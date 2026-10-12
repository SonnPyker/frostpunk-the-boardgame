// FX tokens: map tiles (Remove Snow, placeTile, Far-tile reordering) and expeditions (Deploy Scouts, bonuses, stacks).
import '../tiles';
import '../expedition';
import { deployScout, expeditionBonus, placeExpedition, scoutsReturnNoReward } from '../expedition';
import type { ScoutKind } from '../expedition';
import { cardDef } from '../cards';
import { pushPlaceTile, pushReveal3, removeSnowAction } from '../tiles';
import type { PlaceMode, SnowVariant } from '../tiles';
import { defTok, N } from './core';

defTok('placeTile', (s, a, ctx) => pushPlaceTile(s, (a[0] ?? 'far') as PlaceMode, ctx.who, ctx.src));

defTok('removeSnow', (s, a, ctx) =>
  removeSnowAction(s, ctx.who, ctx.meeple ?? null, (a[0] ?? 'normal') as SnowVariant, ctx.src),
);

defTok('revealFar3AndReorder', (s, _a, ctx) => pushReveal3(s, ctx.who, ctx.src));

// Passive marker (L04A): read through childRemoveSnowFood() in tiles.ts by the ACTIONS module.
defTok('removeSnowChildSpendFood', () => {
  /* passive: no effect when run as an effect */
});

// A Citizen card that replaces Deploy Scouts (ctx.card) lets only a Meeple of the card's own type become the Scout.
defTok('deployScouts', (s, a, ctx) => {
  const t = ctx.card ? cardDef(ctx.card)?.type : undefined;
  const only: ScoutKind | undefined = t === 'worker' || t === 'engineer' ? t : undefined;
  deployScout(s, ctx.who, { replaceWithB: a[0] === 'replaceWithB', src: ctx.src, only });
});

defTok('expeditionBonus', (s, a) => expeditionBonus(s, a[0] as 'wood' | 'coal', N(a, 1, 0)));

defTok('scoutsReturnNoReward', (s) => scoutsReturnNoReward(s));

defTok('expedition', (s, a) => {
  if (a[0] === 'place' && a[1]) placeExpedition(s, a[1]);
});
