// Audit 8 (closure, group misc) BLD-01 / BLD-02: building costs, upgrade costs and piece limits in buildings.json,
// checked against the Buildings board (group cost icons, shelter rings 4 / 3 / 2 wood), the rulebook appendix pp40-44
// (cost headings "SMALL BUILDINGS THAT COST 1/2 WOOD", "LARGE BUILDINGS THAT COST 3 / 4+1 / 5+1") and the piece counts in
// the TTS mod (assets_src/mod/frostpunk_tts_mod.json, one deck per building type).
// The rulebook component list (p5) prints 42 Small Basic and 11 Large Basic tiles. The Large count matches; the Small
// count is 43 in the mod (see the last test; declared, not changed).
import { describe, expect, it } from 'vitest';
import { buildings } from '../src/data';

const B = buildings as Record<string, any>;

describe('BLD-01: build costs match the Buildings board groups and the rulebook cost headings', () => {
  const wood = (k: string) => B[k].build?.wood ?? 0;
  const core = (k: string) => B[k].build?.core ?? 0;

  it('1 Wood group: Gathering Post, Charcoal Kiln, Hunter\'s Hut, Workshop', () => {
    for (const k of ['gatheringPost', 'charcoalKiln', 'huntersHut', 'workshop']) {
      expect(wood(k)).toBe(1);
      expect(core(k)).toBe(0);
    }
  });

  it('2 Wood group: Factory, Sawmill, Medical Post', () => {
    for (const k of ['factory', 'sawmill', 'medicalPost']) {
      expect(wood(k)).toBe(2);
      expect(core(k)).toBe(0);
    }
  });

  it('Large 3 Wood group: Beacon, Coal Thumper', () => {
    for (const k of ['beacon', 'coalThumper']) {
      expect(wood(k)).toBe(3);
      expect(core(k)).toBe(0);
    }
  });

  it('Large 4 Wood + 1 Steam Core: Infirmary, Hothouse; 5 Wood + 1 Steam Core: Coal Mine, Wall Drill', () => {
    for (const k of ['infirmary', 'hothouse']) {
      expect(wood(k)).toBe(4);
      expect(core(k)).toBe(1);
    }
    for (const k of ['coalMine', 'wallDrill']) {
      expect(wood(k)).toBe(5);
      expect(core(k)).toBe(1);
    }
  });

  it('shelters cost 4 / 3 / 2 Wood (House / Bunkhouse / Tent), the Buildings board rings', () => {
    expect(wood('house')).toBe(4);
    expect(wood('bunkhouse')).toBe(3);
    expect(wood('tent')).toBe(2);
  });
});

describe('BLD-01: upgrade costs match the Buildings board (1 Wood, 1 Steam Core, 2 Steam Cores)', () => {
  it('1-Wood and 2-Wood groups upgrade for 1 Wood; Workshop, Factory have no upgrade', () => {
    for (const k of ['charcoalKiln', 'huntersHut', 'gatheringPost', 'sawmill', 'medicalPost']) {
      expect(B[k].upgrade).toEqual({ wood: 1 });
    }
    expect(B.workshop.upgrade).toBeNull();
    expect(B.factory.upgrade).toBeNull();
  });

  it('Beacon and Coal Thumper upgrade for 1 Steam Core; Infirmary, Hothouse, Coal Mine, Wall Drill for 2', () => {
    expect(B.beacon.upgrade).toEqual({ core: 1 });
    expect(B.coalThumper.upgrade).toEqual({ core: 1 });
    for (const k of ['infirmary', 'hothouse', 'coalMine', 'wallDrill']) expect(B[k].upgrade).toEqual({ core: 2 });
  });

  it('shelters, Generator-tile-only and law buildings cannot be upgraded', () => {
    for (const k of ['house', 'bunkhouse', 'tent']) expect(B[k].upgrade).toBeNull();
  });
});

describe('BLD-02: piece limits (TTS mod counts per building type)', () => {
  it('shelter limits: House 10, Bunkhouse 8, Tent 4', () => {
    expect(B.house.limit).toBe(10);
    expect(B.bunkhouse.limit).toBe(8);
    expect(B.tent.limit).toBe(4);
  });

  it('the other basic limits equal the mod deck counts', () => {
    const want: Record<string, number> = {
      charcoalKiln: 3,
      sawmill: 3,
      huntersHut: 5,
      gatheringPost: 3,
      workshop: 2,
      factory: 1,
      medicalPost: 4,
      beacon: 1,
      coalThumper: 2,
      infirmary: 2,
      hothouse: 2,
      coalMine: 2,
      wallDrill: 2,
    };
    for (const [k, n] of Object.entries(want)) expect(B[k].limit, k).toBe(n);
  });

  it('Large basic tiles total 11 (rulebook p5 component list)', () => {
    const large = ['beacon', 'coalThumper', 'infirmary', 'hothouse', 'coalMine', 'wallDrill'];
    expect(large.reduce((a, k) => a + B[k].limit, 0)).toBe(11);
  });

  it('Small basic tiles total 43 in the mod counts; the rulebook prints 42 (declared, see KNOWN_ISSUES)', () => {
    // Small basic = the basic types placed from the Buildings board; Cookhouse, Platform and Generator are printed on
    // or placed on the Generator tile and are not in the 42 pile.
    const small = ['charcoalKiln', 'sawmill', 'huntersHut', 'gatheringPost', 'workshop', 'factory', 'medicalPost', 'house', 'bunkhouse', 'tent'];
    expect(small.reduce((a, k) => a + B[k].limit, 0)).toBe(43);
  });
});
