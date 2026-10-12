// Audit 8 group buildings, ACT-CO3: the engine's dismantle flag matches the red Dismantle icon printed on the
// building art. Image evidence (apps/web/public/assets/tiles, red house-with-X glyph, top-left corner):
// Cookhouse (cookhouse.webp), Beacon (beacon.webp and beacon_back.webp), Snow Pit (field_kitchen_back.webp).
// No red icon on Field Kitchen (field_kitchen.webp), House, Tent, Bunkhouse, Workshop, or the generator tile.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import { canDismantle, placeBuilding } from '../src/buildings';
import { bdef } from '../src/util';

describe('ACT-CO3: red Dismantle icon set matches the engine', () => {
  it('buildings.json flags exactly the four printed red-icon buildings', () => {
    const red = ['cookhouse', 'beacon', 'snowPit'];
    const flagged = ['cookhouse', 'beacon', 'snowPit'].filter((id) => {
      const d: any = bdef(id);
      return !!(d.start || d.noDismantle);
    });
    expect(flagged).toEqual(red);
    expect((bdef('snowPit') as any).noDismantle).toBe(true);
    for (const id of ['fieldKitchen', 'house', 'tent', 'bunkhouse', 'workshop', 'charcoalKiln']) {
      const d: any = bdef(id);
      expect(!!(d.start || d.noDismantle)).toBe(false);
    }
  });

  it('a Snow Pit cannot be dismantled; a plain Small building can', () => {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    placeTileAt(s, 'N02', 2, 0, 'near');
    const pit = placeBuilding(s, 'snowPit', 'N01:top');
    const kiln = placeBuilding(s, 'charcoalKiln', 'N02:top');
    expect(pit).not.toBeNull();
    expect(kiln).not.toBeNull();
    expect(canDismantle(s, pit!.uid)).toBe(false);
    expect(canDismantle(s, kiln!.uid)).toBe(true);
  });

  it('Cookhouse and Beacon cannot be dismantled', () => {
    const s = blankState();
    placeTileAt(s, 'N01', 1, 0, 'near');
    const beacon = placeBuilding(s, 'beacon', 'N01:top');
    expect(beacon).not.toBeNull();
    expect(canDismantle(s, beacon!.uid)).toBe(false);
  });
});
