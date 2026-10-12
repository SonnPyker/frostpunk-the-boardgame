// SCENARIO module (wave 3): scenario setup, scenario cards S01-S09, Dawn triggers, Stockpile, Storm hits, end checks.
// Ops (global names, prefix scn*): scnPhase, scnOptions, scnOptionApply, scnStock, scnStockPick, scnNightSleepApply.
// FX tokens that drive this module are registered in fx/tokens_scenario.ts. Card data: data/raw/scenarios.json.
// Rules: docs/rules_text/196D49D479 (Scenario Book) > 5B9201D39C (Rulebook); card text beats both (see scenarios.json note).
import { ask, askDistribute, defOp, log, opt, push, win } from './core';
import { evalCond, runFx } from './fx/core';
import type { Ctx } from './fx/core';
import { scenarioCards, scenarioStart, scenarios, techs } from './data';
import { flipToRuins, sleepSlots } from './buildings';
import { removeIndicator, advanceIndicators } from './generator';
import { addSick } from './sickness';
import { bdef, citizenTypeOf, lawActive, spendRes, techDone, typeName } from './util';
import { shuffle } from './rng';
import { CITIZEN_TYPES } from './types';
import type { CitizenType, GameState } from './types';

/** Scenario cards that carry Stockpile markers (S03 3 slots, S07 6 slots; mutually exclusive). */
export const STOCK_CARDS = ['S03', 'S07'] as const;
/**
 * Steel in the bank at the start of Dreadnought (Scenario Book p7: "Place the Steel in the bank at the start of the game").
 * The bank is not modelled as a counter: the supply starts at 0 and gains are capped by LIMITS.steel (components, 8).
 */
export const DREADNOUGHT_STEEL = 8;

type Counts = Record<CitizenType, number>;
interface Slots {
  general: number; // any Citizen
  child: number; // Child Shelter: children only
  engineer: number; // T12 engineer slot: engineers only
}

// ---- accessors --------------------------------------------------------------------------------------------

export function scenarioDef(id: string): any {
  const d = (scenarioCards as Record<string, any>)[id];
  if (!d) throw new Error('Unknown scenario card ' + id);
  return d;
}

/** scenarioState keys used across the engine: revealed (evalCond), rations (gain perFoodRation), coalStocks (sickAll), specialUsed. */
function scn(s: GameState) {
  const x = s.scenarioState;
  if (!Array.isArray(x.revealed)) x.revealed = [];
  if (typeof x.rations !== 'number') x.rations = 0;
  if (typeof x.coalStocks !== 'number') x.coalStocks = 0;
  if (!x.specialUsed) x.specialUsed = {};
  return x;
}

function cardCtx(s: GameState, id: string, who: number): Ctx {
  return { who, src: 'scn:' + id, card: id };
}

// ---- setup --------------------------------------------------------------------------------------------------

/**
 * Scenario setup (rulebook setup p13-15, Scenario Book): S01 face up with its Scenario Trigger tokens (4 and 11),
 * Storm card and Storm marker (9), scenario state reset, Technology display adjusted (T09 removed unless fixed),
 * Idempotent: running it twice leaves the same state. Pushes no ops. (Dreadnought Steel starts in the bank, not the supply.)
 */
export function scenarioSetup(s: GameState) {
  const sc = (scenarios as Record<string, any>)[s.config.scenario];
  if (!sc || sc.status !== 'playable') throw new Error('Scenario not playable: ' + s.config.scenario);
  s.round = scenarioStart.round ?? 1;
  s.stormMarker = scenarioStart.stormMarker ?? null;
  s.stormCard = sc.stormCard;
  s.stormsHit = 0;
  s.scenarioDisplay = [];
  s.triggers = [];
  s.scenarioState = { revealed: [], rations: 0, coalStocks: 0, specialUsed: {} };
  for (const id of scenarioStart.scenarioDisplay ?? []) placeScenarioCard(s, id, s.leader, false);
  setupTechDisplay(s, sc);
  log(s, 'scn.setup', `Scenario ${sc.name} set up`, { scenario: s.config.scenario, storm: s.stormCard });
}

function setupTechDisplay(s: GameState, sc: any) {
  const td = sc.technologyDisplay;
  const fixed: string[] = td.fixed ?? [];
  const excluded = [...(td.excluded ?? []), ...(scenarioStart.removeTechnologies ?? [])].filter((id: string) => !fixed.includes(id));
  s.techs = s.techs.filter((t) => !excluded.includes(t.id));
  for (const id of fixed) if (!s.techs.some((t) => t.id === id)) s.techs.push({ id, state: 'inactive', dueRound: null });
  const target = fixed.length + Number(td.random ?? 0);
  const pool = Object.keys(techs).filter(
    (id) =>
      !excluded.includes(id) &&
      !fixed.includes(id) &&
      !s.techs.some((t) => t.id === id) &&
      (s.config.extraPack || techs[id].pack !== 'extra'),
  );
  const picks = shuffle(s.rng, pool);
  while (s.techs.length < target && picks.length) {
    s.techs.push({ id: picks.shift()!, state: 'inactive', dueRound: null });
  }
}

// ---- scenario cards: place / resolve / remove -----------------------------------------------------------

function addTrigger(s: GameState, card: string, idx: number) {
  if (s.triggers.some((t) => t.card === card && t.idx === idx)) return;
  s.triggers.push({ round: scenarioDef(card).triggers[idx].round, card, idx });
}

/** `trigger:<round>` token: place the card's Scenario Trigger token on that Round (deduplicated). */
export function addTriggerToken(s: GameState, round: number, card: string) {
  const idx = (scenarioDef(card).triggers ?? []).findIndex((t: any) => t.round === round);
  if (idx < 0) throw new Error(`${card} has no Scenario Trigger on Round ${round}`);
  addTrigger(s, card, idx);
}

/**
 * `scenario:place:<id>`: place the card face up in the Scenario display, mark it revealed, place its Scenario Trigger
 * tokens and run its onPlace effects (unless runOnPlace is false).
 */
export function placeScenarioCard(s: GameState, id: string, who: number = s.leader, runOnPlace = true) {
  const def = scenarioDef(id);
  const x = scn(s);
  if (!s.scenarioDisplay.includes(id)) s.scenarioDisplay.push(id);
  if (!x.revealed.includes(id)) x.revealed.push(id);
  (def.triggers ?? []).forEach((_: any, idx: number) => addTrigger(s, id, idx));
  log(s, 'scn.place', `${def.title} placed face up`, { card: id });
  if (runOnPlace && def.onPlace?.length) runFx(s, def.onPlace, cardCtx(s, id, who));
}

/**
 * `scenario:resolve:<id>`: reveal the card now, run its onResolve effects, then (if it has options) let the leader
 * choose one. onResolve runs first because the option decision is pushed underneath it.
 */
export function resolveScenarioCard(s: GameState, id: string, who: number = s.leader) {
  const def = scenarioDef(id);
  const x = scn(s);
  if (!x.revealed.includes(id)) x.revealed.push(id);
  if (!s.scenarioDisplay.includes(id)) s.scenarioDisplay.push(id);
  log(s, 'scn.resolve', `${def.title} resolved`, { card: id });
  if ((def.options ?? []).some((o: any) => !o.kind)) push(s, { k: 'scnOptions', card: id, who, src: 'scn:' + id });
  runFx(s, def.onResolve, cardCtx(s, id, who));
}

/** `scenario:remove:<id>`: take the card out of the Scenario display (Stockpile markers leave with S03/S07). */
export function removeScenarioCard(s: GameState, id: string) {
  if (!s.scenarioDisplay.includes(id)) return;
  s.scenarioDisplay = s.scenarioDisplay.filter((c) => c !== id);
  if ((STOCK_CARDS as readonly string[]).includes(id)) {
    const x = scn(s);
    x.rations = 0;
    x.coalStocks = 0;
  }
  log(s, 'scn.remove', `${scenarioDef(id).title} removed from the Scenario display`, { card: id });
}

defOp('scnOptions', (s, op) => {
  const def = scenarioDef(op.card);
  const options = (def.options ?? []).filter((o: any) => !o.kind);
  if (!options.length) return;
  ask(s, {
    who: op.who,
    kind: 'scenario',
    prompt: `${def.title}: choose one option`,
    src: op.src,
    options: options.map((o: any) => opt(o.id, o.text)),
    then: { k: 'scnOptionApply', card: op.card, who: op.who, src: op.src },
  });
});

defOp('scnOptionApply', (s, op) => {
  const def = scenarioDef(op.card);
  const o = (def.options ?? []).find((x: any) => x.id === op.pick?.[0]);
  if (!o) return;
  runFx(s, o.fx, { who: op.who, src: op.src, card: op.card });
});

// ---- Dawn triggers and persistent Dawn text --------------------------------------------------------------

/**
 * Dawn (round start): fire every Scenario Trigger whose Round has been reached (token removed first), then the Dawn
 * text of the face-up scenario cards (S06). A trigger with `replacesRound` runs its steps in order instead of the
 * normal round; its last step (`victory`) ends the game, which clears the stack, so the normal Dawn/Morning never runs.
 */
export function fireDawnTriggers(s: GameState) {
  s.flags.sheltersAllHeated = false;
  // the Round counter advances one step at a time, so a trigger fires exactly on its own Dawn
  const due = s.triggers.filter((t) => t.round === s.round);
  s.triggers = s.triggers.filter((t) => t.round !== s.round);
  const lists: { list: any[]; ctx: Ctx }[] = [];
  for (const t of due) {
    const card = scenarioDef(t.card);
    const trig = (card.triggers ?? [])[t.idx];
    if (!trig) continue;
    const ctx: Ctx = { who: s.leader, src: `scn:${t.card}:r${t.round}`, card: t.card, trig };
    log(s, 'scn.trigger', `${card.title}: ${trig.label ?? 'Scenario Trigger'}`, { card: t.card, round: t.round });
    const list = trig.replacesRound ? (trig.steps ?? []).flatMap((x: any) => x.fx ?? []) : trig.fx ?? [];
    lists.push({ list, ctx });
  }
  for (const id of s.scenarioDisplay.slice()) {
    const dawn = scenarioDef(id).dawn;
    if (dawn?.length) lists.push({ list: dawn, ctx: { who: s.leader, src: `scn:${id}:dawn`, card: id } });
  }
  // runFx pushes onto a LIFO stack: push in reverse so the first trigger runs first
  for (let i = lists.length - 1; i >= 0; i--) runFx(s, lists[i].list, lists[i].ctx);
}

/**
 * Scenario hook called by PHASES at the start/end of each phase (only when this op exists). Dawn triggers run at the END
 * of Dawn: the Round marker has already moved (phDawn), and the rulebook resolves Scenario Trigger tokens after that move.
 */
defOp('scnPhase', (s, op) => {
  if (op.phase !== 'dawn' || op.when !== 'end') return;
  if (s.status !== 'playing') return;
  checkEnd(s);
  if (s.status !== 'playing') return;
  fireDawnTriggers(s);
});

/**
 * Scenario end check: reports the game status. The rulebook has no round limit (p16, p30: the game ends only by a lose
 * condition or by completing the scenario goal). Every scenario reaches its goal at S04 (Round 12) with `victory`.
 */
export function checkEnd(s: GameState): 'playing' | 'won' | 'lost' {
  return s.status === 'playing' ? 'playing' : s.status;
}

// ---- Storm -------------------------------------------------------------------------------------------------

/** Heat range helpers for the `heatRange:` token family. */
export function heatRemove(s: GameState, k: 'red' | 'orange' | 'yellow') {
  if (s.gen.ind[k] != null) removeIndicator(s, k);
}
export function heatAdvance(s: GameState, k: 'cold' | 'red' | 'orange' | 'yellow', n: number) {
  if (n <= 0) return;
  advanceIndicators(s, { [k]: n });
}

/** Flip every Building of the kind (Tents, Bunkhouses) that is not yet Ruins. Returns how many flipped. */
export function flipAllToRuins(s: GameState, kind: string): number {
  let n = 0;
  for (const b of s.buildings.slice()) if (b.kind === kind && !b.ruins && flipToRuins(s, b.uid)) n++;
  if (!n) log(s, 'ruins.none', `No ${kind} to flip to Ruins`, { kind });
  return n;
}

/**
 * Weather section D (rulebook p21): move the Storm marker back by the card's `storm` value. If it is now on or before
 * the Round marker a Storm hits: the Storm card branch matching the current Round runs (card text decides by Round).
 * A null marker means no more Storms.
 */
export function applyStorm(s: GameState, back: number, who: number = s.leader) {
  if (s.stormMarker == null) {
    log(s, 'storm.none', 'No Storm marker left: no Storm can hit', {});
    return;
  }
  s.stormMarker = Math.max(0, s.stormMarker - back);
  log(s, 'storm.move', `Storm marker moved ${back} back to ${s.stormMarker}`, { n: s.stormMarker });
  if (s.stormMarker > s.round) return;
  const card = scenarioDef(s.stormCard);
  const ctx: Ctx = { who, src: 'storm:' + card.id, card: card.id };
  s.stormsHit++;
  const br = (card.branches ?? []).find((b: any) => evalCond(s, b.if, ctx));
  log(s, 'storm.hit', `A Storm hits (${card.title})`, { card: card.id, round: s.round, hit: s.stormsHit });
  if (br) runFx(s, br.fx, ctx);
}

// ---- Frostbite / night sleep (S04 Round 12) ----------------------------------------------------------------

/** Warm sleeping places for the Frostbite. Normal rules use sleepSlots (heated shelters); shelters:allHeated adds the rest. */
function warmSlots(s: GameState): Slots {
  const sl: Slots = { general: 0, child: 0, engineer: 0 };
  const seen = new Set<number>();
  for (const x of sleepSlots(s)) {
    sl.general += x.capacity;
    sl.child += x.childCapacity;
    sl.engineer += x.engineerCapacity;
    seen.add(x.uid);
  }
  if (!s.flags.sheltersAllHeated) return sl;
  for (const b of s.buildings) {
    if (seen.has(b.uid) || b.kind === 'prison') continue;
    if (b.ruins) {
      if (lawActive(s, 'L06')) sl.general += 1; // Ruins stay unusable unless a Law says otherwise
      continue;
    }
    const d: any = bdef(b.kind);
    let cap: number = d.shelter ?? 0;
    const ch: number = d.shelterChildren ?? 0;
    const eng = techDone(s, 'T12') && (b.kind === 'medicalPost' || b.kind === 'infirmary') ? 1 : 0;
    if (!cap && !ch && !eng) continue;
    if (cap && lawActive(s, 'L05')) cap += 1;
    sl.general += cap;
    sl.child += ch;
    sl.engineer += eng;
  }
  return sl;
}

function citizenCounts(s: GameState): Counts {
  const c: Counts = { worker: 0, engineer: 0, child: 0 };
  for (const m of s.meeples) {
    if (m.loc.k === 'supply' || m.loc.k === 'spent' || m.loc.k === 'scout' || m.loc.k === 'bank') continue;
    const t = citizenTypeOf(m.kind);
    if (t) c[t]++;
  }
  return c;
}

/** Overflow rule: children use Child Shelter slots first, engineers the T12 slot first, the rest share general slots. */
function sheltersFit(c: Counts, sl: Slots, u: Counts, U: number): boolean {
  for (const t of CITIZEN_TYPES) if (u[t] < 0 || u[t] > c[t]) return false;
  if (u.worker + u.engineer + u.child !== U) return false;
  const sc = c.child - u.child;
  const se = c.engineer - u.engineer;
  const sw = c.worker - u.worker;
  return Math.max(0, sc - sl.child) + Math.max(0, se - sl.engineer) + sw <= sl.general;
}

/** All unsheltered distributions of exactly U Citizens that leave every other Citizen a warm place, worker-first. */
function unshelteredOptions(c: Counts, sl: Slots, U: number): Counts[] {
  const out: Counts[] = [];
  for (let uw = c.worker; uw >= 0; uw--) {
    for (let ue = c.engineer; ue >= 0; ue--) {
      const uc = U - uw - ue;
      if (uc < 0 || uc > c.child) continue;
      const u = { worker: uw, engineer: ue, child: uc };
      if (sheltersFit(c, sl, u, U)) out.push(u);
    }
  }
  return out;
}

/**
 * S04 Frostbite: each Citizen Meeple without a warm place to sleep gains `perU` sick Citizens of its type.
 * The leader chooses which Citizens are left out (askDistribute); an invalid choice falls back to the first valid one.
 */
export function nightSleepSick(s: GameState, ctx: Ctx, perU = 3) {
  const c = citizenCounts(s);
  const total = c.worker + c.engineer + c.child;
  const sl = warmSlots(s);
  const maxWarm =
    Math.min(c.child, sl.child) +
    Math.min(c.engineer, sl.engineer) +
    Math.min(c.worker + Math.max(0, c.child - sl.child) + Math.max(0, c.engineer - sl.engineer), sl.general);
  const U = total - maxWarm;
  if (U <= 0) {
    log(s, 'scn.warm', 'Every Citizen Meeple has a warm place to sleep', {});
    return;
  }
  const options = CITIZEN_TYPES.filter((t) => c[t] > 0).map((t) => ({
    id: t,
    label: `${typeName(t)} without a warm place`,
    cap: c[t],
  }));
  askDistribute(s, {
    who: ctx.who,
    kind: 'sleep',
    prompt: `Choose ${U} Citizen Meeple(s) without a warm place to sleep (each gains ${perU} sick of its type)`,
    options,
    count: U,
    then: { k: 'scnNightSleepApply', counts: c, slots: sl, U, perU, who: ctx.who, src: ctx.src },
    src: ctx.src,
  });
}

defOp('scnNightSleepApply', (s, op) => {
  const c: Counts = op.counts;
  const sl: Slots = op.slots;
  const U: number = op.U;
  const picked: Counts = { worker: 0, engineer: 0, child: 0 };
  for (const id of op.pick ?? []) if (id in picked) picked[id as CitizenType]++;
  let u = picked;
  if (!sheltersFit(c, sl, picked, U)) {
    const alt = unshelteredOptions(c, sl, U)[0];
    log(s, 'scn.warm', 'The chosen split leaves a Citizen without a place it could use; the first valid split is used', {});
    if (alt) u = alt;
  }
  for (const t of CITIZEN_TYPES) if (u[t] > 0) addSick(s, t, u[t] * op.perU, op.who);
  log(s, 'scn.frostbite', `Frostbite: ${U} Citizen(s) without a warm place gain ${op.perU} sick each`, { u });
});

// ---- Stockpile (S03 / S07 special action) -------------------------------------------------------------------

/**
 * Special action of S03 / S07 (ACTIONS calls it through the custom:stockpile token with ctx.card 'S03' or 'S07').
 * Once per Round. Spend Food (3 per Food Ration marker) and/or Coal (2 per Coal Stock marker) while markers fit the slots.
 */
export function stockpileAction(s: GameState, ctx: Ctx) {
  const x = scn(s);
  const id =
    ctx.card && (STOCK_CARDS as readonly string[]).includes(ctx.card)
      ? ctx.card
      : s.scenarioDisplay.find((c) => (STOCK_CARDS as readonly string[]).includes(c));
  if (!id || !s.scenarioDisplay.includes(id)) {
    log(s, 'scn.stock', 'No Stockpile card is in play', {});
    return;
  }
  if (x.specialUsed[id] === s.round) {
    log(s, 'scn.stock', 'This Stockpile was already used this Round', { card: id });
    return;
  }
  x.specialUsed[id] = s.round;
  const slots = scenarioDef(id).stockpile.slots;
  push(s, { k: 'scnStock', card: id, who: ctx.who ?? s.leader, src: ctx.src ?? 'scn:' + id, slots });
}

defOp('scnStock', (s, op) => {
  if (s.status !== 'playing') return;
  const x = scn(s);
  const used = x.rations + x.coalStocks;
  const room = used < op.slots;
  const options = [
    opt(
      'ration',
      'Spend 3 Food: place a Food Ration marker',
      room && s.food >= 3 ? undefined : { disabled: room ? 'Not enough Food' : 'Stockpile full' },
    ),
    opt(
      'coal',
      'Spend 2 Coal: place a Coal Stock marker',
      room && s.res.coal >= 2 ? undefined : { disabled: room ? 'Not enough Coal' : 'Stockpile full' },
    ),
    opt('done', 'Finish'),
  ];
  ask(s, {
    who: op.who,
    kind: 'stockpile',
    prompt: `Stockpile (${used}/${op.slots} markers): spend Food or Coal, or finish`,
    src: op.src,
    options,
    min: 1,
    max: 1,
    then: { k: 'scnStockPick', card: op.card, who: op.who, src: op.src, slots: op.slots },
  });
});

defOp('scnStockPick', (s, op) => {
  const x = scn(s);
  const pick = op.pick?.[0];
  if (pick === 'ration' && spendRes(s, 'food', 3)) {
    x.rations++;
    log(s, 'scn.stock', '+1 Food Ration marker (3 Food spent)', { card: op.card });
  } else if (pick === 'coal' && spendRes(s, 'coal', 2)) {
    x.coalStocks++;
    log(s, 'scn.stock', '+1 Coal Stock marker (2 Coal spent)', { card: op.card });
  } else return; // finished
  push(s, { k: 'scnStock', card: op.card, who: op.who, src: op.src, slots: op.slots });
});

/**
 * Special actions the Scenario display offers to the Action phase (ACTIONS builds the menu from this).
 * key `stock<card>` runs custom:stockpile with ctx.card = card.
 */
export interface ScenarioSpecialAction {
  key: string;
  card: string;
  title: string;
  text: string;
  phase: string;
  oncePerRound: boolean;
  meeples: string[];
  heated: boolean;
  usedThisRound: boolean;
  available: boolean;
}

/** Stockpile numbers of a Stockpile card in play (markers used by both cards together, slots, cost per marker). */
export function scenarioStockState(s: GameState, card: string): { used: number; slots: number; food: number; coal: number } | null {
  const st = scenarioDef(card).stockpile;
  if (!st || !s.scenarioDisplay.includes(card)) return null;
  const x = scn(s);
  return { used: x.rations + x.coalStocks, slots: st.slots, food: st.foodPerRation, coal: st.coalPerStock };
}

export function scenarioSpecialActions(s: GameState): ScenarioSpecialAction[] {
  const x = scn(s);
  const out: ScenarioSpecialAction[] = [];
  for (const id of s.scenarioDisplay) {
    const def = scenarioDef(id);
    const sa = def.specialAction;
    if (!sa) continue;
    const usedThisRound = sa.oncePerRound ? x.specialUsed[id] === s.round : false;
    out.push({
      key: `stock${id}`,
      card: id,
      title: def.title,
      text: sa.text ?? '',
      phase: sa.phase,
      oncePerRound: !!sa.oncePerRound,
      meeples: sa.meeples ?? [],
      heated: !!sa.heated,
      usedThisRound,
      available: !usedThisRound,
    });
  }
  return out;
}
