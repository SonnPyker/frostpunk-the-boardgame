// BUILD (spec 4.1): Construct sub-action loop (Build / Dismantle / Upgrade), placement, removal, upgrade, flip to Ruins,
// "Use a Building" with action modifiers (techs and laws), Dreadnought Steel substitution and sleeping capacity.
// Rules: rulebook p26 (Construct, Use a Building), appendix pp41-44, spec section 3.4. Checklist: ACT-CO1-5, ACT-UB1-10, BLD-01/02.
// Cross-module hook: the first Workshop built pushes op `techStart` when that op is registered (tech.ts).
import { ask, askDistribute, defOp, DistOption, hasOp, log, opt, push } from './core';
import { buildings as BUILDINGS, buildingMeta, laws as LAW_DATA } from './data';
import { feasible, runFx } from './fx/core';
import { engineerSpecificBarred, hasPassive, passive } from './laws';
import { adjacentSpaces, adjacentTiles, buildingHeated, spaceAllowed, spaceHeated, spaceLabel, tileAdjacentToRimDeposit, tileByKey, treesOnMap } from './map';
import type { Building, GameState, Op } from './types';
import { bdef, buildingByUid, cap, gainRes, lawActive, meepleById, meeplesAtSpace, nRes, roleOf, spendRes, techDone, toSupply, turnWho } from './util';

export type Cost = { wood?: number; core?: number };
export interface EffAction {
  cost: any[];
  fx: any[];
}
/** context carried by the Construct / Build / Upgrade / Dismantle op chain */
export interface C {
  who: number;
  src?: string | null;
  cont?: Op | null; // op pushed when this sub-action ends
  free?: boolean; // no cost
  filter?: string; // buildFree filter: any | wood1 | maxWood2 | upgradedMedicalPost
  size?: 'any' | 'small' | 'huntersHutOrHothouse'; // upgradeFree / upgradeBuilding scope
  ignoreUsed?: boolean; // ignore the "Meeple on the building" restriction
  woodDiscount?: number; // constructOverRuins:woodDiscount
  overRuins?: boolean; // may build over Ruins
  only?: string; // build only this kind (Law buildOnIntro offer)
  meeple?: number | null;
  left?: number; // Construct sub-actions still available
  /** the first sub-action of a Construct: its decisions may go back to the action menu (core.ts back); later ones may not */
  first?: boolean;
  allowUpgrade?: boolean;
  upgradeCost?: number; // sub-actions one Upgrade uses (L18 Engineer: 2); default 1
  onDone?: Op | null;
}

const CHILD_KINDS = ['child', 'childWorker', 'childEngineer'];
const isChild = (k: string) => CHILD_KINDS.includes(k);
const occupied = (s: GameState, b: Building) => b.spaces.some((sid) => meeplesAtSpace(s, sid).length > 0);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------------------------------------------------
// catalogue queries
// ---------------------------------------------------------------------------------------------------------

/** Building kinds that can be built now: base catalogue (not printed, not Ruins) plus law / tech unlocks (BLD-01). */
export function unlockedKinds(s: GameState): string[] {
  return Object.keys(BUILDINGS).filter((id) => {
    const d: any = BUILDINGS[id];
    if (d.build === undefined || d.cannotBuild || d.start || id === 'ruins' || id === 'dreadnoughtTile') return false;
    // spec 3.4: laws only UNLOCK; the building is then built through Construct at its normal build cost
    if (d.law && !s.laws.some((l) => l.id === d.law)) return false;
    if (d.unlockedBy && !techDone(s, d.unlockedBy)) return false;
    return true;
  });
}

/** Number of buildings of this kind on the map, Ruins included (spec 3.4). */
export function builtCount(s: GameState, kind: string): number {
  return s.buildings.filter((b) => b.kind === kind).length;
}

/** Base Build cost from the column the building is in; Steel may replace Wood (see costPayable). */
/** Build cost of a kind from its catalogue column, less `woodDiscount` Wood (constructOverRuins). Steel may replace Wood. */
export function buildCost(s: GameState, kind: string, woodDiscount = 0): Cost {
  return baseCost(kind, woodDiscount);
}

function baseCost(kind: string, woodDiscount = 0): Cost {
  const c: any = bdef(kind).build ?? {};
  return { wood: Math.max(0, (c.wood ?? 0) - woodDiscount), core: c.core ?? 0 };
}

export function costLabel(s: GameState, kind: string, free = false): string {
  if (free) return 'free';
  const c = baseCost(kind);
  const parts: string[] = [];
  if (c.wood) parts.push(`${c.wood} Wood`);
  if (c.core) parts.push(`${c.core} Steam Core`);
  return parts.length ? parts.join(' + ') : 'free';
}

/** Null when the cost can be paid now. Steel (Dreadnought) substitutes for Wood, mixing allowed (ACT-CO4). */
export function costPayable(s: GameState, cost: Cost, allowSteel = true): string | null {
  const w = cost.wood ?? 0;
  const c = cost.core ?? 0;
  if (w > s.res.wood + (allowSteel ? s.res.steel : 0)) return `Needs ${w} Wood`;
  if (c > s.res.core) return `Needs ${c} Steam Core`;
  return null;
}

/** Upgrade cost of a building kind, or null when it has no upgraded side (ACT-UB10). */
export function upgradeCostOf(kind: string): Cost | null {
  const d: any = bdef(kind);
  if (d.upgrade === 'special') return null;
  if (d.upgrade !== undefined) {
    if (!d.upgrade) return null;
    return { wood: d.upgrade.wood ?? 0, core: d.upgrade.core ?? 0 };
  }
  if (d.upgAction) return buildingMeta.upgradeCostByGroup[d.group ?? ''] ?? null;
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// placement
// ---------------------------------------------------------------------------------------------------------

export interface PlaceOption {
  id: string;
  label: string;
  spaces: string[];
}

/** Spaces a building of this kind would occupy when placed on spaceId (Large = both spaces of a Map tile). */
export function footprint(s: GameState, kind: string, spaceId: string): string[] | null {
  const sp = s.spaces[spaceId];
  if (!sp) return null;
  if (bdef(kind).size !== 'L') return [spaceId];
  const t = tileByKey(s, sp.tile);
  if (!t || t.kind === 'gen' || t.spaces.length !== 2) return null;
  return [...t.spaces];
}

function spaceFreeFor(s: GameState, sid: string, overRuins: boolean): boolean {
  const sp = s.spaces[sid];
  if (!sp) return false;
  // D043 A Tripod!: "you may not Build on these spaces until the Automaton is removed" (scenarioState.blocked, set by custom.ts)
  const blocked = (s.scenarioState?.blocked as string[] | undefined) ?? [];
  if (blocked.includes(sid)) return false;
  if (meeplesAtSpace(s, sid).length > 0) return false;
  if (sp.building == null) return true;
  const b = buildingByUid(s, sp.building);
  return !!b && b.ruins && overRuins;
}

function placementOk(s: GameState, kind: string, fp: string[]): boolean {
  const d: any = bdef(kind);
  const sp = s.spaces[fp[0]];
  const t = tileByKey(s, sp.tile);
  if (d.placement === 'notOnGeneratorTile' && sp.tile === 'GEN') return false;
  if (typeof d.placement === 'string' && d.placement.startsWith('adjacentRimDeposit:')) {
    const dep = d.placement.split(':')[1] as 'wood' | 'coal';
    if (!t || !tileAdjacentToRimDeposit(s, t, dep)) return false;
  }
  return true;
}

/** All legal placements of a kind (Large kinds list tiles, the id is the tile's first space). */
export function placementOptions(s: GameState, kind: string, opts: { overRuins?: boolean } = {}): PlaceOption[] {
  const overRuins = !!opts.overRuins;
  const out: PlaceOption[] = [];
  if (bdef(kind).size === 'L') {
    for (const t of s.tiles) {
      if (t.kind === 'gen' || t.spaces.length !== 2) continue;
      if (!t.spaces.every((sid) => spaceFreeFor(s, sid, overRuins))) continue;
      if (!spaceAllowed(s, t.spaces[0])) continue; // ACT-11 Frozen Grove: Construct only on a connected tile
      if (!placementOk(s, kind, t.spaces)) continue;
      out.push({ id: t.spaces[0], label: `${spaceLabel(s, t.spaces[0]).replace(/ (top|bottom)$/, '')} (both spaces)`, spaces: [...t.spaces] });
    }
    return out;
  }
  for (const sid of Object.keys(s.spaces)) {
    if (!spaceFreeFor(s, sid, overRuins)) continue;
    if (!spaceAllowed(s, sid)) continue; // ACT-11 Frozen Grove: Construct only on a connected tile
    if (!placementOk(s, kind, [sid])) continue;
    out.push({ id: sid, label: spaceLabel(s, sid), spaces: [sid] });
  }
  return out;
}

/** Can a building of this kind be built now (unlocked, under its limit, a legal space exists)? */
export function canBuildKind(s: GameState, kind: string, opts: { overRuins?: boolean } = {}): boolean {
  if (!unlockedKinds(s).includes(kind)) return false;
  const d: any = BUILDINGS[kind];
  if (d.limit !== undefined && builtCount(s, kind) >= d.limit) return false;
  return placementOptions(s, kind, opts).length > 0;
}

export interface PlaceOpts {
  upgraded?: boolean;
  printed?: boolean; // set-up pieces on the Generator tile (cannot be dismantled)
  overRuins?: boolean;
  who?: number;
  src?: string | null;
  noOnBuild?: boolean;
}

/**
 * Put a building on the map. Structural validation only (space free of Meeples and Buildings, Large on one tile,
 * placement rules); cost and limits are the caller's job (canBuildKind / payment ops). Ruins under the footprint are
 * removed from the game; Resources and Trees there return to the bank. Runs onBuild effects.
 */
export function placeBuilding(s: GameState, kind: string, spaceId: string, opts: PlaceOpts = {}): Building | null {
  const d: any = bdef(kind);
  const fp = footprint(s, kind, spaceId);
  if (!fp) return null;
  if (!fp.every((sid) => spaceFreeFor(s, sid, !!opts.overRuins))) return null;
  if (!placementOk(s, kind, fp)) return null;
  for (const sid of fp) {
    const bid = s.spaces[sid].building;
    if (bid != null) removeBuilding(s, bid);
  }
  for (const sid of fp) {
    s.spaces[sid].res = {};
    s.spaces[sid].trees = 0;
  }
  const b: Building = { uid: ++s.nextUid, kind, upgraded: !!opts.upgraded, ruins: false, spaces: [...fp] };
  if (opts.printed) b.printed = true;
  s.buildings.push(b);
  for (const sid of fp) s.spaces[sid].building = b.uid;
  const who = opts.who ?? s.leader;
  log(s, 'build', `${d.name} built`, { kind, uid: b.uid, spaces: fp });
  if (!opts.noOnBuild && d.onBuild && d.onBuild.length) runFx(s, d.onBuild, { who, src: 'bld:' + kind, bld: b.uid, space: fp[0] });
  // spec 3.4 / ACT-CO5: the first Workshop starts a Technology choice
  if (kind === 'workshop' && !opts.printed && builtCount(s, 'workshop') === 1 && hasOp('techStartCheck')) {
    push(s, { k: 'techStartCheck', who, src: 'bld:workshop' });
  }
  return b;
}

/** Remove a building piece (its spaces become empty). Removing the last Workshop returns the Technology token (ACT-CO5). */
export function removeBuilding(s: GameState, uid: number): boolean {
  const i = s.buildings.findIndex((b) => b.uid === uid);
  if (i < 0) return false;
  const b = s.buildings[i];
  for (const sid of b.spaces) if (s.spaces[sid] && s.spaces[sid].building === uid) s.spaces[sid].building = null;
  s.buildings.splice(i, 1);
  if (b.kind === 'workshop' && builtCount(s, 'workshop') === 0) {
    for (const t of s.techs) {
      if (t.state === 'developing') {
        t.state = 'inactive';
        t.dueRound = null;
      }
    }
    s.techInProgress = null;
    log(s, 'tech.lost', 'The last Workshop is gone: the Technology in development returns to inactive');
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// upgrade / dismantle / flip
// ---------------------------------------------------------------------------------------------------------

/** Can the building be upgraded now (ACT-UB10: once only, not Ruins, no diamond/special side, no Meeple unless ignored). */
export function canUpgrade(s: GameState, uid: number, ignoreUsed = false): boolean {
  const b = buildingByUid(s, uid);
  if (!b || b.ruins || b.upgraded) return false;
  if (!upgradeCostOf(b.kind)) return false;
  return ignoreUsed || !occupied(s, b);
}

/** Flip a building to its upgraded side. The cost is paid by the caller. */
export function upgradeBuilding(s: GameState, uid: number, opts: { ignoreUsed?: boolean } = {}): boolean {
  if (!canUpgrade(s, uid, !!opts.ignoreUsed)) return false;
  const b = buildingByUid(s, uid)!;
  b.upgraded = true;
  log(s, 'upgrade', `${bdef(b.kind).name} upgraded`, { uid, kind: b.kind });
  return true;
}

/** Dismantle is allowed only without a Meeple and never for printed (red Dismantle) pieces (ACT-CO3). */
export function canDismantle(s: GameState, uid: number): boolean {
  const b = buildingByUid(s, uid);
  if (!b) return false;
  const d: any = bdef(b.kind);
  if (b.printed || d.start || d.noDismantle || b.kind === 'dreadnoughtTile') return false;
  return !occupied(s, b);
}

/** Shelter flips to Ruins (storm). Ruins keep their space and provide no action. */
export function flipToRuins(s: GameState, uid: number): boolean {
  const b = buildingByUid(s, uid);
  if (!b || b.ruins) return false;
  if (bdef(b.kind).flipSide !== 'ruins') return false;
  b.ruins = true;
  b.upgraded = false;
  log(s, 'ruins', `${bdef(b.kind).name} became Ruins`, { uid });
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// actions and action modifiers
// ---------------------------------------------------------------------------------------------------------

function baseAction(b: Building): EffAction | null {
  const d: any = bdef(b.kind);
  const a = d.action;
  if (b.upgraded && d.upgAction !== undefined) {
    if (d.upgAction === null) return null;
    if (d.upgAction === 'same') return a ? clone({ cost: a.cost ?? [], fx: a.fx ?? [] }) : null;
    return clone({ cost: d.upgAction.cost ?? [], fx: d.upgAction.fx ?? [] });
  }
  if (!a) return null;
  return clone({ cost: a.cost ?? [], fx: a.fx ?? [] });
}

function addChoice(fx: any[], list: any[]): any[] {
  if (fx.length === 1 && fx[0] && typeof fx[0] === 'object' && 'choose' in fx[0]) {
    fx[0].choose.push(list);
    return fx;
  }
  return [{ choose: [fx, list] }];
}

/**
 * The action a building performs for this Meeple right now (null = no action). Applies the modifiers of spec 3.4:
 * T05 medicalPost treat:2 choice, L12 medical food-to-cure, T03 charcoalKiln tree option, T13 coalThumper +2 Coal,
 * T10 sawmill/wallDrill +1 Wood, T06 generator +1 stress removal, T15 hothouse corpse-back for +3 Food (Engineer).
 */
export function effectiveAction(s: GameState, b: Building, meepleId: number | null): EffAction | null {
  if (b.ruins) return null;
  let e = baseAction(b);
  if (!e) return null;
  const m = meepleId != null ? meepleById(s, meepleId) : undefined;
  const role = m ? roleOf(m.kind) : null;
  const k = b.kind;
  if ((k === 'medicalPost' || k === 'infirmary' || k === 'careHouse') && lawActive(s, 'L12')) {
    e.fx.push({ ifPay: 'spend:food:2', then: ['cure:1'] });
  }
  if (k === 'medicalPost' && techDone(s, 'T05')) e.fx = addChoice(e.fx, ['treat:2']);
  if (k === 'charcoalKiln' && techDone(s, 'T03')) {
    const gain = e.fx.filter((x: any) => typeof x === 'string' && x.startsWith('gain:'));
    const trees = treesOnMap(s) > 0;
    const wood = s.res.wood >= 1;
    if (trees && wood) e = { cost: [], fx: [{ choose: [['pay:wood:1', ...gain], ['removeTree:any', ...gain]] }] };
    else if (trees) e = { cost: [], fx: ['removeTree:any', ...gain] };
  }
  if (k === 'coalThumper' && techDone(s, 'T13')) e.fx.push('gain:coal:2');
  if ((k === 'sawmill' || k === 'wallDrill') && techDone(s, 'T10')) e.fx.push('gain:wood:1');
  if (k === 'generator' && techDone(s, 'T06')) e.fx.push('removeStress:1');
  // L19 Radical Treatment: a Medical Post or Infirmary may instead set one Sickness marker to 5 and flip it (may cause death);
  // the alternative replaces the building's normal effect (cost unchanged).
  if ((k === 'medicalPost' || k === 'infirmary') && hasPassive(s, 'medicalPostOrInfirmaryAlt')) e = { cost: e.cost, fx: ['setSickFlip5'] };
  if (k === 'hothouse' && techDone(s, 'T15') && role === 'engineer' && s.corpse > 0) {
    e.fx.push({ choose: [['corpseBack:1', 'gain:food:3'], ['stop']] });
  }
  return e;
}

export function buildingAction(s: GameState, uid: number, meepleId: number | null): EffAction | null {
  const b = buildingByUid(s, uid);
  return b ? effectiveAction(s, b, meepleId) : null;
}

/** Tile-scope tree search used by removeTree: tile | tileOrAdjacent | any. Returns spaces that hold Trees. */
export function treeCandidates(s: GameState, fromSpace: string | null | undefined, scope: string): string[] {
  let spaces: string[];
  if (scope === 'any') spaces = Object.keys(s.spaces);
  else {
    const sp = fromSpace ? s.spaces[fromSpace] : undefined;
    if (!sp) return [];
    const t = tileByKey(s, sp.tile);
    if (!t) return [];
    spaces = [...t.spaces];
    if (scope === 'tileOrAdjacent') for (const at of adjacentTiles(s, t)) spaces.push(...at.spaces);
  }
  return spaces.filter((sid) => (s.spaces[sid]?.trees ?? 0) > 0);
}

/** Null when the Meeple may use this building now, otherwise the reason. */
export function usageProblem(s: GameState, b: Building, meepleId: number | null, who: number, childOk = false): string | null {
  if (b.ruins) return 'Ruins have no action';
  const e = effectiveAction(s, b, meepleId);
  if (!e) return 'No action';
  // ACT-11 Frozen Grove: Use a Building only on a tile adjacent or connected to the Generator (heating is unaffected)
  if (!spaceAllowed(s, b.spaces[0])) return 'Not connected to the Generator';
  const d: any = bdef(b.kind);
  const m = meepleId != null ? meepleById(s, meepleId) : undefined;
  if (m) {
    const role = roleOf(m.kind);
    // Only plain child Meeples are limited to Citizen cards; child workers and engineers act as their adult role (roleOf)
    if (m.kind === 'child' && !childOk && !(b.kind === 'gatheringPost' && lawActive(s, 'L01')) && !(b.kind === 'cookhouse' && techDone(s, 'T16'))) {
      return 'Child Meeples act only through Citizen cards';
    }
    // D062 Engineers' Strike: an Engineer may not use an Engineer-specific Building (the card's own event action is exempt)
    if (d.engineer && role === 'engineer' && engineerSpecificBarred(s)) return "Engineers may not use Engineer-specific actions (D062)";
    if (d.engineer && role !== 'engineer') {
      // L18: Workers may use Workshops and the Generator (passive workersUseWorkshopsAndGenerator aliases both keys)
      const ok =
        (role === 'worker' && b.kind === 'workshop' && lawActive(s, 'L18')) ||
        (role === 'worker' && b.kind === 'generator' && hasPassive(s, 'workersUseGenerator')) ||
        (role === 'automaton' && techDone(s, 'T17'));
      if (!ok) return 'Engineers only';
    }
  }
  if (b.spaces.reduce((n, sid) => n + meeplesAtSpace(s, sid).length, 0) >= b.spaces.length) return 'Building is occupied';
  const pay = feasible(s, e.cost, { who });
  if (pay) return pay;
  for (const it of e.fx) {
    if (typeof it === 'string' && it.startsWith('removeTree:') && treeCandidates(s, b.spaces[0], it.split(':')[1]).length === 0) {
      return 'No Tree to remove';
    }
  }
  return null;
}

export interface UseOpts {
  space?: string;
  heated?: boolean;
  childOk?: boolean;
  then?: Op | null;
  src?: string | null;
}

/**
 * Use a Building with a Meeple. Validates, then queues op `bldUse`, which places the Meeple, computes heating and runs
 * the action (cost first, then effects) with ctx {who, bld, meeple, space, heated}. Cold-action sickness is the caller's job.
 */
export function startUseBuilding(s: GameState, who: number, meepleId: number | null, uid: number, opts: UseOpts = {}): boolean {
  const b = buildingByUid(s, uid);
  if (!b) return false;
  if (usageProblem(s, b, meepleId, who, !!opts.childOk)) return false;
  push(s, {
    k: 'bldUse',
    who,
    meeple: meepleId,
    uid,
    space: opts.space ?? null,
    heated: opts.heated ?? null,
    childOk: !!opts.childOk,
    then: opts.then ?? null,
    src: opts.src ?? null,
  });
  return true;
}

export interface UsableBuilding {
  uid: number;
  kind: string;
  name: string;
  space: string;
  heated: boolean;
  usable: boolean;
  reason: string | null;
}

/** Buildings with an action, with usable flags and reasons, for a given Meeple (null = generic listing). */
export function usableBuildings(s: GameState, meepleId: number | null, childOk = false): UsableBuilding[] {
  const out: UsableBuilding[] = [];
  const who = turnWho(s);
  for (const b of s.buildings) {
    if (!effectiveAction(s, b, meepleId)) continue;
    const space = pickSpace(s, b);
    const reason = usageProblem(s, b, meepleId, who, childOk);
    out.push({ uid: b.uid, kind: b.kind, name: bdef(b.kind).name, space, heated: spaceHeated(s, space, true), usable: !reason, reason });
  }
  return out;
}

function pickSpace(s: GameState, b: Building): string {
  return b.spaces.find((sid) => meeplesAtSpace(s, sid).length === 0) ?? b.spaces[0];
}

// ---------------------------------------------------------------------------------------------------------
// Construct
// ---------------------------------------------------------------------------------------------------------

export interface ConstructOpts {
  /**
   * true when this Construct IS the Construct action (rulebook p26): the normal action, a Citizen card that replaces it
   * (C06, C10, C18, C25), or a Worker that reuses it. Only then do the action rules apply: T08 (+1 sub-action) and the
   * L18 Engineer budget (see constructActionOpts). false (default) is a free Construct granted by an effect: no action rules.
   */
  isAction?: boolean;
  maxSub?: number; // default 3 (+1 with T08 when isAction)
  allowUpgrade?: boolean; // Upgrade as a sub-action (constructUpgrade:2subactions, L18 engineer perm)
  upgradeCost?: number; // sub-actions one Upgrade uses (L18 engineer: 2 Construct sub-actions to upgrade)
  woodDiscount?: number; // constructOverRuins:woodDiscount:N
  overRuins?: boolean; // constructOverRuins
  onDone?: Op | null; // op pushed when the Construct action ends
  src?: string | null;
  who?: number;
}

/** Construct action: up to N sub-actions (Build / Dismantle / Upgrade) chosen by the player, then `onDone`. */
export function startConstruct(s: GameState, who: number, meepleId: number | null, opts: ConstructOpts = {}): void {
  const m = meepleId != null ? meepleById(s, meepleId) : undefined;
  if (m) m.loc = { k: 'board', slot: 'construct' };
  const maxSub = opts.maxSub ?? 3 + (opts.isAction && techDone(s, 'T08') ? 1 : 0);
  const c: C = {
    who: opts.who ?? who,
    src: opts.src ?? null,
    meeple: meepleId,
    left: maxSub,
    first: true,
    allowUpgrade: !!opts.allowUpgrade,
    upgradeCost: opts.upgradeCost ?? 1,
    woodDiscount: opts.woodDiscount ?? 0,
    overRuins: !!opts.overRuins,
    onDone: opts.onDone ?? null,
  };
  push(s, { k: 'bldConstructStep', c });
}

/**
 * Options of a Construct that is the Construct action (isAction): the normal action, a Citizen card that replaces it
 * (the card's own budget in `extra` wins), or a Worker that reuses it. L18 Shared Knowledge (engineerConstructTwoSubactionsUpgrade):
 * an Engineer's Construct has 2 sub-actions and one Upgrade costs both of them. Applies to Engineer Meeples only.
 */
export function constructActionOpts(s: GameState, meepleId: number | null, extra: ConstructOpts = {}): ConstructOpts {
  const m = meepleId != null ? meepleById(s, meepleId) : undefined;
  const engineerTwo = !!m && roleOf(m.kind) === 'engineer' && hasPassive(s, 'engineerConstructTwoSubactionsUpgrade');
  return { ...(engineerTwo ? { maxSub: 2, allowUpgrade: true, upgradeCost: 2 } : {}), ...extra, isAction: true };
}

function finishConstruct(s: GameState, c: C) {
  if (c.onDone) push(s, c.onDone);
}

function anyBuildable(s: GameState, c: C): boolean {
  return unlockedKinds(s).some((k) => canBuildKind(s, k, { overRuins: c.overRuins }) && costPayable(s, baseCost(k, 0)) === null);
}
function anyDismantle(s: GameState): boolean {
  return s.buildings.some((b) => canDismantle(s, b.uid));
}
function anyUpgrade(s: GameState): boolean {
  // Upgrades are paid in Wood only (Steel does not replace Wood for upgrades)
  return s.buildings.some((b) => canUpgrade(s, b.uid, false) && costPayable(s, upgradeCostOf(b.kind)!, false) === null);
}

defOp('bldConstructStep', (s, op) => {
  const c: C = op.c;
  if ((c.left ?? 0) <= 0) return finishConstruct(s, c);
  const options = [];
  if (anyBuildable(s, c)) options.push(opt('build', 'Build a Building'));
  if (anyDismantle(s)) options.push(opt('dismantle', 'Dismantle a Building'));
  if (c.allowUpgrade && (c.left ?? 0) >= (c.upgradeCost ?? 1) && anyUpgrade(s)) options.push(opt('upgrade', 'Upgrade a Building'));
  options.push(opt('done', 'End Construction'));
  ask(s, {
    who: c.who,
    kind: 'construct',
    prompt: `Construct: ${c.left} sub-action(s) left`,
    options,
    then: { k: 'bldConstructPick', c },
    src: c.src ?? undefined,
    back: !!c.first,
  });
});

defOp('bldConstructPick', (s, op) => {
  const c: C = op.c;
  const pick = op.pick?.[0];
  const used = pick === 'upgrade' ? c.upgradeCost ?? 1 : 1;
  const cont: Op = { k: 'bldConstructStep', c: { ...c, left: (c.left ?? 1) - used, first: false } };
  const sub: C = { who: c.who, src: c.src, woodDiscount: c.woodDiscount, overRuins: c.overRuins, first: c.first, cont };
  if (pick === 'build') return push(s, { k: 'bldBuildKind', c: { ...sub, free: false, filter: 'any' } });
  if (pick === 'dismantle') return push(s, { k: 'bldDismantlePick', c: sub });
  if (pick === 'upgrade') return push(s, { k: 'bldUpgradePick', c: { ...sub, free: false, size: 'any', ignoreUsed: false } });
  finishConstruct(s, c);
});

// ----- Build -----

function buildFilterOk(kind: string, filter: string | undefined): boolean {
  const cost = baseCost(kind);
  switch (filter) {
    case 'wood1':
      return cost.wood === 1 && !cost.core;
    case 'maxWood2':
      return (cost.wood ?? 0) <= 2 && !cost.core;
    case 'upgradedMedicalPost':
      return kind === 'medicalPost';
    case 'hothouse':
      // D030 A (printed): "Build a Hothouse for free" - only a Hothouse
      return kind === 'hothouse';
    default:
      return true;
  }
}

defOp('bldBuildKind', (s, op) => {
  const c: C = op.c;
  const kinds = unlockedKinds(s).filter(
    (k) =>
      (!c.only || k === c.only) &&
      buildFilterOk(k, c.filter) &&
      canBuildKind(s, k, { overRuins: c.overRuins }) &&
      (c.free || costPayable(s, baseCost(k, 0)) === null),
  );
  if (!kinds.length) {
    if (c.cont) push(s, c.cont);
    return;
  }
  ask(s, {
    who: c.who,
    kind: 'buildPick',
    prompt: 'Choose a Building to build',
    options: kinds.map((k) => opt(k, `${bdef(k).name} (${costLabel(s, k, !!c.free)})`)),
    then: { k: 'bldBuildSpace', c },
    src: c.src ?? undefined,
    back: !!c.first,
  });
});

/**
 * Law buildOnIntro (printed on the Law card, e.g. Child Shelter L02, Care House L09, Fighting Arena L10, Public House L11):
 * "When this Law is introduced, you may immediately build X by paying its cost." Optional, at the normal cost. Queued by
 * laws.ts `lawApply` after the intro Hope/Discontent change. Silent when the building cannot be built or paid for now.
 */
defOp('bldLawOffer', (s, op) => {
  const lawId: string = op.lawId;
  const kind: string | undefined = (LAW_DATA[lawId] as { buildOnIntro?: string } | undefined)?.buildOnIntro;
  if (!kind || !unlockedKinds(s).includes(kind)) return;
  if (!canBuildKind(s, kind)) return;
  if (costPayable(s, baseCost(kind, 0)) !== null) return;
  ask(s, {
    who: s.leader,
    kind: 'lawBuild',
    prompt: `${LAW_DATA[lawId]?.title ?? lawId}: you may immediately build the ${bdef(kind).name} by paying its cost`,
    options: [opt('yes', `Build ${bdef(kind).name} (${costLabel(s, kind)})`), opt('no', 'Do not build now')],
    then: { k: 'bldLawPick', kind },
  });
});

defOp('bldLawPick', (s, op) => {
  if (op.pick?.[0] !== 'yes') return;
  push(s, {
    k: 'bldBuildKind',
    c: { who: s.leader, src: null, cont: null, free: false, filter: 'any', overRuins: false, woodDiscount: 0, only: op.kind },
  });
});

defOp('bldBuildSpace', (s, op) => {
  const c: C = op.c;
  const kind: string = op.pick[0];
  const places = placementOptions(s, kind, { overRuins: c.overRuins });
  if (!places.length) {
    if (c.cont) push(s, c.cont);
    return;
  }
  ask(s, {
    who: c.who,
    kind: 'buildSpace',
    prompt: `Place ${bdef(kind).name}`,
    options: places.map((p) => opt(p.id, p.label)),
    then: { k: 'bldBuildPay', c, kind },
    src: c.src ?? undefined,
    back: !!c.first,
  });
});

defOp('bldBuildPay', (s, op) => {
  const c: C = op.c;
  const kind: string = op.kind;
  const sid: string = op.pick[0];
  const fp = footprint(s, kind, sid) ?? [sid];
  const overRuins = fp.some((x) => {
    const bid = s.spaces[x]?.building;
    const b = bid != null ? buildingByUid(s, bid) : undefined;
    return !!b?.ruins;
  });
  const cost = c.free ? { wood: 0, core: 0 } : baseCost(kind, overRuins ? c.woodDiscount ?? 0 : 0);
  const next: Op = { k: 'bldBuildPlace', c, kind, spaceId: sid, cost };
  if (c.free) return push(s, next);
  if (costPayable(s, cost)) {
    log(s, 'build.cancel', `Cannot pay for ${bdef(kind).name}`, { kind });
    if (c.cont) push(s, c.cont);
    return;
  }
  push(s, { k: 'bldPay', c, cost, next });
});

/** Pay a cost: Steel replaces Wood (player chooses the mix when both are available). Queues `next` with `paid`. */
defOp('bldPay', (s, op) => {
  const c: C = op.c;
  const cost: Cost = op.cost;
  if (cost.core) spendRes(s, 'core', cost.core);
  const W = cost.wood ?? 0;
  if (W <= 0) return push(s, { ...op.next, paid: { wood: 0, steel: 0 } });
  const woodOpt = { id: 'wood', label: 'Wood', cap: Math.min(W, s.res.wood) };
  const steelOpt = { id: 'steel', label: 'Steel', cap: Math.min(W, s.res.steel) };
  askDistribute(s, {
    who: c.who,
    kind: 'pay',
    prompt: op.noSteel ? `Pay ${W} Wood` : `Pay ${W} Wood (Steel may replace Wood)`,
    options: (op.noSteel ? [woodOpt] : [woodOpt, steelOpt]) as DistOption[],
    count: W,
    then: { k: 'bldPayApply', c, next: op.next },
    back: !!c.first,
    src: c.src ?? undefined,
  });
});

defOp('bldPayApply', (s, op) => {
  const picks: string[] = op.pick ?? [];
  const wood = picks.filter((x) => x === 'wood').length;
  const steel = picks.filter((x) => x === 'steel').length;
  if (wood) spendRes(s, 'wood', wood);
  if (steel) spendRes(s, 'steel', steel);
  push(s, { ...op.next, paid: { wood, steel } });
});

defOp('bldBuildPlace', (s, op) => {
  const c: C = op.c;
  const kind: string = op.kind;
  const W = op.cost?.wood ?? 0;
  const paid = op.paid ?? { wood: 0, steel: 0 };
  // ACT-CO4: paying the full Wood cost in Steel upgrades the new building for free
  const fullSteel = W > 0 && paid.steel === W && paid.wood === 0;
  const upgraded = (c.filter === 'upgradedMedicalPost' && kind === 'medicalPost') || (fullSteel && upgradeCostOf(kind) !== null);
  if (c.cont) push(s, c.cont);
  const b = placeBuilding(s, kind, op.spaceId, { upgraded, overRuins: c.overRuins, who: c.who, src: c.src });
  if (!b) log(s, 'build.fail', `${bdef(kind).name} could not be placed`, { kind });
});

// ----- Dismantle -----

defOp('bldDismantlePick', (s, op) => {
  const c: C = op.c;
  const list = s.buildings.filter((b) => canDismantle(s, b.uid));
  if (!list.length) {
    if (c.cont) push(s, c.cont);
    return;
  }
  ask(s, {
    who: c.who,
    kind: 'dismantle',
    prompt: 'Dismantle which Building?',
    options: list.map((b) => opt(String(b.uid), buildingLabel(s, b.uid))),
    then: { k: 'bldDismantleDo', c },
    src: c.src ?? undefined,
    back: !!c.first,
  });
});

defOp('bldDismantleDo', (s, op) => {
  const c: C = op.c;
  const uid = Number(op.pick[0]);
  if (canDismantle(s, uid)) {
    const name = bdef(buildingByUid(s, uid)!.kind).name;
    removeBuilding(s, uid);
    log(s, 'dismantle', `${name} dismantled`, { uid });
    if (techDone(s, 'T08')) gainRes(s, 'wood', 1);
  }
  if (c.cont) push(s, c.cont);
});

export function buildingLabel(s: GameState, uid: number): string {
  const b = buildingByUid(s, uid);
  if (!b) return `#${uid}`;
  const tags = [b.ruins ? 'Ruins' : '', b.upgraded ? 'upgraded' : ''].filter(Boolean);
  return `${bdef(b.kind).name}${tags.length ? ` (${tags.join(', ')})` : ''} at ${spaceLabel(s, b.spaces[0])}`;
}

// ----- Upgrade -----

defOp('bldUpgradePick', (s, op) => {
  const c: C = op.c;
  const list = s.buildings.filter((b) => {
    const d: any = bdef(b.kind);
    if (c.size === 'small' && d.size !== 'S') return false;
    if (c.size === 'huntersHutOrHothouse' && b.kind !== 'huntersHut' && b.kind !== 'hothouse') return false;
    if (!canUpgrade(s, b.uid, !!c.ignoreUsed)) return false;
    if (!c.free && costPayable(s, upgradeCostOf(b.kind)!, false) !== null) return false;
    return true;
  });
  if (!list.length) {
    if (c.cont) push(s, c.cont);
    return;
  }
  ask(s, {
    who: c.who,
    kind: 'upgradePick',
    prompt: 'Upgrade which Building?',
    options: list.map((b) => opt(String(b.uid), buildingLabel(s, b.uid))),
    then: { k: 'bldUpgradeCost', c },
    src: c.src ?? undefined,
    back: !!c.first,
  });
});

defOp('bldUpgradeCost', (s, op) => {
  const c: C = op.c;
  const uid = Number(op.pick[0]);
  const b = buildingByUid(s, uid);
  if (!b) {
    if (c.cont) push(s, c.cont);
    return;
  }
  if (c.free) return push(s, { k: 'bldUpgradeDo', c, uid });
  push(s, { k: 'bldPay', c, cost: upgradeCostOf(b.kind) ?? {}, noSteel: true, next: { k: 'bldUpgradeDo', c, uid } });
});

defOp('bldUpgradeDo', (s, op) => {
  const c: C = op.c;
  if (c.cont) push(s, c.cont);
  upgradeBuilding(s, op.uid, { ignoreUsed: !!c.ignoreUsed });
});

// ----- Destroy (dusk / social effects) -----

defOp('bldDestroy', (s, op) => {
  const c: C = op.c;
  const list = s.buildings.filter((b) => {
    const d: any = bdef(b.kind);
    // Red Dismantle icon (printed, start, Beacon = noDismantle) cannot be destroyed either (rulebook p26, ACT-CO3).
    if (b.printed || d.start || d.noDismantle || b.kind === 'dreadnoughtTile') return false;
    return op.mode !== 'occupied' || occupied(s, b);
  });
  if (!list.length) {
    if (c.cont) push(s, c.cont);
    return;
  }
  ask(s, {
    who: c.who,
    kind: 'destroy',
    prompt: 'Destroy which Building?',
    options: list.map((b) => opt(String(b.uid), buildingLabel(s, b.uid))),
    then: { k: 'bldDestroyDo', c, mode: op.mode, count: op.count },
    src: c.src ?? undefined,
  });
});

defOp('bldDestroyDo', (s, op) => {
  const c: C = op.c;
  const uid = Number(op.pick[0]);
  const b = buildingByUid(s, uid);
  if (c.cont) push(s, c.cont);
  if (op.count > 1) push(s, { k: 'bldDestroy', c, mode: op.mode, count: op.count - 1 });
  if (!b) return;
  for (const sid of b.spaces) for (const m of meeplesAtSpace(s, sid)) toSupply(s, m);
  const name = bdef(b.kind).name;
  removeBuilding(s, uid);
  log(s, 'destroy', `${name} destroyed`, { uid });
});

// ----- Gather adjacent / Thump / Corpse / Trees -----

function takeOne(s: GameState, sid: string, k: 'wood' | 'coal' | 'core') {
  const sp = s.spaces[sid];
  if (!sp || !(sp.res[k] ?? 0)) return;
  sp.res[k] = (sp.res[k] ?? 0) - 1;
  if (sp.res[k] === 0) delete sp.res[k];
  gainRes(s, k, 1);
}

/** Resource kinds currently on a space (wood, coal, core). */
function spaceResKinds(s: GameState, sid: string): ('wood' | 'coal' | 'core')[] {
  const sp = s.spaces[sid];
  return sp ? (['wood', 'coal', 'core'] as const).filter((k) => (sp.res[k] ?? 0) > 0) : [];
}

/** Take one Resource from a space: the only kind at once, several kinds asked (gatherPick). */
function takeOneFromSpace(s: GameState, c: C, sid: string) {
  const kinds = spaceResKinds(s, sid);
  if (!kinds.length) return;
  if (kinds.length === 1) return takeOne(s, sid, kinds[0]);
  ask(s, {
    who: c.who,
    kind: 'gatherPick',
    prompt: `Take which Resource from ${spaceLabel(s, sid)}?`,
    options: kinds.map((k) => opt(k, cap(k === 'core' ? 'steam core' : k))),
    then: { k: 'bldGatherTake', sid },
    src: c.src ?? undefined,
  });
}

defOp('bldGatherAdj', (s, op) => {
  const c: C = op.c;
  const spaces: string[] = op.spaces;
  const limit: number | undefined = op.limit;
  if (!spaces.length || limit === 0) {
    if (c.cont) push(s, c.cont);
    return;
  }
  const withRes = spaces.filter((sid) => spaceResKinds(s, sid).length > 0);
  if (limit !== undefined && withRes.length > limit) {
    // the L01 cap binds: the player chooses which adjacent space gives each of the (limited) Resources
    const sids = [...new Set(withRes)];
    ask(s, {
      who: c.who,
      kind: 'space',
      prompt: `Take a Resource from which space? (${limit} left)`,
      options: sids.map((sid) => opt(sid, spaceLabel(s, sid), { hint: nRes(Object.values(s.spaces[sid].res).reduce((a, n) => a + (n ?? 0), 0)) })),
      then: { k: 'bldGatherChosen', c, spaces, limit },
      src: c.src ?? undefined,
    });
    return;
  }
  const [sid, ...rest] = spaces;
  const hasRes = spaceResKinds(s, sid).length > 0;
  // one Resource is taken from this space when it has any; the cap counts that take before the next space is visited
  push(s, { k: 'bldGatherAdj', c, spaces: rest, ...(limit !== undefined ? { limit: limit - (hasRes ? 1 : 0) } : {}) });
  if (hasRes) takeOneFromSpace(s, c, sid);
});

/** The player picked the space for one capped Resource (L01): the rest of the list continues with one less to take. */
defOp('bldGatherChosen', (s, op) => {
  const c: C = op.c;
  const spaces: string[] = op.spaces;
  const sid = String(op.pick?.[0] ?? '');
  const idx = spaces.indexOf(sid);
  if (idx < 0) return push(s, { k: 'bldGatherAdj', c, spaces: [], limit: op.limit });
  const rest = [...spaces.slice(0, idx), ...spaces.slice(idx + 1)];
  push(s, { k: 'bldGatherAdj', c, spaces: rest, limit: (op.limit as number) - 1 });
  takeOneFromSpace(s, c, sid);
});

defOp('bldGatherTake', (s, op) => {
  takeOne(s, op.sid, op.pick[0]);
});

function coalDepositOk(s: GameState, sid: string): boolean {
  const sp = s.spaces[sid];
  if (!sp || sp.building != null || sp.trees > 0) return false;
  if ((sp.res.wood ?? 0) > 0 || (sp.res.core ?? 0) > 0) return false;
  return (sp.res.coal ?? 0) < 5;
}

defOp('bldThumpApply', (s, op) => {
  const each: number = op.each;
  for (const sid of (op.pick ?? []) as string[]) {
    const sp = s.spaces[sid];
    if (!sp) continue;
    // Coal Thumper places Coal from the bank: the bank's own Coal stock does not limit it (only the 5-Coal cap per space)
    const n = Math.min(each, 5 - (sp.res.coal ?? 0));
    if (n <= 0) continue;
    sp.res.coal = (sp.res.coal ?? 0) + n;
    log(s, 'thump', `+${n} Coal placed`, { sid, n });
  }
});

defOp('bldCorpseDo', (s, op) => {
  const n = Number(op.pick?.[0] ?? 0);
  if (n <= 0) return;
  s.corpse = Math.max(0, s.corpse - n);
  log(s, 'corpse.back', `Corpse marker moved back ${n}`, { n });
  // Cemetery: "If you do, increase Hope" -- Hope is gained only after the marker actually moved.
  if (op.hopeAfterMove) runFx(s, ['hope+:1'], { who: op.who, src: op.src ?? 'bld:cemetery' });
});

defOp('bldTreeDo', (s, op) => {
  const sp = s.spaces[op.pick[0]];
  if (!sp || sp.trees <= 0) return;
  sp.trees -= 1;
  log(s, 'tree.remove', `Tree removed at ${spaceLabel(s, op.pick[0])}`, { sid: op.pick[0] });
});

/**
 * Corpse marker back (Snow Pit, Cemetery, Hothouse): a choice among the allowed distances.
 * `hopeAfterMove` (Cemetery only) gains 1 Hope once the marker has actually moved (never when it cannot move).
 */
export function corpseBackChoice(s: GameState, who: number, lo: number, hi: number, src?: string, hopeAfterMove = false) {
  const max = Math.min(hi, s.corpse);
  if (max < 1) return;
  const options = [];
  for (let n = Math.min(lo, max); n <= max; n++) options.push(opt(String(n), `Move the Corpse marker back ${n}`));
  ask(s, {
    who,
    kind: 'corpse',
    prompt: 'Move the Corpse marker back how far?',
    options,
    then: hopeAfterMove ? { k: 'bldCorpseDo', hopeAfterMove: true, who, src } : { k: 'bldCorpseDo' },
    src,
  });
}

/** thump:SPACES:EACH (Coal Thumper): up to SPACES adjacent spaces each receive EACH Coal from the bank. */
export function thumpCoal(s: GameState, who: number, space: string | undefined, count: number, each: number, src?: string) {
  if (!space) return;
  const cands = adjacentSpaces(s, space).filter((sid) => coalDepositOk(s, sid));
  if (!cands.length) return;
  askDistribute(s, {
    who,
    kind: 'thump',
    prompt: `Place ${each} Coal on up to ${count} adjacent spaces`,
    options: cands.map((sid) => ({ id: sid, label: spaceLabel(s, sid), cap: 1 })),
    count,
    then: { k: 'bldThumpApply', each },
    src,
  });
}

/** removeTree:scope. Fails silently when no Tree is in scope (usageProblem blocks such actions beforehand). */
export function removeTreeChoice(s: GameState, who: number, fromSpace: string | undefined, scope: string, src?: string) {
  const cands = treeCandidates(s, fromSpace, scope);
  if (!cands.length) return;
  ask(s, {
    who,
    kind: 'treePick',
    prompt: 'Remove a Tree from which space?',
    options: cands.map((sid) => opt(sid, spaceLabel(s, sid))),
    then: { k: 'bldTreeDo' },
    src,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Sleeping (Night phase helper)
// ---------------------------------------------------------------------------------------------------------

export interface SleepSlot {
  uid: number;
  kind: string;
  ruins: boolean;
  heated: boolean;
  capacity: number; // citizens of any type
  childCapacity: number; // children only (Child Shelter)
  engineerCapacity: number; // T12 engineer slot at a medical building
  prison: boolean; // Prison: Meeples that used it stay there (sleep if heated, sick otherwise)
}

/**
 * Sleeping slots for the Night phase. Heated shelters only, except the Prison which is always listed (its `heated`
 * flag decides sickness). Ruins sleep one only with L06 and heating (ruinsCountAsShelter, heatedRuinsSlots:1).
 * L05 adds +1 per heated shelter. T12 adds an Engineer slot at medical buildings.
 */
export function sleepSlots(s: GameState): SleepSlot[] {
  const out: SleepSlot[] = [];
  for (const b of s.buildings) {
    const d: any = bdef(b.kind);
    if (b.ruins) {
      if (!lawActive(s, 'L06')) continue;
      const heated = spaceHeated(s, b.spaces[0], false); // Ruins have Blue insulation
      if (!heated) continue;
      out.push({ uid: b.uid, kind: b.kind, ruins: true, heated, capacity: 1, childCapacity: 0, engineerCapacity: 0, prison: false });
      continue;
    }
    const heated = buildingHeated(s, b);
    if (b.kind === 'prison') {
      out.push({ uid: b.uid, kind: b.kind, ruins: false, heated, capacity: 2, childCapacity: 0, engineerCapacity: 0, prison: true });
      continue;
    }
    let capacity = d.shelter ?? 0;
    const childCapacity = d.shelterChildren ?? 0;
    let engineerCapacity = techDone(s, 'T12') && (b.kind === 'medicalPost' || b.kind === 'infirmary') ? 1 : 0;
    if (!heated) {
      capacity = 0;
      engineerCapacity = 0;
    }
    if (heated && capacity > 0 && lawActive(s, 'L05')) capacity += 1;
    if (!heated) continue;
    if (capacity || childCapacity || engineerCapacity) {
      out.push({ uid: b.uid, kind: b.kind, ruins: false, heated, capacity, childCapacity, engineerCapacity, prison: false });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Use op
// ---------------------------------------------------------------------------------------------------------

defOp('bldUse', (s, op) => {
  const b = buildingByUid(s, op.uid);
  const who: number = op.who;
  const meepleId: number | null = op.meeple ?? null;
  if (!b || usageProblem(s, b, meepleId, who, !!op.childOk)) {
    log(s, 'use.cancel', 'The building cannot be used now');
    if (op.then) push(s, op.then);
    return;
  }
  const m = meepleId != null ? meepleById(s, meepleId) : undefined;
  const space: string = op.space && b.spaces.includes(op.space) ? op.space : pickSpace(s, b);
  if (m) m.loc = { k: 'space', space };
  const heated: boolean = op.heated ?? spaceHeated(s, space, true);
  const e = effectiveAction(s, b, meepleId)!;
  if (op.then) push(s, op.then);
  runFx(s, [...e.cost, ...e.fx], {
    who,
    src: 'bld:' + b.kind,
    meeple: meepleId ?? undefined,
    space,
    bld: b.uid,
    heated,
  });
});

// ---------------------------------------------------------------------------------------------------------
// Token-facing entry points (used by tokens_build.ts)
// ---------------------------------------------------------------------------------------------------------

/** buildFree:<filter> */
export function queueBuildFree(s: GameState, who: number, filter: string, src?: string) {
  push(s, { k: 'bldBuildKind', c: { who, src: src ?? null, cont: null, free: true, filter, overRuins: false, woodDiscount: 0 } });
}

/** upgradeFree:<small|any>[:ignoreUsed] and upgradeBuilding (paid) */
export function queueUpgrade(s: GameState, who: number, free: boolean, size: 'any' | 'small' | 'huntersHutOrHothouse', ignoreUsed: boolean, src?: string) {
  push(s, { k: 'bldUpgradePick', c: { who, src: src ?? null, cont: null, free, size, ignoreUsed } });
}

/** destroyBuilding:<choose|occupied>[:N] */
export function queueDestroy(s: GameState, who: number, mode: string, count: number, src?: string) {
  push(s, { k: 'bldDestroy', c: { who, src: src ?? null, cont: null }, mode, count });
}

/**
 * gatherAdjacent:N, Gathering Post: one Resource from each adjacent space, N passes. `limit` caps the Resources taken
 * in total (the L01 Child Labour cap, see gatheringPostLimit); undefined = no cap.
 */
export function queueGatherAdjacent(s: GameState, who: number, space: string | undefined, passes: number, src?: string, limit?: number) {
  if (!space) return;
  const adj = adjacentSpaces(s, space);
  const all: string[] = [];
  for (let i = 0; i < Math.max(1, passes); i++) all.push(...adj);
  push(s, { k: 'bldGatherAdj', c: { who, src: src ?? null, cont: null }, spaces: all, ...(limit !== undefined ? { limit } : {}) });
}

/**
 * Law L01 Child Labour (printed on the law card): Child Meeples may "use Gathering Post Buildings (up to 3 Resources)".
 * A plain child Meeple using a Gathering Post takes at most that many Resources in total. Child Workers and Child Engineers
 * act as their adult role (roleOf), so they are not capped. Undefined when no such passive is in play.
 */
export function gatheringPostLimit(s: GameState, meepleId: number | null | undefined): number | undefined {
  const m = meepleId != null ? meepleById(s, meepleId) : undefined;
  if (!m || m.kind !== 'child') return undefined;
  const n = passive(s, 'childMeeplesMayUseGatheringPost');
  return n > 0 ? n : undefined;
}

export { adjacentTiles, treesOnMap };
