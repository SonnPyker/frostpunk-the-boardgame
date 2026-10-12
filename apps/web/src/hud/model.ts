// HUD constants and pure helpers. Everything here is derived from the engine data and GameState; nothing is stored.
import {
  advisors,
  citizens,
  describeFx,
  dusk,
  expeditions,
  heatTrack,
  laws,
  lawConsequences,
  morning,
  scenarioCards,
  societies,
  socialDispute,
  techs,
  weatherCards,
  type CitizenType,
  type DiscType,
  type GameState,
  type HopeType,
  type PhaseName,
} from '@frostpunk/engine';
import { cardArt } from './assets';

// Mirrors HOPE_SLOTS / DISC_SLOTS in packages/engine/src/hope.ts (not re-exported from the engine index).
export const HOPE_SLOTS = 6;
export const DISC_SLOTS = 5;
export const STRESS_SLOTS = 10;
export const HEAT_LEN = 16;
export const ROUND_LEN = 15;
export const POP_TRACK_MAX = 50;
export const MAX_LAWS = 4;
export const CARD_RATIO = 1.42;

export const CITIZEN_ORDER: CitizenType[] = ['worker', 'engineer', 'child'];
export const CITIZEN_LABEL: Record<CitizenType, string> = { worker: 'Workers', engineer: 'Engineers', child: 'Children' };
export const CITIZEN_SHORT: Record<CitizenType, string> = { worker: 'Worker', engineer: 'Engineer', child: 'Child' };
/** Board-art colours: green = Child, orange = Worker, blue = Engineer (see generator.json). */
export const CITIZEN_COLOR: Record<CitizenType, string> = { worker: '#e89a3c', engineer: '#5fb6e6', child: '#8fd16a' };

export const HOPE_ORDER: HopeType[] = ['care', 'justice', 'motivation'];
export const HOPE_LABEL: Record<HopeType, string> = { care: 'Care', justice: 'Justice', motivation: 'Motivation' };
export const HOPE_COLOR: Record<HopeType, string> = { care: '#8bd2ff', justice: '#d9c27a', motivation: '#d98cff' };
export const DISC_ORDER: DiscType[] = ['anger', 'apathy', 'greed'];
export const DISC_LABEL: Record<DiscType, string> = { anger: 'Anger', apathy: 'Apathy', greed: 'Greed' };
export const DISC_COLOR: Record<DiscType, string> = { anger: '#e5533d', apathy: '#8f8f9b', greed: '#c9a227' };

export const SCENARIO_NAME: Record<string, string> = {
  crater: 'A New Home: Crater',
  frozenGrove: 'A New Home: Frozen Grove',
  dreadnought: 'A New Home: Dreadnought',
};

export const PHASES: { id: PhaseName; label: string; hint: string }[] = [
  { id: 'dawn', label: 'Dawn', hint: 'Dawn: scenario triggers fire and the Round begins.' },
  { id: 'morning', label: 'Morning', hint: 'Morning: draw and resolve the Morning event card.' },
  { id: 'generator', label: 'Generator', hint: 'Generator: optional fuelling, cold sickness, then Stress cubes drop.' },
  { id: 'weather', label: 'Weather', hint: 'Weather: heat, hunting, scouts and the Storm card.' },
  { id: 'preparation', label: 'Preparation', hint: 'Preparation: sickness is resolved, advisors and Call to Rise.' },
  { id: 'action', label: 'Action', hint: 'Action: players place Citizens on buildings, spaces and expeditions.' },
  { id: 'dusk', label: 'Dusk', hint: 'Dusk: draw the Dusk card and resolve its event.' },
  { id: 'hunger', label: 'Hunger', hint: 'Hunger: spend Food, then apply the Hunger table.' },
  { id: 'night', label: 'Night', hint: 'Night: citizens find shelter; unsheltered citizens fall ill.' },
];

export function phaseHint(p: PhaseName): string {
  return PHASES.find((x) => x.id === p)?.hint ?? '';
}

// ---- Hunger ----------------------------------------------------------------------------------------------

export interface HungerBand {
  lose: boolean;
  disc: number;
  deaths: number;
  label: string;
  /** colour bucket 0..4 for the track */
  tier: number;
}

/** Hunger table (docs/ENGINE_SPEC.md, rulebook p28): applied after the Food has been spent. */
export function hungerBand(h: number): HungerBand {
  if (h >= 25) return { lose: true, disc: 0, deaths: 0, label: 'Hunger 25+: the city starves. Defeat.', tier: 4 };
  if (h <= 0) return { lose: false, disc: 0, deaths: 0, label: 'No consequence.', tier: 0 };
  const deaths = h >= 20 ? 4 : h >= 15 ? 3 : h >= 10 ? 2 : h >= 5 ? 1 : 0;
  const tier = h >= 15 ? 3 : h >= 5 ? 2 : 1;
  const deathText = deaths === 0 ? '' : `, ${deaths} ${deaths === 1 ? 'citizen dies' : 'citizens die'}`;
  return { lose: false, disc: 1, deaths, label: `+1 Discontent${deathText}.`, tier };
}

// ---- Generator -------------------------------------------------------------------------------------------

export function cubesForHeat(heat: number): number {
  return heatTrack[Math.min(HEAT_LEN, Math.max(1, heat)) - 1]?.cubes ?? 0;
}

/** Citizen icons on spaces strictly between the Heat marker and the Cold marker: sickness if not fuelled. */
export function coldIcons(heat: number, cold: number): CitizenType[] {
  const out: CitizenType[] = [];
  for (let p = heat + 1; p < cold; p++) {
    const icon = heatTrack[p - 1]?.icon;
    if (icon) out.push(icon as CitizenType);
  }
  return out;
}

/** Coal that can still go into the Generator this phase (engine: fuelRoom). */
export function fuelRoomOf(coal: number, heat: number, cold: number): number {
  return Math.max(0, Math.min(coal, cold - heat));
}

// ---- Tracks ----------------------------------------------------------------------------------------------

export function sickTotal(s: GameState): number {
  return CITIZEN_ORDER.reduce((a, t) => a + s.sick[t].n, 0);
}

export function citizenTotal(s: GameState): number {
  return CITIZEN_ORDER.reduce((a, t) => a + s.cit[t], 0);
}

/** Automatons waiting in the supply (meeples of kind automaton in supply or on a scout). */
export function automatonsFree(s: GameState): number {
  return s.meeples.filter((m) => m.kind === 'automaton' && (m.loc.k === 'supply' || m.loc.k === 'scout')).length;
}

export function automatonsTotal(s: GameState): number {
  return s.meeples.filter((m) => m.kind === 'automaton').length;
}

export function meepleKindOf(s: GameState, id: number): string | null {
  return s.meeples.find((m) => m.id === id)?.kind ?? null;
}

// ---- Logs ------------------------------------------------------------------------------------------------

export type IconName =
  | 'wood' | 'coal' | 'core' | 'steel' | 'food'
  | 'worker' | 'engineer' | 'child' | 'automaton'
  | 'skull' | 'syringe' | 'hope' | 'disc' | 'heat' | 'cold' | 'storm'
  | 'round' | 'hunger' | 'corpse' | 'stress' | 'tech' | 'expedition' | 'scout'
  | 'law' | 'event' | 'advisor' | 'leader' | 'turn' | 'log' | 'tree' | 'fuel' | 'broken' | 'generator' | 'check';

const LOG_ICON: Record<string, IconName> = {
  sick: 'syringe',
  cure: 'syringe',
  die: 'skull',
  corpse: 'corpse',
  hope: 'hope',
  disc: 'disc',
  gen: 'generator',
  fuel: 'fuel',
  stress: 'stress',
  hunger: 'hunger',
  food: 'food',
  gain: 'wood',
  spend: 'coal',
  pay: 'coal',
  res: 'wood',
  event: 'event',
  dusk: 'event',
  morning: 'event',
  weather: 'cold',
  storm: 'storm',
  law: 'law',
  tech: 'tech',
  exp: 'expedition',
  expedition: 'expedition',
  scout: 'scout',
  advisor: 'advisor',
  leader: 'leader',
  round: 'round',
  phase: 'turn',
  tree: 'tree',
  automaton: 'automaton',
  dev: 'tech',
  build: 'tree',
  broken: 'broken',
};

export function logIcon(t: string): IconName {
  const head = t.split('.')[0];
  return LOG_ICON[head] ?? 'log';
}

/** Routine bookkeeping lines hidden by the "Key events" filter. */
export function isMinorLog(t: string): boolean {
  return /\.(draw|activate|exhaust|remove)$/.test(t) || t.startsWith('gen.range');
}

// ---- Card lookup -----------------------------------------------------------------------------------------

export type CardKind =
  | 'citizen' | 'morning' | 'dusk' | 'law' | 'lawEvent' | 'social' | 'weather'
  | 'storm' | 'scenario' | 'expedition' | 'tech' | 'advisor' | 'society' | 'unknown';

export interface CardInfo {
  id: string;
  kind: CardKind;
  kindLabel: string;
  title: string;
  /** rules text, one paragraph per entry */
  lines: string[];
  accent: string;
  icon: IconName;
}

const KIND_ACCENT: Record<CardKind, string> = {
  citizen: '#c9b98a',
  morning: '#8fb2c2',
  dusk: '#d8483f',
  law: '#b9cdd8',
  lawEvent: '#d9c27a',
  social: '#d98cff',
  weather: '#8bd2ff',
  storm: '#9fb4c4',
  scenario: '#ff9b2f',
  expedition: '#c9a227',
  tech: '#6fd3ff',
  advisor: '#ffc766',
  society: '#b9cdd8',
  unknown: '#7c93a1',
};

const KIND_ICON: Record<CardKind, IconName> = {
  citizen: 'worker',
  morning: 'event',
  dusk: 'event',
  law: 'law',
  lawEvent: 'law',
  social: 'disc',
  weather: 'cold',
  storm: 'storm',
  scenario: 'round',
  expedition: 'expedition',
  tech: 'tech',
  advisor: 'advisor',
  society: 'leader',
  unknown: 'log',
};

const fx = (list: unknown): string => {
  if (!Array.isArray(list)) return '';
  return list.map((x) => describeFx(x)).join(', ');
};

const humanise = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

function mk(id: string, kind: CardKind, kindLabel: string, title: string, lines: string[], accent?: string): CardInfo {
  return { id, kind, kindLabel, title, lines: lines.filter((l) => l.length > 0), accent: accent ?? KIND_ACCENT[kind], icon: KIND_ICON[kind] };
}

const UNKNOWN = (id: string): CardInfo => mk(id, 'unknown', 'Card', id, []);
const cache = new Map<string, CardInfo>();

/** Rules summary for any card id the engine knows. Pure and cached; safe to call on every render. */
export function cardInfo(id: string): CardInfo {
  const hit = cache.get(id);
  if (hit) return hit;
  const info = buildCardInfo(id);
  cache.set(id, info);
  return info;
}

function buildCardInfo(id: string): CardInfo {
  try {
    if (/^C\d+$/.test(id)) {
      const c = citizens[id];
      if (!c) return UNKNOWN(id);
      const type = c.type as CitizenType;
      const lines = [c.text as string];
      if (Array.isArray(c.start) && c.start.length) lines.unshift(`Cost: ${fx(c.start)}.`);
      return mk(id, 'citizen', `${CITIZEN_SHORT[type] ?? 'Citizen'} card`, c.name, lines, CITIZEN_COLOR[type]);
    }
    if (/^M\d+$/.test(id) || /^D\d+$/.test(id)) {
      const c = /^M/.test(id) ? morning[id] : dusk[id];
      if (!c) return UNKNOWN(id);
      const lines: string[] = [];
      if (c.top) lines.push(fx(c.top));
      for (const o of c.opts ?? []) lines.push(`- ${o.label}${o.fx ? ': ' + fx(o.fx) : ''}`);
      return mk(id, /^M/.test(id) ? 'morning' : 'dusk', /^M/.test(id) ? 'Morning event' : 'Dusk event', c.title, lines);
    }
    if (/^L\d+$/.test(id)) {
      const l = laws[id];
      if (!l) return UNKNOWN(id);
      const lines: string[] = [];
      if (l.intro?.length) lines.push(`Introduced: ${fx(l.intro)}.`);
      for (const k of Object.keys(l.perm ?? {})) lines.push(`Permanent: ${humanise(k)}.`);
      return mk(id, 'law', 'Law', l.title, lines);
    }
    if (/^L\d+[AB]$/.test(id)) {
      const c = lawConsequences[id];
      if (!c) return UNKNOWN(id);
      const lines = (c.top ?? []).map((x: unknown) => fx([x]));
      return mk(id, 'lawEvent', 'Law consequence', c.title, lines);
    }
    if (/^SD\d+$/.test(id)) {
      const c = socialDispute[id];
      if (!c) return UNKNOWN(id);
      const lines = [c.kind === 'hopeVsDisc' ? 'Compare Hope and Discontent on the tracks.' : 'Most common Hope or Discontent type decides.'];
      for (const key of ['more', 'fewer', 'same'] as const) {
        const v = c[key];
        if (!v) continue;
        if (key === 'same') lines.push(`Equal: ${fx(v)}`);
        else lines.push(`${humanise(key)}: ${Object.entries(v)
          .filter(([k]) => k !== 'default' && k !== 'order')
          .map(([k, fxs]) => `${humanise(k)} (${fx(fxs)})`)
          .join('; ')}`);
      }
      return mk(id, 'social', 'Social Dispute', c.title, lines);
    }
    if (/^W\d+$/.test(id)) {
      const w = weatherCards.find((x: any) => x.id === id);
      if (!w) return UNKNOWN(id);
      const [cold, yellow, orange, red] = w.heat as number[];
      const lines = [
        `Heat: Cold +${cold}, Yellow +${yellow}, Orange +${orange}, Red +${red}.`,
        `Hunting: ${w.hunt} Food per Hunting symbol.`,
        `Scouts advance ${w.scout} space${w.scout === 1 ? '' : 's'}.`,
      ];
      if (w.storm) lines.push(`Storm marker moves back ${w.storm}.`);
      return mk(id, 'weather', 'Weather', `Weather ${id.slice(1)}`, lines);
    }
    if (/^S\d+$/.test(id)) {
      const c = scenarioCards[id];
      if (!c) return UNKNOWN(id);
      const lines: string[] = [];
      if (c.fx) lines.push(fx(c.fx));
      for (const b of c.branches ?? []) lines.push(`${humanise(String(b.if))}: ${fx(b.fx)}`);
      if (c.kind === 'storm') return mk(id, 'storm', 'Storm', c.title, lines);
      return mk(id, 'scenario', 'Scenario', c.title, lines);
    }
    if (/^X\d+$/.test(id)) {
      const e = expeditions[id];
      if (!e) return UNKNOWN(id);
      const lines = (e.options ?? []).map((o: any) => `${o.kind === 'continue' ? 'Continue' : 'Return'}: ${o.label}${o.fx ? ' (' + fx(o.fx) + ')' : ''}`);
      return mk(id, 'expedition', `Expedition ${e.letter}`, e.title, [`${e.steps} steps.`, ...lines]);
    }
    if (/^T\d+$/.test(id)) {
      const t = techs[id];
      if (!t) return UNKNOWN(id);
      return mk(id, 'tech', 'Technology', t.title, [t.text as string, `Develops in ${t.cost} rounds.`]);
    }
    if (id.startsWith('ADV_') || id === 'CALL_TO_RISE') {
      const a = advisors[id];
      if (!a) return mk(id, 'advisor', 'Advisor', humanise(id.replace(/^ADV_/, '')), []);
      const lines = [`Phase: ${a.phase}.`];
      if (a.cost?.length) lines.push(`Cost: ${fx(a.cost)}.`);
      if (a.fx?.length) lines.push(fx(a.fx));
      return mk(id, 'advisor', 'Advisor', a.title, lines);
    }
    if (/^S\d[NHSX]$/.test(id)) {
      const s = societies.find((x: any) => x.id === id);
      if (!s) return UNKNOWN(id);
      return mk(id, 'society', `Society ${s.society}`, `${s.difficulty} society`, []);
    }
  } catch {
    return UNKNOWN(id);
  }
  return UNKNOWN(id);
}

/** Title of a card id, for tooltips and lists. */
export function cardTitle(id: string): string {
  return cardInfo(id).title;
}

/** Whether the card art asset exists for a card id (manifest-driven). */
export function hasArt(id: string): boolean {
  return cardArt(id) !== undefined;
}

// ---- Signatures for memoisation ---------------------------------------------------------------------------

/**
 * Cheap change signature over the slice of GameState a panel reads. Panels are memoised on this string, so a panel
 * re-renders only when its own data changed (GameState may be mutated in place by the engine, so identity is not used).
 */
export function sliceSig(state: GameState, keys: readonly (keyof GameState)[], extra?: unknown): string {
  return JSON.stringify([extra ?? null, ...keys.map((k) => state[k])]);
}

export interface SigProps {
  sig: string;
}
export const sameSig = (a: SigProps, b: SigProps) => a.sig === b.sig;
