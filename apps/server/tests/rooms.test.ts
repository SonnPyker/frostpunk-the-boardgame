import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '../../../packages/engine/src/protocol';
import { MemoryStore } from '../src/store';
import { RoomManager, type Session } from '../src/rooms';
import { makeFakeEngine } from './fake-engine';

interface TestSession extends Session {
  out: ServerMessage[];
  closed: { code: number; reason: string }[];
}

let counter = 0;

function makeSession(label: string): TestSession {
  counter++;
  const s: TestSession = {
    id: `s${counter}`,
    guestId: `guest-${label}-${counter}`,
    name: label,
    room: null,
    seat: null,
    out: [],
    closed: [],
    send(msg) {
      s.out.push(msg);
    },
    close(code, reason) {
      s.closed.push({ code, reason });
    },
  };
  return s;
}

function of<T extends ServerMessage['t']>(s: TestSession, t: T): Extract<ServerMessage, { t: T }>[] {
  return s.out.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
}

function lastOf<T extends ServerMessage['t']>(s: TestSession, t: T): Extract<ServerMessage, { t: T }> | undefined {
  return of(s, t).at(-1);
}

function errorsOf(s: TestSession): string[] {
  return of(s, 'error').map((e) => e.code);
}

function clearOut(...ss: TestSession[]) {
  for (const s of ss) s.out.length = 0;
}

interface Harness {
  manager: RoomManager;
  store: MemoryStore;
  engine: ReturnType<typeof makeFakeEngine>;
  logs: string[];
  send(s: TestSession, msg: ClientMessage): void;
  tokenOf(s: TestSession): string;
}

function harness(opts: { store?: MemoryStore; lobbyGraceMs?: number; maxRooms?: number; abandonAfterMs?: number } = {}): Harness {
  const engine = makeFakeEngine();
  const store = opts.store ?? new MemoryStore();
  const logs: string[] = [];
  let tokens = 0;
  let codes = 0;
  const codeList = ['ABCDEF', 'GHJKMN', 'PQRSTU', 'VWXYZA', 'BCDFGH', 'JKLMNP'];
  const manager = new RoomManager({
    engine,
    store,
    snapshotEvery: 2,
    lobbyGraceMs: opts.lobbyGraceMs ?? 1000,
    endedRoomTtlMs: 5000,
    maxRooms: opts.maxRooms ?? 100,
    abandonAfterMs: opts.abandonAfterMs ?? 60_000,
    retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    log: (_l, msg) => logs.push(msg),
    ids: {
      roomCode: () => codeList[codes++ % codeList.length],
      token: () => `token-${++tokens}-abcdefghijkl`,
      guestId: () => `guest-${tokens}`,
      seed: () => 42,
    },
  });
  const tokenByTrack = new Map<TestSession, string>();
  return {
    manager,
    store,
    engine,
    logs,
    send(s, msg) {
      manager.handle(s, msg);
      if (msg.t === 'create' || msg.t === 'join') {
        const joined = lastOf(s, 'joined');
        if (joined) tokenByTrack.set(s, joined.token);
      }
    },
    tokenOf(s) {
      const t = tokenByTrack.get(s);
      if (!t) throw new Error('no token recorded for ' + s.name);
      return t;
    },
  };
}

const create = (h: Harness, s: TestSession, settings: Record<string, unknown> = {}) =>
  h.send(s, { t: 'create', name: s.name, settings: settings as never });

function codeOf(s: TestSession): string {
  const j = lastOf(s, 'joined');
  if (!j) throw new Error('not joined');
  return j.code;
}

describe('lobby', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('create gives a 6-letter code, seat 0 and a token; the host is ready', () => {
    const host = makeSession('host');
    create(h, host, { seats: 3, scenario: 'frozenGrove', society: 2, difficulty: 'hard', extraPack: true, advisors: ['ADV_GENERATOR'] });
    const j = lastOf(host, 'joined');
    expect(j).toBeDefined();
    expect(j!.code).toMatch(/^[A-HJ-NP-Z]{6}$/);
    expect(j!.seat).toBe(0);
    expect(j!.token.length).toBeGreaterThan(10);
    const room = lastOf(host, 'room')!.room;
    expect(room.status).toBe('lobby');
    expect(room.settings).toMatchObject({ seats: 3, scenario: 'frozenGrove', society: 2, difficulty: 'hard', extraPack: true });
    expect(room.players).toEqual([
      expect.objectContaining({ seat: 0, host: true, ready: true, connected: true }),
    ]);
  });

  it('join assigns the next seat, broadcasts the roster and enforces the seat limit', () => {
    const host = makeSession('host');
    const p2 = makeSession('p2');
    const p3 = makeSession('p3');
    create(h, host, { seats: 2 });
    const code = codeOf(host);
    h.send(p2, { t: 'join', code: code.toLowerCase(), name: 'Ann' });
    expect(lastOf(p2, 'joined')).toMatchObject({ seat: 1, code });
    expect(lastOf(host, 'room')!.room.players.map((p) => p.name)).toEqual(['host', 'Ann']);
    h.send(p3, { t: 'join', code, name: 'Bob' });
    expect(errorsOf(p3)).toEqual(['room_full']);
  });

  it('rejects unknown codes and malformed joins', () => {
    const s = makeSession('x');
    h.send(s, { t: 'join', code: 'ZZZZZZ', name: 'x' });
    expect(errorsOf(s)).toEqual(['room_not_found']);
  });

  it('only the host changes settings, and seats cannot drop below the current player count', () => {
    const host = makeSession('host');
    const p2 = makeSession('p2');
    create(h, host, { seats: 4 });
    h.send(p2, { t: 'join', code: codeOf(host), name: 'Ann' });
    clearOut(host, p2);
    h.send(p2, { t: 'settings', settings: { society: 3 } });
    expect(errorsOf(p2)).toEqual(['not_host']);
    h.send(host, { t: 'settings', settings: { seats: 1 } });
    expect(errorsOf(host)).toEqual(['bad_request']);
    h.send(host, { t: 'settings', settings: { society: 3, roomName: 'Night shift' } });
    expect(lastOf(p2, 'room')!.room.settings).toMatchObject({ society: 3, roomName: 'Night shift' });
  });

  it('leaving the lobby compacts seats and moves the host to seat 0', () => {
    const host = makeSession('host');
    const p2 = makeSession('p2');
    const p3 = makeSession('p3');
    create(h, host, { seats: 4 });
    const code = codeOf(host);
    h.send(p2, { t: 'join', code, name: 'Ann' });
    h.send(p3, { t: 'join', code, name: 'Bob' });
    h.send(host, { t: 'leave' });
    expect(lastOf(host, 'left')).toEqual({ t: 'left', code });
    expect(host.room).toBeNull();
    expect(p3.seat).toBe(1);
    expect(p2.seat).toBe(0);
    const room = lastOf(p3, 'room')!.room;
    expect(room.players.map((p) => [p.name, p.seat, p.host])).toEqual([
      ['Ann', 0, true],
      ['Bob', 1, false],
    ]);
  });

  it('a disconnected lobby seat is removed after the grace period, and an empty room disappears', () => {
    vi.useFakeTimers();
    try {
      const host = makeSession('host');
      const p2 = makeSession('p2');
      create(h, host, { seats: 4 });
      h.send(p2, { t: 'join', code: codeOf(host), name: 'Ann' });
      h.manager.disconnect(p2);
      expect(h.manager.describeRoom(codeOf(host))!.players).toHaveLength(2);
      vi.advanceTimersByTime(1000);
      expect(h.manager.describeRoom(codeOf(host))!.players).toHaveLength(1);
      h.manager.disconnect(host);
      expect(h.manager.roomCount).toBe(1);
      vi.advanceTimersByTime(1000);
      expect(h.manager.roomCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('listOpenRooms exposes lobbies only, without tokens or guest ids', () => {
    const host = makeSession('host');
    create(h, host, { seats: 2 });
    const list = h.manager.listOpenRooms();
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0])).not.toContain('token');
    expect(JSON.stringify(list)).not.toContain('guest');
    h.send(host, { t: 'start' });
    expect(h.manager.listOpenRooms()).toHaveLength(0);
  });
});

describe('game start and answer routing', () => {
  let h: Harness;
  let host: TestSession;
  let p2: TestSession;
  let code: string;

  beforeEach(() => {
    h = harness();
    host = makeSession('host');
    p2 = makeSession('p2');
    create(h, host, { seats: 2 });
    code = codeOf(host);
    h.send(p2, { t: 'join', code, name: 'Ann' });
    clearOut(host, p2);
  });

  it('start is refused until every seat is connected and ready, and only the host may start', () => {
    h.send(p2, { t: 'start' });
    expect(errorsOf(p2)).toEqual(['not_host']);
    h.send(host, { t: 'start' });
    expect(errorsOf(host)).toEqual(['not_ready']);
    h.send(p2, { t: 'ready', ready: true });
    clearOut(host, p2);
    h.send(host, { t: 'start' });
    expect(h.engine.createCalls).toBe(1);
    expect(lastOf(host, 'state')).toMatchObject({ seat: 0, seq: 0, status: 'playing', pending: { id: 1, who: 0 } });
    expect(lastOf(p2, 'state')).toMatchObject({ seat: 1, seq: 0, pending: { id: 1, who: 0 } });
    expect(lastOf(p2, 'room')!.room.status).toBe('playing');
  });

  it('start configures the engine with seats as players and the lobby settings', () => {
    h.send(p2, { t: 'ready', ready: true });
    const created: unknown[] = [];
    const original = h.engine.createGame;
    h.engine.createGame = (config) => {
      created.push(config);
      return original(config);
    };
    h.send(host, { t: 'start' });
    expect(created[0]).toMatchObject({
      mode: 'coop',
      scenario: 'crater',
      players: [
        { name: 'host', id: expect.any(String) },
        { name: 'Ann', id: expect.any(String) },
      ],
      seed: 42,
    });
  });

  it('answers are routed by pending.who and validated; rejected answers change nothing', () => {
    h.send(p2, { t: 'ready', ready: true });
    h.send(host, { t: 'start' });
    clearOut(host, p2);

    h.send(p2, { t: 'answer', pendingId: 1, pick: ['a'] });
    expect(errorsOf(p2)).toEqual(['not_your_decision']);

    h.send(host, { t: 'answer', pendingId: 7, pick: ['a'] });
    expect(errorsOf(host)).toEqual(['stale_decision']);

    h.send(host, { t: 'answer', pendingId: 1, pick: ['zzz'] });
    expect(errorsOf(host)).toEqual(['stale_decision', 'invalid_answer']);
    expect(h.manager.describeRoom(code)!.seq).toBe(0);
    expect(lastOf(host, 'state')).toBeUndefined();
  });

  it('decision 2 is open to any seat (who = -1); the state advances and both seats get new views', () => {
    h.send(p2, { t: 'ready', ready: true });
    h.send(host, { t: 'start' });
    h.send(host, { t: 'answer', pendingId: 1, pick: ['a'] });
    expect(errorsOf(host)).toEqual([]);
    clearOut(host, p2);
    expect(lastOf(host, 'state')).toBeUndefined();
    h.send(p2, { t: 'answer', pendingId: 2, pick: ['b'] });
    expect(errorsOf(p2)).toEqual([]);
    expect(lastOf(host, 'state')).toMatchObject({ seq: 2, seat: 0, pending: { id: 3, who: 0 } });
    expect(lastOf(p2, 'state')).toMatchObject({ seq: 2, seat: 1, pending: { id: 3, who: 0 } });
  });

  it('a seat outside the room cannot answer, and answering before the game starts is refused', () => {
    const stranger = makeSession('stranger');
    h.send(stranger, { t: 'answer', pendingId: 1, pick: ['a'] });
    expect(errorsOf(stranger)).toEqual(['not_in_room']);
    h.send(host, { t: 'answer', pendingId: 1, pick: ['a'] });
    expect(errorsOf(host)).toEqual(['wrong_status']);
  });

  it('ending the game sends ended, then a final state, and further answers are refused', () => {
    h.send(p2, { t: 'ready', ready: true });
    h.send(host, { t: 'start' });
    h.send(host, { t: 'answer', pendingId: 1, pick: ['a'] });
    h.send(p2, { t: 'answer', pendingId: 2, pick: ['end'] });
    expect(lastOf(host, 'ended')).toEqual({ t: 'ended', code, status: 'lost', reason: 'ended by players' });
    expect(lastOf(host, 'state')).toMatchObject({ status: 'lost', pending: null });
    expect(h.manager.describeRoom(code)!.status).toBe('ended');
    clearOut(host);
    h.send(host, { t: 'answer', pendingId: 3, pick: ['a'] });
    expect(errorsOf(host)).toEqual(['game_over']);
  });

  it('a chat message reaches every room member with the sender seat', () => {
    h.send(p2, { t: 'chat', text: 'hello there' });
    expect(lastOf(host, 'chat')).toMatchObject({ from: { seat: 1, name: 'Ann' }, text: 'hello there' });
    expect(lastOf(p2, 'chat')).toMatchObject({ text: 'hello there' });
  });

  it('ping is answered with pong and echoes ts', () => {
    h.send(host, { t: 'ping', ts: 123 });
    expect(lastOf(host, 'pong')).toEqual({ t: 'pong', ts: 123 });
  });
});

describe('resume and reconnect', () => {
  it('a seat resumes with its token after a socket drop and receives the current view', () => {
    const h = harness();
    const host = makeSession('host');
    const p2 = makeSession('p2');
    create(h, host, { seats: 2 });
    const code = codeOf(host);
    h.send(p2, { t: 'join', code, name: 'Ann' });
    h.send(p2, { t: 'ready', ready: true });
    h.send(host, { t: 'start' });
    h.send(host, { t: 'answer', pendingId: 1, pick: ['a'] });
    const token = h.tokenOf(p2);

    h.manager.disconnect(p2);
    expect(h.manager.describeRoom(code)!.players.find((p) => p.seat === 1)!.connected).toBe(false);

    const again = makeSession('ann-again');
    h.send(again, { t: 'resume', code, token });
    expect(lastOf(again, 'resumed')).toEqual({ t: 'resumed', code, seat: 1 });
    expect(lastOf(again, 'state')).toMatchObject({ seat: 1, seq: 1, pending: { id: 2, who: -1 } });
    expect(h.manager.describeRoom(code)!.players.find((p) => p.seat === 1)!.connected).toBe(true);
  });

  it('a wrong token is refused', () => {
    const h = harness();
    const host = makeSession('host');
    create(h, host, { seats: 2 });
    const intruder = makeSession('intruder');
    h.send(intruder, { t: 'resume', code: codeOf(host), token: 'not-the-token-at-all' });
    expect(errorsOf(intruder)).toEqual(['bad_token']);
  });

  it('resuming from a second socket takes the seat and closes the first socket', () => {
    const h = harness();
    const host = makeSession('host');
    create(h, host, { seats: 2 });
    const code = codeOf(host);
    const token = h.tokenOf(host);
    const second = makeSession('host-2');
    h.send(second, { t: 'resume', code, token });
    expect(lastOf(second, 'resumed')).toMatchObject({ seat: 0 });
    expect(host.closed).toEqual([{ code: 4001, reason: 'seat resumed from another connection' }]);
    expect(host.room).toBeNull();
  });

  it('disconnect removes the socket from the connection registry', () => {
    const h = harness();
    const host = makeSession('host');
    h.manager.connect(host);
    expect(h.manager.connectionCount).toBe(1);
    h.manager.disconnect(host);
    expect(h.manager.connectionCount).toBe(0);
  });
});

describe('persistence and restore', () => {
  it('persists the room, players, commands and snapshots as the game progresses', async () => {
    const h = harness();
    const host = makeSession('host');
    const p2 = makeSession('p2');
    create(h, host, { seats: 2 });
    h.send(p2, { t: 'join', code: codeOf(host), name: 'Ann' });
    h.send(p2, { t: 'ready', ready: true });
    h.send(host, { t: 'start' });
    h.send(host, { t: 'answer', pendingId: 1, pick: ['a'] });
    h.send(p2, { t: 'answer', pendingId: 2, pick: ['b'] });
    await h.manager.flush();

    const games = await h.store.loadActiveGames();
    expect(games).toHaveLength(1);
    const g = games[0];
    expect(g.roomCode).toBe(codeOf(host));
    expect(g.players.map((p) => [p.seat, p.name, p.isHost])).toEqual([
      [0, 'host', true],
      [1, 'Ann', false],
    ]);
    expect(g.players[0].tokenHash).not.toContain(h.tokenOf(host));
    expect(g.commands).toEqual([
      { seq: 1, who: 0, pendingId: 1, pick: ['a'] },
      { seq: 2, who: 1, pendingId: 2, pick: ['b'] },
    ]);
    // snapshotEvery is 2 in this harness: a snapshot at seq 0 (start) and at seq 2
    expect(g.snapshot?.seq).toBe(2);
  });

  it('restores an unfinished game from the store, and the same tokens keep working', async () => {
    const store = new MemoryStore();
    const h1 = harness({ store });
    const host = makeSession('host');
    const p2 = makeSession('p2');
    create(h1, host, { seats: 2 });
    const code = codeOf(host);
    h1.send(p2, { t: 'join', code, name: 'Ann' });
    h1.send(p2, { t: 'ready', ready: true });
    h1.send(host, { t: 'start' });
    h1.send(host, { t: 'answer', pendingId: 1, pick: ['a'] });
    h1.send(p2, { t: 'answer', pendingId: 2, pick: ['a'] });
    const hostToken = h1.tokenOf(host);
    const annToken = h1.tokenOf(p2);
    await h1.manager.flush();

    // a new process: fresh manager over the same store
    const h2 = harness({ store });
    expect(await h2.manager.restore()).toBe(1);
    expect(h2.manager.describeRoom(code)).toMatchObject({ status: 'playing', seq: 2 });

    const back = makeSession('host-back');
    h2.send(back, { t: 'resume', code, token: hostToken });
    expect(errorsOf(back)).toEqual([]);
    expect(lastOf(back, 'state')).toMatchObject({ seq: 2, seat: 0, pending: { id: 3, who: 0 } });
    h2.send(back, { t: 'answer', pendingId: 3, pick: ['b'] });
    expect(errorsOf(back)).toEqual([]);
    expect(lastOf(back, 'state')).toMatchObject({ status: 'won', seq: 3 });

    const annBack = makeSession('ann-back');
    h2.send(annBack, { t: 'resume', code, token: annToken });
    expect(lastOf(annBack, 'resumed')).toEqual({ t: 'resumed', code, seat: 1 });
    await h2.manager.flush();
    expect((await store.loadActiveGames())).toHaveLength(0);
  });

  it('restores from the full command log when no snapshot exists', async () => {
    const store = new MemoryStore();
    const id = 'game-1';
    await store.createGame({
      id,
      roomCode: 'ABCDEF',
      roomName: 'Old room',
      config: { scenario: 'crater', society: 1, difficulty: 'normal', mode: 'solo', players: [{ name: 'solo', id: 'g1' }], seed: 42, extraPack: false, advisors: [] },
    });
    await store.addPlayers(id, [{ seat: 0, guestId: 'g1', name: 'solo', isHost: true, tokenHash: 'x'.repeat(64) }]);
    await store.appendCommand(id, { seq: 1, who: 0, pendingId: 1, pick: ['a'] });
    const h = harness({ store });
    expect(await h.manager.restore()).toBe(1);
    expect(h.manager.describeRoom('ABCDEF')).toMatchObject({ seq: 1, status: 'playing' });
  });
});

describe('engine failures', () => {
  it('an engine exception is reported as internal, the state is rebuilt from the accepted log, and play continues', () => {
    const h = harness();
    const host = makeSession('host');
    create(h, host, { seats: 1 });
    const code = codeOf(host);
    h.send(host, { t: 'start' });
    h.send(host, { t: 'answer', pendingId: 1, pick: ['a'] });
    clearOut(host);
    h.send(host, { t: 'answer', pendingId: 2, pick: ['boom'] });
    expect(errorsOf(host)).toEqual(['internal']);
    expect(h.manager.describeRoom(code)!.seq).toBe(1);
    h.send(host, { t: 'answer', pendingId: 2, pick: ['b'] });
    expect(errorsOf(host)).toEqual(['internal']); // no new error from the valid answer
    expect(lastOf(host, 'state')).toMatchObject({ seq: 2, pending: { id: 3 } });
  });
});
