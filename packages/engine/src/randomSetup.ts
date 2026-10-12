// Random solo set-up for the web "Kịch bản ngẫu nhiên" mode. Every starting number comes from a Society card as printed, so the
// game starts the way the rulebook sets it up. The draw picks a playable scenario, one printed Society card (Survivalist cards
// only with the extra pack), one Advisor, and a seed. The draw uses the seeded RNG, so one draw seed always gives one config.
import { nextU32, pickOne, seedRng } from './rng';
import * as D from './data';
import type { GameConfig } from './types';

export const PLAYABLE_SCENARIOS = ['crater', 'frozenGrove', 'dreadnought'] as const;

export interface RandomSetupOptions {
  /** the player's name at the table */
  name: string;
  extraPack: boolean;
}

export function randomSetup(drawSeed: number, opts: RandomSetupOptions): GameConfig {
  const st = seedRng(drawSeed);
  const scenario = pickOne(st, PLAYABLE_SCENARIOS);
  const cards = (D.societies as any[]).filter((c) => opts.extraPack || c.pack !== 'extra');
  const card = pickOne(st, cards);
  const survivalist = card.difficulty === 'survivalist';
  const advisor = pickOne(st, Object.keys(D.advisors).sort());
  const seed = nextU32(st);
  return {
    scenario,
    society: card.society,
    difficulty: survivalist ? 'normal' : card.difficulty,
    ...(survivalist ? { survivalist: true } : {}),
    mode: 'solo',
    players: [{ name: opts.name }],
    seed,
    extraPack: opts.extraPack,
    advisors: [advisor],
  };
}
