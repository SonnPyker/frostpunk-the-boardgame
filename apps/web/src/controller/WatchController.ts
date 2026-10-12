// Watch mode: a bot plays a whole game in this tab while the viewer only watches. The viewer controls pause, single
// step and speed. The bot answers through the same engine call as a player (applyAnswer), so every rule still applies.
// Nothing is autosaved: the solo save belongs to the player's own game, and a watched game is not resumed.
import { botPick, botRng, type BotLevel, type GameState } from '@frostpunk/engine';
import { applyAnswer, cloneState } from './engineApi';
import type { Controller, ControllerSnapshot, WatchSpeed, WatchView } from './types';
import { t } from '../i18n';

/** Decisions per second at each fixed speed. `max` has no rate: it applies decisions for as long as a frame allows. */
export const WATCH_SPEEDS: { id: WatchSpeed; label: string; perSecond: number }[] = [
  { id: '1x', label: '1×', perSecond: 2 },
  { id: '2x', label: '2×', perSecond: 4 },
  { id: '4x', label: '4×', perSecond: 10 },
  { id: 'max', label: 'Max', perSecond: Infinity },
];

const TICK_MS = 100;
/** A tick stops applying decisions after this much work, so the page stays responsive at top speed. */
const SLICE_MS = 40;
/** Unspent decisions never pile up beyond this, so a hidden tab does not flood the board when it returns. */
const CREDIT_CAP = 10;

type Listener = (snap: ControllerSnapshot) => void;

export class WatchController implements Controller {
  readonly mode = 'solo' as const;
  private state: GameState;
  private readonly level: BotLevel;
  private readonly rng: ReturnType<typeof botRng>;
  private speed: WatchSpeed = '2x';
  private status: WatchView['status'] = 'playing';
  private decisions = 0;
  /** fractional decisions carried from one tick to the next at a fixed speed */
  private credit = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private snap: ControllerSnapshot;
  private disposed = false;

  constructor(state: GameState, level: BotLevel, seed: number) {
    this.state = state;
    this.level = level;
    this.rng = botRng(seed);
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
      watch: this.view(),
    };
    this.timer = setInterval(() => this.tick(), TICK_MS);
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

  /** The viewer cannot answer: the bot plays every decision. */
  answer(): void {
    this.emit({ error: t('This game is watched, not played.'), errorSeq: this.snap.errorSeq + 1 });
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimer();
    this.listeners.clear();
  }

  /** Pauses a running game or resumes a paused one. A game that ended or got stuck stays so. */
  togglePause(): void {
    if (this.status === 'playing') this.setStatus('paused');
    else if (this.status === 'paused') this.setStatus('playing');
  }

  /** Applies exactly one decision. Meant for a paused game, so the viewer can follow each choice. */
  step(): void {
    if (this.status === 'paused') this.advance(1, Infinity);
  }

  setSpeed(speed: WatchSpeed): void {
    if (this.disposed || speed === this.speed) return;
    this.speed = speed;
    this.credit = 0;
    this.emit({ watch: this.view() });
  }

  private setStatus(status: WatchView['status']): void {
    this.status = status;
    this.credit = 0;
    this.emit({ watch: this.view() });
  }

  private tick(): void {
    if (this.disposed || this.status !== 'playing') return;
    const rate = WATCH_SPEEDS.find((s) => s.id === this.speed)?.perSecond ?? 0;
    if (rate === Infinity) {
      this.advance(Infinity, SLICE_MS);
      return;
    }
    this.credit = Math.min(this.credit + (rate * TICK_MS) / 1000, CREDIT_CAP);
    const due = Math.floor(this.credit);
    this.credit -= due;
    if (due > 0) this.advance(due, SLICE_MS);
  }

  /**
   * Applies up to `maxDecisions` bot answers, or as many as fit in `sliceMs`, on one copy of the state. The UI is
   * told once per batch, and the previous state object stays intact for its diff-based animations.
   */
  private advance(maxDecisions: number, sliceMs: number): void {
    const next = cloneState(this.state);
    const started = performance.now();
    let done = 0;
    let failure: string | null = null;
    while (done < maxDecisions && next.status === 'playing' && performance.now() - started < sliceMs) {
      const p = next.pending;
      if (!p) {
        failure = t('The game is waiting for a decision that does not exist.');
        break;
      }
      const pick = botPick(this.level, this.rng, next, p);
      if (!pick) {
        failure = t('The bot found no legal move, so the game stopped.');
        break;
      }
      const r = applyAnswer(next, p.who >= 0 ? p.who : next.leader, p.id, pick);
      if (!r.ok) {
        failure = r.error ?? t('The engine rejected the bot move.');
        break;
      }
      done += 1;
      this.decisions += 1;
    }
    this.state = next;
    if (failure) {
      this.status = 'stuck';
      this.stopTimer();
      this.emit({ state: next, watch: this.view(), error: failure, errorSeq: this.snap.errorSeq + 1 });
      return;
    }
    if (next.status !== 'playing') {
      this.status = 'ended';
      this.stopTimer();
    }
    this.emit({ state: next, watch: this.view(), seq: this.snap.seq + done });
  }

  private view(): WatchView {
    return { level: this.level, speed: this.speed, status: this.status, decisions: this.decisions };
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private emit(patch: Partial<ControllerSnapshot>): void {
    this.snap = { ...this.snap, ...patch, state: this.state };
    for (const l of this.listeners) l(this.snap);
  }
}
