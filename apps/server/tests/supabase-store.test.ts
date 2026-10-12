// SupabaseStore against FakeSupabase: idempotent retries, PostgREST paging, error propagation, append-only commands.
import { describe, expect, it } from 'vitest';
import { SupabaseStore } from '../src/supabase-store';
import { FakeSupabase } from './fake-supabase';
import type { GameConfig } from '../src/adapter';

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

const GAME = '11111111-2222-4333-8444-555555555555';
const player = (seat: number) => ({ seat, guestId: `g${seat}`, name: `p${seat}`, isHost: seat === 0, tokenHash: 'h'.repeat(64) });

function setup() {
  const db = new FakeSupabase();
  const store = new SupabaseStore('https://example.invalid', 'service-role-key', db);
  return { db, store };
}

describe('SupabaseStore writes are idempotent', () => {
  it('a retried createGame, addPlayers and appendCommand after a lost response leaves one row each', async () => {
    const { db, store } = setup();
    await store.createGame({ id: GAME, roomCode: 'ABCDEF', roomName: 'Room', config });
    await store.createGame({ id: GAME, roomCode: 'ABCDEF', roomName: 'Room', config });
    await store.addPlayers(GAME, [player(0), player(1)]);
    await store.addPlayers(GAME, [player(0), player(1)]);
    await store.appendCommand(GAME, { seq: 1, who: 0, pendingId: 1, pick: ['a'] });
    await store.appendCommand(GAME, { seq: 1, who: 0, pendingId: 1, pick: ['a'] });

    expect(db.count('games')).toBe(1);
    expect(db.count('game_players')).toBe(2);
    expect(db.count('game_commands')).toBe(1);
  });

  it('a re-sent command with the same seq is a no-op and does not overwrite the stored pick', async () => {
    const { db, store } = setup();
    await store.createGame({ id: GAME, roomCode: 'ABCDEF', roomName: 'Room', config });
    await store.appendCommand(GAME, { seq: 1, who: 0, pendingId: 1, pick: ['a'] });
    await store.appendCommand(GAME, { seq: 1, who: 0, pendingId: 1, pick: ['b'] });
    expect(db.tables.game_commands[0].pick).toEqual(['a']);
  });

  it('a snapshot upsert for the same command_seq overwrites the payload instead of failing', async () => {
    const { db, store } = setup();
    await store.createGame({ id: GAME, roomCode: 'ABCDEF', roomName: 'Room', config });
    await store.saveSnapshot(GAME, 4, 'first');
    await store.saveSnapshot(GAME, 4, 'second');
    expect(db.count('game_snapshots')).toBe(1);
    expect(db.tables.game_snapshots[0].state).toBe('second');
  });
});

describe('SupabaseStore errors', () => {
  it('a failed write rejects with the table and the database message, so the caller can retry', async () => {
    const { db, store } = setup();
    db.failNext(1, { table: 'game_commands', op: 'upsert', message: 'connection reset' });
    await expect(store.appendCommand(GAME, { seq: 1, who: 0, pendingId: 1, pick: ['a'] })).rejects.toThrow(
      'upsert game_commands: connection reset',
    );
    expect(db.count('game_commands')).toBe(0);
    await store.appendCommand(GAME, { seq: 1, who: 0, pendingId: 1, pick: ['a'] });
    expect(db.count('game_commands')).toBe(1);
  });

  it('a failed finishGame update rejects with the update message', async () => {
    const { db, store } = setup();
    await store.createGame({ id: GAME, roomCode: 'ABCDEF', roomName: 'Room', config });
    db.failNext(1, { table: 'games', op: 'update' });
    await expect(store.finishGame(GAME, { status: 'won', endReason: 'done', round: 3, commandCount: 9 })).rejects.toThrow('update games');
  });

  it('game_commands is append-only: an UPDATE is refused at the database layer', async () => {
    const { db, store } = setup();
    await store.createGame({ id: GAME, roomCode: 'ABCDEF', roomName: 'Room', config });
    await store.appendCommand(GAME, { seq: 1, who: 0, pendingId: 1, pick: ['a'] });
    const res = await db.from('game_commands').update({ pick: ['x'] }).eq('game_id', GAME);
    expect(res.error?.message).toMatch(/append-only/);
    expect(db.tables.game_commands[0].pick).toEqual(['a']);
  });
});

describe('SupabaseStore reads', () => {
  it('pages past PostgREST\'s 1000-row cap and returns every command in order', async () => {
    const { db, store } = setup();
    await store.createGame({ id: GAME, roomCode: 'ABCDEF', roomName: 'Room', config });
    const total = 2507;
    for (let seq = 1; seq <= total; seq += 500) {
      const rows = [];
      for (let s = seq; s < Math.min(total + 1, seq + 500); s++) {
        rows.push({ game_id: GAME, seq: s, seat: s % 2, pending_id: s, pick: ['a'] });
      }
      db.tables.game_commands.push(...rows);
    }
    const [game] = await store.loadActiveGames();
    expect(game.commands).toHaveLength(total);
    expect(game.commands[0].seq).toBe(1);
    expect(game.commands[total - 1].seq).toBe(total);
    expect(db.calls.filter((c) => c.table === 'game_commands' && c.op === 'select')).toHaveLength(3);
  });

  it('loads the latest snapshot, and skips finished games', async () => {
    const { db, store } = setup();
    await store.createGame({ id: GAME, roomCode: 'ABCDEF', roomName: 'Room', config });
    await store.saveSnapshot(GAME, 0, 'zero');
    await store.saveSnapshot(GAME, 5, 'five');
    await store.createGame({ id: 'finished-game', roomCode: 'GHJKMN', roomName: 'Done', config });
    await store.finishGame('finished-game', { status: 'lost', endReason: 'x', round: 1, commandCount: 0 });

    const games = await store.loadActiveGames();
    expect(games.map((g) => g.id)).toEqual([GAME]);
    expect(games[0].snapshot).toEqual({ seq: 5, payload: 'five' });
  });

  it('a read failure rejects instead of returning partial data', async () => {
    const { db, store } = setup();
    await store.createGame({ id: GAME, roomCode: 'ABCDEF', roomName: 'Room', config });
    db.failNext(1, { table: 'game_players', op: 'select' });
    await expect(store.loadActiveGames()).rejects.toThrow('select game_players');
  });
});
