// Per-viewer browser storage: the autosave of a solo game and the co-op seat token (for resume).
// Every access is wrapped: storage can be blocked, full or unavailable (private windows, previews).
//
// Solo save format (version 2, key 'frostpunk.solo.save.v1' kept so older saves are still found):
//   kind 'replay'   : { v:2, config, commands, hash }  the game is rebuilt with engine replay(config, commands) and the
//                     result must hash to `hash`; this is the normal autosave after every answered decision.
//   kind 'snapshot' : { v:2, config, state }           the serialised state itself, used when the game cannot be
//                     described by commands (a developer fast-forward adopted a state). Not replayable.
//   v1 (legacy)     : { v:1, config, state }           the snapshot form written by the first build; read as a snapshot.
import type { Command, GameConfig } from '@frostpunk/engine';

const SOLO_KEY = 'frostpunk.solo.save.v1';
/** The co-op seat of one tab (sessionStorage). In localStorage this key is the seat an older build kept; it is migrated on read. */
const COOP_KEY = 'frostpunk.coop.session.v1';
/** Fallback: the last co-op seat this browser held (localStorage), so a fresh tab can rejoin after the tab was closed. */
const COOP_LAST_KEY = 'frostpunk.coop.last.v1';
const GUEST_KEY = 'frostpunk.guest.v1';
const GUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SEAT_TEXT_MAX = 256;

/** The save format written by this build. */
export const SAVE_FORMAT = 2;

/** A co-op seat: enough to resume it with the server's `resume` message. */
interface CoopSeat {
  serverUrl: string;
  code: string;
  token: string;
  name: string;
}

export interface StoredCoopSession extends CoopSeat {
  /** the guest id stored with the seat (set for fallback reads) */
  guestId?: string;
  /** when the fallback record was written (ms since epoch); set for fallback reads */
  savedAt?: number;
  /** true when this tab holds no seat and the seat comes from the localStorage fallback */
  fallback?: boolean;
}

/** The localStorage fallback record (format 1). */
interface StoredCoopLast extends CoopSeat {
  v: 1;
  guestId?: string;
  savedAt: number;
}

// Solo autosave uses localStorage (shared by every tab of the origin, so the last game survives a restart of the
// browser). The co-op seat and the guest id live in sessionStorage: they belong to one tab, so two tabs playing two
// seats of one room (or a reload of one tab) never read or overwrite each other's seat. The last seat is also copied
// to localStorage (COOP_LAST_KEY) as a fallback, used only by a fresh tab that has no seat of its own.
type StoreKind = 'local' | 'session';

/** The storage object, or null when the browser blocks it (the getter itself can throw). */
function storeOf(kind: StoreKind): Storage | null {
  try {
    return kind === 'session' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

function read(key: string, kind: StoreKind = 'local'): string | null {
  try {
    return storeOf(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null, kind: StoreKind = 'local'): boolean {
  try {
    const store = storeOf(kind);
    if (!store) return false;
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// ---- solo autosave -------------------------------------------------------

export interface SoloSaveReplay {
  v: 2;
  kind: 'replay';
  savedAt: number;
  config: GameConfig;
  commands: Command[];
  /** cyrb53 hash (hex) of the serialised state after the last command */
  hash: string;
}

export interface SoloSaveSnapshot {
  v: 2;
  kind: 'snapshot';
  savedAt: number;
  config: GameConfig;
  /** serialised engine state (JSON text) */
  state: string;
}

export interface SoloSaveLegacy {
  v: 1;
  savedAt: number;
  config: GameConfig;
  state: string;
}

export type SoloSave = SoloSaveReplay | SoloSaveSnapshot | SoloSaveLegacy;

/** Hash of a text (cyrb53, 53 bits, hex). Used to detect a replay that no longer reproduces the saved game. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

function isConfigLike(c: unknown): c is GameConfig {
  return typeof c === 'object' && c !== null && Array.isArray((c as GameConfig).players);
}

/** Reads and shape-checks the stored solo save. Returns null when there is none or it is not a known format. */
export function readSoloSave(): SoloSave | null {
  const raw = read(SOLO_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<SoloSave> & { v?: number; kind?: string };
    if (!p || typeof p !== 'object' || !isConfigLike(p.config)) return null;
    if (p.v === 1 && typeof (p as SoloSaveLegacy).state === 'string') return p as SoloSaveLegacy;
    if (p.v === SAVE_FORMAT && p.kind === 'snapshot' && typeof (p as SoloSaveSnapshot).state === 'string') {
      return p as SoloSaveSnapshot;
    }
    if (p.v === SAVE_FORMAT && p.kind === 'replay') {
      const r = p as SoloSaveReplay;
      if (Array.isArray(r.commands) && typeof r.hash === 'string') return r;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSoloSave(save: SoloSave): boolean {
  try {
    return write(SOLO_KEY, JSON.stringify(save));
  } catch {
    return false;
  }
}

export function clearSoloSave(): void {
  write(SOLO_KEY, null);
}

export function hasSoloSave(): boolean {
  return readSoloSave() !== null;
}

// ---- co-op seat token ----------------------------------------------------

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Shape-checks a stored seat. Anything malformed is treated as no seat. */
function parseSeat(raw: unknown): CoopSeat | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= SEAT_TEXT_MAX;
  if (!text(p.serverUrl) || !text(p.code) || !text(p.token)) return null;
  return {
    serverUrl: p.serverUrl,
    code: p.code,
    token: p.token,
    name: typeof p.name === 'string' ? p.name.slice(0, 64) : '',
  };
}

function readTabSeat(): CoopSeat | null {
  return parseSeat(parseJson(read(COOP_KEY, 'session')));
}

function readLastRecord(): StoredCoopLast | null {
  const raw = parseJson(read(COOP_LAST_KEY));
  const seat = parseSeat(raw);
  if (!seat || !raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.savedAt !== 'number') return null;
  const guest = typeof r.guestId === 'string' && GUEST_ID_RE.test(r.guestId) ? r.guestId : undefined;
  return { v: 1, ...seat, guestId: guest, savedAt: r.savedAt };
}

function writeLastRecord(seat: CoopSeat, guest: string | undefined, savedAt: number): void {
  const record: StoredCoopLast = { v: 1, ...seat, guestId: guest, savedAt };
  write(COOP_LAST_KEY, JSON.stringify(record));
}

/** Reads and removes the seat an older build kept in localStorage, so it is migrated to the new format once. */
function takeLegacyLocalSeat(): CoopSeat | null {
  const raw = read(COOP_KEY, 'local');
  if (raw === null) return null;
  write(COOP_KEY, null, 'local');
  return parseSeat(parseJson(raw));
}

/**
 * The co-op seat for this browser: this tab's seat first, otherwise the localStorage fallback (flagged `fallback`).
 * Never throws; storage that is blocked or full simply yields no seat.
 */
export function readCoopSession(): StoredCoopSession | null {
  const legacy = takeLegacyLocalSeat();
  const tab = readTabSeat();
  if (tab) return { ...tab, fallback: false };
  let last = readLastRecord();
  if (!last && legacy) {
    const now = Date.now();
    writeLastRecord(legacy, undefined, now);
    last = readLastRecord();
  }
  if (!last) return null;
  return {
    serverUrl: last.serverUrl,
    code: last.code,
    token: last.token,
    name: last.name,
    guestId: last.guestId,
    savedAt: last.savedAt,
    fallback: true,
  };
}

/** Stores the seat for this tab and as the localStorage fallback. `null` forgets the seat everywhere. */
export function writeCoopSession(session: StoredCoopSession | null): void {
  if (session === null) {
    write(COOP_KEY, null, 'session');
    write(COOP_LAST_KEY, null);
    write(COOP_KEY, null, 'local');
    return;
  }
  const seat: CoopSeat = {
    serverUrl: session.serverUrl,
    code: session.code,
    token: session.token,
    name: session.name,
  };
  write(COOP_KEY, JSON.stringify(seat), 'session');
  writeLastRecord(seat, guestId(), Date.now());
}

/** A tab that resumes the fallback seat takes over the guest id stored with it, unless it already has one. */
export function adoptFallbackGuestId(): void {
  const current = read(GUEST_KEY, 'session');
  if (current && GUEST_ID_RE.test(current)) return;
  const last = readLastRecord();
  if (last?.guestId) write(GUEST_KEY, last.guestId, 'session');
}

/** Stable anonymous id so the server can recognise the browser across reloads. */
export function guestId(): string | undefined {
  const existing = read(GUEST_KEY, 'session');
  if (existing && GUEST_ID_RE.test(existing)) return existing;
  const id = randomId();
  return write(GUEST_KEY, id, 'session') ? id : undefined;
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
