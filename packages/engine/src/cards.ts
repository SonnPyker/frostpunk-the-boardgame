// Card resolution: Morning / Dusk / Law-consequence cards, Event display, Social Dispute cards (rulebook p25-27).
//
// A drawn card is resolved as: TOP effects -> (if the card is still "open") its OPTIONS (or the automatic BRANCH) -> FATE.
// The fate of a card is set by the tokens `remove`, `event`, `shuffleBack`, `discard` (see fx/tokens_cards.ts).
import { ask, defOp, log, opt, push, pushSeq } from './core';
import * as D from './data';
import { describeList } from './fx/describe';
import { evalCond, feasible, runFx } from './fx/core';
import type { Ctx } from './fx/core';
import { reqProblem } from './fx/tokens_supply';
import { activeCount, activeTotal, mostCommonActive, mostCommonDiscActive, TYPE_LABEL } from './hope';
import { shuffle } from './rng';
import type { EventCardInPlay, GameState } from './types';
import { meepleById, toSupply } from './util';

export function cardDef(id: string): any {
  return D.morning[id] ?? D.dusk[id] ?? D.lawConsequences[id] ?? D.socialDispute[id];
}
export function cardTitle(id: string): string {
  return cardDef(id)?.title ?? id;
}
export const isSocial = (id: string) => id.startsWith('SD');

// ---- Event display -------------------------------------------------------------------------------------------

export function eventOf(s: GameState, card: string): EventCardInPlay | undefined {
  return s.events.find((e) => e.card === card);
}

export function placeEvent(s: GameState, card: string): EventCardInPlay {
  const ex = eventOf(s, card);
  if (ex) return ex;
  const ev: EventCardInPlay = { uid: ++s.nextUid, card, res: {}, meeples: [], usedThisRound: false, usedEver: false };
  s.events.push(ev);
  s.flags.curEv = ev.uid;
  log(s, 'event.place', `${cardTitle(card)} was placed in the Event display`, { card });
  return ev;
}

/** Remove an Event card from the display: Resources on it go to the bank, Meeples on it return to the supply. */
export function removeEventCard(s: GameState, card: string, to: 'removed' | 'discard' = 'removed'): boolean {
  const i = s.events.findIndex((e) => e.card === card);
  if (i < 0) return false;
  const [ev] = s.events.splice(i, 1);
  for (const id of ev.meeples) {
    const m = meepleById(s, id);
    if (m) toSupply(s, m);
  }
  if (to === 'discard') s.decks.duskDiscard.push(card);
  log(s, 'event.remove', `${cardTitle(card)} left the Event display`, { card, to });
  return true;
}

// ---- decks -------------------------------------------------------------------------------------------------------

export function addToDusk(s: GameState, id: string) {
  s.decks.dusk.push(id);
  s.decks.dusk = shuffle(s.rng, s.decks.dusk);
  log(s, 'dusk.add', 'A card was shuffled into the Dusk deck', {});
}

/** Dusk deck + discard + (optionally) the next Social Dispute card are shuffled into a fresh Dusk deck. */
export function rebuildDusk(s: GameState, addSocial: boolean) {
  const all = [...s.decks.dusk, ...s.decks.duskDiscard];
  s.decks.duskDiscard = [];
  if (addSocial) {
    const sd = s.decks.social.pop();
    if (sd) all.push(sd);
  }
  s.decks.dusk = shuffle(s.rng, all);
}

export function drawMorning(s: GameState): string | null {
  return s.decks.morning.pop() ?? null;
}
export function drawDusk(s: GameState): string | null {
  if (s.decks.dusk.length === 0 && s.decks.duskDiscard.length > 0) {
    s.decks.dusk = shuffle(s.rng, s.decks.duskDiscard.splice(0));
  }
  return s.decks.dusk.pop() ?? null;
}

export function currentCardId(s: GameState, ctx?: Ctx): string | undefined {
  return ctx?.card ?? s.flags.cur?.id;
}

// ---- resolution ------------------------------------------------------------------------------------------------

defOp('morningDraw', (s) => {
  const id = drawMorning(s);
  if (!id) return;
  s.morningCard = id;
  push(s, { k: 'cardResolve', card: id });
});

defOp('duskDraw', (s) => {
  const id = drawDusk(s);
  if (!id) return;
  s.duskCard = id;
  push(s, { k: 'cardResolve', card: id });
});

const cardCtx = (s: GameState, id: string): Ctx => ({ who: s.leader, src: 'card:' + id, card: id });

defOp('cardResolve', (s, op) => {
  const id: string = op.card;
  const def = cardDef(id);
  if (!def) throw new Error('unknown card ' + id);
  s.flags.cur = { id, fate: null };
  s.flags.lastCard = { id, n: s.logN + 1 };
  log(s, 'card.draw', `${def.title} (${id})`, { card: id });
  if (isSocial(id)) {
    pushSeq(s, { k: 'socialResolve', card: id }, { k: 'socialAfter', card: id });
    return;
  }
  const ctx = cardCtx(s, id);
  if (def.coverLaw) {
    const law = s.laws.find((l) => l.id === def.coverLaw);
    if (law) {
      law.covered = id;
      log(s, 'law.cover', `${def.title} covers the Law`, { law: law.id, card: id });
    } else {
      // the law is not in play (cannot normally happen) – the card has no effect
      removeEventCard(s, id);
    }
    s.flags.cur.fate = 'cover';
    return;
  }
  pushSeq(s, { k: 'fx', list: def.top ?? [], ctx }, { k: 'cardOpts', card: id }, { k: 'cardFate', card: id });
});

defOp('cardOpts', (s, op) => {
  const id: string = op.card;
  const cur = s.flags.cur;
  if (!cur || cur.id !== id) return;
  if (cur.fate === 'removed' || cur.fate === 'back' || cur.fate === 'discard') return;
  const def = cardDef(id);
  const opts: D.OptDef[] = def.opts ?? [];
  if (opts.length === 0) return;
  const ctx = cardCtx(s, id);
  if (def.branch) {
    const b = def.branch;
    if (b.if === 'mostCommonDisc') {
      const mc = mostCommonDiscActive(s);
      if (mc.length === 0) return push(s, { k: 'cardOptRun', card: id, idx: (b.map.none ?? 1) - 1 });
      if (mc.length === 1) return push(s, { k: 'cardOptRun', card: id, idx: (b.map[mc[0]] ?? b.map['*'] ?? 1) - 1 });
      // Tie: the printed card names the tied types it covers (e.g. D073/D021: Anger -> 1, Greed -> 2); the '*' branch
      // applies only when no tied type is named. Only the branches the card allows are offered.
      const named = mc.filter((t) => b.map[t] !== undefined);
      const legal = named.length ? [...new Set(named.map((t) => b.map[t]))] : [b.map['*'] ?? 1];
      if (legal.length === 1) return push(s, { k: 'cardOptRun', card: id, idx: legal[0] - 1 });
      ask(s, {
        who: ctx.who,
        kind: 'type',
        prompt: 'Several Discontent types are tied for most common – which one counts?',
        src: ctx.src,
        options: named.map((t) => opt(t, TYPE_LABEL[t])),
        then: { k: 'cardBranchTie', card: id },
      });
      return;
    }
    const n = evalCond(s, b.if, ctx) ? b.then : b.else;
    return push(s, { k: 'cardOptRun', card: id, idx: n - 1 });
  }
  const options = opts.map((o, i) => {
    let why: string | null = null;
    for (const r of o.req ?? []) why = why ?? reqProblem(s, r, ctx);
    if (!why) why = feasible(s, o.fx.filter((x) => typeof x === 'string'), ctx);
    if (!why && typeof o.cond === 'string' && !evalCond(s, o.cond, ctx)) why = 'Not available';
    return opt(String(i), o.label, { hint: describeList(o.fx.filter((x) => x !== 'remove' && x !== 'event')), disabled: why ?? undefined });
  });
  ask(s, {
    who: ctx.who,
    kind: 'card',
    prompt: def.title,
    src: ctx.src,
    options,
    then: { k: 'cardOptPick', card: id },
    meta: { card: id },
  });
});

defOp('cardBranchTie', (s, op) => {
  const def = cardDef(op.card);
  const t: string = op.pick[0];
  push(s, { k: 'cardOptRun', card: op.card, idx: (def.branch.map[t] ?? def.branch.map['*'] ?? 1) - 1 });
});

defOp('cardOptPick', (s, op) => {
  let idx = Number(op.pick?.[0]);
  if (!Number.isFinite(idx)) {
    // nothing selectable: fall back to the first option without a requirement
    const def = cardDef(op.card);
    idx = Math.max(0, (def.opts as D.OptDef[]).findIndex((o) => !(o.req && o.req.length)));
  }
  push(s, { k: 'cardOptRun', card: op.card, idx });
});

defOp('cardOptRun', (s, op) => {
  const def = cardDef(op.card);
  const o: D.OptDef = def.opts[op.idx];
  const ctx = cardCtx(s, op.card);
  log(s, 'card.opt', o.label, { card: op.card, idx: op.idx });
  const costs = (o.req ?? []).filter((r) => !r.startsWith('active:'));
  runFx(s, Array.isArray(o.cond) ? o.cond : [], ctx);
  runFx(s, o.fx, ctx);
  runFx(s, costs, ctx);
});

defOp('cardFate', (s, op) => {
  const cur = s.flags.cur;
  if (!cur || cur.id !== op.card) return;
  if (!cur.fate && !eventOf(s, op.card)) {
    if (D.morning[op.card]) {
      cur.fate = 'removed';
      log(s, 'card.remove', `${cardTitle(op.card)} was removed from the game`, { card: op.card });
    } else {
      // no fate icon on a Dusk card (or a Law consequence): it goes to the Dusk discard pile
      cur.fate = 'discard';
      s.decks.duskDiscard.push(op.card);
      log(s, 'card.discard', `${cardTitle(op.card)} was placed on the Dusk discard pile`, { card: op.card });
    }
  }
  s.morningCard = null;
  s.duskCard = null;
  delete s.flags.cur;
});

// ---- Social Dispute ------------------------------------------------------------------------------------------------

defOp('socialAfter', (s, op) => {
  log(s, 'sd.done', `${cardTitle(op.card)} resolved and removed from the game`, { card: op.card });
  rebuildDusk(s, true);
  s.duskCard = null;
  delete s.flags.cur;
});

const MOST_COMMON_ORDER = ['greed', 'apathy', 'anger', 'motivation', 'care', 'justice'];

function mostCommonList(s: GameState): any[] {
  const mc = mostCommonActive(s);
  const out: any[] = [];
  for (const t of MOST_COMMON_ORDER) {
    if (!mc.includes(t)) continue;
    const n = activeCount(s, t);
    switch (t) {
      case 'greed':
        out.push(`hunger+${3 * n}`);
        break;
      case 'apathy':
        out.push({ times: n, fx: ['flipSickness:any:1'] });
        break;
      case 'anger':
        out.push({ times: n, fx: ['sick:any:2'] });
        break;
      case 'motivation':
        out.push(`takeMapRes:${1 + n}`);
        break;
      case 'care':
        out.push({ times: n, fx: ['cure:2'] });
        break;
      case 'justice':
        out.push({ times: n, fx: [{ choose: [['exhaust:disc:1'], ['activateHope:1']] }] });
        break;
    }
  }
  return out;
}

defOp('socialResolve', (s, op) => {
  const def = D.socialDispute[op.card];
  const ctx = cardCtx(s, op.card);
  switch (def.kind) {
    case 'mostCommon':
      runFx(s, mostCommonList(s), ctx);
      return;
    case 'hopeVsDisc': {
      const h = s.hope.length;
      const d = s.disc.length;
      if (h > d) {
        const types = Object.keys(def.more).filter((t) => activeCount(s, t) > 0);
        const options = types.map((t) => opt(t, `Exhaust ${TYPE_LABEL[t]}: ${describeList(def.more[t])}`));
        options.push(opt('none', 'Do nothing'));
        ask(s, {
          who: ctx.who,
          kind: 'choice',
          prompt: `${def.title}: you may exhaust 1 Hope to gain the matching effect`,
          src: ctx.src,
          options,
          then: { k: 'socialMore', card: op.card },
          forced: true,
        });
      } else if (h < d) {
        const mc = mostCommonDiscActive(s);
        const t = mc.length ? def.fewer.order.find((x: string) => mc.includes(x)) : def.fewer.default;
        runFx(s, def.fewer.fx[t], ctx);
      } else runFx(s, def.same, ctx);
      return;
    }
    case 'hopeMoreThanDisc': {
      const spec = activeTotal(s, 'hope') > activeTotal(s, 'disc') ? def.yes : def.no;
      runFx(s, [spec], ctx);
      return;
    }
    case 'noActiveDisc': {
      if (activeTotal(s, 'disc') === 0) return runFx(s, [def.yes], ctx);
      const list: any[] = [];
      for (const t of ['greed', 'apathy', 'anger']) if (activeCount(s, t) > 0) list.push(...def.no.perType[t]);
      runFx(s, list, ctx);
      return;
    }
    case 'allHopeTypes': {
      const missing = ['care', 'motivation', 'justice'].filter((t) => activeCount(s, t) === 0);
      if (missing.length === 0) return runFx(s, [def.yes], ctx);
      const list: any[] = [];
      for (const t of missing) list.push(...def.no.perMissingHope[t]);
      runFx(s, list, ctx);
      return;
    }
    default:
      throw new Error('unknown social dispute kind ' + def.kind);
  }
});

defOp('socialMore', (s, op) => {
  const t: string = op.pick?.[0];
  if (!t || t === 'none') return;
  const def = D.socialDispute[op.card];
  const ctx = cardCtx(s, op.card);
  runFx(s, def.more[t], ctx);
  push(s, { k: 'fx', list: [`exhaust:${t}`], ctx });
});
