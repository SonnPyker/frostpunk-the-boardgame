// Flat Monte-Carlo bot for scripts/sim.ts (--mc). At each strategic decision it builds a small candidate set (the top-K
// options by the pro bot's scoring, plus pro-bot variants and one random option), then for every candidate it clones the
// state (JSON round trip), reseeds the engine RNG, applies the candidate and plays the rest of the round (up to `horizon`
// rounds and `depth` decisions) with the pro bot as rollout policy (epsilon-random picks for diversity). The candidate with
// the best mean score over `rollouts` rollouts is played. Trivial and non-strategic decisions go straight to the pro bot.
//
// Reproducible: every rollout seed is a hash of the bot seed, the decision counter, the candidate index and the rollout
// index. The real game state is never mutated (all work happens on clones). Single-threaded.
import type { GameState, Pending } from '../../src/types';
import { seedRng, randInt } from '../../src/rng';
import { answer } from '../../src/setup';
import { legalPick } from '../../src/autoplay';
import { proPick, proCtx, proScore } from '../../src/bots/pro';

export interface McOpts {
  rollouts: number; // rollouts per candidate
  top: number; // candidates taken from the pro ranking (plus pro variants and one random option)
  depth: number; // max decisions per rollout
  horizon: number; // rollouts stop after this many rounds (1 = end of the current round)
  eps: number; // probability of a uniformly random legal pick inside a rollout
}

export const DEFAULT_MC: McOpts = { rollouts: 32, top: 6, depth: 400, horizon: 1, eps: 0.1 };

/** Global counters for the report (not part of the game). */
export const mcStats = {
  searches: 0, // strategic decisions that ran a search
  candidates: 0,
  rollouts: 0,
  rolloutCrashes: 0, // engine exceptions inside a rollout (not inside the real game)
  rolloutRejects: 0, // rollout answers the engine refused
  firstCrash: '' as string,
};

/** Decision kinds worth a search (the rest go straight to the pro bot). */
const STRATEGIC = new Set([
  'action',
  'fuel',
  'construct',
  'buildPick',
  'buildSpace',
  'building',
  'space',
  'gatherRes',
  'gatherPick',
  'mapres',
  'law',
  'tech',
  'advisor',
  'citizen',
  'stockpile',
  'steamHub',
  'sleep',
  'removeSnow',
  'tileKind',
  'choice',
]);

const CRASH_SCORE = -1e9;

function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x7f4a7c15, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deep copy of a state without its (UI-only) log. */
export function cloneState(s: GameState): GameState {
  return JSON.parse(JSON.stringify({ ...s, log: [] }));
}

/**
 * Score of a state at the end of a rollout. Rounds survived dominate; hope, discontent, food, fuel, sickness, corpses
 * and hunger break ties. A lost game scores below any survivor that reached the same round.
 */
export function evalState(s: GameState): number {
  if (s.status === 'won') return 1e6 + s.round;
  const hopeActive = s.hope.filter((t) => t.a).length;
  const discActive = s.disc.filter((t) => t.a).length;
  const discTotal = s.disc.length;
  const sick = (s.sick.worker?.n ?? 0) + (s.sick.engineer?.n ?? 0) + (s.sick.child?.n ?? 0);
  const pop = s.cit.worker + s.cit.engineer + s.cit.child;
  let v = 100 * s.round;
  v += 4 * hopeActive + 1 * s.hope.length;
  v -= 6 * discActive + 2 * (discTotal - discActive);
  v += 0.4 * Math.min(s.food, 30) + 0.5 * Math.min(s.res.coal, 15) + 0.3 * Math.min(s.res.wood, 15);
  v -= 0.5 * s.corpse + 1.0 * sick + 0.5 * s.hunger;
  v += 0.5 * pop;
  if (s.status === 'lost') v -= 50;
  return v;
}

/** Plays a rollout on `s` (mutates it). Returns true when the engine threw. */
function playout(s: GameState, rng: ReturnType<typeof seedRng>, opts: McOpts, startRound: number): boolean {
  let n = 0;
  while (s.status === 'playing' && s.round < startRound + opts.horizon && n < opts.depth) {
    const p = s.pending;
    if (!p) return false;
    try {
      const random = randInt(rng, 1000) < opts.eps * 1000;
      const pick = random ? legalPick(rng, p) : proPick(rng, s, p);
      if (!pick) return false;
      const who = p.who >= 0 ? p.who : s.leader;
      const r = answer(s, who, p.id, pick);
      if (!r.ok) {
        mcStats.rolloutRejects++;
        return false;
      }
    } catch (e: any) {
      mcStats.rolloutCrashes++;
      if (!mcStats.firstCrash) mcStats.firstCrash = `${p.kind}: ${String(e?.message ?? e)}`;
      return true;
    }
    n++;
  }
  return false;
}

/** Mean rollout score of one candidate answer. */
function evalCandidate(base: GameState, p: Pending, cand: string[], opts: McOpts, seed: number): number {
  let total = 0;
  const who = p.who >= 0 ? p.who : base.leader;
  for (let r = 0; r < opts.rollouts; r++) {
    const rs = mix(seed, r + 1);
    const c = cloneState(base);
    c.rng = seedRng(rs); // diversify the engine's own draws (card decks, tiles) per rollout
    mcStats.rollouts++;
    let score: number;
    try {
      const res = answer(c, who, p.id, cand);
      if (!res.ok) {
        mcStats.rolloutRejects++;
        return CRASH_SCORE;
      }
    } catch (e: any) {
      mcStats.rolloutCrashes++;
      if (!mcStats.firstCrash) mcStats.firstCrash = `candidate ${p.kind}: ${String(e?.message ?? e)}`;
      return CRASH_SCORE;
    }
    const crashed = playout(c, seedRng(mix(rs, 7)), opts, base.round);
    score = crashed ? CRASH_SCORE / 2 : evalState(c);
    total += score;
  }
  return total / opts.rollouts;
}

function keyOf(pick: string[]): string {
  return [...pick].sort().join('\u0001');
}

/** Candidate answers for one decision, best-first according to the pro ranking. */
function candidates(st: ReturnType<typeof seedRng>, s: GameState, p: Pending, opts: McOpts): string[][] {
  const enabled = p.options.filter((o) => !o.disabled);
  const out: string[][] = [];
  const seen = new Set<string>();
  const add = (pick: string[] | null) => {
    if (!pick) return;
    if (pick.length < p.min || pick.length > p.max) return;
    const k = keyOf(pick);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(pick);
  };
  const single = p.max === 1 && !p.meta?.allowRepeat;
  if (single) {
    const c = proCtx(s);
    const ranked = enabled
      .map((o) => {
        let sc = 0;
        try {
          sc = proScore(s, c, p, o);
        } catch {
          sc = 0;
        }
        return { id: o.id, sc };
      })
      .sort((a, b) => b.sc - a.sc);
    for (const r of ranked.slice(0, opts.top)) add([r.id]);
    if (p.min === 0) add([]);
    // one random option outside the top-K keeps the search from ignoring what the pro ranking dislikes
    if (ranked.length > opts.top) add([ranked[opts.top + randInt(st, ranked.length - opts.top)].id]);
  } else {
    // multi-pick decisions: pro-bot picks under different tie-breaks, plus random legal picks
    for (let i = 0; i < opts.top && out.length < opts.top; i++) add(proPick(st, s, p));
    for (let i = 0; i < 2; i++) add(legalPick(st, p));
  }
  return out;
}

/**
 * Chooses an answer for pending decision `p` by Monte-Carlo search. `seedBase` must differ per decision (the sim passes
 * a mix of the bot seed and the decision counter). Returns null only when no legal pick exists.
 */
export function mcPick(st: ReturnType<typeof seedRng>, s: GameState, p: Pending, opts: McOpts, seedBase: number): string[] | null {
  const enabled = p.options.filter((o) => !o.disabled);
  if (!STRATEGIC.has(p.kind) || enabled.length <= 1) return proPick(st, s, p);
  const cands = candidates(st, s, p, opts);
  if (cands.length === 0) return proPick(st, s, p);
  if (cands.length === 1) return cands[0];
  mcStats.searches++;
  mcStats.candidates += cands.length;
  let best = cands[0];
  let bestScore = -Infinity;
  cands.forEach((cand, ci) => {
    const v = evalCandidate(s, p, cand, opts, mix(seedBase, ci + 1));
    if (v > bestScore) {
      bestScore = v;
      best = cand;
    }
  });
  return best;
}
