// Audit 7 fix PLT-02: board art and face-down card backs are drawn by the HUD (presentation only, no engine change).
//  plt02-a: the manifest holds the boards the HUD draws (board_generator, board_panel_b).
//  plt02-b: GeneratorBoard and SocietyBoard pass that board art to HudPanel, and HudPanel draws it behind the content.
//  plt02-c: the HUD helpers boardArt and cardBackArt read the manifest accessors boardUrl and cardBackUrl.
//  plt02-d: the Event display shows face-down piles whose backs are family backs (never a unique back that reveals a card),
//           and reads only the cards-left counts, never the hidden deck order.
//  plt02-e: hud.css styles the board art backdrop and the deck piles.
// These read the repository files only; they need no browser.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../../', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, ROOT), 'utf8').replace(/\r\n/g, '\n');

const MANIFEST = read('apps/web/src/assets/manifest.ts');
const HUD = 'apps/web/src/hud/';

describe('audit 7 PLT-02: board art and card backs', () => {
  it('plt02-a: the manifest holds the boards drawn by the HUD', () => {
    expect(MANIFEST).toMatch(/"board_generator": \{/);
    expect(MANIFEST).toMatch(/"board_panel_b": \{/);
  });

  it('plt02-b: the generator and society boards draw their board art through HudPanel', () => {
    const gen = read(HUD + 'GeneratorBoard.tsx');
    const soc = read(HUD + 'SocietyBoard.tsx');
    expect(gen).toMatch(/import \{ boardArt \} from '\.\/assets'/);
    expect(gen).toMatch(/art=\{boardArt\('board_generator'\)\}/);
    expect(soc).toMatch(/import \{ boardArt, tokenArt \} from '\.\/assets'/);
    expect(soc).toMatch(/art=\{boardArt\('board_panel_b'\)\}/);

    const ctx = read(HUD + 'context.tsx');
    expect(ctx).toMatch(/art\?: string;/);
    expect(ctx).toMatch(/function BoardArt\(/);
    expect(ctx).toMatch(/props\.art \? <BoardArt url=\{props\.art\} \/>/);
    expect(ctx).toMatch(/\{art \? <BoardArt url=\{art\} \/> : null\}/);
  });

  it('plt02-c: boardArt and cardBackArt resolve through the manifest accessors', () => {
    const assets = read(HUD + 'assets.ts');
    expect(assets).toMatch(/'cardBackUrl'/);
    expect(assets).toMatch(/export const boardArt = \(key: string\)[^\n]*lookup\('boardUrl', key\)/);
    expect(assets).toMatch(/export const cardBackArt = \(id: string\)[^\n]*lookup\('cardBackUrl', id\)/);
    expect(MANIFEST).toMatch(/export function cardBackUrl\(id: string\)/);
    expect(MANIFEST).toMatch(/export function boardUrl\(key: string\)/);
  });

  it('plt02-d: face-down piles use family backs and read only deck counts', () => {
    const ev = read(HUD + 'EventDisplay.tsx');
    const piles = [...ev.matchAll(/\{ key: '(\w+)', label: '[^']+', card: '([A-Za-z0-9_]+)' \}/g)];
    expect(piles.map((m) => m[1])).toEqual(['morning', 'dusk', 'citizen', 'social']);
    for (const [, , card] of piles) {
      // the card's back must be a shared family back (back_*), not a unique "<id>_back" that would reveal the card
      const re = new RegExp(`"${card}": \\{\\s*"back": "(back_[a-z]+)"`);
      expect(MANIFEST, `${card} has a family back`).toMatch(re);
    }
    expect(ev).toMatch(/<DeckPiles s=\{s\} \/>/);
    expect(ev).not.toMatch(/decks\.\w+\[/);
    expect(ev).toMatch(/s\.decks\.morning\.length/);
  });

  it('plt02-e: hud.css styles the board backdrop and the deck piles', () => {
    const css = read(HUD + 'hud.css');
    expect(css).toMatch(/\.hud-board-art \{/);
    expect(css).toMatch(/\.has-board-art/);
    expect(css).toMatch(/\.hud-deck-stack \{/);
    expect(css).toMatch(/\.hud-decks \{/);
  });
});
