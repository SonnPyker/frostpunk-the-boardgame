// Unit tests for laws.ts / tech.ts (introduction, passives, technology development timing).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run } from '../src/core';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import { hasPassive, introduceLaw, lawCandidates, passive, techMod } from '../src/laws';
import { devMove, techDawn, techStart, techSyncWorkshops, techActive } from '../src/tech';

// Pending decisions and stack-empty are both normal in isolation: drain the stack without failing on an empty one.
function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}
function answer(s: GameState, pick: string[]) {
  const p = s.pending!;
  s.pending = null;
  s.stack.push({ ...p.then, pick });
  drain(s);
}
const workshop = (s: GameState) =>
  s.buildings.push({ uid: ++s.nextUid, kind: 'workshop', upgraded: false, ruins: false, spaces: [] });

describe('law introduction', () => {
  it('introduces a law, removes its pair and puts one hidden consequence into the Dusk deck', () => {
    const s = blankState();
    s.futureLaws = ['L03', 'L04', 'L09'];
    s.lawConsequenceBank = { L03: ['L03A', 'L03B'] };
    introduceLaw(s);
    expect(s.pending?.kind).toBe('law');
    answer(s, ['L03']);
    expect(s.laws.map((l) => l.id)).toEqual(['L03']);
    expect(s.futureLaws).toEqual(['L09']);
    expect(s.removedLaws).toContain('L04');
    expect(s.decks.dusk.length).toBe(1);
    expect(['L03A', 'L03B']).toContain(s.decks.dusk[0]);
    expect(s.lawConsequenceBank.L03).toBeUndefined();
    expect(s.pending).toBeNull();
  });

  it('never offers a law whose pair is in play, and at most 4 laws', () => {
    const s = blankState();
    s.futureLaws = ['L07', 'L08', 'L09'];
    s.laws = [{ id: 'L07', covered: null }];
    expect(lawCandidates(s)).toEqual(['L09']);
    s.laws = [0, 1, 2, 3].map((i) => ({ id: 'X' + i, covered: null }));
    expect(lawCandidates(s)).toEqual([]);
    introduceLaw(s);
    expect(s.pending).toBeNull();
    expect(s.laws.length).toBe(4);
  });
});

describe('law passives', () => {
  it('reads active law perms and skips the perm of a covered law', () => {
    const s = blankState();
    s.laws = [{ id: 'L04', covered: null }];
    expect(hasPassive(s, 'heatedBySpendFood')).toBe(true);
    expect(passive(s, 'heatedBySpendFood')).toBe(2);
    s.laws = [{ id: 'L04', covered: 'L04A' }];
    // the covering consequence L04A grants the same passive
    expect(passive(s, 'heatedBySpendFood')).toBe(2);
    expect(passive(s, 'removeSnowChildSpendFood')).toBe(3);
  });

  it('normalises alias names and lets the covering card replace the perm', () => {
    const s = blankState();
    s.laws = [{ id: 'L18', covered: null }];
    expect(hasPassive(s, 'workersUseWorkshops')).toBe(true);
    expect(hasPassive(s, 'engineerConstructTwoSubactionsUpgrade')).toBe(true);
    expect(hasPassive(s, 'workersUseGenerator')).toBe(false);
    s.laws = [{ id: 'L18', covered: 'L18A' }];
    expect(hasPassive(s, 'workersUseGenerator')).toBe(true);
    expect(hasPassive(s, 'workersUseWorkshopsAndGenerator')).toBe(true);
  });

  it('reads event passives on the Event display', () => {
    const s = blankState();
    s.events = [{ uid: 1, card: 'D064', res: {}, meeples: [], usedThisRound: false, usedEver: false }];
    expect(passive(s, 'huntingSymbols')).toBe(1);
  });
});

describe('technology development', () => {
  const techs = (): GameState['techs'] => [
    { id: 'T01', state: 'inactive', dueRound: null }, // cost 4
    { id: 'T08', state: 'inactive', dueRound: null }, // cost 6
  ];

  it('starts with a workshop, develops at Dawn and then chooses the next tech', () => {
    const s = blankState();
    s.techs = techs();
    s.round = 1;
    workshop(s);
    techStart(s);
    drain(s);
    expect(s.pending?.kind).toBe('tech');
    answer(s, ['T01']);
    expect(s.techs.find((t) => t.id === 'T01')).toMatchObject({ state: 'developing', dueRound: 5 });

    s.round = 4;
    techDawn(s);
    drain(s);
    expect(techActive(s, 'T01')).toBe(false);

    s.round = 5;
    techDawn(s);
    drain(s);
    expect(techActive(s, 'T01')).toBe(true);
    // only T08 is left: it is started automatically at cost 6 from the current round
    expect(s.techs.find((t) => t.id === 'T08')).toMatchObject({ state: 'developing', dueRound: 11 });
    expect(techMod(s, 'constructSubactions')).toBe(0);
  });

  it('caps the due round at 15 and develops at once when a Workshop effect moves the token onto the marker', () => {
    const s = blankState();
    s.techs = [{ id: 'T08', state: 'developing', dueRound: 15 }];
    s.techInProgress = 'T08';
    s.round = 13;
    workshop(s);
    devMove(s, 2);
    drain(s);
    expect(techActive(s, 'T08')).toBe(true);
    expect(techMod(s, 'constructSubactions')).toBe(4);
    expect(techMod(s, 'dismantleGainWood')).toBe(1);
  });

  it('returns the token to inactive when all Workshops are gone', () => {
    const s = blankState();
    s.techs = [{ id: 'T01', state: 'developing', dueRound: 6 }];
    s.techInProgress = 'T01';
    techSyncWorkshops(s);
    expect(s.techs[0]).toMatchObject({ state: 'inactive', dueRound: null });
    expect(s.techInProgress).toBeNull();
  });
});
