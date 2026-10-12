// Audit 4: Technology `mod` keys in technologies.json are informational. No code queries them by name; each printed
// Technology effect is implemented by its tech id. This test pins that map: every mod key must have an entry here, and
// each entry's marker must still appear in the file that implements it. A new or orphaned key fails the test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as D from '../src/data';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const readSrc = (file: string) => readFileSync(SRC + file, 'utf8');

// mod key (name before ':') -> [implementing source file, marker that must appear in that file]
const IMPL: Record<string, [string, string]> = {
  scoutBonusMoveOnDeployOrContinue: ['expedition.ts', "techDone(s, 'T01')"], // T01
  charcoalKilnTreeInsteadOfWood: ['buildings.ts', "techDone(s, 'T03')"], // T03
  gatherTreeWood: ['actions.ts', "techDone(s, 'T04')"], // T04
  medicalPostMayTreat: ['buildings.ts', "techDone(s, 'T05')"], // T05
  generatorBuildingExtraStressRemoval: ['buildings.ts', "techDone(s, 'T06')"], // T06
  gatherUpTo3ResourcesAnySpacesOnTile: ['actions.ts', "techDone(s, 'T07')"], // T07
  constructSubactions: ['buildings.ts', "techDone(s, 'T08')"], // T08
  dismantleGainWood: ['buildings.ts', "techDone(s, 'T08')"], // T08
  steamHubCoalHeatsTileAndAdjacentIfHeatAboveRed: ['actions.ts', "act:steamHub"], // T09 (Steam Hub building action)
  sawmillWallDrillExtraWood: ['buildings.ts', "techDone(s, 'T10')"], // T10
  removeSnowAlwaysHeated: ['actions.ts', "techDone(s, 'T11')"], // T11
  heatedMedicalSleepingSlotEngineer: ['buildings.ts', "techDone(s, 'T12')"], // T12
  coalThumperExtraCoal: ['buildings.ts', "techDone(s, 'T13')"], // T13
  hothouseEngineerMayLowerCorpseFor3Food: ['buildings.ts', "techDone(s, 'T15')"], // T15
  cookhouseChildMeepleAllowed: ['buildings.ts', "techDone(s, 'T16')"], // T16
  automatonMayUseAnyBuilding: ['buildings.ts', "techDone(s, 'T17')"], // T17
  automatonFreeIfHeatAboveRed: ['actions.ts', "techDone(s, 'T17')"], // T17
};

const techs: any[] = Object.values(D.techs as Record<string, any>);
const modKeys = (t: any): string[] => (t.mod ?? []).map((m: string) => String(m).split(':')[0]);

describe('technology mod keys (audit 4)', () => {
  it('every mod key on a Technology has an implementation entry', () => {
    const unmapped = techs.flatMap((t) => modKeys(t).map((k) => `${t.id}:${k}`)).filter((k) => !IMPL[k.split(':')[1]]);
    expect(unmapped).toEqual([]);
  });

  it('every entry in the map is a live mod key (no stale rows)', () => {
    const live = new Set(techs.flatMap(modKeys));
    const stale = Object.keys(IMPL).filter((k) => !live.has(k));
    expect(stale).toEqual([]);
  });

  it('each mapped implementation marker still exists in its source file', () => {
    const missing = Object.entries(IMPL)
      .filter(([, [file, marker]]) => !readSrc(file).includes(marker))
      .map(([key, [file, marker]]) => `${key} -> ${file} ${marker}`);
    expect(missing).toEqual([]);
  });

  it('the weather arrays of T02 and T14 are live (read by tech.ts)', () => {
    expect(readSrc('tech.ts')).toContain('weather');
    const weatherTechs = techs.filter((t) => Array.isArray(t.weather)).map((t) => t.id);
    expect(weatherTechs.sort()).toEqual(['T02', 'T14']);
  });
});
