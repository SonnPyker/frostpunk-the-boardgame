// Regression tests for the scenario fixer (audit 5), task 3: the round-limit change of wave 4 (no defeat at Round 15).
// Rulebook p16/p30: the game ends only by a lose condition or by completing the scenario goal; the rulebook has no round limit.
// The scenario goal is the Round 12 finale S04 (Scenario Book / scenarios.json: S01 places S04 at Round 11, S04's trigger
// replaces Round 12 and ends with `victory`). So every playable scenario must end by Round 12 at the latest; no Round-15 cap is
// needed, and autoplay/sim stop on their own step caps (autoplay maxSteps, sim MAX_DECISIONS).
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
import { createGame } from '../src/index';
import { drive } from '../src/setup';
import { run } from '../src/core';
import { autoplay } from '../src/autoplay';
import { placeScenarioCard, scenarioDef } from '../src/scenario';
import { runFx } from '../src/fx/core';
import { blankState } from '../src/testing';
import type { GameConfig, GameState } from '../src/types';

const SCENARIOS = ['crater', 'frozenGrove', 'dreadnought'] as const;

function config(scenario: string, mode: 'solo' | 'coop', seed: number): GameConfig {
  return {
    scenario,
    society: 1,
    difficulty: 'normal',
    mode,
    players: mode === 'solo' ? [{ name: 'A' }] : [{ name: 'A' }, { name: 'B' }],
    seed,
    extraPack: false,
    advisors: [],
  } as any;
}

/** Starts a game at the given Round's Dawn (the stack is replaced by a Dawn start) and plays it with random legal answers. */
function playFrom(scenario: string, mode: 'solo' | 'coop', seed: number, round: number, placeFinale: boolean) {
  const s = createGame(config(scenario, mode, seed));
  s.pending = null;
  s.stack = [];
  s.round = round;
  s.phase = 'action';
  if (placeFinale) placeScenarioCard(s, 'S04', s.leader, true);
  s.stack.push({ k: 'phStart', phase: 'dawn' } as any);
  drive(s);
  const r = autoplay(s, seed * 3 + 1, 60000);
  return { s, r };
}

describe('the round-limit change: the scenario goal ends the game, nothing runs past Round 12', () => {
  it('S01 places the S04 finale at Round 11, and S04 replaces Round 12 with a victory step (scenarios.json)', () => {
    const s1 = scenarioDef('S01');
    expect((s1.triggers ?? []).map((t: any) => t.round)).toEqual([4, 11]);
    const s4 = scenarioDef('S04');
    const finale = (s4.triggers ?? []).find((t: any) => t.round === 12);
    expect(finale?.replacesRound).toBe(true);
    const steps = finale.steps.map((x: any) => x.id);
    expect(steps[steps.length - 1]).toBe('end');
    expect(finale.steps[finale.steps.length - 1].fx).toEqual(['victory']);
  });

  it('the victory token ends an alive game as won', () => {
    const s = blankState({ scenario: 'crater' });
    runFx(s, ['victory'], { who: 0, src: 'test:victory' });
    try {
      run(s);
    } catch (e: any) {
      if (!/stack ran dry/.test(String(e?.message))) throw e;
    }
    expect(s.status).toBe('won');
  });

  it('a game that reaches Round 11 with S04 placed ends by Round 12 (never later), with no stuck decision', () => {
    for (const sc of SCENARIOS) {
      for (let seed = 1; seed <= 4; seed++) {
        const { s, r } = playFrom(sc, 'solo', seed, 11, true);
        expect(r.stuck, `${sc} seed ${seed}: ${r.error}`).toBe(false);
        expect(s.status, `${sc} seed ${seed}`).not.toBe('playing');
        expect(s.round, `${sc} seed ${seed}`).toBeLessThanOrEqual(12);
      }
    }
  });

  it('starting at Round 10 (S01 places S04 at Round 11) ends by Round 12 in co-op and solo, with no stuck decision', () => {
    for (const sc of SCENARIOS) {
      for (const mode of ['solo', 'coop'] as const) {
        for (let seed = 1; seed <= 3; seed++) {
          const { s, r } = playFrom(sc, mode, seed, 10, false);
          expect(r.stuck, `${sc} ${mode} seed ${seed}: ${r.error}`).toBe(false);
          expect(s.status, `${sc} ${mode} seed ${seed}`).not.toBe('playing');
          expect(s.round, `${sc} ${mode} seed ${seed}`).toBeLessThanOrEqual(12);
          if (s.round >= 11) expect(s.scenarioDisplay).toContain('S04');
        }
      }
    }
  });
});
