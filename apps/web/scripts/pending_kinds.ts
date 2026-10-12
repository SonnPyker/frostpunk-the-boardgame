// Decision coverage for the DecisionPanel. Plays many engine games (solo + co-op, all three scenarios, the extra
// pack now and then) with a mix of the scripted pro bot and random legal answers, and records every distinct
// decision shape: (kind, meta keys, option-id shapes). For each shape it keeps a sample prompt, labels and hints and
// flags labels that look like raw ids (e.g. "m:12", "N03:top", "b:4") that the player would see as they are.
//
//   npx tsx scripts/pending_kinds.ts [--games 300] [--seed 1] [--json <file>]
//   (run from E:/Claude/frostpunk-web/apps/web or packages/engine; paths are relative to this file)
import { createGame, answer } from '../../../packages/engine/src/setup';
import '../../../packages/engine/src/index';
import { legalPick } from '../../../packages/engine/src/autoplay';
import { proPick } from '../../../packages/engine/src/bots/pro';
import { checkInvariants } from '../../../packages/engine/src/invariants';
import { seedRng } from '../../../packages/engine/src/rng';
import { writeFileSync } from 'node:fs';
import type { GameConfig, GameState, Pending } from '../../../packages/engine/src/types';

interface Shape {
  kind: string;
  metaKeys: string[];
  optShapes: string[];
  count: number;
  minMax: string;
  who: string;
  anyDisabled: boolean;
  anyHint: boolean;
  disabledSample: string;
  promptSample: string;
  labelSample: string;
  rawLabels: string[];
  srcSample: string;
  games: number;
}

const args = process.argv.slice(2);
const argOf = (name: string, dflt: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const GAMES = Number(argOf('--games', '300'));
const SEED = Number(argOf('--seed', '1'));
const JSON_OUT = argOf('--json', '');

/** Option id shape: digits become '#', so 'm:12' and 'm:3' share the shape 'm:#'. */
export function idShape(id: string): string {
  return id.replace(/\d+/g, '#').replace(/[A-Za-z0-9]{8,}/g, (m) => (/^[a-f0-9]+$/.test(m) ? 'HEX' : m));
}

/** A label is "raw" when a player would read an engine id in it instead of words. */
export function looksRaw(label: string, id: string): boolean {
  if (!label) return true;
  if (label === id) return true;
  if (/^[a-z]{1,8}:[^ ]*$/i.test(label)) return true; // m:12, b:4, act:fuel, mapRemove:coal:2
  if (/^[A-Z]{1,3}\d{2,}(:[a-z]+)?(\|[a-z]+)?$/.test(label)) return true; // N03:top, C04, X01
  if (/\|/.test(label)) return true; // space|res
  if (/^[a-z]+[A-Z][A-Za-z]*$/.test(label)) return true; // camelCase ids such as steamHub
  return false;
}

const shapes = new Map<string, Shape>();
const roundsSeen = new Map<number, number>();

function observe(p: Pending, cfg: GameConfig, gameKey: string) {
  const metaKeys = Object.keys(p.meta ?? {}).sort();
  const optShapes = [...new Set(p.options.map((o) => idShape(o.id)))].sort();
  const key = `${p.kind} | meta:${metaKeys.join(',')} | opts:${optShapes.join(' ; ')}`;
  let sh = shapes.get(key);
  const rawLabels: string[] = [];
  // Engine labels only: friendlyLabel (src/decisions/meta.ts) imports Vite-only modules, so the rendered text is
  // checked in the browser instead (see the spot-check notes).
  for (const o of p.options) if (looksRaw(o.label ?? '', o.id)) rawLabels.push(`${o.id} -> "${o.label ?? ''}"`);
  if (!sh) {
    sh = {
      kind: p.kind,
      metaKeys,
      optShapes,
      count: 0,
      minMax: `${p.min}..${p.max}`,
      who: p.who >= 0 ? 'seat' : 'any',
      anyDisabled: false,
      anyHint: false,
      disabledSample: '',
      promptSample: p.prompt,
      labelSample: p.options[0]?.label ?? '',
      rawLabels: [],
      srcSample: p.src ?? '',
      games: 0,
    };
    shapes.set(key, sh);
  }
  sh.count++;
  sh.minMax = sh.minMax.includes(`${p.min}..${p.max}`) ? sh.minMax : sh.minMax + ` ${p.min}..${p.max}`;
  for (const o of p.options) {
    if (o.disabled) {
      sh.anyDisabled = true;
      if (!sh.disabledSample) sh.disabledSample = `${o.id}: ${o.disabled}`;
    }
    if (o.hint) sh.anyHint = true;
  }
  for (const r of rawLabels) if (sh.rawLabels.length < 6 && !sh.rawLabels.includes(r)) sh.rawLabels.push(r);
  if (!(sh as any)._games) (sh as any)._games = new Set<string>();
  (sh as any)._games.add(gameKey);
  sh.games = (sh as any)._games.size;
  void cfg;
}

function configFor(i: number): GameConfig {
  const scenarios = ['crater', 'frozenGrove', 'dreadnought'] as const;
  const coop = i % 2 === 1;
  const players = coop ? Array.from({ length: 2 + (i % 3) }, (_, k) => ({ name: 'P' + (k + 1) })) : [{ name: 'Solo' }];
  return {
    scenario: scenarios[Math.floor(i / 2) % 3],
    society: 1 + (i % 6),
    difficulty: i % 4 === 3 ? 'hard' : 'normal',
    mode: coop ? 'coop' : 'solo',
    players,
    seed: SEED * 1000 + i,
    extraPack: i % 5 === 0,
  } as GameConfig;
}

let outcomes = { won: 0, lost: 0, stuck: 0, crashed: 0, invariant: 0, playing: 0 };
const stuckNotes: string[] = [];
let totalDecisions = 0;
const t0 = Date.now();

for (let i = 0; i < GAMES; i++) {
  const cfg = configFor(i);
  const gameKey = `${cfg.scenario}/${cfg.mode}/${i}`;
  let s: GameState;
  try {
    s = createGame(cfg);
  } catch (e: any) {
    outcomes.crashed++;
    stuckNotes.push(`${gameKey} setup: ${e?.message ?? e}`);
    continue;
  }
  const st = seedRng(cfg.seed * 7 + 3);
  const useRandom = i % 3 === 0; // a third of the games use random legal answers: more unusual shapes
  let decisions = 0;
  let result: keyof typeof outcomes = 'playing';
  for (;;) {
    const inv = checkInvariants(s);
    if (inv.length) {
      result = 'invariant';
      stuckNotes.push(`${gameKey} invariant: ${inv[0]}`);
      break;
    }
    if (s.status !== 'playing') {
      result = s.status === 'won' ? 'won' : 'lost';
      break;
    }
    if (decisions >= 50000) {
      result = 'stuck';
      stuckNotes.push(`${gameKey} more than 50000 decisions`);
      break;
    }
    const p = s.pending;
    if (!p) {
      result = 'stuck';
      stuckNotes.push(`${gameKey} no pending decision while playing`);
      break;
    }
    observe(p, cfg, gameKey);
    roundsSeen.set(s.round, (roundsSeen.get(s.round) ?? 0) + 1);
    let pick: string[] | null;
    try {
      pick = useRandom ? legalPick(st, p) : proPick(st, s, p);
    } catch (e: any) {
      result = 'crashed';
      stuckNotes.push(`${gameKey} bot crash at ${p.kind}: ${e?.message ?? e}`);
      break;
    }
    if (!pick) {
      result = 'stuck';
      stuckNotes.push(`${gameKey} no legal pick for ${p.kind} (${p.options.length} options, min ${p.min} max ${p.max})`);
      break;
    }
    const who = p.who >= 0 ? p.who : s.leader;
    let r: { ok: boolean; error?: string };
    try {
      r = answer(s, who, p.id, pick);
    } catch (e: any) {
      result = 'crashed';
      stuckNotes.push(`${gameKey} engine crash at ${p.kind}: ${e?.message ?? e}`);
      break;
    }
    if (!r.ok) {
      result = 'stuck';
      stuckNotes.push(`${gameKey} engine rejected a legal ${p.kind} pick: ${r.error}`);
      break;
    }
    decisions++;
  }
  totalDecisions += decisions;
  outcomes[result]++;
}

const list = [...shapes.values()].sort((a, b) => a.kind.localeCompare(b.kind) || b.count - a.count);
const kinds = new Map<string, number>();
for (const sh of list) kinds.set(sh.kind, (kinds.get(sh.kind) ?? 0) + 1);

console.log(`games ${GAMES} (${((Date.now() - t0) / 1000).toFixed(1)}s) decisions ${totalDecisions} outcomes ${JSON.stringify(outcomes)}`);
console.log(`distinct kinds ${kinds.size}: ${[...kinds.entries()].map(([k, n]) => `${k}(${n})`).join(' ')}`);
console.log(`distinct shapes ${list.length}`);
for (const sh of list) {
  console.log(
    `\n[${sh.kind}] n=${sh.count} games=${sh.games} min/max ${sh.minMax} who=${sh.who} meta=[${sh.metaKeys.join(',')}]` +
      `${sh.anyDisabled ? ' disabled-reasons' : ''}${sh.anyHint ? ' hints' : ''}`,
  );
  console.log(`   opts: ${sh.optShapes.join(' ; ')}`);
  console.log(`   prompt: ${sh.promptSample}`);
  console.log(`   src: ${sh.srcSample}  label0: "${sh.labelSample}"`);
  if (sh.disabledSample) console.log(`   disabled e.g. ${sh.disabledSample}`);
  if (sh.rawLabels.length) console.log(`   RAW LABELS: ${sh.rawLabels.join(' | ')}`);
}
console.log(`\nrounds seen: ${[...roundsSeen.keys()].sort((a, b) => a - b).join(',')}`);
console.log(`stuck/crash notes (${stuckNotes.length}):`);
for (const n of stuckNotes.slice(0, 40)) console.log('  ' + n);

if (JSON_OUT) {
  const out = list.map(({ ...sh }) => {
    const copy: any = { ...sh };
    delete copy._games;
    return copy;
  });
  writeFileSync(JSON_OUT, JSON.stringify({ outcomes, shapes: out }, null, 2));
  console.log(`wrote ${JSON_OUT}`);
}
