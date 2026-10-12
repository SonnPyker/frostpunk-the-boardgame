// Inline SVG icon set (24x24, stroke + currentColor) and the colour-blind-safe tone marker.
import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';

export type IconName =
  | 'wood'
  | 'coal'
  | 'core'
  | 'steel'
  | 'food'
  | 'hunger'
  | 'sick'
  | 'skull'
  | 'syringe'
  | 'worker'
  | 'engineer'
  | 'child'
  | 'automaton'
  | 'hope'
  | 'discontent'
  | 'heat'
  | 'cold'
  | 'close'
  | 'check'
  | 'warning'
  | 'sound'
  | 'mute'
  | 'book'
  | 'gear';

const G: Record<IconName, ReactNode> = {
  wood: (
    <>
      <rect x="3" y="6.5" width="15.5" height="4.6" rx="2.3" />
      <rect x="5.5" y="12.9" width="15.5" height="4.6" rx="2.3" />
      <circle cx="5.6" cy="8.8" r="0.9" />
      <circle cx="8.1" cy="15.2" r="0.9" />
    </>
  ),
  coal: (
    <>
      <path d="M4 17.5 6.3 11.2 10.2 8.4 14.6 7.6 19.6 10.6 20.2 16.6 15.8 19.6 8.1 19.6z" fill="currentColor" fillOpacity="0.22" />
      <path d="M9.5 13.5l2.5-1.2 2.6 1.6" />
    </>
  ),
  core: (
    <>
      <path d="M12 3 19.6 7.4v9.2L12 21l-7.6-4.4V7.4z" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" fillOpacity="0.35" />
    </>
  ),
  steel: (
    <>
      <path d="M3.5 17 6.5 10h11l3 7z" fill="currentColor" fillOpacity="0.2" />
      <path d="M6.5 10 8.5 6.5h7L17.5 10" />
      <path d="M9 13.5h6" />
    </>
  ),
  food: (
    <>
      <path d="M3.5 11h17a8.5 8.5 0 0 1-17 0z" fill="currentColor" fillOpacity="0.2" />
      <path d="M8.5 7.5c0-1.2 1-1.4 1-2.8M12 7.5c0-1.2 1-1.4 1-2.8M15.5 7.5c0-1.2 1-1.4 1-2.8" />
    </>
  ),
  hunger: (
    <>
      <path d="M3.5 11h17a8.5 8.5 0 0 1-17 0z" strokeDasharray="2.2 2.2" />
      <path d="M9.5 15.5h5" />
    </>
  ),
  sick: (
    <>
      <path d="M10 4.5a2 2 0 0 1 4 0V14a4 4 0 1 1-4 0z" />
      <path d="M12 9.5v6.5" />
      <circle cx="12" cy="17.2" r="1.3" fill="currentColor" />
    </>
  ),
  skull: (
    <>
      <path d="M12 3.5a7.5 7.5 0 0 0-7.5 7.5c0 2.5 1.2 4 2.8 4.8V19h9.4v-3.2c1.6-.8 2.8-2.3 2.8-4.8A7.5 7.5 0 0 0 12 3.5z" />
      <circle cx="9" cy="11.5" r="1.7" fill="currentColor" />
      <circle cx="15" cy="11.5" r="1.7" fill="currentColor" />
      <path d="M10 19v2M14 19v2M12 15.2l-.6 1h1.2z" />
    </>
  ),
  syringe: (
    <>
      <path d="M15.5 3.5 20.5 8.5 17.5 11.5 12.5 6.5z" />
      <path d="M12.5 6.5 4 15l-.5 5.5L9 20l8.5-8.5" />
      <path d="M9 11.5l3.5 3.5M6.5 14l.5.5" />
    </>
  ),
  worker: (
    <>
      <circle cx="12" cy="9" r="3.2" />
      <path d="M8.6 8.3a3.4 3.4 0 0 1 6.8 0z" fill="currentColor" fillOpacity="0.3" />
      <path d="M5 20.5c0-3.9 3-6.4 7-6.4s7 2.5 7 6.4" />
    </>
  ),
  engineer: (
    <>
      <circle cx="11" cy="9.5" r="3" />
      <path d="M5.5 20c0-3.7 2.6-6 5.5-6 1.3 0 2.5.4 3.4 1.2" />
      <circle cx="17.5" cy="16.5" r="2.4" />
      <path d="M17.5 13.4v.9M17.5 18.7v.9M14.4 16.5h.9M19.7 16.5h.9" />
    </>
  ),
  child: (
    <>
      <circle cx="12" cy="10" r="2.6" />
      <path d="M7.7 20c0-3 1.9-4.8 4.3-4.8s4.3 1.8 4.3 4.8" />
    </>
  ),
  automaton: (
    <>
      <rect x="5" y="7.5" width="14" height="11" rx="2.5" />
      <circle cx="9.5" cy="12.8" r="1.5" fill="currentColor" />
      <circle cx="14.5" cy="12.8" r="1.5" fill="currentColor" />
      <path d="M12 7.5V4.5M9.8 4.5h4.4" />
    </>
  ),
  hope: (
    <>
      <circle cx="12" cy="14" r="4.3" fill="currentColor" fillOpacity="0.25" />
      <path d="M3 18h18M5.3 12.2 7 13.6M18.7 12.2 17 13.6M12 5.5v2.2" />
    </>
  ),
  discontent: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M7.8 9.2 10.4 10.2M16.2 9.2 13.6 10.2" />
      <path d="M8.6 16.4c1.9-1.7 4.9-1.7 6.8 0" />
    </>
  ),
  heat: (
    <>
      <path
        d="M12 3c1.9 3 5 5 5 9.2a5 5 0 0 1-10 0c0-2.1 1-3.4 2.1-4.6.2 1.8.9 2.9 2 3.5C10.9 7.3 11.2 5.2 12 3z"
        fill="currentColor"
        fillOpacity="0.22"
      />
      <path d="M12 21.2v-2.4" />
    </>
  ),
  cold: (
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
      <path d="M9.6 4.8 12 6.4l2.4-1.6M9.6 19.2 12 17.6l2.4 1.6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M4.5 12.5l4.8 4.5L19.5 7" />,
  warning: (
    <>
      <path d="M12 4 21 19.5H3z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor" fillOpacity="0.2" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor" fillOpacity="0.2" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5c2.6-.8 5.2-.6 8 1.2 2.8-1.8 5.4-2 8-1.2V19c-2.6-.8-5.2-.6-8 1.2-2.8-1.8-5.4-2-8-1.2z" />
      <path d="M12 6.7v13" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7.5" strokeDasharray="3.2 2.6" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, title, className, style, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg
      className={cx('icon', `icon--${name}`, className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={style}
    >
      {title ? <title>{title}</title> : null}
      {G[name]}
    </svg>
  );
}

// ---- colour-blind-safe markers ---------------------------------------------

export type Tone =
  | 'care'
  | 'justice'
  | 'motivation'
  | 'anger'
  | 'apathy'
  | 'greed'
  | 'ok'
  | 'danger'
  | 'ember'
  | 'steel';

export const TONE_COLOR: Record<Tone, string> = {
  care: 'var(--care)',
  justice: 'var(--justice)',
  motivation: 'var(--motivation)',
  anger: 'var(--anger)',
  apathy: 'var(--apathy)',
  greed: 'var(--greed)',
  ok: 'var(--ok)',
  danger: 'var(--danger)',
  ember: 'var(--ember)',
  steel: 'var(--steel-hi)',
};

/** Each tone also has a shape, shown when the colour-blind option is on (Settings). */
const SHAPE: Record<Tone, string> = {
  care: 'M5 1.5 L8.5 5 L5 8.5 L1.5 5 Z', // diamond
  justice: 'M1.5 1.5h7v7h-7z', // square
  motivation: 'M5 1 L9 8.5 H1 Z', // triangle
  anger: 'M5 0.5 L9.5 5 L5 9.5 L0.5 5 Z', // diamond, tall
  apathy: 'M1 3.5h8v3H1z', // bar
  greed: 'M5 0.8 L9.2 3.9 L7.6 9.1 H2.4 L0.8 3.9 Z', // pentagon
  ok: 'M1.5 5.2 4 7.7 8.5 2.2', // tick
  danger: 'M5 0.8 L9.2 9.2 H0.8 Z', // warning triangle
  ember: 'M5 .5 L6.2 3.8 9.5 5 6.2 6.2 5 9.5 3.8 6.2 .5 5 3.8 3.8 Z', // star
  steel: 'M1.5 1.5h7v7h-7z',
};

export interface ToneMarkProps {
  tone: Tone;
  size?: number;
  title?: string;
  className?: string;
}

/**
 * A small dot in the tone colour. With Settings > Colour-blind markers on, a distinct shape is drawn next to it so
 * no meaning depends on hue alone. Visibility follows the `data-cb` attribute on <html> (no React subscription).
 */
export function ToneMark({ tone, size = 10, title, className }: ToneMarkProps) {
  return (
    <span className={cx('tone', `tone--${tone}`, className)} title={title} style={{ color: TONE_COLOR[tone] }}>
      <span className="tone__dot" style={{ width: size, height: size, background: TONE_COLOR[tone] }} />
      <svg className="tone__shape" width={size + 2} height={size + 2} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <path d={SHAPE[tone]} fill="currentColor" />
      </svg>
    </span>
  );
}
