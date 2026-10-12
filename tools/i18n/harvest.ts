// Harvests every English string the game can show: decision prompts, option labels/hints, log lines (from many
// simulated games), FX descriptions and the display fields of the raw data. Output: scratch/i18n/strings.json.
// Run from the repo root: npx tsx scratch/i18n/harvest.ts [games]
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../packages/engine/src/index';
import { answer, createGame } from '../../packages/engine/src/setup';
import { legalPick } from '../../packages/engine/src/autoplay';
import { seedRng } from '../../packages/engine/src/rng';
import { proPick } from '../../packages/engine/scripts/bots/pro';
import { describe as describeFx } from '../../packages/engine/src/fx/describe';
import type { GameConfig, GameState, Pending } from '../../packages/engine/src/types';

const here = dirname(fileURLToPath(import.meta.url));
const RAW = join(here, '../../packages/engine/src/data/raw');
const GAMES = Number(process.argv[2] ?? 150);

type Cat = string;
interface Rec { en: string; cats: Set<Cat>; example: string }
const seen = new Map<string, Rec>();

function add(en: string | undefined, cat: Cat, where = '') {
  if (typeof en !== 'string') return;
  const t = en.trim();
  if (!t || t.length > 600) return;
  let r = seen.get(t);
  if (!r) { r = { en: t, cats: new Set(), example: where }; seen.set(t, r); }
  r.cats.add(cat);
}

// ---- 1. simulated games ----------------------------------------------------------------------------------------
const SCEN: GameConfig['scenario'][] = ['crater', 'frozenGrove', 'dreadnought'];
let played = 0;
let decisions = 0;
let stuck = 0;
for (let g = 0; g < GAMES; g++) {
  const solo = g % 3 !== 0;
  const n = solo ? 1 : 2 + (g % 3);
  const cfg: GameConfig = {
    scenario: SCEN[g % 3],
    society: (g % 6) + 1,
    difficulty: g % 2 ? 'hard' : 'normal',
    mode: solo ? 'solo' : 'coop',
    players: solo ? [{ name: 'Solo' }] : Array.from({ length: n }, (_, k) => ({ name: 'P' + (k + 1) })),
    seed: 1000 + g,
    extraPack: g % 4 >= 2,
  };
  let s: GameState = createGame(cfg);
  const rng = seedRng(cfg.seed * 7 + 3);
  let lastN = 0;
  let steps = 0;
  const drainLog = () => {
    for (const e of s.log) if (e.n > lastN) { add(e.m, 'log:' + (e.t ?? ''), `game ${g}`); lastN = e.n; }
  };
  drainLog();
  while (s.status === 'playing' && steps < 4000) {
    const p: Pending | null = s.pending;
    if (!p) { stuck++; break; }
    add(p.prompt, 'prompt:' + p.kind, `game ${g}`);
    for (const o of p.options) {
      add(o.label, 'option:' + p.kind, `game ${g}`);
      add(o.hint, 'hint:' + p.kind, `game ${g}`);
      add(o.disabled, 'disabled', `game ${g}`);
    }
    const pick = (g + steps) % 2 === 0 ? legalPick(rng, p) : proPick(rng, s, p) ?? legalPick(rng, p);
    if (!pick) { stuck++; break; }
    const r = answer(s, p.who, p.id, pick);
    if (!r.ok) { stuck++; break; }
    drainLog();
    steps++;
    decisions++;
  }
  played++;
}

// ---- 2. FX descriptions and data display fields -------------------------------------------------------------------
const DISPLAY_KEYS = new Set(['name', 'title', 'label', 'text', 'note', 'hint', 'desc', 'description', 'kind', 'deck', 'intro']);
function safeDescribe(x: any): string | null {
  try { return describeFx(x); } catch { return null; }
}
function walk(node: any, file: string, key = '') {
  if (node == null) return;
  if (typeof node === 'string') {
    if (DISPLAY_KEYS.has(key)) add(node, 'data:' + key, file);
    const d = safeDescribe(node);
    if (d && d !== node && !/^[\[{]/.test(d)) add(d, 'fx', file);
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) walk(x, file, key);
    return;
  }
  if (typeof node === 'object') {
    if (!Array.isArray(node) && Object.keys(node).some((k) => ['choose', 'if', 'ifPay', 'each', 'times', 'spendOr'].includes(k))) {
      const d = safeDescribe(node);
      if (d && !/^[\[{]/.test(d) && !d.includes('"')) add(d, 'fx', file);
    }
    for (const [k, v] of Object.entries(node)) walk(v, file, k);
  }
}
for (const f of readdirSync(RAW).filter((x) => x.endsWith('.json'))) {
  const json = JSON.parse(readFileSync(join(RAW, f), 'utf8'));
  walk(json, f);
}

// ---- output ----------------------------------------------------------------------------------------------------
const out = [...seen.values()]
  .map((r) => ({ en: r.en, cats: [...r.cats].sort(), example: r.example }))
  .sort((a, b) => a.en.localeCompare(b.en));
writeFileSync(join(here, 'strings.json'), JSON.stringify(out, null, 1), 'utf8');
const byCat: Record<string, number> = {};
for (const r of out) for (const c of r.cats) { const k = c.split(':')[0]; byCat[k] = (byCat[k] ?? 0) + 1; }
console.log(JSON.stringify({ games: played, decisions, stuck, unique: out.length, byCat }, null, 1));
