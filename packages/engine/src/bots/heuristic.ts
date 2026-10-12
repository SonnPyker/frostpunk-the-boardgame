// Heuristic bot ("--smart" in scripts/sim.ts, and the "Heuristic" level of the watch mode). It scores every enabled
// option by the kind of decision (fuel, Construct and Gathering Post early, Food and Coal over junk, Stockpile when
// affordable, shelters first) and takes the best ones. Ties are broken with the bot's own seeded RNG, so a game
// played with it is reproducible. It only ever returns picks the engine accepts (min/max, caps, disabled options).
import type { GameState, Pending } from '../types';
import { randInt, type RngState } from '../rng';

/** Score of one option for the heuristic bot (higher is better). Unknown decisions score 0 and are picked randomly. */
function scoreOption(s: GameState, p: Pending, id: string, label: string): number {
  switch (p.kind) {
    case 'action': {
      if (id === 'act:pass') return 0;
      if (id === 'act:steamHub') return 9; // free, no turn cost
      // Fuel is free: keep the Generator warm while Coal lasts. Gather Coal and Wood before building when stocks run low.
      if (id === 'act:fuel') return s.res.coal >= 1 && s.gen.heat <= 4 ? 10 : 1;
      if (id === 'act:construct') {
        const early = s.round <= 6 && !s.buildings.some((b) => b.kind === 'gatheringPost');
        return early ? 6 : 4;
      }
      if (id === 'act:use') return 6;
      if (id === 'act:gather') return s.res.coal < 6 || s.res.wood < 4 ? 9 : 4;
      if (id === 'act:removeSnow') return 4;
      if (id === 'act:deploy') return s.buildings.some((b) => b.kind === 'beacon') ? 5 : 1;
      if (id.startsWith('act:special:stock')) return s.food >= 3 || s.res.coal >= 2 ? 6 : 1;
      if (id.startsWith('act:special:')) return 5;
      return 2;
    }
    case 'gatherRes': {
      // option ids are "<space>|<resource>"; the resource that is short right now scores highest
      const k = id.split('|')[1] ?? '';
      if (k === 'coal') return s.res.coal < 6 ? 9 : 3;
      if (k === 'wood') return s.res.wood < 4 ? 8 : 2;
      if (k === 'core') return 1;
      return 0;
    }
    case 'stockpile':
      if (id === 'ration') return s.food >= 3 ? 5 : 0;
      if (id === 'coal') return s.res.coal >= 2 ? 4 : 0;
      return 0;
    case 'fuel': {
      // option ids are the amount of Coal to spend: spend more while the Generator is cold
      const n = Number(id);
      if (s.gen.heat >= 6) return n === 0 ? 8 : 0;
      return n === 0 ? 0 : 2 + 2 * n;
    }
    case 'construct':
      // never dismantle (no refund outside tech T08): End Construction is the fallback
      return id === 'build' ? 6 : id === 'dismantle' ? 0 : 2;
    case 'buildPick': {
      // shelters first (the Night needs a sleeping slot for every citizen), then food and heat, then the rest
      const order: Record<string, number> = { tent: 10, bunkhouse: 9, house: 9, gatheringPost: 8, cookhouse: 7, huntersHut: 6, workshop: 5 };
      return order[id] ?? 3;
    }
    case 'buildSpace': {
      // heated tiles first: the Generator tile, then the tiles next to it (labels "Generator tile (..)" and "N01 top")
      if (/^GEN:/.test(id)) return 9;
      if (/^N\d/.test(id)) return 6;
      return 2;
    }
    case 'advisor':
      return id === 'none' ? 1 : 5;
    case 'sleep':
      return id === 'child' ? 3 : id === 'engineer' ? 2 : 2;
    case 'citizen':
      return id === 'normal' ? 1 : 3;
    default:
      return 0;
  }
}

/** Picks the best legal answer: highest scores first (random tie-break), repeats only while the caps allow. */
export function heuristicPick(st: RngState, s: GameState, p: Pending): string[] | null {
  const enabled = p.options.filter((o) => !o.disabled);
  if (enabled.length === 0) return p.min > 0 ? null : [];
  const allowRepeat = !!p.meta?.allowRepeat;
  const caps: Record<string, number> | undefined = p.meta?.caps;
  const scored = enabled.map((o) => ({ id: o.id, score: scoreOption(s, p, o.id, o.label ?? o.id), tie: randInt(st, 1000) }));
  const rank = (a: { score: number; tie: number }, b: { score: number; tie: number }) => b.score - a.score || a.tie - b.tie;
  if (allowRepeat) {
    const count = p.max;
    const used: Record<string, number> = {};
    const pick: string[] = [];
    for (let i = 0; i < count; i++) {
      const cands = scored.filter((o) => (used[o.id] ?? 0) < (caps?.[o.id] ?? 1)).sort(rank);
      if (cands.length === 0) break;
      used[cands[0].id] = (used[cands[0].id] ?? 0) + 1;
      pick.push(cands[0].id);
    }
    return pick.length >= p.min ? pick : null;
  }
  const count = Math.min(p.max, enabled.length);
  if (count < p.min) return null;
  const sorted = scored.sort(rank).map((o) => o.id);
  // multi-select with a score of 0 is still a valid answer when min demands it; otherwise take only useful options
  const useful = scored.filter((o) => o.score > 0).length;
  const n = Math.max(p.min, Math.min(count, p.kind === 'action' || p.max === 1 ? count : useful || p.min));
  return sorted.slice(0, n);
}
