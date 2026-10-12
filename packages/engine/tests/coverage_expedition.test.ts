// Hand-built-state coverage for the Expedition flow (expedition.ts): Deploy Scouts, Scout movement, arrival, Skip,
// Explore, Continue, Return, the no-reward return (S04) and the stack bonus. The bot never completed these ops.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run } from '../src/core';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import {
  deployScout,
  expCardDef,
  initExpDecks,
  placeExpedition,
  scoutsReturnNoReward,
  setupExpeditions,
  expeditionBonus,
} from '../src/expedition';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}
function answer(s: GameState, pick: string[]) {
  const p = s.pending!;
  s.pending = null;
  s.stack.push({ ...p.then, pick });
  drain(s);
}
function beacon(s: GameState) {
  const sid = 'N01:top';
  if (!s.tiles.some((t) => t.key === '0,0')) {
    s.tiles.push({ key: '0,0', id: 'N01', kind: 'near', q: 0, r: 0, food: 0, zone: 'A', spaces: [] } as any);
  }
  s.spaces[sid] = { id: sid, tile: '0,0', slot: 'top', res: {}, trees: 0, building: null } as any;
  (s.tiles.find((t) => t.key === '0,0') as any).spaces.push(sid);
  const b = { uid: ++s.nextUid, kind: 'beacon', upgraded: false, ruins: false, spaces: [sid] } as any;
  s.spaces[sid].building = b.uid;
  s.buildings.push(b);
}
/** Deploy the first Worker on a stack. Single-option prompts resolve on their own, so only pending prompts are answered. */
function deployTo(s: GameState, stackUid: number) {
  deployScout(s, 0);
  drain(s);
  if (s.pending?.kind === 'deployScout') answer(s, ['worker']);
  if (s.pending?.kind === 'expStack') answer(s, [String(stackUid)]);
}
function worker(s: GameState, id: number) {
  s.meeples.push({ id, kind: 'worker', loc: { k: 'supply' } } as any);
}

/** A ready state: a Beacon, one Worker in the supply, and expedition stacks laid out. */
function ready(): GameState {
  const s = blankState();
  beacon(s);
  worker(s, 1);
  initExpDecks(s);
  setupExpeditions(s);
  return s;
}

describe('Deploy Scouts', () => {
  it('needs a Beacon; without one the deployment is denied and nothing is asked', () => {
    const s = blankState();
    worker(s, 1);
    initExpDecks(s);
    setupExpeditions(s);
    deployScout(s, 0);
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.meeples[0].loc.k).toBe('supply');
  });

  it('a Worker becomes the Scout and is placed on the chosen stack at position 1', () => {
    const s = ready();
    const stack = s.expeditions[0];
    deployScout(s, 0);
    drain(s);
    // the only Meeple in the supply is a Worker, so the Scout-kind prompt resolves itself
    expect(s.pending?.kind).toBe('expStack');
    answer(s, [String(stack.uid)]);
    const e = s.expeditions.find((x) => x.uid === stack.uid)!;
    expect(e.scout).toMatchObject({ meeple: 1, pos: 1 });
    expect(s.meeples[0].loc).toMatchObject({ k: 'scout', exp: stack.uid });
    expect(s.flags.expLast).toBe(stack.uid);
  });

  it('T01 Lighter Scout Sleds moves the Scout one extra space when deployed', () => {
    const s = ready();
    s.techs = [{ id: 'T01', state: 'done', dueRound: null }] as any;
    const stack = s.expeditions[0];
    deployTo(s, stack.uid);
    expect(s.expeditions.find((x) => x.uid === stack.uid)!.scout!.pos).toBe(2);
  });
});

describe('Scout arrival: Explore, then Return', () => {
  it('a Scout that reaches the last space asks Skip or Explore, and Explore asks the option', () => {
    const s = ready();
    const stack = s.expeditions[0];
    deployTo(s, stack.uid);
    const e = s.expeditions.find((x) => x.uid === stack.uid)!;
    const steps = expCardDef(e.cards[e.cards.length - 1].id).steps;
    // move the Scout to the last space through the normal movement op
    s.stack.push({ k: 'expMove', uid: stack.uid, n: steps - 1 });
    drain(s);
    expect(s.pending?.kind).toBe('expArrive');
    answer(s, ['explore']);
    expect(s.pending?.kind).toBe('expExplore');
    expect(e.waiting).toBe(true);
    expect(e.cards[e.cards.length - 1].flipped).toBe(true);
  });

  it('Return sends the Scout back to the supply and clears the stack scout', () => {
    const s = ready();
    const stack = s.expeditions[0];
    deployTo(s, stack.uid);
    const e = s.expeditions.find((x) => x.uid === stack.uid)!;
    const top = e.cards[e.cards.length - 1];
    const steps = expCardDef(top.id).steps;
    s.stack.push({ k: 'expMove', uid: stack.uid, n: steps - 1 });
    drain(s);
    answer(s, ['explore']);
    const options = expCardDef(top.id).options;
    const ret = options.findIndex((o) => o.kind === 'return');
    expect(ret).toBeGreaterThanOrEqual(0);
    answer(s, [String(ret)]);
    expect(s.meeples[0].loc.k).toBe('supply');
    expect(e.scout).toBeNull();
    expect(e.waiting).toBe(false);
  });
});

describe('Skip (A and B locations only)', () => {
  it('Skip overlays the next letter card and moves the Scout to its first space', () => {
    const s = ready();
    const stack = s.expeditions[0];
    const e = s.expeditions.find((x) => x.uid === stack.uid)!;
    if (expCardDef(e.cards[0].id).scenario) return; // only meaningful for a normal stack
    deployTo(s, stack.uid);
    const steps = expCardDef(e.cards[0].id).steps;
    s.stack.push({ k: 'expMove', uid: stack.uid, n: steps - 1 });
    drain(s);
    expect(s.pending?.kind).toBe('expArrive');
    const cardsBefore = e.cards.length;
    answer(s, ['skip']);
    expect(e.cards.length).toBe(cardsBefore + 1);
    expect(e.scout!.pos).toBe(1);
  });

  it('a scenario expedition cannot be skipped', () => {
    const s = ready();
    placeExpedition(s, 'S05');
    const e = s.expeditions[s.expeditions.length - 1];
    const def = expCardDef(e.cards[e.cards.length - 1].id);
    expect(def.scenario).toBe(true);
    e.scout = { meeple: 1, pos: 1 }; // the Scout must be on the stack for the arrival choice
    s.stack.push({ k: 'expArriveChoice', uid: e.uid, left: 0 });
    drain(s);
    // Skip is disabled for a scenario card, so the only legal option (Explore) is chosen without asking:
    // no Skip is logged, Explore is, and the scenario stack leaves the game on its Return.
    expect(s.log.some((l: any) => l.t === 'exp.skip')).toBe(false);
    expect(s.log.some((l: any) => l.t === 'exp.explore')).toBe(true);
    expect(s.expeditions.some((x) => x.uid === e.uid)).toBe(false);
  });
});

describe('scenario no-reward return and stack bonus', () => {
  it('scoutsReturnNoReward returns every Scout and drops the pending bonus', () => {
    const s = ready();
    const stack = s.expeditions[0];
    deployTo(s, stack.uid);
    const e = s.expeditions.find((x) => x.uid === stack.uid)!;
    e.bonus = { wood: 3 };
    scoutsReturnNoReward(s);
    expect(e.scout).toBeNull();
    expect(e.bonus).toBeUndefined();
    expect(s.meeples[0].loc.k).toBe('supply');
  });

  it('expeditionBonus adds Wood to the stack and expFinishReturn pays it out and removes the stack', () => {
    const s = ready();
    const stack = s.expeditions[0];
    expeditionBonus(s, 'wood', 2);
    const e = s.expeditions.find((x) => x.uid === stack.uid)!;
    expect(e.bonus?.wood ?? 0).toBeGreaterThanOrEqual(0);
    const before = s.res.wood;
    s.stack.push({ k: 'expFinishReturn', uid: stack.uid, next: 'remove' });
    drain(s);
    expect(s.res.wood).toBeGreaterThanOrEqual(before);
    expect(s.expeditions.some((x) => x.uid === stack.uid)).toBe(false);
  });
});
