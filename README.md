# Frostpunk: The Board Game, web port

A web port of the board game *Frostpunk: The Board Game* for solo play and co-op play (2 to 4 players in one city).
The rules engine is complete for the three scenarios that the supplied Scenario Book covers (Crater, Frozen Grove,
Dreadnought). This is an unofficial fan project. The game, its art, sounds and models belong to their rights holders.

Status and known gaps: [`docs/PROGRESS.md`](docs/PROGRESS.md) ("State at end of session") and
[`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md) ("Current state"). Winnability is not established: the bots have never
won a game.

## Stack

| Part | Stack | Role |
| --- | --- | --- |
| `packages/engine` | TypeScript, Vitest | Pure rules engine. Deterministic, seeded, serialisable, replayable. No DOM, no network. |
| `apps/web` | Vite, React, Three.js, zustand | Browser client. Solo mode runs the engine in the browser. |
| `apps/server` | Node, `ws`, Supabase JS | Realtime co-op server. Authoritative state, per-seat redacted views, snapshots and command log to Supabase. |
| `supabase/migrations` | SQL | Schema for saved games, seats, commands and snapshots. |
| `tools/` | Python 3 | Checklist JSON generator, asset optimiser, data generators. |
| `docs/` | Markdown | Rules checklist, effect language, engine and protocol specs, progress, known issues, deployment. |

## Commands

Run from the repository root. Node 20 or newer (CI uses 22), npm 10 or newer.

```bash
npm ci                      # install all workspaces from the lockfile
npm run dev:server          # game server, watch mode (PORT, default 8080)
npm run dev:web             # web client on http://localhost:5173
npm test                    # engine tests (Vitest)
npm test -w apps/server     # server tests (Vitest)
npm run typecheck           # engine, server and web
npm run build               # web and server builds
npm run sim -- --games 200 --smart   # bot simulation of engine games
```

Solo play needs neither the server nor Supabase. Copy the `.env.example` files to `apps/web/.env.local` and
`apps/server/.env` when you need them. The variables are listed in the `.env.example` files.

`npm run typecheck`, `npm run build` and all tests pass (see docs/PROGRESS.md for the current numbers).

## Deploy

Summary. The full steps are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

1. **Supabase**: create a project and apply `supabase/migrations/` in filename order.
2. **Render**: create a Blueprint from `render.yaml`. Set `CORS_ORIGIN`, `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` (a secret, server only). Check `/health`.
3. **Vercel**: import the repository. `vercel.json` sets the install, build (`npm run build:web`) and output
   (`apps/web/dist`) settings and the SPA rewrite. Set `VITE_SERVER_URL` (the Render `wss://` URL), then deploy. The browser never talks to
   Supabase, so no other `VITE_*` variable exists.
4. Put the Vercel origin into `CORS_ORIGIN` on Render and redeploy the server.

Solo play needs only the Vercel deployment. Co-op needs the Render service. The Render free plan sleeps when idle,
which interrupts live games.

## Assets

* `assets_src/` is a raw copy of the TTS mod. It is git-ignored and not deployed.
* `apps/web/public/assets/` is the optimised set that is deployed. It is committed. Regenerate it with
  `npm run assets` (needs `assets_src/` and Python 3). See [`docs/ASSETS.md`](docs/ASSETS.md).

## Licence and attribution

The engine and web code are the project's own work (licence to be added). *Frostpunk: The Board Game* and its
assets belong to their owners. Do not publish `assets_src/` or `apps/web/public/assets/` without the rights to do so.
