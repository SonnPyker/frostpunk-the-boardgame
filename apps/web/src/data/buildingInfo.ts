// Display data for building kinds: the effect text shown under a building in the decisions and on the map, and the
// artwork that stands for it. Presentation only. The rules are in packages/engine/src/data/raw/buildings.json.
//
// The texts are English keys. The UI wraps each one in t() or tn() when it draws it, and the Vietnamese is in
// tools/i18n/ui/buildings.json. Numbers stay in the text, so the translation keeps its placeholders.

/** Effect text per building kind (the engine's kind ids). Ruins is the flip side of a House, Bunkhouse or Tent. */
export const BUILDING_TEXT: Record<string, string> = {
  cookhouse: 'Action: spend 3 Food to raise Hope or lower Discontent.',
  platform: 'Action: introduce a new Law. Printed on the Generator tile. Engineers only.',
  generator: 'Action: remove up to 5 Stress cubes, or spend 1 Steam Core to remove them all. Engineers only.',
  workshop:
    'Action: choose two effects (the same one twice is allowed): upgrade a Building, or move the Development token one space back on the Round track. Engineers only.',
  charcoalKiln: 'Action: spend 1 Wood to gain 4 Coal. Upgraded: spend 1 Wood to gain 5 Coal.',
  huntersHut: 'Passive: 1 Food each Weather phase (2 when upgraded). Action: gain 4 Food (5 when upgraded).',
  gatheringPost: 'Action: take 1 Resource from each adjacent space into the supply. Upgraded: only better Insulation.',
  factory: 'Action: spend 1 Steam Core to gain 1 Automaton. Engineers only.',
  sawmill: 'Action: remove 1 Tree from the Sawmill tile to gain 3 Wood. Upgraded: the Tree may also be on an adjacent space.',
  medicalPost: 'Action: Cure 3. Upgraded: Cure 4, or Treat 1. Engineers only.',
  beacon: 'Passive: up to 1 Expedition may be active. Upgraded: up to 2.',
  coalThumper:
    'Action: place up to 3 Coal on each of 3 different adjacent spaces (5 Coal max per space). A space must already hold Coal or have no Resources, Trees or Buildings. Upgraded: 4 different spaces.',
  infirmary: 'Action: Cure 4 or Treat 2. Upgraded: Cure 5 or Treat 3. Engineers only.',
  hothouse: 'Action: gain 7 Food. Upgraded: gain 9 Food.',
  coalMine: 'Action: gain 4 Coal. Upgraded: gain 5 Coal. Can only be built next to a Coal deposit on the Rim.',
  wallDrill: 'Action: gain 3 Wood. Can only be built next to a Wood deposit on the Rim. Upgraded: only better Insulation.',
  house: 'Shelter for 2 Citizens.',
  bunkhouse: 'Shelter for 2 Citizens.',
  tent: 'Shelter for 2 Citizens.',
  ruins: 'The flip side of a House, Bunkhouse or Tent. No Shelter in the Night Phase unless a Law says otherwise, and then only if heated.',
  childShelter: 'Shelter for 4 Children.',
  careHouse: 'Action: Cure 2, or Cure 5 if you exhaust an active Care token.',
  fightingArena: 'Action: decrease Discontent.',
  publicHouse: 'Action: increase Hope.',
  fieldKitchen:
    'Passive: actions and Buildings on this tile count as heated, and so do Shelters here at Night. Cannot be built on the Generator tile.',
  cemetery: 'Action: move the Corpse marker back 1 to 2 spaces. If you do, increase Hope.',
  temple: 'Action: activate all Hope tokens of one type. Engineers only.',
  faithKeepers:
    'Action: draw 3 Dusk cards. You may discard one of them without its effect (not a Social Dispute card), then shuffle the other 2 back into the Dusk deck.',
  snowPit: 'When built, move the Corpse marker back 1 to 3 spaces.',
  propagandaCentre:
    'Action: choose a Building with a Citizen on it and perform its action (it counts as heated). Engineers only.',
  agitator: 'Action: exhaust all active Discontent tokens of one type.',
  prison:
    'Action: reduce Hunger by 4. A Meeple that uses it stays in the Prison at Night: it is a Shelter if heated, otherwise the Meeple falls sick.',
  steamHub:
    'Passive: at any time, if Heat is above the red level, you may place 1 Coal here. While it holds Coal, this tile and its adjacent tiles count as heated. Return the Coal to the bank at the end of the Generator phase.',
  dreadnoughtTile: 'Dreadnought. A Small Building with Blue insulation. Use a Building action: gain 1 Steel.',
};

/** A manifest key: a tile face (`tile`) or a token (`token`). */
export interface ArtRef {
  tile?: string;
  token?: string;
}

/** Front artwork per building kind. Steam Hub and Dreadnought have no 2D artwork in the asset set, so they have none. */
export const BUILDING_ART: Record<string, ArtRef> = {
  cookhouse: { tile: 'cookhouse' },
  platform: { token: 'token_platform' },
  generator: { tile: 'generator_tile' },
  workshop: { tile: 'workshop' },
  charcoalKiln: { tile: 'charcoal_kiln' },
  huntersHut: { token: 'hunter_s_hut' },
  gatheringPost: { tile: 'gathering_post' },
  factory: { tile: 'factory' },
  sawmill: { tile: 'sawmill' },
  medicalPost: { tile: 'medical_post' },
  beacon: { tile: 'beacon' },
  coalThumper: { tile: 'coal_thumper' },
  infirmary: { tile: 'infirmary' },
  hothouse: { tile: 'hothouse' },
  coalMine: { tile: 'coal_mine' },
  wallDrill: { tile: 'wall_drill' },
  house: { tile: 'house' },
  bunkhouse: { tile: 'bunkhouse' },
  tent: { tile: 'tent' },
  ruins: { tile: 'tent_back' },
  childShelter: { tile: 'child_shelter' },
  careHouse: { tile: 'care_house' },
  fightingArena: { tile: 'fighting_arena' },
  publicHouse: { tile: 'public_house' },
  fieldKitchen: { tile: 'field_kitchen' },
  cemetery: { tile: 'cemetery' },
  temple: { tile: 'temple' },
  faithKeepers: { tile: 'faith_keepers' },
  snowPit: { tile: 'field_kitchen_back' },
  propagandaCentre: { tile: 'cemetery_back' },
  agitator: { tile: 'temple_back' },
  prison: { tile: 'faith_keepers_back' },
};

/** Artwork of the upgraded side, for the kinds whose tile back is that side. */
export const UPGRADED_ART: Record<string, ArtRef> = {
  charcoalKiln: { tile: 'charcoal_kiln_back' },
  huntersHut: { token: 'hunter_s_hut_back' },
  gatheringPost: { tile: 'gathering_post_back' },
  sawmill: { tile: 'sawmill_back' },
  medicalPost: { tile: 'medical_post_back' },
  beacon: { tile: 'beacon_back' },
  coalThumper: { tile: 'coal_thumper_back' },
  infirmary: { tile: 'infirmary_back' },
  hothouse: { tile: 'hothouse_back' },
  coalMine: { tile: 'coal_mine_back' },
  wallDrill: { tile: 'wall_drill_back' },
};

/** A building as a decision or the map reports it. `kind` is the building's own kind, even when it is in ruins. */
export interface BuildingView {
  kind: string;
  upgraded?: boolean;
  ruins?: boolean;
}

/** The kind whose text and artwork describe a building: ruins take the ruins face whatever they were built as. */
export function kindOf(b: BuildingView): string {
  return b.ruins ? 'ruins' : b.kind;
}

/** Effect text for a building, or undefined for a kind the data does not describe. */
export function buildingText(b: BuildingView): string | undefined {
  return BUILDING_TEXT[kindOf(b)];
}

/** Artwork for a building: its ruins face, its upgraded side when it is upgraded and there is one, else the front. */
export function buildingArt(b: BuildingView): ArtRef | undefined {
  if (b.ruins) return BUILDING_ART.ruins;
  if (b.upgraded && UPGRADED_ART[b.kind]) return UPGRADED_ART[b.kind];
  return BUILDING_ART[b.kind];
}
