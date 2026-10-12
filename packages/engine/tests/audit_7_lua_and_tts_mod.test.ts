// Audit batch 7 (lua-and-tts-mod-reference): the TTS reference files must match the rules and the engine.
//  lua-04: TTS mod Steam Hub text states the Heat-above-red condition and the any-time timing (Scenario Book Steam Hub).
//  lua-05: Crater Lua places Scenario Trigger tokens on 4 and 11 at setup only; the round-12 token comes with S04 (round 11).
//  lua-06: Frozen Grove Lua draws the Technology display from every card except Steam Hub (no exclusions); engine already does.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import '../src/fx/index';
import * as D from '../src/data';
import { createGame } from '../src/index';
import type { GameConfig } from '../src/types';

const LUA = readFileSync(new URL('../../../docs/tts_lua_script.lua', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// assets_src/ is git-ignored (the raw TTS copy), so a clean checkout such as CI has no mod file. lua-04 runs only where it exists.
const MOD_FILE = new URL('../../../assets_src/mod/frostpunk_tts_mod.json', import.meta.url);

/** Source of a top-level Lua function (up to the column-0 `end`). */
function luaFunction(name: string): string {
  const start = LUA.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = LUA.indexOf('\nend\n', start);
  expect(end).toBeGreaterThan(start);
  return LUA.slice(start, end);
}

/** Every TTS object (any depth) whose Nickname is the given value. */
function objectsNamed(node: unknown, nickname: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const v of node) objectsNamed(v, nickname, out);
  } else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (o.Nickname === nickname) out.push(o);
    for (const v of Object.values(o)) objectsNamed(v, nickname, out);
  }
  return out;
}

function frozenGroveConfig(seed: number): GameConfig {
  return {
    scenario: 'frozenGrove',
    society: 3,
    difficulty: 'normal',
    mode: 'coop',
    players: [{ name: 'Ann' }, { name: 'Ben' }, { name: 'Cy' }],
    seed,
    extraPack: true,
  };
}

describe.skipIf(!existsSync(MOD_FILE))('lua-04: TTS mod Steam Hub text', () => {
  it('every Steam Hub object states the any-time timing and the Heat-above-red condition', () => {
    const hubs = objectsNamed(JSON.parse(readFileSync(MOD_FILE, 'utf8')), 'Steam Hub');
    expect(hubs.length).toBeGreaterThan(0);
    for (const hub of hubs) {
      const text = String(hub.Description);
      expect(text).toContain('At any time during the round');
      expect(text).toContain('if the Heat marker is above the red indicator level');
      expect(text).toContain('place 1 Coal from the supply into the Steam Hub');
      // the old wording dropped the condition and timing
      expect(text).not.toContain('Place 1 coal into the Steam Hub to count');
    }
  });
});

describe('lua-05: Crater Scenario Trigger tokens at setup', () => {
  it('places the round-4 and round-11 tokens and not the round-12 token (S04 places it at round 11)', () => {
    expect(LUA).toMatch(/^Scenario1EventMarker1 = 4$/m);
    expect(LUA).toMatch(/^Scenario1EventMarker2 = 11$/m);
    expect(LUA).toMatch(/^Scenario1EventMarker3 = 0$/m);
    expect(LUA).not.toMatch(/^Scenario1EventMarker3 = 12\b/m);
  });

  it('engine: setup tokens are 4 and 11, and S04 places the round-12 token when it is placed', () => {
    expect(D.scenarioStart.scenarioTriggerTokens).toEqual([4, 11]);
    expect(D.scenarioCards.S04.onPlace).toEqual(['trigger:12']);
    const s = createGame({ scenario: 'crater', society: 3, difficulty: 'normal', mode: 'solo', players: [{ name: 'Captain' }], seed: 11, extraPack: true });
    expect(s.triggers.map((t) => t.round)).toEqual([4, 11]);
  });
});

describe('lua-06: Frozen Grove Technology display', () => {
  it('Lua board-2 branch has no exclusions: only the Steam Hub card is picked out of the deck', () => {
    const fn = luaFunction('SetupTechCard');
    expect(fn).toMatch(/SetupBoardNumber == 2 and i==1/);
    expect(fn).toContain('TechCardSteamHub_GUID');
    expect(fn).not.toMatch(/TechCardHuntingTactics_GUID|TechCardTrackingTechniques_GUID|TechCardAdvancedAutomatons_GUID/);
  });

  it('engine: Steam Hub fixed plus 3 random from every other Technology card, with T02/T14/T17 eligible', () => {
    for (const id of ['T02', 'T14', 'T17']) expect(D.techs[id]).toBeDefined();
    const seen = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const ids = createGame(frozenGroveConfig(seed)).techs.map((t) => t.id);
      expect(ids.length).toBe(4);
      expect(new Set(ids).size).toBe(4);
      expect(ids).toContain('T09');
      for (const id of ids) if (id !== 'T09') seen.add(id);
    }
    for (const id of ['T02', 'T14', 'T17']) expect(seen.has(id)).toBe(true);
  });
});
