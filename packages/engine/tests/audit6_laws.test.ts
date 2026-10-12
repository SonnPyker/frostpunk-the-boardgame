// Audit 6: Law buildOnIntro (L02 Child Shelter, L09 Care House, L10 Fighting Arena, L11 Public House).
// Printed card text (back of the law deck, sheet 557): "When this Law is introduced, you may immediately build the X by
// paying its cost." The build is optional, at the normal cost, and runs after the intro Hope/Discontent change.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run } from '../src/core';
import { buildings as BUILDINGS, laws as LAWS } from '../src/data';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';
import { introduceLaw } from '../src/laws';

const DEFS = BUILDINGS as Record<string, any>;
const LAW_DEFS = LAWS as Record<string, any>;

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/**
 * Answers every pending decision: `choose(pending)` gives the pick, default is the first enabled option. Stops when no
 * decision is pending or when `stopAt` (a pending kind) is reached.
 */
function play(s: GameState, choose: (p: any) => string[] | undefined, stopAt?: string) {
  drain(s);
  for (let i = 0; i < 60 && s.pending; i++) {
    const p: any = s.pending;
    if (stopAt && p.kind === stopAt) return;
    const pick = choose(p) ?? [p.options.find((o: any) => !o.disabled)?.id].filter(Boolean);
    s.pending = null;
    s.stack.push({ ...p.then, pick });
    drain(s);
  }
}

function setupMap(wood: number): GameState {
  const s = blankState();
  s.gen.heat = 0;
  placeTileAt(s, 'N01', 1, 0, 'near');
  s.res.wood = wood;
  return s;
}

/** Introduces `lawId` from the Future Law display (its pair is the other card of the starting pair). */
function introduce(s: GameState, lawId: string, pairId: string) {
  s.futureLaws = [lawId, pairId];
  s.lawConsequenceBank = { [lawId]: [lawId + 'A', lawId + 'B'] };
  introduceLaw(s, lawId);
}

describe('Law buildOnIntro data', () => {
  it('L02, L09, L10, L11 name the building their printed card says may be built on introduction', () => {
    const expected: Record<string, [string, number]> = {
      L02: ['childShelter', 2],
      L09: ['careHouse', 2],
      L10: ['fightingArena', 1],
      L11: ['publicHouse', 1],
    };
    for (const [law, [kind, wood]] of Object.entries(expected)) {
      expect(LAW_DEFS[law].buildOnIntro).toBe(kind);
      expect(DEFS[kind].law).toBe(law);
      expect(DEFS[kind].build.wood).toBe(wood);
    }
  });

  it('laws without a printed intro build carry no buildOnIntro', () => {
    for (const law of ['L01', 'L03', 'L04', 'L05', 'L12', 'L13']) expect(LAW_DEFS[law].buildOnIntro).toBeUndefined();
  });
});

describe('Law buildOnIntro at introduction', () => {
  it('offers the optional build after the law is introduced, and builds the Child Shelter on yes at its cost', () => {
    const s = setupMap(5);
    introduce(s, 'L02', 'L01');
    play(s, () => undefined, 'lawBuild');
    expect(s.pending?.kind).toBe('lawBuild');
    expect(s.laws.map((l) => l.id)).toContain('L02');
    // the intro effect (Hope +1) ran before the offer: the law is in play and the offer is the next decision
    play(s, (p) => (p.kind === 'lawBuild' ? ['yes'] : undefined));
    const built = s.buildings.filter((b) => b.kind === 'childShelter');
    expect(built.length).toBe(1);
    expect(s.res.wood).toBe(3); // 5 Wood minus the 2 Wood cost
  });

  it('builds nothing when the player declines', () => {
    const s = setupMap(5);
    introduce(s, 'L10', 'L09');
    play(s, () => undefined, 'lawBuild');
    expect(s.pending?.kind).toBe('lawBuild');
    play(s, (p) => (p.kind === 'lawBuild' ? ['no'] : undefined));
    expect(s.buildings.some((b) => b.kind === 'fightingArena')).toBe(false);
    expect(s.res.wood).toBe(5);
    expect(s.pending).toBeNull();
  });

  it('is not offered when the building cannot be paid for', () => {
    const s = setupMap(1);
    introduce(s, 'L02', 'L01'); // Child Shelter costs 2 Wood
    play(s, () => undefined);
    expect(s.pending).toBeNull();
    expect(s.buildings.some((b) => b.kind === 'childShelter')).toBe(false);
    expect(s.res.wood).toBe(1);
  });

  it('is not offered for a law without buildOnIntro (L03 Food Additives)', () => {
    const s = setupMap(5);
    introduce(s, 'L03', 'L04');
    play(s, () => undefined);
    expect(s.pending).toBeNull();
    expect(s.res.wood).toBe(5);
  });

  it('the Public House offer builds at 1 Wood (L11)', () => {
    const s = setupMap(3);
    introduce(s, 'L11', 'L12');
    play(s, (p) => (p.kind === 'lawBuild' ? ['yes'] : undefined));
    expect(s.buildings.filter((b) => b.kind === 'publicHouse').length).toBe(1);
    expect(s.res.wood).toBe(2);
  });
});
