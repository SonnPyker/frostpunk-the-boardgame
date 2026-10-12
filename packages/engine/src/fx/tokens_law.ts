// FX tokens: Laws (introduction, Platform consequence choice) and Technology development. See docs/FX_DSL.md §2, §6.
import { ask, defOp, log, opt } from '../core';
import { LAW_MAX, introduceLaw } from '../laws';
import { flipSick } from '../sickness';
import { devDueNow, devMove, workshopEffects } from '../tech';
import { CITIZEN_TYPES } from '../types';
import type { CitizenType } from '../types';
import { defTok, N, runFx } from './core';
import type { Ctx } from './core';
import { defCustom } from './tokens_cards';

// ---- Technology development --------------------------------------------------------------------------------------------

// `devBack:N` (Workshop action), `devToken-N` (L02B), `devTokenBack:N` (D035): move the in-progress token N spaces back.
defTok('devBack', (s, a) => devMove(s, N(a, 0, 1)));
defTok('devToken-', (s, a) => devMove(s, N(a, 0, 1)));
defTok('devTokenBack', (s, a) => devMove(s, N(a, 0, 1)));
defTok('devTokenOnRound', (s) => devDueNow(s));

// `workshop:N` (SD09/SD10) and `workshopEffects:N` (citizen cards): perform N Workshop effects.
defTok('workshop', (s, a, ctx) => workshopEffects(s, N(a, 0, 1), ctx));
defTok('workshopEffects', (s, a, ctx) => workshopEffects(s, N(a, 0, 1), ctx));

// ---- Laws --------------------------------------------------------------------------------------------------------------

// `platform:chooseConsequence`: introduce a Law, the Leadership holder picks which Law Consequence goes into the Dusk deck.
defTok('platform', (s, a, ctx: Ctx) => {
  if (a[0] !== 'chooseConsequence') throw new Error('Unknown platform token ' + a.join(':'));
  introduceLaw(s, undefined, { chooseConsequence: true, src: ctx.src });
});

// Passive markers: no-ops here; the rules read them through passive()/hasPassive() in laws.ts.
defTok('heatedBySpendFood', () => {});
defTok('workersUseWorkshopsAndGenerator', () => {});
defTok('engineerConstructTwoSubactionsUpgrade', () => {});

// L19 Radical Treatment (alternative to a Medical Post / Infirmary effect, see buildings.ts effectiveAction): choose one
// Sickness marker, set it to 5 and flip it (may cause death). addSick caps a marker at its Citizen count, so the marker
// stops there when fewer than 5 Citizens of the type are alive.
defTok('setSickFlip5', (s, _a, ctx: Ctx) => {
  const types = CITIZEN_TYPES.filter((t) => s.cit[t] > 0);
  if (!types.length) return;
  ask(s, {
    who: ctx.who,
    kind: 'type',
    prompt: 'Radical Treatment: which Sickness marker is set to 5 and flipped?',
    src: ctx.src,
    options: types.map((t) => opt(t, t.charAt(0).toUpperCase() + t.slice(1))),
    then: { k: 'setSickFlip5Do', who: ctx.who, src: ctx.src },
  });
});
defOp('setSickFlip5Do', (s, op) => {
  const t = op.pick?.[0] as CitizenType | undefined;
  if (!t || s.cit[t] <= 0) return;
  s.sick[t].n = Math.min(5, s.cit[t]);
  log(s, 'sick.set5', `${t} sickness marker set to ${s.sick[t].n}`, { type: t });
  flipSick(s, t, op.who);
});

// SD04 Mistrust (justice side, card text): "Introduce a new Law. If you already have 4 Laws, exhaust all Discontent."
// Decided on the Law count at resolve time: below the max the Law is introduced (no choice of effect); at the max
// every active Discontent token is exhausted (`exhaust:disc:all`, no prompt).
defTok('introduceLawOrExhaustDisc', (s, a, ctx: Ctx) => {
  if (s.laws.length >= LAW_MAX) runFx(s, ['exhaust:disc:all'], ctx);
  else introduceLaw(s, undefined, { src: ctx.src });
});

// custom:introduceLaw (Platform action) and custom:introduceLaw:<lawId> (a fixed Law).
defCustom('introduceLaw', (s, ctx, args) => introduceLaw(s, args[0] || undefined, { src: ctx.src }));
