// Realtime wire protocol shared by apps/server and apps/web.
// TYPES ONLY: this file must contain no runtime code and no runtime imports.
// Prose documentation for the web-client author lives in docs/NET_PROTOCOL.md.
//
// Transport: one WebSocket per browser tab, JSON text frames, `t` is the discriminant.

import type { GameConfig } from './types';

export type ProtocolVersion = 1;

/** 6 upper-case letters from A-Z without I and O. */
export type RoomCode = string;

export type Scenario = GameConfig['scenario'];
export type Difficulty = GameConfig['difficulty'];
export type Advisor = string | null;

/** Lobby settings chosen by the host. Seats are dense: seat index == engine player index once the game starts. */
export interface LobbySettings {
  roomName: string; // 1..40 chars
  seats: 1 | 2 | 3 | 4; // maximum number of seats (1 = solo)
  scenario: Scenario;
  society: number; // 1..6
  difficulty: Difficulty;
  /** Survivalist Society cards (needs extraPack). Optional: absent means false (the normal/hard cards). */
  survivalist?: boolean;
  extraPack: boolean;
  advisors: Advisor[]; // 0..4 entries
  seed: number; // integer 0..4294967295
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
  code: RoomCode;
  status: RoomStatus;
  settings: LobbySettings;
  players: PlayerView[];
  /** Monotonic: increments with every command applied to the game (0 in the lobby). */
  seq: number;
}

/** Summary of the open decision. Options are delivered inside `view` (redacted per seat). */
export interface PendingSummary {
  id: number;
  who: number; // seat that must answer; -1 = any seat
  kind: string;
  prompt: string;
  min: number;
  max: number;
}

export type GameOutcome = 'playing' | 'won' | 'lost';

export type ErrorCode =
  | 'bad_request' // malformed JSON / fields
  | 'rate_limited'
  | 'already_in_room'
  | 'not_in_room'
  | 'room_not_found'
  | 'room_full'
  | 'wrong_status' // e.g. join after start, start twice
  | 'bad_token' // resume with unknown token
  | 'not_host'
  | 'not_ready' // start while some seat is not ready
  | 'game_over'
  | 'stale_decision' // pendingId does not match the open decision
  | 'not_your_decision' // pending.who is another seat
  | 'invalid_answer' // engine rejected the pick (message has the reason)
  | 'internal';

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

export type ClientMessage =
  /** Optional identity hint. guestId must match /^[A-Za-z0-9_-]{8,64}$/; otherwise the server issues one. */
  | { t: 'hello'; guestId?: string; name?: string }
  /** Create a lobby; the sender takes seat 0 and becomes host. */
  | { t: 'create'; name: string; settings?: Partial<LobbySettings> }
  /** Join a lobby in status 'lobby' (seat assigned by the server). */
  | { t: 'join'; code: string; name: string }
  /** Re-attach to a seat with the token returned by create/join. Works in lobby and during a game. */
  | { t: 'resume'; code: string; token: string }
  /** Host only, lobby only. Partial update of LobbySettings. */
  | { t: 'settings'; settings: Partial<LobbySettings> }
  /** Lobby only. Toggles the sender's ready flag. */
  | { t: 'ready'; ready: boolean }
  /** Host only, lobby only. Every seat must be ready. Creates the engine game. */
  | { t: 'start' }
  /** Answer the open decision. Only the seat in pending.who may answer (-1 = any seat). */
  | { t: 'answer'; pendingId: number; pick: string[] }
  /** Room chat, 1..300 chars. */
  | { t: 'chat'; text: string }
  /** Leave the room. In the lobby the seat is removed; during a game the seat is kept for resume. */
  | { t: 'leave' }
  | { t: 'ping'; ts?: number };

export type ClientMessageType = ClientMessage['t'];

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export type ServerMessage =
  /** Sent right after the socket opens. */
  | { t: 'welcome'; guestId: string; protocol: ProtocolVersion }
  /** Reply to create/join. `token` is the seat secret: store it for resume (sent once). */
  | { t: 'joined'; code: RoomCode; seat: number; token: string }
  /** Reply to resume. */
  | { t: 'resumed'; code: RoomCode; seat: number }
  /** Lobby / roster / presence / status changes. Sent to everybody in the room. */
  | { t: 'room'; room: RoomView }
  /** Per-seat redacted engine view, sent to every attached seat after each change. */
  | {
      t: 'state';
      code: RoomCode;
      seq: number;
      seat: number;
      /** engine view(s, seat); typed as unknown until the engine exports GameView. */
      view: unknown;
      pending: PendingSummary | null;
      status: GameOutcome;
      endReason: string | null;
    }
  /** Sent once to the room when the game finishes (followed by a final `state`). */
  | { t: 'ended'; code: RoomCode; status: Exclude<GameOutcome, 'playing'>; reason: string | null }
  | { t: 'chat'; code: RoomCode; from: { seat: number; name: string }; text: string; ts: number }
  /** Reply to leave. */
  | { t: 'left'; code: RoomCode }
  | { t: 'pong'; ts?: number }
  | { t: 'error'; code: ErrorCode; message: string }
  /** Server is going down; the client should reconnect and `resume` after `reconnectInMs`. */
  | { t: 'shutdown'; reconnectInMs: number };

export type ServerMessageType = ServerMessage['t'];

/** Exhaustiveness helper for client switch statements: `default: return assertNever(msg)`. */
export type Exhaustive<T extends never> = T;
