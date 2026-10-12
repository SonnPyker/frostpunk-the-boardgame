// Sample populated GameState for the map: the generator tile with its five spaces, every near and far tile on its
// standard position, printed and placed buildings (small, large, ruins, upgraded), meeples in several states,
// rim deposits and a generator whose heat puts only zones A and B in heat. Used by the dev harness and by tests.
import { blankState, mapData } from '@frostpunk/engine';
import type { Building, GameState, MapTile, Meeple, Space } from '@frostpunk/engine';

type Res = Space['res'];

function resOf(raw: Record<string, number> | undefined): { res: Res; trees: number } {
  const res: Res = {};
  if (raw?.wood) res.wood = raw.wood;
  if (raw?.coal) res.coal = raw.coal;
  if (raw?.core) res.core = raw.core;
  return { res, trees: raw?.tree ?? 0 };
}

export function buildSampleState(): GameState {
  const base = blankState({ seed: 7, players: [{ name: 'Captain' }] });
  const mapTiles: any[] = (mapData as any).tiles ?? [];
  const near = mapTiles.filter((t) => t.deck === 'near');
  const far = mapTiles.filter((t) => t.deck === 'far');
  const posNear: { q: number; r: number }[] = (mapData as any).standardPositions.near;
  const posFar: { q: number; r: number }[] = (mapData as any).standardPositions.far;

  const tiles: MapTile[] = [];
  const spaces: Record<string, Space> = {};

  const addTile = (t: any, q: number, r: number, kind: 'near' | 'far') => {
    const key = `${q},${r}`;
    const ids = [`${t.id}:top`, `${t.id}:bottom`];
    tiles.push({ key, id: t.id, kind, q, r, spaces: ids, food: t.food ?? 0 });
    const top = resOf(t.top);
    const bottom = resOf(t.bottom);
    spaces[ids[0]] = { id: ids[0], tile: key, slot: 'top', res: top.res, trees: top.trees, building: null };
    spaces[ids[1]] = { id: ids[1], tile: key, slot: 'bottom', res: bottom.res, trees: bottom.trees, building: null };
  };

  near.slice(0, posNear.length).forEach((t, i) => addTile(t, posNear[i].q, posNear[i].r, 'near'));
  far.slice(0, posFar.length).forEach((t, i) => addTile(t, posFar[i].q, posFar[i].r, 'far'));

  // generator tile: five spaces on the outer hexes of the flower
  tiles.push({
    key: 'GEN',
    id: 'GEN',
    kind: 'gen',
    q: 0,
    r: 0,
    spaces: ['GEN:T', 'GEN:UR', 'GEN:LR', 'GEN:LL', 'GEN:UL'],
    food: 0,
  });
  spaces['GEN:T'] = { id: 'GEN:T', tile: 'GEN', slot: 'T', res: {}, trees: 0, building: 3 };
  spaces['GEN:UR'] = { id: 'GEN:UR', tile: 'GEN', slot: 'UR', res: { coal: 2 }, trees: 0, building: null };
  spaces['GEN:LR'] = { id: 'GEN:LR', tile: 'GEN', slot: 'LR', res: {}, trees: 0, building: 1 };
  spaces['GEN:LL'] = { id: 'GEN:LL', tile: 'GEN', slot: 'LL', res: {}, trees: 0, building: 2 };
  spaces['GEN:UL'] = { id: 'GEN:UL', tile: 'GEN', slot: 'UL', res: { wood: 2 }, trees: 0, building: null };

  const n = (i: number) => near[i]?.id ?? 'N' + String(i + 1).padStart(2, '0');
  const f = (i: number) => far[i]?.id ?? 'F' + String(i + 1).padStart(2, '0');
  const both = (id: string) => [`${id}:top`, `${id}:bottom`];

  const buildings: Building[] = [
    { uid: 1, kind: 'generator', upgraded: false, ruins: false, spaces: ['GEN:LR'], printed: true },
    { uid: 2, kind: 'platform', upgraded: false, ruins: false, spaces: ['GEN:LL'], printed: true },
    { uid: 3, kind: 'cookhouse', upgraded: false, ruins: false, spaces: ['GEN:T'], printed: true },
    { uid: 4, kind: 'workshop', upgraded: false, ruins: false, spaces: [`${n(0)}:top`] },
    { uid: 5, kind: 'sawmill', upgraded: true, ruins: false, spaces: both(n(1)) },
    { uid: 6, kind: 'tent', upgraded: false, ruins: true, spaces: [`${n(2)}:top`] },
    { uid: 7, kind: 'bunkhouse', upgraded: false, ruins: false, spaces: [`${n(2)}:bottom`] },
    { uid: 8, kind: 'coalMine', upgraded: false, ruins: false, spaces: both(n(3)) },
    { uid: 9, kind: 'cemetery', upgraded: false, ruins: false, spaces: [`${n(4)}:top`] },
    { uid: 10, kind: 'beacon', upgraded: false, ruins: false, spaces: both(f(0)) },
  ];
  for (const b of buildings) {
    for (const sid of b.spaces) if (spaces[sid]) spaces[sid].building = b.uid;
  }

  // clear resources and trees on occupied spaces (building placement returns them to the bank)
  for (const sp of Object.values(spaces)) {
    if (sp.building != null) {
      sp.res = {};
      sp.trees = 0;
    }
  }

  const meeples: Meeple[] = [
    { id: 1, kind: 'worker', loc: { k: 'space', space: `${n(0)}:top` } },
    { id: 2, kind: 'engineer', loc: { k: 'space', space: 'GEN:UR' } },
    { id: 3, kind: 'child', loc: { k: 'space', space: 'GEN:UL' } },
    { id: 4, kind: 'automaton', loc: { k: 'space', space: `${n(5)}:bottom` }, used: true },
    { id: 5, kind: 'worker', loc: { k: 'sleep', space: `${n(6)}:top` }, lying: true },
    { id: 6, kind: 'worker', loc: { k: 'supply' } },
    { id: 7, kind: 'childWorker', loc: { k: 'space', space: `${n(1)}:top` } },
    { id: 8, kind: 'engineer', loc: { k: 'space', space: `${n(3)}:bottom` } },
    { id: 9, kind: 'worker', loc: { k: 'space', space: `${f(2)}:top` } },
    { id: 10, kind: 'worker', loc: { k: 'space', space: `${f(4)}:bottom` } },
  ];

  const corners: { corner: number; q: number; r: number }[] = (mapData as any).rim.corners;
  const rim = corners.map((c) => ({
    corner: c.corner,
    q: c.q,
    r: c.r,
    deposit: c.corner === 1 ? ('wood' as const) : c.corner === 4 ? ('coal' as const) : null,
  }));

  return {
    ...base,
    round: 4,
    phase: 'action',
    tiles,
    spaces,
    buildings,
    nextUid: 11,
    rim,
    genCentre: [0, 0],
    meeples,
    nextMeeple: 11,
    gen: {
      ...base.gen,
      // orange threshold crossed (9 > 8) but not yellow (9 is not above 12): zones A and B heated, C cold
      heat: 9,
      ind: { red: 14, orange: 8, yellow: 12 },
    },
  };
}
