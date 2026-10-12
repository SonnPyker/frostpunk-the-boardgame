// Room / lobby / answer-routing logic. Transport-agnostic: sessions are abstract `send` / `close` handles and the
// engine and store are injected. The server is authoritative: every game change goes through engine.answer and the
// resulting per-seat engine.view is pushed to each attached seat.
//
// Persistence: every write for a game goes through that game's WriteQueue (ordered, retried with backoff, dropped only
// after the last attempt). Game ids are generated here, so no write waits for another one to return an id.
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  ClientMessage, ErrorCode, LobbySettings, PendingSummary, PlayerView, RoomStatus, RoomView, ServerMessage,
} from '../../../packages/engine/src/protocol';
import type { EngineAdapter, EngineState, GameConfig } from './adapter';
import type { FinishPatch, GameStore, NewPlayerRecord, PersistedGame, StoredCommand } from './store';
import { WriteQueue, type RetryPolicy } from './persist';
import { cleanName, normalizeCode } from './validate';
import { errorMessage } from './util';

/** One WebSocket connection as seen by the room logic. */
export interface Session {
  readonly id: string;
  guestId: string;
  name: string;
  send(msg: ServerMessage): void;
  close(code: number, reason: string): void;
  room: string | null;
  seat: number | null;
}

export class ProtocolError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
  }
}

export type LogFn = (level: 'info' | 'warn' | 'error', msg: string, extra?: unknown) => void;

/** Id generators (overridable in tests). Defaults use crypto. */
export interface IdGenerators {
  roomCode(): string;
  token(): string;
  guestId(): string;
  seed(): number;
  /** Database id of a started game (UUID). */
  gameId(): string;
}

export interface RoomManagerDeps {
  engine: EngineAdapter;
  store: GameStore;
  /** Write a snapshot every N applied commands. */
  snapshotEvery: number;
  /** Lobby seats without a socket are removed after this long. */
  lobbyGraceMs: number;
  /** Finished rooms are dropped from memory after this long (their data is already persisted). */
  endedRoomTtlMs: number;
  /** Rooms held in memory (lobbies, live and finished games). Creating a room beyond this is refused. */
  maxRooms: number;
  /** A live game with no seat attached for this long is marked 'abandoned' and unloaded. */
  abandonAfterMs: number;
  /** Retry policy for persistence writes. */
  retry: RetryPolicy;
  /** Replaces setTimeout in the retry loop (tests). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: LogFn;
  ids?: Partial<IdGenerators>;
}

interface Seat {
  guestId: string;
  name: string;
  tokenHash: string;
  ready: boolean;
  attached: Session | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

interface Room {
  code: string;
  status: RoomStatus;
  settings: LobbySettings;
  /** Dense list. Index == seat == engine player index. Seat 0 is the host. */
  seats: Seat[];
  state: EngineState | null;
  config: GameConfig | null;
  /** Accepted answers, in order. Used to rebuild the engine state after a failure. */
  commands: StoredCommand[];
  /** Number of accepted answers. Equals the last command seq (kept apart from `commands`, which may have holes after a restore). */
  seq: number;
  createdAt: number;
  endedAt: number | null;
  lastActiveAt: number;
  /** Database id, set when the game starts. */
  dbId: string | null;
  /** Ordered, retried writes for this game. */
  persist: WriteQueue;
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, no O
const ROOM_CODE_LEN = 6;
/** Keys of the engine state that must never reach a client (the engine's view omits them too; this is a second line).
 * `futureLaws` is not listed: the Future Law display is public (rulebook p37), the engine view sends its Law card ids. */
const HIDDEN_STATE_KEYS = ['rng', 'stack', 'decks', 'lawConsequenceBank'] as const;

export const DEFAULT_SETTINGS: LobbySettings = {
  roomName: 'Frostpunk table',
  seats: 4,
  scenario: 'crater',
  society: 1,
  difficulty: 'normal',
  extraPack: false,
  advisors: [],
  seed: 1,
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function tokenMatches(seat: Seat, token: string): boolean {
  const a = Buffer.from(seat.tokenHash, 'hex');
  const b = Buffer.from(hashToken(token), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Returns a shallow copy of an engine view without the hidden keys. Non-objects pass through. */
export function redactView(view: unknown): unknown {
  if (typeof view !== 'object' || view === null || Array.isArray(view)) return view;
  const copy: Record<string, unknown> = { ...(view as Record<string, unknown>) };
  for (const k of HIDDEN_STATE_KEYS) delete copy[k];
  return copy;
}

const defaultIds: IdGenerators = {
  roomCode: () => Array.from({ length: ROOM_CODE_LEN }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join(''),
  token: () => randomBytes(24).toString('base64url'),
  guestId: () => randomBytes(12).toString('base64url'),
  seed: () => randomInt(0, 0x100000000),
  gameId: () => randomUUID(),
};

const noopLog: LogFn = () => {};

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Set<Session>();
  /** Every write queue still in use. Queues of removed rooms stay here until their writes finish (shutdown flush). */
  private readonly queues = new Set<WriteQueue>();
  private readonly now: () => number;
  private readonly log: LogFn;
  private readonly ids: IdGenerators;
  /** Failed writes of queues that were already pruned. */
  private prunedFailures = 0;

  constructor(private readonly deps: RoomManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? noopLog;
    this.ids = { ...defaultIds, ...deps.ids };
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  connect(s: Session): void {
    this.sessions.add(s);
  }

  disconnect(s: Session): void {
    this.sessions.delete(s);
    this.detach(s);
  }

  get connectionCount(): number {
    return this.sessions.size;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** Writes waiting in the persistence queues, and writes given up after all retries. */
  persistenceStats(): { pending: number; failed: number } {
    let pending = 0;
    let failed = this.prunedFailures;
    for (const q of this.queues) {
      pending += q.pending;
      failed += q.failed;
    }
    return { pending, failed };
  }

  /** Routes one validated client message. Protocol errors are sent back to the client; they never throw. */
  handle(s: Session, msg: ClientMessage): void {
    try {
      this.dispatch(s, msg);
    } catch (e) {
      if (e instanceof ProtocolError) {
        s.send({ t: 'error', code: e.code, message: e.message });
      } else {
        this.log('error', 'handler failed', errorMessage(e));
        s.send({ t: 'error', code: 'internal', message: 'internal server error' });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Message dispatch
  // -------------------------------------------------------------------------

  private dispatch(s: Session, msg: ClientMessage): void {
    switch (msg.t) {
      case 'hello': {
        if (s.room === null) {
          if (msg.guestId !== undefined) s.guestId = msg.guestId;
          if (msg.name !== undefined) s.name = msg.name;
        }
        s.send({ t: 'welcome', guestId: s.guestId, protocol: 1 });
        return;
      }
      case 'create':
        return this.create(s, msg.name, msg.settings);
      case 'join':
        return this.join(s, msg.code, msg.name);
      case 'resume':
        return this.resume(s, msg.code, msg.token);
      case 'settings':
        return this.updateSettings(s, msg.settings);
      case 'ready':
        return this.setReady(s, msg.ready);
      case 'start':
        return this.start(s);
      case 'answer':
        return this.answer(s, msg.pendingId, msg.pick);
      case 'chat':
        return this.chat(s, msg.text);
      case 'leave':
        return this.leave(s);
      case 'ping':
        s.send(msg.ts === undefined ? { t: 'pong' } : { t: 'pong', ts: msg.ts });
        return;
      default: {
        const never: never = msg;
        throw new Error('unhandled client message ' + JSON.stringify(never));
      }
    }
  }

  private create(s: Session, name: string, patch?: Partial<LobbySettings>): void {
    if (s.room !== null) throw new ProtocolError('already_in_room', 'leave your current room first');
    if (this.rooms.size >= this.deps.maxRooms) {
      throw new ProtocolError('internal', 'the server has reached its room limit; try again later');
    }
    const code = this.newCode();
    const settings: LobbySettings = { ...DEFAULT_SETTINGS, seed: this.ids.seed(), ...patch, advisors: [...(patch?.advisors ?? [])] };
    const seat: Seat = {
      guestId: s.guestId,
      name: cleanName(name),
      tokenHash: '',
      ready: true,
      attached: s,
      graceTimer: null,
    };
    const token = this.ids.token();
    seat.tokenHash = hashToken(token);
    const room = this.newRoom(code, settings, [seat], 'lobby');
    this.rooms.set(code, room);
    s.name = seat.name;
    s.room = code;
    s.seat = 0;
    s.send({ t: 'joined', code, seat: 0, token });
    this.broadcastRoom(room);
  }

  private join(s: Session, rawCode: string, name: string): void {
    if (s.room !== null) throw new ProtocolError('already_in_room', 'leave your current room first');
    const room = this.findRoom(rawCode);
    if (room.status !== 'lobby') throw new ProtocolError('wrong_status', 'the game has already started; use resume with your token');
    if (room.seats.length >= room.settings.seats) throw new ProtocolError('room_full', 'this room has no free seats');
    const token = this.ids.token();
    const seat: Seat = {
      guestId: s.guestId,
      name: cleanName(name),
      tokenHash: hashToken(token),
      ready: false,
      attached: s,
      graceTimer: null,
    };
    room.seats.push(seat);
    s.name = seat.name;
    s.room = room.code;
    s.seat = room.seats.length - 1;
    s.send({ t: 'joined', code: room.code, seat: s.seat, token });
    this.broadcastRoom(room);
  }

  private resume(s: Session, rawCode: string, token: string): void {
    this.detach(s); // a socket can only hold one seat; drop any previous attachment silently
    const room = this.findRoom(rawCode);
    const idx = room.seats.findIndex((st) => tokenMatches(st, token));
    if (idx < 0) throw new ProtocolError('bad_token', 'unknown seat token for this room');
    const seat = room.seats[idx];
    if (seat.attached && seat.attached !== s) {
      const old = seat.attached;
      old.room = null;
      old.seat = null;
      old.close(4001, 'seat resumed from another connection');
    }
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    seat.graceTimer = null;
    seat.attached = s;
    room.lastActiveAt = this.now();
    s.room = room.code;
    s.seat = idx;
    s.guestId = seat.guestId;
    s.name = seat.name;
    s.send({ t: 'resumed', code: room.code, seat: idx });
    this.broadcastRoom(room);
    if (room.state) this.sendState(room, s, idx);
  }

  private updateSettings(s: Session, patch: Partial<LobbySettings>): void {
    const room = this.requireRoom(s);
    this.requireHost(s);
    this.requireStatus(room, 'lobby');
    if (patch.seats !== undefined && patch.seats < room.seats.length) {
      throw new ProtocolError('bad_request', `cannot go below ${room.seats.length} seated players`);
    }
    room.settings = { ...room.settings, ...patch, advisors: patch.advisors ? [...patch.advisors] : room.settings.advisors };
    this.broadcastRoom(room);
  }

  private setReady(s: Session, ready: boolean): void {
    const room = this.requireRoom(s);
    this.requireStatus(room, 'lobby');
    const seat = this.requireSeat(room, s);
    seat.ready = ready;
    this.broadcastRoom(room);
  }

  private start(s: Session): void {
    const room = this.requireRoom(s);
    this.requireHost(s);
    this.requireStatus(room, 'lobby');
    if (room.seats.some((st) => !st.attached || !st.ready)) {
      throw new ProtocolError('not_ready', 'every seat must be connected and ready before the game starts');
    }
    this.startGame(room);
    this.broadcastState(room);
    if (room.status === 'ended') this.announceEnd(room);
    this.broadcastRoom(room);
  }

  private answer(s: Session, pendingId: number, pick: string[]): void {
    const room = this.requireRoom(s);
    const seatIdx = this.requireSeatIndex(s);
    if (room.status === 'lobby') throw new ProtocolError('wrong_status', 'the game has not started');
    if (room.status === 'ended' || !room.state || room.dbId === null) throw new ProtocolError('game_over', 'the game is over');
    const state = room.state;
    const p = state.pending;
    if (!p) throw new ProtocolError('stale_decision', 'no decision is open');
    if (p.id !== pendingId) throw new ProtocolError('stale_decision', `decision ${pendingId} is no longer open`);
    if (p.who >= 0 && p.who !== seatIdx) throw new ProtocolError('not_your_decision', `seat ${p.who} must answer this decision`);

    let result: { ok: boolean; error?: string };
    try {
      result = this.deps.engine.answer(state, seatIdx, pendingId, pick);
    } catch (e) {
      this.log('error', `engine.answer threw in room ${room.code}`, errorMessage(e));
      this.recover(room);
      throw new ProtocolError('internal', 'the engine failed on this answer; game state was restored');
    }
    if (!result.ok) {
      // The engine validates before it mutates, except when a rule fails while the decision is being resolved: then
      // `pending` is already cleared and the state is unusable. Rebuild it from the log (the rejected answer is not in it).
      if (state.status === 'playing' && state.pending === null) {
        this.log('error', `engine left room ${room.code} without a decision after a rejected answer; rebuilding`, result.error);
        this.recover(room);
      }
      throw new ProtocolError('invalid_answer', result.error ?? 'answer rejected');
    }

    const seq = room.seq + 1;
    const cmd: StoredCommand = { seq, who: seatIdx, pendingId, pick: pick.slice() };
    room.commands.push(cmd);
    room.seq = seq;
    room.lastActiveAt = this.now();
    const dbId = room.dbId;
    room.persist.enqueue(`command ${seq}`, () => this.deps.store.appendCommand(dbId, cmd));
    if (seq % this.deps.snapshotEvery === 0) this.snapshot(room);

    const finished = state.status !== 'playing';
    if (finished) this.markEnded(room);
    this.broadcastState(room);
    if (finished) this.announceEnd(room);
  }

  private chat(s: Session, text: string): void {
    const room = this.requireRoom(s);
    const seatIdx = this.requireSeatIndex(s);
    const seat = room.seats[seatIdx];
    const payload = { t: 'chat' as const, code: room.code, from: { seat: seatIdx, name: seat.name }, text, ts: this.now() };
    for (const st of room.seats) st.attached?.send(payload);
  }

  private leave(s: Session): void {
    const room = this.requireRoom(s);
    const idx = this.requireSeatIndex(s);
    const code = room.code;
    if (room.status === 'lobby') {
      const seat = room.seats[idx];
      if (seat.graceTimer) clearTimeout(seat.graceTimer);
      seat.attached = null;
      this.removeSeat(room, idx);
    } else {
      room.seats[idx].attached = null; // seat is kept so the player can resume later with the token
      room.lastActiveAt = this.now();
      this.broadcastRoom(room);
    }
    s.room = null;
    s.seat = null;
    s.send({ t: 'left', code });
  }

  // -------------------------------------------------------------------------
  // Game lifecycle
  // -------------------------------------------------------------------------

  private newRoom(code: string, settings: LobbySettings, seats: Seat[], status: RoomStatus): Room {
    const now = this.now();
    const persist = new WriteQueue(`room ${code}`, this.deps.retry, this.log, this.deps.sleep);
    this.queues.add(persist);
    return {
      code,
      status,
      settings,
      seats,
      state: null,
      config: null,
      commands: [],
      seq: 0,
      createdAt: now,
      endedAt: null,
      lastActiveAt: now,
      dbId: null,
      persist,
    };
  }

  private startGame(room: Room): void {
    const st = room.settings;
    const config: GameConfig = {
      scenario: st.scenario,
      society: st.society,
      difficulty: st.difficulty,
      mode: room.seats.length > 1 ? 'coop' : 'solo',
      players: room.seats.map((seat) => ({ name: seat.name, id: seat.guestId })),
      seed: st.seed,
      extraPack: st.extraPack,
      advisors: [...st.advisors],
    };
    // A table the rules do not allow (e.g. fewer Advisors than players) is the host's to fix: tell them the rule.
    try {
      this.deps.engine.validateConfig(config);
    } catch (e) {
      throw new ProtocolError('bad_request', errorMessage(e));
    }
    let state: EngineState;
    try {
      state = this.deps.engine.createGame(config);
    } catch (e) {
      this.log('error', `createGame failed for room ${room.code}`, errorMessage(e));
      throw new ProtocolError('internal', 'could not create the game');
    }
    const initial = this.deps.engine.serialize(state);
    room.config = config;
    room.state = state;
    room.commands = [];
    room.seq = 0;
    room.status = 'playing';
    room.endedAt = null;
    room.lastActiveAt = this.now();
    for (const seat of room.seats) seat.ready = true;

    const dbId = this.ids.gameId();
    room.dbId = dbId;
    const players: NewPlayerRecord[] = room.seats.map((seat, i) => ({
      seat: i,
      guestId: seat.guestId,
      name: seat.name,
      isHost: i === 0,
      tokenHash: seat.tokenHash,
    }));
    const roomName = room.settings.roomName;
    room.persist.enqueue('create game', () => this.deps.store.createGame({ id: dbId, roomCode: room.code, roomName, config }));
    room.persist.enqueue('add players', () => this.deps.store.addPlayers(dbId, players));
    room.persist.enqueue('snapshot 0', () => this.deps.store.saveSnapshot(dbId, 0, initial));

    if (state.status !== 'playing') this.markEnded(room);
  }

  private markEnded(room: Room): void {
    room.status = 'ended';
    room.endedAt = this.now();
    if (room.seq % this.deps.snapshotEvery !== 0) this.snapshot(room);
    this.finish(room);
    this.log('info', `room ${room.code} ended: ${room.state?.status ?? '?'}`, room.state?.endReason ?? null);
  }

  /** Queues the final status row for a room that has ended, or has been abandoned when `patch` is given. */
  private finish(room: Room, patch?: FinishPatch): void {
    if (room.dbId === null) return;
    const state = room.state;
    const final: FinishPatch = patch ?? {
      status: state?.status === 'won' ? 'won' : 'lost',
      endReason: state?.endReason ?? null,
      round: state?.round ?? null,
      commandCount: room.seq,
    };
    const dbId = room.dbId;
    room.persist.enqueue('finish game', () => this.deps.store.finishGame(dbId, final));
  }

  private snapshot(room: Room): void {
    if (!room.state || room.dbId === null) return;
    const seq = room.seq;
    const dbId = room.dbId;
    let payload: string;
    try {
      payload = this.deps.engine.serialize(room.state);
    } catch (e) {
      this.log('error', `serialize failed for ${room.code}`, errorMessage(e));
      return;
    }
    room.persist.enqueue(`snapshot ${seq}`, () => this.deps.store.saveSnapshot(dbId, seq, payload));
  }

  /** Rebuilds the in-memory state from the accepted command log, then tells everybody the result. */
  private recover(room: Room): void {
    this.restoreFromLog(room);
    this.broadcastState(room);
    if (room.status === 'ended') this.announceEnd(room);
  }

  private restoreFromLog(room: Room): void {
    try {
      room.state = this.deps.engine.replay(room.config!, room.commands.map(toCommand));
    } catch (e) {
      this.log('error', `could not rebuild room ${room.code}; ending it`, errorMessage(e));
      room.state = { ...room.state!, status: 'lost', endReason: 'internal error', pending: null };
      this.markEnded(room);
    }
  }

  // -------------------------------------------------------------------------
  // Restore, housekeeping, shutdown
  // -------------------------------------------------------------------------

  /** Loads unfinished games from the store: latest snapshot + command tail, or a full replay. Returns the count. */
  async restore(): Promise<number> {
    const games = await this.deps.store.loadActiveGames();
    let restored = 0;
    for (const g of games) {
      try {
        const room = this.rebuildPersisted(g);
        if (this.rooms.has(room.code)) {
          this.log('warn', `skipping persisted game with duplicate room code ${room.code}`);
          this.queues.delete(room.persist);
          continue;
        }
        this.rooms.set(room.code, room);
        restored++;
        // The row still says 'playing' if the final write was lost before the restart: write it again.
        if (room.status === 'ended') this.finish(room);
      } catch (e) {
        this.log('error', `could not restore game ${g.id} (${g.roomCode})`, errorMessage(e));
      }
    }
    return restored;
  }

  private rebuildPersisted(g: PersistedGame): Room {
    const commands = g.commands.slice().sort((a, b) => a.seq - b.seq);
    let state: EngineState | null = null;
    let seq = 0;

    // Fast path: the latest snapshot plus the contiguous tail after it. Commands before the snapshot are not needed,
    // so a hole in the log before the snapshot does not block the restore.
    const snap = g.snapshot;
    if (snap) {
      try {
        const tail = commands.filter((c) => c.seq > snap.seq);
        tail.forEach((c, i) => {
          if (c.seq !== snap.seq + i + 1) throw new Error(`command log has a gap after snapshot ${snap.seq}`);
        });
        state = this.deps.engine.deserialize(snap.payload);
        for (const c of tail) {
          const r = this.deps.engine.answer(state, c.who, c.pendingId, c.pick);
          if (!r.ok) throw new Error(`command ${c.seq} rejected on restore: ${r.error}`);
        }
        seq = tail.length ? tail[tail.length - 1].seq : snap.seq;
      } catch (e) {
        this.log('warn', `snapshot restore failed for ${g.roomCode}; replaying the full log`, errorMessage(e));
        state = null;
      }
    }
    if (!state) {
      commands.forEach((c, i) => {
        if (c.seq !== i + 1) throw new Error(`command log has a gap at seq ${i + 1}`);
      });
      state = this.deps.engine.replay(g.config, commands.map(toCommand));
      seq = commands.length;
    }

    const players = g.players.slice().sort((a, b) => a.seat - b.seat);
    const seats: Seat[] = players.map((p) => ({
      guestId: p.guestId,
      name: p.name,
      tokenHash: p.tokenHash,
      ready: true,
      attached: null,
      graceTimer: null,
    }));
    const c = g.config;
    const settings: LobbySettings = {
      roomName: g.roomName,
      seats: Math.min(4, Math.max(1, seats.length)) as 1 | 2 | 3 | 4,
      scenario: c.scenario,
      society: c.society,
      difficulty: c.difficulty,
      extraPack: c.extraPack,
      advisors: [...(c.advisors ?? [])],
      seed: c.seed,
    };
    const room = this.newRoom(g.roomCode, settings, seats, state.status === 'playing' ? 'playing' : 'ended');
    room.state = state;
    room.config = c;
    room.commands = commands.filter((cmd) => cmd.seq <= seq);
    room.seq = seq;
    room.dbId = g.id;
    if (room.status === 'ended') room.endedAt = this.now();
    return room;
  }

  /**
   * Housekeeping, run every minute:
   *  - finished rooms are dropped from memory after endedRoomTtlMs (their data is already persisted);
   *  - a live game with no seat attached for abandonAfterMs is marked 'abandoned' and unloaded;
   *  - persistence queues that are empty and no longer referenced are forgotten.
   * Returns how many rooms were removed.
   */
  sweep(): number {
    const now = this.now();
    const cutoff = now - this.deps.endedRoomTtlMs;
    let n = 0;
    for (const [code, room] of this.rooms) {
      if (room.status === 'ended' && room.endedAt !== null && room.endedAt < cutoff) {
        this.dropRoom(code, room);
        n++;
      } else if (room.status === 'playing' && !room.seats.some((st) => st.attached) && now - room.lastActiveAt >= this.deps.abandonAfterMs) {
        this.log('info', `room ${code} abandoned: no player connected for ${Math.round((now - room.lastActiveAt) / 60_000)} min`);
        room.status = 'ended';
        room.endedAt = now;
        this.finish(room, {
          status: 'abandoned',
          endReason: 'no player connected',
          round: room.state?.round ?? null,
          commandCount: room.seq,
        });
        this.dropRoom(code, room);
        n++;
      }
    }
    for (const q of [...this.queues]) {
      if (q.pending === 0 && !this.isInUse(q)) {
        this.prunedFailures += q.failed;
        this.queues.delete(q);
      }
    }
    return n;
  }

  private dropRoom(code: string, room: Room): void {
    for (const seat of room.seats) {
      if (seat.graceTimer) clearTimeout(seat.graceTimer);
      seat.graceTimer = null;
    }
    this.rooms.delete(code);
  }

  private isInUse(q: WriteQueue): boolean {
    for (const room of this.rooms.values()) if (room.persist === q) return true;
    return false;
  }

  /** Resolves once every queued persistence write has finished or been given up (used during graceful shutdown). */
  async flush(): Promise<void> {
    await Promise.all([...this.queues].map((q) => q.idle()));
  }

  notifyShutdown(reconnectInMs: number): void {
    for (const s of this.sessions) s.send({ t: 'shutdown', reconnectInMs });
  }

  /** Clears grace timers and closes every socket. */
  dispose(code = 1001, reason = 'server shutting down'): void {
    for (const room of this.rooms.values()) {
      for (const seat of room.seats) {
        if (seat.graceTimer) clearTimeout(seat.graceTimer);
        seat.graceTimer = null;
      }
    }
    for (const s of [...this.sessions]) {
      try {
        s.close(code, reason);
      } catch {
        /* socket already gone */
      }
    }
    this.sessions.clear();
  }

  /** Public read model for the HTTP layer: lobbies that are still open. Contains no tokens or guest ids. */
  listOpenRooms(): {
    code: string;
    roomName: string;
    scenario: LobbySettings['scenario'];
    society: number;
    difficulty: LobbySettings['difficulty'];
    seated: number;
    maxSeats: number;
    host: string | null;
    createdAt: number;
  }[] {
    const out = [];
    for (const room of this.rooms.values()) {
      if (room.status !== 'lobby') continue;
      out.push({
        code: room.code,
        roomName: room.settings.roomName,
        scenario: room.settings.scenario,
        society: room.settings.society,
        difficulty: room.settings.difficulty,
        seated: room.seats.length,
        maxSeats: room.settings.seats,
        host: room.seats[0]?.name ?? null,
        createdAt: room.createdAt,
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Read-only room view, for tests and diagnostics. */
  describeRoom(code: string): RoomView | null {
    const room = this.rooms.get(code);
    return room ? this.roomView(room) : null;
  }

  /**
   * Diagnostics: the SHA-256 of the engine's serialised state for a room in memory, with its sequence number. Two
   * servers that hold the same game return the same hash. Null when the room is not in memory or has no game yet.
   */
  stateHash(code: string): { seq: number; sha256: string } | null {
    const room = this.rooms.get(code);
    if (!room?.state) return null;
    const json = this.deps.engine.serialize(room.state);
    return { seq: room.seq, sha256: createHash('sha256').update(json).digest('hex') };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private newCode(): string {
    for (let i = 0; i < 100; i++) {
      const code = this.ids.roomCode();
      if (!this.rooms.has(code)) return code;
    }
    throw new ProtocolError('internal', 'could not allocate a room code');
  }

  private findRoom(raw: string): Room {
    const code = normalizeCode(raw);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) throw new ProtocolError('room_not_found', 'no room with that code');
    return room;
  }

  private requireRoom(s: Session): Room {
    if (s.room === null) throw new ProtocolError('not_in_room', 'join or create a room first');
    const room = this.rooms.get(s.room);
    if (!room) {
      s.room = null;
      s.seat = null;
      throw new ProtocolError('not_in_room', 'that room no longer exists');
    }
    return room;
  }

  private requireSeatIndex(s: Session): number {
    if (s.seat === null) throw new ProtocolError('not_in_room', 'join or create a room first');
    return s.seat;
  }

  private requireSeat(room: Room, s: Session): Seat {
    return room.seats[this.requireSeatIndex(s)];
  }

  private requireHost(s: Session): void {
    if (this.requireSeatIndex(s) !== 0) throw new ProtocolError('not_host', 'only the host can do that');
  }

  private requireStatus(room: Room, status: RoomStatus): void {
    if (room.status !== status) throw new ProtocolError('wrong_status', `room is ${room.status}, expected ${status}`);
  }

  /** Detaches a session from its seat. In the lobby the seat is kept for a grace period, then removed. */
  private detach(s: Session): void {
    if (s.room === null) return;
    const room = this.rooms.get(s.room);
    s.room = null;
    s.seat = null;
    if (!room) return;
    const seat = room.seats.find((st) => st.attached === s);
    if (!seat) return;
    seat.attached = null;
    room.lastActiveAt = this.now();
    if (room.status === 'lobby') {
      if (seat.graceTimer) clearTimeout(seat.graceTimer);
      seat.graceTimer = setTimeout(() => {
        seat.graceTimer = null;
        if (this.rooms.get(room.code) !== room || seat.attached || room.status !== 'lobby') return;
        const idx = room.seats.indexOf(seat);
        if (idx >= 0) this.removeSeat(room, idx);
      }, this.deps.lobbyGraceMs);
    }
    this.broadcastRoom(room);
  }

  /** Removes a lobby seat, keeps seat indices dense (host is always seat 0) and drops empty rooms. */
  private removeSeat(room: Room, idx: number): void {
    room.seats.splice(idx, 1);
    room.seats.forEach((st, i) => {
      if (st.attached) st.attached.seat = i;
    });
    if (room.seats.length === 0) {
      this.rooms.delete(room.code);
      return;
    }
    this.broadcastRoom(room);
  }

  private roomView(room: Room): RoomView {
    const players: PlayerView[] = room.seats.map((st, i) => ({
      seat: i,
      guestId: st.guestId,
      name: st.name,
      host: i === 0,
      ready: st.ready,
      connected: st.attached !== null,
    }));
    return {
      code: room.code,
      status: room.status,
      settings: { ...room.settings, advisors: [...room.settings.advisors] },
      players,
      seq: room.seq,
    };
  }

  private broadcastRoom(room: Room): void {
    const msg: ServerMessage = { t: 'room', room: this.roomView(room) };
    for (const st of room.seats) st.attached?.send(msg);
  }

  private broadcastState(room: Room): void {
    if (!room.state) return;
    room.seats.forEach((st, i) => {
      if (st.attached) this.sendState(room, st.attached, i);
    });
  }

  private sendState(room: Room, s: Session, seatIdx: number): void {
    const state = room.state;
    if (!state) return;
    let view: unknown;
    try {
      view = redactView(this.deps.engine.view(state, seatIdx));
    } catch (e) {
      this.log('error', `engine.view failed for ${room.code} seat ${seatIdx}`, errorMessage(e));
      return;
    }
    const p = state.pending;
    const pending: PendingSummary | null = p
      ? { id: p.id, who: p.who, kind: p.kind, prompt: p.prompt, min: p.min, max: p.max }
      : null;
    s.send({
      t: 'state',
      code: room.code,
      seq: room.seq,
      seat: seatIdx,
      view,
      pending,
      status: state.status,
      endReason: state.endReason,
    });
  }

  private announceEnd(room: Room): void {
    const state = room.state;
    if (!state || state.status === 'playing') return;
    const msg: ServerMessage = {
      t: 'ended',
      code: room.code,
      status: state.status,
      reason: state.endReason,
    };
    for (const st of room.seats) st.attached?.send(msg);
  }
}

function toCommand(c: StoredCommand): { who: number; pendingId: number; pick: string[] } {
  return { who: c.who, pendingId: c.pendingId, pick: c.pick };
}
