// Audit 5 (fixer "virtue"): L20 The Virtue of Humanity and its Law Consequences (card text, extra pack).
//  - Introduction: "Choose 1 Hope token from the Hope bag and place it on this card, active side up. This Hope token does
//    not count towards your owned tokens." The token is on the Law (LawInPlay.hopeTok), not on the Hope track; no Hope
//    is gained (the old model pushed +1 Hope onto the track).
//  - Substitution: "Whenever you are about to exhaust a Hope token of the same type as the Hope token on this card, you may
//    exhaust any other active Hope token instead." (passive virtueHopeSubstitute, uncovered Law only)
//  - Swap: "You may swap the Hope token on 'The Virtue of Humanity' (L20) Law card with an active token on the Hope track."
//    (Law Consequence L20A / L20B, token virtueSwapOffer)
//  - L18 Shared Knowledge: the Law card itself grants Workshops only; the Generator comes from the covering L18A card.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run } from '../src/core';
import { runFx } from '../src/fx/core';
import { answer } from '../src/setup';
import { blankState } from '../src/testing';
import { hasPassive } from '../src/laws';
import { virtueSubstitutes } from '../src/hope';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** Answer the pending decision with `pick` (the decision must be of the given kind when `kind` is passed). */
function pick(s: GameState, value: string[], kind?: string) {
  const p = s.pending;
  expect(p).not.toBeNull();
  if (kind) expect(p!.kind).toBe(kind);
  const r = answer(s, p!.who, p!.id, value);
  expect(r.ok).toBe(true);
  drain(s);
}

function optionIds(s: GameState): string[] {
  return (s.pending?.options ?? []).map((o: any) => o.id);
}

function law20(card: string | null = null, covered: string | null = null) {
  return { id: 'L20', covered, hopeTok: card };
}

function raw(name: string): any {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../src/data/raw/${name}`, import.meta.url)), 'utf8'));
}

describe('L20 introduction: the Hope token goes on the card, not on the track', () => {
  it('choosing a bag token moves it from the bag to the card and leaves the track and Hope unchanged', () => {
    const s = blankState();
    s.hopeBag = { care: 2, justice: 1, motivation: 1 };
    s.hope = [{ t: 'justice', a: true }];
    s.laws.push({ id: 'L20', covered: null } as any);
    runFx(s, ['virtueHopeFromBag'], { who: 0, src: 'law:L20' });
    drain(s);
    expect(s.pending?.kind).toBe('type');
    expect(optionIds(s).sort()).toEqual(['care', 'justice', 'motivation']);
    pick(s, ['care'], 'type');
    expect(s.hopeBag.care).toBe(1);
    expect(s.hope).toEqual([{ t: 'justice', a: true }]);
    expect((s.laws[0] as any).hopeTok).toBe('care');
  });

  it('an empty Hope bag leaves the card without a token and asks nothing', () => {
    const s = blankState();
    s.laws.push({ id: 'L20', covered: null } as any);
    runFx(s, ['virtueHopeFromBag'], { who: 0, src: 'law:L20' });
    drain(s);
    expect(s.pending).toBeNull();
    expect((s.laws[0] as any).hopeTok ?? null).toBeNull();
  });
});

describe('L20 substitution (exhaust a Hope token of the card type -> may exhaust another active one)', () => {
  function track(over: Partial<GameState> = {}): GameState {
    const s = blankState();
    s.laws.push(law20('care') as any);
    s.hope = [
      { t: 'care', a: true },
      { t: 'justice', a: true },
      { t: 'motivation', a: false },
    ];
    return Object.assign(s, over);
  }

  it('offers the choice when an active token of the card type is exhausted and another active Hope exists', () => {
    const s = track();
    expect(virtueSubstitutes(s, 'care')).toEqual(['justice']);
    runFx(s, ['exhaust:care'], { who: 0, src: 'card:M001' });
    drain(s);
    expect(s.pending?.kind).toBe('type');
    expect(optionIds(s).sort()).toEqual(['care', 'justice']);
  });

  it('choosing the substitute exhausts the other active Hope and keeps the card-type token active', () => {
    const s = track();
    runFx(s, ['exhaust:care'], { who: 0, src: 'card:M001' });
    drain(s);
    pick(s, ['justice'], 'type');
    expect(s.hope.find((t) => t.t === 'care')!.a).toBe(true);
    expect(s.hope.find((t) => t.t === 'justice')!.a).toBe(false);
  });

  it('declining the substitution exhausts the card-type token as usual', () => {
    const s = track();
    runFx(s, ['exhaust:care'], { who: 0, src: 'card:M001' });
    drain(s);
    pick(s, ['care'], 'type');
    expect(s.hope.find((t) => t.t === 'care')!.a).toBe(false);
    expect(s.hope.find((t) => t.t === 'justice')!.a).toBe(true);
  });

  it('no choice when the exhausted type differs from the card type', () => {
    const s = track();
    runFx(s, ['exhaust:justice'], { who: 0, src: 'card:M001' });
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.hope.find((t) => t.t === 'justice')!.a).toBe(false);
    expect(s.hope.find((t) => t.t === 'care')!.a).toBe(true);
  });

  it('no choice when no other Hope token is active', () => {
    const s = track();
    s.hope = [
      { t: 'care', a: true },
      { t: 'justice', a: false },
    ];
    expect(virtueSubstitutes(s, 'care')).toEqual([]);
    runFx(s, ['exhaust:care'], { who: 0, src: 'card:M001' });
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.hope[0].a).toBe(false);
  });

  it('no substitution once the Law is covered by a Law Consequence card', () => {
    const s = track();
    s.laws = [law20('care', 'L20A') as any];
    expect(virtueSubstitutes(s, 'care')).toEqual([]);
    expect(hasPassive(s, 'virtueHopeSubstitute')).toBe(false);
  });

  it('the Hope token on the card does not count as a track token (loss check ignores it)', () => {
    const s = blankState();
    s.laws.push(law20('care') as any);
    s.hope = [{ t: 'justice', a: true }];
    expect(s.hope.length).toBe(1);
    expect(s.status).toBe('playing');
  });

  it('the exhaust Virtue action (exhaustHopeActive) follows the type actually exhausted', () => {
    const s = track();
    runFx(s, ['exhaustHopeActive:1:apply'], { who: 0, src: 'card:L20B', card: 'L20B' } as any);
    drain(s);
    pick(s, ['care'], 'type');
    // substitution offered for the card-type Hope; the answer decides what is exhausted
    expect(s.pending?.kind).toBe('type');
    pick(s, ['justice'], 'type');
    expect(s.hope.find((t) => t.t === 'justice')!.a).toBe(false);
    expect(s.hope.find((t) => t.t === 'care')!.a).toBe(true);
  });
});

describe('L20 swap with an active Hope token on the track (Law Consequence offer)', () => {
  it('swaps the card token with the chosen active track token; the card gets the track token', () => {
    const s = blankState();
    s.laws.push(law20('care') as any);
    s.hopeBag = { care: 0, justice: 0, motivation: 0 };
    s.hope = [
      { t: 'justice', a: true },
      { t: 'motivation', a: false },
    ];
    runFx(s, ['virtueSwapOffer'], { who: 0, src: 'card:L20A', card: 'L20A' } as any);
    drain(s);
    expect(s.pending?.kind).toBe('choice');
    expect(optionIds(s).sort()).toEqual(['justice', 'none']);
    pick(s, ['justice'], 'choice');
    expect(s.hope).toEqual([
      { t: 'care', a: true },
      { t: 'motivation', a: false },
    ]);
    expect((s.laws[0] as any).hopeTok).toBe('justice');
  });

  it('declining the swap changes nothing', () => {
    const s = blankState();
    s.laws.push(law20('care') as any);
    s.hope = [{ t: 'justice', a: true }];
    runFx(s, ['virtueSwapOffer'], { who: 0, src: 'card:L20B', card: 'L20B' } as any);
    drain(s);
    pick(s, ['none'], 'choice');
    expect(s.hope).toEqual([{ t: 'justice', a: true }]);
    expect((s.laws[0] as any).hopeTok).toBe('care');
  });

  it('no offer without an active Hope token on the track', () => {
    const s = blankState();
    s.laws.push(law20('care') as any);
    s.hope = [{ t: 'justice', a: false }];
    runFx(s, ['virtueSwapOffer'], { who: 0, src: 'card:L20A', card: 'L20A' } as any);
    drain(s);
    expect(s.pending).toBeNull();
  });

  it('L20A and L20B both carry the swap offer after their own effects', () => {
    const cons = raw('law_consequences.json');
    for (const id of ['L20A', 'L20B']) {
      const c = cons.find((x: any) => x.id === id);
      expect(c.top[c.top.length - 1]).toBe('virtueSwapOffer');
      expect(c.swapVirtueHope).toBe(true);
    }
  });
});

describe('L18 Shared Knowledge: Generator use comes only from the covering L18A card', () => {
  it('the uncovered Law grants Workshops but not the Generator', () => {
    const s = blankState();
    s.laws = [{ id: 'L18', covered: null }] as any;
    expect(hasPassive(s, 'workersUseWorkshops')).toBe(true);
    expect(hasPassive(s, 'workersUseGenerator')).toBe(false);
  });

  it('the covering L18A card grants the Generator as well', () => {
    const s = blankState();
    s.laws = [{ id: 'L18', covered: 'L18A' }] as any;
    expect(hasPassive(s, 'workersUseGenerator')).toBe(true);
    expect(hasPassive(s, 'workersUseWorkshops')).toBe(true);
  });

  it('laws.json L18 permission matches the printed Law card (no Generator)', () => {
    const l18 = (raw('laws.json') as any).laws.find((x: any) => x.id === 'L18') as any;
    const perm: string[] = l18.perm.action;
    expect(perm).toContain('workersMayUseWorkshops');
    expect(perm.some((p) => p.startsWith('workersUseGenerator') || p.includes('Generator'))).toBe(false);
  });
});

describe('buildOnIntro is wired (wave 6)', () => {
  it('laws.ts reads buildOnIntro and offers the optional build at law introduction (see audit6_laws.test.ts)', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/laws.ts', import.meta.url)), 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).toMatch(/buildOnIntro/);
  });
});
