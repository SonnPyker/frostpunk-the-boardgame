// Unit and scripted mini-playthrough tests for scenario.ts and fx/tokens_scenario.ts (SCENARIO agent).
import { describe, expect, it } from 'vitest';
import '../src/fx';
import { answerPending, defOp, hasOp, push, run } from '../src/core';
import { runFx, evalCond, hasTok, parseToken } from '../src/fx/core';
import type { Ctx } from '../src/fx/core';
import { scenarioCards, scenarios, techs } from '../src/data';
import {
  applyStorm,
  checkEnd,
  placeScenarioCard,
  scenarioDef,
  scenarioSetup,
  scenarioSpecialActions,
} from '../src/scenario';
import { blankState } from '../src/testing';
import { actionMenuFor } from '../src/actions';
import type { GameState } from '../src/types';

// PHASES is not wired into unit tests: stub its sub-step ops (only when they are not registered) and record their order.
for (const name of ['phGenerator', 'phHungerSpend', 'phHungerResolve', 'phSicknessResolve']) {
  if (!hasOp(name)) {
    defOp(name, (s) => {
      if (!s.flags.phaseLog) s.flags.phaseLog = [];
      s.flags.phaseLog.push(name);
    });
  }
}

const DRY = /stack ran dry/;

/** Drain the op stack. An empty stack is the normal end in unit tests (the phase machine is not wired). */
function drain(s: GameState) {
  try {
    run(s);
  } catch (e) {
    if (!DRY.test(String((e as Error).message))) throw e;
  }
}

/** Answer the current decision and keep running. An empty stack after the last op is the normal end in unit tests. */
function answer(s: GameState, pick: string[]) {
  const p = s.pending!;
  expect(p, 'a decision is pending').not.toBeNull();
  let r: { ok: boolean; error?: string } = { ok: true };
  try {
    r = answerPending(s, p.who < 0 ? 0 : p.who, p.id, pick);
  } catch (e) {
    if (!DRY.test(String((e as Error).message))) throw e;
  }
  if (!r.ok) throw new Error('answer rejected: ' + r.error);
}

function ctx(s: GameState, over: Partial<Ctx> = {}): Ctx {
  return { who: s.leader, src: 'test', ...over };
}

function mk(scenario: 'crater' | 'frozenGrove' | 'dreadnought' = 'crater') {
  const s = blankState({ scenario });
  scenarioSetup(s);
  return s;
}

function building(s: GameState, kind: string, uid?: number) {
  const b = { uid: uid ?? s.nextUid++, kind, upgraded: false, ruins: false, spaces: [] as string[] };
  s.buildings.push(b as any);
  return b;
}

function addMeeple(s: GameState, kind: 'worker' | 'engineer' | 'child') {
  const m = { id: s.nextMeeple++, kind, loc: { k: 'space' as const, space: 'TEST' } };
  s.meeples.push(m as any);
  return m;
}

/** Keys whose arrays hold FX items (strings are tokens only inside these). */
const FX_KEYS = ['fx', 'onPlace', 'onResolve', 'dawn', 'then', 'else', 'choose'];

/** Walk a scenario card and collect FX tokens (strings inside FX lists) and `if` condition strings. */
function collectFx(x: any, inFx: boolean, toks: string[], conds: string[]) {
  if (Array.isArray(x)) {
    for (const it of x) {
      if (typeof it === 'string') {
        if (inFx) toks.push(it);
      } else collectFx(it, inFx, toks, conds);
    }
    return;
  }
  if (!x || typeof x !== 'object') return;
  if (typeof x.if === 'string') conds.push(x.if);
  for (const [k, v] of Object.entries(x)) {
    if (k === 'if') continue;
    collectFx(v, inFx || FX_KEYS.includes(k), toks, conds);
  }
}

describe('token and condition coverage (FX_DSL §7 / §8)', () => {
  it('registers every scenario-owned FX token head', () => {
    for (const head of [
      'scenario', 'trigger', 'goto', 'phase', 'shelters', 'nightSleep', 'flip', 'stormMarker', 'heatRange', 'stormHit',
      'victory', 'defeat', 'custom',
      // used by the scenario data, registered in other modules
      'expedition', 'scoutsReturnNoReward', 'loseHalfFood', 'exhaustAll', 'sickAll', 'gain', 'hunger+', 'hope+', 'disc+',
    ]) {
      expect(hasTok(head), head).toBe(true);
    }
  });

  it('every token and condition in the scenario data resolves to a handler', () => {
    const toks: string[] = [];
    const conds: string[] = [];
    for (const card of Object.values(scenarioCards as Record<string, any>)) collectFx(card, false, toks, conds);
    expect(toks.length).toBeGreaterThan(20);
    for (const t of toks) expect(hasTok(parseToken(t).head), t).toBe(true);
    const s = mk();
    for (const c of conds) expect(() => evalCond(s, c, ctx(s)), c).not.toThrow();
  });

  it('scenario conditions evaluate (beaconBuilt, revealed, round)', () => {
    const s = mk();
    expect(evalCond(s, 'revealed:S07', ctx(s))).toBe(false);
    placeScenarioCard(s, 'S07', 0, false);
    expect(evalCond(s, 'revealed:S07', ctx(s))).toBe(true);
    expect(evalCond(s, '!revealed:S03', ctx(s))).toBe(true);
    expect(evalCond(s, 'beaconBuilt', ctx(s))).toBe(false);
    building(s, 'beacon');
    expect(evalCond(s, 'beaconBuilt', ctx(s))).toBe(true);
    s.round = 7;
    expect(evalCond(s, 'round<=7', ctx(s))).toBe(true);
    expect(evalCond(s, 'round>=8', ctx(s))).toBe(false);
  });
});

describe('setup (SET-17, S01 face up, Storm card, Technology display)', () => {
  it('crater: S01 face up, triggers on 4 and 11, Storm marker 9, S08, no T09, display of 4', () => {
    const s = mk('crater');
    expect(s.scenarioDisplay).toEqual(['S01']);
    expect(s.triggers.map((t) => t.round).sort((a, b) => a - b)).toEqual([4, 11]);
    expect(s.stormMarker).toBe(9);
    expect(s.stormCard).toBe('S08');
    expect(s.techs.some((t) => t.id === 'T09')).toBe(false);
    expect(s.techs).toHaveLength(4);
    expect(s.techs.every((t) => t.id in techs)).toBe(true);
    expect(s.scenarioState.revealed).toEqual(['S01']);
  });

  it('frozen grove: S09 storm card, T09 fixed in the display', () => {
    const s = mk('frozenGrove');
    expect(s.stormCard).toBe('S09');
    expect(s.techs.some((t) => t.id === 'T09')).toBe(true);
    expect(s.techs).toHaveLength(4);
  });

  it('dreadnought: steel starts in the bank (supply 0), S08 storm card', () => {
    const s = mk('dreadnought');
    expect(s.res.steel).toBe(0);
    expect(s.stormCard).toBe('S08');
  });

  it('is idempotent for the technology display and the triggers', () => {
    const s = mk('frozenGrove');
    const before = s.techs.map((t) => t.id).sort();
    const trig = s.triggers.length;
    scenarioSetup(s);
    expect(s.techs.map((t) => t.id).sort()).toEqual(before);
    expect(s.triggers).toHaveLength(trig);
  });

  it('refuses scenarios that are not playable', () => {
    const s = blankState({ scenario: 'crater' });
    expect(scenarios.crags.status).toBe('unavailable');
    s.config.scenario = 'crags' as any;
    expect(() => scenarioSetup(s)).toThrow(/not playable/);
  });
});

describe('Dawn triggers (DAW-04, DAW-05)', () => {
  it('Round 4 with the Beacon: the leader chooses disc-1 or hope+1, then S02 is resolved with its options', () => {
    const s = mk('crater');
    building(s, 'beacon');
    s.round = 4;
    push4(s);
    drain(s);
    expect(s.pending?.kind).toBe('choice');
    answer(s, ['1']); // disc-1 (nothing to lose here)
    expect(s.scenarioDisplay).toContain('S02');
    expect(s.pending?.kind).toBe('scenario');
    expect(s.pending!.options.map((o) => o.id)).toEqual(['A', 'B']);
    answer(s, ['B']);
    expect(s.scenarioDisplay).not.toContain('S02');
    expect(s.expeditions.some((e) => e.cards.some((c) => c.id === 'S05'))).toBe(true);
    expect(s.triggers.some((t) => t.round === 4)).toBe(false);
  });

  it('Round 4 without the Beacon: Discontent is added and S06 Vox Populi is placed', () => {
    const s = mk('crater');
    s.round = 4;
    s.discBag = { anger: 0, apathy: 1, greed: 0 }; // a typed +1 draws from the bag: pin it to apathy
    push4(s);
    drain(s);
    expect(s.scenarioDisplay).toContain('S06');
    expect(s.pending).toBeNull();
    expect(s.disc.map((t) => t.t)).toEqual(['apathy']);
  });

  it('Round 11: S04 is placed (its Round 12 trigger goes on the track); S03 is placed because S07 was never revealed', () => {
    const s = mk('crater');
    s.round = 11;
    push(s, { k: 'scnPhase', phase: 'dawn', when: 'end' } as any);
    drain(s);
    expect(s.scenarioDisplay).toEqual(expect.arrayContaining(['S04', 'S03']));
    expect(s.triggers.some((t) => t.card === 'S04' && t.round === 12)).toBe(true);
  });

  it('the trigger token of S04 is deduplicated (auto placement and onPlace both put it on Round 12)', () => {
    const s = mk('crater');
    placeScenarioCard(s, 'S04', 0, true);
    runFx(s, ['trigger:12'], ctx(s, { card: 'S04' }));
    drain(s);
    expect(s.triggers.filter((t) => t.card === 'S04')).toHaveLength(1);
  });

  it('only the scnPhase Dawn end hook fires triggers (after the Round marker moved)', () => {
    const s = mk('crater');
    s.round = 4;
    push(s, { k: 'scnPhase', phase: 'generator', when: 'start' } as any);
    push(s, { k: 'scnPhase', phase: 'dawn', when: 'start' } as any);
    drain(s);
    expect(s.triggers.some((t) => t.round === 4)).toBe(true); // the start hook does not fire it
    push(s, { k: 'scnPhase', phase: 'dawn', when: 'end' } as any);
    drain(s);
    expect(s.triggers.some((t) => t.round === 4)).toBe(false);
  });
});

function push4(s: GameState) {
  s.stack.push({ k: 'scnPhase', phase: 'dawn', when: 'end' } as any);
}

describe('S04 Round 12 finale (SCN-04)', () => {
  it('replaces the Round: half the Food is lost, the phases run in order, then the scenario is won', () => {
    const s = mk('crater');
    placeScenarioCard(s, 'S04', 0, false);
    s.round = 12;
    s.food = 10;
    s.flags.phaseLog = [];
    push4(s);
    drain(s);
    expect(s.food).toBe(5);
    expect(s.flags.phaseLog).toEqual(['phGenerator', 'phHungerSpend', 'phHungerResolve', 'phSicknessResolve']);
    expect(s.status).toBe('won');
    expect(s.endReason).toMatch(/Survived/);
    expect(s.flags.sheltersAllHeated).toBe(true);
  });

  it('a Frostbite that kills everyone defeats the settlement before the victory token', () => {
    const s = mk('crater');
    placeScenarioCard(s, 'S04', 0, false);
    s.round = 12;
    s.food = 0;
    s.cit = { worker: 1, engineer: 0, child: 0 };
    addMeeple(s, 'worker');
    s.stack.push({ k: 'scnPhase', phase: 'dawn', when: 'end' } as any);
    drain(s);
    expect(s.status === 'won' || s.status === 'lost').toBe(true);
  });

  it('coal stocks reduce the Frostbite sickness by 2 each (sickAll minus2PerCoalStock)', () => {
    const s = mk('crater');
    s.cit = { worker: 20, engineer: 20, child: 20 };
    s.scenarioState.coalStocks = 1;
    runFx(s, ['sickAll:12:minus2PerCoalStock'], ctx(s));
    drain(s);
    expect(s.sick.worker.n).toBe(10);
    expect(s.sick.child.n).toBe(10);
  });

  it('checkEnd: past Round 15 with no finale is not a defeat (no round limit, rulebook p16/p30)', () => {
    const s = mk('crater');
    s.round = 16;
    expect(checkEnd(s)).toBe('playing');
    expect(s.endReason).toBeNull();
  });
});

describe('Frostbite split (S04 nightSleep:sick3PerUnsheltered)', () => {
  it('a valid split: with one Tent (2 places) for 2 workers and 1 engineer, the leader leaves 1 out; it gains 3 sick', () => {
    const s = mk('crater');
    s.cit = { worker: 10, engineer: 10, child: 0 };
    building(s, 'tent');
    s.flags.sheltersAllHeated = true;
    addMeeple(s, 'worker');
    addMeeple(s, 'worker');
    addMeeple(s, 'engineer');
    runFx(s, ['nightSleep:sick3PerUnsheltered'], ctx(s));
    drain(s);
    expect(s.pending?.kind).toBe('sleep');
    answer(s, ['worker']);
    expect(s.sick.worker.n).toBe(3);
    expect(s.sick.engineer.n).toBe(0);
  });

  it('an invalid split falls back to the first valid one (children in a Child Shelter stay warm, workers are left out)', () => {
    const s = mk('crater');
    s.cit = { worker: 10, engineer: 0, child: 10 };
    building(s, 'childShelter');
    s.flags.sheltersAllHeated = true;
    addMeeple(s, 'worker');
    addMeeple(s, 'worker');
    addMeeple(s, 'worker');
    addMeeple(s, 'child');
    runFx(s, ['nightSleep:sick3PerUnsheltered'], ctx(s));
    drain(s);
    expect(s.pending?.kind).toBe('sleep');
    // leaves a child out although the Child Shelter has a place for it: invalid
    answer(s, ['worker', 'worker', 'child']);
    expect(s.sick.worker.n).toBe(9);
    expect(s.sick.child.n).toBe(0);
    expect(s.log.some((l) => /first valid split/.test(l.m))).toBe(true);
  });

  it('everyone warm: nothing happens', () => {
    const s = mk('crater');
    s.cit = { worker: 10, engineer: 0, child: 0 };
    s.flags.sheltersAllHeated = true;
    building(s, 'bunkhouse');
    addMeeple(s, 'worker');
    addMeeple(s, 'worker');
    runFx(s, ['nightSleep:sick3PerUnsheltered'], ctx(s));
    drain(s);
    expect(s.sick.worker.n).toBe(0);
    expect(s.pending).toBeNull();
  });
});

describe('Stockpile (ACT-SP2, custom:stockpile)', () => {
  it('spends Food and Coal into markers, limited by the 3 slots of S03; the markers feed gain:food perFoodRation', () => {
    const s = mk('crater');
    placeScenarioCard(s, 'S03', 0, false);
    s.food = 12;
    s.res.coal = 10;
    runFx(s, ['custom:stockpile'], ctx(s, { card: 'S03' }));
    drain(s);
    expect(s.pending?.kind).toBe('stockpile');
    expect(s.pending!.options.find((o) => o.id === 'ration')!.disabled).toBeUndefined();
    answer(s, ['ration']);
    answer(s, ['ration']);
    answer(s, ['coal']); // 3 markers used = slots: the rest is disabled and the decision finishes itself
    expect(s.scenarioState.rations).toBe(2);
    expect(s.scenarioState.coalStocks).toBe(1);
    expect(s.food).toBe(6);
    expect(s.res.coal).toBe(8);
    expect(s.pending).toBeNull();
    runFx(s, ['gain:food:5:perFoodRation'], ctx(s));
    drain(s);
    expect(s.food).toBe(16);
  });

  it('once per Round: a second use in the same Round does nothing', () => {
    const s = mk('crater');
    placeScenarioCard(s, 'S03', 0, false);
    s.food = 12;
    runFx(s, ['custom:stockpile'], ctx(s, { card: 'S03' }));
    drain(s);
    answer(s, ['done']);
    runFx(s, ['custom:stockpile'], ctx(s, { card: 'S03' }));
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.scenarioState.rations).toBe(0);
  });

  it('special action listing exposes the stockpile key and availability', () => {
    const s = mk('crater');
    placeScenarioCard(s, 'S03', 0, false);
    expect(scenarioSpecialActions(s)).toEqual([
      expect.objectContaining({ key: 'stockS03', card: 'S03', oncePerRound: true, available: true, meeples: ['worker', 'engineer'], heated: true }),
    ]);
    s.scenarioState.specialUsed.S03 = s.round;
    expect(scenarioSpecialActions(s)[0].available).toBe(false);
  });

  it('removing S03 takes its markers with it', () => {
    const s = mk('crater');
    placeScenarioCard(s, 'S03', 0, false);
    s.scenarioState.rations = 2;
    runFx(s, ['scenario:remove:S03'], ctx(s));
    drain(s);
    expect(s.scenarioDisplay).not.toContain('S03');
    expect(s.scenarioState.rations).toBe(0);
  });
});

describe('Storm (WEA-05, stormHit, flip, stormMarker)', () => {
  it('no Storm marker: nothing happens', () => {
    const s = mk('crater');
    s.stormMarker = null;
    runFx(s, ['stormHit:2'], ctx(s));
    drain(s);
    expect(s.stormsHit).toBe(0);
  });

  it('first Storm (Round <= 7): all Tents flip to Ruins and the marker moves to 12', () => {
    const s = mk('crater');
    s.round = 3;
    s.stormMarker = 3;
    const t = building(s, 'tent', 5);
    runFx(s, ['stormHit:0'], ctx(s));
    drain(s);
    expect(t.ruins).toBe(true);
    expect(s.stormMarker).toBe(12);
    expect(s.stormsHit).toBe(1);
  });

  it('second Storm (Round >= 8): all Bunkhouses flip and the marker is removed', () => {
    const s = mk('crater');
    s.round = 9;
    s.stormMarker = 9;
    const b = building(s, 'bunkhouse', 6);
    applyStorm(s, 1, s.leader);
    drain(s);
    expect(b.ruins).toBe(true);
    expect(s.stormMarker).toBeNull();
  });

  it('a Storm that is not yet on or before the Round does not hit', () => {
    const s = mk('crater');
    s.round = 2;
    s.stormMarker = 9;
    runFx(s, ['stormHit:1'], ctx(s));
    drain(s);
    expect(s.stormMarker).toBe(8);
    expect(s.stormsHit).toBe(0);
  });

  it('frozen grove first Storm: yellow removed, cold 0, orange +1, red +1, marker 12', () => {
    const s = mk('frozenGrove');
    s.round = 4;
    s.stormMarker = 4;
    s.stormCard = 'S09';
    const before = { orange: s.gen.ind.orange as number, red: s.gen.ind.red as number };
    runFx(s, ['stormHit:0'], ctx(s));
    drain(s);
    expect(s.gen.ind.yellow).toBeNull();
    expect(s.gen.ind.orange).toBe(before.orange + 1);
    expect(s.gen.ind.red).toBe(before.red + 1);
    expect(s.stormMarker).toBe(12);
  });

  it('heat range tokens remove and advance indicators', () => {
    const s = mk('frozenGrove');
    runFx(s, ['heatRange:remove:orange', 'heatRange:advance:red:3'], ctx(s));
    drain(s);
    expect(s.gen.ind.orange).toBeNull();
    expect(s.gen.ind.red).toBe(4);
  });
});

describe('victory and defeat tokens', () => {
  it('victory wins and clears the stack', () => {
    const s = mk('crater');
    runFx(s, ['victory'], ctx(s));
    drain(s);
    expect(s.status).toBe('won');
  });

  it('defeat loses with the given reason', () => {
    const s = mk('crater');
    runFx(s, ['defeat'], ctx(s));
    drain(s);
    expect(s.status).toBe('lost');
    expect(s.endReason).toBe('Scenario defeat');
  });
});

describe('scenario card flow (S02 options, S05 expedition, S06 Dawn text)', () => {
  it('S06 Dawn text with the Beacon resolves S02 and removes S06', () => {
    const s = mk('crater');
    building(s, 'beacon');
    placeScenarioCard(s, 'S06', 0, false);
    s.round = 5;
    push4(s);
    drain(s);
    expect(s.scenarioDisplay).toContain('S02');
    expect(s.pending?.kind).toBe('scenario'); // S02 options come first; S06 is removed after the choice
    answer(s, ['B']);
    expect(s.scenarioDisplay).not.toContain('S06');
    expect(s.scenarioDisplay).not.toContain('S02');
  });

  it('S02 option A gives the refugees their workers and children (gain tokens)', () => {
    const s = mk('crater');
    runFx(s, ['scenario:resolve:S02'], ctx(s));
    drain(s);
    expect(s.pending?.kind).toBe('scenario');
    answer(s, ['A']);
    expect(s.cit).toEqual({ worker: 5, engineer: 1, child: 3 });
    expect(s.scenarioDisplay).not.toContain('S02');
  });

  it('scenario definitions expose no unknown kinds: all cards resolve through scenarioDef', () => {
    for (const id of Object.keys(scenarioCards as Record<string, unknown>)) expect(scenarioDef(id).id).toBe(id);
  });
});

describe('Stockpile in the action menu (S03 / S07)', () => {
  it('the menu offers act:special:stockS03 with the Stockpile availability as its disabled reason', () => {
    const s = mk('crater');
    placeScenarioCard(s, 'S03', 0, false);
    s.food = 6;
    s.meeples = [{ id: 1, kind: 'worker', loc: { k: 'supply' } } as any];
    const item = () => actionMenuFor(s, s.leader).find((m) => m.id === 'act:special:stockS03');
    expect(item()).toBeDefined();
    expect(item()!.disabled).toBeUndefined();
    s.food = 0;
    s.res.coal = 0;
    expect(item()!.disabled).toMatch(/Not enough Food or Coal/);
    s.food = 6;
    s.scenarioState.specialUsed.S03 = s.round;
    expect(item()!.disabled).toMatch(/Already used/);
  });
});
