// Minimal WebSocket test client: keeps every frame, and lets a test wait for a frame that matches a predicate.
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '../../../packages/engine/src/protocol';

type Pred = (m: ServerMessage) => boolean;
type Typed<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

export class WsClient {
  /** Every frame received, in order. */
  readonly all: ServerMessage[] = [];
  /** Frames not yet consumed by take(). */
  private inbox: ServerMessage[] = [];
  private waiters: { pred: Pred; resolve: (m: ServerMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; label: string }[] = [];
  closed: { code: number; reason: string } | null = null;
  private readonly socket: WebSocket;
  readonly opened: Promise<void>;

  constructor(url: string, readonly label = 'client') {
    this.socket = new WebSocket(url);
    this.opened = new Promise<void>((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
    });
    this.socket.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      this.all.push(msg);
      this.inbox.push(msg);
      this.wake();
    });
    this.socket.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      for (const w of this.waiters.splice(0)) {
        clearTimeout(w.timer);
        w.reject(new Error(`${this.label}: socket closed (${code}) while waiting for ${w.label}`));
      }
    });
    this.socket.on('error', () => {
      /* surfaced through close / waiters */
    });
  }

  static async connect(url: string, label?: string): Promise<WsClient> {
    const c = new WsClient(url, label);
    await c.opened;
    await c.take('welcome');
    return c;
  }

  send(msg: ClientMessage | Record<string, unknown>): void {
    this.socket.send(JSON.stringify(msg));
  }

  /** Sends a raw text frame (for malformed-input tests). */
  sendRaw(text: string): void {
    this.socket.send(text);
  }

  /** Sends a binary frame (for the binary-frame rate limit test). */
  sendBinary(bytes: Buffer): void {
    this.socket.send(bytes, { binary: true });
  }

  /** Resolves with the first unconsumed frame of type `t` matching `pred`, and removes it from the inbox. */
  take<T extends ServerMessage['t']>(t: T, pred: (m: Typed<T>) => boolean = () => true, timeoutMs = 5000): Promise<Typed<T>> {
    const match: Pred = (m) => m.t === t && pred(m as Typed<T>);
    const hit = this.inbox.findIndex(match);
    if (hit >= 0) {
      const [m] = this.inbox.splice(hit, 1);
      return Promise.resolve(m as Typed<T>);
    }
    return new Promise<Typed<T>>((resolve, reject) => {
      const label = `${t}`;
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== wrapped);
        reject(new Error(`${this.label}: timed out waiting for ${label}; last frames: ${this.recent()}`));
      }, timeoutMs);
      const wrapped = (m: ServerMessage) => resolve(m as Typed<T>);
      this.waiters.push({ pred: match, resolve: wrapped, reject, timer, label });
    });
  }

  /** The most recent frame of type `t` received so far (does not consume). */
  latest<T extends ServerMessage['t']>(t: T): Typed<T> | undefined {
    for (let i = this.all.length - 1; i >= 0; i--) {
      const m = this.all[i];
      if (m.t === t) return m as Typed<T>;
    }
    return undefined;
  }

  /** Every frame of type `t` received so far. */
  every<T extends ServerMessage['t']>(t: T): Typed<T>[] {
    return this.all.filter((m): m is Typed<T> => m.t === t);
  }

  /** Waits until the socket closes, returning its close code. */
  waitClosed(timeoutMs = 5000): Promise<{ code: number; reason: string }> {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        if (this.closed) return resolve(this.closed);
        if (Date.now() - t0 > timeoutMs) return reject(new Error(`${this.label}: still open after ${timeoutMs} ms`));
        setTimeout(tick, 10);
      };
      tick();
    });
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close(1000, 'test done');
  }

  get raw(): WebSocket {
    return this.socket;
  }

  private wake(): void {
    for (const w of [...this.waiters]) {
      const idx = this.inbox.findIndex(w.pred);
      if (idx < 0) continue;
      const [m] = this.inbox.splice(idx, 1);
      clearTimeout(w.timer);
      this.waiters = this.waiters.filter((x) => x !== w);
      w.resolve(m);
    }
  }

  private recent(): string {
    return this.all.slice(-5).map((m) => m.t).join(', ') || '(none)';
  }
}
