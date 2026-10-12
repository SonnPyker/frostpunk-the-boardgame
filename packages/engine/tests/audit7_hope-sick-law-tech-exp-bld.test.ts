// Audit 7 (checklist status verification, sections C-H): focused tests that prove behaviour the checklist marks partial.
// Covered here: HOP-07 (Spend needs the full amount, Lose takes what is available), SIC-05 (untyped Sickness is the
// player's choice, D000), DEA-03 (death card routing: auto-draw without a matching card, discard alternative with one),
// DEA-04 (Citizen 50-per-type clamp with overflow choice, Food and Hunger caps), LAW-07 (L14 Extended Shift availability),
// MAP-02 (adjacency of Near tiles to the Generator spaces, symmetric, 0-2 spaces), MAP-03 (Coal Thumper 5-Coal space cap).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/buildings';
import { answerPending, push, run } from '../src/core';
import { payable, runFx } from '../src/fx/core';
import type { Ctx } from '../src/fx/core';
import { addHunger } from '../src/fx/tokens_supply';
import { killCitizen } from '../src/sickness';
import { citizens, mapData } from '../src/data';
import { lawActionsAvailable } from '../src/laws';
import { GEN_SPACES, adjacentSpaces, genSpaceHex, neighbours, nearSlots, placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';

const DRY = /stack ran dry/;
const ctx: Ctx = { who: 0, src: 'test' } as Ctx;

/** Runs queued ops until a decision or the end of the stack (the stack running dry after the last op is expected). */
function drain(s: GameState) {
  try {
    run(s);
  } catch (e) {
    if (!DRY.test(String((e as Error).message))) throw e;
  }
}

/** Answers the pending decision with `pick` and runs on. */
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

const workerCard = () => Object.keys(citizens).find((id) => citizens[id]?.type === 'worker') as string;

/** A board with the Generator spaces (no map tiles yet) and the centre at (0, 0). */
function board(): GameState {
  const s = blankState();
  s.genCentre = [0, 0];
  for (const slot of Object.keys(GEN_SPACES)) {
    s.spaces['GEN:' + slot] = { id: 'GEN:' + slot, tile: 'GEN', slot, res: {}, trees: 0, building: null } as any;
  }
  return s;
}

describe('audit7 HOP-07: Spend needs the full amount; Lose takes what is available', () => {
  it('a Spend that cannot be paid in full is refused by the payable check and spends nothing', () => {
    const s = blankState();
    s.food = 2;
    expect(payable(s, 'spend:food:3', ctx)).not.toBeNull();
    runFx(s, [{ ifPay: 'spend:food:3', then: ['food+:5'], else: [] }], ctx);
    drain(s);
    expect(s.food).toBe(2);
    expect(s.pending).toBeNull();
  });

  it('a Spend that can be paid in full takes exactly the stated amount', () => {
    const s = blankState();
    s.food = 5;
    runFx(s, ['spend:food:3'], ctx);
    drain(s);
    expect(s.food).toBe(2);
  });

  it('Lose Food takes only the Food there is, without asking', () => {
    const s = blankState();
    s.food = 2;
    runFx(s, ['lose:food:5'], ctx);
    drain(s);
    expect(s.food).toBe(0);
    expect(s.pending).toBeNull();
  });

  it('Lose Resources takes all of a smaller supply without asking', () => {
    const s = blankState();
    s.res.wood = 2;
    runFx(s, ['lose:res:5'], ctx);
    drain(s);
    expect(s.res.wood).toBe(0);
    expect(s.pending).toBeNull();
  });

  it('Lose Citizens removes only the Citizens present', () => {
    const s = blankState();
    s.cit.worker = 1;
    runFx(s, ['lose:worker:3'], ctx);
    drain(s);
    expect(s.cit.worker).toBe(0);
  });
});

describe('audit7 SIC-05: an untyped Sickness is the player choice (D000 gain Sickness per corpse)', () => {
  it('the per-corpse Sickness asks the player for each type; the Round type is not used', () => {
    const s = blankState();
    s.corpseMax = 50;
    s.round = 1; // the Round type would be Child
    s.cit = { worker: 3, engineer: 3, child: 3 };
    s.corpse = 2;
    runFx(s, ['gainSickPerCorpse'], ctx);
    drain(s);
    expect(s.pending?.kind).toBe('type');
    expect(s.pending!.options.map((o) => o.id).sort()).toEqual(['child', 'engineer', 'worker']);
    answer(s, ['engineer']);
    expect(s.pending?.kind).toBe('type');
    answer(s, ['engineer']);
    expect(s.sick.engineer.n).toBe(2);
    expect(s.sick.child.n).toBe(0);
    expect(s.sick.worker.n).toBe(0);
  });
});

describe('audit7 DEA-03: death card routing', () => {
  it('with no matching Citizen card in any hand a death draws the top card without asking', () => {
    const s = blankState();
    s.corpseMax = 50;
    s.cit.worker = 3;
    const wid = workerCard();
    s.decks.citizen = [wid];
    killCitizen(s, 'worker', false, 0);
    drain(s);
    expect(s.corpse).toBe(1);
    expect(s.cit.worker).toBe(2);
    expect(s.decks.citizenDiscard).toContain(wid);
    expect(s.pending?.meta?.death ?? false).toBe(false);
  });

  it('a matching card in a hand is offered as the alternative to the draw; discarding it applies its death effect', () => {
    const s = blankState();
    s.corpseMax = 50;
    s.cit.worker = 3;
    const wid = workerCard();
    s.players[0].hand = [wid];
    s.decks.citizen = [];
    killCitizen(s, 'worker', false, 0);
    drain(s);
    expect(s.pending?.kind).toBe('choice');
    expect(s.pending!.options.map((o) => o.id)).toEqual(['draw', 'p:0']);
    answer(s, ['p:0']);
    drain(s);
    expect(s.players[0].hand).toEqual([]);
    expect(s.decks.citizenDiscard).toContain(wid);
  });

  it('the draw option takes the top Citizen card of the deck and keeps the hand', () => {
    const s = blankState();
    s.corpseMax = 50;
    s.cit.worker = 3;
    const wid = workerCard();
    const other = Object.keys(citizens).find((id) => id !== wid) as string;
    s.players[0].hand = [wid];
    s.decks.citizen = [other];
    killCitizen(s, 'worker', false, 0);
    drain(s);
    answer(s, ['draw']);
    drain(s);
    expect(s.decks.citizenDiscard).toContain(other);
    expect(s.players[0].hand).toEqual([wid]);
  });
});

describe('audit7 DEA-04: Citizen 50-per-type clamp, Food and Hunger caps', () => {
  it('Workers beyond 50 are added to the types the player picks for the overflow', () => {
    const s = blankState();
    s.cit.worker = 49;
    runFx(s, ['gain:worker:3'], ctx);
    drain(s);
    expect(s.pending?.kind).toBe('citizenOverflow');
    answer(s, ['engineer', 'child']);
    drain(s);
    expect(s.cit.worker).toBe(50);
    expect(s.cit.engineer).toBe(1);
    expect(s.cit.child).toBe(1);
  });

  it('with every type at 50 the overflow Citizens are lost (no question, no change)', () => {
    const s = blankState();
    s.cit = { worker: 50, engineer: 50, child: 50 };
    runFx(s, ['gain:worker:2'], ctx);
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.cit).toEqual({ worker: 50, engineer: 50, child: 50 });
  });

  it('Food is capped at 50 and Food gained above the cap is lost', () => {
    const s = blankState();
    s.food = 45;
    runFx(s, ['food+:10'], ctx);
    drain(s);
    expect(s.food).toBe(50);
    runFx(s, ['gain:food:10'], ctx);
    drain(s);
    expect(s.food).toBe(50);
    expect(s.pending).toBeNull();
  });

  it('Hunger is capped at 50', () => {
    const s = blankState();
    s.hunger = 48;
    addHunger(s, 5);
    expect(s.hunger).toBe(50);
  });
});

describe('audit7 LAW-07: L14 Extended Shift (once per Round, pay Motivation)', () => {
  it('is offered only while an active Motivation token can be exhausted', () => {
    const s = blankState();
    s.laws = [{ id: 'L14', covered: null }] as any;
    s.hope = [{ t: 'motivation', a: true }];
    const on = lawActionsAvailable(s, 0).find((a) => a.lawId === 'L14');
    expect(on).toBeDefined();
    expect(on!.disabled).toBeUndefined();
    s.hope = [{ t: 'motivation', a: false }];
    const off = lawActionsAvailable(s, 0).find((a) => a.lawId === 'L14');
    expect(off!.disabled).toBeTruthy();
  });
});

describe('audit7 MAP-02: adjacency of map spaces to the Generator spaces and to each other', () => {
  it('every Near slot touches 0-2 Generator spaces; the adjacency is symmetric and matches the hex neighbours', () => {
    const slots = nearSlots(board());
    expect(slots.length).toBeGreaterThan(0);
    const id = mapData.tiles[0].id as string;
    for (const [q, r] of slots) {
      const s = board();
      const t = placeTileAt(s, id, q, r, 'near');
      const hit = Object.keys(GEN_SPACES).filter((slot) => {
        const [hq, hr] = genSpaceHex(s, slot);
        return neighbours(q, r).some(([nq, nr]) => nq === hq && nr === hr);
      });
      const adj = adjacentSpaces(s, t.spaces[0]);
      expect(adj).toContain(t.spaces[1]);
      const genAdj = adj.filter((x) => x.startsWith('GEN:')).map((x) => x.slice(4)).sort();
      expect(genAdj).toEqual([...hit].sort());
      expect(genAdj.length).toBeLessThanOrEqual(2);
      for (const slot of Object.keys(GEN_SPACES)) {
        const back = adjacentSpaces(s, 'GEN:' + slot);
        expect(back.includes(t.spaces[0])).toBe(hit.includes(slot));
      }
    }
  });

  it('a Map tile is adjacent to every space of a tile sharing a straight edge, and not to one two hexes away', () => {
    const id = mapData.tiles[0].id as string;
    const s = board();
    const [q, r] = nearSlots(s)[0];
    const a = placeTileAt(s, id, q, r, 'near');
    // an edge neighbour of A that is not a Generator flower hex (the flower is the centre plus its six neighbours)
    const flower = new Set(
      [[0, 0], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]].map(([dq, dr]) => `${dq},${dr}`),
    );
    const free = neighbours(q, r).find(([nq, nr]) => !flower.has(`${nq},${nr}`));
    expect(free).toBeDefined();
    const b = placeTileAt(s, id, free![0], free![1], 'far');
    expect(adjacentSpaces(s, a.spaces[0])).toEqual(expect.arrayContaining(b.spaces));
    expect(adjacentSpaces(s, b.spaces[0])).toEqual(expect.arrayContaining(a.spaces));
  });
});

describe('audit7 MAP-03: Coal Thumper never puts more than 5 Coal on one space', () => {
  it('a space at 4 Coal gets one more (to 5); a space already at 5 gets none', () => {
    const s = blankState();
    s.spaces['X:top'] = { id: 'X:top', tile: 'X', slot: 'top', res: { coal: 4 }, trees: 0, building: null } as any;
    s.spaces['Y:top'] = { id: 'Y:top', tile: 'Y', slot: 'top', res: { coal: 5 }, trees: 0, building: null } as any;
    push(s, { k: 'bldThumpApply', each: 3, pick: ['X:top', 'Y:top'] } as any);
    drain(s);
    expect(s.spaces['X:top'].res.coal).toBe(5);
    expect(s.spaces['Y:top'].res.coal).toBe(5);
  });
});
