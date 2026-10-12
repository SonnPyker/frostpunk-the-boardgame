// Regression: building the first (non-printed) Workshop must start a Technology choice (ACT-CO5, spec 3.4).
// The hook used to look up the non-existent op 'techStart' (the real op is 'techStartCheck'), so no tech was ever offered.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run } from '../src/core';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import { placeBuilding } from '../src/buildings';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

function setup(): GameState {
  const s = blankState();
  s.gen.heat = 0;
  s.techs = [
    { id: 'T01', state: 'inactive', dueRound: null },
    { id: 'T08', state: 'inactive', dueRound: null },
  ];
  placeTileAt(s, 'N01', 1, 0, 'near');
  return s;
}

describe('first Workshop starts a Technology', () => {
  it('asks a tech decision after the first Workshop is built', () => {
    const s = setup();
    expect(placeBuilding(s, 'workshop', 'N01:top')).not.toBeNull();
    drain(s);
    expect(s.pending?.kind).toBe('tech');
  });

  it('does not ask for a printed Workshop', () => {
    const s = setup();
    expect(placeBuilding(s, 'workshop', 'N01:top', { printed: true })).not.toBeNull();
    drain(s);
    expect(s.pending).toBeNull();
  });
});
