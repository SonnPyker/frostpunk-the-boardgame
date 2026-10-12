// Audit 8 group buildings, ACT-UB8: focused behaviour of the Law buildings Temple, Agitator, Faith Keepers and
// Propaganda Centre (rulebook appendix pp41-44; buildings.json action text). Each case runs the real building use.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run } from '../src/core';
import { answer } from '../src/setup';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import { newMeeple } from '../src/util';
import { placeBuilding, startUseBuilding, usageProblem } from '../src/buildings';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

function world(): GameState {
  const s = blankState();
  placeTileAt(s, 'N01', 1, 0, 'near');
  placeTileAt(s, 'N02', 2, 0, 'near');
  return s;
}

describe('ACT-UB8 Temple: Engineer only; activate all Hope tokens of one type', () => {
  it('a Worker is refused, an Engineer may use it', () => {
    const s = world();
    const temple = placeBuilding(s, 'temple', 'N01:top')!;
    expect(usageProblem(s, temple, newMeeple(s, 'worker').id, 0)).toBe('Engineers only');
    expect(usageProblem(s, temple, newMeeple(s, 'engineer').id, 0)).toBeNull();
  });

  it('activates all exhausted Hope of the chosen type and leaves the other types exhausted', () => {
    const s = world();
    const temple = placeBuilding(s, 'temple', 'N01:top')!;
    s.hope = [
      { t: 'justice', a: false },
      { t: 'justice', a: false },
      { t: 'care', a: false },
    ] as any;
    const eng = newMeeple(s, 'engineer');
    expect(startUseBuilding(s, 0, eng.id, temple.uid, { heated: true })).toBe(true);
    drain(s);
    expect(s.pending).not.toBeNull();
    const ids = s.pending!.options.map((o: any) => String(o.id)).sort();
    expect(ids).toEqual(['care', 'justice']);
    answer(s, s.pending!.who, s.pending!.id, ['justice']);
    drain(s);
    expect(s.hope.filter((t) => t.t === 'justice' && t.a).length).toBe(2);
    expect(s.hope.filter((t) => t.t === 'care' && t.a).length).toBe(0);
  });

  it('with no exhausted Hope nothing is offered and nothing changes', () => {
    const s = world();
    const temple = placeBuilding(s, 'temple', 'N01:top')!;
    s.hope = [{ t: 'motivation', a: true }] as any;
    startUseBuilding(s, 0, newMeeple(s, 'engineer').id, temple.uid, { heated: true });
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.hope.map((t) => t.a)).toEqual([true]);
  });
});

describe('ACT-UB8 Agitator: exhaust all active Discontent of one type (no cost)', () => {
  it('exhausts every active token of the chosen type only', () => {
    const s = world();
    const agi = placeBuilding(s, 'agitator', 'N01:top')!;
    s.disc = [
      { t: 'greed', a: true },
      { t: 'greed', a: true },
      { t: 'anger', a: true },
    ] as any;
    expect(startUseBuilding(s, 0, newMeeple(s, 'worker').id, agi.uid, { heated: true })).toBe(true);
    drain(s);
    expect(s.pending).not.toBeNull();
    const ids = s.pending!.options.map((o: any) => String(o.id)).sort();
    expect(ids).toEqual(['anger', 'greed']);
    answer(s, s.pending!.who, s.pending!.id, ['greed']);
    drain(s);
    expect(s.disc.filter((t) => t.t === 'greed' && t.a).length).toBe(0);
    expect(s.disc.filter((t) => t.t === 'anger' && t.a).length).toBe(1);
  });

  it('is usable by a Worker (not Engineer only)', () => {
    const s = world();
    const agi = placeBuilding(s, 'agitator', 'N01:top')!;
    expect(usageProblem(s, agi, newMeeple(s, 'worker').id, 0)).toBeNull();
  });
});

describe('ACT-UB8 Faith Keepers: draw 3 Dusk, may discard 1 (not Social Dispute), the rest go back and shuffle', () => {
  it('discarding one card returns the other two to the Dusk deck', () => {
    const s = world();
    const fk = placeBuilding(s, 'faithKeepers', 'N01:top')!;
    s.decks.dusk = ['D005', 'D004', 'D003', 'D002', 'D001', 'SD01'];
    s.decks.duskDiscard = [];
    expect(startUseBuilding(s, 0, newMeeple(s, 'worker').id, fk.uid, { heated: true })).toBe(true);
    drain(s);
    expect(s.pending).not.toBeNull();
    const ids = s.pending!.options.map((o: any) => String(o.id));
    expect(ids).toContain('none');
    expect(ids).not.toContain('SD01');
    expect(ids).toContain('D001');
    expect(ids).toContain('D002');
    answer(s, s.pending!.who, s.pending!.id, ['D001']);
    drain(s);
    expect(s.decks.duskDiscard).toEqual(['D001']);
    // 6 cards, 3 drawn, 1 discarded, the other 2 back: 5 left in the deck
    expect(s.decks.dusk.length).toBe(5);
    expect(s.decks.dusk).not.toContain('D001');
    expect(s.decks.dusk).toEqual(expect.arrayContaining(['D002', 'SD01']));
  });

  it('choosing none keeps all three cards in the deck', () => {
    const s = world();
    const fk = placeBuilding(s, 'faithKeepers', 'N01:top')!;
    s.decks.dusk = ['D005', 'D004', 'D003', 'D002', 'D001', 'SD01'];
    s.decks.duskDiscard = [];
    startUseBuilding(s, 0, newMeeple(s, 'worker').id, fk.uid, { heated: true });
    drain(s);
    answer(s, s.pending!.who, s.pending!.id, ['none']);
    drain(s);
    expect(s.decks.duskDiscard).toEqual([]);
    expect(s.decks.dusk.length).toBe(6);
  });
});

describe('ACT-UB8 Propaganda Centre: Engineer only; repeat the action of an occupied Building, counts as heated', () => {
  it('a Worker is refused, an Engineer may use it', () => {
    const s = world();
    const pc = placeBuilding(s, 'propagandaCentre', 'N01:top')!;
    expect(usageProblem(s, pc, newMeeple(s, 'worker').id, 0)).toBe('Engineers only');
    expect(usageProblem(s, pc, newMeeple(s, 'engineer').id, 0)).toBeNull();
  });

  it('offers only occupied Buildings and repeats the Temple action', () => {
    const s = world();
    const pc = placeBuilding(s, 'propagandaCentre', 'N01:top')!;
    const temple = placeBuilding(s, 'temple', 'N02:top')!;
    s.hope = [{ t: 'care', a: false }] as any;
    const sitter = newMeeple(s, 'worker');
    sitter.loc = { k: 'space', space: 'N02:top' } as any;
    const eng = newMeeple(s, 'engineer');
    expect(startUseBuilding(s, 0, eng.id, pc.uid, { heated: true })).toBe(true);
    drain(s);
    // the Temple is the only occupied Building other than the Propaganda Centre itself, so it is taken without a prompt;
    // the repeated Temple action then has one exhausted Hope type to activate (also taken without a prompt)
    expect(s.pending).toBeNull();
    expect(s.hope[0].a).toBe(true);
  });

  it('with no occupied Building nothing is offered', () => {
    const s = world();
    const pc = placeBuilding(s, 'propagandaCentre', 'N01:top')!;
    placeBuilding(s, 'charcoalKiln', 'N02:top');
    startUseBuilding(s, 0, newMeeple(s, 'engineer').id, pc.uid, { heated: true });
    drain(s);
    expect(s.pending).toBeNull();
  });
});
