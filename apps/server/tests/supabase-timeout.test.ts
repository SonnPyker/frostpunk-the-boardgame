// Per-attempt deadline on database calls. A call that never answers fails its attempt, so the room's write queue can retry
// it and keep going; it must not hold the queue for good.
import { describe, expect, it } from 'vitest';
import type { GameConfig } from '../src/adapter';
import { WriteQueue } from '../src/persist';
import { DEFAULT_TIMEOUT_MS, SupabaseStore, withTimeout, type SupabaseLike } from '../src/supabase-store';
import { FakeSupabase } from './fake-supabase';

const GAME = '11111111-2222-4333-8444-555555555555';
const config: GameConfig = {
  scenario: 'crater',
  society: 1,
  difficulty: 'normal',
  mode: 'coop',
  players: [{ name: 'a', id: 'g1' }, { name: 'b', id: 'g2' }],
  seed: 9,
  extraPack: false,
  advisors: [],
};
const cmd = (seq: number) => ({ seq, who: 0, pendingId: seq, pick: ['a'] });

/** A thenable that never settles, like a request whose response never arrives. */
const never = { then() {} };

/** Any chain of query-builder calls (select().eq().order().range() ...) that ends in a request that never answers. */
function hangingBuilder(): any {
  const builder: any = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? () => {} : () => builder) });
  return builder;
}

/** A client that hangs every call on `table` for the first `hangs` calls, then behaves like the inner fake. */
class HangingFirst implements SupabaseLike {
  private left: number;
  constructor(private readonly inner: FakeSupabase, private readonly table: string, hangs: number) {
    this.left = hangs;
  }
  from(table: string): any {
    if (table === this.table && this.left > 0) {
      this.left--;
      return hangingBuilder();
    }
    return this.inner.from(table);
  }
}

/** A client on which every call hangs. */
const deadClient: SupabaseLike = {
  from: () => hangingBuilder(),
};

describe('withTimeout', () => {
  it('passes through a result that arrives in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, 'quick')).resolves.toBe(7);
  });

  it('rejects with the operation name when the deadline passes first', async () => {
    await expect(withTimeout(never as PromiseLike<number>, 10, 'slow call')).rejects.toThrow(/slow call: no answer from the database after 10 ms/);
  });

  it('keeps the original rejection when the operation fails before the deadline', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50, 'fail')).rejects.toThrow('boom');
  });

  it('defaults to a deadline of 8 seconds per attempt', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(8000);
  });
});

describe('SupabaseStore deadline', () => {
  it('a call against a client that never answers rejects instead of hanging', async () => {
    const store = new SupabaseStore('https://example.invalid', 'service-role-key', deadClient, { timeoutMs: 20 });
    const started = Date.now();
    await expect(store.createGame({ id: GAME, roomCode: 'ABCDEF', roomName: 'Room', config })).rejects.toThrow(
      /upsert games: no answer from the database after 20 ms/,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('every method has a deadline, including reads', async () => {
    const store = new SupabaseStore('https://example.invalid', 'service-role-key', deadClient, { timeoutMs: 20 });
    await expect(store.appendCommand(GAME, cmd(1))).rejects.toThrow(/no answer from the database/);
    await expect(store.saveSnapshot(GAME, 1, '{}')).rejects.toThrow(/no answer from the database/);
    await expect(store.finishGame(GAME, { status: 'lost', endReason: null, round: 1, commandCount: 1 })).rejects.toThrow(/no answer/);
    await expect(store.loadActiveGames()).rejects.toThrow(/select games: no answer/);
  });

  it('a hung attempt is retried by the write queue, and writes behind it still land in order', async () => {
    const inner = new FakeSupabase();
    const hanging = new HangingFirst(inner, 'game_commands', 1);
    const store = new SupabaseStore('https://example.invalid', 'service-role-key', hanging, { timeoutMs: 20 });
    await store.createGame({ id: GAME, roomCode: 'ABCDEF', roomName: 'Room', config });

    const logged: string[] = [];
    const queue = new WriteQueue('room ABCDEF', { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 }, (level, msg, extra) => logged.push(`${level}: ${msg} ${String(extra ?? '')}`));
    queue.enqueue('command 1', () => store.appendCommand(GAME, cmd(1)));
    queue.enqueue('command 2', () => store.appendCommand(GAME, cmd(2)));
    queue.enqueue('command 3', () => store.appendCommand(GAME, cmd(3)));
    await queue.idle();

    expect(queue.failed).toBe(0);
    expect(queue.pending).toBe(0);
    expect(inner.tables.game_commands.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(logged.some((l) => /command 1 failed \(attempt 1\).*no answer from the database after 20 ms/.test(l))).toBe(true);
  });

  it('a write that never answers within the attempts is dropped and logged, and the queue is not stalled', async () => {
    const inner = new FakeSupabase();
    const hanging = new HangingFirst(inner, 'game_commands', 2);
    const store = new SupabaseStore('https://example.invalid', 'service-role-key', hanging, { timeoutMs: 10 });
    await store.createGame({ id: GAME, roomCode: 'ABCDEF', roomName: 'Room', config });

    const logged: string[] = [];
    const queue = new WriteQueue('room ABCDEF', { attempts: 2, baseDelayMs: 1, maxDelayMs: 1 }, (level, msg, extra) => logged.push(`${level}: ${msg} ${String(extra ?? '')}`));
    queue.enqueue('command 1', () => store.appendCommand(GAME, cmd(1)));
    queue.enqueue('command 2', () => store.appendCommand(GAME, cmd(2)));
    await queue.idle();

    expect(queue.failed).toBe(1);
    expect(logged.some((l) => /error: .*command 1 dropped after 2 attempts/.test(l))).toBe(true);
    expect(inner.tables.game_commands.map((r) => r.seq)).toEqual([2]);
  });
});
