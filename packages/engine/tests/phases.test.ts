// Unit tests for phases.ts (phase driver, Dawn, Morning/Generator/Weather/Preparation/Dusk/Hunger) and night.ts (rulebook p17-30).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions'; // real Action phase (actStart); with no meeples or options it passes straight through
import '../src/generator';
import '../src/sickness';
import '../src/tech';
import '../src/cards';
import '../src/expedition';
import '../src/phases';
import '../src/night';
import { push, pushSeq, run } from '../src/core';
import type { GameState } from '../src/types';
import { blankState } from '../src/testing';
import { newMeeple } from '../src/util';
import { iconTypesBetween } from '../src/generator';
import { PHASE_ORDER, hungerLevel, nextPhase, setHungerLevel } from '../src/phases';
import { nightBody } from '../src/night';

/** Drain the stack; an empty stack is normal when a test ends on purpose. */
function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

const phaseLog = (s: GameState) => s.log.filter((e: any) => e.t === 'phase').map((e: any) => e.d.phase);

describe('phase order', () => {
  it('cycles Dawn -> ... -> Night -> Dawn', () => {
    expect(PHASE_ORDER).toEqual(['dawn', 'morning', 'generator', 'weather', 'preparation', 'action', 'dusk', 'hunger', 'night']);
    expect(nextPhase('night')).toBe('dawn');
    expect(nextPhase('action')).toBe('dusk');
  });

  it('a Dawn into Round 16 is not a defeat: the rulebook has no round limit (rulebook p16, p30)', () => {
    const s = blankState({ mode: 'coop', players: [{ name: 'A' }, { name: 'B' }] });
    s.round = 15;
    s.leader = 0;
    push(s, { k: 'phDawn' });
    drain(s);
    expect(s.round).toBe(16);
    expect(s.status).toBe('playing');
    expect(s.endReason).toBeNull();
  });

  it('moves the co-op Leadership clockwise at Dawn and resets per-Round state', () => {
    const s = blankState({ mode: 'coop', players: [{ name: 'A' }, { name: 'B' }] });
    s.round = 4;
    s.leader = 0;
    s.passes = 2;
    s.usedSpaces = ['x'];
    push(s, { k: 'phDawn' });
    drain(s);
    expect(s.round).toBe(5);
    expect(s.leader).toBe(1);
    expect(s.turn).toBe(1);
    expect(s.passes).toBe(0);
    expect(s.usedSpaces).toEqual([]);
  });

  it('keeps the solo leader at Dawn', () => {
    const s = blankState();
    s.round = 4;
    push(s, { k: 'phDawn' });
    drain(s);
    expect(s.round).toBe(5);
    expect(s.leader).toBe(0);
  });
});

describe('Hunger (HUN-01..04)', () => {
  it('stores the level as 25 * hungerOver + hunger', () => {
    const s = blankState();
    setHungerLevel(s, 27);
    expect(s.hungerOver).toBe(true);
    expect(s.hunger).toBe(2);
    expect(hungerLevel(s)).toBe(27);
    setHungerLevel(s, 6);
    expect(s.hungerOver).toBe(false);
    expect(hungerLevel(s)).toBe(6);
  });

  it('loses at Hunger 25 or more', () => {
    const s = blankState();
    s.round = 3;
    setHungerLevel(s, 26);
    push(s, { k: 'phHungerResolve' });
    drain(s);
    expect(s.status).toBe('lost');
    expect(s.endReason).toMatch(/Hunger/);
  });

  it('kills by the previous Round type, then feeds the current Round type', () => {
    const s = blankState();
    s.round = 2; // previous Round 1 = child, current Round 2 = engineer (types.ts roundType)
    s.corpseMax = 10;
    s.cit = { worker: 0, engineer: 2, child: 3 };
    s.food = 0;
    setHungerLevel(s, 7); // floor(7/5) = 1 death
    push(s, { k: 'phHungerResolve' });
    drain(s);
    expect(s.status).toBe('playing');
    expect(s.cit.child).toBe(2); // one child died
    expect(s.corpse).toBe(1);
    expect(hungerLevel(s)).toBe(2); // 2 engineers unfed -> +2 Hunger
  });

  it('spends Food against Hunger first (HUN-01)', () => {
    const s = blankState();
    s.round = 2;
    s.food = 4;
    setHungerLevel(s, 3);
    push(s, { k: 'phFoodSpend' });
    drain(s);
    expect(s.food).toBe(1);
    expect(hungerLevel(s)).toBe(0);
  });
});

describe('Generator (GEN-06) and Dusk/Night plumbing', () => {
  it('cold sickness: every Citizen type with an icon between Heat and Cold gets one sick', () => {
    const s = blankState();
    s.cit = { worker: 5, engineer: 5, child: 5 };
    s.gen.heat = 1;
    s.gen.cold = 5;
    const expected = iconTypesBetween(s).length;
    push(s, { k: 'genCold' });
    drain(s);
    const sickTotal = s.sick.worker.n + s.sick.engineer.n + s.sick.child.n;
    expect(sickTotal).toBe(expected);
  });
});

describe('Weather and Storm (WEA-04, WEA-05)', () => {
  it('a Storm within reach hits, removes its marker and logs the unimplemented tokens', () => {
    const s = blankState();
    s.round = 9;
    s.stormMarker = 9;
    push(s, { k: 'phWxStorm', id: 'W10' }); // W10 moves the Storm back 1: marker 8 <= round 9
    drain(s);
    expect(s.stormsHit).toBe(1);
    expect(s.stormMarker).toBeNull(); // S08 branch round>=8: stormMarker:remove
  });

  it('no hit while the Storm marker is still ahead of the Round marker', () => {
    const s = blankState();
    s.round = 9;
    s.stormMarker = 11;
    push(s, { k: 'phWxStorm', id: 'W10' }); // marker 10 > round 9
    drain(s);
    expect(s.stormsHit).toBe(0);
    expect(s.stormMarker).toBe(10);
  });
});

describe('Night (NIG-01..06)', () => {
  it('without shelters the standing Citizens each add one sick of their type', () => {
    const s = blankState();
    s.round = 4;
    s.cit = { worker: 2, engineer: 1, child: 0 };
    newMeeple(s, 'worker');
    newMeeple(s, 'worker');
    newMeeple(s, 'engineer');
    const body = nightBody(s).slice(0, -1); // drop phAdvance: the Night itself is under test
    pushSeq(s, ...body);
    drain(s);
    expect(s.flags.night.total).toBe(3);
    expect(s.flags.night.unsheltered).toBe(3);
    expect(s.sick.worker.n).toBe(2);
    expect(s.sick.engineer.n).toBe(1);
    expect(s.sick.child.n).toBe(0);
  });
});

describe('No round limit (rulebook p16, p30)', () => {
  it('does not lose at the Dawn that starts Round 16, with or without a scenario flag', () => {
    const s = blankState();
    s.round = 15;
    push(s, { k: 'phDawn' });
    drain(s);
    expect(s.status).toBe('playing');
    expect(s.round).toBe(16);

    const t = blankState();
    t.round = 15;
    t.flags.roundLimitHandled = true;
    push(t, { k: 'phDawn' });
    drain(t);
    expect(t.status).toBe('playing');
    expect(t.round).toBe(16);
  });
});
