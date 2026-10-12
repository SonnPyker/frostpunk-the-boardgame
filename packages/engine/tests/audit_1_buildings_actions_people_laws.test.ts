// Regression tests for audit batch "buildings-actions-people-laws" (fixer pass 1).
// Each block names the finding it guards. Data findings read the raw JSON directly.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import '../src/fx/index';
import { run, push } from '../src/core';
import { runFx } from '../src/fx/core';
import { actionHeated } from '../src/actions';
import { placeTileAt } from '../src/map';
import { blankState } from '../src/testing';
import { buildings as BUILDINGS } from '../src/data';
import { CITIZEN_TYPES } from '../src/types';
import type { GameState } from '../src/types';
import { newMeeple } from '../src/util';
import { canDismantle, costPayable, placeBuilding } from '../src/buildings';

function drain(s: GameState) {
  try {
    run(s);
  } catch (e: any) {
    if (!/stack ran dry/.test(String(e?.message))) throw e;
  }
}

function raw(name: string): any[] {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../src/data/raw/${name}`, import.meta.url)), 'utf8'));
}

/** One near Map tile (N01: N01:top and N01:bottom) with a cold Generator. */
function setup(): GameState {
  const s = blankState();
  s.gen.heat = 0;
  placeTileAt(s, 'N01', 1, 0, 'near');
  return s;
}

describe('Field Kitchen heats its tile at Heat 1', () => {
  it('Heat 1 with a Field Kitchen on the tile heats the action; without one it stays cold', () => {
    const s = setup();
    s.gen.heat = 1;
    expect(actionHeated(s, 'N01:bottom', false, [])).toBe(false);
    expect(placeBuilding(s, 'fieldKitchen', 'N01:top', { noOnBuild: true })).not.toBeNull();
    expect(actionHeated(s, 'N01:bottom', false, [])).toBe(true);
  });
});

describe('Beacon cannot be dismantled', () => {
  it('the Beacon data carries noDismantle and canDismantle refuses it', () => {
    expect((BUILDINGS as Record<string, any>).beacon.noDismantle).toBe(true);
    const s = setup();
    const b = placeBuilding(s, 'beacon', 'N01:top', { noOnBuild: true });
    expect(b).not.toBeNull();
    expect(canDismantle(s, b!.uid)).toBe(false);
  });
});

describe('upgrades are paid in Wood only (Steel does not replace Wood)', () => {
  it('costPayable with allowSteel=false ignores Steel stock', () => {
    const s = setup();
    s.res.wood = 0;
    s.res.steel = 5;
    expect(costPayable(s, { wood: 1 })).toBeNull();
    expect(costPayable(s, { wood: 1 }, false)).toMatch(/Needs 1 Wood/);
  });
});

describe('Coal Thumper places Coal independent of the bank stock', () => {
  it('thump places Coal on the adjacent space even when the bank has no Coal left', () => {
    const s = setup();
    s.res.coal = 0;
    push(s, { k: 'bldThumpApply', each: 3, pick: ['N01:top'] } as any);
    drain(s);
    expect(s.spaces['N01:top'].res.coal).toBe(3);
  });
});

describe('overflow Citizens are the player choice, not auto-assigned', () => {
  it('gain beyond a full type asks where the overflow goes instead of filling other types', () => {
    const s = setup();
    for (const t of Object.keys(s.cit) as (keyof GameState['cit'])[]) s.cit[t] = 0;
    s.cit.worker = 50;
    runFx(s, ['gain:worker:3'], { who: 0 } as any);
    drain(s);
    expect(s.cit.worker).toBe(50);
    const others = CITIZEN_TYPES.filter((t) => t !== 'worker').reduce((n, t) => n + s.cit[t], 0);
    expect(others).toBe(0);
  });
});

describe('L01A counts only Child Meeples that acted', () => {
  it('sickPerActedChildMeeple counts used Child Meeples only', () => {
    const s = setup();
    s.cit.child = 10;
    const a = newMeeple(s, 'child');
    const b = newMeeple(s, 'child');
    newMeeple(s, 'child');
    a.used = true;
    b.used = true;
    runFx(s, ['sickPerActedChildMeeple:1'], { who: 0 } as any);
    drain(s);
    expect(s.sick.child.n).toBe(2);
  });
});

describe('data-laws: law consequence fixes', () => {
  const cons = raw('law_consequences.json');
  const byId = (id: string) => cons.find((c) => c.id === id);
  const flat = (x: any): string => JSON.stringify(x);

  it('L01A uses the acted-children token', () => {
    expect(flat(byId('L01A'))).toContain('sickPerActedChildMeeple:1');
    expect(flat(byId('L01A'))).not.toContain('sickPerChildMeeple');
  });

  it('L02B pays for the upgrade (upgradeBuilding, not upgradeFree)', () => {
    expect(flat(byId('L02B'))).toContain('upgradeBuilding:small:ignoreUsed');
    expect(flat(byId('L02B'))).not.toContain('upgradeFree:small');
  });

  it('L07B and L08B flip any Sickness marker, not only a Skull', () => {
    expect(flat(byId('L07B'))).toContain('flipSickness:any:1');
    expect(flat(byId('L08B'))).toContain('flipSickness:any:1');
    expect(flat(byId('L07B'))).not.toContain('toSkull');
    expect(flat(byId('L08B'))).not.toContain('toSkull');
  });

  it('L20B Care gives hunger-2 plus hunger-2 per active Care (2+2k)', () => {
    expect(byId('L20B').virtue.care).toEqual(['hunger-2', { each: 'active:care', fx: ['hunger-2'] }]);
  });
});
