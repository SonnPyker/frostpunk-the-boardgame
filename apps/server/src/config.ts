// Environment configuration. Variable names match docs/ENGINE_SPEC.md section 5.3 (plus the optional extras below).

export interface ServerConfig {
  port: number;
  /** Allowed browser origins. ['*'] allows everything (default when CORS_ORIGIN is unset). */
  corsOrigins: string[];
  supabaseUrl: string | null;
  supabaseServiceRoleKey: string | null;
  /** Write a game_snapshots row every N applied commands (and at game start / end). */
  persistSnapshotEvery: number;
  /** Lobby seat is removed this many ms after its socket drops without resume. */
  lobbyGraceMs: number;
  /** Heartbeat: WebSocket ping interval. A socket missing one pong is terminated. */
  heartbeatMs: number;
  /** Per-connection message budget: burst capacity and refill per second. */
  rateBurst: number;
  rateRefillPerSec: number;
  /** Refused frames inside this window close the socket (default 10 s when unset; see server.ts). */
  rateWindowMs?: number;
  /** Finished games stay in memory this long (they are already persisted). */
  endedRoomTtlMs: number;
  /** Rooms (lobbies, live and finished games) held in memory. New rooms are refused beyond this. */
  maxRooms: number;
  /** Concurrent WebSocket connections. Upgrades beyond this get HTTP 503. */
  maxConnections: number;
  /**
   * Concurrent WebSocket connections per client address. A connection beyond this is accepted and then closed with
   * 1008. Optional in the type so that test fixtures written before it existed still compile; loadConfig always sets it.
   */
  maxConnPerIp?: number;
  /**
   * TRUST_PROXY=1 means the server sits behind a reverse proxy (Render): the client address is then read from the first
   * entry of X-Forwarded-For. Otherwise X-Forwarded-For is ignored and the socket's own address is used.
   */
  trustProxy?: boolean;
  /** A live game with no seat attached for this long is marked 'abandoned' and unloaded from memory. */
  abandonAfterMs: number;
  /** Persistence: attempts per write (1 = no retry) and the backoff base / cap in ms. */
  persistAttempts: number;
  persistBaseDelayMs: number;
  persistMaxDelayMs: number;
  /** On SIGTERM: how long pending database writes may take to flush before the process exits. Keep it below the platform's kill timeout. */
  shutdownGraceMs: number;
}

/**
 * Parses CORS_ORIGIN (comma list). Each entry must be a bare origin such as `https://app.example` (a trailing slash is
 * accepted; a path, query or user info is not). Entries are stored in the browser's normalised form. Unset or empty
 * means '*'. Throws on a malformed entry so that a typo fails the deploy instead of silently refusing every browser.
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  const entries = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) return ['*'];
  const out: string[] = [];
  for (const entry of entries) {
    if (entry === '*') {
      out.push('*');
      continue;
    }
    let u: URL;
    try {
      u = new URL(entry);
    } catch {
      throw new Error(`invalid CORS_ORIGIN entry (expected an origin such as https://app.example): ${entry}`);
    }
    const bare = (u.protocol === 'http:' || u.protocol === 'https:') && (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash && !u.username && !u.password;
    if (!bare) throw new Error(`invalid CORS_ORIGIN entry (an origin has no path, query or user info): ${entry}`);
    if (!out.includes(u.origin)) out.push(u.origin);
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const int = (v: string | undefined, def: number, min: number, max: number): number => {
    if (v === undefined || v.trim() === '') return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`invalid integer config value: ${v}`);
    return n;
  };
  const origins = parseCorsOrigins(env.CORS_ORIGIN);
  const trustProxy = env.TRUST_PROXY?.trim() ?? '';
  if (trustProxy !== '' && trustProxy !== '0' && trustProxy !== '1') throw new Error(`invalid TRUST_PROXY value (use 1 or 0): ${env.TRUST_PROXY}`);
  const url = env.SUPABASE_URL?.trim() || null;
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
  return {
    port: int(env.PORT, 8080, 0, 65535),
    corsOrigins: origins,
    supabaseUrl: url,
    supabaseServiceRoleKey: key,
    persistSnapshotEvery: int(env.PERSIST_SNAPSHOT_EVERY, 10, 1, 100000),
    lobbyGraceMs: 60_000,
    heartbeatMs: 25_000,
    rateBurst: 30,
    rateRefillPerSec: 8,
    rateWindowMs: 10_000,
    endedRoomTtlMs: 60 * 60 * 1000,
    maxRooms: int(env.MAX_ROOMS, 200, 1, 100000),
    maxConnections: int(env.MAX_CONNECTIONS, 1000, 1, 1000000),
    maxConnPerIp: int(env.MAX_CONN_PER_IP, 20, 1, 1000000),
    trustProxy: trustProxy === '1',
    abandonAfterMs: int(env.ABANDON_GAME_MINUTES, 24 * 60, 1, 100000) * 60_000,
    persistAttempts: int(env.PERSIST_ATTEMPTS, 10, 1, 100),
    persistBaseDelayMs: 500,
    persistMaxDelayMs: 30_000,
    shutdownGraceMs: int(env.SHUTDOWN_GRACE_MS, 20_000, 1_000, 120_000),
  };
}
