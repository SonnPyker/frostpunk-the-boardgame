// FX tokens: card flow (Dusk deck, Event display, removal / shuffle-back) and the `custom:` dispatcher.
import { addToDusk, cardTitle, currentCardId, eventOf, isSocial, placeEvent, removeEventCard } from '../cards';
import { ask, defOp, log, opt, push } from '../core';
import { shuffle } from '../rng';
import { activeCount } from '../hope';
import type { GameState } from '../types';
import { Ctx, defTok, exec, N, traceFx } from './core';

export type CustomFn = (s: GameState, ctx: Ctx, args: string[]) => void;
const CUSTOM: Record<string, CustomFn> = {};
export function defCustom(id: string, fn: CustomFn) {
  if (CUSTOM[id]) throw new Error('duplicate custom ' + id);
  CUSTOM[id] = fn;
}
export function hasCustom(id: string) {
  return !!CUSTOM[id];
}
export function customIds() {
  return Object.keys(CUSTOM);
}
defTok('custom', (s, a, ctx) => {
  const id = a.join(':');
  const fn = CUSTOM[id] ?? CUSTOM[a[0]];
  if (!fn) throw new Error('Unknown custom handler ' + id);
  traceFx('custom:' + (CUSTOM[id] ? id : a[0]));
  fn(s, ctx, a.slice(1));
});

function setFate(s: GameState, id: string, fate: string) {
  if (s.flags.cur?.id === id) s.flags.cur.fate = fate;
}

defTok('dusk', (s, a) => addToDusk(s, a[0]));

defTok('event', (s, a, ctx) => {
  const id = currentCardId(s, ctx);
  if (!id) return;
  placeEvent(s, id);
  setFate(s, id, 'event');
});

defTok('remove', (s, a, ctx) => {
  const id = currentCardId(s, ctx);
  if (!id) return;
  removeEventCard(s, id);
  if (s.flags.cur?.id === id) {
    s.flags.cur.fate = 'removed';
    log(s, 'card.remove', `${cardTitle(id)} was removed from the game`, { card: id });
  }
});

defTok('removeCard', (s, a) => {
  removeEventCard(s, a[0]);
});

defTok('shuffleBack', (s, a, ctx) => {
  const id = currentCardId(s, ctx);
  if (!id) return;
  removeEventCard(s, id);
  s.decks.dusk.push(id);
  s.decks.dusk = shuffle(s.rng, s.decks.dusk);
  setFate(s, id, 'back');
  log(s, 'card.back', `${cardTitle(id)} was shuffled back into the Dusk deck`, { card: id });
});

defTok('discard', (s, a, ctx) => {
  const id = currentCardId(s, ctx);
  if (!id) return;
  if (isSocial(id)) return exec(s, 'shuffleBack', ctx); // red-icon cards are never discarded
  if (!removeEventCard(s, id, 'discard')) s.decks.duskDiscard.push(id);
  setFate(s, id, 'discard');
  log(s, 'card.discard', `${cardTitle(id)} was placed on the Dusk discard pile`, { card: id });
});

defTok('coverToDiscard', (s, a, ctx) => {
  const id = ctx.card;
  if (!id) return;
  const law = s.laws.find((l) => l.covered === id);
  if (law) law.covered = null;
  s.decks.duskDiscard.push(id);
  log(s, 'card.discard', `${cardTitle(id)} was placed on the Dusk discard pile; the Law is uncovered`, { card: id });
});

// ---- Dusk discard pile ------------------------------------------------------------------------------------------

defTok('retrieveDuskDiscard', (s, a, ctx) => {
  let n = N(a, 0);
  if (a[1] === 'plusPerActiveJustice') n += activeCount(s, 'justice');
  n = Math.min(n, s.decks.duskDiscard.length);
  if (n <= 0) return;
  ask(s, {
    who: ctx.who,
    kind: 'card',
    prompt: `Return ${n} card(s) from the Dusk discard pile to the Dusk deck`,
    src: ctx.src,
    options: s.decks.duskDiscard.map((id) => opt(id, cardTitle(id))),
    min: n,
    max: n,
    then: { k: 'retrieveApply' },
  });
});
defOp('retrieveApply', (s, op) => {
  const ids: string[] = op.pick ?? [];
  for (const id of ids) {
    const i = s.decks.duskDiscard.indexOf(id);
    if (i >= 0) {
      s.decks.duskDiscard.splice(i, 1);
      s.decks.dusk.push(id);
    }
  }
  s.decks.dusk = shuffle(s.rng, s.decks.dusk);
  if (ids.length) log(s, 'dusk.retrieve', `${ids.length} card(s) returned to the Dusk deck`, {});
});

export { eventOf, push };
