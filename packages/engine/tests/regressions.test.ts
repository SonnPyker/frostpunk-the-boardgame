// Regression tests for bugs found by the bot simulator (scripts/sim.ts), one block per fixed bug.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { lose, run } from '../src/core';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import { actionMenuFor } from '../src/actions';
import { fuelRoom } from '../src/generator';
import { nightBody } from '../src/night';

// Pending decisions and an empty stack are both normal in isolation: drain without failing on an empty stack.
function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

describe('regression: Night does not resolve Sickness (sim: every Sickness marker flipped twice per Round)', () => {
  it('the Night op list has no sicknessResolve step; Preparation resolves Sickness instead', () => {
    const s = blankState();
    const kinds = nightBody(s).map((o) => o.k);
    expect(kinds).not.toContain('sicknessResolve');
    expect(kinds[kinds.length - 1]).toBe('phAdvance');
  });
});

describe('regression: Fuel is once per turn, not once per phase (rulebook p23)', () => {
  it('fuel is disabled after one fueling in the same turn', () => {
    const s = blankState();
    s.res.coal = 5;
    s.gen.heat = 0;
    s.gen.cold = 10;
    expect(fuelRoom(s)).toBeGreaterThan(0);
    expect(actionMenuFor(s, 0)[0].disabled).toBeUndefined();
    s.flags.actFuelUsed = true;
    expect(actionMenuFor(s, 0)[0].disabled).toBe('Already fueled this turn');
  });

  it('choosing fuel sets the once-per-turn flag and does not end the turn', () => {
    const s = blankState();
    s.res.coal = 5;
    s.gen.heat = 0;
    s.gen.cold = 10;
    s.phase = 'action';
    s.stack.push({ k: 'actPick', who: 0, pick: ['act:fuel'] });
    drain(s);
    expect(s.flags.actFuelUsed).toBe(true);
  });

  it('passing the turn clears the flag so the next turn can fuel again', () => {
    const s = blankState();
    s.res.coal = 5;
    s.gen.heat = 0;
    s.gen.cold = 10;
    s.flags.actFuelUsed = true;
    s.stack.push({ k: 'actPick', who: 0, pick: ['act:pass'] });
    drain(s);
    expect(s.flags.actFuelUsed).toBe(false);
    expect(actionMenuFor(s, 0)[0].disabled).toBeUndefined();
  });

  it('actEnd clears the flag', () => {
    const s = blankState();
    s.res.coal = 5;
    s.gen.heat = 0;
    s.gen.cold = 10;
    s.flags.actFuelUsed = true;
    s.stack.push({ k: 'actEnd' });
    drain(s);
    expect(s.flags.actFuelUsed).toBe(false);
  });
});

describe('regression: a finished game keeps no queued ops (found by the card harness: a death effect pushed after the loss)', () => {
  it('run() clears ops that were pushed after the game was lost', () => {
    const s = blankState();
    lose(s, 'test loss');
    s.stack.push({ k: 'phAdvance' } as any);
    run(s);
    expect(s.status).toBe('lost');
    expect(s.stack.length).toBe(0);
  });
});
