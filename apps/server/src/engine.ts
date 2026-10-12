// The only module that loads the real rules engine at runtime.
import * as engine from '@frostpunk/engine';
import type { EngineAdapter } from './adapter';

const REQUIRED = ['validateConfig', 'createGame', 'answer', 'view', 'serialize', 'deserialize', 'replay'] as const;

export function loadRealEngine(): EngineAdapter {
  const missing = REQUIRED.filter((name) => typeof (engine as Record<string, unknown>)[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(`rules engine not ready: @frostpunk/engine does not export ${missing.join(', ')} yet`);
  }
  return {
    validateConfig: engine.validateConfig,
    createGame: engine.createGame,
    answer: engine.answer,
    view: engine.view,
    serialize: engine.serialize,
    deserialize: engine.deserialize,
    replay: engine.replay,
  };
}
