// Audit 2 regressions for fx/custom.ts and morning_3.json: M015 Dusk threshold, M038 printed Wood cost, D043 Automaton
// taken from the supply when the bank is empty, D053 equal-Wood test, and the M031/M032 pack flag.
import { describe, expect, it } from 'vitest';
import '../src/fx';
import { cardDef, placeEvent, eventOf } from '../src/cards';
import { answerPending, push, run } from '../src/core';
import { runFx } from '../src/fx/core';
import { eventTimingFx } from '../src/fx/custom';
import { blankState } from '../src/testing';
import { actionMenuFor } from '../src/actions';
import type { GameState } from '../src/types';

/** Drain the op stack. The phase machine is not wired in unit tests, so an empty stack is the normal end here. */
function drain(s: GameState) {
  try {
    run(s);
  } catch (e) {
    if (!/stack ran dry/.test(String((e as Error).message))) throw e;
  }
}

describe('audit 2: M015 A New Project (Dusk: exactly 2 Wood adds D030)', () => {
  const dusk = (s: GameState) => {
    const ev = eventOf(s, 'M015')!;
    runFx(s, eventTimingFx('M015', 'dusk'), { who: 0, src: 'card:M015', card: 'M015', evUid: ev.uid });
    drain(s);
  };

  it('2 Wood on the card adds D030 to the Dusk deck', () => {
    const s = blankState();
    const ev = placeEvent(s, 'M015');
    ev.res.wood = 2;
    s.meeples.push({ id: 90, kind: 'engineer', loc: { k: 'card', card: 'M015' } } as any);
    ev.meeples.push(90);
    dusk(s);
    expect(s.decks.dusk).toContain('D030');
  });

  it('3 Wood on the card does not add D030 (the card says exactly 2)', () => {
    const s = blankState();
    const ev = placeEvent(s, 'M015');
    ev.res.wood = 3;
    s.meeples.push({ id: 90, kind: 'engineer', loc: { k: 'card', card: 'M015' } } as any);
    ev.meeples.push(90);
    dusk(s);
    expect(s.decks.dusk).not.toContain('D030');
  });

  it('1 Wood on the card does not add D030', () => {
    const s = blankState();
    const ev = placeEvent(s, 'M015');
    ev.res.wood = 1;
    s.meeples.push({ id: 90, kind: 'engineer', loc: { k: 'card', card: 'M015' } } as any);
    ev.meeples.push(90);
    dusk(s);
    expect(s.decks.dusk).not.toContain('D030');
  });
});

describe('audit 2: M038 Child\'s Play (printed cost 1 Wood)', () => {
  it('the JSON eventAction carries the Wood cost, and no other cost', () => {
    const ea: any = (cardDef('M038') as any).eventAction;
    expect(ea.cost).toEqual({ wood: 1 });
    expect(ea.custom).toBe('M038');
    expect(ea.acts).toEqual(['worker']);
  });

  it('the event action is disabled when the supply has no Wood', () => {
    const s = blankState();
    const ev = placeEvent(s, 'M038');
    s.res.wood = 0;
    s.meeples = [{ id: 1, kind: 'worker', loc: { k: 'supply' } } as any];
    const item = actionMenuFor(s, 0).find((m) => m.id === `act:special:ev${ev.uid}`);
    expect(item).toBeDefined();
    expect(item!.disabled).toBeDefined();
  });

  it('performing the action with 1 Wood spends it once and places the Worker on the card', () => {
    const s = blankState();
    const ev = placeEvent(s, 'M038');
    s.res.wood = 1;
    s.meeples = [{ id: 1, kind: 'worker', loc: { k: 'supply' } } as any];
    push(s, { k: 'actSpecial', who: 0, key: `ev${ev.uid}`, meeple: 1 });
    drain(s);
    expect(s.res.wood).toBe(0);
    expect(ev.meeples).toContain(1);
  });

  it('performing the action with 0 Wood is refused: no Worker placed, nothing spent', () => {
    const s = blankState();
    const ev = placeEvent(s, 'M038');
    s.res.wood = 0;
    s.meeples = [{ id: 1, kind: 'worker', loc: { k: 'supply' } } as any];
    push(s, { k: 'actSpecial', who: 0, key: `ev${ev.uid}`, meeple: 1 });
    drain(s);
    expect(s.res.wood).toBe(0);
    expect(ev.meeples).not.toContain(1);
  });
});

describe('audit 2: D043 A Tripod! (Automaton from the supply when the bank is empty)', () => {
  const tripod = (s: GameState) => {
    s.tiles = [{ key: '0,0', id: 'F1', kind: 'far', spaces: ['far:1', 'far:2'] } as any];
    push(s, { k: 'cusD043Tile', who: 0, pick: ['0,0'] });
    drain(s);
  };

  it('with the bank empty, an Automaton in the supply is laid ON the Tripod tile (not on the card), both spaces blocked', () => {
    const s = blankState();
    s.meeples = [
      ...[1, 2, 3, 4, 5].map((id) => ({ id, kind: 'automaton', loc: { k: 'space', space: 'x' } }) as any),
      { id: 6, kind: 'automaton', loc: { k: 'supply' } } as any,
    ];
    s.nextMeeple = 6;
    tripod(s);
    const ev = eventOf(s, 'D043');
    expect(ev).toBeDefined();
    expect(ev!.meeples).toEqual([]);
    expect(s.meeples.find((m) => m.id === 6)!.loc).toEqual({ k: 'space', space: 'far:1' });
    expect(s.scenarioState.blocked).toEqual(['far:1', 'far:2']);
    expect(s.meeples.filter((m) => m.kind === 'automaton')).toHaveLength(6);
  });

  it('with the bank empty and no Automaton in the supply, nothing is placed and no 7th Automaton is created', () => {
    const s = blankState();
    s.meeples = [1, 2, 3, 4, 5, 6].map((id) => ({ id, kind: 'automaton', loc: { k: 'space', space: 'x' } }) as any);
    s.nextMeeple = 6;
    tripod(s);
    const ev = eventOf(s, 'D043');
    expect(ev!.meeples).toEqual([]);
    expect(s.meeples.filter((m) => m.kind === 'automaton')).toHaveLength(6);
  });

  it('with a bank Automaton available, a new one is gained as before', () => {
    const s = blankState();
    s.meeples = [1, 2, 3, 4, 5].map((id) => ({ id, kind: 'automaton', loc: { k: 'space', space: 'x' } }) as any);
    s.nextMeeple = 5;
    tripod(s);
    const ev = eventOf(s, 'D043');
    expect(ev!.meeples).toEqual([]);
    expect(s.meeples.filter((m) => m.kind === 'automaton' && m.loc.k === 'space' && m.loc.space === 'far:1')).toHaveLength(1);
    expect(s.meeples.filter((m) => m.kind === 'automaton')).toHaveLength(6);
  });
});

describe('audit 2: D053 What About the Toys? (Wood must equal the Child count)', () => {
  const toys = (wood: number, kids: number) => {
    const s = blankState();
    const ev = placeEvent(s, 'M029');
    ev.res.wood = wood;
    for (let i = 0; i < kids; i++) s.meeples.push({ id: 100 + i, kind: 'child', loc: { k: 'supply' } } as any);
    s.hopeBag = { care: 3, justice: 3, motivation: 3 };
    s.hope = [];
    runFx(s, ['custom:D053'], { who: 0, src: 'card:D053' });
    drain(s);
    // each +1 Hope asks "Draw a random Hope token" (or activate an exhausted one): answer with a draw
    for (let i = 0; i < 5 && s.pending; i++) {
      try {
        answerPending(s, 0, s.pending.id, ['draw']);
      } catch (e) {
        if (!/stack ran dry/.test(String((e as Error).message))) throw e;
      }
      drain(s);
    }
    return s.hope.length;
  };

  it('equal Wood and Child meeples: +2 Hope', () => {
    expect(toys(2, 2)).toBe(2);
  });

  it('more Wood than Child meeples: +1 Hope, not +2', () => {
    expect(toys(3, 2)).toBe(1);
  });

  it('fewer Wood than Child meeples: +1 Hope', () => {
    expect(toys(1, 2)).toBe(1);
  });
});

describe('audit 2: morning card pack flags (M031/M032 are base game)', () => {
  it('M031 and M032 carry no extra-pack flag; M033 keeps it', () => {
    expect((cardDef('M031') as any).pack).toBeUndefined();
    expect((cardDef('M032') as any).pack).toBeUndefined();
    expect((cardDef('M033') as any).pack).toBe('extra');
  });
});
