// Game set-up (rulebook pp8-15) and the hand-over to the phase driver (round 1 starts at the Action phase).
//
// Decisions (see docs/ENGINE_SPEC.md §3.1, §3.7 and the notes on each step below):
// * No Weather draw in set-up: rulebook p13/§"Round 1" says Phases 1-5 are skipped in the first Round. The spec text
//   (§3.1) that mentions a set-up weather draw is not followed; the Heat marker simply starts on space 1 (everything cold).
// * Dusk deck = the 'Inevitable' card D000 + the top Social Dispute card, shuffled. The other Dusk cards stay in the box until
//   a Law consequence adds them (rulebook p13 step 11.5).
// * Morning deck = M001-M032 (+ M033-M040 with the extra pack). Citizen deck = all C01-C30.
// * Advisors: the choice is made before the game (config.advisors = the Advisors at the table; RULES_CHECKLIST ADP-07). Each seat is
//   dealt one of them at random; Advisors not dealt return to the box. Without a table choice the whole list is the pool.
// * Law pool for the Future Law display: L01-L08 face up + 4 random of the rest (L09-L16; with the extra pack L17-L20 join the pool).
// * Technology display: T09 (Steam Hub) only in Frozen Grove (plus 3 random); otherwise 4 random from T01-T08 (+ T10-T17 with the extra pack).
// * Storm marker on Round-track space 9 (scenarios.json start) for every scenario; the storm card comes from the scenario data.
// * Corpse track limit 10 (TTS mod: "If reaches 10 ... lose").
// * The scenario hook: `scenario.ts` may export `scenarioSetup(s)`; it is called once during set-up (it may mutate s and push ops).
//   Until that module exists the hook is skipped.
import './fx/index';
import { BACK_PICK, answerPending, ask, defOp, hasOp, log, opt, push, run, RuleError } from './core';
import * as D from './data';
import { meepleCountFor } from './data';
import { describeList } from './fx/describe';
import { feasible, runFx } from './fx/core';
import { setupTrack } from './hope';
import { setupExpeditions } from './expedition';
import { placeBuilding } from './buildings';
import { addSick } from './sickness';
import { initTileStacks, setupBoardTiles } from './tiles';
import { allLawIds } from './laws';
import { lessonAdvance, lessonCheck, lessonRewind, validateLesson } from './tutorial';
import { blankState } from './testing';
import { randInt, shuffle } from './rng';
import { newMeeple } from './util';
import * as ScenarioMod from './scenario';
import type { CitizenType, GameConfig, GameState, MapTile, Space } from './types';
import { CITIZEN_TYPES } from './types';

export const CORPSE_MAX = 10;
export const STORM_MARKER_START = 9;
export const BASE_MORNING_MAX = 32; // M001-M032 in the base game; M033-M040 are the extra pack
export const EXTRA_MORNING_MAX = 40;
const FUTURE_LAW_FACE_UP = ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08'];
const LAWS_DRAWN = 4;
const GEN_SLOTS = ['T', 'UR', 'LR', 'LL', 'UL'] as const;

export interface SetupInfo {
  scenario: string;
  societyCard: string;
  hope: [number, number];
  discontent: [number, number];
}

const idNum = (id: string) => Number(id.replace(/\D/g, ''));
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const costText = (c: any) => (c?.start?.length ? describeList(c.start) : 'no cost');

/** Throws RuleError for configurations the engine cannot start. */
export function validateConfig(config: GameConfig) {
  if (!['crater', 'frozenGrove', 'dreadnought'].includes(config.scenario)) throw new RuleError('unknown scenario ' + config.scenario);
  if (!(config.society >= 1 && config.society <= 6)) throw new RuleError('society must be 1..6');
  if (!['normal', 'hard'].includes(config.difficulty)) throw new RuleError('difficulty must be normal or hard');
  if (config.survivalist !== undefined && typeof config.survivalist !== 'boolean') throw new RuleError('survivalist must be a boolean');
  if (config.survivalist && !config.extraPack) throw new RuleError('the Survivalist Society cards are in the extra pack: enable extraPack');
  if (!['solo', 'coop'].includes(config.mode)) throw new RuleError('mode must be solo or coop');
  const n = config.players?.length ?? 0;
  if (n < 1 || n > 4) throw new RuleError('between 1 and 4 players');
  if (config.mode === 'solo' && n !== 1) throw new RuleError('a solo game has exactly one player');
  if (config.mode === 'coop' && n < 2) throw new RuleError('a co-op game has at least two players');
  if (!Number.isInteger(config.seed)) throw new RuleError('seed must be an integer');
  // Advisors at the table (rulebook p15): unknown or repeated Advisors are rejected; a solo game takes exactly one Advisor
  // (its Call to Rise is separate); a co-op table needs at least one Advisor per player (unused ones return to the box).
  const chosen = (config.advisors ?? []).filter((a): a is string => typeof a === 'string');
  if (chosen.some((a) => !(a in D.advisors))) throw new RuleError('unknown Advisor in config.advisors');
  if (new Set(chosen).size !== chosen.length) throw new RuleError('an Advisor is chosen twice');
  if (config.mode === 'solo' && chosen.length > 1) throw new RuleError('a solo game takes one Advisor');
  if (chosen.length > 0 && chosen.length < n) throw new RuleError(`the table needs at least ${n} Advisors (one per player)`);
  if (config.tutorial !== undefined) validateLesson(config);
}

export function societyCardFor(config: GameConfig): any {
  const difficulty = config.survivalist ? 'survivalist' : config.difficulty;
  const card = D.societies.find((c: any) => c.society === config.society && c.difficulty === difficulty);
  if (!card) throw new RuleError(`no Society card for ${config.society}/${difficulty}`);
  return card;
}

/** Builds the state of step 1-12 of the set-up (everything that needs no decision). Board tiles and hands are handled by ops. */
export function newGameState(config: GameConfig): GameState {
  validateConfig(config);
  const s = blankState(config);
  const sc = config.scenario;
  const board = (D.mapData.boards as any)[sc];
  const start = D.scenarioStart;
  const scen = D.scenarios[sc];
  const card = societyCardFor(config);

  s.phase = 'setup';
  s.round = start.round ?? 1;
  s.genCentre = [board.generatorCentre[0], board.generatorCentre[1]];
  s.leader = randInt(s.rng, config.players.length);
  s.corpseMax = CORPSE_MAX;

  // Population board (step 1-5 of the Population/Supply board set-up)
  CITIZEN_TYPES.forEach((t: CitizenType, i: number) => {
    s.cit[t] = card.pop[i];
    s.sick[t] = { n: card.sick[i], skull: false };
  });
  s.food = card.food;
  s.hunger = 0;
  s.hungerOver = false;
  s.corpse = card.corpse;
  s.res = { wood: card.wood, coal: card.coal, core: card.cores, steel: 0 };
  s.spent = [];
  s.automatonsMax = 6;

  // Citizen meeples: one per Population-track meeple of each type, plus Automatons from the bank (supply)
  for (const t of CITIZEN_TYPES) for (let i = 0; i < meepleCountFor(s.cit[t]); i++) newMeeple(s, t);
  for (let i = 0; i < card.automaton; i++) newMeeple(s, 'automaton');

  // Hope & Discontent: 3 tokens of each type in each bag; draw from the bags as the Society card says
  s.hopeBag = { care: 3, justice: 3, motivation: 3 };
  s.discBag = { anger: 3, apathy: 3, greed: 3 };
  setupTrack(s, 'disc', card.discontent[0], card.discontent[1]);
  setupTrack(s, 'hope', card.hope[0], card.hope[1]);

  // Round & Morning board: Round marker on 1, Storm marker, Morning deck
  s.stormMarker = start.stormMarker ?? STORM_MARKER_START;
  s.stormCard = scen?.stormCard ?? start.stormCard;
  s.decks.morning = shuffle(
    s.rng,
    Object.keys(D.morning)
      .filter((id) => idNum(id) <= BASE_MORNING_MAX || (config.extraPack && idNum(id) <= EXTRA_MORNING_MAX))
      .sort(byId),
  );

  // Generator board: heat track, indicators, Generator tile spaces (step 12)
  const hs = D.heatRangeSetup;
  s.gen = {
    ...s.gen,
    heat: hs.heat,
    cold: hs.cold,
    ind: { red: hs.red, orange: hs.orange, yellow: hs.yellow },
    broken: false,
    stress: 0,
    overflow: 0,
    upgraded: false,
    carry: 0,
    fuelUsedThisPhase: 0,
  };
  const genSpaces: string[] = [];
  for (const slot of GEN_SLOTS) {
    const sid = `GEN:${slot}`;
    const res: Space['res'] = {};
    if (slot === 'UL') res.wood = 5;
    if (slot === 'UR') res.coal = 5;
    s.spaces[sid] = { id: sid, tile: 'GEN', slot, res, trees: 0, building: null };
    genSpaces.push(sid);
  }
  const genTile: MapTile = { key: 'GEN', id: 'GEN', kind: 'gen', q: s.genCentre[0], r: s.genCentre[1], spaces: genSpaces, food: 0 };
  s.tiles.push(genTile);
  // printed / starting buildings on the Generator tile (buildings.json start: 'printed' | 'generatorTile')
  placeBuilding(s, 'cookhouse', 'GEN:T', { noOnBuild: true });
  placeBuilding(s, 'generator', 'GEN:LR', { printed: true, noOnBuild: true });
  placeBuilding(s, 'platform', 'GEN:LL', { printed: true, noOnBuild: true });

  // Tile stacks (shuffled face down). Board placement itself is an op (tilSetupBoard), see pushSetupOps.
  initTileStacks(s);

  // Future Law display: L01-L08 face up, then 4 random of the remaining laws; each law's two consequences stay hidden
  s.futureLaws = [...FUTURE_LAW_FACE_UP];
  const pool = allLawIds(config.extraPack).filter((id) => !FUTURE_LAW_FACE_UP.includes(id)).sort(byId);
  s.futureLaws.push(...shuffle(s.rng, pool).slice(0, LAWS_DRAWN));
  for (const lawId of s.futureLaws) {
    s.lawConsequenceBank[lawId] = Object.values(D.lawConsequences)
      .filter((c: any) => c.law === lawId && (config.extraPack || c.pack !== 'extra'))
      .map((c: any) => c.id as string)
      .sort(byId);
  }

  // Technology display (T09 Steam Hub is removed from the game except in Frozen Grove)
  const techPool = Object.values(D.techs)
    .filter((t: any) => t.id !== 'T09' && (config.extraPack || t.pack !== 'extra'))
    .map((t: any) => t.id as string)
    .sort(byId);
  const fixed = sc === 'frozenGrove' ? ['T09'] : [];
  const randomCount = sc === 'frozenGrove' ? 3 : 4;
  const shown = [...fixed, ...shuffle(s.rng, techPool).slice(0, randomCount)].sort(byId);
  s.techs = shown.map((id) => ({ id, state: 'inactive' as const, dueRound: null }));

  // Scenario display, trigger tokens (SCENARIO interprets them; the card is filled in by scenario.ts)
  s.scenarioDisplay = [...start.scenarioDisplay];
  s.triggers = (start.scenarioTriggerTokens as number[]).map((round, idx) => ({ round, card: '', idx }));

  // Expeditions: three stacks from the A deck
  setupExpeditions(s);

  // Decks: Dusk = 'Inevitable' + top Social Dispute card (shuffled); the Social Dispute deck keeps the rest
  s.decks.social = shuffle(s.rng, Object.keys(D.socialDispute).sort(byId));
  const topSocial = s.decks.social.pop();
  s.decks.dusk = shuffle(s.rng, ['D000', ...(topSocial ? [topSocial] : [])]);
  s.decks.duskDiscard = [];
  // Weather deck: all 13 cards in every playable scenario. Rulebook set-up step 5 removes only the cards a scenario does not use
  // and says "for Crater use all Weather cards"; Scenario Book Frozen Grove and Dreadnought "follow the set-up of Crater except the
  // Map and Technology display", and no Scenario Book text removes a Weather card. An empty deck is reshuffled from the discard
  // (phases.ts drawFrom), so the deck cannot run dry.
  s.decks.weather = shuffle(s.rng, D.weatherCards.map((c: any) => c.id as string).sort(byId));
  s.decks.weatherDiscard = [];
  s.decks.citizen = shuffle(s.rng, Object.keys(D.citizens).sort(byId));
  s.decks.citizenDiscard = [];

  // Players: seats, Advisors (dealt at random from the table's set, or from all Advisors), Citizen hands
  const table = (config.advisors ?? []).filter((a): a is string => typeof a === 'string');
  const advisorPool = shuffle(s.rng, table.length ? [...table] : Object.keys(D.advisors).sort(byId));
  const handCount = D.handSize[String(Math.min(4, config.players.length))] ?? 7;
  s.players.forEach((p, i) => {
    p.advisor = advisorPool[i] ?? null;
    p.hand = [];
    p.playedCitizen = null;
    for (let k = 0; k < handCount && s.decks.citizen.length; k++) p.hand.push(s.decks.citizen.pop()!);
  });

  // Starting Morning/Dusk/Weather decks are ready; the Round starts at the Action phase
  s.stack = [];
  s.pending = null;
  return s;
}

/**
 * Operations of the set-up, pushed so that they run in this order: board tiles (crater corner choice) -> each player
 * discards one Citizen card -> scenario set-up -> finish (phStart action, when the phase driver is registered).
 */
export function pushSetupOps(s: GameState) {
  push(s, { k: 'setupEnd' });
  // a tutorial position is arranged after the board and the discards, just before the Action phase starts
  if (s.config.tutorial !== undefined) push(s, { k: 'tutorialPatch' });
  const hook = (ScenarioMod as any).scenarioSetup;
  if (typeof hook === 'function') hook(s);
  // Discards run in a random seat order: when two players' Citizen costs cannot both be paid, the winner is random (rulebook p15).
  const order = shuffle(s.rng, s.players.map((_, i) => i));
  for (let i = order.length - 1; i >= 0; i--) push(s, { k: 'setupDiscard', who: order[i] });
  setupBoardTiles(s);
}

defOp('setupDiscard', (s, op) => {
  const who: number = op.who;
  const p = s.players[who];
  if (!p || p.hand.length === 0) return;
  const ctx = { who, src: 'setup:discard' };
  const payable = (id: string) => feasible(s, D.citizens[id]?.start ?? [], ctx) === null;
  const anyPayable = p.hand.some(payable);
  ask(s, {
    who,
    kind: 'citizenDiscard',
    prompt: 'Setup: discard one of your Citizen cards (pay its starting cost)',
    src: 'setup:discard',
    options: p.hand.map((id) => {
      const c = D.citizens[id];
      const ok = payable(id);
      return opt(id, `${c?.name ?? id} (${c?.type ?? '?'})`, {
        hint: costText(c),
        disabled: anyPayable && !ok ? 'Cannot pay the starting cost' : undefined,
      });
    }),
    then: { k: 'setupDiscardPick', who },
  });
});

defOp('setupDiscardPick', (s, op) => {
  const who: number = op.who;
  const p = s.players[who];
  const id: string | undefined = op.pick?.[0];
  if (!p || !id || !p.hand.includes(id)) return;
  const c = D.citizens[id];
  const ctx = { who, src: 'setup:discard' };
  const cost: any[] = c?.start ?? [];
  const payable = feasible(s, cost, ctx) === null;
  p.hand = p.hand.filter((x) => x !== id);
  s.decks.citizenDiscard.push(id);
  if (payable) {
    log(s, 'setup.discard', `${p.name} discarded ${c?.name ?? id}`, { card: id, who });
    runFx(s, cost, ctx);
  } else {
    // nothing can be paid: discard the card anyway and add a sick Citizen of its type (rulebook p15)
    log(s, 'setup.discardSick', `${p.name} discarded ${c?.name ?? id} without paying; a ${c?.type ?? 'citizen'} falls sick`, {
      card: id,
      who,
    });
    if (c?.type) addSick(s, c.type as CitizenType, 1, who);
  }
});

defOp('setupEnd', (s) => {
  s.phase = 'action';
  log(s, 'setup.done', 'Set-up complete: Round 1 starts at the Action phase', { round: s.round });
  if (hasOp('phStart')) push(s, { k: 'phStart', phase: 'action' });
});

/** Runs the stack until a decision or the end of the game. Set-up ends with an empty stack only until the phase driver exists. */
export function drive(s: GameState) {
  if (s.status !== 'playing' || s.pending) return;
  try {
    run(s);
  } catch (e: any) {
    if (!hasOp('phStart') && /stack ran dry/.test(String(e?.message))) return;
    throw e;
  }
}

/** Creates a game: set-up, then runs to the first pending decision (or the end). */
export function createGame(config: GameConfig): GameState {
  const s = newGameState(config);
  pushSetupOps(s);
  drive(s);
  if (config.tutorial !== undefined) skipLessonSetup(s);
  return s;
}

/**
 * A lesson starts from a fixed position, so the set-up decisions (the Crater corner and the Citizen discards) are not
 * asked: each takes its first enabled option, the same way on every replay.
 */
function skipLessonSetup(s: GameState) {
  for (let i = 0; i < 20 && s.pending && (s.pending.kind === 'setup' || s.pending.kind === 'citizenDiscard'); i++) {
    const p = s.pending;
    const first = p.options.find((o) => !o.disabled) ?? p.options[0];
    answer(s, p.who, p.id, [first.id]);
  }
}

export type AnswerResult = { ok: boolean; error?: string };

/** Applies an answer (mutates `s`); the game then runs to the next decision. Returns {ok:false, error} for rejected answers. */
export function answer(s: GameState, who: number, pendingId: number, pick: string[]): AnswerResult {
  // a tutorial step refuses an answer that is not its own pick before the answer is applied
  const before = s.pending;
  let advance = false;
  if (before && before.id === pendingId && s.flags.lesson) {
    const gate = lessonCheck(s, before, pick);
    if (!gate.ok) return { ok: false, error: gate.error };
    advance = gate.advance;
  }
  let result: AnswerResult;
  try {
    result = answerPending(s, who, pendingId, pick);
  } catch (e: any) {
    if (e instanceof RuleError) return { ok: false, error: e.message };
    // stack ran dry before the phase driver exists: the answer itself was applied
    if (!hasOp('phStart') && /stack ran dry/.test(String(e?.message)) && s.status === 'playing') result = { ok: true };
    else throw e;
  }
  if (result.ok && advance) lessonAdvance(s);
  if (result.ok && s.flags.lesson && pick.length === 1 && pick[0] === BACK_PICK) lessonRewind(s);
  return result;
}
