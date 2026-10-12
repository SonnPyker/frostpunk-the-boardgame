// Boosted simulation (scripts/sim.ts --boost). OUT OF RULES, FOR TESTING ONLY, NEVER FOR PLAY.
//
// The normal bots die by round 3 to 6, so the late-game content (techs, expeditions, storms, late Dusk cards, the
// S02-S05 and S07 scenario cards and the S04 victory) is hardly exercised. This module keeps the colony alive by
// topping up the GameState directly before every decision, so the ENGINE still runs every card, tech, expedition,
// storm, law and scenario goal itself. The top-up is applied between decisions and before every engine op (sim.ts
// sets it up through setOpTrace); it never answers anything.
//
// Top-up (applied before each decision the sim asks the bot for, and before each engine op, so also at every round start):
//   food >= 40; coal and wood >= 20; core >= 10; steel 8 in Dreadnought (its start stock, DN2 limit);
//   every sick marker at 0 and off the skull side; hunger 0 (not over); corpse 0;
//   discontent tokens cleared (the removed tokens go back to the bag); hope track refilled to 6 active tokens
//   (drawn from the bag, conjured when the bag is empty); Generator stress 0, overflow 0, not broken, heat at least
//   the level that heats the yellow shelters (capped by the cold marker).
// Nothing else is changed: population, buildings, cards, decks, laws and techs are left to the engine.
//
// Bot: the pro bot (scripts/bots/pro.ts) with the scores pushed towards late-game content: Workshop first, Stockpile
// (S03/S07), deploying Scouts, adopting Laws, developing Technologies, taking an Advisor. The same repeat and cap rules
// apply, so every answer is a legal answer.
//
// Limits: a sim run with --boost is not replayable from its config and seed alone (the top-up is not a command), so a
// boosted repro line only reproduces with --boost again. Losses inside a single engine op (after its top-up) are not
// prevented by the top-up and are reported as they happen.
import type { GameState, Pending, PendingOption, HopeType, DiscType, CitizenType } from '../../src/types';
import { CITIZEN_TYPES } from '../../src/types';
import { legalPick } from '../../src/autoplay';
import { proCtx, proScore, pickBy } from './pro';
import type { ProCtx } from './pro';
import { randInt } from '../../src/rng';

type Rng = Parameters<typeof randInt>[0];

const HOPE_TYPES_LIST: HopeType[] = ['care', 'justice', 'motivation'];
const DISC_TYPES_LIST: DiscType[] = ['anger', 'apathy', 'greed'];
const HOPE_TRACK = 6;

export interface BoostStats {
  topUps: number;
  conjuredHope: number;
}
export const boostStats: BoostStats = { topUps: 0, conjuredHope: 0 };

/** Out-of-rules colony top-up. Mutates `s` in place; a no-op once the game has ended. */
export function boostTopUp(s: GameState): void {
  if (s.status !== 'playing') return;
  boostStats.topUps++;

  if (s.food < 40) s.food = 40;
  if (s.res.coal < 20) s.res.coal = 20;
  if (s.res.wood < 20) s.res.wood = 20;
  if (s.res.core < 10) s.res.core = 10;
  if (s.config.scenario === 'dreadnought') s.res.steel = 8;

  for (const t of CITIZEN_TYPES as CitizenType[]) s.sick[t] = { n: 0, skull: false };
  s.hunger = 0;
  s.hungerOver = false;
  s.corpse = 0;

  // Discontent: every token goes back to the bag, the track is empty
  for (const t of s.disc) s.discBag[t.t as DiscType] = (s.discBag[t.t as DiscType] ?? 0) + 1;
  s.disc = [];

  // Hope: all tokens on the track active, then refill the track to six from the bag (conjured when the bag is empty)
  for (const t of s.hope) t.a = true;
  let k = 0;
  while (s.hope.length < HOPE_TRACK) {
    const bagged = HOPE_TYPES_LIST.find((h) => (s.hopeBag[h] ?? 0) > 0);
    if (bagged) {
      s.hopeBag[bagged]--;
      s.hope.push({ t: bagged, a: true });
    } else {
      s.hope.push({ t: HOPE_TYPES_LIST[k % HOPE_TYPES_LIST.length], a: true });
      boostStats.conjuredHope++;
    }
    k++;
  }

  // Generator: no stress, not broken, heat on the level that keeps the yellow shelters warm (never above the cold marker)
  s.gen.stress = 0;
  s.gen.overflow = 0;
  s.gen.broken = false;
  const target = Math.min(s.gen.cold, (s.gen.ind.yellow ?? 3) + 1);
  if (s.gen.heat < target) s.gen.heat = target;
}

/** Late-game bias on top of the pro scores. Unknown decision kinds keep the pro score. */
export function boostScore(s: GameState, c: ProCtx, p: Pending, o: PendingOption): number {
  const id = o.id;
  const hasWorkshop = s.buildings.some((b) => b.kind === 'workshop' && !b.ruins);
  const hasBeacon = s.buildings.some((b) => b.kind === 'beacon' && !b.ruins);
  switch (p.kind) {
    case 'action':
      if (id === 'act:deploy') return 8; // Scouts and expeditions
      if (id.startsWith('act:special:stock')) return 8; // Stockpile (S03 / S07)
      return proScore(s, c, p, o);
    case 'buildPick':
      if (id === 'workshop') return hasWorkshop ? 4 : 10; // Workshop first: Technologies need it
      if (id === 'beacon') return hasBeacon ? 4 : 10; // Beacon: S01 round 4 (S02, S05 expedition) and Scouts/expeditions
      // the rarer building kinds, so their effects run (Coal Thumper, Factory, Hothouse, Infirmary, Wall Drill, Steam Hub)
      if (id === 'coalThumper' || id === 'factory' || id === 'wallDrill') return 6;
      if (id === 'hothouse' || id === 'infirmary' || id === 'steamHub') return 6;
      return proScore(s, c, p, o);
    case 'building':
      // Platform: the Use action that introduces a Law (custom:introduceLaw)
      if (/platform/i.test(`${o.label ?? ''} ${o.hint ?? ''}`)) return 10;
      return proScore(s, c, p, o);
    case 'law': {
      // adopt laws: any law scores at least 5 (the pro order still decides among them)
      return Math.max(5, proScore(s, c, p, o));
    }
    case 'tech':
      return proScore(s, c, p, o) + 2; // develop Technologies
    case 'advisor':
      return id === 'none' ? 1 : 7;
    case 'stockpile':
      if (id === 'ration') return 7;
      if (id === 'coal') return 6;
      return proScore(s, c, p, o);
    case 'deployScout':
    case 'expStack':
    case 'expArrive':
    case 'expExplore':
      return Math.max(6, proScore(s, c, p, o));
    default:
      return proScore(s, c, p, o);
  }
}

/** The boosted bot's answer for one pending decision (null only when no legal pick exists). */
export function boostPick(st: Rng, s: GameState, p: Pending): string[] | null {
  const c = proCtx(s);
  const picked = pickBy(st, p, (o) => {
    try {
      return boostScore(s, c, p, o);
    } catch {
      return 0;
    }
  });
  return picked ?? legalPick(st, p);
}
