// Dependency-injection contract between the realtime layer and the rules engine.
// Type-only: importing this file never loads the engine, so tests can supply a fake adapter.
import type { Command, GameConfig } from '@frostpunk/engine';

export type { Command, GameConfig };

export interface EnginePending {
  id: number;
  who: number; // -1 = any seat may answer
  kind: string;
  prompt: string;
  min: number;
  max: number;
  options: { id: string; label: string; disabled?: string }[];
}

/** The subset of GameState the server reads. The real GameState is structurally compatible. */
export interface EngineState {
  status: 'playing' | 'won' | 'lost';
  endReason: string | null;
  round?: number;
  pending: EnginePending | null;
}

export interface AnswerResult {
  ok: boolean;
  error?: string;
}

/** Method syntax on purpose: parameters are compared bivariantly so the real engine functions fit. */
export interface EngineAdapter {
  /** Throws an Error whose message is the rule the configuration breaks (the engine's RuleError text); returns otherwise. */
  validateConfig(config: GameConfig): void;
  createGame(config: GameConfig): EngineState;
  answer(s: EngineState, who: number, pendingId: number, pick: string[]): AnswerResult;
  view(s: EngineState, who: number): unknown;
  serialize(s: EngineState): string;
  deserialize(json: string): EngineState;
  replay(config: GameConfig, commands: Command[]): EngineState;
}
