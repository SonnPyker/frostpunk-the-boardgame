// Audit 3 regressions: M028 'Double rations' Hunger counts only Worker/Engineer Meeples in the supply,
// and Dusk D012 'Otherwise' costs ceil(Hunger / 5) Hope (it used to gain Hope).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { answerPending, run } from '../src/core';
import { runFx } from '../src/fx/core';
import { blankState } from '../src/testing';
import { dusk, morning } from '../src/data';
import { activeTotal } from '../src/hope';
import type { GameState, Meeple, MeepleKind } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

// Each Hope decrease asks which token to exhaust (when there is a choice): answer by exhausting an active Care token.
function settleHope(s: GameState) {
  drain(s);
  for (let guard = 0; s.pending && guard < 20; guard++) {
    const p = s.pending;
    const pick = p.options.find((o) => o.id === 'exh:care') ?? p.options[0];
    let r: { ok: boolean; error?: string } = { ok: true };
    try {
      r = answerPending(s, p.who, p.id, [pick.id]);
    } catch (e: any) {
      // an isolated test has no phase driver under the card: an empty stack after the answer is expected
      if (!/stack ran dry/.test(String(e?.message))) throw e;
    }
    expect(r.ok, r.error).toBe(true);
  }
}

let nextId = 1;
function meeple(s: GameState, kind: MeepleKind, loc: Meeple['loc']) {
  const m: Meeple = { id: nextId++, kind, loc };
  s.meeples.push(m);
  return m;
}

describe('audit 3: M028 Hunger per Worker/Engineer Meeple in the supply (card: "for each Worker and Engineer Meeple in the supply")', () => {
  it('card M028 option 2 still uses the hungerPerMeeple token', () => {
    const card: any = morning.M028;
    expect(card.opts[1].fx).toContain('hungerPerMeeple:workerEngineer:1');
  });

  it('counts only Worker and Engineer Meeples whose location is the supply', () => {
    const s = blankState();
    meeple(s, 'worker', { k: 'supply' });
    meeple(s, 'engineer', { k: 'supply' });
    // not in the supply: on a building, on an Event card, on an expedition (scout), spent
    meeple(s, 'worker', { k: 'space', space: 'farm:1' });
    meeple(s, 'engineer', { k: 'card', card: 'M001' });
    meeple(s, 'worker', { k: 'scout' });
    meeple(s, 'worker', { k: 'spent' });
    // not Workers or Engineers at all
    meeple(s, 'child', { k: 'supply' });
    meeple(s, 'automaton', { k: 'supply' });
    s.hunger = 0;
    runFx(s, ['hungerPerMeeple:workerEngineer:1'], { who: 0, src: 'card:M028' });
    drain(s);
    expect(s.hunger).toBe(2);
  });

  it('a Worker that is only on a building does not add Hunger', () => {
    const s = blankState();
    meeple(s, 'worker', { k: 'space', space: 'farm:1' });
    s.hunger = 3;
    runFx(s, ['hungerPerMeeple:workerEngineer:1'], { who: 0, src: 'card:M028' });
    drain(s);
    expect(s.hunger).toBe(3);
  });

  it('per-meeple amount is applied to the supply count', () => {
    const s = blankState();
    meeple(s, 'worker', { k: 'supply' });
    meeple(s, 'worker', { k: 'supply' });
    meeple(s, 'engineer', { k: 'supply' });
    runFx(s, ['hungerPerMeeple:workerEngineer:2'], { who: 0, src: 'card:M028' });
    drain(s);
    expect(s.hunger).toBe(6);
  });
});

describe('audit 3: D012 Otherwise: for every 5 Hunger (rounded up), -1 Hope (it used to gain Hope via hopePerHunger:5)', () => {
  // Evaluate the card's top chain for a given Hunger value and return the effect tokens it selects.
  function leafTokens(list: any[], hunger: number): string[] {
    const out: string[] = [];
    for (const item of list) {
      if (typeof item === 'string') {
        out.push(item);
        continue;
      }
      let ok: boolean;
      const c: string = item.if;
      let m: RegExpExecArray | null;
      if ((m = /^hunger>=(\d+)$/.exec(c))) ok = hunger >= Number(m[1]);
      else if (c === 'hunger==0') ok = hunger === 0;
      else throw new Error('unexpected condition ' + c);
      const branch = ok ? item.then : item.else;
      if (branch) out.push(...leafTokens(branch, hunger));
    }
    return out;
  }

  it('the card no longer uses hopePerHunger (which gains Hope)', () => {
    const top = dusk.D012.top as any[];
    expect(JSON.stringify(top)).not.toContain('hopePerHunger');
  });

  it('Hunger 0 gives +1 Care, otherwise -ceil(Hunger/5) Hope, for every Hunger value 0..50', () => {
    const top = dusk.D012.top as any[];
    for (let h = 0; h <= 50; h++) {
      const toks = leafTokens(top, h).filter((t) => t !== 'remove');
      if (h === 0) {
        expect(toks, 'hunger 0').toEqual(['hope+1:care']);
      } else {
        expect(toks, `hunger ${h}`).toEqual([`hope-${Math.ceil(h / 5)}`]);
      }
    }
  });

  it('removes the card in both branches exactly once', () => {
    const top = dusk.D012.top as any[];
    for (const h of [0, 1, 7, 50]) {
      const toks = leafTokens(top, h);
      expect(toks.filter((t) => t === 'remove'), `hunger ${h}`).toHaveLength(1);
    }
  });

  it('with Hunger 1..5 it exhausts one active Hope (no Hope is gained)', () => {
    for (const h of [1, 5]) {
      const s = blankState();
      s.hope = [
        { t: 'care', a: true },
        { t: 'care', a: true },
        { t: 'care', a: true },
        { t: 'care', a: true },
        { t: 'care', a: true },
        { t: 'care', a: true },
      ];
      s.hunger = h;
      const before = activeTotal(s, 'hope');
      runFx(s, dusk.D012.top as any[], { who: 0, src: 'card:D012', card: 'D012' });
      settleHope(s);
      expect(activeTotal(s, 'hope'), `hunger ${h}`).toBe(before - 1);
      expect(s.hunger).toBe(h);
    }
  });

  it('with Hunger 6..10 it exhausts two active Hope', () => {
    for (const h of [6, 10]) {
      const s = blankState();
      s.hope = Array.from({ length: 6 }, () => ({ t: 'care' as const, a: true }));
      s.hunger = h;
      runFx(s, dusk.D012.top as any[], { who: 0, src: 'card:D012', card: 'D012' });
      settleHope(s);
      expect(activeTotal(s, 'hope'), `hunger ${h}`).toBe(4);
    }
  });

  it('with Hunger 0 it adds Care Hope and does not reduce Hope', () => {
    const s = blankState();
    s.hope = [{ t: 'care', a: true }];
    s.hopeBag.care = 2;
    s.hunger = 0;
    runFx(s, dusk.D012.top as any[], { who: 0, src: 'card:D012', card: 'D012' });
    settleHope(s);
    expect(activeTotal(s, 'hope')).toBeGreaterThan(1);
  });
});
