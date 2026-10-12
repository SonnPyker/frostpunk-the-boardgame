// Client-side mirror of packages/engine/src/protocol.ts (the wire contract shared with apps/server).
// Kept as a local copy because the engine package only exports "." (deep imports are blocked by its
// "exports" map). Keep this file in sync with protocol.ts; when the engine re-exports the protocol
// from its index, replace this file with a re-export.

import type { GameConfig } from '@frostpunk/engine';

export type ProtocolVersion = 1;
export type Scenario = GameConfig['scenario'];
export type Difficulty = GameConfig['difficulty'];
export type Advisor = string | null;

export interface LobbySettings {
  roomName: string;
  seats: 1 | 2 | 3 | 4;
  scenario: Scenario;
  society: number;
  difficulty: Difficulty;
  extraPack: boolean;
  advisors: Advisor[];
  seed: number;
}

export interface PlayerView {
  seat: number;
  guestId: string;
  name: string;
  host: boolean;
  ready: boolean;
  connected: boolean;
}

export type RoomStatus = 'lobby' | 'playing' | 'ended';

export interface RoomView {
  code: string;
  status: RoomStatus;
  settings: LobbySettings;
  players: PlayerView[];
  seq: number;
}

export interface PendingSummary {
  id: number;
  who: number;
  kind: string;
  prompt: string;
  min: number;
  max: number;
}

export type GameOutcome = 'playing' | 'won' | 'lost';

export type ErrorCode =
  | 'bad_request'
  | 'rate_limited'
  | 'already_in_room'
  | 'not_in_room'
  | 'room_not_found'
  | 'room_full'
  | 'wrong_status'
  | 'bad_token'
  | 'not_host'
  | 'not_ready'
  | 'game_over'
  | 'stale_decision'
  | 'not_your_decision'
  | 'invalid_answer'
  | 'internal';

export type ClientMessage =
  | { t: 'hello'; guestId?: string; name?: string }
  | { t: 'create'; name: string; settings?: Partial<LobbySettings> }
  | { t: 'join'; code: string; name: string }
  | { t: 'resume'; code: string; token: string }
  | { t: 'settings'; settings: Partial<LobbySettings> }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'answer'; pendingId: number; pick: string[] }
  | { t: 'chat'; text: string }
  | { t: 'leave' }
  | { t: 'ping'; ts?: number };

export type ServerMessage =
  | { t: 'welcome'; guestId: string; protocol: ProtocolVersion }
  | { t: 'joined'; code: string; seat: number; token: string }
  | { t: 'resumed'; code: string; seat: number }
  | { t: 'room'; room: RoomView }
  | {
      t: 'state';
      code: string;
      seq: number;
      seat: number;
      /** engine view(s, seat), redacted; options of the open decision live inside view.pending */
      view: unknown;
      pending: PendingSummary | null;
      status: GameOutcome;
      endReason: string | null;
    }
  | { t: 'ended'; code: string; status: Exclude<GameOutcome, 'playing'>; reason: string | null }
  | { t: 'chat'; code: string; from: { seat: number; name: string }; text: string; ts: number }
  | { t: 'left'; code: string }
  | { t: 'pong'; ts?: number }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'shutdown'; reconnectInMs: number };

export interface ChatLine {
  seat: number; // -1 = system
  name: string;
  text: string;
  ts: number;
}
