// Audit 7 fix ACT-CO3: a Beacon (red Dismantle icon, noDismantle) cannot be destroyed either.
// Rulebook p26: "Buildings with a Red Dismantle icon cannot be dismantled or destroyed in any way."
// Dusk destroy text: "You may not choose to destroy a Building with the Red Dismantle icon."
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run } from '../src/core';
import { answer } from '../src/setup';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import { newMeeple } from '../src/util';
import { placeBuilding, queueDestroy } from '../src/buildings';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** A solo state with two Near tiles: N01 for the Beacon (Large, both spaces), N02 for a Small building. */
function world(): GameState {
  const s = blankState();
  placeTileAt(s, 'N01', 1, 0, 'near');
  placeTileAt(s, 'N02', 2, 0, 'near');
  return s;
}

describe('ACT-CO3 fix: destroy never offers or removes a Beacon', () => {
  it('a Beacon alone is not a candidate: nothing is asked and the Beacon stays', () => {
    const s = world();
    const beacon = placeBuilding(s, 'beacon', 'N01:top')!;
    expect(beacon).not.toBeNull();
    queueDestroy(s, 0, 'choose', 1);
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.buildings.some((b) => b.uid === beacon.uid)).toBe(true);
  });

  it('with a Beacon and another building, only the other building is a candidate', () => {
    const s = world();
    const beacon = placeBuilding(s, 'beacon', 'N01:top')!;
    const kiln = placeBuilding(s, 'charcoalKiln', 'N02:top')!;
    expect(kiln).not.toBeNull();
    queueDestroy(s, 0, 'choose', 1);
    drain(s);
    const ids = (s.pending?.options ?? []).map((o: any) => String(o.id));
    expect(ids).not.toContain(String(beacon.uid));
    if (s.pending) answer(s, s.pending.who, s.pending.id, [String(kiln.uid)]);
    drain(s);
    expect(s.buildings.some((b) => b.uid === kiln.uid)).toBe(false);
    expect(s.buildings.some((b) => b.uid === beacon.uid)).toBe(true);
  });

  it('a Beacon is not a candidate even in the occupied-only destroy mode', () => {
    const s = world();
    const beacon = placeBuilding(s, 'beacon', 'N01:top')!;
    const worker = newMeeple(s, 'worker');
    worker.loc = { k: 'space', id: 'N01:top' } as any;
    queueDestroy(s, 0, 'occupied', 1);
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.buildings.some((b) => b.uid === beacon.uid)).toBe(true);
  });
});
