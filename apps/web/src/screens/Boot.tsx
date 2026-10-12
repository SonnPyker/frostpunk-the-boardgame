// Loading screen shown before the main menu. It waits for the web fonts, the critical board images and the scene's
// GLB models (fetched into the browser cache so the 3D map does not wait for them later).
//   * never blocks for long: after WARMUP_TIMEOUT_MS the menu opens anyway (the warm-up keeps running in the background)
//   * skip on reload: once a full warm-up succeeded for this asset set, the next load opens the menu at once and only
//     refreshes the caches in the background
//   * the player can skip it after SKIP_AFTER_MS
import { useEffect, useState, type ReactNode } from 'react';
import { warmupTargets } from '../components/ui/assets';
import { hashText } from '../controller/persistence';
import { Icon } from '../components/ui';
import { Backdrop } from './Backdrop';
import { t, tn } from '../i18n';

export const WARMUP_TIMEOUT_MS = 15_000;
const SKIP_AFTER_MS = 4_000;
const FONT_FAMILIES = ['400 16px "Oswald"', '600 16px "Oswald"', '400 16px "Barlow Condensed"', '400 16px "Barlow"'];
const CACHE_KEY = 'frostpunk.boot.v1';

const LABELS = ['Stoking the generator', 'Setting the fonts', 'Hauling the board art', 'Raising the city models'];

interface Plan {
  tag: string;
  imageUrls: string[];
  modelUrls: string[];
  total: number;
}

function plan(): Plan {
  const { images, models } = warmupTargets();
  const tag = hashText(`${images.join('|')}#${models.join('|')}`);
  return { tag, imageUrls: images, modelUrls: models, total: 1 + images.length + models.length };
}

function readWarmTag(): string | null {
  try {
    return localStorage.getItem(CACHE_KEY);
  } catch {
    return null;
  }
}

function writeWarmTag(tag: string): void {
  try {
    localStorage.setItem(CACHE_KEY, tag);
  } catch {
    // storage blocked: the screen simply shows again next time
  }
}

function loadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve();
    img.onerror = () => resolve(); // a missing image is not a reason to hold the menu
    img.src = url;
  });
}

function fetchModel(url: string): Promise<void> {
  return fetch(url, { cache: 'force-cache' })
    .then((r) => (r.ok ? r.arrayBuffer() : undefined))
    .then(() => undefined)
    .catch(() => undefined);
}

function fonts(): Promise<void> {
  const doc = document as Document & { fonts?: FontFaceSet };
  if (!doc.fonts) return Promise.resolve();
  return Promise.allSettled([doc.fonts.ready, ...FONT_FAMILIES.map((f) => doc.fonts!.load(f))]).then(() => undefined);
}

/**
 * Runs the warm-up. Resolves true when every target finished, false when the deadline passed first.
 * `onStep` is called as each target completes.
 */
function runWarmup(p: Plan, onStep: (done: number, label: string) => void): Promise<boolean> {
  let done = 0;
  const step = (label: string) => {
    done += 1;
    onStep(done, label);
  };
  const tasks: Promise<void>[] = [fonts().then(() => step(LABELS[1]))];
  for (const url of p.imageUrls) tasks.push(loadImage(url).then(() => step(LABELS[2])));
  for (const url of p.modelUrls) tasks.push(fetchModel(url).then(() => step(LABELS[3])));
  const all = Promise.all(tasks).then(() => true);
  const deadline = new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), WARMUP_TIMEOUT_MS));
  return Promise.race([all, deadline]);
}

export function Boot({ children }: { children: ReactNode }) {
  const [planned] = useState<Plan>(plan);
  const [ready, setReady] = useState<boolean>(() => readWarmTag() === planned.tag);
  const [done, setDone] = useState(0);
  const [label, setLabel] = useState(LABELS[0]);
  const [canSkip, setCanSkip] = useState(false);

  useEffect(() => {
    let alive = true;
    const p = planned;
    const skipTimer = window.setTimeout(() => {
      if (alive) setCanSkip(true);
    }, SKIP_AFTER_MS);
    const finish = (complete: boolean) => {
      window.clearTimeout(skipTimer);
      if (complete) writeWarmTag(p.tag);
      if (alive) setReady(true);
    };

    if (ready) {
      // Cache hit: the menu is already open (see the initial state); refresh the caches quietly.
      void runWarmup(p, () => undefined);
      return () => {
        alive = false;
        window.clearTimeout(skipTimer);
      };
    }

    void runWarmup(p, (count, stepLabel) => {
      if (!alive) return;
      setDone(count);
      setLabel(stepLabel);
    }).then((complete) => finish(complete));

    return () => {
      alive = false;
      window.clearTimeout(skipTimer);
    };
    // The plan is fixed for this page load: the effect runs once.
  }, []);

  if (ready) return <>{children}</>;

  const pct = Math.min(100, Math.round((done / Math.max(1, planned.total)) * 100));
  return (
    <div className="boot" role="status" aria-live="polite" aria-busy="true">
      <Backdrop intensity={0.8} glow="center" />
      <div className="boot__content">
        <p className="label-caps boot__kicker">{tn('A New Home')}</p>
        <h1 className="boot__title">{tn('Frostpunk')}</h1>
        <div
          className="boot__bar"
          role="progressbar"
          aria-label={t('Loading')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span className="boot__fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="boot__label">
          <Icon name="heat" size={14} /> {tn(label)}… <span className="num">{pct}%</span>
        </p>
        {canSkip ? (
          <button type="button" className="boot__skip" onClick={() => setReady(true)}>
            {tn('Continue without waiting')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
