// Unit tests for actions.ts and fx/tokens_action.ts: the action menu, Gather with cold sickness, co-op Pass rotation,
// automaton coal cost, Citizen-card replacement and the Child restriction (spec 3.2, 4.5, 6; rulebook p26).
// The engine resolves any decision with exactly one legal option by itself (core.ask), so tests assert outcomes
// after an answer rather than expecting a pause at every step.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { answerPending, defOp, hasOp, push, run } from '../src/core';
import { actionHeated, actionMenuFor } from '../src/actions';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import type { GameConfig, GameState } from '../src/types';
import { newMeeple } from '../src/util';

// phAdvance belongs to PHASES. Until that module is loaded, a stub ends the phase so the Action phase can be tested alone.
if (!hasOp('phAdvance')) {
  defOp('phAdvance', (s) => {
    s.flags.phaseEnded = true;
  });
}

const STACK_DRY = /stack ran dry/;

/** Run until a decision is needed. Running out of ops after the phase ended is expected when phAdvance is the stub. */
function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!STACK_DRY.test(String(e?.message))) throw e;
  }
}

function startAction(s: GameState) {
  push(s, { k: 'actStart' });
  drain(s);
}

/** Answer the pending decision. A stack-dry throw here means the phase ended (see drain). */
function answer(s: GameState, who: number, pick: string[]) {
  const p = s.pending;
  if (!p) throw new Error(`no decision pending, wanted to pick ${pick.join(',')}`);
  let r;
  try {
    r = answerPending(s, who, p.id, pick);
  } catch (e: any) {
    if (STACK_DRY.test(String(e?.message))) return;
    throw e;
  }
  if (!r.ok) throw new Error(`answer rejected (${p.kind}): ${r.error}`);
}

function optionIds(s: GameState): string[] {
  return (s.pending?.options ?? []).map((o) => o.id);
}

/** A cold Generator (Heat 1 = all actions cold) with one near tile. Tests set the resources they need. */
function coldWorld(over: Partial<GameConfig> = {}): GameState {
  const s = blankState(over);
  s.gen.heat = 1;
  s.gen.cold = 5;
  placeTileAt(s, 'N01', 1, 0, 'near');
  s.spaces['N01:top'].res = {};
  s.spaces['N01:bottom'].res = {};
  s.spaces['N01:top'].trees = 0;
  return s;
}

const menuItem = (s: GameState, who: number, id: string) => actionMenuFor(s, who).find((m) => m.id === id);

describe('action menu', () => {
  it('lists Fuel, the five main actions and Pass, with disabled reasons', () => {
    const s = coldWorld();
    s.cit.worker = 5; // meepleCountFor(5) = 2 Workers
    s.res.coal = 2;
    startAction(s);
    expect(s.pending?.kind).toBe('action');
    expect(s.pending?.who).toBe(0);
    expect(optionIds(s)).toEqual(
      expect.arrayContaining(['act:fuel', 'act:removeSnow', 'act:gather', 'act:construct', 'act:use', 'act:deploy', 'act:pass']),
    );
    expect(menuItem(s, 0, 'act:fuel')?.disabled).toBeUndefined();
    expect(menuItem(s, 0, 'act:deploy')?.disabled).toBe('The Beacon must be built first');
    expect(menuItem(s, 0, 'act:use')?.disabled).toBeDefined(); // no Building on the board
    expect(menuItem(s, 0, 'act:pass')?.disabled).toBeUndefined();
  });

  it('Gather is disabled when no unoccupied space holds a Resource', () => {
    const s = coldWorld();
    s.cit.worker = 5;
    startAction(s);
    expect(menuItem(s, 0, 'act:gather')?.disabled).toBeDefined();
  });

  it('a Child with no Citizen card and no Law cannot take a main action', () => {
    const s = coldWorld();
    s.spaces['N01:top'].res = { coal: 2 };
    newMeeple(s, 'child');
    expect(menuItem(s, 0, 'act:gather')?.disabled).toBeDefined();
    expect(menuItem(s, 0, 'act:removeSnow')?.disabled).toBeDefined();
  });
});

describe('heating of actions (ACT-07)', () => {
  it('a heated token makes the action heated; Heat on space 1 keeps it cold', () => {
    const s = coldWorld();
    expect(actionHeated(s, 'N01:top', false, ['heated'])).toBe(true);
    expect(actionHeated(s, 'N01:top', false, [])).toBe(false); // Heat 1: the Generator has not started
  });
});

describe('Gather Resources', () => {
  it('a cold Gather costs +1 sick of the Meeple type and takes up to 2 Resources', () => {
    const s = coldWorld();
    s.cit.worker = 5;
    s.spaces['N01:top'].res = { coal: 2 };
    startAction(s);
    const sickBefore = s.sick.worker.n;
    answer(s, 0, ['act:gather']);
    expect(s.sick.worker.n).toBe(sickBefore + 1);
    expect(s.res.coal).toBe(2);
    expect(s.spaces['N01:top'].res.coal ?? 0).toBe(0);
    expect(s.usedSpaces).toContain('N01:top');
  });
});

describe('turn order and passing', () => {
  it('co-op: Passes rotate the turn, and two passes in a row end the phase', () => {
    const s = coldWorld({ mode: 'coop', players: [{ name: 'A' }, { name: 'B' }] });
    s.cit.worker = 10; // meepleCountFor(10) = 3 Workers in the shared supply
    startAction(s);
    expect(s.pending?.who).toBe(0);
    answer(s, 0, ['act:pass']);
    expect(s.pending?.kind).toBe('action');
    expect(s.pending?.who).toBe(1);
    answer(s, 1, ['act:pass']);
    expect(s.pending).toBeNull();
    expect(s.flags.phaseEnded).toBe(true);
  });

  it('the phase ends without a decision when no Meeple can act', () => {
    const s = coldWorld();
    startAction(s); // no Meeples at all
    expect(s.pending).toBeNull();
    expect(s.flags.phaseEnded).toBe(true);
  });
});

describe('automatons', () => {
  it('an Automaton pays 1 Coal per use, then gathers, and is placed on that space', () => {
    const s = coldWorld();
    s.spaces['N01:top'].res = { coal: 2 };
    s.res.coal = 1;
    const a = newMeeple(s, 'automaton');
    startAction(s);
    expect(menuItem(s, 0, 'act:gather')?.disabled).toBeUndefined();
    answer(s, 0, ['act:gather']);
    expect(s.res.coal).toBe(2); // 1 paid, then 2 gathered
    expect(a.loc).toEqual({ k: 'space', space: 'N01:top' });
  });

  it('with no Coal an Automaton cannot gather', () => {
    const s = coldWorld();
    s.spaces['N01:top'].res = { coal: 2 };
    s.res.coal = 0;
    newMeeple(s, 'automaton');
    const why = menuItem(s, 0, 'act:gather')?.disabled;
    expect(why).toMatch(/Coal/);
  });
});

describe('Citizen card replacement', () => {
  it('C04 (Gather a Tree, heated) is the only option: it replaces Gather, leaves the hand and does not cause sickness', () => {
    const s = coldWorld();
    s.cit.worker = 5;
    s.players[0].hand = ['C04'];
    s.spaces['N01:top'].trees = 1;
    startAction(s);
    const sickBefore = s.sick.worker.n;
    answer(s, 0, ['act:gather']);
    expect(s.spaces['N01:top'].trees).toBe(0);
    expect(s.res.wood).toBe(2);
    expect(s.sick.worker.n).toBe(sickBefore); // heated by the card
    expect(s.players[0].hand).toEqual([]);
    expect(s.players[0].playedCitizen).toBe('C04');
  });

  it('when a normal Gather is also possible, the player chooses between C04 and the normal action', () => {
    const s = coldWorld();
    s.cit.worker = 5;
    s.players[0].hand = ['C04'];
    s.spaces['N01:top'].trees = 1;
    s.spaces['N01:bottom'].res = { coal: 2 };
    startAction(s);
    answer(s, 0, ['act:gather']);
    expect(s.pending?.kind).toBe('citizen');
    expect(optionIds(s)).toEqual(expect.arrayContaining(['C04', 'normal']));
  });

  it('choosing the normal action instead of C04 gathers the Resources and pays the cold sickness', () => {
    const s = coldWorld();
    s.cit.worker = 5;
    s.players[0].hand = ['C04'];
    s.spaces['N01:top'].trees = 1;
    s.spaces['N01:bottom'].res = { coal: 2 };
    startAction(s);
    const sickBefore = s.sick.worker.n;
    answer(s, 0, ['act:gather']);
    answer(s, 0, ['normal']);
    expect(s.res.coal).toBe(2);
    expect(s.spaces['N01:top'].trees).toBe(1); // the Tree is untouched
    expect(s.sick.worker.n).toBe(sickBefore + 1);
    expect(s.players[0].hand).toEqual(['C04']);
    expect(s.players[0].playedCitizen).toBeNull();
  });

  it('a played Citizen card is discarded when the Action phase ends', () => {
    const s = coldWorld();
    s.cit.worker = 5;
    s.players[0].hand = ['C04'];
    s.spaces['N01:top'].trees = 1;
    startAction(s);
    answer(s, 0, ['act:gather']);
    expect(s.players[0].playedCitizen).toBe('C04');
    answer(s, 0, ['act:pass']); // one player: a single Pass ends the phase
    expect(s.flags.phaseEnded).toBe(true);
    expect(s.players[0].playedCitizen).toBeNull();
    expect(s.decks.citizenDiscard).toContain('C04');
  });
});
