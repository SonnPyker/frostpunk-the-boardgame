// Card-effect coverage on real games: every Law Consequence card (L01A-L20B) is put in play over its Law, its effect lists
// are run through the effect engine, and every decision they raise is answered with random legal picks. Each card must
// run without throwing and leave the state consistent (checkInvariants). Cards the bot never reached are named in the
// coverage report (scripts/sim.ts --coverage).
import { describe, expect, it } from 'vitest';
import '../src/index';
import { run } from '../src/core';
import { createGame, answer, drive } from '../src/setup';
import { legalPick } from '../src/autoplay';
import { seedRng } from '../src/rng';
import { checkInvariants } from '../src/invariants';
import { runFx } from '../src/fx/core';
import { dusk, lawConsequences, morning, scenarioCards } from '../src/data';
import { eventTimingFx } from '../src/fx/custom';
import type { GameConfig, GameState } from '../src/types';

const config = (seed: number, mode: 'solo' | 'coop' = 'coop'): GameConfig => ({
  scenario: 'crater',
  society: 2,
  difficulty: 'normal',
  mode,
  players: mode === 'solo' ? [{ name: 'Captain' }] : [{ name: 'Ann' }, { name: 'Ben' }, { name: 'Cy' }],
  seed,
  extraPack: true,
});

/** Answers every pending decision with a random legal pick until nothing is pending (bounded). */
function settle(s: GameState, seed: number): number {
  const st = seedRng(seed);
  let answered = 0;
  for (let guard = 0; guard < 400; guard++) {
    try {
      run(s);
    } catch (e: any) {
      if (!/stack ran dry/.test(String(e?.message))) throw e;
    }
    const p = s.pending;
    if (!p) return answered;
    const pick = legalPick(st, p);
    if (!pick) return answered;
    const r = answer(s, p.who >= 0 ? p.who : s.leader, p.id, pick);
    if (!r.ok) throw new Error(`engine rejected a legal pick for ${p.kind}: ${r.error}`);
    answered++;
  }
  return answered;
}

describe('Law Consequence cards: every card runs and keeps the state consistent', () => {
  const ids = Object.keys(lawConsequences).sort();

  it('the card list is the full set of 40 Law Consequences', () => {
    expect(ids.length).toBe(40);
  });

  for (const id of ids) {
    it(`${id} runs its effects and keeps invariants`, () => {
      const card = lawConsequences[id];
      const s = createGame(config(31));
      settle(s, 1);
      // put the card in play: covering its Law (the Law is introduced first so the cover is legal)
      s.laws = [{ id: card.law, covered: null }];
      s.laws[0].covered = id;
      const lists: any[][] = [];
      for (const key of Object.keys(card)) {
        if (key === 'passive' || key === 'id' || key === 'deck' || key === 'law' || key === 'title' || key === 'idx') continue;
        if (Array.isArray(card[key]) && card[key].length) lists.push(card[key]);
      }
      if (lists.length === 0) {
        // a passive-only card (its effect is read as a passive by the rules, not run): it must declare one
        expect(card.passive, `${id} has neither an effect list nor a passive`).toBeDefined();
        return;
      }
      for (const list of lists) {
        runFx(s, list, { who: s.leader, src: `card:${id}`, card: id });
        // a card effect runs outside the phase driver: resume the driver (as the game would) and answer what it asks
        settle(s, 7);
        drive(s);
        settle(s, 8);
        const bad = checkInvariants(s);
        expect(bad.join('; '), `invariants after ${id}`).toBe('');
      }
    });
  }
});

/** Every effect list a Dusk or Morning event card can run: its top list, its option lists and its timing lists. */
function eventLists(id: string, card: any): any[][] {
  const out: any[][] = [];
  for (const k of Object.keys(card)) {
    if (['id', 'title', 'deck', 'idx', 'pile', 'law', 'passive', 'opts'].includes(k)) continue;
    const v = card[k];
    if (Array.isArray(v) && v.length) out.push(v);
  }
  for (const o of card.opts ?? []) if (o && Array.isArray(o.fx) && o.fx.length) out.push(o.fx);
  for (const timing of ['dusk', 'night'] as const) {
    const fx = eventTimingFx(id, timing);
    if (fx.length) out.push(fx);
  }
  return out;
}

function runEventCard(id: string, card: any, seed: number) {
  const lists = eventLists(id, card);
  if (lists.length === 0) return; // nothing to run for this card (no effect list)
  const s = createGame(config(seed));
  settle(s, 1);
  drive(s);
  settle(s, 2);
  for (const list of lists) {
    runFx(s, list, { who: s.leader, src: `card:${id}`, card: id });
    settle(s, 7);
    drive(s);
    settle(s, 8);
    const bad = checkInvariants(s);
    expect(bad.join('; '), `invariants after ${id}`).toBe('');
    if (s.status !== 'playing') break; // the game ended inside the card: nothing further to check
  }
}

describe('Dusk event cards: every card runs and keeps the state consistent', () => {
  for (const id of Object.keys(dusk).sort()) {
    it(`${id} runs its effects and keeps invariants`, () => {
      runEventCard(id, dusk[id], 41);
    });
  }
});

describe('Morning event cards: every card runs and keeps the state consistent', () => {
  for (const id of Object.keys(morning).sort()) {
    it(`${id} runs its effects and keeps invariants`, () => {
      runEventCard(id, morning[id], 43);
    });
  }
});

/** Effect lists of a Scenario card: its on-place / on-resolve / dawn / on-reach lists, and the fx of each option and branch. */
function scenarioLists(card: any): any[][] {
  const out: any[][] = [];
  for (const k of ['onPlace', 'onResolve', 'dawn', 'onReach']) if (Array.isArray(card[k]) && card[k].length) out.push(card[k]);
  for (const o of card.options ?? []) if (Array.isArray(o.fx) && o.fx.length) out.push(o.fx);
  for (const b of card.branches ?? []) if (Array.isArray(b.fx) && b.fx.length) out.push(b.fx);
  return out;
}

describe('Scenario cards: every card with effects runs and keeps the state consistent', () => {
  for (const id of Object.keys(scenarioCards).sort()) {
    it(`${id} runs its effects and keeps invariants`, () => {
      const card = scenarioCards[id];
      const lists = scenarioLists(card);
      if (lists.length === 0) return; // a card whose effect is a special action or a trigger (covered by the engine's own path)
      const s = createGame(config(47));
      settle(s, 1);
      drive(s);
      settle(s, 2);
      for (const list of lists) {
        runFx(s, list, { who: s.leader, src: `scn:${id}`, card: id });
        settle(s, 7);
        drive(s);
        settle(s, 8);
        const bad = checkInvariants(s);
        expect(bad.join('; '), `invariants after ${id}`).toBe('');
        if (s.status !== 'playing') break;
      }
    });
  }
});
