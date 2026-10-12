// Audit 8 (TEC-04): behavioural probes for the Technology modifiers that were marker-only (audit_4_tech_mods.test.ts):
// T01 Lighter Scout Sleds, T03 Charcoal Kiln Upgrade, T05 Medical Education, T06 Generator Safety System, T08 Construction
// Planning, T09 Steam Hub, T10 Wood Processing, T12 Night Care, T13 Equipment Upgrade, T15 Natural Fertiliser,
// T16 Nutrition Education. Each probe runs the real building, expedition, generator or construct flow with and without the
// Technology and asserts the difference the card names. Helpers mirror audit8_tec04_t07_t11.test.ts (settle, withTech).
import { describe, expect, it, vi } from 'vitest';
import '../src/index';
import { push, run } from '../src/core';
import { blankState } from '../src/testing';
import { placeTileAt, spaceHeated } from '../src/map';
import { placeBuilding, sleepSlots, startConstruct, startUseBuilding, unlockedKinds } from '../src/buildings';
import { deployScout, initExpDecks, setupExpeditions } from '../src/expedition';
import { STRESS_SLOTS, totalStress } from '../src/generator';
import { newMeeple } from '../src/util';
import { techs as TECHS } from '../src/data';
import type { GameState } from '../src/types';

// The Generator drawer rolls for falling Stress cubes (generator.ts genStress). Pinning every roll to "no cube falls" keeps the
// Generator Safety System probe on the overflow it sets up; the rule under test is the Technology, not the drawer.
vi.mock('../src/rng', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/rng')>();
  return { ...m, chance: () => false };
});

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

const TOP = 'N01:top';
const BOTTOM = 'N01:bottom';

/** One near tile (N01) on the board; its two spaces are N01:top and N01:bottom. */
function board(): GameState {
  const s = blankState();
  placeTileAt(s, 'N01', 1, 0, 'near');
  return s;
}

describe('T01 Lighter Scout Sleds: a Scout deployed on an Expedition moves 1 space forward', () => {
  /** Deploys the first Worker as a Scout on the first Expedition stack; returns the Scout's space on that stack. */
  function scoutPos(tech: string | null): number {
    const s = board();
    placeBuilding(s, 'beacon', TOP, { noOnBuild: true }); // Deploy Scouts needs a Beacon
    newMeeple(s, 'worker');
    initExpDecks(s);
    setupExpeditions(s);
    if (tech) withTech(s, tech);
    const stack = s.expeditions[0];
    deployScout(s, 0);
    settle(s, (p) => (p.kind === 'expStack' ? [String(stack.uid)] : undefined));
    return s.expeditions.find((x) => x.uid === stack.uid)!.scout!.pos;
  }

  it('without T01 the deployed Scout stands on space 1', () => {
    expect(scoutPos(null)).toBe(1);
  });

  it('with T01 the deployed Scout is moved one space forward (space 2)', () => {
    expect(scoutPos('T01')).toBe(2);
  });
});

describe('T03 Charcoal Kiln Upgrade: a Tree on any Map tile may replace the 1 Wood', () => {
  function kiln(tech: string | null) {
    const s = board();
    const k = placeBuilding(s, 'charcoalKiln', TOP, { noOnBuild: true })!;
    s.spaces[BOTTOM].trees = 1;
    s.res.wood = 0;
    const w = newMeeple(s, 'worker');
    if (tech) withTech(s, tech);
    const used = startUseBuilding(s, 0, w.id, k.uid, { heated: true });
    settle(s);
    return { s, used };
  }

  it('without T03 the Kiln cannot be used when there is no Wood to pay', () => {
    const { s, used } = kiln(null);
    expect(used).toBe(false);
    expect(s.spaces[BOTTOM].trees).toBe(1);
    expect(s.res.coal).toBe(0);
  });

  it('with T03 the Kiln removes the Tree at no Wood cost and gains its Coal', () => {
    const { s, used } = kiln('T03');
    expect(used).toBe(true);
    expect(s.spaces[BOTTOM].trees).toBe(0);
    expect(s.res.wood).toBe(0);
    expect(s.res.coal).toBe(4);
  });
});

describe('T05 Medical Education: an Engineer at a Medical Post may Treat 2 instead of its normal effect', () => {
  /** Worker sickness: 3 markers with the Skull side up. Medical Post normal effect: cure:3 (cannot cure the Skull marker to 0). */
  function post(tech: string | null) {
    const s = board();
    const mp = placeBuilding(s, 'medicalPost', TOP, { noOnBuild: true })!;
    s.sick.worker = { n: 3, skull: true } as any;
    const eng = newMeeple(s, 'engineer');
    if (tech) withTech(s, tech);
    let asked = false;
    startUseBuilding(s, 0, eng.id, mp.uid, { heated: true });
    settle(s, (p) => {
      if (p.kind === 'choice') {
        asked = true;
        return ['1']; // the Treat 2 branch
      }
      return undefined;
    });
    return { s, asked };
  }

  it('without T05 the Medical Post cures (3 markers down to the Skull floor of 1) and asks nothing', () => {
    const { s, asked } = post(null);
    expect(asked).toBe(false);
    expect(s.sick.worker.n).toBe(1);
    expect(s.sick.worker.skull).toBe(true);
  });

  it('with T05 the Medical Post may choose Treat 2: the Skull is treated and no marker is cured', () => {
    const { s, asked } = post('T05');
    expect(asked).toBe(true);
    expect(s.sick.worker.skull).toBe(false);
    expect(s.sick.worker.n).toBe(3);
  });
});

describe('T06 Generator Safety System: the Generator Building removes 1 extra Stress; the phase clears a small overflow', () => {
  /** Stress on the track (8) used with the Generator Building by an Engineer: the normal action removes up to 5. */
  function generatorUse(tech: string | null): number {
    const s = board();
    const g = placeBuilding(s, 'generator', TOP, { noOnBuild: true })!;
    s.gen.stress = 8;
    s.gen.overflow = 0;
    const eng = newMeeple(s, 'engineer');
    if (tech) withTech(s, tech);
    startUseBuilding(s, 0, eng.id, g.uid, { heated: true });
    settle(s);
    return totalStress(s);
  }

  /** Generator phase with 2 Stress cubes on the overflow space (the track is full). */
  function phase(tech: string | null) {
    const s = blankState();
    s.gen.stress = STRESS_SLOTS;
    s.gen.overflow = 2;
    if (tech) withTech(s, tech);
    push(s, { k: 'genStress' });
    settle(s);
    return s;
  }

  it('without T06 the Generator Building removes 5 Stress (8 down to 3)', () => {
    expect(generatorUse(null)).toBe(3);
  });

  it('with T06 the Generator Building also removes 1 extra Stress (8 down to 2)', () => {
    expect(generatorUse('T06')).toBe(2);
  });

  it('without T06 the overflow of 2 cubes causes a Generator breakdown', () => {
    const s = phase(null);
    expect(s.gen.broken).toBe(true);
  });

  it('with T06 the 2 overflow cubes are removed before the breakdown check: no breakdown', () => {
    const s = phase('T06');
    expect(s.gen.broken).toBeFalsy();
    expect(s.gen.overflow).toBe(0);
    expect(s.gen.stress).toBe(STRESS_SLOTS);
  });
});

describe('T08 Construction Planning: a Construct action has up to 4 sub-actions; Dismantle gains 1 Wood', () => {
  /** Number of Construct sub-action choices offered by a Construct action; each sub-action builds when it can. */
  function subActions(tech: string | null): number {
    const s = board();
    placeTileAt(s, 'N02', 2, 0, 'near');
    s.res.wood = 50;
    if (tech) withTech(s, tech);
    let prompts = 0;
    startConstruct(s, 0, null, { isAction: true });
    settle(s, (p) => {
      if (p.kind !== 'construct') return undefined;
      prompts++;
      return p.options.some((o: any) => o.id === 'build' && !o.disabled) ? ['build'] : ['done'];
    });
    return prompts;
  }

  function dismantleWood(tech: string | null) {
    const s = board();
    const hut = placeBuilding(s, 'huntersHut', TOP, { noOnBuild: true })!;
    s.res.wood = 0;
    if (tech) withTech(s, tech);
    push(s, { k: 'bldDismantleDo', c: { who: 0, src: null, cont: null }, pick: [String(hut.uid)] } as any);
    settle(s);
    return { s, wood: s.res.wood, uid: hut.uid };
  }

  it('without T08 a Construct action offers 3 sub-actions', () => {
    expect(subActions(null)).toBe(3);
  });

  it('with T08 a Construct action offers 4 sub-actions', () => {
    expect(subActions('T08')).toBe(4);
  });

  it('without T08 dismantling a Building gains no Wood', () => {
    const { s, wood, uid } = dismantleWood(null);
    expect(s.buildings.some((b) => b.uid === uid)).toBe(false);
    expect(wood).toBe(0);
  });

  it('with T08 dismantling a Building gains 1 Wood', () => {
    const { s, wood, uid } = dismantleWood('T08');
    expect(s.buildings.some((b) => b.uid === uid)).toBe(false);
    expect(wood).toBe(1);
  });
});

describe('T09 Steam Hub (Frozen Grove only): unlocks the Steam Hub; its Coal heats its tile and the adjacent tiles', () => {
  function grove(tech: string | null): GameState {
    const s = blankState({ scenario: 'frozenGrove' } as any);
    placeTileAt(s, 'N01', 1, 0, 'near');
    placeTileAt(s, 'N02', 2, 0, 'near');
    if (tech) withTech(s, tech);
    return s;
  }

  /** A built Steam Hub on N01, Heat 2 above the red indicator (1), 2 Coal in the bank. */
  function hub(tech: string | null): { s: GameState; uid: number } {
    const s = grove(tech);
    const h = placeBuilding(s, 'steamHub', TOP, { noOnBuild: true });
    if (!h) throw new Error('steam hub not placed');
    s.gen.heat = 2;
    s.gen.ind.red = 1;
    s.res.coal = 2;
    return { s, uid: h.uid };
  }

  it('without T09 the Steam Hub is not unlocked; with T09 it is', () => {
    expect(unlockedKinds(grove(null))).not.toContain('steamHub');
    expect(unlockedKinds(grove('T09'))).toContain('steamHub');
  });

  it('with T09 placing Coal in the Steam Hub makes its tile and the adjacent tile heated (not before)', () => {
    const { s, uid } = hub('T09');
    s.gen.heat = 0; // not heated by the Generator, so the Steam Hub Coal is the only source of heat here
    expect(spaceHeated(s, 'N02:top')).toBe(false);
    s.gen.heat = 2;
    push(s, { k: 'steamHubDo', who: 0 } as any);
    settle(s);
    expect(s.buildings.find((b) => b.uid === uid)?.steamHubCoal).toBe(true);
    expect(spaceHeated(s, TOP)).toBe(true);
    expect(spaceHeated(s, 'N02:top')).toBe(true);
  });

  it('with T09 the Coal placed in the Steam Hub goes back to the bank in the Generator phase', () => {
    const { s, uid } = hub('T09');
    push(s, { k: 'steamHubDo', who: 0 } as any);
    settle(s);
    expect(s.res.coal).toBe(1);
    expect(s.buildings.find((b) => b.uid === uid)?.steamHubCoal).toBe(true);
    push(s, { k: 'genStress' });
    settle(s);
    expect(s.buildings.find((b) => b.uid === uid)?.steamHubCoal).toBeFalsy();
    expect(s.res.coal).toBe(2);
  });
});

describe('T10 Wood Processing: a Sawmill or Wall Drill use gains 1 extra Wood', () => {
  function woodGain(kind: string, tech: string | null): number {
    const s = board();
    // Placed directly on both spaces: the Wall Drill's rim-deposit placement rule is not under test (the board has no rim).
    const b = { uid: ++s.nextUid, kind, upgraded: false, ruins: false, spaces: [TOP, BOTTOM] } as any;
    s.spaces[TOP].building = b.uid;
    s.spaces[BOTTOM].building = b.uid;
    s.buildings.push(b);
    s.spaces[BOTTOM].trees = 1; // the Sawmill removes a Tree on the tile
    s.res.wood = 0;
    const w = newMeeple(s, 'worker');
    if (tech) withTech(s, tech);
    startUseBuilding(s, 0, w.id, b.uid, { heated: true });
    settle(s);
    return s.res.wood;
  }

  for (const kind of ['sawmill', 'wallDrill']) {
    it(`${kind}: 3 Wood without T10, 4 Wood with T10`, () => {
      expect(woodGain(kind, null)).toBe(3);
      expect(woodGain(kind, 'T10')).toBe(4);
    });
  }
});

describe('T12 Night Care: a heated Medical Post or Infirmary gives 1 sleeping slot for an Engineer', () => {
  function engineerSlots(kind: string, tech: string | null, heat: number): number {
    const s = board();
    s.gen.heat = heat;
    const b = placeBuilding(s, kind, TOP, { noOnBuild: true })!;
    if (tech) withTech(s, tech);
    return sleepSlots(s)
      .filter((x) => x.uid === b.uid)
      .reduce((a, x) => a + x.engineerCapacity, 0);
  }

  for (const kind of ['medicalPost', 'infirmary']) {
    it(`${kind}: heated with T12 gives 1 Engineer slot, without T12 none`, () => {
      expect(engineerSlots(kind, null, 3)).toBe(0);
      expect(engineerSlots(kind, 'T12', 3)).toBe(1);
    });

    it(`${kind}: unheated with T12 gives no Engineer slot`, () => {
      expect(engineerSlots(kind, 'T12', 0)).toBe(0);
    });
  }
});

describe('T13 Equipment Upgrade: a Coal Thumper use also gains 2 Coal', () => {
  function coalAfterThumper(tech: string | null): number {
    const s = board();
    const th = placeBuilding(s, 'coalThumper', TOP, { noOnBuild: true })!;
    s.res.coal = 0; // the Thumper places Coal from the bank on adjacent spaces; with none in the bank it places none
    const w = newMeeple(s, 'worker');
    if (tech) withTech(s, tech);
    startUseBuilding(s, 0, w.id, th.uid, { heated: true });
    settle(s);
    return s.res.coal;
  }

  it('without T13 the Coal Thumper gains no Coal', () => {
    expect(coalAfterThumper(null)).toBe(0);
  });

  it('with T13 the Coal Thumper also gains 2 Coal', () => {
    expect(coalAfterThumper('T13')).toBe(2);
  });
});

describe('T15 Natural Fertiliser: an Engineer at a Hothouse may move the Corpse marker back 1 for 3 extra Food', () => {
  function hothouse(tech: string | null) {
    const s = board();
    const h = placeBuilding(s, 'hothouse', TOP, { noOnBuild: true })!;
    s.corpse = 3;
    s.food = 0;
    const eng = newMeeple(s, 'engineer');
    if (tech) withTech(s, tech);
    startUseBuilding(s, 0, eng.id, h.uid, { heated: true });
    settle(s, (p) => (p.kind === 'choice' ? ['0'] : undefined)); // option 0: Corpse back 1 and 3 Food
    return { food: s.food, corpse: s.corpse };
  }

  it('without T15 the Hothouse gains its 7 Food and no Corpse is moved', () => {
    expect(hothouse(null)).toEqual({ food: 7, corpse: 3 });
  });

  it('with T15 an Engineer may move the Corpse marker back 1 for 3 extra Food', () => {
    expect(hothouse('T15')).toEqual({ food: 10, corpse: 2 });
  });
});

describe('T16 Nutrition Education: a Child Meeple may use the Cookhouse', () => {
  function cookhouse(tech: string | null) {
    const s = board();
    const c = placeBuilding(s, 'cookhouse', TOP, { noOnBuild: true })!;
    s.food = 10;
    const child = newMeeple(s, 'child');
    if (tech) withTech(s, tech);
    const used = startUseBuilding(s, 0, child.id, c.uid, { heated: true });
    settle(s);
    return { used, food: s.food };
  }

  it('without T16 a Child Meeple cannot use the Cookhouse and no Food is paid', () => {
    expect(cookhouse(null)).toEqual({ used: false, food: 10 });
  });

  it('with T16 a Child Meeple uses the Cookhouse and pays its 3 Food', () => {
    expect(cookhouse('T16')).toEqual({ used: true, food: 7 });
  });
});

/** The eleven modifiers this file probes (the marker-only ids of audit8_tec04_t07_t11.test.ts OPEN_PROBES). */
const PROBED = ['T01', 'T03', 'T05', 'T06', 'T08', 'T09', 'T10', 'T12', 'T13', 'T15', 'T16'];

describe('sweep: the marker-only Technologies are real Technologies with a probe in this file', () => {
  it('every probed id exists in the Technology list', () => {
    expect(PROBED.filter((id) => !(id in (TECHS as Record<string, unknown>)))).toEqual([]);
  });
});
