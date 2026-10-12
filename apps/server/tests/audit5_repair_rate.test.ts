// Rate limit regressions (repair pass on the wave-5 transport fixes):
// 1. Interleaved flood: an accepted frame between bursts of refusals must not reset the count (the socket still closes).
// 2. Binary frames take the token bucket like text frames (no unlimited bad_request replies).
// 3. The refusal window slides: refusals spread over time do not add up to a close.
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerConfig } from '../src/config';
import { RoomManager, type LogFn } from '../src/rooms';
import { startServer, type RunningServer } from '../src/server';
import { MemoryStore } from '../src/store';
import { RefusalWindow } from '../src/util';
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

const running: RunningServer[] = [];
const clients: WsClient[] = [];

async function boot(overrides: Partial<ServerConfig> = {}, log: LogFn = () => {}) {
  const store = new MemoryStore();
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
  return { server, url: `ws://127.0.0.1:${server.port}/ws` };
}

/** Waits until the socket is closed (or the timeout passes); returns the close, or null. */
async function untilClosed(c: WsClient, timeoutMs = 3000): Promise<{ code: number; reason: string } | null> {
  const t0 = Date.now();
  while (c.closed === null && Date.now() - t0 < timeoutMs) await sleep(20);
  return c.closed;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.stop(200);
});

describe('rate limit: interleaved accepted frames do not evade the close', () => {
  it('a valid frame between bursts of refusals still closes the socket with 1008', async () => {
    // Burst 1, one token per 50 ms. Each cycle: sleep 60 ms (one token back), one valid ping (accepted), then 19 refused frames.
    // The old rule reset the count on every accepted frame, so this never closed; the window keeps the refusals.
    const { url } = await boot({ rateBurst: 1, rateRefillPerSec: 20 });
    const c = await WsClient.connect(url, 'interleaved');
    clients.push(c);
    for (let cycle = 0; cycle < 6 && c.closed === null; cycle++) {
      await sleep(60);
      c.send({ t: 'ping', ts: cycle });
      for (let i = 0; i < 19; i++) c.sendRaw('x');
    }
    const closed = await untilClosed(c);
    expect(closed?.code).toBe(1008);
    expect(closed?.reason).toBe('rate limit exceeded');
    expect(c.all.filter((m) => m.t === 'error' && m.code === 'rate_limited').length).toBeGreaterThanOrEqual(20);
  });
});

describe('rate limit: binary frames', () => {
  it('binary frames take tokens: after the burst they are refused as rate_limited and the flood closes the socket', async () => {
    const { url } = await boot({ rateBurst: 5, rateRefillPerSec: 0.001 });
    const c = await WsClient.connect(url, 'binary');
    clients.push(c);
    for (let i = 0; i < 40; i++) c.sendBinary(Buffer.from([0x01, 0x02, 0x03]));
    const closed = await untilClosed(c);
    expect(closed?.code).toBe(1008);
    const bad = c.all.filter((m) => m.t === 'error' && m.code === 'bad_request').length;
    const limited = c.all.filter((m) => m.t === 'error' && m.code === 'rate_limited').length;
    expect(bad).toBeLessThanOrEqual(5); // only the frames that had a token get a bad_request reply
    expect(limited).toBeGreaterThanOrEqual(20);
  });
});

describe('RefusalWindow (sliding time window)', () => {
  it('closes at the limit inside the window, and old refusals fall out of the window', () => {
    let t = 0;
    const w = new RefusalWindow(3, 1000, () => t);
    t = 0;
    expect(w.refuse()).toBe(false);
    t = 500;
    expect(w.refuse()).toBe(false);
    t = 1000; // the refusal at t=0 is exactly one window old and falls out: two refusals inside
    expect(w.refuse()).toBe(false);
    t = 1100; // refusals at 500, 1000 and 1100 are inside the window
    expect(w.refuse()).toBe(true);
  });

  it('refusals spread over longer than the window never reach the limit', () => {
    let t = 0;
    const w = new RefusalWindow(20, 10_000, () => t);
    for (let i = 0; i < 100; i++) {
      t += 10_000; // one refusal per window
      expect(w.refuse()).toBe(false);
    }
  });
});
