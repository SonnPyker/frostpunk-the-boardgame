// In-memory stand-in for the subset of @supabase/supabase-js that SupabaseStore uses. It mirrors what matters for the
// server: primary-key conflicts (23505), ON CONFLICT DO NOTHING for ignoreDuplicates upserts, the append-only trigger on
// game_commands, PostgREST-style range paging, and injected outages for retry tests.
import type { SupabaseLike } from '../src/supabase-store';

type Row = Record<string, any>;
type Err = { message: string; code?: string };
type Result = { data: any; error: Err | null };
type Op = 'select' | 'insert' | 'upsert' | 'update';

const PRIMARY_KEYS: Record<string, string[]> = {
  games: ['id'],
  game_players: ['game_id', 'seat'],
  game_commands: ['game_id', 'seq'],
  game_snapshots: ['game_id', 'command_seq'],
};

interface Failure {
  table?: string;
  op?: Op;
  remaining: number;
  message: string;
}

export class FakeSupabase implements SupabaseLike {
  readonly tables: Record<string, Row[]> = { games: [], game_players: [], game_commands: [], game_snapshots: [] };
  /** Every operation attempted, including failed ones. */
  readonly calls: { table: string; op: Op }[] = [];
  private failures: Failure[] = [];

  /** The next `times` operations matching `table` / `op` fail with a simulated outage. */
  failNext(times: number, where: { table?: string; op?: Op; message?: string } = {}): void {
    this.failures.push({ table: where.table, op: where.op, remaining: times, message: where.message ?? 'simulated outage: connection reset' });
  }

  from(table: string): any {
    return new Query(this, table);
  }

  /** Row count helper for assertions. */
  count(table: string): number {
    return this.tables[table].length;
  }

  /** @internal */
  maybeFail(table: string, op: Op): Err | null {
    this.calls.push({ table, op });
    for (const f of this.failures) {
      if (f.remaining <= 0) continue;
      if (f.table !== undefined && f.table !== table) continue;
      if (f.op !== undefined && f.op !== op) continue;
      f.remaining--;
      return { message: f.message };
    }
    return null;
  }

  /** @internal */
  keyOf(table: string, row: Row, cols?: string[]): string {
    const names = cols ?? PRIMARY_KEYS[table];
    return names.map((c) => String(row[c])).join('|');
  }
}

class Query implements PromiseLike<Result> {
  private op: Op = 'select';
  private payload: any = null;
  private opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: [string, unknown][] = [];
  private orderCol: string | null = null;
  private ascending = true;
  private from_: number | null = null;
  private to_: number | null = null;
  private limitN: number | null = null;

  constructor(private readonly db: FakeSupabase, private readonly table: string) {}

  select(_columns?: string): this {
    return this;
  }

  insert(values: Row | Row[]): this {
    this.op = 'insert';
    this.payload = values;
    return this;
  }

  upsert(values: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.op = 'upsert';
    this.payload = values;
    this.opts = opts;
    return this;
  }

  update(values: Row): this {
    this.op = 'update';
    this.payload = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  order(column: string, opts: { ascending?: boolean } = {}): this {
    this.orderCol = column;
    this.ascending = opts.ascending !== false;
    return this;
  }

  range(from: number, to: number): this {
    this.from_ = from;
    this.to_ = to;
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  then<A = Result, B = never>(onfulfilled?: ((v: Result) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return Promise.resolve().then(() => this.exec()).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every(([c, v]) => String(row[c]) === String(v));
  }

  private exec(): Result {
    const failure = this.db.maybeFail(this.table, this.op);
    if (failure) return { data: null, error: failure };
    const rows = this.db.tables[this.table];
    const payloads: Row[] = Array.isArray(this.payload) ? this.payload : this.payload === null ? [] : [this.payload];

    switch (this.op) {
      case 'insert': {
        const cols = PRIMARY_KEYS[this.table];
        const keys = new Set(rows.map((r) => this.db.keyOf(this.table, r, cols)));
        for (const p of payloads) {
          if (keys.has(this.db.keyOf(this.table, p, cols))) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${this.table}_pkey"` } };
        }
        for (const p of payloads) rows.push(structuredClone(this.withDefaults(p)));
        return { data: null, error: null };
      }
      case 'upsert': {
        const cols = this.opts.onConflict ? this.opts.onConflict.split(',') : PRIMARY_KEYS[this.table];
        for (const p of payloads) {
          const key = this.db.keyOf(this.table, p, cols);
          const idx = rows.findIndex((r) => this.db.keyOf(this.table, r, cols) === key);
          if (idx >= 0) {
            if (this.opts.ignoreDuplicates) continue; // INSERT ... ON CONFLICT DO NOTHING
            if (this.table === 'game_commands') return { data: null, error: { message: 'table game_commands is append-only' } };
            rows[idx] = { ...rows[idx], ...structuredClone(p) };
          } else {
            rows.push(structuredClone(this.withDefaults(p)));
          }
        }
        return { data: null, error: null };
      }
      case 'update': {
        if (this.table === 'game_commands') return { data: null, error: { message: 'table game_commands is append-only' } };
        for (const r of rows) if (this.matches(r)) Object.assign(r, structuredClone(this.payload));
        return { data: null, error: null };
      }
      case 'select': {
        let out = rows.filter((r) => this.matches(r)).map((r) => structuredClone(r));
        if (this.orderCol) {
          const c = this.orderCol;
          out.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (this.ascending ? 1 : -1));
        }
        if (this.from_ !== null && this.to_ !== null) out = out.slice(this.from_, this.to_ + 1);
        if (this.limitN !== null) out = out.slice(0, this.limitN);
        return { data: out, error: null };
      }
    }
  }

  /** Column defaults the real table would fill in. */
  private withDefaults(p: Row): Row {
    if (this.table === 'games' && p.id === undefined) throw new Error('games.id is required (uuid default not emulated)');
    return { created_at: new Date().toISOString(), ...p };
  }
}
