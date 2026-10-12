// Repair pass (audit 5 wave-5 review): card regressions that the existing suites did not reach.
//  1. D043 A Tripod!: the Automaton's two spaces are blocked for Buildings (spaceFreeFor, scenarioState.blocked).
//  2. D032 Explosion of the Distillery: destroying the last Workshop returns the Technology in development (removeBuilding).
//  3. D030 Successful Project, option A: buildFree:hothouse builds only a Hothouse (buildFilterOk).
//  4. D043 event action: an Engineer on an unheated Automaton tile takes the cold ill effect (applyCold, actSpecial).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { placeEvent, eventOf } from '../src/cards';
import { push, run } from '../src/core';
import { runFx } from '../src/fx/core';
import { answer } from '../src/setup';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import { placeBuilding } from '../src/buildings';
import { newMeeple } from '../src/util';
import type { GameState, MapTile } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** Adds a Far tile with its two spaces (the shape setup.ts gives a placed tile). */
function addFarTile(s: GameState, key: string, spaces: string[], q: number): MapTile {
  const tile = { key, id: 'F' + key, kind: 'far', q, r: 0, spaces, food: 0 } as MapTile;
  s.tiles.push(tile);
  for (const sid of spaces) s.spaces[sid] = { id: sid, tile: key, slot: 'top', res: {}, trees: 0, building: null } as any;
  return tile;
}

// ---------------------------------------------------------------------------------------------------------
// 1. D043: no Building on the Automaton's spaces
// ---------------------------------------------------------------------------------------------------------

describe('D043 A Tripod!: the Automaton blocks its tile for Buildings', () => {
  it('a Building can be placed on a free Far space, but not on a space the Automaton blocks', () => {
    const s = blankState();
    addFarTile(s, '0,0', ['far:1', 'far:2'], 0);
    addFarTile(s, '1,0', ['far:3', 'far:4'], 1);
    push(s, { k: 'cusD043Tile', who: 0, pick: ['0,0'] });
    drain(s);
    expect(s.scenarioState.blocked).toEqual(['far:1', 'far:2']);
    expect(placeBuilding(s, 'huntersHut', 'far:2')).toBeNull();
    expect(placeBuilding(s, 'huntersHut', 'far:3')).not.toBeNull(); // control: the free tile takes the Building
  });
});

// ---------------------------------------------------------------------------------------------------------
// 2. D032: the last Workshop destroyed while a Technology is in development
// ---------------------------------------------------------------------------------------------------------

describe('D032 Explosion of the Distillery: destroying the last Workshop stops the Technology in development', () => {
  it('an Engineer on the Workshop: the card destroys it, the Technology returns to inactive and is no longer in progress', () => {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    const workshop = placeBuilding(s, 'workshop', 'N01:top');
    expect(workshop).not.toBeNull();
    s.techs.push({ id: 'T01', state: 'developing', dueRound: 3 } as any);
    s.techInProgress = 'T01';
    const eng = newMeeple(s, 'engineer');
    eng.loc = { k: 'space', space: 'N01:top' };
    s.cit.engineer = 2;

    // the Workshop is the only candidate, so the card's question resolves on its own (ask with one option)
    s.stack = [];
    runFx(s, ['custom:D032'], { who: 0, src: 'card:D032', card: 'D032' });
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.log.some((l) => l.t === 'bld.destroy')).toBe(true);
    expect(s.buildings.some((b) => b.kind === 'workshop')).toBe(false);
    expect(s.techs.find((t) => t.id === 'T01')!.state).toBe('inactive');
    expect(s.techs.find((t) => t.id === 'T01')!.dueRound).toBeNull();
    expect(s.techInProgress).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------
// 3. D030 option A: a free Hothouse, nothing else
// ---------------------------------------------------------------------------------------------------------

describe('D030 Successful Project, option A: buildFree:hothouse builds a Hothouse only', () => {
  it('the free build can only be a Hothouse (a Hunters Hut or Gathering Post is not offered or built)', () => {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    runFx(s, ['buildFree:hothouse'], { who: 0, src: 'card:D030', card: 'D030' });
    drain(s);
    for (let i = 0; i < 8 && s.pending; i++) {
      const p = s.pending;
      const first = p.options.find((o: any) => !o.disabled) ?? p.options[0];
      expect(answer(s, p.who, p.id, [first.id]).ok).toBe(true);
      drain(s);
    }
    expect(s.buildings.length).toBeGreaterThan(0);
    expect(s.buildings.every((b) => b.kind === 'hothouse')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 4. D043 event action on an unheated Automaton tile: the Engineer takes the cold ill effect
// ---------------------------------------------------------------------------------------------------------

describe('D043 event action: heating of the Automaton tile decides the cold ill effect', () => {
  function engineerOnTripod(withKitchen: boolean) {
    const s = blankState();
    addFarTile(s, '0,0', ['far:1', 'far:2'], 0);
    if (withKitchen) {
      const b = placeBuilding(s, 'fieldKitchen', 'far:2');
      expect(b).not.toBeNull(); // control: the Field Kitchen heats the tile
    }
    const ev = placeEvent(s, 'D043');
    ev.extra = { tile: '0,0' };
    s.cit.engineer = 2;
    const eng = newMeeple(s, 'engineer');
    s.stack = [];
    push(s, { k: 'actSpecial', who: 0, meeple: eng.id, key: `ev${ev.uid}` });
    drain(s);
    return s;
  }

  it('unheated tile: the Engineer makes a cold action, one Engineer becomes sick', () => {
    const s = engineerOnTripod(false);
    expect(s.log.some((l) => l.t === 'act.cold')).toBe(true);
    expect(s.sick.engineer.n).toBe(1);
  });

  it('heated tile (Field Kitchen on it): no cold action, nobody becomes sick', () => {
    const s = engineerOnTripod(true);
    expect(s.log.some((l) => l.t === 'act.cold')).toBe(false);
    expect(s.sick.engineer.n).toBe(0);
    // no Steam Core: Salvage is the only option and is taken, so the card leaves and the Steam Core comes in
    expect(s.res.core).toBe(1);
    expect(eventOf(s, 'D043')).toBeUndefined();
  });
});
