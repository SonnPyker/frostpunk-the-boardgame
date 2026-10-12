// Per-viewer HUD preferences (collapsed panels, the active City tab) and a media-query hook. Every storage access is
// wrapped: private windows, blocked site data and previews can throw or return nothing, and the HUD must still render.
import { useEffect, useState } from 'react';

const PREFIX = 'frostpunk.hud.v1.';

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    /* storage unavailable: the preference simply is not remembered */
  }
}

/** A remembered boolean, or the fallback when nothing (or nothing readable) is stored. */
export function readFlag(key: string, fallback: boolean): boolean {
  const v = readPref(key);
  if (v === '1') return true;
  if (v === '0') return false;
  return fallback;
}

export function writeFlag(key: string, value: boolean): void {
  writePref(key, value ? '1' : '0');
}

/** True while the media query matches; follows window resizes. */
export function useMedia(query: string): boolean {
  const get = () => {
    try {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [matches, setMatches] = useState<boolean>(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  return matches;
}
