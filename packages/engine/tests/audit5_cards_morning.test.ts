// Audit 5 (fixer "cards"): Morning M016 Young Adepts (Child placed on the card, no Frozen Grove filter), the D031 swap
// that follows it, M015 Dusk text repeating at every Dusk, and the open M028 Child Worker counting item.
import { describe, expect, it } from 'vitest';
import '../src/fx';
import { eventOf, placeEvent } from '../src/cards';
import { answerPending, run } from '../src/core';
import { runFx } from '../src/fx/core';
import { eventTimingFx } from '../src/fx/custom';
import { describeList } from '../src/fx/describe';
import { blankState } from '../src/testing';
import { dusk, morning } from '../src/data';
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

const ctxM016 = { who: 0, src: 'card:M016', card: 'M016' };
const m016Opts = morning.M016.opts!;

describe('M016 Young Adepts: the printed option effects (JSON list, run as printed)', () => {
  it('option 1 (send engineers): the card is in the Event display, a supply Child becomes a Child Engineer ON the card, D031 is added', () => {
    const s = blankState();
    const child = meeple(s, 'child', { k: 'supply' });
    runFx(s, m016Opts[0].fx as any[], ctxM016);
    drain(s);
    const ev = eventOf(s, 'M016');
    expect(ev).toBeDefined();
    expect(child.kind).toBe('childEngineer');
    expect(child.loc).toEqual({ k: 'card', card: 'M016' });
    expect(ev!.meeples).toEqual([child.id]);
    expect(s.decks.dusk).toContain('D031');
  });

  it('option 2 (send workers): the Child becomes a Child Worker on the card', () => {
    const s = blankState();
    const child = meeple(s, 'child', { k: 'supply' });
    runFx(s, m016Opts[1].fx as any[], ctxM016);
    drain(s);
    expect(child.kind).toBe('childWorker');
    expect(child.loc).toEqual({ k: 'card', card: 'M016' });
    expect(eventOf(s, 'M016')!.meeples).toEqual([child.id]);
  });

  it('a Child that is not in the supply (on a building) is not taken: the supply Child is used', () => {
    const s = blankState();
    const busy = meeple(s, 'child', { k: 'space', space: 'farm:1' });
    const free = meeple(s, 'child', { k: 'supply' });
    placeEvent(s, 'M016');
    runFx(s, ['custom:M016:engineer'], ctxM016);
    drain(s);
    expect(busy.kind).toBe('child');
    expect(free.kind).toBe('childEngineer');
  });

  it('with no Child in the supply the card still goes to the Event display and nothing is placed', () => {
    const s = blankState();
    meeple(s, 'child', { k: 'space', space: 'farm:1' });
    runFx(s, m016Opts[0].fx as any[], ctxM016);
    drain(s);
    expect(eventOf(s, 'M016')).toBeDefined();
    expect(eventOf(s, 'M016')!.meeples).toEqual([]);
  });

  it('the Frozen Grove connectivity rule does not filter the placement (it covers Map-tile Actions only)', () => {
    const s = blankState();
    s.scenarioState = { revealed: ['S09'] };
    // a Map with no tile connected to the Generator: the Child is still placed on the card
    s.tiles = [{ key: '5,5', id: 'F9', kind: 'far', q: 5, r: 5, spaces: ['far:1', 'far:2'], food: 0 } as any];
    const child = meeple(s, 'child', { k: 'supply' });
    runFx(s, m016Opts[1].fx as any[], ctxM016);
    drain(s);
    expect(child.loc).toEqual({ k: 'card', card: 'M016' });
  });

  it('D031 (the real Dusk card) swaps the Child on M016 with one of your Children, then M016 leaves the display and its Child returns to the supply', () => {
    const s = blankState();
    const onCard = meeple(s, 'child', { k: 'supply' });
    runFx(s, m016Opts[0].fx as any[], ctxM016);
    drain(s);
    expect(onCard.kind).toBe('childEngineer');
    const other = meeple(s, 'child', { k: 'supply' });
    const third = meeple(s, 'child', { k: 'supply' });
    runFx(s, dusk.D031.top as any[], { who: 0, src: 'card:D031', card: 'D031' });
    drain(s);
    expect(s.pending).toBeTruthy();
    try {
      answerPending(s, 0, s.pending!.id, [String(other.id)]);
    } catch (e) {
      if (!/stack ran dry/.test(String((e as Error).message))) throw e;
    }
    drain(s);
    expect(other.kind).toBe('childEngineer');
    expect(third.kind).toBe('child');
    expect(onCard.kind).toBe('child');
    expect(eventOf(s, 'M016')).toBeUndefined();
    expect(onCard.loc).toEqual({ k: 'supply' });
  });

  it('the description of the handler names the Child and the card', () => {
    expect(describeList(['custom:M016:worker'])).toContain('Child-Worker');
    expect(describeList(['custom:M016:engineer'])).toContain('Child-Engineer');
  });
});

describe('M015 A New Project: the Dusk text repeats at every Dusk while the card is in the Event display', () => {
  it('the Dusk hook is part of the timing list', () => {
    expect(eventTimingFx('M015', 'dusk')).toContain('custom:M015:dusk');
  });

  it('two Dusks with no Engineer on the card give +1 Apathy twice', () => {
    const s = blankState();
    // the Discontent bag must hold Apathy for a typed increase to draw it
    s.discBag = { anger: 0, apathy: 5, greed: 0 };
    const ev = placeEvent(s, 'M015');
    const ctx = { who: 0, src: 'card:M015', card: 'M015', evUid: ev.uid };
    runFx(s, eventTimingFx('M015', 'dusk'), ctx);
    drain(s);
    runFx(s, eventTimingFx('M015', 'dusk'), ctx);
    drain(s);
    expect(s.disc.filter((t) => t.t === 'apathy').length).toBe(2);
  });

  it('each Dusk with exactly 2 Wood on the card adds D030 again', () => {
    const s = blankState();
    const ev = placeEvent(s, 'M015');
    ev.res.wood = 2;
    const engineer = meeple(s, 'engineer', { k: 'card', card: 'M015' });
    ev.meeples.push(engineer.id);
    const ctx = { who: 0, src: 'card:M015', card: 'M015', evUid: ev.uid };
    runFx(s, eventTimingFx('M015', 'dusk'), ctx);
    drain(s);
    runFx(s, eventTimingFx('M015', 'dusk'), ctx);
    drain(s);
    expect(s.decks.dusk.filter((id) => id === 'D030')).toHaveLength(2);
    expect(s.disc.filter((t) => t.t === 'apathy')).toHaveLength(0);
  });
});

describe('M028 Criticising the Leaders: Hunger per Worker/Engineer Meeple in the supply', () => {
  // Printed: "+1 Hunger for each Worker and Engineer Meeple in the supply". A Child Worker counts as a Child, so it is not counted.
  // The token (fx/tokens_supply.ts hungerPerMeeple) counts only the plain worker and engineer kinds.
  it('a Child Worker in the supply adds no Hunger', () => {
    const s = blankState();
    s.hunger = 0;
    meeple(s, 'childWorker', { k: 'supply' });
    runFx(s, ['hungerPerMeeple:workerEngineer:1'], { who: 0, src: 'card:M028' });
    drain(s);
    expect(s.hunger).toBe(0);
  });

  it('a plain Worker and a plain Engineer in the supply add 1 Hunger each', () => {
    const s = blankState();
    s.hunger = 0;
    meeple(s, 'worker', { k: 'supply' });
    meeple(s, 'engineer', { k: 'supply' });
    runFx(s, ['hungerPerMeeple:workerEngineer:1'], { who: 0, src: 'card:M028' });
    drain(s);
    expect(s.hunger).toBe(2);
  });
});
