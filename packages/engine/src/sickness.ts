// Sickness, death, cure, treat (rulebook p30-31).
import { ask, defOp, lose, log, opt, push, pushSeq } from './core';
import { citizens, sicknessBand } from './data';
import { shuffle } from './rng';
import { CITIZEN_TYPES } from './types';
import type { CitizenType, GameState } from './types';
import { aAn, clamp, typeName } from './util';

const cap1 = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export const MAX_SPENT_PER_TYPE = 5;

export function sickCount(s: GameState, t: CitizenType) {
  return s.sick[t].n;
}
export function healthy(s: GameState, t: CitizenType) {
  return Math.max(0, s.cit[t] - s.sick[t].n);
}

function clampMarkers(s: GameState) {
  for (const t of CITIZEN_TYPES) {
    s.cit[t] = clamp(s.cit[t], 0, 50);
    if (s.sick[t].n > s.cit[t]) s.sick[t].n = s.cit[t];
    if (s.cit[t] === 0) s.sick[t].skull = false;
  }
}

/** A citizen of the type dies. Corpse +1, citizen marker -1, draws a death card (unless noCards). */
export function killCitizen(s: GameState, t: CitizenType, noCards = false, who?: number) {
  if (s.status !== 'playing') return;
  if (s.cit[t] <= 0) return;
  s.corpse += 1;
  s.cit[t] -= 1;
  clampMarkers(s);
  log(s, 'die', `${cap1(aAn(typeName(t)))} ${typeName(t)} citizen died`, { type: t });
  if (s.corpse >= s.corpseMax) {
    lose(s, 'The Corpse marker reached the last space of the Corpse track.');
    return;
  }
  if (!noCards) push(s, { k: 'deathCard', type: t, who: who ?? s.leader });
}

/** +1 sick Citizen of a type. Returns nothing; deaths are resolved immediately via killCitizen. */
export function addSick(s: GameState, t: CitizenType, n = 1, who?: number) {
  for (let i = 0; i < n; i++) {
    if (s.status !== 'playing') return;
    if (s.cit[t] <= 0) return;
    const m = s.sick[t];
    if (m.n < s.cit[t]) {
      m.n++;
      log(s, 'sick', `+1 sick ${typeName(t)}`, { type: t, n: m.n });
    } else {
      flipSick(s, t, who);
    }
  }
}

/** Flip a Sickness marker: Syringe -> Skull (no effect), Skull -> Syringe (one Citizen dies, marker back 1). */
export function flipSick(s: GameState, t: CitizenType, who?: number) {
  const m = s.sick[t];
  if (s.cit[t] <= 0) return;
  if (!m.skull) {
    m.skull = true;
    log(s, 'sick.skull', `${typeName(t)} sickness marker flipped to the Skull side`, { type: t });
  } else {
    m.skull = false;
    log(s, 'sick.syringe', `${typeName(t)} sickness marker flipped back – a citizen dies`, { type: t });
    if (m.n > 0) m.n--;
    killCitizen(s, t, false, who);
  }
}

export function cureOne(s: GameState, t: CitizenType): boolean {
  const m = s.sick[t];
  const floor = m.skull ? 1 : 0; // a Skull marker cannot be cured to 0 – Treat it first
  if (m.n <= floor) return false;
  m.n--;
  log(s, 'cure', `Cured 1 ${typeName(t)}`, { type: t });
  return true;
}
export function canCure(s: GameState, t: CitizenType) {
  return s.sick[t].n > (s.sick[t].skull ? 1 : 0);
}
export function curableTotal(s: GameState): number {
  return CITIZEN_TYPES.reduce((a, t) => a + Math.max(0, s.sick[t].n - (s.sick[t].skull ? 1 : 0)), 0);
}
export function curableOf(s: GameState, t: CitizenType) {
  return Math.max(0, s.sick[t].n - (s.sick[t].skull ? 1 : 0));
}
export function treatOne(s: GameState, t: CitizenType): boolean {
  const m = s.sick[t];
  if (!m.skull) return false;
  m.skull = false;
  log(s, 'treat', `Treated ${typeName(t)} (Skull -> Syringe)`, { type: t });
  return true;
}
export function skullTypes(s: GameState): CitizenType[] {
  return CITIZEN_TYPES.filter((t) => s.sick[t].skull);
}

// ---- Spent tokens ---------------------------------------------------------------------------------------

export function spentCount(s: GameState, t: CitizenType) {
  return s.spent.filter((x) => x.type === t).length;
}
export function addSpent(s: GameState, t: CitizenType, n = 1) {
  for (let i = 0; i < n; i++) {
    if (spentCount(s, t) >= MAX_SPENT_PER_TYPE) return;
    s.spent.push({ id: ++s.nextSpent, type: t, meeple: null });
    log(s, 'spent', `A Spent ${typeName(t)} token was placed in the supply`, { type: t });
  }
}

// ---- death card ----------------------------------------------------------------------------------------

function drawCitizenCard(s: GameState): string | null {
  if (s.decks.citizen.length === 0) {
    if (s.decks.citizenDiscard.length === 0) return null;
    s.decks.citizen = shuffle(s.rng, s.decks.citizenDiscard.splice(0));
  }
  return s.decks.citizen.pop() ?? null;
}

/** Players holding a Citizen card of the type, in seat order starting from `from` (the leader or the death's player). */
function holdersInSeatOrder(s: GameState, t: CitizenType, from: number): number[] {
  const n = s.players.length;
  const start = from >= 0 && from < n ? from : 0;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (s.players[i].hand.some((c) => citizens[c]?.type === t)) out.push(i);
  }
  return out;
}

// Rulebook p30: instead of drawing, ANY player holding a matching Citizen card may discard it. Holders are asked one by one in
// seat order from the leader: the first who discards wins; if every holder passes, the top card of the deck is drawn.
defOp('deathCard', (s, op) => {
  const t: CitizenType = op.type;
  const who: number = op.who ?? s.leader;
  const order = holdersInSeatOrder(s, t, who);
  if (order.length === 0) {
    push(s, { k: 'deathCard2', type: t, who, pick: ['draw'] });
    return;
  }
  push(s, { k: 'deathHold', type: t, who, order });
});

defOp('deathHold', (s, op) => {
  const t: CitizenType = op.type;
  const order: number[] = op.order ?? [];
  if (order.length === 0) {
    push(s, { k: 'deathCard2', type: t, who: op.who, pick: ['draw'] });
    return;
  }
  const h = order[0];
  ask(s, {
    who: h,
    kind: 'choice',
    prompt: `${cap1(aAn(typeName(t)))} ${typeName(t)} died – discard a matching Citizen card instead of drawing one?`,
    options: [
      opt('draw', 'Pass (do not discard)'),
      opt('p:' + h, `${s.players[h].name} discards ${aAn(typeName(t))} ${typeName(t)} Citizen card`),
    ],
    then: { k: 'deathHold2', type: t, who: op.who, order: order.slice(1) },
    meta: { death: true },
  });
});

defOp('deathHold2', (s, op) => {
  const t: CitizenType = op.type;
  const pick: string = op.pick?.[0] ?? 'draw';
  if (pick === 'draw') {
    push(s, { k: 'deathHold', type: t, who: op.who, order: op.order ?? [] });
    return;
  }
  push(s, { k: 'deathCard2', type: t, who: op.who, pick: [pick] });
});

defOp('deathCard2', (s, op) => {
  const t: CitizenType = op.type;
  const pick: string = op.pick?.[0] ?? 'draw';
  if (pick === 'draw') {
    const id = drawCitizenCard(s);
    if (!id) return;
    s.decks.citizenDiscard.push(id);
    log(s, 'death.card', `Death effect of ${citizens[id].name} (${typeName(t)})`, { card: id, type: t });
    push(s, { k: 'fx', list: citizens[id].death[t] ?? [], ctx: { who: op.who ?? s.leader, src: 'death:' + id } });
    return;
  }
  const pi = Number(pick.slice(2));
  const hand = s.players[pi].hand.filter((c) => citizens[c]?.type === t);
  ask(s, {
    who: pi,
    kind: 'card',
    prompt: `Discard ${aAn(typeName(t))} ${typeName(t)} Citizen card for its death effect`,
    options: hand.map((c) => opt(c, citizens[c].name, { hint: citizens[c].death[t]?.join(', ') })),
    then: { k: 'deathCard3', type: t, who: op.who ?? s.leader, player: pi },
  });
});

defOp('deathCard3', (s, op) => {
  const t: CitizenType = op.type;
  const id: string = op.pick[0];
  const p = s.players[op.player];
  const i = p.hand.indexOf(id);
  if (i >= 0) p.hand.splice(i, 1);
  s.decks.citizenDiscard.push(id);
  log(s, 'death.card', `${p.name} discards ${citizens[id].name}: death effect (${typeName(t)})`, { card: id, type: t });
  push(s, { k: 'fx', list: citizens[id].death[t] ?? [], ctx: { who: op.who ?? s.leader, src: 'death:' + id } });
});

// ---- Preparation phase: sickness resolution (p22/p30) --------------------------------------------------

export function checkSicknessLoss(s: GameState) {
  for (const t of CITIZEN_TYPES) {
    if (s.sick[t].n >= 26) {
      lose(s, `Sickness marker (${typeName(t)}) reached space 26 or more.`);
      return true;
    }
  }
  return false;
}

/** Resolve each Sickness marker from the lowest to the highest value. */
defOp('sicknessResolve', (s, op) => {
  if (checkSicknessLoss(s)) return;
  const done: CitizenType[] = op.done ?? [];
  const remaining = CITIZEN_TYPES.filter((t) => !done.includes(t));
  if (remaining.length === 0) return;
  remaining.sort((a, b) => s.sick[a].n - s.sick[b].n);
  const t = remaining[0];
  const band = sicknessBand(s.sick[t].n);
  push(s, { k: 'sicknessResolve', done: [...done, t] });
  if (band.spent > 0 || band.flips > 0) {
    log(s, 'sick.band', `${typeName(t)} sickness band: ${band.spent} spent, ${band.flips} flip(s)`, { type: t, band });
    const ops: any[] = [];
    if (band.spent > 0) ops.push({ k: 'addSpent', type: t, n: band.spent });
    for (let i = 0; i < band.flips; i++) ops.push({ k: 'flipOp', type: t });
    pushSeq(s, ...ops);
  }
});
defOp('addSpent', (s, op) => addSpent(s, op.type, op.n));
defOp('flipOp', (s, op) => flipSick(s, op.type));
