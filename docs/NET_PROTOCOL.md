# Network protocol (web client guide)

Types live in `packages/engine/src/protocol.ts` (`ClientMessage`, `ServerMessage`, `RoomView`, `PendingSummary`, `ErrorCode`). Import them from there; do not re-declare them.

## Endpoints

| URL | purpose |
|---|---|
| `wss://<host>/ws` (also `/`) | WebSocket. JSON text frames. Max frame 16 KB; a larger frame closes the socket with 1009. Binary frames are refused with `bad_request` and take a rate-limit token like text frames. When the server is at its connection cap (`MAX_CONNECTIONS`), the upgrade is refused with HTTP 503: retry later. |
| `GET /health` | `{ ok, protocol: 1, uptimeSec, rooms, connections, persistence: 'memory' \| 'supabase', persistPending, persistFailed }`. `persistPending` is the number of database writes still queued or retrying. `persistFailed` counts writes given up after every retry (the game still runs; those rows are missing from the database). |
| `GET /api/rooms` | `{ rooms: [{ code, roomName, scenario, society, difficulty, seated, maxSeats, host, createdAt }] }`. Open lobbies only. No tokens or guest ids. |

Origins are checked against `CORS_ORIGIN` (comma list of bare origins such as `https://app.example`; a trailing slash is fine, a path is not). Unset means any origin. Requests without an `Origin` header (CLI, tests) are allowed. A malformed `CORS_ORIGIN` stops the server at start-up with an error in the log.

## Connection lifecycle

1. Open the socket. The server sends `welcome { guestId, protocol: 1 }` right away. `guestId` is an anonymous label. Keep it in `localStorage` if you want, but it grants nothing.
2. Optionally send `hello { name, guestId }` to set a display name before creating or joining a room.
3. `create` or `join`. The server replies `joined { code, seat, token }`. **Store `token` (sessionStorage or localStorage).** It is the only way back into the seat. It is sent once.
4. The server pushes `room` (lobby and roster) and, once the game runs, `state` for your seat after every change.
5. Heartbeat: the server sends a WebSocket ping about every 25 s and drops sockets that stop answering. Browsers answer pings automatically. You may also send `ping { ts }` and get `pong { ts }` back to measure latency.
6. On socket close or `shutdown`, reconnect with exponential backoff (1 s, 2 s, 4 s … cap 15 s). On open, send `resume { code, token }`. You receive `resumed`, then `room`, then `state`.

If `resume` answers `error bad_token`, the room was removed or the token is wrong. Drop the stored session and go back to the lobby screen.

## Client to server (`ClientMessage`)

| `t` | fields | who | notes |
|---|---|---|---|
| `hello` | `guestId?`, `name?` | anyone | only applied outside a room |
| `create` | `name`, `settings?` | anyone | sender becomes seat 0 (host) |
| `join` | `code`, `name` | anyone | lobby only; code is case-insensitive |
| `resume` | `code`, `token` | seat owner | works in the lobby and during a game |
| `settings` | `settings` (partial) | host | lobby only |
| `ready` | `ready` | any seat | lobby only |
| `start` | none | host | every seat must be connected and ready, and the table must be one the rules allow (otherwise `bad_request` with the rule text) |
| `answer` | `pendingId`, `pick` | seat in `pending.who` (or any seat when `who` is -1) | `pick` is an array of option ids |
| `chat` | `text` (1..300 chars) | seated players | broadcast to the room |
| `leave` | none | seated player | lobby: seat removed. Game: seat kept for resume. |
| `ping` | `ts?` | anyone | answered with `pong` |

`LobbySettings`: `roomName` (1..40), `seats` (1..4, the maximum), `scenario` (`crater` | `frozenGrove` | `dreadnought`), `society` (1..6), `difficulty` (`normal` | `hard`), `extraPack`, `advisors` (up to 4 entries, `null` or a short id string), `seed` (uint32). Seats are dense: seat index equals the engine player index. Seat 0 is always the host.

## Server to client (`ServerMessage`)

| `t` | when | payload |
|---|---|---|
| `welcome` | socket opened | `guestId`, `protocol` |
| `joined` | after `create` or `join` | `code`, `seat`, `token` |
| `resumed` | after `resume` | `code`, `seat` |
| `room` | any lobby or roster change, presence change, status change | `room: RoomView` (`status`, `settings`, `players[]` with `host`, `ready`, `connected`, `seq`) |
| `state` | after game start and after every applied answer, to each attached seat | `code`, `seq`, `seat`, `view`, `pending`, `status`, `endReason` |
| `ended` | once, when the game is won or lost | `code`, `status`, `reason`. A final `state` follows it. |
| `chat` | room chat | `code`, `from: { seat, name }`, `text`, `ts` |
| `left` | after `leave` | `code` |
| `pong` | after `ping` | `ts?` |
| `error` | a request was refused | `code: ErrorCode`, `message` |
| `shutdown` | the server is stopping | `reconnectInMs` (at most 10 000). Reconnect and `resume` after that delay. |

### `state.view`

`view` is `engine.view(state, seat)`: the redacted, JSON-safe game view for your seat (hidden deck order, other players' hidden cards, and so on). Its type is `unknown` in `protocol.ts` until the engine exports `GameView`. Narrow it in the client, or wait for that export.

`pending` is a summary: `{ id, who, kind, prompt, min, max }`. The option list is in `view` and is only populated for seats that may answer. Show the decision only when `pending.who` is `-1` or equals your seat. Anyone else sees it as a waiting state.

### Errors (`ErrorCode`)

| code | meaning |
|---|---|
| `bad_request` | malformed frame or field, or a `start` the rules refuse (for example, fewer chosen Advisors than players). `message` says what is wrong, and for a refused start it is the rule itself, for example `the table needs at least 3 Advisors (one per player)`. Change the settings and start again. |
| `rate_limited` | more than about 30 messages in a short burst. Back off. Twenty refused messages within ten seconds close the socket with 1008. Refusals spread over a longer time, or mixed with accepted messages, are counted in a sliding window and do not close the socket by themselves. |
| `already_in_room` | leave first |
| `not_in_room` | join or create first |
| `room_not_found` | no such code (lobbies are dropped when their last seat leaves; finished games leave memory an hour after they end, but stay in the database; a live game with no player connected for `ABANDON_GAME_MINUTES` is marked `abandoned` and leaves memory) |
| `room_full` | the lobby has `seats` players |
| `wrong_status` | e.g. `join` after the start, or `answer` in the lobby |
| `bad_token` | `resume` with an unknown token |
| `not_host` | host-only action |
| `not_ready` | start requires every seat connected and ready |
| `game_over` | the game already ended |
| `stale_decision` | `pendingId` is not the open decision any more. Refresh from the latest `state`. |
| `not_your_decision` | `pending.who` is another seat |
| `invalid_answer` | the engine rejected the pick. `message` has the reason. |
| `internal` | the server failed. The state was rebuilt from the log. Also returned when the server has reached `MAX_ROOMS` and refuses `create`; the `message` says which. Retry later. |

Errors do not close the socket, with these exceptions:

* sustained flooding (twenty refused messages within ten seconds) closes with 1008 `rate limit exceeded`;
* a frame over 16 KB closes with 1009;
* more than `MAX_CONN_PER_IP` open sockets from one client address (default 20): the extra socket is accepted and then closed with 1008 `too many connections from this address`. Wait before retrying; do not loop on it. The address is the first `X-Forwarded-For` entry when the server runs with `TRUST_PROXY=1` (Render), otherwise the socket address;
* a seat resumed from another tab: the old socket is closed with 4001 `seat resumed from another connection`, so do not auto-reconnect on that code;
* a server shutdown sends `shutdown { reconnectInMs }` and then closes with 1001.

## Typical sequences

Create, invite, start:
```
C create {name, settings:{seats:2, scenario:'crater', society:1, difficulty:'normal', extraPack:false, advisors:[], seed:1234}}
S joined {code:'ABCDEF', seat:0, token:'…'}
S room {room:{…}}
C (friend) join {code:'ABCDEF', name:'Ann'}     -> S joined {seat:1,…}; everyone gets room
C (friend) ready {ready:true}
C (host)  start                                  -> S state to each seat (seq 0)
```

Answering a decision:
```
S state {seat:0, seq:4, pending:{id:5, who:0, …}, view:{…}}
C answer {pendingId:5, pick:['a']}
S state {seat:0, seq:5, pending:{id:6, who:-1, …}}   (and to every other seat)
```

Reconnect after a drop:
```
(socket closes, room shows connected:false to the others)
C resume {code:'ABCDEF', token:'…'}
S resumed {code, seat:1}  ->  S room  ->  S state (current view)
```

## Notes for the client

* `seq` only goes up. Ignore a `state` whose `seq` is lower than what you already render.
* Treat every `state` as a full snapshot. Do not try to apply diffs.
* The server validates every answer with the engine. The client may disable options for UX, but the server is the source of truth.
* Use `GameState.log` (inside `view`, once exposed) for the event feed and animations.
* `view` never contains the engine's random state, decks or hidden law data. The server strips these keys before sending (`rng`, `stack`, `decks`, `lawConsequenceBank`), so do not rely on them being present. `futureLaws` (Law card ids of the public Future Law display) is sent.
* A game can end with status `abandoned` (`endReason: 'no player connected'`) when no seat has been connected for `ABANDON_GAME_MINUTES`. Treat it like any other ended game.
