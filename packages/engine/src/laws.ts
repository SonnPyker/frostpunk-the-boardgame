// Laws (rulebook p37): introduction through the Platform, Law permissions and the passive-effect aggregator.
//
// Decisions (see docs/ENGINE_SPEC.md §3.5):
// * Introducing a Law: the Leadership holder picks one Law from the Future Law display. Its two Law Consequence cards are
//   hidden (`s.lawConsequenceBank`): one is chosen at random and shuffled into the Dusk deck unseen, the other is dropped.
//   `platform:chooseConsequence` lets the player choose instead (options are labelled A/B so the hidden ids never leak).
//   The intro effect (+ `onIntro`) then runs at once. Then `buildOnIntro` (laws.json; L02, L09, L10, L11) offers an OPTIONAL
//   immediate build of that building at its normal cost (printed card text: "you may immediately build X by paying its
//   cost"; op `bldLawOffer` in buildings.ts). Otherwise a Law only unlocks its building (buildings.json `law`, read by
//   buildings.ts `unlockedKinds`), which is then built through Construct. The `unlock` arrays in laws.json are informational
//   (nothing reads them). See ENGINE_SPEC §3.4.
// * Max 4 Laws (`lawRules.maxLaws`). A Law cannot be discarded. Starting pairs (L01/L02, L03/L04, L05/L06, L07/L08):
//   introducing one removes the paired Law from the game, so L07 xor L08 falls out of the pairing.
// * A Law's permanent `perm` applies only while it is not covered by a Law Consequence card. A covering card's `passive`
//   list applies instead (the card replaces the Law's effect until it is discarded, see cards.ts).
// * Passive names are normalised to `{key, args}` where `args` are the trailing `:` parts (`childMeeplesMayUseGatheringPost:3`
//   -> key `childMeeplesMayUseGatheringPost`, args ['3']). `passive(s,key)` sums the first numeric argument of every matching
//   entry (1 for a flag without a number). Some names are aliases of canonical names (see ALIASES).
// * Sources: law perms (active laws only), covering Law Consequence `passive` lists, `eventPassive` of Event cards on display,
//   and the `mod` lists of developed Technologies (tech.ts).
// * `actionOncePerRound` laws (L13, L14, L17) are listed by `lawActionsAvailable` and run by `runLawAction`; the Worker or
//   Engineer placement that makes the action is done by the caller (actions.ts).
import { ask, defOp, log, opt, push } from './core';
import * as D from './data';
import { addToDusk } from './cards';
import { describeList } from './fx/describe';
import { feasible, runFx } from './fx/core';
import type { Ctx } from './fx/core';
import { randInt } from './rng';
import type { GameState } from './types';

export const LAW_MAX: number = (D.lawRules as any)?.maxLaws ?? 4;
const LAWS = D.laws;

export type PassiveKind = 'law' | 'consequence' | 'event' | 'tech';
export interface PassiveEntry {
  key: string; // canonical passive name
  args: string[]; // trailing ':' parts
  src: string; // 'law:L04' | 'card:L04A' | 'card:M022' | 'tech:T08'
  kind: PassiveKind;
  data?: any; // object-valued entries (actionOncePerRound, hungerStartOncePerRound, ...)
}
/** A list of effects to run later (weather / night of covering cards, Technology weather mods). */
export interface FxRun {
  src: string;
  card?: string; // ctx.card for tokens such as coverToDiscard
  list: any[];
}

/** Written name -> extra canonical names it also grants. Keeps the written name too. */
const ALIASES: Record<string, string[]> = {
  workersMayUseWorkshops: ['workersUseWorkshops'],
  workersUseWorkshopsAndGenerator: ['workersUseWorkshops', 'workersUseGenerator'],
};

// ---- passive normalisation ----------------------------------------------------------------------------------------

function add(out: PassiveEntry[], key: string, args: string[], src: string, kind: PassiveKind, data?: any) {
  const e: PassiveEntry = { key, args, src, kind };
  if (data !== undefined) e.data = data;
  out.push(e);
  for (const a of ALIASES[key] ?? []) out.push({ ...e, key: a });
}

/** A list of passive strings such as ['heatedBySpendFood:2', 'removeSnowChildSpendFood:3:heated']. */
function fromList(list: any[], src: string, kind: PassiveKind, out: PassiveEntry[]) {
  for (const item of list) {
    if (typeof item === 'string') {
      const [key, ...args] = item.split(':');
      add(out, key, args, src, kind);
    } else if (item && typeof item === 'object') {
      const key = Object.keys(item)[0];
      if (key) add(out, key, [], src, kind, item);
    }
  }
}

/** An object of passives: arrays are lists of names, numbers/true are flags with a value, objects keep their data. */
function fromObj(obj: Record<string, any>, src: string, kind: PassiveKind, out: PassiveEntry[]) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (Array.isArray(v)) fromList(v, src, kind, out);
    else if (typeof v === 'number') add(out, k, [String(v)], src, kind);
    else if (v === true) add(out, k, [], src, kind);
    else if (v && typeof v === 'object') add(out, k, [], src, kind, v);
  }
}

/** Every passive entry currently in force, from all sources. */
export function collectPassives(s: GameState): PassiveEntry[] {
  const out: PassiveEntry[] = [];
  for (const l of s.laws) {
    if (l.covered) {
      const c = D.lawConsequences[l.covered];
      if (c?.passive) fromList(c.passive, `card:${c.id}`, 'consequence', out);
    } else if (LAWS[l.id]?.perm) {
      fromObj(LAWS[l.id].perm, `law:${l.id}`, 'law', out);
    }
  }
  for (const ev of s.events) {
    const d = D.morning[ev.card] ?? D.dusk[ev.card];
    if (d?.eventPassive) fromObj(d.eventPassive, `card:${ev.card}`, 'event', out);
  }
  for (const t of s.techs) {
    if (t.state !== 'done') continue;
    const d = D.techs[t.id];
    if (d?.mod) fromList(d.mod, `tech:${t.id}`, 'tech', out);
  }
  return out;
}

export function passiveEntries(s: GameState, key: string, kinds?: PassiveKind[]): PassiveEntry[] {
  return collectPassives(s).filter((e) => e.key === key && (!kinds || kinds.includes(e.kind)));
}

const valueOf = (e: PassiveEntry) => {
  const n = Number(e.args[0]);
  return e.args.length > 0 && Number.isFinite(n) ? n : 1;
};

/** Sum of the numeric values of all entries named `key` (1 per flag). 0 when none. */
export function passive(s: GameState, key: string): number {
  return passiveEntries(s, key).reduce((a, e) => a + valueOf(e), 0);
}
export function hasPassive(s: GameState, key: string): boolean {
  return passiveEntries(s, key).length > 0;
}
/**
 * D062 Engineers' Strike (event passive `noEngineerSpecific`): Engineers may not use Engineer-specific actions, except the
 * event action on that card itself. `card` is the Event card whose action is asked about; null asks about a Building.
 * The passive's source is `card:D062`, so the card that grants it keeps its own action.
 */
export function engineerSpecificBarred(s: GameState, card: string | null = null): boolean {
  const entries = passiveEntries(s, 'noEngineerSpecific');
  if (entries.length === 0) return false;
  return !(card !== null && entries.some((e) => e.src === `card:${card}`));
}
/** Passives granted by Law permissions and covering Law Consequence cards only. */
export function lawPermission(s: GameState, key: string): number {
  return passiveEntries(s, key, ['law', 'consequence']).reduce((a, e) => a + valueOf(e), 0);
}
/**
 * Passives granted by developed Technologies only (T01-T17 `mod` lists). Informational: no engine code queries a tech
 * mod key. Each printed Technology effect is implemented by its tech id (`techDone(s, 'Txx')`). The map of mod key ->
 * implementation is checked by tests/audit_4_tech_mods.test.ts.
 */
export function techMod(s: GameState, key: string): number {
  return passiveEntries(s, key, ['tech']).reduce((a, e) => a + valueOf(e), 0);
}

/** Effect lists of covering Law Consequence cards (`weather` or `night`), to be run with ctx.card = the card. */
export function coverRuns(s: GameState, key: 'weather' | 'night'): FxRun[] {
  const out: FxRun[] = [];
  for (const l of s.laws) {
    if (!l.covered) continue;
    const c = D.lawConsequences[l.covered];
    if (c?.[key]) out.push({ src: `card:${c.id}`, card: c.id, list: c[key] });
  }
  return out;
}

// ---- law special actions (actionOncePerRound) ----------------------------------------------------------------------

export interface LawAction {
  lawId: string;
  title: string;
  pay: any[];
  choose?: any[][];
  fx: any[];
  disabled?: string;
}

function lawActUsed(s: GameState, id: string): boolean {
  const r = s.flags.lawAct;
  return !!r && r.round === s.round && (r.used as string[]).includes(id);
}
function markLawAct(s: GameState, id: string) {
  const r = s.flags.lawAct;
  const used: string[] = r && r.round === s.round ? [...r.used] : [];
  used.push(id);
  s.flags.lawAct = { round: s.round, used };
}

/** Once-per-Round special actions of the Laws in force (L13 Time to Rest, L14 Extended Shift, L17 Emergency Shift). */
export function lawActionsAvailable(s: GameState, who: number): LawAction[] {
  const out: LawAction[] = [];
  for (const l of s.laws) {
    if (l.covered) continue;
    const perm = LAWS[l.id]?.perm?.actionOncePerRound;
    if (!perm) continue;
    const ctx: Ctx = { who, src: 'law:' + l.id };
    const pay: any[] = perm.pay ?? [];
    const why = lawActUsed(s, l.id) ? 'Already used this Round' : feasible(s, pay, ctx);
    out.push({
      lawId: l.id,
      title: LAWS[l.id].title,
      pay,
      choose: perm.choose,
      fx: perm.fx ?? [],
      disabled: why ?? undefined,
    });
  }
  return out;
}

/** Pay the cost and resolve the benefit of a law special action. Returns false if it is not available. */
export function runLawAction(s: GameState, who: number, lawId: string): boolean {
  const a = lawActionsAvailable(s, who).find((x) => x.lawId === lawId);
  if (!a || a.disabled) return false;
  markLawAct(s, lawId);
  const list: any[] = [...a.pay, ...(a.choose ? [{ choose: a.choose }] : []), ...a.fx];
  runFx(s, list, { who, src: 'law:' + lawId });
  return true;
}

// ---- introduction ---------------------------------------------------------------------------------------------------

export function allLawIds(extraPack = false): string[] {
  return Object.values(LAWS)
    .filter((l: any) => extraPack || l.pack !== 'extra')
    .map((l: any) => l.id as string);
}

/** Laws that may be introduced now: in the Future Law display, not removed, not blocked by an introduced pair, below the max. */
export function lawCandidates(s: GameState): string[] {
  if (s.laws.length >= LAW_MAX) return [];
  return s.futureLaws.filter((id) => {
    const def = LAWS[id];
    if (!def) return false;
    if (s.laws.some((l) => l.id === id) || s.removedLaws.includes(id)) return false;
    if (def.pairedWith && s.laws.some((l) => l.id === def.pairedWith)) return false;
    return true;
  });
}
export function canIntroduceLaw(s: GameState): boolean {
  return lawCandidates(s).length > 0;
}

function consequenceBank(s: GameState, lawId: string): string[] {
  const bank = s.lawConsequenceBank?.[lawId];
  if (bank && bank.length) return bank;
  return Object.values(D.lawConsequences)
    .filter((c: any) => c.law === lawId)
    .map((c: any) => c.id as string);
}

/**
 * Introduce a Law (Platform action, custom:introduceLaw, SD04 Mistrust). `lawId` restricts the choice to one Law.
 * `chooseConsequence` lets the Leadership holder pick which Law Consequence goes into the Dusk deck.
 */
export function introduceLaw(s: GameState, lawId?: string, opts: { chooseConsequence?: boolean; src?: string } = {}) {
  const cands = lawCandidates(s);
  const pool = lawId ? cands.filter((x) => x === lawId) : cands;
  if (pool.length === 0) {
    log(s, 'law.none', 'No Law can be introduced', {});
    return;
  }
  ask(s, {
    who: s.leader,
    kind: 'law',
    prompt: 'Choose a Law from the Future Law display',
    src: opts.src,
    options: pool.map((id) => {
      const d = LAWS[id];
      return opt(id, d.title, { hint: describeList([...(d.intro ?? []), ...(d.onIntro ?? [])]) });
    }),
    then: { k: 'lawPicked', chooseConsequence: !!opts.chooseConsequence },
  });
}

defOp('lawPicked', (s, op) => {
  const id: string | undefined = op.pick?.[0];
  if (!id || !lawCandidates(s).includes(id)) return;
  const bank = consequenceBank(s, id);
  if (op.chooseConsequence && bank.length > 1) {
    ask(s, {
      who: s.leader,
      kind: 'law',
      prompt: `Choose the Law Consequence of ${LAWS[id].title} to shuffle into the Dusk deck (the other is removed unseen)`,
      options: bank.map((_, i) => opt(String(i), `Law Consequence ${String.fromCharCode(65 + i)}`)),
      then: { k: 'lawConsPicked', lawId: id },
    });
    return;
  }
  push(s, { k: 'lawConsPicked', lawId: id, pick: [String(randInt(s.rng, bank.length))] });
});

defOp('lawConsPicked', (s, op) => {
  const id: string = op.lawId;
  const bank = consequenceBank(s, id);
  const i = Number(op.pick?.[0]);
  const chosen = bank[Number.isFinite(i) && bank[i] ? i : 0];
  if (chosen) addToDusk(s, chosen); // hidden: the other consequence is removed from the game unseen
  if (s.lawConsequenceBank) delete s.lawConsequenceBank[id];
  push(s, { k: 'lawApply', lawId: id });
});

defOp('lawApply', (s, op) => {
  const id: string = op.lawId;
  const def = LAWS[id];
  if (!def) return;
  s.futureLaws = s.futureLaws.filter((x) => x !== id);
  if (def.pairedWith) {
    const p: string = def.pairedWith;
    s.futureLaws = s.futureLaws.filter((x) => x !== p);
    if (!s.removedLaws.includes(p)) s.removedLaws.push(p);
  }
  s.laws.push({ id, covered: null });
  log(s, 'law.intro', `${def.title} was introduced`, { law: id });
  // buildOnIntro (L02, L09, L10, L11): the optional paid build runs AFTER the intro Hope/Discontent change. push() first, then
  // runFx() on top, so the fx executes first.
  if (def.buildOnIntro) push(s, { k: 'bldLawOffer', lawId: id });
  runFx(s, [...(def.intro ?? []), ...(def.onIntro ?? [])], { who: s.leader, src: 'law:' + id });
});
