// Audit 5 (actions fixer): regression tests for the Action module.
// 1. Spend rule for Citizen cards (rulebook p16 "You cannot choose an effect for which you do not have the full amount"):
//    a Citizen card whose required Spend cannot be paid is not playable as a replacement of an action (C20, C23);
//    a card whose Spend is optional (C17, ifPay) stays playable.
// 2. Construct is an action (ConstructOpts.isAction, rulebook p26): T08 and the L18 Engineer budget apply to the
//    Construct action (normal, replaced by a Citizen card, or reused), not to a free Construct granted by an effect.
// 3. L01 Child Labour (law card, rulebook p13): a plain child Meeple using a Gathering Post takes up to 3 Resources.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { push, run } from '../src/core';
import { exec } from '../src/fx/core';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import { newMeeple } from '../src/util';
import { citizenCostProblem, playableCards } from '../src/actions';
import { constructActionOpts, gatheringPostLimit, placeBuilding, queueGatherAdjacent, startConstruct } from '../src/buildings';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** The top of the stack: the op an effect just pushed (startConstruct, queueGatherAdjacent). */
const top = (s: GameState): any => s.stack[s.stack.length - 1];

// ---------------------------------------------------------------------------------------------------------
// 1. Spend rule
// ---------------------------------------------------------------------------------------------------------

describe('Citizen card Spend rule (ACT-CC1)', () => {
  it('C20 "Spend 4 Food" in both options: not playable with 3 Food, playable with 4', () => {
    const s = blankState();
    s.food = 3;
    expect(citizenCostProblem(s, 'C20', 0)).not.toBeNull();
    s.food = 4;
    expect(citizenCostProblem(s, 'C20', 0)).toBeNull();
  });

  it('C23 cookhouse tiers: the smallest Spend (4 Food) decides playability', () => {
    const s = blankState();
    s.food = 3;
    expect(citizenCostProblem(s, 'C23', 0)).not.toBeNull();
    s.food = 4;
    expect(citizenCostProblem(s, 'C23', 0)).toBeNull();
  });

  it('C17 keeps its optional "may then spend 3 Food" part: playable with no Food', () => {
    const s = blankState();
    s.food = 0;
    expect(citizenCostProblem(s, 'C17', 0)).toBeNull();
  });

  it('a stale pick of C20 with 3 Food does not consume the card (actCitizenPick keeps it in hand)', () => {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    placeBuilding(s, 'cookhouse', 'N01:top', { noOnBuild: true });
    s.players[0].hand = ['C20'];
    const eng = newMeeple(s, 'engineer');
    s.food = 3;
    push(s, { k: 'actCitizenPick', who: 0, action: 'use', meeple: eng.id, pick: ['C20'] } as any);
    drain(s);
    expect(s.players[0].hand).toContain('C20');
    expect(s.players[0].playedCitizen).toBeNull();
  });

  it('playableCards omits C20 while its Spend cannot be paid, and offers it once it can', () => {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    placeBuilding(s, 'cookhouse', 'N01:top', { noOnBuild: true });
    s.players[0].hand = ['C20'];
    const eng = newMeeple(s, 'engineer');
    s.food = 3;
    expect(playableCards(s, 0, 'use', 'engineer', eng.id)).not.toContain('C20');
    s.food = 4;
    expect(playableCards(s, 0, 'use', 'engineer', eng.id)).toContain('C20');
  });
});

// ---------------------------------------------------------------------------------------------------------
// 2. Construct is an action
// ---------------------------------------------------------------------------------------------------------

describe('Construct is the Construct action (isAction)', () => {
  it('a free Construct (no isAction) has the default budget of 3 even with T08 developed', () => {
    const s = blankState();
    s.techs.push({ id: 'T08', state: 'done' } as any);
    startConstruct(s, 0, null, {});
    expect(top(s).c.left).toBe(3);
  });

  it('the Construct action with T08 developed has 4 sub-actions', () => {
    const s = blankState();
    s.techs.push({ id: 'T08', state: 'done' } as any);
    startConstruct(s, 0, null, { isAction: true });
    expect(top(s).c.left).toBe(4);
  });

  it('constructActionOpts marks the action; L18 gives an Engineer 2 sub-actions and an Upgrade costs both', () => {
    const s = blankState();
    s.laws.push({ id: 'L18', covered: null } as any);
    const eng = newMeeple(s, 'engineer');
    const wrk = newMeeple(s, 'worker');
    const o = constructActionOpts(s, eng.id);
    expect(o.isAction).toBe(true);
    expect(o.maxSub).toBe(2);
    expect(o.allowUpgrade).toBe(true);
    expect(o.upgradeCost).toBe(2);
    const w = constructActionOpts(s, wrk.id);
    expect(w.isAction).toBe(true);
    expect(w.maxSub).toBeUndefined();
    expect(w.allowUpgrade).toBeFalsy();
  });

  it('an explicit card budget wins over the L18 Engineer budget (the card names its own sub-actions)', () => {
    const s = blankState();
    s.laws.push({ id: 'L18', covered: null } as any);
    const eng = newMeeple(s, 'engineer');
    expect(constructActionOpts(s, eng.id, { maxSub: 3 }).maxSub).toBe(3);
  });

  it('a free Construct by an Engineer ignores L18: only the Construct action gets the Engineer budget', () => {
    const s = blankState();
    s.laws.push({ id: 'L18', covered: null } as any);
    const eng = newMeeple(s, 'engineer');
    startConstruct(s, 0, eng.id, {});
    expect(top(s).c.left).toBe(3);
    expect(top(s).c.allowUpgrade).toBe(false);
  });

  it('C18 (Engineer card, "as normal", constructOverRuins) gets the L18 Engineer budget', () => {
    const s = blankState();
    s.laws.push({ id: 'L18', covered: null } as any);
    const eng = newMeeple(s, 'engineer');
    exec(s, 'constructOverRuins:woodDiscount:1', { who: 0, meeple: eng.id, src: 'cit:C18' });
    expect(top(s).c.left).toBe(2);
    expect(top(s).c.allowUpgrade).toBe(true);
    expect(top(s).c.overRuins).toBe(true);
    expect(top(s).c.woodDiscount).toBe(1);
  });

  it('C25 (Child card, constructSubactions:2) keeps its printed 2 sub-actions', () => {
    const s = blankState();
    const child = newMeeple(s, 'child');
    exec(s, 'constructSubactions:2', { who: 0, meeple: child.id, src: 'cit:C25' });
    expect(top(s).c.left).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 3. L01 Child Labour: Gathering Post cap
// ---------------------------------------------------------------------------------------------------------

describe('L01 Child Labour: Gathering Post takes up to 3 Resources (printed)', () => {
  /** A near tile: N01:top and N01:bottom. The bottom space holds 6 Wood and is the only space adjacent to the top one. */
  function gatherWorld(): GameState {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    s.spaces['N01:bottom'].res = { wood: 6 };
    s.laws.push({ id: 'L01', covered: null } as any);
    return s;
  }

  it('gatheringPostLimit is 3 for a plain child under L01, and none for adults or Child Workers/Engineers', () => {
    const s = gatherWorld();
    expect(gatheringPostLimit(s, newMeeple(s, 'child').id)).toBe(3);
    expect(gatheringPostLimit(s, newMeeple(s, 'worker').id)).toBeUndefined();
    expect(gatheringPostLimit(s, newMeeple(s, 'childWorker').id)).toBeUndefined();
  });

  it('without L01 a child has no cap (the Gathering Post is then not open to children anyway)', () => {
    const s = blankState();
    expect(gatheringPostLimit(s, newMeeple(s, 'child').id)).toBeUndefined();
  });

  it('a plain child using the Gathering Post takes at most 3 Resources in total', () => {
    const s = gatherWorld();
    const child = newMeeple(s, 'child');
    queueGatherAdjacent(s, 0, 'N01:top', 4, 'bld:gatheringPost', gatheringPostLimit(s, child.id));
    drain(s);
    expect(s.spaces['N01:bottom'].res.wood).toBe(3);
    expect(s.res.wood).toBe(3);
  });

  it('an adult takes all four passes (no cap)', () => {
    const s = gatherWorld();
    const wrk = newMeeple(s, 'worker');
    queueGatherAdjacent(s, 0, 'N01:top', 4, 'bld:gatheringPost', gatheringPostLimit(s, wrk.id));
    drain(s);
    expect(s.spaces['N01:bottom'].res.wood).toBe(2);
    expect(s.res.wood).toBe(4);
  });

  it('the gatheringPost building token passes the child cap to the Gathering Post op', () => {
    const s = gatherWorld();
    const child = newMeeple(s, 'child');
    exec(s, 'gatherAdjacent:1', { who: 0, space: 'N01:top', meeple: child.id, src: 'bld:gatheringPost' });
    expect(top(s).k).toBe('bldGatherAdj');
    expect(top(s).limit).toBe(3);
  });
});
