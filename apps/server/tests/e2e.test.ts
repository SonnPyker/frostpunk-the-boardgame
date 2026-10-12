// Full co-op game over real sockets with the real rules engine (see e2e-scenario.ts for the checks).
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store';
import { SupabaseStore } from '../src/supabase-store';
import { runScenario } from './e2e-scenario';
import { FakeSupabase } from './fake-supabase';

describe('co-op game end to end (real engine, real sockets)', () => {
  it('plays to round 3 or the end, with a restart and a reconnect on the way (memory store)', async () => {
    const report = await runScenario({ store: new MemoryStore() });
    expect(report.round >= 3 || report.status !== 'playing').toBe(true);
    expect(report.decisions).toBeGreaterThan(0);
    expect(report.checks).toEqual(expect.arrayContaining([
      'lobby:wrong_status', 'lobby:not_host', 'lobby:not_ready', 'invalid:invalid_answer', 'stale:stale_decision',
    ]));
    if (report.decisions > 25) {
      expect(report.restarts).toBe(1);
      expect(report.checks).toContain('restart:restored');
    }
    expect(report.reconnects).toBe(report.decisions > 8 ? 1 : 0);
  }, 60_000);

  it('the same game runs through the Supabase store, with transient write outages that are retried', async () => {
    const db = new FakeSupabase();
    // Outages during the game: retried writes must land exactly once.
    db.failNext(2, { table: 'game_commands' });
    db.failNext(1, { table: 'game_snapshots' });
    const store = new SupabaseStore('http://fake.invalid', 'service-key', db);
    const report = await runScenario({ store, restartAfterDecisions: 12, reconnectAfterDecisions: 4 });
    expect(report.restarts).toBe(report.decisions > 12 ? 1 : 0);
    if (report.status === 'playing') expect(report.storedCommands).toBe(report.finalSeq);
    // One game row, one command row per accepted answer (no duplicates from the retries).
    expect(db.count('games')).toBe(1);
    expect(db.count('game_commands')).toBe(report.finalSeq);
  }, 60_000);
});
