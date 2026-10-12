// Solo controller: the engine runs in this browser tab. Every answer is applied to a clone, so the
// previous state object stays intact for the UI's diff-based animations; then the game is autosaved.
//
// The autosave is the list of answers (engine Command[]) plus the start config: Continue rebuilds the game with
// engine replay() and checks the result against the saved hash. A game whose state cannot be described by answers
// alone (a developer fast-forward adopts a state) is saved as a snapshot instead and is not replayable.
import type { Command, GameConfig, GameState } from '@frostpunk/engine';
import { applyAnswer, cloneState, deserializeGame, replayGame, serializeGame } from './engineApi';
import { SAVE_FORMAT, clearSoloSave, hashText, readSoloSave, writeSoloSave, type SoloSave } from './persistence';
import type { Controller, ControllerSnapshot } from './types';
import { t } from '../i18n';

type Listener = (snap: ControllerSnapshot) => void;

export const STALE_SAVE_MESSAGE = t(
  'The saved game no longer plays back with the current rules, so it was removed. Start a new game to keep playing.',
);
export const NO_SAVE_MESSAGE = t('No saved solo game was found in this browser.');

export type RestoreResult =
  | { ok: true; controller: LocalController }
  | { ok: false; reason: 'none' | 'stale'; message: string };

export class LocalController implements Controller {
  readonly mode = 'solo' as const;
  private state: GameState;
  private readonly config: GameConfig;
  private readonly persist: boolean;
  /** answers applied since the game started; null when the state cannot be rebuilt from answers */
  private commands: Command[] | null;
  private listeners = new Set<Listener>();
  private snap: ControllerSnapshot;
  private disposed = false;

  constructor(state: GameState, config: GameConfig, opts: { persist?: boolean; commands?: Command[] | null } = {}) {
    this.state = state;
    this.config = config;
    this.persist = opts.persist !== false;
    this.commands = opts.commands === undefined ? [] : opts.commands;
    this.snap = {
      mode: 'solo',
      seat: 0,
      state,
      room: null,
      connection: 'local',
      error: null,
      errorSeq: 0,
      seq: 0,
      chat: [],
    };
    this.save();
  }

  /**
   * Restores the autosaved solo game by replaying its answers. A save that no longer replays (the rules changed) or
   * replays to a different state is removed, and the result carries a message for the player instead of an exception.
   */
  static restore(): RestoreResult {
    const saved = readSoloSave();
    if (!saved) return { ok: false, reason: 'none', message: NO_SAVE_MESSAGE };
    try {
      if (saved.v === 1 || saved.kind === 'snapshot') {
        const state = deserializeGame(saved.state);
        return { ok: true, controller: new LocalController(state, saved.config, { commands: null }) };
      }
      const state = replayGame(saved.config, saved.commands);
      if (hashText(serializeGame(state)) !== saved.hash) throw new Error('replay diverged from the saved game');
      return { ok: true, controller: new LocalController(state, saved.config, { commands: saved.commands.slice() }) };
    } catch {
      clearSoloSave();
      return { ok: false, reason: 'stale', message: STALE_SAVE_MESSAGE };
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ControllerSnapshot {
    return this.snap;
  }

  answer(pick: string[]): void {
    if (this.disposed) return;
    const pending = this.state.pending;
    if (!pending || this.state.status !== 'playing') {
      this.fail(t('There is no open decision to answer.'));
      return;
    }
    const next = cloneState(this.state);
    let result: { ok: boolean; error?: string };
    try {
      // Solo: the single human is seat 0, and the engine accepts pending.who = -1 for anyone.
      result = applyAnswer(next, 0, pending.id, pick);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : t('The engine rejected the answer.'));
      return;
    }
    if (!result.ok) {
      this.fail(result.error ?? t('The engine rejected the answer.'));
      return;
    }
    if (this.commands) this.commands = [...this.commands, { who: 0, pendingId: pending.id, pick: [...pick] }];
    this.state = next;
    this.emit({ state: next, error: null, seq: this.snap.seq + 1 });
    this.save();
  }

  /**
   * Replaces the running state (used by the DEV-only fast-forward helper in dev/devHook.ts; production never calls it).
   * The adopted state is not reachable by answers, so the autosave becomes a snapshot.
   */
  adopt(next: GameState): void {
    if (this.disposed) return;
    this.commands = null;
    this.emit({ state: next, error: null, seq: this.snap.seq + 1 });
    this.save();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  /** Removes the autosave, e.g. when the game ended and the player returns to the menu. */
  discardSave(): void {
    clearSoloSave();
  }

  private fail(message: string): void {
    this.emit({ error: message, errorSeq: this.snap.errorSeq + 1 });
  }

  private save(): void {
    if (!this.persist) return;
    try {
      const json = serializeGame(this.state);
      const savedAt = Date.now();
      const save: SoloSave = this.commands
        ? { v: SAVE_FORMAT, kind: 'replay', savedAt, config: this.config, commands: this.commands, hash: hashText(json) }
        : { v: SAVE_FORMAT, kind: 'snapshot', savedAt, config: this.config, state: json };
      writeSoloSave(save);
    } catch {
      // autosave is a convenience; the game keeps running without it
    }
  }

  private emit(patch: Partial<ControllerSnapshot> & { state?: GameState }): void {
    const { state, ...rest } = patch;
    if (state) this.state = state;
    this.snap = { ...this.snap, ...rest, state: this.state };
    for (const l of this.listeners) l(this.snap);
  }
}
