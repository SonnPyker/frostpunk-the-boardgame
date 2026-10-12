// Per-address connection limit (MAX_CONN_PER_IP) and the client address rule (TRUST_PROXY).
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig, type ServerConfig } from '../src/config';
import { RoomManager } from '../src/rooms';
import { clientAddress, startServer, type RunningServer } from '../src/server';
import { MemoryStore } from '../src/store';
import { makeFakeEngine } from './fake-engine';

const baseConfig: ServerConfig = {
  port: 0,
  corsOrigins: ['*'],
  supabaseUrl: null,
  supabaseServiceRoleKey: null,
  persistSnapshotEvery: 10,
  lobbyGraceMs: 60_000,
  heartbeatMs: 60_000,
  rateBurst: 1000,
  rateRefillPerSec: 1000,
  endedRoomTtlMs: 60_000,
  maxRooms: 100,
  maxConnections: 100,
  maxConnPerIp: 2,
  trustProxy: false,
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

/** Opens a socket and resolves once it is open. Rejects if the upgrade is refused. */
function open(url: string, headers: Record<string, string> = {}): Promise<WebSocket> {
  const ws = new WebSocket(url, { headers });
  sockets.push(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Opens a socket and resolves with how it ended: the close code, once it is open (or the refusal status). */
function outcome(url: string, headers: Record<string, string> = {}): Promise<{ opened: true; code: number; reason: string } | { opened: false; status: number }> {
  const ws = new WebSocket(url, { headers });
  sockets.push(ws);
  return new Promise((resolve) => {
    ws.once('unexpected-response', (_req, res) => resolve({ opened: false, status: res.statusCode ?? 0 }));
    ws.once('error', () => {});
    ws.once('open', () => {
      ws.once('close', (code, reason) => resolve({ opened: true, code, reason: reason.toString() }));
    });
  });
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const s of running.splice(0)) await s.stop(200);
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('per-address connection limit', () => {
  it('refuses the connection beyond the limit with close code 1008, and admits again once one of the first closes', async () => {
    const url = await boot({ maxConnPerIp: 2 });
    const a = await open(url);
    await open(url);

    const third = await outcome(url);
    expect(third).toEqual({ opened: true, code: 1008, reason: 'too many connections from this address' });

    a.close();
    await sleep(50);
    const fourth = await open(url);
    expect(fourth.readyState).toBe(WebSocket.OPEN);
  });

  it('counts a refused connection neither as open nor as a release (no counter drift)', async () => {
    const url = await boot({ maxConnPerIp: 1 });
    const first = await open(url);
    for (let i = 0; i < 3; i++) {
      const refused = await outcome(url);
      expect(refused).toMatchObject({ opened: true, code: 1008 });
    }
    // Refusals took no slot, so closing the one accepted socket frees the only slot.
    first.close();
    await sleep(50);
    const again = await open(url);
    expect(again.readyState).toBe(WebSocket.OPEN);
    expect(await outcome(url)).toMatchObject({ opened: true, code: 1008 });
  });

  it('ignores X-Forwarded-For when TRUST_PROXY is off: every socket counts under the real address', async () => {
    const url = await boot({ maxConnPerIp: 2, trustProxy: false });
    await open(url, { 'X-Forwarded-For': '198.51.100.1' });
    await open(url, { 'X-Forwarded-For': '198.51.100.2' });
    const third = await outcome(url, { 'X-Forwarded-For': '198.51.100.3' });
    expect(third).toMatchObject({ opened: true, code: 1008 });
  });

  it('counts by the first X-Forwarded-For entry when TRUST_PROXY is on', async () => {
    const url = await boot({ maxConnPerIp: 2, trustProxy: true });
    await open(url, { 'X-Forwarded-For': '198.51.100.1, 10.0.0.9' });
    await open(url, { 'X-Forwarded-For': '198.51.100.1' });
    // Same first hop: refused, whatever the proxy chain behind it.
    expect(await outcome(url, { 'X-Forwarded-For': '198.51.100.1, 10.0.0.7' })).toMatchObject({ opened: true, code: 1008 });
    // A different first hop has its own budget.
    const other = await open(url, { 'X-Forwarded-For': '198.51.100.2' });
    expect(other.readyState).toBe(WebSocket.OPEN);
  });
});

describe('clientAddress', () => {
  const req = (headers: Record<string, string | string[]>, remote: string | undefined) =>
    ({ headers, socket: { remoteAddress: remote } }) as unknown as Pick<IncomingMessage, 'headers' | 'socket'>;

  it('uses the socket address when the proxy is not trusted, whatever the header says', () => {
    expect(clientAddress(req({ 'x-forwarded-for': '203.0.113.5' }, '10.1.1.1'), false)).toBe('10.1.1.1');
  });

  it('uses the first X-Forwarded-For entry when the proxy is trusted', () => {
    expect(clientAddress(req({ 'x-forwarded-for': ' 203.0.113.5 , 10.0.0.2' }, '10.1.1.1'), true)).toBe('203.0.113.5');
    expect(clientAddress(req({ 'x-forwarded-for': ['203.0.113.6, 10.0.0.2'] }, '10.1.1.1'), true)).toBe('203.0.113.6');
  });

  it('falls back to the socket address when a trusted proxy sent no usable header', () => {
    expect(clientAddress(req({}, '10.1.1.1'), true)).toBe('10.1.1.1');
    expect(clientAddress(req({ 'x-forwarded-for': ' , ' }, '10.1.1.1'), true)).toBe('10.1.1.1');
    expect(clientAddress(req({}, undefined), false)).toBe('unknown');
  });
});

describe('MAX_CONN_PER_IP and TRUST_PROXY configuration', () => {
  it('defaults to 20 connections per address and no proxy trust', () => {
    const c = loadConfig({});
    expect(c.maxConnPerIp).toBe(20);
    expect(c.trustProxy).toBe(false);
  });

  it('reads MAX_CONN_PER_IP as an integer in range', () => {
    expect(loadConfig({ MAX_CONN_PER_IP: '5' }).maxConnPerIp).toBe(5);
    expect(() => loadConfig({ MAX_CONN_PER_IP: '0' })).toThrow(/invalid integer config value/);
    expect(() => loadConfig({ MAX_CONN_PER_IP: 'many' })).toThrow(/invalid integer config value/);
  });

  it('accepts TRUST_PROXY 1 and 0 only, so that a typo stops the deploy', () => {
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: '0' }).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: '' }).trustProxy).toBe(false);
    expect(() => loadConfig({ TRUST_PROXY: 'true' })).toThrow(/invalid TRUST_PROXY value/);
    expect(() => loadConfig({ TRUST_PROXY: 'yes' })).toThrow(/invalid TRUST_PROXY value/);
  });
});
