// Unit tests for expedition.ts: decks, Deploy Scouts, Weather-phase movement, Skip / Explore, stack bonuses (rulebook p26, p35-36).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { answerPending, push, run } from '../src/core';
import { expeditions as expData, scenarioCards, weatherCards } from '../src/data';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import { bdef, newMeeple } from '../src/util';
import {
  advanceScouts,
  deployScout,
  expCardDef,
  expeditionBonus,
  initExpDecks,
  legalExpeditionDeploy,
  maxActiveExpeditions,
  placeExpedition,
  scoutsReturnNoReward,
  setupExpeditions,
} from '../src/expedition';

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
const optionIds = (s: GameState) => (s.pending?.options ?? []).map((o) => o.id);
const letterCount = (letter: string) => Object.values(expData as Record<string, any>).filter((c) => c.letter === letter).length;

function addBeacon(s: GameState) {
  s.buildings.push({ uid: ++s.nextUid, kind: 'beacon', upgraded: false, ruins: false, spaces: [] });
}
/** A Scout standing on stack `uid` (top card `id`) at position `pos`. */
function scoutOn(s: GameState, uid: number, pos = 1) {
  const m = newMeeple(s, 'worker');
  m.loc = { k: 'scout', exp: uid };
  const e = s.expeditions.find((x) => x.uid === uid)!;
  e.scout = { meeple: m.id, pos };
  return m;
}
function stackWith(s: GameState, id: string) {
  if (!s.decks.expA.length && !s.decks.expB.length && !s.decks.expC.length) initExpDecks(s);
  placeExpedition(s, id);
  return s.expeditions[s.expeditions.length - 1];
}

describe('expedition decks', () => {
  it('splits X01-X40 into decks A, B and C by letter, each shuffled with the game RNG', () => {
    const s = blankState();
    initExpDecks(s);
    expect(s.decks.expA).toHaveLength(letterCount('A'));
    expect(s.decks.expB).toHaveLength(letterCount('B'));
    expect(s.decks.expC).toHaveLength(letterCount('C'));
    expect(s.decks.expA.every((id) => expCardDef(id).letter === 'A')).toBe(true);
    expect(s.decks.expC.every((id) => expCardDef(id).letter === 'C')).toBe(true);
  });

  it('setup puts one A card on each of three stacks, white side up', () => {
    const s = blankState();
    setupExpeditions(s);
    expect(s.expeditions).toHaveLength(3);
    for (const e of s.expeditions) {
      expect(e.cards).toHaveLength(1);
      expect(e.cards[0].flipped).toBe(false);
      expect(expCardDef(e.cards[0].id).letter).toBe('A');
      expect(e.scenario).toBe(false);
    }
    expect(s.decks.expA).toHaveLength(letterCount('A') - 3);
  });

  it('a scenario expedition is placed as a scenario stack that is removed on Return', () => {
    const s = blankState();
    const sid = Object.keys(scenarioCards as any).find((k) => (scenarioCards as any)[k].expedition);
    expect(sid).toBeTruthy();
    placeExpedition(s, sid!);
    expect(s.expeditions[0].scenario).toBe(true);
    expect(expCardDef(sid!).scenario).toBe(true);
  });
});

describe('Deploy Scouts', () => {
  it('needs the Beacon, a Worker or Engineer in the supply, room under the limit and a free stack', () => {
    const s = blankState();
    setupExpeditions(s);
    expect(legalExpeditionDeploy(s)).toBe('The Beacon must be built first');
    addBeacon(s);
    expect(legalExpeditionDeploy(s)).toBe('No Worker or Engineer in the supply');
    newMeeple(s, 'worker');
    expect(legalExpeditionDeploy(s)).toBeNull();
  });

  it('the Beacon allows one active Expedition, two when upgraded', () => {
    const s = blankState();
    addBeacon(s);
    const d = bdef('beacon') as any;
    expect(maxActiveExpeditions(s)).toBe(d.passive?.expeditions ?? 1);
    s.buildings[0].upgraded = true;
    expect(maxActiveExpeditions(s)).toBe(d.upgPassive?.expeditions ?? 2);
  });

  it('a denied deploy does nothing', () => {
    const s = blankState();
    setupExpeditions(s);
    newMeeple(s, 'worker');
    deployScout(s, 0);
    expect(s.stack).toHaveLength(0);
    expect(s.pending).toBeNull();
  });

  it('asks the Meeple, then the stack, and places the Scout at position 1', () => {
    const s = blankState();
    setupExpeditions(s);
    addBeacon(s);
    const m = newMeeple(s, 'worker');
    deployScout(s, 0);
    drain(s);
    // only a Worker is in the supply, so the Meeple question resolves itself and the stack is asked next
    expect(s.pending?.kind).toBe('expStack');
    expect(optionIds(s)).toHaveLength(3);
    const uid = s.expeditions[1].uid;
    answer(s, [String(uid)]);
    const e = s.expeditions.find((x) => x.uid === uid)!;
    expect(e.scout).toEqual({ meeple: m.id, pos: 1 });
    expect(m.loc).toEqual({ k: 'scout', exp: uid });
    expect(s.flags.expLast).toBe(uid);
    expect(s.pending).toBeNull();
  });
});

describe('Scout movement (Weather phase)', () => {
  it('moves every Scout by the weather card value, without a decision while still on the stack', () => {
    const s = blankState();
    addBeacon(s);
    const e = stackWith(s, 'X01');
    scoutOn(s, e.uid, 1);
    const w = (weatherCards as any[]).find((c) => c.scout === 2);
    s.weatherCard = w.id;
    advanceScouts(s);
    drain(s);
    const steps = expCardDef('X01').steps;
    if (1 + 2 < steps) {
      expect(e.scout!.pos).toBe(3);
      expect(s.pending).toBeNull();
    } else {
      expect(s.pending?.kind).toBe('expArrive');
    }
  });

  it('reaching the last space offers Skip (A and B) or Explore', () => {
    const s = blankState();
    const e = stackWith(s, 'X01');
    scoutOn(s, e.uid, expCardDef('X01').steps - 1);
    push(s, { k: 'expMove', uid: e.uid, n: 1 });
    drain(s);
    expect(s.pending?.kind).toBe('expArrive');
    expect(optionIds(s)).toEqual(['skip', 'explore']);
  });

  it('Skip overlays the next letter card and puts the Scout on its first space', () => {
    const s = blankState();
    const e = stackWith(s, 'X01');
    scoutOn(s, e.uid, expCardDef('X01').steps - 1);
    push(s, { k: 'expMove', uid: e.uid, n: 1 });
    drain(s);
    answer(s, ['skip']);
    expect(e.cards).toHaveLength(2);
    expect(expCardDef(e.cards[1].id).letter).toBe('B');
    expect(e.scout!.pos).toBe(1);
    expect(e.waiting).toBeFalsy();
  });

  it('Explore turns the top card black, sets the Scout aside and asks for one option', () => {
    const s = blankState();
    const e = stackWith(s, 'X01');
    const m = scoutOn(s, e.uid, expCardDef('X01').steps - 1);
    push(s, { k: 'expMove', uid: e.uid, n: 1 });
    drain(s);
    answer(s, ['explore']);
    expect(s.pending?.kind).toBe('expExplore');
    expect(e.cards[0].flipped).toBe(true);
    expect(e.waiting).toBe(true);
    expect(e.scout?.meeple).toBe(m.id); // still the Scout, just not moving
    expect(optionIds(s).length).toBe(expCardDef('X01').options.length);
  });

  it('a Scout that waits does not move with the weather', () => {
    const s = blankState();
    const e = stackWith(s, 'X01');
    scoutOn(s, e.uid, 2);
    e.waiting = true;
    push(s, { k: 'expMove', uid: e.uid, n: 3 });
    drain(s);
    expect(e.scout!.pos).toBe(2);
  });
});

describe('stack bonus and scenario return', () => {
  it('expeditionBonus attaches the bonus to the stack the Scout was deployed to', () => {
    const s = blankState();
    const e = stackWith(s, 'X01');
    scoutOn(s, e.uid, 1);
    s.flags.expLast = e.uid;
    expeditionBonus(s, 'wood', 2);
    expect(e.bonus).toEqual({ wood: 2 });
    expect(s.res.wood).toBe(0);
  });

  it('expeditionBonus gains the resource at once when the stack already returned', () => {
    const s = blankState();
    const e = stackWith(s, 'X01');
    s.flags.expLast = e.uid; // no Scout on it any more
    expeditionBonus(s, 'coal', 2);
    expect(s.res.coal).toBe(2);
    expect(e.bonus).toBeUndefined();
  });

  it('a Return pays the stack bonus and removes a scenario stack', () => {
    const s = blankState();
    const sid = Object.keys(scenarioCards as any).find((k) => (scenarioCards as any)[k].expedition)!;
    const e = stackWith(s, sid);
    e.bonus = { wood: 1, coal: 1 };
    push(s, { k: 'expFinishReturn', uid: e.uid, next: 'remove' });
    drain(s);
    expect(s.res.wood).toBe(1);
    expect(s.res.coal).toBe(1);
    expect(s.expeditions.find((x) => x.uid === e.uid)).toBeUndefined();
  });

  it('S04 "Scouts return without reward" returns every Scout and drops the bonuses', () => {
    const s = blankState();
    const e = stackWith(s, 'X01');
    const m = scoutOn(s, e.uid, 2);
    e.bonus = { wood: 3 };
    scoutsReturnNoReward(s);
    expect(e.scout).toBeNull();
    expect(e.bonus).toBeUndefined();
    expect(m.loc).toEqual({ k: 'supply' });
    expect(s.res.wood).toBe(0);
  });
});
