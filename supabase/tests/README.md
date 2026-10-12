# SQL check on a real PostgreSQL engine (PGlite)

`pglite_check.mjs` runs the Supabase SQL on PostgreSQL in WebAssembly (PGlite, `@electric-sql/pglite`, not a project dependency) and then replays the server's persistence through the real `SupabaseStore` class (`apps/server/src/supabase-store.ts`).

It checks:

* the roles `anon`, `authenticated` and `service_role` (`service_role` bypasses RLS) and a stub `auth` schema with NULL `auth.uid()` and `auth.jwt()`;
* that every file in `supabase/migrations/` (in filename order) and `supabase/seed.sql` apply, and that re-running them changes nothing;
* tables, indexes, the `games_read_finished` policy, the append-only trigger, RLS on the four game tables;
* the constraints (room code alphabet, enums, ranges, NOT NULL, FKs, duplicate seq);
* the store's SQL through a PostgREST-style adapter (upsert = `INSERT ... ON CONFLICT`, `range` = `LIMIT/OFFSET` capped at 1000 rows, `SET LOCAL ROLE` per request): create, retried writes, commands, snapshots, finish, load with paging, anon key refused;
* RLS as anon and authenticated (finished games only, no config, no player, command or snapshot rows, no writes).

It does not run PostgREST, Supabase Auth or the Supabase CLI. Those need Docker or a hosted project. PGlite is PostgreSQL 18; hosted Supabase runs a different major version.

## Run it

1. Install PGlite in a folder outside the repository (do not add it to the project's `package.json`):

   ```bash
   mkdir ~/pglite-check && cd ~/pglite-check && npm init -y && npm install @electric-sql/pglite
   ```

   PowerShell: `New-Item -ItemType Directory $HOME\pglite-check; cd $HOME\pglite-check; npm init -y; npm install @electric-sql/pglite`

2. From `apps/server` (it uses the server's `tsx` to import the TypeScript store):

   ```bash
   cd apps/server
   PGLITE_DIR=~/pglite-check npx tsx ../../supabase/tests/pglite_check.mjs
   ```

   PowerShell: `$env:PGLITE_DIR="$HOME\pglite-check"; npx tsx ..\..\supabase\tests\pglite_check.mjs`

The script prints one line per check and exits with code 1 if any check fails. `PGLITE_DIR` is optional when PGlite is installed next to the script or in `apps/server`.
