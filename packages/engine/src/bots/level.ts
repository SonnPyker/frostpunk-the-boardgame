// Bot levels: one entry point for the watch mode (apps/web) and anything else that needs a named bot. Every level only
// returns legal picks (min/max, caps, disabled options). The bot's randomness comes from its own seeded RNG, never from
// s.rng, so the bot never changes the game's determinism: the same config, bot seed and answers replay the same game.
import type { GameState, Pending } from '../types';
import { legalPick } from '../autoplay';
import { seedRng, type RngState } from '../rng';
import { heuristicPick } from './heuristic';
import { proPick } from './pro';

/** random: any legal answer · heuristic: scored by decision kind · pro: scored from the state (food, shelter, heat, hope) */
export const BOT_LEVELS = ['random', 'heuristic', 'pro'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];

/** A fresh RNG for one bot. Seeding it with the same value replays the same choices. */
export function botRng(seed: number): RngState {
  return seedRng(seed);
}

/** The answer one bot level gives to a pending decision, or null when it has no legal answer. */
export function botPick(level: BotLevel, st: RngState, s: GameState, p: Pending): string[] | null {
  switch (level) {
    case 'random':
      return legalPick(st, p);
    case 'heuristic':
      return heuristicPick(st, s, p);
    case 'pro':
      return proPick(st, s, p);
  }
}
