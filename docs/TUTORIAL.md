# Tutorial lessons ("Hướng dẫn")

The main menu's Tutorial opens six short lessons. Each one is a prepared position of the Crater game (solo, base pack,
Society I, normal) that teaches one mechanic. The player follows the step on screen, and the engine accepts only the
answer that step asks for.

| # | id | Lesson | Rulebook | Steps |
|---|----|--------|----------|-------|
| 1 | `fuel` | Fuel the Generator | p23 | 2 |
| 2 | `gather` | Gather Resources | p25 | 3 |
| 3 | `removeSnow` | Remove Snow | p25 | 5 |
| 4 | `construct` | Construct | p26 | 7 |
| 5 | `use` | Use a Building | p26, p39-44 | 3 |
| 6 | `endRound` | End of the Round | p22, p29 | 2 |

Hope, Discontent, Hunger, Laws, Technologies, Expeditions and Storms have no lesson yet.

## Engine (`packages/engine/src/tutorial.ts`)

- A lesson is a `GameConfig` with `tutorial: <id>` (`lessonConfig(id)`: Crater, seed `LESSON_SEED`, one Advisor,
  Commander). `createGame` builds it like any game, so a lesson saves, replays and restores through the same
  config-plus-answers path. The set-up decisions (Crater corner, Citizen discards) are answered by the engine with their
  first enabled option, so they are never asked.
- `tutorialPatch` runs at the end of the set-up, after the board and the discards. Each lesson's `prepare(s)` arranges
  the position (resources, Heat, a building, the target space) and returns the lesson's target, if it has one.
- Progress is `s.flags.lesson = { id, step, done, target }`. While a step is current, `answer()` checks the pick
  (`lessonCheck`) before the answer is applied. A wrong pick returns `LESSON_REFUSED` and changes nothing. The right pick
  moves the lesson to the next step (`lessonAdvance`). After the last step, `done` is true and the game plays on freely.
- A decision of another kind is not gated, and Back to actions (`BACK_PICK`) is always allowed. After a Back, the lesson
  returns to the latest step of the kind of the menu it went back to (`lessonRewind`), so the menu is gated again.
- A step's `pick` is one of:
  - an option id (`act:gather`, `2`, `build`): exactly that answer;
  - `any`: any enabled option (a Meeple, a highlighted hex, a highlighted space);
  - `target`: the option the lesson's `prepare` chose (a space or a building).

## Web (`apps/web`)

- `screens/Tutorial.tsx`: the lesson list (menu screen `tutorial`). Finished lessons are marked from `store/tutorial.ts`
  (localStorage `frostpunk.tutorial.done.v1`, per browser).
- `session.startLesson(id)`: a `LocalController` with `persist: false`. A lesson is never autosaved, so the player's own
  solo save is left alone, also when the lesson ends in a defeat (`discardSolo` only clears a persisting game).
- `screens/LessonBanner.tsx`: the step panel over the map (title, "Step n of m", dots, Leave lesson) and the completion
  card (Next lesson, Back to lessons, Keep playing freely). It only reads `state.flags.lesson`.
- Texts: the step and summary texts are English data in the engine. They are translated through
  `tools/i18n/ui/tutorial.json` (run `node tools/i18n/build_vi.mjs`).

## Adding a lesson

1. Add a `LessonDef` to `LESSONS` in `tutorial.ts`: `id`, `title`, `summary`, `rulebook`, `prepare` and `steps`. Keep
   each step's `kind` equal to the `Pending.kind` the engine raises (check with a short script first, as the lessons were
   checked).
2. Add the English strings (title, summary, each step text) to `tools/i18n/ui/tutorial.json` with their Vietnamese.
   Numbers become placeholders, so write `{0}` in the Vietnamese wherever the English has a number.
3. Update the id list and the step counts in `packages/engine/tests/tutorial.test.ts`. The test plays every lesson
   through its steps, checks that it completes and that it replays.
