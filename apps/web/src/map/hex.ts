// Hex frame of the map. Same conventions as packages/engine/src/map.ts and data/raw/map.json:
// flat-top hexes, axial (q, r); world x = 1.5 * q * HEX, world z = sqrt(3) * HEX * (r + q / 2)
// (z grows towards the viewer's "down" on the board). Every map tile is one hex split in two spaces:
// 'top' is the northern half (z < centre), 'bottom' the southern half.
import { mapData } from '@frostpunk/engine';
import type { GameState } from '@frostpunk/engine';

export const SQRT3 = Math.sqrt(3);
/** Hex circumradius in world units. */
export const HEX = 1;
/** Distance from a tile centre to the centroid of its top or bottom half (trapezoid centroid = 4h/9). */
export const HALF_DZ = (((SQRT3 / 2) * 4) / 9) * HEX;

export interface Xz {
  x: number;
  z: number;
}

export type Slot = 'top' | 'bottom';

/** Generator tile spaces (axial offsets from the generator centre). The sixth flower hex (0,1) is the drawer / road. */
export const GEN_SLOT_OFFSET: Record<string, [number, number]> = {
  T: [0, -1],
  UR: [1, -1],
  LR: [1, 0],
  LL: [-1, 1],
  UL: [-1, 0],
};

export const FLOWER: [number, number][] = (mapData as any).generatorTile.flower as [number, number][];
export const GEN_DRAWER_OFFSET: [number, number] = [0, 1];

export const DIRS: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

export function hexXz(q: number, r: number): Xz {
  return { x: 1.5 * HEX * q, z: SQRT3 * HEX * (r + q / 2) };
}

export function halfXz(q: number, r: number, slot: Slot): Xz {
  const c = hexXz(q, r);
  return { x: c.x, z: c.z + (slot === 'top' ? -HALF_DZ : HALF_DZ) };
}

/** Axial coordinates of a generator space's hex. */
export function genSlotAxial(genCentre: [number, number], slot: string): [number, number] | null {
  const o = GEN_SLOT_OFFSET[slot];
  if (!o) return null;
  return [genCentre[0] + o[0], genCentre[1] + o[1]];
}

export function hexDist(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function cubeRound(qf: number, rf: number): [number, number] {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

/** Axial hex containing a world point on the board plane. */
export function worldToAxial(x: number, z: number): [number, number] {
  const qf = (2 / 3) * (x / HEX);
  const rf = z / (SQRT3 * HEX) - qf / 2;
  return cubeRound(qf, rf);
}

/** Zone letter (A generator tile, B adjacent, C within two hexes) as in engine map.ts tileZone. */
export function tileZone(genCentre: [number, number], q: number, r: number): 'A' | 'B' | 'C' | null {
  if (hexDist(genCentre[0], genCentre[1], q, r) === 0) return 'A';
  let best = 99;
  for (const [dq, dr] of FLOWER) best = Math.min(best, hexDist(genCentre[0] + dq, genCentre[1] + dr, q, r));
  if (best <= 1) return 'B';
  if (best <= 2) return 'C';
  return null;
}

/** Is a zone heated for the current Generator heat marker (engine map.ts zoneHeated). */
export function zoneHeated(gen: GameState['gen'], zone: 'A' | 'B' | 'C' | null): boolean {
  if (!zone) return false;
  const above = (lvl: number | null) => lvl != null && gen.heat > lvl;
  const red = above(gen.ind.red);
  const orange = above(gen.ind.orange);
  const yellow = above(gen.ind.yellow);
  if (zone === 'A') return red || orange || yellow;
  if (zone === 'B') return orange || yellow;
  return yellow;
}

/**
 * Rim corner hexes in absolute axial coordinates, as in data/raw/map.json. The Rim is fixed on the board for every
 * scenario (the engine's tiles.ts and the TTS Lua use the same values); the Generator centre does not move it.
 */
export function rimCorners(): { corner: number; q: number; r: number }[] {
  const list = ((mapData as any).rim.corners as { corner: number; q: number; r: number }[]) ?? [];
  return list.map((c) => ({ corner: c.corner, q: c.q, r: c.r }));
}
