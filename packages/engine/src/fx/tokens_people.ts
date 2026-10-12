// FX tokens: citizens, sickness, death, Hope and Discontent.
import { ask, askDistribute, defOp, DistOption, log, opt, push, pushSeq } from '../core';
import { lawConsequences } from '../data';
import {
  activateOne,
  activeCount,
  activeTotal,
  askVirtueSubstitute,
  discardToken,
  doActivate,
  drawToTrack,
  EXHAUST_ALL,
  exhaustOne,
  exhaustTokensPlan,
  exhaustTyped,
  pushDecrease,
  pushIncrease,
  sideOfType,
  TYPE_LABEL,
  track,
  virtueLaw,
} from '../hope';
import {
  addSick,
  addSpent,
  canCure,
  cureOne,
  curableOf,
  curableTotal,
  flipSick,
  killCitizen,
  skullTypes,
  spentCount,
  treatOne,
} from '../sickness';
import { CITIZEN_TYPES, DISC_TYPES, HOPE_TYPES, roundType } from '../types';
import type { CitizenType, GameState, HopeType } from '../types';
import { citizenTypeOf, clamp, cap, huntingSymbols, newMeeple, nRes, toSupply, typeName } from '../util';
import { Ctx, defTok, exec, N, runFx } from './core';

const isCit = (t: string): t is CitizenType => (CITIZEN_TYPES as string[]).includes(t);

function askType(s: GameState, who: number, types: string[], prompt: string, then: any, src?: string, label?: (t: string) => string) {
  ask(s, {
    who,
    kind: 'type',
    prompt,
    src,
    options: types.map((t) => opt(t, label ? label(t) : cap(t))),
    then,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Citizens
// ---------------------------------------------------------------------------------------------------------

/**
 * Gain n Citizens of type t. The type gained fills up to its room (50); any overflow is for the player to place among the
 * other types that still have room (askDistribute, citGainApply), not assigned automatically.
 */
export function gainCitizens(s: GameState, t: CitizenType, n: number, who: number, src?: string) {
  const add = Math.max(0, Math.min(50 - s.cit[t], n));
  if (add > 0) {
    s.cit[t] += add;
    log(s, 'citizens', `+${add} ${typeName(t)} Citizens`, { type: t, n: add });
  }
  const left = n - add;
  if (left <= 0) return;
  const options: DistOption[] = CITIZEN_TYPES.filter((x) => x !== t && 50 - s.cit[x] > 0).map((x) => ({
    id: x,
    label: `${typeName(x)} (room ${50 - s.cit[x]})`,
    cap: 50 - s.cit[x],
  }));
  if (!options.length) return;
  askDistribute(s, {
    who,
    kind: 'citizenOverflow',
    prompt: `${left} more Citizen(s) do not fit: choose their type(s)`,
    options,
    count: left,
    then: { k: 'citGainApply' },
    src,
  });
}

defOp('citGainApply', (s, op) => {
  for (const id of (op.pick ?? []) as CitizenType[]) {
    if (!isCit(id) || s.cit[id] >= 50) continue;
    s.cit[id] += 1;
    log(s, 'citizens', `+1 ${typeName(id)} Citizen (overflow)`, { type: id, n: 1 });
  }
});

export function gainAutomatons(s: GameState, n: number) {
  for (let i = 0; i < n; i++) {
    const have = s.meeples.filter((m) => m.kind === 'automaton').length;
    if (have >= s.automatonsMax) return;
    newMeeple(s, 'automaton');
    log(s, 'automaton', 'An Automaton joins the city', {});
  }
}

defTok('gain', (s, a, ctx) => {
  const [what, nStr, extra] = a;
  const n = Number(nStr);
  if (what === 'automaton') return gainAutomatons(s, n);
  if (isCit(what)) return gainCitizens(s, what, n, ctx.who, ctx.src);
  if (what === 'food' && nStr === 'perTwoHuntingSymbols') {
    const g = Math.floor(huntingSymbols(s) / 2) * Number(extra ?? 1);
    s.food = Math.min(50, s.food + g);
    if (g) log(s, 'gain.food', `+${g} Food (Hunting Tactics)`, { n: g });
    return;
  }
  if (what === 'food' && nStr === 'perMapTileWithFoodBonus') {
    const g = s.tiles.filter((t) => t.food > 0).length * Number(extra ?? 1);
    s.food = Math.min(50, s.food + g);
    if (g) log(s, 'gain.food', `+${g} Food (Tracking Techniques)`, { n: g });
    return;
  }
  if (what === 'food' && extra === 'perFoodRation') {
    const r = (s.scenarioState.rations ?? 0) * n;
    s.food = Math.min(50, s.food + r);
    log(s, 'gain.food', `+${r} Food from rations`, { n: r });
    return;
  }
  if (['wood', 'coal', 'core', 'steel', 'food'].includes(what)) {
    s.flags._gainTmp = 0;
    const g = Math.min(
      n,
      what === 'food' ? 50 - s.food : what === 'steel' ? 8 - s.res.steel : Infinity,
    );
    if (g > 0) {
      if (what === 'food') s.food += g;
      else (s.res as any)[what] += g;
      log(s, 'gain.' + what, `+${g} ${what === 'core' ? 'Steam Core' : what}`, { k: what, n: g });
    }
    return;
  }
  throw new Error('bad gain token ' + a.join(':'));
});
defTok('food+', (s, a) => {
  const g = Math.min(N(a, 0), 50 - s.food);
  if (g > 0) {
    s.food += g;
    log(s, 'gain.food', `+${g} Food`, { n: g });
  }
});
defTok('gainFoodRound', (s) => {
  const g = Math.min(s.round, 50 - s.food);
  if (g > 0) {
    s.food += g;
    log(s, 'gain.food', `+${g} Food`, { n: g });
  }
});

// ---- sick ---------------------------------------------------------------------------------------------

defTok('sick', (s, a, ctx) => {
  const t = a[0];
  const n = N(a, 1);
  if (isCit(t)) return addSick(s, t, n, ctx.who);
  if (t === 'current') return addSick(s, roundType(s.round), n, ctx.who);
  if (t === 'any') return push(s, { k: 'sickAny', n, who: ctx.who, src: ctx.src });
  if (t === 'anyOneType') {
    const types = CITIZEN_TYPES.filter((x) => s.cit[x] > 0);
    return askType(s, ctx.who, types, `Which Citizens get sick (${n})?`, { k: 'sickOneType', n, who: ctx.who }, ctx.src);
  }
  throw new Error('bad sick type ' + t);
});
defOp('sickAny', (s, op) => {
  if (op.n <= 0) return;
  const types = CITIZEN_TYPES.filter((x) => s.cit[x] > 0);
  askType(s, op.who, types, `Choose which Citizen type gets sick (${op.n} left)`, { k: 'sickAny2', n: op.n, who: op.who }, op.src);
});
defOp('sickAny2', (s, op) => {
  if (op.n > 1) push(s, { k: 'sickAny', n: op.n - 1, who: op.who });
  addSick(s, op.pick[0], 1, op.who);
});
defOp('sickOneType', (s, op) => addSick(s, op.pick[0], op.n, op.who));

defTok('sickPerChildMeeple', (s, a, ctx) => {
  const per = a[0] === 'child' ? N(a, 1) : 1;
  const kids = s.meeples.filter((m) => citizenTypeOf(m.kind) === 'child').length;
  addSick(s, 'child', kids * per, ctx.who);
});
/** sickPerActedChildMeeple:N (L01A Work Accidents): N Sickness per Child Meeple that acted this round. */
defTok('sickPerActedChildMeeple', (s, a, ctx) => {
  const per = N(a, 0, 1);
  const kids = s.meeples.filter((m) => m.kind === 'child' && m.used).length;
  addSick(s, 'child', kids * per, ctx.who);
});
defTok('sickAll', (s, a, ctx) => {
  const base = N(a, 0);
  const minus = a[1] === 'minus2PerCoalStock' ? 2 * (s.scenarioState.coalStocks ?? 0) : 0;
  for (const t of CITIZEN_TYPES) addSick(s, t, Math.max(0, base - minus), ctx.who);
});
// D000: the Sickness per corpse goes to Citizen types chosen by the player (sickAny), not to the round's type.
defTok('gainSickPerCorpse', (s, _a, ctx) => push(s, { k: 'sickAny', n: s.corpse, who: ctx.who, src: ctx.src ?? null }));

// ---- die / lose -----------------------------------------------------------------------------------------

defTok('die', (s, a, ctx) => {
  const t = a[0];
  const n = N(a, 1);
  const noCards = a[2] === 'noCards';
  for (let i = 0; i < n; i++) push(s, { k: 'dieOne', t, noCards, who: ctx.who, src: ctx.src });
});
defOp('dieOne', (s, op) => {
  const t: string = op.t;
  if (isCit(t)) return killCitizen(s, t, op.noCards, op.who);
  if (t === 'current') return killCitizen(s, roundType(s.round), op.noCards, op.who);
  const types = t === 'workerOrEngineer' ? ['worker', 'engineer'] : CITIZEN_TYPES.slice();
  const avail = types.filter((x) => s.cit[x as CitizenType] > 0);
  askType(s, op.who, avail, 'Which Citizen dies?', { k: 'dieOne2', noCards: op.noCards, who: op.who }, op.src);
});
defOp('dieOne2', (s, op) => killCitizen(s, op.pick[0], op.noCards, op.who));

defTok('lose', (s, a, ctx) => {
  const [what, nStr] = a;
  const n = Number(nStr);
  if (isCit(what)) {
    const k = Math.min(n, s.cit[what]);
    s.cit[what] -= k;
    if (s.sick[what].n > s.cit[what]) s.sick[what].n = s.cit[what];
    if (k) log(s, 'citizens.leave', `${k} ${typeName(what)} Citizens leave the city`, { type: what, n: k });
    return;
  }
  if (what === 'food') {
    const k = Math.min(n, s.food);
    s.food -= k;
    if (k) log(s, 'lose.food', `-${k} Food`, { n: k });
    return;
  }
  if (what === 'res') return push(s, { k: 'supplyDist', n, who: ctx.who, mode: 'lose', src: ctx.src });
  throw new Error('bad lose token ' + a.join(':'));
});

// ---- spent tokens ---------------------------------------------------------------------------------------

defTok('spent', (s, a, ctx) => {
  const t = a[0];
  const n = N(a, 1);
  if (isCit(t)) return addSpent(s, t, n);
  if (t === 'workerEngineer') {
    for (let i = 0; i < n; i++) push(s, { k: 'spentWE', who: ctx.who, src: ctx.src });
    return;
  }
  throw new Error('bad spent type ' + t);
});
defOp('spentWE', (s, op) => {
  const types = (['worker', 'engineer'] as CitizenType[]).filter((t) => spentCount(s, t) < 5);
  askType(s, op.who, types, 'Place a Spent token of which type?', { k: 'spentWE2' }, op.src);
});
defOp('spentWE2', (s, op) => addSpent(s, op.pick[0], 1));

defTok('spentPerSkull', (s) => {
  for (const t of CITIZEN_TYPES) if (s.sick[t].skull) addSpent(s, t, 1);
});

defTok('removeSpentUnoccupied', (s, a, ctx) => {
  const free = s.spent.filter((x) => x.meeple == null);
  if (!free.length) return;
  const types = Array.from(new Set(free.map((x) => x.type)));
  askType(s, ctx.who, types, 'Return a Spent token (without Meeple) to the bank', { k: 'spentRemoveUnocc' }, ctx.src);
});
defOp('spentRemoveUnocc', (s, op) => {
  const i = s.spent.findIndex((x) => x.type === op.pick[0] && x.meeple == null);
  if (i >= 0) s.spent.splice(i, 1);
});
defTok('returnSpentCitizenTokens', (s, a, ctx) => {
  const n = a[0] === 'upTo2' ? 2 : 1;
  for (let i = 0; i < n; i++) push(s, { k: 'spentReturn', who: ctx.who, src: ctx.src });
});
defOp('spentReturn', (s, op) => {
  if (!s.spent.length) return;
  const ids = s.spent.map((x) => opt(String(x.id), `Spent ${typeName(x.type)} token${x.meeple != null ? ' (with Meeple)' : ''}`));
  ask(s, {
    who: op.who,
    kind: 'choice',
    prompt: 'Return a Spent Citizen token',
    src: op.src,
    options: [...ids, opt('none', 'Stop')],
    then: { k: 'spentReturn2' },
  });
});
defOp('spentReturn2', (s, op) => {
  const pick = op.pick[0];
  if (pick === 'none') return;
  const i = s.spent.findIndex((x) => String(x.id) === pick);
  if (i < 0) return;
  const [tok] = s.spent.splice(i, 1);
  if (tok.meeple != null) {
    const m = s.meeples.find((x) => x.id === tok.meeple);
    if (m) {
      toSupply(s, m);
      m.returnedRound = s.round; // usable this Round only if a law says so (L17), see util.ts freeSupply
    }
  }
});

// ---- cure / treat / flip ---------------------------------------------------------------------------------

defTok('cure', (s, a, ctx) => {
  if (a[0] === 'perChildMeeple') {
    const kids = s.meeples.filter((m) => citizenTypeOf(m.kind) === 'child').length;
    return push(s, { k: 'cureDist', n: kids, who: ctx.who, src: ctx.src });
  }
  push(s, { k: 'cureDist', n: N(a, 0), one: a[1] === 'oneType', who: ctx.who, src: ctx.src });
});
defOp('cureDist', (s, op) => {
  if (op.n <= 0 || curableTotal(s) <= 0) return;
  if (op.one) {
    const types = CITIZEN_TYPES.filter((t) => canCure(s, t));
    askType(s, op.who, types, `Cure ${op.n} of one Citizen type`, { k: 'cureOne', n: op.n }, op.src, (t) => `${cap(t)} (sick ${s.sick[t as CitizenType].n}/${s.cit[t as CitizenType]})`);
    return;
  }
  askDistribute(s, {
    who: op.who,
    prompt: `Cure ${op.n} – distribute over Citizen types`,
    src: op.src,
    count: op.n,
    options: CITIZEN_TYPES.map((t) => ({ id: t, label: `${cap(t)} (sick ${s.sick[t].n}${s.sick[t].skull ? ', skull' : ''})`, cap: curableOf(s, t) })),
    then: { k: 'cureApply' },
  });
});
defOp('cureOne', (s, op) => {
  for (let i = 0; i < op.n; i++) if (!cureOne(s, op.pick[0])) break;
});
defOp('cureApply', (s, op) => {
  for (const t of op.pick ?? []) cureOne(s, t as CitizenType);
});

defTok('treat', (s, a, ctx) => push(s, { k: 'treatDist', n: N(a, 0), who: ctx.who, src: ctx.src }));
defOp('treatDist', (s, op) => {
  const skulls = skullTypes(s);
  if (!skulls.length) return;
  if (skulls.length <= op.n) {
    for (const t of skulls) treatOne(s, t);
    return;
  }
  ask(s, {
    who: op.who,
    kind: 'type',
    prompt: `Treat ${op.n} Sickness marker(s)`,
    src: op.src,
    options: skulls.map((t) => opt(t, cap(t) + ' (Skull)')),
    min: op.n,
    max: op.n,
    then: { k: 'treatApply' },
  });
});
defOp('treatApply', (s, op) => {
  for (const t of op.pick ?? []) treatOne(s, t as CitizenType);
});

defTok('cureOrTreat', (s, a, ctx) => {
  const c = N(a, 0);
  const t = a[1] !== undefined ? N(a, 1) : c;
  exec(s, { choose: [[`cure:${c}`], [`treat:${t}`]] }, ctx);
});

defTok('flipSickness', (s, a, ctx) => {
  const mode = a[0];
  if (mode === 'toSyringe' && a[1] === 'all') {
    for (const t of CITIZEN_TYPES) if (s.sick[t].skull) flipSick(s, t, ctx.who);
    return;
  }
  const n = N(a, 1);
  for (let i = 0; i < n; i++) push(s, { k: 'flipPick', mode, who: ctx.who, src: ctx.src });
});
defOp('flipPick', (s, op) => {
  let types = CITIZEN_TYPES.filter((t) => s.cit[t] > 0);
  if (op.mode === 'toSkull') types = types.filter((t) => !s.sick[t].skull);
  if (op.mode === 'toSyringe') types = types.filter((t) => s.sick[t].skull);
  if (!types.length) return;
  askType(s, op.who, types, 'Flip which Sickness marker?', { k: 'flipPick2', who: op.who }, op.src, (t) => `${cap(t)} (${s.sick[t as CitizenType].skull ? 'Skull' : 'Syringe'})`);
});
defOp('flipPick2', (s, op) => flipSick(s, op.pick[0], op.who));
defTok('flipSicknessType', (s, a, ctx) => flipSick(s, a[0] as CitizenType, ctx.who));

defTok('coldSick', () => {
  /* read by the action code (cold penalty override) */
});
defTok('heated', () => {
  /* read by the action code */
});

defTok('childMeeple', (s, a, ctx) => {
  const kind = a[0] === 'engineer' ? 'childEngineer' : 'childWorker';
  const m = s.meeples.find((x) => x.kind === 'child' && x.loc.k === 'supply');
  if (m) {
    m.kind = kind as any;
    log(s, 'meeple', `A Child Meeple becomes a Child-${cap(a[0])}`, {});
  }
});

// ---------------------------------------------------------------------------------------------------------
// Hope & Discontent
// ---------------------------------------------------------------------------------------------------------

defTok('hope+', (s, a, ctx) => pushIncrease(s, 'hope', N(a, 0), a[1] ?? null, ctx.who, ctx.src));
defTok('hope-', (s, a, ctx) => pushDecrease(s, 'hope', N(a, 0), ctx.who, ctx.src));
defTok('disc+', (s, a, ctx) => pushIncrease(s, 'disc', N(a, 0), a[1] ?? null, ctx.who, ctx.src));
defTok('disc-', (s, a, ctx) => pushDecrease(s, 'disc', N(a, 0), ctx.who, ctx.src));

function pickToken(s: GameState, who: number, side: 'hope' | 'disc', pool: 'any' | 'active' | 'exhausted', mode: string, n: number, src?: string, then?: any) {
  for (let i = 0; i < n; i++) push(s, { k: 'tokPick', side, pool, mode, who, src });
}
defOp('tokPick', (s, op) => {
  const tr = track(s, op.side);
  const list = tr.filter((t) => (op.pool === 'any' ? true : op.pool === 'active' ? t.a : !t.a));
  const keys = Array.from(new Set(list.map((t) => `${t.t}:${t.a ? 1 : 0}`)));
  if (!keys.length) return;
  const verb = { discard: 'Discard', activate: 'Activate', exhaust: 'Exhaust' }[op.mode as string] ?? op.mode;
  ask(s, {
    who: op.who,
    kind: 'type',
    prompt: `${verb} which ${op.side === 'hope' ? 'Hope' : 'Discontent'} token?`,
    src: op.src,
    options: keys.map((k) => {
      const [t, a] = k.split(':');
      return opt(k, `${TYPE_LABEL[t]}${a === '1' ? ' (active)' : ' (exhausted)'}`);
    }),
    then: { k: 'tokPick2', side: op.side, mode: op.mode, who: op.who, src: op.src },
  });
});
defOp('tokPick2', (s, op) => {
  const [t, a] = String(op.pick[0]).split(':');
  if (op.mode === 'discard') {
    const tr = track(s, op.side);
    const i = tr.findIndex((x) => x.t === t && x.a === (a === '1'));
    if (i >= 0) {
      tr.splice(i, 1);
      ((op.side === 'hope' ? s.hopeBag : s.discBag) as Record<string, number>)[t]++;
      log(s, op.side + '.remove', `${TYPE_LABEL[t]} removed from the track`, { type: t });
      if (op.side === 'hope' && s.hope.length === 0) pushSeq(s, { k: 'loseNoHope' });
    }
  } else if (op.mode === 'activate') activateOne(s, op.side, t);
  else exhaustTyped(s, t, op.who, op.src);
});
defOp('loseNoHope', (s) => {
  if (s.hope.length === 0) {
    s.status = 'lost';
    s.endReason = 'All Hope has been lost.';
    s.stack.length = 0;
    s.pending = null;
    log(s, 'lose', 'DEFEAT: All Hope has been lost.', {});
  }
});

defTok('disc-discard', (s, a, ctx) => pickToken(s, ctx.who, 'disc', a[1] === 'active' ? 'active' : 'any', 'discard', N(a, 0), ctx.src));
defTok('discardHope', (s, a, ctx) => pickToken(s, ctx.who, 'hope', 'any', 'discard', N(a, 0), ctx.src));

function activateGeneric(s: GameState, side: 'hope' | 'disc', mod: string | undefined, ctx: Ctx) {
  if (mod === 'allOfType') return push(s, { k: 'pickTypeThen', side, mode: 'activate', pool: 'exhausted', all: true, who: ctx.who, src: ctx.src });
  if (mod === 'oneOfEachType') {
    for (const t of side === 'hope' ? HOPE_TYPES : DISC_TYPES) activateOne(s, side, t);
    return;
  }
  const n = mod ? Number(mod) : 1;
  pickToken(s, ctx.who, side, 'exhausted', 'activate', n, ctx.src);
}
defTok('activate', (s, a, ctx) => {
  const w = a[0];
  if (w === 'hope' || w === 'disc') {
    if (a[1] === 'mostCommon') {
      const counts: Record<string, number> = {};
      for (const t of s.disc) counts[t.t] = (counts[t.t] ?? 0) + 1;
      const max = Math.max(0, ...Object.values(counts));
      const types = Object.keys(counts).filter((k) => counts[k] === max);
      if (!types.length) return;
      if (types.length === 1) return doActivate(s, types[0], true);
      return askType(s, ctx.who, types, 'Activate all Discontent of which (tied) type?', { k: 'activateAllType' }, ctx.src, (t) => TYPE_LABEL[t]);
    }
    return activateGeneric(s, w, a[1], ctx);
  }
  doActivate(s, w, a[1] === 'all');
});
defOp('activateAllType', (s, op) => doActivate(s, op.pick[0], true));
defTok('activateHope', (s, a, ctx) => pickToken(s, ctx.who, 'hope', 'exhausted', 'activate', N(a, 0), ctx.src));
defTok('activateDisc', (s, a, ctx) => {
  if (a[0] === 'allOfType') return activateGeneric(s, 'disc', 'allOfType', ctx);
  pickToken(s, ctx.who, 'disc', 'exhausted', 'activate', N(a, 0), ctx.src);
});

/** Exhaust every active token of the given types (one at a time; each Hope token is offered the L20 substitution). */
function exhaustAllOfTypes(s: GameState, types: readonly string[], ctx: Ctx) {
  exhaustTokensPlan(s, types.map((t) => ({ type: t, n: EXHAUST_ALL })), ctx.who, ctx.src);
}

function exhaustGeneric(s: GameState, side: 'hope' | 'disc', mod: string | undefined, ctx: Ctx) {
  if (mod === 'all') return exhaustAllOfTypes(s, side === 'hope' ? HOPE_TYPES : DISC_TYPES, ctx);
  if (mod === 'allOfType') return push(s, { k: 'pickTypeThen', side, mode: 'exhaust', pool: 'active', all: true, who: ctx.who, src: ctx.src });
  if (mod === 'oneOfEachType') {
    // one token of each type; a Hope token may still be substituted (L20) at the moment it is exhausted
    return exhaustTokensPlan(s, (side === 'hope' ? HOPE_TYPES : DISC_TYPES).map((t) => ({ type: t, n: 1 })), ctx.who, ctx.src);
  }
  pickToken(s, ctx.who, side, 'active', 'exhaust', mod ? Number(mod) : 1, ctx.src);
}
defTok('exhaust', (s, a, ctx) => {
  const w = a[0];
  if (w === 'hope' || w === 'disc') return exhaustGeneric(s, w, a[1], ctx);
  if (w.includes('|')) {
    const types = w.split('|').filter((x) => activeCount(s, x) > 0);
    if (types.length === 0) return;
    if (types.length === 1) {
      if (a[1] === 'all') return exhaustTokensPlan(s, [{ type: types[0], n: EXHAUST_ALL }], ctx.who, ctx.src);
      return exhaustTyped(s, types[0], ctx.who, ctx.src);
    }
    return askType(s, ctx.who, types, 'Exhaust which Hope?', { k: 'exhaustType', all: a[1] === 'all', who: ctx.who, src: ctx.src }, ctx.src, (x) => TYPE_LABEL[x]);
  }
  if (a[1] === 'all') return exhaustTokensPlan(s, [{ type: w, n: EXHAUST_ALL }], ctx.who, ctx.src);
  exhaustTyped(s, w, ctx.who, ctx.src);
});
defOp('exhaustType', (s, op) => {
  if (op.all) return exhaustTokensPlan(s, [{ type: op.pick[0], n: EXHAUST_ALL }], op.who, op.src);
  exhaustTyped(s, op.pick[0], op.who, op.src);
});
defTok('exhaustHope', (s, a, ctx) => exhaustGeneric(s, 'hope', a[0], ctx));
defTok('exhaustAll', (s, _a, ctx) => exhaustAllOfTypes(s, HOPE_TYPES, ctx));
defTok('exhaustHopeOrDisc', (s, a, ctx) => {
  const opts = [];
  if (activeTotal(s, 'hope')) opts.push(opt('hope', 'Exhaust 1 Hope'));
  if (activeTotal(s, 'disc')) opts.push(opt('disc', 'Exhaust 1 Discontent'));
  if (!opts.length) return;
  ask(s, { who: ctx.who, kind: 'choice', prompt: 'Exhaust Hope or Discontent', src: ctx.src, options: opts, then: { k: 'exhaustHopeOrDisc2', ctx } });
});
defOp('exhaustHopeOrDisc2', (s, op) => pickToken(s, op.ctx.who, op.pick[0], 'active', 'exhaust', 1, op.ctx.src));

defTok('drawHope', (s, a, ctx) => {
  if (s.hope.length < 6 && drawToTrack(s, 'hope', true)) return;
  activateOne(s, 'hope');
});

// L20 introduction (card text): "Choose 1 Hope token from the Hope bag and place it on this card, active side up. This Hope
// token does not count towards your owned tokens." The token leaves the bag and is stored on the Law (hopeTok), not on
// the track; no Hope is gained or lost.
defTok('virtueHopeFromBag', (s, _a, ctx) => {
  if (!virtueLaw(s)) return;
  const avail = (HOPE_TYPES as HopeType[]).filter((t) => s.hopeBag[t] > 0);
  if (!avail.length) return;
  ask(s, {
    who: ctx.who,
    kind: 'type',
    prompt: 'The Virtue of Humanity: choose a Hope token from the Hope bag to place on this card',
    src: ctx.src,
    options: avail.map((t) => opt(t, TYPE_LABEL[t])),
    then: { k: 'virtueHopeTake' },
  });
});
defOp('virtueHopeTake', (s, op) => {
  const t: string | undefined = op.pick?.[0];
  const l = virtueLaw(s);
  if (!l || l.hopeTok || !t || !(HOPE_TYPES as string[]).includes(t)) return;
  if (s.hopeBag[t as HopeType] <= 0) return;
  s.hopeBag[t as HopeType]--;
  l.hopeTok = t;
  log(s, 'law.virtueHope', `${TYPE_LABEL[t]} Hope token placed on The Virtue of Humanity`, { type: t });
});
defTok('virtueHopeSubstitute', () => {
  /* passive marker: read by hope.ts virtueSubstitutes() through hasPassive() */
});
// L20 Law Consequence (Strength in Unity, United We Stand; card text: "You may swap the Hope token on 'The Virtue of
// Humanity' (L20) Law card with an active token on the Hope track."). Offered after the card's other effects.
defTok('virtueSwapOffer', (s, _a, ctx) => {
  const l = virtueLaw(s);
  if (!l || l.covered || !l.hopeTok) return;
  const alts = (HOPE_TYPES as HopeType[]).filter((t) => activeCount(s, t) > 0);
  if (!alts.length) return;
  ask(s, {
    who: ctx.who,
    kind: 'choice',
    prompt: `The Virtue of Humanity: swap its ${TYPE_LABEL[l.hopeTok]} Hope token with an active Hope token on the track?`,
    src: ctx.src,
    options: [...alts.map((t) => opt(t, `Swap with active ${TYPE_LABEL[t]}`)), opt('none', 'Do not swap')],
    then: { k: 'virtueSwap2' },
  });
});
defOp('virtueSwap2', (s, op) => {
  const pick: string | undefined = op.pick?.[0];
  const l = virtueLaw(s);
  if (!l || l.covered || !l.hopeTok || !pick || pick === 'none') return;
  const tr = track(s, 'hope');
  const i = tr.findIndex((x) => x.a && x.t === pick);
  if (i < 0) return;
  const card = l.hopeTok;
  tr[i] = { t: card, a: true };
  l.hopeTok = pick;
  log(s, 'hope.virtueSwap', `${TYPE_LABEL[card]} Hope token from The Virtue of Humanity swapped with an active ${TYPE_LABEL[pick]} Hope token`, { card, track: pick });
});
/**
 * L20B "Otherwise": apply the Virtue effect of the type of the Hope token on The Virtue of Humanity (L20) card. No choice and
 * no dependence on the active Hope tokens on the track (printed: "based on the type of Hope token on ... (L20) Law card").
 */
defTok('virtueEffect', (s, _a, ctx) => {
  const card = ctx.card ?? s.flags.cur?.id;
  const virtue = card ? (require_lc(card)?.virtue ?? {}) : {};
  const t = virtueLaw(s)?.hopeTok;
  if (!t || !virtue[t]) return;
  runFx(s, virtue[t], ctx);
});
defTok('exhaustHopeActive', (s, a, ctx) => {
  const card = ctx.card ?? s.flags.cur?.id;
  const types = HOPE_TYPES.filter((t) => activeCount(s, t) > 0);
  if (!types.length) return;
  askType(s, ctx.who, types, 'Exhaust which active Hope (and apply its Virtue effect)?', { k: 'exhaustVirtue', card, ctx }, ctx.src, (t) => TYPE_LABEL[t]);
});
defOp('exhaustVirtue', (s, op) => {
  const t = op.pick[0];
  // the L20 substitution may change which Hope is exhausted; the Virtue effect follows the type actually exhausted
  if (askVirtueSubstitute(s, t, op.ctx.who, op.ctx.src, { k: 'exhaustVirtueDo', card: op.card, ctx: op.ctx })) return;
  push(s, { k: 'exhaustVirtueDo', pick: [t], card: op.card, ctx: op.ctx });
});
defOp('exhaustVirtueDo', (s, op) => {
  const t = op.pick[0];
  exhaustOne(s, 'hope', t);
  const virtue = require_lc(op.card)?.virtue ?? {};
  runFx(s, virtue[t], op.ctx);
});

function require_lc(id: string): any {
  return lawConsequences[id];
}

// supply distribution (spend/lose N resources of the player's choice)
defOp('supplyDist', (s, op) => {
  const kinds = ['wood', 'coal', 'core', 'steel'] as const;
  askDistribute(s, {
    who: op.who,
    prompt: op.mode === 'lose' ? `Lose ${nRes(op.n)}` : `Spend ${nRes(op.n)}`,
    src: op.src,
    count: op.n,
    options: kinds.map((k) => ({ id: k, label: `${k === 'core' ? 'Steam Core' : cap(k)} (${s.res[k]})`, cap: s.res[k] })),
    then: { k: 'supplyDistApply' },
  });
});
defOp('supplyDistApply', (s, op) => {
  for (const k of op.pick ?? []) if (s.res[k as keyof typeof s.res] > 0) s.res[k as keyof typeof s.res]--;
  if ((op.pick ?? []).length) log(s, 'spend.res', `Resources spent/lost: ${(op.pick as string[]).join(', ')}`, {});
});

export { clamp, sideOfType, discardToken };
