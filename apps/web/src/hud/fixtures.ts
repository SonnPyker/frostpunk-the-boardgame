// Rich sample GameState for the HUD harness and visual checks. Built on the engine's blankState (never mutates shared data).
// Two seats, round 9 (a Worker round), mid-game: heat 6 / cold 9, a couple of sick citizens, one developing tech, a black-side
// expedition, a waiting expedition, a covered law and a revealed weather card.
import { blankState } from '@frostpunk/engine';
import type { GameState, LogEntry, Meeple, ExpStack } from '@frostpunk/engine';

const log = (n: number, r: number, p: LogEntry['p'], t: string, m: string): LogEntry => ({ n, r, p, t, m });

const LOG: LogEntry[] = [
  log(1, 1, 'setup', 'setup.start', 'The Crater begins. Keep the city alive for 15 Rounds.'),
  log(2, 1, 'dawn', 'dawn.round', 'Round 1 begins.'),
  log(3, 1, 'morning', 'draw.morning', 'Morning event drawn: Theft.'),
  log(4, 1, 'action', 'build.done', 'Captain built a Hut.'),
  log(5, 2, 'generator', 'gen.range', 'Generator heat 3, cold 7.'),
  log(6, 3, 'action', 'gather.wood', 'Mara Vance gathered 4 wood.'),
  log(7, 4, 'weather', 'storm.warn', 'Storm card revealed: the storm marker sits on Round 12.'),
  log(8, 4, 'hunger', 'hunger.up', 'Hunger rises by 1 (food ran short).'),
  log(9, 5, 'dusk', 'hope.gain', 'Hope token gained: Care.'),
  log(10, 5, 'dusk', 'disc.gain', 'Discontent token gained: Greed.'),
  log(11, 5, 'action', 'sick.add', 'Two workers fall ill in the cold.'),
  log(12, 6, 'generator', 'fuel.add', 'Coal fuels the Generator: 2 coal spent.'),
  log(13, 6, 'generator', 'stress.add', 'Stress cube dropped on the Generator track.'),
  log(14, 6, 'night', 'die', 'One citizen dies in the night. Corpse moved to the track.'),
  log(15, 7, 'morning', 'draw.morning', 'Morning event drawn: Work Accidents.'),
  log(16, 7, 'action', 'law.pass', 'Law passed: Child Labour (covered by a consequence).'),
  log(17, 7, 'action', 'tech.start', 'Research started: Steampowered Chainsaw.'),
  log(18, 8, 'generator', 'draw.weather', 'Weather card W05 revealed.'),
  log(19, 8, 'action', 'exhaust.building', 'Mara Vance activated the Steam Hub.'),
  log(20, 8, 'action', 'activate.building', 'Captain activated the Hunting Lodge.'),
  log(21, 8, 'action', 'draw.exp', 'Expedition A sent to explore.'),
  log(22, 8, 'action', 'remove.meeple', 'Scout returned from the Expedition with 2 food.'),
  log(23, 8, 'dusk', 'law.consequence', 'Consequence card covers Child Labour.'),
  log(24, 9, 'dawn', 'dawn.round', 'Round 9 begins: a Worker round.'),
  log(25, 9, 'morning', 'draw.morning', 'Morning event drawn: Social Dispute.'),
  log(26, 9, 'generator', 'gen.range', 'Generator heat 6, cold 9. Citizens between them fall ill unless fuelled.'),
  log(27, 9, 'generator', 'stress.add', 'Two more Stress cubes dropped (7 of 10).'),
  log(28, 9, 'action', 'tech.done', 'Technology complete: Hunting Tactics.'),
  log(29, 9, 'action', 'hope.gain', 'Hope token gained: Motivation.'),
  log(30, 9, 'action', 'gather.coal', 'Captain gathered 3 coal.'),
];

function meeples(): Meeple[] {
  const m: Meeple[] = [
    { id: 1, kind: 'worker', loc: { k: 'space', space: 'N01:top' } },
    { id: 2, kind: 'worker', loc: { k: 'space', space: 'N01:top' }, used: true },
    { id: 3, kind: 'engineer', loc: { k: 'board', slot: 'construct' } },
    { id: 4, kind: 'child', loc: { k: 'sleep' }, lying: true },
    { id: 5, kind: 'childWorker', loc: { k: 'space', space: 'N02:bottom' } },
    { id: 101, kind: 'worker', loc: { k: 'scout', exp: 1 } },
    { id: 102, kind: 'engineer', loc: { k: 'scout', exp: 2 } },
    { id: 201, kind: 'automaton', loc: { k: 'supply' } },
    { id: 202, kind: 'automaton', loc: { k: 'supply' } },
    { id: 203, kind: 'automaton', loc: { k: 'supply' } },
    { id: 204, kind: 'automaton', loc: { k: 'supply' } },
    { id: 205, kind: 'automaton', loc: { k: 'card', card: 'M001' } },
    { id: 206, kind: 'automaton', loc: { k: 'card', card: 'M001' } },
  ];
  return m;
}

function expeditions(): ExpStack[] {
  return [
    {
      uid: 1,
      cards: [
        { id: 'X01', flipped: false, cont: null },
        { id: 'X02', flipped: false, cont: null },
      ],
      scout: { meeple: 101, pos: 1 },
    },
    {
      uid: 2,
      cards: [{ id: 'X15', flipped: true, cont: 0 }],
      scout: { meeple: 102, pos: 2 },
    },
    {
      uid: 3,
      cards: [{ id: 'X29', flipped: false, cont: null }],
      scout: null,
      waiting: true,
    },
  ];
}

/** A two-seat, round-9 mid-game state for the HUD. Fresh object on every call. */
export function makeHudFixture(): GameState {
  const s = blankState({
    scenario: 'crater',
    society: 1,
    difficulty: 'normal',
    mode: 'coop',
    players: [{ name: 'Captain', id: 'p0' }, { name: 'Mara Vance', id: 'p1' }],
    seed: 7,
    extraPack: false,
  });

  s.round = 9;
  s.phase = 'action';
  s.leader = 0;
  s.turn = 1;
  s.passes = 0;

  s.players[0].advisor = 'ADV_GENERATOR';
  s.players[0].hand = ['C01', 'C02', 'C03'];
  s.players[0].playedCitizen = 'C04';
  s.players[1].advisor = null;
  s.players[1].hand = ['C05', 'C06'];
  s.players[1].playedCitizen = 'C07';

  s.res = { wood: 14, coal: 9, core: 2, steel: 3 };
  s.food = 12;
  s.cit = { worker: 22, engineer: 12, child: 8 };
  s.sick = {
    worker: { n: 2, skull: false },
    engineer: { n: 1, skull: true },
    child: { n: 0, skull: false },
  };
  s.hunger = 6;
  s.hungerOver = false;
  s.corpse = 3;
  s.corpseMax = 10;

  s.hope = [
    { t: 'care', a: true },
    { t: 'justice', a: false },
    { t: 'motivation', a: true },
  ];
  s.disc = [
    { t: 'anger', a: true },
    { t: 'greed', a: false },
  ];
  s.hopeBag = { care: 2, justice: 3, motivation: 4 };
  s.discBag = { anger: 1, apathy: 2, greed: 3 };

  s.gen = {
    heat: 6,
    cold: 9,
    ind: { red: 1, orange: 2, yellow: null },
    broken: false,
    stress: 7,
    overflow: 0,
    upgraded: false,
    carry: 0,
    fuelUsedThisPhase: 0,
  };

  s.meeples = meeples();
  s.nextMeeple = 300;
  s.automatonsMax = 6;

  s.laws = [
    { id: 'L01', covered: 'L01A' },
    { id: 'L05', covered: null },
    { id: 'L12', covered: 'L12B' },
  ];
  s.removedLaws = [];
  s.futureLaws = ['L02', 'L03'];

  const techIds = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12', 'T13', 'T14', 'T15', 'T16', 'T17'];
  s.techs = techIds.map((id) => {
    if (id === 'T04') return { id, state: 'developing' as const, dueRound: 11 };
    if (['T01', 'T02', 'T03', 'T05'].includes(id)) return { id, state: 'done' as const, dueRound: null };
    return { id, state: 'inactive' as const, dueRound: null };
  });
  s.techInProgress = 'T04';

  s.events = [
    {
      uid: 1,
      card: 'M001',
      res: { coal: 2 },
      meeples: [205, 206],
      usedThisRound: false,
      usedEver: false,
    },
    {
      uid: 2,
      card: 'M005',
      res: {},
      meeples: [],
      usedThisRound: true,
      usedEver: true,
    },
  ];
  s.morningCard = 'M001';
  s.duskCard = null;

  s.weatherCard = 'W05';
  s.weatherHunt = 0;
  s.stormCard = 'S08';
  s.stormMarker = 12;
  s.stormsHit = 1;
  s.triggers = [
    { round: 10, card: 'M010', idx: 0 },
    { round: 13, card: 'M012', idx: 0 },
  ];

  s.expeditions = expeditions();
  s.nextExp = 4;
  s.stacks = { near: ['N01', 'N02'], far: ['F01'] };

  s.log = LOG;
  s.logN = LOG.length;
  s.steps = 412;

  return s;
}

/** Shared instance for quick imports. Prefer makeHudFixture() when a panel mutates its copy. */
export const HUD_FIXTURE: GameState = makeHudFixture();
