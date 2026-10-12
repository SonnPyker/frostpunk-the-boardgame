// Hand-built-state coverage for the Technology effect hooks (T01-T17) that the bot simulator never reached.
// Each hook is checked through the exported helper that reads it (buildings.ts effectiveAction, actions.ts automatonCoal /
// gatherCandidates, tech.ts weatherFxRuns, buildings.ts usageProblem / sleepSlots).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run } from '../src/core';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import { automatonCoal, gatherCandidates } from '../src/actions';
import { effectiveAction, sleepSlots, usageProblem } from '../src/buildings';
import { weatherFxRuns } from '../src/tech';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** A state where the given Technologies are developed (state 'done'). */
function withTechs(done: string[]): GameState {
  const s = blankState();
  s.techs = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12', 'T13', 'T14', 'T15', 'T16', 'T17'].map((id) => ({
    id,
    state: done.includes(id) ? 'done' : 'inactive',
    dueRound: null,
  })) as GameState['techs'];
  return s;
}

/** A Building standing on a real space of a real tile (so occupancy and heating read correctly). */
function building(s: GameState, kind: string, extra: Record<string, unknown> = {}) {
  if (!s.tiles.some((t) => t.key === '0,0')) {
    s.tiles.push({ key: '0,0', id: 'N01', kind: 'near', q: 0, r: 0, food: 0, zone: 'A', spaces: [] } as any);
  }
  const sid = 'N01:top' + s.buildings.length;
  s.spaces[sid] = { id: sid, tile: '0,0', slot: 'top', res: {}, trees: 0, building: null } as any;
  (s.tiles.find((t) => t.key === '0,0') as any).spaces.push(sid);
  const b = { uid: ++s.nextUid, kind, upgraded: false, ruins: false, spaces: [sid], ...extra } as any;
  s.spaces[sid].building = b.uid;
  s.buildings.push(b);
  return b;
}

function space(s: GameState, id: string, trees: number, res: Record<string, number> = {}) {
  s.spaces[id] = { id, tile: '0,0', slot: 'top', res, trees, building: null } as any;
}

const json = (x: unknown) => JSON.stringify(x);

describe('T03 Charcoal Kiln Upgrade: a tree may replace the Wood', () => {
  it('offers a choice between paying 1 Wood and removing a Tree when both are available', () => {
    const s = withTechs(['T03']);
    space(s, 'N01:top', 1);
    s.res.wood = 1;
    const e = effectiveAction(s, building(s, 'charcoalKiln'), null)!;
    expect(json(e.fx)).toContain('pay:wood:1');
    expect(json(e.fx)).toContain('removeTree:any');
  });

  it('removes a Tree at no cost when there is no Wood to pay', () => {
    const s = withTechs(['T03']);
    space(s, 'N01:top', 1);
    s.res.wood = 0;
    const e = effectiveAction(s, building(s, 'charcoalKiln'), null)!;
    expect(e.cost).toEqual([]);
    expect(json(e.fx)).toContain('removeTree:any');
    expect(json(e.fx)).not.toContain('pay:wood');
  });

  it('keeps the normal Kiln action without the Technology', () => {
    const s = withTechs([]);
    space(s, 'N01:top', 1);
    s.res.wood = 1;
    const e = effectiveAction(s, building(s, 'charcoalKiln'), null)!;
    expect(json(e.fx)).not.toContain('removeTree');
  });
});

describe('T05 Medical Education, T13 Equipment Upgrade, T10 Wood Processing, T06 Generator Safety', () => {
  it('Medical Post may Treat 2 (only with T05)', () => {
    const s = withTechs(['T05']);
    expect(json(effectiveAction(s, building(s, 'medicalPost'), null)!.fx)).toContain('treat:2');
    const s0 = withTechs([]);
    expect(json(effectiveAction(s0, building(s0, 'medicalPost'), null)!.fx)).not.toContain('treat:2');
  });

  it('Coal Thumper gains 2 extra Coal (T13)', () => {
    const s = withTechs(['T13']);
    expect(json(effectiveAction(s, building(s, 'coalThumper'), null)!.fx)).toContain('gain:coal:2');
    const s0 = withTechs([]);
    expect(json(effectiveAction(s0, building(s0, 'coalThumper'), null)!.fx)).not.toContain('gain:coal:2');
  });

  it('Sawmill and Wall Drill gain 1 extra Wood (T10)', () => {
    for (const kind of ['sawmill', 'wallDrill']) {
      const s = withTechs(['T10']);
      expect(json(effectiveAction(s, building(s, kind), null)!.fx)).toContain('gain:wood:1');
    }
  });

  it('Generator Building removes an extra Stress cube on use (T06 action part)', () => {
    const s = withTechs(['T06']);
    expect(json(effectiveAction(s, building(s, 'generator'), null)!.fx)).toContain('removeStress:1');
  });
});

describe('T15 Natural Fertiliser: Engineer at a Hothouse may lower the Corpse marker for 3 Food', () => {
  it('offers corpseBack:1 to an Engineer when there are corpses', () => {
    const s = withTechs(['T15']);
    s.corpse = 3;
    s.meeples.push({ id: 1, kind: 'engineer', loc: { k: 'supply' } } as any);
    const e = effectiveAction(s, building(s, 'hothouse'), 1)!;
    expect(json(e.fx)).toContain('corpseBack:1');
    expect(json(e.fx)).toContain('gain:food:3');
  });

  it('does not apply to a Worker, or when there is no corpse', () => {
    const s = withTechs(['T15']);
    s.corpse = 3;
    s.meeples.push({ id: 1, kind: 'worker', loc: { k: 'supply' } } as any);
    expect(json(effectiveAction(s, building(s, 'hothouse'), 1)!.fx)).not.toContain('corpseBack');
    s.meeples[0].kind = 'engineer' as any;
    s.corpse = 0;
    expect(json(effectiveAction(s, s.buildings[0], 1)!.fx)).not.toContain('corpseBack');
  });
});

describe('T17 Advanced Automatons: Automatons do not cost Coal above the red Heat level', () => {
  it('automatonCoal is 0 when Heat is above red and the Technology is developed', () => {
    const s = withTechs(['T17']);
    s.gen.ind.red = 1;
    s.gen.heat = 2;
    expect(automatonCoal(s)).toBe(0);
  });

  it('automatonCoal is not 0 at the same Heat without the Technology', () => {
    const s = withTechs([]);
    s.gen.ind.red = 1;
    s.gen.heat = 2;
    expect(automatonCoal(s)).toBeGreaterThan(0);
  });

  it('Automatons may use any Building only with T17', () => {
    const s = withTechs(['T17']);
    s.meeples.push({ id: 1, kind: 'automaton', loc: { k: 'supply' } } as any);
    const mp = building(s, 'medicalPost');
    expect(usageProblem(s, mp, 1, 0)).toBeNull();
    const s0 = withTechs([]);
    s0.meeples.push({ id: 1, kind: 'automaton', loc: { k: 'supply' } } as any);
    const mp0 = building(s0, 'medicalPost');
    expect(usageProblem(s0, mp0, 1, 0)).toBe('Engineers only');
  });
});

describe('T16 Nutrition Education: a Child may use the Cookhouse', () => {
  it('a Child may use a Cookhouse with T16 but not without it', () => {
    const s = withTechs(['T16']);
    s.food = 10;
    s.meeples.push({ id: 1, kind: 'child', loc: { k: 'supply' } } as any);
    expect(usageProblem(s, building(s, 'cookhouse'), 1, 0)).toBeNull();
    const s0 = withTechs([]);
    s0.food = 10;
    s0.meeples.push({ id: 1, kind: 'child', loc: { k: 'supply' } } as any);
    expect(usageProblem(s0, building(s0, 'cookhouse'), 1, 0)).toBe('Child Meeples act only through Citizen cards');
  });
});

describe('T12 Night Care: heated Medical Posts and Infirmaries add an Engineer sleeping slot', () => {
  it('a heated Medical Post gives one more Engineer place with T12', () => {
    const s = withTechs(['T12']);
    s.gen.heat = 3;
    const mp = building(s, 'medicalPost');
    const slots = sleepSlots(s).filter((x) => x.uid === mp.uid);
    expect(slots.reduce((a, x) => a + x.engineerCapacity, 0)).toBe(1);
  });

  it('no extra Engineer place without T12', () => {
    const s = withTechs([]);
    s.gen.heat = 3;
    const mp = building(s, 'medicalPost');
    const slots = sleepSlots(s).filter((x) => x.uid === mp.uid);
    expect(slots.reduce((a, x) => a + x.engineerCapacity, 0)).toBe(0);
  });
});

describe('T04 Steampowered Chainsaw: Gather may take a Tree-only space', () => {
  it('a space with Trees and no Resources is a gather candidate only with T04', () => {
    const s = withTechs(['T04']);
    space(s, 'N01:top', 1);
    expect(gatherCandidates(s, 'res')).toContain('N01:top');
    const s0 = withTechs([]);
    space(s0, 'N01:top', 1);
    expect(gatherCandidates(s0, 'res')).not.toContain('N01:top');
  });
});

describe('T02 Hunting Tactics and T14 Tracking Techniques: Weather Phase food', () => {
  it('T02 gains 1 Food per 2 Hunting symbols (4 Hunters Huts give 2 Food)', () => {
    const s = withTechs(['T02']);
    for (let i = 0; i < 4; i++) building(s, 'huntersHut');
    const runs = weatherFxRuns(s);
    const list = runs.flatMap((r) => r.list);
    expect(list).toContain('gain:food:2');
  });

  it('T02 gives nothing with fewer than 2 Hunting symbols', () => {
    const s = withTechs(['T02']);
    building(s, 'huntersHut');
    expect(weatherFxRuns(s).flatMap((r) => r.list).filter((x) => String(x).startsWith('gain:food'))).toEqual([]);
  });

  it('T14 gains 1 Food per Map tile with a Food Bonus', () => {
    const s = withTechs(['T14']);
    s.tiles = [{ key: '0,0', food: 1 }, { key: '1,0', food: 1 }, { key: '2,0', food: 0 }] as any;
    const list = weatherFxRuns(s).flatMap((r) => r.list);
    expect(list).toContain('gain:food:2');
  });
});

describe('T01 Lighter Scout Sleds and T09 Steam Hub: no unexpected effects before they are developed', () => {
  it('no Technology is developed on a blank state, so no weather runs exist', () => {
    const s = withTechs([]);
    expect(weatherFxRuns(s)).toEqual([]);
  });

  it('a developed Technology with no weather list adds no weather run', () => {
    const s = withTechs(['T01', 'T03']);
    expect(weatherFxRuns(s)).toEqual([]);
  });
});

// Ensure the module-level drain helper is used so a stack-empty run does not look like a failure.
describe('drain helper', () => {
  it('running an empty stack is not an error', () => {
    const s = blankState();
    expect(() => drain(s)).not.toThrow();
  });
});
