// FX interpreter core: the `fx` op, token registry, control forms, conditions and counters. See docs/FX_DSL.md.
import { ask, defOp, log, opt, push } from '../core';
import { activeCount, activeTotal, EXHAUST_ALL, exhaustTokensPlan, tokenTotal, mostCommonDiscActive } from '../hope';
import { describe, describeList } from './describe';
import { buildingsOfKind, hasBuilt, totalSupplyRes } from '../util';
import { CITIZEN_TYPES } from '../types';
import type { GameState, Op } from '../types';

export interface Ctx {
  who: number; // player who takes the decisions of this effect
  src?: string; // source label, e.g. "card:M001", "bld:cookhouse"
  meeple?: number; // acting meeple id
  space?: string; // space of the action
  bld?: number; // building uid
  card?: string; // card id for cardRes tokens
  evUid?: number; // Event display card uid
  heated?: boolean;
  [k: string]: any;
}

export type TokFn = (s: GameState, a: string[], ctx: Ctx, raw: string) => void;
const TOK: Record<string, TokFn> = {};

export function defTok(head: string, fn: TokFn) {
  if (TOK[head]) throw new Error('duplicate token ' + head);
  TOK[head] = fn;
}
export function hasTok(head: string) {
  return !!TOK[head];
}
export function tokenHeads() {
  return Object.keys(TOK);
}

export function parseToken(raw: string): { head: string; a: string[] } {
  const m = /^([A-Za-z]+)([+-])(\d+)(?::(.*))?$/.exec(raw);
  if (m) return { head: m[1] + m[2], a: [m[3], ...(m[4] ? m[4].split(':') : [])] };
  const parts = raw.split(':');
  return { head: parts[0], a: parts.slice(1) };
}

export const N = (a: string[], i: number, def = 1) => {
  const v = Number(a[i]);
  return Number.isFinite(v) && a[i] !== undefined && a[i] !== '' ? v : def;
};

/** Run an effect list now (pushes it onto the stack; it runs before whatever was pushed earlier). */
export function runFx(s: GameState, list: any[] | undefined, ctx: Ctx) {
  if (!list || list.length === 0) return;
  push(s, { k: 'fx', list, ctx });
}

defOp('fx', (s, op) => {
  const list: any[] = op.list;
  if (!list || list.length === 0) return;
  const item = list[0];
  if (item === 'stop') return;
  if (list.length > 1) push(s, { k: 'fx', list: list.slice(1), ctx: op.ctx });
  exec(s, item, op.ctx);
});

let fxTrace: ((name: string) => void) | null = null;
/**
 * Coverage hook for the simulator: called with `tok:<head>` for every token executed and with `custom:<id>` for every
 * custom handler (tokens_cards.ts `custom`). Pass null to remove it. It must not change the state.
 */
export function setFxTrace(fn: ((name: string) => void) | null) {
  fxTrace = fn;
}
export function traceFx(name: string) {
  if (fxTrace) fxTrace(name);
}

export function exec(s: GameState, item: any, ctx: Ctx) {
  if (s.status !== 'playing') return;
  if (typeof item === 'string') {
    const { head, a } = parseToken(item);
    const fn = TOK[head];
    if (!fn) throw new Error(`Unknown FX token "${item}" (head "${head}")`);
    traceFx('tok:' + head);
    fn(s, a, ctx, item);
    return;
  }
  execObj(s, item, ctx);
}

// ---- object forms --------------------------------------------------------------------------------------

function execObj(s: GameState, o: any, ctx: Ctx) {
  if ('choose' in o) return doChoose(s, o.choose, ctx);
  if ('if' in o) {
    const ok = evalCond(s, o.if, ctx);
    const list = ok ? o.then : o.else;
    if (list && list.length) runFx(s, list, ctx);
    return;
  }
  if ('ifPay' in o) return doIfPay(s, o, ctx);
  if ('each' in o) {
    const n = evalCount(s, o.each, ctx);
    for (let i = 0; i < n; i++) runFx(s, o.fx, ctx);
    return;
  }
  if ('times' in o) {
    for (let i = 0; i < o.times; i++) runFx(s, o.fx, ctx);
    return;
  }
  if ('perActiveHope' in o) return perActive(s, 'hope', o.perActiveHope, ctx);
  if ('perActiveDisc' in o) return perActive(s, 'disc', o.perActiveDisc, ctx);
  if ('activateAllDiscOfType' in o) return typePick(s, 'disc', 'activate', o.activateAllDiscOfType, ctx);
  if ('exhaustAllHopeOfType' in o) return typePick(s, 'hope', 'exhaust', o.exhaustAllHopeOfType, ctx);
  if ('spendOr' in o) return doSpendOr(s, o, ctx);
  if ('custom' in o) return exec(s, 'custom:' + o.custom, ctx);
  throw new Error('Unknown FX object ' + JSON.stringify(o).slice(0, 120));
}

/** reason a list cannot be performed (a cost that cannot be paid), or null */
export function feasible(s: GameState, list: any[], ctx: Ctx): string | null {
  for (const it of list) {
    if (typeof it === 'string') {
      const r = payable(s, it, ctx);
      if (r) return r;
    }
  }
  return null;
}

let payableImpl: (s: GameState, raw: string, ctx: Ctx) => string | null = () => null;
export function setPayable(fn: typeof payableImpl) {
  payableImpl = fn;
}
export function payable(s: GameState, raw: string, ctx: Ctx) {
  return payableImpl(s, raw, ctx);
}

function doChoose(s: GameState, lists: any[][], ctx: Ctx) {
  const options = lists.map((l, i) => {
    const why = feasible(s, l, ctx);
    return opt(String(i), describeList(l), why ? { disabled: why } : undefined);
  });
  ask(s, {
    who: ctx.who,
    kind: 'choice',
    prompt: 'Choose one',
    src: ctx.src,
    options,
    then: { k: 'fxChoose', lists, ctx },
  });
}
defOp('fxChoose', (s, op) => {
  const i = Number(op.pick?.[0]);
  runFx(s, op.lists[i], op.ctx);
});

function doIfPay(s: GameState, o: any, ctx: Ctx) {
  const cost: string = o.ifPay;
  const why = payable(s, cost, ctx);
  if (why) {
    runFx(s, o.else, ctx);
    return;
  }
  ask(s, {
    who: ctx.who,
    kind: 'choice',
    prompt: `Pay: ${describe(cost)}?`,
    src: ctx.src,
    options: [opt('yes', `Yes – ${describe(cost)}`), opt('no', 'No')],
    then: { k: 'fxIfPay', cost, thenL: o.then, elseL: o.else, ctx },
  });
}
defOp('fxIfPay', (s, op) => {
  if (op.pick?.[0] === 'yes') {
    runFx(s, op.thenL, op.ctx);
    exec(s, op.cost, op.ctx); // runs first: the cost is paid before the benefit
  } else runFx(s, op.elseL, op.ctx);
});

function doSpendOr(s: GameState, o: any, ctx: Ctx) {
  const [res, n] = Object.entries(o.spendOr)[0] as [string, number];
  const cost = `spend:${res}:${n}`;
  if (payable(s, cost, ctx)) {
    runFx(s, o.else, ctx);
    return;
  }
  ask(s, {
    who: ctx.who,
    kind: 'choice',
    prompt: `Spend ${n} ${res}, or suffer the consequence`,
    src: ctx.src,
    options: [opt('pay', `Spend ${n} ${res}`), opt('else', describeList(o.else))],
    then: { k: 'fxSpendOr', cost, elseL: o.else, ctx },
  });
}
defOp('fxSpendOr', (s, op) => {
  if (op.pick?.[0] === 'pay') exec(s, op.cost, op.ctx);
  else runFx(s, op.elseL, op.ctx);
});

function perActive(s: GameState, side: 'hope' | 'disc', spec: any, ctx: Ctx) {
  const order: string[] = spec.order ?? Object.keys(spec);
  const seq: any[] = [];
  for (const t of order) {
    const n = activeCount(s, t);
    for (let i = 0; i < n; i++) seq.push(...(spec[t] ?? []));
  }
  runFx(s, seq, ctx);
}

/** law consequences: the player picks one token type, the effect list of that type runs */
function typePick(s: GameState, side: 'hope' | 'disc', mode: 'activate' | 'exhaust', spec: Record<string, any[]>, ctx: Ctx) {
  const track = side === 'hope' ? s.hope : s.disc;
  const want = mode === 'activate' ? false : true;
  let types = Object.keys(spec).filter((t) => track.some((x) => x.t === t && x.a === want));
  if (types.length === 0) types = Object.keys(spec).filter((t) => track.some((x) => x.t === t));
  if (types.length === 0) return;
  ask(s, {
    who: ctx.who,
    kind: 'type',
    prompt: mode === 'activate' ? 'Activate all Discontent of which type?' : 'Exhaust all Hope of which type?',
    src: ctx.src,
    options: types.map((t) => opt(t, t[0].toUpperCase() + t.slice(1), { hint: describeList(spec[t]) })),
    then: { k: 'fxTypePick', side, mode, spec, ctx },
  });
}
defOp('fxTypePick', (s, op) => {
  const t: string = op.pick[0];
  if (op.mode === 'exhaust' && op.side === 'hope') {
    // every Hope token is exhausted on its own (L20 substitution, hope.ts exhaustTokensPlan); the effect runs after it
    log(s, 'tok.exhaust', `Exhausted all ${t}`, { type: t });
    exhaustTokensPlan(s, [{ type: t, n: EXHAUST_ALL }], op.ctx.who, op.ctx.src);
    push(s, { k: 'fxRunSpec', spec: op.spec[t], ctx: op.ctx });
    return;
  }
  for (const tok of op.side === 'hope' ? s.hope : s.disc) {
    if (tok.t === t) tok.a = op.mode === 'activate';
  }
  log(s, 'tok.' + op.mode, `${op.mode === 'activate' ? 'Activated' : 'Exhausted'} all ${t}`, { type: t });
  runFx(s, op.spec[t], op.ctx);
});
defOp('fxRunSpec', (s, op) => runFx(s, op.spec, op.ctx));

// ---- conditions & counters -------------------------------------------------------------------------------

export function evalCond(s: GameState, c: string, ctx: Ctx): boolean {
  if (c.startsWith('!')) return !evalCond(s, c.slice(1), ctx);
  let m: RegExpExecArray | null;
  if (c === 'beaconBuilt') return hasBuilt(s, 'beacon');
  if ((m = /^revealed:(\w+)$/.exec(c))) return (s.scenarioState.revealed ?? []).includes(m[1]);
  if ((m = /^round<=(\d+)$/.exec(c))) return s.round <= Number(m[1]);
  if ((m = /^round>=(\d+)$/.exec(c))) return s.round >= Number(m[1]);
  if (c === 'round:odd') return s.round % 2 === 1;
  if ((m = /^active:(\w+)$/.exec(c))) return activeCount(s, m[1]) > 0;
  if ((m = /^built:(\w+)$/.exec(c))) return hasBuilt(s, m[1]);
  if ((m = /^hunger>=(\d+)$/.exec(c))) return s.hunger >= Number(m[1]);
  if (c === 'hunger==0') return s.hunger === 0;
  if (c === 'hunger<=food') return s.hunger <= s.food;
  if (c === 'supplyRes<2') return totalSupplyRes(s) < 2;
  if (c === 'noActiveHope') return activeTotal(s, 'hope') === 0;
  if (c === 'noActiveDisc') return activeTotal(s, 'disc') === 0;
  if (c === 'allDiscActive') return s.disc.length > 0 && s.disc.every((t) => t.a);
  if ((m = /^activeDisc>=(\d+)$/.exec(c))) return activeTotal(s, 'disc') >= Number(m[1]);
  if ((m = /^activeHope>=(\d+)$/.exec(c))) return activeTotal(s, 'hope') >= Number(m[1]);
  if ((m = /^hopeTokens>=(\d+)$/.exec(c))) return tokenTotal(s, 'hope') >= Number(m[1]);
  if (c === 'anySicknessSkull') return CITIZEN_TYPES.some((t) => s.sick[t].skull);
  if (c === 'anyCitizenUnsheltered') return (s.flags.night?.unsheltered ?? 0) > 0;
  if (c === 'allCitizensWarm') return (s.flags.night?.unsheltered ?? 0) === 0;
  if (c === 'allCitizensWarmNoRuins') return (s.flags.night?.unsheltered ?? 0) === 0 && !s.flags.night?.ruinsUsed;
  if (c === 'allSleepWarm') return (s.flags.night?.unsheltered ?? 0) === 0;
  if (c === 'moreHalfSleepWarm') {
    const n = s.flags.night;
    return !!n && n.total > 0 && n.total - n.unsheltered > n.total / 2;
  }
  if (c === 'allTechsDeveloped') return s.techs.length > 0 && s.techs.every((t) => t.state === 'done');
  if (c === 'devTokenOnRound') return s.techs.some((t) => t.state === 'developing' && t.dueRound === s.round);
  if (c === 'hasScout') return s.expeditions.some((e) => !!e.scout);
  if (c === 'engineerOnCard') {
    const ev = s.events.find((e) => e.uid === ctx.evUid) ?? s.events[s.events.length - 1];
    return !!ev && ev.meeples.some((id) => s.meeples.find((x) => x.id === id)?.kind === 'engineer');
  }
  if ((m = /^cardHasRes:(\w+)$/.exec(c))) {
    const ev = s.events.find((e) => e.card === m![1]);
    return !!ev && Object.values(ev.res).some((n) => (n ?? 0) > 0);
  }
  if ((m = /^cardNoRes:(\w+)$/.exec(c))) {
    const ev = s.events.find((e) => e.card === m![1]);
    return !ev || !Object.values(ev.res).some((n) => (n ?? 0) > 0);
  }
  if (c === 'notOnGeneratorTile') return !ctx.space || !ctx.space.startsWith('GEN:');
  if (c === 'mostCommonDisc') return mostCommonDiscActive(s).length > 0;
  throw new Error('Unknown FX condition "' + c + '"');
}

export function evalCount(s: GameState, c: string, ctx: Ctx): number {
  let m: RegExpExecArray | null;
  if ((m = /^active:(\w+)$/.exec(c))) return activeCount(s, m[1]);
  if (c === 'unsheltered') return s.flags.night?.unsheltered ?? 0;
  if (c === 'spentCitizenInSupply') return s.spent.length;
  if (c === 'activeHope') return activeTotal(s, 'hope');
  if (c === 'activeDisc') return activeTotal(s, 'disc');
  throw new Error('Unknown FX counter "' + c + '"');
}

export { buildingsOfKind };
export type { Op };
