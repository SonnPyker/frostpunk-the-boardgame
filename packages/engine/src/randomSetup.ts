// Random solo set-up for the web "Kịch bản ngẫu nhiên" mode. One draw picks a playable scenario, one Advisor, a seed, and
// every starting number at random: Population per type, sick Citizens, Automatons, the four supplies, Hope and Discontent
// tokens with their active counts, and the Corpse marker. Each number is drawn within START_LIMITS, the same limits a custom
// set-up is held to, so every draw passes validateStart and starts a legal game.
//
// The map and the decks are already random for each seed: the tile stacks, the Morning, Dusk, Weather and Citizen decks,
// the Laws, Technologies and Expeditions. The rulebook fixes the rest (the Heat and indicator positions, the Storm marker,
// Round 1), so those are not drawn. Society and difficulty are not read when `start` is set; they stay at their defaults.
import { nextU32, pickOne, randInt, seedRng, type RngState } from './rng';
import * as D from './data';
import { START_LIMITS } from './setup';
import type { GameConfig, StartOverride } from './types';

export const PLAYABLE_SCENARIOS = ['crater', 'frozenGrove', 'dreadnought'] as const;

export interface RandomSetupOptions {
  /** the player's name at the table */
  name: string;
  extraPack: boolean;
}

/** A whole number drawn uniformly from lo..hi (both included). */
function range(st: RngState, lo: number, hi: number): number {
  return lo + randInt(st, hi - lo + 1);
}

/** Every starting number drawn within START_LIMITS. Draw order is fixed, so one state always gives one start. */
export function randomStart(st: RngState): StartOverride {
  const L = START_LIMITS;
  const pop = [0, 1, 2].map(() => range(st, 0, L.citizens)) as [number, number, number];
  const sick = pop.map((p) => range(st, 0, Math.min(p, L.sick))) as [number, number, number];
  const automaton = range(st, 0, L.automaton);
  const food = range(st, 0, L.supply);
  const wood = range(st, 0, L.supply);
  const coal = range(st, 0, L.supply);
  const cores = range(st, 0, L.supply);
  // at least one Hope token: an empty Hope track loses at once
  const hopeDrawn = range(st, 1, L.hope);
  const hope: [number, number] = [hopeDrawn, range(st, 0, hopeDrawn)];
  const discDrawn = range(st, 0, L.discontent);
  const discontent: [number, number] = [discDrawn, range(st, 0, discDrawn)];
  const corpse = range(st, 0, L.corpse);
  return { pop, sick, automaton, food, wood, coal, cores, hope, discontent, corpse };
}

export function randomSetup(drawSeed: number, opts: RandomSetupOptions): GameConfig {
  const st = seedRng(drawSeed);
  const scenario = pickOne(st, PLAYABLE_SCENARIOS);
  const advisor = pickOne(st, Object.keys(D.advisors).sort());
  const seed = nextU32(st);
  const start = randomStart(st);
  return {
    scenario,
    society: 1,
    difficulty: 'normal',
    mode: 'solo',
    players: [{ name: opts.name }],
    seed,
    extraPack: opts.extraPack,
    advisors: [advisor],
    start,
  };
}
