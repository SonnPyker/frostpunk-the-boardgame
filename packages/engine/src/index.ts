// Engine public entry (spec §5.1). Keeps the wave-0 re-exports and adds the game API.
// Importing this file registers every op and FX token (side-effect imports below).
import type { GameConfig, GameState } from './types';
import { answer, createGame, validateConfig } from './setup';
import { view as viewOf } from './view';
import type { GameView, ViewOptions } from './view';
import './fx/index';
import './tiles';
import './buildings';
import './expedition';
import './laws';
import './tech';
import './cards';
import './generator';
import './sickness';
import './actions';
import './phases';
import './night';
import './scenario';

export * from './types';
export * as Data from './data';
export * from './data';
export { blankState, blankConfig } from './testing';
export { describe as describeFx } from './fx/describe';
export { seedRng } from './rng';
export { BACK_PICK } from './core';
export * from './protocol';
export { createGame, answer, validateConfig, newGameState, pushSetupOps, CORPSE_MAX } from './setup';
export type { AnswerResult } from './setup';
export type { GameView, PendingView, PlayerSeatView, DeckName, ViewOptions } from './view';
export { autoplay } from './autoplay';
export type { AutoplayResult } from './autoplay';
export { BOT_LEVELS, botPick, botRng } from './bots/level';
export type { BotLevel } from './bots/level';

/** A player's answer to one decision. */
export type Command = { who: number; pendingId: number; pick: string[] };

/**
 * JSON-safe, redacted view of the game for one seat (-1 = spectator). `{ omniscient: true }` is for the simulator and the dev
 * harness only (it includes the hidden decks, Future Law order and Law consequences).
 */
export function view(s: GameState, who: number, opts?: ViewOptions): GameView {
  return viewOf(s, who, opts);
}

export function serialize(s: GameState): string {
  return JSON.stringify(s);
}

export function deserialize(json: string): GameState {
  const s = JSON.parse(json) as GameState;
  if (!s || s.v !== 1) throw new Error('not an engine state (v1)');
  return s;
}

/** Re-plays a recorded game from its config and commands. Same config + commands give the same state. */
export function replay(config: GameConfig, commands: Command[]): GameState {
  validateConfig(config);
  const s = createGame(config);
  for (const c of commands) {
    const r = answer(s, c.who, c.pendingId, c.pick);
    if (!r.ok) throw new Error(`replay rejected command ${c.pendingId}: ${r.error}`);
  }
  return s;
}
