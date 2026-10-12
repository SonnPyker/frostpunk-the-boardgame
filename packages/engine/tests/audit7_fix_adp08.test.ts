// Audit 7 fix ADP-08: the Future Law display is public (rulebook p37: "You may look through the Law cards at any time, but not
// the Law Consequence cards"; setup step 1, p13: L01-L08 placed face up). The player view now sends `futureLaws` (Law card ids
// in display order). The Law Consequence bank stays hidden, and so do the decks and the RNG.
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
import { createGame } from '../src/setup';
import { run } from '../src/core';
import { view } from '../src/view';
import { blankState } from '../src/testing';
import { introduceLaw } from '../src/laws';
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

/** Answers pending decisions with the first enabled option until none is left (the same pattern as audit6_laws). */
function playToEnd(s: GameState) {
  for (let i = 0; i < 40; i++) {
    try {
      run(s);
    } catch (e: any) {
      if (!/stack ran dry/.test(String(e?.message))) throw e;
    }
    if (!s.pending) return;
    const p: any = s.pending;
    const pick = [p.options.find((o: any) => !o.disabled)?.id].filter(Boolean);
    s.pending = null;
    s.stack.push({ ...p.then, pick });
  }
}

describe('ADP-08: the player view sends the Future Law display (Law card ids)', () => {
  it('a new game: the seat view lists the 12 Law cards in display order, L01-L08 first (setup step 1)', () => {
    const s = createGame(config(21));
    const v: any = view(s, 0);
    expect(v.futureLaws).toEqual(s.futureLaws);
    expect(v.futureLaws).toHaveLength(12);
    expect(v.futureLaws.slice(0, 8)).toEqual(['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08']);
    // the four random Laws come from L09-L16 (extra pack off)
    for (const id of v.futureLaws.slice(8)) expect(id).toMatch(/^L(09|1[0-6])$/);
  });

  it('the spectator view (seat -1) lists the same Law cards', () => {
    const s = createGame(config(22));
    const v: any = view(s, -1);
    expect(v.futureLaws).toEqual(s.futureLaws);
  });

  it('the list is a copy: changing it in the view does not change the game', () => {
    const s = createGame(config(23));
    const v: any = view(s, 0);
    v.futureLaws.push('X');
    v.futureLaws[0] = 'Y';
    expect(s.futureLaws).not.toContain('X');
    expect(s.futureLaws[0]).toBe('L01');
  });

  it('futureLawCount is still sent and equals the length of the list', () => {
    const s = createGame(config(24));
    const v: any = view(s, 0);
    expect(v.futureLawCount).toBe(v.futureLaws.length);
  });

  it('the Law Consequence cards of the display are never sent to a seat', () => {
    const s = createGame(config(25));
    const v: any = view(s, 0);
    const json = JSON.stringify(v);
    expect(json).not.toContain('"lawConsequenceBank"');
    expect('lawConsequenceBank' in v).toBe(false);
    const consequenceIds = new Set<string>();
    for (const law of s.futureLaws) for (const c of s.lawConsequenceBank[law] ?? []) consequenceIds.add(c);
    expect(consequenceIds.size).toBeGreaterThan(0);
    for (const c of consequenceIds) expect(json).not.toContain(`"${c}"`);
  });

  it('the deck order and the RNG stay hidden; the omniscient debug view still adds decks and consequences', () => {
    const s = createGame(config(26));
    const v: any = view(s, 0);
    for (const k of ['decks', 'rng', 'stack', 'lawConsequenceBank']) expect(k in v).toBe(false);
    const dbg: any = view(s, 0, { omniscient: true });
    expect(dbg.decks).toEqual(s.decks);
    expect(dbg.lawConsequenceBank).toEqual(s.lawConsequenceBank);
    expect(dbg.futureLaws).toEqual(s.futureLaws);
    expect('rng' in dbg).toBe(false);
  });

  it('the list follows the game: a Law that is introduced leaves the display in the next view', () => {
    const s = blankState({ scenario: 'crater' } as any);
    s.futureLaws = ['L03', 'L04'];
    s.lawConsequenceBank = { L03: ['L03A', 'L03B'], L04: ['L04A', 'L04B'] };
    expect((view(s, 0) as any).futureLaws).toEqual(['L03', 'L04']);
    introduceLaw(s, 'L03');
    playToEnd(s);
    expect(s.laws.map((l) => l.id)).toContain('L03');
    const v: any = view(s, 0);
    expect(v.futureLaws).not.toContain('L03');
    expect(v.futureLaws).toEqual(s.futureLaws);
  });
});
