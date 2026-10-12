// Graceful shutdown keeps accepted answers, and a stuck database does not hold the process hostage.
// Also: the per-connection rate limit counts an unbroken run of refused frames, not the lifetime total.
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerConfig } from '../src/config';
import { RoomManager, type LogFn } from '../src/rooms';
import { startServer, type RunningServer } from '../src/server';
import { MemoryStore, type FinishPatch, type GameStore, type NewGameRecord, type NewPlayerRecord, type PersistedGame, type StoredCommand } from '../src/store';
import { makeFakeEngine } from './fake-engine';
import { WsClient } from './ws-client';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const baseConfig: ServerConfig = {
  port: 0,
  corsOrigins: ['*'],
  supabaseUrl: null,
  supabaseServiceRoleKey: null,
  persistSnapshotEvery: 10,
  lobbyGraceMs: 60_000,
  heartbeatMs: 60_000,
  rateBurst: 1_000_000,
  rateRefillPerSec: 1_000_000,
  endedRoomTtlMs: 60_000,
  maxRooms: 10,
  maxConnections: 10,
  abandonAfterMs: 60_000,
  persistAttempts: 3,
  persistBaseDelayMs: 1,
  persistMaxDelayMs: 2,
  shutdownGraceMs: 1000,
};

/** A MemoryStore whose command writes take `delayMs` each (a slow but healthy database). */
class SlowCommands implements GameStore {
  readonly kind = 'memory' as const;
  constructor(private readonly inner: MemoryStore, private readonly delayMs: number) {}
  createGame(rec: NewGameRecord) {
    return this.inner.createGame(rec);
  }
  addPlayers(id: string, players: NewPlayerRecord[]) {
    return this.inner.addPlayers(id, players);
  }
  async appendCommand(id: string, cmd: StoredCommand) {
    await sleep(this.delayMs);
    return this.inner.appendCommand(id, cmd);
  }
  saveSnapshot(id: string, seq: number, payload: string) {
    return this.inner.saveSnapshot(id, seq, payload);
  }
  finishGame(id: string, patch: FinishPatch) {
    return this.inner.finishGame(id, patch);
  }
  loadActiveGames(): Promise<PersistedGame[]> {
    return this.inner.loadActiveGames();
  }
}

/** A database that accepts the game row but never answers a command write. */
class StuckCommands extends SlowCommands {
  constructor(inner: MemoryStore) {
    super(inner, 0);
  }
  override appendCommand(): Promise<void> {
    return new Promise<void>(() => {});
  }
}

const running: RunningServer[] = [];
const clients: WsClient[] = [];

async function boot(store: GameStore, log: LogFn, overrides: Partial<ServerConfig> = {}) {
  const manager = new RoomManager({
    engine: makeFakeEngine(),
    store,
    snapshotEvery: 10,
    lobbyGraceMs: 60_000,
    endedRoomTtlMs: 60_000,
    maxRooms: 10,
    abandonAfterMs: 60_000,
    retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    log,
  });
  const server = await startServer({ config: { ...baseConfig, ...overrides }, manager, persistence: store.kind, log, port: 0, host: '127.0.0.1' });
  running.push(server);
  return { manager, server, url: `ws://127.0.0.1:${server.port}/ws` };
}

/** Solo game, then two answers (the fake engine ends after three). Returns once both answers are broadcast. */
async function playTwoAnswers(url: string): Promise<WsClient> {
  const c = await WsClient.connect(url, 'host');
  clients.push(c);
  c.send({ t: 'create', name: 'Ann', settings: { seats: 1, seed: 3 } });
  await c.take('joined');
  c.send({ t: 'start' });
  await c.take('state', (m) => m.seq === 0);
  c.send({ t: 'answer', pendingId: 1, pick: ['a'] });
  await c.take('state', (m) => m.seq === 1);
  c.send({ t: 'answer', pendingId: 2, pick: ['a'] });
  await c.take('state', (m) => m.seq === 2);
  return c;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.stop(200);
});

describe('graceful shutdown', () => {
  it('waits for queued database writes, so every accepted answer is stored before the process exits', async () => {
    const inner = new MemoryStore();
    const store = new SlowCommands(inner, 25);
    const { manager, server, url } = await boot(store, () => {});
    await playTwoAnswers(url);
    expect(manager.persistenceStats().pending).toBeGreaterThan(0); // writes really are still in flight

    await server.stop(5000);

    expect(manager.persistenceStats().pending).toBe(0);
    const [game] = await inner.loadActiveGames();
    expect(game.commands.map((c) => c.seq)).toEqual([1, 2]);
  });

  it('a database write that never completes does not hold shutdown past the grace period, and the loss is logged', async () => {
    const logs: string[] = [];
    const log: LogFn = (level, msg) => {
      logs.push(`${level}: ${msg}`);
    };
    const { manager, server, url } = await boot(new StuckCommands(new MemoryStore()), log);
    await playTwoAnswers(url);
    expect(manager.persistenceStats().pending).toBeGreaterThan(0);

    const t0 = Date.now();
    await server.stop(300);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(logs.some((l) => /^warn: shutdown: \d+ database write\(s\) still pending after 300 ms/.test(l))).toBe(true);
  });
});

describe('rate limit', () => {
  it('a busy client that is refused now and then is not disconnected: refusals are counted in a short window', async () => {
    // One token per 50 ms, burst 1. Each cycle: a frame that fits, then a second frame in the same tick that does not.
    // The window is 300 ms, so at most ~5 refusals are ever inside it: 22 refusals in total never close the socket.
    const { url } = await boot(new MemoryStore(), () => {}, { rateBurst: 1, rateRefillPerSec: 20, rateWindowMs: 300 });
    const c = await WsClient.connect(url, 'busy');
    clients.push(c);
    const cycles = 22; // more refusals in total than RATE_VIOLATIONS_BEFORE_CLOSE (20), spread over time
    for (let i = 0; i < cycles; i++) {
      c.send({ t: 'ping', ts: i });
      c.send({ t: 'ping', ts: -1 });
      await sleep(70);
    }
    await sleep(100);
    expect(c.closed).toBeNull();
    expect(c.every('error').filter((e) => e.code === 'rate_limited').length).toBeGreaterThanOrEqual(20);
    expect(c.every('pong').length).toBe(cycles);
  });
});
