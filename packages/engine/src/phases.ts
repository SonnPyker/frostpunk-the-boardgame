// Phase driver and the non-Action phases: Dawn, Morning, Generator, Weather, Preparation, Dusk, Hunger (rulebook p17-30;
// docs/ENGINE_SPEC.md §3.1, §6). The Action phase is ACTIONS' (op actStart); the Night is in night.ts.
//
// Round: Dawn -> Morning -> Generator -> Weather -> Preparation -> Action -> Dusk -> Hunger -> Night, then the next Dawn.
// Round 1 starts at the Action phase (setup pushes phStart{action}), so the first Dawn is Round 2.
//
// Decisions (see also docs/ENGINE_SPEC.md §3.8):
// * A phase body is an op sequence that ends with `phAdvance`. The Action body is `actStart` alone: ACTIONS pushes phAdvance.
// * The scenario hook `scnPhase` ({phase, when:'start'|'end'}) is pushed only when the op is registered. `phAdvance` runs the end
//   hook before it starts the next phase.
// * Hunger level = (hungerOver ? 25 : 0) + hunger. HUN-01 spend Food; HUN-02 table on the level (>= 25 loses) with deaths of the
//   PREVIOUS Round's type (round 1: current); HUN-03 feed the CURRENT Round's type, the shortfall is Hunger for the next phase.
//   HUN-04: feeding that reaches 25 flips the marker and keeps the excess.
// * Weather: A heat, B hunt Food and Technology / covering-Law lists, C Scouts, D Storm (`stormHit:<card.storm>` token).
// * Dawn triggers (Scenario Trigger tokens, Dawn text) resolve AFTER the Round marker moves (rulebook p17/p19): the
//   `scnPhase` end hook for `dawn` runs after `phDawn` has incremented the round.
// * Preparation: one Advisor per Round, chosen by Leadership (the stated Hope is exhausted first). Solo Call to Rise draws from
//   the table once, then the Preparation sickness check and resolution.
// * Dusk: the pending DUSK PHASE items in any order (the Leadership holder picks when there is more than one), then the Dusk card.
// * Call to Rise (solo) is an optional choice in each Preparation Phase until it is played; no Otherwise branch (card text).
import { ask, defOp, hasOp, lose, log, opt, push, pushSeq } from './core';
import * as D from './data';
import { advanceScouts } from './expedition';
import { advanceIndicators } from './generator';
import { describeList } from './fx/describe';
import { feasible, runFx } from './fx/core';
import type { Ctx } from './fx/core';
import { tokenTotal } from './hope';
import { passive, passiveEntries } from './laws';
import { eventRunItems, nightBody, runItems, steamHubStepOps } from './night';
import type { RunItem } from './night';
import { shuffle } from './rng';
import { killCitizen } from './sickness';
import { weatherFxRuns } from './tech';
import { roundType } from './types';
import type { CitizenType, GameState, Op, PhaseName } from './types';
import { citizenTypeOf, clamp, gainRes, huntingSymbols } from './util';

export const PHASE_ORDER: PhaseName[] = ['dawn', 'morning', 'generator', 'weather', 'preparation', 'action', 'dusk', 'hunger', 'night'];

export function nextPhase(p: PhaseName): PhaseName {
  const i = PHASE_ORDER.indexOf(p);
  if (i < 0) throw new Error('no phase follows ' + p);
  return PHASE_ORDER[(i + 1) % PHASE_ORDER.length];
}

// ---- Hunger level -----------------------------------------------------------------------------------------------------

export function hungerLevel(s: GameState): number {
  return (s.hungerOver ? 25 : 0) + s.hunger;
}

/** Sets the Hunger level (0..50). At 25 or more the marker is on the 25+ side and `hunger` keeps the excess. */
export function setHungerLevel(s: GameState, level: number) {
  const L = clamp(level, 0, 50);
  if (L >= 25) {
    s.hungerOver = true;
    s.hunger = L - 25;
  } else {
    s.hungerOver = false;
    s.hunger = L;
  }
}

// ---- decks -----------------------------------------------------------------------------------------------------------

/** Top card of a deck; an empty deck is reshuffled from its discard pile first. */
function drawFrom(s: GameState, deck: 'weather' | 'citizen'): string | null {
  const pile = deck === 'weather' ? s.decks.weather : s.decks.citizen;
  const discard = deck === 'weather' ? s.decks.weatherDiscard : s.decks.citizenDiscard;
  if (pile.length === 0) {
    if (discard.length === 0) return null;
    const fresh = shuffle(s.rng, discard.splice(0));
    if (deck === 'weather') s.decks.weather = fresh;
    else s.decks.citizen = fresh;
  }
  return (deck === 'weather' ? s.decks.weather : s.decks.citizen).pop() ?? null;
}

const weatherById = (id: string | null | undefined): any => (id ? D.weatherCards.find((w: any) => w.id === id) : undefined);

// ---- phase bodies -----------------------------------------------------------------------------------------------------

export function phaseBody(s: GameState, phase: PhaseName): Op[] {
  switch (phase) {
    // Steam Hub coal (Scenario Book, "at any time during the round") is offered at the start of every phase that
    // precedes the Generator phase's Stress step, as well as Dusk and Hunger. The Generator phase itself offers none.
    case 'dawn':
      return [...steamHubStepOps(s), { k: 'phDawn' }, { k: 'techDawnCheck' }, { k: 'phAdvance' }];
    case 'morning':
      return [...steamHubStepOps(s), { k: 'morningDraw' }, { k: 'phAdvance' }];
    case 'generator':
      return [{ k: 'phGenerator' }, { k: 'phAdvance' }];
    case 'weather':
      return [...steamHubStepOps(s), { k: 'phWeather' }, { k: 'phAdvance' }];
    case 'preparation':
      return [...steamHubStepOps(s), { k: 'phPrepAdvisor' }, { k: 'phCallToRise' }, { k: 'phSicknessResolve' }, { k: 'phAdvance' }];
    case 'action':
      return [{ k: 'actStart' }];
    case 'dusk':
      return [...steamHubStepOps(s), { k: 'duskRuns', items: eventRunItems(s, 'dusk', 'now') }, { k: 'duskDraw' }, { k: 'phAdvance' }];
    case 'hunger':
      return [...steamHubStepOps(s), { k: 'phHungerSpend' }, { k: 'phHungerResolve' }, { k: 'phAdvance' }];
    case 'night':
      return nightBody(s);
    default:
      throw new Error('no phase body for ' + phase);
  }
}

// ---- the driver -------------------------------------------------------------------------------------------------------

defOp('phStart', (s, op) => {
  const phase = op.phase as PhaseName;
  s.phase = phase;
  log(s, 'phase', `${phase.charAt(0).toUpperCase()}${phase.slice(1)} phase`, { phase });
  const hook: Op[] = hasOp('scnPhase') ? [{ k: 'scnPhase', phase, when: 'start' }] : [];
  pushSeq(s, ...hook, ...phaseBody(s, phase));
});

defOp('phAdvance', (s, op) => {
  if (s.status !== 'playing') return;
  if (!op.ended) {
    push(s, { k: 'phAdvance', ended: true });
    if (hasOp('scnPhase')) push(s, { k: 'scnPhase', phase: s.phase, when: 'end' });
    return;
  }
  push(s, { k: 'phStart', phase: nextPhase(s.phase) });
});

/** Dawn (DAW-02, DAW-03 queued by the body): the Round marker moves, Leadership passes clockwise, per-Round state resets. */
defOp('phDawn', (s) => {
  s.round += 1;
  if (s.players.length > 1) s.leader = (s.leader + 1) % s.players.length;
  s.turn = s.leader;
  s.passes = 0;
  s.usedSpaces = [];
  s.advisorUsedThisRound = false;
  s.gen.fuelUsedThisPhase = 0;
  for (const p of s.players) p.playedCitizen = null;
  for (const e of s.events) e.usedThisRound = false;
  for (const m of s.meeples) delete m.used;
  log(s, 'round', `Round ${s.round} begins`, { round: s.round });
});

defOp('phGenerator', (s) => {
  push(s, { k: 'generatorPhase' });
});

defOp('phSicknessResolve', (s) => {
  push(s, { k: 'sicknessResolve', done: [] });
});

// ---- Weather (WEA-01..06) ---------------------------------------------------------------------------------------------

defOp('phWeather', (s) => {
  const id = drawFrom(s, 'weather');
  const card = weatherById(id);
  s.weatherCard = id;
  s.weatherHunt = card?.hunt ?? 0;
  if (id) {
    s.decks.weatherDiscard.push(id);
    log(s, 'weather.card', `Weather card ${id} revealed`, { card: id });
  } else log(s, 'weather.none', 'No Weather card left to reveal', {});
  pushSeq(
    s,
    card ? { k: 'phWxHeat', id } : null,
    card ? { k: 'phWxHunt', id } : null,
    card ? { k: 'phWxFx' } : null,
    card ? { k: 'phWxScout' } : null,
    { k: 'phWxStorm', id: card ? id : null },
  );
});

/** A: advance the Cold marker and the Yellow / Orange / Red indicators (heat = [cold, yellow, orange, red]). */
defOp('phWxHeat', (s, op) => {
  const c = weatherById(op.id);
  if (!c) return;
  const [cold, yellow, orange, red] = c.heat ?? [0, 0, 0, 0];
  advanceIndicators(s, { cold, yellow, orange, red });
});

/** B: Food per Hunting symbol. */
defOp('phWxHunt', (s, op) => {
  const c = weatherById(op.id);
  if (!c) return;
  gainRes(s, 'food', (c.hunt ?? 0) * huntingSymbols(s));
});

/** B (cont.): developed Technology weather effects and covering Law Consequences. */
defOp('phWxFx', (s) => {
  const items: RunItem[] = weatherFxRuns(s).map((r) => ({ list: r.list, ctx: { who: s.leader, src: r.src, card: r.card } }));
  runItems(s, items);
});

/** C: every Scout moves by the card's scout value. */
defOp('phWxScout', (s) => {
  advanceScouts(s);
});

/**
 * D: the Storm marker moves back by the card's storm value and, on or behind the Round marker, a Storm hits. Both steps are
 * the `stormHit:<N>` token (fx/tokens_scenario.ts -> applyStorm in scenario.ts), so the Storm card branch is ordinary fx.
 */
defOp('phWxStorm', (s, op) => {
  const c = weatherById(op.id);
  runFx(s, [`stormHit:${c?.storm ?? 0}`], { who: s.leader, src: 'weather:' + op.id });
});

// ---- Preparation (PRE-01..05) -----------------------------------------------------------------------------------------

/** PRE-01: Leadership chooses one Advisor of the players (or none). The stated Hope is exhausted by the advisor's cost. */
defOp('phPrepAdvisor', (s) => {
  const holders = s.players.map((p, i) => ({ p, i })).filter((x) => !!x.p.advisor && !!D.advisors[x.p.advisor!]);
  if (holders.length === 0) return;
  const options = [opt('none', 'No Advisor this Round')];
  for (const { p, i } of holders) {
    const a = D.advisors[p.advisor!];
    const why = feasible(s, a.cost ?? [], { who: s.leader, src: 'adv:' + a.id });
    options.push(opt(`p${i}`, `${a.title} (${p.name})`, { hint: describeList(a.fx ?? []), disabled: why ?? undefined }));
  }
  ask(s, {
    who: s.leader,
    kind: 'advisor',
    prompt: 'Use an Advisor this Round?',
    options,
    then: { k: 'phPrepAdvisorDo' },
  });
});

defOp('phPrepAdvisorDo', (s, op) => {
  const id: string | undefined = op.pick?.[0];
  if (!id || id === 'none') return;
  const p = s.players[Number(id.slice(1))];
  const a = p ? D.advisors[p.advisor!] : undefined;
  if (!a) return;
  s.advisorUsedThisRound = true;
  log(s, 'advisor', `${a.title} is used`, { advisor: a.id });
  runFx(s, [...(a.cost ?? []), ...(a.fx ?? [])], { who: s.leader, src: 'adv:' + a.id });
});

/** The Hope-table row Call to Rise uses for this many active Hope tokens (undefined below the lowest row). */
function callToRiseRow(hope: number): { minHope: number; draw: number } | undefined {
  const rows: { minHope: number; draw: number }[] = [...(D.callToRise.table ?? [])].sort((a: any, b: any) => a.minHope - b.minHope);
  return rows.filter((r) => hope >= r.minHope).pop();
}

/**
 * PRE-03: solo Call to Rise (rulebook p31, "may be used in the Preparation Phase"). The solo player decides whether to play
 * it now or keep it for a later Preparation Phase; playing it needs at least 1 Hope token. The card is removed after use.
 */
defOp('phCallToRise', (s) => {
  if (s.config.mode !== 'solo' || s.callToRiseUsed || s.players.length === 0) return;
  const hope = tokenTotal(s, 'hope');
  const row = callToRiseRow(hope);
  ask(s, {
    who: 0,
    kind: 'choice',
    prompt: 'Call to Rise: play the card now, or keep it for a later Preparation Phase?',
    src: 'call:rise',
    options: [
      opt('play', row ? `Play Call to Rise (draw ${row.draw} Citizen card${row.draw > 1 ? 's' : ''})` : 'Play Call to Rise', {
        hint: row ? `${hope} Hope token(s) active` : undefined,
        disabled: row ? undefined : 'Needs at least 1 Hope token',
      }),
      opt('keep', 'Keep it for a later Preparation Phase'),
    ],
    then: { k: 'phCallToRiseDo' },
  });
});

defOp('phCallToRiseDo', (s, op) => {
  if (op.pick?.[0] !== 'play' || s.callToRiseUsed) return;
  const hope = tokenTotal(s, 'hope');
  const row = callToRiseRow(hope);
  if (!row) return;
  s.callToRiseUsed = true;
  const hand = s.players[0].hand;
  let drawn = 0;
  for (let i = 0; i < row.draw; i++) {
    const id = drawFrom(s, 'citizen');
    if (!id) break;
    hand.push(id);
    drawn++;
  }
  log(s, 'call.rise', `Call to Rise: ${drawn} Citizen card(s) drawn`, { hope, drawn });
});

// ---- Dusk (DUS-01) ----------------------------------------------------------------------------------------------------
// The Dusk body (phaseBody 'dusk') runs the pending DUSK PHASE items through duskRuns, then duskDraw (cards.ts).

/**
 * DUS-01 (rulebook p27): the DUSK PHASE effects of the Scenario and Event displays resolve "in any order". With more than one
 * item pending, the Leadership holder picks which resolves next (asked one item at a time); a single item needs no decision.
 * Items whose Event card has left the display are dropped first.
 */
defOp('duskRuns', (s, op) => {
  const items: RunItem[] = (op.items ?? []).filter((it: RunItem) => it.uid === undefined || s.events.some((e) => e.uid === it.uid));
  if (items.length === 0) return;
  if (items.length === 1) {
    push(s, { k: 'ntRuns', items });
    return;
  }
  ask(s, {
    who: s.leader,
    kind: 'choice',
    prompt: 'Dusk: which DUSK PHASE effect resolves next?',
    src: 'phase:dusk',
    options: items.map((it, i) => opt(String(i), `${(D.dusk as any)[it.ctx.card ?? '']?.title ?? it.ctx.card ?? 'Event'} (DUSK PHASE)`)),
    then: { k: 'duskPick', items },
  });
});

defOp('duskPick', (s, op) => {
  const items: RunItem[] = op.items ?? [];
  const i = Number(op.pick?.[0]);
  if (!Number.isInteger(i) || i < 0 || i >= items.length) return;
  push(s, { k: 'duskRuns', items: items.filter((_, j) => j !== i) });
  push(s, { k: 'ntRuns', items: [items[i]] });
});

// ---- Hunger (HUN-01..05) ----------------------------------------------------------------------------------------------

/** HUN-01 start: optional L03 (once per Round), then Food spent to reduce Hunger. */
defOp('phHungerSpend', (s) => {
  const ctx: Ctx = { who: s.leader, src: 'law:L03' };
  push(s, { k: 'phFoodSpend' });
  const l03 = passiveEntries(s, 'hungerStartOncePerRound')[0]?.data;
  if (!l03) return;
  if (feasible(s, [l03.pay], ctx)) return;
  ask(s, {
    who: s.leader,
    kind: 'choice',
    prompt: 'Food Additives (L03): use it this Hunger phase?',
    src: 'law:L03',
    options: [
      opt('yes', 'Use Food Additives', { hint: describeList([l03.pay, ...(l03.fx ?? [])]) }),
      opt('no', 'Do not use'),
    ],
    then: { k: 'phL03', pay: l03.pay, fx: l03.fx ?? [], ctx },
  });
});

defOp('phL03', (s, op) => {
  if (op.pick?.[0] !== 'yes') return;
  log(s, 'law.l03', 'Food Additives used', {});
  runFx(s, [op.pay, ...op.fx], op.ctx);
});

defOp('phFoodSpend', (s) => {
  const level = hungerLevel(s);
  const n = Math.min(s.food, level);
  if (n <= 0) return;
  s.food -= n;
  setHungerLevel(s, level - n);
  log(s, 'hunger.spend', `Spent ${n} Food to reduce Hunger`, { n });
});

/** HUN-02: the table, then the feeding (HUN-03). Feeding happens last so that its Hunger carries into the next Hunger phase. */
defOp('phHungerResolve', (s) => {
  const level = hungerLevel(s);
  if (level >= 25) {
    lose(s, 'Hunger reached 25 or more after spending Food.');
    return;
  }
  const prevType: CitizenType = s.round > 1 ? roundType(s.round - 1) : roundType(s.round);
  const deaths = Math.floor(level / 5);
  push(s, { k: 'phFeed' });
  if (deaths > 0) push(s, { k: 'phHungerDeaths', n: deaths, t: prevType });
  if (level > 0) runFx(s, ['disc+1'], { who: s.leader, src: 'phase:hunger' });
  const parts: string[] = [];
  if (level > 0) parts.push('+1 Discontent');
  if (deaths > 0) parts.push(`${deaths} ${prevType} Citizen(s) die`);
  log(s, 'hunger.table', `Hunger ${level}: ${parts.length ? parts.join(', ') : 'no effect'}`, { level, deaths, prevType });
});

defOp('phHungerDeaths', (s, op) => {
  if (op.n <= 0) return;
  push(s, { k: 'phHungerDeaths', n: op.n - 1, t: op.t });
  killCitizen(s, op.t, false, s.leader);
});

/** HUN-03: 1 Food per Citizen of the current Round's type (minus L16 per Meeple of that type). Each missing Food = +1 Hunger. */
defOp('phFeed', (s) => {
  setHungerLevel(s, 0);
  const cur = roundType(s.round);
  const reduce = passive(s, 'foodCostMinusPerCurrentTypeMeeple');
  const meeplesOfType = s.meeples.filter((m) => citizenTypeOf(m.kind) === cur).length;
  const cost = Math.max(0, s.cit[cur] - reduce * meeplesOfType);
  const paid = Math.min(s.food, cost);
  if (paid > 0) {
    s.food -= paid;
    log(s, 'feed', `Fed ${paid} ${cur} Citizen(s) with Food`, { n: paid, type: cur });
  }
  const missing = cost - paid;
  if (missing > 0) {
    setHungerLevel(s, missing);
    log(s, 'feed.short', `${missing} ${cur} Citizen(s) unfed: +${missing} Hunger`, { n: missing, type: cur });
  }
});
