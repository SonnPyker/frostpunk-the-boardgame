// Regression tests for the audit batch setup-phases-advisors-steel:
// setup-01 (Dreadnought steel), players-03 (Advisors at the table), players-05 (seat order of the Citizen discard),
// players-02 (solo Call to Rise is a choice), scenarios-04 (no round-limit defeat), evening-02 (DUSK PHASE in any order).
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
import { answerPending, push, run } from '../src/core';
import { runFx } from '../src/fx/core';
import type { Ctx } from '../src/fx/core';
import * as D from '../src/data';
import { createGame, answer } from '../src/index';
import { checkEnd, scenarioSetup } from '../src/scenario';
import { blankState } from '../src/testing';
import { legalPick } from '../src/autoplay';
import { seedRng } from '../src/rng';
import { LIMITS } from '../src/util';
import type { GameConfig, GameState } from '../src/types';

/** Drain the stack; an empty stack is normal when a test ends on purpose. */
function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** Applies an answer and asserts it was accepted; an empty stack afterwards is normal in these unit tests. */
function answerOk(s: GameState, who: number, pick: string[]) {
  const pendingId = s.pending!.id;
  let r: { ok: boolean; error?: string } = { ok: true };
  try {
    r = answerPending(s, who, pendingId, pick);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
  expect(r.ok, r.error).toBe(true);
}

const ctx = (s: GameState, over: Partial<Ctx> = {}): Ctx => ({ who: s.leader, src: 'test', ...over }) as Ctx;

/** The Advisor ids of the data, sorted: the tests pick from these instead of hard-coding names. */
const ADVISOR_IDS = Object.keys(D.advisors).sort();

function coop(players: number, advisors: (string | null)[] | undefined, seed = 11): GameConfig {
  const names = ['Ann', 'Ben', 'Cy', 'Dee'].slice(0, players).map((name) => ({ name }));
  return { scenario: 'crater', society: 1, difficulty: 'normal', mode: 'coop', players: names, seed, extraPack: false, advisors };
}

// ---- setup-01: Dreadnought steel starts in the bank and gains are capped at the component limit (rulebook p15, p196) ----

describe('setup-01: Dreadnought steel', () => {
  it('the Dreadnought set-up starts with no steel in supply (the bank is not a counter)', () => {
    const s = blankState({ scenario: 'dreadnought' });
    scenarioSetup(s);
    expect(s.res.steel).toBe(0);
  });

  it('a steel gain stops at the component limit (LIMITS.steel = 8)', () => {
    expect(LIMITS.steel).toBe(8);
    const s = blankState({ scenario: 'dreadnought' });
    scenarioSetup(s);
    runFx(s, ['gain:steel:10'], ctx(s));
    drain(s);
    expect(s.res.steel).toBe(8);
    runFx(s, ['gain:steel:1'], ctx(s));
    drain(s);
    expect(s.res.steel).toBe(8);
  });
});

// ---- players-03: Advisors at the table are validated and dealt only from the chosen pool (rulebook p15) ----------------

describe('players-03: Advisors at the table', () => {
  const [a, b, c] = ADVISOR_IDS;

  it('rejects an unknown Advisor in the table', () => {
    expect(() => createGame(coop(2, ['NOT_AN_ADVISOR', a]))).toThrow(/unknown Advisor/);
  });

  it('rejects the same Advisor chosen twice', () => {
    expect(() => createGame(coop(2, [a, a]))).toThrow(/chosen twice/);
  });

  it('a solo game takes one Advisor, not two', () => {
    const cfg: GameConfig = { ...coop(1, [a, b]), mode: 'solo' };
    expect(() => createGame(cfg)).toThrow(/one Advisor/);
  });

  it('a table smaller than the number of players is rejected', () => {
    expect(() => createGame(coop(3, [a, b]))).toThrow(/at least 3 Advisors/);
  });

  it('the seats are dealt only from the chosen table, one each, with no repeats', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = createGame(coop(2, [a, b], seed));
      const dealt = s.players.map((p) => p.advisor);
      expect([...dealt].sort()).toEqual([a, b].sort());
    }
  });

  it('a larger table than the players deals each seat a distinct Advisor from the table only', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = createGame(coop(2, [a, b, c], seed));
      const dealt = s.players.map((p) => p.advisor as string);
      expect(new Set(dealt).size).toBe(2);
      for (const id of dealt) expect([a, b, c]).toContain(id);
    }
  });

  it('with no table choice every seat gets an Advisor from the whole list', () => {
    const s = createGame(coop(2, undefined, 4));
    for (const p of s.players) expect(ADVISOR_IDS).toContain(p.advisor);
    expect(s.players[0].advisor).not.toBe(s.players[1].advisor);
  });
});

// ---- players-05: the Citizen-card discard runs in a random seat order (rulebook p15 tie-break) ---------------------------

describe('players-05: seat order of the set-up Citizen discard', () => {
  it('the first seat asked to discard varies with the seed', () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const s = createGame({ ...coop(2, undefined, seed), scenario: 'frozenGrove' });
      const st = seedRng(seed * 7);
      let guard = 0;
      while (s.pending && s.pending.kind !== 'citizenDiscard' && guard++ < 50) {
        const p = s.pending;
        const pick = legalPick(st, p);
        expect(pick).not.toBeNull();
        const r = answer(s, p.who >= 0 ? p.who : s.leader, p.id, pick!);
        expect(r.ok, r.error).toBe(true);
      }
      expect(s.pending?.kind).toBe('citizenDiscard');
      firsts.add(s.pending!.who);
    }
    expect(firsts.size).toBe(2);
  });
});

// ---- players-02: solo Call to Rise is an optional choice in the Preparation Phase (rulebook p31, PRE-03) ---------------

describe('players-02: solo Call to Rise', () => {
  function soloWithHope(hopeTokens: number) {
    const s = blankState({ mode: 'solo', players: [{ name: 'Captain' }], seed: 3 });
    s.hope = Array.from({ length: hopeTokens }, () => ({ t: 'care', a: true })) as any;
    s.decks.citizen = Object.keys(D.citizens).sort().slice(0, 6);
    return s;
  }

  it('asks whether to play it now or keep it, when there is at least 1 Hope token', () => {
    const s = soloWithHope(2);
    push(s, { k: 'phCallToRise' });
    drain(s);
    expect(s.pending?.kind).toBe('choice');
    expect(s.pending?.who).toBe(0);
    expect(s.pending?.options.map((o) => o.id)).toEqual(['play', 'keep']);
  });

  it('playing it draws the number of Citizen cards the Hope table gives (2 Hope = 2 cards) and uses the card', () => {
    const s = soloWithHope(2);
    const deckBefore = s.decks.citizen.length;
    push(s, { k: 'phCallToRise' });
    drain(s);
    answerOk(s, 0, ['play']);
    drain(s);
    expect(s.players[0].hand.length).toBe(2);
    expect(s.decks.citizen.length).toBe(deckBefore - 2);
    expect(s.callToRiseUsed).toBe(true);
  });

  it('keeping it draws nothing and leaves the card in play for a later Preparation Phase', () => {
    const s = soloWithHope(2);
    push(s, { k: 'phCallToRise' });
    drain(s);
    answerOk(s, 0, ['keep']);
    drain(s);
    expect(s.players[0].hand).toEqual([]);
    expect(s.callToRiseUsed).toBe(false);
  });

  it('play is not offered with 0 Hope tokens (the card cannot be played)', () => {
    const s = soloWithHope(0);
    push(s, { k: 'phCallToRise' });
    drain(s);
    if (s.pending) {
      expect(s.pending.options.find((o) => o.id === 'play')?.disabled).toBeTruthy();
    }
    expect(s.players[0].hand).toEqual([]);
    expect(s.callToRiseUsed).toBe(false);
  });

  it('a co-op game has no Call to Rise', () => {
    const s = blankState({ mode: 'coop', players: [{ name: 'A' }, { name: 'B' }], seed: 3 });
    s.hope = [{ t: 'care', a: true }, { t: 'care', a: true }] as any;
    s.decks.citizen = Object.keys(D.citizens).sort().slice(0, 4);
    push(s, { k: 'phCallToRise' });
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.callToRiseUsed).toBe(false);
  });
});

// ---- scenarios-04: the game has no round limit (rulebook p16 lose list, p30 ends only by lose or goal) ------------------

describe('scenarios-04: no round-limit defeat', () => {
  it('past Round 15 with no finale the game keeps going', () => {
    const s = blankState({ scenario: 'crater' });
    s.round = 16;
    expect(checkEnd(s)).toBe('playing');
    expect(s.status).toBe('playing');
    expect(s.endReason).toBeNull();
  });
});

// ---- evening-02: pending DUSK PHASE effects resolve in any order, the Leadership holder choosing (rulebook p27) --------

describe('evening-02: DUSK PHASE effects in any order', () => {
  const twoItems = () => [
    { list: ['gain:wood:1'], ctx: { who: 0, src: 'test' } },
    { list: ['gain:coal:1'], ctx: { who: 0, src: 'test' } },
  ];

  it('two pending DUSK PHASE effects raise a choice for the Leadership holder', () => {
    const s = blankState({ mode: 'coop', players: [{ name: 'A' }, { name: 'B' }] });
    s.leader = 1;
    push(s, { k: 'duskRuns', items: twoItems() as any });
    drain(s);
    expect(s.pending?.kind).toBe('choice');
    expect(s.pending?.who).toBe(1);
    expect(s.pending?.options.length).toBe(2);
    expect(s.res.wood).toBe(0);
    expect(s.res.coal).toBe(0);
  });

  it('the chosen effect resolves first, then the other', () => {
    const s = blankState({ mode: 'coop', players: [{ name: 'A' }, { name: 'B' }] });
    s.leader = 1;
    push(s, { k: 'duskRuns', items: twoItems() as any });
    drain(s);
    answerOk(s, 1, ['1']); // the coal effect first
    drain(s);
    const gains = s.log.filter((e: any) => String(e.t).startsWith('gain.')).map((e: any) => e.t);
    expect(gains).toEqual(['gain.coal', 'gain.wood']);
    expect(s.res.wood).toBe(1);
    expect(s.res.coal).toBe(1);
  });

  it('a single pending DUSK PHASE effect needs no decision', () => {
    const s = blankState({ mode: 'coop', players: [{ name: 'A' }, { name: 'B' }] });
    push(s, { k: 'duskRuns', items: [twoItems()[0]] as any });
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.res.wood).toBe(1);
  });
});
