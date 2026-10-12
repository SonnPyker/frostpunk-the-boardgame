// Deterministic stand-in for the rules engine, implementing the EngineAdapter contract.
// Game: pending decisions with options a / b / end / boom (and 'corrupt', which half-applies a rejected answer). Decision k is addressed to seat k % players,
// except decision 1 which any seat may answer (who = -1). Three answers win; 'end' loses; 'boom' throws
// after mutating state, to exercise the server's rebuild-from-log path.
import type { Command, EngineAdapter, EngineState, GameConfig } from '../src/adapter';

export interface FakeState extends EngineState {
  config: GameConfig;
  answers: number;
  round: number;
}

const OPTIONS = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'end', label: 'End the game' },
  { id: 'boom', label: 'Explode' },
];

function whoFor(k: number, players: number): number {
  return k === 1 ? -1 : k % players;
}

function pendingFor(s: FakeState) {
  return {
    id: s.answers + 1,
    who: whoFor(s.answers, s.config.players.length),
    kind: 'choice',
    prompt: `decision ${s.answers + 1}`,
    min: 1,
    max: 1,
    options: OPTIONS,
  };
}

export function makeFakeEngine(): EngineAdapter & { createCalls: number } {
  const engine = {
    createCalls: 0,
    /** Same rule text as the real engine's validateConfig (one Advisor per player when Advisors are chosen). */
    validateConfig(config: GameConfig): void {
      const n = config.players.length;
      const chosen = config.advisors ?? [];
      if (chosen.length > 0 && chosen.length < n) {
        throw new Error(`the table needs at least ${n} Advisors (one per player)`);
      }
    },
    createGame(config: GameConfig): FakeState {
      engine.createCalls++;
      const s: FakeState = { status: 'playing', endReason: null, round: 1, config, answers: 0, pending: null };
      s.pending = pendingFor(s);
      return s;
    },
    answer(s: FakeState, who: number, pendingId: number, pick: string[]) {
      if (s.status !== 'playing') return { ok: false, error: 'game is over' };
      const p = s.pending;
      if (!p) return { ok: false, error: 'no decision pending' };
      if (p.id !== pendingId) return { ok: false, error: 'stale decision' };
      if (p.who >= 0 && p.who !== who) return { ok: false, error: 'not your decision' };
      if (pick[0] === 'corrupt') {
        // Mimics the real engine's failure mode: the decision is consumed, then a rule rejects the answer.
        s.pending = null;
        return { ok: false, error: 'rule failed while resolving' };
      }
      if (pick.length !== 1 || !OPTIONS.some((o) => o.id === pick[0])) return { ok: false, error: 'bad pick' };
      s.answers++;
      if (pick[0] === 'boom') throw new Error('engine exploded');
      if (pick[0] === 'end') {
        s.status = 'lost';
        s.endReason = 'ended by players';
        s.pending = null;
      } else if (s.answers >= 3) {
        s.status = 'won';
        s.endReason = 'three decisions done';
        s.pending = null;
      } else {
        s.pending = pendingFor(s);
      }
      return { ok: true };
    },
    view(s: FakeState, who: number) {
      const p = s.pending;
      const addressed = p !== null && (p.who === -1 || p.who === who);
      return {
        seat: who,
        round: s.round,
        answers: s.answers,
        options: addressed ? p.options.map((o) => o.id) : [],
      };
    },
    serialize(s: FakeState): string {
      return JSON.stringify(s);
    },
    deserialize(json: string): FakeState {
      return JSON.parse(json) as FakeState;
    },
    replay(config: GameConfig, commands: Command[]): FakeState {
      const s = engine.createGame(config);
      for (const c of commands) {
        const r = engine.answer(s, c.who, c.pendingId, c.pick);
        if (!r.ok) throw new Error('replay rejected: ' + r.error);
      }
      return s;
    },
  };
  return engine;
}
