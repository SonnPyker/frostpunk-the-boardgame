// Audit 8 (SCN-02 / FG1): Remove Snow under Frozen Grove.
// Scenario Book, Frozen Grove, Action phase: an Action (Remove Snow, Gather, Construct, Use a Building) may be performed only
// on a Map tile that is adjacent to the Generator tile or connected to it through other Map tiles. Remove Snow places tiles,
// so the rule is enforced through where a tile may be placed: Near tiles next to the Generator, Far tiles next to a
// connected tile (map.ts farSlots / nearSlots). These tests pin that behaviour for the Remove Snow action.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions';
import '../src/buildings';
import '../src/generator';
import '../src/sickness';
import '../src/tech';
import '../src/cards';
import '../src/expedition';
import '../src/phases';
import '../src/night';
import '../src/scenario';
import { answerPending, push, run } from '../src/core';
import { farSlots, nearSlots, placeTileAt } from '../src/map';
import { initTileStacks, removeSnowAction } from '../src/tiles';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** Frozen Grove: connected Near tile N01 at hex (2,0), unconnected Far tile F01 at hex (4,0). */
function frozenWorld(): GameState {
  const s = blankState({ scenario: 'frozenGrove' });
  s.gen.heat = 3;
  s.gen.cold = 5;
  initTileStacks(s);
  placeTileAt(s, 'N01', 2, 0, 'near');
  placeTileAt(s, 'F01', 4, 0, 'far');
  return s;
}

const key = (q: number, r: number) => `${q},${r}`;

describe('SCN-02 / FG1: Remove Snow places tiles only next to the Generator or a connected tile', () => {
  it('Far tile slots never include a hex that touches only the unconnected tile F01', () => {
    const s = frozenWorld();
    const far = farSlots(s).map(([q, r]) => key(q, r));
    expect(far.length).toBeGreaterThan(0);
    // (5,0) and (5,-1) touch F01 (4,0) only; F01 is not connected to the Generator
    expect(far).not.toContain(key(5, 0));
    expect(far).not.toContain(key(5, -1));
  });

  it('Far tile slots include a hex next to the connected tile N01 (2,0)', () => {
    const s = frozenWorld();
    const far = farSlots(s).map(([q, r]) => key(q, r));
    const nearN01 = [key(3, 0), key(3, -1), key(2, 1), key(2, -1)];
    expect(far.some((k) => nearN01.includes(k))).toBe(true);
  });

  it('Near tile slots are all adjacent to the Generator flower, never out at the unconnected tile F01', () => {
    const s = frozenWorld();
    const near = nearSlots(s).map(([q, r]) => key(q, r));
    expect(near.length).toBeGreaterThan(0);
    expect(near).not.toContain(key(5, 0));
  });

  it('the Remove Snow "two Far tiles" variant asks for a Far tile space that is connected', () => {
    const s = frozenWorld();
    push(s, { k: 'tilRemoveSnow', who: 0, meeple: null, variant: 'twoFar', src: 'test' } as any);
    drain(s);
    const p: any = s.pending;
    expect(p?.kind).toBe('tileSlot');
    const ids = (p.options as any[]).map((o) => o.id);
    expect(ids).not.toContain(key(5, 0));
    expect(ids.length).toBeGreaterThan(0);
  });

  it('the normal Remove Snow choice "one Far tile" leads to the same connected-only Far slots', () => {
    const s = frozenWorld();
    removeSnowAction(s, 0, null, 'normal', 'test');
    drain(s);
    expect(s.pending?.kind).toBe('removeSnow');
    answerPending(s, s.leader, s.pending!.id, ['far1']);
    drain(s);
    const p: any = s.pending;
    expect(p?.kind).toBe('tileSlot');
    expect((p.options as any[]).map((o) => o.id)).not.toContain(key(5, 0));
  });
});
