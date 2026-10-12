// ACTIONS (spec 3.2, 4.5, 6): the Action phase. Turn loop, the action menu, Meeple and Citizen-card choices, and the
// resolution of Remove Snow, Gather Resources, Construct, Use a Building, Deploy Scouts and Special actions.
// Rules: rulebook p26 (actions), Citizen cards, Reuse rules, automatons. Checklist: ACT-01..11, ACT-GR1-3, ACT-RS1-4,
// ACT-CO1-5, ACT-UB*, ACT-DS1-2, ACT-SP1-2, ACT-CC1-2. Decision ids: docs/DECISION_IDS.md.
//
// Phase contract (spec 6): PHASES pushes {k:'actStart'}; this module pushes {k:'phAdvance'} as the continuation that
// runs after the phase, and {k:'actClose'} before it. Everything else is local to this file or to fx/tokens_action.ts.
import { ask, askDistribute, defOp, DistOption, log, opt, push } from './core';
import type { PendingOption } from './types';
import { feasible, runFx } from './fx/core';
import type { Ctx } from './fx/core';
import { citizens, eventCard, meepleCountFor } from './data';
import { constructActionOpts, startConstruct, startUseBuilding, usableBuildings, usageProblem, effectiveAction, UsableBuilding } from './buildings';
import { removeSnowAction, tileAvailable } from './tiles';
import { deployScout, legalExpeditionDeploy } from './expedition';
import { scenarioSpecialActions, scenarioStockState } from './scenario';
import type { ScenarioSpecialAction } from './scenario';
import { engineerSpecificBarred, hasPassive, lawActionsAvailable, passive, runLawAction } from './laws';
import { fuelRoom } from './generator';
import { steamHubState } from './steamHub';
import { adjacentSpaces, spaceAllowed, spaceHeated, spaceLabel, tileForcedHeated, tileOfSpace } from './map';
import { addSick } from './sickness';
import { buildingByUid, citizenTypeOf, freeSupply, gainRes, hasBuilt, lawActive, meepleById, meeplesAtSpace, newMeeple, removeMeeple, roleOf, spendRes, techDone } from './util';
import { CITIZEN_TYPES } from './types';
import type { CitizenType, GameState, Meeple, MeepleKind, ResKind } from './types';

// ---------------------------------------------------------------------------------------------------------
// constants and small helpers
// ---------------------------------------------------------------------------------------------------------

export type MainAct = 'removeSnow' | 'gather' | 'construct' | 'use' | 'deploy';
export const MAIN_ACTS: MainAct[] = ['removeSnow', 'gather', 'construct', 'use', 'deploy'];
/** Citizen card `act` field for each main action */
export const CARD_ACT: Record<MainAct, string> = {
  removeSnow: 'removeSnow',
  gather: 'gatherResources',
  construct: 'construct',
  use: 'useBuilding',
  deploy: 'deployScouts',
};
const ACT_ID: Record<MainAct, string> = {
  removeSnow: 'act:removeSnow',
  gather: 'act:gather',
  construct: 'act:construct',
  use: 'act:use',
  deploy: 'act:deploy',
};
const ACT_LABEL: Record<MainAct, string> = {
  removeSnow: 'Remove Snow (2 Near or 1 Far tile)',
  gather: 'Gather Resources',
  construct: 'Construct',
  use: 'Use a Building',
  deploy: 'Deploy Scouts',
};
const KIND_LABEL: Record<MeepleKind, string> = {
  worker: 'Worker',
  engineer: 'Engineer',
  automaton: 'Automaton',
  child: 'Child',
  childWorker: 'Child (Worker)',
  childEngineer: 'Child (Engineer)',
};
const KIND_ORDER: MeepleKind[] = ['worker', 'engineer', 'automaton', 'child', 'childWorker', 'childEngineer'];
const CHILD_KINDS: MeepleKind[] = ['child', 'childWorker', 'childEngineer'];
const isChildKind = (k: MeepleKind) => CHILD_KINDS.includes(k);

const actOf = (id: string): MainAct | null => (MAIN_ACTS.find((a) => ACT_ID[a] === id) ?? null);
const cardDef = (id: string): any => citizens[id];
const hasTok = (list: any[], head: string) => list.some((x) => typeof x === 'string' && x.split(':')[0] === head);

/** Next seat clockwise (solo: always 0). */
export function nextSeat(s: GameState): number {
  const n = s.players.length;
  return n <= 1 ? 0 : (s.turn + 1) % n;
}

/** Coal an automaton costs per use (T17 with Heat above the Red indicator: free). */
export function automatonCoal(s: GameState): number {
  const red = s.gen.ind.red;
  if (techDone(s, 'T17') && red != null && s.gen.heat > red) return 0;
  return 1;
}

/** Cost list of an event action: array of tokens, or a map {food: 5} -> ['spend:food:5']. */
function costTokens(c: any): string[] {
  if (!c) return [];
  if (Array.isArray(c)) return c.map(String);
  return Object.entries(c).map(([k, v]) => `spend:${k}:${v}`);
}

function markUsed(m: Meeple, loc: Meeple['loc']) {
  m.loc = loc;
  m.used = true;
}

/** Cold-action sickness (ACT-08): +1 of the acting Meeple's type unless a `coldSick:<type>:N` token overrides it. */
/** D043: is the Far tile the Automaton lies on (ev.extra.tile, set by custom.ts) heated? Unknown tile: no cold action. */
function d043TileHeated(s: GameState, ev: { extra?: any }): boolean {
  const tile = s.tiles.find((t) => t.key === ev.extra?.tile);
  if (!tile || !tile.spaces.length) return true;
  return spaceHeated(s, tile.spaces[0], false);
}

function applyCold(s: GameState, who: number, kind: MeepleKind | null, list: any[]) {
  if (!kind || kind === 'automaton') return;
  const t = citizenTypeOf(kind);
  if (!t) return;
  let type: CitizenType = t;
  let n = 1;
  const ov = list.find((x) => typeof x === 'string' && x.startsWith('coldSick:'));
  if (ov) {
    const p = String(ov).split(':');
    type = (p[1] as CitizenType) || t;
    n = Number(p[2] ?? 1) || 1;
  }
  log(s, 'act.cold', `Cold action: +${n} sick ${type}`, { type, n });
  addSick(s, type, n, who);
}

/** Heat-by-spending-Food laws: `heatedBySpendFood:N` lets actions that spend at most N Food count as heated. */
function foodHeats(s: GameState, list: any[]): boolean {
  const lim = passive(s, 'heatedBySpendFood');
  if (!lim) return false;
  return list.some((x) => typeof x === 'string' && x.startsWith('spend:food:') && Number(x.split(':')[2]) <= lim);
}

/** Gather / Use heating (ACT-07): zone or insulation heating, plus the card's `heated` token and food-spend laws. */
export function actionHeated(s: GameState, space: string, useBuilding: boolean, list: any[]): boolean {
  if (hasTok(list, 'heated') || list.includes('heated')) return true;
  if (foodHeats(s, list)) return true;
  if (s.gen.heat <= 1) {
    // Heat on space 1: the Generator has not started, so only tile-forced heating (Field Kitchen, lit Steam Hub) applies
    const t = tileOfSpace(s, space);
    return !!t && tileForcedHeated(s, t);
  }
  return spaceHeated(s, space, useBuilding);
}

export { spaceAllowed } from './map';

function spaceResTotal(s: GameState, sid: string): number {
  const r = s.spaces[sid]?.res ?? {};
  return (r.wood ?? 0) + (r.coal ?? 0) + (r.core ?? 0);
}

/** Gather candidates. mode res: Resources, or Trees when T04 is developed; tree: Trees; any: every unoccupied space. */
export function gatherCandidates(s: GameState, mode: 'res' | 'tree' | 'any'): string[] {
  return Object.keys(s.spaces).filter((sid) => {
    const sp = s.spaces[sid];
    if (s.usedSpaces.includes(sid)) return false;
    if (meeplesAtSpace(s, sid).length > 0) return false;
    if (!spaceAllowed(s, sid)) return false;
    const trees = sp.trees ?? 0;
    if (mode === 'any') return true;
    if (mode === 'tree') return trees > 0;
    return spaceResTotal(s, sid) > 0 || (techDone(s, 'T04') && trees > 0);
  });
}

/** Gather mode of a Citizen card: tree (C04), any space with adjacent Food (C28), or the normal Resource gather. */
function cardGatherMode(c: any): 'res' | 'tree' | 'any' {
  const fx: any[] = c.fx ?? [];
  if (fx.some((x) => typeof x === 'string' && x.startsWith('gatherTree'))) return 'tree';
  if (fx.some((x) => typeof x === 'string' && x.startsWith('gatherFoodAdjacent'))) return 'any';
  return 'res';
}

/** Whether a Meeple kind may take this main action without a Citizen card (ACT-04, ACT-05, ACT-06). */
export function normalAllowed(s: GameState, kind: MeepleKind, a: MainAct): boolean {
  // child workers and child engineers act as their adult role (roleOf); plain children are handled below
  const role = roleOf(kind);
  const base = role === 'worker' || role === 'engineer' || role === 'automaton';
  // M022 (Youth Gang, event passive noChildMeeples): Child Meeples take no actions at all
  if (isChildKind(kind) && hasPassive(s, 'noChildMeeples')) return false;
  switch (a) {
    case 'removeSnow':
    case 'construct':
      return base;
    case 'gather':
      return base || (isChildKind(kind) && lawActive(s, 'L01'));
    case 'use':
      return base || isChildKind(kind); // childOk is decided per building by usageProblem
    case 'deploy':
      return role === 'worker' || role === 'engineer';
  }
}

/** Option lists of a choose-type Citizen effect: `{choose: [...]}`, or `cookhouseTiers:<cost>:<hunger>...` (C23). */
function choiceLists(it: any): any[][] | null {
  if (it && typeof it === 'object' && Array.isArray(it.choose)) return it.choose;
  if (typeof it === 'string' && it.startsWith('cookhouseTiers:')) {
    const a = it.split(':').slice(1);
    const out: any[][] = [];
    for (let i = 0; i + 1 < a.length; i += 2) out.push([`spend:food:${a[i]}`]);
    return out;
  }
  return null;
}

/**
 * Spend rule (rulebook p16): "You cannot choose an effect for which you do not have the full amount". A Citizen card whose
 * required Spend cannot be paid is not playable, so it is not offered as a replacement (C20, C23). A choose needs one legal
 * option. An optional part (ifPay, C17) does not block the card. Null when the card can be played.
 */
export function citizenCostProblem(s: GameState, card: string, who: number): string | null {
  const ctx: Ctx = { who, src: 'cit:' + card, card };
  for (const it of cardDef(card)?.fx ?? []) {
    const lists = choiceLists(it);
    if (lists) {
      if (lists.length === 0) continue;
      const whys = lists.map((l) => feasible(s, l, ctx));
      if (whys.every((w) => w !== null)) return whys[0];
      continue;
    }
    const why = feasible(s, [it], ctx);
    if (why) return why;
  }
  return null;
}

/** Citizen cards in hand that may replace this action with this Meeple kind (ACT-CC1). */
export function playableCards(s: GameState, who: number, a: MainAct, kind: MeepleKind | null, meeple: number | null): string[] {
  const p = s.players[who];
  if (!p || p.playedCitizen) return [];
  if (kind && isChildKind(kind) && hasPassive(s, 'noChildMeeples')) return [];
  const t = kind ? citizenTypeOf(kind) : null;
  return p.hand.filter((id) => {
    const c = cardDef(id);
    if (!c || c.act !== CARD_ACT[a]) return false;
    if (citizenCostProblem(s, id, who)) return false;
    if (a === 'deploy') return (c.type === 'worker' || c.type === 'engineer') && !legalExpeditionDeploy(s, { only: c.type });
    if (!kind || c.type !== t) return false;
    if (a === 'gather') return gatherCandidates(s, cardGatherMode(c)).length > 0;
    if (a === 'use') return usableFor(s, meeple, c).length > 0;
    return true;
  });
}

function usableFor(s: GameState, meeple: number | null, c: any): UsableBuilding[] {
  return usableBuildings(s, meeple, c.type === 'child').filter((u) => u.usable && (c.buildings ?? []).includes(u.kind));
}

export interface KindOpt {
  kind: MeepleKind;
  meeple: number; // representative Meeple (lowest id of that kind in supply)
  normalOk: boolean;
  normalWhy: string | null;
  cards: string[];
  disabled: string | null;
}

/** One entry per Meeple kind in the supply that may take the action (normally or by a Citizen card). */
export function kindOptions(s: GameState, who: number, a: MainAct): KindOpt[] {
  const out: KindOpt[] = [];
  for (const kind of KIND_ORDER) {
    const rep = freeSupply(s, kind)[0];
    if (!rep) continue;
    const normal = normalAllowed(s, kind, a);
    const cards = playableCards(s, who, a, kind, rep.id);
    if (!normal && cards.length === 0) continue;
    let normalWhy: string | null = null;
    if (normal) {
      if (a === 'gather' && gatherCandidates(s, 'res').length === 0) normalWhy = 'No unoccupied space with Resources or Trees';
      if (a === 'use' && !usableBuildings(s, rep.id, false).some((u) => u.usable)) normalWhy = 'No Building this Meeple can use';
    }
    let disabled: string | null = null;
    if (kind === 'automaton' && s.res.coal < automatonCoal(s)) disabled = 'An Automaton needs 1 Coal';
    if (!disabled && normalWhy && cards.length === 0) disabled = normalWhy;
    out.push({ kind, meeple: rep.id, normalOk: normal && !normalWhy, normalWhy, cards, disabled });
  }
  return out;
}

function meepleOptions(s: GameState, who: number, a: MainAct): PendingOption[] {
  return kindOptions(s, who, a).map((k) => opt(`m:${k.meeple}`, KIND_LABEL[k.kind], { disabled: k.disabled ?? undefined, data: { kind: k.kind } }));
}

function specialMeepleOptions(s: GameState, key: string): PendingOption[] {
  const kinds: MeepleKind[] = specialKinds(s, key);
  const out: PendingOption[] = [];
  for (const k of kinds) {
    const rep = freeSupply(s, k)[0];
    if (rep) out.push(opt(`m:${rep.id}`, KIND_LABEL[k], { data: { kind: k } }));
  }
  return out;
}

function evUidOf(key: string): number {
  return Number(key.slice(2));
}
/** Meeple kinds allowed for a special action key: event `acts`, or Worker/Engineer for laws. */
function specialKinds(s: GameState, key: string): MeepleKind[] {
  if (key.startsWith('stock')) {
    const sa = scenarioSpecialActions(s).find((x) => x.key === key);
    return (sa?.meeples ?? []).filter((k): k is MeepleKind => k === 'worker' || k === 'engineer');
  }
  if (!key.startsWith('ev')) return ['worker', 'engineer'];
  const ev = s.events.find((e) => e.uid === evUidOf(key));
  const acts: string[] = (ev ? (eventCard(ev.card) as any)?.eventAction?.acts : null) ?? [];
  const barred = !!ev && engineerSpecificBarred(s, ev.card);
  return (['worker', 'engineer'] as MeepleKind[]).filter((k) => acts.includes(k) && !(k === 'engineer' && barred));
}

function eventDisabled(s: GameState, who: number, ev: GameState['events'][number], ea: any): string | null {
  if (ea.freq === 'round' && ev.usedThisRound) return 'Already used this Round';
  if (ea.freq === 'game' && ev.usedEver) return 'Already used';
  if (ea.needs === 'beacon' && !hasBuilt(s, 'beacon')) return 'Needs the Beacon';
  const why = feasible(s, costTokens(ea.cost), { who, src: 'card:' + ev.card, card: ev.card, evUid: ev.uid });
  if (why) return why;
  const barred = engineerSpecificBarred(s, ev.card);
  const kinds = (['worker', 'engineer'] as MeepleKind[]).filter((k) => (ea.acts ?? []).includes(k) && !(k === 'engineer' && barred));
  if (kinds.length === 0 && barred && (ea.acts ?? []).includes('engineer')) return "Engineers may not use Engineer-specific actions (D062)";
  if (!kinds.some((k) => freeSupply(s, k).length > 0)) return 'No free Worker or Engineer for this card';
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// action menu (spec 6)
// ---------------------------------------------------------------------------------------------------------

export interface MenuItem {
  id: string;
  label: string;
  kind: 'fuel' | 'free' | 'main' | 'special' | 'pass';
  disabled?: string;
}

/**
 * Steam Hub coal in the Action-phase menu (steamHub.ts holds the shared rule): offered as a free menu item (like Fuel),
 * it does not end the turn.
 */
function mainDisabled(s: GameState, who: number, a: MainAct): string | null {
  if (a === 'deploy') return legalExpeditionDeploy(s);
  const opts = kindOptions(s, who, a);
  if (opts.length === 0) return 'No free Meeple can take this action';
  if (!opts.some((o) => !o.disabled)) return opts[0].disabled ?? 'No Meeple can take this action now';
  if (a === 'removeSnow' && !tileAvailable(s, 'near') && !tileAvailable(s, 'far')) return 'No Tiles left to place';
  return null;
}

/** Stockpile (S03 / S07) is offered only when it is unused this Round and a marker can be bought with Food or Coal. */
function stockDisabled(s: GameState, sa: ScenarioSpecialAction, noMeeple: string | undefined): string | undefined {
  if (sa.usedThisRound) return 'Already used this Round';
  if (noMeeple) return noMeeple;
  const st = scenarioStockState(s, sa.card);
  if (!st) return 'Stockpile is not in play';
  if (st.used >= st.slots) return 'Stockpile is full';
  if (s.food < st.food && s.res.coal < st.coal) return 'Not enough Food or Coal';
  return undefined;
}

function specialItems(s: GameState, who: number): MenuItem[] {
  const out: MenuItem[] = [];
  for (const ev of s.events) {
    const def: any = eventCard(ev.card);
    const ea = def?.eventAction;
    if (!ea) continue;
    const why = eventDisabled(s, who, ev, ea);
    out.push({ id: `act:special:ev${ev.uid}`, label: `${def.title} (event action)`, kind: 'special', disabled: why ?? undefined });
  }
  for (const la of lawActionsAvailable(s, who)) {
    const noMeeple = freeSupply(s, 'worker').length + freeSupply(s, 'engineer').length === 0 ? 'No free Worker or Engineer' : undefined;
    out.push({ id: `act:special:law${la.lawId}`, label: `${la.title} (law action)`, kind: 'special', disabled: la.disabled ?? noMeeple });
  }
  for (const sa of scenarioSpecialActions(s)) {
    const noMeeple = sa.meeples.some((k) => freeSupply(s, k as MeepleKind).length > 0) ? undefined : 'No free Worker or Engineer';
    out.push({ id: `act:special:${sa.key}`, label: `${sa.title} (${sa.card} action)`, kind: 'special', disabled: stockDisabled(s, sa, noMeeple) });
  }
  return out;
}

/** The menu for one player's turn: Fuel (free), the five main actions, special actions and Pass. */
export function actionMenuFor(s: GameState, who: number): MenuItem[] {
  const out: MenuItem[] = [];
  const room = fuelRoom(s);
  out.push({
    id: 'act:fuel',
    label: 'Fuel the Generator (free)',
    kind: 'fuel',
    disabled: s.flags.actFuelUsed ? 'Already fueled this turn' : room <= 0 ? 'No Coal to add or the Generator is full' : undefined,
  });
  for (const a of MAIN_ACTS) {
    out.push({ id: ACT_ID[a], label: ACT_LABEL[a], kind: 'main', disabled: mainDisabled(s, who, a) ?? undefined });
  }
  out.push({ id: 'act:steamHub', label: 'Place Coal on a Steam Hub (free)', kind: 'free', disabled: steamHubState(s).why ?? undefined });
  out.push(...specialItems(s, who));
  out.push({ id: 'act:pass', label: 'Pass', kind: 'pass' });
  return out;
}

function anyoneCanAct(s: GameState): boolean {
  return s.players.some((_, i) => actionMenuFor(s, i).some((m) => (m.kind === 'main' || m.kind === 'special') && !m.disabled));
}

// ---------------------------------------------------------------------------------------------------------
// phase start / close
// ---------------------------------------------------------------------------------------------------------

/** Population track: the Meeples of each type equal meepleCountFor(citizens of that type). Scouts count. */
function adjustMeeples(s: GameState) {
  for (const t of CITIZEN_TYPES) {
    const kind = t as MeepleKind;
    const target = meepleCountFor(s.cit[t]);
    const have = s.meeples.filter((m) => m.kind === kind).length;
    if (target > have) for (let i = 0; i < target - have; i++) newMeeple(s, kind);
    else if (target < have) for (const m of freeSupply(s, kind).slice(0, have - target)) removeMeeple(s, m.id);
  }
}

defOp('actStart', (s) => {
  adjustMeeples(s);
  for (const t of s.spent) {
    if (t.meeple != null) continue;
    const m = freeSupply(s, t.type as MeepleKind)[0];
    if (!m) continue;
    m.loc = { k: 'spent', token: t.id };
    t.meeple = m.id;
    log(s, 'act.spent', `A ${t.type} Meeple fills a Spent token (cannot act)`, { type: t.type });
  }
  s.usedSpaces = [];
  s.passes = 0;
  s.flags.actFuelUsed = false;
  s.turn = s.leader;
  for (const m of s.meeples) delete m.used;
  for (const e of s.events) e.usedThisRound = false;
  for (const p of s.players) p.playedCitizen = null;
  log(s, 'act.start', 'Action phase begins');
  push(s, { k: 'phAdvance' }); // runs after the phase (bottom of the stack)
  push(s, { k: 'actTurn' });
});

/** Ask the current player for the action, or pass them automatically when they have nothing to do. */
defOp('actTurn', (s) => {
  // Every action chain ends here or in actEnd/actClose, so its back point (core.ts) closes there.
  delete s.backPoint;
  if (s.status !== 'playing') return;
  if (s.passes >= s.players.length || !anyoneCanAct(s)) {
    push(s, { k: 'actClose' });
    return;
  }
  const who = s.turn;
  const menu = actionMenuFor(s, who);
  const canMain = menu.some((m) => (m.kind === 'main' || m.kind === 'special') && !m.disabled);
  if (!canMain) {
    s.passes++;
    log(s, 'act.autoPass', `${s.players[who]?.name ?? 'Player'} has no Meeple that can act and passes`, { who });
    s.flags.actFuelUsed = false;
    s.turn = nextSeat(s);
    push(s, { k: 'actTurn' });
    return;
  }
  ask(s, {
    who,
    kind: 'action',
    prompt: `${s.players[who]?.name ?? 'Player'}: choose an action`,
    options: menu.map((m) => opt(m.id, m.label, { disabled: m.disabled, data: { kind: m.kind } })),
    then: { k: 'actPick', who },
    src: 'action',
  });
});

defOp('actPick', (s, op) => {
  const who: number = op.who;
  const id: string = op.pick?.[0];
  if (id === 'act:pass') {
    s.passes++;
    log(s, 'act.pass', `${s.players[who]?.name ?? 'Player'} passes`, { who });
    s.flags.actFuelUsed = false;
    s.turn = nextSeat(s);
    push(s, { k: 'actTurn' });
    return;
  }
  if (id === 'act:fuel') {
    // Fuel is free: it does not end the turn. Rulebook p23 "On your turn, you may first choose to fuel": once per turn
    // (the flag is cleared when the turn passes: actEnd / pass / auto-pass).
    s.flags.actFuelUsed = true;
    push(s, { k: 'actTurn' });
    push(s, { k: 'fuelAsk', who });
    return;
  }
  if (id === 'act:steamHub') {
    // Steam Hub Coal is free too: no Meeple, no turn
    push(s, { k: 'actTurn' });
    push(s, { k: 'steamHubDo', who });
    return;
  }
  s.passes = 0;
  if (id.startsWith('act:special:')) {
    push(s, { k: 'actMeeple', who, action: 'special', key: id.slice('act:special:'.length) });
    return;
  }
  const a = actOf(id);
  if (!a) {
    push(s, { k: 'actTurn' });
    return;
  }
  if (a === 'deploy') push(s, { k: 'actCitizen', who, action: 'deploy', meeple: null });
  else push(s, { k: 'actMeeple', who, action: a });
});

/** Which Meeple acts (ids m:<id>). Automaton coal and Citizen-card availability are shown as disabled reasons. */
defOp('actMeeple', (s, op) => {
  const opts = op.action === 'special' ? specialMeepleOptions(s, op.key) : meepleOptions(s, op.who, op.action);
  if (!opts.some((o) => !o.disabled)) {
    log(s, 'act.none', 'No Meeple can take that action');
    push(s, { k: 'actTurn' });
    return;
  }
  ask(s, {
    who: op.who,
    kind: 'meeple',
    prompt: 'Which Meeple acts?',
    options: opts,
    then: { k: 'actMeeplePick', who: op.who, action: op.action, key: op.key ?? null },
    src: op.action,
    back: true,
  });
});

defOp('actMeeplePick', (s, op) => {
  const mid = Number(String(op.pick?.[0] ?? '').slice(2));
  if (!meepleById(s, mid)) {
    push(s, { k: 'actTurn' });
    return;
  }
  if (op.action === 'special') push(s, { k: 'actSpecial', who: op.who, key: op.key, meeple: mid });
  else push(s, { k: 'actCitizen', who: op.who, action: op.action, meeple: mid });
});

/** Optional Citizen card that replaces the normal effect (ids: card ids in hand, or normal). */
defOp('actCitizen', (s, op) => {
  const kind = op.meeple != null ? meepleById(s, op.meeple)?.kind ?? null : null;
  const a: MainAct = op.action;
  const cards = playableCards(s, op.who, a, kind, op.meeple ?? null);
  let normal = true;
  if (kind) normal = normalAllowed(s, kind, a) && (a !== 'gather' || gatherCandidates(s, 'res').length > 0) && (a !== 'use' || usableBuildings(s, op.meeple, false).some((u) => u.usable));
  const options: PendingOption[] = cards.map((id) => opt(id, cardDef(id)?.name ?? id, { data: { act: CARD_ACT[a] } }));
  if (normal) options.push(opt('normal', 'Normal action'));
  if (options.length === 0) {
    push(s, { k: 'actTurn' });
    return;
  }
  ask(s, {
    who: op.who,
    kind: 'citizen',
    prompt: 'Replace the action with a Citizen card?',
    options,
    then: { k: 'actCitizenPick', who: op.who, action: a, meeple: op.meeple ?? null },
    src: a,
    back: true,
  });
});

defOp('actCitizenPick', (s, op) => {
  const id: string = op.pick?.[0] ?? 'normal';
  const card = id === 'normal' ? null : id;
  if (card && citizenCostProblem(s, card, op.who)) {
    // the Spend cannot be paid: the card stays in hand and is not played (the offer is asked again without it)
    log(s, 'act.card.cancel', `${cardDef(card)?.name ?? card}: the Spend cannot be paid`, { card });
    push(s, { k: 'actCitizen', who: op.who, action: op.action, meeple: op.meeple ?? null });
    return;
  }
  if (card) {
    const p = s.players[op.who];
    const i = p.hand.indexOf(card);
    if (i >= 0) p.hand.splice(i, 1);
    p.playedCitizen = card;
    log(s, 'act.card', `${p.name} plays ${cardDef(card)?.name ?? card} (${cardDef(card)?.text ?? ''})`, { card });
  }
  push(s, { k: 'actResolve', who: op.who, action: op.action, meeple: op.meeple, card });
});

// ---------------------------------------------------------------------------------------------------------
// resolution of the main actions
// ---------------------------------------------------------------------------------------------------------

function ctxFor(who: number, meeple: number | null, card: string | null, src: string, extra: Partial<Ctx> = {}): Ctx {
  return { who, meeple: meeple ?? undefined, card: card ?? undefined, src, ...extra };
}

defOp('actResolve', (s, op) => {
  const who: number = op.who;
  const a: MainAct = op.action;
  const card: string | null = op.card ?? null;
  const mid: number | null = op.meeple ?? null;
  const m = mid != null ? meepleById(s, mid) : undefined;
  const kind: MeepleKind | null = m?.kind ?? null;
  const list: any[] = card ? cardDef(card)?.fx ?? [] : [];
  const src = card ? 'cit:' + card : 'act:' + a;

  push(s, { k: 'actEnd', who }); // runs after the action (bottom)
  if (kind === 'automaton') {
    const cost = automatonCoal(s);
    if (cost > 0) spendRes(s, 'coal', cost);
    log(s, 'act.automaton', `Automaton uses ${cost} Coal`, { cost });
  }
  switch (a) {
    case 'removeSnow': {
      if (m) m.used = true;
      const heated = techDone(s, 'T11') || list.includes('heated');
      if (!heated) applyCold(s, who, kind, list);
      if (card) {
        if (m) m.loc = { k: 'board', slot: 'removeSnow' };
        runFx(s, list, ctxFor(who, mid, card, src));
      } else {
        if (m) markUsed(m, { k: 'board', slot: 'removeSnow' });
        removeSnowAction(s, who, mid, 'normal', src);
      }
      return;
    }
    case 'construct': {
      if (m) m.used = true;
      if (card) runFx(s, list, ctxFor(who, mid, card, src));
      // the normal Construct action: an action (isAction), with the L18 Engineer budget when it applies (constructActionOpts)
      else startConstruct(s, who, mid, constructActionOpts(s, mid, { src, who }));
      return;
    }
    case 'deploy': {
      if (card) runFx(s, list, ctxFor(who, null, card, src));
      else deployScout(s, who, { src });
      return;
    }
    case 'use':
      push(s, { k: 'actUse', who, meeple: mid, card });
      return;
    case 'gather':
      push(s, { k: 'actGatherSpace', who, meeple: mid, card });
      return;
  }
});

defOp('actUse', (s, op) => {
  const card: string | null = op.card ?? null;
  const childOk = card ? cardDef(card)?.type === 'child' : false;
  const opts: PendingOption[] = usableBuildings(s, op.meeple, childOk)
    .filter((u) => u.usable && (!card || (cardDef(card).buildings ?? []).includes(u.kind)))
    .map((u) => opt(`b:${u.uid}`, u.name, { hint: spaceLabel(s, u.space) }));
  if (opts.length === 0) {
    log(s, 'act.none', 'No Building can be used');
    return;
  }
  ask(s, {
    who: op.who,
    kind: 'building',
    prompt: 'Use which Building?',
    options: opts,
    then: { k: 'actUseDo', who: op.who, meeple: op.meeple, card },
    src: 'use',
    back: true,
  });
});

defOp('actUseDo', (s, op) => {
  const who: number = op.who;
  const uid = Number(String(op.pick?.[0] ?? '').slice(2));
  const b = buildingByUid(s, uid);
  const mid: number | null = op.meeple ?? null;
  const card: string | null = op.card ?? null;
  if (!b) return;
  // Spend rule: a Citizen card's effect never runs with an unpayable Spend (actCitizenPick already keeps such cards out)
  if (card && citizenCostProblem(s, card, who)) {
    log(s, 'act.use.cancel', `${cardDef(card)?.name ?? card}: the Spend cannot be paid`);
    return;
  }
  const childOk = card ? cardDef(card)?.type === 'child' : false;
  const why = usageProblem(s, b, mid, who, childOk);
  if (why) {
    log(s, 'act.use.cancel', `The Building cannot be used: ${why}`);
    return;
  }
  const space = b.spaces.find((sid) => meeplesAtSpace(s, sid).length === 0) ?? b.spaces[0];
  const e = effectiveAction(s, b, mid);
  const buildingList = e ? [...e.cost, ...e.fx] : [];
  const cardList: any[] = card ? cardDef(card).fx ?? [] : [];
  const heated = actionHeated(s, space, true, card ? cardList : buildingList);
  const m = mid != null ? meepleById(s, mid) : undefined;
  if (!heated) applyCold(s, who, m?.kind ?? null, card ? cardList : []);
  if (card) {
    if (m) markUsed(m, { k: 'space', space });
    runFx(s, cardList, ctxFor(who, mid, card, 'cit:' + card, { space, bld: b.uid, heated }));
  } else {
    if (m) m.used = true;
    startUseBuilding(s, who, mid, uid, { space, heated, childOk: false, src: 'act:use' });
  }
});

defOp('actGatherSpace', (s, op) => {
  const card: string | null = op.card ?? null;
  const mode = card ? cardGatherMode(cardDef(card)) : 'res';
  const cands = gatherCandidates(s, mode);
  if (cands.length === 0) {
    log(s, 'act.none', 'No space to gather from');
    return;
  }
  ask(s, {
    who: op.who,
    kind: 'space',
    prompt: 'Gather at which space?',
    options: cands.map((sid) => opt(sid, spaceLabel(s, sid), { hint: `${spaceResTotal(s, sid)} Resources, ${s.spaces[sid].trees} Trees` })),
    then: { k: 'actGatherDo', who: op.who, meeple: op.meeple ?? null, card },
    src: 'gather',
    back: true,
  });
});

defOp('actGatherDo', (s, op) => {
  const who: number = op.who;
  const sid: string = op.pick?.[0];
  const sp = s.spaces[sid];
  if (!sp) return;
  const mid: number | null = op.meeple ?? null;
  const card: string | null = op.card ?? null;
  const m = mid != null ? meepleById(s, mid) : undefined;
  const list: any[] = card ? cardDef(card).fx ?? [] : [];
  const hasRes = spaceResTotal(s, sid) > 0;
  const treeMode = !card && !hasRes; // normal gather on a Tree-only space (T04)
  const heated = actionHeated(s, sid, false, list);
  if (!heated) applyCold(s, who, m?.kind ?? null, list);
  if (m) markUsed(m, { k: 'space', space: sid });
  s.usedSpaces.push(sid);
  const ctx = ctxFor(who, mid, card, card ? 'cit:' + card : 'act:gather', { space: sid, heated });
  if (card || treeMode) {
    runFx(s, card ? list : ['gatherTree:wood:2'], ctx);
    return;
  }
  const tile = techDone(s, 'T07');
  const cands = tile ? (tileOfSpace(s, sid)?.spaces ?? [sid]) : [sid];
  const options: DistOption[] = [];
  for (const c of cands) {
    for (const k of ['wood', 'coal', 'core'] as ResKind[]) {
      const n = s.spaces[c]?.res[k as 'wood'] ?? 0;
      if (n > 0) options.push({ id: `${c}|${k}`, label: `${k} at ${spaceLabel(s, c)}`, cap: n });
    }
  }
  askDistribute(s, {
    who,
    kind: 'gatherRes',
    prompt: tile ? 'Take up to 3 Resources from any spaces on this tile' : 'Take up to 2 Resources from this space',
    options,
    count: tile ? 3 : 2,
    then: { k: 'actGatherApply', who },
    src: 'gather',
  });
});

defOp('actGatherApply', (s, op) => {
  for (const id of (op.pick ?? []) as string[]) {
    const [sid, k] = id.split('|');
    const sp = s.spaces[sid];
    if (!sp || !(sp.res as any)[k]) continue;
    const got = gainRes(s, k as ResKind, 1, true);
    if (got > 0) (sp.res as any)[k] -= 1;
  }
  log(s, 'act.gather', 'Resources gathered', { picks: op.pick ?? [] });
});

defOp('actSpecial', (s, op) => {
  const who: number = op.who;
  const m = meepleById(s, op.meeple);
  if (!m) return;
  const key: string = op.key;
  if (key.startsWith('ev')) {
    const ev = s.events.find((e) => e.uid === evUidOf(key));
    const def: any = ev ? eventCard(ev.card) : null;
    const ea = def?.eventAction;
    if (!ev || !ea) return;
    const why = eventDisabled(s, who, ev, ea);
    if (why) {
      log(s, 'act.special.cancel', `Cannot use this card action: ${why}`);
      return;
    }
    // D062: an Engineer may not perform another card's Engineer-specific action while Engineers' Strike is in effect
    if (roleOf(m.kind) === 'engineer' && engineerSpecificBarred(s, ev.card) && (ea.acts ?? []).includes('engineer')) {
      log(s, 'act.special.cancel', 'Cannot use this card action: Engineers may not use Engineer-specific actions (D062)');
      return;
    }
    markUsed(m, { k: 'card', card: ev.card });
    ev.meeples.push(m.id);
    ev.usedThisRound = true;
    ev.usedEver = true;
    push(s, { k: 'actEnd', who });
    const list: any[] = [...costTokens(ea.cost), ...(ea.custom ? [`custom:${ea.custom}`] : []), ...(ea.fx ?? [])];
    // D043 A Tripod! (printed): "Check the tile's heating as normal" on the Automaton tile. An unheated tile is a cold action
    // for the Engineer (ill effects of the cold, applyCold). Other event actions keep the heated default.
    const d043Heated = ev.card === 'D043' ? d043TileHeated(s, ev) : true;
    if (!d043Heated) applyCold(s, who, m.kind, []);
    runFx(s, list, { who, src: 'card:' + ev.card, card: ev.card, evUid: ev.uid, meeple: m.id, heated: d043Heated });
    return;
  }
  if (key.startsWith('stock')) {
    const card = key.slice('stock'.length);
    const sa = scenarioSpecialActions(s).find((x) => x.key === key);
    if (!sa || sa.usedThisRound || !sa.meeples.includes(m.kind)) return;
    markUsed(m, { k: 'card', card });
    push(s, { k: 'actEnd', who });
    runFx(s, ['custom:stockpile'], { who, src: 'card:' + card, card, meeple: m.id, heated: true });
    return;
  }
  if (key.startsWith('law')) {
    const id = key.slice(3);
    const la = lawActionsAvailable(s, who).find((x) => x.lawId === id);
    if (!la || la.disabled) return;
    markUsed(m, { k: 'board', slot: 'law:' + id });
    push(s, { k: 'actEnd', who });
    runLawAction(s, who, id);
  }
});

/** Steam Hub: place 1 Coal on a Steam Hub without Coal (the player picks the hub when there are several). */
defOp('steamHubDo', (s, op) => {
  const st = steamHubState(s);
  if (st.why || st.candidates.length === 0) {
    log(s, 'steamHub.none', `Steam Hub: ${st.why ?? 'nothing to do'}`);
    return;
  }
  if (st.candidates.length === 1) {
    push(s, { k: 'steamHubPlace', who: op.who, uid: st.candidates[0].uid });
    return;
  }
  ask(s, {
    who: op.who,
    kind: 'steamHub',
    prompt: 'Which Steam Hub receives 1 Coal?',
    options: st.candidates.map((b) => opt(`b:${b.uid}`, `Steam Hub #${b.uid}`)),
    then: { k: 'steamHubPick', who: op.who },
    src: 'steamHub',
    back: true,
  });
});

defOp('steamHubPick', (s, op) => {
  const uid = Number(String(op.pick?.[0] ?? '').slice(2));
  push(s, { k: 'steamHubPlace', who: op.who, uid });
});

defOp('steamHubPlace', (s, op) => {
  const b = s.buildings.find((x) => x.uid === op.uid);
  const st = steamHubState(s);
  if (!b || b.kind !== 'steamHub' || b.steamHubCoal || st.why) return;
  if (!spendRes(s, 'coal', 1)) return;
  b.steamHubCoal = true;
  log(s, 'steamHub.coal', 'Steam Hub: 1 Coal placed (this tile and adjacent tiles count as heated until the Generator phase)', { uid: b.uid });
});

/** After an action: the next player's turn. */
defOp('actEnd', (s) => {
  delete s.backPoint;
  s.flags.actFuelUsed = false;
  s.turn = nextSeat(s);
  push(s, { k: 'actTurn' });
});

/** End of the Action phase: discard the Citizen cards played this round. */
defOp('actClose', (s) => {
  delete s.backPoint;
  for (const p of s.players) {
    if (p.playedCitizen) {
      s.decks.citizenDiscard.push(p.playedCitizen);
      p.playedCitizen = null;
    }
  }
  log(s, 'act.end', 'Action phase ends');
});

// ---------------------------------------------------------------------------------------------------------
// Reuse helpers used by fx/tokens_action.ts
// ---------------------------------------------------------------------------------------------------------

/** Effect of a building as used by the Citizen-card tokens: its cost then its action effects. */
export function buildingFx(s: GameState, uid: number | undefined, meeple: number | null | undefined): any[] {
  const b = uid != null ? buildingByUid(s, uid) : undefined;
  if (!b) return [];
  const e = effectiveAction(s, b, meeple ?? null);
  return e ? [...e.cost, ...e.fx] : [];
}

/** The cure / treat part of a building action (C12, C15: "perform the Building's Cure effect"). */
export function cureOnly(fx: any[]): any[] {
  const out: any[] = [];
  for (const x of fx) {
    if (typeof x === 'string') {
      if (x.startsWith('cure') || x.startsWith('treat')) out.push(x);
    } else if (x && typeof x === 'object' && JSON.stringify(x).match(/"(cure|treat)/)) {
      out.push(x);
    }
  }
  return out;
}

/** Spaces with Meeples and the building on them (for Reuse a Building). */
export function occupiedBuildings(s: GameState): { uid: number; space: string; kind: string }[] {
  const out: { uid: number; space: string; kind: string }[] = [];
  for (const b of s.buildings) {
    const sid = b.spaces.find((x) => meeplesAtSpace(s, x).length > 0);
    if (sid) out.push({ uid: b.uid, space: sid, kind: b.kind });
  }
  return out;
}

/** Remove Snow/Gather/Construct/Use helpers exposed for tokens. */

