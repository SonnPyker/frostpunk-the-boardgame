// Redacted, JSON-safe view of a game for one seat (spec §5.1). Never contains the RNG, the op stack, deck order,
// hidden Law consequences, or another seat's hand. Pending options are sent only to the seat allowed to answer.
//
// Hidden information (what a seat may not see):
// * deck contents and their order (morning, dusk, weather, citizen, social, expA-C): counts only (deckCounts);
// * each Law's two consequence cards (lawConsequenceBank): never sent;
// * the RNG state and the op stack: never sent.
// The Future Law display is public: the Law cards (not the Law Consequence cards) may be looked through at any time
// (rulebook p37), so `futureLaws` (Law card ids, in display order) is sent. `futureLawCount` is kept for existing clients.
// The face-up discard piles are shown where the rules show them (citizen discard as `discards.citizen`).
//
// Debug only: `view(s, seat, { omniscient: true })` adds `decks` and `lawConsequenceBank` (for the simulator and
// the dev harness). Never send an omniscient view to a player.
import type { GameConfig, GameState, PendingOption, PlayerState } from './types';

export type DeckName =
  | 'morning'
  | 'dusk'
  | 'duskDiscard'
  | 'weather'
  | 'weatherDiscard'
  | 'citizen'
  | 'citizenDiscard'
  | 'social'
  | 'expA'
  | 'expB'
  | 'expC';

export interface PlayerSeatView extends Omit<PlayerState, 'hand'> {
  /** own hand (empty for other seats) */
  hand: string[];
  handCount: number;
}

export interface PendingView {
  id: number;
  who: number;
  kind: string;
  prompt: string;
  src?: string;
  min: number;
  max: number;
  /** options are only populated for the seat allowed to answer (who -1 = anyone) */
  options: PendingOption[];
  /** true when the viewer may answer this decision */
  canAnswer: boolean;
  /** the viewer may answer with BACK_PICK (go back to the action menu this decision came from; see core.ts) */
  back?: boolean;
  meta?: Record<string, any>;
}

export interface ViewOptions {
  /** debug only: include the hidden decks and Law consequences */
  omniscient?: boolean;
}

/** backPoint holds the whole state from before the action pick (hidden decks included), so it is never sent. */
type HiddenKeys = 'rng' | 'stack' | 'decks' | 'lawConsequenceBank' | 'pending' | 'players' | 'config' | 'backPoint';

export interface GameView extends Omit<GameState, HiddenKeys> {
  config: Omit<GameConfig, 'seed'>;
  players: PlayerSeatView[];
  pending: PendingView | null;
  /** number of cards in each deck and the face-up discard piles */
  deckCounts: Record<DeckName, number>;
  discards: { citizen: string[] };
  /** how many Laws are in the Future Law display (same as futureLaws.length) */
  futureLawCount: number;
  /** Law card ids of the Future Law display, public (rulebook p37); the Law Consequence cards are never sent */
  futureLaws: string[];
  /** the seat this view is for (-1 = spectator) */
  seat: number;
  /** present only for `omniscient` debug views */
  decks?: GameState['decks'];
  lawConsequenceBank?: GameState['lawConsequenceBank'];
}

const COUNT_DECKS: DeckName[] = [
  'morning',
  'dusk',
  'duskDiscard',
  'weather',
  'weatherDiscard',
  'citizen',
  'citizenDiscard',
  'social',
  'expA',
  'expB',
  'expC',
];

/** Redacted view for `who` (a seat index; -1 for a spectator). */
export function view(s: GameState, who: number, opts: ViewOptions = {}): GameView {
  const {
    rng: _rng,
    stack: _stack,
    decks,
    lawConsequenceBank,
    futureLaws,
    pending,
    players,
    config,
    backPoint: _backPoint,
    ...rest
  } = s;
  const { seed: _seed, ...publicConfig } = config;
  const deckCounts = {} as Record<DeckName, number>;
  for (const d of COUNT_DECKS) deckCounts[d] = decks[d].length;

  const canAnswer = (p: { who: number }) => p.who < 0 || p.who === who;
  const pendingView: PendingView | null = pending
    ? {
        id: pending.id,
        who: pending.who,
        kind: pending.kind,
        prompt: pending.prompt,
        src: pending.src,
        min: pending.min,
        max: pending.max,
        canAnswer: canAnswer(pending),
        ...(pending.back && canAnswer(pending) ? { back: true } : {}),
        options: canAnswer(pending) ? pending.options.map((o) => ({ ...o })) : [],
        meta: canAnswer(pending) ? pending.meta : undefined,
      }
    : null;

  const out = {
    ...rest,
    config: publicConfig,
    players: players.map((p) => ({
      ...p,
      hand: p.seat === who ? [...p.hand] : [],
      handCount: p.hand.length,
    })),
    pending: pendingView,
    deckCounts,
    discards: { citizen: [...decks.citizenDiscard] },
    futureLawCount: futureLaws.length,
    futureLaws: [...futureLaws],
    seat: who,
  } as GameView;
  if (opts.omniscient) {
    out.decks = structuredClone(decks);
    out.lawConsequenceBank = structuredClone(lawConsequenceBank);
  }
  return out;
}
