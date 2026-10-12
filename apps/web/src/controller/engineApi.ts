// The ONLY module that touches the engine's public API (ENGINE_SPEC section 5.1):
//   createGame(config) · answer(s, who, pendingId, pick) · view(s, who) · serialize(s) · deserialize(json)
// The engine index is still being completed, so every entry point is looked up at call time. The web
// build therefore passes before the engine exports these functions; calls then fail with a clear error.
import * as Engine from '@frostpunk/engine';
import type { Command, GameConfig, GameState, StartOverride } from '@frostpunk/engine';

type AnyFn = (...args: unknown[]) => unknown;
const api = Engine as unknown as Record<string, unknown>;

export class EngineUnavailableError extends Error {
  constructor(name: string) {
    super(`The rules engine does not export "${name}" yet.`);
    this.name = 'EngineUnavailableError';
  }
}

function lookup(name: string): AnyFn {
  const f = api[name];
  if (typeof f !== 'function') throw new EngineUnavailableError(name);
  return f as AnyFn;
}

/** true when the engine exposes the full solo API (createGame + answer) */
export function engineReady(): boolean {
  return typeof api.createGame === 'function' && typeof api.answer === 'function';
}

export function createGameState(config: GameConfig): GameState {
  return lookup('createGame')(config) as GameState;
}

/** Rebuilds a game from its config and the recorded answers (engine replay). Throws when a command no longer applies. */
export function replayGame(config: GameConfig, commands: Command[]): GameState {
  return lookup('replay')(config, commands) as GameState;
}

export interface AnswerResult {
  ok: boolean;
  error?: string;
}

/** Applies an answer. MUTATES `s`: callers pass a clone when the previous state must stay intact. */
export function applyAnswer(s: GameState, who: number, pendingId: number, pick: string[]): AnswerResult {
  const r = lookup('answer')(s, who, pendingId, pick) as AnswerResult | undefined;
  if (!r || typeof r !== 'object') return { ok: true };
  return { ok: r.ok !== false, error: r.error };
}

/** Redacted view for a seat. Falls back to the full state when the engine has no view() yet. */
export function viewFor(s: GameState, who: number): GameState {
  if (typeof api.view === 'function') return (api.view as (a: GameState, b: number) => GameState)(s, who);
  return s;
}

export function serializeGame(s: GameState): string {
  if (typeof api.serialize === 'function') return (api.serialize as (a: GameState) => string)(s);
  return JSON.stringify(s);
}

export function deserializeGame(json: string): GameState {
  if (typeof api.deserialize === 'function') return (api.deserialize as (a: string) => GameState)(json);
  return JSON.parse(json) as GameState;
}

/** structuredClone with a JSON fallback (GameState is plain JSON by contract). */
export function cloneState(s: GameState): GameState {
  if (typeof structuredClone === 'function') return structuredClone(s);
  return JSON.parse(JSON.stringify(s)) as GameState;
}

// Tutorial lessons (engine tutorial.ts): plain data and the config that starts one. A lesson is a solo game, so the
// rest of the session (answers, the decision panel, Back to actions) works as in any solo game.
export { LESSONS, LESSON_REFUSED, lessonConfig } from '@frostpunk/engine';
export type { LessonDef, LessonProgress } from '@frostpunk/engine';

/** The limits a custom start is held to (engine START_LIMITS). */
export interface StartLimits {
  citizens: number;
  sick: number;
  automaton: number;
  supply: number;
  corpse: number;
  hope: number;
  discontent: number;
}

export function startLimits(): StartLimits {
  const limits = api.START_LIMITS as StartLimits | undefined;
  if (!limits) throw new EngineUnavailableError('START_LIMITS');
  return limits;
}

/** Throws the engine's reason when the config cannot start (validateConfig). */
export function checkConfig(config: GameConfig): void {
  lookup('validateConfig')(config);
}

/** The starting numbers a config uses: its custom start, or the Society card as printed. */
export function startValuesOf(config: GameConfig): StartOverride {
  return lookup('startValues')(config) as StartOverride;
}

/** One random solo set-up: a playable scenario, a printed Society card, one Advisor and a seed (engine randomSetup). */
export function randomSetupConfig(drawSeed: number, name: string, extraPack: boolean): GameConfig {
  return lookup('randomSetup')(drawSeed, { name, extraPack }) as GameConfig;
}
