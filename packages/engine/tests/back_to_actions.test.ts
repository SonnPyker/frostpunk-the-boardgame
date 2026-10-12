// Going back to the action menu (BACK_PICK, core.ts). The player picks an action to see what it does and may return to the
// menu from its first decision, before anything is paid, built, used or drawn. The engine restores the state from before the
// pick, so going back leaves no trace: the same menu, the same pending id, the same replay. Going back is refused once a
// hidden part of the game (decks, RNG, other hands) has changed, and a back point never outlives its Action phase.
import { describe, expect, it } from 'vitest';
import { answer, createGame, deserialize, replay, serialize, view, type Command } from '../src/index';
import { BACK_PICK, answerPending, ask, opt } from '../src/core';
import { legalPick } from '../src/autoplay';
import { randInt, seedRng } from '../src/rng';
import type { GameConfig, GameState } from '../src/types';

function config(seed: number, mode: 'solo' | 'coop' = 'solo'): GameConfig {
  return {
    scenario: 'crater',
    society: 1,
    difficulty: 'normal',
    mode,
    players: mode === 'solo' ? [{ name: 'A' }] : [{ name: 'A' }, { name: 'B' }],
    seed,
    extraPack: false,
    advisors: [],
  };
}

/** The seat that answers the open decision (anyone-decisions go to the leader, as in autoplay). */
function whoOf(s: GameState): number {
  return s.pending && s.pending.who >= 0 ? s.pending.who : s.leader;
}

/** The state without the two counters that only ever go up (decision ids and log numbers). */
function withoutCounters(s: GameState) {
  const { nextPending: _n, logN: _l, ...rest } = s;
  return rest;
}

/** Answers random legal picks until the game is at an action menu. */
function toActionMenu(s: GameState, st: ReturnType<typeof seedRng>): boolean {
  for (let i = 0; i < 3000 && s.status === 'playing'; i++) {
    const p = s.pending;
    if (!p) return false;
    if (p.kind === 'action') return true;
    const pick = legalPick(st, p);
    if (!pick || !answer(s, whoOf(s), p.id, pick).ok) return false;
  }
  return false;
}

/** Tries each enabled action of the menu on a copy; returns the first copy whose decision can go back. */
function pickWithBack(menu: GameState): GameState | null {
  const base = serialize(menu);
  const p = menu.pending!;
  for (const o of p.options) {
    if (o.disabled) continue;
    const t = deserialize(base);
    if (!answer(t, whoOf(t), p.id, [o.id]).ok) continue;
    if (t.pending?.back) return t;
  }
  return null;
}

/** The first action menu (seeds 1-20) whose action opens a back-able decision: the menu, and a copy picked into that decision. */
function openBackDecision(): { menu: GameState; picked: GameState } {
  for (let seed = 1; seed <= 20; seed++) {
    const menu = createGame(config(seed));
    if (!toActionMenu(menu, seedRng(seed))) continue;
    const picked = pickWithBack(menu);
    if (picked) return { menu, picked };
  }
  throw new Error('no action in seeds 1-20 opens a back-able decision');
}

describe('going back to the action menu', () => {
  it('restores the menu exactly as it was before the pick', () => {
    const { menu, picked } = openBackDecision();
    const base = deserialize(serialize(menu));
    const menuId = base.pending!.id;
    const r = answer(picked, whoOf(picked), picked.pending!.id, [BACK_PICK]);
    expect(r.ok).toBe(true);
    expect(withoutCounters(picked)).toEqual(withoutCounters(base));
    expect(picked.pending?.id).toBe(menuId);
    expect(picked.pending?.kind).toBe('action');
    expect(picked.backPoint).toBeUndefined();
  });

  it('keeps the decision and log counters counting up, so no id is ever reused', () => {
    const { menu, picked } = openBackDecision();
    const before = picked.nextPending;
    const logBefore = picked.logN;
    expect(menu.nextPending).toBeLessThanOrEqual(before);
    answer(picked, whoOf(picked), picked.pending!.id, [BACK_PICK]);
    expect(picked.nextPending).toBe(before);
    expect(picked.logN).toBe(logBefore);
  });

  it('is refused once something hidden has changed since the pick', () => {
    const { picked } = openBackDecision();
    picked.decks.citizen.push('X'); // a hidden deck changed: the fingerprint no longer matches the pick
    const before = serialize(picked);
    const r = answerPending(picked, whoOf(picked), picked.pending!.id, [BACK_PICK]);
    expect(r.ok).toBe(false);
    expect(serialize(picked)).toBe(before);
  });

  it('is offered on a new decision only while the back point is open, unchanged and in its own round and phase', () => {
    const { picked } = openBackDecision();
    const probe = () => ({
      who: 0,
      kind: 'probe',
      prompt: 'probe',
      options: [opt('a', 'A'), opt('b', 'B')],
      then: { k: 'noop' },
      back: true,
    });

    const open = deserialize(serialize(picked));
    ask(open, probe());
    expect(open.pending?.back).toBe(true);

    const nextRound = deserialize(serialize(picked));
    nextRound.round += 1;
    ask(nextRound, probe());
    expect(nextRound.pending?.back).toBeUndefined();

    const hiddenChanged = deserialize(serialize(picked));
    hiddenChanged.decks.citizen.push('X');
    ask(hiddenChanged, probe());
    expect(hiddenChanged.pending?.back).toBeUndefined();

    const noPoint = deserialize(serialize(picked));
    delete noPoint.backPoint;
    ask(noPoint, probe());
    expect(noPoint.pending?.back).toBeUndefined();
  });

  it('keeps the back point out of views and sends the flag only to the seat that may answer', () => {
    const { picked } = openBackDecision();
    const v = view(picked, whoOf(picked));
    expect('backPoint' in v).toBe(false);
    expect(v.pending?.back).toBe(true);
    expect(view(picked, -1).pending?.back).toBeUndefined();
  });

  it('is refused on a decision that cannot go back, such as the action menu itself', () => {
    const { menu } = openBackDecision();
    expect(menu.pending?.back).toBeUndefined();
    const r = answer(menu, whoOf(menu), menu.pending!.id, [BACK_PICK]);
    expect(r.ok).toBe(false);
  });

  it('a random game with going back replays to the same state and keeps its invariants', () => {
    let backs = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const cfg = config(seed, seed % 2 === 0 ? 'coop' : 'solo');
      const s = createGame(cfg);
      const st = seedRng(500 + seed);
      const commands: Command[] = [];
      for (let i = 0; i < 1200 && s.status === 'playing'; i++) {
        const p = s.pending;
        if (!p) throw new Error(`seed ${seed}: no decision while the game is playing`);
        const pick = p.back && randInt(st, 3) === 0 ? [BACK_PICK] : legalPick(st, p);
        if (!pick) break;
        const who = whoOf(s);
        const r = answer(s, who, p.id, pick);
        expect(r.ok, `seed ${seed}, decision ${p.kind}: ${r.error}`).toBe(true);
        commands.push({ who, pendingId: p.id, pick });
        if (pick[0] === BACK_PICK) {
          backs++;
          expect(s.pending?.kind).toBe('action');
        }
        if (s.pending?.back) expect(s.backPoint).toBeDefined();
        if (s.status === 'playing' && s.phase !== 'action') expect(s.backPoint).toBeUndefined();
      }
      expect(serialize(replay(cfg, commands))).toBe(serialize(s));
    }
    expect(backs).toBeGreaterThan(0);
  }, 120000);
});
