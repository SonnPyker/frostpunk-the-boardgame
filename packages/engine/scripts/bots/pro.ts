// Scripted "pro" bot for scripts/sim.ts (--pro). It only answers pending decisions through the public engine API:
// it reads the state, scores every enabled option and returns the best legal answer (repeats and caps respected).
// Scoring is per decision kind; unknown kinds fall back to hint/label text scoring. It never edits the engine.
import type { GameState, Pending, PendingOption } from '../../src/types';
import { sleepSlots } from '../../src/buildings';
import { legalPick } from '../../src/autoplay';
import { spaceHeated } from '../../src/map';
import { randInt } from '../../src/rng';

type Rng = Parameters<typeof randInt>[0];

/** Snapshot of the numbers the scorers look at, read once per decision. */
export interface ProCtx {
  pop: number;
  food: number;
  coal: number;
  wood: number;
  heat: number;
  cold: number;
  stress: number;
  hope: number;
  disc: number;
  homeless: number; // citizens without a heated sleeping slot
  sick: number;
  round: number;
  heatTarget: number; // Heat level that keeps the yellow-insulated shelters warm (heat must exceed the yellow indicator)
  huts: number; // Hunter's Huts standing
  foodNeed: number; // food the next round type can need at most (the largest citizen group)
}

export function proCtx(s: GameState): ProCtx {
  const pop = s.cit.worker + s.cit.engineer + s.cit.child;
  const cap = sleepSlots(s).reduce((a, x) => a + x.capacity + x.childCapacity + x.engineerCapacity, 0);
  const sick = (s.sick.worker?.n ?? 0) + (s.sick.engineer?.n ?? 0) + (s.sick.child?.n ?? 0);
  return {
    pop,
    food: s.food,
    coal: s.res.coal,
    wood: s.res.wood,
    heat: s.gen.heat,
    cold: s.gen.cold,
    stress: s.gen.stress,
    hope: s.hope.filter((t) => t.a).length,
    disc: s.disc.filter((t) => t.a).length,
    homeless: Math.max(0, s.meeples.length - cap), // only the meeples on the board sleep (the rest of the population is off the board)
    sick,
    round: s.round,
    heatTarget: (s.gen.ind.yellow ?? 3) + 1,
    huts: s.buildings.filter((b) => b.kind === 'huntersHut' && !b.ruins).length,
    foodNeed: Math.max(s.cit.worker, s.cit.engineer, s.cit.child),
  };
}

/** Hint/label text scoring for cards and choices: gains are positive, losses (hope, discontent, deaths, dusk cards) negative. */
export function textScore(t: string): number {
  let v = 0;
  const num = (re: RegExp) => {
    const m = re.exec(t);
    return m ? Number(m[1] ?? m[2] ?? 1) || 1 : 0;
  };
  v += 3 * num(/hope\s*\+\s*(\d+)|hope\+(\d+)/i);
  v -= 4 * num(/hope\s*[−\-]\s*(\d+)|hope-(\d+)/i);
  v += 2 * num(/discontent\s*[−\-]\s*(\d+)|disc-(\d+)/i);
  v -= 3 * num(/discontent\s*\+\s*(\d+)|disc\+(\d+)/i);
  v -= 1 * num(/hunger\s*\+\s*(\d+)|hunger\+(\d+)/i);
  if (/add dusk card/i.test(t)) v -= 1.5;
  if (/worker token|spent worker|spent engineer|spent child/i.test(t)) v -= 3;
  v += 0.8 * num(/gain\s+(\d+)\s+food|food\s*\+\s*(\d+)/i);
  v += 0.6 * num(/gain\s+(\d+)\s+(?:coal|wood)/i);
  if (/cure/i.test(t)) v += 2;
  else if (/treat/i.test(t)) v += 1;
  v -= 0.8 * num(/spend\s+(\d+)\s+food/i);
  if (/build a building for free/i.test(t)) v += 2;
  if (/activate/i.test(t)) v += 1;
  if (/exhaust/i.test(t)) v -= 0.3;
  if (/draw a random/i.test(t)) v += 0;
  return v;
}

/** Cheap law priorities: Hope first, then Discontent relief, then avoid the discontent and hunger laws. */
const LAW_SCORE: Record<string, number> = {
  L12: 9,
  L02: 8,
  L04: 8,
  L11: 7,
  L15: 7,
  L08: 6,
  L10: 6,
  L09: 6,
  L03: 6,
  L06: 6,
  L13: 5,
  L07: 4,
  L05: 2,
  L14: 2,
  L01: 0,
  L16: 0,
};

/** Technology priorities (roughly: heat and food first, then wood and coal throughput). */
const TECH_SCORE: Record<string, number> = {
  T06: 8, // Generator Safety System
  T14: 7, // Tracking Techniques (food)
  T02: 7, // Hunting Tactics (food)
  T09: 6, // Steam Hub
  T12: 6, // Night Care
  T11: 6, // Heating Lamps
  T10: 6, // Wood Processing
  T13: 6, // Equipment Upgrade
  T03: 5, // Charcoal Kiln Upgrade
  T07: 5, // Carrier Sledge
  T08: 5, // Construction Planning
  T04: 4, // Steampowered Chainsaw
  T05: 4, // Medical Education
  T01: 3,
  T15: 3,
  T16: 3,
  T17: 3,
};

function actionScore(s: GameState, c: ProCtx, id: string): number {
  if (id === 'act:pass') return 0;
  if (id === 'act:steamHub') return 9; // free, no turn cost
  if (id === 'act:fuel') return c.coal >= 1 && c.heat < c.heatTarget ? 10 : 2;
  if (id === 'act:construct') {
    if (c.huts < 2 && c.wood >= 1) return 11; // two Hunter's Huts first: food is the bottleneck
    if (c.homeless > 0 && c.wood >= 2) return 11; // then shelter for the meeples on the board (beats gathering)
    if (c.huts < 5 && c.wood >= 1) return 7;
    return c.homeless > 0 && c.wood >= 2 ? 9 : c.wood >= 2 ? 5 : 3;
  }
  // with no Hunter's Hut the use action can only pick the Cookhouse (3 Food), so it waits
  if (id === 'act:use') return c.huts > 0 ? (c.food < c.foodNeed ? 10 : 6) : 2;
  if (id === 'act:gather') return c.coal < 4 ? 10 : c.wood < 4 ? 9 : 5; // coal is the binding resource for heat
  if (id === 'act:removeSnow') return 6;
  if (id === 'act:deploy') return 5;
  if (id.startsWith('act:special:stock')) return c.food >= 3 || c.coal >= 2 ? 6 : 1;
  if (id.startsWith('act:special:')) return 5;
  return 2;
}

function fuelScore(c: ProCtx, id: string): number {
  const n = Number(id);
  const after = c.heat + n;
  // aim at the heat target; keep a small coal reserve once the Generator is warm
  let v = 10 - Math.abs(after - c.heatTarget);
  if (c.coal - n < 2 && after >= c.heatTarget) v -= 2;
  return v;
}

function buildKindScore(c: ProCtx, id: string): number {
  switch (id) {
    // shelters by insulation: a house (red) is heated at heat 2, a bunkhouse (orange) at 3, a tent (yellow) at 4,
    // so the coal-poor early game prefers the house when the wood allows it
    case 'house':
      return c.homeless > 0 && c.wood >= 4 ? 10 : c.homeless > 0 ? 6 : 2;
    case 'bunkhouse':
      return c.homeless > 0 ? 8 : 2;
    case 'tent':
      return c.homeless > 0 ? 9 : 2;
    case 'huntersHut':
      // 5 is the building's limit; each hut feeds 4 per use, and food is the bottleneck in the early rounds
      if (c.huts >= 5) return 0;
      if (c.huts < 2) return 11;
      return c.homeless > 0 ? 5 : 8;
    case 'gatheringPost':
      return 7;
    case 'medicalPost':
      return c.sick > 0 ? 8 : 3;
    case 'charcoalKiln':
      return 4;
    case 'cookhouse':
      return 4;
    case 'workshop':
      return 3;
    default:
      return 2;
  }
}

function buildSpaceScore(id: string): number {
  if (/^GEN:/.test(id)) return 9; // heated tiles first
  if (/^N\d/.test(id)) return 6;
  return 2;
}

/**
 * Hope and Discontent tokens: a Decrease Hope must exhaust an active token before it removes one (removing the
 * last token loses the game), a Decrease Discontent removes tokens, an Increase Discontent prefers activating a
 * token already on the track over drawing a new one (a sixth token loses the game).
 */
function tokenChoiceScore(p: Pending, o: PendingOption): number {
  const prompt = p.prompt;
  const id = o.id;
  if (id.startsWith('exh:')) return /Decrease Hope/i.test(prompt) ? 3 : /Decrease Discontent/i.test(prompt) ? 1 : 0;
  if (id.startsWith('rem:')) return /Decrease Discontent/i.test(prompt) ? 4 : /Decrease Hope/i.test(prompt) ? -4 : 0;
  if (id.startsWith('act:')) return /Increase Discontent/i.test(prompt) ? 2 : 0;
  if (id === 'draw') return /Increase Discontent/i.test(prompt) ? -1 : 0;
  return 0;
}

/** Use-building option by label (the engine labels them with the building name). */
function useScore(c: ProCtx, o: PendingOption): number {
  const t = `${o.label ?? ''} ${o.hint ?? ''}`;
  if (/hunter/i.test(t)) return c.food < c.foodNeed ? 10 : 4;
  // the cookhouse costs 3 Food for Hope: only when the population's next round is covered
  if (/cookhouse/i.test(t)) return c.food >= c.foodNeed + 3 ? 7 : 1;
  if (/medical|infirmary/i.test(t)) return c.sick > 0 ? 8 : 2;
  if (/gathering/i.test(t)) return 7;
  if (/kiln/i.test(t)) return c.wood >= 1 ? 5 : 1;
  if (/sawmill|wall drill/i.test(t)) return c.wood < 6 ? 6 : 3;
  return 3;
}

/** Per-resource gain score for gather-style picks (`space|resource` or a bare resource). */
function resScore(c: ProCtx, k: string): number {
  if (k === 'coal') return c.coal < 6 ? 9 : 3;
  if (k === 'wood') return c.wood < 6 ? 8 : 2;
  if (k === 'core') return 1;
  if (k === 'food') return 5;
  return 0;
}

function sickOf(s: GameState, type: string): number {
  return (s.sick as any)[type]?.n ?? 0;
}

export function proScore(s: GameState, c: ProCtx, p: Pending, o: PendingOption): number {
  const id = o.id;
  const text = `${o.label ?? ''} ${o.hint ?? ''}`;
  switch (p.kind) {
    case 'action':
      return actionScore(s, c, id);
    case 'fuel':
      return fuelScore(c, id);
    case 'construct':
      if (id === 'build') return c.homeless > 0 || c.wood >= 2 ? 9 : 4;
      if (id === 'dismantle') return -5;
      return 3; // End Construction
    case 'buildPick':
      return buildKindScore(c, id);
    case 'buildSpace':
      return buildSpaceScore(id);
    case 'meeple': {
      if (/worker/i.test(text)) return 4;
      if (/engineer/i.test(text)) return 3;
      if (/child/i.test(text)) return 1;
      return 2;
    }
    case 'building':
      return useScore(c, o);
    case 'space': {
      // gathering in an unheated space makes the meeple sick ("Cold action"): heated spaces get a large bonus
      const m = /(\d+)\s+Resources?/i.exec(o.hint ?? '');
      return (m ? Number(m[1]) : 0) + (spaceHeated(s, id, true) ? 6 : 0);
    }
    case 'gatherRes': {
      const [sid, k = ''] = id.split('|');
      return resScore(c, k) + (sid && spaceHeated(s, sid, true) ? 3 : 0);
    }
    case 'mapres':
    case 'gatherPick': {
      const [sid, k = id] = id.includes('|') ? id.split('|') : [null, id];
      return resScore(c, k) + (sid && spaceHeated(s, sid, true) ? 3 : 0);
    }
    case 'stockpile':
      if (id === 'ration') return c.food >= 3 ? 5 : 0;
      if (id === 'coal') return c.coal >= 2 ? 4 : 0;
      return 0;
    case 'pay':
      // Steel may replace Wood: spend Steel first when it is there, Wood otherwise
      return id === 'steel' ? 6 : id === 'wood' ? 5 : 0;
    case 'sleep':
      return id === 'worker' ? 4 : id === 'child' ? 3 : id === 'engineer' ? 3 : 1;
    case 'advisor': {
      // every Advisor exhausts one Hope token as its cost: only worth it with spare Hope and a clear need
      if (id === 'none') return c.hope <= 3 ? 6 : 2;
      if (c.hope < 4) return 0;
      if (/health/i.test(text)) return c.sick >= 2 ? 6 : 1;
      if (/generator/i.test(text)) return c.stress >= 6 ? 5 : 1;
      return 1;
    }
    case 'law':
      return LAW_SCORE[id] ?? 3;
    case 'tech':
      return TECH_SCORE[id] ?? 3;
    case 'type':
      // sickness: pick the type with the fewest sick citizens (sick hits again or costs most when it piles up)
      return -sickOf(s, id);
    case 'distribute':
      // cure/treat: the type with the most sick citizens first (caps keep the count honest)
      return sickOf(s, id) + (id === 'engineer' ? 0.5 : 0);
    case 'removeSnow':
      return id === 'near2' ? 5 : 3;
    case 'tileKind':
      return id === 'near' ? 4 : 3;
    case 'dismantle':
    case 'destroy':
      return -5;
    case 'steamHub':
      return 0;
    case 'choice':
      return tokenChoiceScore(p, o) + textScore(text);
    default:
      return textScore(text);
  }
}

/** Picks answers for one pending decision with the same repeat/cap rules as the random bot. */
export function pickBy(st: Rng, p: Pending, score: (o: PendingOption) => number): string[] | null {
  const enabled = p.options.filter((o) => !o.disabled);
  if (enabled.length === 0) return p.min > 0 ? null : [];
  const allowRepeat = !!p.meta?.allowRepeat;
  const caps: Record<string, number> | undefined = p.meta?.caps;
  const scored = enabled.map((o) => ({ id: o.id, score: score(o), tie: randInt(st, 1000) }));
  const rank = (a: { score: number; tie: number }, b: { score: number; tie: number }) => b.score - a.score || a.tie - b.tie;
  if (allowRepeat) {
    const used: Record<string, number> = {};
    const pick: string[] = [];
    for (let i = 0; i < p.max; i++) {
      const cands = scored.filter((o) => (used[o.id] ?? 0) < (caps?.[o.id] ?? 1)).sort(rank);
      if (cands.length === 0) break;
      // optional extra picks with no value are skipped once the minimum is met
      if (pick.length >= p.min && cands[0].score <= 0) break;
      used[cands[0].id] = (used[cands[0].id] ?? 0) + 1;
      pick.push(cands[0].id);
    }
    return pick.length >= p.min ? pick : null;
  }
  const count = Math.min(p.max, enabled.length);
  if (count < p.min) return null;
  const sorted = scored.sort(rank);
  if (p.min === p.max || p.max === 1) return sorted.slice(0, count).map((o) => o.id);
  const positive = sorted.filter((o) => o.score > 0).length;
  const n = Math.max(p.min, Math.min(count, positive));
  return sorted.slice(0, n).map((o) => o.id);
}

/** The pro bot's answer for one pending decision (null only when no legal pick exists). */
export function proPick(st: Rng, s: GameState, p: Pending): string[] | null {
  const c = proCtx(s);
  const picked = pickBy(st, p, (o) => {
    try {
      return proScore(s, c, p, o);
    } catch {
      return 0;
    }
  });
  return picked ?? legalPick(st, p);
}
