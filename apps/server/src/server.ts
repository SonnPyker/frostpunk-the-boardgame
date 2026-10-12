// Transport: HTTP (/health, /api/rooms) and WebSocket (/ws, also "/") on one port, heartbeat, rate limiting, shutdown.
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { ServerConfig } from './config';
import type { LogFn, RoomManager, Session } from './rooms';
import { parseClientMessage } from './validate';
import { RefusalWindow, TokenBucket } from './util';
import type { ServerMessage } from '../../../packages/engine/src/protocol';

export const PROTOCOL_VERSION = 1;
const MAX_PAYLOAD_BYTES = 16 * 1024;
/** Refused frames inside the rate window that close the socket (1008). */
const RATE_VIOLATIONS_BEFORE_CLOSE = 20;
/** Default length of the rate window (config.rateWindowMs). */
const RATE_WINDOW_MS = 10_000;
/** Default open sockets per client address (config.maxConnPerIp) when a config object does not set it. */
const DEFAULT_MAX_CONN_PER_IP = 20;

export interface AppServerOptions {
  config: ServerConfig;
  manager: RoomManager;
  persistence: 'memory' | 'supabase';
  log: LogFn;
}

export interface RunningServer {
  readonly port: number;
  readonly http: Server;
  /** Stops accepting connections, tells clients to reconnect, flushes persistence, closes sockets. */
  stop(graceMs?: number): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (allowed.includes('*')) return true;
  if (origin === undefined) return true; // non-browser clients (CLI, tests) send no Origin
  return allowed.includes(origin);
}

function setCors(req: IncomingMessage, res: ServerResponse, allowed: string[]): void {
  const origin = req.headers.origin;
  if (allowed.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

export async function startServer(opts: AppServerOptions & { port?: number; host?: string }): Promise<RunningServer> {
  const { config, manager, persistence, log } = opts;
  const startedAt = Date.now();

  const http = createServer((req, res) => {
    setCors(req, res, config.corsOrigins);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/health') {
      const writes = manager.persistenceStats();
      sendJson(res, 200, {
        ok: true,
        protocol: PROTOCOL_VERSION,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        rooms: manager.roomCount,
        connections: manager.connectionCount,
        persistence,
        persistPending: writes.pending,
        persistFailed: writes.failed,
      });
      return;
    }
    if (path === '/api/rooms') {
      sendJson(res, 200, { rooms: manager.listOpenRooms() });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/ws' && path !== '/') return reject(socket, 404, 'Not Found');
    if (!originAllowed(req.headers.origin, config.corsOrigins)) return reject(socket, 403, 'Forbidden');
    if (wss.clients.size >= config.maxConnections) return reject(socket, 503, 'Service Unavailable');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  // Open sockets per client address. Only sockets that passed the check are counted, and each is released once.
  const perIp = new Map<string, number>();
  const maxPerIp = config.maxConnPerIp ?? DEFAULT_MAX_CONN_PER_IP;
  const trustProxy = config.trustProxy ?? false;

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('error', (e) => log('warn', 'socket error', e.message));

    const ip = clientAddress(req, trustProxy);
    const open = perIp.get(ip) ?? 0;
    if (open >= maxPerIp) {
      // Accepted and then closed with a WebSocket close code, so the client sees a reason instead of a bare HTTP error.
      ws.close(1008, 'too many connections from this address');
      return;
    }
    perIp.set(ip, open + 1);
    ws.once('close', () => {
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
    });

    const bucket = new TokenBucket(config.rateBurst, config.rateRefillPerSec);
    const refusals = new RefusalWindow(RATE_VIOLATIONS_BEFORE_CLOSE, config.rateWindowMs ?? RATE_WINDOW_MS);
    let closing = false;
    const session: Session = {
      id: randomUUID(),
      guestId: randomBytes(12).toString('base64url'),
      name: 'Guest',
      room: null,
      seat: null,
      send(msg: ServerMessage) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close(code: number, reason: string) {
        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(code, reason);
      },
    };

    manager.connect(session);
    session.send({ t: 'welcome', guestId: session.guestId, protocol: 1 });

    ws.on('message', (data, isBinary) => {
      if (closing) return;
      // Every frame, binary ones included, takes a token first, so the binary check cannot bypass the budget.
      if (!bucket.take()) {
        // Refusals are counted in a time window that accepted frames do not clear: a client that keeps refusals
        // coming (even interleaved with valid frames) is closed; a client refused now and then is not.
        session.send({ t: 'error', code: 'rate_limited', message: 'slow down' });
        if (refusals.refuse()) {
          closing = true;
          ws.close(1008, 'rate limit exceeded');
        }
        return;
      }
      if (isBinary) {
        session.send({ t: 'error', code: 'bad_request', message: 'binary frames are not supported' });
        return;
      }
      const parsed = parseClientMessage(rawToString(data));
      if (!parsed.ok) {
        session.send({ t: 'error', code: 'bad_request', message: parsed.message });
        return;
      }
      manager.handle(session, parsed.value);
    });

    ws.on('close', () => manager.disconnect(session));
  });

  // Heartbeat: ping every interval; a socket that did not answer the previous ping is terminated.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, config.heartbeatMs);
  heartbeat.unref();

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port ?? config.port, opts.host ?? '0.0.0.0', () => resolve());
  });
  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  log('info', `listening on :${port} (persistence: ${persistence}, origins: ${config.corsOrigins.join(',')})`);

  let stopped = false;
  return {
    port,
    http,
    async stop(graceMs = 5000) {
      if (stopped) return;
      stopped = true;
      clearInterval(heartbeat);
      manager.notifyShutdown(Math.min(graceMs, 10_000));
      // Stop accepting new connections. The close callback only fires once upgraded sockets are gone too,
      // so it is awaited after the sockets are closed below.
      const httpClosed = new Promise<void>((resolve) => http.close(() => resolve()));
      http.closeIdleConnections();
      await Promise.race([manager.flush(), sleep(graceMs)]);
      const unflushed = manager.persistenceStats().pending;
      if (unflushed > 0) log('warn', `shutdown: ${unflushed} database write(s) still pending after ${graceMs} ms; they are lost`);
      manager.dispose(1001, 'server shutting down');
      // Give each socket a moment to complete the close handshake, then drop whatever is left.
      await Promise.all(
        [...wss.clients].map(
          (ws) =>
            new Promise<void>((resolve) => {
              if (ws.readyState === ws.CLOSED) return resolve();
              const timer = setTimeout(() => {
                ws.terminate();
                resolve();
              }, 500);
              ws.once('close', () => {
                clearTimeout(timer);
                resolve();
              });
            }),
        ),
      );
      await Promise.race([httpClosed, sleep(1000)]);
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      log('info', 'stopped');
    },
  };
}

/**
 * The address a connection is counted under. With trustProxy the first X-Forwarded-For entry is used when present
 * (behind Render's proxy). Note that the first entry is whatever the client sent, so a client can choose it; see
 * docs/DEPLOYMENT.md before relying on this limit against deliberate abuse.
 */
export function clientAddress(req: Pick<IncomingMessage, 'headers' | 'socket'>, trustProxy: boolean): string {
  if (trustProxy) {
    const raw = req.headers['x-forwarded-for'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const first = header?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
