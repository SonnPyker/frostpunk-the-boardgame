// Client settings (per browser): volumes, graphics quality, UI scale, colour-blind-safe markers.
// Persisted in localStorage with every access guarded. The 3D map reads `quality` through getSettings().
import { create } from 'zustand';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  /** 0..1, ambient music */
  musicVolume: number;
  /** 0..1, procedural sound effects */
  sfxVolume: number;
  quality: Quality;
  /** 0.85..1.3, applied as CSS zoom on the app root */
  uiScale: number;
  /** adds shape markers next to every colour-coded token (Hope, Discontent, sickness, ...) */
  colourBlind: boolean;
}

const KEY = 'frostpunk.settings.v1';

function detectQuality(): Quality {
  try {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 8;
    if (cores && cores <= 4) return 'low';
    if (cores && cores <= 8) return 'medium';
  } catch {
    // fall through
  }
  return 'high';
}

export function defaultSettings(): Settings {
  return { musicVolume: 0.45, sfxVolume: 0.7, quality: detectQuality(), uiScale: 1, colourBlind: false };
}

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

export function sanitizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const d = defaultSettings();
  const q = raw?.quality;
  return {
    musicVolume: clamp(raw?.musicVolume, 0, 1, d.musicVolume),
    sfxVolume: clamp(raw?.sfxVolume, 0, 1, d.sfxVolume),
    quality: q === 'low' || q === 'medium' || q === 'high' ? q : d.quality,
    uiScale: clamp(raw?.uiScale, 0.85, 1.3, d.uiScale),
    colourBlind: typeof raw?.colourBlind === 'boolean' ? raw.colourBlind : d.colourBlind,
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitizeSettings(raw ? (JSON.parse(raw) as Partial<Settings>) : null);
  } catch {
    return sanitizeSettings(null);
  }
}

function save(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: settings still apply for this session
  }
}

function pickSettings(s: Settings): Settings {
  return {
    musicVolume: s.musicVolume,
    sfxVolume: s.sfxVolume,
    quality: s.quality,
    uiScale: s.uiScale,
    colourBlind: s.colourBlind,
  };
}

export interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsStore>()((set, get) => ({
  ...load(),
  update: (patch) => {
    const next = sanitizeSettings({ ...pickSettings(get()), ...patch });
    save(next);
    set(next);
  },
  reset: () => {
    const next = sanitizeSettings(defaultSettings());
    save(next);
    set(next);
  },
}));

/** Non-reactive read for code outside React (e.g. the map's render loop). */
export function getSettings(): Settings {
  return pickSettings(useSettings.getState());
}

/** Writes the settings that CSS and the document depend on. Called once at start and on every change. */
export function applySettingsToDocument(s: Settings): void {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(s.uiScale));
  root.dataset.cb = s.colourBlind ? 'on' : 'off';
  root.dataset.quality = s.quality;
}
