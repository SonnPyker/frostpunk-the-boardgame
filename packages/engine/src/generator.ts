// The Generator: fuel, cold sickness, stress, breakdown (rulebook p20-21).
import { ask, defOp, lose, log, opt, push, pushSeq } from './core';
import { generatorData, heatTrack } from './data';
import { chance } from './rng';
import { addSick } from './sickness';
import type { CitizenType, GameState } from './types';
import { buildingsOfKind, clamp, gainRes, techDone } from './util';

export const TRACK_LEN = 16;
export const STRESS_SLOTS = 10;
const P_DRAWER: number = generatorData.stress.digitalSimulation.pDrawer;
const P_DRAWER_UPG: number = generatorData.stress.digitalSimulation.pDrawerUpgraded;
const P_DEFERRED: number = generatorData.stress.digitalSimulation.pDeferred;

export function totalStress(s: GameState) {
  return s.gen.stress + s.gen.overflow;
}

export function addStress(s: GameState, n: number) {
  if (n <= 0) return;
  const total = totalStress(s) + n;
  s.gen.stress = Math.min(STRESS_SLOTS, total);
  s.gen.overflow = Math.max(0, total - STRESS_SLOTS);
  log(s, 'stress', `+${n} Stress cube(s)`, { n, total });
}
export function removeStress(s: GameState, n: number): number {
  let removed = 0;
  while (n-- > 0 && totalStress(s) > 0) {
    if (s.gen.overflow > 0) s.gen.overflow--;
    else s.gen.stress--;
    removed++;
  }
  if (removed) log(s, 'stress.remove', `-${removed} Stress cube(s)`, { n: removed });
  return removed;
}

/** how much Coal can still be put into the Generator right now */
export function fuelRoom(s: GameState) {
  return Math.max(0, Math.min(s.res.coal, s.gen.cold - s.gen.heat));
}

export function doFuel(s: GameState, n: number) {
  const k = Math.min(n, fuelRoom(s));
  if (k <= 0) return 0;
  s.res.coal -= k;
  s.gen.heat += k;
  s.gen.fuelUsedThisPhase += k;
  log(s, 'fuel', `Fuelled the Generator with ${k} Coal (Heat ${s.gen.heat})`, { n: k, heat: s.gen.heat });
  return k;
}

/** Ask how much Coal to put into the Generator. `then` is pushed afterwards. */
defOp('fuelAsk', (s, op) => {
  const room = fuelRoom(s);
  if (room <= 0) return;
  const options = [opt('0', 'Do not fuel')];
  for (let i = 1; i <= room; i++) options.push(opt(String(i), `Spend ${i} Coal (Heat ${s.gen.heat} → ${s.gen.heat + i})`));
  ask(s, {
    who: op.who,
    kind: 'fuel',
    prompt: 'Fuel the Generator?',
    options,
    then: { k: 'fuelDo' },
    forced: true,
    back: true,
    meta: { heat: s.gen.heat, cold: s.gen.cold, coal: s.res.coal },
  });
});
defOp('fuelDo', (s, op) => {
  const n = Number(op.pick?.[0] ?? 0);
  if (n > 0) doFuel(s, n);
});

// ---- Generator phase steps ------------------------------------------------------------------------------

export function iconTypesBetween(s: GameState): CitizenType[] {
  const out: CitizenType[] = [];
  for (let p = s.gen.heat + 1; p < s.gen.cold; p++) {
    const icon = heatTrack[p - 1]?.icon;
    if (icon) out.push(icon as CitizenType);
  }
  return out;
}

defOp('genCold', (s, op) => {
  const icons = iconTypesBetween(s);
  if (icons.length) log(s, 'gen.cold', `The cold hits: ${icons.join(', ')}`, { icons });
  for (const t of icons) addSick(s, t, 1, s.leader);
});

export function cubesForHeat(heat: number) {
  return heatTrack[clamp(heat, 1, TRACK_LEN) - 1].cubes;
}

defOp('genStress', (s) => {
  // Cubes that fell out while the drawer was closed last round are placed on the Stress track now (rulebook p21)
  const carried = s.gen.carry || 0;
  if (carried > 0) {
    s.gen.carry = 0;
    addStress(s, carried);
  }
  const cubes = cubesForHeat(s.gen.heat);
  const p = s.gen.upgraded ? P_DRAWER_UPG : P_DRAWER;
  let fell = 0;
  for (let i = 0; i < cubes; i++) if (chance(s.rng, p)) fell++;
  // Closing the drawer again: each cube in it may fall out and wait for the next round (rulebook p21, pDeferred)
  let deferred = 0;
  if (P_DEFERRED > 0) for (let i = 0; i < fell; i++) if (chance(s.rng, P_DEFERRED)) deferred++;
  s.gen.carry = deferred;
  log(s, 'gen.drop', `${cubes} Coal cube(s) dropped into the Generator, ${fell} fell into the drawer`, { cubes, fell, deferred });
  addStress(s, fell - deferred);
  // T06 Generator Safety System
  if (techDone(s, 'T06') && s.gen.overflow > 0 && s.gen.overflow <= 2) {
    log(s, 'gen.safety', 'Generator Safety System removes the overflow cubes', { n: s.gen.overflow });
    s.gen.overflow = 0;
  }
  if (s.gen.overflow > 0) breakdown(s);
  s.gen.heat = 1;
  s.gen.fuelUsedThisPhase = 0;
  // Steam Hub coal returns to the bank (T09 / Frozen Grove Steam Hub passive: "place that Coal in the bank in the Generator Phase")
  for (const b of buildingsOfKind(s, 'steamHub')) {
    if (b.steamHubCoal) gainRes(s, 'coal', 1);
    b.steamHubCoal = false;
  }
});

export function breakdown(s: GameState) {
  if (s.gen.broken) {
    lose(s, 'The Generator broke down for the second time and exploded.');
    return;
  }
  s.gen.broken = true;
  s.gen.cold = Math.min(TRACK_LEN, s.gen.cold + 1);
  for (const k of ['red', 'orange', 'yellow'] as const) {
    const v = s.gen.ind[k];
    if (v != null) s.gen.ind[k] = Math.min(TRACK_LEN, v + 1);
  }
  s.gen.stress = 0;
  s.gen.overflow = 0;
  log(s, 'gen.breakdown', 'The Generator broke down! Cold +1, all Heat Range indicators +1, Stress cubes removed.', {});
}

/** Weather section A / Storm card heat range changes. Values are relative advances; null indicators stay removed. */
export function advanceIndicators(s: GameState, adv: { cold?: number; yellow?: number; orange?: number; red?: number }) {
  if (adv.cold) s.gen.cold = Math.min(TRACK_LEN, s.gen.cold + adv.cold);
  for (const k of ['red', 'orange', 'yellow'] as const) {
    const a = adv[k];
    if (a && s.gen.ind[k] != null) s.gen.ind[k] = Math.min(TRACK_LEN, (s.gen.ind[k] as number) + a);
  }
  if (s.gen.heat > s.gen.cold) s.gen.heat = s.gen.cold;
  log(s, 'gen.range', 'Heat range advanced', adv);
}
export function removeIndicator(s: GameState, k: 'red' | 'orange' | 'yellow') {
  s.gen.ind[k] = null;
  log(s, 'gen.range', `The ${k} Heat Range indicator was removed`, { k });
}

/** Whole Generator phase as op sequence: optional fuel -> cold sickness -> stress check */
defOp('generatorPhase', (s) => {
  pushSeq(s, { k: 'fuelAsk', who: s.leader }, { k: 'genCold' }, { k: 'genStress' });
});
