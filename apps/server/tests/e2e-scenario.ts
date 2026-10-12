// End-to-end scenario over real WebSockets, against the real rules engine. Shared by tests/e2e.test.ts and
// scripts/e2e.ts. It throws (node:assert) on the first broken expectation and returns a report otherwise.
//
// Flow: two clients create / join / ready / start a 2-seat co-op game, then play with random legal picks (taken from
// the seat's own view) until round `untilRound` or the end. On the way it checks:
//   - only the addressed seat is served a decision (wrong seat -> not_your_decision, stale id -> stale_decision,
//     bad pick -> invalid_answer, and a rejected answer changes nothing);
//   - both seats get redacted views (no rng / stack / decks / hidden law data, other hands hidden);
//   - a dropped seat resumes mid-game with its token and receives the current view;
//   - a full server restart over the same store restores the game, and the resumed views match what was seen before.
import assert from 'node:assert/strict';
import { loadRealEngine } from '../src/engine';
import type { ServerConfig } from '../src/config';
import type { LogFn } from '../src/rooms';
import { RoomManager } from '../src/rooms';
import { startServer, type RunningServer } from '../src/server';
import type { GameStore } from '../src/store';
import type { PendingSummary, ServerMessage } from '../../../packages/engine/src/protocol';
import { WsClient } from './ws-client';

export interface ScenarioOptions {
  store: GameStore;
  log?: LogFn;
  /** Stop once the round reaches this (default 3), or when the game ends. */
  untilRound?: number;
  /** Restart the whole server after this many answered decisions (default 25; 0 = never). */
  restartAfterDecisions?: number;
  /** Drop and resume seat 1 after this many answered decisions (default 8; 0 = never). */
  reconnectAfterDecisions?: number;
  /** Seed for the bot's own choices (the game seed is fixed). */
  botSeed?: number;
}

export interface ScenarioReport {
  decisions: number;
  round: number;
  status: string;
  endReason: string | null;
  finalSeq: number;
  restarts: number;
  restoredGames: number;
  reconnects: number;
  /** Negative checks that were exercised, by name. */
  checks: string[];
  /** Commands the store held for the active game at the last check (-1 when the game had ended). */
  storedCommands: number;
}

export const SCENARIO_SETTINGS = {
  roomName: 'E2E co-op',
  seats: 2,
  scenario: 'crater',
  society: 1,
  difficulty: 'normal',
  extraPack: false,
  advisors: [],
  seed: 1234,
} as const;

const SERVER_CONFIG: ServerConfig = {
  port: 0,
  corsOrigins: ['*'],
  supabaseUrl: null,
  supabaseServiceRoleKey: null,
  persistSnapshotEvery: 5,
  lobbyGraceMs: 60_000,
  heartbeatMs: 60_000,
  rateBurst: 1_000_000,
  rateRefillPerSec: 1_000_000,
  endedRoomTtlMs: 60_000,
  maxRooms: 100,
  maxConnections: 100,
  abandonAfterMs: 60 * 60_000,
  persistAttempts: 5,
  persistBaseDelayMs: 1,
  persistMaxDelayMs: 5,
  shutdownGraceMs: 2000,
};

const HIDDEN_KEYS = ['rng', 'stack', 'decks', 'lawConsequenceBank'];

type StateMsg = Extract<ServerMessage, { t: 'state' }>;

async function boot(store: GameStore, log: LogFn): Promise<{ server: RunningServer; manager: RoomManager; restored: number; url: string }> {
  const manager = new RoomManager({
    engine: loadRealEngine(),
    store,
    snapshotEvery: SERVER_CONFIG.persistSnapshotEvery,
    lobbyGraceMs: SERVER_CONFIG.lobbyGraceMs,
    endedRoomTtlMs: SERVER_CONFIG.endedRoomTtlMs,
    maxRooms: SERVER_CONFIG.maxRooms,
    abandonAfterMs: SERVER_CONFIG.abandonAfterMs,
    retry: { attempts: SERVER_CONFIG.persistAttempts, baseDelayMs: SERVER_CONFIG.persistBaseDelayMs, maxDelayMs: SERVER_CONFIG.persistMaxDelayMs },
    log,
  });
  const restored = await manager.restore();
  const server = await startServer({ config: SERVER_CONFIG, manager, persistence: store.kind, log, port: 0, host: '127.0.0.1' });
  return { server, manager, restored, url: `ws://127.0.0.1:${server.port}/ws` };
}

/** Deterministic PRNG (mulberry32). */
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

interface PendingOptionView {
  id: string;
  disabled?: string;
}

/** A legal answer for a decision, built from the options the seat was shown. */
function legalPick(p: { min: number; max: number; options: PendingOptionView[]; meta?: Record<string, any> }, rnd: () => number): string[] {
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

function assertRedacted(view: any, seat: number): void {
  for (const k of HIDDEN_KEYS) assert.ok(!(k in view), `view for seat ${seat} leaks ${k}`);
  assert.equal(view.seat, seat, 'view.seat');
  assert.ok(view.deckCounts && typeof view.deckCounts === 'object', 'deck counts are sent instead of decks');
  assert.ok(Array.isArray(view.futureLaws), 'the Future Law display (Law card ids) is sent');
  for (const p of view.players as any[]) {
    if (p.seat !== seat) assert.deepEqual(p.hand, [], `seat ${seat} sees the hand of seat ${p.seat}`);
  }
}

export async function runScenario(opts: ScenarioOptions): Promise<ScenarioReport> {
  const log = opts.log ?? (() => {});
  const untilRound = opts.untilRound ?? 3;
  const restartAt = opts.restartAfterDecisions ?? 25;
  const reconnectAt = opts.reconnectAfterDecisions ?? 8;
  const rnd = rng(opts.botSeed ?? 7);
  const checks: string[] = [];
  const report: ScenarioReport = {
    decisions: 0, round: 0, status: 'playing', endReason: null, finalSeq: 0,
    restarts: 0, restoredGames: 0, reconnects: 0, checks, storedCommands: -1,
  };

  let booted = await boot(opts.store, log);
  report.restoredGames += booted.restored;
  let url = booted.url;

  let a = await WsClient.connect(url, 'A');
  let b = await WsClient.connect(url, 'B');

  // ---- lobby -------------------------------------------------------------
  a.send({ t: 'hello', guestId: 'ann-guest-0001', name: 'Ann' });
  assert.equal((await a.take('welcome', (w) => w.guestId === 'ann-guest-0001')).guestId, 'ann-guest-0001');

  b.send({ t: 'start' });
  assert.equal((await b.take('error')).code, 'not_in_room', 'start before joining');

  a.send({ t: 'create', name: 'Ann', settings: { ...SCENARIO_SETTINGS, advisors: [...SCENARIO_SETTINGS.advisors] } });
  const joinedA = await a.take('joined');
  assert.equal(joinedA.seat, 0);
  const code = joinedA.code;
  const tokenA = joinedA.token;
  assert.match(code, /^[A-HJ-NP-Z]{6}$/);

  b.send({ t: 'join', code: 'ZZZZZZ', name: 'Ben' });
  assert.equal((await b.take('error')).code, 'room_not_found', 'join with an unknown code');

  b.send({ t: 'join', code, name: 'Ben' });
  const joinedB = await b.take('joined');
  assert.equal(joinedB.seat, 1);
  const tokenB = joinedB.token;
  await a.take('room', (r) => r.room.players.length === 2);

  b.send({ t: 'answer', pendingId: 1, pick: ['a'] });
  assert.equal((await b.take('error')).code, 'wrong_status', 'answer in the lobby');
  checks.push('lobby:wrong_status');

  b.send({ t: 'start' });
  assert.equal((await b.take('error')).code, 'not_host', 'start by a non-host');
  checks.push('lobby:not_host');

  a.send({ t: 'start' });
  assert.equal((await a.take('error')).code, 'not_ready', 'start while a seat is not ready');
  checks.push('lobby:not_ready');

  b.send({ t: 'ready', ready: true });
  await a.take('room', (r) => r.room.players[1]?.ready === true);
  a.send({ t: 'start' });

  let stA: StateMsg = await a.take('state', (m) => m.seq === 0);
  let stB: StateMsg = await b.take('state', (m) => m.seq === 0);
  assertRedacted(stA.view, 0);
  assertRedacted(stB.view, 1);
  assert.equal(stA.status, 'playing');
  assert.ok(stA.pending, 'the first decision is open');

  // ---- play ----------------------------------------------------------------
  let answered = 0;
  let wrongSeatChecked = false;
  let staleChecked = false;
  let invalidChecked = false;
  let restarted = false;
  let reconnected = false;

  const roundOf = (s: StateMsg) => (s.view as any).round as number;

  while (stA.status === 'playing' && roundOf(stA) < untilRound) {
    // Mid-game drop and resume of seat 1. Runs first, so the client references below are the live ones.
    if (!reconnected && reconnectAt > 0 && answered === reconnectAt) {
      b.close();
      await a.take('room', (r) => r.room.players[1]?.connected === false);
      b = await WsClient.connect(url, 'B-again');
      b.send({ t: 'resume', code, token: tokenB });
      assert.deepEqual(await b.take('resumed'), { t: 'resumed', code, seat: 1 });
      await b.take('room', (r) => r.room.players[1]?.connected === true);
      stB = await b.take('state');
      assert.equal(stB.seq, stA.seq, 'the resumed seat gets the current sequence number');
      assertRedacted(stB.view, 1);
      assert.equal(stB.pending?.id, stA.pending?.id, 'the resumed seat sees the same open decision');
      report.reconnects++;
      checks.push('reconnect:resumed');
      reconnected = true;
    }

    // Full server restart over the same store. Both seats reconnect with their tokens.
    if (!restarted && restartAt > 0 && answered === restartAt) {
      const beforeView = stA.view;
      const beforeSeq = stA.seq;
      const beforePending: PendingSummary | null = stA.pending;
      a.close();
      b.close();
      await booted.server.stop(2000);
      booted = await boot(opts.store, log);
      url = booted.url;
      report.restarts++;
      report.restoredGames += booted.restored;
      assert.equal(booted.restored, 1, 'the unfinished game is restored from the store');

      a = await WsClient.connect(url, 'A-restarted');
      b = await WsClient.connect(url, 'B-restarted');
      a.send({ t: 'resume', code, token: tokenA });
      assert.deepEqual(await a.take('resumed'), { t: 'resumed', code, seat: 0 });
      stA = await a.take('state');
      b.send({ t: 'resume', code, token: tokenB });
      assert.deepEqual(await b.take('resumed'), { t: 'resumed', code, seat: 1 });
      stB = await b.take('state');
      assert.equal(stA.seq, beforeSeq, 'sequence number survives the restart');
      assert.deepEqual(stA.view, beforeView, 'the restored view matches the view before the restart');
      assert.deepEqual(stA.pending, beforePending, 'the restored decision matches the one before the restart');
      assertRedacted(stB.view, 1);
      checks.push('restart:restored');
      restarted = true;
    }

    const pending = stA.pending as PendingSummary | null;
    assert.ok(pending, `game is playing at seq ${stA.seq} without a decision`);
    const who = pending.who >= 0 ? pending.who : 0; // -1: any seat may answer; seat 0 answers
    const addressed = who === 0 ? a : b;
    const other = who === 0 ? b : a;
    const addressedState = who === 0 ? stA : stB;
    const otherState = who === 0 ? stB : stA;
    const shown = (addressedState.view as any).pending as { options: PendingOptionView[]; min: number; max: number; meta?: Record<string, any>; canAnswer: boolean } | null;
    assert.ok(shown && shown.canAnswer, 'the addressed seat is told it may answer');
    assert.ok(shown.options.length > 0, 'the addressed seat receives the options');
    if (pending.who >= 0) {
      assert.equal(((otherState.view as any).pending as any)?.options?.length ?? 0, 0, 'the other seat is not shown the options');
    }

    // Negative checks, once each, on the first suitable decisions.
    if (answered >= 2 && pending.who >= 0 && !wrongSeatChecked) {
      other.send({ t: 'answer', pendingId: pending.id, pick: [shown.options.find((o) => !o.disabled)!.id] });
      assert.equal((await other.take('error')).code, 'not_your_decision', 'a seat that is not addressed is refused');
      checks.push('wrong-seat:not_your_decision');
      wrongSeatChecked = true;
    }
    if (answered >= 2 && !staleChecked) {
      addressed.send({ t: 'answer', pendingId: pending.id - 1, pick: [shown.options[0].id] });
      assert.equal((await addressed.take('error')).code, 'stale_decision', 'an answer to an old decision is refused');
      checks.push('stale:stale_decision');
      staleChecked = true;
    }
    if (answered >= 2 && !invalidChecked) {
      const before = addressed.latest('state')?.seq;
      addressed.send({ t: 'answer', pendingId: pending.id, pick: ['no-such-option'] });
      assert.equal((await addressed.take('error')).code, 'invalid_answer', 'an unknown option is refused');
      checks.push('invalid:invalid_answer');
      // A refused answer changes nothing: no new state follows it.
      assert.equal(addressed.latest('state')?.seq, before, 'a refused answer does not advance the game');
      invalidChecked = true;
    }

    // Persistence is in step with the game: the store holds exactly the accepted commands.
    if (answered === 5 || (restarted && answered === restartAt + 1)) {
      await booted.manager.flush();
      const active = (await opts.store.loadActiveGames()).find((g) => g.roomCode === code);
      assert.ok(active, 'the active game is in the store');
      assert.equal(active!.commands.length, stA.seq, 'the store holds one row per accepted answer');
      report.storedCommands = active!.commands.length;
    }

    // The decision itself.
    const pick = legalPick({ min: shown.min, max: shown.max, options: shown.options, meta: shown.meta }, rnd);
    const seqBefore = stA.seq;
    addressed.send({ t: 'answer', pendingId: pending.id, pick });
    stA = await a.take('state', (m) => m.seq > seqBefore);
    stB = await b.take('state', (m) => m.seq > seqBefore);
    assert.equal(stA.seq, stB.seq, 'both seats see the same sequence number');
    assertRedacted(stA.view, 0);
    assertRedacted(stB.view, 1);
    answered++;
    report.decisions = answered;
  }

  // ---- end -----------------------------------------------------------------
  report.round = roundOf(stA);
  report.status = stA.status;
  report.endReason = stA.endReason;
  report.finalSeq = stA.seq;

  if (stA.status !== 'playing') {
    await a.take('ended');
    await b.take('ended');
    assert.equal(a.every('ended').length, 1, 'ended is sent once');
    const last = stA.pending;
    a.send({ t: 'answer', pendingId: last?.id ?? 1, pick: [] });
    assert.equal((await a.take('error')).code, 'game_over', 'answers after the end are refused');
    checks.push('game:game_over');
  } else {
    await booted.manager.flush();
    const active = (await opts.store.loadActiveGames()).find((g) => g.roomCode === code);
    assert.equal(active?.commands.length, stA.seq, 'the store is in step at the end of the run');
    report.storedCommands = active!.commands.length;
  }
  // The restart and the reconnect must both have happened if the game was long enough to reach them.
  if (restartAt > 0 && report.decisions > restartAt + 1) assert.ok(restarted, 'the restart was exercised');
  if (reconnectAt > 0 && report.decisions > reconnectAt) assert.ok(reconnected, 'the reconnect was exercised');

  a.close();
  b.close();
  await booted.server.stop(2000);
  return report;
}
