// Controller abstraction (docs/UI_SPEC.md section 3). The UI only ever talks to a Controller:
// LocalController runs the engine in the browser (solo), RemoteController talks to apps/server (co-op).
import type { BotLevel, GameState } from '@frostpunk/engine';
import type { ChatLine, RoomView } from './remoteTypes';

export type ConnectionState = 'local' | 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Watch mode: how fast the bot plays. `max` applies as many decisions as fit in each frame. */
export type WatchSpeed = '1x' | '2x' | '4x' | 'max';

/** Watch mode only: the bot's progress and the viewer's controls (null or absent in solo and co-op). */
export interface WatchView {
  level: BotLevel;
  speed: WatchSpeed;
  status: 'playing' | 'paused' | 'ended' | 'stuck';
  /** decisions the bot has answered in this game */
  decisions: number;
}

export interface ControllerSnapshot {
  mode: 'solo' | 'coop';
  /** seat this client plays (solo: always 0) */
  seat: number;
  /**
   * The state the UI renders. Solo: the full engine GameState. Co-op: the seat's redacted view
   * (engine view(s, seat)); it is cast to GameState, so only read fields the view keeps.
   */
  state: GameState | null;
  /** lobby / roster information (co-op only) */
  room: RoomView | null;
  connection: ConnectionState;
  /** last error message; cleared by the next successful action */
  error: string | null;
  /** increments on every error so the UI can announce each one once */
  errorSeq: number;
  /** monotonically increasing state version (co-op: server seq; solo: answer count) */
  seq: number;
  chat: ChatLine[];
  /** watch mode: the bot's progress and the viewer's controls */
  watch?: WatchView | null;
}

export interface Controller {
  readonly mode: 'solo' | 'coop';
  /** listeners receive a fresh snapshot object each time something changed */
  subscribe(listener: (snap: ControllerSnapshot) => void): () => void;
  getSnapshot(): ControllerSnapshot;
  /** answer the open decision (addressed to this seat); the pending id is taken from state.pending */
  answer(pick: string[]): void;
  dispose(): void;
}
