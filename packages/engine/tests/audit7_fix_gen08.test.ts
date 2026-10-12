// Audit 7 fix GEN-08 (docs/RULES_CHECKLIST.md): cubes that fall out while the drawer is closed carry over to the next round.
// Rulebook p21: "Any cubes that fall out of the Generator when inserting the drawer remain in the drawer (and will be placed
// on the Stress track next round)." Digital model: each cube in the drawer after the drop falls out again with probability
// pDeferred (generator.json, a design choice; the rulebook prints no value). Deferred cubes sit in s.gen.carry and are added
// to the Stress track at the start of the next genStress, before that round's drop.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions';
import '../src/generator';
import '../src/sickness';
import '../src/tech';
import '../src/cards';
import '../src/expedition';
import '../src/phases';
import '../src/night';
import '../src/scenario';
import { push, run } from '../src/core';
import { blankState } from '../src/testing';
import { seedRng } from '../src/rng';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** Run one Generator Stress step and return the numbers it logged. */
function stressStep(s: GameState) {
  const before = s.logN;
  push(s, { k: 'genStress' });
  drain(s);
  const entry = s.log.find((e) => e.n > before && e.t === 'gen.drop');
  expect(entry).toBeDefined();
  return entry!.d as { cubes: number; fell: number; deferred: number };
}

function fresh(seed: number, heat: number): GameState {
  const s = blankState({ seed });
  s.rng = seedRng(seed);
  s.gen.heat = heat;
  s.gen.cold = 16;
  s.gen.stress = 0;
  s.gen.overflow = 0;
  s.gen.carry = 0;
  return s;
}

describe('GEN-08: cubes that fall out while the drawer is closed carry to the next round', () => {
  it('the deferred count is a subset of the fallers: nothing is lost or duplicated', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = fresh(seed, 16); // 9 cubes dropped
      const { cubes, fell, deferred } = stressStep(s);
      expect(cubes).toBe(9);
      expect(deferred).toBeGreaterThanOrEqual(0);
      expect(deferred).toBeLessThanOrEqual(fell);
      expect(fell).toBeLessThanOrEqual(cubes);
      // cubes that landed on the track now plus the carry equal the cubes that fell into the drawer
      expect(s.gen.stress + s.gen.overflow - (fell - deferred)).toBe(0);
      expect(s.gen.carry).toBe(deferred);
    }
  });

  it('the carried cubes are placed on the Stress track at the start of the next genStress', () => {
    let checked = 0;
    for (let seed = 1; seed <= 200 && checked < 20; seed++) {
      const s = fresh(seed, 16);
      stressStep(s);
      const carried = s.gen.carry;
      const onTrack = s.gen.stress + s.gen.overflow;
      // skip rounds where the track would overflow (breakdown resets the track and is covered by the next test)
      if (carried === 0 || onTrack + carried + 2 > 10) continue;
      checked++;
      // next round: heat 1 drops 2 cubes; the carry is added first, so the track total grows by carry + new fallers
      s.gen.heat = 1;
      const next = stressStep(s);
      expect(s.gen.stress + s.gen.overflow + s.gen.carry).toBe(onTrack + carried + next.fell);
      expect(s.gen.carry).toBe(next.deferred);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('carried cubes count toward the overflow check in the same genStress (breakdown)', () => {
    const s = fresh(7, 1);
    s.gen.stress = 10;
    s.gen.carry = 1;
    stressStep(s);
    // 10 on the slots plus the carried cube overflow the track: the Generator breaks down once
    expect(s.gen.broken).toBe(true);
    expect(s.gen.stress + s.gen.overflow).toBe(0);
  });

  it('the carry is stored on the state and survives a JSON save and reload', () => {
    const s = fresh(11, 16);
    stressStep(s);
    const reloaded = JSON.parse(JSON.stringify(s)) as GameState;
    expect(reloaded.gen.carry).toBe(s.gen.carry);
    expect(typeof reloaded.gen.carry).toBe('number');
  });

  it('a state saved before GEN-08 (no carry field) starts with no carried cubes', () => {
    const s = fresh(3, 1);
    (s.gen as any).carry = undefined;
    const { deferred } = stressStep(s);
    expect(s.gen.carry).toBe(deferred);
    expect(Number.isNaN(s.gen.stress + s.gen.overflow)).toBe(false);
  });
});
