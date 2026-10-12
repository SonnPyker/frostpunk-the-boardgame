// Audit 7 (checklist verification): Scenarios (I), Lose conditions (J), Players (K), Digital adaptations (L).
// Items covered: SCN-02 (Frozen Grove action-tile rule, FG1), ADP-08 (face-up Future Laws visible to players),
// PLY-02 (death card: any player may discard a matching card, rulebook p30), SCN-05 / LOS-07 (no Round-15 lose).
// Gap tests use it.fails so the suite stays green while documenting the current behaviour; when a gap is fixed the
// it.fails block starts failing and must be flipped to a normal it.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions';
import '../src/buildings';
import '../src/sickness';
import '../src/phases';
import { run, push } from '../src/core';
import { placementOptions } from '../src/buildings';
import { placeTileAt, connectedTileKeys } from '../src/map';
import { spaceAllowed } from '../src/actions';
import { view } from '../src/view';
import { citizens } from '../src/data';
import { blankState } from '../src/testing';
import type { GameState } from '../src/types';

/** Frozen Grove: the Generator tile (origin) with one tile on hex (1,0) that touches it, and one tile on hex (-2,0) that does not. */
function frozenWithDisconnected(): { s: GameState; connectedSpace: string; isolatedSpace: string } {
  const s = blankState({ scenario: 'frozenGrove', players: [{ name: 'A' }, { name: 'B' }] } as any);
  placeTileAt(s, 'N01', 1, 0, 'near');
  placeTileAt(s, 'N02', -3, 0, 'near');
  const conn = connectedTileKeys(s);
  const tAdj = s.tiles.find((t) => t.kind !== 'gen' && t.q === 1 && t.r === 0)!;
  const tIso = s.tiles.find((t) => t.kind !== 'gen' && t.q === -3 && t.r === 0)!;
  expect(conn.has(tAdj.key)).toBe(true);
  expect(conn.has(tIso.key)).toBe(false);
  return { s, connectedSpace: tAdj.spaces[0], isolatedSpace: tIso.spaces[0] };
}

describe('SCN-02 / FG1 Frozen Grove action tiles (ACT-11)', () => {
  it('Gather (space action) is limited to tiles connected to the Generator', () => {
    const { s, connectedSpace, isolatedSpace } = frozenWithDisconnected();
    expect(spaceAllowed(s, connectedSpace)).toBe(true);
    expect(spaceAllowed(s, isolatedSpace)).toBe(false);
  });

  it('Construct placement must exclude a tile that is neither adjacent nor connected (FG1)', () => {
    const { s, isolatedSpace } = frozenWithDisconnected();
    const opts = placementOptions(s, 'house').map((o) => o.id);
    expect(opts).not.toContain(isolatedSpace);
  });
});

describe('ADP-08 hidden information: face-up Law cards', () => {
  it('the player view shows the face-up Future Law cards (Scenario-independent rulebook p37: "look through the Law cards at any time")', () => {
    const s = blankState({ scenario: 'crater' } as any);
    s.futureLaws = ['L01', 'L02'];
    const v: any = view(s, 0);
    expect(v.futureLaws).toEqual(['L01', 'L02']);
  });

  it('the player view still hides the Law Consequence bank', () => {
    const s = blankState({ scenario: 'crater' } as any);
    s.futureLaws = ['L01'];
    const json = JSON.stringify(view(s, 0));
    expect(json).not.toContain('lawConsequenceBank');
  });
});

describe('PLY-02 / DEA-03 death card: any player may discard a matching card (rulebook p30)', () => {
  it('a non-leader holding a matching Citizen card is asked to decide the discard', () => {
    const s = blankState({ scenario: 'crater', players: [{ name: 'A' }, { name: 'B' }] } as any);
    const workerCard = Object.keys(citizens).find((id) => (citizens as any)[id].type === 'worker')!;
    s.players[1].hand = [workerCard];
    s.leader = 0;
    push(s, { k: 'deathCard', type: 'worker', who: 0 } as any);
    try {
      run(s);
    } catch {
      /* stack ran dry in a unit test */
    }
    expect(s.pending?.who).toBe(1);
  });
});

describe('SCN-05 / LOS-07 end conditions', () => {
  it('checkEnd reports only the stored status (no extra Round-15 lose is ever set)', async () => {
    const { checkEnd } = await import('../src/scenario');
    const s = blankState({ scenario: 'crater' } as any);
    s.round = 15;
    expect(checkEnd(s)).toBe('playing');
    s.status = 'won';
    expect(checkEnd(s)).toBe('won');
  });
});
