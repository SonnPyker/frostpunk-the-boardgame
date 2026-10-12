// Audit 8 (LAW-06): behavioural tests for the Law Consequence cards that had none: L03A, L13B, L14A, L17A-L17B,
// L18A-L18B, L19A-L19B, L20A-L20B. Each card is put on the table through the real card path (cardResolve: top effects,
// options, fate) and its outcome is checked against the printed face (checked against the card images: sheets 726 #4-5,
// #24-27, #32-39). Decisions are answered explicitly: `choice` takes the option index, other decisions take the first
// enabled option.
import { describe, expect, it } from 'vitest';
import '../src/index';
import { push, run } from '../src/core';
import { blankState } from '../src/testing';
import { totalStress } from '../src/generator';
import { roundType } from '../src/types';
import { activeCount } from '../src/hope';
import type { GameState } from '../src/types';

type Choice = number | undefined;

/** Resolves one Dusk / Law Consequence card. `choice` answers `choice`-kind decisions (option index). */
function resolve(s: GameState, card: string, choice?: Choice) {
  push(s, { k: 'cardResolve', card });
  for (let i = 0; i < 60; i++) {
    try {
      run(s);
    } catch (e: any) {
      if (!/stack ran dry/.test(String(e?.message))) throw e;
    }
    const p: any = s.pending;
    if (!p) return;
    let pick: string[] | undefined;
    // the card's own "Choose one" decision takes the requested option; other choices (e.g. Decrease Discontent) take the first
    if (p.kind === 'choice' && p.prompt === 'Choose one' && choice !== undefined) pick = [String(choice)];
    else pick = [p.options.find((o: any) => !o.disabled)?.id].filter(Boolean);
    s.pending = null;
    s.stack.push({ ...p.then, pick });
  }
  throw new Error(`card ${card} did not settle`);
}

function fresh(): GameState {
  const s = blankState();
  s.round = 1; // roundType(1) = child; tests that need another type set s.round explicitly
  s.cit = { worker: 6, engineer: 6, child: 6 };
  // Hope / Discontent tokens are drawn from the bags: give every type stock so the +1 effects can draw
  s.hopeBag = { care: 5, justice: 5, motivation: 5 };
  s.discBag = { anger: 5, apathy: 5, greed: 5 };
  return s;
}

const removed = (s: GameState, card: string) => !s.decks.duskDiscard.includes(card) && !s.decks.dusk.includes(card);
const discarded = (s: GameState, card: string) => s.decks.duskDiscard.includes(card);
const activeOf = (s: GameState, t: string) => activeCount(s, t as any);

describe('L03A A Bellyful of Lies: Hunger level 1 or more', () => {
  it('with Hunger 2: gains 2 sick Citizens of the current Round type and reduces Hunger by 3 (to 0)', () => {
    const s = fresh();
    s.round = 2; // worker round type = roundType(2)
    s.hunger = 2;
    const type = roundType(s.round);
    resolve(s, 'L03A');
    expect(s.sick[type].n).toBe(2);
    expect(s.hunger).toBe(0);
    expect(discarded(s, 'L03A')).toBe(true);
  });

  it('with Hunger 0: the printed condition fails, so no sickness and Hunger stays 0', () => {
    const s = fresh();
    s.hunger = 0;
    resolve(s, 'L03A');
    expect(s.sick.child.n + s.sick.worker.n + s.sick.engineer.n).toBe(0);
    expect(s.hunger).toBe(0);
  });
});

describe('L03B It\'s Not Healthy, But It Tastes Great!: -1 Discontent, then choose sick Workers or Engineers', () => {
  // Decrease Discontent exhausts one active token (it stays on the track, inactive) - the engine's dec op.
  it('option A: exhausts one active Discontent, gains 3 sick Workers; the card leaves the game', () => {
    const s = fresh();
    s.disc = [{ t: 'anger', a: true }];
    resolve(s, 'L03B', 0);
    expect(s.sick.worker.n).toBe(3);
    expect(s.sick.engineer.n).toBe(0);
    expect(activeOf(s, 'anger')).toBe(0);
    expect(removed(s, 'L03B')).toBe(true);
  });

  it('option B: gains 3 sick Engineers instead', () => {
    const s = fresh();
    s.disc = [{ t: 'greed', a: true }];
    resolve(s, 'L03B', 1);
    expect(s.sick.engineer.n).toBe(3);
    expect(s.sick.worker.n).toBe(0);
    expect(activeOf(s, 'greed')).toBe(0);
    expect(removed(s, 'L03B')).toBe(true);
  });
});

describe('L13B A Day of Appreciation: +1 Justice, then remove a spent token or reuse a Worker; leaves the game', () => {
  it('+1 Justice activates a Hope token of Justice', () => {
    const s = fresh();
    s.hope = [{ t: 'justice', a: false }];
    resolve(s, 'L13B', 0);
    expect(activeOf(s, 'justice')).toBe(1);
  });

  it('option A: removes one unoccupied Spent Citizen token', () => {
    const s = fresh();
    s.hope = [{ t: 'justice', a: false }];
    s.spent = [{ id: 1, type: 'worker', meeple: null }];
    resolve(s, 'L13B', 0);
    expect(s.spent.length).toBe(0);
    expect(removed(s, 'L13B')).toBe(true);
  });

  it('option A does not remove a Spent token that still holds a Meeple', () => {
    const s = fresh();
    s.hope = [{ t: 'justice', a: false }];
    s.spent = [{ id: 1, type: 'worker', meeple: 9 }];
    s.meeples = [{ id: 9, kind: 'worker', loc: { k: 'spent', token: 1 } } as any];
    resolve(s, 'L13B', 0);
    expect(s.spent.length).toBe(1);
  });

  it('option B: Reuse a Worker offers only a Worker that already acted this Round', () => {
    const s = fresh();
    s.hope = [{ t: 'justice', a: false }];
    // a Worker on a Remove Snow slot that already acted: reuse repeats its action (removeSnowAction)
    s.meeples = [{ id: 3, kind: 'worker', loc: { k: 'board', slot: 'removeSnow' } as any, used: true }];
    resolve(s, 'L13B', 1);
    expect(s.log.some((e) => e.t === 'act.reuseWorker.none')).toBe(false);
    expect(removed(s, 'L13B')).toBe(true);
  });

  it('option B with no Worker that has acted: nothing to reuse, the card still resolves and leaves the game', () => {
    const s = fresh();
    s.hope = [{ t: 'justice', a: false }];
    s.meeples = [{ id: 3, kind: 'worker', loc: { k: 'supply' } as any }];
    resolve(s, 'L13B', 1);
    expect(s.log.some((e) => e.t === 'act.reuseWorker.none')).toBe(true);
    expect(removed(s, 'L13B')).toBe(true);
  });
});

describe('L14A Pressure or Oppression?: +1 Apathy, Hunger +6, leaves the game', () => {
  it('adds one active Apathy, raises Hunger by 6 and removes the card', () => {
    const s = fresh();
    s.hunger = 0;
    resolve(s, 'L14A');
    expect(activeOf(s, 'apathy')).toBe(1);
    expect(s.hunger).toBe(6);
    expect(removed(s, 'L14A')).toBe(true);
  });
});

describe('L17A Human Limits: Spent tokens depend on active Apathy', () => {
  it('without active Apathy: places 1 Spent Worker / Engineer token', () => {
    const s = fresh();
    resolve(s, 'L17A');
    expect(s.spent.length).toBe(1);
    expect(discarded(s, 'L17A')).toBe(true);
  });

  it('with active Apathy: places 2 Spent Worker / Engineer tokens', () => {
    const s = fresh();
    s.disc = [{ t: 'apathy', a: true }];
    resolve(s, 'L17A');
    expect(s.spent.length).toBe(2);
    expect(s.spent.every((t) => t.type === 'worker' || t.type === 'engineer')).toBe(true);
  });
});

describe('L17B The Birth of Distrust: +1 Apathy, exhaust all Motivation, leaves the game', () => {
  it('exhausts every active Motivation Hope token and adds an active Apathy', () => {
    const s = fresh();
    s.hope = [
      { t: 'motivation', a: true },
      { t: 'motivation', a: true },
      { t: 'care', a: true },
    ];
    resolve(s, 'L17B');
    expect(activeOf(s, 'motivation')).toBe(0);
    expect(activeOf(s, 'care')).toBe(1);
    expect(activeOf(s, 'apathy')).toBe(1);
    expect(removed(s, 'L17B')).toBe(true);
  });
});

describe('L18A Knowledge Is Power: a cover card for the Shared Knowledge Law (L18)', () => {
  it('covers L18 and stays in play (not discarded); its passives replace the Law permission', () => {
    const s = fresh();
    s.laws = [{ id: 'L18', covered: null }];
    resolve(s, 'L18A');
    expect(s.laws[0].covered).toBe('L18A');
    expect(discarded(s, 'L18A')).toBe(false);
  });
});

describe('L18B Social Equality: upgrade a small building free, or activate 1 Hope', () => {
  it('option B: activates one inactive Hope token and the card is discarded', () => {
    const s = fresh();
    s.hope = [{ t: 'care', a: false }];
    resolve(s, 'L18B', 1);
    expect(activeOf(s, 'care')).toBe(1);
    expect(discarded(s, 'L18B')).toBe(true);
  });
});

describe('L19A Abandon All Hope Ye Who Enter Here: skull branch versus sick branch', () => {
  it('with a Skull marker: flips it to Syringe, a Citizen of that type dies and the marker moves back', () => {
    const s = fresh();
    s.sick.worker = { n: 2, skull: true };
    resolve(s, 'L19A');
    expect(s.sick.worker.skull).toBe(false);
    expect(s.cit.worker).toBe(5);
    expect(s.sick.worker.n).toBe(1);
  });

  it('with no Skull marker: gains 3 sick Citizens of one chosen type', () => {
    const s = fresh();
    resolve(s, 'L19A');
    expect(s.sick.worker.n + s.sick.engineer.n + s.sick.child.n).toBe(3);
  });
});

describe('L19B Traumatising Moments: +1 Apathy, 2 sick Engineers (2 more with active Care), leaves the game', () => {
  it('without active Care: 2 sick Engineers', () => {
    const s = fresh();
    resolve(s, 'L19B');
    expect(s.sick.engineer.n).toBe(2);
    expect(activeOf(s, 'apathy')).toBe(1);
    expect(removed(s, 'L19B')).toBe(true);
  });

  it('with active Care: 4 sick Engineers in total', () => {
    const s = fresh();
    s.hope = [{ t: 'care', a: true }];
    resolve(s, 'L19B');
    expect(s.sick.engineer.n).toBe(4);
    expect(removed(s, 'L19B')).toBe(true);
  });
});

describe('L20A Strength in Unity: 3 or more active Discontent, otherwise a choice', () => {
  it('with 3 active Discontent: +1 Discontent (one more token) and no choice is asked', () => {
    const s = fresh();
    s.disc = [
      { t: 'anger', a: true },
      { t: 'anger', a: true },
      { t: 'apathy', a: true },
    ];
    resolve(s, 'L20A');
    // an untyped increase draws a token and places it EXHAUSTED side up (rulebook: Hope/Discontent increase)
    expect(s.disc.length).toBe(4);
    expect(s.disc.filter((t) => !t.a).length).toBe(1);
    expect(activeOf(s, 'anger') + activeOf(s, 'apathy') + activeOf(s, 'greed')).toBe(3);
  });

  it('otherwise option A: exhausts one active Discontent', () => {
    const s = fresh();
    s.disc = [{ t: 'anger', a: true }];
    resolve(s, 'L20A', 0);
    expect(activeOf(s, 'anger')).toBe(0);
  });

  it('otherwise option B: exhausts an active Hope and applies its Virtue effect (Justice removes 4 Stress)', () => {
    const s = fresh();
    s.disc = [];
    s.hope = [{ t: 'justice', a: true }];
    s.gen.stress = 5;
    const before = totalStress(s);
    resolve(s, 'L20A', 1);
    expect(activeOf(s, 'justice')).toBe(0);
    expect(totalStress(s)).toBe(Math.max(0, before - 4));
  });
});

describe('L20B United We Stand: 3 or more active Discontent, otherwise the Virtue effect of the L20 Hope token', () => {
  it('otherwise: applies the Care Virtue effect for the Hope token on L20 (Hunger -2, and -2 per active Care)', () => {
    const s = fresh();
    s.disc = [];
    s.laws = [{ id: 'L20', covered: null, hopeTok: 'care' } as any];
    s.hope = [{ t: 'care', a: true }];
    s.hunger = 6;
    resolve(s, 'L20B');
    expect(s.hunger).toBe(2);
    expect(discarded(s, 'L20B')).toBe(true);
  });

  it('with 3 or more active Discontent: +1 Discontent and the Virtue effect is not applied', () => {
    const s = fresh();
    s.disc = [
      { t: 'anger', a: true },
      { t: 'anger', a: true },
      { t: 'apathy', a: true },
    ];
    s.laws = [{ id: 'L20', covered: null, hopeTok: 'care' } as any];
    s.hunger = 6;
    resolve(s, 'L20B');
    expect(s.disc.length).toBe(4);
    expect(s.hunger).toBe(6);
  });
});
