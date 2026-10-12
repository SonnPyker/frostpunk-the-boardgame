// Engine-facing helpers for decisions: which option ids are cards, the card behind a decision, and expedition
// choices with their effect text. Pure functions over engine data; nothing is stored.
import { describeFx, expeditions, scenarioCards, type GameState, type Pending, type PendingOption } from '@frostpunk/engine';
import { BUILDING_TEXT, type BuildingView } from '../data/buildingInfo';
import { cardInfo } from '../hud/model';
import { humanise } from './labels';

export { actionIcon, kindIcon, kindLabel, optionIcon } from './labels';

const CARD_ID = /^(?:C\d+|M\d+|D\d+|L\d+[AB]?|SD\d+|W\d+|S\d+|X\d+|T\d+|ADV_[A-Z_]+|CALL_TO_RISE)$/;

/** True when the id names a card the HUD can draw (art or text face). */
export function isCardId(id: string): boolean {
  return CARD_ID.test(id) && cardInfo(id).kind !== 'unknown';
}

/** The card id inside a source tag such as 'card:D016', 'cit:C04', 'exp:X01', 'scn:S05:r3' or 'law:L03'. */
export function sourceCardId(src: string | undefined): string | null {
  if (!src) return null;
  const part = src.includes(':') ? src.split(':')[1] : src;
  return part && isCardId(part) ? part : null;
}

/**
 * The "Asked because" line: the card a decision came from, or the phase or building it belongs to. The engine's source
 * tags are prefix:id pairs (card:D016, cit:C04, bld:cookhouse, death:C19, phase:hunger, setup:crater, call:rise ...).
 */
export function sourceTitle(src: string | undefined): string | null {
  if (!src) return null;
  const [head, arg = ''] = src.split(':');
  if (head === 'death') return isCardId(arg) ? `Death of ${cardInfo(arg).title}` : 'Citizen death';
  const id = sourceCardId(src);
  if (id) return cardInfo(id).title;
  if (src === 'action' || head === 'act') return 'Action phase';
  if (head === 'bld') return arg ? humanise(arg) : 'Building';
  if (head === 'phase') return arg ? `${humanise(arg)} phase` : 'Phase';
  if (head === 'call') return 'Call to Rise';
  if (head === 'setup') return 'Setup';
  if (head === 'adv' || head === 'advisor') return 'Advisor';
  if (head === 'scn') return 'Scenario';
  if (head === 'exp') return 'Expedition';
  return humanise(head);
}

/** Engine effect tokens that reach a choice label without going through describeFx (see fx/tokens_action.ts, tokens_people.ts). */
const RAW_LABEL: Record<string, string> = {
  buildingNormal: 'Build as normal: pay its cost, then get its effect',
  sickPerChildMeeple: 'Each Child falls sick',
};

/** An engine token in parentheses, e.g. "Special effect (generatorUpgradeOnFirstCore)": the player does not need the id. */
const PAREN_TOKEN = /\s*\((?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z]+:[^)\s]*)\)/g;

/** Text with the engine-token parentheses removed (ordinary text is returned unchanged). */
export function stripTokens(text: string): string {
  const out = text.replace(PAREN_TOKEN, '').trim();
  return out || text;
}

/** Map-space suffixes the engine uses for the two halves of a tile. */
const HALF: Record<string, string> = { top: 'upper', bottom: 'lower' };

/** Engine nouns whose count decides the form: "1 Resources" reads "1 Resource", "2 Resource" reads "2 Resources". */
const NOUN: Record<string, { one: string; many: string }> = {
  Resources: { one: 'Resource', many: 'Resources' },
  Resource: { one: 'Resource', many: 'Resources' },
  Coals: { one: 'Coal', many: 'Coal' },
  Foods: { one: 'Food', many: 'Food' },
  Corpses: { one: 'Corpse', many: 'Corpses' },
  Citizens: { one: 'Citizen', many: 'Citizens' },
  Children: { one: 'Child', many: 'Children' },
  Scouts: { one: 'Scout', many: 'Scouts' },
  Engineers: { one: 'Engineer', many: 'Engineers' },
  Automatons: { one: 'Automaton', many: 'Automatons' },
  Buildings: { one: 'Building', many: 'Buildings' },
  Trees: { one: 'Tree', many: 'Trees' },
};

/** Words that begin with a vowel letter but a consonant sound ("a useful", "a unit"): they keep "a". */
const CONSONANT_SOUND = /^(?:uni|use|usa|usu|eu|one|once|ubi|ufo)/i;

/**
 * Presentation-only text repair for engine strings: engine token words, map-space ids (N04:bottom), counts with a
 * singular or plural noun ("1 Resources") and article grammar ("A Engineer"). Pure; nothing here touches game state.
 */
export function friendlyText(text: string): string {
  let t = text;
  t = t.replace(/\bgatherAdjacentSpace:(\d+)\b/g, (_, n: string) => `up to ${n} from an adjacent space`);
  t = t.replace(/\bbuildingNormal\b/g, 'build as normal (pay its cost, then get its effect)');
  t = t.replace(/\bsickPerChildMeeple\b/g, 'each Child falls sick');
  t = t.replace(/\b([A-Z]{1,3}\d{1,3}):(top|bottom)\b/g, (_, id: string, half: string) => `Tile ${id} (${HALF[half]})`);
  t = t.replace(/\bGEN:([a-zA-Z]+)\b/g, (_, s: string) => `Generator ${s}`);
  t = t.replace(/\b(\d+)(\s+)([A-Za-z]+)\b/g, (whole, n: string, sp: string, word: string) => {
    const pair = NOUN[word];
    if (!pair) return whole;
    return `${n}${sp}${Number(n) === 1 ? pair.one : pair.many}`;
  });
  t = t.replace(/\b([Aa]n?)(\s+)([A-Za-z][A-Za-z-]*)\b/g, (whole, art: string, sp: string, word: string) => {
    const cap = art.charAt(0) === 'A';
    const an = art.toLowerCase() === 'an';
    const vowel = /^[AEIOUaeiou]/.test(word) && !CONSONANT_SOUND.test(word);
    if (vowel && !an) return `${cap ? 'An' : 'an'}${sp}${word}`;
    if (!vowel && an && !/^h/i.test(word) && /^[A-Za-z]/.test(word)) return `${cap ? 'A' : 'a'}${sp}${word}`;
    return whole;
  });
  return t;
}

/**
 * The text a player reads for one option. Engine labels are mostly sentences; a few are bare numbers ("Take how many"
 * counts), engine tokens (buildingNormal) or camelCase ids. Those get words here; everything else is repaired by
 * friendlyText.
 */
export function friendlyLabel(p: Pending, o: PendingOption): string {
  return friendlyText(baseLabel(p, o));
}

function baseLabel(p: Pending, o: PendingOption): string {
  const raw = stripTokens((o.label ?? '').trim());
  if (!raw) return prettyToken(o.id);
  if (RAW_LABEL[raw]) return RAW_LABEL[raw];
  const gather = /^gatherAdjacentSpace:(\d+)$/.exec(raw);
  if (gather) return `Take up to ${gather[1]} from an adjacent space`;
  if (/^\d+$/.test(raw)) return /how many|take|amount|number|count|how much/i.test(p.prompt) ? `Take ${raw}` : raw;
  const space = /^([A-Z]{1,3}\d{1,3}|GEN):([a-zA-Z]+)$/.exec(raw);
  if (space) return space[1] === 'GEN' ? `Generator ${space[2]}` : `Tile ${space[1]} (${HALF[space[2]] ?? space[2]})`;
  if (/^[a-z]+[A-Z][A-Za-z]*$/.test(raw)) return humanise(raw);
  if (/^[A-Za-z]+:\S+$/.test(raw)) return prettyToken(raw);
  return raw;
}

/** Card id that a stack label ends with, e.g. "Title (A) - X01" gives X01. */
export function stackCardId(label: string): string | null {
  const m = /-\s*([A-Z]+\d+)\s*$/.exec(label);
  return m && isCardId(m[1]) ? m[1] : null;
}

/** The card an option stands for, when it has art: the option id itself, or the card in an expedition stack label. */
export function thumbFor(p: Pending, o: PendingOption): string | null {
  if (isCardId(o.id)) return o.id;
  if (p.kind === 'expStack') return stackCardId(o.label);
  return null;
}

/** Decision kinds whose options name a building by its uid as a plain number (building, dismantle, upgradePick, destroy). */
const UID_OPTION_KINDS = new Set(['building', 'dismantle', 'upgradePick', 'destroy']);

/**
 * The building an option stands for: a building kind in a Construct list (buildPick, the option id is the kind), or a
 * building uid (`b:<uid>`, or a plain number in the kinds above). Null for any other option, and for a uid the state
 * does not hold.
 */
export function buildingOf(p: Pending, o: PendingOption, state: GameState | undefined): BuildingView | null {
  if (p.kind === 'buildPick' && BUILDING_TEXT[o.id]) return { kind: o.id };
  let uid: number | null = null;
  if (o.id.startsWith('b:')) uid = Number(o.id.slice(2));
  else if (UID_OPTION_KINDS.has(p.kind) && /^\d+$/.test(o.id)) uid = Number(o.id);
  if (uid === null || !state) return null;
  const b = state.buildings.find((x) => x.uid === uid);
  return b ? { kind: b.kind, upgraded: b.upgraded, ruins: b.ruins } : null;
}

/** The card a decision is about: its meta.card, or the card named by its source tag. */
export function contextCardId(p: Pending): string | null {
  const fromMeta = typeof p.meta?.card === 'string' && isCardId(p.meta.card) ? p.meta.card : null;
  return fromMeta ?? sourceCardId(p.src);
}

const RES_WORD: Record<string, string> = { wood: 'Wood', coal: 'Coal', food: 'Food', core: 'Steam Core', steel: 'Steel' };

/**
 * Presentation-only fallback for effect tokens the engine describer leaves raw (e.g. "mapRemove:coal:2").
 * Only used when describeFx returned the token unchanged; nothing here touches game state.
 */
export function prettyToken(t: string): string {
  const remove = /^mapRemove:([a-z]+):(\d+)$/.exec(t);
  if (remove) return `Remove ${remove[2]} ${RES_WORD[remove[1]] ?? humanise(remove[1])} from the map`;
  if (/^[A-Za-z]+:/.test(t)) {
    const [head, ...args] = t.split(':');
    return [humanise(head), ...args.map((a) => humanise(a))].join(' ');
  }
  return t;
}

/** An option hint: a bare effect token ("mapRemove:coal:2") is prettified; ordinary text passes through. */
export function prettyHint(hint: string | undefined): string | undefined {
  if (!hint) return hint;
  const text = /^[A-Za-z]+(:[A-Za-z0-9|+-]+)+$/.test(hint) ? prettyToken(hint) : hint;
  return friendlyText(text);
}

/** Effect text of a list of engine effects, skipping bookkeeping tokens. */
export function effectText(fx: unknown): string {
  if (!Array.isArray(fx)) return '';
  return fx
    .filter((x) => x !== 'remove' && x !== 'event')
    .map((x) => {
      try {
        const text = describeFx(x);
        return typeof x === 'string' && text === x ? prettyToken(x) : text;
      } catch {
        return prettyToken(String(x));
      }
    })
    .filter((t) => t.length > 0)
    .join(' · ');
}

export interface ExpChoice {
  kind: string;
  label: string;
  effect: string;
}

/** The Explore choices of an expedition card (X-cards and scenario S-cards), in engine option order. */
export function expeditionChoices(cardId: string): ExpChoice[] {
  const sc = scenarioCards[cardId];
  const x = expeditions[cardId] ?? (sc?.expedition ? sc : undefined);
  if (!x) return [];
  return ((x.options ?? []) as any[]).map((o) => ({
    kind: o.kind ?? 'return',
    label: friendlyText(String(o.label || o.text || '')),
    effect: effectText(o.fx),
  }));
}

/** Rules text for the two arrival choices. */
export const ARRIVE_TEXT: Record<string, string> = {
  skip: "Place the next letter's card on top and keep the Scout moving.",
  explore: 'Flip this card over and choose one of its outcomes.',
};
