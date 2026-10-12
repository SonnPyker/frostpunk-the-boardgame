// Repair pass (audit 5 wave-5 review): L20 The Virtue of Humanity.
//  1. L20B "Otherwise": apply the Virtue effect of the type of the Hope token on the L20 card (no choice, no track dependence).
//  2. Bulk exhausts of a Hope type ("exhaust:care:all", L08A/L08B exhaustAllHopeOfType) are one token at a time, and each
//     Hope token is offered the L20 substitution while the card's passive is in force.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run } from '../src/core';
import { runFx } from '../src/fx/core';
import { answer } from '../src/setup';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

function optionIds(s: GameState): string[] {
  return (s.pending?.options ?? []).map((o: any) => o.id);
}

function choose(s: GameState, ids: string[]) {
  const p = s.pending;
  expect(p).not.toBeNull();
  const r = answer(s, p!.who, p!.id, ids);
  expect(r.ok).toBe(true);
  drain(s);
}

function law20(card: string | null) {
  return { id: 'L20', covered: null, hopeTok: card } as any;
}

const activeTypes = (s: GameState) => s.hope.filter((t) => t.a).map((t) => t.t).sort();

// ---------------------------------------------------------------------------------------------------------
// 1. L20B "Otherwise"
// ---------------------------------------------------------------------------------------------------------

describe('L20B Otherwise: the Virtue effect follows the Hope token on the L20 card', () => {
  it('card=care with no active Hope on the track: the care effect (Hunger -2) still applies', () => {
    const s = blankState();
    s.laws.push(law20('care'));
    s.hope = [];
    s.hunger = 5;
    runFx(s, ['virtueEffect'], { who: 0, card: 'L20B', src: 'law:L20B' });
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.hunger).toBe(3);
  });

  it('card=care with only an active justice on the track: the care effect applies and no justice effect is chosen', () => {
    const s = blankState();
    s.laws.push(law20('care'));
    s.hope = [{ t: 'justice', a: true }];
    s.hunger = 5;
    runFx(s, ['virtueEffect'], { who: 0, card: 'L20B', src: 'law:L20B' });
    drain(s);
    expect(s.pending?.kind === 'type' && /Virtue effect/.test(s.pending.prompt)).toBe(false);
    expect(s.hunger).toBe(3);
  });

  it('card=motivation with active care and justice on the track: no prompt asks which active Hope to apply', () => {
    const s = blankState();
    s.laws.push(law20('motivation'));
    s.hope = [
      { t: 'care', a: true },
      { t: 'justice', a: true },
    ];
    s.hunger = 5;
    runFx(s, ['virtueEffect'], { who: 0, card: 'L20B', src: 'law:L20B' });
    drain(s);
    expect(s.pending && /Virtue effect of which/.test(s.pending.prompt)).toBeFalsy();
    expect(s.hunger).toBe(5); // the care effect did not run
  });

  it('no Hope token on the card: nothing happens', () => {
    const s = blankState();
    s.laws.push(law20(null));
    s.hunger = 5;
    runFx(s, ['virtueEffect'], { who: 0, card: 'L20B', src: 'law:L20B' });
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.hunger).toBe(5);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 2. Bulk exhausts go through the L20 substitution one token at a time
// ---------------------------------------------------------------------------------------------------------

describe('L20 substitution applies to bulk exhausts (exhaust:care:all, exhaustAllHopeOfType)', () => {
  it('exhaust:care:all with the card on care: the first care token is offered the substitution (no silent exhaust)', () => {
    const s = blankState();
    s.laws.push(law20('care'));
    s.hope = [
      { t: 'care', a: true },
      { t: 'care', a: true },
      { t: 'justice', a: true },
    ];
    runFx(s, ['exhaust:care:all'], { who: 0, src: 'card:test' });
    drain(s);
    expect(s.pending?.kind).toBe('type');
    expect(optionIds(s).sort()).toEqual(['care', 'justice']);
    expect(activeTypes(s)).toEqual(['care', 'care', 'justice']); // nothing exhausted before the answer
  });

  it('answering "no substitution" twice exhausts both care tokens and leaves justice active', () => {
    const s = blankState();
    s.laws.push(law20('care'));
    s.hope = [
      { t: 'care', a: true },
      { t: 'care', a: true },
      { t: 'justice', a: true },
    ];
    runFx(s, ['exhaust:care:all'], { who: 0, src: 'card:test' });
    drain(s);
    choose(s, ['care']);
    // the second care token is about to be exhausted too: the substitution is offered again
    expect(s.pending?.kind).toBe('type');
    choose(s, ['care']);
    expect(s.pending).toBeNull();
    expect(s.hope.filter((t) => t.t === 'care' && t.a)).toHaveLength(0);
    expect(s.hope.filter((t) => t.t === 'justice' && t.a)).toHaveLength(1);
  });

  it('answering "justice instead" exhausts a justice token for the first care slot; the care loop then finishes', () => {
    const s = blankState();
    s.laws.push(law20('care'));
    s.hope = [
      { t: 'care', a: true },
      { t: 'care', a: true },
      { t: 'justice', a: true },
    ];
    runFx(s, ['exhaust:care:all'], { who: 0, src: 'card:test' });
    drain(s);
    choose(s, ['justice']);
    // justice is gone now: no alternative remains, so the two care tokens are exhausted without another question
    expect(s.pending).toBeNull();
    expect(activeTypes(s)).toEqual([]);
    expect(s.hope.filter((t) => t.t === 'justice' && t.a)).toHaveLength(0);
  });

  it('without the card on the type (card on justice), exhaust:care:all is not offered a substitution', () => {
    const s = blankState();
    s.laws.push(law20('justice'));
    s.hope = [
      { t: 'care', a: true },
      { t: 'care', a: true },
      { t: 'justice', a: true },
    ];
    runFx(s, ['exhaust:care:all'], { who: 0, src: 'card:test' });
    drain(s);
    expect(s.pending).toBeNull();
    expect(activeTypes(s)).toEqual(['justice']);
  });

  it('exhaustAllHopeOfType (L08A/L08B shape): every care token is offered the substitution, then the effect runs once', () => {
    const s = blankState();
    s.laws.push(law20('care'));
    s.hope = [
      { t: 'care', a: true },
      { t: 'care', a: true },
      { t: 'justice', a: true },
    ];
    s.hunger = 5;
    runFx(s, [{ exhaustAllHopeOfType: { care: ['hunger-1'] } }] as any, { who: 0, src: 'law:L08A' });
    drain(s);
    // the type question first (care is the only type in the spec, so it is chosen automatically)
    expect(s.pending?.kind).toBe('type');
    expect(optionIds(s).sort()).toEqual(['care', 'justice']);
    choose(s, ['care']);
    expect(s.pending?.kind).toBe('type');
    choose(s, ['care']);
    expect(s.pending).toBeNull();
    expect(s.hunger).toBe(4);
    expect(s.hope.filter((t) => t.t === 'care' && t.a)).toHaveLength(0);
  });
});
