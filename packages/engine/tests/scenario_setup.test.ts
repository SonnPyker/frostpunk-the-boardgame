// Random and custom solo set-up (web "Kịch bản ngẫu nhiên" and "Tùy chỉnh"): the random draw uses only printed Society cards,
// a custom start is held to START_LIMITS, and a custom start feeds the set-up and the replay.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import * as D from '../src/data';
import { meepleCountFor } from '../src/data';
import {
  createGame,
  newGameState,
  PLAYABLE_SCENARIOS,
  randomSetup,
  replay,
  serialize,
  startValues,
  START_LIMITS,
  validateConfig,
  validateStart,
} from '../src/index';
import { autoplay } from '../src/autoplay';
import { checkInvariants } from '../src/invariants';
import { blankConfig } from '../src/testing';
import type { GameConfig, StartOverride } from '../src/types';

const NAME = 'Commander';

function printedCard(society: number, difficulty: 'normal' | 'hard' | 'survivalist') {
  const row = (D.societies as any[]).find((c) => c.society === society && c.difficulty === difficulty);
  if (!row) throw new Error(`no printed card ${society}/${difficulty}`);
  return row;
}

/** Fully-specified custom start that matches a printed card, for editing in the tests. */
function startFrom(society: number, difficulty: 'normal' | 'hard' = 'normal'): StartOverride {
  return startValues(blankConfig({ society, difficulty, extraPack: false }));
}

describe('random set-up draw', () => {
  it('draws a playable scenario, one Advisor, and a start within START_LIMITS', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const cfg = randomSetup(seed, { name: NAME, extraPack: seed % 2 === 0 });
      expect(validateConfig(cfg)).toBeUndefined();
      expect(PLAYABLE_SCENARIOS).toContain(cfg.scenario);
      expect(cfg.advisors).toHaveLength(1);
      expect(Object.keys(D.advisors)).toContain(cfg.advisors![0]);
      expect(cfg.survivalist).toBeUndefined();
      expect(cfg.start).toBeDefined();
      expect(() => validateStart(cfg.start!)).not.toThrow();
    }
  });

  it('is reproducible for one draw seed and gives a different start on each draw', () => {
    const opts = { name: NAME, extraPack: true };
    expect(randomSetup(42, opts)).toEqual(randomSetup(42, opts));
    const starts = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) starts.add(JSON.stringify(randomSetup(seed, opts).start));
    expect(starts.size).toBe(200);
  });

  it('draws across the whole range of each number, not only the printed card values', () => {
    const seen = { workerLow: false, workerHigh: false, hopeOne: false, hopeTop: false, corpseTop: false, automatonTop: false };
    for (let seed = 1; seed <= 500; seed++) {
      const st = randomSetup(seed, { name: NAME, extraPack: false }).start!;
      seen.workerLow ||= st.pop[0] <= 5;
      seen.workerHigh ||= st.pop[0] >= 45;
      seen.hopeOne ||= st.hope[0] === 1;
      seen.hopeTop ||= st.hope[0] === START_LIMITS.hope;
      seen.corpseTop ||= st.corpse === START_LIMITS.corpse;
      seen.automatonTop ||= st.automaton === START_LIMITS.automaton;
    }
    expect(Object.values(seen).every(Boolean)).toBe(true);
  });

  it('gives each draw its own map and decks, since the seed shuffles them', () => {
    const opts = { name: NAME, extraPack: false };
    const a = newGameState(randomSetup(1, opts));
    const b = newGameState(randomSetup(2, opts));
    expect(a.stacks).not.toEqual(b.stacks);
    expect(a.decks.morning).not.toEqual(b.decks.morning);
  });

  it('starts valid games that keep every invariant, and plays some of them on', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const cfg = randomSetup(seed, { name: NAME, extraPack: seed % 2 === 0 });
      const s = createGame(cfg);
      expect(checkInvariants(s), `draw ${seed}`).toEqual([]);
      expect(s.status, `draw ${seed}`).toBe('playing');
    }
    for (let seed = 1; seed <= 24; seed++) {
      const s = createGame(randomSetup(seed, { name: NAME, extraPack: seed % 2 === 0 }));
      const r = autoplay(s, seed, 300);
      expect(r.error).toBeUndefined();
      expect(checkInvariants(s)).toEqual([]);
    }
  });
});

describe('custom start limits', () => {
  it('accepts the printed cards as custom starts', () => {
    for (let society = 1; society <= 6; society++) {
      for (const difficulty of ['normal', 'hard'] as const) {
        expect(() => validateStart(startFrom(society, difficulty))).not.toThrow();
      }
    }
  });

  it('accepts the largest value of every limit', () => {
    const top: StartOverride = {
      pop: [START_LIMITS.citizens, START_LIMITS.citizens, START_LIMITS.citizens],
      sick: [START_LIMITS.sick, START_LIMITS.sick, START_LIMITS.sick],
      automaton: START_LIMITS.automaton,
      food: START_LIMITS.supply,
      wood: START_LIMITS.supply,
      coal: START_LIMITS.supply,
      cores: START_LIMITS.supply,
      hope: [START_LIMITS.hope, START_LIMITS.hope],
      discontent: [START_LIMITS.discontent, START_LIMITS.discontent],
      corpse: START_LIMITS.corpse,
    };
    expect(() => validateStart(top)).not.toThrow();
  });

  it('refuses values outside the limits and starts that would lose at once', () => {
    const base = startFrom(1);
    const bad: Array<[string, Partial<StartOverride>]> = [
      ['worker count above 50', { pop: [51, 12, 8] }],
      ['negative engineer count', { pop: [22, -1, 8] }],
      ['fractional child count', { pop: [22, 12, 8.5] }],
      ['sick above the population', { pop: [22, 12, 8], sick: [23, 0, 0] }],
      ['sick at 26 (Sickness loses)', { pop: [50, 12, 8], sick: [26, 0, 0] }],
      ['seven Automatons', { automaton: 7 }],
      ['food above 50', { food: 51 }],
      ['negative coal', { coal: -1 }],
      ['no Hope token (loses at once)', { hope: [0, 0] }],
      ['more active Hope than drawn', { hope: [2, 3] }],
      ['seven Hope tokens (track has six)', { hope: [7, 0] }],
      ['six Discontent tokens (sixth loses)', { discontent: [6, 0] }],
      ['more active Discontent than drawn', { discontent: [2, 3] }],
      ['corpse on the last space (loses)', { corpse: START_LIMITS.corpse + 1 }],
    ];
    for (const [why, patch] of bad) {
      expect(() => validateStart({ ...base, ...patch } as StartOverride), why).toThrow();
    }
    expect(() => validateStart({ ...base, hope: undefined } as unknown as StartOverride), 'missing Hope').toThrow();
    expect(() => validateStart(null as unknown as StartOverride), 'no start object').toThrow();
  });

  it('is checked by validateConfig, so a bad custom start never reaches the engine', () => {
    const cfg: GameConfig = { ...blankConfig({ society: 1 }), start: { ...startFrom(1), automaton: 9 } };
    expect(() => validateConfig(cfg)).toThrow(/Automatons/);
  });
});

describe('custom start feeds the set-up', () => {
  const custom: StartOverride = {
    pop: [10, 6, 3],
    sick: [2, 1, 0],
    automaton: 2,
    food: 12,
    wood: 7,
    coal: 9,
    cores: 3,
    hope: [4, 2],
    discontent: [3, 1],
    corpse: 2,
  };

  it('sets the population, supplies, tokens and Corpse as typed', () => {
    const s = newGameState(blankConfig({ society: 1, start: custom }));
    expect(s.cit).toEqual({ worker: 10, engineer: 6, child: 3 });
    expect(s.sick.worker.n).toBe(2);
    expect(s.sick.engineer.n).toBe(1);
    expect(s.sick.child.n).toBe(0);
    expect(s.food).toBe(12);
    expect(s.res).toMatchObject({ wood: 7, coal: 9, core: 3 });
    expect(s.corpse).toBe(2);
    expect(s.hope).toHaveLength(4);
    expect(s.hope.filter((t) => t.a)).toHaveLength(2);
    expect(s.disc).toHaveLength(3);
    expect(s.disc.filter((t) => t.a)).toHaveLength(1);
  });

  it('places the meeples and Automatons for the typed numbers', () => {
    const s = newGameState(blankConfig({ society: 1, start: custom }));
    expect(s.meeples.filter((m) => m.kind === 'worker')).toHaveLength(meepleCountFor(10));
    expect(s.meeples.filter((m) => m.kind === 'engineer')).toHaveLength(meepleCountFor(6));
    expect(s.meeples.filter((m) => m.kind === 'child')).toHaveLength(meepleCountFor(3));
    expect(s.meeples.filter((m) => m.kind === 'automaton')).toHaveLength(2);
  });

  it('ignores the printed card when a custom start is set', () => {
    const cfg = blankConfig({ society: 6, start: custom });
    expect(startValues(cfg)).toBe(cfg.start);
    expect(startValues(blankConfig({ society: 6 })).pop).toEqual(printedCard(6, 'normal').pop);
  });

  it('replays to the same state from its config and no commands', () => {
    const cfg = blankConfig({ society: 1, start: custom });
    expect(serialize(replay(cfg, []))).toBe(serialize(createGame(cfg)));
    expect(JSON.parse(JSON.stringify(cfg))).toEqual(cfg);
  });

  it('keeps the invariants with the largest allowed start', () => {
    const top: StartOverride = {
      pop: [50, 50, 50],
      sick: [25, 25, 25],
      automaton: 6,
      food: 50,
      wood: 50,
      coal: 50,
      cores: 50,
      hope: [6, 6],
      discontent: [5, 5],
      corpse: 9,
    };
    const s = createGame(blankConfig({ society: 1, start: top }));
    expect(checkInvariants(s)).toEqual([]);
  });
});
