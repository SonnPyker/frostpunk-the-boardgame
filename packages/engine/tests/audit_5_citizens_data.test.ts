// Audit 5 (citizens-data): regression tests for two Citizen cards.
// C22 Patick McGretchak: Remove Snow is performed as normal (tiles are placed), plus 2 sick Children when cold.
// C20 Pauline Grogan: "Spend 4 Food" is a cost of both options, so an option without 4 Food cannot be chosen.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { defOp, hasOp, answerPending, push, run } from '../src/core';
import { runFx, feasible } from '../src/fx/core';
import type { Ctx } from '../src/fx/core';
import { citizens } from '../src/data';
import { placeTileAt } from '../src/map';
import { initTileStacks } from '../src/tiles';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import { newMeeple } from '../src/util';

// phAdvance belongs to the phase module. A stub ends the phase so the Action phase can be tested alone (as in actions.test.ts).
if (!hasOp('phAdvance')) {
  defOp('phAdvance', (s) => {
    s.flags.phaseEnded = true;
  });
}

const STACK_DRY = /stack ran dry/;

/** Run until a decision is needed. A stack-dry throw means nothing else is queued, which is fine here. */
function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!STACK_DRY.test(String(e?.message))) throw e;
  }
}

/**
 * Answer the pending decision. answerPending runs the game on, so once the Action phase has ended under the phAdvance
 * stub the stack-dry error is expected here too (as in drain).
 */
function answer(s: GameState, pick: string[]) {
  const p = s.pending;
  if (!p) throw new Error(`no decision pending, wanted to pick ${pick.join(',')}`);
  let r: { ok: boolean; error?: string };
  try {
    r = answerPending(s, p.who, p.id, pick);
  } catch (e: any) {
    if (!STACK_DRY.test(String(e?.message))) throw e;
    return;
  }
  if (!r.ok) throw new Error(`answer rejected (${p.kind}): ${r.error}`);
}

const optionIds = (s: GameState) => (s.pending?.options ?? []).map((o) => o.id);

/** A cold Generator (Heat 1: every action is cold), one Near tile placed, tile stacks ready. */
function coldWorld(): GameState {
  const s = blankState();
  s.gen.heat = 1;
  s.gen.cold = 5;
  initTileStacks(s);
  placeTileAt(s, 'N01', 1, 0, 'near');
  s.spaces['N01:top'].res = {};
  s.spaces['N01:bottom'].res = {};
  s.spaces['N01:top'].trees = 0;
  return s;
}

describe('C22 Patick McGretchak: Remove Snow with cold Children', () => {
  it('card data: the normal Remove Snow token is listed before the cold override', () => {
    expect(citizens.C22.fx).toEqual(['removeSnow:normal', 'coldSick:child:2']);
  });

  it('playing C22 for Remove Snow gains 2 sick Children when cold and then places the Remove Snow tiles', () => {
    const s = coldWorld();
    s.cit.child = 5; // two Child Meeples, and room for two sick Children
    newMeeple(s, 'child');
    s.players[0].hand = ['C22'];
    const nearBefore = s.stacks.near.length;
    push(s, { k: 'actStart' });
    drain(s);
    answer(s, ['act:removeSnow']); // C22 is the only legal Citizen card, so it is played without a further choice
    expect(s.players[0].playedCitizen).toBe('C22');
    expect(s.sick.child.n).toBe(2);
    // The normal Remove Snow places two Near tiles (the Far option is not offered here): place them.
    let guard = 0;
    while (s.pending?.kind === 'tileSlot' && guard++ < 4) {
      answer(s, [optionIds(s)[0]]);
      drain(s);
    }
    expect(nearBefore - s.stacks.near.length).toBe(2);
  });
});

describe('C20 Pauline Grogan: Spend 4 Food is a cost of each option', () => {
  const ctx = (): Ctx => ({ who: 0, src: 'cit:C20', card: 'C20' });

  it('card data: each option pays 4 Food itself, with no free top-level spend', () => {
    const fx = citizens.C20.fx as any[];
    expect(fx).toHaveLength(1);
    expect(fx[0].choose).toEqual([
      ['pay:food:4', 'drawHope:activate'],
      ['pay:food:4', 'disc-discard:1:active'],
    ]);
  });

  it('with 3 Food both options are disabled: nothing is paid and nothing happens', () => {
    const s = blankState();
    s.food = 3;
    s.disc = [{ t: 'anger', a: true }];
    const c = ctx();
    const fx = citizens.C20.fx as any[];
    expect(feasible(s, fx[0].choose[0], c)).toMatch(/Food/);
    expect(feasible(s, fx[0].choose[1], c)).toMatch(/Food/);
    runFx(s, fx, c);
    drain(s);
    expect(s.food).toBe(3);
    expect(s.disc).toHaveLength(1);
    expect(s.disc[0].a).toBe(true);
    expect(s.pending).toBeFalsy();
  });

  it('with 4 Food the discard option pays 4 Food and removes one active Discontent token', () => {
    const s = blankState();
    s.food = 4;
    s.disc = [{ t: 'anger', a: true }];
    runFx(s, citizens.C20.fx as any[], ctx());
    drain(s);
    expect(s.pending?.kind).toBe('choice');
    expect(optionIds(s)).toEqual(['0', '1']);
    answer(s, ['1']);
    drain(s);
    expect(s.food).toBe(0);
    expect(s.disc).toHaveLength(0);
  });
});
