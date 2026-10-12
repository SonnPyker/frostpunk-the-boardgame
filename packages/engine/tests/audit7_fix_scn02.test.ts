// Audit 7 fix regression, SCN-02:
// (1) FG1 (Frozen Grove): Construct and Use a Building are limited to tiles adjacent or connected to the Generator
//     (Scenario Book, Frozen Grove, Action phase; scenarios.json FG1). ACT-11 already applies spaceAllowed in
//     placementOptions and usageProblem; these tests pin that behaviour.
// (2) Steam Hub passive (Scenario Book p3, "At any time during the round"): the free Steam Hub Coal step is offered at the
//     start of Dawn, Morning, Weather and Preparation as well as Dusk and Hunger. The Generator phase offers none (its
//     Stress step returns the Coal to the bank).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions';
import '../src/buildings';
import '../src/generator';
import '../src/sickness';
import '../src/tech';
import '../src/cards';
import '../src/expedition';
import '../src/phases';
import '../src/night';
import '../src/scenario';
import { answerPending, push, run } from '../src/core';
import { placeBuilding, placementOptions, usageProblem } from '../src/buildings';
import { placeTileAt } from '../src/map';
import { initTileStacks } from '../src/tiles';
import { blankState } from '../src/testing';
import { phaseBody } from '../src/phases';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

function answerOk(s: GameState, pick: string[]) {
  const id = s.pending!.id;
  try {
    answerPending(s, s.leader, id, pick);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
  expect(s.pending?.id).not.toBe(id);
}

/** Frozen Grove: connected Near tile N01 at hex (1,0), unconnected Far tile F01 at hex (3,0). */
function frozenWorld(): { s: GameState; nearSpaces: string[]; farSpaces: string[] } {
  const s = blankState({ scenario: 'frozenGrove' });
  s.gen.heat = 3;
  s.gen.cold = 5;
  initTileStacks(s);
  const near = placeTileAt(s, 'N01', 1, 0, 'near');
  const far = placeTileAt(s, 'F01', 3, 0, 'far');
  return { s, nearSpaces: [...near.spaces], farSpaces: [...far.spaces] };
}

/** Frozen Grove with a built Steam Hub on the connected tile, Heat 2 above the red indicator (1), 2 Coal in the supply. */
function hubState(): { s: GameState; uid: number } {
  const s = blankState({ scenario: 'frozenGrove' });
  placeTileAt(s, 'N01', 1, 0, 'near');
  const hub = placeBuilding(s, 'steamHub', 'N01:top', { noOnBuild: true });
  if (!hub) throw new Error('steam hub not placed');
  s.gen.heat = 2;
  s.gen.ind.red = 1;
  s.res.coal = 2;
  return { s, uid: hub.uid };
}

describe('SCN-02 / FG1: Construct and Use a Building follow the connection rule', () => {
  it('Construct offers a connected space and never an unconnected one', () => {
    const { s, nearSpaces, farSpaces } = frozenWorld();
    const ids = placementOptions(s, 'house').map((o) => o.id);
    expect(ids).toContain(nearSpaces[0]);
    for (const sid of farSpaces) expect(ids).not.toContain(sid);
  });

  it('Construct of a Large building is offered only on a connected tile', () => {
    const { s, nearSpaces, farSpaces } = frozenWorld();
    const ids = placementOptions(s, 'hothouse').map((o) => o.id);
    expect(ids).toContain(nearSpaces[0]);
    expect(ids).not.toContain(farSpaces[0]);
  });

  it('Use a Building on an unconnected tile is refused with the not-connected reason', () => {
    const { s, farSpaces } = frozenWorld();
    const b = placeBuilding(s, 'cookhouse', farSpaces[0], { noOnBuild: true });
    expect(b).not.toBeNull();
    expect(usageProblem(s, b!, null, 0)).toBe('Not connected to the Generator');
  });
});

describe('SCN-02 / Steam Hub passive: the free Coal step at any time during the round', () => {
  const offeredFirst = ['dawn', 'morning', 'weather', 'preparation', 'dusk', 'hunger'] as const;

  it('each of Dawn, Morning, Weather, Preparation, Dusk and Hunger begins with the Steam Hub step when a Hub may take Coal', () => {
    const { s } = hubState();
    for (const phase of offeredFirst) {
      const ops = phaseBody(s, phase);
      expect(ops[0], phase).toEqual({ k: 'ntSteamHub' });
    }
  });

  it('the Generator phase offers no Steam Hub step (its Stress step returns the Coal)', () => {
    const { s } = hubState();
    expect(phaseBody(s, 'generator').map((o) => o.k)).not.toContain('ntSteamHub');
  });

  it('no phase offers the step when Heat is not above the red level', () => {
    const { s } = hubState();
    s.gen.heat = 1;
    for (const phase of [...offeredFirst, 'generator' as const]) {
      expect(phaseBody(s, phase).map((o) => o.k), phase).not.toContain('ntSteamHub');
    }
  });

  it('starting Dawn asks the Steam Hub question first; choosing done lets the Dawn phase continue', () => {
    const { s, uid } = hubState();
    const roundBefore = s.round;
    push(s, { k: 'phStart', phase: 'dawn' });
    drain(s);
    expect(s.pending?.kind).toBe('steamHub');
    expect(s.pending!.options.map((o) => o.id)).toEqual([`b:${uid}`, 'done']);
    answerOk(s, ['done']);
    drain(s);
    expect(s.round).toBe(roundBefore + 1);
    expect(s.buildings.find((b) => b.uid === uid)?.steamHubCoal).toBeFalsy();
  });

  it('starting Preparation asks the Steam Hub question and placing Coal spends it', () => {
    const { s, uid } = hubState();
    push(s, { k: 'phStart', phase: 'preparation' });
    drain(s);
    expect(s.pending?.kind).toBe('steamHub');
    answerOk(s, [`b:${uid}`]);
    drain(s);
    expect(s.buildings.find((b) => b.uid === uid)?.steamHubCoal).toBe(true);
    expect(s.res.coal).toBe(1);
  });
});
