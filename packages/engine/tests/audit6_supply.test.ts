// Audit 6 (fixer "supply"): C20 Pauline Grogan option 2 (discard 1 active Discontent) is gated on an active Discontent token;
// M028 Criticising the Leaders counts only plain Worker and Engineer Meeples in the supply (a Child Worker or Child Engineer is a
// Child, see D031); the dead FX tokens hopePerHunger and childMeeple are gone from fx/tokens_supply.ts and fx/describe.ts.
import { describe, expect, it } from 'vitest';
import '../src/fx';
import { citizenCostProblem } from '../src/actions';
import { run } from '../src/core';
import { payable, runFx } from '../src/fx/core';
import type { Ctx } from '../src/fx/core';
import { describe as describeToken } from '../src/fx/describe';
import { citizens } from '../src/data';
import { blankState } from '../src/testing';
import type { GameState, Meeple, MeepleKind } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e) {
    if (!/stack ran dry/.test(String((e as Error).message))) throw e;
  }
}

function meeple(s: GameState, kind: MeepleKind, loc: Meeple['loc']): Meeple {
  const m = { id: ++s.nextMeeple, kind, loc } as Meeple;
  s.meeples.push(m);
  return m;
}

const c20Fx = citizens.C20.fx as any[];
const c20Ctx = (): Ctx => ({ who: 0, src: 'cit:C20', card: 'C20' });

describe('C20 Pauline Grogan: "discard 1 active Discontent token" needs an active Discontent token', () => {
  it('payable: disc-discard with the active flag is blocked when no Discontent token is active', () => {
    const s = blankState();
    s.disc = [{ t: 'anger', a: false }];
    expect(payable(s, 'disc-discard:1:active', c20Ctx())).toMatch(/active Discontent/);
    s.disc = [];
    expect(payable(s, 'disc-discard:1:active', c20Ctx())).toMatch(/active Discontent/);
  });

  it('payable: disc-discard with the active flag is free once one Discontent token is active', () => {
    const s = blankState();
    s.disc = [{ t: 'anger', a: false }, { t: 'greed', a: true }];
    expect(payable(s, 'disc-discard:1:active', c20Ctx())).toBeNull();
  });

  it('payable: a plain disc-discard (no active flag) is not gated by the Discontent state (other cards)', () => {
    const s = blankState();
    s.disc = [];
    expect(payable(s, 'disc-discard:1', c20Ctx())).toBeNull();
  });

  it('with 4 Food and no active Discontent the card is still playable: option 2 is not legal, so option 1 is the only choice', () => {
    const s = blankState();
    s.food = 4;
    s.disc = [{ t: 'anger', a: false }];
    expect(citizenCostProblem(s, 'C20', 0)).toBeNull();
    runFx(s, c20Fx, c20Ctx());
    drain(s);
    // the only legal option is taken: 4 Food is paid, no Discontent is discarded
    expect(s.food).toBe(0);
    expect(s.disc).toHaveLength(1);
    expect(s.disc[0].a).toBe(false);
  });

  it('with an active Discontent both options are offered and the discard option is enabled', () => {
    const s = blankState();
    s.food = 4;
    s.disc = [{ t: 'anger', a: true }, { t: 'greed', a: false }];
    runFx(s, c20Fx, c20Ctx());
    drain(s);
    expect(s.pending?.kind).toBe('choice');
    expect(s.pending!.options![1].disabled).toBeFalsy();
  });

  it('with 4 Food and an active Discontent both options are enabled', () => {
    const s = blankState();
    s.food = 4;
    s.disc = [{ t: 'anger', a: true }];
    runFx(s, c20Fx, c20Ctx());
    drain(s);
    const opts = s.pending!.options!;
    expect(opts[0].disabled).toBeFalsy();
    expect(opts[1].disabled).toBeFalsy();
  });

  it('with no active Discontent and 3 Food the card is not playable (both options need 4 Food)', () => {
    const s = blankState();
    s.food = 3;
    s.disc = [];
    expect(citizenCostProblem(s, 'C20', 0)).not.toBeNull();
  });

  it('with no active Discontent the discard never happens: the inactive Discontent token stays on the track', () => {
    const s = blankState();
    s.food = 4;
    s.disc = [{ t: 'anger', a: false }];
    runFx(s, c20Fx, c20Ctx());
    drain(s);
    expect(s.disc).toHaveLength(1);
    expect(s.disc[0].a).toBe(false);
  });

  it('the printed discard option is described with the active qualifier', () => {
    expect(describeToken('disc-discard:1:active')).toBe('Discard 1 active Discontent');
  });
});

describe('M028 Criticising the Leaders: Hunger per Worker and Engineer Meeple in the supply', () => {
  const ctx: Ctx = { who: 0, src: 'card:M028' };

  it('a Child Worker in the supply adds no Hunger', () => {
    const s = blankState();
    s.hunger = 0;
    meeple(s, 'childWorker', { k: 'supply' });
    runFx(s, ['hungerPerMeeple:workerEngineer:1'], ctx);
    drain(s);
    expect(s.hunger).toBe(0);
  });

  it('a Child Engineer in the supply adds no Hunger', () => {
    const s = blankState();
    s.hunger = 0;
    meeple(s, 'childEngineer', { k: 'supply' });
    runFx(s, ['hungerPerMeeple:workerEngineer:1'], ctx);
    drain(s);
    expect(s.hunger).toBe(0);
  });

  it('plain Child Meeples in the supply add no Hunger either', () => {
    const s = blankState();
    s.hunger = 0;
    meeple(s, 'child', { k: 'supply' });
    runFx(s, ['hungerPerMeeple:workerEngineer:1'], ctx);
    drain(s);
    expect(s.hunger).toBe(0);
  });

  it('only the plain Worker and Engineer in the supply count, the Child Worker and Child Engineer beside them do not', () => {
    const s = blankState();
    s.hunger = 0;
    meeple(s, 'worker', { k: 'supply' });
    meeple(s, 'engineer', { k: 'supply' });
    meeple(s, 'childWorker', { k: 'supply' });
    meeple(s, 'childEngineer', { k: 'supply' });
    runFx(s, ['hungerPerMeeple:workerEngineer:1'], ctx);
    drain(s);
    expect(s.hunger).toBe(2);
  });

  it('a Worker that is on a building, not in the supply, is not counted', () => {
    const s = blankState();
    s.hunger = 0;
    meeple(s, 'worker', { k: 'space', space: 'farm:1' });
    meeple(s, 'worker', { k: 'supply' });
    runFx(s, ['hungerPerMeeple:workerEngineer:1'], ctx);
    drain(s);
    expect(s.hunger).toBe(1);
  });

  it('the per-Meeple amount scales the count (per 2 with two plain Workers in the supply gives +4)', () => {
    const s = blankState();
    s.hunger = 0;
    meeple(s, 'worker', { k: 'supply' });
    meeple(s, 'worker', { k: 'supply' });
    runFx(s, ['hungerPerMeeple:workerEngineer:2'], ctx);
    drain(s);
    expect(s.hunger).toBe(4);
  });
});
