// Tutorial lessons (src/tutorial.ts). Each lesson is a prearranged solo Crater position whose steps gate the answers: the
// player must give the step's own pick, Back to actions is allowed, and a finished lesson gates nothing. A lesson is a
// normal game for save and replay: the same config and answers rebuild the same state.
import { describe, expect, it } from 'vitest';
import { LESSONS, answer, createGame, lessonConfig, lessonProgress, replay, serialize, type Command } from '../src/index';
import { LESSON_REFUSED, lessonDef } from '../src/tutorial';
import { BACK_PICK } from '../src/core';
import type { GameState, Pending } from '../src/types';

/** The pick a lesson step asks for, resolved against the pending decision (what a player following the step gives). */
function stepPick(s: GameState, p: Pending, step: { pick: string }): string[] {
  if (step.pick === 'any') return [p.options.find((o) => !o.disabled)!.id];
  if (step.pick === 'target') return [s.flags.lesson.target];
  return [step.pick];
}

/** Plays a lesson through its steps, as a player following them would, and returns the state and the answers given. */
function playLesson(id: string): { s: GameState; commands: Command[] } {
  const def = lessonDef(id)!;
  const s = createGame(lessonConfig(id));
  const commands: Command[] = [];
  for (const step of def.steps) {
    const p = s.pending!;
    expect(p.kind, `${id}: the step asks for a ${step.kind}`).toBe(step.kind);
    const pick = stepPick(s, p, step);
    const r = answer(s, 0, p.id, pick);
    expect(r.ok, `${id}: ${r.error ?? ''}`).toBe(true);
    commands.push({ who: 0, pendingId: p.id, pick });
  }
  return { s, commands };
}

describe('tutorial lessons', () => {
  it('has six lessons, each with at least one step and text for every step', () => {
    expect(LESSONS.map((l) => l.id)).toEqual(['fuel', 'gather', 'removeSnow', 'construct', 'use', 'endRound']);
    for (const l of LESSONS) {
      expect(l.steps.length).toBeGreaterThan(0);
      for (const st of l.steps) expect(st.text.length).toBeGreaterThan(10);
    }
  });

  it('a lesson starts at its first step with its target, and the set-up decisions are not asked', () => {
    for (const l of LESSONS) {
      const s = createGame(lessonConfig(l.id));
      expect(lessonProgress(s)).toMatchObject({ id: l.id, step: 0, done: false });
      expect(s.pending?.kind).toBe(l.steps[0].kind);
      expect(s.phase).toBe('action');
      expect(s.round).toBe(1);
    }
  });

  for (const l of LESSONS) {
    it(`${l.id}: the steps complete the lesson and the game goes on`, () => {
      const { s } = playLesson(l.id);
      expect(lessonProgress(s)).toMatchObject({ id: l.id, step: l.steps.length, done: true });
      expect(s.status).toBe('playing');
    });
  }

  it('refuses an answer that is not the current step, and leaves the state unchanged', () => {
    const s = createGame(lessonConfig('gather'));
    const before = serialize(s);
    const p = s.pending!;
    const wrong = p.options.find((o) => o.id !== 'act:gather' && !o.disabled)!;
    const r = answer(s, 0, p.id, [wrong.id]);
    expect(r).toEqual({ ok: false, error: LESSON_REFUSED });
    expect(serialize(s)).toBe(before);
    // the right answer is still open to the player
    expect(answer(s, 0, p.id, ['act:gather']).ok).toBe(true);
    expect(lessonProgress(s)?.step).toBe(1);
  });

  it('gates the target space: another space with Resources is refused, the lesson space is accepted', () => {
    const s = createGame(lessonConfig('gather'));
    answer(s, 0, s.pending!.id, ['act:gather']);
    answer(s, 0, s.pending!.id, ['m:2']);
    const p = s.pending!;
    expect(p.kind).toBe('space');
    const other = p.options.find((o) => o.id !== s.flags.lesson.target && !o.disabled)!;
    expect(answer(s, 0, p.id, [other.id])).toEqual({ ok: false, error: LESSON_REFUSED });
    expect(answer(s, 0, p.id, [s.flags.lesson.target]).ok).toBe(true);
    expect(lessonProgress(s)?.done).toBe(true);
  });

  it('gather: the Worker takes 2 Wood from the warm target space', () => {
    const { s } = playLesson('gather');
    expect(s.res.wood).toBe(6);
    expect(s.spaces[s.flags.lesson.target].res.wood ?? 0).toBe(0);
    expect(s.gen.heat).toBe(4);
  });

  it('fuel: 2 Coal go into the Generator and Heat rises from 1 to 3', () => {
    const { s } = playLesson('fuel');
    expect(s.res.coal).toBe(3);
    expect(s.gen.heat).toBe(3);
  });

  it("use: Hunter's Hut gives 4 Food", () => {
    const { s } = playLesson('use');
    expect(s.food).toBe(21);
    const hut = s.buildings.find((b) => b.kind === 'huntersHut');
    expect(hut).toBeDefined();
    expect(s.flags.lesson.target).toBe('b:' + hut!.uid);
  });

  it("construct: one Hunter's Hut is built on the highlighted space the player picks, for 1 Wood", () => {
    const { s } = playLesson('construct');
    const huts = s.buildings.filter((b) => b.kind === 'huntersHut');
    expect(huts).toHaveLength(1);
    expect(huts[0].spaces).toHaveLength(1);
    expect(s.res.wood).toBe(3);
  });

  it('removeSnow: two Near tiles are placed, and the Worker falls sick (Remove Snow is always cold)', () => {
    const before = createGame(lessonConfig('removeSnow'));
    const tilesBefore = before.tiles.length;
    const { s } = playLesson('removeSnow');
    expect(s.tiles.length).toBe(tilesBefore + 2);
    expect(s.sick.worker.n).toBe(1);
  });

  it('endRound: Pass ends the Action phase, and the Night Fuel step takes 1 Coal and moves on to the Round 2 Morning', () => {
    const { s } = playLesson('endRound');
    expect(s.round).toBe(2);
    expect(s.res.coal).toBe(4);
  });

  it('free choices: any enabled Worker or highlighted hex is accepted, in any order', () => {
    const s = createGame(lessonConfig('removeSnow'));
    answer(s, 0, s.pending!.id, ['act:removeSnow']);
    const worker = s.pending!;
    expect(worker.kind).toBe('meeple');
    const lastWorker = [...worker.options].reverse().find((o) => !o.disabled)!;
    expect(answer(s, 0, worker.id, [lastWorker.id]).ok).toBe(true);
    answer(s, 0, s.pending!.id, ['near2']);
    const slot = s.pending!;
    expect(slot.kind).toBe('tileSlot');
    const lastHex = [...slot.options].reverse().find((o) => !o.disabled)!;
    expect(answer(s, 0, slot.id, [lastHex.id]).ok).toBe(true);
    expect(lessonProgress(s)?.step).toBe(4);
  });

  it('Back to actions is allowed at a step, and the lesson returns to the step that asks for the menu', () => {
    const s = createGame(lessonConfig('use'));
    answer(s, 0, s.pending!.id, ['act:use']);
    expect(s.pending?.kind).toBe('meeple');
    expect(s.pending?.back).toBe(true);
    expect(lessonProgress(s)?.step).toBe(1);
    const r = answer(s, 0, s.pending!.id, [BACK_PICK]);
    expect(r.ok).toBe(true);
    expect(s.pending?.kind).toBe('action');
    expect(lessonProgress(s)).toMatchObject({ step: 0, done: false });
    // the menu is gated again: a different action is refused, the step's own action is accepted
    expect(answer(s, 0, s.pending!.id, ['act:gather'])).toEqual({ ok: false, error: LESSON_REFUSED });
    expect(answer(s, 0, s.pending!.id, ['act:use']).ok).toBe(true);
  });

  it('a lesson replays to the same state from its config and answers (save and Continue)', () => {
    for (const l of LESSONS) {
      const { s, commands } = playLesson(l.id);
      const again = replay(lessonConfig(l.id), commands);
      expect(serialize(again)).toBe(serialize(s));
    }
  });

  it('the lesson config is a solo Crater game with the lesson id, and rejects an unknown lesson', () => {
    expect(lessonConfig('fuel')).toMatchObject({ scenario: 'crater', mode: 'solo', tutorial: 'fuel' });
    expect(() => createGame({ ...lessonConfig('fuel'), tutorial: 'nope' })).toThrow(/unknown lesson/);
    expect(() => createGame({ ...lessonConfig('fuel'), extraPack: true })).toThrow(/without the extra pack/);
  });

  it('a normal game is not gated by lessons: no progress is kept and the set-up decisions are asked', () => {
    const s = createGame({
      scenario: 'crater',
      society: 1,
      difficulty: 'normal',
      mode: 'solo',
      players: [{ name: 'A' }],
      seed: 7,
      extraPack: false,
      advisors: ['ADV_GENERATOR'],
    });
    expect(s.flags.lesson).toBeUndefined();
    expect(s.pending?.kind).toBe('setup');
  });
});
