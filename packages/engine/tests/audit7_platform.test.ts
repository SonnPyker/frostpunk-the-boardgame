// Audit batch 7 (platform and delivery, checklist section M): static cross-checks of the deployment files.
// These read the repository files only; they need no database, network or browser.
//  plt-01: the npm workspaces match the monorepo layout (packages/*, apps/*, supabase/ present).
//  plt-04a: every table and column that apps/server/src/supabase-store.ts writes exists in supabase/migrations/0001_init.sql.
//  plt-04b: RLS is enabled on every table and clients have no write grant or write policy.
//  plt-05a: render.yaml and the server .env.example only name environment variables that the server reads.
//  plt-05b: the build and start commands in render.yaml and vercel.json point at scripts and outputs that exist.
//  plt-06: the optimised asset set holds one GLB per source OBJ and the audio track is copied.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../../', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, ROOT), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel: string): boolean => existsSync(new URL(rel, ROOT));

/** Body of `create table if not exists public.<name> ( ... );` from the migration. */
function tableBlock(sql: string, name: string): string {
  const start = sql.indexOf(`create table if not exists public.${name} (`);
  if (start < 0) return '';
  const end = sql.indexOf('\n);', start);
  return sql.slice(start, end);
}

describe('plt-01 monorepo layout', () => {
  it('workspaces cover packages/* and apps/*, and the four top-level parts exist', () => {
    const pkg = JSON.parse(read('package.json')) as { workspaces: string[] };
    expect(pkg.workspaces).toEqual(['packages/*', 'apps/*']);
    expect(exists('packages/engine/package.json')).toBe(true);
    expect(exists('apps/web/package.json')).toBe(true);
    expect(exists('apps/server/package.json')).toBe(true);
    expect(exists('supabase/migrations')).toBe(true);
  });
});

describe('plt-04 Supabase schema', () => {
  const sql = read('supabase/migrations/0001_init.sql');
  const store = read('apps/server/src/supabase-store.ts');

  // table -> columns the store writes (payload keys of the upsert calls, in supabase-store.ts)
  const written: Record<string, string[]> = {
    games: ['id', 'room_code', 'room_name', 'status', 'scenario', 'society', 'difficulty', 'mode', 'extra_pack', 'seed', 'config'],
    game_players: ['game_id', 'seat', 'guest_id', 'display_name', 'is_host', 'token_hash'],
    game_commands: ['game_id', 'seq', 'seat', 'pending_id', 'pick'],
    game_snapshots: ['game_id', 'command_seq', 'state'],
  };

  it('the store writes only to the four tables the migration creates', () => {
    for (const table of Object.keys(written)) {
      expect(store).toContain(`from('${table}')`);
      expect(tableBlock(sql, table).length).toBeGreaterThan(0);
    }
  });

  it('every column the store writes exists in its table', () => {
    for (const [table, cols] of Object.entries(written)) {
      const block = tableBlock(sql, table);
      for (const col of cols) {
        expect(block, `${table}.${col}`).toMatch(new RegExp(`^\\s+${col}\\s`, 'm'));
      }
    }
  });

  it('upsert conflict targets match the primary keys', () => {
    expect(store).toContain("onConflict: 'game_id,seat'");
    expect(store).toContain("onConflict: 'game_id,seq'");
    expect(store).toContain("onConflict: 'game_id,command_seq'");
    expect(sql).toContain('primary key (game_id, seat)');
    expect(sql).toContain('primary key (game_id, seq)');
    expect(sql).toContain('primary key (game_id, command_seq)');
  });

  it('RLS is enabled on all four tables', () => {
    for (const table of Object.keys(written)) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
    }
  });

  it('clients (anon, authenticated) get no write grant and no write policy', () => {
    expect(sql).toMatch(/revoke all on public\.games, public\.game_players, public\.game_commands, public\.game_snapshots\s+from anon, authenticated;/);
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)/i);
    const policies = [...sql.matchAll(/create policy\s+\w+\s+on public\.\w+\s+for (\w+)/gi)].map((m) => m[1].toLowerCase());
    expect(policies).toEqual(['select']);
    expect(sql).toMatch(/create policy games_read_finished on public\.games\s+for select to anon, authenticated\s+using \(status in \('won', 'lost', 'abandoned'\)\)/);
  });

  it('anon and authenticated can read only summary columns of finished games (no config, no tokens)', () => {
    const grant = sql.match(/grant select \(([\s\S]*?)\) on public\.games/);
    expect(grant).not.toBeNull();
    const cols = grant![1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(cols).not.toContain('config');
    expect(cols).toContain('status');
  });

  it('the command log is append-only (update and delete are rejected by a trigger)', () => {
    expect(sql).toContain('before update or delete on public.game_commands');
    expect(sql).toContain("raise exception 'table % is append-only', tg_table_name;");
  });
});

describe('plt-05 deployment files', () => {
  it('render.yaml env keys are all read by the server config', () => {
    const render = read('render.yaml');
    const config = read('apps/server/src/config.ts');
    // NODE_VERSION is read by the Render build image, not by the server
    const keys = [...render.matchAll(/^\s+- key:\s*(\w+)/gm)].map((m) => m[1]).filter((k) => k !== 'NODE_VERSION');
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      expect(config, key).toContain(`env.${key}`);
    }
  });

  it('apps/server/.env.example only names variables the server reads', () => {
    const example = read('apps/server/.env.example');
    const config = read('apps/server/src/config.ts');
    const keys = [...example.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) expect(config, key).toContain(`env.${key}`);
  });

  it('apps/web/.env.example names only VITE_SERVER_URL, the one variable the web client reads', () => {
    const example = read('apps/web/.env.example');
    const keys = [...example.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]);
    expect(keys).toEqual(['VITE_SERVER_URL']);
    expect(read('apps/web/src/store/session.ts')).toContain('import.meta.env.VITE_SERVER_URL');
  });

  it('render.yaml build and start commands match root scripts and the server bundle path', () => {
    const render = read('render.yaml');
    const rootPkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(render).toContain('buildCommand: npm ci && npm run build:server');
    expect(rootPkg.scripts['build:server']).toBeDefined();
    expect(render).toContain('startCommand: node apps/server/dist/server.mjs');
    expect(read('apps/server/package.json')).toContain('--outfile=dist/server.mjs');
    expect(render).toContain('healthCheckPath: /health');
    expect(read('apps/server/src/server.ts')).toContain("path === '/health'");
  });

  it('vercel.json build and output match the root scripts and the Vite output', () => {
    const vercel = JSON.parse(read('vercel.json')) as { buildCommand: string; outputDirectory: string; installCommand: string };
    const rootPkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(vercel.buildCommand).toBe('npm run build:web');
    expect(rootPkg.scripts['build:web']).toBeDefined();
    expect(vercel.installCommand).toBe('npm ci');
    expect(vercel.outputDirectory).toBe('apps/web/dist');
    expect(read('apps/web/vite.config.ts')).toMatch(/outDir|build/);
  });

  it('the README names the deploy docs and the env example files that exist', () => {
    const readme = read('README.md');
    expect(readme).toContain('docs/DEPLOYMENT.md');
    expect(exists('docs/DEPLOYMENT.md')).toBe(true);
    expect(exists('apps/server/.env.example')).toBe(true);
    expect(exists('apps/web/.env.example')).toBe(true);
    expect(readme).toContain('npm run assets');
    expect(read('package.json')).toContain('"assets": "python tools/optimize_assets.py"');
  });
});

describe('plt-06 asset conversion', () => {
  const src = new URL('assets_src/', ROOT);
  const hasSrc = existsSync(src);
  const pub = 'apps/web/public/assets/';

  it.skipIf(!hasSrc)('one GLB per source OBJ model, all present in the public set', () => {
    const objs = readdirSync(new URL('assets_src/models/', ROOT)).filter((f) => f.toLowerCase().endsWith('.obj'));
    const glbs = readdirSync(new URL(pub + 'models/', ROOT)).filter((f) => f.endsWith('.glb'));
    expect(objs.length).toBe(14);
    expect(glbs.length).toBe(objs.length);
  });

  it.skipIf(!hasSrc)('the source audio track is copied to the public set', () => {
    const srcAudio = readdirSync(new URL('assets_src/audio/', ROOT)).filter((f) => f.toLowerCase().endsWith('.mp3'));
    expect(srcAudio.length).toBe(1);
    expect(exists(pub + 'audio/frostpunk_theme.mp3')).toBe(true);
  });

  it('the manifest lists the converted files and each path exists on disk', () => {
    const manifest = JSON.parse(read(pub + 'manifest.json')) as {
      cards: Record<string, { path?: string }>;
      models: Record<string, { path?: string }>;
      audio: Record<string, { path?: string }>;
      meta: { unresolved: unknown[] };
    };
    expect(manifest.meta.unresolved).toEqual([]);
    const paths = [
      ...Object.values(manifest.cards),
      ...Object.values(manifest.models),
      ...Object.values(manifest.audio),
    ].map((r) => r.path).filter((p): p is string => typeof p === 'string');
    expect(paths.length).toBeGreaterThan(200);
    for (const p of paths) expect(exists(pub + p), p).toBe(true);
    for (const p of paths.filter((x) => x.startsWith('cards/'))) expect(p.endsWith('.webp'), p).toBe(true);
  });
});
