// Set-up and API tests (rulebook pp8-15, spec §3.7 / §5.1): every scenario x society 1-6 x solo/coop x extra pack.
// Invariants of the freshly set-up city, JSON round-trip, redacted views, and replay determinism.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { hasOp } from '../src/core';
import * as D from '../src/data';
import { meepleCountFor } from '../src/data';
import { HOPE_SLOTS, DISC_SLOTS } from '../src/hope';
import { createGame, answer, autoplay, replay, serialize, deserialize, view, type Command } from '../src/index';
import { societyCardFor } from '../src/setup';
import { legalPick } from '../src/autoplay';
import { seedRng } from '../src/rng';
import { LIMITS } from '../src/util';
import type { GameConfig, GameState } from '../src/types';

const SCENARIOS = ['crater', 'frozenGrove', 'dreadnought'] as const;
const CITIZEN = ['worker', 'engineer', 'child'] as const;

function configFor(scenario: GameConfig['scenario'], society: number, mode: 'solo' | 'coop', extraPack: boolean, seed = 11): GameConfig {
  const players = mode === 'solo' ? [{ name: 'Captain' }] : [{ name: 'Ann' }, { name: 'Ben' }, { name: 'Cy' }];
  return { scenario, society, difficulty: 'normal', mode, players, seed, extraPack };
}

const setupDone = (s: GameState) => s.log.some((l) => l.t === 'setup.done');

/**
 * Answers decisions with random legal picks (the bot's `legalPick`, which respects min/max, allowRepeat and per-option caps),
 * recording the commands. Stops at `stop(s)`, when nothing is pending, or after `maxDecisions` answers.
 */
function resolveAll(s: GameState, record: Command[] = [], maxDecisions = 300, stop: (s: GameState) => boolean = () => false, seed = 1) {
  const st = seedRng(seed);
  let n = 0;
  while (s.pending && n++ < maxDecisions && !stop(s)) {
    const p = s.pending;
    const pick = legalPick(st, p);
    expect(pick, `no legal pick for ${p.kind}`).not.toBeNull();
    const who = p.who >= 0 ? p.who : s.leader;
    const r = answer(s, who, p.id, pick!);
    expect(r.ok, `decision ${p.kind}: ${r.error ?? ''}`).toBe(true);
    record.push({ who, pendingId: p.id, pick: pick! });
  }
  return record;
}

/** Answers the set-up decisions only: stops as soon as the set-up is complete (the Action phase then awaits its first decision). */
const resolveSetup = (s: GameState, record: Command[] = []) => resolveAll(s, record, 300, setupDone);

/** Invariants of the set-up before any decision (citizen discards not yet paid). */
function freshInvariants(s: GameState, cfg: GameConfig) {
  const card = societyCardFor(cfg);
  const nPlayers = cfg.players.length;
  const handSize = D.handSize[String(Math.min(4, nPlayers))];

  expect(s.status).toBe('playing');
  expect(s.round).toBe(1);
  expect(s.phase).toBe('setup');

  // population and sickness
  CITIZEN.forEach((t, i) => {
    expect(s.cit[t]).toBe(card.pop[i]);
    expect(s.sick[t].n).toBeGreaterThanOrEqual(0);
    expect(s.sick[t].n).toBeLessThanOrEqual(s.cit[t]);
  });
  expect(s.cit.worker + s.cit.engineer + s.cit.child).toBeGreaterThan(0);
  for (const t of CITIZEN) {
    const mine = s.meeples.filter((m) => m.kind === t);
    expect(mine.length).toBe(meepleCountFor(s.cit[t]));
    expect(mine.every((m) => m.loc.k === 'supply')).toBe(true);
  }
  expect(s.meeples.filter((m) => m.kind === 'automaton').length).toBe(card.automaton);
  expect(s.hunger).toBe(0);
  expect(s.corpse).toBe(card.corpse);
  expect(s.corpseMax).toBe(10);

  // resources and food
  for (const k of ['wood', 'coal', 'core', 'steel'] as const) {
    expect(Number.isInteger(s.res[k])).toBe(true);
    expect(s.res[k]).toBeGreaterThanOrEqual(0);
  }
  expect(s.res.wood).toBe(card.wood);
  expect(s.res.coal).toBe(card.coal);
  expect(s.res.core).toBe(card.cores);
  expect(s.food).toBeGreaterThanOrEqual(card.food);
  expect(s.spent).toEqual([]);

  // hope and discontent: every token is either on the track or in its bag (3 of each type = 9 per side)
  const hopeTokens = s.hope.length + Object.values(s.hopeBag).reduce((a, b) => a + b, 0);
  const discTokens = s.disc.length + Object.values(s.discBag).reduce((a, b) => a + b, 0);
  expect(hopeTokens).toBe(9);
  expect(discTokens).toBe(9);
  expect(s.hope.length).toBe(card.hope[0]);
  expect(s.disc.length).toBe(card.discontent[0]);
  expect(s.hope.filter((t) => t.a).length).toBe(card.hope[1]);
  expect(s.disc.filter((t) => t.a).length).toBe(card.discontent[1]);
  expect(s.hope.length).toBeLessThanOrEqual(HOPE_SLOTS);
  expect(s.disc.length).toBeLessThanOrEqual(DISC_SLOTS);

  // generator: indicators, heat, cold, stress; Generator-tile spaces and printed buildings
  expect(s.gen.heat).toBe(D.heatRangeSetup.heat);
  expect(s.gen.cold).toBe(D.heatRangeSetup.cold);
  expect(s.gen.ind).toEqual({ red: 1, orange: 2, yellow: 3 });
  expect(s.gen.stress).toBe(0);
  expect(s.gen.broken).toBe(false);
  const genSpaces = Object.values(s.spaces).filter((sp) => sp.tile === 'GEN');
  expect(genSpaces.map((sp) => sp.slot).sort()).toEqual(['LL', 'LR', 'T', 'UL', 'UR']);
  expect(s.spaces['GEN:UL'].res.wood).toBe(5);
  expect(s.spaces['GEN:UR'].res.coal).toBe(5);
  const gb = s.buildings.filter((b) => b.spaces[0].startsWith('GEN:')).map((b) => `${b.kind}@${b.spaces[0]}`).sort();
  expect(gb).toEqual(['cookhouse@GEN:T', 'generator@GEN:LR', 'platform@GEN:LL']);
  expect(s.buildings.find((b) => b.kind === 'generator')?.printed).toBe(true);

  // map: unique tile keys, every space belongs to an existing tile, Rim has six corners
  const keys = s.tiles.map((t) => t.key);
  expect(new Set(keys).size).toBe(keys.length);
  for (const t of s.tiles) for (const sid of t.spaces) expect(s.spaces[sid]?.tile).toBe(t.key);
  for (const sp of Object.values(s.spaces)) {
    expect(sp.trees).toBeGreaterThanOrEqual(0);
    expect(Object.values(sp.res).every((n) => (n ?? 0) >= 0)).toBe(true);
  }
  const treeTotal = Object.values(s.spaces).reduce((a, sp) => a + sp.trees, 0);
  expect(treeTotal).toBeLessThanOrEqual(LIMITS.trees);

  // decks
  const morningCount = s.decks.morning.length;
  expect(morningCount).toBe(cfg.extraPack ? 40 : 32);
  expect(new Set(s.decks.morning).size).toBe(morningCount);
  // Dusk deck: the Inevitable card and one Social Dispute card; the Social Dispute deck keeps the other 9
  expect(s.decks.dusk.length).toBe(2);
  expect(s.decks.dusk).toContain('D000');
  expect(s.decks.social.length).toBe(9);
  expect(s.decks.weather.length).toBe(13);
  expect(s.decks.citizen.length + s.players.reduce((a, p) => a + p.hand.length, 0) + s.decks.citizenDiscard.length).toBe(30);
  const expCards = s.decks.expA.length + s.decks.expB.length + s.decks.expC.length + s.expeditions.reduce((a, e) => a + e.cards.length, 0);
  expect(expCards).toBe(40); // X01-X40 are all either in a deck or on a stack
  expect(s.expeditions.length).toBe(3);
  expect(s.expeditions.every((e) => e.cards.length === 1 && e.cards[0].id.startsWith('X'))).toBe(true);

  // players and hands
  expect(s.players.length).toBe(nPlayers);
  for (const p of s.players) expect(p.hand.length).toBe(handSize);
  expect(s.decks.citizenDiscard.length).toBe(0);
  const advisors = s.players.map((p) => p.advisor);
  expect(advisors.every((a) => typeof a === 'string')).toBe(true);
  expect(new Set(advisors).size).toBe(nPlayers);
  expect(s.leader).toBeGreaterThanOrEqual(0);
  expect(s.leader).toBeLessThan(nPlayers);

  // laws: 12 in the Future Law display, the 8 starting laws face up, consequences hidden for each
  expect(s.futureLaws.length).toBe(12);
  expect(new Set(s.futureLaws).size).toBe(12);
  expect(s.futureLaws.slice(0, 8)).toEqual(['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08']);
  for (const id of s.futureLaws) expect(s.lawConsequenceBank[id]?.length).toBe(2);
  if (!cfg.extraPack) expect(s.futureLaws.some((id) => /^L1[7-9]|^L20/.test(id))).toBe(false);

  // technologies: four on display, the Steam Hub only in Frozen Grove, all inactive
  expect(s.techs.length).toBe(4);
  expect(s.techs.every((t) => t.state === 'inactive')).toBe(true);
  expect(s.techs.some((t) => t.id === 'T09')).toBe(cfg.scenario === 'frozenGrove');
  if (!cfg.extraPack) expect(s.techs.every((t) => !/^T1[0-7]$/.test(t.id))).toBe(true);

  // scenario display, round track, storm
  expect(s.scenarioDisplay).toEqual(['S01']);
  expect(s.stormMarker).toBe(9);
  expect(s.stormCard).toBe(cfg.scenario === 'frozenGrove' ? 'S09' : 'S08');
  expect(s.triggers.map((t) => t.round)).toEqual([4, 11]);
}

/** Invariants once every set-up decision (citizen discards, corner choice) has been answered. */
function finishedInvariants(s: GameState, cfg: GameConfig) {
  const handSize = D.handSize[String(Math.min(4, cfg.players.length))];
  // Rim deposits and Dreadnought tiles are placed by the board step (Crater: after the corner choice)
  expect(s.rim.length).toBe(6);
  const deposits = s.rim.filter((r) => r.deposit).length;
  if (cfg.scenario === 'crater') expect(deposits).toBe(3);
  if (cfg.scenario === 'frozenGrove') expect(deposits).toBe(1);
  if (cfg.scenario === 'dreadnought') expect(deposits).toBe(2);
  if (cfg.scenario === 'dreadnought') expect(s.tiles.filter((t) => t.kind === 'dread').length).toBe(4);
  expect(setupDone(s)).toBe(true);
  // the Action phase has started: its first decision (the action menu) awaits the first player
  expect(s.pending?.kind).toBe('action');
  expect(s.pending?.who).toBe(s.leader);
  expect(s.phase).toBe('action');
  expect(s.round).toBe(1);
  expect(s.status).toBe('playing');
  for (const p of s.players) expect(p.hand.length).toBe(handSize - 1);
  expect(s.decks.citizenDiscard.length).toBe(cfg.players.length);
  expect(s.decks.citizen.length + s.players.reduce((a, p) => a + p.hand.length, 0) + s.decks.citizenDiscard.length).toBe(30);
  for (const k of ['wood', 'coal', 'core', 'steel'] as const) expect(s.res[k]).toBeGreaterThanOrEqual(0);
  expect(s.food).toBeGreaterThanOrEqual(0);
  const cards = [...s.players.flatMap((p) => p.hand), ...s.decks.citizenDiscard, ...s.decks.citizen];
  expect(new Set(cards).size).toBe(30);
}

describe('setup matrix: scenario x society x mode x extra pack', () => {
  for (const scenario of SCENARIOS) {
    for (let society = 1; society <= 6; society++) {
      for (const mode of ['solo', 'coop'] as const) {
        for (const extraPack of [false, true]) {
          it(`${scenario} society ${society} ${mode} extra=${extraPack}`, () => {
            const cfg = configFor(scenario, society, mode, extraPack, 100 + society);
            const s = createGame(cfg);
            freshInvariants(s, cfg);
            resolveSetup(s);
            finishedInvariants(s, cfg);
          });
        }
      }
    }
  }
});

describe('serialization, views and replay', () => {
  it('JSON round-trip is lossless at every decision point', () => {
    const cfg = configFor('crater', 2, 'coop', true, 5);
    const s = createGame(cfg);
    const commands: Command[] = [];
    let guard = 0;
    while (s.pending && guard++ < 300) {
      const j = serialize(s);
      expect(serialize(deserialize(j))).toBe(j);
      resolveAll(s, commands, 1);
    }
    expect(serialize(deserialize(serialize(s)))).toBe(serialize(s));
  });

  it('creating the same game twice gives the same state', () => {
    const cfg = configFor('frozenGrove', 4, 'coop', false, 42);
    expect(serialize(createGame(cfg))).toBe(serialize(createGame(cfg)));
  });

  it('replay of recorded commands reproduces the state exactly', () => {
    for (const scenario of SCENARIOS) {
      const cfg = configFor(scenario, 3, 'coop', true, 9);
      const s = createGame(cfg);
      const commands = resolveAll(s);
      expect(commands.length).toBeGreaterThan(0);
      expect(serialize(replay(cfg, commands))).toBe(serialize(s));
    }
  });

  it('a rejected answer leaves the game untouched', () => {
    const cfg = configFor('crater', 1, 'solo', false, 3);
    const s = createGame(cfg);
    expect(s.pending).not.toBeNull();
    const before = serialize(s);
    const r = answer(s, 0, s.pending!.id + 999, ['1']);
    expect(r.ok).toBe(false);
    expect(serialize(s)).toBe(before);
  });

  it('the view hides RNG, deck order, hidden consequences and other seats hands', () => {
    const cfg = configFor('dreadnought', 5, 'coop', true, 17);
    const s = createGame(cfg);
    resolveAll(s);
    const v: any = view(s, 1);
    expect('rng' in v).toBe(false);
    expect('stack' in v).toBe(false);
    expect('decks' in v).toBe(false);
    expect('lawConsequenceBank' in v).toBe(false);
    expect('seed' in v.config).toBe(false);
    expect(v.players[0].hand).toEqual([]);
    expect(v.players[0].handCount).toBe(s.players[0].hand.length);
    expect(v.players[1].hand).toEqual(s.players[1].hand);
    expect(v.deckCounts.morning).toBe(s.decks.morning.length);
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });

  it('pending options are only shown to the seat allowed to answer', () => {
    const cfg = configFor('crater', 1, 'coop', false, 21);
    const s = createGame(cfg);
    // crater asks the leader for the Rim corner (a decision for one seat)
    expect(s.pending).not.toBeNull();
    const p = s.pending!;
    const other = (p.who + 1) % cfg.players.length;
    const hidden: any = view(s, other);
    expect(hidden.pending.canAnswer).toBe(false);
    expect(hidden.pending.options).toEqual([]);
    const shown: any = view(s, p.who);
    expect(shown.pending.canAnswer).toBe(true);
    expect(shown.pending.options.length).toBeGreaterThan(0);
  });
});

describe('autoplay bot', () => {
  it('plays set-up matrix games with random legal picks without rejected answers', () => {
    for (const scenario of SCENARIOS) {
      for (const seed of [1, 2, 3]) {
        const s = createGame(configFor(scenario, 1 + seed, seed % 2 ? 'solo' : 'coop', seed === 3, seed));
        const r = autoplay(s, seed * 97, 400);
        if (hasOp('phStart')) {
          expect(r.stuck, r.error).toBe(false);
        } else {
          // until the phase driver is registered the game stops at the Action phase with nothing to answer
          if (r.stuck) expect(r.error).toMatch(/no pending decision/);
        }
        expect(r.decisions).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is reproducible for the same bot seed', () => {
    const cfg = configFor('crater', 6, 'coop', true, 77);
    const a = createGame(cfg);
    const b = createGame(cfg);
    autoplay(a, 5, 200);
    autoplay(b, 5, 200);
    expect(serialize(a)).toBe(serialize(b));
  });
});

describe('Survivalist Society cards (optional GameConfig.survivalist)', () => {
  const base = { scenario: 'crater', society: 2, difficulty: 'normal', mode: 'solo', players: [{ name: 'A' }], seed: 7 } as const;

  it('without the flag the normal/hard card is used (backwards compatible)', () => {
    expect(societyCardFor({ ...base, extraPack: false } as any).id).toBe('S2N');
    expect(societyCardFor({ ...base, difficulty: 'hard', extraPack: true } as any).id).toBe('S2H');
    expect(societyCardFor({ ...base, survivalist: false, extraPack: false } as any).id).toBe('S2N');
  });

  it('with the flag and extraPack the Survivalist card of the same society is used', () => {
    for (let n = 1; n <= 6; n++) {
      expect(societyCardFor({ ...base, society: n, survivalist: true, extraPack: true } as any).id).toBe(`S${n}S`);
    }
  });

  it('the flag needs the extra pack, and must be a boolean', () => {
    expect(() => createGame({ ...base, survivalist: true, extraPack: false } as any)).toThrow(/extra pack/);
    expect(() => createGame({ ...base, survivalist: 'yes', extraPack: true } as any)).toThrow(/boolean/);
  });

  it('a Survivalist game is set up from the Survivalist card (S2S: population 13/13/4, food 3)', () => {
    const s = createGame({ ...base, survivalist: true, extraPack: true } as any);
    expect(s.config.survivalist).toBe(true);
    expect(s.status).toBe('playing');
    const card = D.societies.find((c: any) => c.id === 'S2S') as any;
    expect(card.pop).toEqual([13, 13, 4]);
    expect(card.food).toBe(3);
    expect(s.cit).toEqual({ worker: 13, engineer: 13, child: 4 });
  });
});
