// MOR-05 fix (audit 7): D062 Engineers' Strike, event passive noEngineerSpecific. While the card is on display, Engineers may
// not use Engineer-specific actions: Buildings with the Engineer symbol (rulebook p26, appendix "[Engineer only]") and the
// Engineer event actions of other cards. The card's own event action (Engineer, once per Round, 5 Food) stays allowed.
// Rulebook: card D062 text (docs/CARD_TEXT_CUSTOM.md, card image #23). Worker-only and general actions are unchanged.
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { placeEvent, eventOf } from '../src/cards';
import { push, run } from '../src/core';
import { actionMenuFor, kindOptions } from '../src/actions';
import { placeBuilding, usageProblem } from '../src/buildings';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import { newMeeple } from '../src/util';
import { engineerSpecificBarred } from '../src/laws';
import type { GameState } from '../src/types';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

/** A solo state with one Near tile (N01) so that Small and Large Buildings have spaces to stand on. */
function world(): GameState {
  const s = blankState();
  placeTileAt(s, 'N01', 1, 0, 'near');
  return s;
}

const menuItem = (s: GameState, id: string) => actionMenuFor(s, 0).find((m) => m.id === id);

describe('MOR-05 D062 Engineers\' Strike: Buildings', () => {
  it('without D062, an Engineer may use an Engineer-only Building (Medical Post)', () => {
    const s = world();
    const mp = placeBuilding(s, 'medicalPost', 'N01:top', { noOnBuild: true })!;
    const eng = newMeeple(s, 'engineer');
    expect(engineerSpecificBarred(s)).toBe(false);
    expect(usageProblem(s, mp, eng.id, 0)).toBeNull();
  });

  it('with D062 on display, an Engineer is refused at an Engineer-only Building (Medical Post, Platform, Child Engineer too)', () => {
    const s = world();
    placeEvent(s, 'D062');
    const mp = placeBuilding(s, 'medicalPost', 'N01:top', { noOnBuild: true })!;
    const plat = placeBuilding(s, 'platform', 'N01:bottom', { printed: true })!;
    const eng = newMeeple(s, 'engineer');
    const childEng = newMeeple(s, 'childEngineer');
    expect(engineerSpecificBarred(s)).toBe(true);
    expect(usageProblem(s, mp, eng.id, 0)).toMatch(/D062/);
    expect(usageProblem(s, plat, eng.id, 0)).toMatch(/D062/);
    expect(usageProblem(s, mp, childEng.id, 0)).toMatch(/D062/);
  });

  it('with D062 on display, an Engineer may still use a Building without the Engineer symbol (Cookhouse)', () => {
    const s = world();
    placeEvent(s, 'D062');
    const cook = placeBuilding(s, 'cookhouse', 'N01:top')!;
    const eng = newMeeple(s, 'engineer');
    s.food = 5;
    expect(usageProblem(s, cook, eng.id, 0)).toBeNull();
  });

  it('with D062 on display, a Worker is still refused at an Engineer-only Building for the usual reason (unchanged)', () => {
    const s = world();
    placeEvent(s, 'D062');
    const mp = placeBuilding(s, 'medicalPost', 'N01:top', { noOnBuild: true })!;
    const worker = newMeeple(s, 'worker');
    expect(usageProblem(s, mp, worker.id, 0)).toBe('Engineers only');
  });

  it('the Use menu item for an Engineer is not offered when only Engineer-only Buildings are usable', () => {
    const s = world();
    placeEvent(s, 'D062');
    placeBuilding(s, 'medicalPost', 'N01:top', { noOnBuild: true });
    newMeeple(s, 'engineer');
    const eng = kindOptions(s, 0, 'use').find((k) => k.kind === 'engineer');
    expect(eng).toBeDefined();
    expect(eng!.normalOk).toBe(false);
  });
});

describe('MOR-05 D062 Engineers\' Strike: Engineer event actions of other cards', () => {
  it('without D062, the Engineer event action of D037 is offered', () => {
    const s = blankState();
    const ev = placeEvent(s, 'D037');
    newMeeple(s, 'engineer');
    expect(menuItem(s, `act:special:ev${ev.uid}`)!.disabled).toBeUndefined();
  });

  it('with D062 on display, the Engineer-only event action of D037 is disabled', () => {
    const s = blankState();
    placeEvent(s, 'D062');
    const ev = placeEvent(s, 'D037');
    newMeeple(s, 'engineer');
    expect(menuItem(s, `act:special:ev${ev.uid}`)!.disabled).toMatch(/D062/);
  });

  it('with D062 on display, a Worker-or-Engineer event action keeps the Worker and is still offered', () => {
    const s = blankState();
    placeEvent(s, 'D062');
    const ev = placeEvent(s, 'M004');
    newMeeple(s, 'worker');
    newMeeple(s, 'engineer');
    expect(menuItem(s, `act:special:ev${ev.uid}`)!.disabled).toBeUndefined();
  });

  it('with D062 on display and only an Engineer in the supply, a Worker-or-Engineer event action is disabled', () => {
    const s = blankState();
    placeEvent(s, 'D062');
    const ev = placeEvent(s, 'M004');
    s.res.wood = 1;
    newMeeple(s, 'engineer');
    expect(menuItem(s, `act:special:ev${ev.uid}`)!.disabled).toBeDefined();
  });

  it('actSpecial refuses an Engineer on D037 while D062 is on display: no Meeple placed, the Engineer stays in supply', () => {
    const s = blankState();
    placeEvent(s, 'D062');
    const ev = placeEvent(s, 'D037');
    const eng = newMeeple(s, 'engineer');
    push(s, { k: 'actSpecial', who: 0, key: `ev${ev.uid}`, meeple: eng.id });
    drain(s);
    expect(ev.meeples).not.toContain(eng.id);
    expect(eng.loc).toEqual({ k: 'supply' });
    expect(eventOf(s, 'D037')!.usedThisRound).toBeFalsy();
  });

  it('the D062 action itself stays allowed for an Engineer: it places the Engineer on the card and spends 5 Food', () => {
    const s = blankState();
    const ev = placeEvent(s, 'D062');
    const eng = newMeeple(s, 'engineer');
    s.food = 5;
    expect(menuItem(s, `act:special:ev${ev.uid}`)!.disabled).toBeUndefined();
    push(s, { k: 'actSpecial', who: 0, key: `ev${ev.uid}`, meeple: eng.id });
    drain(s);
    expect(ev.meeples).toContain(eng.id);
    expect(s.food).toBe(0);
  });
});
