// Night phase (rulebook p28-30, appendix L05A/L06A; docs/ENGINE_SPEC.md §3.3; checklist NIG-01..07).
//
// Order (ops in nightBody):
//   1. ntReturns    Spent tokens that hold Meeples are removed and their Meeples return; every placed Meeple returns to the
//                   supply except Scouts (on an expedition) and Meeples with `stay` (Prison).
//   2. fuelAsk      optional Fuel (generator.ts).
//      ntSteamHub   optional free Steam Hub Coal (Frozen Grove; Scenario Book "at any time during the round"), before sleeping.
//   3. ntSleep      the Leadership holder chooses how many of each Citizen type sleep in warm places (askDistribute).
//                   Shelter seats: general seats (any type), Child-only seats, Engineer-only seats (T12). Ruins count only with L06.
//   4. ntRuns       Event-display Night text that is not `atEnd` (eventNight), now that the sleepers are known.
//   5. ntStanding   every standing Meeple (not sleeping, not a Scout, not an Automaton) adds +1 sick of its type.
//   6. ntRuns       `atEnd` Night text of Event cards, then the covering Law Consequences (L05A, L06A: atEnd first, then the cover
//                   is discarded).
//   7. ntClear and phAdvance (phases.ts). Sickness is NOT resolved here: rulebook p22 "RESOLVING SICKNESS" is a
//      Preparation-phase step (phases.ts 'preparation'), and the Night text (p29-30) has no such step. Resolving in both
//      phases flipped every Sickness marker twice per Round.
//
// Decisions:
// * Scouts are not standing and do not sleep (checklist NIG-05 "not Scouts"), so they take no sickness and are not counted.
// * Prisoners (Meeples with `stay`) sleep when their Prison is heated (2 places), otherwise they count as standing.
// * askDistribute offers one option per Citizen type. Its caps (workers <= general seats, children <= child + general,
//   engineers <= engineer + general) do not guarantee a feasible joint assignment, so ntSleepDo trims the overflow:
//   workers first, then engineers / children above their own seats. The trimmed picks are logged.
// * flags.night = { unsheltered, total, ruinsUsed } is read by the Night and Dusk card conditions (fx/core.ts, fx/custom.ts).
import { ask, askDistribute, defOp, log, opt, push } from './core';
import type { DistOption } from './core';
import { eventTimingFx } from './fx/custom';
import { runFx } from './fx/core';
import type { Ctx } from './fx/core';
import { sleepSlots } from './buildings';
import { coverRuns, hasPassive } from './laws';
import { addSick } from './sickness';
import { steamHubFreeCandidates } from './steamHub';
import type { GameState, Meeple, Op } from './types';
import { citizenTypeOf, meepleById, sum, toSupply } from './util';

/** A queued run of an effect list. `uid` (an Event display card) makes the run skip if that card has left the display. */
export interface RunItem {
  uid?: number;
  list: any[];
  ctx: Ctx;
}

export const isAtEnd = (x: any): boolean => !!x && typeof x === 'object' && x.atEnd === true;

/** Splits an effect list into the ordinary items and the items marked `atEnd` (returned without the marker). */
export function splitAtEnd(list: any[] | undefined): { now: any[]; end: any[] } {
  const now: any[] = [];
  const end: any[] = [];
  for (const x of list ?? []) {
    if (isAtEnd(x)) {
      const rest = { ...x };
      delete rest.atEnd;
      end.push(rest);
    } else now.push(x);
  }
  return { now, end };
}

/** Event-display effects for a timing ('dusk' | 'night'). part 'now' = ordinary items, 'end' = the `atEnd` items. */
export function eventRunItems(s: GameState, timing: 'dusk' | 'night', part: 'now' | 'end'): RunItem[] {
  const out: RunItem[] = [];
  for (const ev of s.events.slice()) {
    const split = splitAtEnd(eventTimingFx(ev.card, timing));
    const list = part === 'now' ? split.now : split.end;
    if (list.length) out.push({ uid: ev.uid, list, ctx: { who: s.leader, src: 'card:' + ev.card, card: ev.card, evUid: ev.uid } });
  }
  return out;
}

/** Covering Law Consequences with Night text: their atEnd items run first, then the rest (the cover is discarded last). */
export function coverRunItems(s: GameState): RunItem[] {
  return coverRuns(s, 'night').map((r) => {
    const split = splitAtEnd(r.list);
    return { list: [...split.end, ...split.now], ctx: { who: s.leader, src: r.src, card: r.card } };
  });
}

/** Queue runs so that they execute in the given order, each before anything pushed earlier. */
export function runItems(s: GameState, items: RunItem[]) {
  if (items.length) push(s, { k: 'ntRuns', items });
}

/** Citizen Meeples that are not Scouts and not Prisoners (Automatons are excluded by citizenTypeOf). */
export function citizenMeeples(s: GameState): Meeple[] {
  return s.meeples.filter((m) => citizenTypeOf(m.kind) !== null && m.loc.k !== 'scout' && !m.stay);
}

/** Ops of the whole Night, ending with phAdvance. */
export function nightBody(s: GameState): Op[] {
  return [
    { k: 'ntReturns' },
    { k: 'fuelAsk', who: s.leader },
    { k: 'ntSteamHub' },
    { k: 'ntSleep' },
    { k: 'ntRuns', items: eventRunItems(s, 'night', 'now') },
    { k: 'ntStanding' },
    { k: 'ntRuns', items: [...eventRunItems(s, 'night', 'end'), ...coverRunItems(s)] },
    { k: 'ntClear' },
    { k: 'phAdvance' },
  ];
}

defOp('ntRuns', (s, op) => {
  const items: RunItem[] = op.items ?? [];
  if (items.length === 0) return;
  const [it, ...rest] = items;
  if (rest.length) push(s, { k: 'ntRuns', items: rest });
  if (it.uid !== undefined && !s.events.some((e) => e.uid === it.uid)) return;
  runFx(s, it.list, it.ctx);
});

defOp('ntReturns', (s) => {
  let back = 0;
  s.spent = s.spent.filter((t) => {
    if (t.meeple == null) return true;
    const m = meepleById(s, t.meeple);
    if (m && !m.stay) {
      toSupply(s, m);
      back++;
    }
    return false;
  });
  for (const m of s.meeples) {
    if (m.stay || m.loc.k === 'scout' || m.loc.k === 'supply') continue;
    toSupply(s, m);
    back++;
  }
  for (const ev of s.events) ev.meeples = ev.meeples.filter((id) => meepleById(s, id)?.loc.k === 'card');
  log(s, 'night.return', `${back} Meeple(s) returned to the supply`, { n: back });
});

export { steamHubFreeCandidates } from './steamHub';

/**
 * The free Steam Hub step as an op list for a phase body (empty when no Steam Hub may take Coal now). Scenario Book, Steam Hub
 * passive: "At any time during the round, if the Heat marker level is higher than the Red Insulation level you may place 1 Coal".
 * Heat stays high from the Action phase until the Generator phase resets it, so the step is offered in the Dusk and Hunger phases
 * (phases.ts phaseBody prepends it there) and in the Night (nightBody). Heat is only reset by the Generator phase, so Dawn,
 * Morning, Weather and Preparation cannot see Heat above the red level and need no step.
 */
export function steamHubStepOps(s: GameState): Op[] {
  return steamHubFreeCandidates(s).length > 0 ? [{ k: 'ntSteamHub' }] : [];
}

/**
 * Optional free Steam Hub step, after the Fuel step and before the sleeping is decided (Night), so that a Coal placed
 * here heats its tile and adjacent tiles for the sleep. The step is asked again after each Coal until the player picks 'done'.
 * The Generator phase has no such step: its Stress step returns every Steam Hub Coal to the bank (Scenario Book, "Return the Coal
 * to the bank at the end of the Generator Phase") and resets Heat to 1, so the red-level condition cannot hold after it.
 */
defOp('ntSteamHub', (s) => {
  const cands = steamHubFreeCandidates(s);
  if (cands.length === 0) return;
  ask(s, {
    who: s.leader,
    kind: 'steamHub',
    prompt: 'Steam Hub (Frozen Grove): place 1 Coal from the supply on a Steam Hub?',
    src: 'steamHub',
    options: [...cands.map((b) => opt(`b:${b.uid}`, `Steam Hub #${b.uid}`)), opt('done', 'Place no Coal')],
    then: { k: 'ntSteamHubPick' },
  });
});

defOp('ntSteamHubPick', (s, op) => {
  const id: string | undefined = op.pick?.[0];
  if (!id || id === 'done') return;
  const uid = Number(id.slice(2));
  // LIFO: the placement (actions.ts steamHubPlace re-checks the rule and spends the Coal) runs first, then the step is asked again
  push(s, { k: 'ntSteamHub' });
  push(s, { k: 'steamHubPlace', who: s.leader, uid });
});

defOp('ntSleep', (s) => {
  const slots = sleepSlots(s);
  const general = slots.filter((x) => !x.prison);
  const G = sum(general.map((x) => x.capacity));
  const C = sum(general.map((x) => x.childCapacity));
  const E = sum(general.map((x) => x.engineerCapacity));
  const ruinsCap = sum(general.filter((x) => x.ruins).map((x) => x.capacity));
  const prisonCap = sum(slots.filter((x) => x.prison && x.heated).map((x) => x.capacity));

  const prisoners = s.meeples.filter((m) => m.stay && m.loc.k !== 'scout');
  for (const m of prisoners.slice(0, prisonCap)) m.lying = true;

  const pool = citizenMeeples(s);
  const count = Math.min(pool.length, G + C + E);
  const kids = pool.filter((m) => citizenTypeOf(m.kind) === 'child').length;
  const engs = pool.filter((m) => citizenTypeOf(m.kind) === 'engineer').length;
  const works = pool.filter((m) => citizenTypeOf(m.kind) === 'worker').length;
  const options: DistOption[] = [];
  const capChild = Math.min(kids, C + G);
  const capEng = Math.min(engs, E + G);
  const capWork = Math.min(works, G);
  if (capChild > 0) options.push({ id: 'child', label: 'Children', cap: capChild, hint: `${kids} Child Meeple(s)` });
  if (capEng > 0) options.push({ id: 'engineer', label: 'Engineers', cap: capEng, hint: `${engs} Engineer Meeple(s)` });
  if (capWork > 0) options.push({ id: 'worker', label: 'Workers', cap: capWork, hint: `${works} Worker Meeple(s)` });

  askDistribute(s, {
    who: s.leader,
    kind: 'sleep',
    prompt: `Who sleeps in a warm place? (${G + C + E} places in heated shelters)`,
    src: 'night',
    options,
    count,
    then: { k: 'ntSleepDo', G, C, E, ruinsCap },
  });
});

defOp('ntSleepDo', (s, op) => {
  const pick: string[] = op.pick ?? [];
  const G: number = op.G;
  const C: number = op.C;
  const E: number = op.E;
  let c = pick.filter((x) => x === 'child').length;
  let e = pick.filter((x) => x === 'engineer').length;
  let w = pick.filter((x) => x === 'worker').length;
  // M022 (event passive nightChildrenFirst): Children take every warm place they can before any other Citizen sleeps
  if (hasPassive(s, 'nightChildrenFirst')) {
    const kids = citizenMeeples(s).filter((m) => citizenTypeOf(m.kind) === 'child').length;
    const forced = Math.min(kids, C + G);
    if (forced !== c) log(s, 'night.children', `Children sleep first: ${forced} Child(ren) in warm places`, { forced });
    c = forced;
  }
  const generalUsed = () => w + Math.max(0, c - C) + Math.max(0, e - E);
  let trimmed = 0;
  while (generalUsed() > G) {
    if (w > 0) w--;
    else if (e > E) e--;
    else c--;
    trimmed++;
  }
  if (trimmed) log(s, 'night.trim', `Sleeping arrangement trimmed by ${trimmed} to fit the shelters`, { trimmed });

  const pool = citizenMeeples(s);
  const ofType = (t: string) => pool.filter((m) => citizenTypeOf(m.kind) === t).sort((a, b) => a.id - b.id);
  const sleepers = [...ofType('child').slice(0, c), ...ofType('engineer').slice(0, e), ...ofType('worker').slice(0, w)];
  for (const m of sleepers) m.lying = true;

  const prisoners = s.meeples.filter((m) => m.stay && m.loc.k !== 'scout');
  const asleepPrisoners = prisoners.filter((m) => m.lying).length;
  const total = pool.length + prisoners.length;
  const asleep = sleepers.length + asleepPrisoners;
  const ruinsUsed = op.ruinsCap > 0 && generalUsed() > G - op.ruinsCap;
  s.flags.night = { unsheltered: total - asleep, total, ruinsUsed };
  log(s, 'night.sleep', `${asleep} of ${total} Meeple(s) sleep in a warm place`, { asleep, total, ruinsUsed });
});

defOp('ntStanding', (s) => {
  const standing = s.meeples.filter((m) => !m.lying && m.loc.k !== 'scout' && citizenTypeOf(m.kind) !== null);
  if (standing.length) log(s, 'night.cold', `${standing.length} Meeple(s) spend the Night outside`, { n: standing.length });
  for (const m of standing) addSick(s, citizenTypeOf(m.kind)!, 1, s.leader);
});

defOp('ntClear', (s) => {
  for (const m of s.meeples) delete m.lying;
});
