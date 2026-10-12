// Core type definitions for the Frostpunk engine. Everything in GameState is plain JSON.
import type { RngState } from './rng';

export type CitizenType = 'worker' | 'engineer' | 'child';
export type MeepleKind = 'worker' | 'engineer' | 'child' | 'automaton' | 'childWorker' | 'childEngineer';
export type HopeType = 'care' | 'justice' | 'motivation';
export type DiscType = 'anger' | 'apathy' | 'greed';
export type ResKind = 'wood' | 'coal' | 'core' | 'steel';
export type PhaseName =
  | 'setup'
  | 'dawn'
  | 'morning'
  | 'generator'
  | 'weather'
  | 'preparation'
  | 'action'
  | 'dusk'
  | 'hunger'
  | 'night';

export const CITIZEN_TYPES: CitizenType[] = ['worker', 'engineer', 'child'];
export const HOPE_TYPES: HopeType[] = ['care', 'justice', 'motivation'];
export const DISC_TYPES: DiscType[] = ['anger', 'apathy', 'greed'];

/** Citizen type printed at the top of the Round column: round 1 = child, 2 = engineer, 3 = worker, 4 = child ... */
export function roundType(round: number): CitizenType {
  return (['child', 'engineer', 'worker'] as CitizenType[])[(((round - 1) % 3) + 3) % 3];
}

export type Id = string;

export interface Tok<T extends string> {
  t: T;
  a: boolean; // active?
}

export interface SickMarker {
  n: number; // number of sick citizens (position on the Population track)
  skull: boolean; // marker on skull side
}

export interface Loc {
  k: 'supply' | 'space' | 'board' | 'card' | 'spent' | 'scout' | 'sleep' | 'bank';
  space?: string;
  slot?: string; // board slot: removeSnow | construct | deploy
  card?: string;
  token?: number;
  exp?: number;
}

export interface Meeple {
  id: number;
  kind: MeepleKind;
  loc: Loc;
  /** set during the Action phase when the meeple already acted this round (for Reuse a Worker) */
  used?: boolean;
  /** lying down (sleeping) during the Night */
  lying?: boolean;
  /** stays on its space through the Night (Prison etc.) */
  stay?: boolean;
  /** the Round in which the Meeple was returned from a Spent token to the supply (L17); see util.ts freeSupply */
  returnedRound?: number;
}

export interface SpentToken {
  id: number;
  type: CitizenType;
  meeple: number | null;
}

export interface Space {
  id: string; // e.g. N03:top / GEN:UL
  tile: string; // tile key "q,r" or "GEN"
  slot: string; // top | bottom | T UR LR LL UL
  res: Partial<Record<'wood' | 'coal' | 'core', number>>;
  trees: number;
  building: number | null; // building uid
}

export interface MapTile {
  key: string; // "q,r"
  id: string; // N01.. F01.. | GEN | DN1..
  kind: 'near' | 'far' | 'gen' | 'dread';
  q: number;
  r: number;
  spaces: string[]; // space ids
  food: number;
}

export interface Building {
  uid: number;
  kind: string; // building def id
  upgraded: boolean;
  ruins: boolean; // flipped to ruins (shelters) – kind remains the original shelter kind
  spaces: string[]; // 1 (small) or 2 (large)
  steamHubCoal?: boolean;
  printed?: boolean; // printed on the Generator tile, cannot be dismantled
  extra?: Record<string, any>;
}

export interface Pending {
  id: number;
  who: number; // player index; -1 means "any player" (anyone can answer)
  kind: string; // UI hint
  prompt: string;
  src?: string;
  options: PendingOption[];
  min: number;
  max: number;
  then: Op;
  meta?: Record<string, any>;
  /**
   * Set on a decision inside an action's chain (which Meeple, which building, where to place it ...) while the player may
   * still go back to the action menu: answer it with BACK_PICK. Only set while nothing hidden has changed since the action
   * was picked (see core.ts backAvailable), so going back never reveals or re-rolls anything.
   */
  back?: boolean;
}

/**
 * The state from just before the player picked an action, kept so that a decision inside that action's chain can go back
 * to the action menu. `snap` is the JSON of the state without `backPoint` (so it never nests); `hidden` fingerprints the
 * hidden parts (decks, stacks, RNG, other seats' hands) at the pick. `round` and `phase` keep it inside the Action phase
 * it was taken in. Cleared when the chain ends (core.ts, actions.ts).
 */
export interface BackPoint {
  who: number;
  round: number;
  phase: PhaseName;
  hidden: string;
  snap: string;
}

export interface PendingOption {
  id: string;
  label: string;
  hint?: string;
  disabled?: string; // reason it is not selectable (kept so UI can show it greyed)
  data?: any;
}

export interface Op {
  k: string;
  [key: string]: any;
}

export type FxItem = string | { [key: string]: any };

export interface PlayerState {
  id: string;
  name: string;
  seat: number;
  advisor: string | null;
  hand: string[]; // citizen cards
  playedCitizen: string | null; // citizen card played this round (main ability)
  color: string;
}

export interface ExpCard {
  id: string;
  flipped: boolean; // black side up
  /** chosen continue option index (null if not continued) */
  cont: number | null;
}

export interface ExpStack {
  uid: number;
  cards: ExpCard[]; // bottom -> top
  scout: { meeple: number; pos: number } | null; // pos = 1-based space index on the top card
  scenario?: boolean; // scenario expedition (cannot skip)
  /** set while the player decides to skip / explore */
  waiting?: boolean;
  /** bonus resources gained when the expedition Returns */
  bonus?: { wood?: number; coal?: number };
}

export interface EventCardInPlay {
  uid: number;
  card: string; // M### or D###
  res: Partial<Record<ResKind, number>>;
  meeples: number[];
  usedThisRound: boolean;
  usedEver: boolean;
  extra?: Record<string, any>;
}

export interface LawInPlay {
  id: string;
  covered: string | null; // consequence card id covering it
  hopeTok?: string | null; // L20 The Virtue of Humanity: the Hope token on the card (active side up), not on the track
}

export interface LogEntry {
  n: number;
  r: number;
  p: PhaseName;
  t: string; // key for UI
  m: string; // English message
  d?: any;
}

export interface GameConfig {
  scenario: 'crater' | 'frozenGrove' | 'dreadnought';
  society: number; // 1..6
  difficulty: 'normal' | 'hard';
  /**
   * Survivalist Society cards (ids S1S..S6S, extra pack). When true the Society card is the Survivalist one of
   * `society` and `difficulty` is not used for it. Optional: absent or false keeps the normal/hard cards (backwards compatible).
   */
  survivalist?: boolean;
  mode: 'solo' | 'coop';
  players: { name: string; id?: string }[];
  seed: number;
  extraPack: boolean;
  /** skip optional Hope-bag draw choices (auto) */
  advisors?: (string | null)[];
}

export interface GameState {
  v: 1;
  config: GameConfig;
  rng: RngState;
  status: 'playing' | 'won' | 'lost';
  endReason: string | null;
  round: number;
  phase: PhaseName;
  leader: number;
  turn: number; // active player (Action phase)
  passes: number; // consecutive passes in the action phase
  players: PlayerState[];

  // supply
  res: Record<ResKind, number>;
  food: number;
  cit: Record<CitizenType, number>;
  sick: Record<CitizenType, SickMarker>;
  hunger: number;
  hungerOver: boolean;
  corpse: number;
  corpseMax: number;

  // hope / discontent
  hope: Tok<HopeType>[];
  disc: Tok<DiscType>[];
  hopeBag: Record<HopeType, number>;
  discBag: Record<DiscType, number>;

  // generator
  gen: {
    heat: number;
    cold: number;
    ind: { red: number | null; orange: number | null; yellow: number | null };
    broken: boolean; // heat marker on overheated side
    stress: number; // cubes on the 10 slots
    overflow: number;
    upgraded: boolean; // Generator Upgrade piece placed
    carry: number; // Coal cubes that fell out while the drawer was closed; placed on the Stress track at the next genStress (GEN-08, p21)
    fuelUsedThisPhase: number;
  };

  // map
  tiles: MapTile[];
  spaces: Record<string, Space>;
  buildings: Building[];
  nextUid: number;
  stacks: { near: string[]; far: string[] };
  rim: { corner: number; q: number; r: number; deposit: 'wood' | 'coal' | null }[];
  genCentre: [number, number];

  // meeples & tokens
  meeples: Meeple[];
  nextMeeple: number;
  spent: SpentToken[];
  nextSpent: number;
  automatonsMax: number;

  // decks
  decks: {
    morning: string[];
    dusk: string[];
    duskDiscard: string[];
    weather: string[];
    weatherDiscard: string[];
    citizen: string[];
    citizenDiscard: string[];
    social: string[];
    expA: string[];
    expB: string[];
    expC: string[];
  };
  futureLaws: string[];
  lawConsequenceBank: Record<string, string[]>; // lawId -> its 2 consequence ids (hidden)
  laws: LawInPlay[];
  removedLaws: string[];
  techs: {
    id: string;
    state: 'inactive' | 'developing' | 'done';
    dueRound: number | null;
  }[];
  techInProgress: string | null;
  events: EventCardInPlay[];
  scenarioDisplay: string[];
  scenarioState: Record<string, any>;
  triggers: { round: number; card: string; idx: number }[];
  stormMarker: number | null; // Round-track space the Storm card hits on (null = none left)
  stormsHit: number;
  stormCard: string;
  weatherCard: string | null; // currently revealed
  weatherHunt: number;
  expeditions: ExpStack[];
  nextExp: number;
  advisorUsedThisRound: boolean;
  callToRiseUsed: boolean;
  morningCard: string | null;
  duskCard: string | null;

  // per-round flags
  flags: Record<string, any>;
  /** per-round records of spaces used (for gather once per space per round) */
  usedSpaces: string[];

  // control
  stack: Op[];
  pending: Pending | null;
  /** present only while an action's chain can still go back to the action menu (see BackPoint) */
  backPoint?: BackPoint;
  nextPending: number;
  log: LogEntry[];
  logN: number;
  steps: number; // op counter for safety / replay checks
}
