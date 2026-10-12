// Picks made for the open decision. One store feeds the decision panel AND the map/HUD clicks (App routes
// clicks on multi-choice decisions here), so every surface shows the same selection. Keyed by pending id, so a new
// decision starts empty without an effect.
import { create } from 'zustand';
import type { Pending } from '@frostpunk/engine';

export interface SelectionState {
  pendingId: number | null;
  /** how many times each option id is picked (0/1 for N-of-M, up to the cap for distribute) */
  counts: Record<string, number>;
}

const NONE: Record<string, number> = {};

export const useSelection = create<SelectionState>()(() => ({ pendingId: null, counts: NONE }));

/** Selection counts for one decision (empty when the store holds a different decision). */
export function useCounts(p: Pending | null): Record<string, number> {
  return useSelection((s) => (p && s.pendingId === p.id ? s.counts : NONE));
}

export function totalOf(counts: Record<string, number>): number {
  let t = 0;
  for (const k of Object.keys(counts)) t += counts[k] ?? 0;
  return t;
}

/** Option ids in engine option order, repeated by their count: the `pick` array for answer(). */
export function pickArray(p: Pending, counts: Record<string, number>): string[] {
  const out: string[] = [];
  for (const o of p.options) for (let i = 0; i < (counts[o.id] ?? 0); i++) out.push(o.id);
  return out;
}

function capsOf(p: Pending): Record<string, number> | undefined {
  return p.meta?.caps as Record<string, number> | undefined;
}

function currentFor(p: Pending): Record<string, number> {
  const s = useSelection.getState();
  return s.pendingId === p.id ? s.counts : NONE;
}

/** Adds (+1) or removes (-1) one pick of an option, within the decision's limits. */
export function bumpPick(p: Pending, id: string, delta: 1 | -1): void {
  const cur = currentFor(p);
  const n = cur[id] ?? 0;
  const total = totalOf(cur);
  const caps = capsOf(p);
  let want: number;
  if (delta > 0) {
    if (total >= p.max) return;
    if (caps && n >= (caps[id] ?? 1)) return;
    if (!caps && n >= 1) return;
    want = n + 1;
  } else {
    if (n <= 0) return;
    want = n - 1;
  }
  const next: Record<string, number> = { ...cur, [id]: want };
  if (want === 0) delete next[id];
  useSelection.setState({ pendingId: p.id, counts: next });
}

/** A click (map, HUD or digit key) on an option of a multi-choice decision: adds or removes it. */
export function toggleBoardPick(p: Pending, id: string): void {
  const cur = currentFor(p);
  const n = cur[id] ?? 0;
  const caps = capsOf(p);
  if (caps) {
    const canUp = n < (caps[id] ?? 1) && totalOf(cur) < p.max;
    bumpPick(p, id, canUp ? 1 : -1);
    return;
  }
  bumpPick(p, id, n > 0 ? -1 : 1);
}

export function clearSelection(): void {
  useSelection.setState({ pendingId: null, counts: NONE });
}
