// Seeded random legal-pick bot: answers every decision with random legal picks until the game ends or maxSteps decisions
// have been answered. Used by tests and the simulation script. It only ever submits picks the engine would accept
// (min/max, allowRepeat, per-option caps, disabled options), and never touches s.rng, so the game stays reproducible.
import type { GameState, Pending } from './types';
import { seedRng, randInt, shuffle } from './rng';
import { answer } from './setup';

export interface AutoplayResult {
  /** decisions answered */
  decisions: number;
  status: GameState['status'];
  endReason: string | null;
  round: number;
  /** true when the bot stopped because the game was waiting for something it cannot answer (see `error`) */
  stuck: boolean;
  error?: string;
}

/** Picks a legal answer for a pending decision (random, but reproducible through `st`). Returns null when none exists. */
export function legalPick(st: ReturnType<typeof seedRng>, p: Pending): string[] | null {
  const enabled = p.options.filter((o) => !o.disabled);
  const allowRepeat = !!p.meta?.allowRepeat;
  const caps: Record<string, number> | undefined = p.meta?.caps;
  if (p.min > 0 && enabled.length === 0) return null;
  const maxCount = allowRepeat ? p.max : Math.min(p.max, enabled.length);
  if (maxCount < p.min) return null;
  const count = p.min + randInt(st, maxCount - p.min + 1);
  if (allowRepeat) {
    const used: Record<string, number> = {};
    const pick: string[] = [];
    let guard = 0;
    while (pick.length < count && guard++ < 1000) {
      const cands = enabled.filter((o) => (used[o.id] ?? 0) < (caps?.[o.id] ?? 1));
      if (cands.length === 0) return null;
      const o = cands[randInt(st, cands.length)];
      used[o.id] = (used[o.id] ?? 0) + 1;
      pick.push(o.id);
    }
    return pick.length === count ? pick : null;
  }
  return shuffle(st, enabled.map((o) => o.id)).slice(0, count);
}

/**
 * Plays the game to the end with random legal answers. `rngSeed` drives only the bot's own choices.
 * Stops at `maxSteps` answered decisions (the game is then still playing), at the end of the game, or when stuck.
 */
export function autoplay(s: GameState, rngSeed: number, maxSteps: number): AutoplayResult {
  const st = seedRng(rngSeed);
  let decisions = 0;
  let stuck = false;
  let error: string | undefined;
  while (s.status === 'playing' && decisions < maxSteps) {
    const p = s.pending;
    if (!p) {
      stuck = true;
      error = 'no pending decision while the game is still running';
      break;
    }
    const pick = legalPick(st, p);
    if (!pick) {
      stuck = true;
      error = `no legal pick for decision ${p.id} (${p.kind})`;
      break;
    }
    const who = p.who >= 0 ? p.who : s.leader;
    const r = answer(s, who, p.id, pick);
    if (!r.ok) {
      stuck = true;
      error = `engine rejected bot pick for ${p.kind}: ${r.error}`;
      break;
    }
    decisions++;
  }
  return { decisions, status: s.status, endReason: s.endReason, round: s.round, stuck, error };
}
