// Engine invariants for the simulator and the tests (docs/KNOWN_ISSUES.md lists what the sim found).
//
// checkInvariants(s) returns a list of violated invariant messages (empty = all hold). It only reads the state, so it can run
// after every decision. Each message starts with a short invariant id in brackets, e.g. "[res.nonneg] wood = -1", so the sim
// can group failures by class.
//
// Rules of thumb for what is checked:
// * Hard bounds from the components (LIMITS in util.ts, HOPE_SLOTS / DISC_SLOTS in hope.ts).
// * Consistency of the board: spaces, buildings and Meeples point at each other; no space holds more than perSpace Meeples.
// * Citizen cards are unique across hands, decks, discards and the played slots.
// * Control: a playing game always has a pending decision or an op left on the stack; a finished game has neither.
import { DISC_SLOTS, HOPE_SLOTS } from './hope';
import { LIMITS } from './util';
import { CITIZEN_TYPES } from './types';
import type { GameState } from './types';

export function checkInvariants(s: GameState): string[] {
  const out: string[] = [];
  const bad = (id: string, msg: string) => out.push(`[${id}] ${msg}`);

  // resources
  for (const k of ['wood', 'coal', 'core', 'steel'] as const) {
    const v = s.res[k];
    if (!(v >= 0)) bad('res.nonneg', `${k} = ${v}`);
  }
  if (s.res.steel > LIMITS.steel) bad('res.steelLimit', `steel ${s.res.steel} > ${LIMITS.steel}`);
  if (!(s.food >= 0 && s.food <= LIMITS.food)) bad('res.food', `food ${s.food} outside 0..${LIMITS.food}`);
  if (!(s.hunger >= 0 && s.hunger <= LIMITS.hunger)) bad('res.hunger', `hunger ${s.hunger} outside 0..${LIMITS.hunger}`);

  // population
  for (const t of CITIZEN_TYPES) {
    const n = s.cit[t];
    if (!(n >= 0 && n <= LIMITS.citizens)) bad('pop.range', `${t} ${n} outside 0..${LIMITS.citizens}`);
  }
  const automatons = s.meeples.filter((m) => m.kind === 'automaton').length;
  if (automatons > LIMITS.automatons) bad('pop.automatons', `${automatons} Automatons > ${LIMITS.automatons}`);
  if (s.corpse < 0 || s.corpse > s.corpseMax) bad('pop.corpse', `corpse ${s.corpse} outside 0..${s.corpseMax}`);

  // Hope and Discontent
  if (s.hope.length > HOPE_SLOTS) bad('hope.slots', `${s.hope.length} Hope tokens > ${HOPE_SLOTS}`);
  if (s.disc.length > DISC_SLOTS) bad('disc.slots', `${s.disc.length} Discontent tokens > ${DISC_SLOTS}`);

  // Generator
  if (s.gen.stress < 0) bad('gen.stress', `stress ${s.gen.stress}`);
  if (s.gen.heat < 0) bad('gen.heat', `heat ${s.gen.heat}`);

  // board: meeples, spaces and buildings
  const perSpace = new Map<string, number>();
  for (const m of s.meeples) {
    if (m.loc.k === 'space' && m.loc.space) {
      if (!s.spaces[m.loc.space]) bad('board.meepleSpace', `meeple ${m.id} on unknown space ${m.loc.space}`);
      perSpace.set(m.loc.space, (perSpace.get(m.loc.space) ?? 0) + 1);
    }
  }
  for (const [sid, n] of perSpace) if (n > LIMITS.perSpace) bad('board.perSpace', `${n} Meeples on ${sid} > ${LIMITS.perSpace}`);
  const listed = new Set<number>();
  for (const b of s.buildings) {
    // a building may span several spaces, so the duplicate check is on the building entry itself
    if (listed.has(b.uid)) bad('board.buildingDup', `building ${b.uid} listed twice`);
    listed.add(b.uid);
    for (const sid of b.spaces) {
      const sp = s.spaces[sid];
      if (!sp) {
        bad('board.buildingSpace', `building ${b.uid} on unknown space ${sid}`);
        continue;
      }
      if (sp.building !== b.uid) bad('board.buildingLink', `building ${b.uid} on ${sid} but the space says ${sp.building}`);
    }
  }
  for (const sp of Object.values(s.spaces)) {
    if (sp.building != null && !s.buildings.some((b) => b.uid === sp.building)) bad('board.spaceBuilding', `space ${sp.id} holds unknown building ${sp.building}`);
    for (const k of ['wood', 'coal', 'core'] as const) {
      const v = sp.res[k] ?? 0;
      if (v < 0) bad('board.spaceRes', `space ${sp.id} ${k} = ${v}`);
    }
  }

  // Citizen cards: each card id exists once in hands, decks, discards and the played slots
  const seen = new Map<string, string>();
  const note = (id: string, where: string) => {
    if (seen.has(id)) bad('cards.unique', `${id} in ${where} and ${seen.get(id)}`);
    else seen.set(id, where);
  };
  s.players.forEach((p, i) => {
    for (const c of p.hand) note(c, `hand${i}`);
    if (p.playedCitizen) note(p.playedCitizen, `played${i}`);
  });
  for (const c of s.decks.citizen) note(c, 'deck');
  for (const c of s.decks.citizenDiscard) note(c, 'discard');

  // scenario display: no duplicates, S03 and S07 never together
  const disp = s.scenarioDisplay;
  if (new Set(disp).size !== disp.length) bad('scn.dup', `duplicate Scenario cards ${disp.join(',')}`);
  if (disp.includes('S03') && disp.includes('S07')) bad('scn.s03s07', 'S03 and S07 are both in the Scenario display');

  // round and storm
  if (s.status === 'playing') {
    if (s.round < 1) bad('round.range', `round ${s.round}`);
    if (s.stormMarker != null && s.stormMarker < 0) bad('storm.range', `storm marker ${s.stormMarker}`);
    for (const t of s.triggers) if (t.round < s.round) bad('trigger.past', `trigger for round ${t.round} still pending in round ${s.round}`);
  }

  // control: a playing game always has a decision or ops left; a finished game has neither
  if (s.status === 'playing') {
    if (!s.pending && s.stack.length === 0) bad('ctrl.stuck', `playing with no decision and an empty stack (phase ${s.phase})`);
  } else {
    if (s.pending) bad('ctrl.endPending', 'a finished game still has a pending decision');
    if (s.stack.length) bad('ctrl.endStack', `a finished game still has ${s.stack.length} op(s) on the stack`);
  }
  if (s.pending && !(s.pending.min <= s.pending.max || s.pending.kind === 'distribute')) bad('ctrl.pendingRange', `pending ${s.pending.kind} min ${s.pending.min} > max ${s.pending.max}`);

  return out;
}
