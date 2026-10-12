// FX tokens owned by SCENARIO (docs/FX_DSL.md §7): scenario, trigger, goto, phase, shelters, nightSleep, flip,
// stormMarker, heatRange, stormHit, victory, defeat; custom 'stockpile'. Heads are global (defTok throws on duplicates).
// Already registered elsewhere and NOT repeated here: expedition, scoutsReturnNoReward (tokens_map), loseHalfFood,
// exhaustAll, sickAll, gain, hunger+, hope+, disc+ (tokens_supply / tokens_people).
import { win, lose, push } from '../core';
import type { Op } from '../types';
import { defCustom } from './tokens_cards';
import { defTok, N, runFx } from './core';
import {
  addTriggerToken,
  applyStorm,
  flipAllToRuins,
  heatAdvance,
  heatRemove,
  nightSleepSick,
  placeScenarioCard,
  removeScenarioCard,
  resolveScenarioCard,
  scenarioDef,
  stockpileAction,
} from '../scenario';

/** `phase:<name>` → the PHASES sub-step op (owned by phases.ts). */
const PHASE_OPS: Record<string, string> = {
  generator: 'phGenerator',
  hungerSpend: 'phHungerSpend',
  hungerResolve: 'phHungerResolve',
  sicknessResolve: 'phSicknessResolve',
};

const HEAT_KINDS = ['cold', 'red', 'orange', 'yellow'] as const;
const INDICATOR_KINDS = ['red', 'orange', 'yellow'] as const;

// scenario:place:<id> | scenario:resolve:<id> | scenario:remove:<id>
defTok('scenario', (s, a, ctx) => {
  const [act, id] = a;
  if (!id) throw new Error('scenario token needs a card id: ' + a.join(':'));
  scenarioDef(id); // throws on unknown card
  if (act === 'place') return placeScenarioCard(s, id, ctx.who);
  if (act === 'resolve') return resolveScenarioCard(s, id, ctx.who);
  if (act === 'remove') return removeScenarioCard(s, id);
  throw new Error('bad scenario token ' + a.join(':'));
});

// trigger:<round> — places the Scenario Trigger token of the card being placed (ctx.card) on that Round
defTok('trigger', (s, a, ctx) => {
  const round = N(a, 0);
  if (!ctx.card) throw new Error('trigger:' + round + ' outside a scenario card');
  addTriggerToken(s, round, ctx.card);
});

// goto:A | goto:B — runs the chosen branch of the Scenario Trigger being fired (ctx.trig)
defTok('goto', (s, a, ctx) => {
  const trig = ctx.trig;
  const br = trig?.branches?.[a[0]];
  if (!br) throw new Error('goto:' + a[0] + ' has no branch in this trigger');
  runFx(s, br.fx, ctx);
});

// phase:<generator|hungerSpend|hungerResolve|sicknessResolve> — PHASES sub-step op
defTok('phase', (s, a) => {
  const op = PHASE_OPS[a[0]];
  if (!op) throw new Error('bad phase token ' + a.join(':'));
  push(s, { k: op } as Op);
});

// shelters:allHeated — every Shelter counts as heated for this Round's Frostbite (Ruins stay unusable unless a Law says so)
defTok('shelters', (s, a) => {
  if (a[0] !== 'allHeated') throw new Error('bad shelters token ' + a.join(':'));
  s.flags.sheltersAllHeated = true;
});

// nightSleep:sick3PerUnsheltered — each Citizen Meeple without a warm place gains 3 sick Citizens of its type
defTok('nightSleep', (s, a, ctx) => {
  if (a[0] !== 'sick3PerUnsheltered') throw new Error('bad nightSleep token ' + a.join(':'));
  nightSleepSick(s, ctx, 3);
});

// flip:<building kind>:ruins — flip every Building of that kind to its Ruins side (Tents, Bunkhouses)
defTok('flip', (s, a) => {
  if (a[1] !== 'ruins') throw new Error('bad flip token ' + a.join(':'));
  flipAllToRuins(s, a[0]);
});

// stormMarker:set:<N> | stormMarker:remove
defTok('stormMarker', (s, a) => {
  if (a[0] === 'set') {
    s.stormMarker = N(a, 1);
    return;
  }
  if (a[0] === 'remove') {
    s.stormMarker = null;
    return;
  }
  throw new Error('bad stormMarker token ' + a.join(':'));
});

// heatRange:remove:<red|orange|yellow> | heatRange:advance:<cold|red|orange|yellow>:<N>
defTok('heatRange', (s, a) => {
  if (a[0] === 'remove') {
    if (!(INDICATOR_KINDS as readonly string[]).includes(a[1])) throw new Error('bad heatRange remove ' + a.join(':'));
    heatRemove(s, a[1] as 'red' | 'orange' | 'yellow');
    return;
  }
  if (a[0] === 'advance') {
    if (!(HEAT_KINDS as readonly string[]).includes(a[1])) throw new Error('bad heatRange advance ' + a.join(':'));
    heatAdvance(s, a[1] as 'cold' | 'red' | 'orange' | 'yellow', N(a, 2, 0));
    return;
  }
  throw new Error('bad heatRange token ' + a.join(':'));
});

// stormHit:<N> — Weather section D: the Storm marker moves back N (the weather card's `storm` value); a hit runs the Storm card branch
defTok('stormHit', (s, a, ctx) => applyStorm(s, N(a, 0, 0), ctx.who));

// victory — the scenario is won (S04 Round 12 finale, alive)
defTok('victory', (s, a) => win(s, a.join(':') || 'Survived the Storm'));

// defeat[:reason] — explicit scenario defeat
defTok('defeat', (s, a) => lose(s, a.join(':') || 'Scenario defeat'));

// custom:stockpile — S03 / S07 special action (ctx.card = 'S03' | 'S07')
defCustom('stockpile', (s, ctx) => stockpileAction(s, ctx));
