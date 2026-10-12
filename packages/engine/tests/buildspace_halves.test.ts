// Build site decisions for a Large building: one option per half of the tile, so the map shows a pick point on each half.
// Either half names the same two-space footprint, so both answers build on the whole tile (footprint, bldBuildPay).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions';
import '../src/buildings';
import { placeTileAt } from '../src/map';
import { footprint, placementOptions } from '../src/buildings';
import { initTileStacks } from '../src/tiles';
import { blankState } from '../src/testing';

describe('buildSpace: a Large building offers each half of a tile', () => {
  it('lists both spaces of a free tile, each with the same footprint', () => {
    const s = blankState({ scenario: 'crater' });
    initTileStacks(s);
    const tile = placeTileAt(s, 'N01', 1, 0, 'near');
    const [top, bottom] = tile.spaces;

    const opts = placementOptions(s, 'hothouse').filter((o) => tile.spaces.includes(o.id));
    expect(opts.map((o) => o.id).sort()).toEqual([top, bottom].sort());
    for (const o of opts) {
      expect(o.spaces).toEqual([top, bottom]);
      expect(footprint(s, 'hothouse', o.id)).toEqual([top, bottom]);
      expect(o.label).toContain('both spaces');
    }
  });

  it('a Small building keeps one option per space, as before', () => {
    const s = blankState({ scenario: 'crater' });
    initTileStacks(s);
    const tile = placeTileAt(s, 'N01', 1, 0, 'near');
    const ids = placementOptions(s, 'house').map((o) => o.id);
    expect(ids).toContain(tile.spaces[0]);
    expect(ids).toContain(tile.spaces[1]);
  });
});
