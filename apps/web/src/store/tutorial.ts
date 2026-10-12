// Tutorial lessons this browser has finished (the lesson list shows them). A per-viewer convenience: it is kept in
// localStorage, and a blocked or full storage only loses the record.
import { create } from 'zustand';

const KEY = 'frostpunk.tutorial.done.v1';

function read(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: the record is lost, nothing else depends on it */
  }
}

interface TutorialStore {
  /** ids of the lessons finished in this browser */
  done: string[];
  markDone: (id: string) => void;
}

export const useTutorial = create<TutorialStore>()((set, get) => ({
  done: read(),
  markDone: (id) => {
    if (get().done.includes(id)) return;
    const next = [...get().done, id];
    write(next);
    set({ done: next });
  },
}));
