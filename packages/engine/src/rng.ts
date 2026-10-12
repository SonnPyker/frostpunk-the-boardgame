// Seeded, serialisable RNG (sfc32). The 4 words live in GameState.rng so a game can be saved/resumed/replayed.

export type RngState = [number, number, number, number];

export function seedRng(seed: number): RngState {
  // splitmix32 to expand the seed into 4 words
  let a = seed >>> 0;
  const sm = () => {
    a = (a + 0x9e3779b9) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const st: RngState = [sm(), sm(), sm(), sm()];
  for (let i = 0; i < 12; i++) nextU32(st);
  return st;
}

export function nextU32(st: RngState): number {
  let [a, b, c, d] = st;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) >>> 0;
  st[0] = a >>> 0;
  st[1] = b >>> 0;
  st[2] = c >>> 0;
  st[3] = d >>> 0;
  return t >>> 0;
}

export function rand(st: RngState): number {
  return nextU32(st) / 4294967296;
}

/** integer in [0, n) */
export function randInt(st: RngState, n: number): number {
  if (n <= 1) return 0;
  return Math.floor(rand(st) * n);
}

export function chance(st: RngState, p: number): boolean {
  return rand(st) < p;
}

export function pickOne<T>(st: RngState, arr: readonly T[]): T {
  return arr[randInt(st, arr.length)];
}

/** In-place Fisher–Yates; returns the same array. */
export function shuffle<T>(st: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(st, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}
