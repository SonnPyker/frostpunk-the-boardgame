// Unit tests for fx/custom.ts (ENGINE_SPEC §4.4): registration of the handlers and two deterministic card flows.
import { describe, expect, it } from 'vitest';
import '../src/fx';
import { placeEvent } from '../src/cards';
import { run } from '../src/core';
import { runFx } from '../src/fx/core';
import { customIds } from '../src/fx/tokens_cards';
import { blankState } from '../src/testing';

/** Drain the op stack. The phase machine is not wired in unit tests, so an empty stack is the normal end here. */
function drain(s: ReturnType<typeof blankState>) {
  try {
    run(s);
  } catch (e) {
    if (!/stack ran dry/.test(String((e as Error).message))) throw e;
  }
}

const OWNED = [
  'M004', 'M010', 'M015', 'M029', 'M038',
  'D005', 'D007', 'D010', 'D011', 'D016', 'D030', 'D031', 'D032', 'D036', 'D037', 'D043', 'D053', 'D062', 'D067', 'D072',
  'socialAdvisor', 'generatorSick:noFuel',
];

describe('custom handlers (4.4)', () => {
  it('registers every handler owned by CUSTOM', () => {
    const ids = customIds();
    for (const id of OWNED) expect(ids, id).toContain(id);
  });

  it('D016: with no active Discontent, -1 Discontent is applied automatically', () => {
    const s = blankState();
    s.disc = [{ t: 'anger', a: false }];
    runFx(s, ['custom:D016'], { who: 0, src: 'test' });
    drain(s);
    expect(s.disc).toEqual([]);
  });

  it('D010: a full loss of Wood discards 1 Discontent and removes the card', () => {
    const s = blankState();
    s.res.wood = 2;
    s.flags.night = { unsheltered: 1, total: 1, ruinsUsed: false };
    s.disc = [{ t: 'anger', a: true }];
    placeEvent(s, 'D010');
    runFx(s, ['custom:D010'], { who: 0, src: 'test' });
    drain(s);
    expect(s.res.wood).toBe(1);
    expect(s.disc).toEqual([]);
    expect(s.events.find((e) => e.card === 'D010')).toBeUndefined();
  });
});
