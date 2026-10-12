// Audit 7: verification of the open and partial items of docs/RULES_CHECKLIST.md sections A (Setup), 1 (Dawn) and
// 2 (Morning). Items that the code already covers are pinned here; `it.fails` marks a known rules gap (it passes while the
// gap exists and must be flipped to `it` when the gap is closed).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions';
import '../src/generator';
import '../src/sickness';
import '../src/tech';
import '../src/cards';
import '../src/expedition';
import '../src/phases';
import '../src/night';
import '../src/scenario';
import { answerPending, push, run } from '../src/core';
import { feasible } from '../src/fx/core';
import type { Ctx } from '../src/fx/core';
import * as D from '../src/data';
import { createGame, newGameState } from '../src/setup';
import { fireDawnTriggers, scenarioSetup } from '../src/scenario';
import { eventOf, placeEvent, removeEventCard } from '../src/cards';
import { blankState } from '../src/testing';
import type { CitizenType, GameConfig, GameState } from '../src/types';

const DRY = /stack ran dry/;

/** Drain the op stack. An empty stack is the normal end in these unit tests. */
function drain(s: GameState) {
  try {
    run(s);
  } catch (e) {
    if (!DRY.test(String((e as Error).message))) throw e;
  }
}

/** Answer the pending decision. The continuation runs past the end of the unit-test stack, which is not a rules error:
 *  the answer is already applied when that dry-stack error is thrown, so it is ignored here. */
function answer(s: GameState, pick: string[]) {
  const p = s.pending!;
  try {
    answerPending(s, p.who, p.id, pick);
  } catch (e) {
    if (!DRY.test(String((e as Error).message))) throw e;
  }
}

function cfg(scenario: GameConfig['scenario'], seed: number, extraPack = false): GameConfig {
  return { scenario, society: 1, difficulty: 'normal', mode: 'solo', players: [{ name: 'Captain' }], seed, extraPack };
}

/** A unit-test state with the scenario set-up hook applied (no phase machine, no set-up discards). */
function scenarioState(scenario: GameConfig['scenario'] = 'crater'): GameState {
  const s = blankState({ scenario });
  scenarioSetup(s);
  return s;
}

function building(s: GameState, kind: string) {
  const b = { uid: s.nextUid++, kind, upgraded: false, ruins: false, spaces: [] as string[] };
  s.buildings.push(b as any);
  return b;
}

const ctxOf = (s: GameState): Ctx => ({ who: s.leader, src: 'test' }) as Ctx;

// ---- SET-08, SET-17, SET-19, SET-16, SET-15: the set-up state ------------------------------------------------------

describe('SET-08 round, Storm marker and Morning deck at set-up', () => {
  it('Round marker starts on 1, Storm marker on 9, storm card S08 (Crater)', () => {
    const s = createGame(cfg('crater', 7));
    expect(s.round).toBe(1);
    expect(s.stormMarker).toBe(9);
    expect(s.stormCard).toBe('S08');
  });

  it('the Morning deck is shuffled: two seeds give two different orders of the same 32 cards', () => {
    const a = createGame(cfg('crater', 7)).decks.morning;
    const b = createGame(cfg('crater', 8)).decks.morning;
    expect([...a].sort()).toEqual([...b].sort());
    expect(a).not.toEqual(b);
  });
});

describe('SET-19 Hunger, Stress, Heat side and Laws at set-up', () => {
  it('Hunger marker 0, Stress track empty, Heat marker on its normal side, no Laws in play', () => {
    const s = newGameState(cfg('crater', 3));
    expect(s.hunger).toBe(0);
    expect(s.hungerOver).toBe(false);
    expect(s.gen.stress).toBe(0);
    expect(s.gen.overflow).toBe(0);
    expect(s.gen.broken).toBe(false); // normal side (overheated side is `broken`)
    expect(s.gen.heat).toBe(1);
    expect(s.laws).toEqual([]);
  });
});

describe('SET-16 Technology display at set-up', () => {
  it('4 Technologies, all with an inactive Development token; T09 only in Frozen Grove', () => {
    for (let seed = 1; seed <= 8; seed++) {
      for (const sc of ['crater', 'frozenGrove', 'dreadnought'] as const) {
        const s = newGameState(cfg(sc, seed));
        expect(s.techs).toHaveLength(4);
        expect(s.techs.every((t) => t.state === 'inactive' && t.dueRound === null)).toBe(true);
        expect(s.techs.some((t) => t.id === 'T09')).toBe(sc === 'frozenGrove');
      }
    }
  });
});

describe('SET-17 Scenario set-up: S01 face up, triggers, Storm card', () => {
  it('Crater: S01 face up, Scenario Trigger tokens on 4 and 11, Storm card S08 set aside', () => {
    const s = newGameState(cfg('crater', 5));
    expect(s.scenarioDisplay).toEqual(['S01']);
    expect(s.triggers.map((t) => t.round).sort((a, b) => a - b)).toEqual([4, 11]);
    expect(s.stormCard).toBe('S08');
  });

  it('Frozen Grove: Storm card S09 (not S08); the same trigger tokens as Crater', () => {
    const s = newGameState(cfg('frozenGrove', 5));
    expect(s.stormCard).toBe('S09');
    expect(s.triggers.map((t) => t.round).sort((a, b) => a - b)).toEqual([4, 11]);
  });
});

describe('SET-15 Expedition decks and the three starting A stacks', () => {
  it('three stacks, each starting with one A card (white side up), in every playable scenario', () => {
    for (const sc of ['crater', 'frozenGrove', 'dreadnought'] as const) {
      const s = newGameState(cfg(sc, 9));
      expect(s.expeditions).toHaveLength(3);
      for (const st of s.expeditions) {
        expect(st.cards).toHaveLength(1);
        expect((D.expeditions as any)[st.cards[0].id].letter).toBe('A');
      }
      // the A deck holds the remaining A cards only
      expect(s.decks.expA.every((id) => (D.expeditions as any)[id].letter === 'A')).toBe(true);
    }
  });
});

describe('SET-14 set-up Citizen discard when no starting cost can be paid', () => {
  it('the player discards any card, ignoring the cost, and one sick Citizen of that type is added', () => {
    const s = blankState({ scenario: 'crater' });
    s.res = { wood: 0, coal: 0, core: 0, steel: 0 };
    s.food = 0;
    for (const t of ['worker', 'engineer', 'child'] as CitizenType[]) s.cit[t] = 5;
    const unpayable = Object.keys(D.citizens)
      .sort()
      .filter((id) => {
        const c: any = (D.citizens as any)[id];
        return ['worker', 'engineer', 'child'].includes(c.type) && (c.start?.length ?? 0) > 0 && feasible(s, c.start, { who: 0, src: 'setup:discard' }) !== null;
      });
    // two cards, so the decision is not auto-resolved (ask() picks the only enabled option on its own)
    expect(unpayable.length).toBeGreaterThanOrEqual(2);
    const pick = unpayable[0];
    const type = (D.citizens as any)[pick].type as CitizenType;
    s.players[0].hand = [pick, unpayable[1]];
    const before = s.sick[type].n;

    push(s, { k: 'setupDiscard', who: 0 } as any);
    drain(s);
    expect(s.pending?.kind).toBe('citizenDiscard');
    expect(s.pending!.options.every((o: any) => !o.disabled)).toBe(true); // none payable: nothing is disabled
    answer(s, [pick]);
    drain(s);

    expect(s.players[0].hand).not.toContain(pick);
    expect(s.decks.citizenDiscard).toContain(pick);
    expect(s.sick[type].n).toBe(before + 1);
  });
});

// ---- DAW-05, DAW-06: the Dawn ----------------------------------------------------------------------------------------

describe('DAW-05 Dawn text of the face-up Scenario card S06 Vox Populi', () => {
  it('without the Beacon: +1 Discontent at every Dawn while S06 is face up', () => {
    const s = scenarioState('crater');
    s.discBag = { anger: 3, apathy: 3, greed: 3 };
    s.scenarioDisplay.push('S06');
    fireDawnTriggers(s);
    drain(s);
    expect(s.disc).toHaveLength(1);
    fireDawnTriggers(s); // the text is persistent: the next Dawn repeats it
    drain(s);
    if (s.pending) answer(s, ['draw']); // the bag is no longer full: the player chooses between drawing and exhausted Greed
    drain(s);
    expect(s.disc).toHaveLength(2);
    expect(s.scenarioDisplay).toContain('S06');
  });

  it('with the Beacon built: S02 is revealed and resolved, and S06 leaves the display once S02 is resolved', () => {
    const s = scenarioState('crater');
    building(s, 'beacon');
    s.scenarioDisplay.push('S06');
    fireDawnTriggers(s);
    drain(s);
    expect(s.scenarioDisplay).toContain('S02');
    expect(s.pending?.kind).toBe('scenario');
    expect(s.disc).toHaveLength(0); // the Discontent branch is not taken
    // S02 offers options A and B; answering removes the S06 text from the display
    answer(s, ['A']);
    drain(s);
    expect(s.scenarioDisplay).not.toContain('S06');
  });
});

describe('DAW-06 the Storm is resolved in the Weather phase, not at Dawn', () => {
  it('a Dawn that moves the Round marker onto the Storm marker does not resolve a Storm', () => {
    const s = scenarioState('crater');
    s.round = 8;
    s.stormMarker = 9;
    s.stormsHit = 0;
    // scnPhase(dawn, end) runs after phDawn (LIFO: push the end hook first)
    push(s, { k: 'scnPhase', phase: 'dawn', when: 'end' } as any);
    push(s, { k: 'phDawn' } as any);
    drain(s);
    expect(s.round).toBe(9);
    expect(s.stormMarker).toBe(9);
    expect(s.stormsHit).toBe(0);
    expect(s.log.some((e: any) => e.t === 'storm.hit' || e.t === 'storm.move')).toBe(false);
  });
});

// ---- MOR-01, MOR-03, MOR-04, MOR-05, MOR-06: the Morning -------------------------------------------------------------

describe('MOR-01 a revealed Morning card resolves its instant effect (top) at once', () => {
  it('M027 Strange Noises: +1 Discontent is applied on the reveal, then the options are asked', () => {
    const s = scenarioState('crater');
    s.discBag = { anger: 3, apathy: 3, greed: 3 };
    s.decks.morning = ['M027'];
    push(s, { k: 'morningDraw' } as any);
    drain(s);
    expect(s.disc).toHaveLength(1);
    expect(s.pending?.kind).toBe('card');
    expect(s.pending!.options).toHaveLength(2);
    expect(s.log.some((e: any) => e.t === 'card.draw')).toBe(true);
  });
});

describe('MOR-04 an option that names a Dusk card adds it to the Dusk deck', () => {
  it('M003 "Send out an expedition": D005 goes to the Dusk deck, and M003 is removed', () => {
    const s = scenarioState('crater');
    s.decks.morning = ['M003'];
    push(s, { k: 'morningDraw' } as any);
    drain(s);
    expect(s.pending?.kind).toBe('card');
    answer(s, ['0']);
    drain(s);
    expect(s.decks.dusk).toContain('D005');
    expect(s.events.some((e) => e.card === 'D005')).toBe(false); // unseen: not revealed, not in the display
    expect(s.events.some((e) => e.card === 'M003')).toBe(false);
    expect(s.log.some((e: any) => e.t === 'card.remove')).toBe(true);
  });
});

describe('MOR-03 a card leaving the Event display: Meeples to supply, Resources to the bank', () => {
  it('Meeples on the card return to the supply (implemented)', () => {
    const s = scenarioState('crater');
    placeEvent(s, 'M004');
    const m = { id: s.nextMeeple++, kind: 'worker', loc: { k: 'card', card: 'M004' } } as any;
    s.meeples.push(m);
    eventOf(s, 'M004')!.meeples.push(m.id);
    removeEventCard(s, 'M004');
    expect(m.loc.k).toBe('supply');
    expect(eventOf(s, 'M004')).toBeUndefined();
  });

  // Rulebook: the bank is the stock outside the city supply, so Resources placed on a removed card leave play
  // (removeEventCard drops ev.res; the city supply s.res is untouched).
  it('Resources on the card go to the bank: they leave play and do not enter the city supply', () => {
    const s = scenarioState('crater');
    s.res.wood = 0;
    placeEvent(s, 'M004');
    eventOf(s, 'M004')!.res.wood = 2;
    removeEventCard(s, 'M004');
    expect(s.res.wood).toBe(0);
    expect(eventOf(s, 'M004')).toBeUndefined();
  });
});

describe('MOR-06 an empty Morning deck reveals nothing', () => {
  it('the Morning draw with an empty deck adds no card, no decision and no log entry', () => {
    const s = scenarioState('crater');
    s.decks.morning = [];
    push(s, { k: 'morningDraw' } as any);
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.morningCard).toBeNull();
    expect(s.log.some((e: any) => e.t === 'card.draw')).toBe(false);
    expect(s.events).toEqual([]);
  });
});
