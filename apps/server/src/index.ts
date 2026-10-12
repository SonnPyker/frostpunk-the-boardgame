// Entry point: `npm run dev -w apps/server` (tsx) or `npm start -w apps/server` (bundled dist/server.mjs).
import { loadRealEngine } from './engine';
import { loadConfig } from './config';
import { RoomManager, type LogFn } from './rooms';
import { startServer } from './server';
import { MemoryStore, type GameStore } from './store';
import { SupabaseStore } from './supabase-store';
import { errorMessage } from './util';

const log: LogFn = (level, msg, extra) => {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (extra === undefined) out(line);
  else out(line, extra);
};

async function main(): Promise<void> {
  const config = loadConfig();

  if (Boolean(config.supabaseUrl) !== Boolean(config.supabaseServiceRoleKey)) {
    log('warn', 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set together; using in-memory persistence');
  }
  const store: GameStore =
    config.supabaseUrl && config.supabaseServiceRoleKey
      ? new SupabaseStore(config.supabaseUrl, config.supabaseServiceRoleKey)
      : new MemoryStore();
  if (store.kind === 'memory') log('info', 'no SUPABASE_URL: games are kept in memory only');
  if (config.corsOrigins.includes('*')) log('warn', 'CORS_ORIGIN is not set: browsers from any origin may connect');

  const manager = new RoomManager({
    engine: loadRealEngine(),
    store,
    snapshotEvery: config.persistSnapshotEvery,
    lobbyGraceMs: config.lobbyGraceMs,
    endedRoomTtlMs: config.endedRoomTtlMs,
    maxRooms: config.maxRooms,
    abandonAfterMs: config.abandonAfterMs,
    retry: { attempts: config.persistAttempts, baseDelayMs: config.persistBaseDelayMs, maxDelayMs: config.persistMaxDelayMs },
    log,
  });

  // A failed restore is fatal: running without the persisted games would silently drop them.
  const restored = await manager.restore();
  log('info', `restored ${restored} unfinished game(s)`);

  const server = await startServer({ config, manager, persistence: store.kind, log });
  const sweep = setInterval(() => {
    try {
      manager.sweep();
    } catch (e) {
      log('error', 'housekeeping failed', errorMessage(e));
    }
  }, 60_000);
  sweep.unref();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', `${signal} received, shutting down`);
    clearInterval(sweep);
    server
      .stop(config.shutdownGraceMs)
      .catch((e) => log('error', 'error during shutdown', errorMessage(e)))
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  log('error', 'fatal startup error', errorMessage(e));
  process.exit(1);
});
