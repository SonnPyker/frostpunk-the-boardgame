// Audit 4: SD04 Mistrust, Justice side (card text): "Introduce a new Law. If you already have 4 Laws, exhaust all Discontent."
// The branch is decided by the Law count at resolve time. No choice between the two effects is offered.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run } from '../src/core';
import { runFx } from '../src/fx/core';
import { blankState } from '../src/testing';
import { LAW_MAX, lawCandidates } from '../src/laws';
import type { GameState } from '../src/types';

// Pending decisions and stack-empty are both normal in isolation: drain the stack without failing on an empty one.
function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}
function justice(s: GameState) {
  runFx(s, ['introduceLawOrExhaustDisc'], { who: 0, src: 'card:SD04' });
  drain(s);
}
const lawsOf = (ids: string[]) => ids.map((id) => ({ id, covered: null }));
const FOUR_LAWS = lawsOf(['L05', 'L07', 'L15', 'L16']);
const THREE_LAWS = lawsOf(['L05', 'L07', 'L15']);

describe('SD04 Mistrust, justice side', () => {
  it('LAW_MAX is 4 (the card threshold)', () => {
    expect(LAW_MAX).toBe(4);
  });

  it('with fewer than 4 Laws it introduces a Law: a Law pick is offered directly, not an effect choice', () => {
    const s = blankState();
    s.futureLaws = ['L03', 'L04'];
    s.laws = lawsOf(['L05']);
    s.disc = [{ t: 'anger', a: true }];
    justice(s);
    expect(s.pending?.kind).toBe('law');
    expect(s.pending?.kind).not.toBe('choice');
    // Discontent is untouched while a Law is introduced
    expect(s.disc.every((t) => t.a)).toBe(true);
  });

  it('with 3 Laws the Law is introduced when the player picks one, and Discontent is not exhausted', () => {
    const s = blankState();
    s.futureLaws = ['L03', 'L04'];
    s.laws = lawsOf(['L05', 'L07', 'L15']);
    s.disc = [
      { t: 'anger', a: true },
      { t: 'apathy', a: true },
    ];
    justice(s);
    expect(s.pending?.kind).toBe('law');
    const p = s.pending!;
    s.pending = null;
    s.stack.push({ ...p.then, pick: ['L03'] });
    drain(s);
    expect(s.laws.map((l) => l.id)).toContain('L03');
    expect(s.laws).toHaveLength(LAW_MAX);
    expect(s.disc.every((t) => t.a)).toBe(true);
  });

  it('with fewer than 4 Laws and no Law available, nothing happens (no prompt, no Discontent exhausted)', () => {
    const s = blankState();
    s.futureLaws = [];
    s.laws = lawsOf(['L05']);
    s.disc = [{ t: 'anger', a: true }];
    justice(s);
    expect(s.pending).toBeFalsy();
    expect(s.disc[0].a).toBe(true);
    expect(s.laws).toHaveLength(1);
  });

  it('with 4 Laws it exhausts ALL active Discontent (several types), with no prompt', () => {
    const s = blankState();
    s.futureLaws = ['L03', 'L04'];
    s.laws = FOUR_LAWS;
    s.disc = [
      { t: 'anger', a: true },
      { t: 'apathy', a: true },
      { t: 'greed', a: false },
      { t: 'anger', a: true },
    ];
    justice(s);
    expect(s.pending).toBeFalsy();
    expect(s.disc.filter((t) => t.a)).toHaveLength(0);
    // the already-exhausted token stays exhausted, and no Law is introduced
    expect(s.disc.map((t) => t.t)).toEqual(['anger', 'apathy', 'greed', 'anger']);
    expect(s.laws).toHaveLength(LAW_MAX);
  });

  it('with 4 Laws and exactly one active Discontent it exhausts that one token', () => {
    const s = blankState();
    s.laws = FOUR_LAWS;
    s.disc = [{ t: 'greed', a: true }];
    justice(s);
    expect(s.pending).toBeFalsy();
    expect(s.disc[0].a).toBe(false);
  });

  it('with 4 Laws and no active Discontent it does nothing and does not prompt', () => {
    const s = blankState();
    s.laws = FOUR_LAWS;
    s.disc = [{ t: 'anger', a: false }];
    justice(s);
    expect(s.pending).toBeFalsy();
    expect(s.disc[0].a).toBe(false);
    expect(s.laws).toHaveLength(LAW_MAX);
  });

  it('the Law count is read at resolve time: 3 Laws goes to the introduce branch, 4 goes to exhaust', () => {
    const three = blankState();
    three.futureLaws = ['L03', 'L04'];
    three.laws = THREE_LAWS;
    three.disc = [{ t: 'anger', a: true }];
    justice(three);
    expect(three.pending?.kind).toBe('law');
    expect(three.disc[0].a).toBe(true);
    expect(lawCandidates(three).length).toBeGreaterThan(0);
  });
});
