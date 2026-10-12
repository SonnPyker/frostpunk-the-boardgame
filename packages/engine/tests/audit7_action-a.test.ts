// Audit 7 (action, part A): focused checks for checklist items ACT-01, ACT-04, ACT-05, ACT-06, ACT-10, ACT-11, ACT-RS4 and
// ACT-CO4 that had no direct test. Rulebook p22 (Meeples at the Action phase start), p23 (Spent tokens), p26 (Construct
// and Use), p39 (Automatons), scenario book Frozen Grove (Action phase), Citizen cards C13 and C22.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { answerPending, defOp, hasOp, push, run } from '../src/core';
import { actionMenuFor, gatherCandidates, kindOptions } from '../src/actions';
import { placeTileAt } from '../src/map';
import { placeBuilding, placementOptions, sleepSlots } from '../src/buildings';
import { initTileStacks } from '../src/tiles';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import { newMeeple } from '../src/util';
import { citizens } from '../src/data';

// phAdvance belongs to the phase module. A stub ends the phase so the Action phase can be tested alone (as in actions.test.ts).
if (!hasOp('phAdvance')) {
  defOp('phAdvance', (s) => {
    s.flags.phaseEnded = true;
  });
}

const STACK_DRY = /stack ran dry/;

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!STACK_DRY.test(String(e?.message))) throw e;
  }
}

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

/** Heat 1 (every action cold), one Near tile N01 at hex (1,0) that is adjacent to the Generator, tile stacks ready. */
function world(over: Parameters<typeof blankState>[0] = {}): GameState {
  const s = blankState(over);
  s.gen.heat = 1;
  s.gen.cold = 5;
  placeTileAt(s, 'N01', 1, 0, 'near');
  for (const id of ['N01:top', 'N01:bottom']) {
    s.spaces[id].res = {};
    s.spaces[id].trees = 0;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------
// ACT-01 Start of the Action phase: Meeples to the Citizen thresholds, then Spent tokens get supply Meeples
// ---------------------------------------------------------------------------------------------------------

describe('ACT-01 Action phase start: Meeple counts and Spent tokens', () => {
  it('2 Workers (5 Worker Citizens) fill 2 of 3 Spent Worker tokens; the third token stays empty and its Meeple cannot act', () => {
    const s = world();
    s.cit.worker = 5; // meepleCountFor(5) = 2
    s.spent = [
      { id: 1, type: 'worker', meeple: null },
      { id: 2, type: 'worker', meeple: null },
      { id: 3, type: 'worker', meeple: null },
    ];
    s.nextSpent = 3;
    push(s, { k: 'actStart' });
    drain(s);
    const workers = s.meeples.filter((m) => m.kind === 'worker');
    expect(workers).toHaveLength(2);
    const filled = s.spent.filter((t) => t.meeple != null);
    expect(filled).toHaveLength(2);
    expect(s.spent.filter((t) => t.meeple == null)).toHaveLength(1);
    for (const t of filled) {
      const m = s.meeples.find((x) => x.id === t.meeple)!;
      expect(m.loc).toEqual({ k: 'spent', token: t.id });
    }
    // a Meeple on a Spent token is not in the supply, so it is never offered to act
    expect(s.meeples.filter((m) => m.loc.k === 'supply')).toHaveLength(0);
  });

  it('a Worker count that needs 0 Meeples removes the supply Meeples again', () => {
    const s = world();
    s.cit.worker = 0;
    newMeeple(s, 'worker');
    newMeeple(s, 'worker');
    push(s, { k: 'actStart' });
    drain(s);
    expect(s.meeples.filter((m) => m.kind === 'worker')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------
// ACT-04 Main actions with one available Meeple
// ---------------------------------------------------------------------------------------------------------

describe('ACT-04 main actions with one available Meeple', () => {
  it('one free Worker offers Construct and no other Meeple is needed; once it is placed, Construct has no Meeple left', () => {
    const s = world();
    const w = newMeeple(s, 'worker');
    const before = actionMenuFor(s, 0).find((m) => m.id === 'act:construct')!;
    expect(before.disabled).toBeUndefined();
    expect(kindOptions(s, 0, 'construct').map((k) => k.kind)).toEqual(['worker']);
    w.loc = { k: 'space', space: 'N01:top' };
    const after = actionMenuFor(s, 0).find((m) => m.id === 'act:construct')!;
    expect(after.disabled).toBe('No free Meeple can take this action');
  });
});

// ---------------------------------------------------------------------------------------------------------
// ACT-05 Child Meeples: plain children take no main action without a card; child Workers act as Workers
// ---------------------------------------------------------------------------------------------------------

describe('ACT-05 Child Meeples in the Action phase', () => {
  it('a plain Child cannot Construct or Deploy; a Child Worker Meeple can Construct as a Worker', () => {
    const s = world();
    newMeeple(s, 'child');
    expect(kindOptions(s, 0, 'construct')).toEqual([]);
    expect(kindOptions(s, 0, 'deploy')).toEqual([]);
    const s2 = world();
    newMeeple(s2, 'childWorker');
    expect(kindOptions(s2, 0, 'construct').map((k) => k.kind)).toEqual(['childWorker']);
    // a Child Worker acts as a Worker, so it may also take Deploy Scouts (rulebook p39)
    expect(kindOptions(s2, 0, 'deploy').map((k) => k.kind)).toEqual(['childWorker']);
  });
});

// ---------------------------------------------------------------------------------------------------------
// ACT-06 Automatons: a Worker for 1 Coal, never on Expeditions
// ---------------------------------------------------------------------------------------------------------

describe('ACT-06 Automatons', () => {
  it('an Automaton is not offered for Deploy Scouts (Expeditions), and needs 1 Coal for a Gather', () => {
    const s = world();
    s.res.coal = 0;
    s.spaces['N01:top'].res = { wood: 2 };
    newMeeple(s, 'automaton');
    expect(kindOptions(s, 0, 'deploy')).toEqual([]);
    const gather = kindOptions(s, 0, 'gather').find((k) => k.kind === 'automaton');
    expect(gather).toBeDefined();
    expect(gather!.normalOk).toBe(true);
    expect(gather!.disabled).toBe('An Automaton needs 1 Coal');
    s.res.coal = 1;
    const paid = kindOptions(s, 0, 'gather').find((k) => k.kind === 'automaton')!;
    expect(paid.disabled).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------
// ACT-10 Field Kitchen: a shelter on its tile is heated at Night (rulebook p44, Faith Law buildings)
// ---------------------------------------------------------------------------------------------------------

describe('ACT-10 Field Kitchen heats a shelter on its tile at Night', () => {
  it('a House on the Field Kitchen tile sleeps in a heated shelter while the Generator is cold', () => {
    const s = world();
    s.gen.heat = 0; // cold Generator: nothing is heated by the Generator
    expect(placeBuilding(s, 'fieldKitchen', 'N01:top', { noOnBuild: true })).not.toBeNull();
    const house = placeBuilding(s, 'house', 'N01:bottom', { noOnBuild: true });
    expect(house).not.toBeNull();
    const slot = sleepSlots(s).find((x) => x.uid === house!.uid);
    expect(slot).toBeDefined();
    expect(slot!.heated).toBe(true);
    expect(slot!.capacity).toBe(2);
  });

  it('without the Field Kitchen the same House on a cold tile is not a heated shelter', () => {
    const s = world();
    s.gen.heat = 0;
    const house = placeBuilding(s, 'house', 'N01:bottom', { noOnBuild: true });
    expect(house).not.toBeNull();
    expect(sleepSlots(s).find((x) => x.uid === house!.uid)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------
// ACT-11 Frozen Grove: actions only on tiles adjacent or connected to the Generator
// ---------------------------------------------------------------------------------------------------------

/** Frozen Grove state with a connected Near tile (N01, next to the Generator) and an unconnected Far tile (F01 at hex 3,0). */
function frozenWithDisconnected(): { s: GameState; farSpaces: string[]; nearSpaces: string[] } {
  const s = blankState({ scenario: 'frozenGrove' });
  s.gen.heat = 3;
  s.gen.cold = 5;
  initTileStacks(s);
  const near = placeTileAt(s, 'N01', 1, 0, 'near');
  const far = placeTileAt(s, 'F01', 3, 0, 'far');
  return { s, nearSpaces: [...near.spaces], farSpaces: [...far.spaces] };
}

describe('ACT-11 Frozen Grove action restriction', () => {
  it('Gather Resources is not offered on an unconnected tile (existing rule, passing)', () => {
    const { s, farSpaces, nearSpaces } = frozenWithDisconnected();
    for (const sid of farSpaces) s.spaces[sid].res = { wood: 2 };
    s.spaces[nearSpaces[0]].res = { wood: 2 };
    const cands = gatherCandidates(s, 'res');
    expect(cands).toContain(nearSpaces[0]);
    for (const sid of farSpaces) expect(cands).not.toContain(sid);
  });

  it('Construct does not offer a Build space on an unconnected tile (rulebook: Frozen Grove Action phase)', () => {
    const { s, farSpaces, nearSpaces } = frozenWithDisconnected();
    const ids = placementOptions(s, 'house').map((o) => o.id);
    expect(ids).toContain(nearSpaces[0]);
    for (const sid of farSpaces) expect(ids).not.toContain(sid);
  });
});

// ---------------------------------------------------------------------------------------------------------
// ACT-RS4 Citizen-card Remove Snow variants: C13 places two Far tiles and gains 2 sick Engineers when cold
// ---------------------------------------------------------------------------------------------------------

describe('ACT-RS4 Remove Snow card variants', () => {
  it('card data: C13 sets the two-Far variant and the cold override (2 sick Engineers)', () => {
    expect((citizens as any).C13.fx).toEqual(['removeSnow:twoFar', 'coldSick:engineer:2']);
    expect((citizens as any).C08.fx).toEqual(['removeSnow:drawFar3ChooseOne']);
    expect((citizens as any).C21.fx).toEqual(['removeSnow:oneNearElseFar']);
  });

  it('playing C13 for Remove Snow on a cold Generator gains 2 sick Engineers', () => {
    const s = world();
    s.cit.engineer = 5;
    newMeeple(s, 'engineer');
    initTileStacks(s);
    s.players[0].hand = ['C13'];
    push(s, { k: 'actStart' });
    drain(s);
    answer(s, ['act:removeSnow']);
    // an Engineer may also use the normal Remove Snow, so the card is picked from the Citizen offer
    if (s.pending?.kind === 'citizen') answer(s, ['C13']);
    expect(s.players[0].playedCitizen).toBe('C13');
    expect(s.sick.engineer.n).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------
// ACT-CO4 Dreadnought Steel: a Build paid with the full Wood cost in Steel is upgraded for free (partial Steel is not)
// ---------------------------------------------------------------------------------------------------------

describe('ACT-CO4 Steel substitutes for Wood in a Build', () => {
  it('a Medical Post paid entirely in Steel is built upgraded; a mixed payment is built normal', () => {
    const run1 = (paid: { wood: number; steel: number }) => {
      const s = world({ scenario: 'dreadnought' });
      s.gen.heat = 1;
      const c = { who: 0, src: null, cont: null, free: false, filter: 'any', overRuins: false, woodDiscount: 0 };
      push(s, { k: 'bldBuildPlace', c, kind: 'medicalPost', spaceId: 'N01:top', cost: { wood: 2 }, paid } as any);
      drain(s);
      return s.buildings.find((b) => b.kind === 'medicalPost');
    };
    expect(run1({ wood: 0, steel: 2 })?.upgraded).toBe(true);
    expect(run1({ wood: 1, steel: 1 })?.upgraded).toBeFalsy();
  });
});
