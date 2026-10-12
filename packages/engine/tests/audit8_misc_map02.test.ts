// Audit 8 (closure, group misc) MAP-02: adjacency table checked against rulebook p40 ("Adjacent spaces", "Generator tile
// Adjacency", "Adjacency with the Rim board") and the Crater set-up corner positions in map.json.
// Hex frame: axial (q, r), Generator centre (0, 0). Generator spaces: T (0,-1), UR (1,-1), LR (1,0), LL (-1,1), UL (-1,0).
// The south hex (0,1) is the drawer / road, not a space.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { mapData } from '../src/data';
import {
  GEN_SPACES,
  adjacentSpaces,
  farSlots,
  hexDist,
  insideRim,
  nearSlots,
  neighbours,
  placeTileAt,
  tileAdjacentToGenerator,
  tileAdjacentToRimDeposit,
} from '../src/map';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';

const TILE = mapData.tiles[0].id as string;
const FLOWER: [number, number][] = [[0, 0], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];

function board(): GameState {
  const s = blankState();
  s.genCentre = [0, 0];
  for (const slot of Object.keys(GEN_SPACES)) {
    s.spaces['GEN:' + slot] = { id: 'GEN:' + slot, tile: 'GEN', slot, res: {}, trees: 0, building: null } as any;
  }
  return s;
}

/** Generator spaces a map tile at (q, r) is adjacent to (sorted), read through adjacentSpaces. */
function genSpacesTouching(q: number, r: number): string[] {
  const s = board();
  const t = placeTileAt(s, TILE, q, r, 'near');
  return adjacentSpaces(s, t.spaces[0])
    .filter((x) => x.startsWith('GEN:'))
    .map((x) => x.slice(4))
    .sort();
}

describe('MAP-02: Generator-tile adjacency pairs (rulebook p40, Generator tile adjacency)', () => {
  // Ring-2 (Near) positions around the flower, with the Generator spaces each one shares an edge with.
  // Hand-derived from the hex neighbours; the (0,1) south hex is not a space, so (0,2) touches none.
  const PAIRS: [number, number, string[]][] = [
    [0, -2, ['T']],
    [1, -2, ['T', 'UR']],
    [2, -2, ['UR']],
    [2, -1, ['LR', 'UR']],
    [2, 0, ['LR']],
    [1, 1, ['LR']],
    [0, 2, []],
    [-1, 2, ['LL']],
    [-2, 2, ['LL']],
    [-2, 1, ['LL', 'UL']],
    [-2, 0, ['UL']],
    [-1, -1, ['T', 'UL']],
  ];

  it.each(PAIRS)('the map tile at (%i,%i) is adjacent to the Generator spaces %j', (q, r, want) => {
    expect(genSpacesTouching(q, r)).toEqual([...want].sort());
  });

  it('the pairs are the Near positions of the standard layout (map.json standardPositions.near)', () => {
    const near = mapData.standardPositions.near.map((p: any) => `${p.q},${p.r}`).sort();
    expect(PAIRS.map(([q, r]) => `${q},${r}`).sort()).toEqual(near);
  });

  it('no map tile touches more than two Generator spaces', () => {
    for (const [q, r] of neighbours(0, 0).flatMap(([a, b]) => neighbours(a, b))) {
      if (FLOWER.some(([fq, fr]) => fq === q && fr === r)) continue;
      expect(genSpacesTouching(q, r).length).toBeLessThanOrEqual(2);
    }
  });

  it('the relation is symmetric: a Generator space lists exactly the map spaces whose tile touches its hex', () => {
    const s = board();
    // one distinct tile definition per hex (space ids are built from the definition id)
    nearSlots(s).forEach(([q, r], i) => placeTileAt(s, mapData.tiles[i].id as string, q, r, 'near'));
    for (const slot of Object.keys(GEN_SPACES)) {
      const back = adjacentSpaces(s, 'GEN:' + slot).sort();
      const [hq, hr] = [GEN_SPACES[slot][0], GEN_SPACES[slot][1]];
      const want = s.tiles
        .filter((t) => t.kind !== 'gen' && neighbours(hq, hr).some(([nq, nr]) => nq === t.q && nr === t.r))
        .flatMap((t) => t.spaces)
        .sort();
      expect(back).toEqual(want);
    }
  });

  it('Generator spaces are never adjacent to each other', () => {
    const s = board();
    for (const slot of Object.keys(GEN_SPACES)) {
      const adj = adjacentSpaces(s, 'GEN:' + slot);
      expect(adj.filter((x) => x.startsWith('GEN:'))).toEqual([]);
    }
  });

  it('a tile on the south (drawer) hex is generator-adjacent but touches no Generator space', () => {
    const s = board();
    const t = placeTileAt(s, TILE, 0, 2, 'near');
    expect(tileAdjacentToGenerator(s, t)).toBe(true);
    expect(adjacentSpaces(s, t.spaces[0]).some((x) => x.startsWith('GEN:'))).toBe(false);
  });
});

describe('MAP-02: slot geometry (rulebook p9, p26: Near tiles touch the Generator, Far tiles do not)', () => {
  it('every Near slot touches the flower; every Far slot is at least two hexes from every flower hex', () => {
    const s = board();
    for (const [q, r] of nearSlots(s)) {
      expect(FLOWER.some(([fq, fr]) => hexDist(fq, fr, q, r) === 1)).toBe(true);
      expect(insideRim(q, r)).toBe(true);
    }
    for (const [q, r] of farSlots(s)) {
      expect(FLOWER.some(([fq, fr]) => hexDist(fq, fr, q, r) <= 1)).toBe(false);
      expect(insideRim(q, r)).toBe(true);
    }
  });
});

describe('MAP-02: Rim board adjacency (rulebook p40 "Adjacency with the Rim board")', () => {
  const corners: { corner: number; q: number; r: number }[] = mapData.rim.corners;
  const farOfCorner = mapData.rim.adjacentFarTileOfCorner as Record<string, [number, number]>;

  it('each Rim corner has exactly one ring-3 hex next to it, and that hex is the one used for the Rim adjacency', () => {
    for (const c of corners) {
      const inward = neighbours(c.q, c.r).filter(([q, r]) => hexDist(0, 0, q, r) === 3);
      expect(inward).toHaveLength(1);
      expect(farOfCorner[String(c.corner)]).toEqual(inward[0]);
    }
  });

  it('the Crater corner Far positions match the Rim adjacency tile (map.json boards.crater.corners)', () => {
    for (const c of mapData.boards.crater.corners) {
      expect(farOfCorner[String(c.corner)]).toEqual(c.farPos);
    }
  });

  it('a tile counts as adjacent to a Deposit only on the tile that shares the Rim edge at that corner', () => {
    const s = board();
    s.rim = corners.map((c) => ({ corner: c.corner, q: c.q, r: c.r, deposit: c.corner === 1 ? 'coal' : null }));
    const [q1, r1] = farOfCorner['1'];
    const atCorner = placeTileAt(s, TILE, q1, r1, 'far');
    expect(tileAdjacentToRimDeposit(s, atCorner, 'coal')).toBe(true);
    expect(tileAdjacentToRimDeposit(s, atCorner, 'wood')).toBe(false);
    // the neighbouring tiles do not share the Deposit's Rim edge
    for (const [q, r] of [[1, -3], [-1, -2]] as [number, number][]) {
      const t = { ...atCorner, q, r };
      expect(tileAdjacentToRimDeposit(s, t as any, 'coal')).toBe(false);
    }
    // a tile at another corner's Far position is not adjacent to this Deposit
    const [q2, r2] = farOfCorner['4'];
    expect(tileAdjacentToRimDeposit(s, { ...atCorner, q: q2, r: r2 } as any, 'coal')).toBe(false);
  });
});
