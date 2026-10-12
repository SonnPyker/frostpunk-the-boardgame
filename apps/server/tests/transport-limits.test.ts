// Transport limits over real sockets: the connection cap (503) and the frame size cap (close 1009).
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerConfig } from '../src/config';
import { RoomManager } from '../src/rooms';
import { startServer, type RunningServer } from '../src/server';
import { MemoryStore } from '../src/store';
import { makeFakeEngine } from './fake-engine';

const baseConfig: ServerConfig = {
  port: 0,
  corsOrigins: ['https://game.example'],
  supabaseUrl: null,
  supabaseServiceRoleKey: null,
  persistSnapshotEvery: 10,
  lobbyGraceMs: 60_000,
  heartbeatMs: 60_000,
  rateBurst: 50,
  rateRefillPerSec: 50,
  endedRoomTtlMs: 60_000,
  maxRooms: 100,
  maxConnections: 100,
  abandonAfterMs: 60_000,
  persistAttempts: 3,
  persistBaseDelayMs: 1,
  persistMaxDelayMs: 2,
  shutdownGraceMs: 1000,
};

const running: RunningServer[] = [];
const sockets: WebSocket[] = [];

async function boot(overrides: Partial<ServerConfig> = {}): Promise<string> {
  const manager = new RoomManager({
    engine: makeFakeEngine(),
    store: new MemoryStore(),
    snapshotEvery: 10,
    lobbyGraceMs: 60_000,
    endedRoomTtlMs: 60_000,
    maxRooms: 100,
    abandonAfterMs: 60_000,
    retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
  });
  const server = await startServer({
    config: { ...baseConfig, ...overrides },
    manager,
    persistence: 'memory',
    log: () => {},
    port: 0,
    host: '127.0.0.1',
  });
  running.push(server);
  return `ws://127.0.0.1:${server.port}/ws`;
}

function connect(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  sockets.push(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const s of running.splice(0)) await s.stop(200);
});

describe('connection cap', () => {
  it('refuses an upgrade beyond maxConnections with HTTP 503, and admits again once a socket closes', async () => {
    const url = await boot({ maxConnections: 1 });
    const first = await connect(url);

    const refused = await new Promise<number | string>((resolve) => {
      const ws = new WebSocket(url);
      sockets.push(ws);
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 'no status'));
      ws.once('open', () => resolve('opened'));
      ws.once('error', (e) => resolve(e.message));
    });
    expect(refused).toBe(503);

    const closed = new Promise<void>((resolve) => first.once('close', () => resolve()));
    first.close();
    await closed;
    // The server counts clients as they close; retry briefly until the slot is free.
    let admitted: WebSocket | null = null;
    for (let i = 0; i < 50 && !admitted; i++) {
      await new Promise((r) => setTimeout(r, 10));
      admitted = await connect(url).catch(() => null);
    }
    expect(admitted).not.toBeNull();
  });
});

describe('frame size cap', () => {
  it('closes a socket that sends a frame over 16KB with code 1009', async () => {
    const url = await boot();
    const ws = await connect(url);
    const code = new Promise<number>((resolve) => ws.once('close', (c) => resolve(c)));
    ws.send('x'.repeat(20_000));
    expect(await code).toBe(1009);
  });

  it('still accepts ordinary frames just under the cap', async () => {
    const url = await boot();
    const ws = await connect(url);
    const reply = new Promise<string>((resolve) => ws.once('message', (d) => resolve(d.toString())));
    ws.send(JSON.stringify({ t: 'ping', pad: 'x'.repeat(8_000) }));
    expect(JSON.parse(await reply).t).toBe('pong');
  });
});
