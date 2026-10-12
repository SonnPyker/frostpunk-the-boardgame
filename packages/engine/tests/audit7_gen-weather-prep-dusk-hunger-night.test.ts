// Audit 7: focused proofs for checklist items still marked open or partial in sections 3 Generator, 4 Weather,
// 5 Preparation, 7 Dusk, 8 Hunger and 9 Night (docs/RULES_CHECKLIST.md). Each test pins behaviour the code already has.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions';
import '../src/generator';
import '../src/sickness';
import '../src/tech';
import '../src/cards';
import '../src/phases';
import '../src/night';
import { run } from '../src/core';
import { runFx } from '../src/fx/core';
import { weatherFxRuns } from '../src/tech';
import { hungerLevel } from '../src/phases';
import { addSpent, spentCount, MAX_SPENT_PER_TYPE } from '../src/sickness';
import { drawDusk } from '../src/cards';
import { gainRes } from '../src/util';
import { sicknessBand } from '../src/data';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

describe('WEA-06 L16B Survival of the Fittest weather effect while covering L16', () => {
  it('the covering Law Consequence weather list is offered as a weather run', () => {
    const s = blankState();
    s.laws = [{ id: 'L16', covered: 'L16B' } as any];
    const runs = weatherFxRuns(s);
    const cover = runs.find((r) => r.src === 'card:L16B');
    expect(cover).toBeDefined();
    expect(cover!.list[0]).toEqual({ each: 'active:greed', fx: ['hunger+2'] });
  });

  it('each active Greed adds +2 Hunger while L16B covers L16 (2 active Greed => +4 Hunger)', () => {
    const s = blankState();
    s.laws = [{ id: 'L16', covered: 'L16B' } as any];
    s.disc = [
      { t: 'greed', a: true },
      { t: 'greed', a: true },
      { t: 'anger', a: true },
    ] as any;
    s.hunger = 0;
    s.hungerOver = false;
    for (const r of weatherFxRuns(s)) {
      if (r.src === 'card:L16B') runFx(s, r.list, { who: 0, src: r.src, card: r.card });
    }
    drain(s);
    expect(hungerLevel(s)).toBe(4);
  });

  it('without a covering L16B there is no Weather effect from L16', () => {
    const s = blankState();
    s.laws = [{ id: 'L16', covered: null } as any];
    expect(weatherFxRuns(s).some((r) => r.src === 'card:L16B')).toBe(false);
  });
});

describe('PRE-06 Spent Citizen tokens go to the supply', () => {
  it('a placed Spent token has no Meeple and counts against the per-type limit of 5', () => {
    const s = blankState();
    addSpent(s, 'worker', 2);
    expect(spentCount(s, 'worker')).toBe(2);
    expect(s.spent.every((x) => x.meeple === null)).toBe(true);
    addSpent(s, 'worker', 10);
    expect(spentCount(s, 'worker')).toBe(MAX_SPENT_PER_TYPE);
  });

  it('the Preparation band for 15-19 sick is 2 Spent + 2 flips (rulebook p22 example: 15 sick Workers)', () => {
    expect(sicknessBand(15)).toEqual(expect.objectContaining({ spent: 2, flips: 2 }));
  });
});

describe('DUS-05 Dusk deck empty', () => {
  it('reshuffles the Dusk discard pile into an empty deck', () => {
    const s = blankState();
    s.decks.dusk = [];
    s.decks.duskDiscard = ['D001', 'D002'];
    const id = drawDusk(s);
    expect(id === 'D001' || id === 'D002').toBe(true);
    expect(s.decks.duskDiscard).toEqual([]);
  });

  it('with the deck and discard both empty no Dusk card is revealed', () => {
    const s = blankState();
    s.decks.dusk = [];
    s.decks.duskDiscard = [];
    expect(drawDusk(s)).toBeNull();
  });
});

describe('HUN-05 Food cap 50', () => {
  it('gaining Food stops at 50 and reports only what was gained', () => {
    const s = blankState();
    s.food = 48;
    const got = gainRes(s, 'food', 5);
    expect(s.food).toBe(50);
    expect(got).toBe(2);
  });
});

