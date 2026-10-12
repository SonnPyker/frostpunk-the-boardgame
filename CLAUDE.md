# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Web port of *Frostpunk: The Board Game* (solo, and 2 to 4 players in co-op). An npm workspaces monorepo:
`packages/engine` (rules), `apps/server` (co-op WebSocket server), `apps/web` (Vite + React + Three.js client).

Rule sources, in priority order: card text, then the Scenario Book, then the Rulebook. `docs/RULES_CHECKLIST.md` has
the rule IDs. Read `docs/PROGRESS.md` and `docs/KNOWN_ISSUES.md` first when resuming, and update `PROGRESS.md` at the
end of each chunk of work.

## Commands

Node 20 or newer (CI uses 22). Run from the repo root. `npm ci` installs every workspace from the root lockfile.

```bash
npm run dev:web            # client at http://localhost:5173 (solo needs no server)
npm run dev:server         # game server on PORT (default 8080), co-op only
npm run typecheck          # engine, server, web. No linter or formatter is configured.
npm test                   # engine tests (Vitest)
npm test -w apps/server    # server tests
npm run build              # web and server builds (the committed assets are enough; assets_src/ is not needed)
```

Single test files and names:

```bash
cd packages/engine && npx vitest run tests/buildings.test.ts
cd packages/engine && npx vitest run -t "SET-08"    # by name; rule IDs appear in describe() titles
cd apps/server && npx vitest run tests/validate.test.ts
```

Simulation and checks:

```bash
npm run sim -- --games 200 --smart                  # solo, all scenarios; prints a repro line per game
npm run sim -- --games 200 --smart --coop --extra
npm run sim -- --games 300 --smart --coverage       # lists ops, tokens and cards the games never reached
cd packages/engine && npx tsx scripts/scan_tokens.ts    # must report 0 unknown FX token heads
cd apps/server && npx tsx scripts/smoke.ts          # in-process co-op smoke test, prints "smoke: PASS"
cd apps/server && npx tsx scripts/e2e.ts [--supabase]
```

Other tools:

- `npm run assets` rebuilds `apps/web/public/assets` from `assets_src/` (needs Python 3). `python -I tools/optimize_assets.py --verify` only checks the outputs.
- After editing `docs/RULES_CHECKLIST.md`, run `python -I tools/gen_checklist_json.py` to regenerate `apps/web/public/checklist.json`.
- `tools/gen_map.py`, `gen_citizens.py` and `gen_expeditions.py` generate `packages/engine/src/data/raw/map.json`, `citizens.json` and `expeditions.json`. Change the generator, not its output.
- The SQL check runs on PGlite outside the repo. See `supabase/tests/README.md`.

## Engine (`packages/engine`)

- **Determinism is the core invariant.** A game is `config + seed + command log`, and `replay(config, commands)` rebuilds
  the same state. The solo autosave, the co-op snapshots and the server restore all depend on this. So `GameState` and
  op payloads must stay plain JSON: no `Date`, `Math.random`, `Map`, `Set`, class instances or functions. All
  randomness goes through the seeded RNG in `s.rng` (`rng.ts`).
- **Control flow is an op stack.** `state.stack` holds data-only ops. `run(state)` pops them until a decision is pending
  (`state.pending`) or the game ends. `answer(s, who, pendingId, pick)` resumes the game.
- **Ops** are registered with `defOp(name, handler)`. Names are global (a duplicate throws) and prefixed by module:
  `bld`, `act`, `exp`, `law`, `tech`, `ph`, `nt`, `scn`, `cus`. A decision is raised with `ask` or `askDistribute`
  (`core.ts`), with a `then` op that receives the answer as `op.pick`. `ask` resolves on its own when nothing is left
  to decide (exactly `min` selectable options with `min` = `max`, or no options at all), unless `forced: true`.
- **Registration happens by side-effect import.** `src/index.ts` and `src/fx/index.ts` import every module. A new file
  that calls `defOp` or `defTok` does nothing until something imports it. Each `fx/tokens_*.ts` imports the module that
  owns its ops.
- **Card and building effects are data.** `src/data/raw/*.json` is loaded through `src/data/index.ts`. Effects use the
  FX DSL (`docs/FX_DSL.md`): tokens are registered with `defTok` in `src/fx/tokens_*.ts` and run with `runFx`. Effects
  the DSL cannot express are `custom:<ID>` handlers in `src/fx/custom.ts`, with the card text in
  `docs/CARD_TEXT_CUSTOM.md`.
- **Working data for a feature** goes in `s.flags`, `s.scenarioState`, `Building.extra` or `EventCardInPlay.extra`.
- **Public API** (`src/index.ts`): `createGame`, `answer`, `view(s, seat)`, `serialize`, `deserialize`, `replay`, `autoplay`.
  `view` is redacted for one seat. `{ omniscient: true }` is for the simulator and the dev harness only.
- **Decision kinds and option IDs** are a contract with the UI (`docs/DECISION_IDS.md`). Rules decisions that are already
  made are recorded in `docs/ENGINE_SPEC.md` section 3. Do not re-derive them.
- **Tests:** `tests/audit*_*.test.ts` are regression tests, grouped by audit wave or fix. Describe titles carry rule IDs
  (for example `describe('SET-08 ...')`).

## Server (`apps/server`)

- `src/index.ts` boots in this order: config from env (see root `.env.example`), then the store (Supabase only when both
  `SUPABASE_URL` and the service-role key are set, otherwise in memory), then `RoomManager`, then restore of unfinished
  games, then `startServer`.
- `src/server.ts` serves HTTP (`/health`, `/api/rooms`) and WebSocket (`/ws`) on one port. It also handles heartbeat,
  message rate limits, a per-IP connection cap (`MAX_CONN_PER_IP`) and graceful shutdown.
- `src/rooms.ts` (`RoomManager`) owns lobbies, seats and live games. The server is authoritative and sends each seat its
  redacted `engine.view`. `src/engine.ts` is the only module that loads the real engine. `src/adapter.ts` is the type-only
  contract, so tests inject `tests/fake-engine.ts`.
- **Persistence:** `store.ts` defines the interface and `MemoryStore`. `supabase-store.ts` is the Supabase implementation.
  `persist.ts` is an ordered, retrying write queue, one per game. Every write is idempotent. A snapshot is written every
  `PERSIST_SNAPSHOT_EVERY` commands. On restore, the server loads the latest snapshot and replays the command tail.
- **Wire protocol:** `packages/engine/src/protocol.ts` is authoritative. `apps/web/src/controller/remoteTypes.ts` is a
  hand-kept mirror, so change both together. Details are in `docs/NET_PROTOCOL.md`.

## Web (`apps/web`)

- `main.tsx` mounts `Boot` (loading screen) around `App.tsx`. `App.tsx` picks the screen from two zustand stores:
  `store/session.ts` (the active controller and its latest snapshot) and `store/ui.ts` (menu and screen state).
- `controller/` is the only layer the UI uses to reach a game, through the `Controller` interface in `types.ts`.
  `LocalController` runs the engine in the tab for solo play. Its autosave is the list of answers, and Continue replays it
  (`persistence.ts`). `RemoteController` talks to the server over WebSocket, reconnects with backoff and resumes its
  seat with the stored token. `engineApi.ts` is the only web module that imports the engine.
- In co-op, the snapshot state is the seat's redacted view cast to `GameState`. Read only the fields the view keeps.
- Layers: `map/` (Three.js board and picking), `hud/` (panels), `decisions/` (decision panel and pickers), `screens/`,
  `audio/`.
- UI text is Vietnamese by default (`apps/web/src/i18n`, Settings → Language switches to English). Wrap visible strings
  with `t()` (plain) or `tn()` (visible, with game-term glosses), keep the English literal in the code, and add the
  translation to `tools/i18n/ui/`. Then run `node tools/i18n/build_vi.mjs`. Never hand-edit `vi.json`. See `docs/I18N.md`.
- `src/dev/` and the `hud-harness.html` and `map-harness.html` pages are dev-only. The DEV-only `window.__fp` hook is a
  fast-forward helper. Vite builds only `index.html`, so these pages are not in the production bundle.
- The deployed assets are `apps/web/public/assets` (committed), listed in `src/assets/manifest.ts`.
- The CSP in `vercel.json` is `script-src 'self'`. Do not add inline scripts or CDN script tags to `index.html`.

## Deploy

Three services. Vercel serves `apps/web` (build `npm run build:web`, output `apps/web/dist`, SPA rewrite in `vercel.json`).
Render runs `apps/server` from `render.yaml` (`npm ci && npm run build:server`, then `node apps/server/dist/server.mjs`).
Supabase holds the schema in `supabase/migrations`, applied in filename order. The browser never talks to Supabase. The
service-role key lives only on the server. Steps are in `docs/DEPLOYMENT.md`.

## Gotchas

- Bots never win. A 0-win simulation is the documented baseline (`docs/KNOWN_ISSUES.md`), not a regression. `--boost`
  is out-of-rules and shows only that the late game is reachable.
- Only Crater, Frozen Grove and Dreadnought are playable. The other scenarios are listed as unavailable on purpose,
  because the supplied Scenario Book does not cover them.
- `assets_src/` (raw TTS copy) and `scratch/` (debug output) are git-ignored. Do not publish `assets_src/`.
- Hosted Supabase has not been tested. The SQL was checked only on PGlite.
