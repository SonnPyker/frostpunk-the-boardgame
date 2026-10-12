// Expeditions (rulebook p26, p35-36; ENGINE_SPEC 3.6): Deploy Scouts, Weather-phase Scout movement, Skip / Explore /
// Continue / Return, stack bonuses, and the S05 scenario stack.
//
// Conventions:
// * `ExpStack.cards` is bottom -> top; the top card is the last element. Expedition decks (`s.decks.expA/B/C`) are drawn with
//   pop(), the same as cards.ts.
// * `ExpStack.scout.pos` is 1-based along the top card: 1 = bottommost space, `steps` = topmost (last) space.
// * `ExpStack.waiting` is true while a Scout is set aside for the Explore decision (the Scout still counts as active).
// * Decisions are raised for `s.leader` (the player who answers expedition choices in the Weather phase).
// * Deploy Scouts remembers the stack it used in `s.flags.expLast` so that `expeditionBonus:<res>:N` (C03, C07) can attach
//   its bonus to that stack.
import { ask, defOp, log, opt, push } from './core';
import { expeditions as expData, scenarioCards, weatherCards } from './data';
import { runFx } from './fx/core';
import { shuffle } from './rng';
import { bdef, cap, freeSupply, gainRes, hasBuilt, meepleById, techDone, toSupply } from './util';
import type { ExpStack, GameState } from './types';

/** Meeple kinds that may become a Scout (rulebook p26: Worker or Engineer only). */
export type ScoutKind = 'worker' | 'engineer';

export interface ExpOption {
  kind: 'return' | 'continue';
  next: string; // 'A' | 'B' | 'C' | 'newA' | 'remove' (S05) ; Continue: the deck to draw from
  label: string;
  fx: any[];
}
export interface ExpDef {
  id: string;
  letter: string; // A | B | C | S (scenario)
  steps: number;
  scenario: boolean;
  title: string;
  options: ExpOption[];
  onReach: any[];
}

/** Expedition card definition (X01-X40 from expeditions.json, S-cards from scenarios.json). */
export function expCardDef(id: string): ExpDef {
  const x = (expData as any)[id];
  if (x) {
    return {
      id,
      letter: x.letter,
      steps: x.steps,
      scenario: false,
      title: x.title ?? id,
      onReach: [],
      options: (x.options as any[]).map((o) => ({ kind: o.kind, next: o.next, label: o.label ?? '', fx: o.fx ?? [] })),
    };
  }
  const sc = (scenarioCards as any)[id];
  if (sc?.expedition) {
    return {
      id,
      letter: 'S',
      steps: sc.expedition.steps,
      scenario: true,
      title: sc.title ?? id,
      onReach: sc.onReach ?? [],
      options: ((sc.options ?? []) as any[]).map((o) => ({
        kind: 'return' as const,
        next: 'remove', // the scenario stack is removed on Return (no new A)
        label: o.text ?? 'Return to the city',
        fx: o.fx ?? [],
      })),
    };
  }
  throw new Error('Unknown expedition card ' + id);
}

export const expeditionTokens = ['placeTile', 'removeSnow', 'revealFar3AndReorder', 'removeSnowChildSpendFood', 'deployScouts', 'expeditionBonus', 'scoutsReturnNoReward', 'expedition'];

// ---- helpers ----------------------------------------------------------------------------------------------

const top = (e: ExpStack) => e.cards[e.cards.length - 1];
const find = (s: GameState, uid: number) => s.expeditions.find((e) => e.uid === uid);
const nextLetter = (letter: string): string | null => (letter === 'A' ? 'B' : letter === 'B' ? 'C' : null);
const deckOf = (s: GameState, letter: string): string[] | undefined =>
  letter === 'A' || letter === 'B' || letter === 'C' ? s.decks[('exp' + letter) as 'expA' | 'expB' | 'expC'] : undefined;
function drawFrom(s: GameState, letter: string): string | null {
  const d = deckOf(s, letter);
  return d && d.length ? (d.pop() as string) : null;
}
function newStack(s: GameState, ids: string[], scenario: boolean): ExpStack {
  return { uid: s.nextExp++, cards: ids.map((id) => ({ id, flipped: false, cont: null })), scout: null, scenario };
}
function stackLabel(e: ExpStack): string {
  const d = expCardDef(top(e).id);
  return `${d.title} (${d.letter === 'S' ? 'scenario' : d.letter}) - ${d.id}`;
}

/** Deck contents: X01-X14 = A, X15-X28 = B, X29-X40 = C; shuffled with the game RNG. */
export function initExpDecks(s: GameState) {
  for (const letter of ['A', 'B', 'C'] as const) {
    const ids = Object.values(expData as Record<string, any>)
      .filter((c) => c.letter === letter)
      .map((c) => c.id as string)
      .sort();
    s.decks[('exp' + letter) as 'expA' | 'expB' | 'expC'] = shuffle(s.rng, ids);
  }
}

/** Start of game: three stacks, each with one A card (white side up). */
export function setupExpeditions(s: GameState) {
  if (!s.decks.expA.length && !s.decks.expB.length && !s.decks.expC.length) initExpDecks(s);
  if (s.expeditions.length) return;
  for (let i = 0; i < 3; i++) {
    const id = drawFrom(s, 'A');
    if (!id) break;
    s.expeditions.push(newStack(s, [id], false));
  }
}
defOp('expSetup', (s) => setupExpeditions(s));

/** Expedition stack from a scenario effect (`expedition:place:<id>`, e.g. S02 places S05). */
export function placeExpedition(s: GameState, id: string) {
  const def = expCardDef(id);
  s.expeditions.push(newStack(s, [id], def.scenario));
  log(s, 'exp.place', `Expedition ${def.title} placed`, { id });
}

export function maxActiveExpeditions(s: GameState): number {
  const b = s.buildings.find((x) => x.kind === 'beacon' && !x.ruins);
  if (!b) return 0;
  const d = bdef('beacon') as any;
  return b.upgraded ? d.upgPassive?.expeditions ?? 2 : d.passive?.expeditions ?? 1;
}

/** Stacks a new Scout may go on: no Scout yet; `replaceWithB` (C05) also needs a non-scenario stack and a B card. */
function eligibleStacks(s: GameState, replaceWithB: boolean): ExpStack[] {
  return s.expeditions.filter((e) => !e.scout && (!replaceWithB || (!e.scenario && (deckOf(s, 'B')?.length ?? 0) > 0)));
}

/** Null when Deploy Scouts can be performed now, otherwise the reason (for the action menu). */
export function legalExpeditionDeploy(s: GameState, opts: { replaceWithB?: boolean; only?: ScoutKind } = {}): string | null {
  if (!hasBuilt(s, 'beacon')) return 'The Beacon must be built first';
  const pool: ScoutKind[] = opts.only ? [opts.only] : ['worker', 'engineer'];
  if (!pool.some((k) => freeSupply(s, k).length > 0)) return `No ${opts.only ? opts.only : 'Worker or Engineer'} in the supply`;
  if (s.expeditions.filter((e) => e.scout).length >= maxActiveExpeditions(s)) return 'Expedition limit reached';
  if (!eligibleStacks(s, !!opts.replaceWithB).length) return 'No free Expedition stack';
  return null;
}

/** Stack bonus: resources gained when the Scout returns from this stack. */
export function addStackBonus(s: GameState, e: ExpStack, kind: 'wood' | 'coal', n: number) {
  e.bonus = e.bonus ?? {};
  e.bonus[kind] = (e.bonus[kind] ?? 0) + n;
  log(s, 'exp.bonus', `${n} ${kind} will be gained when the Scout returns`, { uid: e.uid, kind, n });
}

/** `expeditionBonus:<wood|coal>:N` after `deployScouts`: the bonus goes with the stack the Scout was deployed to. */
export function expeditionBonus(s: GameState, kind: 'wood' | 'coal', n: number) {
  const uid = s.flags.expLast as number | null | undefined;
  if (uid == null) return;
  const e = find(s, uid);
  if (e && e.scout) addStackBonus(s, e, kind, n);
  else gainRes(s, kind, n); // the stack already returned: gain now
}

// ---- Deploy Scouts -----------------------------------------------------------------------------------------

/** Deploy a Worker or Engineer from the supply as a Scout (rulebook p26). `replaceWithB`: C05 replaces an empty stack first. */
/** `only`: a Citizen card that replaces the action only lets a Meeple of its own type become the Scout (ACT-CC1). */
export function deployScout(s: GameState, who: number, opts: { replaceWithB?: boolean; src?: string; only?: ScoutKind } = {}) {
  s.flags.expLast = null;
  const why = legalExpeditionDeploy(s, opts);
  if (why) {
    log(s, 'exp.deny', `Deploy Scouts not possible: ${why}`, {});
    return;
  }
  push(s, { k: 'expDeployMeeple', who, replace: !!opts.replaceWithB, src: opts.src, only: opts.only ?? null });
}

defOp('expDeployMeeple', (s, op) => {
  const kinds = (['worker', 'engineer'] as const).filter((k) => (!op.only || k === op.only) && freeSupply(s, k).length > 0);
  if (!kinds.length) return;
  ask(s, {
    who: op.who,
    kind: 'deployScout',
    prompt: 'Which Meeple becomes the Scout?',
    src: op.src,
    options: kinds.map((k) => opt(k, cap(k))),
    then: { k: 'expDeployStack', who: op.who, replace: op.replace, src: op.src },
    back: true,
  });
});

defOp('expDeployStack', (s, op) => {
  const kind = op.pick?.[0];
  if (!kind) return;
  const list = eligibleStacks(s, !!op.replace);
  if (!list.length) return;
  ask(s, {
    who: op.who,
    kind: 'expStack',
    prompt: 'Deploy the Scout on which Expedition stack?',
    src: op.src,
    options: list.map((e) => opt(String(e.uid), stackLabel(e))),
    then: { k: 'expDeployDo', kind, replace: op.replace, who: op.who, src: op.src },
    back: true,
  });
});

defOp('expDeployDo', (s, op) => {
  const uid = Number(op.pick?.[0]);
  const e = find(s, uid);
  const m = freeSupply(s, op.kind)[0];
  if (!e || e.scout || !m) return;
  if (op.replace) {
    const id = drawFrom(s, 'B');
    if (!id) return;
    log(s, 'exp.replace', `Expedition stack replaced by ${id}`, { uid });
    e.cards = [{ id, flipped: false, cont: null }];
    e.scenario = false;
    delete e.bonus;
  }
  m.loc = { k: 'scout', exp: uid };
  e.scout = { meeple: m.id, pos: 1 };
  s.flags.expLast = uid;
  log(s, 'exp.deploy', `Scout deployed on ${stackLabel(e)}`, { uid, meeple: m.id });
  if (techDone(s, 'T01')) push(s, { k: 'expMove', uid, n: 1 }); // Lighter Scout Sleds
});

// ---- Weather-phase movement ---------------------------------------------------------------------------------

/** Weather phase: every Scout moves by the drawn weather card's `scout` value. */
export function advanceScouts(s: GameState) {
  const card = (weatherCards as any[]).find((w) => w.id === s.weatherCard);
  const n = card?.scout ?? 0;
  if (n > 0) push(s, { k: 'expAdvance', n });
}

defOp('expAdvance', (s, op) => {
  const uids = s.expeditions
    .filter((e) => e.scout && !e.waiting)
    .map((e) => e.uid)
    .sort((a, b) => a - b);
  for (let i = uids.length - 1; i >= 0; i--) push(s, { k: 'expMove', uid: uids[i], n: op.n });
});

defOp('expMove', (s, op) => {
  const e = find(s, op.uid);
  if (!e || !e.scout || e.waiting || op.n <= 0) return;
  const steps = expCardDef(top(e).id).steps;
  const pos = e.scout.pos + op.n;
  if (pos < steps) {
    e.scout.pos = pos;
    return;
  }
  e.scout.pos = steps;
  log(s, 'exp.reach', `Scout reached the last space of ${top(e).id}`, { uid: e.uid });
  push(s, { k: 'expArrive', uid: e.uid, left: pos - steps });
});

/** The Scout reached the last space: S-cards run their onReach effects first, then the Skip / Explore decision. */
defOp('expArrive', (s, op) => {
  const e = find(s, op.uid);
  if (!e || !e.scout) return;
  const def = expCardDef(top(e).id);
  push(s, { k: 'expArriveChoice', uid: op.uid, left: op.left });
  if (def.onReach.length) runFx(s, def.onReach, { who: s.leader, src: `exp:${def.id}` });
});

defOp('expArriveChoice', (s, op) => {
  const e = find(s, op.uid);
  if (!e || !e.scout) return;
  const def = expCardDef(top(e).id);
  const next = nextLetter(def.letter);
  const skipOk = !def.scenario && !!next && (deckOf(s, next)?.length ?? 0) > 0;
  const why = def.scenario
    ? 'Scenario expeditions cannot be skipped'
    : !next
      ? 'C expeditions cannot be skipped'
      : 'No card left in the next deck';
  ask(s, {
    who: s.leader,
    kind: 'expArrive',
    prompt: `The Scout reached the last space of ${def.title}: Skip the location or Explore it?`,
    src: `exp:${def.id}`,
    options: [
      opt('skip', 'Skip the location', skipOk ? undefined : { disabled: why }),
      opt('explore', 'Explore the location'),
    ],
    then: { k: 'expArrivePick', uid: op.uid, left: op.left },
  });
});

defOp('expArrivePick', (s, op) => {
  const e = find(s, op.uid);
  if (!e || !e.scout) return;
  if (op.pick?.[0] === 'skip') doSkip(s, e, op.left as number);
  else doExplore(s, e);
});

/** Skip (A or B only): overlay the next letter's card, Scout to its first space, leftover movement is used on it. */
function doSkip(s: GameState, e: ExpStack, left: number) {
  const next = nextLetter(expCardDef(top(e).id).letter);
  const id = next ? drawFrom(s, next) : null;
  if (!id) {
    doExplore(s, e);
    return;
  }
  e.cards.push({ id, flipped: false, cont: null });
  e.scout!.pos = 1;
  log(s, 'exp.skip', `Location skipped: ${id} placed on top`, { uid: e.uid, id });
  if (left > 0) push(s, { k: 'expMove', uid: e.uid, n: left });
}

/** Explore: the top card turns black, the Scout is set aside, one option is chosen. */
function doExplore(s: GameState, e: ExpStack) {
  const t = top(e);
  const def = expCardDef(t.id);
  t.flipped = true;
  e.waiting = true;
  log(s, 'exp.explore', `Exploring ${def.title}`, { uid: e.uid, id: t.id });
  const options = def.options.map((o, i) => {
    const noDeck = o.kind === 'continue' && !(deckOf(s, o.next)?.length);
    return opt(String(i), o.label || o.kind, noDeck ? { disabled: 'no card left in the deck' } : undefined);
  });
  ask(s, {
    who: s.leader,
    kind: 'expExplore',
    prompt: `${def.title}: choose an option`,
    src: `exp:${def.id}`,
    options,
    then: { k: 'expChosen', uid: e.uid },
  });
}

defOp('expChosen', (s, op) => {
  const e = find(s, op.uid);
  if (!e) return;
  const t = top(e);
  const def = expCardDef(t.id);
  const idx = Number(op.pick?.[0]);
  const o = def.options[idx] ?? def.options.find((x) => x.kind === 'return');
  if (!o) return;
  const canContinue = o.kind === 'continue' && (deckOf(s, o.next)?.length ?? 0) > 0;
  if (canContinue) {
    // Continue: the black card stays, a new card is overlaid, the Scout starts it; remaining movement is lost
    const id = drawFrom(s, o.next) as string;
    t.cont = def.options.indexOf(o);
    e.waiting = false;
    e.cards.push({ id, flipped: false, cont: null });
    e.scout = { meeple: e.scout!.meeple, pos: 1 };
    log(s, 'exp.continue', `Expedition continued with ${id}`, { uid: e.uid, id });
    if (techDone(s, 'T01')) push(s, { k: 'expMove', uid: e.uid, n: 1 });
    return;
  }
  // Return: Scout to supply; the chosen option plus the Continue effects of the black cards below run as one list.
  const list = returnList(e, o);
  push(s, { k: 'expFinishReturn', uid: e.uid, next: o.next });
  runFx(s, list, { who: s.leader, src: `exp:${def.id}` });
  push(s, { k: 'expReturnScout', uid: e.uid });
});

/** Effects of a Return: the chosen option, then the Continue option of every black card below (top first). */
function returnList(e: ExpStack, o: ExpOption): any[] {
  const clean = (fx: any[]) => fx.filter((x) => x !== 'remove');
  const list: any[] = [...clean(o.fx)];
  for (let i = e.cards.length - 2; i >= 0; i--) {
    const c = e.cards[i];
    if (c.flipped && c.cont != null) list.push(...clean(expCardDef(c.id).options[c.cont]?.fx ?? []));
  }
  return list;
}

defOp('expReturnScout', (s, op) => {
  const e = find(s, op.uid);
  if (!e) return;
  if (e.scout) {
    const m = meepleById(s, e.scout.meeple);
    if (m) toSupply(s, m);
    log(s, 'exp.return', `Scout returned from ${top(e).id}`, { uid: e.uid });
  }
  e.scout = null;
  e.waiting = false;
});

/** After the Return effects: stack bonus, then the next stack (remove / newA / B or C overlay). */
defOp('expFinishReturn', (s, op) => {
  const e = find(s, op.uid);
  if (!e) return;
  if (e.bonus) {
    for (const k of ['wood', 'coal'] as const) {
      const n = e.bonus[k] ?? 0;
      if (n > 0) gainRes(s, k, n);
    }
    delete e.bonus;
  }
  const idx = s.expeditions.indexOf(e);
  if (op.next === 'remove' || e.scenario) {
    s.expeditions.splice(idx, 1);
    log(s, 'exp.remove', 'Expedition stack removed from the game', { uid: e.uid });
    return;
  }
  if (op.next === 'newA') {
    s.expeditions.splice(idx, 1);
    const id = drawFrom(s, 'A');
    if (id) s.expeditions.splice(idx, 0, newStack(s, [id], false));
    return;
  }
  if (op.next === 'B' || op.next === 'C') {
    for (const c of e.cards) {
      c.flipped = false;
      c.cont = null;
    }
    const id = drawFrom(s, op.next);
    if (id) e.cards.push({ id, flipped: false, cont: null });
    else log(s, 'exp.empty', `No ${op.next} card left`, {});
  }
});

// ---- scenario effects ------------------------------------------------------------------------------------

/** S04 Round 12: Scouts return without any reward. */
export function scoutsReturnNoReward(s: GameState) {
  for (const e of s.expeditions) {
    if (!e.scout) continue;
    const m = meepleById(s, e.scout.meeple);
    if (m) toSupply(s, m);
    e.scout = null;
    e.waiting = false;
    delete e.bonus;
  }
  log(s, 'exp.noreward', 'All Scouts returned without rewards', {});
}

defOp('expNoReward', (s) => scoutsReturnNoReward(s));
