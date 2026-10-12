// Small helpers shared by the rules modules.
import { log } from './core';
import { buildings as bdefs, laws } from './data';
import type { CitizenType, GameState, Meeple, MeepleKind, ResKind } from './types';

export const RES_KINDS: ResKind[] = ['wood', 'coal', 'core', 'steel'];
export const LIMITS = { citizens: 50, food: 50, hunger: 50, automatons: 6, perSpace: 5, steel: 8, trees: 30 };

export function leaderWho(s: GameState) {
  return s.leader;
}
export function turnWho(s: GameState) {
  return s.turn;
}
export function pname(s: GameState, i: number) {
  return s.players[i]?.name ?? `Player ${i + 1}`;
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** citizen type a meeple belongs to for sickness / feeding (null = automaton) */
export function citizenTypeOf(kind: MeepleKind): CitizenType | null {
  switch (kind) {
    case 'worker':
      return 'worker';
    case 'engineer':
      return 'engineer';
    case 'child':
    case 'childWorker':
    case 'childEngineer':
      return 'child';
    default:
      return null;
  }
}
/** the "role" a meeple plays when acting */
export function roleOf(kind: MeepleKind): 'worker' | 'engineer' | 'child' | 'automaton' {
  switch (kind) {
    case 'childWorker':
      return 'worker';
    case 'childEngineer':
      return 'engineer';
    default:
      return kind as any;
  }
}

export function res(s: GameState, k: ResKind) {
  return s.res[k] ?? 0;
}

export function gainRes(s: GameState, k: ResKind | 'food', n: number, quiet = false): number {
  if (n <= 0) return 0;
  let got = n;
  if (k === 'food') {
    const room = LIMITS.food - s.food;
    got = Math.min(n, Math.max(0, room));
    s.food += got;
  } else if (k === 'steel') {
    const room = LIMITS.steel - s.res.steel;
    got = Math.min(n, Math.max(0, room));
    s.res.steel += got;
  } else {
    s.res[k] += n;
  }
  if (!quiet && got > 0) log(s, 'gain.' + k, `+${got} ${k}`, { k, n: got });
  return got;
}

export function spendRes(s: GameState, k: ResKind | 'food', n: number): boolean {
  if (n <= 0) return true;
  if (k === 'food') {
    if (s.food < n) return false;
    s.food -= n;
  } else {
    if (s.res[k] < n) return false;
    s.res[k] -= n;
  }
  log(s, 'spend.' + k, `-${n} ${k}`, { k, n });
  return true;
}

export function totalSupplyRes(s: GameState) {
  return s.res.wood + s.res.coal + s.res.core + s.res.steel;
}

// ---- meeples --------------------------------------------------------------------------------------------

export function meepleById(s: GameState, id: number): Meeple | undefined {
  return s.meeples.find((m) => m.id === id);
}
export function meeplesAtSpace(s: GameState, spaceId: string): Meeple[] {
  return s.meeples.filter((m) => m.loc.k === 'space' && m.loc.space === spaceId);
}
export function inSupply(s: GameState, kind?: MeepleKind): Meeple[] {
  return s.meeples.filter((m) => (m.loc.k === 'supply' || m.loc.k === 'scout') && (!kind || m.kind === kind));
}
/**
 * L17 Emergency Shift (laws.json perm.actionOncePerRound.returnedMeeplesUsableThisRound): Meeples returned to the supply by
 * the law's action may be used in the same Round. Read here, from the law in play and not covered.
 */
export function returnedMeeplesUsable(s: GameState): boolean {
  return s.laws.some((l) => !l.covered && !!(bdefLaw(l.id)?.perm?.actionOncePerRound?.returnedMeeplesUsableThisRound));
}
function bdefLaw(id: string): any {
  return (laws as Record<string, any>)[id];
}

/**
 * Meeples that may be placed now. A Meeple returned to the supply during this Round (see `returnedRound`, set by
 * fx/tokens_people.ts spentReturn2) is not free unless a law says returned Meeples are usable this Round (L17).
 */
export function freeSupply(s: GameState, kind?: MeepleKind): Meeple[] {
  const usable = returnedMeeplesUsable(s);
  return s.meeples.filter(
    (m) => m.loc.k === 'supply' && (!kind || m.kind === kind) && (usable || m.returnedRound !== s.round),
  );
}
export function newMeeple(s: GameState, kind: MeepleKind): Meeple {
  const m: Meeple = { id: ++s.nextMeeple, kind, loc: { k: 'supply' } };
  s.meeples.push(m);
  return m;
}
export function removeMeeple(s: GameState, id: number) {
  const i = s.meeples.findIndex((m) => m.id === id);
  if (i >= 0) s.meeples.splice(i, 1);
}
export function toSupply(s: GameState, m: Meeple) {
  m.loc = { k: 'supply' };
  delete m.used;
  delete m.lying;
}

// ---- buildings ------------------------------------------------------------------------------------------

export function bdef(kind: string) {
  const d = bdefs[kind];
  if (d) return d;
  if (kind === 'dreadnoughtTile')
    return {
      id: 'dreadnoughtTile',
      name: 'Dreadnought',
      size: 'S' as const,
      ins: 'B' as const,
      action: { cost: [], fx: ['gain:steel:1'] },
    } as any;
  throw new Error('unknown building ' + kind);
}
export function buildingByUid(s: GameState, uid: number | null | undefined) {
  if (uid == null) return undefined;
  return s.buildings.find((b) => b.uid === uid);
}
export function buildingAtSpace(s: GameState, spaceId: string) {
  const sp = s.spaces[spaceId];
  return sp ? buildingByUid(s, sp.building) : undefined;
}
export function buildingsOfKind(s: GameState, kind: string) {
  return s.buildings.filter((b) => b.kind === kind);
}
export function hasBuilt(s: GameState, kind: string) {
  return s.buildings.some((b) => b.kind === kind && !b.ruins);
}
export function hasLaw(s: GameState, id: string) {
  return s.laws.some((l) => l.id === id && l.covered == null) || s.laws.some((l) => l.id === id);
}
/** law is in play and not covered by a consequence card */
export function lawActive(s: GameState, id: string) {
  return s.laws.some((l) => l.id === id && l.covered == null);
}
export function techDone(s: GameState, id: string) {
  return s.techs.some((t) => t.id === id && t.state === 'done');
}

/** Hunting symbols: Hunter's Hut 1 (upgraded 2) + event passives (D064) */
export function huntingSymbols(s: GameState): number {
  let n = 0;
  for (const b of s.buildings) {
    if (b.kind !== 'huntersHut' || b.ruins) continue;
    n += b.upgraded ? 2 : 1;
  }
  if (s.events.some((e) => e.card === 'D064')) n += 1;
  return n;
}

export function unique<T>(a: T[]): T[] {
  return Array.from(new Set(a));
}
export function sum(a: number[]) {
  return a.reduce((x, y) => x + y, 0);
}
export function cap(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
export function typeName(t: string) {
  return cap(t);
}
/** English indefinite article for a noun phrase: 'a Worker', 'an Engineer'. */
export function aAn(word: string) {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}
/** '1 Resource' / '3 Resources'. */
export function nRes(n: number) {
  return `${n} Resource${n === 1 ? '' : 's'}`;
}
