// Engine core: op registry, run loop, pending decisions, logging.
import type { GameState, Op, Pending, PendingOption } from './types';

export type OpHandler = (s: GameState, op: Op) => void;
const OPS: Record<string, OpHandler> = {};

export function defOp(name: string, h: OpHandler) {
  if (OPS[name]) throw new Error('duplicate op ' + name);
  OPS[name] = h;
}

/** Names of every registered op (coverage report of the simulator). */
export function opNames(): string[] {
  return Object.keys(OPS);
}

export function hasOp(name: string) {
  return !!OPS[name];
}

/** Push ops so that they execute in the given order (first argument first). */
export function pushSeq(s: GameState, ...ops: (Op | null | undefined | false)[]) {
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    if (o) s.stack.push(o);
  }
}

export function push(s: GameState, op: Op) {
  s.stack.push(op);
}

export function log(s: GameState, t: string, m: string, d?: any) {
  s.logN++;
  s.log.push({ n: s.logN, r: s.round, p: s.phase, t, m, d });
  if (s.log.length > 600) s.log.splice(0, s.log.length - 400);
}

/** The answer that goes back from a decision with Pending.back to the action menu it came from. */
export const BACK_PICK = 'back';

/**
 * Fingerprint of what the player cannot see: the decks and tile/expedition stacks, the RNG, the hidden Law data, the
 * scenario's hidden state and the other seats' hands. Going back is only allowed while it is unchanged since the action
 * was picked, so a hidden card can never be drawn, seen and then undone.
 */
function hiddenFingerprint(s: GameState, who: number): string {
  const hands = s.players.map((p, i) => (i === who ? null : p.hand));
  return JSON.stringify([s.rng, s.decks, s.stacks, s.expeditions, s.nextExp, s.futureLaws, s.lawConsequenceBank, s.scenarioState, hands]);
}

function backAvailable(s: GameState): boolean {
  const bp = s.backPoint;
  return !!bp && bp.round === s.round && bp.phase === s.phase && bp.hidden === hiddenFingerprint(s, bp.who);
}

/** The state as JSON, without the back point (so a back point never nests inside another one). */
function stateWithoutBack(s: GameState): string {
  const { backPoint: _bp, ...rest } = s;
  return JSON.stringify(rest);
}

export interface AskSpec {
  who: number; // player index (use leader/active) ; -1 = anyone
  kind: string;
  prompt: string;
  options: PendingOption[];
  min?: number;
  max?: number;
  then: Op;
  src?: string;
  meta?: Record<string, any>;
  /** never auto-resolve, even when there is only one legal option (e.g. confirmations) */
  forced?: boolean;
  /**
   * A decision of an action's chain that comes before anything is built, paid, used or drawn: the player may go back to
   * the action menu from it (Pending.back). Ignored when no back point is open.
   */
  back?: boolean;
}

/**
 * Raise a decision. If there is nothing to decide (exactly `min` selectable options and min==max, or no options at all)
 * and the decision is not `forced`, resolve it automatically so that the player never has to click through no-ops.
 */
export function ask(s: GameState, spec: AskSpec) {
  const min = spec.min ?? 1;
  const max = spec.max ?? Math.max(1, min);
  const enabled = spec.options.filter((o) => !o.disabled);
  if (!spec.forced) {
    if (enabled.length === 0 && min > 0) {
      s.stack.push({ ...spec.then, pick: [], none: true });
      return;
    }
    if (min === max && enabled.length === min && min > 0) {
      s.stack.push({ ...spec.then, pick: enabled.map((o) => o.id) });
      return;
    }
    if (min === 0 && enabled.length === 0) {
      s.stack.push({ ...spec.then, pick: [], none: true });
      return;
    }
  }
  const p: Pending = {
    id: ++s.nextPending,
    who: spec.who,
    kind: spec.kind,
    prompt: spec.prompt,
    src: spec.src,
    options: spec.options,
    min,
    max,
    then: spec.then,
    meta: spec.meta,
    ...(spec.back && backAvailable(s) ? { back: true } : {}),
  };
  s.pending = p;
}

export interface DistOption {
  id: string;
  label: string;
  cap: number;
  hint?: string;
}

/**
 * Ask the player to distribute `count` points over options (each option id may be picked up to `cap` times).
 * Unused points are lost, so the player must pick min(count, total cap) points. Resolves automatically when there is no real choice.
 */
export function askDistribute(
  s: GameState,
  spec: { who: number; kind?: string; prompt: string; options: DistOption[]; count: number; then: Op; src?: string; back?: boolean },
) {
  const opts = spec.options.filter((o) => o.cap > 0);
  const total = opts.reduce((a, o) => a + o.cap, 0);
  const need = Math.min(spec.count, total);
  if (need <= 0) {
    s.stack.push({ ...spec.then, pick: [], none: true });
    return;
  }
  if (total <= spec.count || opts.length === 1) {
    const pick: string[] = [];
    for (const o of opts) for (let i = 0; i < Math.min(o.cap, need); i++) pick.push(o.id);
    s.stack.push({ ...spec.then, pick: pick.slice(0, need) });
    return;
  }
  const caps: Record<string, number> = {};
  for (const o of opts) caps[o.id] = o.cap;
  const p: Pending = {
    id: ++s.nextPending,
    who: spec.who,
    kind: spec.kind ?? 'distribute',
    prompt: spec.prompt,
    src: spec.src,
    options: opts.map((o) => ({ id: o.id, label: o.label, hint: o.hint, data: { cap: o.cap } })),
    min: need,
    max: need,
    then: spec.then,
    meta: { allowRepeat: true, caps, count: need },
    ...(spec.back && backAvailable(s) ? { back: true } : {}),
  };
  s.pending = p;
}

export class RuleError extends Error {}

/** A JSON copy of the whole game state (the state is plain JSON by design). Used to make an answer transactional. */
export function snapshotState(s: GameState): string {
  return JSON.stringify(s);
}

/** Puts `s` back to a snapshot taken by snapshotState (in place: the caller keeps its reference). */
export function restoreState(s: GameState, snap: string): void {
  const back = JSON.parse(snap) as GameState;
  for (const k of Object.keys(s)) delete (s as any)[k];
  Object.assign(s, back);
}

export interface AnswerResult {
  ok: boolean;
  error?: string;
}

/** Validate and apply a player's answer to the current pending decision, then continue running the game. */
export function answerPending(s: GameState, who: number, pendingId: number, pick: string[]): AnswerResult {
  const p = s.pending;
  if (s.status !== 'playing') return { ok: false, error: 'game is over' };
  if (!p) return { ok: false, error: 'no decision pending' };
  if (p.id !== pendingId) return { ok: false, error: 'stale decision' };
  if (p.who >= 0 && p.who !== who) return { ok: false, error: 'not your decision' };
  if (!Array.isArray(pick)) return { ok: false, error: 'bad pick' };
  if (p.back && pick.length === 1 && pick[0] === BACK_PICK) return goBackToActions(s);
  const uniq = new Set(pick);
  if (uniq.size !== pick.length && !p.meta?.allowRepeat) return { ok: false, error: 'duplicate picks' };
  if (pick.length < p.min || pick.length > p.max) return { ok: false, error: `pick ${p.min}..${p.max} options` };
  for (const id of pick) {
    const o = p.options.find((x) => x.id === id);
    if (!o) return { ok: false, error: 'unknown option ' + id };
    if (o.disabled) return { ok: false, error: 'option unavailable: ' + o.disabled };
  }
  const caps: Record<string, number> | undefined = p.meta?.caps;
  if (caps) {
    const cnt: Record<string, number> = {};
    for (const id of pick) {
      cnt[id] = (cnt[id] ?? 0) + 1;
      if (cnt[id] > (caps[id] ?? 1)) return { ok: false, error: 'too many picks of ' + id };
    }
  }
  // Transactional: the answer is validated above (nothing changed yet). If the game then rejects it inside a handler (RuleError),
  // the state goes back to what it was before the answer, so the same decision stays pending. Other errors are engine bugs and
  // are rethrown as they are (no restore), because the caller needs them to be visible.
  const snap = snapshotState(s);
  // Picking an action opens its back point: the state as it was before this pick, which "back" returns to (see BackPoint).
  if (p.kind === 'action') {
    const actor = p.who >= 0 ? p.who : who;
    s.backPoint = { who: actor, round: s.round, phase: s.phase, hidden: hiddenFingerprint(s, actor), snap: stateWithoutBack(s) };
  }
  try {
    s.pending = null;
    s.stack.push({ ...p.then, pick: pick.slice() });
    run(s);
  } catch (e) {
    if (e instanceof RuleError) restoreState(s, snap);
    throw e;
  }
  return { ok: true };
}

/**
 * Puts the game back to the action menu the open back point was taken from. Nothing that happened after that menu is kept,
 * because the back point is only open while nothing hidden has changed (backAvailable). The id and log counters keep
 * counting up, so an id a client may still hold is never reused for a different decision.
 */
function goBackToActions(s: GameState): AnswerResult {
  const bp = s.backPoint;
  if (!bp || !backAvailable(s)) return { ok: false, error: 'no going back from here' };
  const nextPending = s.nextPending;
  const logN = s.logN;
  restoreState(s, bp.snap);
  s.nextPending = nextPending;
  s.logN = logN;
  return { ok: true };
}

const MAX_STEPS_PER_RUN = 200000;

let opTrace: ((name: string) => void) | null = null;
/**
 * Coverage hook for the simulator: called with the op name before every op of `run`. Pass null to remove it.
 * It must not change the state; it is not part of the game rules.
 */
export function setOpTrace(fn: ((name: string) => void) | null) {
  opTrace = fn;
}

/** Execute ops until a decision is needed or the game ends. */
export function run(s: GameState) {
  let guard = 0;
  while (!s.pending && s.status === 'playing') {
    const op = s.stack.pop();
    if (!op) {
      // should not happen: the phase machine always keeps an op on the stack while playing
      throw new Error('engine stack ran dry in phase ' + s.phase);
    }
    const h = OPS[op.k];
    if (!h) throw new Error('unknown op ' + op.k);
    if (opTrace) opTrace(op.k);
    s.steps++;
    if (++guard > MAX_STEPS_PER_RUN) throw new Error('op loop guard tripped at ' + op.k);
    h(s, op);
  }
  // A game that ended inside an op (lose / win clear the stack, but a handler may push after that) has nothing left to do.
  if (s.status !== 'playing') s.stack.length = 0;
}

export function lose(s: GameState, reason: string) {
  if (s.status !== 'playing') return;
  s.status = 'lost';
  s.endReason = reason;
  s.pending = null;
  s.stack.length = 0;
  log(s, 'lose', 'DEFEAT: ' + reason, { reason });
}

export function win(s: GameState, reason: string) {
  if (s.status !== 'playing') return;
  s.status = 'won';
  s.endReason = reason;
  s.pending = null;
  s.stack.length = 0;
  log(s, 'win', 'VICTORY: ' + reason, { reason });
}

/** Convenience: option builders */
export function opt(id: string, label: string, extra?: Partial<PendingOption>): PendingOption {
  return { id, label, ...extra };
}
