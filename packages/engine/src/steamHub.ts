// Frozen Grove Steam Hub: the one shared rule used by the Action-phase menu (actions.ts) and by the free Steam Hub step of the
// Dusk, Hunger and Night phases (night.ts). Scenario Book, Steam Hub passive: "At any time during the round, if the Heat marker
// level is higher than the Red Insulation level you may place 1 Coal from the supply into the Steam Hub. While there is a Coal in
// the Steam Hub, the tile it is on and all adjacent tiles are heated. Return the Coal to the bank at the end of the Generator Phase."
import type { Building, GameState } from './types';

export interface SteamHubState {
  /** built Steam Hubs that may take 1 Coal now (empty when `why` is set) */
  candidates: Building[];
  /** why no Coal may be placed now (null when placing is allowed) */
  why: string | null;
}

/** The Steam Hub rule: a built Steam Hub without Coal, Heat above the red Insulation level, 1 Coal in the supply. */
export function steamHubState(s: GameState): SteamHubState {
  const hubs = s.buildings.filter((b) => b.kind === 'steamHub' && !b.ruins);
  if (hubs.length === 0) return { candidates: [], why: 'No Steam Hub built' };
  const empty = hubs.filter((b) => !b.steamHubCoal);
  if (empty.length === 0) return { candidates: [], why: 'Every Steam Hub already has Coal' };
  const red = s.gen.ind.red;
  if (red == null || s.gen.heat <= red) return { candidates: [], why: 'Heat must be above the red level' };
  if (s.res.coal < 1) return { candidates: [], why: 'No Coal' };
  return { candidates: empty, why: null };
}

/** The Steam Hubs that may take 1 Coal at a free moment (no Action-phase turn needed). Empty when placing is not allowed. */
export function steamHubFreeCandidates(s: GameState): Building[] {
  const st = steamHubState(s);
  return st.why ? [] : st.candidates;
}
