// Hex geometry, adjacency, zones and heating (rulebook p9, p26, p31).
import { mapData } from './data';
import { bdef } from './util';
import type { Building, GameState, MapTile, Space } from './types';

export const DIRS: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

export const hexKey = (q: number, r: number) => `${q},${r}`;
export function hexDist(aq: number, ar: number, bq: number, br: number) {
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
export function neighbours(q: number, r: number): [number, number][] {
  return DIRS.map(([dq, dr]) => [q + dq, r + dr] as [number, number]);
}

export const GEN_SPACES: Record<string, [number, number]> = {
  T: [0, -1],
  UR: [1, -1],
  LR: [1, 0],
  LL: [-1, 1],
  UL: [-1, 0],
};
export const FLOWER: [number, number][] = mapData.generatorTile.flower;
export const RIM_RADIUS = 3; // map tiles may be placed within this distance of the Rim centre

export function flowerHexes(s: GameState): [number, number][] {
  return FLOWER.map(([dq, dr]) => [s.genCentre[0] + dq, s.genCentre[1] + dr]);
}
export function isFlowerHex(s: GameState, q: number, r: number) {
  return flowerHexes(s).some(([fq, fr]) => fq === q && fr === r);
}
export function genSpaceHex(s: GameState, slot: string): [number, number] {
  const [dq, dr] = GEN_SPACES[slot];
  return [s.genCentre[0] + dq, s.genCentre[1] + dr];
}

export function tileByKey(s: GameState, key: string): MapTile | undefined {
  return s.tiles.find((t) => t.key === key);
}
export function tileAtHex(s: GameState, q: number, r: number): MapTile | undefined {
  return s.tiles.find((t) => t.kind !== 'gen' && t.q === q && t.r === r);
}
export function tileOfSpace(s: GameState, spaceId: string): MapTile | undefined {
  const sp = s.spaces[spaceId];
  return sp ? tileByKey(s, sp.tile) : undefined;
}
export function hexOfSpace(s: GameState, spaceId: string): [number, number] {
  const sp = s.spaces[spaceId];
  if (sp.tile === 'GEN') return genSpaceHex(s, sp.slot);
  const t = tileByKey(s, sp.tile)!;
  return [t.q, t.r];
}

export function mapTiles(s: GameState): MapTile[] {
  return s.tiles.filter((t) => t.kind !== 'gen');
}

/** Is the map tile adjacent to the generator tile (touches the flower)? */
export function tileAdjacentToGenerator(s: GameState, t: MapTile): boolean {
  if (t.kind === 'gen') return true;
  return flowerHexes(s).some(([fq, fr]) => hexDist(fq, fr, t.q, t.r) === 1);
}

/** Zone letter of a tile: A (generator tile), B (adjacent), C (within 2 hexes), null (outside). */
export function tileZone(s: GameState, t: MapTile): 'A' | 'B' | 'C' | null {
  if (t.kind === 'gen') return 'A';
  let best = 99;
  for (const [fq, fr] of flowerHexes(s)) best = Math.min(best, hexDist(fq, fr, t.q, t.r));
  if (best <= 1) return 'B';
  if (best <= 2) return 'C';
  return null;
}

/** tiles connected to the generator via a chain of adjacent tiles */
export function connectedTileKeys(s: GameState): Set<string> {
  const conn = new Set<string>(['GEN']);
  const tiles = mapTiles(s);
  const queue: MapTile[] = tiles.filter((t) => tileAdjacentToGenerator(s, t));
  for (const t of queue) conn.add(t.key);
  while (queue.length) {
    const t = queue.pop()!;
    for (const [nq, nr] of neighbours(t.q, t.r)) {
      const n = tileAtHex(s, nq, nr);
      if (n && !conn.has(n.key)) {
        conn.add(n.key);
        queue.push(n);
      }
    }
  }
  return conn;
}

/**
 * Frozen Grove (ACT-11): Map-tile actions (Remove Snow, Gather, Construct, Use a Building) only on a space whose tile is
 * adjacent or connected to the Generator. Other scenarios: always true. Heating is not affected by this rule.
 */
export function spaceAllowed(s: GameState, sid: string): boolean {
  if (s.config.scenario !== 'frozenGrove') return true;
  const sp = s.spaces[sid];
  return !!sp && connectedTileKeys(s).has(sp.tile);
}

export function adjacentTiles(s: GameState, t: MapTile): MapTile[] {
  const out: MapTile[] = [];
  if (t.kind === 'gen') {
    for (const m of mapTiles(s)) if (tileAdjacentToGenerator(s, m)) out.push(m);
    return out;
  }
  for (const [nq, nr] of neighbours(t.q, t.r)) {
    const n = tileAtHex(s, nq, nr);
    if (n) out.push(n);
  }
  const gen = s.tiles.find((x) => x.kind === 'gen');
  if (gen && tileAdjacentToGenerator(s, t)) out.push(gen);
  return out;
}

/** spaces adjacent to the given space (same tile / tiles sharing an edge / generator-tile hex rules) */
export function adjacentSpaces(s: GameState, spaceId: string): string[] {
  const sp = s.spaces[spaceId];
  if (!sp) return [];
  const out = new Set<string>();
  if (sp.tile === 'GEN') {
    const [hq, hr] = genSpaceHex(s, sp.slot);
    for (const [nq, nr] of neighbours(hq, hr)) {
      const n = tileAtHex(s, nq, nr);
      if (n) for (const id of n.spaces) out.add(id);
    }
    return Array.from(out);
  }
  const t = tileByKey(s, sp.tile)!;
  for (const id of t.spaces) if (id !== spaceId) out.add(id);
  for (const [nq, nr] of neighbours(t.q, t.r)) {
    const n = tileAtHex(s, nq, nr);
    if (n) for (const id of n.spaces) out.add(id);
    // generator spaces whose outer hex is that neighbour hex
    for (const [slot, [dq, dr]] of Object.entries(GEN_SPACES)) {
      if (s.genCentre[0] + dq === nq && s.genCentre[1] + dr === nr) out.add('GEN:' + slot);
    }
  }
  return Array.from(out);
}

/** tiles adjacent to a tile, as tile objects for a space's tile */
export function tilesAdjacentToSpace(s: GameState, spaceId: string): MapTile[] {
  const sp = s.spaces[spaceId];
  if (sp.tile === 'GEN') {
    const [hq, hr] = genSpaceHex(s, sp.slot);
    return neighbours(hq, hr)
      .map(([q, r]) => tileAtHex(s, q, r))
      .filter(Boolean) as MapTile[];
  }
  return adjacentTiles(s, tileByKey(s, sp.tile)!);
}

// ---- heating --------------------------------------------------------------------------------------------

type Ind = 'red' | 'orange' | 'yellow';
function above(s: GameState, ind: Ind): boolean {
  const lvl = s.gen.ind[ind];
  return lvl != null && s.gen.heat > lvl;
}
export function insulationHeated(s: GameState, ins: string): boolean {
  if (ins === 'R') return above(s, 'red');
  if (ins === 'O') return above(s, 'orange');
  if (ins === 'Y') return above(s, 'yellow');
  return false;
}
export function zoneHeated(s: GameState, zone: 'A' | 'B' | 'C' | null): boolean {
  if (!zone) return false;
  if (zone === 'A') return above(s, 'red') || above(s, 'orange') || above(s, 'yellow');
  if (zone === 'B') return above(s, 'orange') || above(s, 'yellow');
  return above(s, 'yellow');
}

export function buildingInsulation(b: Building): string {
  const d = bdef(b.kind);
  return b.upgraded ? (d.upgIns ?? d.ins) : d.ins;
}

/** Field Kitchen on the tile / Steam Hub (with coal) on or next to the tile make the tile heated. */
export function tileForcedHeated(s: GameState, t: MapTile): boolean {
  for (const sid of t.spaces) {
    const b = s.spaces[sid].building != null ? s.buildings.find((x) => x.uid === s.spaces[sid].building) : undefined;
    if (b && b.kind === 'fieldKitchen') return true;
    if (b && b.kind === 'steamHub' && b.steamHubCoal) return true;
  }
  for (const n of adjacentTiles(s, t)) {
    for (const sid of n.spaces) {
      const b = s.spaces[sid].building != null ? s.buildings.find((x) => x.uid === s.spaces[sid].building) : undefined;
      if (b && b.kind === 'steamHub' && b.steamHubCoal) return true;
    }
  }
  return false;
}

/** Is an action on this space heated? `useBuilding` additionally considers the building's insulation. */
export function spaceHeated(s: GameState, spaceId: string, useBuilding = false): boolean {
  const sp = s.spaces[spaceId];
  if (!sp) return false;
  const t = tileByKey(s, sp.tile)!;
  if (tileForcedHeated(s, t)) return true;
  if (zoneHeated(s, tileZone(s, t))) return true;
  if (useBuilding && sp.building != null) {
    const b = s.buildings.find((x) => x.uid === sp.building);
    if (b && insulationHeated(s, buildingInsulation(b))) return true;
  }
  return false;
}

export function buildingHeated(s: GameState, b: Building): boolean {
  if (spaceHeated(s, b.spaces[0], false)) return true;
  return insulationHeated(s, buildingInsulation(b));
}

// ---- tile placement -------------------------------------------------------------------------------------

export function insideRim(q: number, r: number) {
  return hexDist(0, 0, q, r) <= RIM_RADIUS;
}
/** free hexes where a Near tile may be placed (adjacent to the generator flower) */
export function nearSlots(s: GameState): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (const [fq, fr] of flowerHexes(s)) {
    for (const [nq, nr] of neighbours(fq, fr)) {
      const k = hexKey(nq, nr);
      if (seen.has(k)) continue;
      seen.add(k);
      if (isFlowerHex(s, nq, nr)) continue;
      if (!insideRim(nq, nr)) continue;
      if (tileAtHex(s, nq, nr)) continue;
      out.push([nq, nr]);
    }
  }
  return out;
}
/** free hexes where a Far tile may be placed: adjacent to a connected tile, never adjacent to the generator tile */
export function farSlots(s: GameState): [number, number][] {
  const conn = connectedTileKeys(s);
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (const t of mapTiles(s)) {
    if (!conn.has(t.key)) continue;
    for (const [nq, nr] of neighbours(t.q, t.r)) {
      const k = hexKey(nq, nr);
      if (seen.has(k)) continue;
      seen.add(k);
      if (isFlowerHex(s, nq, nr)) continue;
      if (!insideRim(nq, nr)) continue;
      if (tileAtHex(s, nq, nr)) continue;
      if (flowerHexes(s).some(([fq, fr]) => hexDist(fq, fr, nq, nr) === 1)) continue; // would be adjacent to the generator
      out.push([nq, nr]);
    }
  }
  return out;
}

export function tileDef(id: string) {
  return mapData.tiles.find((t: any) => t.id === id);
}

/** Create a map tile (face-up) at a hex, filling resources/trees from its definition. */
export function placeTileAt(s: GameState, id: string, q: number, r: number, kind: 'near' | 'far'): MapTile {
  const def = tileDef(id);
  const key = hexKey(q, r);
  const t: MapTile = { key, id, kind, q, r, spaces: [], food: def.food ?? 0 };
  for (const slot of ['top', 'bottom'] as const) {
    const sid = `${id}:${slot}`;
    const sp: Space = { id: sid, tile: key, slot, res: {}, trees: 0, building: null };
    const d = def[slot] ?? {};
    for (const k of ['wood', 'coal', 'core'] as const) if (d[k]) sp.res[k] = d[k];
    if (d.tree) sp.trees = d.tree;
    s.spaces[sid] = sp;
    t.spaces.push(sid);
  }
  s.tiles.push(t);
  return t;
}

export function treesOnMap(s: GameState) {
  return Object.values(s.spaces).reduce((a, sp) => a + sp.trees, 0);
}

/** Does this tile touch a rim deposit of the given type? */
export function tileAdjacentToRimDeposit(s: GameState, t: MapTile, deposit: 'wood' | 'coal'): boolean {
  const adj = mapData.rim.adjacentFarTileOfCorner as Record<string, [number, number]>;
  for (const c of s.rim) {
    if (c.deposit !== deposit) continue;
    const [q, r] = adj[String(c.corner)];
    if (q === t.q && r === t.r) return true;
  }
  return false;
}

/** map spaces holding the given resource (or any) */
export function spacesWith(s: GameState, kind?: 'wood' | 'coal' | 'core'): string[] {
  return Object.values(s.spaces)
    .filter((sp) => (kind ? (sp.res[kind] ?? 0) > 0 : Object.values(sp.res).some((n) => (n ?? 0) > 0)))
    .map((sp) => sp.id);
}

export function spaceLabel(s: GameState, spaceId: string): string {
  const sp = s.spaces[spaceId];
  if (!sp) return spaceId;
  if (sp.tile === 'GEN') return 'Generator tile (' + sp.slot + ')';
  const t = tileByKey(s, sp.tile);
  return `${t?.id ?? sp.tile} ${sp.slot}`;
}
