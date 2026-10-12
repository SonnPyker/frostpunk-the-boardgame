// Colours of the 3D map. Mirrors the CSS tokens in docs/UI_SPEC.md section 1 (hex values, for three.js).
export const PAL = {
  bg: 0x070b0e,
  fog: 0x0b1218,
  ground: 0x17242d,
  steel: 0x7c93a1,
  steelDark: 0x33454f,
  steelHi: 0xb9cdd8,
  frost: 0xdff1f8,
  snow: 0xd3e2ea,
  snowWarm: 0xefe3cc,
  snowGen: 0xb7cad5,
  snowDread: 0x9aafbe,
  road: 0x5d4a35,
  rock: 0x2c3c46,
  rockHi: 0x4d6470,
  ember: 0xff9b2f,
  emberHi: 0xffc766,
  emberLo: 0x8a4b10,
  danger: 0xff4d3d,
  hope: 0x6fd3ff,
  wood: 0xb07a45,
  woodDark: 0x6e4a2a,
  coal: 0x2a2a2e,
  core: 0xff8a3d,
  steelRes: 0x9fb4c4,
  pine: 0x2f4f47,
  pineDark: 0x1f3731,
  pineSnow: 0xe9f3f7,
  // category body colours
  shelter: 0xa99478,
  production: 0x8a6038,
  law: 0x6f8594,
  scenario: 0x5f7f8c,
  ruin: 0x6b747a,
  // meeples
  meepleWorker: 0xd9a463,
  meepleEngineer: 0x8fd8ff,
  meepleChild: 0xf2ece0,
  meepleAutomaton: 0xaebdc8,
  meepleEye: 0xff8a3d,
} as const;

/** Insulation colours (W white, B blue, Y yellow, O orange, R red). */
export const INS_COLOR: Record<string, number> = {
  W: 0xe8f4fa,
  B: 0x4f9dff,
  Y: 0xf2c94c,
  O: 0xff8a3d,
  R: 0xff4d3d,
};

export const INS_NAME: Record<string, string> = {
  W: 'White',
  B: 'Blue',
  Y: 'Yellow',
  O: 'Orange',
  R: 'Red',
};

export const MEEPLE_NAME: Record<string, string> = {
  worker: 'Worker',
  engineer: 'Engineer',
  child: 'Child',
  automaton: 'Automaton',
  childWorker: 'Child (worker)',
  childEngineer: 'Child (engineer)',
};

/** Building body colour by group (see data/raw/buildings.json groups). */
export function categoryColor(group: string | undefined): number {
  if (!group) return PAL.production;
  if (group === 'shelter') return PAL.shelter;
  if (group === 'law') return PAL.law;
  if (group === 'scenario') return PAL.scenario;
  return PAL.production;
}
