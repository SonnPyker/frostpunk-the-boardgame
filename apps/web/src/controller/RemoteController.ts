// Co-op controller: one WebSocket per tab to apps/server (wire format in remoteTypes.ts, mirrored from
// packages/engine/src/protocol.ts). The server is authoritative; this class only mirrors what it sends:
// the room roster and, once the game runs, the redacted view of this seat. It reconnects with backoff
// and resumes the seat with the token stored for this tab (sessionStorage), or the localStorage fallback.
import type { GameState } from '@frostpunk/engine';
import {
  adoptFallbackGuestId,
  guestId,
  readCoopSession,
  writeCoopSession,
  type StoredCoopSession,
} from './persistence';
import type { Controller, ControllerSnapshot, ConnectionState } from './types';
import type { ChatLine, ClientMessage, LobbySettings, RoomView, ServerMessage } from './remoteTypes';
import { t } from '../i18n';

type Listener = (snap: ControllerSnapshot) => void;

const MAX_RETRIES = 8;
const PING_MS = 20_000;
const MAX_CHAT = 200;

/** Friendly text for a resume the server refused: the stored seat is forgotten and the player is told why. */
const SEAT_GONE: Record<string, string> = {
  room_not_found: t('That co-op room no longer exists. It may have closed. Host or join a new room.'),
  bad_token: t('Your seat in that room is no longer available. Join again with the room code.'),
};

export class RemoteController implements Controller {
  readonly mode = 'coop' as const;

  private readonly url: string;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private snap: ControllerSnapshot;
  private session: StoredCoopSession | null = null;
  private myName = '';
  private outbox: ClientMessage[] = [];
  private lastSeq = -1;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private leaving = false;
  /** a resume was sent and not answered yet: only then does a bad token or missing room forget the stored seat */
  private resumeInFlight = false;

  constructor(serverUrl: string) {
    this.url = serverUrl;
    this.session = RemoteController.storedSession(serverUrl);
    this.myName = this.session?.name ?? '';
    this.snap = {
      mode: 'coop',
      seat: -1,
      state: null,
      room: null,
      connection: 'idle',
      error: null,
      errorSeq: 0,
      seq: 0,
      chat: [],
    };
  }

  /** The stored co-op session (if any) for this server. */
  static storedSession(serverUrl: string): StoredCoopSession | null {
    const s = readCoopSession();
    return s && s.serverUrl === serverUrl ? s : null;
  }

  /** Whether a seat can be resumed from this browser. */
  hasSession(): boolean {
    return this.session !== null;
  }

  // ---- lifecycle -----------------------------------------------------------

  /** Opens the socket. Lobby commands queued before the socket is ready are sent after `welcome`. */
  connect(): void {
    if (this.disposed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setConnection('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.fail(t('Cannot reach the co-op server. Check the server URL in the build configuration.'));
      this.setConnection('closed');
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'hello', guestId: guestId(), name: this.myName || this.session?.name || undefined });
    };
    ws.onmessage = (ev) => this.onRaw(typeof ev.data === 'string' ? ev.data : '');
    ws.onerror = () => {
      // details arrive through onclose; avoid double reporting
    };
    ws.onclose = () => {
      this.ws = null;
      this.stopPing();
      if (this.disposed || this.leaving) {
        this.setConnection('closed');
        return;
      }
      this.scheduleReconnect(undefined);
    };
    this.startPing();
  }

  /** Host: create a lobby. The sender takes seat 0. */
  create(name: string, settings: Partial<LobbySettings>): void {
    this.myName = name;
    this.enqueue({ t: 'create', name, settings });
  }

  /** Guest: join a lobby by its room code. */
  join(code: string, name: string): void {
    this.myName = name;
    this.enqueue({ t: 'join', code: code.trim().toUpperCase(), name });
  }

  /** Re-attach to the stored seat (after a reload or a dropped connection). */
  resume(): boolean {
    if (!this.session) return false;
    if (this.session.fallback) adoptFallbackGuestId();
    this.enqueue({ t: 'resume', code: this.session.code, token: this.session.token });
    return true;
  }

  updateSettings(settings: Partial<LobbySettings>): void {
    this.send({ t: 'settings', settings });
  }

  setReady(ready: boolean): void {
    this.send({ t: 'ready', ready });
  }

  start(): void {
    this.send({ t: 'start' });
  }

  chat(text: string): void {
    const clean = text.trim().slice(0, 300);
    if (clean) this.send({ t: 'chat', text: clean });
  }

  /** Leaves the room for good: during a game the seat is kept on the server, so use this only in the lobby. */
  leave(): void {
    this.leaving = true;
    this.send({ t: 'leave' });
    this.session = null;
    writeCoopSession(null);
    this.close();
  }

  /** Closes the socket without leaving the room (the seat stays reserved for resume). */
  detach(): void {
    this.close();
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
    const pending = this.snap.state?.pending;
    if (!pending) {
      this.fail(t('There is no open decision to answer.'));
      return;
    }
    this.send({ t: 'answer', pendingId: pending.id, pick });
  }

  dispose(): void {
    this.disposed = true;
    this.close();
    this.listeners.clear();
  }

  // ---- internals -----------------------------------------------------------

  /** Closes the socket on purpose: handlers are detached first so no automatic reconnect follows. */
  private close(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, 'client closed');
    }
    this.setConnection('closed');
  }

  private enqueue(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send(msg);
      return;
    }
    this.outbox.push(msg);
    this.connect();
  }

  private send(msg: ClientMessage): void {
    if (msg.t === 'resume') this.resumeInFlight = true;
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (msg.t === 'create' || msg.t === 'join' || msg.t === 'resume') this.outbox.push(msg);
      else this.fail(t('Not connected to the co-op server.'));
      return;
    }
    ws.send(JSON.stringify(msg));
  }

  private scheduleReconnect(delayMs: number | undefined): void {
    if (this.disposed || this.leaving) return;
    if (this.retries >= MAX_RETRIES) {
      this.setConnection('closed');
      this.fail(t('Lost the connection to the co-op server.'));
      return;
    }
    this.setConnection('reconnecting');
    const wait = delayMs ?? Math.min(12_000, 800 * 2 ** this.retries);
    this.retries += 1;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, wait);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: Date.now() }), PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private onRaw(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.t) {
      case 'welcome': {
        this.retries = 0;
        this.setConnection('open');
        const queued = this.outbox;
        this.outbox = [];
        if (queued.length > 0) {
          for (const m of queued) this.send(m);
        } else if (this.session && !this.resumeInFlight) {
          // a second welcome on the same socket must not send the seat a second time (two refusals)
          this.send({ t: 'resume', code: this.session.code, token: this.session.token });
        }
        return;
      }
      case 'joined': {
        this.resumeInFlight = false;
        this.session = {
          serverUrl: this.url,
          code: msg.code,
          token: msg.token,
          name: this.myName,
        };
        writeCoopSession(this.session);
        this.emit({ seat: msg.seat, error: null });
        return;
      }
      case 'resumed': {
        this.resumeInFlight = false;
        if (this.session?.fallback) {
          // the seat now belongs to this tab too: keep it in sessionStorage as well
          const { serverUrl, code, token, name } = this.session;
          this.session = { serverUrl, code, token, name };
          writeCoopSession(this.session);
        }
        this.emit({ seat: msg.seat, error: null });
        return;
      }
      case 'room': {
        const room: RoomView = msg.room;
        this.emit({ room, seq: Math.max(this.snap.seq, room.seq) });
        return;
      }
      case 'state': {
        if (msg.seq < this.lastSeq) return; // stale frame
        this.lastSeq = msg.seq;
        // view is the engine's redacted view; GameView is a subset of GameState (see ControllerSnapshot.state)
        const state = msg.view as GameState;
        this.emit({ state, seat: msg.seat, seq: msg.seq, error: null });
        return;
      }
      case 'ended': {
        // the seat token stays stored, so the end summary can be revisited after a reload
        const cur = this.snap.state;
        if (cur) {
          const state = { ...cur, status: msg.status, endReason: msg.reason } as GameState;
          this.emit({ state });
        }
        return;
      }
      case 'chat': {
        const line: ChatLine = { seat: msg.from.seat, name: msg.from.name, text: msg.text, ts: msg.ts };
        const chat = [...this.snap.chat, line].slice(-MAX_CHAT);
        this.emit({ chat });
        return;
      }
      case 'left': {
        this.session = null;
        writeCoopSession(null);
        this.emit({ room: null, state: null });
        return;
      }
      case 'pong':
        return;
      case 'error': {
        const answeredResume = this.resumeInFlight;
        this.resumeInFlight = false;
        const gone = SEAT_GONE[msg.code];
        if (answeredResume && gone) {
          // the stored seat (this tab's and the fallback) is refused: forget it and say why
          this.session = null;
          writeCoopSession(null);
          this.fail(gone);
          return;
        }
        this.fail(msg.message || msg.code);
        return;
      }
      case 'shutdown': {
        // reconnect after the server's delay, not with our own backoff
        const ws = this.ws;
        this.ws = null;
        this.stopPing();
        if (ws) {
          ws.onclose = null;
          ws.close(1000, 'server shutdown');
        }
        this.scheduleReconnect(msg.reconnectInMs);
        return;
      }
      default:
        return;
    }
  }

  private setConnection(connection: ConnectionState): void {
    if (this.snap.connection === connection) return;
    this.emit({ connection });
  }

  private fail(message: string): void {
    this.emit({ error: message, errorSeq: this.snap.errorSeq + 1 });
  }

  private emit(patch: Partial<ControllerSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l(this.snap);
  }
}
