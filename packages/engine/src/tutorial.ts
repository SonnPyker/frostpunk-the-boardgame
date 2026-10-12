// Tutorial lessons (the web app's "Hướng dẫn" menu): short, prearranged positions of the Crater game, each teaching one
// mechanic from the rulebook.
//
// A lesson is a GameConfig with `tutorial: <id>` (see lessonConfig). createGame builds the position from that config, so a
// lesson saves, replays and restores like any other game. Its steps then gate the answers: while a step is the current one,
// an answer to a decision of that step's kind must be the step's pick, or it is refused. Back to actions is always allowed,
// and so is any decision of another kind (the engine can ask things the lesson does not teach). Progress is kept in
// `s.flags.lesson`, so it replays with the game.
//
// The step texts are English data, like card and option text. The web layer translates them.
import { BACK_PICK, defOp, log, RuleError } from './core';
import { placeBuilding } from './buildings';
import { buildingAtSpace, meeplesAtSpace } from './util';
import type { GameConfig, GameState, Pending } from './types';

/** Seed of every lesson. The position is fixed by the lesson code, and the seed fixes the board that the set-up draws. */
export const LESSON_SEED = 7;

/** Heat marker for the lessons that need warm actions: above every indicator (Red 1, Orange 2, Yellow 3). */
const WARM_HEAT = 4;

/** Message of a refused answer (the web layer shows its translation). */
export const LESSON_REFUSED = 'This lesson asks for a different answer here. Follow the step shown.';

export interface LessonStep {
  /** kind of the decision this step waits for (Pending.kind) */
  kind: string;
  /** the answer the step requires: 'any' (any enabled option, e.g. a highlighted hex), 'target' (the lesson's target) or an option id */
  pick: string;
  /** what the player is asked to do */
  text: string;
}

export interface LessonDef {
  id: string;
  title: string;
  /** one line for the lesson list */
  summary: string;
  /** rulebook pages the lesson follows */
  rulebook: string;
  /** Arranges the position (after the set-up). Returns the option id the 'target' steps use, or null. */
  prepare: (s: GameState) => string | null;
  steps: LessonStep[];
}

/** `s.flags.lesson`: where the player is in the lesson. */
export interface LessonProgress {
  id: string;
  /** index of the current step; equals steps.length when the lesson is done */
  step: number;
  done: boolean;
  target: string | null;
}

/**
 * The first space of a Near tile (board order) with no Building or Meeple on it. A space with no Resource and no Tree is
 * preferred, so the lesson's own Resources are the only ones on the space.
 */
function freeNearSpace(s: GameState): string {
  const free = Object.keys(s.spaces)
    .sort()
    .filter((id) => /^N\d+:top$/.test(id) && !buildingAtSpace(s, id) && meeplesAtSpace(s, id).length === 0);
  const empty = free.find((id) => !s.spaces[id].trees && !Object.values(s.spaces[id].res).some((n) => (n ?? 0) > 0));
  const sid = empty ?? free[0];
  if (!sid) throw new Error('tutorial: no free Near space in this position');
  return sid;
}

export const LESSONS: readonly LessonDef[] = [
  {
    id: 'fuel',
    title: 'Fuel the Generator',
    summary: 'Coal in the Generator raises Heat. Warm actions do not make Citizens sick.',
    rulebook: 'p23',
    prepare: () => null,
    steps: [
      {
        kind: 'action',
        pick: 'act:fuel',
        text: 'Choose Fuel the Generator. It costs no Meeple and no main action.',
      },
      {
        kind: 'fuel',
        pick: '2',
        text: 'Spend 2 Coal. Each Coal raises the Heat marker by 1, from 1 to 3.',
      },
    ],
  },
  {
    id: 'gather',
    title: 'Gather Resources',
    summary: 'A Worker takes up to 2 Resources from one space with Wood, Coal or Steam Core.',
    rulebook: 'p25',
    prepare: (s) => {
      const sid = freeNearSpace(s);
      s.spaces[sid].res = { wood: 2 };
      s.gen.heat = WARM_HEAT;
      return sid;
    },
    steps: [
      {
        kind: 'action',
        pick: 'act:gather',
        text: 'Choose Gather Resources. Heat is at 4, so the space is warm and no Citizen falls sick.',
      },
      {
        kind: 'meeple',
        pick: 'any',
        text: 'Choose a Meeple to do the work. It goes onto the space you pick next.',
      },
      {
        kind: 'space',
        pick: 'target',
        text: 'Pick the space with 2 Wood. You take up to 2 Resources from it. Each space can be gathered once per Round.',
      },
    ],
  },
  {
    id: 'removeSnow',
    title: 'Remove Snow',
    summary: 'Clear the snow next to the Generator to add new tiles, with their Resources and Trees.',
    rulebook: 'p25',
    prepare: () => null,
    steps: [
      {
        kind: 'action',
        pick: 'act:removeSnow',
        text: 'Choose Remove Snow. It is always cold, so one Worker falls sick.',
      },
      {
        kind: 'meeple',
        pick: 'any',
        text: 'Choose a Meeple to clear the snow.',
      },
      {
        kind: 'removeSnow',
        pick: 'near2',
        text: 'Choose two Near tiles. Near tiles go next to the Generator. The other choice is one Far tile.',
      },
      {
        kind: 'tileSlot',
        pick: 'any',
        text: 'Place the first Near tile on a highlighted hex next to the Generator.',
      },
      {
        kind: 'tileSlot',
        pick: 'any',
        text: 'Place the second Near tile on another highlighted hex.',
      },
    ],
  },
  {
    id: 'construct',
    title: 'Construct',
    summary: 'Build a building on an empty space and pay its cost in Wood.',
    rulebook: 'p26',
    prepare: (s) => {
      s.gen.heat = WARM_HEAT;
      return null;
    },
    steps: [
      {
        kind: 'action',
        pick: 'act:construct',
        text: 'Choose Construct. You can make up to 3 sub-actions in any order: Build or Dismantle.',
      },
      {
        kind: 'meeple',
        pick: 'any',
        text: 'Choose a Meeple to build. Construct is always warm, so no Citizen falls sick.',
      },
      {
        kind: 'citizen',
        pick: 'normal',
        text: 'Decline the Citizen card and take the normal Construct action.',
      },
      {
        kind: 'construct',
        pick: 'build',
        text: 'Choose Build.',
      },
      {
        kind: 'buildPick',
        pick: 'huntersHut',
        text: "Choose Hunter's Hut. It costs 1 Wood.",
      },
      {
        kind: 'buildSpace',
        pick: 'any',
        text: 'Place it on any highlighted empty space. A space with a Meeple or a building cannot take one.',
      },
      {
        kind: 'construct',
        pick: 'done',
        text: 'Choose Done to end the Construct action.',
      },
    ],
  },
  {
    id: 'use',
    title: 'Use a Building',
    summary: "Send a Worker to a building and use its effect. Hunter's Hut gives 4 Food.",
    rulebook: 'p26, p39-44',
    prepare: (s) => {
      const sid = freeNearSpace(s);
      const b = placeBuilding(s, 'huntersHut', sid, { noOnBuild: true });
      if (!b) throw new Error("tutorial: could not place Hunter's Hut");
      s.gen.heat = WARM_HEAT;
      return 'b:' + b.uid;
    },
    steps: [
      {
        kind: 'action',
        pick: 'act:use',
        text: 'Choose Use a Building. Heat is at 4, so the building is warm.',
      },
      {
        kind: 'meeple',
        pick: 'any',
        text: 'Choose a Meeple to use the building. A Small building takes one Meeple per Round.',
      },
      {
        kind: 'building',
        pick: 'target',
        text: "Use Hunter's Hut. It gains 4 Food.",
      },
    ],
  },
  {
    id: 'endRound',
    title: 'End of the Round',
    summary: 'Passing ends your Action phase. Night then offers an optional Fuel before the Round ends.',
    rulebook: 'p22, p29',
    prepare: () => null,
    steps: [
      {
        kind: 'action',
        pick: 'act:pass',
        text: 'Choose Pass. When every player passes in a row, the Action phase ends.',
      },
      {
        kind: 'fuel',
        pick: '1',
        text: 'At Night, Fuel the Generator is optional. Spend 1 Coal. Citizens with no warm place to sleep fall sick.',
      },
    ],
  },
];

export function lessonDef(id: string | null | undefined): LessonDef | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** The config that starts a lesson: a solo Crater game with the fixed seed. The web layer uses it as it is. */
export function lessonConfig(id: string): GameConfig {
  return {
    scenario: 'crater',
    society: 1,
    difficulty: 'normal',
    mode: 'solo',
    players: [{ name: 'Commander' }],
    seed: LESSON_SEED,
    extraPack: false,
    advisors: ['ADV_GENERATOR'],
    tutorial: id,
  };
}

/** Throws RuleError for a config that names a lesson the engine cannot play. */
export function validateLesson(config: GameConfig) {
  if (!lessonDef(config.tutorial)) throw new RuleError('unknown lesson ' + config.tutorial);
  if (config.scenario !== 'crater' || config.mode !== 'solo' || config.players.length !== 1 || config.extraPack) {
    throw new RuleError('a lesson is a solo Crater game without the extra pack');
  }
}

export function lessonProgress(s: GameState): LessonProgress | null {
  return (s.flags?.lesson as LessonProgress | undefined) ?? null;
}

/** Whether `pick` is what the step asks for (see LessonStep.pick). */
function stepAccepts(p: Pending, step: LessonStep, target: string | null, pick: string[]): boolean {
  if (pick.length !== 1) return false;
  if (step.pick === 'any') return p.options.some((o) => o.id === pick[0] && !o.disabled);
  if (step.pick === 'target') return target !== null && pick[0] === target;
  return pick[0] === step.pick;
}

/**
 * Checks an answer to the pending decision `p` against the lesson. `advance` is true when the answer is the current
 * step's own pick: the step is complete once the answer is applied (see lessonAdvance).
 */
export function lessonCheck(s: GameState, p: Pending, pick: string[]): { ok: true; advance: boolean } | { ok: false; error: string } {
  const progress = lessonProgress(s);
  if (!progress || progress.done) return { ok: true, advance: false };
  const def = lessonDef(progress.id);
  const step = def?.steps[progress.step];
  if (!def || !step || p.kind !== step.kind) return { ok: true, advance: false };
  if (pick.length === 1 && pick[0] === BACK_PICK) return { ok: true, advance: false };
  if (stepAccepts(p, step, progress.target, pick)) return { ok: true, advance: true };
  return { ok: false, error: LESSON_REFUSED };
}

/** Moves the lesson to its next step after an answer the lesson accepted. */
export function lessonAdvance(s: GameState) {
  const progress = lessonProgress(s);
  const def = progress ? lessonDef(progress.id) : undefined;
  if (!progress || !def) return;
  progress.step++;
  if (progress.step >= def.steps.length) {
    progress.step = def.steps.length;
    progress.done = true;
    log(s, 'lesson.done', `Lesson complete: ${def.title}`, { lesson: def.id });
  }
}

/**
 * After Back to actions the decision on the table is the action menu again. The lesson goes back to the latest step that
 * asks for that kind of decision, so the menu is gated by its own step (and not by a step further on).
 */
export function lessonRewind(s: GameState) {
  const progress = lessonProgress(s);
  const def = progress ? lessonDef(progress.id) : undefined;
  if (!progress || !def || progress.done || !s.pending) return;
  for (let j = Math.min(progress.step, def.steps.length - 1); j >= 0; j--) {
    if (def.steps[j].kind === s.pending.kind) {
      progress.step = j;
      return;
    }
  }
}

/** Set-up step of a lesson: arranges the position and starts its progress. Runs after the board and the discards. */
defOp('tutorialPatch', (s) => {
  const def = lessonDef(s.config.tutorial);
  if (!def) throw new Error('tutorial: unknown lesson ' + s.config.tutorial);
  const target = def.prepare(s);
  s.flags.lesson = { id: def.id, step: 0, done: false, target } satisfies LessonProgress;
});
