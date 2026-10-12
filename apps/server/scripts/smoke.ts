// Co-op smoke test, programmatic (no browser). Run with: npx tsx scripts/smoke.ts  (from apps/server)
//
// Starts the server in-process on a random port with MemoryStore and the real rules engine, connects two WebSocket
// clients, creates a 2-seat co-op room, joins it by code, and plays with random legal answers (taken from each seat's
// own view). The flow:
//   1. at decision DROP_AT, seat 2's socket is closed mid-game and reconnected with its resume token;
//   2. at decision RESTART_AT the whole server is stopped and started again over the same store. The restored room must
//      have the same sequence number and the same SHA-256 of the engine's serialised state, and both seats must get the
//      same view and the same open decision back;
//   3. the restored game is played on until it ends or MAX_DECISIONS decisions have been answered, and the store must
//      hold exactly one command per accepted answer.
// The restart is placed mid-game on purpose: a finished game is not restored at start-up (only unfinished games are),
// and random play loses the game in well under MAX_DECISIONS decisions.
// Exits 0 with a JSON report on success; exits 1 with the failed assertion otherwise.
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import type { ServerConfig } from '../src/config';
import { loadRealEngine } from '../src/engine';
import type { LogFn } from '../src/rooms';
import { RoomManager } from '../src/rooms';
import { startServer, type RunningServer } from '../src/server';
import { MemoryStore, type GameStore } from '../src/store';
import type { PendingSummary, ServerMessage } from '../../../packages/engine/src/protocol';
import { WsClient } from '../tests/ws-client';

const MAX_DECISIONS = 400;
const DROP_AT = 20;
const RESTART_AT = 45;
const SEED = 4242;

const SETTINGS = {
  roomName: 'Smoke co-op',
  seats: 2,
  scenario: 'crater',
  society: 1,
  difficulty: 'normal',
  extraPack: false,
  advisors: [],
  seed: SEED,
} as const;

type StateMsg = Extract<ServerMessage, { t: 'state' }>;
interface OptionView { id: string; disabled?: string }
interface PendingView { options: OptionView[]; min: number; max: number; meta?: Record<string, any>; canAnswer: boolean }

const quiet: LogFn = (level, msg, extra) => {
  if (level !== 'info') console.log(`[${level}] ${msg}${extra === undefined ? '' : ` ${JSON.stringify(extra)}`}`);
};

// The smoke test sends faster than the production limits allow, so the per-connection burst limit is lifted here.
const CONFIG: ServerConfig = {
  port: 0,
  corsOrigins: ['*'],
  supabaseUrl: null,
  supabaseServiceRoleKey: null,
  persistSnapshotEvery: 10,
  lobbyGraceMs: 60_000,
  heartbeatMs: 60_000,
  rateBurst: 1_000_000,
  rateRefillPerSec: 1_000_000,
  endedRoomTtlMs: 60_000,
  maxRooms: 10,
  maxConnections: 20,
  maxConnPerIp: 20,
  trustProxy: false,
  abandonAfterMs: 60 * 60_000,
  persistAttempts: 3,
  persistBaseDelayMs: 1,
  persistMaxDelayMs: 5,
  shutdownGraceMs: 2000,
};

async function boot(store: GameStore): Promise<{ server: RunningServer; manager: RoomManager; restored: number; url: string }> {
  const manager = new RoomManager({
    engine: loadRealEngine(),
    store,
    snapshotEvery: CONFIG.persistSnapshotEvery,
    lobbyGraceMs: CONFIG.lobbyGraceMs,
    endedRoomTtlMs: CONFIG.endedRoomTtlMs,
    maxRooms: CONFIG.maxRooms,
    abandonAfterMs: CONFIG.abandonAfterMs,
    retry: { attempts: CONFIG.persistAttempts, baseDelayMs: CONFIG.persistBaseDelayMs, maxDelayMs: CONFIG.persistMaxDelayMs },
    log: quiet,
  });
  const restored = await manager.restore();
  const server = await startServer({ config: CONFIG, manager, persistence: store.kind, log: quiet, port: 0, host: '127.0.0.1' });
  return { server, manager, restored, url: `ws://127.0.0.1:${server.port}/ws` };
}

/** Deterministic PRNG (mulberry32), so a run can be repeated. */
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

/** A random answer that satisfies min/max, the disabled flags and (for repeatable choices) the per-option caps. */
function legalPick(p: { min: number; max: number; options: OptionView[]; meta?: Record<string, any> }, rnd: () => number): string[] {
  const enabled = p.options.filter((o) => !o.disabled);
  const allowRepeat = Boolean(p.meta?.allowRepeat);
  const caps: Record<string, number> = p.meta?.caps ?? {};
  const maxCount = allowRepeat ? p.max : Math.min(p.max, enabled.length);
  if (maxCount < p.min) throw new Error(`no legal answer: needs ${p.min}..${p.max}, enabled options ${enabled.length}`);
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
    const cands = enabled.filter((o) => (used[o.id] ?? 0) < (caps[o.id] ?? 1));
    if (cands.length === 0) break;
    const o = cands[Math.floor(rnd() * cands.length)];
    used[o.id] = (used[o.id] ?? 0) + 1;
    pick.push(o.id);
  }
  return pick;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function main(): Promise<void> {
  const started = Date.now();
  const rnd = rng(SEED);
  const store = new MemoryStore();
  const report: Record<string, unknown> = { store: store.kind };

  let booted = await boot(store);
  assert.equal(booted.restored, 0, 'an empty store restores nothing');
  let manager = booted.manager;
  let url = booted.url;

  // ---- lobby: create, join by code, ready, start ----------------------------
  let a = await WsClient.connect(url, 'A');
  let b = await WsClient.connect(url, 'B');
  a.send({ t: 'create', name: 'Ann', settings: { ...SETTINGS, advisors: [] } });
  const joinedA = await a.take('joined');
  const code = joinedA.code;
  const tokenA = joinedA.token;
  assert.equal(joinedA.seat, 0);

  b.send({ t: 'join', code, name: 'Ben' });
  const joinedB = await b.take('joined');
  const tokenB = joinedB.token;
  assert.equal(joinedB.seat, 1);
  await a.take('room', (r) => r.room.players.length === 2);

  b.send({ t: 'ready', ready: true });
  await a.take('room', (r) => r.room.players[1]?.ready === true);
  a.send({ t: 'start' });

  let stA: StateMsg = await a.take('state', (m) => m.seq === 0);
  let stB: StateMsg = await b.take('state', (m) => m.seq === 0);
  assert.equal(stA.status, 'playing', 'the game starts');
  assert.ok(stA.pending, 'the first decision is open');
  report.code = code;

  let decisions = 0;
  let dropped = false;
  let restarted = false;

  /** Answers one decision with the addressed seat's client. Both seats receive the new state. */
  async function answerOne(): Promise<void> {
    const pending = stA.pending as PendingSummary | null;
    assert.ok(pending, `the game is playing at seq ${stA.seq} without a decision`);
    const who = pending.who >= 0 ? pending.who : 0; // -1: any seat may answer; seat 0 answers
    const addressed = who === 0 ? a : b;
    const seenBy = who === 0 ? stA : stB;
    const shown = (seenBy.view as { pending: PendingView | null }).pending;
    assert.ok(shown && shown.canAnswer, `seat ${who} is told it may answer decision ${pending.id}`);
    const pick = legalPick(shown, rnd);
    const before = stA.seq;
    addressed.send({ t: 'answer', pendingId: pending.id, pick });
    stA = await a.take('state', (m) => m.seq > before);
    stB = await b.take('state', (m) => m.seq > before);
    assert.equal(stA.seq, stB.seq, 'both seats see the same sequence number');
    decisions++;
  }

  /** Closes seat 2's socket and reconnects it with the resume token. */
  async function dropAndResumeSeatTwo(): Promise<void> {
    b.close();
    await a.take('room', (r) => r.room.players[1]?.connected === false);
    b = await WsClient.connect(url, 'B-resumed');
    b.send({ t: 'resume', code, token: tokenB });
    assert.deepEqual(await b.take('resumed'), { t: 'resumed', code, seat: 1 });
    await b.take('room', (r) => r.room.players[1]?.connected === true);
    stB = await b.take('state');
    assert.equal(stB.seq, stA.seq, 'the resumed seat receives the current sequence number');
    assert.equal(stB.pending?.id, stA.pending?.id, 'the resumed seat sees the same open decision');
    dropped = true;
  }

  /** Stops the server, starts it again over the same store, and checks the restored room against the old one. */
  async function restartAndCompare(): Promise<void> {
    await manager.flush();
    const hashBefore = manager.stateHash(code);
    assert.ok(hashBefore, 'the room is in memory before the restart');
    assert.equal(hashBefore.seq, stA.seq, 'the server and the client agree on the sequence number');
    const viewBefore = sha256(JSON.stringify(stA.view));
    const pendingBefore = stA.pending;
    const storedBefore = (await store.loadActiveGames()).find((g) => g.roomCode === code);
    assert.equal(storedBefore?.commands.length, stA.seq, 'the store holds one command per accepted answer');

    a.close();
    b.close();
    await booted.server.stop(2000);

    booted = await boot(store);
    manager = booted.manager;
    url = booted.url;
    assert.equal(booted.restored, 1, 'the unfinished game is restored from the store');

    const hashAfter = manager.stateHash(code);
    assert.deepEqual(hashAfter, hashBefore, 'the restored engine state has the same sequence number and serialised hash');

    a = await WsClient.connect(url, 'A-restarted');
    a.send({ t: 'resume', code, token: tokenA });
    assert.deepEqual(await a.take('resumed'), { t: 'resumed', code, seat: 0 });
    stA = await a.take('state');
    b = await WsClient.connect(url, 'B-restarted');
    b.send({ t: 'resume', code, token: tokenB });
    assert.deepEqual(await b.take('resumed'), { t: 'resumed', code, seat: 1 });
    stB = await b.take('state');
    assert.equal(stA.seq, hashBefore.seq, 'the restored sequence number matches');
    assert.equal(sha256(JSON.stringify(stA.view)), viewBefore, 'the restored view matches the view before the restart');
    assert.deepEqual(stA.pending, pendingBefore, 'the restored decision matches the one before the restart');

    report.restart = {
      atDecision: decisions,
      seq: hashBefore.seq,
      stateSha256Before: hashBefore.sha256,
      stateSha256After: hashAfter?.sha256 ?? null,
      viewMatches: true,
    };
    restarted = true;
  }

  // ---- play ------------------------------------------------------------------
  while (stA.status === 'playing' && decisions < MAX_DECISIONS) {
    if (!dropped && decisions === DROP_AT) await dropAndResumeSeatTwo();
    if (!restarted && decisions === RESTART_AT) await restartAndCompare();
    await answerOne();
  }
  if (stA.status !== 'playing') {
    await a.take('ended');
    await b.take('ended');
  }
  assert.ok(dropped, 'the drop was exercised');
  assert.ok(restarted, 'the restart was exercised: the game must still be running at the restart point');

  await manager.flush();
  const stored = (await store.loadActiveGames()).find((g) => g.roomCode === code);
  if (stA.status === 'playing') {
    assert.equal(stored?.commands.length, stA.seq, 'the store is in step at the end of the run');
  } else {
    assert.equal(stored, undefined, 'a finished game is no longer an active row');
  }

  report.decisions = decisions;
  report.gameStatus = stA.status;
  report.endReason = stA.endReason;
  report.round = (stA.view as { round?: number }).round ?? null;
  report.finalSeq = stA.seq;
  report.seatTwoDroppedAndResumed = dropped;
  report.storedCommands = stA.status === 'playing' ? stored?.commands.length ?? null : 'game finished, row no longer active';
  report.persistFailed = manager.persistenceStats().failed;

  a.close();
  b.close();
  await booted.server.stop(2000);
  report.ms = Date.now() - started;
  console.log(JSON.stringify(report, null, 2));
  console.log('smoke: PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error('smoke: FAIL', e);
  process.exit(1);
});
