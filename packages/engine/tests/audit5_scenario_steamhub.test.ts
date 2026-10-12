// Regression tests for the scenario fixer (audit 5): Steam Hub coal at any time during the round (lua-02, scenarios-03).
// Scenario Book, Steam Hub passive: "At any time during the round, if the Heat marker level is higher than the Red Insulation
// level you may place 1 Coal from the supply into the Steam Hub. ... Return the Coal to the bank at the end of the Generator Phase."
// Digital model: the Action-phase menu item (actions.ts) already exists; this file covers the Night step (night.ts ntSteamHub)
// and checks that the Generator phase offers no step (its Stress step returns the Coal and resets Heat to 1).
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import '../src/actions';
import '../src/generator';
import '../src/sickness';
import '../src/tech';
import '../src/cards';
import '../src/expedition';
import '../src/phases';
import '../src/night';
import '../src/scenario';
import { answerPending, push, run } from '../src/core';
import { placeBuilding } from '../src/buildings';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import { nightBody, steamHubFreeCandidates } from '../src/night';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** Answers the pending decision of the leader; an empty stack afterwards is normal in these unit tests. */
function answerOk(s: GameState, pick: string[]) {
  const id = s.pending!.id;
  try {
    answerPending(s, s.leader, id, pick);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
  expect(s.pending?.id).not.toBe(id);
}

/** A Frozen Grove-like board: one near tile, a built Steam Hub on it, Heat 2 above the red indicator (1), 2 Coal in the supply. */
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

describe('Steam Hub coal at Night (Scenario Book: at any time during the round)', () => {
  it('the Night body asks the Steam Hub step after the Fuel step and before the sleeping', () => {
    const kinds = nightBody(blankState()).map((o) => o.k);
    const fuel = kinds.indexOf('fuelAsk');
    const hub = kinds.indexOf('ntSteamHub');
    const sleep = kinds.indexOf('ntSleep');
    expect(fuel).toBeGreaterThanOrEqual(0);
    expect(hub).toBe(fuel + 1);
    expect(sleep).toBe(hub + 1);
  });

  it('a Steam Hub with Heat above the red level is offered at Night, with a choice to place no Coal', () => {
    const { s, uid } = hubState();
    expect(steamHubFreeCandidates(s).map((b) => b.uid)).toEqual([uid]);
    push(s, { k: 'ntSteamHub' });
    drain(s);
    expect(s.pending?.kind).toBe('steamHub');
    expect(s.pending!.options.map((o) => o.id)).toEqual([`b:${uid}`, 'done']);
  });

  it('nothing is offered when Heat is not above the red indicator, or no Coal is in the supply', () => {
    const cold = hubState().s;
    cold.gen.heat = 1; // equal to the red level: not above it
    push(cold, { k: 'ntSteamHub' });
    drain(cold);
    expect(cold.pending).toBeNull();

    const broke = hubState().s;
    broke.res.coal = 0;
    push(broke, { k: 'ntSteamHub' });
    drain(broke);
    expect(broke.pending).toBeNull();
  });

  it('placing Coal spends 1 Coal, marks the Steam Hub, and asks again until the player picks done', () => {
    const { s, uid } = hubState();
    push(s, { k: 'ntSteamHub' });
    drain(s);
    const first = s.pending!;
    answerOk(s, [`b:${uid}`]);
    drain(s);
    expect(s.buildings.find((b) => b.uid === uid)?.steamHubCoal).toBe(true);
    expect(s.res.coal).toBe(1);
    // the Steam Hub now holds its Coal: no candidate is left, so the step ends without another question
    expect(s.pending).toBeNull();
  });

  it('picking done places nothing and the Night step ends', () => {
    const { s, uid } = hubState();
    push(s, { k: 'ntSteamHub' });
    drain(s);
    answerOk(s, ['done']);
    drain(s);
    expect(s.buildings.find((b) => b.uid === uid)?.steamHubCoal).toBeFalsy();
    expect(s.res.coal).toBe(2);
    expect(s.pending).toBeNull();
  });

  it('two Steam Hubs: the step asks for each Coal in turn; the Coal stays until the next Generator Stress step', () => {
    const s = hubState().s;
    const first = s.buildings[0].uid;
    const second = placeBuilding(s, 'steamHub', 'N01:bottom', { noOnBuild: true });
    expect(second).not.toBeNull();
    push(s, { k: 'ntSteamHub' });
    drain(s);
    answerOk(s, [`b:${first}`]);
    drain(s);
    expect(s.pending?.kind).toBe('steamHub'); // the second hub is still empty
    answerOk(s, [`b:${second!.uid}`]);
    drain(s);
    expect(s.buildings.filter((b) => b.kind === 'steamHub' && b.steamHubCoal)).toHaveLength(2);
    expect(s.res.coal).toBe(0);
    expect(s.pending).toBeNull();

    // the Generator phase returns the Coal to the bank (its Stress step), and Heat is reset
    push(s, { k: 'genStress' });
    drain(s);
    expect(s.buildings.filter((b) => b.kind === 'steamHub' && b.steamHubCoal)).toHaveLength(0);
    expect(s.gen.heat).toBe(1);
  });
});

describe('Steam Hub coal in the Generator phase: no step (it would be returned in the same phase)', () => {
  it('the Generator phase asks only the Fuel question; no Steam Hub question appears before or after the Stress step', () => {
    const { s } = hubState();
    s.gen.cold = 5;
    s.gen.heat = 3; // above the red level: the Action-menu rule would allow Coal here
    push(s, { k: 'generatorPhase' });
    drain(s);
    expect(s.pending?.kind).toBe('fuel');
    answerOk(s, ['0']);
    drain(s);
    expect(s.pending).toBeNull();
    expect(s.buildings.some((b) => b.steamHubCoal)).toBe(false);
    expect(s.gen.heat).toBe(1);
  });
});
