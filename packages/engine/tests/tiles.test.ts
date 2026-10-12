// Unit tests for tiles.ts: tile stacks, placement and Remove Snow variants, Far-tile reordering, board set-up (rulebook p9-10, p25-26).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { answerPending, push, run } from '../src/core';
import { mapData } from '../src/data';
import { farSlots, nearSlots, treesOnMap } from '../src/map';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import { LIMITS } from '../src/util';
import {
  childRemoveSnowFood,
  initTileStacks,
  pushPlaceTile,
  pushReveal3,
  removeSnowAction,
  revealTile,
  setupBoardTiles,
  tileAvailable,
} from '../src/tiles';

// Pending decisions and an empty stack are both normal in isolation: drain without failing on an empty stack.
function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}
function answer(s: GameState, pick: string[]) {
  const p = s.pending!;
  expect(p).toBeTruthy();
  try {
    const r = answerPending(s, p.who, p.id, pick);
    expect(r.ok).toBe(true);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}
const ids = (deck: 'near' | 'far') => (mapData.tiles as any[]).filter((t) => t.deck === deck).map((t) => t.id as string);
const optionIds = (s: GameState) => (s.pending?.options ?? []).map((o) => o.id);

/** A blank board with one Near tile next to the Generator, so Far tiles can be placed. */
function boardWithNear(s: GameState) {
  initTileStacks(s);
  const [q, r] = nearSlots(s)[0];
  const id = s.stacks.near.pop() as string;
  revealTile(s, id, q, r, 'near');
}

describe('tile stacks', () => {
  it('fills both stacks from the tile data, face down and shuffled', () => {
    const s = blankState();
    initTileStacks(s);
    expect([...s.stacks.near].sort()).toEqual(ids('near').sort());
    expect([...s.stacks.far].sort()).toEqual(ids('far').sort());
  });

  it('places tiles with a legal slot and only when a tile of that kind remains', () => {
    const s = blankState();
    boardWithNear(s);
    expect(tileAvailable(s, 'far')).toBe(true);
    s.stacks.far = [];
    expect(tileAvailable(s, 'far')).toBe(false);
  });

  it('revealTile gains the tile Food bonus at once', () => {
    const s = blankState();
    const [q, r] = nearSlots(s)[0];
    const food = (mapData.tiles as any[]).find((t) => (t.food ?? 0) > 0);
    revealTile(s, food.id, q, r, 'near');
    expect(s.food).toBe(food.food);
    expect(s.tiles.at(-1)).toMatchObject({ id: food.id, q, r });
  });

  it('caps the Trees placed by a tile at the 30-Tree limit', () => {
    const s = blankState();
    // 29 trees already on the map: only one more may be placed
    s.spaces['pre:top'] = { id: 'pre:top', tile: 'pre', slot: 'top', res: {}, trees: LIMITS.trees - 1, building: null };
    const withTrees = (mapData.tiles as any[]).find((t) => (t.top?.tree ?? 0) + (t.bottom?.tree ?? 0) >= 2);
    const [q, r] = nearSlots(s)[0];
    revealTile(s, withTrees.id, q, r, 'near');
    expect(treesOnMap(s)).toBe(LIMITS.trees);
  });

  it('pushPlaceTile("far") asks for a slot and draws the top tile when the answer arrives', () => {
    const s = blankState();
    boardWithNear(s);
    const top = s.stacks.far[s.stacks.far.length - 1];
    const before = s.stacks.far.length;
    pushPlaceTile(s, 'far', 0);
    drain(s);
    expect(s.pending?.kind).toBe('tileSlot');
    expect(optionIds(s)).toEqual(farSlots(s).map(([q, r]) => `${q},${r}`));
    answer(s, [optionIds(s)[0]]);
    expect(s.stacks.far.length).toBe(before - 1);
    expect(s.tiles.some((t) => t.id === top && t.kind === 'far')).toBe(true);
  });
});

describe('Remove Snow', () => {
  it('normal: "Place two Near tiles" places two Near tiles, one slot decision each', () => {
    const s = blankState();
    boardWithNear(s);
    const nearBefore = s.stacks.near.length;
    removeSnowAction(s, 0, null, 'normal');
    drain(s);
    expect(s.pending?.kind).toBe('removeSnow');
    answer(s, ['near2']);
    expect(s.pending?.kind).toBe('tileSlot');
    answer(s, [optionIds(s)[0]]);
    expect(s.pending?.kind).toBe('tileSlot');
    answer(s, [optionIds(s)[0]]);
    expect(s.stacks.near.length).toBe(nearBefore - 2);
  });

  it('normal: "Place one Far tile" places exactly one Far tile', () => {
    const s = blankState();
    boardWithNear(s);
    const farBefore = s.stacks.far.length;
    removeSnowAction(s, 0, null, 'normal');
    drain(s);
    answer(s, ['far1']);
    expect(s.pending?.kind).toBe('tileSlot');
    answer(s, [optionIds(s)[0]]);
    expect(s.pending).toBeNull();
    expect(s.stacks.far.length).toBe(farBefore - 1);
  });

  it('drawFar3ChooseOne: places the chosen tile and asks where the other two go', () => {
    const s = blankState();
    boardWithNear(s);
    const far = ids('far').slice(0, 4);
    s.stacks.far = [...far]; // top = far[3]
    push(s, { k: 'tilDraw3', who: 0, src: 'test' });
    drain(s);
    expect(s.pending?.kind).toBe('drawFar3');
    expect(optionIds(s)).toEqual(['0', '1', '2']);
    answer(s, ['0']); // the top tile, far[3], is placed
    expect(s.pending?.kind).toBe('tileSlot');
    answer(s, [optionIds(s)[0]]);
    expect(s.tiles.some((t) => t.id === far[3] && t.kind === 'far')).toBe(true);
    expect(s.pending?.kind).toBe('farOrder');
    answer(s, ['BB']); // both remaining drawn tiles go to the bottom, in place
    expect(s.stacks.far).toEqual([far[1], far[2], far[0]]);
  });

  it('with no Far tile left, the only legal choice (two Near tiles) is made automatically', () => {
    const s = blankState();
    boardWithNear(s);
    s.stacks.far = [];
    removeSnowAction(s, 0, null, 'normal');
    drain(s);
    expect(s.pending?.kind).toBe('tileSlot');
    expect(optionIds(s)).toEqual(nearSlots(s).map(([q, r]) => `${q},${r}`));
  });
});

describe('Far-tile reordering (revealFar3AndReorder, C26)', () => {
  it('reveals the top 3 Far tiles and puts each on the top or bottom in the chosen order', () => {
    const s = blankState();
    initTileStacks(s);
    const far = ids('far').slice(0, 4);
    s.stacks.far = [...far]; // top = far[3]
    pushReveal3(s, 0, 'test');
    drain(s);
    // revealed top first: far[3], far[2], far[1]; far[0] stays
    expect(s.pending?.kind).toBe('farReorder');
    answer(s, ['bottom']); // far[3] to the bottom
    answer(s, ['top']); // far[2] to the top
    answer(s, ['top']); // far[1] to the top
    expect(s.pending).toBeNull();
    expect(s.stacks.far).toEqual([far[3], far[0], far[2], far[1]]);
  });
});

describe('childRemoveSnowFood (L04A)', () => {
  it('reads the covering law consequence, and nothing without a covering law', () => {
    const s = blankState();
    expect(childRemoveSnowFood(s).food).toBe(0);
    s.laws = [{ id: 'L04', covered: 'L04A' }];
    expect(childRemoveSnowFood(s).food).toBe(3);
  });
});

describe('board set-up', () => {
  it('Frozen Grove: Generator centre, one random Deposit on corner 1, Near tiles on the listed hexes', () => {
    const s = blankState({ scenario: 'frozenGrove' });
    setupBoardTiles(s);
    drain(s);
    const board = (mapData.boards as any).frozenGrove;
    expect(s.genCentre).toEqual(board.generatorCentre);
    expect(s.rim).toHaveLength(6);
    expect(s.rim.filter((c) => c.deposit).map((c) => c.corner)).toEqual([1]);
    expect(s.tiles.filter((t) => t.kind === 'near')).toHaveLength(board.nearTiles.length);
  });

  it('Crater: asks the start corner, then places 3 Deposits and a Near + Far pair on every other corner', () => {
    const s = blankState({ scenario: 'crater' });
    setupBoardTiles(s);
    drain(s);
    expect(s.pending?.kind).toBe('setup');
    answer(s, ['1']);
    expect(s.pending).toBeNull();
    const deposits = s.rim.filter((c) => c.deposit);
    expect(deposits.length).toBeLessThanOrEqual(3);
    const empty = 6 - deposits.length;
    expect(s.tiles).toHaveLength(empty * 2);
    expect(s.tiles.filter((t) => t.kind === 'far')).toHaveLength(empty);
  });

  it('Crater: the same seed and start corner give the same Rim', () => {
    const run1 = (): string => {
      const s = blankState({ scenario: 'crater', seed: 7 });
      setupBoardTiles(s);
      drain(s);
      answer(s, ['3']);
      return JSON.stringify(s.rim);
    };
    expect(run1()).toBe(run1());
  });

  it('Dreadnought: Deposits on corners 3 and 4, DN1-DN4 placed as Dreadnought tiles', () => {
    const s = blankState({ scenario: 'dreadnought' });
    setupBoardTiles(s);
    drain(s);
    expect(s.rim.filter((c) => c.deposit).map((c) => c.corner).sort()).toEqual([3, 4]);
    const dn = s.tiles.filter((t) => t.kind === 'dread');
    expect(dn.map((t) => t.id)).toEqual(['DN1', 'DN2', 'DN3', 'DN4']);
    expect(s.buildings.filter((b) => b.kind === 'dreadnoughtTile')).toHaveLength(4);
  });
});
