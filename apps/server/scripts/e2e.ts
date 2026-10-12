// Runs the end-to-end scenario (tests/e2e-scenario.ts) against an in-process server and prints a report.
// Usage: npx tsx scripts/e2e.ts [--supabase]   (--supabase uses the in-memory Supabase fake with injected outages)
import { MemoryStore, type GameStore } from '../src/store';
import { SupabaseStore } from '../src/supabase-store';
import { runScenario } from '../tests/e2e-scenario';
import { FakeSupabase } from '../tests/fake-supabase';

async function main(): Promise<void> {
  const useSupabase = process.argv.includes('--supabase');
  let store: GameStore = new MemoryStore();
  if (useSupabase) {
    const db = new FakeSupabase();
    db.failNext(2, { table: 'game_commands' });
    store = new SupabaseStore('http://fake.invalid', 'service-key', db);
  }
  const started = Date.now();
  const report = await runScenario({ store, log: (lvl, msg) => { if (lvl !== 'info') console.log(`[${lvl}] ${msg}`); } });
  console.log(JSON.stringify({ store: store.kind, ...report, ms: Date.now() - started }, null, 2));
  console.log('e2e: PASS');
}

main().catch((e) => {
  console.error('e2e: FAIL', e);
  process.exit(1);
});
