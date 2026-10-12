// supabase/tests/pglite_check.mjs
// Checks the Supabase SQL on a real PostgreSQL engine (PostgreSQL 18 compiled to WASM by PGlite) and replays the
// server's persistence through the real SupabaseStore class (apps/server/src/supabase-store.ts). The store's
// supabase-js calls are translated to the PostgREST SQL they compile to (upsert = INSERT ... ON CONFLICT, select with
// range = LIMIT/OFFSET capped at max_rows, every request runs with SET LOCAL ROLE like PostgREST does).
//
// Run (see supabase/tests/README.md):
//   cd apps/server && npx tsx ../../supabase/tests/pglite_check.mjs
// Environment: PGLITE_DIR = folder whose node_modules contains @electric-sql/pglite (optional when it is installed
// next to this file or in apps/server). FROSTPUNK_REPO = repository root (optional; defaults to two levels up).
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.FROSTPUNK_REPO ? resolve(process.env.FROSTPUNK_REPO) : resolve(here, '..', '..');
const MIGRATIONS_DIR = join(REPO, 'supabase', 'migrations');
const SEED_PATH = join(REPO, 'supabase', 'seed.sql');
const STORE_PATH = join(REPO, 'apps', 'server', 'src', 'supabase-store.ts');
const SEED_GAME = '00000000-0000-4000-8000-000000000001';
const TABLES = ['games', 'game_players', 'game_commands', 'game_snapshots'];
const MAX_ROWS = 1000; // supabase/config.toml [api] max_rows, PostgREST default

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function loadPGlite() {
  const tried = [];
  for (const base of [process.env.PGLITE_DIR, here, process.cwd(), join(REPO, 'apps', 'server')]) {
    if (!base) continue;
    try {
      const req = createRequire(join(resolve(base), 'pglite_check.cjs'));
      return req('@electric-sql/pglite').PGlite;
    } catch (e) {
      tried.push(`  ${base}: ${e.code ?? e.message.split('\n')[0]}`);
    }
  }
  throw new Error('cannot load @electric-sql/pglite. Install it (supabase/tests/README.md) and set PGLITE_DIR.\n' + tried.join('\n'));
}

const PGlite = loadPGlite();
let SupabaseStore;
try {
  ({ SupabaseStore } = await import(pathToFileURL(STORE_PATH).href));
} catch (e) {
  throw new Error(
    `cannot import ${STORE_PATH} (${e.code ?? e.message.split('\n')[0]}). Run this script with tsx: cd apps/server && npx tsx ../../supabase/tests/pglite_check.mjs`,
  );
}

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------

const failures = [];
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${String(e?.message ?? e).split('\n').join('\n        ')}`);
  }
}

const ROLLBACK = Symbol('rollback');

/** Runs one statement as `role` inside a transaction (SET LOCAL ROLE, as PostgREST does per request). */
async function asRole(db, role, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`set local role ${role}`);
    return (await tx.query(sql, params)).rows;
  });
}

/** Runs `fn(tx)` as `role` and always rolls back (for temporary grants in RLS checks). */
async function rolledBack(db, role, fn) {
  try {
    await db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await fn(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

async function expectError(promise, code) {
  try {
    await promise;
  } catch (e) {
    if (code && e.code !== code) throw new Error(`expected SQLSTATE ${code}, got ${e.code}: ${e.message}`);
    return e;
  }
  throw new Error(`expected SQLSTATE ${code ?? '(any error)'}, but the statement succeeded`);
}

async function scalar(db, sql, params = []) {
  return (await db.query(sql, params)).rows[0];
}

// ---------------------------------------------------------------------------
// PostgREST-style client over PGlite (only the surface SupabaseStore uses)
// ---------------------------------------------------------------------------

const JSON_COLUMNS = new Set(['config', 'pick']);
const quoteId = (s) => `"${String(s).replace(/"/g, '""')}"`;
const toParam = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

class PostgrestLike {
  constructor(db, role) {
    this.db = db;
    this.role = role;
  }
  from(table) {
    return new PgQuery(this, table);
  }
}

class PgQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.kind = 'select';
    this.cols = '*';
    this.values = null;
    this.opts = {};
    this.filters = [];
    this.orders = [];
    this.lo = null;
    this.hi = null;
    this.lim = null;
  }
  select(cols = '*') {
    if (this.kind === 'select') this.cols = cols;
    return this;
  }
  insert(values) {
    this.kind = 'insert';
    this.values = values;
    return this;
  }
  upsert(values, opts = {}) {
    this.kind = 'upsert';
    this.values = values;
    this.opts = opts;
    return this;
  }
  update(values) {
    this.kind = 'update';
    this.values = values;
    return this;
  }
  eq(col, value) {
    this.filters.push([col, value]);
    return this;
  }
  order(col, opts = {}) {
    this.orders.push([col, opts.ascending !== false]);
    return this;
  }
  range(from, to) {
    this.lo = from;
    this.hi = to;
    return this;
  }
  limit(n) {
    this.lim = n;
    return this;
  }
  then(onOk, onErr) {
    return this.exec().then(onOk, onErr);
  }
  async exec() {
    try {
      return { data: await this.client.db.transaction(async (tx) => {
        await tx.query(`set local role ${this.client.role}`);
        return this.compileAndRun(tx);
      }), error: null };
    } catch (e) {
      return { data: null, error: { message: e.message, code: e.code } };
    }
  }
  whereClause(params) {
    if (this.filters.length === 0) return '';
    return ' where ' + this.filters.map(([c, v]) => {
      params.push(toParam(v));
      return `${quoteId(c)} = $${params.length}`;
    }).join(' and ');
  }
  async compileAndRun(tx) {
    const t = `public.${quoteId(this.table)}`;
    if (this.kind === 'select') {
      const params = [];
      const cols = this.cols === '*' ? '*' : this.cols.split(',').map((c) => quoteId(c.trim())).join(', ');
      let sql = `select ${cols} from ${t}` + this.whereClause(params);
      if (this.orders.length) sql += ' order by ' + this.orders.map(([c, asc]) => `${quoteId(c)} ${asc ? 'asc' : 'desc'}`).join(', ');
      // PostgREST: range() becomes offset/limit; the server never returns more than max_rows per request.
      const offset = this.lo ?? 0;
      const wanted = this.lim ?? (this.hi !== null ? this.hi - this.lo + 1 : MAX_ROWS);
      sql += ` limit ${Math.min(wanted, MAX_ROWS)} offset ${offset}`;
      return (await tx.query(sql, params)).rows;
    }
    if (this.kind === 'update') {
      const params = [];
      const sets = Object.entries(this.values).map(([c, v]) => {
        params.push(JSON_COLUMNS.has(c) ? JSON.stringify(v) : toParam(v));
        return `${quoteId(c)} = $${params.length}${JSON_COLUMNS.has(c) ? '::jsonb' : ''}`;
      });
      await tx.query(`update ${t} set ${sets.join(', ')}` + this.whereClause(params), params);
      return null;
    }
    // insert / upsert
    const rows = Array.isArray(this.values) ? this.values : [this.values];
    if (rows.length === 0) return null;
    const cols = Object.keys(rows[0]);
    const params = [];
    const tuples = rows.map((r) => '(' + cols.map((c) => {
      params.push(JSON_COLUMNS.has(c) ? JSON.stringify(r[c]) : toParam(r[c]));
      return `$${params.length}${JSON_COLUMNS.has(c) ? '::jsonb' : ''}`;
    }).join(', ') + ')');
    let sql = `insert into ${t} (${cols.map(quoteId).join(', ')}) values ${tuples.join(', ')}`;
    if (this.kind === 'upsert') {
      const conflict = this.opts.onConflict.split(',').map((c) => c.trim());
      const updates = cols.filter((c) => !conflict.includes(c));
      if (this.opts.ignoreDuplicates || updates.length === 0) {
        sql += ` on conflict (${conflict.map(quoteId).join(', ')}) do nothing`;
      } else {
        sql += ` on conflict (${conflict.map(quoteId).join(', ')}) do update set ` +
          updates.map((c) => `${quoteId(c)} = excluded.${quoteId(c)}`).join(', ');
      }
    }
    await tx.query(sql, params);
    return null;
  }
}

const storeAs = (db, role) => new SupabaseStore('https://unused.invalid', 'unused-key', new PostgrestLike(db, role), { timeoutMs: 10000 });

// ---------------------------------------------------------------------------
// Database setup as Supabase provides it (roles, auth schema stub, default privileges)
// ---------------------------------------------------------------------------

async function newDatabase({ supabaseDefaultPrivileges = true } = {}) {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
    end $$;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create or replace function auth.role() returns text language sql stable as $$ select null::text $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select null::jsonb $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  if (supabaseDefaultPrivileges) {
    // Supabase's project defaults: every new table in public is granted to the three API roles.
    await db.exec(`
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    `);
  }
  return db;
}

const countRows = async (db, table) => (await scalar(db, `select count(*)::int as n from public.${table}`)).n;

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

// Every migration file, in filename order (the same order `supabase db push` and the SQL editor use).
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const migrationSql = migrationFiles.map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
const seedSql = readFileSync(SEED_PATH, 'utf8');
console.log(`migrations: ${migrationFiles.join(', ')}`);

console.log('PGlite (PostgreSQL) check of supabase/migrations/0001_init.sql and supabase/seed.sql');
const db = await newDatabase();

await test('Supabase roles exist; service_role bypasses RLS, anon and authenticated do not', async () => {
  const rows = (await db.query(`select rolname, rolbypassrls, rolcanlogin from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname`)).rows;
  const byName = Object.fromEntries(rows.map((r) => [r.rolname, r]));
  assert.ok(byName.anon && byName.authenticated && byName.service_role, 'roles missing');
  assert.equal(byName.service_role.rolbypassrls, true);
  assert.equal(byName.anon.rolbypassrls, false);
  assert.equal(byName.authenticated.rolbypassrls, false);
  assert.equal(byName.anon.rolcanlogin, false);
});

await test('migrations apply in filename order without error', async () => {
  await db.exec(migrationSql);
});

await test('seed.sql applies without error', async () => {
  await db.exec(seedSql);
});

await test('tables, indexes, policy, trigger and trigger function exist', async () => {
  const tables = (await db.query(`select table_name from information_schema.tables where table_schema = 'public' order by 1`)).rows.map((r) => r.table_name);
  for (const t of TABLES) assert.ok(tables.includes(t), `missing table ${t}`);
  const indexes = new Set((await db.query(`select indexname from pg_indexes where schemaname = 'public'`)).rows.map((r) => r.indexname));
  for (const i of ['games_pkey', 'game_players_pkey', 'game_commands_pkey', 'game_snapshots_pkey', 'games_status_idx', 'games_room_code_idx', 'games_finished_idx', 'game_players_guest_idx']) {
    assert.ok(indexes.has(i), `missing index ${i}`);
  }
  const pol = await db.query(`select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'games'`);
  assert.equal(pol.rows.length, 1, 'expected exactly one policy on games');
  assert.equal(pol.rows[0].policyname, 'games_read_finished');
  assert.equal(pol.rows[0].cmd, 'SELECT');
  const trg = await db.query(`select tgname, tgenabled from pg_trigger where tgrelid = 'public.game_commands'::regclass and not tgisinternal`);
  assert.deepEqual(trg.rows.map((r) => r.tgname), ['game_commands_append_only']);
  assert.equal(trg.rows[0].tgenabled, 'O', 'append-only trigger must be enabled');
  assert.equal((await db.query(`select 1 from pg_proc where proname = 'forbid_log_mutation'`)).rows.length, 1);
});

await test('row level security is enabled on all four game tables', async () => {
  const rows = (await db.query(`select relname, relrowsecurity from pg_class where relname = any($1) and relnamespace = 'public'::regnamespace`, [TABLES])).rows;
  assert.equal(rows.length, 4);
  for (const r of rows) assert.equal(r.relrowsecurity, true, `RLS off on ${r.relname}`);
});

await test('re-running the migration and the seed changes nothing (idempotent)', async () => {
  const before = { games: await countRows(db, 'games'), game_players: await countRows(db, 'game_players'), game_commands: await countRows(db, 'game_commands') };
  await db.exec(migrationSql);
  await db.exec(seedSql);
  assert.deepEqual({ games: await countRows(db, 'games'), game_players: await countRows(db, 'game_players'), game_commands: await countRows(db, 'game_commands') }, before);
  assert.equal((await db.query(`select 1 from pg_policies where tablename = 'games'`)).rows.length, 1);
  assert.equal((await db.query(`select 1 from pg_trigger where tgname = 'game_commands_append_only'`)).rows.length, 1);
});

await test('seed game is present and matches the seed rows', async () => {
  const g = await scalar(db, `select status, room_code, command_count, round from public.games where id = $1`, [SEED_GAME]);
  assert.deepEqual(g, { status: 'won', room_code: 'SAMPLE', command_count: 3, round: 3 });
  assert.equal(await countRows(db, 'game_players'), 2);
  assert.equal(await countRows(db, 'game_commands'), 3);
});

// --- privileges -----------------------------------------------------------

await test('anon and authenticated have no table privileges on the game tables (only the column grant on games)', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const t of TABLES) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const r = await scalar(db, `select has_table_privilege($1, $2, $3) as ok`, [role, `public.${t}`, priv]);
        assert.equal(r.ok, false, `${role} has ${priv} on ${t}`);
      }
    }
  }
});

await test('anon and authenticated can read only the summary columns of games', async () => {
  const allowed = ['id', 'room_code', 'room_name', 'status', 'scenario', 'society', 'difficulty', 'mode', 'extra_pack', 'seed', 'round', 'end_reason', 'command_count', 'created_at', 'finished_at'];
  const denied = ['config', 'updated_at'];
  for (const role of ['anon', 'authenticated']) {
    for (const c of allowed) assert.equal((await scalar(db, `select has_column_privilege($1, 'public.games', $2, 'SELECT') as ok`, [role, c])).ok, true, `${role} cannot read games.${c}`);
    for (const c of denied) assert.equal((await scalar(db, `select has_column_privilege($1, 'public.games', $2, 'SELECT') as ok`, [role, c])).ok, false, `${role} can read games.${c}`);
    assert.equal((await scalar(db, `select has_column_privilege($1, 'public.games', 'id', 'UPDATE') as ok`, [role])).ok, false);
  }
});

await test('service_role has full table privileges on the four game tables', async () => {
  for (const t of TABLES) {
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.equal((await scalar(db, `select has_table_privilege('service_role', $1, $2) as ok`, [`public.${t}`, priv])).ok, true, `service_role lacks ${priv} on ${t}`);
    }
  }
});

// --- raw constraints ------------------------------------------------------

const gid = randomUUID();
await test('a game row with the minimum valid values inserts and gets defaults (id, created_at)', async () => {
  const r = await scalar(db, `insert into public.games (room_code, scenario, society, difficulty, mode, seed, config)
    values ('KQRSTW', 'crater', 1, 'normal', 'solo', 0, '{}'::jsonb) returning id, status, room_name, command_count, created_at`);
  assert.ok(r.id, 'uuid default missing');
  assert.equal(r.status, 'playing');
  assert.equal(r.room_name, '');
  assert.equal(r.command_count, 0);
  assert.ok(r.created_at instanceof Date);
  await db.query(`delete from public.games where id = $1`, [r.id]).catch(() => {}); // cascades to nothing yet
});

await db.query(`insert into public.games (id, room_code, scenario, society, difficulty, mode, seed, config)
  values ($1, 'KQRSTW', 'crater', 1, 'normal', 'solo', 1, '{}'::jsonb)`, [gid]);

const badGames = [
  ['room code with I', `room_code = 'ABCDEI'`],
  ['room code with O', `room_code = 'ABCDEO'`],
  ['lower-case room code', `room_code = 'abcdef'`],
  ['room code of five letters', `room_code = 'ABCDE'`],
  ['unknown status', `status = 'draft'`],
  ['scenario spelled wrong', `scenario = 'Crater'`],
  ['scenario in snake case', `scenario = 'frozen_grove'`],
  ['society 0', `society = 0`],
  ['society 7', `society = 7`],
  ['difficulty easy', `difficulty = 'easy'`],
  ['mode lobby', `mode = 'lobby'`],
  ['seed -1', `seed = -1`],
  ['seed 2^32', `seed = 4294967296`],
  ['round 0', `round = 0`],
  ['command_count -1', `command_count = -1`],
];
for (const [label, set] of badGames) {
  await test(`games rejects ${label} (check constraint)`, async () => {
    await expectError(db.query(`update public.games set ${set} where id = $1`, [gid]), '23514');
  });
}

await test('games rejects NULL in NOT NULL columns (config, extra_pack)', async () => {
  await expectError(db.query(`update public.games set config = null where id = $1`, [gid]), '23502');
  await expectError(db.query(`update public.games set extra_pack = null where id = $1`, [gid]), '23502');
});

await test('games accepts the boundary seeds 0 and 4294967295 and round 1', async () => {
  await db.query(`update public.games set seed = 0, round = 1 where id = $1`, [gid]);
  await db.query(`update public.games set seed = 4294967295 where id = $1`, [gid]);
  await db.query(`update public.games set seed = 1, round = null where id = $1`, [gid]);
});

await test('game_players rejects seat 4, seat -1, duplicate seat, unknown game, NULL is_host', async () => {
  await expectError(db.query(`insert into public.game_players values ($1, 4, 'g', 'n', false, 'h')`, [gid]), '23514');
  await expectError(db.query(`insert into public.game_players values ($1, -1, 'g', 'n', false, 'h')`, [gid]), '23514');
  await db.query(`insert into public.game_players values ($1, 0, 'g0', 'n0', true, 'h')`, [gid]);
  await expectError(db.query(`insert into public.game_players values ($1, 0, 'g0', 'again', false, 'h')`, [gid]), '23505');
  await expectError(db.query(`insert into public.game_players values ($1, 1, 'g1', 'n1', false, 'h')`, [randomUUID()]), '23503');
  await expectError(db.query(`insert into public.game_players values ($1, 1, 'g1', 'n1', null, 'h')`, [gid]), '23502');
});

await test('game_commands rejects seq 0, seat -1, pending_id -1, non-array pick, duplicate seq, unknown game', async () => {
  await expectError(db.query(`insert into public.game_commands values ($1, 0, 0, 1, '["a"]')`, [gid]), '23514');
  await expectError(db.query(`insert into public.game_commands values ($1, 1, -1, 1, '["a"]')`, [gid]), '23514');
  await expectError(db.query(`insert into public.game_commands values ($1, 1, 0, -1, '["a"]')`, [gid]), '23514');
  await expectError(db.query(`insert into public.game_commands values ($1, 1, 0, 1, '{"a":1}')`, [gid]), '23514');
  await expectError(db.query(`insert into public.game_commands values ($1, 1, 0, 1, 'null')`, [gid]), '23514');
  await expectError(db.query(`insert into public.game_commands values ($1, 1, 0, 1, '["a"]')`, [randomUUID()]), '23503');
  await db.query(`insert into public.game_commands values ($1, 1, 0, 1, '["a"]')`, [gid]);
  // The duplicate-seq case the task asks for: a plain INSERT of an occupied seq is rejected.
  await expectError(db.query(`insert into public.game_commands values ($1, 1, 1, 2, '["b"]')`, [gid]), '23505');
});

await test('game_snapshots rejects negative command_seq and unknown game', async () => {
  await expectError(db.query(`insert into public.game_snapshots values ($1, -1, 'x')`, [gid]), '23514');
  await expectError(db.query(`insert into public.game_snapshots values ($1, 0, 'x')`, [randomUUID()]), '23503');
});

await test('append-only trigger: UPDATE and DELETE on game_commands are refused', async () => {
  const e1 = await expectError(db.query(`update public.game_commands set pick = '["z"]' where game_id = $1`, [gid]));
  assert.match(e1.message, /append-only/);
  await expectError(db.query(`delete from public.game_commands where game_id = $1`, [gid]));
  assert.equal((await scalar(db, `select pick from public.game_commands where game_id = $1 and seq = 1`, [gid])).pick[0], 'a');
});

await test('append-only trigger does not fire for INSERT ... ON CONFLICT DO NOTHING (the store path), but does for DO UPDATE', async () => {
  await db.query(`insert into public.game_commands values ($1, 1, 0, 1, '["a"]') on conflict (game_id, seq) do nothing`, [gid]);
  await expectError(db.query(`insert into public.game_commands values ($1, 1, 0, 1, '["a"]') on conflict (game_id, seq) do update set pick = excluded.pick`, [gid]));
});

await test('deleting a game with commands is refused by the trigger; the documented procedure (disable trigger) works', async () => {
  const doomed = randomUUID();
  await db.query(`insert into public.games (id, room_code, scenario, society, difficulty, mode, seed, config) values ($1,'LMNPQR','crater',1,'normal','solo',2,'{}'::jsonb)`, [doomed]);
  await db.query(`insert into public.game_commands values ($1, 1, 0, 1, '["a"]')`, [doomed]);
  await expectError(db.query(`delete from public.games where id = $1`, [doomed]), 'P0001');
  await db.exec(`alter table public.game_commands disable trigger game_commands_append_only;`);
  await db.query(`delete from public.games where id = $1`, [doomed]);
  await db.exec(`alter table public.game_commands enable trigger game_commands_append_only;`);
  assert.equal((await scalar(db, `select count(*)::int as n from public.game_commands where game_id = $1`, [doomed])).n, 0);
  assert.equal((await scalar(db, `select tgenabled from pg_trigger where tgname = 'game_commands_append_only'`)).tgenabled, 'O');
});

// --- the server's store, replayed through PostgREST-style SQL (service_role) ---------------

const svc = storeAs(db, 'service_role');
const anon = storeAs(db, 'anon');
const A = randomUUID();
const B = randomUUID();
const C = randomUUID();
const configA = {
  scenario: 'frozenGrove',
  society: 3,
  difficulty: 'hard',
  mode: 'coop',
  players: [{ name: 'Ann', id: 'guest-ann-0001' }, { name: 'Bo', id: 'guest-bo-00002' }],
  seed: 4294967295,
  extraPack: true,
  advisors: ['Ann', null],
};
const player = (seat, extra = {}) => ({ seat, guestId: `guest-p${seat}-0000`, name: `P${seat}`, isHost: seat === 0, tokenHash: 'a'.repeat(64), ...extra });

await test('store: createGame and addPlayers (retried) leave one row per key', async () => {
  await svc.createGame({ id: A, roomCode: 'KQRSTW', roomName: 'Frozen table', config: configA });
  await svc.createGame({ id: A, roomCode: 'KQRSTW', roomName: 'Frozen table', config: configA });
  await svc.addPlayers(A, [player(0), player(1)]);
  await svc.addPlayers(A, [player(0), player(1)]);
  assert.equal((await scalar(db, `select count(*)::int as n from public.games where id = $1`, [A])).n, 1);
  assert.equal((await scalar(db, `select count(*)::int as n from public.game_players where game_id = $1`, [A])).n, 2);
  const row = await scalar(db, `select status, scenario, society, difficulty, mode, extra_pack, seed, room_name, config from public.games where id = $1`, [A]);
  assert.equal(row.status, 'playing');
  assert.equal(row.scenario, 'frozenGrove');
  assert.equal(row.seed, 4294967295);
  assert.equal(row.extra_pack, true);
  assert.equal(row.room_name, 'Frozen table');
  assert.deepEqual(row.config, configA);
});

await test('store: appendCommand in order; a retried identical command is a no-op', async () => {
  await svc.appendCommand(A, { seq: 1, who: 0, pendingId: 1, pick: ['a'] });
  await svc.appendCommand(A, { seq: 2, who: 1, pendingId: 2, pick: ['b', 'c'] });
  await svc.appendCommand(A, { seq: 2, who: 1, pendingId: 2, pick: ['b', 'c'] });
  await svc.appendCommand(A, { seq: 3, who: 0, pendingId: 3, pick: [] });
  assert.equal((await scalar(db, `select count(*)::int as n from public.game_commands where game_id = $1`, [A])).n, 3);
});

await test('store: a DIFFERENT command re-sent at an occupied seq is ignored, first write wins (pinned by supabase-store.test.ts; MemoryStore throws here)', async () => {
  await svc.appendCommand(A, { seq: 2, who: 1, pendingId: 2, pick: ['x'] });
  assert.deepEqual((await scalar(db, `select pick from public.game_commands where game_id = $1 and seq = 2`, [A])).pick, ['b', 'c']);
});

await test('store: snapshot upsert is idempotent and overwrites the payload for the same seq', async () => {
  await svc.saveSnapshot(A, 0, '{"v":"s0"}');
  await svc.saveSnapshot(A, 2, '{"v":"s2"}');
  await svc.saveSnapshot(A, 2, '{"v":"s2-again"}');
  await svc.saveSnapshot(A, 2, '{"v":"s2-again"}');
  assert.equal((await scalar(db, `select count(*)::int as n from public.game_snapshots where game_id = $1`, [A])).n, 2);
  assert.equal((await scalar(db, `select state from public.game_snapshots where game_id = $1 and command_seq = 2`, [A])).state, '{"v":"s2-again"}');
});

await test('store: loadActiveGames returns players, ordered commands, latest snapshot and the exact config', async () => {
  const games = await svc.loadActiveGames();
  const g = games.find((x) => x.id === A);
  assert.ok(g, 'active game not loaded');
  assert.deepEqual(g.config, configA);
  assert.equal(g.roomCode, 'KQRSTW');
  assert.equal(g.roomName, 'Frozen table');
  assert.deepEqual(g.players.map((p) => [p.seat, p.name, p.isHost, p.tokenHash.length]), [[0, 'P0', true, 64], [1, 'P1', false, 64]]);
  assert.deepEqual(g.commands.map((c) => [c.seq, c.who, c.pendingId, c.pick]), [[1, 0, 1, ['a']], [2, 1, 2, ['b', 'c']], [3, 0, 3, []]]);
  assert.deepEqual(g.snapshot, { seq: 2, payload: '{"v":"s2-again"}' });
  assert.ok(!games.some((x) => x.id === SEED_GAME), 'finished seed game must not be loaded as active');
});

await test('store: finishGame marks the row, sets finished_at and drops it from the active list', async () => {
  await svc.finishGame(A, { status: 'won', endReason: 'three decisions done', round: 3, commandCount: 3 });
  const r = await scalar(db, `select status, end_reason, round, command_count, finished_at is not null as done from public.games where id = $1`, [A]);
  assert.deepEqual(r, { status: 'won', end_reason: 'three decisions done', round: 3, command_count: 3, done: true });
  assert.ok(!(await svc.loadActiveGames()).some((x) => x.id === A));
});

await test('store: a 4-seat game with an abandoned finish (round null, no end reason) is stored', async () => {
  await svc.createGame({ id: B, roomCode: 'BCDFGH', roomName: '', config: { ...configA, mode: 'coop', players: [1, 2, 3, 4].map((i) => ({ name: `N${i}`, id: `guest-n${i}-0000` })) } });
  await svc.addPlayers(B, [0, 1, 2, 3].map((s) => player(s)));
  await svc.finishGame(B, { status: 'abandoned', endReason: null, round: null, commandCount: 0 });
  const r = await scalar(db, `select status, round, room_name, (select count(*) from public.game_players where game_id = $1)::int as seats from public.games where id = $1`, [B]);
  assert.deepEqual(r, { status: 'abandoned', round: null, room_name: '', seats: 4 });
});

await test('store: loadActiveGames pages past the 1000-row cap and keeps every command in order', async () => {
  await svc.createGame({ id: C, roomCode: 'CDGHJK', roomName: 'Long table', config: configA });
  for (let seq = 1; seq <= 1105; seq++) {
    await svc.appendCommand(C, { seq, who: seq % 2, pendingId: seq, pick: ['a'] });
  }
  const g = (await svc.loadActiveGames()).find((x) => x.id === C);
  assert.equal(g.commands.length, 1105);
  assert.deepEqual(g.commands.map((c) => c.seq), Array.from({ length: 1105 }, (_, i) => i + 1));
  assert.equal(g.snapshot, null);
});

await test('store: the anon key cannot write or read through the store (the server must use service_role)', async () => {
  await assert.rejects(anon.createGame({ id: randomUUID(), roomCode: 'KQRSTW', roomName: 'x', config: configA }), /permission denied/);
  await assert.rejects(anon.loadActiveGames(), /permission denied/);
});

// --- RLS as seen by anon / authenticated -----------------------------------

const finishedCount = (await scalar(db, `select count(*)::int as n from public.games where status in ('won','lost','abandoned')`)).n;
const activeCount = (await scalar(db, `select count(*)::int as n from public.games where status = 'playing'`)).n;

await test('RLS: anon and authenticated see finished games only (the policy filters the playing rows)', async () => {
  assert.ok(activeCount >= 1 && finishedCount >= 2, 'fixture needs both kinds of game');
  for (const role of ['anon', 'authenticated']) {
    const rows = await asRole(db, role, `select id, status, room_code, round, command_count from public.games order by created_at`);
    assert.equal(rows.length, finishedCount, `${role} sees ${rows.length} games, expected ${finishedCount}`);
    assert.ok(rows.every((r) => ['won', 'lost', 'abandoned'].includes(r.status)));
    assert.ok(rows.some((r) => r.id === SEED_GAME));
  }
});

await test('RLS: anon and authenticated cannot read config, player, command or snapshot data', async () => {
  for (const role of ['anon', 'authenticated']) {
    await expectError(asRole(db, role, `select config from public.games`), '42501');
    await expectError(asRole(db, role, `select * from public.games`), '42501');
    await expectError(asRole(db, role, `select * from public.game_players`), '42501');
    await expectError(asRole(db, role, `select * from public.game_commands`), '42501');
    await expectError(asRole(db, role, `select * from public.game_snapshots`), '42501');
  }
});

await test('RLS: anon and authenticated cannot insert, update or delete anything', async () => {
  for (const role of ['anon', 'authenticated']) {
    await expectError(asRole(db, role, `insert into public.games (room_code, scenario, society, difficulty, mode, seed, config) values ('KQRSTW','crater',1,'normal','solo',1,'{}')`), '42501');
    await expectError(asRole(db, role, `update public.games set status = 'won'`), '42501');
    await expectError(asRole(db, role, `delete from public.games`), '42501');
    await expectError(asRole(db, role, `insert into public.game_commands values ($1, 9, 0, 1, '["a"]')`, [A]), '42501');
    await expectError(asRole(db, role, `insert into public.game_players values ($1, 3, 'g', 'n', false, 'h')`, [A]), '42501');
    await expectError(asRole(db, role, `insert into public.game_snapshots values ($1, 99, 'x')`, [A]), '42501');
  }
});

await test('RLS is a second layer: with a temporary table grant, anon still sees no command rows (no policy) and only finished games', async () => {
  await rolledBack(db, 'postgres', async (tx) => {
    await tx.query(`grant select on public.game_commands, public.games to anon`);
    await tx.query(`set local role anon`);
    const cmds = (await tx.query(`select count(*)::int as n from public.game_commands`)).rows[0].n;
    assert.equal(cmds, 0, 'RLS let anon read command rows');
    const games = (await tx.query(`select count(*)::int as n from public.games`)).rows[0].n;
    assert.equal(games, finishedCount, 'RLS let anon read playing games');
  });
  // rolled back: the grant is gone again
  assert.equal((await scalar(db, `select has_table_privilege('anon', 'public.game_commands', 'SELECT') as ok`)).ok, false);
});

await test('service_role bypasses RLS: it reads every row of every game table', async () => {
  const rows = await asRole(db, 'service_role', `select (select count(*) from public.game_commands)::int as c, (select count(*) from public.game_players)::int as p, (select count(*) from public.games)::int as g`);
  assert.ok(rows[0].c > 1000 && rows[0].p >= 2 && rows[0].g >= 4, JSON.stringify(rows));
});

await test('auth stub: auth.uid() and auth.jwt() are NULL for anon (no policy depends on them)', async () => {
  const rows = await asRole(db, 'anon', `select auth.uid() as uid, auth.jwt() as jwt`);
  assert.deepEqual(rows[0], { uid: null, jwt: null });
});

// --- a project without Supabase's default privileges -----------------------

await test('without Supabase default grants, the migration still lets service_role write (explicit grants)', async () => {
  const bare = await newDatabase({ supabaseDefaultPrivileges: false });
  try {
    await bare.exec(migrationSql);
    const s = storeAs(bare, 'service_role');
    const id = randomUUID();
    await s.createGame({ id, roomCode: 'KQRSTW', roomName: 'bare', config: configA });
    await s.appendCommand(id, { seq: 1, who: 0, pendingId: 1, pick: ['a'] });
    assert.equal(await countRows(bare, 'game_commands'), 1);
  } finally {
    await bare.close();
  }
});

await db.close();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('failed: ' + failures.join(' | '));
  process.exitCode = 1;
}
