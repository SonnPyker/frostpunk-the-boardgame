// Audit 8 (TEC-04): behavioural tests for Technology modifiers T07 (Carrier Sledge), T11 (Heating Lamps), plus a sweep
// over T01-T17. The sweep requires each modifier to be probed by a with/without-Technology difference in the behaviour it
// names (not only a marker in the source). Modifiers that have no probe yet are listed by name in OPEN_PROBES; the sweep
// fails if a Technology is neither probed nor listed, so a gap cannot be dropped silently.
import { describe, expect, it } from 'vitest';
import '../src/index';
import { push, run } from '../src/core';
import { blankState } from '../src/testing';
import { placeTileAt } from '../src/map';
import { tileOfSpace } from '../src/map';
import { actionHeated } from '../src/actions';
import { automatonCoal } from '../src/actions';
import { gatherCandidates } from '../src/actions';
import { techWeatherRuns } from '../src/tech';
import { techs as TECHS } from '../src/data';
import type { GameState } from '../src/types';

/** Runs the engine; each pending decision is answered by `pickFor` (undefined = the first enabled option). */
function settle(s: GameState, pickFor: (p: any) => string[] | undefined = () => undefined) {
  for (let i = 0; i < 60; i++) {
    try {
      run(s);
    } catch (e: any) {
      if (!/stack ran dry/.test(String(e?.message))) throw e;
    }
    const p: any = s.pending;
    if (!p) return;
    const pick = pickFor(p) ?? [p.options.find((o: any) => !o.disabled)?.id].filter(Boolean);
    s.pending = null;
    s.stack.push({ ...p.then, pick });
  }
  throw new Error('did not settle');
}

const withTech = (s: GameState, id: string) => {
  s.techs = [...s.techs, { id, state: 'done' } as any];
  return s;
};

/** A state with one Near tile (N01) placed; its first two spaces hold plenty of Resources. */
function gatherSetup(tech: string | null) {
  const s = blankState();
  s.gen.heat = 0; // cold: the gather is not heated by the Generator (no Heat-based heating)
  s.discBag = { anger: 5, apathy: 5, greed: 5 };
  s.hopeBag = { care: 5, justice: 5, motivation: 5 };
  s.cit = { worker: 6, engineer: 6, child: 0 };
  placeTileAt(s, 'N01', 1, 0, 'near');
  const tile = s.tiles[0];
  const [a, b] = tile.spaces;
  s.spaces[a].res = { wood: 5, coal: 0, core: 0 } as any;
  s.spaces[b].res = { wood: 0, coal: 5, core: 0 } as any;
  if (tech) withTech(s, tech);
  return { s, a, b };
}

describe('T07 Carrier Sledge: a Gather Resources action takes up to 3 Resources from any spaces on the tile', () => {
  it('without T07 a gather takes up to 2 Resources from the one space chosen (no choice: one space offers only one option)', () => {
    const { s, a } = gatherSetup(null);
    const woodBefore = s.res.wood;
    push(s, { k: 'actGatherDo', who: 0, pick: [a], meeple: null, card: null } as any);
    let asked = false;
    settle(s, (p) => {
      if (p.kind === 'gatherRes') asked = true;
      return undefined;
    });
    expect(asked).toBe(false);
    expect(s.res.wood - woodBefore).toBe(2);
    expect(s.spaces[a].res.wood).toBe(3);
  });

  it('with T07 the gather asks for 3 Resources and offers the spaces of the whole tile', () => {
    const { s, a, b } = gatherSetup('T07');
    push(s, { k: 'actGatherDo', who: 0, pick: [a], meeple: null, card: null } as any);
    let pending: any = null;
    settle(s, (p) => {
      if (p.kind === 'gatherRes') pending = p;
      return undefined;
    });
    expect(pending).not.toBeNull();
    expect(pending.meta.count).toBe(3);
    const ids = pending.options.map((o: any) => o.id);
    expect(ids).toContain(a + '|wood');
    expect(ids).toContain(b + '|coal');
  });

  it('with T07 the chosen mix comes from different spaces and the bank and the spaces change by the same amounts', () => {
    const { s, a, b } = gatherSetup('T07');
    const woodBefore = s.res.wood;
    const coalBefore = s.res.coal;
    push(s, { k: 'actGatherDo', who: 0, pick: [a], meeple: null, card: null } as any);
    settle(s, (p) => (p.kind === 'gatherRes' ? [a + '|wood', b + '|coal', b + '|coal'] : undefined));
    expect(s.res.wood - woodBefore).toBe(1);
    expect(s.res.coal - coalBefore).toBe(2);
    expect(s.spaces[a].res.wood).toBe(4);
    expect(s.spaces[b].res.coal).toBe(3);
  });

  it('the tile helper finds both spaces on the tile (the test premise)', () => {
    const { s, a, b } = gatherSetup('T07');
    const t = tileOfSpace(s, a);
    expect(t?.spaces ?? []).toEqual(expect.arrayContaining([a, b]));
  });
});

describe('T11 Heating Lamps: the Remove Snow action is always heated', () => {
  // A cold Remove Snow by a Worker gives +1 sick Worker (applyCold, actions.ts). With T11 the action is heated: no cold.
  function removeSnow(tech: string | null): GameState {
    const s = blankState();
    s.gen.heat = 0;
    s.discBag = { anger: 5, apathy: 5, greed: 5 };
    s.hopeBag = { care: 5, justice: 5, motivation: 5 };
    s.cit = { worker: 6, engineer: 6, child: 0 };
    placeTileAt(s, 'N01', 1, 0, 'near');
    s.meeples = [{ id: 1, kind: 'worker', loc: { k: 'supply' } } as any];
    if (tech) withTech(s, tech);
    push(s, { k: 'actResolve', who: 0, action: 'removeSnow', card: null, meeple: 1 } as any);
    settle(s);
    return s;
  }

  it('without T11 a Remove Snow with a Worker in the cold is a cold action (+1 sick Worker)', () => {
    const s = removeSnow(null);
    expect(s.log.some((e) => e.t === 'act.cold')).toBe(true);
    expect(s.sick.worker.n).toBe(1);
  });

  it('with T11 the same Remove Snow is heated: no cold action and no sick Worker', () => {
    const s = removeSnow('T11');
    expect(s.log.some((e) => e.t === 'act.cold')).toBe(false);
    expect(s.sick.worker.n).toBe(0);
  });

  it('the heated check of the Remove Snow action is the T11 check (actionHeated does not depend on it)', () => {
    const s = blankState();
    s.gen.heat = 0;
    placeTileAt(s, 'N01', 1, 0, 'near');
    expect(actionHeated(s, s.tiles[0].spaces[0], false, [])).toBe(false);
  });
});

describe('T17 Advanced Automatons: Automatons cost no Coal when Heat is above the red level', () => {
  it('without T17 an Automaton costs 1 Coal', () => {
    const s = blankState();
    s.gen.ind = { red: 1, orange: 2, yellow: 3 };
    s.gen.heat = 4;
    expect(automatonCoal(s)).toBe(1);
  });

  it('with T17 and Heat above red: free; with T17 and Heat at or below red: 1 Coal', () => {
    const s = withTech(blankState(), 'T17');
    s.gen.ind = { red: 2, orange: 3, yellow: 4 };
    s.gen.heat = 3;
    expect(automatonCoal(s)).toBe(0);
    s.gen.heat = 2;
    expect(automatonCoal(s)).toBe(1);
  });
});

describe('T04 Steampowered Chainsaw: a tree-only space is a Gather candidate', () => {
  it('without T04 a space with only Trees is not offered for a Resource gather; with T04 it is', () => {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    const sid = s.tiles[0].spaces[0];
    s.spaces[sid].res = { wood: 0, coal: 0, core: 0 } as any;
    s.spaces[sid].trees = 1;
    expect(gatherCandidates(s, 'res')).not.toContain(sid);
    withTech(s, 'T04');
    expect(gatherCandidates(s, 'res')).toContain(sid);
  });
});

/** Two Hunter's Huts (1 Food per 2 Hunting symbols) on the board. */
function withHunters(s: GameState) {
  placeTileAt(s, 'N01', 1, 0, 'near');
  const sid = s.tiles[0].spaces[0];
  s.buildings.push({ uid: 901, kind: 'huntersHut', space: sid } as any);
  s.buildings.push({ uid: 902, kind: 'huntersHut', space: sid } as any);
  return s;
}

describe('T02 / T14 Weather phase: extra Food from the Technology weather effects', () => {
  it('T02 adds 1 Food per 2 Hunting symbols in the Weather phase (two Hunter\'s Huts give 1 Food)', () => {
    const s = withHunters(blankState());
    expect(techWeatherRuns(s).length).toBe(0);
    withTech(s, 'T02');
    const runs = techWeatherRuns(s);
    expect(runs.map((r) => r.src)).toEqual(['tech:T02']);
    expect(runs[0].list).toEqual(['gain:food:1']);
  });

  it('T14 adds 1 Food per Map tile depicting a Food Bonus', () => {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    s.tiles[0].food = 1;
    expect(techWeatherRuns(s).length).toBe(0);
    withTech(s, 'T14');
    const runs = techWeatherRuns(s);
    expect(runs.map((r) => r.src)).toEqual(['tech:T14']);
    expect(runs[0].list).toEqual(['gain:food:1']);
  });
});

// ---- sweep over T01-T17 ----------------------------------------------------------------------------------------------

/** Each probe returns true when developing the Technology changes the behaviour it names. */
const PROBES: Record<string, () => boolean> = {
  T02: () => techWeatherRuns(withTech(withHunters(blankState()), 'T02')).length > techWeatherRuns(withHunters(blankState())).length,
  T04: () => {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    const sid = s.tiles[0].spaces[0];
    s.spaces[sid].res = { wood: 0, coal: 0, core: 0 } as any;
    s.spaces[sid].trees = 1;
    const before = gatherCandidates(s, 'res').includes(sid);
    withTech(s, 'T04');
    return gatherCandidates(s, 'res').includes(sid) !== before;
  },
  T07: () => {
    // Resources taken from the tile in one gather, with the player taking 3 from the first space when asked
    const taken = (tech: string | null) => {
      const { s, a } = gatherSetup(tech);
      const before = s.res.wood + s.res.coal;
      push(s, { k: 'actGatherDo', who: 0, pick: [a], meeple: null, card: null } as any);
      settle(s, (p) => (p.kind === 'gatherRes' ? [a + '|wood', a + '|wood', a + '|wood'] : undefined));
      return s.res.wood + s.res.coal - before;
    };
    return taken('T07') !== taken(null);
  },
  T11: () => removeSnow(null) !== removeSnow('T11'),
  T14: () => {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    s.tiles[0].food = 1;
    const before = techWeatherRuns(s).length;
    return techWeatherRuns(withTech(s, 'T14')).length > before;
  },
  T17: () => {
    const s = blankState();
    s.gen.ind = { red: 2, orange: 3, yellow: 4 };
    s.gen.heat = 3;
    const before = automatonCoal(s);
    return automatonCoal(withTech(s, 'T17')) !== before;
  },
};

function removeSnow(tech: string | null): string {
  // the sick Worker count after a Remove Snow in the cold (see the T11 tests above)
  const s = blankState();
  s.gen.heat = 0;
  s.discBag = { anger: 5, apathy: 5, greed: 5 };
  s.hopeBag = { care: 5, justice: 5, motivation: 5 };
  s.cit = { worker: 6, engineer: 6, child: 0 };
  placeTileAt(s, 'N01', 1, 0, 'near');
  s.meeples = [{ id: 1, kind: 'worker', loc: { k: 'supply' } } as any];
  if (tech) withTech(s, tech);
  push(s, { k: 'actResolve', who: 0, action: 'removeSnow', card: null, meeple: 1 } as any);
  settle(s);
  return String(s.sick.worker.n);
}

/**
 * Modifiers probed in audit8_tec04_rest.test.ts (with/without behaviour tests), not in PROBES above.
 */
const OPEN_PROBES = ['T01', 'T03', 'T05', 'T06', 'T08', 'T09', 'T10', 'T12', 'T13', 'T15', 'T16'];

describe('sweep: every Technology modifier changes the behaviour it names', () => {
  const all = Object.keys(TECHS as Record<string, unknown>).sort();

  it('the Technology list is T01-T17', () => {
    expect(all).toEqual(Array.from({ length: 17 }, (_, i) => 'T' + String(i + 1).padStart(2, '0')));
  });

  it('every Technology is either probed or named in OPEN_PROBES (no silent gap)', () => {
    const unaccounted = all.filter((id) => !PROBES[id] && !OPEN_PROBES.includes(id));
    expect(unaccounted).toEqual([]);
    const stale = [...Object.keys(PROBES), ...OPEN_PROBES].filter((id) => !all.includes(id));
    expect(stale).toEqual([]);
  });

  for (const id of Object.keys(PROBES)) {
    it(`${id}: developing it changes the behaviour it names`, () => {
      expect(PROBES[id]()).toBe(true);
    });
  }
});
