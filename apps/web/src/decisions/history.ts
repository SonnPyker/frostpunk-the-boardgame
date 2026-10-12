// The player's last few answers, shown as a compact trail under the decision. Recorded by App for every answer sent
// (panel buttons, map clicks and HUD clicks alike). Per browser tab only; it is a convenience, not game state.
import { create } from 'zustand';
import { BACK_PICK, type GameState, type Pending } from '@frostpunk/engine';
import { kindLabel } from './labels';
import { friendlyLabel } from './meta';
import { isWorkshopChoice, resetWorkshopRun } from './workshop';

export interface DecisionRecord {
  n: number;
  round: number;
  phase: string;
  title: string;
  picked: string;
  /** the action picked from the action menu: going back to that menu drops it and every decision made after it */
  menu: boolean;
}

const KEEP = 8;
let seq = 0;

export const useDecisionHistory = create<{ entries: DecisionRecord[] }>()(() => ({ entries: [] }));

/** Forgets the trail. Called whenever a game is attached (new, continued, resumed) or detached (back to the menu). */
export function clearDecisionHistory(): void {
  useDecisionHistory.setState({ entries: [] });
  resetWorkshopRun();
}

export function recordDecision(state: GameState | null, p: Pending, pick: string[]): void {
  // Going back to the action menu undoes the action picked from it and the decisions made in it, so the trail drops them.
  if (pick.length === 1 && pick[0] === BACK_PICK) {
    useDecisionHistory.setState((s) => {
      const at = s.entries.map((e) => e.menu).lastIndexOf(true);
      return { entries: at >= 0 ? s.entries.slice(0, at) : s.entries };
    });
    return;
  }
  const tally = new Map<string, number>();
  for (const id of pick) tally.set(id, (tally.get(id) ?? 0) + 1);
  const parts: string[] = [];
  for (const [id, count] of tally) {
    const opt = p.options.find((o) => o.id === id);
    const label = opt ? friendlyLabel(p, opt) : id;
    parts.push(count > 1 ? `${label} ×${count}` : label);
  }
  const picked = parts.length > 0 ? parts.join(', ') : p.options.length > 0 ? 'Skipped' : 'Continued';
  const rec: DecisionRecord = {
    n: ++seq,
    round: state?.round ?? 0,
    phase: state?.phase ?? '',
    title: isWorkshopChoice(p) ? 'Workshop' : kindLabel(p.kind),
    picked,
    menu: p.kind === 'action',
  };
  useDecisionHistory.setState((s) => ({ entries: [...s.entries, rec].slice(-KEEP) }));
}
