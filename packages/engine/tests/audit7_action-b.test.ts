// Audit 7 (action, second half): focused checks for the Use a Building, Construct, Deploy Scouts and Citizen-card items
// of RULES_CHECKLIST section 6 (ACT-CO3, ACT-CO4, ACT-UB1, ACT-UB2, ACT-UB3, ACT-UB8, ACT-UB9, ACT-DS2).
// Rulebook: p26 (Construct, Use a Building, Deploy Scouts), p27 (Special Actions), appendix pp41-44.
// `it.fails` cases document a rules gap that is still open in the engine (the test passes while the gap exists).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { push, run } from '../src/core';
import { answer } from '../src/setup';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import { newMeeple } from '../src/util';
import { costPayable, placeBuilding, queueDestroy, startUseBuilding, usageProblem } from '../src/buildings';
import { legalExpeditionDeploy } from '../src/expedition';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** A solo state with one Near tile (N01) so that Small and Large buildings have spaces to stand on. */
function world(): GameState {
  const s = blankState();
  placeTileAt(s, 'N01', 1, 0, 'near');
  return s;
}

describe('ACT-UB1 Engineer-only buildings: Platform (and the rest of the list) refuse a Worker', () => {
  it('a Worker is refused at the Platform, an Engineer may use it', () => {
    const s = world();
    const plat = placeBuilding(s, 'platform', 'N01:top', { printed: true })!;
    const worker = newMeeple(s, 'worker');
    const eng = newMeeple(s, 'engineer');
    expect(usageProblem(s, plat, worker.id, 0)).toBe('Engineers only');
    expect(usageProblem(s, plat, eng.id, 0)).toBeNull();
  });
});

describe('ACT-UB2 Cookhouse: spend 3 Food, then Hope +1 or Discontent -1 (choice)', () => {
  it('pays 3 Food and asks which effect to take', () => {
    const s = world();
    const cook = placeBuilding(s, 'cookhouse', 'N01:top')!;
    s.food = 5;
    const worker = newMeeple(s, 'worker');
    expect(startUseBuilding(s, 0, worker.id, cook.uid, { heated: true })).toBe(true);
    drain(s);
    expect(s.food).toBe(2);
    expect(s.pending).not.toBeNull();
    expect(s.pending!.options.length).toBe(2);
  });

  it('cannot be used with fewer than 3 Food', () => {
    const s = world();
    const cook = placeBuilding(s, 'cookhouse', 'N01:top')!;
    s.food = 2;
    const worker = newMeeple(s, 'worker');
    expect(usageProblem(s, cook, worker.id, 0)).not.toBeNull();
  });
});

describe('ACT-UB4 / ACT-UB3 Generator and Platform cost and effect checks', () => {
  it('Generator: "spend 1 Steam Core to remove all Stress" is the second choice and removes all Stress', () => {
    const s = world();
    const gen = placeBuilding(s, 'generator', 'N01:top', { printed: true })!;
    s.gen.stress = 7;
    s.res.core = 1;
    const eng = newMeeple(s, 'engineer');
    expect(startUseBuilding(s, 0, eng.id, gen.uid, { heated: true })).toBe(true);
    drain(s);
    expect(s.pending).not.toBeNull();
    // second option of the choice: pay 1 Steam Core, remove all Stress, Generator upgrade placed
    const second = s.pending!.options[1].id;
    answer(s, s.pending!.who, s.pending!.id, [second]);
    drain(s);
    expect(s.res.core).toBe(0);
    expect(s.gen.stress).toBe(0);
    expect(s.gen.upgraded).toBe(true);
  });
});

describe('ACT-CO3 Dismantle: Beacon has no Dismantle; it must also not be destroyed', () => {
  it('Destroy (Dusk/social effects) must not offer a Beacon (rulebook p26: red Dismantle icon = no destroy)', () => {
    const s = world();
    // the Beacon is Large: both spaces of the tile
    const beacon = placeBuilding(s, 'beacon', 'N01:top')!;
    expect(beacon).not.toBeNull();
    queueDestroy(s, 0, 'choose', 1);
    drain(s);
    // with a single candidate the engine resolves the destroy without asking, so check the outcome on the map
    const ids = (s.pending?.options ?? []).map((o: any) => String(o.id));
    expect(ids).not.toContain(String(beacon.uid));
    expect(s.buildings.some((b) => b.uid === beacon.uid)).toBe(true);
  });
});

describe('ACT-CO4 Dreadnought: Steel substitutes for Wood (mixing allowed)', () => {
  it('a Wood cost is payable with Steel, and not when Steel is excluded', () => {
    const s = world();
    s.res.wood = 0;
    s.res.steel = 1;
    expect(costPayable(s, { wood: 1 })).toBeNull();
    expect(costPayable(s, { wood: 1 }, false)).toBe('Needs 1 Wood');
  });

  it('paying the full Wood cost in Steel places the new building already upgraded', () => {
    const s = world();
    s.res.steel = 1;
    push(s, {
      k: 'bldBuildPlace',
      c: { who: 0, cont: null, free: false, filter: 'any', overRuins: false, woodDiscount: 0 },
      kind: 'charcoalKiln',
      spaceId: 'N01:top',
      cost: { wood: 1, core: 0 },
      paid: { wood: 0, steel: 1 },
    } as any);
    drain(s);
    const b = s.buildings.find((x) => x.kind === 'charcoalKiln');
    expect(b).toBeDefined();
    expect(b!.upgraded).toBe(true);
  });

  it('paying the Wood cost in Wood does not upgrade the new building', () => {
    const s = world();
    s.res.wood = 1;
    push(s, {
      k: 'bldBuildPlace',
      c: { who: 0, cont: null, free: false, filter: 'any', overRuins: false, woodDiscount: 0 },
      kind: 'charcoalKiln',
      spaceId: 'N01:top',
      cost: { wood: 1, core: 0 },
      paid: { wood: 1, steel: 0 },
    } as any);
    drain(s);
    expect(s.buildings.find((x) => x.kind === 'charcoalKiln')!.upgraded).toBe(false);
  });
});

describe('ACT-UB8 Law buildings with an effect that was not covered by the existing tests', () => {
  it('Cemetery: the Corpse marker moves first; with no corpse to move there is no choice (no Hope)', () => {
    const s = world();
    const cem = placeBuilding(s, 'cemetery', 'N01:top')!;
    s.corpse = 0;
    const worker = newMeeple(s, 'worker');
    startUseBuilding(s, 0, worker.id, cem.uid, { heated: true });
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.hope.length).toBe(0);
  });

  it('Cemetery: Corpse marker back 1 or 2 is asked, and Hope is gained only after the move', () => {
    const s = world();
    const cem = placeBuilding(s, 'cemetery', 'N01:top')!;
    s.corpse = 3;
    s.hopeBag = { care: 2, justice: 2, motivation: 2 } as any;
    const worker = newMeeple(s, 'worker');
    startUseBuilding(s, 0, worker.id, cem.uid, { heated: true });
    drain(s);
    expect(s.pending?.options.map((o: any) => o.id)).toEqual(['1', '2']);
    expect(s.hope.length).toBe(0);
    answer(s, s.pending!.who, s.pending!.id, ['2']);
    drain(s);
    expect(s.corpse).toBe(1);
    expect(s.hope.length).toBe(1);
  });

  it('Snow Pit (on build): Corpse marker back 1-3 is asked', () => {
    const s = world();
    s.corpse = 5;
    placeBuilding(s, 'snowPit', 'N01:top');
    drain(s);
    expect(s.pending?.options.map((o: any) => o.id)).toEqual(['1', '2', '3']);
  });

  it('Prison: Hunger -4 and the Meeple stays in the Prison (m.stay)', () => {
    const s = world();
    const prison = placeBuilding(s, 'prison', 'N01:top')!;
    s.hunger = 6;
    const worker = newMeeple(s, 'worker');
    startUseBuilding(s, 0, worker.id, prison.uid, { heated: true });
    drain(s);
    expect(s.hunger).toBe(2);
    expect(worker.stay).toBe(true);
  });
});

describe('ACT-DS2 Citizen-card variant C05: replace an empty Expedition stack with a B card', () => {
  function beaconWorld(): GameState {
    const s = world();
    placeBuilding(s, 'beacon', 'N01:top');
    newMeeple(s, 'worker');
    return s;
  }

  it('needs an unoccupied non-scenario stack and a B card', () => {
    const s = beaconWorld();
    s.expeditions = [{ uid: 1, scout: null, scenario: false, bonus: {} } as any];
    s.decks.expB = [];
    expect(legalExpeditionDeploy(s, { replaceWithB: true })).toBe('No free Expedition stack');
    s.decks.expB = ['B01'];
    expect(legalExpeditionDeploy(s, { replaceWithB: true })).toBeNull();
  });

  it('a scenario stack cannot be replaced', () => {
    const s = beaconWorld();
    s.expeditions = [{ uid: 1, scout: null, scenario: true, bonus: {} } as any];
    s.decks.expB = ['B01'];
    expect(legalExpeditionDeploy(s, { replaceWithB: true })).toBe('No free Expedition stack');
  });
});

describe('ACT-UB9 Dreadnought tile: a Small Building with Blue insulation; using it gains 1 Steel', () => {
  it('the tile action is gain:steel:1 and the Meeple may use it', () => {
    const s = world();
    const tile = placeBuilding(s, 'dreadnoughtTile', 'N01:top', { printed: true });
    expect(tile).not.toBeNull();
    const meeple = newMeeple(s, 'worker');
    expect(usageProblem(s, tile!, meeple.id, 0)).toBeNull();
    startUseBuilding(s, 0, meeple.id, tile!.uid, { heated: true });
    drain(s);
    expect(s.res.steel).toBe(1);
  });
});
