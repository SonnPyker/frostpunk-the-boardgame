// Hand-written `custom:ID` handlers (ENGINE_SPEC §4.4). Card text: docs/CARD_TEXT_CUSTOM.md (source of truth), JSON in data/raw.
//
// Conventions
//  - A handler gets (s, ctx, args). Event-card handlers find their card on the Event display by its printed id
//    (eventOf(s, 'M004') ...), so they behave the same from eventAction, eventNight, eventDusk and top lists.
//  - eventAction.custom runs when a player performs the event action; ctx.who is that player.
//  - Night / Dusk hooks: call eventTimingFx(card, 'dusk' | 'night') and run the returned list with
//    ctx {who, src: 'card:'+card, card, evUid}. It merges the JSON eventDusk/eventNight lists with the hooks that the JSON
//    cannot express (M015 and M038 in the Dusk phase).
//  - Decisions are raised with ask / askDistribute; continuations are ops named cus*.
//  - Cards whose JSON carries the trailing effect (D005, D007, D053, D072, ...) only do the part the JSON cannot express.
import { addToDusk, cardDef, cardTitle, drawDusk, eventOf, isSocial, placeEvent, removeEventCard } from '../cards';
import { removeBuilding } from '../buildings';
import { ask, askDistribute, defOp, log, opt, push } from '../core';
import { iconTypesBetween } from '../generator';
import { activeCount, TYPE_LABEL } from '../hope';
import { shuffle } from '../rng';
import { addSick } from '../sickness';
import { CITIZEN_TYPES, DISC_TYPES, HOPE_TYPES } from '../types';
import type { Building, EventCardInPlay, GameState, Meeple, PendingOption, ResKind } from '../types';
import { bdef, citizenTypeOf, gainRes, meepleById, meeplesAtSpace, newMeeple, removeMeeple, roleOf, spendRes, toSupply } from '../util';
import { runFx } from './core';
import type { Ctx } from './core';
import { defCustom } from './tokens_cards';

// ---- helpers -----------------------------------------------------------------------------------------------------

const whoOf = (s: GameState, ctx?: Ctx): number => ctx?.who ?? s.leader;

/** a context for effect lists that belong to a printed card (used for its own removal, log and "who decides") */
const cardCtx = (s: GameState, card: string, who: number): Ctx => ({
  who,
  src: 'card:' + card,
  card,
  evUid: eventOf(s, card)?.uid,
});

const optIf = (ok: boolean, id: string, label: string, why = 'not available'): PendingOption =>
  opt(id, label, ok ? undefined : { disabled: why });

const resLabel = (k: string) => (k === 'core' ? 'Steam Core' : k === 'coal' ? 'Coal' : k === 'wood' ? 'Wood' : k);

/** Meeples lying on an Event card. */
function cardMeeples(s: GameState, ev: EventCardInPlay): Meeple[] {
  return ev.meeples.map((id) => meepleById(s, id)).filter((m): m is Meeple => !!m);
}

function resTotal(ev: EventCardInPlay): number {
  return Object.values(ev.res).reduce((a, n) => a + (n ?? 0), 0);
}

function locLabel(m: Meeple): string {
  if (m.loc.k === 'space') return m.loc.space ?? 'space';
  if (m.loc.k === 'card') return m.loc.card ?? 'card';
  return m.loc.k;
}

/** A Shelter that is still standing: not flipped to Ruins. Child Shelters count too. */
function isShelter(b: Building): boolean {
  if (b.ruins || b.kind === 'ruins') return false;
  const d: any = bdef(b.kind);
  return (d?.shelter ?? 0) > 0 || (d?.shelterChildren ?? 0) > 0;
}

export function shelterCount(s: GameState): number {
  return s.buildings.filter(isShelter).length;
}

/** Citizen meeples without a warm place to sleep (set by the Night phase). */
function unsheltered(s: GameState): number {
  return s.flags.night?.unsheltered ?? 0;
}

function buildingLabel(b: Building): string {
  const name = (bdef(b.kind) as any)?.name ?? b.kind;
  return b.ruins ? `${name} (Ruins)` : name;
}

/**
 * Destroy a building: it leaves the board and its spaces are free again. Goes through removeBuilding, so destroying the
 * last Workshop returns the Technology in development to inactive with its progress lost (ACT-CO5).
 */
function destroyBuilding(s: GameState, uid: number) {
  const b = s.buildings.find((x) => x.uid === uid);
  if (!b) return;
  const label = buildingLabel(b);
  const kind = b.kind;
  removeBuilding(s, uid);
  log(s, 'bld.destroy', `${label} was destroyed`, { uid, kind });
}

/** Event-action helper: take 1..max Resources of the given kinds from the supply and place them on the card. */
function takeToCard(s: GameState, card: string, who: number, kinds: ResKind[], min: number, max = Infinity) {
  if (!eventOf(s, card)) return;
  const total = kinds.reduce((a, k) => a + s.res[k], 0);
  const hi = Math.min(max, total);
  if (hi < min) {
    log(s, 'card.take', `Not enough Resources in the supply for ${cardTitle(card)}`, { card });
    return;
  }
  const options: PendingOption[] = [];
  for (let n = min; n <= hi; n++) options.push(opt(String(n), String(n)));
  ask(s, {
    who,
    kind: 'choice',
    prompt: `Take how many Resources from the supply onto ${cardTitle(card)}?`,
    src: 'card:' + card,
    options,
    then: { k: 'cusTakeDist', card, kinds, who },
  });
}

defOp('cusTakeDist', (s, op) => {
  const n = Number(op.pick?.[0]);
  if (!(n > 0) || !eventOf(s, op.card)) return;
  askDistribute(s, {
    who: op.who,
    prompt: `Which Resources (${n} in total) go onto ${cardTitle(op.card)}?`,
    src: 'card:' + op.card,
    count: n,
    options: (op.kinds as ResKind[]).map((k) => ({ id: k, label: resLabel(k), cap: Math.min(s.res[k], n) })),
    then: { k: 'cusTakeApply', card: op.card, who: op.who },
  });
});

defOp('cusTakeApply', (s, op) => {
  const ev = eventOf(s, op.card);
  if (!ev) return;
  for (const k of (op.pick ?? []) as ResKind[]) {
    if (spendRes(s, k, 1)) ev.res[k] = (ev.res[k] ?? 0) + 1;
  }
  log(s, 'card.take', `Resources were placed on ${cardTitle(op.card)}`, { card: op.card });
});

/** Generic "choose one option, run its effect list" op. Option id 'none' runs when nothing could be chosen. */
defOp('cusPickRun', (s, op) => {
  const id: string = op.pick?.[0] ?? 'none';
  const list: any[] | undefined = op.map?.[id];
  if (list) runFx(s, list, op.ctx);
});

// ---- Dusk / Night timing hooks ----------------------------------------------------------------------------------

/**
 * The effect list to run for an Event card at Dusk or Night: the JSON eventDusk / eventNight list plus hooks that the
 * JSON cannot express (M015 and M038 in the Dusk phase). Run it with a cardCtx-like context that has evUid.
 */
export function eventTimingFx(card: string, timing: 'dusk' | 'night'): any[] {
  const def: any = cardDef(card);
  const base: any[] = (timing === 'dusk' ? def?.eventDusk : def?.eventNight) ?? [];
  const extra: any[] = [];
  if (timing === 'dusk' && card === 'M015') extra.push('custom:M015:dusk');
  if (timing === 'dusk' && card === 'M038') extra.push('custom:M038:dusk');
  return [...base, ...extra];
}

// ---- Morning event cards (eventAction) --------------------------------------------------------------------------

// M004 Comfort the Sick: each time, take 1+ Wood and/or Coal from the supply onto this card.
defCustom('M004', (s, ctx) => {
  takeToCard(s, 'M004', whoOf(s, ctx), ['wood', 'coal'], 1);
});

// M010 Another Settlement (once per game, Beacon built): take 3+ Resources from the supply onto this card.
defCustom('M010', (s, ctx) => {
  takeToCard(s, 'M010', whoOf(s, ctx), ['wood', 'coal', 'core'], 3);
});

// M016 Young Adepts, options 1 (arg 'engineer') and 2 (arg 'worker'): the JSON places this card in the Event display first.
// Then 1 Child from the supply becomes a Child Engineer / Child Worker and is placed ON THIS CARD (D031 later swaps it).
// A Child is not placed on a Map tile, so the Frozen Grove connectivity rule (Map-tile Actions only) does not apply.
// With no free Child in the supply nothing is placed (the card still goes to the Event display).
defCustom('M016', (s, ctx, args) => {
  const ev = eventOf(s, 'M016');
  if (!ev) return;
  const child = s.meeples.find((m) => m.kind === 'child' && m.loc.k === 'supply');
  if (!child) {
    log(s, 'card.place', 'Young Adepts: no Child in the supply to teach, so no Child Meeple was placed', { card: 'M016' });
    return;
  }
  const engineer = args[0] === 'engineer';
  child.kind = engineer ? 'childEngineer' : 'childWorker';
  child.loc = { k: 'card', card: 'M016' };
  ev.meeples.push(child.id);
  log(s, 'card.place', `A Child became a Child-${engineer ? 'Engineer' : 'Worker'} on Young Adepts`, { card: 'M016' });
});

// M015 A New Project: action takes 1 Wood onto this card. Dusk hook: no Engineer on card -> +1 Apathy; exactly 2 Wood -> add D030.
defCustom('M015', (s, ctx, args) => {
  const who = whoOf(s, ctx);
  if (args[0] === 'dusk') {
    const ev = eventOf(s, 'M015');
    if (!ev) return;
    if (!cardMeeples(s, ev).some((m) => m.kind === 'engineer')) runFx(s, ['disc+1:apathy'], cardCtx(s, 'M015', who));
    if ((ev.res.wood ?? 0) === 2) addToDusk(s, 'D030');
    return;
  }
  takeToCard(s, 'M015', who, ['wood'], 1, 1);
});

// M029 Wooden Toys: action takes 1+ Wood from the supply onto this card.
defCustom('M029', (s, ctx) => {
  takeToCard(s, 'M029', whoOf(s, ctx), ['wood'], 1);
});

// M038 Child's Play (extra pack): action costs 1 Wood (JSON eventAction.cost, spent before this handler runs; the
// action is feasibility-checked so it cannot run without Wood). Dusk hook: a Worker on the card -> add D070; otherwise +1 Apathy.
defCustom('M038', (s, ctx, args) => {
  const who = whoOf(s, ctx);
  if (args[0] === 'dusk') {
    const ev = eventOf(s, 'M038');
    if (!ev) return;
    if (cardMeeples(s, ev).some((m) => roleOf(m.kind) === 'worker')) addToDusk(s, 'D070');
    else runFx(s, ['disc+1:apathy'], cardCtx(s, 'M038', who));
    return;
  }
});

// ---- Dusk cards ---------------------------------------------------------------------------------------------------

// D005 Have We Found Them? (option 1, a Scout on an Expedition): place 2 Wood below an active Expedition; gained on Return.
defCustom('D005', (s, ctx) => {
  const stacks = s.expeditions.filter((e) => !!e.scout);
  if (stacks.length === 0) return;
  const options = stacks.map((e) => opt(String(e.uid), `Expedition ${e.cards[e.cards.length - 1]?.id ?? e.uid}`));
  ask(s, {
    who: whoOf(s, ctx),
    kind: 'choice',
    prompt: 'Place 2 Wood below which Expedition with a Scout?',
    src: 'card:D005',
    options,
    then: { k: 'cusD005Apply' },
  });
});

defOp('cusD005Apply', (s, op) => {
  const uid = Number(op.pick?.[0]);
  const e = s.expeditions.find((x) => x.uid === uid);
  if (!e) return;
  e.bonus = { ...(e.bonus ?? {}), wood: (e.bonus?.wood ?? 0) + 2 };
  log(s, 'exp.bonus', `2 Wood placed below an Expedition (gained on its Return)`, { exp: uid });
});

// D007 Did You Stay True to Your Word? (option 2, M004 still has Resources): for each Sickness marker above 4,
// remove 1 Resource from M004 or -1 Hope; if that empties M004, -1 Hope; then M004 leaves the game.
defCustom('D007', (s, ctx) => {
  const ev = eventOf(s, 'M004');
  if (!ev) return;
  const who = whoOf(s, ctx);
  const steps = CITIZEN_TYPES.filter((t) => s.sick[t].n > 4).length;
  push(s, { k: 'cusD007Step', left: steps, startRes: resTotal(ev), who, ctx: cardCtx(s, 'D007', who) });
});

defOp('cusD007Step', (s, op) => {
  const ev = eventOf(s, 'M004');
  if (op.left <= 0 || !ev) {
    if (ev) {
      if (op.startRes > 0 && resTotal(ev) === 0) runFx(s, ['hope-1'], op.ctx);
      removeEventCard(s, 'M004');
    }
    return;
  }
  const kinds = (['wood', 'coal', 'core'] as ResKind[]).filter((k) => (ev.res[k] ?? 0) > 0);
  const options: PendingOption[] = kinds.map((k) => opt('res:' + k, `Remove 1 ${resLabel(k)} from M004`));
  options.push(opt('hope', '-1 Hope'));
  ask(s, {
    who: op.who,
    kind: 'choice',
    prompt: 'A Sickness marker is above 4: remove 1 Resource from M004, or -1 Hope',
    src: 'card:D007',
    options,
    then: { k: 'cusD007Apply', left: op.left, startRes: op.startRes, who: op.who, ctx: op.ctx },
  });
});

defOp('cusD007Apply', (s, op) => {
  const pick: string = op.pick?.[0] ?? 'hope';
  // the next step is queued first so that a -1 Hope from this step runs before it
  push(s, { k: 'cusD007Step', left: op.left - 1, startRes: op.startRes, who: op.who, ctx: op.ctx });
  const ev = eventOf(s, 'M004');
  if (pick.startsWith('res:') && ev) {
    const k = pick.slice(4) as ResKind;
    ev.res[k] = Math.max(0, (ev.res[k] ?? 0) - 1);
    log(s, 'card.res', `1 ${resLabel(k)} removed from M004`, { card: 'M004' });
  } else {
    runFx(s, ['hope-1'], op.ctx);
  }
});

// D010 The Comfort of Warmth (Night, Event display): lose 1 Wood or Coal per Shelter and per unsheltered citizen.
// Full loss -> discard 1 Discontent; otherwise -1 Hope per Resource that could not be lost. The card is then removed.
defCustom('D010', (s, ctx) => {
  if (!eventOf(s, 'D010')) return;
  const who = whoOf(s, ctx);
  const n = shelterCount(s) + unsheltered(s);
  askDistribute(s, {
    who,
    prompt: `Lose ${n} Wood or Coal (one per Shelter and per citizen without a warm place to sleep)`,
    src: 'card:D010',
    count: n,
    options: [
      { id: 'wood', label: 'Wood', cap: Math.min(s.res.wood, n) },
      { id: 'coal', label: 'Coal', cap: Math.min(s.res.coal, n) },
    ],
    then: { k: 'cusD010Apply', n, who, ctx: cardCtx(s, 'D010', who) },
  });
});

defOp('cusD010Apply', (s, op) => {
  let lost = 0;
  for (const k of (op.pick ?? []) as ResKind[]) if (spendRes(s, k, 1)) lost++;
  const short = op.n - lost;
  if (short <= 0) runFx(s, ['disc-discard:1'], op.ctx);
  else runFx(s, [`hope-${short}`], op.ctx);
  removeEventCard(s, 'D010');
});

// D011 Warmth for Those in Need (Night, Event display): if unsheltered citizens -> spend that many Wood/Coal; otherwise
// spend ceil(Shelters/2). Paid: +1 Hope; cannot pay: +1 Greed. Then each active Greed loses 1 Resource. Card removed.
defCustom('D011', (s, ctx) => {
  if (!eventOf(s, 'D011')) return;
  const who = whoOf(s, ctx);
  const unsh = unsheltered(s);
  const amount = unsh > 0 ? unsh : Math.ceil(shelterCount(s) / 2);
  const ctx2 = cardCtx(s, 'D011', who);
  if (s.res.wood + s.res.coal < amount) {
    d011Result(s, false, ctx2);
    return;
  }
  askDistribute(s, {
    who,
    prompt: `Spend ${amount} Wood or Coal to warm the city`,
    src: 'card:D011',
    count: amount,
    options: [
      { id: 'wood', label: 'Wood', cap: s.res.wood },
      { id: 'coal', label: 'Coal', cap: s.res.coal },
    ],
    then: { k: 'cusD011Apply', amount, ctx: ctx2 },
  });
});

function d011Result(s: GameState, paid: boolean, ctx: Ctx) {
  const list: any[] = [paid ? 'hope+1' : 'disc+1:greed', { each: 'active:greed', fx: ['lose:res:1'] }];
  runFx(s, list, ctx);
  removeEventCard(s, 'D011');
}

defOp('cusD011Apply', (s, op) => {
  const picks = (op.pick ?? []) as ResKind[];
  let ok = picks.length === op.amount;
  if (ok) for (const k of picks) if (!spendRes(s, k, 1)) ok = false;
  d011Result(s, ok, op.ctx);
});

// D016 Consensus: exhaust all Discontent of one type, or -1 Discontent.
defCustom('D016', (s, ctx) => {
  const who = whoOf(s, ctx);
  const options: PendingOption[] = [];
  const map: Record<string, any[]> = {};
  for (const t of DISC_TYPES) {
    const ok = activeCount(s, t) > 0;
    if (!ok) continue;
    options.push(opt('exh:' + t, `Exhaust all ${TYPE_LABEL[t]}`));
    map['exh:' + t] = [`exhaust:${t}:all`];
  }
  options.push(opt('dec', '-1 Discontent'));
  map.dec = ['disc-1'];
  ask(s, { who, kind: 'choice', prompt: 'Consensus', src: 'card:D016', options, then: { k: 'cusPickRun', map, ctx: cardCtx(s, 'D016', who) } });
});

// D030 Successful Project: A) build a Hothouse for free, B) upgrade a Hunter's Hut or Hothouse for free (even if used).
// Uses the BUILD tokens buildFree:hothouse (filter: only a Hothouse, buildings.ts buildFilterOk) and upgradeFree:huntersHutOrHothouse:ignoreUsed.
defCustom('D030', (s, ctx) => {
  runFx(s, [{ choose: [['buildFree:hothouse'], ['upgradeFree:huntersHutOrHothouse:ignoreUsed']] }], cardCtx(s, 'D030', whoOf(s, ctx)));
});

// D031 Successful Education: swap 1 of your Child meeples with the Child Worker/Engineer on M016; M016 is removed.
// The swap exchanges kinds: the chosen Child becomes the Child Worker/Engineer, the M016 meeple becomes a plain Child.
defCustom('D031', (s, ctx) => {
  const who = whoOf(s, ctx);
  const x = s.meeples.find(
    (m) => (m.kind === 'childWorker' || m.kind === 'childEngineer') && m.loc.k === 'card' && m.loc.card === 'M016',
  );
  const kids = s.meeples.filter((m) => m.kind === 'child');
  if (!x || kids.length === 0) {
    log(s, 'card.swap', 'Successful Education: no Child swap possible', { card: 'D031' });
    return;
  }
  ask(s, {
    who,
    kind: 'meeple',
    prompt: 'Swap one of your Child meeples with the Child Worker/Engineer on M016',
    src: 'card:D031',
    options: kids.map((m) => opt(String(m.id), `Child (${locLabel(m)})`)),
    then: { k: 'cusD031Apply', x: x.id },
  });
});

defOp('cusD031Apply', (s, op) => {
  const x = meepleById(s, op.x);
  const y = meepleById(s, Number(op.pick?.[0]));
  if (!x || !y) return;
  const kind = x.kind;
  x.kind = 'child';
  y.kind = kind;
  log(s, 'card.swap', 'A Child became a Child Worker/Engineer', { card: 'D031' });
});

// D032 Explosion of the Distillery: destroy a Building with an Engineer on it, or any Shelter (1 Engineer dies: JSON).
defCustom('D032', (s, ctx) => {
  const cands = s.buildings.filter(
    (b) =>
      !b.printed &&
      b.kind !== 'ruins' &&
      (isShelter(b) || b.spaces.some((sp) => meeplesAtSpace(s, sp).some((m) => m.kind === 'engineer'))),
  );
  if (cands.length === 0) {
    log(s, 'card.destroy', 'No Building to destroy', { card: 'D032' });
    return;
  }
  ask(s, {
    who: whoOf(s, ctx),
    kind: 'building',
    prompt: 'Choose a Building with an Engineer on it, or a Shelter, to destroy',
    src: 'card:D032',
    options: cands.map((b) => opt(String(b.uid), buildingLabel(b))),
    then: { k: 'cusD032Apply' },
  });
});

defOp('cusD032Apply', (s, op) => {
  const uid = Number(op.pick?.[0]);
  if (!Number.isNaN(uid)) destroyBuilding(s, uid);
});

// D036 Unworthy Successor: activate Greed or Apathy; if neither could be activated, +1 Discontent.
defCustom('D036', (s, ctx) => {
  const who = whoOf(s, ctx);
  const exhausted = (t: string) => s.disc.some((x) => x.t === t && !x.a);
  const options = [
    optIf(exhausted('greed'), 'greed', 'Activate Greed', 'no exhausted Greed'),
    optIf(exhausted('apathy'), 'apathy', 'Activate Apathy', 'no exhausted Apathy'),
  ];
  ask(s, {
    who,
    kind: 'choice',
    prompt: 'Activate Greed or Apathy',
    src: 'card:D036',
    options,
    then: {
      k: 'cusPickRun',
      map: { greed: ['activate:greed'], apathy: ['activate:apathy'], none: ['disc+1'] },
      ctx: cardCtx(s, 'D036', who),
    },
  });
});

// D037 Epidemic: the event action only places the Engineer (no effect). Night: gain 3 sick Citizens of the Round's type.
defCustom('D037', (s, ctx) => {
  if (!(s.phase === 'night' || ctx?.phase === 'night')) return;
  runFx(s, ['sick:current:3'], cardCtx(s, 'D037', whoOf(s, ctx)));
});

/** Spaces covered by a Tripod Automaton (D043): no Building may be built there until the Automaton is removed. */
const blockedSpaces = (s: GameState): string[] => (s.scenarioState?.blocked as string[] | undefined) ?? [];

// D043 A Tripod!: top -> choose a Far tile, destroy its Buildings, bank its Resources and Trees, lay an Automaton on it.
// The Automaton lies ON THE TILE (both spaces blocked for Building), not on the Event card.
// Event action (Engineer, the card is on the display) -> Repair (spend 1 Steam Core, Automaton to the supply) or
// Salvage (gain 1 Steam Core, Automaton to the bank); either way the card leaves the display and the spaces are freed.
defCustom('D043', (s, ctx) => {
  if (eventOf(s, 'D043')) {
    d043Action(s, ctx);
    return;
  }
  const far = s.tiles.filter((t) => t.kind === 'far' && !t.spaces.some((sp) => blockedSpaces(s).includes(sp)));
  if (far.length === 0) {
    log(s, 'card.tile', 'No Far tile for the Automaton', { card: 'D043' });
    return;
  }
  const who = whoOf(s, ctx);
  ask(s, {
    who,
    kind: 'tile',
    prompt: 'Choose a Far tile for the Automaton',
    src: 'card:D043',
    options: far.map((t) => opt(t.key, `Far tile ${t.id}`)),
    then: { k: 'cusD043Tile', who },
  });
});

function d043Action(s: GameState, ctx: Ctx) {
  const who = whoOf(s, ctx);
  ask(s, {
    who,
    kind: 'choice',
    prompt: 'A Tripod: Repair (spend 1 Steam Core) or Salvage (gain 1 Steam Core)?',
    src: 'card:D043',
    options: [
      optIf(s.res.core >= 1, 'repair', 'Repair: spend 1 Steam Core, Automaton to the supply', 'no Steam Core'),
      opt('salvage', 'Salvage: gain 1 Steam Core, Automaton to the bank'),
    ],
    then: { k: 'cusD043Act', who },
  });
}

defOp('cusD043Tile', (s, op) => {
  const tile = s.tiles.find((t) => t.key === op.pick?.[0]);
  if (!tile) return;
  const spaces = new Set(tile.spaces);
  const uids = new Set<number>();
  for (const sp of spaces) {
    const uid = s.spaces[sp]?.building;
    if (uid != null) uids.add(uid);
  }
  for (const b of s.buildings) if (b.spaces.some((sp) => spaces.has(sp))) uids.add(b.uid);
  for (const uid of uids) destroyBuilding(s, uid);
  for (const sp of spaces) {
    const space = s.spaces[sp];
    if (space) {
      space.res = {};
      space.trees = 0;
    }
  }
  placeEvent(s, 'D043');
  const ev = eventOf(s, 'D043');
  if (!ev) return;
  ev.extra = { ...(ev.extra ?? {}), tile: tile.key };
  // Rulebook p39: with the bank empty (limit of automatonsMax in the game), an Automaton is taken from the supply instead.
  let m: Meeple | undefined;
  if (s.meeples.filter((x) => x.kind === 'automaton').length >= s.automatonsMax) {
    m = s.meeples.find((x) => x.kind === 'automaton' && x.loc.k === 'supply');
    if (!m) {
      log(s, 'card.tile', 'No Automaton left in the bank or the supply', { card: 'D043' });
      return;
    }
  } else {
    m = newMeeple(s, 'automaton');
  }
  m.loc = { k: 'space', space: tile.spaces[0] };
  s.scenarioState.blocked = [...blockedSpaces(s), ...tile.spaces];
  log(s, 'card.tile', `An Automaton was laid on Far tile ${tile.id}`, { card: 'D043', tile: tile.key });
});

defOp('cusD043Act', (s, op) => {
  const ev = eventOf(s, 'D043');
  if (!ev) return;
  const tile = s.tiles.find((t) => t.key === ev.extra?.tile);
  const covered = new Set<string>(tile?.spaces ?? []);
  const autos = s.meeples.filter((m) => m.kind === 'automaton' && m.loc.k === 'space' && covered.has(m.loc.space ?? ''));
  if (op.pick?.[0] === 'repair') {
    if (!spendRes(s, 'core', 1)) return;
    for (const m of autos) toSupply(s, m);
  } else {
    gainRes(s, 'core', 1);
    for (const m of autos) removeMeeple(s, m.id);
  }
  s.scenarioState.blocked = blockedSpaces(s).filter((sp) => !covered.has(sp));
  removeEventCard(s, 'D043');
});

// D053 What About the Toys? (option 2, Wood on M029): +2 Hope if the Wood is exactly as much as the number of Child meeples, else +1 Hope.
// "Child Meeples" = every Child-type meeple you have: supply, board, Event cards and Scouts alike (rulebook p.22:
// the Meeples in your city include those on Expedition stacks as Scouts), and Child Worker / Child Engineer count
// (rulebook p.39: they count as Children "in all respects"). Spent Child tokens are not meeples and do not count.
defCustom('D053', (s, ctx) => {
  const wood = eventOf(s, 'M029')?.res.wood ?? 0;
  const kids = s.meeples.filter((m) => citizenTypeOf(m.kind) === 'child').length;
  runFx(s, [wood === kids ? 'hope+2' : 'hope+1'], cardCtx(s, 'D053', whoOf(s, ctx)));
});

// D062 Engineers' Strike: the event action (5 Food is paid by the JSON cost) only places the Engineer.
// The Event passive noEngineerSpecific (JSON eventPassive) is enforced by laws.ts engineerSpecificBarred(): usageProblem
// (buildings.ts) refuses Engineers at Engineer-only Buildings, and eventDisabled / specialKinds / actSpecial (actions.ts)
// refuse Engineers at other cards' Engineer-specific event actions. This card's own action stays allowed.
defCustom('D062', () => {});

// D067 Results of the Survey: activate all Hope of one type, or +1 Hope.
defCustom('D067', (s, ctx) => {
  const who = whoOf(s, ctx);
  const options: PendingOption[] = HOPE_TYPES.map((t) =>
    optIf(s.hope.some((x) => x.t === t && !x.a), t, `Activate all ${TYPE_LABEL[t]} Hope`, 'no exhausted token'),
  );
  options.push(opt('plus', '+1 Hope'));
  const map: Record<string, any[]> = { plus: ['hope+1'] };
  for (const t of HOPE_TYPES) map[t] = [`activate:${t}:all`];
  ask(s, { who, kind: 'choice', prompt: 'Results of the Survey', src: 'card:D067', options, then: { k: 'cusPickRun', map, ctx: cardCtx(s, 'D067', who) } });
});

// D072 Point of No Return (option 2): activate Apathy or exhaust Care. (1 Worker dies: JSON)
defCustom('D072', (s, ctx) => {
  const who = whoOf(s, ctx);
  const options = [
    optIf(s.disc.some((x) => x.t === 'apathy' && !x.a), 'apathy', 'Activate Apathy', 'no exhausted Apathy'),
    optIf(s.hope.some((x) => x.t === 'care' && x.a), 'care', 'Exhaust Care', 'no active Care'),
  ];
  ask(s, {
    who,
    kind: 'choice',
    prompt: 'Activate Apathy or exhaust Care',
    src: 'card:D072',
    options,
    then: { k: 'cusPickRun', map: { apathy: ['activate:apathy'], care: ['exhaust:care'] }, ctx: cardCtx(s, 'D072', who) },
  });
});

// ---- Advisor and Law consequences -------------------------------------------------------------------------------

// ADV_SOCIAL Social Advisor: reveal 3 Dusk cards; one (not red-icon, i.e. not a Social Dispute card) goes to the Dusk discard
// pile without effect; the others go back into the Dusk deck (shuffled).
defCustom('socialAdvisor', (s, ctx) => {
  const who = whoOf(s, ctx);
  const revealed: string[] = [];
  for (let i = 0; i < 3; i++) {
    const id = drawDusk(s);
    if (id) revealed.push(id);
  }
  if (revealed.length === 0) return;
  const options = revealed.map((id) => optIf(!isSocial(id), id, cardTitle(id), 'red Dusk discard symbol: cannot be chosen'));
  ask(s, {
    who,
    kind: 'card',
    prompt: 'Social Advisor: choose 1 card for the Dusk discard pile (no effect). The others go back into the Dusk deck.',
    src: 'advisor:ADV_SOCIAL',
    options,
    min: 0,
    max: 1,
    then: { k: 'cusSocialPick', revealed },
  });
});

defOp('cusSocialPick', (s, op) => {
  const chosen: string | undefined = op.pick?.[0];
  for (const id of (op.revealed ?? []) as string[]) {
    if (id === chosen) {
      s.decks.duskDiscard.push(id);
      log(s, 'card.discard', `${cardTitle(id)} was placed on the Dusk discard pile`, { card: id });
    } else {
      s.decks.dusk.push(id);
    }
  }
  s.decks.dusk = shuffle(s.rng, s.decks.dusk);
});

// L16A A Candle in the Wind: gain sick Citizens as in the Generator phase, with the Generator not fuelled (Heat marker at 1).
defCustom('generatorSick:noFuel', (s, ctx) => {
  const icons = iconTypesBetween({ ...s, gen: { ...s.gen, heat: 1 } });
  if (icons.length) log(s, 'gen.cold', `The cold hits: ${icons.join(', ')}`, { icons });
  for (const t of icons) addSick(s, t, 1, whoOf(s, ctx));
});
