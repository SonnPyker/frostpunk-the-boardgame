// Room-level limits and housekeeping, driven with an injected clock: room cap, abandoned games, ended-room expiry,
// view redaction, and recovery after an engine answer is rejected mid-resolution.
import { describe, expect, it } from 'vitest';
import { RoomManager, redactView, type Session } from '../src/rooms';
import { MemoryStore } from '../src/store';
import { makeFakeEngine } from './fake-engine';
import type { ServerMessage } from '../../../packages/engine/src/protocol';

interface Out extends Session {
  out: ServerMessage[];
}

function build(opts: { maxRooms?: number; abandonAfterMs?: number; endedRoomTtlMs?: number } = {}) {
  let clock = 1_000_000;
  const store = new MemoryStore();
  const logs: string[] = [];
  let n = 0;
  let tok = 0;
  const codes = ['ABCDEF', 'GHJKMN', 'PQRSTU', 'VWXYZA', 'BCDFGH'];
  let code = 0;
  const manager = new RoomManager({
    engine: makeFakeEngine(),
    store,
    snapshotEvery: 100,
    lobbyGraceMs: 1000,
    endedRoomTtlMs: opts.endedRoomTtlMs ?? 5_000,
    maxRooms: opts.maxRooms ?? 50,
    abandonAfterMs: opts.abandonAfterMs ?? 60_000,
    retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
    sleep: async () => {},
    now: () => clock,
    log: (lvl, msg) => logs.push(`${lvl}:${msg}`),
    ids: { roomCode: () => codes[code++ % codes.length], token: () => `token-${++tok}-abcdefghijkl`, seed: () => 3 },
  });
  const session = (label: string): Out => {
    const s: Out = {
      id: `s${++n}`,
      guestId: `guest-${label}-${n}`,
      name: label,
      room: null,
      seat: null,
      out: [],
      send(msg) {
        s.out.push(msg);
      },
      close() {},
    };
    manager.connect(s);
    return s;
  };
  return {
    manager,
    store,
    logs,
    session,
    tick(ms: number) {
      clock += ms;
    },
  };
}

const errorsOf = (s: Out) => s.out.flatMap((m) => (m.t === 'error' ? [m.code] : []));

function soloGame(h: ReturnType<typeof build>) {
  const host = h.session('host');
  h.manager.handle(host, { t: 'create', name: 'host', settings: { seats: 1, seed: 3 } });
  h.manager.handle(host, { t: 'start' });
  return host;
}

describe('room cap', () => {
  it('refuses to create a room past maxRooms, with a clear error, and frees the slot when a room is dropped', () => {
    const h = build({ maxRooms: 1 });
    const first = h.session('first');
    h.manager.handle(first, { t: 'create', name: 'first' });
    const second = h.session('second');
    h.manager.handle(second, { t: 'create', name: 'second' });
    expect(errorsOf(second)).toEqual(['internal']);
    expect(second.out.find((m) => m.t === 'error')).toMatchObject({ message: expect.stringMatching(/room limit/) });
    expect(h.manager.roomCount).toBe(1);

    h.manager.handle(first, { t: 'leave' });
    h.manager.sweep();
    h.manager.handle(second, { t: 'create', name: 'second' });
    expect(errorsOf(second)).toEqual(['internal']); // still one error only
    expect(h.manager.roomCount).toBe(1);
  });
});

describe('abandoned games', () => {
  it('a live game with no seat attached for abandonAfterMs is stored as abandoned and unloaded', async () => {
    const h = build({ abandonAfterMs: 60_000 });
    const host = soloGame(h);
    h.manager.disconnect(host);

    h.tick(59_000);
    expect(h.manager.sweep()).toBe(0);
    expect(h.manager.roomCount).toBe(1);

    h.tick(2_000);
    expect(h.manager.sweep()).toBe(1);
    expect(h.manager.roomCount).toBe(0);
    await h.manager.flush();
    expect(await h.store.loadActiveGames()).toEqual([]);
    expect(h.logs.some((l) => l.includes('abandoned'))).toBe(true);
  });

  it('a game with a connected seat is never abandoned, however long it has been', () => {
    const h = build({ abandonAfterMs: 60_000 });
    soloGame(h);
    h.tick(10 * 60_000);
    expect(h.manager.sweep()).toBe(0);
    expect(h.manager.roomCount).toBe(1);
  });
});

describe('ended rooms', () => {
  it('stay readable for endedRoomTtlMs after the game ends, then are dropped from memory', () => {
    const h = build({ endedRoomTtlMs: 5_000 });
    const host = soloGame(h);
    h.manager.handle(host, { t: 'answer', pendingId: 1, pick: ['end'] });
    expect(h.manager.describeRoom('ABCDEF')?.status).toBe('ended');

    h.tick(4_000);
    expect(h.manager.sweep()).toBe(0);
    expect(h.manager.describeRoom('ABCDEF')).not.toBeNull();

    h.tick(2_000);
    expect(h.manager.sweep()).toBe(1);
    expect(h.manager.describeRoom('ABCDEF')).toBeNull();
  });
});

describe('redactView', () => {
  it('removes the engine internals that must never reach a client, and keeps everything else', () => {
    const view = {
      round: 2,
      options: ['a'],
      rng: [1, 2, 3],
      stack: [],
      decks: { laws: [] },
      lawConsequenceBank: [],
      futureLaws: ['secret law'],
    };
    // futureLaws is public (Law card ids of the Future Law display), so it passes through
    expect(redactView(view)).toEqual({ round: 2, options: ['a'], futureLaws: ['secret law'] });
    expect(view.rng).toEqual([1, 2, 3]); // the original is not mutated
  });

  it('passes non-object values through unchanged', () => {
    expect(redactView(null)).toBeNull();
    expect(redactView([1, 2])).toEqual([1, 2]);
    expect(redactView('x')).toBe('x');
  });
});

describe('recovery after a rejected answer', () => {
  it('a rule that fails mid-resolution clears the decision; the room rebuilds from its log and play continues', () => {
    const h = build();
    const host = soloGame(h);
    h.manager.handle(host, { t: 'answer', pendingId: 1, pick: ['corrupt'] });
    expect(errorsOf(host)).toEqual(['invalid_answer']);
    expect(h.logs.some((l) => l.includes('rebuilding'))).toBe(true);
    expect(h.manager.describeRoom('ABCDEF')).toMatchObject({ seq: 0, status: 'playing' });

    // The decision is open again and the seat can answer it.
    host.out.length = 0;
    h.manager.handle(host, { t: 'answer', pendingId: 1, pick: ['a'] });
    expect(errorsOf(host)).toEqual([]);
    expect(h.manager.describeRoom('ABCDEF')).toMatchObject({ seq: 1 });
  });
});
