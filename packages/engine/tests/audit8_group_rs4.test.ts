// Audit 8, ACT-RS4: Citizen-card variants of Remove Snow (C08, C09, C13, C21, C22, C26). Each variant text was checked
// against the card image (scratch/view_541_7.jpg from tools/sheet.py view 541 7 19). The Foreman Advisor (ADV_FOREMAN,
// image scratch/view_725_3.jpg): exhaust Motivation, place 1 Near tile, or 1 Far tile if all Near tiles are placed.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions';
import '../src/cards';
import '../src/phases';
import { push, run } from '../src/core';
import { answer } from '../src/setup';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import { newMeeple } from '../src/util';
import { removeSnowAction } from '../src/tiles';
import { runFx } from '../src/fx/core';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** Run the queue, answering every pending prompt with its first option, until nothing is pending. */
function resolveAll(s: GameState, limit = 30) {
  for (let i = 0; i < limit; i++) {
    drain(s);
    if (!s.pending) return;
    try {
      answer(s, s.pending.who, s.pending.id, [s.pending.options[0].id]);
    } catch (e: any) {
      if (!/stack ran dry/.test(String(e?.message))) throw e;
    }
  }
}

/** A solo state with one Near tile placed (N01 at ring 2) and stacks of Near and Far tiles that the variants draw from. */
function world(near: string[], far: string[]): GameState {
  const s = blankState();
  placeTileAt(s, 'N01', 2, 0, 'near');
  s.stacks.near = [...near];
  s.stacks.far = [...far];
  return s;
}

const placed = (s: GameState) => s.tiles.length;

describe('ACT-RS4 C08 Georgia Taller: draw 3 Far tiles, place 1, the other 2 go back on top or bottom', () => {
  it('draws three, places one, returns two to the Far stack', () => {
    const s = world([], ['F01', 'F02', 'F03', 'F04', 'F05']);
    const before = placed(s);
    removeSnowAction(s, 0, null, 'drawFar3ChooseOne');
    drain(s);
    expect(s.pending).not.toBeNull();
    expect(s.pending!.options.length).toBe(3);
    try {
      answer(s, s.pending!.who, s.pending!.id, ['0']);
    } catch (e: any) {
      if (!/stack ran dry/.test(String(e?.message))) throw e;
    }
    resolveAll(s);
    expect(placed(s)).toBe(before + 1);
    // 5 - 3 drawn + 2 returned = 4 left on the stack
    expect(s.stacks.far.length).toBe(4);
  });
});

describe('ACT-RS4 C09 Pat O Bara: 1 Near and 1 Far; if all Near are placed, 2 Far instead', () => {
  it('with Near tiles left: one Near and one Far are placed', () => {
    const s = world(['N02', 'N03'], ['F01', 'F02', 'F03']);
    const before = placed(s);
    removeSnowAction(s, 0, null, 'nearAndFar');
    resolveAll(s);
    expect(placed(s)).toBe(before + 2);
    expect(s.stacks.near.length).toBe(1);
    expect(s.stacks.far.length).toBe(2);
  });

  it('with no Near tiles left: two Far tiles are placed', () => {
    const s = world([], ['F01', 'F02', 'F03']);
    const before = placed(s);
    removeSnowAction(s, 0, null, 'nearAndFar');
    resolveAll(s);
    expect(placed(s)).toBe(before + 2);
    expect(s.stacks.far.length).toBe(1);
  });
});

describe('ACT-RS4 C13 Jesse Quackerson: place 2 Far tiles; if cold, 2 sick Engineers (instead of 1)', () => {
  it('places two Far tiles', () => {
    const s = world([], ['F01', 'F02', 'F03', 'F04']);
    const before = placed(s);
    removeSnowAction(s, 0, null, 'twoFar');
    resolveAll(s);
    expect(placed(s)).toBe(before + 2);
    expect(s.stacks.far.length).toBe(2);
  });

  it('the cold override gives 2 sick Engineers through the citizen-card fx', () => {
    const s = world([], ['F01', 'F02', 'F03', 'F04']);
    s.cit.engineer = 5; // addSick needs a Citizen of the type in the city
    const m = newMeeple(s, 'engineer');
    push(s, { k: 'actResolve', who: 0, action: 'removeSnow', card: 'C13', meeple: m.id } as any);
    resolveAll(s);
    expect(s.sick.engineer.n).toBe(2);
  });
});

describe('ACT-RS4 C21 Michael Plower: only 1 Near tile; if all Near are placed, 1 Far tile instead', () => {
  it('with Near tiles left: exactly one Near tile is placed', () => {
    const s = world(['N02', 'N03'], ['F01', 'F02']);
    const before = placed(s);
    removeSnowAction(s, 0, null, 'oneNearElseFar');
    resolveAll(s);
    expect(placed(s)).toBe(before + 1);
    expect(s.stacks.near.length).toBe(1);
    expect(s.stacks.far.length).toBe(2);
  });

  it('with no Near tiles left: one Far tile is placed', () => {
    const s = world([], ['F01', 'F02']);
    const before = placed(s);
    removeSnowAction(s, 0, null, 'oneNearElseFar');
    resolveAll(s);
    expect(placed(s)).toBe(before + 1);
    expect(s.stacks.far.length).toBe(1);
  });
});

describe('ACT-RS4 C22 Patrick McGretchak: as normal, if cold 2 sick Children (instead of 1)', () => {
  it('the cold override gives 2 sick Children through the citizen-card fx', () => {
    const s = world(['N02', 'N03'], ['F01']);
    s.cit.child = 5;
    const m = newMeeple(s, 'child');
    push(s, { k: 'actResolve', who: 0, action: 'removeSnow', card: 'C22', meeple: m.id } as any);
    resolveAll(s);
    expect(s.sick.child.n).toBe(2);
  });
});

describe('ACT-RS4 C26 Phillipa Bullsky: reveal 3 Far tiles and place each on the top or bottom of the stack', () => {
  it('reveals three Far tiles, places none, and keeps the stack size', () => {
    const s = world([], ['F01', 'F02', 'F03', 'F04']);
    const before = placed(s);
    runFx(s, ['revealFar3AndReorder'], { who: 0 } as any);
    resolveAll(s);
    expect(placed(s)).toBe(before);
    expect(s.stacks.far.length).toBe(4);
  });
});

describe('ACT-RS4 Foreman Advisor: placeTile:nearElseFar (1 Near, else 1 Far)', () => {
  it('places one Near tile while Near tiles remain', () => {
    const s = world(['N02', 'N03'], ['F01', 'F02']);
    const before = placed(s);
    runFx(s, ['placeTile:nearElseFar'], { who: 0 } as any);
    resolveAll(s);
    expect(placed(s)).toBe(before + 1);
    expect(s.stacks.near.length).toBe(1);
    expect(s.stacks.far.length).toBe(2);
  });

  it('places one Far tile once all Near tiles are placed', () => {
    const s = world([], ['F01', 'F02']);
    const before = placed(s);
    runFx(s, ['placeTile:nearElseFar'], { who: 0 } as any);
    resolveAll(s);
    expect(placed(s)).toBe(before + 1);
    expect(s.stacks.far.length).toBe(1);
  });
});
