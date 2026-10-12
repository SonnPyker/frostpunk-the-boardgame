// Audit 8 (group cards, checklist DUS-02 and NIG-06). Card-level behaviour of Dusk cards D012, D030, D053, D073 (played through
// cardResolve, the same path as the Dusk draw), and the Night timing of D008/D009 (printed "At the end of the Night Phase")
// against D010/D011/D037 (printed "NIGHT PHASE" only, no "at the end").
import { describe, expect, it } from 'vitest';
import '../src/fx';
import { placeEvent, eventOf } from '../src/cards';
import { answerPending, push, run } from '../src/core';
import { eventRunItems, nightBody, runItems } from '../src/night';
import { blankState } from '../src/testing';
import type { GameState, Meeple, MeepleKind } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e) {
    if (!/stack ran dry/.test(String((e as Error).message))) throw e;
  }
}

/** answerPending, then drain; the engine's own run may end with an empty stack, which is the normal idle state. */
function answer(s: GameState, who: number, id: number, pick: string[]) {
  try {
    answerPending(s, who, id, pick);
  } catch (e) {
    if (!/stack ran dry/.test(String((e as Error).message))) throw e;
  }
  drain(s);
}

function meeple(s: GameState, kind: MeepleKind, loc: Meeple['loc']): Meeple {
  const m = { id: ++s.nextMeeple, kind, loc } as Meeple;
  s.meeples.push(m);
  return m;
}

/** Resolve a Dusk card through the real draw path and answer any draw prompts with the first offered option. */
function playDusk(s: GameState, id: string) {
  push(s, { k: 'cardResolve', card: id });
  drain(s);
  for (let i = 0; i < 10 && s.pending; i++) {
    const p = s.pending;
    const first = p.options.find((o) => !o.disabled) ?? p.options[0];
    answer(s, p.who < 0 ? 0 : p.who, p.id, [first.id]);
  }
}

const activeHope = (s: GameState, t?: string) => s.hope.filter((x) => x.a && (t === undefined || x.t === t)).length;
const activeDisc = (s: GameState, t?: string) => s.disc.filter((x) => x.a && (t === undefined || x.t === t)).length;

describe('DUS-02 D012 Have You Solved the Food Crisis? (printed: no Hunger: +1 Care; otherwise -1 Hope per 5 Hunger, rounded up)', () => {
  it('Hunger 0: +1 Care (an exhausted Care token becomes active) and the card leaves the display', () => {
    const s = blankState();
    s.hunger = 0;
    s.hope = [{ t: 'care', a: false }];
    playDusk(s, 'D012');
    expect(activeHope(s, 'care')).toBe(1);
    expect(s.hope.length).toBe(1);
  });

  it.each([
    [1, 1],
    [5, 1],
    [6, 2],
    [10, 2],
    [11, 3],
  ])('Hunger %i: -%i Hope (six active Hope tokens lose that many)', (hunger, loss) => {
    const s = blankState();
    s.hunger = hunger;
    s.hope = [1, 2, 3, 4, 5, 6].map((_, i) => ({ t: (['care', 'justice', 'motivation'] as const)[i % 3], a: true }));
    playDusk(s, 'D012');
    expect(activeHope(s)).toBe(6 - loss);
  });
});

describe('DUS-02 D053 What About the Toys? (printed: no Wood on M029 -> -1 Hope, activate all Greed; else +2 Hope if Wood = Child Meeples, otherwise +1 Hope; then M029 leaves)', () => {
  const answerDraws = (s: GameState) => {
    for (let i = 0; i < 5 && s.pending; i++) {
      answer(s, 0, s.pending.id, ['draw']);
    }
  };

  it('no Wood on M029: option 1 (-1 Hope, all Greed activated), M029 removed, its Resources go nowhere', () => {
    const s = blankState();
    placeEvent(s, 'M029');
    s.hope = [{ t: 'care', a: true }, { t: 'justice', a: true }];
    s.disc = [{ t: 'greed', a: false }, { t: 'greed', a: false }];
    playDusk(s, 'D053');
    expect(activeHope(s)).toBe(1);
    expect(activeDisc(s, 'greed')).toBe(2);
    expect(eventOf(s, 'M029')).toBeUndefined();
  });

  it('Wood on M029 equal to the Child Meeples: +2 Hope, the Wood goes to the bank (not the city) and M029 is removed', () => {
    const s = blankState();
    const ev = placeEvent(s, 'M029');
    ev.res.wood = 2;
    meeple(s, 'child', { k: 'supply' });
    meeple(s, 'child', { k: 'space', space: 'farm:1' });
    s.hope = [];
    s.hopeBag = { care: 3, justice: 3, motivation: 3 };
    const woodBefore = s.res.wood;
    push(s, { k: 'cardResolve', card: 'D053' });
    drain(s);
    answerDraws(s);
    expect(s.hope.length).toBe(2);
    // the card's Wood goes into the bank (off the city stock), so the city's Wood does not change
    expect(s.res.wood).toBe(woodBefore);
    expect(eventOf(s, 'M029')).toBeUndefined();
  });

  it('Wood on M029 not equal to the Child Meeples: +1 Hope', () => {
    const s = blankState();
    const ev = placeEvent(s, 'M029');
    ev.res.wood = 1;
    meeple(s, 'child', { k: 'supply' });
    meeple(s, 'child', { k: 'supply' });
    s.hope = [];
    s.hopeBag = { care: 3, justice: 3, motivation: 3 };
    playDusk(s, 'D053');
    answerDraws(s);
    expect(s.hope.length).toBe(1);
    expect(eventOf(s, 'M029')).toBeUndefined();
  });
});

describe('DUS-02 D073 Riot (printed: no active Discontent or most common Anger -> 1; Greed -> 2; otherwise 3)', () => {
  it('a single most common Greed takes option 2: Hunger +6, no question', () => {
    const s = blankState();
    s.disc = [{ t: 'greed', a: true }];
    s.hunger = 0;
    playDusk(s, 'D073');
    expect(s.pending).toBeNull();
    expect(s.hunger).toBe(6);
  });

  it('a tie of Greed and Apathy takes option 2 without asking (the card names Greed)', () => {
    const s = blankState();
    s.disc = [{ t: 'greed', a: true }, { t: 'apathy', a: true }];
    s.hunger = 0;
    playDusk(s, 'D073');
    expect(s.pending).toBeNull();
    expect(s.hunger).toBe(6);
  });

  it('most common Apathy (not named) takes option 3: one Citizen of the Round type dies, Hunger unchanged', () => {
    const s = blankState();
    s.disc = [{ t: 'apathy', a: true }];
    s.hunger = 0;
    s.round = 1; // Round 1 type is Child
    s.cit.child = 2;
    playDusk(s, 'D073');
    expect(s.hunger).toBe(0);
    expect(s.pending).toBeNull();
    expect(s.cit.child).toBe(1);
  });
});

describe('DUS-02 D030 Successful Project (printed: choose A) free Hothouse or B) free upgrade of a Hunter\'s Hut or Hothouse)', () => {
  it('the card asks the choice between the two printed options and both are offered', () => {
    const s = blankState();
    push(s, { k: 'cardResolve', card: 'D030' });
    drain(s);
    // the choice is pending (no building needed to ask), two options: A (build) and B (upgrade)
    expect(s.pending).toBeTruthy();
    expect(s.pending!.kind).toBe('choice');
    expect(s.pending!.options.map((o) => o.id)).toEqual(['0', '1']);
  });
});

describe('NIG-06 Night text timing (rulebook p29: the standing-sickness step is "At the end of the Night Phase")', () => {
  it('D008 and D009 (printed "At the end of the Night Phase") are the atEnd items, so they run after the standing sickness step', () => {
    const s = blankState();
    placeEvent(s, 'D008');
    placeEvent(s, 'D009');
    const end = eventRunItems(s, 'night', 'end').map((r) => r.ctx.card);
    const now = eventRunItems(s, 'night', 'now').map((r) => r.ctx.card);
    expect(end.sort()).toEqual(['D008', 'D009']);
    expect(now).toEqual([]);
    const ops = nightBody(s);
    const standing = ops.findIndex((o) => o.k === 'ntStanding');
    const lastRuns = ops.map((o, i) => (o.k === 'ntRuns' ? i : -1)).filter((i) => i >= 0);
    expect(lastRuns[lastRuns.length - 1]).toBeGreaterThan(standing);
  });

  it('D010, D011 and D037 (printed "NIGHT PHASE" without "at the end") stay in the ordinary Night run, before the standing sickness step', () => {
    const s = blankState();
    placeEvent(s, 'D010');
    placeEvent(s, 'D011');
    placeEvent(s, 'D037');
    expect(eventRunItems(s, 'night', 'end')).toEqual([]);
    const now = eventRunItems(s, 'night', 'now').map((r) => r.ctx.card);
    expect(now.sort()).toEqual(['D010', 'D011', 'D037']);
    const ops = nightBody(s);
    const standing = ops.findIndex((o) => o.k === 'ntStanding');
    const firstRuns = ops.findIndex((o) => o.k === 'ntRuns');
    expect(firstRuns).toBeLessThan(standing);
  });

  it('D008 with every Citizen warm: its end run activates 1 Hope and removes the card', () => {
    const s = blankState();
    placeEvent(s, 'D008');
    s.flags.night = { unsheltered: 0, total: 3, ruinsUsed: false };
    s.hope = [{ t: 'care', a: false }];
    runItems(s, eventRunItems(s, 'night', 'end'));
    drain(s);
    expect(activeHope(s)).toBe(1);
    expect(eventOf(s, 'D008')).toBeUndefined();
  });

  it('D009 with more than half warm: the card is removed, no Apathy is gained', () => {
    const s = blankState();
    placeEvent(s, 'D009');
    s.flags.night = { unsheltered: 1, total: 4, ruinsUsed: false };
    s.disc = [];
    runItems(s, eventRunItems(s, 'night', 'end'));
    drain(s);
    expect(s.disc.length).toBe(0);
    expect(eventOf(s, 'D009')).toBeUndefined();
  });
});
