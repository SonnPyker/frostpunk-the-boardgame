// Hope & Discontent tracks (rulebook p17-18).
import { ask, defOp, lose, log, opt, push, pushSeq } from './core';
import { hasPassive } from './laws';
import { randInt } from './rng';
import type { DiscType, GameState, HopeType, Op, Tok } from './types';
import { DISC_TYPES, HOPE_TYPES } from './types';

export const HOPE_SLOTS = 6;
export const DISC_SLOTS = 5;

export type Side = 'hope' | 'disc';

export const TYPE_LABEL: Record<string, string> = {
  care: 'Care',
  justice: 'Justice',
  motivation: 'Motivation',
  anger: 'Anger',
  apathy: 'Apathy',
  greed: 'Greed',
};

export function track(s: GameState, side: Side): Tok<any>[] {
  return side === 'hope' ? s.hope : s.disc;
}
function bag(s: GameState, side: Side): Record<string, number> {
  return side === 'hope' ? s.hopeBag : s.discBag;
}
function slots(side: Side) {
  return side === 'hope' ? HOPE_SLOTS : DISC_SLOTS;
}
function types(side: Side): string[] {
  return side === 'hope' ? HOPE_TYPES : DISC_TYPES;
}
export function sideOfType(t: string): Side {
  return (HOPE_TYPES as string[]).includes(t) ? 'hope' : 'disc';
}

export function bagTotal(s: GameState, side: Side) {
  return Object.values(bag(s, side)).reduce((a, b) => a + b, 0);
}

export function activeCount(s: GameState, type: string): number {
  return track(s, sideOfType(type)).filter((t) => t.t === type && t.a).length;
}
export function exhaustedCount(s: GameState, type: string): number {
  return track(s, sideOfType(type)).filter((t) => t.t === type && !t.a).length;
}
export function activeTotal(s: GameState, side: Side): number {
  return track(s, side).filter((t) => t.a).length;
}
export function tokenTotal(s: GameState, side: Side): number {
  return track(s, side).length;
}

/**
 * Draw a token of the bag; returns its type or null if the bag is empty. A wanted type (chosen under L15 Public Council) is
 * taken when it is still in the bag; otherwise the draw is random.
 */
export function drawFromBag(s: GameState, side: Side, want?: string): string | null {
  const b = bag(s, side);
  const total = bagTotal(s, side);
  if (total <= 0) return null;
  if (want && b[want] > 0) {
    b[want]--;
    return want;
  }
  let r = randInt(s.rng, total);
  for (const t of types(side)) {
    if (r < b[t]) {
      b[t]--;
      return t;
    }
    r -= b[t];
  }
  return null;
}

function canDraw(s: GameState, side: Side) {
  return track(s, side).length < slots(side) && bagTotal(s, side) > 0;
}

/** Place a randomly drawn token on the leftmost empty space (exhausted). Returns the drawn type. */
function drawToTrack(s: GameState, side: Side, active = false, want?: string): string | null {
  const t = drawFromBag(s, side, want);
  if (!t) return null;
  track(s, side).push({ t, a: active } as Tok<any>);
  log(s, side + '.draw', `${side === 'hope' ? 'Hope' : 'Discontent'}: drew ${TYPE_LABEL[t]}${active ? ' (active)' : ''}`, { type: t, active });
  return t;
}

export function setupTrack(s: GameState, side: Side, draw: number, active: number) {
  for (let i = 0; i < draw; i++) drawToTrack(s, side, i < active);
}

function activateOne(s: GameState, side: Side, type?: string): boolean {
  const tr = track(s, side);
  const tok = tr.find((t) => !t.a && (!type || t.t === type));
  if (!tok) return false;
  tok.a = true;
  log(s, side + '.activate', `${TYPE_LABEL[tok.t]} ${side === 'hope' ? 'Hope' : 'Discontent'} activated`, { type: tok.t });
  return true;
}
function exhaustOne(s: GameState, side: Side, type?: string): boolean {
  const tr = track(s, side);
  const tok = tr.find((t) => t.a && (!type || t.t === type));
  if (!tok) return false;
  tok.a = false;
  log(s, side + '.exhaust', `${TYPE_LABEL[tok.t]} ${side === 'hope' ? 'Hope' : 'Discontent'} exhausted`, { type: tok.t });
  return true;
}
function removeOne(s: GameState, side: Side, type: string): boolean {
  const tr = track(s, side);
  const i = tr.findIndex((t) => !t.a && t.t === type);
  if (i < 0) return false;
  tr.splice(i, 1);
  bag(s, side)[type]++;
  log(s, side + '.remove', `${TYPE_LABEL[type]} removed from the track`, { type });
  return true;
}
/** Remove an exhausted-or-active token (used by "discard 1 Hope/Discontent" effects). */
export function discardToken(s: GameState, side: Side, type: string, activeOnly = false): boolean {
  const tr = track(s, side);
  let i = tr.findIndex((t) => t.t === type && t.a === activeOnly);
  if (i < 0 && !activeOnly) i = tr.findIndex((t) => t.t === type);
  if (i < 0) return false;
  const [tok] = tr.splice(i, 1);
  bag(s, side)[tok.t]++;
  log(s, side + '.remove', `${TYPE_LABEL[tok.t]} removed from the track`, { type: tok.t });
  checkTrack(s, side);
  return true;
}

export function checkTrack(s: GameState, side: Side) {
  if (s.status !== 'playing') return;
  if (side === 'hope' && s.hope.length === 0) lose(s, 'All Hope has been lost.');
}

function discOverflow(s: GameState) {
  lose(s, 'Discontent overflowed: a sixth Discontent token was drawn.');
}

// ---------------------------------------------------------------------------------------------------------
// Public sync-ish helpers that raise decisions via ops. They are used by the FX interpreter and the rules.

export function pushIncrease(s: GameState, side: Side, n: number, type: string | null, who: number, src?: string) {
  const ops: Op[] = [];
  for (let i = 0; i < n; i++) ops.push({ k: 'inc', side, type, who, src });
  pushSeq(s, ...ops);
}
export function pushDecrease(s: GameState, side: Side, n: number, who: number, src?: string) {
  const ops: Op[] = [];
  for (let i = 0; i < n; i++) ops.push({ k: 'dec', side, who, src });
  pushSeq(s, ...ops);
}

// ---- increase -------------------------------------------------------------------------------------------

/**
 * L15 Public Council (card back): "Whenever you increase Hope / Discontent and choose to draw a token, you may choose a
 * specific Hope / Discontent token to draw." While the passive is in force and the bag holds two or more types, the
 * leader (the group's decision holder, PLY-02) picks the type. Returns true when a decision was raised; the draw (and the
 * optional activation of `activate`) then happens in 'drawChosen'. Otherwise the caller draws at random as before.
 */
function askChosenDraw(s: GameState, side: Side, who: number, src: string | undefined, activate: string | null): boolean {
  if (!hasPassive(s, 'chooseTokenWhenDrawing')) return false;
  if (!canDraw(s, side)) return false;
  const b = bag(s, side);
  const avail = types(side).filter((t) => b[t] > 0);
  if (avail.length < 2) return false;
  ask(s, {
    who: s.leader ?? who,
    kind: 'type',
    prompt: `Public Council: which ${side === 'hope' ? 'Hope' : 'Discontent'} token do you draw?`,
    src,
    options: avail.map((t) => opt(t, TYPE_LABEL[t] ?? t)),
    then: { k: 'drawChosen', side, activate, src },
  });
  return true;
}

defOp('drawChosen', (s, op) => {
  const side: Side = op.side;
  if (s.status !== 'playing') return;
  if (canDraw(s, side)) drawToTrack(s, side, false, op.pick?.[0]);
  if (op.activate) activateOne(s, side, op.activate);
});

defOp('inc', (s, op) => {
  const side: Side = op.side;
  const type: string | null = op.type;
  if (s.status !== 'playing') return;
  if (type && type.includes('|')) {
    const choices = type.split('|');
    ask(s, {
      who: op.who,
      kind: 'type',
      prompt: `Increase which ${side === 'hope' ? 'Hope' : 'Discontent'}?`,
      src: op.src,
      options: choices.map((c) => opt(c, TYPE_LABEL[c] ?? c)),
      then: { k: 'inc2', side, who: op.who, src: op.src },
    });
    return;
  }
  if (type) {
    // typed increase: draw one (if possible), then activate an exhausted token of the type (if possible)
    if (canDraw(s, side)) {
      // L15 Public Council: the chosen draw and the activation resume in 'drawChosen'
      if (askChosenDraw(s, side, op.who, op.src, type)) return;
      drawToTrack(s, side, false);
    } else if (side === 'disc' && track(s, 'disc').length >= DISC_SLOTS && bagTotal(s, 'disc') > 0) {
      // track is full: the drawn 6th token cannot be placed => lose (rulebook: 6th Discontent)
      return discOverflow(s);
    }
    activateOne(s, side, type);
    return;
  }
  // untyped: draw to the leftmost empty space exhausted, OR activate an exhausted token
  const tr = track(s, side);
  const exhausted = Array.from(new Set(tr.filter((t) => !t.a).map((t) => t.t)));
  const drawOk = canDraw(s, side);
  const drawLoses = side === 'disc' && tr.length >= DISC_SLOTS && bagTotal(s, 'disc') > 0;
  const options = [] as ReturnType<typeof opt>[];
  if (drawOk || drawLoses)
    options.push(
      opt('draw', side === 'hope' ? 'Draw a random Hope token' : 'Draw a random Discontent token', drawLoses ? { hint: 'This would be the sixth Discontent token – you lose!' } : undefined),
    );
  for (const t of exhausted) options.push(opt('act:' + t, `Activate exhausted ${TYPE_LABEL[t]}`));
  if (options.length === 0) return; // nothing possible (track full of active tokens / bag empty)
  ask(s, {
    who: op.who,
    kind: 'choice',
    prompt: `Increase ${side === 'hope' ? 'Hope' : 'Discontent'}`,
    src: op.src,
    options,
    then: { k: 'inc2', side, who: op.who, src: op.src },
  });
});

defOp('inc2', (s, op) => {
  const side: Side = op.side;
  const pick: string | undefined = op.pick?.[0];
  if (!pick) return;
  if (pick === 'draw') {
    if (side === 'disc' && track(s, 'disc').length >= DISC_SLOTS) return discOverflow(s);
    if (askChosenDraw(s, side, op.who, op.src, null)) return;
    drawToTrack(s, side, false);
    return;
  }
  if (pick.startsWith('act:')) {
    activateOne(s, side, pick.slice(4));
    return;
  }
  // type chosen for a "a|b" typed increase
  push(s, { k: 'inc', side, type: pick, who: op.who, src: op.src });
});

// ---- decrease -------------------------------------------------------------------------------------------

defOp('dec', (s, op) => {
  const side: Side = op.side;
  const tr = track(s, side);
  const actives = Array.from(new Set(tr.filter((t) => t.a).map((t) => t.t)));
  const exh = Array.from(new Set(tr.filter((t) => !t.a).map((t) => t.t)));
  const options = [] as ReturnType<typeof opt>[];
  for (const t of actives) options.push(opt('exh:' + t, `Exhaust ${TYPE_LABEL[t]}`));
  // removal is allowed at any time for exhausted tokens (and forced when there are no active tokens)
  for (const t of exh) options.push(opt('rem:' + t, `Remove exhausted ${TYPE_LABEL[t]} from the track`));
  if (options.length === 0) return;
  ask(s, {
    who: op.who,
    kind: 'choice',
    prompt: `Decrease ${side === 'hope' ? 'Hope' : 'Discontent'}`,
    src: op.src,
    options,
    then: { k: 'dec2', side, who: op.who, src: op.src },
  });
});

defOp('dec2', (s, op) => {
  const side: Side = op.side;
  const pick: string = op.pick?.[0];
  if (!pick) return;
  const [kind, type] = pick.split(':');
  if (kind === 'exh') exhaustTyped(s, type, op.who, op.src);
  else removeOne(s, side, type);
  checkTrack(s, side);
});

// ---- exhaust / activate a token of a given type (with optional "all") -----------------------------------

export function doExhaust(s: GameState, type: string, all: boolean) {
  const side = sideOfType(type);
  if (all) while (exhaustOne(s, side, type));
  else exhaustOne(s, side, type);
}

// ---- L20 The Virtue of Humanity (card text, extra pack) -------------------------------------------------------------
// The Law card holds one Hope token (`hopeTok` on its LawInPlay entry, active side up). That token is NOT on the Hope
// track and does not count towards the owned Hope tokens. While the card is uncovered and its passive
// `virtueHopeSubstitute` is in force: "Whenever you are about to exhaust a Hope token of the same type as the Hope token
// on this card, you may exhaust any other active Hope token instead." The swap ("You may swap the Hope token on L20 with
// an active token on the Hope track") is the Law Consequence offer `virtueSwapOffer` (fx/tokens_people.ts).

export interface VirtueLaw {
  id: string;
  covered: string | null;
  hopeTok?: string | null;
}

/** The Law card The Virtue of Humanity (L20) in play, if introduced. */
export function virtueLaw(s: GameState): VirtueLaw | undefined {
  return s.laws.find((l) => l.id === 'L20') as VirtueLaw | undefined;
}

/** Active Hope types the player may exhaust instead of a Hope token of `type` (empty when no substitution applies). */
export function virtueSubstitutes(s: GameState, type: string): string[] {
  const l = virtueLaw(s);
  if (!l || l.covered || !l.hopeTok || l.hopeTok !== type) return [];
  if (!(HOPE_TYPES as string[]).includes(type)) return [];
  if (!hasPassive(s, 'virtueHopeSubstitute')) return [];
  if (activeCount(s, type) <= 0) return [];
  return HOPE_TYPES.filter((t) => t !== type && activeCount(s, t) > 0);
}

/**
 * Offer the L20 substitution before exhausting a Hope token of `type`. Returns false when no substitution applies (the
 * caller exhausts as usual). Otherwise asks which active Hope token to exhaust; the answer resumes in `then`, whose
 * `pick[0]` is the Hope type to exhaust.
 */
export function askVirtueSubstitute(s: GameState, type: string, who: number, src: string | undefined, then: any): boolean {
  const alts = virtueSubstitutes(s, type);
  if (!alts.length) return false;
  ask(s, {
    who,
    kind: 'type',
    prompt: `The Virtue of Humanity: exhaust a ${TYPE_LABEL[type]} Hope token, or another active Hope token instead?`,
    src,
    options: [type, ...alts].map((t) => opt(t, t === type ? `${TYPE_LABEL[t]} (no substitution)` : `${TYPE_LABEL[t]} instead`)),
    then,
  });
  return true;
}

/** Exhaust one active token of `type` (Hope or Discontent); a Hope exhaust is first offered the L20 substitution. */
export function exhaustTyped(s: GameState, type: string, who: number, src?: string) {
  if (sideOfType(type) === 'hope' && askVirtueSubstitute(s, type, who, src, { k: 'virtueExhaustDo' })) return;
  doExhaust(s, type, false);
}

defOp('virtueExhaustDo', (s, op) => {
  const t: string | undefined = op.pick?.[0];
  if (t) doExhaust(s, t, false);
});

/** "All" as a token count (JSON-safe, unlike Infinity which would be stored as null in a saved stack). */
export const EXHAUST_ALL = Number.MAX_SAFE_INTEGER;

/** One step of a bulk exhaust: exhaust `n` active tokens of `type` (EXHAUST_ALL = all of them). */
export interface ExhaustStep {
  type: string;
  n: number;
}

/**
 * Bulk exhaust ("all of a type", "one of each type", "all Hope"): one token at a time. Each Hope token is about to be
 * exhausted on its own, so while the L20 substitution applies the player is asked before each one (askVirtueSubstitute);
 * the answer resumes in `exhaustPlanDo`. Without a substitution the plan runs synchronously.
 */
export function exhaustTokensPlan(s: GameState, plan: ExhaustStep[], who: number, src?: string | null) {
  for (let i = 0; i < plan.length; i++) {
    const { type, n } = plan[i];
    const side = sideOfType(type);
    let left = n;
    while (left > 0 && activeCount(s, type) > 0) {
      const then = { k: 'exhaustPlanDo', plan: [{ type, n: left - 1 }, ...plan.slice(i + 1)], who, src: src ?? null };
      if (side === 'hope' && askVirtueSubstitute(s, type, who, src ?? undefined, then)) return;
      if (!exhaustOne(s, side, type)) break;
      left--;
    }
  }
}

defOp('exhaustPlanDo', (s, op) => {
  // the picked type is exhausted in place of the one the plan was about to exhaust (its count is already reduced)
  const t: string | undefined = op.pick?.[0];
  if (t && activeCount(s, t) > 0) exhaustOne(s, sideOfType(t), t);
  exhaustTokensPlan(s, op.plan, op.who, op.src);
});
export function doActivate(s: GameState, type: string, all: boolean) {
  const side = sideOfType(type);
  if (all) while (activateOne(s, side, type));
  else activateOne(s, side, type);
}

/** Can an Exhaust of the given type be paid (token of that type active)? type may be 'hope'|'disc' for any */
export function canExhaust(s: GameState, type: string): boolean {
  if (type === 'hope') return activeTotal(s, 'hope') > 0;
  if (type === 'disc') return activeTotal(s, 'disc') > 0;
  return activeCount(s, type) > 0;
}

export function exhaustAnyOf(s: GameState, side: Side, count: number) {
  for (let i = 0; i < count; i++) if (!exhaustOne(s, side)) break;
}

/** generic "choose a type then exhaust/activate" helper op */
defOp('pickTypeThen', (s, op) => {
  // op: {side, mode: 'exhaust'|'activate', pool: 'active'|'exhausted', all?: bool, who}
  const side: Side = op.side;
  const tr = track(s, side);
  const want = op.pool === 'active';
  const ts = Array.from(new Set(tr.filter((t) => t.a === want).map((t) => t.t)));
  if (ts.length === 0) return;
  ask(s, {
    who: op.who,
    kind: 'type',
    prompt: `${op.mode === 'exhaust' ? 'Exhaust' : 'Activate'} which ${side === 'hope' ? 'Hope' : 'Discontent'}${op.all ? ' type' : ''}?`,
    src: op.src,
    options: ts.map((t) => opt(t, TYPE_LABEL[t])),
    then: { k: 'pickTypeThen2', side, mode: op.mode, all: !!op.all, who: op.who, src: op.src ?? null },
  });
});
defOp('pickTypeThen2', (s, op) => {
  const t: string = op.pick?.[0];
  if (!t) return;
  if (op.mode === 'exhaust') {
    if (op.all) exhaustTokensPlan(s, [{ type: t, n: EXHAUST_ALL }], op.who, op.src);
    else exhaustTyped(s, t, op.who, op.src ?? undefined);
  } else doActivate(s, t, op.all);
});

export function mostCommonActive(s: GameState): string[] {
  const counts: Record<string, number> = {};
  for (const t of [...s.hope, ...s.disc]) if (t.a) counts[t.t] = (counts[t.t] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  if (max === 0) return [];
  return Object.keys(counts).filter((k) => counts[k] === max);
}

export function mostCommonDiscActive(s: GameState): string[] {
  const counts: Record<string, number> = {};
  for (const t of s.disc) if (t.a) counts[t.t] = (counts[t.t] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  if (max === 0) return [];
  return Object.keys(counts).filter((k) => counts[k] === max);
}
export { drawToTrack, activateOne, exhaustOne, removeOne };
