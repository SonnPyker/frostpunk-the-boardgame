// Small shared helpers (no dependencies).

export function assertNever(x: never): never {
  throw new Error('unhandled variant: ' + JSON.stringify(x));
}

/** Token bucket: `capacity` messages burst, refilled at `refillPerSec`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  /** Takes one token. Returns false when the bucket is empty. */
  take(): boolean {
    const t = this.now();
    const elapsed = Math.max(0, t - this.last) / 1000;
    this.last = t;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * Refused frames inside a sliding time window. Accepted frames do not clear it, so a client cannot keep the count down by
 * interleaving valid frames; the socket is closed when `limit` refusals fall inside `windowMs`.
 */
export class RefusalWindow {
  private readonly times: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records one refused frame. Returns true when the socket should now be closed. */
  refuse(): boolean {
    const t = this.now();
    this.times.push(t);
    while (this.times.length > 0 && this.times[0] <= t - this.windowMs) this.times.shift();
    return this.times.length >= this.limit;
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
