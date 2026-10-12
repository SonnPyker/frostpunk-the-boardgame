// Audit 8 regression tests for the rules-checklist-docs batch. They pin the engine behaviour that docs/RULES_CHECKLIST.md
// now states: SET-08 (Morning deck contents) and WEA-01 (Weather deck reshuffle when empty, no effect when both piles are empty).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions'; // real Action phase; phWeather itself needs no meeples
import '../src/generator';
import '../src/sickness';
import '../src/tech';
import '../src/cards';
import '../src/expedition';
import '../src/phases';
import '../src/night';
import { push, run } from '../src/core';
import { createGame } from '../src/index';
import { blankState } from '../src/testing';
import type { GameConfig, GameState } from '../src/types';

/** Drain the stack; an empty stack is normal when a test ends on purpose. */
function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

const padId = (prefix: string, n: number) => `${prefix}${String(n).padStart(3, '0')}`;

describe('SET-08 Morning deck: base game M001-M032, extra pack adds M033-M040', () => {
  const setupMorning = (extraPack: boolean) => {
    const cfg: GameConfig = {
      scenario: 'crater',
      society: 1,
      difficulty: 'normal',
      mode: 'solo',
      players: [{ name: 'Captain' }],
      seed: 7,
      extraPack,
    };
    return [...createGame(cfg).decks.morning].sort();
  };

  it('base game (extra pack off) holds exactly the 32 cards M001-M032', () => {
    const expected = Array.from({ length: 32 }, (_, i) => padId('M', i + 1));
    expect(setupMorning(false)).toEqual(expected);
  });

  it('extra pack on adds M033-M040 on top of the base 32', () => {
    const expected = Array.from({ length: 40 }, (_, i) => padId('M', i + 1));
    expect(setupMorning(true)).toEqual(expected);
  });
});

describe('WEA-01 Weather deck: an empty deck reshuffles its discard; no effect only when both piles are empty', () => {
  it('reveals from the reshuffled discard, then discards the revealed card', () => {
    const s = blankState();
    s.decks.weather = [];
    s.decks.weatherDiscard = ['W01', 'W02', 'W03'];
    push(s, { k: 'phWeather' } as any);
    drain(s);
    expect(['W01', 'W02', 'W03']).toContain(s.weatherCard);
    expect(s.decks.weatherDiscard).toEqual([s.weatherCard]); // revealed card goes to the discard pile
    expect(s.decks.weather).toHaveLength(2); // the other two cards form the new deck
    expect(s.decks.weather).not.toContain(s.weatherCard);
    expect(s.log.some((e: any) => e.t === 'weather.card')).toBe(true);
  });

  it('with an empty deck and empty discard there is no Weather effect (logged as weather.none)', () => {
    const s = blankState();
    s.decks.weather = [];
    s.decks.weatherDiscard = [];
    push(s, { k: 'phWeather' } as any);
    drain(s);
    expect(s.weatherCard).toBeNull();
    expect(s.decks.weatherDiscard).toEqual([]);
    expect(s.log.some((e: any) => e.t === 'weather.none')).toBe(true);
  });

  it('a fresh game holds all 13 Weather cards in its deck with an empty discard', () => {
    const s = createGame({
      scenario: 'crater',
      society: 1,
      difficulty: 'normal',
      mode: 'solo',
      players: [{ name: 'Captain' }],
      seed: 7,
      extraPack: false,
    });
    expect(s.decks.weather).toHaveLength(13);
    expect(s.decks.weatherDiscard).toEqual([]);
  });
});
