// DEV ONLY (loaded from devHook.ts behind import.meta.env.DEV, never in the production bundle).
// A port of the engine sim's heuristic bot (packages/engine/scripts/sim.ts, scoreOption/smartPick) plus a
// "god mode" patch that keeps the colony alive, so the late-game UI (laws, techs, expeditions, events, storm,
// victory/defeat) can be reached and looked at. The god mode only touches the bot's own copy of the state.
import { applyAnswer, cloneState } from '../controller/engineApi';
import type { GameState, Pending } from '@frostpunk/engine';

function score(s: GameState, p: Pending, id: string): number {
  switch (p.kind) {
    case 'action': {
      if (id === 'act:pass') return 0;
      if (id === 'act:steamHub') return 9;
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
      const n = Number(id);
      if (s.gen.heat >= 6) return n === 0 ? 8 : 0;
      return n === 0 ? 0 : 2 + 2 * n;
    }
    case 'construct':
      return id === 'build' ? 6 : id === 'dismantle' ? 0 : 2;
    case 'buildPick': {
      const order: Record<string, number> = { tent: 10, bunkhouse: 9, house: 9, gatheringPost: 8, cookhouse: 7, huntersHut: 6, workshop: 5 };
      return order[id] ?? 3;
    }
    case 'buildSpace': {
      if (/^GEN:/.test(id)) return 9;
      if (/^N\d/.test(id)) return 6;
      return 2;
    }
    case 'advisor':
      return id === 'none' ? 1 : 5;
    case 'sleep':
      return id === 'child' ? 3 : 2;
    case 'citizen':
      return id === 'normal' ? 1 : 3;
    default:
      return 0;
  }
}

/** Highest-scored legal pick (random tie-break; repeats only while the caps allow). Null when none is legal. */
export function smartPick(s: GameState, p: Pending): string[] | null {
  const enabled = p.options.filter((o) => !o.disabled);
  if (enabled.length === 0) return p.min > 0 ? null : [];
  const allowRepeat = !!p.meta?.allowRepeat;
  const caps = (p.meta?.caps ?? undefined) as Record<string, number> | undefined;
  const scored = enabled.map((o) => ({ id: o.id, score: score(s, p, o.id), tie: Math.random() }));
  const rank = (a: { score: number; tie: number }, b: { score: number; tie: number }) => b.score - a.score || a.tie - b.tie;
  if (allowRepeat) {
    const used: Record<string, number> = {};
    const pick: string[] = [];
    for (let i = 0; i < p.max; i++) {
      const cands = scored.filter((o) => (used[o.id] ?? 0) < (caps?.[o.id] ?? 1)).sort(rank);
      if (cands.length === 0) break;
      used[cands[0].id] = (used[cands[0].id] ?? 0) + 1;
      pick.push(cands[0].id);
    }
    return pick.length >= p.min ? pick : null;
  }
  const count = Math.min(p.max, enabled.length);
  if (count < p.min) return null;
  const sorted = [...scored].sort(rank).map((o) => o.id);
  const useful = scored.filter((o) => o.score > 0).length;
  const n = Math.max(p.min, Math.min(count, p.kind === 'action' || p.max === 1 ? count : useful || p.min));
  return sorted.slice(0, n);
}

/**
 * God mode (dev only): keeps Hope on the track and Discontent below overflow, and feeds the colony. Tokens move
 * between track and bag the way the engine does it (a bag draw / a bag return), so the rules still apply to the rest.
 */
export function godPatch(s: GameState): void {
  const HOPE_TYPES = ['care', 'justice', 'motivation'] as const;
  const DISC_TYPES = ['anger', 'apathy', 'greed'] as const;
  while (s.hope.length < 3) {
    const t = HOPE_TYPES.find((k) => s.hopeBag[k] > 0);
    if (!t) break;
    s.hopeBag[t] -= 1;
    s.hope.push({ t, a: true });
  }
  while (s.disc.length > 2) {
    const tok = s.disc.pop();
    if (!tok) break;
    s.discBag[tok.t as (typeof DISC_TYPES)[number]] += 1;
  }
  s.food = Math.max(s.food, 6);
  s.hunger = Math.min(s.hunger, 0);
  if (s.corpse > s.corpseMax - 2) s.corpse = 0;
}

export interface FastForwardResult {
  ok: boolean;
  round: number;
  status: GameState['status'];
  decisions: number;
  state: GameState | null;
  note: string;
}

/** Plays the bot on a copy until `targetRound` (or the game ends). Returns the copy: the caller decides what to do. */
export function runBot(start: GameState, targetRound: number, godMode: boolean, maxDecisions = 20000): FastForwardResult {
  let s = cloneState(start);
  let decisions = 0;
  let note = '';
  while (s.status === 'playing' && s.round < targetRound && decisions < maxDecisions) {
    if (godMode) godPatch(s);
    const p = s.pending;
    if (!p) {
      note = 'no pending decision';
      break;
    }
    const pick = smartPick(s, p);
    if (!pick) {
      note = `no legal pick for ${p.kind}`;
      break;
    }
    const r = applyAnswer(s, p.who >= 0 ? p.who : s.leader, p.id, pick);
    if (!r.ok) {
      note = `engine rejected pick: ${r.error ?? ''}`;
      break;
    }
    decisions++;
  }
  const ok = note === '' && (s.status !== 'playing' || s.round >= targetRound);
  return { ok, round: s.round, status: s.status, decisions, state: s, note };
}
