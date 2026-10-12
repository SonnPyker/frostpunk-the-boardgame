// Unit tests for buildings.ts: heated detection, Steel substitution, Large placement, upgrade/dismantle blocking,
// dismantle with T08, sleeping capacity and the Construct menu (spec 4.1, rulebook p26, appendix pp41-44).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { answerPending, push, run } from '../src/core';
import { buildings as BUILDINGS } from '../src/data';
import { placeTileAt, spaceHeated } from '../src/map';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import { newMeeple } from '../src/util';
import {
  buildCost,
  canDismantle,
  canUpgrade,
  flipToRuins,
  placeBuilding,
  sleepSlots,
  startConstruct,
  upgradeCostOf,
} from '../src/buildings';

const DEFS = BUILDINGS as Record<string, any>;

// Pending decisions and an empty stack are both normal in isolation: drain without failing on an empty stack.
function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** One near Map tile (N01: spaces N01:top and N01:bottom) on a cold Generator, so nothing is heated by the Generator. */
function setup(): GameState {
  const s = blankState();
  s.gen.heat = 0;
  placeTileAt(s, 'N01', 1, 0, 'near');
  return s;
}

function meepleOn(s: GameState, space: string) {
  const m = newMeeple(s, 'worker');
  m.loc = { k: 'space', space };
  return m;
}

describe('heated detection', () => {
  it('a Field Kitchen heats its whole tile even when the Generator is cold', () => {
    const s = setup();
    expect(spaceHeated(s, 'N01:bottom')).toBe(false);
    expect(placeBuilding(s, 'fieldKitchen', 'N01:top', { noOnBuild: true })).not.toBeNull();
    expect(spaceHeated(s, 'N01:bottom')).toBe(true);
  });
});

describe('payment and placement', () => {
  it('Steel replaces Wood in a Build cost, and the Steel is spent', () => {
    const s = setup();
    const wood = buildCost(s, 'house').wood ?? 0;
    expect(wood).toBeGreaterThan(0);
    s.res.wood = 0;
    s.res.steel = wood;
    push(s, {
      k: 'bldBuildPay',
      c: { who: 0, src: null, cont: null, free: false, filter: 'any', overRuins: false, woodDiscount: 0 },
      kind: 'house',
      pick: ['N01:top'],
    } as any);
    drain(s);
    expect(s.buildings.map((b) => b.kind)).toEqual(['house']);
    expect(s.spaces['N01:top'].building).toBe(s.buildings[0].uid);
    expect(s.res.steel).toBe(0);
  });

  it('a Large building takes both spaces of one tile and is blocked while either space holds a Meeple', () => {
    const kind = Object.keys(DEFS).find((k) => DEFS[k].size === 'L' && !DEFS[k].start && !DEFS[k].placement);
    expect(kind).toBeDefined();
    const s = setup();
    const m = meepleOn(s, 'N01:bottom');
    expect(placeBuilding(s, kind!, 'N01:top')).toBeNull();
    m.loc = { k: 'supply' };
    const b = placeBuilding(s, kind!, 'N01:top');
    expect(b?.spaces).toEqual(['N01:top', 'N01:bottom']);
    expect(s.spaces['N01:bottom'].building).toBe(b!.uid);
  });
});

describe('upgrade and dismantle', () => {
  it('a Meeple on a building blocks its upgrade and its dismantle', () => {
    const kind = Object.keys(DEFS).find((k) => DEFS[k].size === 'S' && !DEFS[k].start && upgradeCostOf(k) !== null);
    expect(kind).toBeDefined();
    const s = setup();
    const b = placeBuilding(s, kind!, 'N01:top')!;
    const m = meepleOn(s, 'N01:top');
    expect(canUpgrade(s, b.uid)).toBe(false);
    expect(canDismantle(s, b.uid)).toBe(false);
    m.loc = { k: 'supply' };
    expect(canUpgrade(s, b.uid)).toBe(true);
    expect(canDismantle(s, b.uid)).toBe(true);
  });

  it('dismantling returns +1 Wood only with T08 done', () => {
    const s = setup();
    const b = placeBuilding(s, 'house', 'N01:top')!;
    push(s, { k: 'bldDismantleDo', c: { who: 0, cont: null }, pick: [String(b.uid)] } as any);
    drain(s);
    expect(s.buildings.length).toBe(0);
    expect(s.res.wood).toBe(0);

    const s2 = setup();
    s2.techs.push({ id: 'T08', state: 'done' } as any);
    const b2 = placeBuilding(s2, 'house', 'N01:top')!;
    push(s2, { k: 'bldDismantleDo', c: { who: 0, cont: null }, pick: [String(b2.uid)] } as any);
    drain(s2);
    expect(s2.buildings.length).toBe(0);
    expect(s2.res.wood).toBe(1);
  });
});

describe('sleeping and ruins', () => {
  it('sleepSlots lists a heated shelter with its capacity; a flipped shelter drops out without L06', () => {
    const s = setup();
    placeBuilding(s, 'fieldKitchen', 'N01:bottom', { noOnBuild: true });
    const h = placeBuilding(s, 'house', 'N01:top')!;
    expect(sleepSlots(s).find((x) => x.uid === h.uid)?.capacity).toBe(DEFS.house.shelter);
    expect(flipToRuins(s, h.uid)).toBe(true);
    expect(sleepSlots(s).find((x) => x.uid === h.uid)).toBeUndefined();
  });
});

describe('Construct menu', () => {
  it('offers Build and End Construction, and End finishes the action', () => {
    const s = setup();
    s.res.wood = 10;
    startConstruct(s, 0, null, { maxSub: 1 });
    drain(s);
    expect(s.pending?.kind).toBe('construct');
    const ids = s.pending!.options.map((o) => o.id);
    expect(ids).toContain('build');
    expect(ids).toContain('done');
    try {
      answerPending(s, 0, s.pending!.id, ['done']);
    } catch (e: any) {
      if (!/stack ran dry/.test(String(e?.message))) throw e;
    }
    expect(s.pending).toBeNull();
  });
});
