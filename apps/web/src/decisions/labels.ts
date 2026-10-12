// Labels and icons for decision kinds and option ids. No runtime imports, so the App shell can import the history
// store without pulling the engine in.
import type { IconName } from '../hud/model';

export function humanise(s: string): string {
  const spaced = s.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

const KIND_LABEL: Record<string, string> = {
  action: 'Action',
  fuel: 'Generator',
  meeple: 'Meeple',
  citizen: 'Citizen card',
  space: 'Space',
  gatherRes: 'Gather',
  building: 'Building',
  adjacentSpace: 'Adjacent space',
  moveBuilding: 'Move building',
  reuseBuilding: 'Reuse building',
  reuseWorker: 'Reuse worker',
  card: 'Event card',
  tech: 'Technology',
  law: 'Law',
  type: 'Type',
  advisor: 'Advisor',
  scenario: 'Scenario',
  stockpile: 'Stockpile',
  sleep: 'Night',
  deployScout: 'Scout',
  expStack: 'Expedition',
  expArrive: 'Expedition',
  expExplore: 'Expedition',
  choice: 'Choice',
  distribute: 'Distribute',
  pay: 'Payment',
  // every other kind the engine raises (see the coverage run in apps/web/scripts/pending_kinds.ts)
  buildPick: 'Building',
  buildSpace: 'Build site',
  construct: 'Construction',
  citizenDiscard: 'Citizen',
  citizenOverflow: 'Citizens',
  corpse: 'Corpse marker',
  destroy: 'Destroy',
  dismantle: 'Dismantle',
  drawFar3: 'Far tiles',
  farOrder: 'Far tiles',
  farReorder: 'Far tiles',
  mapres: 'Map resources',
  removeSnow: 'Snow',
  setup: 'Setup',
  tile: 'Tile',
  tileKind: 'Tile',
  tileSlot: 'Tile placement',
  treePick: 'Trees',
  gatherPick: 'Gather',
  upgradePick: 'Upgrade',
  duskPeek: 'Dusk',
  dreadnoughtTile: 'Dreadnought',
  dread: 'Dreadnought',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? humanise(kind);
}

const KIND_ICON: Record<string, IconName> = {
  action: 'turn',
  fuel: 'fuel',
  meeple: 'worker',
  citizen: 'worker',
  space: 'tree',
  gatherRes: 'wood',
  building: 'steel',
  adjacentSpace: 'tree',
  moveBuilding: 'steel',
  reuseBuilding: 'steel',
  reuseWorker: 'worker',
  card: 'event',
  tech: 'tech',
  law: 'law',
  type: 'hope',
  advisor: 'advisor',
  scenario: 'round',
  stockpile: 'food',
  sleep: 'cold',
  deployScout: 'scout',
  expStack: 'expedition',
  expArrive: 'expedition',
  expExplore: 'expedition',
  choice: 'log',
  distribute: 'wood',
  pay: 'coal',
  buildPick: 'steel',
  buildSpace: 'steel',
  construct: 'steel',
  citizenDiscard: 'worker',
  citizenOverflow: 'worker',
  corpse: 'corpse',
  destroy: 'broken',
  dismantle: 'broken',
  drawFar3: 'tree',
  farOrder: 'tree',
  farReorder: 'tree',
  mapres: 'core',
  removeSnow: 'cold',
  setup: 'round',
  tile: 'tree',
  tileKind: 'tree',
  tileSlot: 'tree',
  treePick: 'tree',
  gatherPick: 'wood',
  upgradePick: 'steel',
  duskPeek: 'round',
  dreadnoughtTile: 'tree',
  dread: 'tree',
};

export function kindIcon(kind: string): IconName {
  return KIND_ICON[kind] ?? 'event';
}

const ACTION_ICON: Record<string, IconName> = {
  'act:fuel': 'fuel',
  'act:removeSnow': 'cold',
  'act:gather': 'wood',
  'act:construct': 'steel',
  'act:use': 'turn',
  'act:deploy': 'scout',
  'act:pass': 'round',
};

export function actionIcon(id: string): IconName {
  if (ACTION_ICON[id]) return ACTION_ICON[id];
  if (id.startsWith('act:special:ev')) return 'event';
  if (id.startsWith('act:special:law')) return 'law';
  return 'turn';
}

const MEEPLE_ICON: Record<string, IconName> = {
  worker: 'worker',
  engineer: 'engineer',
  child: 'child',
  automaton: 'automaton',
  scout: 'scout',
};

export function meepleIcon(kind: string | undefined): IconName {
  return (kind && MEEPLE_ICON[kind]) || 'worker';
}

const RESOURCE_ICON: Record<string, IconName> = { wood: 'wood', coal: 'coal', core: 'core', food: 'food', steel: 'steel' };

/** Icon for a 'space|res' distribute id (gatherRes) or a plain resource id. */
export function resourceIcon(id: string): IconName {
  const res = id.includes('|') ? id.split('|')[1] : id;
  return RESOURCE_ICON[res] ?? 'log';
}

/** The icon that stands for one option of a decision, from the decision kind and the option id. */
export function optionIcon(kind: string, id: string, data?: any): IconName {
  switch (kind) {
    case 'meeple':
    case 'deployScout':
    case 'reuseWorker':
      return meepleIcon(data?.kind);
    case 'space':
    case 'adjacentSpace':
      return 'tree';
    case 'gatherRes':
      return resourceIcon(id);
    case 'building':
    case 'moveBuilding':
    case 'reuseBuilding':
      return 'steel';
    case 'stockpile':
      return id === 'ration' ? 'food' : id === 'coal' ? 'coal' : 'check';
    case 'action':
      return actionIcon(id);
    case 'type':
      return 'hope';
    case 'advisor':
      return 'advisor';
    case 'tech':
      return 'tech';
    case 'law':
      return 'law';
    default:
      return kindIcon(kind);
  }
}
