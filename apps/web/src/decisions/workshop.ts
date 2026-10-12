// The Workshop choice: one decision per Workshop effect (engine op techWorkshopStep, prompt "Workshop effect (N left)").
// The engine does not say how many effects the run has, only how many are left after the current one. The total is
// taken from the first step of a run (left = total) and kept here while the steps count down by one. Presentation only.
import { create } from 'zustand';
import type { Pending } from '@frostpunk/engine';

interface Run {
  /** effects in the run, from its first step */
  total: number;
  /** "left" shown by the previous Workshop step, -1 when none */
  lastLeft: number;
}

const useRun = create<Run>()(() => ({ total: 0, lastLeft: -1 }));

/** What each Workshop option does, shown under it (the engine's own labels stay the same). */
export const WORKSHOP_HINT: Record<string, string> = {
  upgrade: 'Pay the cost to upgrade one Building that has no worker on it. Its upgraded effect applies from now on.',
  dev: 'The Technology in development moves one Round nearer completion. Only possible while one is in development.',
};

export interface WorkshopPos {
  /** this effect's number in the run, 1-based */
  k: number;
  /** effects in the run */
  n: number;
}

/** True for the Workshop effect choice (the engine's techWorkshopStep decision). */
export function isWorkshopChoice(p: Pending | null | undefined): boolean {
  if (!p || p.kind !== 'choice') return false;
  return p.then?.k === 'techWorkshopPick' || /^Workshop effect \(\d+ left\)$/.test(p.prompt);
}

/** Effects left after this one, from the engine's op data or, failing that, the prompt text. */
function leftOf(p: Pending): number | null {
  const fromOp = typeof p.then?.left === 'number' ? (p.then.left as number) : null;
  if (fromOp !== null) return fromOp;
  const m = /\((\d+) left\)/.exec(p.prompt);
  return m ? Number(m[1]) : null;
}

/** "Workshop effect k of n" for the pending Workshop choice; null for any other decision. Pure given the run store. */
export function workshopPosition(p: Pending | null | undefined): WorkshopPos | null {
  if (!p || !isWorkshopChoice(p)) return null;
  const left = leftOf(p);
  if (left === null || left < 1) return null;
  const run = useRun.getState();
  const continues = run.lastLeft === left + 1 && run.total >= left;
  const n = continues ? run.total : left;
  return { k: n - left + 1, n };
}

/** Records the step a Workshop choice is showing, so the next step can count on from it. Call from an effect. */
export function noteWorkshopStep(p: Pending | null | undefined): void {
  if (!p || !isWorkshopChoice(p)) return;
  const pos = workshopPosition(p);
  const left = leftOf(p);
  if (!pos || left === null) return;
  useRun.setState({ total: pos.n, lastLeft: left });
}

/** Forgets the run (a new game). */
export function resetWorkshopRun(): void {
  useRun.setState({ total: 0, lastLeft: -1 });
}
