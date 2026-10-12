// FX tokens for BUILD (spec 4.1, FX_DSL section 6): buildFree, upgradeFree, upgradeBuilding, destroyBuilding,
// corpseBack, removeTree, gatherAdjacent, thump; customs generatorUpgradeOnFirstCore, cemetery, duskPeek3, prisonStay.
import '../buildings';
import { cardTitle, drawDusk, isSocial } from '../cards';
import { defOp, opt, ask, push, log } from '../core';
import { shuffle } from '../rng';
import { meepleById } from '../util';
import type { GameState } from '../types';
import {
  corpseBackChoice,
  gatheringPostLimit,
  queueBuildFree,
  queueDestroy,
  queueGatherAdjacent,
  queueUpgrade,
  removeTreeChoice,
  thumpCoal,
} from '../buildings';
import { defTok, N, runFx, Ctx } from './core';
import { defCustom } from './tokens_cards';

// ---------------------------------------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------------------------------------

/** buildFree:wood1|maxWood2|upgradedMedicalPost. Builds a building for free under the filter (Successful Project, social cards). */
defTok('buildFree', (s, a, ctx) => {
  queueBuildFree(s, ctx.who, a[0] ?? 'any', ctx.src);
});

/** upgradeScope: the size restriction named by the first argument (small | huntersHutOrHothouse | any). */
const upgradeScope = (a: string[]): 'any' | 'small' | 'huntersHutOrHothouse' =>
  a[0] === 'small' ? 'small' : a[0] === 'huntersHutOrHothouse' ? 'huntersHutOrHothouse' : 'any';

/** upgradeFree:small|huntersHutOrHothouse|any[:ignoreUsed]. Upgrades a building for free within the scope. */
defTok('upgradeFree', (s, a, ctx) => {
  queueUpgrade(s, ctx.who, true, upgradeScope(a), a.includes('ignoreUsed'), ctx.src);
});

/** upgradeBuilding[:small|huntersHutOrHothouse][:ignoreUsed]. Upgrades one building within the scope, paying its upgrade cost (Wood only). */
defTok('upgradeBuilding', (s, a, ctx) => {
  queueUpgrade(s, ctx.who, false, upgradeScope(a), a.includes('ignoreUsed'), ctx.src);
});

/** destroyBuilding:choose|occupied[:N]. Destroys N buildings (Meeples on them return to supply). */
defTok('destroyBuilding', (s, a, ctx) => {
  queueDestroy(s, ctx.who, a[0] ?? 'choose', N(a, 1, 1), ctx.src);
});

/** corpseBack:min-max (choice) or corpseBack:N (fixed). Moves the Corpse marker back. */
defTok('corpseBack', (s, a, ctx) => {
  const r = a[0] ?? '1';
  if (r.includes('-')) {
    const [lo, hi] = r.split('-').map((x) => Number(x));
    corpseBackChoice(s, ctx.who, lo, hi, ctx.src);
  } else {
    push(s, { k: 'bldCorpseDo', pick: [r] });
  }
});

/** removeTree:tile|tileOrAdjacent|any. Removes one Tree in scope (the action fails when there is none). */
defTok('removeTree', (s, a, ctx) => {
  removeTreeChoice(s, ctx.who, ctx.space, a[0] ?? 'tile', ctx.src);
});

/** gatherAdjacent:N. Gathering Post: take one Resource from each adjacent space, N passes; a plain child Meeple is capped (L01). */
defTok('gatherAdjacent', (s, a, ctx) => {
  queueGatherAdjacent(s, ctx.who, ctx.space, N(a, 0, 1), ctx.src, gatheringPostLimit(s, ctx.meeple));
});

/** thump:SPACES:EACH. Coal Thumper: up to SPACES adjacent spaces each receive EACH Coal from the bank. */
defTok('thump', (s, a, ctx) => {
  thumpCoal(s, ctx.who, ctx.space, N(a, 0, 1), N(a, 1, 1), ctx.src);
});

// ---------------------------------------------------------------------------------------------------------
// customs
// ---------------------------------------------------------------------------------------------------------

/** Generator upgrade (special): the first Steam Core put into the Generator upgrades it (idempotent). */
defCustom('generatorUpgradeOnFirstCore', (s: GameState) => {
  if (s.gen.upgraded) return;
  s.gen.upgraded = true;
  log(s, 'generator.upgrade', 'The Generator is upgraded');
});

/** Cemetery (appendix): move the Corpse marker back 1-2, then increase Hope. */
defCustom('cemetery', (s: GameState, ctx: Ctx) => {
  // Hope is increased only if the Corpse marker moves: the gain is chained after the move (bldCorpseDo).
  corpseBackChoice(s, ctx.who, 1, 2, ctx.src ?? 'bld:cemetery', true);
});

/**
 * Faith Keepers (appendix): draw 3 Dusk cards. The player may discard one of them to the Dusk discard without effect
 * (Social Dispute cards cannot be chosen); the other cards return to the Dusk deck, which is shuffled.
 */
defCustom('duskPeek3', (s: GameState, ctx: Ctx) => {
  const peek: string[] = [];
  for (let i = 0; i < 3; i++) {
    const id = drawDusk(s);
    if (id) peek.push(id);
  }
  if (!peek.length) return;
  const choices = peek.filter((id) => !isSocial(id));
  const options = [opt('none', 'Keep all three cards')];
  for (const id of choices) options.push(opt(id, `Discard ${cardTitle(id)}`));
  ask(s, {
    who: ctx.who,
    kind: 'duskPeek',
    prompt: 'Faith Keepers: discard one of the three cards (or keep all)',
    options,
    then: { k: 'duskPeekDo', peek },
    src: ctx.src ?? 'bld:faithKeepers',
  });
});

/** Prison (appendix): the Meeple stays in the Prison through the Night. Unheated: the citizen becomes sick. */
// Prison (rulebook p21 [R]): the Meeple stays in Prison through the Night. It sleeps there if the Prison is heated (2 places,
// night.ts prisoners); otherwise it stands outside like any unsheltered Meeple and ntStanding gives the sick Citizen then.
// No sick is added here: that would count the cold twice.
defCustom('prisonStay', (s: GameState, ctx: Ctx) => {
  const m = ctx.meeple != null ? meepleById(s, ctx.meeple) : undefined;
  if (!m) return;
  m.stay = true;
});

// ---------------------------------------------------------------------------------------------------------
// ops
// ---------------------------------------------------------------------------------------------------------

/** Faith Keepers resolution: discard the chosen card (no effect), return the rest to the Dusk deck and shuffle. */
defOp('duskPeekDo', (s, op) => {
  const pick: string = op.pick?.[0] ?? 'none';
  const peek: string[] = op.peek ?? [];
  const rest = peek.filter((id) => id !== pick);
  if (pick !== 'none' && peek.includes(pick)) {
    s.decks.duskDiscard.push(pick);
    log(s, 'dusk.discard', `${cardTitle(pick)} discarded without effect`, { card: pick });
  }
  if (rest.length) s.decks.dusk.push(...rest);
  s.decks.dusk = shuffle(s.rng, s.decks.dusk);
});
