// Audit 6, core: (1) the seat view hides the deck orders and the Law consequences (omniscient debug view excepted) and sends the
// public Future Law display (Law card ids, ADP-08); (2) a rejected answer leaves the state unchanged (pending preserved); (3) the Steam Hub rule has one shared helper
// (steamHub.ts) used by the Action menu and by the free Steam Hub step (night.ts ntSteamHub, steamHubStepOps).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/tiles';
import '../src/buildings';
import '../src/expedition';
import '../src/laws';
import '../src/tech';
import '../src/cards';
import '../src/generator';
import '../src/sickness';
import '../src/actions';
import '../src/phases';
import '../src/night';
import '../src/scenario';
import { answer, createGame } from '../src/setup';
import { ask, defOp, opt, RuleError, run, snapshotState, restoreState } from '../src/core';
import { placeBuilding } from '../src/buildings';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import { view } from '../src/view';
import { steamHubFreeCandidates, steamHubStepOps } from '../src/night';
import { steamHubFreeCandidates as sharedFree, steamHubState } from '../src/steamHub';
import type { GameConfig, GameState } from '../src/types';

function config(seed: number): GameConfig {
  return {
    scenario: 'crater',
    society: 1,
    difficulty: 'normal',
    mode: 'solo',
    players: [{ name: 'A' }],
    seed,
    extraPack: false,
    advisors: [],
  } as any;
}

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

// A test-only op that rejects the answer the way a rule handler does.
defOp('audit6ForcedRuleError', () => {
  throw new RuleError('forced rule error (audit6)');
});

// A test-only parking decision: keeps the game from running dry under a unit-test stack.
defOp('audit6Park', (s) => {
  ask(s, { who: s.leader, kind: 'park', prompt: 'parked (test)', options: [opt('x', 'x')], forced: true, then: { k: 'audit6Park' } });
});

describe('view: hidden information stays hidden', () => {
  it('the seat view has no Future Law order, no deck contents, no Law consequences, no RNG and no op stack', () => {
    const s = createGame(config(11));
    const v: any = view(s, 0);
    for (const k of ['decks', 'lawConsequenceBank', 'rng', 'stack']) expect(k in v).toBe(false);
    // the Future Law display is public (rulebook p37): Law card ids are sent, the Law Consequence cards are not
    expect(v.futureLaws).toEqual(s.futureLaws);
    expect(v.futureLawCount).toBe(s.futureLaws.length);
    expect(v.futureLawCount).toBeGreaterThan(0);
    // counts only for the decks
    expect(v.deckCounts.morning).toBe(s.decks.morning.length);
    expect(v.deckCounts.citizen).toBe(s.decks.citizen.length);
    // no card id of a hidden deck leaks through the JSON (the citizen discard is face up and is the only discard shown)
    const json = JSON.stringify(v);
    expect(json).not.toContain('"lawConsequenceBank"');
  });

  it('a spectator view (seat -1) has the same redaction', () => {
    const s = createGame(config(12));
    const v: any = view(s, -1);
    expect(v.futureLaws).toEqual(s.futureLaws);
    expect('decks' in v).toBe(false);
    expect(v.seat).toBe(-1);
  });

  it('the omniscient debug view adds decks, Future Laws and consequences, and still has no RNG or op stack', () => {
    const s = createGame(config(13));
    const v: any = view(s, 0, { omniscient: true });
    expect(v.decks).toEqual(s.decks);
    expect(v.futureLaws).toEqual(s.futureLaws);
    expect(v.lawConsequenceBank).toEqual(s.lawConsequenceBank);
    expect('rng' in v).toBe(false);
    expect('stack' in v).toBe(false);
    // the copies are independent of the state
    v.decks.morning.push('X');
    expect(s.decks.morning).not.toContain('X');
  });

  it('a non-omniscient view is unchanged by the option object being absent', () => {
    const s = createGame(config(14));
    expect(JSON.stringify(view(s, 0))).toBe(JSON.stringify(view(s, 0, {})));
  });
});

describe('answers are transactional: a rejected answer leaves the state unchanged', () => {
  function firstDecision(seed: number) {
    const s = createGame(config(seed));
    expect(s.pending).not.toBeNull();
    return s;
  }

  it('an answer to a stale decision id is refused and nothing changes', () => {
    const s = firstDecision(21);
    const before = snapshotState(s);
    const r = answer(s, s.pending!.who < 0 ? 0 : s.pending!.who, s.pending!.id + 99, []);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('stale decision');
    expect(snapshotState(s)).toBe(before);
  });

  it('an answer from the wrong seat is refused and the decision stays pending', () => {
    const s = firstDecision(22);
    s.pending!.who = 0; // a decision for seat 0; seat 3 does not exist in this solo game
    const before = snapshotState(s);
    const id = s.pending!.id;
    const r = answer(s, 3, id, []);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not your decision');
    expect(s.pending?.id).toBe(id);
    expect(snapshotState(s)).toBe(before);
  });

  it('a pick with too many options is refused and nothing changes', () => {
    const s = firstDecision(23);
    const p = s.pending!;
    const ids = p.options.filter((o) => !o.disabled).map((o) => o.id);
    expect(ids.length).toBeGreaterThan(0);
    const pick = Array.from({ length: p.max + 1 }, (_, i) => ids[i % ids.length]);
    const before = snapshotState(s);
    const r = answer(s, p.who < 0 ? 0 : p.who, p.id, pick);
    expect(r.ok).toBe(false);
    expect(snapshotState(s)).toBe(before);
    expect(s.pending?.id).toBe(p.id);
  });

  it('a pick with too few options is refused and nothing changes', () => {
    const s = firstDecision(24);
    const p = s.pending!;
    if (p.min === 0) return; // nothing is too few for an optional decision
    const before = snapshotState(s);
    const r = answer(s, p.who < 0 ? 0 : p.who, p.id, []);
    expect(r.ok).toBe(false);
    expect(snapshotState(s)).toBe(before);
    expect(s.pending?.id).toBe(p.id);
  });

  it('an unknown option id is refused and nothing changes', () => {
    const s = firstDecision(25);
    const p = s.pending!;
    const before = snapshotState(s);
    const r = answer(s, p.who < 0 ? 0 : p.who, p.id, ['NO_SUCH_OPTION']);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown option|pick|duplicate/);
    expect(snapshotState(s)).toBe(before);
    expect(s.pending?.id).toBe(p.id);
  });

  it('a duplicate pick (without repeats allowed) is refused and nothing changes', () => {
    const s = firstDecision(26);
    const p = s.pending!;
    const id = p.options.find((o) => !o.disabled)?.id;
    if (!id || p.meta?.allowRepeat) return;
    const before = snapshotState(s);
    const r = answer(s, p.who < 0 ? 0 : p.who, p.id, [id, id]);
    expect(r.ok).toBe(false);
    expect(snapshotState(s)).toBe(before);
  });

  it('a RuleError thrown inside the game after the answer is applied restores the state (pending preserved)', () => {
    const s = firstDecision(27);
    const who = s.pending!.who < 0 ? 0 : s.pending!.who;
    // make the decision's continuation a rule handler that rejects the answer
    s.pending!.min = 0;
    s.pending!.max = 0;
    s.pending!.then = { k: 'audit6ForcedRuleError' } as any;
    const before = snapshotState(s);
    const id = s.pending!.id;
    const r = answer(s, who, id, []);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('forced rule error (audit6)');
    expect(s.pending).not.toBeNull();
    expect(s.pending!.id).toBe(id);
    expect(snapshotState(s)).toBe(before);
  });

  it('restoreState puts back an earlier snapshot in place', () => {
    const s = firstDecision(28);
    const snap = snapshotState(s);
    s.round = 99;
    s.pending = null;
    restoreState(s, snap);
    expect(s.round).not.toBe(99);
    expect(s.pending).not.toBeNull();
    expect(snapshotState(s)).toBe(snap);
  });

  it('after a refused answer the same decision is still answerable with a valid pick', () => {
    const s = firstDecision(29);
    const p = s.pending!;
    const who = p.who < 0 ? 0 : p.who;
    answer(s, who, p.id + 1000, []); // refused
    const valid = p.options.filter((o) => !o.disabled).slice(0, p.min).map((o) => o.id);
    if (valid.length !== p.min) return;
    const r = answer(s, who, p.id, valid);
    expect(r.ok).toBe(true);
  });
});

describe('Steam Hub: one shared rule (steamHub.ts)', () => {
  it('night.ts and steamHub.ts export the same helper (no duplicate rule)', () => {
    expect(steamHubFreeCandidates).toBe(sharedFree);
  });

  function hubState(): { s: GameState; uid: number } {
    const s = blankState({ scenario: 'frozenGrove' });
    placeTileAt(s, 'N01', 1, 0, 'near');
    const hub = placeBuilding(s, 'steamHub', 'N01:top', { noOnBuild: true });
    if (!hub) throw new Error('steam hub not placed');
    s.gen.heat = 2;
    s.gen.ind.red = 1;
    s.res.coal = 2;
    return { s, uid: hub.uid };
  }

  it('the menu rule and the free-step rule agree in every state tried', () => {
    const { s, uid } = hubState();
    expect(steamHubState(s).why).toBeNull();
    expect(steamHubFreeCandidates(s).map((b) => b.uid)).toEqual([uid]);
    s.gen.heat = 1; // equal to the red level: not above it
    expect(steamHubState(s).why).toBe('Heat must be above the red level');
    expect(steamHubFreeCandidates(s)).toEqual([]);
    s.gen.heat = 2;
    s.res.coal = 0;
    expect(steamHubState(s).why).toBe('No Coal');
    expect(steamHubFreeCandidates(s)).toEqual([]);
  });

  it('steamHubStepOps offers the free step only when a Steam Hub may take Coal', () => {
    const { s } = hubState();
    expect(steamHubStepOps(s)).toEqual([{ k: 'ntSteamHub' }]);
    s.gen.heat = 1;
    expect(steamHubStepOps(s)).toEqual([]);
    expect(steamHubStepOps(blankState())).toEqual([]);
  });

  it('the free step asks at a Dusk-like moment (after the Action phase) and places Coal only on the chosen hub', () => {
    const { s, uid } = hubState();
    s.phase = 'dusk';
    // a parking decision at the bottom of the stack so that the game never runs dry in this unit test
    s.stack.push({ k: 'audit6Park' } as any);
    s.stack.push(...steamHubStepOps(s));
    drain(s);
    expect(s.pending?.kind).toBe('steamHub');
    expect(s.pending!.options.map((o) => o.id)).toEqual([`b:${uid}`, 'done']);
    const id = s.pending!.id;
    const r = answer(s, s.leader, id, [`b:${uid}`]);
    expect(r.ok).toBe(true);
    expect(s.buildings.find((b) => b.uid === uid)?.steamHubCoal).toBe(true);
    expect(s.res.coal).toBe(1);
    // the step is not asked again for the same hub: only the parking decision is left
    expect(s.pending?.kind).toBe('park');
  });

  it('a Steam Hub that already holds Coal is not offered again in the same free step', () => {
    const { s, uid } = hubState();
    s.buildings.find((b) => b.uid === uid)!.steamHubCoal = true;
    expect(steamHubFreeCandidates(s)).toEqual([]);
    expect(steamHubStepOps(s)).toEqual([]);
  });
});
