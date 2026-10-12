// Controller abstraction (docs/UI_SPEC.md section 3). The UI only ever talks to a Controller:
// LocalController runs the engine in the browser (solo), RemoteController talks to apps/server (co-op).
import type { GameState } from '@frostpunk/engine';
import type { ChatLine, RoomView } from './remoteTypes';

export type ConnectionState = 'local' | 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

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
