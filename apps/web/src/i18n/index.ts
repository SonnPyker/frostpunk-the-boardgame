// Vietnamese UI for the web client. The engine and the server keep English; this layer translates what the screen shows.
//
// Source strings stay English in the code. t(en) normalises the string into a template (numbers become {0}, {1}, ...
// and player names become {P}), looks the template up in vi.json, and fills the numbers and names back in. A string
// with no entry is shown in English (dev builds log it once), so an untranslated string never breaks the screen.
//
// Game terms that are kept in English (Hope, Steam Core, Meeple ...) are listed in glossary.json. tn(en) wraps them in
// <abbr> so the Vietnamese gloss shows on hover. Use t() for attributes (title, aria-label) and tn() for visible text.
import { createElement, type ReactNode } from 'react';
import { create } from 'zustand';
import viDict from './vi.json';
import glossaryJson from './glossary.json';

export type Lang = 'vi' | 'en';
const LANG_KEY = 'frostpunk.lang';

function readLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'vi';
  } catch {
    return 'vi';
  }
}

interface LangStore {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

/** The UI language. Vietnamese by default; the choice is a per-browser preference (localStorage). */
export const useLang = create<LangStore>()((set) => ({
  lang: readLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // private window or blocked storage: the choice lasts for this page only
    }
    set({ lang });
  },
}));

const dict = viDict as Record<string, string>;
const gloss = glossaryJson as Record<string, string>;

let playerNames: string[] = [];

/** Registers the names of the players in the current game, so log lines that name them can be translated. */
export function setPlayerNames(names: readonly string[]): void {
  playerNames = names.filter((n) => n.length > 0).sort((a, b) => b.length - a.length);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Template {
  key: string;
  nums: string[];
  players: string[];
}

/** Mirrors the harvest normalisation (scratch/i18n/normalize.mjs): player names, then numbers not preceded by a letter. */
function normalise(en: string): Template {
  let s = en;
  const names = playerNames.map((n, i) => [n, `P${i + 1}`] as const);
  for (const [name, token] of names) s = s.replace(new RegExp(`(?<![\\w])${escapeRe(name)}(?![\\w])`, 'g'), token);
  const players: string[] = [];
  s = s.replace(/\bP([1-4])\b/g, (_, d: string) => {
    players.push(playerNames[Number(d) - 1] ?? `P${d}`);
    return '{P}';
  });
  const nums: string[] = [];
  const key = s.replace(/(?<![A-Za-z])\d+/g, (m) => {
    nums.push(m);
    return `{${nums.length - 1}}`;
  });
  return { key, nums, players };
}

function fill(tpl: string, nums: string[], players: string[]): string {
  let pi = 0;
  return tpl.replace(/\{(\d+)\}|\{P\}/g, (m, d: string | undefined) => {
    if (d !== undefined) return nums[Number(d)] ?? m;
    return players[pi++] ?? m;
  });
}

const warned = new Set<string>();

/** The text in the current language. Use for attributes and anywhere a plain string is needed. */
export function t(en: string): string {
  if (!en || useLang.getState().lang === 'en') return en;
  const { key, nums, players } = normalise(en);
  const tpl = dict[key];
  if (tpl === undefined) {
    if (import.meta.env.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] no Vietnamese text for: ${key}`);
    }
    return en;
  }
  return fill(tpl, nums, players);
}

// Longest term first, so "Frozen Grove" is matched before any shorter term inside it.
const TERMS = Object.keys(gloss).sort((a, b) => b.length - a.length);
const TERM_RE = TERMS.length ? new RegExp(`(?<![\\w])(${TERMS.map(escapeRe).join('|')})(?![\\w])`) : null;

/** Visible text in the current language, with the game terms annotated (hover shows the Vietnamese gloss). */
export function tn(en: string): ReactNode {
  const s = t(en);
  if (!TERM_RE || useLang.getState().lang === 'en' || !s) return s;
  const parts = s.split(TERM_RE);
  if (parts.length === 1) return s;
  return parts.map((p, i) =>
    i % 2 === 1 ? createElement('abbr', { key: i, className: 'gl-term', title: gloss[p] ?? p }, p) : p,
  );
}

/** Every glossary term with its Vietnamese gloss, in alphabetical order (for the glossary panel). */
export function glossaryEntries(): { term: string; vi: string }[] {
  return Object.keys(gloss)
    // The all-lowercase keys only exist so that lowercase text ("advisor") gets the same gloss; list the capitalised term.
    .filter((term) => term !== term.toLowerCase())
    .sort((a, b) => a.localeCompare(b))
    .map((term) => ({ term, vi: gloss[term] }));
}
