// Falling snow on a 2D canvas (menus and background). Particle count follows the Settings quality.
// Pauses when the tab is hidden, draws a still frame for reduced-motion users.
import { useEffect, useRef } from 'react';
import { useSettings, type Quality } from '../../store/settings';
import { cx } from './cx';

const COUNT: Record<Quality, number> = { low: 70, medium: 130, high: 220 };

interface Flake {
  x: number;
  y: number;
  r: number;
  vy: number;
  drift: number;
  phase: number;
  alpha: number;
}

export interface SnowCanvasProps {
  className?: string;
  /** multiplies the particle count (1 = quality default) */
  intensity?: number;
}

export function SnowCanvas({ className, intensity = 1 }: SnowCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const quality = useSettings((s) => s.quality);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = Math.max(10, Math.round(COUNT[quality] * intensity * (reduce ? 0.4 : 1)));
    let w = 0;
    let h = 0;
    let dpr = 1;
    let flakes: Flake[] = [];
    let raf = 0;
    let last = 0;

    const spawn = (f: Flake, fresh: boolean) => {
      f.x = Math.random() * w;
      f.y = fresh ? Math.random() * h : -4 - Math.random() * 30;
      f.r = 0.6 + Math.random() * 2.2;
      f.vy = 18 + Math.random() * 42 + f.r * 6;
      f.drift = 4 + Math.random() * 10;
      f.phase = Math.random() * Math.PI * 2;
      f.alpha = 0.25 + Math.random() * 0.55;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (flakes.length !== target) {
        flakes = Array.from({ length: target }, () => {
          const f = { x: 0, y: 0, r: 1, vy: 1, drift: 1, phase: 0, alpha: 1 };
          spawn(f, true);
          return f;
        });
      }
    };

    const draw = (dt: number, t: number) => {
      ctx.clearRect(0, 0, w, h);
      const wind = Math.sin(t * 0.00012) * 0.6 + 0.4;
      for (const f of flakes) {
        f.y += f.vy * dt * (reduce ? 0.25 : 1);
        f.x += (Math.sin(t * 0.0009 + f.phase) * f.drift + wind * 12) * dt;
        if (f.y > h + 4 || f.x < -10 || f.x > w + 10) spawn(f, false);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 2.4);
        g.addColorStop(0, `rgba(223,241,248,${f.alpha})`);
        g.addColorStop(1, 'rgba(223,241,248,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      draw(dt, now);
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (raf || reduce) return;
      last = 0;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    resize();
    if (reduce) draw(0.5, 0);
    else start();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [quality, intensity]);

  return <canvas ref={ref} className={cx('snow', className)} aria-hidden="true" />;
}
