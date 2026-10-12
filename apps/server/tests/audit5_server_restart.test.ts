// Restart determinism with the real engine. A bot plays a co-op game through RoomManager over a MemoryStore, the
// manager is discarded ("server restart") and a new one restores the game:
//   (a) from the latest snapshot plus the command tail (the fast path), and
//   (b) from the command log alone (snapshots hidden), a full replay.
// In both cases every seat must see exactly the view, pending decision and sequence number it saw before the restart,
// and play must continue to the same state an uninterrupted game reaches with the same bot choices.
import { describe, expect, it } from 'vitest';
import type { LobbySettings, ServerMessage } from '../../../packages/engine/src/protocol';
import { loadRealEngine } from '../src/engine';
import { RoomManager, type Session } from '../src/rooms';
import {
  MemoryStore, type FinishPatch, type GameStore, type NewGameRecord, type NewPlayerRecord, type PersistedGame, type StoredCommand,
} from '../src/store';

interface Client extends Session {
  out: ServerMessage[];
}

type StateMsg = Extract<ServerMessage, { t: 'state' }>;

function client(label: string): Client {
  const c: Client = {
    id: `c-${label}`,
    guestId: `guest-${label}-0001`,
    name: label,
    room: null,
    seat: null,
    out: [],
    send(m) {
      c.out.push(m);
    },
    close() {},
  };
  return c;
}

const latest = (c: Client): StateMsg | undefined => c.out.filter((m): m is StateMsg => m.t === 'state').at(-1);

const lastOf = <T extends ServerMessage['t']>(c: Client, t: T) =>
  c.out.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t).at(-1);

const SETTINGS: Partial<LobbySettings> = {
  roomName: 'Restart table',
  seats: 2,
  scenario: 'crater',
  society: 1,
  difficulty: 'normal',
  extraPack: false,
  advisors: [],
  seed: 4242,
};

function manager(store: GameStore): RoomManager {
  return new RoomManager({
    engine: loadRealEngine(),
    store,
    snapshotEvery: 4, // snapshots at 4, 8, 12, ...: most restarts need a command tail after the snapshot
    lobbyGraceMs: 60_000,
    endedRoomTtlMs: 60_000,
    maxRooms: 10,
    abandonAfterMs: 3_600_000,
    retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
  });
}

/** Same game store, but every game is handed back without its snapshot: forces a full replay from the command log. */
class WithoutSnapshots implements GameStore {
  readonly kind = 'memory' as const;
  constructor(private readonly inner: GameStore) {}
  createGame(rec: NewGameRecord) {
    return this.inner.createGame(rec);
  }
  addPlayers(gameId: string, players: NewPlayerRecord[]) {
    return this.inner.addPlayers(gameId, players);
  }
  appendCommand(gameId: string, cmd: StoredCommand) {
    return this.inner.appendCommand(gameId, cmd);
  }
  saveSnapshot(gameId: string, seq: number, payload: string) {
    return this.inner.saveSnapshot(gameId, seq, payload);
  }
  finishGame(gameId: string, patch: FinishPatch) {
    return this.inner.finishGame(gameId, patch);
  }
  async loadActiveGames(): Promise<PersistedGame[]> {
    return (await this.inner.loadActiveGames()).map((g) => ({ ...g, snapshot: null }));
  }
}

/** Deterministic PRNG (mulberry32): the bot's choices, identical across runs. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface OptionView {
  id: string;
  disabled?: string;
}

/** A legal pick for the decision as the addressed seat was shown it (same rules as tests/e2e-scenario.ts). */
function legalPick(p: { min: number; max: number; options: OptionView[]; meta?: Record<string, any> }, rnd: () => number): string[] {
  const enabled = p.options.filter((o) => !o.disabled);
  const allowRepeat = Boolean(p.meta?.allowRepeat);
  const caps: Record<string, number> | undefined = p.meta?.caps;
  const maxCount = allowRepeat ? p.max : Math.min(p.max, enabled.length);
  const count = p.min + Math.floor(rnd() * (maxCount - p.min + 1));
  if (!allowRepeat) {
    const ids = enabled.map((o) => o.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids.slice(0, count);
  }
  const used: Record<string, number> = {};
  const pick: string[] = [];
  while (pick.length < count) {
    const cands = enabled.filter((o) => (used[o.id] ?? 0) < (caps?.[o.id] ?? 1));
    if (cands.length === 0) break;
    const o = cands[Math.floor(rnd() * cands.length)];
    used[o.id] = (used[o.id] ?? 0) + 1;
    pick.push(o.id);
  }
  return pick;
}

/** Plays up to `count` decisions. Returns how many were answered. Fails the test on any refused answer. */
function play(m: RoomManager, a: Client, b: Client, rnd: () => number, count: number): number {
  let n = 0;
  while (n < count) {
    const st = latest(a);
    if (!st || st.status !== 'playing' || !st.pending) break;
    const seat = st.pending.who > 0 ? b : a;
    const shown = (latest(seat)!.view as any).pending as { min: number; max: number; options: OptionView[]; meta?: Record<string, any> };
    expect(shown.options.length, 'the addressed seat is shown the options').toBeGreaterThan(0);
    const pick = legalPick(shown, rnd);
    m.handle(seat, { t: 'answer', pendingId: st.pending.id, pick });
    expect(lastOf(seat, 'error'), `answer ${st.pending.id} refused`).toBeUndefined();
    expect(latest(a)!.seq).toBe(st.seq + 1);
    n++;
  }
  return n;
}

/** What the server last sent one seat: sequence, status, open decision and the redacted view. */
function picture(c: Client) {
  const s = latest(c)!;
  return JSON.parse(JSON.stringify({ seq: s.seq, seat: s.seat, status: s.status, endReason: s.endReason, pending: s.pending, view: s.view }));
}

/** Creates a 2-seat table, joins and starts it. Returns the room code and the seat tokens. */
function startTable(m: RoomManager, a: Client, b: Client): { code: string; tokenA: string; tokenB: string } {
  m.connect(a);
  m.connect(b);
  m.handle(a, { t: 'create', name: 'Ann', settings: SETTINGS });
  const joined = lastOf(a, 'joined')!;
  m.handle(b, { t: 'join', code: joined.code, name: 'Ben' });
  m.handle(b, { t: 'ready', ready: true });
  m.handle(a, { t: 'start' });
  expect(lastOf(a, 'error')).toBeUndefined();
  return { code: joined.code, tokenA: joined.token, tokenB: lastOf(b, 'joined')!.token };
}

/** Reconnects both seats to a (restarted) manager with their tokens. */
function resumeBoth(m: RoomManager, code: string, tokenA: string, tokenB: string): { a: Client; b: Client } {
  const a = client('A-restarted');
  const b = client('B-restarted');
  m.connect(a);
  m.connect(b);
  m.handle(a, { t: 'resume', code, token: tokenA });
  m.handle(b, { t: 'resume', code, token: tokenB });
  expect(lastOf(a, 'error')).toBeUndefined();
  expect(lastOf(b, 'error')).toBeUndefined();
  return { a, b };
}

const DECISIONS_BEFORE_RESTART = 30;
const DECISIONS_AFTER_RESTART = 20;

describe('a restarted server reproduces the game exactly', () => {
  it('restores from snapshot plus tail, and both seats see what they saw before the restart', async () => {
    const store = new MemoryStore();
    const m1 = manager(store);
    const a1 = client('A');
    const b1 = client('B');
    const { code, tokenA, tokenB } = startTable(m1, a1, b1);
    expect(play(m1, a1, b1, rng(99), DECISIONS_BEFORE_RESTART)).toBe(DECISIONS_BEFORE_RESTART);
    await m1.flush();
    const before = [picture(a1), picture(b1)];
    expect(before[0].view).not.toHaveProperty('rng');

    const m2 = manager(store);
    expect(await m2.restore()).toBe(1);
    const { a: a2, b: b2 } = resumeBoth(m2, code, tokenA, tokenB);
    expect([picture(a2), picture(b2)]).toEqual(before);
    expect(picture(a2).seq).toBe(DECISIONS_BEFORE_RESTART);
  });

  it('replays from the command log alone when no snapshot exists, to the same views', async () => {
    const store = new MemoryStore();
    const m1 = manager(store);
    const a1 = client('A');
    const b1 = client('B');
    const { code, tokenA, tokenB } = startTable(m1, a1, b1);
    play(m1, a1, b1, rng(99), DECISIONS_BEFORE_RESTART);
    await m1.flush();
    const before = [picture(a1), picture(b1)];

    const m2 = manager(new WithoutSnapshots(store));
    expect(await m2.restore()).toBe(1);
    const { a: a2, b: b2 } = resumeBoth(m2, code, tokenA, tokenB);
    expect([picture(a2), picture(b2)]).toEqual(before);
  });

  it('play continues after the restart to the same state as a game that never restarted', async () => {
    const total = DECISIONS_BEFORE_RESTART + DECISIONS_AFTER_RESTART;

    // Reference: one server, no restart, the same bot choices. Same client labels, so guest ids in the views match.
    const ref = manager(new MemoryStore());
    const ra = client('A');
    const rb = client('B');
    startTable(ref, ra, rb);
    const refAnswered = play(ref, ra, rb, rng(99), total);
    await ref.flush();
    const refFinal = [picture(ra), picture(rb)];

    // Restarted: the same bot, restarted after DECISIONS_BEFORE_RESTART (snapshot path), then play on.
    const store = new MemoryStore();
    const m1 = manager(store);
    const a1 = client('A');
    const b1 = client('B');
    const { code, tokenA, tokenB } = startTable(m1, a1, b1);
    const rnd = rng(99);
    let answered = play(m1, a1, b1, rnd, DECISIONS_BEFORE_RESTART);
    await m1.flush();
    const m2 = manager(store);
    expect(await m2.restore()).toBe(1);
    const { a: a2, b: b2 } = resumeBoth(m2, code, tokenA, tokenB);
    answered += play(m2, a2, b2, rnd, DECISIONS_AFTER_RESTART);
    await m2.flush();

    expect(refAnswered).toBeGreaterThanOrEqual(DECISIONS_BEFORE_RESTART + 1);
    expect(answered).toBe(refAnswered);
    expect([picture(a2), picture(b2)]).toEqual(refFinal);
    // The store holds one command row per accepted answer, in order, after the restart.
    const [stored] = await store.loadActiveGames();
    expect(stored.commands.map((c) => c.seq)).toEqual(Array.from({ length: answered }, (_, i) => i + 1));
  });
});
