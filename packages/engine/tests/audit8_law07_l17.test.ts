// Audit 8 (LAW-07): L17 Emergency Shift (extra pack) and the once-per-Round law actions L13 / L14 that were only partly tested.
//  - returnSpentCitizenTokens:upTo2 (fx/tokens_people.ts): returns up to two Spent Citizen tokens, chosen one at a time, and
//    the Meeple sitting on a returned token goes to the supply.
//  - returnedMeeplesUsableThisRound (laws.json, L17 perm.actionOncePerRound): the Meeples returned by the L17 action may be
//    used in the same Round. The engine reads it in util.ts (returnedMeeplesUsable / freeSupply); without it a Meeple
//    returned mid-Round is not free until the next Round (Spent Meeples otherwise return in the Night Phase).
import { describe, expect, it } from 'vitest';
import '../src/index';
import { push, run } from '../src/core';
import { blankState } from '../src/testing';
import { freeSupply, returnedMeeplesUsable } from '../src/util';
import { lawActionsAvailable, runLawAction } from '../src/laws';
import { activeCount } from '../src/hope';
import type { GameState } from '../src/types';

/** Runs the engine; each pending decision is answered by `pickFor` (undefined = the first enabled option). */
function settle(s: GameState, pickFor: (p: any) => string[] | undefined = () => undefined) {
  for (let i = 0; i < 60; i++) {
    try {
      run(s);
    } catch (e: any) {
      if (!/stack ran dry/.test(String(e?.message))) throw e;
    }
    const p: any = s.pending;
    if (!p) return;
    const pick = pickFor(p) ?? [p.options.find((o: any) => !o.disabled)?.id].filter(Boolean);
    s.pending = null;
    s.stack.push({ ...p.then, pick });
  }
  throw new Error('did not settle');
}

/** Answers the successive "Return a Spent Citizen token" decisions with the given ids ('none' stops). */
function returnTokens(s: GameState, ids: string[]) {
  const queue = [...ids];
  settle(s, (p) => (p.prompt === 'Return a Spent Citizen token' ? [queue.shift() ?? 'none'] : undefined));
}

function fresh(): GameState {
  const s = blankState();
  s.round = 3;
  s.cit = { worker: 6, engineer: 6, child: 0 };
  s.discBag = { anger: 5, apathy: 5, greed: 5 };
  s.hopeBag = { care: 5, justice: 5, motivation: 5 };
  s.laws = [{ id: 'L17', covered: null }];
  return s;
}

const withMeeple = (id: number, token: number, kind: 'worker' | 'engineer' = 'worker') =>
  ({ id, kind, loc: { k: 'spent', token } }) as any;

describe('L17 Emergency Shift: the once-per-Round action', () => {
  it('is listed as a law action for the L17 law in play, and its fx return up to two Spent Citizen tokens', () => {
    const s = fresh();
    const a = lawActionsAvailable(s, 0).find((x) => x.lawId === 'L17');
    expect(a).toBeDefined();
    expect(a?.fx).toContain('returnSpentCitizenTokens:upTo2');
    expect(a?.disabled).toBeUndefined();
  });

  it('runs at most once per Round; it becomes available again in the next Round', () => {
    const s = fresh();
    expect(runLawAction(s, 0, 'L17')).toBe(true);
    settle(s, () => ['none']);
    expect(lawActionsAvailable(s, 0).find((x) => x.lawId === 'L17')?.disabled).toBe('Already used this Round');
    expect(runLawAction(s, 0, 'L17')).toBe(false);
    s.round += 1;
    expect(lawActionsAvailable(s, 0).find((x) => x.lawId === 'L17')?.disabled).toBeUndefined();
  });

  it('applies the printed cost too: Apathy +1 (Discontent) on every use', () => {
    const s = fresh();
    runLawAction(s, 0, 'L17');
    settle(s, () => ['none']);
    expect(activeCount(s, 'apathy')).toBe(1);
  });

  it('is not offered once the L17 law is not in play', () => {
    const s = fresh();
    s.laws = [];
    expect(lawActionsAvailable(s, 0).some((x) => x.lawId === 'L17')).toBe(false);
  });
});

describe('returnSpentCitizenTokens:upTo2', () => {
  it('returns two tokens of the chosen kinds (the Meeple on each goes to the supply); the third stays spent', () => {
    const s = fresh();
    s.spent = [
      { id: 1, type: 'worker', meeple: 9 },
      { id: 2, type: 'engineer', meeple: null },
      { id: 3, type: 'worker', meeple: 10 },
    ];
    s.meeples = [withMeeple(9, 1), withMeeple(10, 3)];
    runLawAction(s, 0, 'L17');
    returnTokens(s, ['1', '3']);
    expect(s.spent.map((t) => t.id)).toEqual([2]);
    expect(s.meeples.find((m) => m.id === 9)?.loc.k).toBe('supply');
    expect(s.meeples.find((m) => m.id === 10)?.loc.k).toBe('supply');
  });

  it('returns only one token when the player stops after one (upTo, not exactly)', () => {
    const s = fresh();
    s.spent = [
      { id: 1, type: 'worker', meeple: null },
      { id: 2, type: 'engineer', meeple: null },
    ];
    runLawAction(s, 0, 'L17');
    returnTokens(s, ['2', 'none']);
    expect(s.spent.map((t) => t.id)).toEqual([1]);
  });

  it('returns nothing when there is no Spent token', () => {
    const s = fresh();
    runLawAction(s, 0, 'L17');
    settle(s);
    expect(s.spent.length).toBe(0);
    expect(s.log.some((e) => e.t === 'act.reuseWorker.none')).toBe(false);
  });

  it('never returns more than two tokens, even if the player keeps choosing', () => {
    const s = fresh();
    s.spent = [
      { id: 1, type: 'worker', meeple: null },
      { id: 2, type: 'worker', meeple: null },
      { id: 3, type: 'engineer', meeple: null },
    ];
    runLawAction(s, 0, 'L17');
    returnTokens(s, ['1', '2', '3']);
    expect(s.spent.map((t) => t.id)).toEqual([3]);
  });
});

describe('returnedMeeplesUsableThisRound: read by the engine', () => {
  it('is true while L17 is in play and not covered, false otherwise', () => {
    const s = fresh();
    expect(returnedMeeplesUsable(s)).toBe(true);
    s.laws = [];
    expect(returnedMeeplesUsable(s)).toBe(false);
  });

  it('a Meeple returned by the L17 action is free to place in the same Round', () => {
    const s = fresh();
    s.spent = [{ id: 1, type: 'worker', meeple: 9 }];
    s.meeples = [withMeeple(9, 1)];
    runLawAction(s, 0, 'L17');
    returnTokens(s, ['1', 'none']);
    expect(freeSupply(s, 'worker').map((m) => m.id)).toContain(9);
  });

  it('without the law, a Meeple returned from a Spent token is not free until the next Round', () => {
    const s = fresh();
    s.laws = [];
    s.spent = [{ id: 1, type: 'worker', meeple: 9 }];
    s.meeples = [withMeeple(9, 1)];
    push(s, { k: 'spentReturn2', pick: ['1'], who: 0, src: 'test' } as any);
    settle(s);
    expect(s.meeples[0].loc.k).toBe('supply');
    expect(freeSupply(s, 'worker').map((m) => m.id)).not.toContain(9);
    s.round += 1;
    expect(freeSupply(s, 'worker').map((m) => m.id)).toContain(9);
  });
});

describe('L13 Time to Rest: once-per-Round action permissions', () => {
  const l13 = (s: GameState) => lawActionsAvailable(s, 0).find((x) => x.lawId === 'L13');

  it('needs an active Justice to pay: without one it is disabled', () => {
    const s = fresh();
    s.laws = [{ id: 'L13', covered: null }];
    s.hope = [{ t: 'justice', a: false }];
    s.spent = [];
    s.cit.worker = 2;
    expect(l13(s)?.disabled).toBeTruthy();
  });

  it('pays: exhausts the active Justice and places a Spent Worker / Engineer token, then the chosen option resolves', () => {
    const s = fresh();
    s.laws = [{ id: 'L13', covered: null }];
    s.hope = [{ t: 'justice', a: true }];
    s.cit.worker = 2;
    expect(runLawAction(s, 0, 'L13')).toBe(true);
    settle(s, (p) => (p.kind === 'type' ? ['worker'] : p.kind === 'choice' && p.prompt === 'Choose one' ? ['1'] : undefined));
    expect(activeCount(s, 'justice')).toBe(0);
    expect(s.spent.length).toBe(1);
    expect(['worker', 'engineer']).toContain(s.spent[0].type);
    expect(s.spent[0].meeple).toBeNull();
  });
});

describe('L14 Extended Shift: once-per-Round action permissions', () => {
  it('pays one active Motivation (exhausted) and then offers reuseBuilding; it is disabled without an active Motivation', () => {
    const s = fresh();
    s.laws = [{ id: 'L14', covered: null }];
    s.hope = [{ t: 'motivation', a: false }];
    expect(lawActionsAvailable(s, 0).find((x) => x.lawId === 'L14')?.disabled).toBeTruthy();
    s.hope = [{ t: 'motivation', a: true }];
    expect(lawActionsAvailable(s, 0).find((x) => x.lawId === 'L14')?.disabled).toBeUndefined();
    expect(runLawAction(s, 0, 'L14')).toBe(true);
    settle(s);
    expect(activeCount(s, 'motivation')).toBe(0);
    expect(lawActionsAvailable(s, 0).find((x) => x.lawId === 'L14')?.disabled).toBe('Already used this Round');
  });
});
