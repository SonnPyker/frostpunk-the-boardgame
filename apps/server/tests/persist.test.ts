// Persistence: the ordered retrying queue, games that keep running when writes fail, and restores after lost writes.
import { describe, expect, it } from 'vitest';
import { makeFakeEngine } from './fake-engine';
import { RoomManager, type Session } from '../src/rooms';
import { MemoryStore, type GameStore } from '../src/store';
import { WriteQueue } from '../src/persist';
import type { GameConfig } from '../src/adapter';

const retry = { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 };

const config: GameConfig = {
  scenario: 'crater',
  society: 1,
  difficulty: 'normal',
  mode: 'solo',
  players: [{ name: 'solo', id: 'g1' }],
  seed: 7,
  extraPack: false,
  advisors: [],
};

describe('WriteQueue', () => {
  it('runs jobs in order and waits for each to finish', async () => {
    const order: string[] = [];
    const q = new WriteQueue('t', retry, () => {});
    q.enqueue('a', async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('a');
    });
    q.enqueue('b', async () => {
      order.push('b');
    });
    expect(q.pending).toBe(2);
    await q.idle();
    expect(order).toEqual(['a', 'b']);
    expect(q.pending).toBe(0);
    expect(q.failed).toBe(0);
  });

  it('retries a failing write with capped exponential backoff until it succeeds', async () => {
    const sleeps: number[] = [];
    const logs: string[] = [];
    const q = new WriteQueue(
      't',
      { attempts: 5, baseDelayMs: 10, maxDelayMs: 25 },
      (_l, m) => {
        logs.push(m);
      },
      async (ms) => {
        sleeps.push(ms);
      },
    );
    let calls = 0;
    q.enqueue('flaky', async () => {
      calls++;
      if (calls < 4) throw new Error('boom');
    });
    await q.idle();
    expect(calls).toBe(4);
    expect(sleeps).toEqual([10, 20, 25]);
    expect(q.failed).toBe(0);
    expect(logs.filter((m) => m.includes('retrying'))).toHaveLength(3);
  });

  it('gives up after the last attempt, logs it, and keeps running later jobs', async () => {
    const logs: string[] = [];
    const q = new WriteQueue('t', retry, (lvl, m) => logs.push(`${lvl}:${m}`), async () => {});
    let attempts = 0;
    let after = false;
    q.enqueue('dead', async () => {
      attempts++;
      throw new Error('down');
    });
    q.enqueue('next', async () => {
      after = true;
    });
    await q.idle();
    expect(attempts).toBe(3);
    expect(q.failed).toBe(1);
    expect(after).toBe(true);
    expect(logs.some((l) => l.startsWith('error:') && l.includes('dropped after 3 attempts'))).toBe(true);
  });

  it('idle() never rejects, even when every job fails', async () => {
    const q = new WriteQueue('t', { attempts: 1, baseDelayMs: 1, maxDelayMs: 1 }, () => {});
    q.enqueue('x', async () => {
      throw new Error('nope');
    });
    await expect(q.idle()).resolves.toBeUndefined();
  });
});

interface Harness {
  manager: RoomManager;
  logs: string[];
  session(label: string): Session & { out: { t: string; code?: string }[] };
}

function harness(store: GameStore): Harness {
  const engine = makeFakeEngine();
  const logs: string[] = [];
  let n = 0;
  const codes = ['ABCDEF', 'GHJKMN', 'PQRSTU', 'VWXYZA'];
  let code = 0;
  let tok = 0;
  const manager = new RoomManager({
    engine,
    store,
    snapshotEvery: 2,
    lobbyGraceMs: 1000,
    endedRoomTtlMs: 5000,
    maxRooms: 50,
    abandonAfterMs: 60_000,
    retry,
    sleep: async () => {},
    log: (lvl, msg, extra) => logs.push(`${lvl}:${msg}${extra ? ` ${String(extra)}` : ''}`),
    ids: {
      roomCode: () => codes[code++ % codes.length],
      token: () => `token-${++tok}-abcdefghijkl`,
      seed: () => 7,
    },
  });
  return {
    manager,
    logs,
    session(label) {
      const out: { t: string; code?: string }[] = [];
      const s = {
        id: `p${++n}`,
        guestId: `guest-${label}-${n}`,
        name: label,
        room: null,
        seat: null,
        out,
        send(msg: { t: string; code?: string }) {
          out.push(msg);
        },
        close() {},
      };
      manager.connect(s);
      return s;
    },
  };
}

/** A store whose named operations fail a fixed number of times before succeeding. */
class FlakyStore implements GameStore {
  readonly kind = 'memory' as const;
  constructor(
    private readonly inner: MemoryStore,
    private readonly failures: Partial<Record<'createGame' | 'addPlayers' | 'appendCommand' | 'saveSnapshot' | 'finishGame', number>>,
  ) {}

  private gate(op: keyof typeof this.failures): void {
    const left = this.failures[op] ?? 0;
    if (left > 0) {
      this.failures[op] = left - 1;
      throw new Error(`simulated ${op} outage`);
    }
  }

  async createGame(rec: Parameters<GameStore['createGame']>[0]) {
    this.gate('createGame');
    return this.inner.createGame(rec);
  }
  async addPlayers(id: string, p: Parameters<GameStore['addPlayers']>[1]) {
    this.gate('addPlayers');
    return this.inner.addPlayers(id, p);
  }
  async appendCommand(id: string, c: Parameters<GameStore['appendCommand']>[1]) {
    this.gate('appendCommand');
    return this.inner.appendCommand(id, c);
  }
  async saveSnapshot(id: string, seq: number, payload: string) {
    this.gate('saveSnapshot');
    return this.inner.saveSnapshot(id, seq, payload);
  }
  async finishGame(id: string, patch: Parameters<GameStore['finishGame']>[1]) {
    this.gate('finishGame');
    return this.inner.finishGame(id, patch);
  }
  async loadActiveGames() {
    return this.inner.loadActiveGames();
  }
}

function startSolo(h: Harness) {
  const host = h.session('host');
  h.manager.handle(host, { t: 'create', name: 'host', settings: { seats: 1, seed: 7 } });
  h.manager.handle(host, { t: 'start' });
  return host;
}

describe('a game keeps running when persistence fails', () => {
  it('transient write failures are retried, so the store ends up complete and in order', async () => {
    const inner = new MemoryStore();
    const store = new FlakyStore(inner, { createGame: 1, addPlayers: 1, appendCommand: 2, saveSnapshot: 1 });
    const h = harness(store);
    const host = startSolo(h);
    h.manager.handle(host, { t: 'answer', pendingId: 1, pick: ['a'] });
    h.manager.handle(host, { t: 'answer', pendingId: 2, pick: ['b'] });
    expect(host.out.filter((m) => m.t === 'error')).toEqual([]);

    await h.manager.flush();
    const [game] = await inner.loadActiveGames();
    expect(game.commands.map((c) => c.seq)).toEqual([1, 2]);
    expect(game.players).toHaveLength(1);
    expect(game.snapshot?.seq).toBe(2);
    expect(h.manager.persistenceStats()).toEqual({ pending: 0, failed: 0 });
  });

  it('a write that never succeeds is dropped and logged; the players never see an error', async () => {
    const inner = new MemoryStore();
    const store = new FlakyStore(inner, { appendCommand: 1000 });
    const h = harness(store);
    const host = startSolo(h);
    h.manager.handle(host, { t: 'answer', pendingId: 1, pick: ['a'] });
    h.manager.handle(host, { t: 'answer', pendingId: 2, pick: ['b'] });
    expect(host.out.filter((m) => m.t === 'error')).toEqual([]);
    expect(h.manager.describeRoom('ABCDEF')!.seq).toBe(2);

    await h.manager.flush();
    expect(h.manager.persistenceStats().failed).toBe(2);
    expect(h.logs.some((l) => l.startsWith('error:') && l.includes('command 1') && l.includes('dropped'))).toBe(true);
  });

  it('a lost command before the latest snapshot does not block the restart', async () => {
    const inner = new MemoryStore();
    const engine = makeFakeEngine();
    // Two answers were applied. Command 1 never reached the store; the snapshot after command 2 did.
    const s = engine.createGame(config);
    engine.answer(s, 0, 1, ['a']);
    engine.answer(s, 0, 2, ['b']);
    await inner.createGame({ id: 'game-1', roomCode: 'ABCDEF', roomName: 'Lost write', config });
    await inner.addPlayers('game-1', [{ seat: 0, guestId: 'g1', name: 'solo', isHost: true, tokenHash: 'x'.repeat(64) }]);
    await inner.saveSnapshot('game-1', 2, engine.serialize(s));
    await inner.appendCommand('game-1', { seq: 1, who: 0, pendingId: 1, pick: ['a'] });
    await inner.appendCommand('game-1', { seq: 2, who: 0, pendingId: 2, pick: ['b'] });
    await inner.appendCommand('game-1', { seq: 3, who: 0, pendingId: 3, pick: ['a'] });
    // MemoryStore refuses gaps on write, so the lost write is simulated on the read side: command 1 is missing.
    const [loaded] = await inner.loadActiveGames();
    const lossy = {
      kind: 'memory' as const,
      loadActiveGames: async () => [{ ...loaded, commands: loaded.commands.filter((c) => c.seq !== 1) }],
    } as unknown as GameStore;

    const h = harness(lossy);
    expect(await h.manager.restore()).toBe(1);
    // Command 3 is the third answer, so the fake game is won after it.
    expect(h.manager.describeRoom('ABCDEF')).toMatchObject({ seq: 3, status: 'ended' });
  });
});

describe('MemoryStore writes are idempotent', () => {
  it('repeating createGame, addPlayers or appendCommand does not duplicate or fail', async () => {
    const store = new MemoryStore();
    await store.createGame({ id: 'g', roomCode: 'ABCDEF', roomName: 'x', config });
    await store.createGame({ id: 'g', roomCode: 'ABCDEF', roomName: 'x', config });
    const player = { seat: 0, guestId: 'g1', name: 'solo', isHost: true, tokenHash: 'x'.repeat(64) };
    await store.addPlayers('g', [player]);
    await store.addPlayers('g', [player]);
    await store.appendCommand('g', { seq: 1, who: 0, pendingId: 1, pick: ['a'] });
    await store.appendCommand('g', { seq: 1, who: 0, pendingId: 1, pick: ['a'] });
    await expect(store.appendCommand('g', { seq: 1, who: 0, pendingId: 9, pick: ['a'] })).rejects.toThrow(/already stored/);
    const [game] = await store.loadActiveGames();
    expect(game.players).toHaveLength(1);
    expect(game.commands).toHaveLength(1);
  });
});
