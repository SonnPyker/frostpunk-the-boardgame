// FX tokens: supply, costs, Hunger, map resources, Stress, Resources lying on cards.
import { ask, askDistribute, defOp, log, opt, push } from '../core';
import { activeCount, activeTotal } from '../hope';
import { addStress, removeStress, totalStress } from '../generator';
import { spentCount } from '../sickness';
import type { DistOption } from '../core';
import type { GameState, ResKind } from '../types';
import { cap, clamp, nRes, totalSupplyRes } from '../util';
import { Ctx, defTok, N, parseToken, payable, runFx, setPayable } from './core';

const RES: ResKind[] = ['wood', 'coal', 'core', 'steel'];
const resLabel = (k: string) => (k === 'core' ? 'Steam Core' : cap(k));

// ---------------------------------------------------------------------------------------------------------
// payability of cost tokens (used to disable choices / ifPay)
// ---------------------------------------------------------------------------------------------------------

export function mapResTotal(s: GameState, kind: 'wood' | 'coal' | 'core' | null) {
  let n = 0;
  for (const sp of Object.values(s.spaces)) {
    if (kind) n += sp.res[kind] ?? 0;
    else n += (sp.res.wood ?? 0) + (sp.res.coal ?? 0) + (sp.res.core ?? 0);
  }
  return n;
}

setPayable((s, raw, ctx) => {
  const { head, a } = parseToken(raw);
  switch (head) {
    case 'pay':
    case 'spend': {
      if (/^\d+res\|\d+food$/.test(a[0])) {
        const [r, f] = a[0].split('|').map((x) => parseInt(x, 10));
        return totalSupplyRes(s) >= r || s.food >= f ? null : `Needs ${r} Resources or ${f} Food`;
      }
      if (/^\d+res$/.test(a[0])) {
        const n = parseInt(a[0], 10);
        return totalSupplyRes(s) >= n ? null : `Needs ${nRes(n)}`;
      }
      const k = a[0];
      const n = N(a, 1);
      if (k === 'food') return s.food >= n ? null : `Needs ${n} Food`;
      if (RES.includes(k as ResKind)) return s.res[k as ResKind] >= n ? null : `Needs ${n} ${resLabel(k)}`;
      return null;
    }
    case 'exhaust': {
      const t = a[0];
      if (t === 'hope' || t === 'disc') return activeTotal(s, t) > 0 ? null : `Needs an active ${t === 'hope' ? 'Hope' : 'Discontent'} token`;
      if (t.includes('|')) return t.split('|').some((x) => activeCount(s, x) > 0) ? null : `Needs an active ${t.replace('|', ' or ')}`;
      return activeCount(s, t) > 0 ? null : `Needs an active ${cap(t)} token`;
    }
    case 'exhaustHope':
      return activeTotal(s, 'hope') > 0 ? null : 'Needs an active Hope token';
    case 'spent': {
      const n = N(a, 1);
      const t = a[0];
      if (t === 'workerEngineer') return spentCount(s, 'worker') + spentCount(s, 'engineer') + n <= 10 ? null : 'No room for a Spent token';
      return spentCount(s, t as any) + n <= 5 ? null : 'No room for a Spent token';
    }
    case 'disc-discard': {
      // C20 option 2 "discard 1 active Discontent token": the discard is only possible while a Discontent token is active
      if (a[1] !== 'active') return null;
      return activeTotal(s, 'disc') > 0 ? null : 'Needs an active Discontent token';
    }
    case 'mapRemove': {
      const k = a[0] as 'wood' | 'coal';
      return mapResTotal(s, k) >= N(a, 1) ? null : `Needs ${N(a, 1)} ${cap(k)} on the map`;
    }
    case 'payFoodOrHunger':
    case 'loseResOrHunger':
      return null;
    case 'removeSnow':
      return null;
    case 'active': // not a token; kept for req lists using condition strings
      return null;
    default:
      return null;
  }
});

/** requirement strings on card options: either a cost token or a condition */
export function reqProblem(s: GameState, req: string, ctx: Ctx): string | null {
  const { head } = parseToken(req);
  if (['spend', 'pay', 'exhaust', 'exhaustHope', 'spent', 'mapRemove'].includes(head)) return payable(s, req, ctx);
  if (head === 'payFoodOrHunger') return null;
  if (/^active:/.test(req)) return activeCount(s, req.slice(7)) > 0 ? null : `Needs an active ${cap(req.slice(7))} token`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// pay / spend
// ---------------------------------------------------------------------------------------------------------

function spendTok(s: GameState, a: string[], ctx: Ctx) {
  if (/^\d+res\|\d+food$/.test(a[0])) {
    const [r, f] = a[0].split('|').map((x) => parseInt(x, 10));
    const opts = [];
    if (totalSupplyRes(s) >= r) opts.push(opt('res', `Spend ${nRes(r)}`));
    if (s.food >= f) opts.push(opt('food', `Spend ${f} Food`));
    if (!opts.length) return;
    ask(s, { who: ctx.who, kind: 'choice', prompt: 'How do you pay?', src: ctx.src, options: opts, then: { k: 'spendResOrFood', r, f, who: ctx.who, src: ctx.src } });
    return;
  }
  if (/^\d+res$/.test(a[0])) return push(s, { k: 'supplyDist', n: parseInt(a[0], 10), who: ctx.who, mode: 'spend', src: ctx.src });
  const k = a[0];
  const n = N(a, 1);
  if (k === 'food') {
    const t = Math.min(n, s.food);
    s.food -= t;
    if (t) log(s, 'spend.food', `-${t} Food`, { n: t });
    return;
  }
  const t = Math.min(n, s.res[k as ResKind]);
  s.res[k as ResKind] -= t;
  if (t) log(s, 'spend.' + k, `-${t} ${resLabel(k)}`, { k, n: t });
}
defOp('spendResOrFood', (s, op) => {
  if (op.pick?.[0] === 'res') push(s, { k: 'supplyDist', n: op.r, who: op.who, mode: 'spend', src: op.src });
  else {
    s.food -= op.f;
    log(s, 'spend.food', `-${op.f} Food`, { n: op.f });
  }
});
defTok('pay', (s, a, ctx) => spendTok(s, a, ctx));
defTok('spend', (s, a, ctx) => spendTok(s, a, ctx));

// ---------------------------------------------------------------------------------------------------------
// Hunger
// ---------------------------------------------------------------------------------------------------------

export function addHunger(s: GameState, n: number) {
  if (n === 0) return;
  const before = s.hunger;
  s.hunger = clamp(s.hunger + n, 0, 50);
  if (s.hunger !== before) log(s, 'hunger', `Hunger ${n > 0 ? '+' : ''}${s.hunger - before} (now ${s.hunger})`, { n: s.hunger - before, hunger: s.hunger });
}

defTok('hunger+', (s, a) => {
  let n = N(a, 0);
  if (a[1] === 'perCitizenMeeple') n *= s.meeples.filter((m) => m.kind !== 'automaton').length;
  addHunger(s, n);
});
defTok('hunger-', (s, a) => {
  let n = N(a, 0);
  if (a[1] === 'plusPerActiveCare') n += activeCount(s, 'care');
  addHunger(s, -n);
});
defTok('hungerPerMeeple', (s, a) => {
  const per = N(a, 1);
  // "for each Worker and Engineer Meeple in the supply" (M028): meeples on buildings, tiles, cards or scouting do not count.
  // A Child Worker / Child Engineer is a Child (D031: "counts as a Child in all respects"), so only the plain kinds count.
  const k = s.meeples.filter((m) => (m.kind === 'worker' || m.kind === 'engineer') && m.loc.k === 'supply').length;
  addHunger(s, k * per);
});
defTok('payFoodOrHunger', (s, a) => {
  const n = N(a, 0);
  const t = Math.min(n, s.food);
  s.food -= t;
  if (t) log(s, 'spend.food', `-${t} Food`, { n: t });
  addHunger(s, n - t);
});
defTok('loseResOrHunger', (s, a, ctx) => {
  const A = N(a, 0);
  const B = N(a, 1);
  const lost = Math.min(A, totalSupplyRes(s));
  push(s, { k: 'addHunger', n: (A - lost) * B });
  if (lost > 0) push(s, { k: 'supplyDist', n: lost, who: ctx.who, mode: 'lose', src: ctx.src });
});
defOp('addHunger', (s, op) => addHunger(s, op.n));

defTok('loseHalfFood', (s) => {
  const lost = Math.ceil(s.food / 2);
  s.food -= lost;
  log(s, 'lose.food', `Lost half of the Food (-${lost})`, { n: lost });
});
defTok('clearSupply', (s) => {
  let n = 0;
  for (const k of RES) {
    n += s.res[k];
    s.res[k] = 0;
  }
  if (n) log(s, 'lose.res', `All ${n} Resources in the supply were lost`, { n });
});

// ---------------------------------------------------------------------------------------------------------
// Resources on the map
// ---------------------------------------------------------------------------------------------------------

export function mapResOptions(s: GameState, kinds: ('wood' | 'coal' | 'core')[]): DistOption[] {
  const out: DistOption[] = [];
  for (const sp of Object.values(s.spaces)) {
    for (const k of kinds) {
      const n = sp.res[k] ?? 0;
      if (n > 0) out.push({ id: `${sp.id}|${k}`, label: `${resLabel(k)} – ${spaceName(s, sp.id)} (${n})`, cap: n });
    }
  }
  return out;
}
export function spaceName(s: GameState, id: string) {
  const sp = s.spaces[id];
  if (!sp) return id;
  return sp.tile === 'GEN' ? `Generator ${sp.slot}` : `${id.split(':')[0]} ${sp.slot}`;
}

defOp('mapPick', (s, op) => {
  const opts = mapResOptions(s, op.kinds);
  askDistribute(s, {
    who: op.who,
    kind: 'mapres',
    prompt: op.mode === 'take' ? `Take ${op.n} Resource(s) from the Map` : `Remove ${op.n} Resource(s) from the Map`,
    src: op.src,
    options: opts,
    count: op.n,
    then: { k: 'mapPickApply', mode: op.mode, n: op.n },
  });
});
defOp('mapPickApply', (s, op) => {
  let got = 0;
  for (const id of (op.pick ?? []) as string[]) {
    const [spId, k] = id.split('|');
    const sp = s.spaces[spId];
    if (sp && (sp.res as any)[k] > 0) {
      (sp.res as any)[k]--;
      got++;
      if (op.mode === 'take') (s.res as any)[k]++;
    }
  }
  if (got) log(s, op.mode === 'take' ? 'map.take' : 'map.remove', `${got} Resource(s) ${op.mode === 'take' ? 'taken from' : 'removed from'} the Map`, { n: got });
  if (op.mode === 'take' && got < op.n) {
    s.res.coal += op.n - got;
    log(s, 'gain.coal', `+${op.n - got} Coal (nothing left to take)`, {});
  }
});

defTok('takeMapRes', (s, a, ctx) => {
  let n = N(a, 0);
  const plus = /^plusPerActive(\w+)$/.exec(a[1] ?? '');
  if (plus) n += activeCount(s, plus[1].toLowerCase());
  push(s, { k: 'mapPick', kinds: ['wood', 'coal', 'core'], n, mode: 'take', who: ctx.who, src: ctx.src });
});
defTok('mapRemove', (s, a, ctx) => push(s, { k: 'mapPick', kinds: [a[0]], n: N(a, 1), mode: 'remove', who: ctx.who, src: ctx.src }));
defTok('removeMapRes', (s, a, ctx) => push(s, { k: 'mapPick', kinds: ['wood', 'coal'], n: N(a, 0), mode: 'remove', who: ctx.who, src: ctx.src }));

// ---------------------------------------------------------------------------------------------------------
// Stress
// ---------------------------------------------------------------------------------------------------------

defTok('stress+', (s, a) => addStress(s, N(a, 0)));
defTok('removeStress', (s, a) => {
  if (a[0] === 'all') return void removeStress(s, totalStress(s));
  if (a[0] === 'upTo') return void removeStress(s, N(a, 1));
  removeStress(s, N(a, 0));
});
defTok('removeAllStress', (s) => void removeStress(s, totalStress(s)));

// ---------------------------------------------------------------------------------------------------------
// Resources on Event cards
// ---------------------------------------------------------------------------------------------------------

function evFor(s: GameState, ctx: Ctx) {
  const uid = ctx.evUid ?? s.flags.curEv;
  return s.events.find((e) => e.uid === uid);
}

defTok('toCard', (s, a, ctx) => {
  const n = N(a, 1);
  const ev = evFor(s, ctx);
  if (!ev) return;
  const k = Math.min(n, totalSupplyRes(s));
  if (k <= 0) return;
  push(s, { k: 'toCardPick', n: k, uid: ev.uid, who: ctx.who, src: ctx.src });
});
defOp('toCardPick', (s, op) => {
  askDistribute(s, {
    who: op.who,
    prompt: `Place ${op.n} Resource(s) from the supply onto the card`,
    src: op.src,
    count: op.n,
    options: RES.map((k) => ({ id: k, label: `${resLabel(k)} (${s.res[k]})`, cap: s.res[k] })),
    then: { k: 'toCardApply', uid: op.uid },
  });
});
defOp('toCardApply', (s, op) => {
  const ev = s.events.find((e) => e.uid === op.uid);
  if (!ev) return;
  for (const k of (op.pick ?? []) as ResKind[]) {
    if (s.res[k] > 0) {
      s.res[k]--;
      ev.res[k] = (ev.res[k] ?? 0) + 1;
    }
  }
  log(s, 'card.res', `${(op.pick ?? []).length} Resource(s) placed on the card`, {});
});

export function cardResTotal(ev: { res: Partial<Record<ResKind, number>> }) {
  return Object.values(ev.res).reduce((a, b) => a + (b ?? 0), 0);
}
function evByCard(s: GameState, card: string) {
  return s.events.find((e) => e.card === card);
}
export function cardResToSupply(s: GameState, card: string) {
  const ev = evByCard(s, card);
  if (!ev) return;
  for (const k of RES) {
    const n = ev.res[k] ?? 0;
    if (n) {
      s.res[k] += n;
      ev.res[k] = 0;
    }
  }
}
export function cardResToBank(s: GameState, card: string) {
  const ev = evByCard(s, card);
  if (!ev) return;
  ev.res = {};
}
defTok('cardResToSupply', (s, a) => cardResToSupply(s, a[0]));
defTok('cardResToBank', (s, a) => cardResToBank(s, a[0]));
defTok('cardResOneToSupplyRestBank', (s, a, ctx) => {
  const ev = evByCard(s, a[0]);
  if (!ev || cardResTotal(ev) === 0) return;
  const kinds = RES.filter((k) => (ev.res[k] ?? 0) > 0);
  ask(s, {
    who: ctx.who,
    kind: 'choice',
    prompt: 'Take 1 Resource from the card into your supply (the rest goes to the bank)',
    src: ctx.src,
    options: kinds.map((k) => opt(k, resLabel(k))),
    then: { k: 'cardResOne', card: a[0] },
  });
});
defOp('cardResOne', (s, op) => {
  const ev = evByCard(s, op.card);
  if (!ev) return;
  const k = op.pick?.[0] as ResKind;
  if (k && (ev.res[k] ?? 0) > 0) s.res[k]++;
  ev.res = {};
});

export { runFx };
