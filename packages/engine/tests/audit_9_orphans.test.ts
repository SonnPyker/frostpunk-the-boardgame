// Audit 9 (orphans batch): regression tests for setup-03, scenarios-02/lua-01, actionBuild-02/lua-03, lawsTech-03 (L15),
// lawsTech-05 (L19), lawsTech-06 (L18). Advisors (setup-02) are a declared deviation (RULES_CHECKLIST ADP-07), not a code change.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { answerPending, run, push } from '../src/core';
import { runFx } from '../src/fx/core';
import { blankState } from '../src/testing';
import { createGame } from '../src/setup';
import { effectiveAction } from '../src/buildings';
import { newMeeple } from '../src/util';
import { HOPE_TYPES } from '../src/types';
import type { GameState } from '../src/types';

const DRY = /stack ran dry/;

/** Answers the pending decision and runs on. The stack running dry after the last op is expected in unit tests. */
function answerAndRun(s: GameState, pick: string[]) {
  const p = s.pending;
  if (!p) throw new Error('no decision pending');
  try {
    const r = answerPending(s, p.who, p.id, pick);
    if (!r.ok) throw new Error('answer rejected: ' + r.error);
  } catch (e) {
    if (!DRY.test(String((e as Error).message))) throw e;
  }
}

/** Runs queued ops until a decision or the end of the queue. */
function runSafe(s: GameState) {
  try {
    run(s);
  } catch (e) {
    if (!DRY.test(String((e as Error).message))) throw e;
  }
}

describe('audit_9 setup-03: simultaneous Citizen discards are ordered at random', () => {
  it('the first discarding player varies with the seed (not always seat 0)', () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 24; seed++) {
      const s = createGame({
        scenario: 'dreadnought',
        society: 1,
        difficulty: 'normal',
        mode: 'coop',
        players: [{ name: 'A' }, { name: 'B' }],
        seed,
        extraPack: false,
      } as any);
      expect(s.pending?.kind).toBe('citizenDiscard');
      firsts.add(s.pending!.who);
    }
    expect([...firsts].sort()).toEqual([0, 1]);
  });
});

describe('audit_9 scenarios-02 / lua-01: Dreadnought Steel starts in the bank, not the supply', () => {
  it('the supply starts at 0 Steel', () => {
    const s = createGame({
      scenario: 'dreadnought',
      society: 1,
      difficulty: 'normal',
      mode: 'coop',
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
      extraPack: false,
    } as any);
    expect(s.res.steel).toBe(0);
  });

  it('each Dreadnought gain adds 1 Steel from the bank, capped at the 8 components', () => {
    const s = blankState({ scenario: 'dreadnought' } as any);
    expect(s.res.steel).toBe(0);
    runFx(s, ['gain:steel:1'], { who: 0, src: 'bld:dreadnoughtTile' });
    runSafe(s);
    expect(s.res.steel).toBe(1);
    runFx(s, ['gain:steel:20'], { who: 0, src: 'bld:dreadnoughtTile' });
    runSafe(s);
    expect(s.res.steel).toBe(8);
  });
});

describe('audit_9 actionBuild-02 / lua-03: Cemetery gains Hope only when the Corpse marker moves', () => {
  it('with the Corpse marker at 0 the Cemetery gives no Hope and asks nothing', () => {
    const s = blankState();
    s.corpse = 0;
    s.hopeBag = { care: 3, justice: 3, motivation: 3 };
    runFx(s, ['custom:cemetery'], { who: 0, src: 'bld:cemetery' });
    runSafe(s);
    expect(s.pending).toBeNull();
    expect(s.hope.length).toBe(0);
    expect(s.corpse).toBe(0);
  });

  it('with the marker at 2 Hope is gained after the marker moves, not before', () => {
    const s = blankState();
    s.corpse = 2;
    s.corpseMax = 10;
    s.hopeBag = { care: 3, justice: 3, motivation: 3 };
    runFx(s, ['custom:cemetery'], { who: 0, src: 'bld:cemetery' });
    runSafe(s);
    expect(s.pending?.kind).toBe('corpse');
    expect(s.hope.length).toBe(0);
    answerAndRun(s, ['1']);
    expect(s.corpse).toBe(1);
    expect(s.hope.length).toBe(1);
  });
});

describe('audit_9 lawsTech-03 (L15 Public Council): the player may choose the token drawn', () => {
  it('with L15 in force an increase asks for the token type and draws exactly that type', () => {
    const s = blankState();
    s.laws = [{ id: 'L15', covered: null }] as any;
    s.hopeBag = { care: 1, justice: 1, motivation: 1 };
    runFx(s, ['hope+:1'], { who: 0, src: 'test' });
    runSafe(s);
    expect(s.pending?.kind).toBe('type');
    expect(s.pending!.options.map((o) => o.id).sort()).toEqual([...HOPE_TYPES].sort());
    answerAndRun(s, ['justice']);
    expect(s.hope.map((t) => t.t)).toEqual(['justice']);
    expect(s.hopeBag.justice).toBe(0);
    expect(s.hopeBag.care + s.hopeBag.motivation).toBe(2);
  });

  it('without L15 the draw stays random and asks nothing', () => {
    const s = blankState();
    s.hopeBag = { care: 1, justice: 1, motivation: 1 };
    runFx(s, ['hope+:1'], { who: 0, src: 'test' });
    runSafe(s);
    expect(s.pending).toBeNull();
    expect(s.hope.length).toBe(1);
  });
});

describe('audit_9 lawsTech-05 (L19 Radical Treatment): a Medical Post or Infirmary may set a Sickness marker to 5 and flip it', () => {
  const medicalPost = (uid = 1) => ({ uid, kind: 'medicalPost', upgraded: false, ruins: false, spaces: ['X'], printed: false }) as any;

  it('the alternative replaces the normal effect only while L19 is in force', () => {
    const s = blankState();
    expect(effectiveAction(s, medicalPost(), null)?.fx).not.toEqual(['setSickFlip5']);
    s.laws = [{ id: 'L19', covered: null }] as any;
    expect(effectiveAction(s, medicalPost(), null)?.fx).toEqual(['setSickFlip5']);
  });

  it('sets the chosen marker to 5 and flips it to the Skull side', () => {
    const s = blankState();
    s.laws = [{ id: 'L19', covered: null }] as any;
    s.cit.worker = 6;
    s.cit.child = 2;
    s.sick.worker = { n: 1, skull: false };
    runFx(s, ['setSickFlip5'], { who: 0, src: 'bld:medicalPost' });
    runSafe(s);
    expect(s.pending?.kind).toBe('type');
    answerAndRun(s, ['worker']);
    expect(s.sick.worker).toEqual({ n: 5, skull: true });
  });

  it('the marker stops at the Citizen count when fewer than 5 Citizens of the type live', () => {
    const s = blankState();
    s.cit.engineer = 3;
    s.cit.worker = 4;
    s.sick.engineer = { n: 0, skull: false };
    runFx(s, ['setSickFlip5'], { who: 0, src: 'bld:infirmary' });
    runSafe(s);
    answerAndRun(s, ['engineer']);
    expect(s.sick.engineer.n).toBe(3);
    expect(s.sick.engineer.skull).toBe(true);
  });
});

describe('audit_9 lawsTech-06 (L18 Shared Knowledge): an Engineer Construct has 2 sub-actions', () => {
  /** A board with one dismantlable Sawmill and one upgradeable Medical Post, so the Construct asks instead of auto-ending. */
  function board(laws: string[]) {
    const s = blankState();
    s.laws = laws.map((id) => ({ id, covered: null })) as any;
    s.res.wood = 10;
    s.spaces.A = { id: 'A', tile: 'T', slot: '1', res: {}, trees: 0, building: 1 } as any;
    s.spaces.B = { id: 'B', tile: 'T', slot: '2', res: {}, trees: 0, building: 2 } as any;
    s.buildings.push({ uid: 1, kind: 'sawmill', upgraded: false, ruins: false, spaces: ['A'], printed: false } as any);
    s.buildings.push({ uid: 2, kind: 'medicalPost', upgraded: false, ruins: false, spaces: ['B'], printed: false } as any);
    s.nextUid = 3;
    return s;
  }
  function construct(laws: string[], kind: 'engineer' | 'worker') {
    const s = board(laws);
    const m = newMeeple(s, kind);
    s.stack.push({ k: 'actResolve', who: 0, action: 'construct', meeple: m.id, card: null } as any);
    runSafe(s);
    return s.pending;
  }

  it('with L18 an Engineer Construct offers 2 sub-actions', () => {
    const p = construct(['L18'], 'engineer');
    expect(p?.kind).toBe('construct');
    expect(p?.prompt).toMatch(/2 sub-action/);
  });

  it('without L18 the Engineer keeps the normal 3 sub-actions', () => {
    const p = construct([], 'engineer');
    expect(p?.prompt).toMatch(/3 sub-action/);
  });

  it('L18 does not change a Worker Construct', () => {
    const p = construct(['L18'], 'worker');
    expect(p?.prompt).toMatch(/3 sub-action/);
  });

  it('an Upgrade that costs 2 sub-actions is offered only when 2 are left', () => {
    const offered = (left: number) => {
      const s = board([]);
      s.stack.push({ k: 'bldConstructStep', c: { who: 0, src: null, meeple: null, left, allowUpgrade: true, upgradeCost: 2, woodDiscount: 0, overRuins: false, onDone: null } } as any);
      runSafe(s);
      return (s.pending?.options ?? []).map((o) => o.id);
    };
    expect(offered(1)).not.toContain('upgrade');
    expect(offered(2)).toContain('upgrade');
  });
});
