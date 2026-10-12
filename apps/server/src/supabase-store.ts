// Supabase (Postgres) persistence. Uses the service-role key, so it bypasses RLS. Schema: supabase/migrations/0001_init.sql
//
// Every write is idempotent (the room layer retries failed writes): inserts are upserts with ignoreDuplicates on the
// table's primary key, so a retry after a lost response does not fail and does not duplicate rows.
//
// Every call has its own deadline (DEFAULT_TIMEOUT_MS per attempt). A call that gets no answer in time rejects, so the
// room's write queue treats it like any other failed attempt: it is retried, and given up after the last attempt. A hung
// database therefore cannot stall a room's save queue for longer than attempts x timeout.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameConfig } from './adapter';
import type {
  FinishPatch, GameStore, NewGameRecord, NewPlayerRecord, PersistedGame, StoredCommand,
} from './store';

const PAGE = 1000; // PostgREST returns at most 1000 rows per request by default
/** Longest a single database call may take before it counts as a failed attempt. */
export const DEFAULT_TIMEOUT_MS = 8000;

type Row = Record<string, any>;
type QueryResult = { data: any; error: { message: string } | null };

/** The subset of the Supabase client this store uses. Tests pass a fake that implements it. */
export type SupabaseLike = Pick<SupabaseClient, 'from'>;

export interface SupabaseStoreOptions {
  /** Deadline for one database call (one attempt). Default DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * Resolves or rejects with `p`, or rejects with a timeout error if `p` has not settled within `ms`. A late result of `p`
 * after the timeout is ignored (its rejection is still observed by the race, so it is not an unhandled rejection).
 */
export function withTimeout<T>(p: PromiseLike<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no answer from the database after ${ms} ms`)), ms);
  });
  return Promise.race([Promise.resolve(p), deadline]).finally(() => clearTimeout(timer));
}

export class SupabaseStore implements GameStore {
  readonly kind = 'supabase' as const;
  private readonly db: SupabaseLike;
  private readonly timeoutMs: number;

  constructor(url: string, serviceRoleKey: string, client?: SupabaseLike, options: SupabaseStoreOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.db =
      client ??
      createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
  }

  private static check<T = any>(res: QueryResult, what: string): T {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    return res.data as T;
  }

  /** Runs one database call under the per-attempt deadline and returns its data, or throws. */
  private async run<T = any>(build: () => PromiseLike<QueryResult>, what: string): Promise<T> {
    const res = await withTimeout(build(), this.timeoutMs, what);
    return SupabaseStore.check<T>(res, what);
  }

  async createGame(rec: NewGameRecord): Promise<void> {
    const c: GameConfig = rec.config;
    await this.run(
      () =>
        this.db.from('games').upsert(
          {
            id: rec.id,
            room_code: rec.roomCode,
            room_name: rec.roomName,
            status: 'playing',
            scenario: c.scenario,
            society: c.society,
            difficulty: c.difficulty,
            mode: c.mode,
            extra_pack: c.extraPack,
            seed: c.seed,
            config: c,
          },
          { onConflict: 'id', ignoreDuplicates: true },
        ) as any,
      'upsert games',
    );
  }

  async addPlayers(gameId: string, players: NewPlayerRecord[]): Promise<void> {
    if (players.length === 0) return;
    await this.run(
      () =>
        this.db.from('game_players').upsert(
          players.map((p) => ({
            game_id: gameId,
            seat: p.seat,
            guest_id: p.guestId,
            display_name: p.name,
            is_host: p.isHost,
            token_hash: p.tokenHash,
          })),
          { onConflict: 'game_id,seat', ignoreDuplicates: true },
        ) as any,
      'upsert game_players',
    );
  }

  /**
   * Appends one command. `ignoreDuplicates` makes a retry of an already stored row a no-op, and it compiles to
   * INSERT ... ON CONFLICT DO NOTHING, which the append-only trigger does not see as an UPDATE.
   */
  async appendCommand(gameId: string, cmd: StoredCommand): Promise<void> {
    await this.run(
      () =>
        this.db.from('game_commands').upsert(
          {
            game_id: gameId,
            seq: cmd.seq,
            seat: cmd.who,
            pending_id: cmd.pendingId,
            pick: cmd.pick,
          },
          { onConflict: 'game_id,seq', ignoreDuplicates: true },
        ) as any,
      'upsert game_commands',
    );
  }

  async saveSnapshot(gameId: string, seq: number, payload: string): Promise<void> {
    await this.run(
      () =>
        this.db.from('game_snapshots').upsert(
          { game_id: gameId, command_seq: seq, state: payload },
          { onConflict: 'game_id,command_seq' },
        ) as any,
      'upsert game_snapshots',
    );
  }

  async finishGame(gameId: string, patch: FinishPatch): Promise<void> {
    const now = new Date().toISOString();
    await this.run(
      () =>
        this.db
          .from('games')
          .update({
            status: patch.status,
            end_reason: patch.endReason,
            round: patch.round,
            command_count: patch.commandCount,
            finished_at: now,
            updated_at: now,
          })
          .eq('id', gameId) as any,
      'update games',
    );
  }

  /** Reads every row of a query in pages of PAGE (PostgREST caps responses at 1000 rows). */
  private async fetchAll(build: (from: number, to: number) => PromiseLike<QueryResult>, what: string): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows: Row[] = (await this.run<Row[] | null>(() => build(from, from + PAGE - 1), what)) ?? [];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async loadActiveGames(): Promise<PersistedGame[]> {
    const games = await this.fetchAll(
      (from, to) => this.db.from('games').select('id, room_code, room_name, config').eq('status', 'playing').order('created_at').range(from, to) as any,
      'select games',
    );
    const out: PersistedGame[] = [];
    for (const g of games) out.push(await this.hydrate(g));
    return out;
  }

  /** Loads one row's players, command log and latest snapshot. */
  private async hydrate(g: Row): Promise<PersistedGame> {
    const id = String(g.id);
    const players = await this.fetchAll(
      (from, to) => this.db.from('game_players').select('seat, guest_id, display_name, is_host, token_hash').eq('game_id', id).order('seat').range(from, to) as any,
      'select game_players',
    );
    const commands = await this.fetchAll(
      (from, to) => this.db.from('game_commands').select('seq, seat, pending_id, pick').eq('game_id', id).order('seq').range(from, to) as any,
      'select game_commands',
    );
    const snaps = await this.run<Row[] | null>(
      () =>
        this.db
          .from('game_snapshots')
          .select('command_seq, state')
          .eq('game_id', id)
          .order('command_seq', { ascending: false })
          .limit(1) as any,
      'select game_snapshots',
    ) ?? [];
    return {
      id,
      roomCode: g.room_code,
      roomName: g.room_name ?? g.room_code,
      config: g.config as GameConfig,
      players: players.map((p) => ({
        seat: p.seat,
        guestId: p.guest_id,
        name: p.display_name,
        isHost: p.is_host,
        tokenHash: p.token_hash,
      })),
      commands: commands.map((c) => ({ seq: c.seq, who: c.seat, pendingId: c.pending_id, pick: c.pick as string[] })),
      snapshot: snaps[0] ? { seq: snaps[0].command_seq, payload: snaps[0].state } : null,
    };
  }
}
