// Audit 5 (fixer "cards"): Dusk D043 A Tripod! (the Automaton lies ON THE TILE, both spaces blocked, Repair / Salvage
// free the spaces) and D053 What About the Toys? (Child Meeples = every Child-type meeple you have).
import { describe, expect, it } from 'vitest';
import '../src/fx';
import { eventOf, placeEvent } from '../src/cards';
import { answerPending, push, run } from '../src/core';
import { runFx } from '../src/fx/core';
import { blankState } from '../src/testing';
import type { GameState, Meeple, MeepleKind, MapTile } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e) {
    if (!/stack ran dry/.test(String((e as Error).message))) throw e;
  }
}

function meeple(s: GameState, kind: MeepleKind, loc: Meeple['loc']): Meeple {
  const m = { id: ++s.nextMeeple, kind, loc } as Meeple;
  s.meeples.push(m);
  return m;
}

const far = (key: string, spaces: string[]): MapTile => ({ key, id: 'F' + key, kind: 'far', q: 0, r: 0, spaces, food: 0 }) as MapTile;
const ctxD043 = { who: 0, src: 'card:D043', card: 'D043' };

/** Put the Tripod on a Far tile through the card's own step (the top list runs cusD043Tile after the tile is chosen). */
function tripod(s: GameState, tile: MapTile) {
  s.tiles = [tile];
  push(s, { k: 'cusD043Tile', who: 0, pick: [tile.key] });
  drain(s);
}

describe('D043 A Tripod!: the Automaton is laid on the tile, not on the Event card', () => {
  it('the Automaton sits on the tile (first space), both spaces are blocked, and the card holds no Automaton', () => {
    const s = blankState();
    tripod(s, far('0,0', ['far:1', 'far:2']));
    const ev = eventOf(s, 'D043');
    expect(ev).toBeDefined();
    expect(ev!.meeples).toEqual([]);
    const autos = s.meeples.filter((m) => m.kind === 'automaton');
    expect(autos).toHaveLength(1);
    expect(autos[0].loc).toEqual({ k: 'space', space: 'far:1' });
    expect(s.scenarioState.blocked).toEqual(['far:1', 'far:2']);
    expect(ev!.extra?.tile).toBe('0,0');
  });

  it('a Far tile already covered by an Automaton is not offered again', () => {
    const s = blankState();
    s.tiles = [far('0,0', ['far:1', 'far:2']), far('1,0', ['far:3', 'far:4']), far('2,0', ['far:5', 'far:6'])];
    s.scenarioState.blocked = ['far:1', 'far:2'];
    runFx(s, ['custom:D043'], ctxD043);
    drain(s);
    expect(s.pending).toBeTruthy();
    expect(s.pending!.options.map((o) => o.id)).toEqual(['1,0', '2,0']);
  });

  it('with the bank empty, an Automaton from the supply is laid on the tile', () => {
    const s = blankState();
    for (let i = 1; i <= 5; i++) meeple(s, 'automaton', { k: 'space', space: 'x:' + i });
    const fromSupply = meeple(s, 'automaton', { k: 'supply' });
    tripod(s, far('0,0', ['far:1', 'far:2']));
    expect(fromSupply.loc).toEqual({ k: 'space', space: 'far:1' });
    expect(s.meeples.filter((m) => m.kind === 'automaton')).toHaveLength(6);
  });

  it('Repair: spend 1 Steam Core, the Automaton goes to the supply, the spaces are freed and the card leaves the display', () => {
    const s = blankState();
    tripod(s, far('0,0', ['far:1', 'far:2']));
    const auto = s.meeples.find((m) => m.kind === 'automaton')!;
    s.res.core = 1;
    push(s, { k: 'cusD043Act', who: 0, pick: ['repair'] });
    drain(s);
    expect(s.res.core).toBe(0);
    expect(auto.loc).toEqual({ k: 'supply' });
    expect(s.scenarioState.blocked).toEqual([]);
    expect(eventOf(s, 'D043')).toBeUndefined();
  });

  it('Salvage: gain 1 Steam Core, the Automaton goes to the bank (removed), the spaces are freed, the card leaves', () => {
    const s = blankState();
    tripod(s, far('0,0', ['far:1', 'far:2']));
    const other = meeple(s, 'automaton', { k: 'space', space: 'b:1' });
    s.res.core = 0;
    push(s, { k: 'cusD043Act', who: 0, pick: ['salvage'] });
    drain(s);
    expect(s.res.core).toBe(1);
    expect(s.meeples.filter((m) => m.kind === 'automaton')).toEqual([other]);
    expect(s.scenarioState.blocked).toEqual([]);
    expect(eventOf(s, 'D043')).toBeUndefined();
  });

  it('the Engineer that took the event action goes back to the supply with the card', () => {
    const s = blankState();
    tripod(s, far('0,0', ['far:1', 'far:2']));
    const ev = eventOf(s, 'D043')!;
    const eng = meeple(s, 'engineer', { k: 'card', card: 'D043' });
    ev.meeples.push(eng.id);
    s.res.core = 1;
    push(s, { k: 'cusD043Act', who: 0, pick: ['repair'] });
    drain(s);
    expect(eng.loc).toEqual({ k: 'supply' });
  });

  it('the event action asks Repair or Salvage when the card is on the display and Repair is possible', () => {
    const s = blankState();
    tripod(s, far('0,0', ['far:1', 'far:2']));
    s.res.core = 1;
    runFx(s, ['custom:D043'], ctxD043);
    drain(s);
    expect(s.pending).toBeTruthy();
    const ids = s.pending!.options.map((o) => o.id);
    expect(ids).toEqual(['repair', 'salvage']);
    expect(s.pending!.options.find((o) => o.id === 'repair')?.disabled).toBeFalsy();
  });

  it('with no Steam Core, Repair is disabled, so Salvage is the only choice and is taken: core 1, card leaves', () => {
    const s = blankState();
    tripod(s, far('0,0', ['far:1', 'far:2']));
    s.res.core = 0;
    runFx(s, ['custom:D043'], ctxD043);
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.res.core).toBe(1);
    expect(eventOf(s, 'D043')).toBeUndefined();
  });
});

describe('D053 What About the Toys?: Child Meeples = every Child-type meeple you have', () => {
  /** Run option 2 with M029 holding `wood` Wood; answer each +1 Hope draw; return the number of Hope tokens gained. */
  const toys = (wood: number, setup: (s: GameState) => void) => {
    const s = blankState();
    const ev = placeEvent(s, 'M029');
    ev.res.wood = wood;
    setup(s);
    s.hopeBag = { care: 3, justice: 3, motivation: 3 };
    s.hope = [];
    runFx(s, ['custom:D053'], { who: 0, src: 'card:D053' });
    drain(s);
    for (let i = 0; i < 5 && s.pending; i++) {
      try {
        answerPending(s, 0, s.pending.id, ['draw']);
      } catch (e) {
        if (!/stack ran dry/.test(String((e as Error).message))) throw e;
      }
      drain(s);
    }
    return s.hope.length;
  };

  it('four Child-type meeples in four places (supply, board, a card, a Scout) and Wood 4: +2 Hope', () => {
    const n = toys(4, (s) => {
      meeple(s, 'child', { k: 'supply' });
      meeple(s, 'child', { k: 'space', space: 'farm:1' });
      meeple(s, 'childWorker', { k: 'card', card: 'M016' });
      meeple(s, 'child', { k: 'scout' });
    });
    expect(n).toBe(2);
  });

  it('the same four with Wood 3 is not "as much": +1 Hope', () => {
    const n = toys(3, (s) => {
      meeple(s, 'child', { k: 'supply' });
      meeple(s, 'child', { k: 'space', space: 'farm:1' });
      meeple(s, 'childWorker', { k: 'card', card: 'M016' });
      meeple(s, 'child', { k: 'scout' });
    });
    expect(n).toBe(1);
  });

  it('a Child Engineer counts as a Child: Wood 1 against one Child Engineer is equal, +2 Hope', () => {
    const n = toys(1, (s) => {
      meeple(s, 'childEngineer', { k: 'supply' });
    });
    expect(n).toBe(2);
  });

  it('Automatons are not Child Meeples: Wood 1 against one Child and one Automaton is equal, +2 Hope', () => {
    const n = toys(1, (s) => {
      meeple(s, 'child', { k: 'supply' });
      meeple(s, 'automaton', { k: 'supply' });
    });
    expect(n).toBe(2);
  });
});
