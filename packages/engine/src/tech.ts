// Technologies (rulebook p38; Dawn p19). Development tokens, Workshop effects and the Technology mods.
//
// Decisions (see docs/ENGINE_SPEC.md §3.5):
// * The first Workshop starts a development (`techStart`): the Leadership holder picks an inactive Technology and its token goes
//   `cost` spaces ahead of the Round marker, never beyond space 15. Only one development at a time; further Workshops add nothing.
// * Dawn (`techDawn`, op techDawnCheck, run after the Round marker moved): if the token is on or behind the Round marker the
//   Technology is developed (token returns active-side up), then the next inactive Technology is chosen (op techNext) and
//   placed the same way. A development that completes in the Action phase (Workshop effect) follows the same rules at once.
// * Workshop effect "move the Development token back 1" (`devMove`): if it reaches the Round marker the Technology develops
//   immediately. Its token is never lower than the Round marker.
// * If no Workshop remains the in-progress token goes back inactive and its progress is lost (`techSyncWorkshops`, run at Dawn;
//   building removal should call it too). Developed Technologies stay.
// * Technology mods are read through `techMod` / `passive` (laws.ts). Weather mods are returned by `techWeatherRuns` as fx lists.
//   T06 (Generator safety) is applied directly in generator.ts. T09 Steam Hub is scenario-only (setup).
import { ask, defOp, log, opt, push } from './core';
import * as D from './data';
import { coverRuns } from './laws';
import type { FxRun } from './laws';
import { runFx } from './fx/core';
import type { Ctx } from './fx/core';
import type { GameState } from './types';
import { bdef, huntingSymbols, meeplesAtSpace } from './util';

export const DEV_MAX_ROUND = 15;

const techTitle = (id: string) => D.techs[id]?.title ?? id;
const techCost = (id: string) => D.techs[id]?.cost ?? 4;

export function hasWorkshop(s: GameState): boolean {
  return s.buildings.some((b) => b.kind === 'workshop' && !b.ruins);
}
export function developingTech(s: GameState) {
  return s.techs.find((t) => t.state === 'developing') ?? null;
}
/** Id of the Technology whose token is on the Round track, or null. */
export function techDeveloping(s: GameState): string | null {
  return developingTech(s)?.id ?? null;
}
/** The Technology is developed (its token is active on the card). */
export function techActive(s: GameState, id: string): boolean {
  return s.techs.some((t) => t.id === id && t.state === 'done');
}

function startDev(s: GameState, t: GameState['techs'][number]) {
  t.state = 'developing';
  t.dueRound = Math.min(DEV_MAX_ROUND, s.round + techCost(t.id));
  s.techInProgress = t.id;
  log(s, 'tech.start', `Started developing ${techTitle(t.id)} (Round ${t.dueRound})`, { tech: t.id, due: t.dueRound });
}

function completeDev(s: GameState, t: GameState['techs'][number]) {
  t.state = 'done';
  t.dueRound = null;
  s.techInProgress = null;
  log(s, 'tech.done', `${techTitle(t.id)} was developed`, { tech: t.id });
  push(s, { k: 'techNext' });
}

/** Workshops are gone: the in-progress token returns inactive and its progress is lost. Safe to call at any time. */
export function techSyncWorkshops(s: GameState) {
  if (hasWorkshop(s)) return;
  const t = developingTech(s);
  if (!t) return;
  t.state = 'inactive';
  t.dueRound = null;
  s.techInProgress = null;
  log(s, 'tech.lost', `No Workshop remains: development of ${techTitle(t.id)} is lost`, { tech: t.id });
}

/** Called when a Workshop is built: starts a development if none is in progress (op techStartCheck). */
export function techStart(s: GameState, who?: number) {
  push(s, { k: 'techStartCheck', who: who ?? s.leader });
}

/** Dawn development check (DAW-03). Push it from the Dawn phase after the Round marker moved. */
export function techDawn(s: GameState) {
  push(s, { k: 'techDawnCheck' });
}

/** Move the in-progress Development token `n` spaces back (Workshop effect, D035 devTokenBack, L02B devToken-1). */
export function devMove(s: GameState, n: number) {
  const t = developingTech(s);
  if (!t) return;
  t.dueRound = (t.dueRound ?? s.round) - n;
  if (t.dueRound <= s.round) {
    log(s, 'tech.early', `Development of ${techTitle(t.id)} reached the Round marker`, { tech: t.id });
    completeDev(s, t);
  } else log(s, 'tech.move', `Development token of ${techTitle(t.id)} moved to Round ${t.dueRound}`, { tech: t.id });
}

/** Token devTokenOnRound: develop the in-progress Technology if its token is on (or behind) the Round marker. */
export function devDueNow(s: GameState) {
  const t = developingTech(s);
  if (t && (t.dueRound ?? 0) <= s.round) completeDev(s, t);
}

function upgradable(s: GameState): boolean {
  return s.buildings.some((b) => {
    if (b.ruins || b.upgraded) return false;
    const up = bdef(b.kind).upgrade;
    if (!up || up === 'special') return false;
    return !b.spaces.some((sp) => meeplesAtSpace(s, sp).length > 0);
  });
}

/** Perform `n` Workshop effects (each: upgrade a building, or move the Development token back 1). */
export function workshopEffects(s: GameState, n: number, ctx: Ctx) {
  if (n <= 0) return;
  push(s, { k: 'techWorkshopStep', left: n, ctx });
}

defOp('techDawnCheck', (s) => {
  techSyncWorkshops(s);
  const t = developingTech(s);
  if (t && (t.dueRound ?? 0) <= s.round) completeDev(s, t);
});

defOp('techStartCheck', (s, op) => {
  if (!hasWorkshop(s) || developingTech(s)) return;
  const inactive = s.techs.filter((t) => t.state === 'inactive');
  if (inactive.length === 0) return;
  ask(s, {
    who: op.who ?? s.leader,
    kind: 'tech',
    prompt: 'Your first Workshop is built: choose a Technology to develop',
    options: inactive.map((t) => opt(t.id, techTitle(t.id), { hint: `${techCost(t.id)} Rounds` })),
    then: { k: 'techPick' },
  });
});

defOp('techNext', (s) => {
  if (developingTech(s) || !hasWorkshop(s)) return;
  const inactive = s.techs.filter((t) => t.state === 'inactive');
  if (inactive.length === 0) return;
  ask(s, {
    who: s.leader,
    kind: 'tech',
    prompt: 'Choose the next Technology to develop',
    options: inactive.map((t) => opt(t.id, techTitle(t.id), { hint: `${techCost(t.id)} Rounds` })),
    then: { k: 'techPick' },
  });
});

defOp('techPick', (s, op) => {
  const id: string | undefined = op.pick?.[0];
  const t = s.techs.find((x) => x.id === id);
  if (!t || t.state !== 'inactive' || developingTech(s)) return;
  startDev(s, t);
});

defOp('techWorkshopStep', (s, op) => {
  if (op.left <= 0) return;
  const ctx: Ctx = op.ctx ?? { who: s.leader };
  const canUp = upgradable(s);
  const canDev = !!developingTech(s);
  ask(s, {
    who: ctx.who ?? s.leader,
    kind: 'choice',
    prompt: `Workshop effect (${op.left} left)`,
    src: ctx.src,
    options: [
      opt('upgrade', 'Upgrade a Building (pay its cost)', { disabled: canUp ? undefined : 'No Building can be upgraded' }),
      opt('dev', 'Move the Development token back 1 space', {
        disabled: canDev ? undefined : 'No Technology is in development',
      }),
    ],
    then: { k: 'techWorkshopPick', left: op.left, ctx },
  });
});

defOp('techWorkshopPick', (s, op) => {
  const ctx: Ctx = op.ctx;
  // pushed first so that the chosen effect (and any development it triggers) runs before the next Workshop effect
  push(s, { k: 'techWorkshopStep', left: op.left - 1, ctx });
  const c: string | undefined = op.pick?.[0];
  if (c === 'upgrade') runFx(s, ['upgradeBuilding'], ctx);
  else if (c === 'dev') devMove(s, 1);
});

// ---- weather and Technology lists ------------------------------------------------------------------------------------

function weatherItem(s: GameState, item: string): string | null {
  let m: RegExpExecArray | null;
  if ((m = /^gain:food:perTwoHuntingSymbols:(\d+)$/.exec(item))) {
    const n = Math.floor(huntingSymbols(s) / 2) * Number(m[1]);
    return n > 0 ? `gain:food:${n}` : null;
  }
  if ((m = /^gain:food:perMapTileWithFoodBonus:(\d+)$/.exec(item))) {
    const n = s.tiles.filter((t) => t.food > 0).length * Number(m[1]);
    return n > 0 ? `gain:food:${n}` : null;
  }
  return item;
}

/** Weather-phase effects of developed Technologies (T02, T14), with the counts already computed. */
export function techWeatherRuns(s: GameState): FxRun[] {
  const out: FxRun[] = [];
  for (const t of s.techs) {
    if (t.state !== 'done') continue;
    const d = D.techs[t.id];
    if (!d?.weather) continue;
    const list = (d.weather as string[]).map((x) => weatherItem(s, x)).filter((x): x is string => x !== null);
    if (list.length) out.push({ src: `tech:${t.id}`, list });
  }
  return out;
}

/** Everything the Weather phase runs from Technologies and covering Law Consequences, in order. Run each with its src/card. */
export function weatherFxRuns(s: GameState): FxRun[] {
  return [...techWeatherRuns(s), ...coverRuns(s, 'weather')];
}
