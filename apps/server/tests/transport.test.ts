// End-to-end over real sockets: HTTP routes, WebSocket handshake, origin policy, rate limiting, shutdown.
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerConfig } from '../src/config';
import { RoomManager } from '../src/rooms';
import { startServer, type RunningServer } from '../src/server';
import { MemoryStore } from '../src/store';
import { makeFakeEngine } from './fake-engine';

const config: ServerConfig = {
  port: 0,
  corsOrigins: ['https://game.example'],
  supabaseUrl: null,
  supabaseServiceRoleKey: null,
  persistSnapshotEvery: 10,
  lobbyGraceMs: 60_000,
  heartbeatMs: 60_000,
  rateBurst: 5,
  rateRefillPerSec: 1,
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

async function boot(overrides: Partial<ServerConfig> = {}): Promise<{ base: string; ws: string; server: RunningServer; manager: RoomManager }> {
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
    config: { ...config, ...overrides },
    manager,
    persistence: 'memory',
    log: () => {},
    port: 0,
    host: '127.0.0.1',
  });
  running.push(server);
  return { base: `http://127.0.0.1:${server.port}`, ws: `ws://127.0.0.1:${server.port}/ws`, server, manager };
}

/** Opens a socket and collects every frame it receives. */
function open(url: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(url, { headers });
  const frames: any[] = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  sockets.push(ws);
  const ready = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const waitFor = (pred: (f: any) => boolean, ms = 2000) =>
    new Promise<any>((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const hit = frames.find(pred);
        if (hit) return resolve(hit);
        if (Date.now() - t0 > ms) return reject(new Error('timeout waiting for frame; got ' + JSON.stringify(frames)));
        setTimeout(tick, 5);
      };
      tick();
    });
  return { ws, frames, ready, waitFor };
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const s of running.splice(0)) await s.stop(200);
});

describe('HTTP', () => {
  it('serves /health and an empty /api/rooms', async () => {
    const { base } = await boot();
    const health = await fetch(`${base}/health`).then((r) => r.json());
    expect(health).toMatchObject({ ok: true, protocol: 1, persistence: 'memory', rooms: 0 });
    const rooms = await fetch(`${base}/api/rooms`).then((r) => r.json());
    expect(rooms).toEqual({ rooms: [] });
  });

  it('lists open lobbies without leaking tokens', async () => {
    const { base, ws } = await boot();
    const c = open(ws, { Origin: 'https://game.example' });
    await c.ready;
    await c.waitFor((f) => f.t === 'welcome');
    c.ws.send(JSON.stringify({ t: 'create', name: 'Ann', settings: { roomName: 'Night shift', seats: 3 } }));
    await c.waitFor((f) => f.t === 'joined');
    const rooms = (await fetch(`${base}/api/rooms`).then((r) => r.json())) as {
      rooms: { roomName: string; seated: number; maxSeats: number; host: string }[];
    };
    expect(rooms.rooms).toHaveLength(1);
    expect(rooms.rooms[0]).toMatchObject({ roomName: 'Night shift', seated: 1, maxSeats: 3, host: 'Ann' });
    expect(JSON.stringify(rooms)).not.toContain('token');
  });

  it('answers CORS preflight for allowed origins only', async () => {
    const { base } = await boot();
    const ok = await fetch(`${base}/api/rooms`, { method: 'OPTIONS', headers: { Origin: 'https://game.example' } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://game.example');
    const other = await fetch(`${base}/api/rooms`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns 404 for unknown paths and 405 for writes', async () => {
    const { base } = await boot();
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(405);
  });
});

describe('WebSocket', () => {
  it('sends welcome, runs a lobby round trip, and answers ping', async () => {
    const { ws } = await boot();
    const c = open(ws);
    await c.ready;
    const welcome = await c.waitFor((f) => f.t === 'welcome');
    expect(welcome.guestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    c.ws.send(JSON.stringify({ t: 'create', name: 'Ann' }));
    const joined = await c.waitFor((f) => f.t === 'joined');
    expect(joined).toMatchObject({ seat: 0 });
    expect(joined.token.length).toBeGreaterThan(16);
    c.ws.send(JSON.stringify({ t: 'ping', ts: 7 }));
    expect(await c.waitFor((f) => f.t === 'pong')).toEqual({ t: 'pong', ts: 7 });
  });

  it('reports malformed frames without closing the socket', async () => {
    const { ws } = await boot();
    const c = open(ws);
    await c.ready;
    c.ws.send('{"t":"nope"}');
    expect(await c.waitFor((f) => f.t === 'error')).toMatchObject({ code: 'bad_request' });
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('refuses sockets from disallowed origins', async () => {
    const { ws } = await boot();
    const c = open(ws, { Origin: 'https://evil.example' });
    await expect(c.ready).rejects.toBeDefined();
  });

  it('rate limits bursts and closes a socket that keeps flooding', async () => {
    const { ws } = await boot({ rateBurst: 3, rateRefillPerSec: 0.001 });
    const c = open(ws);
    await c.ready;
    const closed = new Promise<number>((resolve) => c.ws.once('close', (code) => resolve(code)));
    for (let i = 0; i < 40; i++) c.ws.send('{"t":"ping"}');
    expect(await c.waitFor((f) => f.t === 'error' && f.code === 'rate_limited')).toBeDefined();
    expect(await closed).toBe(1008);
  });

  it('shutdown tells clients to reconnect and closes sockets', async () => {
    const { ws, server } = await boot();
    const c = open(ws);
    await c.ready;
    await c.waitFor((f) => f.t === 'welcome');
    const closed = new Promise<number>((resolve) => c.ws.once('close', (code) => resolve(code)));
    const stopping = server.stop(1000);
    expect(await c.waitFor((f) => f.t === 'shutdown')).toMatchObject({ reconnectInMs: 1000 });
    await stopping;
    expect(await closed).toBe(1001);
    running.splice(running.indexOf(server), 1);
  });
});
