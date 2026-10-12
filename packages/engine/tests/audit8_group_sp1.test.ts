// Audit 8, ACT-SP1: Scenario/Event special-action cards. Rulebook p27 (Special Actions): a Meeple placed on the card
// is returned to the supply in the Night Phase, but Resources placed on the card remain. Once per Round for most,
// once per game where the card says so (Event card eventAction.freq "game", e.g. M010 Another Settlement).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions';
import '../src/generator';
import '../src/sickness';
import '../src/tech';
import '../src/cards';
import '../src/expedition';
import '../src/phases';
import '../src/night';
import { push, pushSeq, run } from '../src/core';
import { answer } from '../src/setup';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import { newMeeple } from '../src/util';
import { placeBuilding } from '../src/buildings';
import { placeEvent } from '../src/cards';
import { actionMenuFor } from '../src/actions';
import { nightBody } from '../src/night';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** Use the special action of event card `card` with the given Meeple, through the real actSpecial op. */
function useEventAction(s: GameState, card: string, who: number, meepleId: number) {
  const ev = s.events.find((e) => e.card === card)!;
  push(s, { k: 'actSpecial', who, key: `ev${ev.uid}`, meeple: meepleId } as any);
  drain(s);
  if (s.pending) answer(s, s.pending.who, s.pending.id, [s.pending.options[0].id]);
  drain(s);
  return ev;
}

function specialItem(s: GameState, card: string) {
  const ev = s.events.find((e) => e.card === card)!;
  return actionMenuFor(s, 0).find((m) => m.id === `act:special:ev${ev.uid}`);
}

describe('ACT-SP1 Night: Meeples on a special-action card return to the supply; Resources stay on the card', () => {
  it('a Meeple placed on M004 returns at Night, and the Resources on the card are untouched', () => {
    const s = blankState();
    s.round = 3;
    placeTileAt(s, 'N01', 1, 0, 'near');
    const ev = placeEvent(s, 'M004');
    ev.res = { coal: 2 } as any;
    const w = newMeeple(s, 'worker');
    useEventAction(s, 'M004', 0, w.id);
    expect(w.loc.k).toBe('card');
    expect(ev.meeples).toContain(w.id);

    pushSeq(s, ...nightBody(s).slice(0, -1));
    drain(s);
    if (s.pending) answer(s, s.pending.who, s.pending.id, [s.pending.options[0].id]);
    drain(s);
    expect(w.loc.k).toBe('supply');
    expect(ev.meeples).toEqual([]);
    expect((ev.res as any).coal).toBe(2);
  });
});

describe('ACT-SP1 usedEver: once-per-game event actions (M010, freq "game")', () => {
  it('a successful use sets usedEver, the menu item is then disabled, and a second use adds no Meeple', () => {
    const s = blankState();
    s.round = 3;
    placeTileAt(s, 'N01', 1, 0, 'near');
    placeBuilding(s, 'beacon', 'N01:top', { printed: false });
    const ev = placeEvent(s, 'M010');
    const w1 = newMeeple(s, 'worker');
    const w2 = newMeeple(s, 'worker');
    s.food = 50;
    s.res.wood = 50;
    useEventAction(s, 'M010', 0, w1.id);
    expect(ev.usedEver).toBe(true);
    expect(ev.meeples).toEqual([w1.id]);

    // next Round: the once-per-Round flag resets, the once-per-game flag does not
    ev.usedThisRound = false;
    const item = specialItem(s, 'M010');
    expect(item?.disabled).toBe('Already used');
    useEventAction(s, 'M010', 0, w2.id);
    expect(ev.meeples).toEqual([w1.id]);
    expect(w2.loc.k).not.toBe('card');
  });

  it('the Beacon is needed: without it the card is not usable (needs: beacon)', () => {
    const s = blankState();
    s.round = 3;
    placeTileAt(s, 'N01', 1, 0, 'near');
    placeEvent(s, 'M010');
    newMeeple(s, 'worker');
    const item = specialItem(s, 'M010');
    expect(item?.disabled).toBe('Needs the Beacon');
  });
});

describe('ACT-SP1 once per Round: an M004 action is blocked until the Round resets', () => {
  it('a second use in the same Round is refused, and allowed again after the Round flag resets', () => {
    const s = blankState();
    s.round = 3;
    placeTileAt(s, 'N01', 1, 0, 'near');
    const ev = placeEvent(s, 'M004');
    const w1 = newMeeple(s, 'worker');
    const w2 = newMeeple(s, 'worker');
    useEventAction(s, 'M004', 0, w1.id);
    expect(ev.usedThisRound).toBe(true);
    expect(ev.usedEver).toBe(true);
    expect(specialItem(s, 'M004')?.disabled).toBe('Already used this Round');
    useEventAction(s, 'M004', 0, w2.id);
    expect(ev.meeples).toEqual([w1.id]);
    ev.usedThisRound = false;
    expect(specialItem(s, 'M004')?.disabled).not.toBe('Already used this Round');
  });
});
