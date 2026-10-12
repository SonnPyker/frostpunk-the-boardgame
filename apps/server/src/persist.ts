// Ordered, retrying write queue. One queue per game: writes run strictly in the order they were enqueued, so the
// command log keeps its sequence. A failing write is retried with capped exponential backoff; after the last attempt
// it is logged and dropped so that later writes can still land. Enqueueing never throws and never blocks the game.
import { errorMessage } from './util';

export interface RetryPolicy {
  /** Total attempts per write (1 = no retry). */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type QueueLogFn = (level: 'info' | 'warn' | 'error', msg: string, extra?: unknown) => void;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class WriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  private failedJobs = 0;

  constructor(
    private readonly context: string,
    private readonly policy: RetryPolicy,
    private readonly log: QueueLogFn,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  /** Writes that have not finished yet (queued or retrying). */
  get pending(): number {
    return this.queued;
  }

  /** Writes given up after the last attempt. */
  get failed(): number {
    return this.failedJobs;
  }

  enqueue(label: string, job: () => Promise<void>): void {
    this.queued++;
    this.tail = this.tail.then(async () => {
      try {
        await this.attempt(label, job);
      } finally {
        this.queued--;
      }
    });
  }

  /** Resolves once everything enqueued so far has either succeeded or been given up. Never rejects. */
  idle(): Promise<void> {
    return this.tail;
  }

  private async attempt(label: string, job: () => Promise<void>): Promise<void> {
    for (let n = 1; ; n++) {
      try {
        await job();
        return;
      } catch (e) {
        const msg = errorMessage(e);
        if (n >= this.policy.attempts) {
          this.failedJobs++;
          this.log('error', `${this.context}: ${label} dropped after ${n} attempts`, msg);
          return;
        }
        const delay = Math.min(this.policy.maxDelayMs, this.policy.baseDelayMs * 2 ** (n - 1));
        this.log('warn', `${this.context}: ${label} failed (attempt ${n}), retrying in ${delay} ms`, msg);
        await this.sleep(delay);
      }
    }
  }
}
