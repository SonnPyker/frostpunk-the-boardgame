// Repair pass (audit 5 wave-5 review): two regressions in the Construct / Gather code.
//  1. C10 Worker (constructUpgrade:2subactions): "use 2 sub-actions to upgrade a Building by paying its upgrade cost".
//     One Upgrade uses both sub-actions: 3 -> 1 left, and with 1 left no second Upgrade is offered.
//  2. L01 Child Labour cap (up to 3 Resources): when the cap is below the number of adjacent Resources, the player picks
//     which spaces give them (kind 'space'); the picks decide which spaces are drained.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run } from '../src/core';
import { exec } from '../src/fx/core';
import { answer } from '../src/setup';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import { newMeeple } from '../src/util';
import { gatheringPostLimit, placeBuilding, queueGatherAdjacent } from '../src/buildings';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

function optionIds(s: GameState): string[] {
  return (s.pending?.options ?? []).map((o: any) => o.id);
}

function choose(s: GameState, ids: string[]) {
  const p = s.pending;
  expect(p).not.toBeNull();
  const r = answer(s, p!.who, p!.id, ids);
  expect(r.ok).toBe(true);
  drain(s);
}

// ---------------------------------------------------------------------------------------------------------
// 1. C10 Upgrade costs 2 sub-actions
// ---------------------------------------------------------------------------------------------------------

describe('C10 Worker: an Upgrade uses 2 Construct sub-actions (printed "use 2 sub-actions to upgrade")', () => {
  it('one Upgrade leaves 1 sub-action, and a second Upgrade is not offered', () => {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    placeTileAt(s, 'N02', 2, 0, 'near');
    expect(placeBuilding(s, 'huntersHut', 'N01:top')).not.toBeNull();
    expect(placeBuilding(s, 'gatheringPost', 'N01:bottom')).not.toBeNull();
    s.res.wood = 10;
    const worker = newMeeple(s, 'worker');

    exec(s, 'constructUpgrade:2subactions', { who: 0, meeple: worker.id, src: 'cit:C10' });
    drain(s);
    expect(s.pending?.kind).toBe('construct');
    expect(s.pending!.prompt).toBe('Construct: 3 sub-action(s) left');
    expect(optionIds(s)).toContain('upgrade');

    choose(s, ['upgrade']);
    // pick the first Building to upgrade (and answer any payment or confirmation that follows, but stop at the next Construct step)
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'construct'; i++) choose(s, [s.pending.options[0].id]);

    expect(s.pending?.kind).toBe('construct');
    expect(s.pending!.prompt).toBe('Construct: 1 sub-action(s) left');
    // the second Building could be upgraded, but one sub-action is not enough for an Upgrade that costs 2
    expect(optionIds(s)).not.toContain('upgrade');
    expect(optionIds(s)).toContain('done');
  });
});

// ---------------------------------------------------------------------------------------------------------
// 2. L01 Child Labour: the cap of 3 Resources is the player's choice of spaces
// ---------------------------------------------------------------------------------------------------------

describe('L01 Child Labour: the Gathering Post cap (3 Resources) is taken from spaces the player picks', () => {
  /** N01:top is adjacent to N01:bottom, GEN:UR, N02:top and N02:bottom; each holds 2 Wood. */
  function capWorld(): GameState {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    placeTileAt(s, 'N02', 2, 0, 'near');
    // the Generator space UR as setup.ts creates it (blankState has no Generator tile)
    s.spaces['GEN:UR'] = { id: 'GEN:UR', tile: 'GEN', slot: 'UR', res: {}, trees: 0, building: null } as any;
    for (const sid of ['N01:bottom', 'GEN:UR', 'N02:top', 'N02:bottom']) s.spaces[sid].res = { wood: 2 };
    s.laws.push({ id: 'L01', covered: null } as any);
    return s;
  }

  it('with 4 candidate spaces and a cap of 3, the engine asks which space gives each Resource', () => {
    const s = capWorld();
    const child = newMeeple(s, 'child');
    queueGatherAdjacent(s, 0, 'N01:top', 1, 'bld:gatheringPost', gatheringPostLimit(s, child.id));
    drain(s);
    expect(s.pending?.kind).toBe('space');
    expect(optionIds(s).sort()).toEqual(['GEN:UR', 'N01:bottom', 'N02:bottom', 'N02:top']);
  });

  it('the chosen spaces are the ones drained: N02:top, GEN:UR, N01:bottom give 3 Wood and N02:bottom is untouched', () => {
    const s = capWorld();
    const child = newMeeple(s, 'child');
    queueGatherAdjacent(s, 0, 'N01:top', 1, 'bld:gatheringPost', gatheringPostLimit(s, child.id));
    drain(s);
    choose(s, ['N02:top']);
    expect(s.pending?.kind).toBe('space');
    expect(optionIds(s).sort()).toEqual(['GEN:UR', 'N01:bottom', 'N02:bottom']); // N02:top gave its one Resource for this use
    choose(s, ['GEN:UR']);
    expect(s.pending?.kind).toBe('space');
    choose(s, ['N01:bottom']);
    expect(s.pending).toBeNull();
    expect(s.spaces['N02:top'].res.wood).toBe(1);
    expect(s.spaces['GEN:UR'].res.wood).toBe(1);
    expect(s.spaces['N01:bottom'].res.wood).toBe(1);
    expect(s.spaces['N02:bottom'].res.wood).toBe(2);
    expect(s.res.wood).toBe(3);
  });

  it('a different choice drains different spaces (the choice changes the outcome)', () => {
    const s = capWorld();
    const child = newMeeple(s, 'child');
    queueGatherAdjacent(s, 0, 'N01:top', 1, 'bld:gatheringPost', gatheringPostLimit(s, child.id));
    drain(s);
    choose(s, ['N02:bottom']);
    choose(s, ['N01:bottom']);
    choose(s, ['GEN:UR']);
    expect(s.pending).toBeNull();
    expect(s.spaces['N02:bottom'].res.wood).toBe(1);
    expect(s.spaces['N01:bottom'].res.wood).toBe(1);
    expect(s.spaces['GEN:UR'].res.wood).toBe(1);
    expect(s.spaces['N02:top'].res.wood).toBe(2);
    expect(s.res.wood).toBe(3);
  });

  it('when the cap is not binding (3 candidates, cap 3) the Resources are taken without a choice', () => {
    const s = capWorld();
    s.spaces['N02:bottom'].res = {};
    const child = newMeeple(s, 'child');
    queueGatherAdjacent(s, 0, 'N01:top', 1, 'bld:gatheringPost', gatheringPostLimit(s, child.id));
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.res.wood).toBe(3);
  });
});
