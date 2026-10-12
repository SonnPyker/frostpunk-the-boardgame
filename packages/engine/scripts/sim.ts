// Full-game simulator (docs/KNOWN_ISSUES.md). Plays whole games with a bot, checks the invariants after every decision,
// catches exceptions and stuck states, and prints a report.
//
//   npx tsx scripts/sim.ts [--games N] [--seed S] [--scenario crater|frozenGrove|dreadnought|all] [--coop] [--extra]
//                          [--smart] [--pro] [--coverage]
//   npm run sim -- --games 200 --smart --coverage
//
// Flags
//   --games N      number of games (default 40). With --scenario all the games cycle through the three scenarios.
//   --seed S       base seed (default 1). Game i uses config seed S*1000+i, so any game can be replayed alone.
//   --scenario X   crater | frozenGrove | dreadnought | all (default all)
//   --coop         co-op (2-4 players, player count cycles) instead of solo
//   --extra        include the extra pack (extraPack: true)
//   --smart        heuristic bot (fuel, Construct/Gathering Post early, never pass while a useful action exists,
//                  Food/Coal over junk, Stockpile when affordable). Without it the bot picks random legal answers.
//   --pro          scripted pro bot (src/bots/pro.ts): per-kind scoring from food, shelter, heat, coal, hope and
//                  discontent state. Takes precedence over --smart.
//   --coverage     report ops, token heads, custom ids and card ids that the games never exercised
//   --show I       print the full decision + log trace of game index I (the same index as in the repro line; use with --games I+1)
//   --mc           Monte-Carlo bot (scripts/bots/mc.ts): strategic decisions are searched with pro-bot rollouts; trivial ones use
//                  the pro bot. Takes precedence over --pro and --smart. Tuned by:
//   --mc-rollouts N  rollouts per candidate (default 32)
//   --mc-top K       candidates per decision from the pro ranking (default 6)
//   --mc-depth N     max decisions per rollout (default 400)
//   --mc-horizon H   rounds per rollout before scoring (default 1 = to the start of the next round)
//   --players N      number of players (N > 1 implies --coop; default cycles 2..4 in co-op)
//   --boost          OUT-OF-RULES late-game test (scripts/bots/boost.ts): before every decision the colony is topped up
//                    (food, fuel, sickness, hunger, corpse, discontent, hope refilled to 6, Generator stress) so the engine
//                    runs the late game and the scenario victory; the pro bot is biased to Workshop, Stockpile, Scouts, Laws
//                    and Technologies. Takes precedence over --mc, --pro and --smart. Not replayable from the seed alone.
//
// Stuck = no pending decision while playing, empty stack, or more than 50000 decisions in one game.
// Crash = an exception thrown by the engine (or a legal bot pick rejected by the engine).
// Invariant = checkInvariants(s) reported a violation after a decision (the game stops there).
import '../src/index';
import * as D from '../src/data';
import { answer, createGame } from '../src/setup';
import { legalPick } from '../src/autoplay';
import { proPick } from '../src/bots/pro';
import { heuristicPick } from '../src/bots/heuristic';
import { boostPick, boostStats, boostTopUp } from './bots/boost';
import { DEFAULT_MC, mcPick, mcStats } from './bots/mc';
import type { McOpts } from './bots/mc';
import { checkInvariants } from '../src/invariants';
import { opNames, setOpTrace } from '../src/core';
import { setFxTrace, tokenHeads } from '../src/fx/core';
import { customIds } from '../src/fx/tokens_cards';
import { seedRng, randInt } from '../src/rng';
import type { GameConfig, GameState, Pending } from '../src/types';

// ---- arguments -------------------------------------------------------------------------------------------------

interface Args {
  games: number;
  seed: number;
  scenario: string;
  coop: boolean;
  extra: boolean;
  smart: boolean;
  pro: boolean;
  society: number; // 0 = cycle societies 1..6 over the game index
  difficulty: string; // '' = cycle normal/normal/normal/hard
  coverage: boolean;
  show: number; // -1 = off; else print the full log of game index `show`
  mc: boolean; // Monte-Carlo bot (scripts/bots/mc.ts)
  mcOpts: McOpts;
  players: number; // 0 = cycle 2..4 in co-op; N > 0 = N players (N > 1 implies co-op)
  boost: boolean; // out-of-rules colony top-up + late-game-biased pro bot (scripts/bots/boost.ts)
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    games: 40,
    seed: 1,
    scenario: 'all',
    coop: false,
    extra: false,
    smart: false,
    pro: false,
    society: 0,
    difficulty: '',
    coverage: false,
    show: -1,
    mc: false,
    mcOpts: { ...DEFAULT_MC },
    players: 0,
    boost: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const next = () => argv[++i];
    if (x === '--games') a.games = Number(next());
    else if (x === '--seed') a.seed = Number(next());
    else if (x === '--scenario') a.scenario = String(next());
    else if (x === '--coop') a.coop = true;
    else if (x === '--extra') a.extra = true;
    else if (x === '--smart') a.smart = true;
    else if (x === '--pro') a.pro = true;
    else if (x === '--society') a.society = Number(next());
    else if (x === '--difficulty') a.difficulty = String(next());
    else if (x === '--coverage') a.coverage = true;
    else if (x === '--show') a.show = Number(next());
    else if (x === '--mc') a.mc = true;
    else if (x === '--mc-rollouts') a.mcOpts.rollouts = Number(next());
    else if (x === '--mc-top') a.mcOpts.top = Number(next());
    else if (x === '--mc-depth') a.mcOpts.depth = Number(next());
    else if (x === '--mc-horizon') a.mcOpts.horizon = Number(next());
    else if (x === '--players') a.players = Number(next());
    else if (x === '--boost') a.boost = true;
    else if (x === '--help' || x === '-h') {
      console.log('usage: npx tsx scripts/sim.ts [--games N] [--seed S] [--scenario crater|frozenGrove|dreadnought|all] [--coop] [--extra] [--smart] [--pro] [--mc [--mc-rollouts N] [--mc-top K] [--mc-depth N] [--mc-horizon H]] [--boost] [--players N] [--coverage] [--show I]');
      process.exit(0);
    } else throw new Error('unknown argument ' + x);
  }
  if (a.players > 1) a.coop = true;
  if (!Number.isInteger(a.players) || a.players < 0 || a.players > 4) throw new Error('--players must be 0..4');
  if (a.mc) {
    const m = a.mcOpts;
    if (!Number.isInteger(m.rollouts) || m.rollouts < 1) throw new Error('--mc-rollouts must be a positive integer');
    if (!Number.isInteger(m.top) || m.top < 1) throw new Error('--mc-top must be a positive integer');
    if (!Number.isInteger(m.depth) || m.depth < 1) throw new Error('--mc-depth must be a positive integer');
    if (!Number.isInteger(m.horizon) || m.horizon < 1) throw new Error('--mc-horizon must be a positive integer');
  }
  if (!Number.isInteger(a.games) || a.games < 1) throw new Error('--games must be a positive integer');
  if (!Number.isInteger(a.seed)) throw new Error('--seed must be an integer');
  if (!['all', 'crater', 'frozenGrove', 'dreadnought'].includes(a.scenario)) throw new Error('bad --scenario ' + a.scenario);
  if (!Number.isInteger(a.society) || a.society < 0 || a.society > 6) throw new Error('--society must be 0 (cycle) or 1..6');
  if (a.difficulty && !['normal', 'hard'].includes(a.difficulty)) throw new Error('bad --difficulty ' + a.difficulty);
  return a;
}

const MAX_DECISIONS = 50000;

// ---- running games ---------------------------------------------------------------------------------------------

interface Outcome {
  cfg: GameConfig;
  botSeed: number;
  status: 'won' | 'lost' | 'stuck' | 'crashed' | 'invariant' | 'playing';
  round: number;
  endReason: string | null;
  decisions: number;
  message?: string; // stuck reason / crash message / invariant text
  frames?: string[];
}

const cov = {
  ops: new Set<string>(),
  heads: new Set<string>(),
  customs: new Set<string>(),
  cards: new Set<string>(),
};

/** The state the engine is running on right now (set by playGame; read by the op trace for --coverage and --boost). */
let curS: GameState | null = null;
let boostOn = false;
/** Last log entry number already scanned, per game (log entries carry the card id in `d.card`). */
const logSeen = new WeakMap<GameState, number>();

function observe(s: GameState) {
  // Dusk and Morning cards can resolve between two decisions (no decision while they are face up), so the log is scanned too
  const from = logSeen.get(s) ?? 0;
  for (const e of s.log) if (e.n > from && e.d && typeof e.d.card === 'string') cov.cards.add(e.d.card);
  logSeen.set(s, s.logN);
  for (const c of [s.morningCard, s.duskCard, s.weatherCard, s.stormCard]) if (c) cov.cards.add(c);
  for (const e of s.events) cov.cards.add(e.card);
  for (const c of s.scenarioDisplay) cov.cards.add(c);
  for (const l of s.laws) if (l.covered) cov.cards.add(l.covered);
  for (const t of s.techs) if (t.state !== 'inactive') cov.cards.add(t.id);
  for (const ex of s.expeditions) for (const c of (ex as any).cards ?? []) cov.cards.add(c.id ?? c);
  for (const p of s.players) {
    for (const c of p.hand) cov.cards.add(c);
    if (p.playedCitizen) cov.cards.add(p.playedCitizen);
    if (p.advisor) cov.cards.add(p.advisor);
  }
  for (const b of s.buildings) cov.cards.add(b.kind);
}

const norm = (x: string) => x.replace(/\d+/g, 'N').replace(/\s+/g, ' ').slice(0, 200);

function frameList(e: any): string[] {
  const lines = String(e?.stack ?? '').split('\n').slice(1);
  const out: string[] = [];
  for (const l of lines) {
    if (!/src[\\/]/.test(l)) continue;
    const m = /at (?:(.+?) \()?(?:.*[\\/])?([^\\/:]+\.ts):\d+/.exec(l);
    if (m) out.push(`${m[1] ?? '?'}@${m[2]}`);
    if (out.length === 3) break;
  }
  return out;
}

let TRACE = false;
let traceN = 0;
function playGame(cfg: GameConfig, botSeed: number, smart: boolean, observing: boolean, pro = false, mc: McOpts | null = null, boost = false): Outcome {
  const base = { cfg, botSeed, round: 0, endReason: null as string | null, decisions: 0 };
  let s: GameState;
  try {
    s = createGame(cfg);
  } catch (e: any) {
    return { ...base, status: 'crashed', message: 'setup: ' + String(e?.message ?? e), frames: frameList(e) };
  }
  const st = seedRng(botSeed);
  let decisions = 0;
  const finish = (status: Outcome['status'], message?: string, frames?: string[]): Outcome => ({
    ...base,
    status,
    round: s.round,
    endReason: s.endReason,
    decisions,
    message,
    frames,
  });
  for (;;) {
    curS = s;
    if (observing) observe(s);
    const inv = checkInvariants(s);
    if (inv.length) return finish('invariant', inv[0]);
    if (s.status !== 'playing') return finish(s.status);
    if (decisions >= MAX_DECISIONS) return finish('stuck', `more than ${MAX_DECISIONS} decisions`);
    // --boost: out-of-rules colony top-up before each decision (round starts included); see scripts/bots/boost.ts
    if (boost) boostTopUp(s);
    const p = s.pending;
    if (!p) return finish('stuck', 'no pending decision while the game is playing (stack empty)');
    if (TRACE) console.log(`>> r${s.round} ${s.phase} pending ${p.kind} who=${p.who}: ${p.prompt} -> ${p.options.filter((o) => !o.disabled).map((o) => o.id + (o.label ? ' (' + o.label + ')' : '')).slice(0, 12).join(' | ')}`);
    let pick: string[] | null;
    try {
      pick = boost ? boostPick(st, s, p) : mc ? mcPick(st, s, p, mc, (botSeed * 1000003 + decisions * 7919 + 17) >>> 0) : pro ? proPick(st, s, p) : smart ? heuristicPick(st, s, p) : legalPick(st, p);
    } catch (e: any) {
      return finish('crashed', 'bot: ' + String(e?.message ?? e), frameList(e));
    }
    if (!pick) return finish('stuck', `no legal pick for ${p.kind} (${p.options.length} options, min ${p.min} max ${p.max})`);
    const who = p.who >= 0 ? p.who : s.leader;
    let r: { ok: boolean; error?: string };
    try {
      r = answer(s, who, p.id, pick);
    } catch (e: any) {
      return finish('crashed', String(e?.message ?? e), frameList(e));
    }
    if (!r.ok) return finish('stuck', `engine rejected a legal ${p.kind} pick: ${r.error}`);
    decisions++;
    if (TRACE) {
      for (const e of s.log) if (e.n > traceN) console.log(`  [r${e.r} ${e.p}] ${e.t}: ${e.m}`);
      traceN = s.logN;
    }
  }
}

// ---- report ----------------------------------------------------------------------------------------------------

function configFor(a: Args, i: number): GameConfig {
  const scenarios = ['crater', 'frozenGrove', 'dreadnought'] as const;
  const scenario = a.scenario === 'all' ? scenarios[i % 3] : (a.scenario as GameConfig['scenario']);
  const nPlayers = a.players || 2 + (i % 3);
  const players = a.coop ? Array.from({ length: nPlayers }, (_, k) => ({ name: 'P' + (k + 1) })) : [{ name: 'Solo' }];
  return {
    scenario,
    society: a.society || 1 + (i % 6),
    difficulty: (a.difficulty || (i % 4 === 3 ? 'hard' : 'normal')) as GameConfig['difficulty'],
    mode: a.coop ? 'coop' : 'solo',
    players,
    seed: a.seed * 1000 + i,
    extraPack: a.extra,
  };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  boostOn = a.boost;
  if (a.coverage || a.boost) {
    setOpTrace((n) => {
      // --boost: the colony top-up also runs before every engine op, so no op sees a starved colony (between decisions too)
      if (boostOn && curS) boostTopUp(curS);
      if (!a.coverage) return;
      cov.ops.add(n);
      // a Dusk or Morning card drawn by the op that follows is seen here even when no decision comes before it resolves
      if (curS) {
        if (curS.duskCard) cov.cards.add(curS.duskCard);
        if (curS.morningCard) cov.cards.add(curS.morningCard);
      }
    });
  }
  if (a.coverage) setFxTrace((n) => (n.startsWith('custom:') ? cov.customs.add(n) : cov.heads.add(n)));
  const t0 = Date.now();
  const outcomes: Outcome[] = [];
  for (let i = 0; i < a.games; i++) {
    const cfg = configFor(a, i);
    if (a.show >= 0) {
      if (i !== a.show) continue;
      TRACE = true;
      console.log('cfg ' + JSON.stringify(cfg));
    }
    outcomes.push(playGame(cfg, cfg.seed * 7 + 3, a.smart, a.coverage, a.pro, a.mc ? a.mcOpts : null, a.boost));
    if (a.show >= 0) {
      TRACE = false;
      console.log('END ' + outcomes[outcomes.length - 1].status + ' ' + outcomes[outcomes.length - 1].endReason);
    }
  }
  if (a.show >= 0) return;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const count = (f: (o: Outcome) => boolean) => outcomes.filter(f).length;
  const botName = a.boost ? 'boost(pro)' : a.mc ? `mc(r${a.mcOpts.rollouts},k${a.mcOpts.top},d${a.mcOpts.depth},h${a.mcOpts.horizon})` : a.pro ? 'pro' : a.smart ? 'smart' : 'random';
  console.log(`Simulator: ${a.games} games, scenario=${a.scenario} mode=${a.coop ? 'coop' : 'solo'} extra=${a.extra} bot=${botName} seed=${a.seed} (${secs}s)`);
  console.log(
    `games ${a.games}  won ${count((o) => o.status === 'won')}  lost ${count((o) => o.status === 'lost')}  stuck ${count((o) => o.status === 'stuck')}  crashed ${count((o) => o.status === 'crashed')}  invariant ${count((o) => o.status === 'invariant')}`,
  );
  const dec = outcomes.map((o) => o.decisions).sort((x, y) => x - y);
  console.log(`decisions per game: median ${dec[Math.floor(dec.length / 2)] ?? 0}, max ${dec[dec.length - 1] ?? 0}`);
  const lastRounds = outcomes.map((o) => o.round);
  console.log(`last round reached: avg ${(lastRounds.reduce((x, y) => x + y, 0) / Math.max(1, lastRounds.length)).toFixed(2)}, max ${Math.max(0, ...lastRounds)}`);
  if (a.boost) console.log(`boost: top-ups ${boostStats.topUps}, hope tokens conjured (bag empty) ${boostStats.conjuredHope}`);
  if (a.mc) {
    console.log(
      `mc: searches ${mcStats.searches}, candidates ${mcStats.candidates}, rollouts ${mcStats.rollouts}, rollout engine exceptions ${mcStats.rolloutCrashes}, rollout rejects ${mcStats.rolloutRejects}${mcStats.firstCrash ? ' first: ' + mcStats.firstCrash : ''}`,
    );
  }

  const rounds = new Map<number, number>();
  for (const o of outcomes) rounds.set(o.round, (rounds.get(o.round) ?? 0) + 1);
  console.log('round histogram (round where the game ended): ' + [...rounds.entries()].sort((x, y) => x[0] - y[0]).map(([r, n]) => `r${r}:${n}`).join(' '));

  const ends = new Map<string, number>();
  for (const o of outcomes) {
    const k = norm(o.endReason ?? o.status);
    ends.set(k, (ends.get(k) ?? 0) + 1);
  }
  console.log('end-reason histogram:');
  for (const [k, n] of [...ends.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${k}`);

  const classes = (status: Outcome['status']) => {
    const m = new Map<string, { n: number; ex: Outcome }>();
    for (const o of outcomes.filter((x) => x.status === status)) {
      const key = norm(o.message ?? status) + (o.frames?.length ? ' | ' + o.frames.join(' < ') : '');
      const e = m.get(key);
      if (e) e.n++;
      else m.set(key, { n: 1, ex: o });
    }
    return [...m.entries()].sort((x, y) => y[1].n - x[1].n);
  };
  for (const status of ['crashed', 'invariant', 'stuck'] as const) {
    const cl = classes(status);
    if (cl.length === 0) continue;
    console.log(`${status} classes (${cl.length}):`);
    for (const [k, { n, ex }] of cl.slice(0, 20)) {
      console.log(`  ${String(n).padStart(4)}x ${k}`);
      console.log(`        repro: scenario=${ex.cfg.scenario} society=${ex.cfg.society} difficulty=${ex.cfg.difficulty} mode=${ex.cfg.mode} players=${ex.cfg.players.length} extraPack=${ex.cfg.extraPack} seed=${ex.cfg.seed} botSeed=${ex.botSeed} bot=${botName} (round ${ex.round}, decision ${ex.decisions})`);
    }
  }

  if (a.coverage) {
    const never = (all: string[], hit: Set<string>) => all.filter((x) => !hit.has(x)).sort();
    const cardPools: [string, string[]][] = [
      ['citizen cards', Object.keys(D.citizens)],
      ['morning cards', Object.keys(D.morning)],
      ['dusk cards', Object.keys(D.dusk)],
      ['scenario cards', Object.keys(D.scenarioCards)],
      ['law consequences', Object.keys(D.lawConsequences)],
      ['technologies', Object.keys(D.techs)],
      ['weather cards', (D.weatherCards as any[]).map((w) => w.id)],
      ['advisors', Object.keys(D.advisors)],
    ];
    const allCards = cardPools.flatMap(([, ids]) => ids);
    const opsAll = opNames();
    const headsAll = tokenHeads();
    const customAll = customIds().map((c) => 'custom:' + c);
    const report = (label: string, list: string[]) => {
      console.log(`${label}: ${list.length} never exercised${list.length ? ' -> ' + list.slice(0, 80).join(' ') + (list.length > 80 ? ' ...' : '') : ''}`);
    };
    console.log('coverage (union over all games of this run):');
    report(`  ops (${opsAll.length} registered)`, never(opsAll, cov.ops));
    report(`  token heads (${headsAll.length} registered)`, never(headsAll, new Set([...cov.heads].map((h) => h.replace(/^tok:/, '')))));
    report(`  custom ids (${customAll.length} registered)`, never(customAll, cov.customs));
    for (const [label, ids] of cardPools) report(`  ${label} (${ids.length})`, never(ids, cov.cards));
    void allCards;
  }
}

main();
