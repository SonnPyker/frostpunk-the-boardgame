// Audit batch 6 (cards-and-expeditions): regression tests.
// - D073 / D021 'mostCommonDisc' branch: a tie resolves by the printed card text, and the player is asked only
//   between branches the card allows (Anger -> 1, Greed -> 2, otherwise -> 3).
// - X29 (a C expedition) cannot be skipped: its arrival auto-resolves to Explore and Skip is never offered.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run } from '../src/core';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import { initExpDecks, placeExpedition, setupExpeditions, expCardDef } from '../src/expedition';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/**
 * Runs the stack, ignoring errors thrown by the chosen option's effects: these tests only check the routing decision,
 * which cardOptRun logs (card.opt) before running any effect, and blankState has no citizens for the effects to act on.
 */
function drainBranch(s: GameState) {
  try {
    run(s);
  } catch {
    /* option effect needs a fuller board; the routing is already logged */
  }
}

/** Plays a branch card's option selection with the given active Discontent tokens (ASK-free when the card decides). */
function playBranch(id: string, discs: Array<'anger' | 'apathy' | 'greed'>) {
  const s = blankState();
  s.disc = discs.map((t) => ({ t, a: true }));
  s.flags.cur = { id, fate: null } as any;
  s.stack.push({ k: 'cardOpts', card: id });
  drainBranch(s);
  return s;
}

/** The option index chosen by cardOptRun, read from its card.opt log entry. */
function chosenIdx(s: GameState): number | undefined {
  const entry = s.log.find((l: any) => l.t === 'card.opt') as any;
  return entry?.d?.idx;
}

describe('D073 Riot: tie resolution follows the printed card text', () => {
  it('a tie of Anger and Apathy goes to option 1 without asking (the card names Anger)', () => {
    const s = playBranch('D073', ['anger', 'apathy']);
    expect(s.pending).toBeNull();
    expect(chosenIdx(s)).toBe(0);
  });

  it('a tie of Greed and Apathy goes to option 2 without asking', () => {
    const s = playBranch('D073', ['greed', 'apathy']);
    expect(s.pending).toBeNull();
    expect(chosenIdx(s)).toBe(1);
  });

  it('a tie of Anger and Greed asks only between Anger and Greed (both are allowed by the card)', () => {
    const s = playBranch('D073', ['anger', 'greed']);
    expect(s.pending?.kind).toBe('type');
    expect(s.pending!.options.map((o) => o.id).sort()).toEqual(['anger', 'greed']);
    // the player picks Greed: branch 2
    const p = s.pending!;
    s.pending = null;
    s.stack.push({ ...p.then, pick: ['greed'] } as any);
    drainBranch(s);
    expect(chosenIdx(s)).toBe(1);
  });

  it('a single most common Anger still goes straight to option 1 (unchanged)', () => {
    const s = playBranch('D073', ['anger']);
    expect(s.pending).toBeNull();
    expect(chosenIdx(s)).toBe(0);
  });
});

describe('D021 Have the Refugees Assimilated?: same tie rule as D073', () => {
  it('a tie of Anger and Apathy goes to option 1 without asking, so Apathy cannot route to option 3', () => {
    const s = playBranch('D021', ['anger', 'apathy']);
    expect(s.pending).toBeNull();
    expect(chosenIdx(s)).toBe(0);
  });
});

describe('C expedition cannot be skipped', () => {
  it('an arriving C expedition auto-resolves to Explore: Skip is not offered', () => {
    const s = blankState();
    // a worker in the supply and a stack holding a C card (X29 is the first C card)
    s.meeples.push({ id: 1, kind: 'worker', loc: { k: 'supply' } } as any);
    initExpDecks(s);
    setupExpeditions(s);
    placeExpedition(s, 'X29');
    const e = s.expeditions[s.expeditions.length - 1];
    expect(expCardDef('X29').letter).toBe('C');
    e.scout = { meeple: 1, pos: 1 } as any; // the Scout must be on the stack for the arrival choice
    s.stack.push({ k: 'expArriveChoice', uid: e.uid, left: 0 } as any);
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.log.some((l: any) => l.t === 'exp.skip')).toBe(false);
    expect(s.log.some((l: any) => l.t === 'exp.explore')).toBe(true);
  });
});
