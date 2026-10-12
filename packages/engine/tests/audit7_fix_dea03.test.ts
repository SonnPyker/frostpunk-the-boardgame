// Regression for audit7 DEA-03 (rulebook p30): on a death, ANY player holding a matching Citizen card may discard it instead of
// the draw. The matching-card decision is asked to each holder in seat order from the leader (not only to the leader); the first
// holder who discards wins, and if every holder passes the top card of the deck is drawn.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/buildings';
import { answerPending, run } from '../src/core';
import { killCitizen } from '../src/sickness';
import { citizens } from '../src/data';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';

const DRY = /stack ran dry/;

function drain(s: GameState) {
  try {
    run(s);
  } catch (e) {
    if (!DRY.test(String((e as Error).message))) throw e;
  }
}

function answer(s: GameState, pick: string[]) {
  const p = s.pending;
  if (!p) throw new Error('no decision pending');
  try {
    const r = answerPending(s, p.who, p.id, pick);
    if (!r.ok) throw new Error('answer rejected: ' + r.error);
  } catch (e) {
    if (!DRY.test(String((e as Error).message))) throw e;
  }
}

const cardOfType = (t: string, skip: string[] = []) =>
  Object.keys(citizens).find((id) => citizens[id]?.type === t && !skip.includes(id)) as string;

function twoPlayers(leader = 0): GameState {
  const s = blankState({ players: [{ name: 'Captain' }, { name: 'Engineer' }, { name: 'Mechanic' }] } as any);
  s.leader = leader;
  s.corpseMax = 50;
  s.cit.worker = 3;
  return s;
}

describe('audit7 DEA-03 fix: any holder may discard a matching Citizen card', () => {
  it('a non-leader holder is asked (not the leader) when only that player holds a matching card', () => {
    const s = twoPlayers(0);
    const wid = cardOfType('worker');
    s.players[1].hand = [wid];
    s.decks.citizen = [];
    killCitizen(s, 'worker', false, 0);
    drain(s);
    expect(s.pending?.kind).toBe('choice');
    expect(s.pending!.who).toBe(1);
    expect(s.pending!.options.map((o) => o.id)).toEqual(['draw', 'p:1']);
  });

  it('holders are asked in seat order from the leader; a pass moves on to the next holder', () => {
    const s = twoPlayers(1);
    const wid = cardOfType('worker');
    s.players[0].hand = [wid];
    s.players[2].hand = [wid];
    s.decks.citizen = [];
    killCitizen(s, 'worker', false, 1);
    drain(s);
    // Seat order from the leader (1): 1 holds none, then 2, then 0.
    expect(s.pending!.who).toBe(2);
    answer(s, ['draw']); // player 2 passes
    drain(s);
    expect(s.pending!.who).toBe(0);
    expect(s.pending!.options.map((o) => o.id)).toEqual(['draw', 'p:0']);
  });

  it('the first holder who discards wins: their card is discarded, the death effect applies, and no card is drawn', () => {
    const s = twoPlayers(0);
    const wid = cardOfType('worker');
    const other = Object.keys(citizens).find((id) => id !== wid) as string;
    s.players[0].hand = [];
    s.players[1].hand = [wid];
    s.players[2].hand = [wid];
    s.decks.citizen = [other];
    killCitizen(s, 'worker', false, 0);
    drain(s);
    expect(s.pending!.who).toBe(1);
    answer(s, ['p:1']); // player 1 chooses to discard; the single matching card is then discarded without a further question
    drain(s);
    expect(s.players[1].hand).toEqual([]);
    expect(s.players[2].hand).toEqual([wid]);
    expect(s.decks.citizenDiscard).toContain(wid);
    expect(s.decks.citizen).toEqual([other]); // the deck top was not drawn
    expect(s.pending).toBeNull();
  });

  it('when every holder passes, the top card of the deck is drawn and the hands are kept', () => {
    const s = twoPlayers(0);
    const wid = cardOfType('worker');
    const other = Object.keys(citizens).find((id) => id !== wid) as string;
    s.players[0].hand = [wid];
    s.players[1].hand = [wid];
    s.decks.citizen = [other];
    killCitizen(s, 'worker', false, 0);
    drain(s);
    expect(s.pending!.who).toBe(0);
    answer(s, ['draw']);
    drain(s);
    expect(s.pending!.who).toBe(1);
    answer(s, ['draw']);
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.decks.citizenDiscard).toContain(other);
    expect(s.players[0].hand).toEqual([wid]);
    expect(s.players[1].hand).toEqual([wid]);
  });

  it('with no matching card anywhere, the death draws the top card without asking anyone', () => {
    const s = twoPlayers(0);
    const wid = cardOfType('worker');
    s.decks.citizen = [wid];
    killCitizen(s, 'worker', false, 0);
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.decks.citizenDiscard).toContain(wid);
    expect(s.cit.worker).toBe(2);
  });
});
