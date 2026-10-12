// FX tokens owned by ACTIONS (spec 4.5): the Citizen-card replacement effects of the Action phase.
// Each token runs inside a Citizen card's `fx` list (see actions.ts, op actResolve) or inside a building action.
import '../actions';
import { ask, askDistribute, defOp, DistOption, log, opt, push } from '../core';
import { removeBuilding, canDismantle, constructActionOpts, startConstruct } from '../buildings';
import { removeSnowAction } from '../tiles';
import { adjacentSpaces, tileOfSpace, tilesAdjacentToSpace } from '../map';
import { bdef, buildingAtSpace, buildingByUid, gainRes, meepleById, techDone } from '../util';
import type { GameState, MapTile, ResKind } from '../types';
import { buildingFx, cureOnly, occupiedBuildings } from '../actions';
import { defTok, N, runFx } from './core';
import type { Ctx } from './core';

const resTotal = (s: GameState, sid: string) => {
  const r = s.spaces[sid]?.res ?? {};
  return (r.wood ?? 0) + (r.coal ?? 0) + (r.core ?? 0);
};

/** `N` from a sub-action argument such as "2subactions" (leading digits). */
function leadingNum(a: string[], def: number): number {
  const m = /^(\d+)/.exec(a[0] ?? '');
  return m ? Number(m[1]) : def;
}

// ---------------------------------------------------------------------------------------------------------
// Gather variants
// ---------------------------------------------------------------------------------------------------------

/** gatherTree:<res>:<n> (C04, T04): remove 1 Tree from ctx.space and gain n of the resource. */
defTok('gatherTree', (s, a, ctx) => {
  const sp = ctx.space ? s.spaces[ctx.space] : undefined;
  if (!sp || (sp.trees ?? 0) <= 0) {
    log(s, 'act.gather.noTree', 'No Tree to remove here');
    return;
  }
  sp.trees -= 1;
  gainRes(s, (a[0] ?? 'wood') as ResKind, N(a, 1, 2));
  log(s, 'act.gather.tree', `Removed a Tree and gained ${N(a, 1, 2)} ${a[0] ?? 'wood'}`, { space: ctx.space });
});

/** gatherFoodAdjacent (C28): Food equal to the Food bonus of the space's tile and all adjacent tiles. */
defTok('gatherFoodAdjacent', (s, _a, ctx) => {
  if (!ctx.space) return;
  const own = tileOfSpace(s, ctx.space);
  const tiles: MapTile[] = [];
  if (own) tiles.push(own);
  for (const t of tilesAdjacentToSpace(s, ctx.space)) if (!tiles.some((x) => x.key === t.key)) tiles.push(t);
  const food = tiles.reduce((n, t) => n + (t.food ?? 0), 0);
  gainRes(s, 'food', food);
  log(s, 'act.gather.food', `Gained ${food} Food from ${tiles.length} tile(s)`, { space: ctx.space });
});

/** gatheringPostOrAdjacent:<n> (C30): perform the Gathering Post action as normal, or take up to n Resources from one adjacent space. */
defTok('gatheringPostOrAdjacent', (s, a, ctx) => {
  runFx(s, [{ choose: [['buildingNormal'], [`gatherAdjacentSpace:${N(a, 0, 3)}`]] }], ctx);
});

defTok('gatherAdjacentSpace', (s, a, ctx: Ctx) => {
  push(s, { k: 'actAdjPick', who: ctx.who, space: ctx.space ?? null, n: N(a, 0, 3), src: ctx.src ?? null });
});

defOp('actAdjPick', (s, op) => {
  const cands = op.space ? adjacentSpaces(s, op.space).filter((sid) => resTotal(s, sid) > 0) : [];
  if (cands.length === 0) {
    log(s, 'act.adj.none', 'No adjacent space with Resources');
    return;
  }
  ask(s, {
    who: op.who,
    kind: 'adjacentSpace',
    prompt: 'Take Resources from which adjacent space?',
    options: cands.map((sid) => opt(sid, sid)),
    then: { k: 'actAdjTake', who: op.who, n: op.n },
    src: op.src ?? undefined,
  });
});

defOp('actAdjTake', (s, op) => {
  const sid: string = op.pick?.[0];
  const sp = s.spaces[sid];
  if (!sp) return;
  const options: DistOption[] = (['wood', 'coal', 'core'] as const)
    .filter((k) => (sp.res[k] ?? 0) > 0)
    .map((k) => ({ id: `${sid}|${k}`, label: `${k} from ${sid}`, cap: sp.res[k] ?? 0 }));
  askDistribute(s, {
    who: op.who,
    kind: 'gatherRes',
    prompt: `Take up to ${op.n} Resources from ${sid}`,
    options,
    count: op.n,
    then: { k: 'actGatherApply', who: op.who },
    src: 'gather',
  });
});

// ---------------------------------------------------------------------------------------------------------
// Construct variants
// ---------------------------------------------------------------------------------------------------------

/** constructMoveSmallBuilding:2subactions (C06): dismantle a small building without the non-dismantle icon, then build it again elsewhere. */
defTok('constructMoveSmallBuilding', (s, _a, ctx) => {
  push(s, { k: 'actMoveBuild', who: ctx.who, meeple: ctx.meeple ?? null, src: ctx.src ?? null });
});

defOp('actMoveBuild', (s, op) => {
  const opts = s.buildings
    .filter((b) => (bdef(b.kind) as any).size === 'S' && !b.printed && !b.ruins && canDismantle(s, b.uid))
    .map((b) => opt(`b:${b.uid}`, bdef(b.kind).name));
  if (opts.length === 0) {
    log(s, 'act.move.none', 'No small building can be moved');
    startConstruct(s, op.who, op.meeple ?? null, constructActionOpts(s, op.meeple ?? null, { src: op.src ?? null, who: op.who }));
    return;
  }
  ask(s, {
    who: op.who,
    kind: 'moveBuilding',
    prompt: 'Move which small Building? (dismantle, then build it on a valid space)',
    options: opts,
    then: { k: 'actMoveDo', who: op.who, meeple: op.meeple ?? null, src: op.src ?? null },
    src: op.src ?? undefined,
  });
});

defOp('actMoveDo', (s, op) => {
  const uid = Number(String(op.pick?.[0] ?? '').slice(2));
  if (!removeBuilding(s, uid)) return;
  log(s, 'act.move', 'Small Building dismantled to be moved', { uid });
  // only the rebuild of the moved Building is paid from this budget (plus one more with T08)
  startConstruct(s, op.who, op.meeple ?? null, constructActionOpts(s, op.meeple ?? null, { maxSub: 1 + (techDone(s, 'T08') ? 1 : 0), src: op.src ?? null, who: op.who }));
});

/**
 * constructUpgrade:2subactions (C10): Construct (default sub-action budget, 3 +1 with T08), Upgrades allowed as a sub-action.
 * The card says the Upgrade uses 2 sub-actions ("use 2 sub-actions to upgrade a Building by paying its upgrade cost"),
 * so the argument sets the per-Upgrade cost (upgradeCost). Extra options win over the L18 Engineer defaults.
 */
defTok('constructUpgrade', (s, a, ctx) => {
  const upgradeCost = leadingNum(a, 2);
  startConstruct(s, ctx.who, ctx.meeple ?? null, constructActionOpts(s, ctx.meeple ?? null, { allowUpgrade: true, upgradeCost, src: ctx.src ?? null, who: ctx.who }));
});

/** constructSubactions:<n> (C25): up to n Construct sub-actions. */
defTok('constructSubactions', (s, a, ctx) => {
  startConstruct(s, ctx.who, ctx.meeple ?? null, constructActionOpts(s, ctx.meeple ?? null, { maxSub: leadingNum(a, 3), src: ctx.src ?? null, who: ctx.who }));
});

/**
 * constructOverRuins:woodDiscount:<n> (C18, an Engineer): may Build over Ruins, each Build costs n less Wood. The card says
 * "as normal", so the Engineer budget of L18 applies to it (constructActionOpts).
 */
defTok('constructOverRuins', (s, a, ctx) => {
  const discount = a[0] === 'woodDiscount' ? N(a, 1, 0) : 0;
  startConstruct(s, ctx.who, ctx.meeple ?? null, constructActionOpts(s, ctx.meeple ?? null, { overRuins: true, woodDiscount: discount, src: ctx.src ?? null, who: ctx.who }));
});

// ---------------------------------------------------------------------------------------------------------
// Use a Building variants
// ---------------------------------------------------------------------------------------------------------

/** buildingNormal (C17): the building action as normal (its cost, then its effects). */
defTok('buildingNormal', (s, _a, ctx) => {
  runFx(s, buildingFx(s, ctx.bld, ctx.meeple ?? null), { ...ctx });
});

/** buildingCureEffect (C12, C15): only the Cure / Treat part of the building action. */
defTok('buildingCureEffect', (s, _a, ctx) => {
  runFx(s, cureOnly(buildingFx(s, ctx.bld, ctx.meeple ?? null)), { ...ctx });
});

/** cookhouseTiers:<cost1>:<hunger1>:<cost2>:<hunger2>... (C23): spend Food for a Hunger reduction, one tier. */
defTok('cookhouseTiers', (s, a, ctx) => {
  const lists: string[][] = [];
  for (let i = 0; i + 1 < a.length; i += 2) lists.push([`spend:food:${a[i]}`, `hunger-${a[i + 1]}`]);
  if (lists.length) runFx(s, [{ choose: lists }], ctx);
});

/** reuseBuilding[:occupied][:heated] (C14, Propaganda Centre): repeat the action of a building that has a Meeple on it; counts as heated. */
defTok('reuseBuilding', (s, _a, ctx) => {
  push(s, { k: 'actReuseBuild', who: ctx.who, meeple: ctx.meeple ?? null, src: ctx.src ?? null });
});

defOp('actReuseBuild', (s, op) => {
  // The Propaganda Centre cannot repeat its own action: it is occupied by the Meeple that is using it, and offering it
  // would reuse it again without end (ACT-UB8, op loop guard).
  const occ = occupiedBuildings(s).filter((o) => o.kind !== 'propagandaCentre');
  if (occ.length === 0) {
    log(s, 'act.reuse.none', 'No occupied Building to reuse');
    return;
  }
  ask(s, {
    who: op.who,
    kind: 'reuseBuilding',
    prompt: 'Reuse which occupied Building?',
    options: occ.map((o) => opt(`b:${o.uid}`, bdef(o.kind).name, { hint: o.space })),
    then: { k: 'actReuseDo', who: op.who, meeple: op.meeple ?? null, src: op.src ?? null },
    src: op.src ?? undefined,
  });
});

defOp('actReuseDo', (s, op) => {
  const uid = Number(String(op.pick?.[0] ?? '').slice(2));
  const b = buildingByUid(s, uid);
  if (!b) return;
  const sid = b.spaces.find((x) => buildingAtSpace(s, x) === b) ?? b.spaces[0];
  runFx(s, buildingFx(s, uid, op.meeple ?? null), { who: op.who, src: op.src ?? undefined, meeple: op.meeple ?? undefined, space: sid, bld: uid, heated: true });
});

// ---------------------------------------------------------------------------------------------------------
// Reuse a Worker (a Worker Meeple that already acted this Round acts again, by its location)
// ---------------------------------------------------------------------------------------------------------

defTok('reuseWorker', (s, _a, ctx) => {
  push(s, { k: 'actReuseWorker', who: ctx.who, src: ctx.src ?? null });
});

defOp('actReuseWorker', (s, op) => {
  const cands = s.meeples.filter((m) => m.kind === 'worker' && m.used);
  if (cands.length === 0) {
    log(s, 'act.reuseWorker.none', 'No Worker has acted this Round');
    return;
  }
  ask(s, {
    who: op.who,
    kind: 'reuseWorker',
    prompt: 'Reuse which Worker?',
    options: cands.map((m) => opt(`m:${m.id}`, `Worker ${m.id} (${m.loc.k})`)),
    then: { k: 'actReuseWorkerDo', who: op.who, src: op.src ?? null },
    src: op.src ?? undefined,
  });
});

defOp('actReuseWorkerDo', (s, op) => {
  const mid = Number(String(op.pick?.[0] ?? '').slice(2));
  const m = meepleById(s, mid);
  if (!m) return;
  const src = op.src ?? undefined;
  const loc = m.loc;
  if (loc.k === 'space' && loc.space) {
    const b = buildingAtSpace(s, loc.space);
    if (b) {
      runFx(s, buildingFx(s, b.uid, mid), { who: op.who, src, meeple: mid, space: loc.space, bld: b.uid, heated: true });
      return;
    }
    log(s, 'act.reuseWorker.noBuilding', 'The Worker was gathering: nothing to repeat here');
    return;
  }
  if (loc.k === 'board' && loc.slot === 'construct') {
    startConstruct(s, op.who, mid, constructActionOpts(s, mid, { src: op.src ?? null, who: op.who }));
    return;
  }
  if (loc.k === 'board' && loc.slot === 'removeSnow') {
    removeSnowAction(s, op.who, mid, 'normal', src);
    return;
  }
  log(s, 'act.reuseWorker.none', 'Nothing to repeat for this Worker');
});

