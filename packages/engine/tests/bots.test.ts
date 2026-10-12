// Bot levels for the watch mode (src/bots). Every level must answer every decision with a legal pick, never get stuck,
// and play the same game from the same bot seed. The bots never touch the game's own RNG, so a recorded answer list
// replays the same state whichever bot produced it.
import { describe, expect, it } from 'vitest';
import { BOT_LEVELS, answer, botPick, botRng, createGame, serialize, type BotLevel, type GameConfig, type GameState } from '../src/index';

function config(seed: number, scenario: GameConfig['scenario'] = 'crater'): GameConfig {
  return {
    scenario,
    society: 1,
    difficulty: 'normal',
    mode: 'solo',
    players: [{ name: 'Commander' }],
    seed,
    extraPack: false,
    advisors: ['ADV_GENERATOR'],
  } as GameConfig;
}

/** Plays up to `maxDecisions` answers with one bot level. Fails the test at the first pick the engine refuses. */
function play(level: BotLevel, gameSeed: number, botSeed: number, maxDecisions: number): { s: GameState; decisions: number } {
  const s = createGame(config(gameSeed));
  const rng = botRng(botSeed);
  let decisions = 0;
  while (s.status === 'playing' && decisions < maxDecisions) {
    const p = s.pending;
    expect(p, `decision ${decisions} of a running game`).not.toBeNull();
    if (!p) break;
    const pick = botPick(level, rng, s, p);
    expect(pick, `${level} found no legal move for ${p.kind}`).not.toBeNull();
    if (!pick) break;
    const r = answer(s, p.who >= 0 ? p.who : s.leader, p.id, pick);
    expect(r.ok, `${level} was refused on ${p.kind}: ${r.error ?? ''}`).toBe(true);
    decisions += 1;
  }
  return { s, decisions };
}

describe('bot levels (watch mode)', () => {
  it('exposes the three levels in order', () => {
    expect([...BOT_LEVELS]).toEqual(['random', 'heuristic', 'pro']);
  });

  for (const level of BOT_LEVELS) {
    it(`${level}: answers with legal picks until the game ends or 300 decisions have passed`, () => {
      const { s, decisions } = play(level, 21, 5, 300);
      expect(s.status !== 'playing' || decisions === 300).toBe(true);
    });

    it(`${level}: the same bot seed plays the same game`, () => {
      const a = play(level, 22, 9, 200).s;
      const b = play(level, 22, 9, 200).s;
      expect(serialize(a)).toBe(serialize(b));
    });
  }

  it('a different bot seed can make different choices (random level)', () => {
    const a = play('random', 23, 1, 120).s;
    const b = play('random', 23, 2, 120).s;
    expect(serialize(a)).not.toBe(serialize(b));
  });

  it('the heuristic level finishes a Frozen Grove game without getting stuck', () => {
    const s = createGame(config(24, 'frozenGrove'));
    const rng = botRng(3);
    let decisions = 0;
    while (s.status === 'playing' && decisions < 4000) {
      const p = s.pending;
      if (!p) break;
      const pick = botPick('heuristic', rng, s, p);
      expect(pick).not.toBeNull();
      if (!pick) break;
      expect(answer(s, p.who >= 0 ? p.who : s.leader, p.id, pick).ok).toBe(true);
      decisions += 1;
    }
    expect(s.status).not.toBe('playing');
  });
});
