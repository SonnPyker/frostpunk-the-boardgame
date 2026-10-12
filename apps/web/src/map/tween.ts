// Minimal tween queue for the map. Each tween calls apply(k) with an eased progress k in 0..1 and then done().
export type Ease = (t: number) => number;

export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack: Ease = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const linear: Ease = (t) => t;

interface Tween {
  elapsed: number;
  delay: number;
  dur: number;
  ease: Ease;
  apply: (k: number) => void;
  done?: () => void;
}

export class Tweens {
  private list: Tween[] = [];

  /** Queue an animation. dur 0 (or instant mode) applies the end state immediately. */
  add(opts: { dur: number; delay?: number; ease?: Ease; apply: (k: number) => void; done?: () => void }, instant = false): void {
    if (instant || opts.dur <= 0) {
      opts.apply(1);
      opts.done?.();
      return;
    }
    this.list.push({
      elapsed: 0,
      delay: opts.delay ?? 0,
      dur: opts.dur,
      ease: opts.ease ?? easeOutCubic,
      apply: opts.apply,
      done: opts.done,
    });
  }

  /** Advance by dt seconds. Returns true while anything is still running. */
  update(dt: number): boolean {
    if (this.list.length === 0) return false;
    const cur = this.list;
    this.list = [];
    const keep: Tween[] = [];
    for (const tw of cur) {
      tw.elapsed += dt;
      const t = (tw.elapsed - tw.delay) / tw.dur;
      if (t < 0) {
        keep.push(tw);
        continue;
      }
      if (t >= 1) {
        tw.apply(1);
        tw.done?.();
      } else {
        tw.apply(tw.ease(t));
        keep.push(tw);
      }
    }
    // tweens queued from inside apply/done are already in this.list
    this.list = keep.concat(this.list);
    return this.list.length > 0;
  }

  get active(): boolean {
    return this.list.length > 0;
  }

  clear(): void {
    this.list = [];
  }
}
