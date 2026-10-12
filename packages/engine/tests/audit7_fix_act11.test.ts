// ACT-11 fix regression: Frozen Grove Construct and Use a Building are limited to tiles adjacent or connected to the
// Generator (scenario book, Frozen Grove, Action phase: Remove Snow, Gather, Construct, Use). Heating is unaffected.
// Dismantle and Destroy are not map-tile actions under this rule and are not tested here.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions';
import '../src/buildings';
import { placeTileAt, spaceAllowed } from '../src/map';
import { gatherCandidates } from '../src/actions';
import { placeBuilding, placementOptions, usableBuildings, usageProblem } from '../src/buildings';
import { initTileStacks } from '../src/tiles';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';

const NOT_CONNECTED = 'Not connected to the Generator';

/** Frozen Grove: connected Near tile N01 at hex (1,0), unconnected Far tile F01 at hex (3,0). */
function frozenWorld(): { s: GameState; nearSpaces: string[]; farSpaces: string[] } {
  const s = blankState({ scenario: 'frozenGrove' });
  s.gen.heat = 3;
  s.gen.cold = 5;
  initTileStacks(s);
  const near = placeTileAt(s, 'N01', 1, 0, 'near');
  const far = placeTileAt(s, 'F01', 3, 0, 'far');
  return { s, nearSpaces: [...near.spaces], farSpaces: [...far.spaces] };
}

describe('ACT-11 Construct: Build spaces follow the connection rule', () => {
  it('a Small building is offered on a connected tile but not on an unconnected tile', () => {
    const { s, nearSpaces, farSpaces } = frozenWorld();
    const ids = placementOptions(s, 'house').map((o) => o.id);
    expect(ids).toContain(nearSpaces[0]);
    for (const sid of farSpaces) expect(ids).not.toContain(sid);
  });

  it('a Large building (both spaces of a tile) is offered only on a connected tile', () => {
    const { s, nearSpaces, farSpaces } = frozenWorld();
    const opts = placementOptions(s, 'hothouse');
    const tileIds = opts.map((o) => o.id);
    expect(tileIds).toContain(nearSpaces[0]);
    expect(tileIds).not.toContain(farSpaces[0]);
    for (const o of opts) expect(spaceAllowed(s, o.spaces[0])).toBe(true);
  });

  it('spaceAllowed agrees with Gather: connected space allowed, unconnected space not', () => {
    const { s, nearSpaces, farSpaces } = frozenWorld();
    expect(spaceAllowed(s, nearSpaces[0])).toBe(true);
    expect(spaceAllowed(s, farSpaces[0])).toBe(false);
    for (const sid of farSpaces) s.spaces[sid].res = { wood: 2 };
    s.spaces[nearSpaces[0]].res = { wood: 2 };
    const cands = gatherCandidates(s, 'res');
    expect(cands).toContain(nearSpaces[0]);
    for (const sid of farSpaces) expect(cands).not.toContain(sid);
  });
});

describe('ACT-11 Use a Building: reason on an unconnected tile', () => {
  it('usageProblem gives the not-connected reason for a Building on an unconnected tile', () => {
    const { s, farSpaces } = frozenWorld();
    const cookhouse = placeBuilding(s, 'cookhouse', `${farSpaces[0]}`, { noOnBuild: true });
    expect(cookhouse).not.toBeNull();
    expect(usageProblem(s, cookhouse!, null, 0)).toBe(NOT_CONNECTED);
  });

  it('usableBuildings marks the unconnected Building as not usable with the same reason', () => {
    const { s, farSpaces, nearSpaces } = frozenWorld();
    const far = placeBuilding(s, 'cookhouse', farSpaces[0], { noOnBuild: true })!;
    const near = placeBuilding(s, 'cookhouse', nearSpaces[0], { noOnBuild: true })!;
    const rows = usableBuildings(s, null);
    const farRow = rows.find((r) => r.uid === far.uid);
    const nearRow = rows.find((r) => r.uid === near.uid);
    expect(farRow?.usable).toBe(false);
    expect(farRow?.reason).toBe(NOT_CONNECTED);
    expect(nearRow?.reason).not.toBe(NOT_CONNECTED);
  });
});

describe('ACT-11 scope: other scenarios are unchanged', () => {
  it('outside Frozen Grove an unconnected tile is still offered for Construct and Use', () => {
    const s = blankState({ scenario: 'crater' });
    s.gen.heat = 3;
    s.gen.cold = 5;
    initTileStacks(s);
    placeTileAt(s, 'N01', 1, 0, 'near');
    const far = placeTileAt(s, 'F01', 3, 0, 'far');
    expect(spaceAllowed(s, far.spaces[0])).toBe(true);
    expect(placementOptions(s, 'house').map((o) => o.id)).toContain(far.spaces[0]);
    const cookhouse = placeBuilding(s, 'cookhouse', far.spaces[0], { noOnBuild: true })!;
    expect(usageProblem(s, cookhouse, null, 0)).not.toBe(NOT_CONNECTED);
  });
});
