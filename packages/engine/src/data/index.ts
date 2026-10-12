// Typed accessors over the raw card/board data (see docs/FX_DSL.md for the effect language).
import buildingsJson from './raw/buildings.json';
import weatherJson from './raw/weather.json';
import advisorsJson from './raw/advisors.json';
import societiesJson from './raw/societies.json';
import mapJson from './raw/map.json';
import lawsJson from './raw/laws.json';
import techJson from './raw/technologies.json';
import citizensJson from './raw/citizens.json';
import lawConsJson from './raw/law_consequences.json';
import sdJson from './raw/social_dispute.json';
import m1 from './raw/morning_1.json';
import m2 from './raw/morning_2.json';
import m3 from './raw/morning_3.json';
import d1 from './raw/dusk_1.json';
import d2 from './raw/dusk_2.json';
import d3 from './raw/dusk_3.json';
import d4 from './raw/dusk_4.json';
import d5 from './raw/dusk_5.json';
import d6 from './raw/dusk_6.json';
import expJson from './raw/expeditions.json';
import scenJson from './raw/scenarios.json';
import genJson from './raw/generator.json';

export type FxList = any[];

export interface BuildingDef {
  id: string;
  name: string;
  size: 'S' | 'L';
  ins: 'W' | 'B' | 'Y' | 'O' | 'R';
  upgIns?: 'W' | 'B' | 'Y' | 'O' | 'R';
  build?: { wood?: number; core?: number } | null;
  upgrade?: { wood?: number; core?: number } | null | 'special';
  engineer?: boolean;
  limit?: number;
  group?: string;
  action?: { cost: string[]; fx: FxList } | null;
  upgAction?: { cost: string[]; fx: FxList } | 'same' | null;
  passive?: Record<string, any>;
  upgPassive?: Record<string, any>;
  placement?: string;
  shelter?: number;
  shelterChildren?: number;
  law?: string;
  sharedTile?: string;
  unlockedBy?: string;
  onBuild?: FxList;
  start?: string;
  cannotBuild?: boolean;
  flipSide?: string;
  text?: string;
  note?: string;
}

export interface OptDef {
  label: string;
  req?: string[];
  fx: FxList;
  cond?: string;
}

export interface EventCardDef {
  id: string;
  idx: number;
  title: string;
  top?: FxList;
  opts?: OptDef[];
  branch?: { if: string; then: number; else: number; map?: Record<string, number> } | any;
  eventAction?: {
    acts: string[];
    freq: string;
    custom?: string;
    needs?: string[];
    cost?: string[];
    fx?: FxList;
    [k: string]: any;
  };
  eventDusk?: FxList;
  eventNight?: FxList;
  eventPassive?: any;
  pack?: string;
  pile?: string;
  deck?: string;
  [k: string]: any;
}

export const buildings: Record<string, BuildingDef> = {};
for (const b of (buildingsJson as any).buildings) buildings[b.id] = b;
export const buildingMeta = {
  upgradeCostByGroup: (buildingsJson as any).upgradeCostByGroup as Record<string, { wood?: number; core?: number }>,
  scenarioTiles: (buildingsJson as any).scenarioTiles,
  limits: (buildingsJson as any).limits as Record<string, number>,
};

export const weatherCards: any[] = (weatherJson as any).cards;
export const heatRangeSetup = (weatherJson as any).heatRangeSetup as {
  red: number;
  orange: number;
  yellow: number;
  cold: number;
  heat: number;
};
export const advisors: Record<string, any> = {};
for (const a of (advisorsJson as any).advisors) advisors[a.id] = a;
export const callToRise = (advisorsJson as any).callToRise;
export const handSize = (advisorsJson as any).handSize as Record<string, number>;
export const societies: any[] = (societiesJson as any).cards;
export const mapData = mapJson as any;
export const tileDefs: Record<string, any> = {};
for (const t of mapData.tiles) tileDefs[t.id] = t;
export const laws: Record<string, any> = {};
for (const l of (lawsJson as any).laws) laws[l.id] = l;
export const lawRules = (lawsJson as any).rules;
export const techs: Record<string, any> = {};
for (const t of (techJson as any).cards) techs[t.id] = t;
export const citizens: Record<string, any> = {};
for (const c of citizensJson as any as any[]) citizens[c.id] = c;
export const lawConsequences: Record<string, any> = {};
for (const c of lawConsJson as any as any[]) lawConsequences[c.id] = c;
export const socialDispute: Record<string, any> = {};
for (const c of sdJson as any as any[]) socialDispute[c.id] = c;
export const morning: Record<string, EventCardDef> = {};
for (const c of [...(m1 as any), ...(m2 as any), ...(m3 as any)]) morning[c.id] = c;
export const dusk: Record<string, EventCardDef> = {};
for (const c of [...(d1 as any), ...(d2 as any), ...(d3 as any), ...(d4 as any), ...(d5 as any), ...(d6 as any)]) dusk[c.id] = c;
export const expeditions: Record<string, any> = {};
for (const c of (expJson as any).cards) expeditions[c.id] = c;
export const scenarioCards: Record<string, any> = (scenJson as any).cards;
export const scenarioStart = (scenJson as any).start;
export const scenarios: Record<string, any> = (scenJson as any).scenarios;
export const generatorData = genJson as any;

export const heatTrack: { pos: number; cubes: number; icon: string | null }[] = generatorData.heatTrack.spaces;

/** Card/sprite metadata used by the web client. */
export function eventCard(id: string): EventCardDef {
  return (id.startsWith('M') ? morning[id] : dusk[id]) as EventCardDef;
}

/** meeples shown on the Population track for a citizen marker value */
export function meepleCountFor(n: number): number {
  if (n <= 0) return 0;
  if (n <= 4) return 1;
  if (n <= 9) return 2;
  if (n <= 14) return 3;
  if (n <= 19) return 4;
  if (n <= 25) return 5;
  if (n <= 32) return 6;
  if (n <= 39) return 7;
  return 8;
}

/** Sickness band effects (Preparation phase): [spent tokens, flips] by sickness marker position */
export function sicknessBand(n: number): { spent: number; flips: number } {
  if (n >= 20) return { spent: 3, flips: 3 };
  if (n >= 15) return { spent: 2, flips: 2 };
  if (n >= 10) return { spent: 1, flips: 1 };
  if (n >= 5) return { spent: 0, flips: 1 };
  return { spent: 0, flips: 0 };
}
