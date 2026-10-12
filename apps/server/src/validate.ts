// Validation of untrusted client input. Pure functions, no I/O.
// Type-only import by relative path: the engine package exports only its index, which is not written yet.
import type { ClientMessage, LobbySettings } from '../../../packages/engine/src/protocol';
import { assertNever } from './util';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const SCENARIOS = ['crater', 'frozenGrove', 'dreadnought'] as const;
const DIFFICULTIES = ['normal', 'hard'] as const;
const CLIENT_TYPES = [
  'hello', 'create', 'join', 'resume', 'settings', 'ready', 'start', 'answer', 'chat', 'leave', 'ping',
] as const;

const GUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CODE_RE = /^[A-HJ-NP-Z]{6}$/; // A-Z without I and O
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function isGuestId(v: unknown): v is string {
  return typeof v === 'string' && GUEST_ID_RE.test(v);
}

/** Upper-cases and trims a room code. Returns null when the shape is wrong. */
export function normalizeCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

/** Strips control characters, collapses whitespace, clamps length. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function cleanName(v: unknown): string {
  return cleanText(v, 24) || 'Guest';
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail<T>(message: string): Parsed<T> {
  return { ok: false, message };
}

/** Validates a partial lobby settings object. Unknown keys are rejected to catch client typos. */
export function parseSettingsPatch(input: unknown): Parsed<Partial<LobbySettings>> {
  if (!isObj(input)) return fail('settings must be an object');
  const allowed = new Set(['roomName', 'seats', 'scenario', 'society', 'difficulty', 'extraPack', 'advisors', 'seed']);
  for (const k of Object.keys(input)) if (!allowed.has(k)) return fail(`unknown setting: ${k}`);
  const out: Partial<LobbySettings> = {};

  if ('roomName' in input) {
    const name = cleanText(input.roomName, 40);
    if (!name) return fail('roomName must be 1..40 characters');
    out.roomName = name;
  }
  if ('seats' in input) {
    const n = input.seats;
    if (n !== 1 && n !== 2 && n !== 3 && n !== 4) return fail('seats must be 1..4');
    out.seats = n;
  }
  if ('scenario' in input) {
    if (!(SCENARIOS as readonly unknown[]).includes(input.scenario)) return fail('unknown scenario');
    out.scenario = input.scenario as LobbySettings['scenario'];
  }
  if ('society' in input) {
    const n = input.society;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 6) return fail('society must be 1..6');
    out.society = n;
  }
  if ('difficulty' in input) {
    if (!(DIFFICULTIES as readonly unknown[]).includes(input.difficulty)) return fail('unknown difficulty');
    out.difficulty = input.difficulty as LobbySettings['difficulty'];
  }
  if ('extraPack' in input) {
    if (typeof input.extraPack !== 'boolean') return fail('extraPack must be boolean');
    out.extraPack = input.extraPack;
  }
  if ('advisors' in input) {
    const a = input.advisors;
    if (!Array.isArray(a) || a.length > 4) return fail('advisors must be an array of at most 4 entries');
    const list: (string | null)[] = [];
    for (const e of a) {
      if (e === null) list.push(null);
      else if (typeof e === 'string' && e.length >= 1 && e.length <= 40) list.push(e);
      else return fail('advisor entries must be null or a short string');
    }
    out.advisors = list;
  }
  if ('seed' in input) {
    const n = input.seed;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 0xffffffff) return fail('seed must be a uint32');
    out.seed = n;
  }
  return { ok: true, value: out };
}

/** Parses one incoming text frame into a typed ClientMessage. */
export function parseClientMessage(raw: string): Parsed<ClientMessage> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fail('frame is not valid JSON');
  }
  if (!isObj(data)) return fail('frame must be a JSON object');
  const t = data.t;
  if (typeof t !== 'string' || !(CLIENT_TYPES as readonly string[]).includes(t)) return fail('unknown message type');

  switch (t as ClientMessage['t']) {
    case 'hello': {
      const msg: ClientMessage = { t: 'hello' };
      if (data.guestId !== undefined) {
        if (!isGuestId(data.guestId)) return fail('guestId has an invalid format');
        msg.guestId = data.guestId;
      }
      if (data.name !== undefined) {
        if (typeof data.name !== 'string') return fail('name must be a string');
        msg.name = cleanName(data.name);
      }
      return { ok: true, value: msg };
    }
    case 'create': {
      if (typeof data.name !== 'string') return fail('name is required');
      const msg: ClientMessage = { t: 'create', name: cleanName(data.name) };
      if (data.settings !== undefined) {
        const s = parseSettingsPatch(data.settings);
        if (!s.ok) return s;
        msg.settings = s.value;
      }
      return { ok: true, value: msg };
    }
    case 'join': {
      const code = normalizeCode(data.code);
      if (!code) return fail('code must be 6 letters');
      if (typeof data.name !== 'string') return fail('name is required');
      return { ok: true, value: { t: 'join', code, name: cleanName(data.name) } };
    }
    case 'resume': {
      const code = normalizeCode(data.code);
      if (!code) return fail('code must be 6 letters');
      if (typeof data.token !== 'string' || !TOKEN_RE.test(data.token)) return fail('token has an invalid format');
      return { ok: true, value: { t: 'resume', code, token: data.token } };
    }
    case 'settings': {
      const s = parseSettingsPatch(data.settings);
      if (!s.ok) return s;
      return { ok: true, value: { t: 'settings', settings: s.value } };
    }
    case 'ready': {
      if (typeof data.ready !== 'boolean') return fail('ready must be boolean');
      return { ok: true, value: { t: 'ready', ready: data.ready } };
    }
    case 'start':
      return { ok: true, value: { t: 'start' } };
    case 'answer': {
      const id = data.pendingId;
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) return fail('pendingId must be an integer');
      if (!Array.isArray(data.pick) || data.pick.length > 64 || !data.pick.every((p) => typeof p === 'string' && p.length <= 64)) {
        return fail('pick must be an array of option ids');
      }
      return { ok: true, value: { t: 'answer', pendingId: id, pick: data.pick as string[] } };
    }
    case 'chat': {
      const text = cleanText(data.text, 300);
      if (!text) return fail('chat text must be 1..300 characters');
      return { ok: true, value: { t: 'chat', text } };
    }
    case 'leave':
      return { ok: true, value: { t: 'leave' } };
    case 'ping': {
      const msg: ClientMessage = { t: 'ping' };
      if (typeof data.ts === 'number' && Number.isFinite(data.ts)) msg.ts = data.ts;
      return { ok: true, value: msg };
    }
    default:
      return assertNever(t as never);
  }
}
