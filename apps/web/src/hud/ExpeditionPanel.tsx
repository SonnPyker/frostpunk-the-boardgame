// Right column: Expeditions. Three stacks A / B / C with their top card, the Scout position along the steps, and black/white sides.
import { memo } from 'react';
import type { CSSProperties } from 'react';
import { expeditions as expData } from '@frostpunk/engine';
import type { ExpStack, GameState } from '@frostpunk/engine';
import { t, tn } from '../i18n';
import { CardImage } from './CardImage';
import { HudPanel, tip } from './context';
import { Icon } from './icons';
import { sameSig, sliceSig } from './model';
import type { SigProps } from './model';
import { useMedia } from './storage';

export const EXPEDITION_KEYS = ['expeditions', 'meeples', 'decks', 'nextExp'] as const satisfies readonly (keyof GameState)[];
export const expeditionSig = (s: GameState) => sliceSig(s, EXPEDITION_KEYS);

interface Props extends SigProps {
  state: GameState;
}

const LETTERS = ['A', 'B', 'C'] as const;
type Letter = (typeof LETTERS)[number];

function letterOf(st: ExpStack): Letter | null {
  const first = st.cards[0];
  const l = first ? expData[first.id]?.letter : undefined;
  return l === 'A' || l === 'B' || l === 'C' ? l : null;
}

function ExpeditionPanelImpl({ state: s }: Props) {
  const deckLeft: Record<Letter, number> = {
    A: s.decks.expA.length,
    B: s.decks.expB.length,
    C: s.decks.expC.length,
  };
  return (
    <HudPanel title={t('Expeditions')} icon="expedition" aside={<span className="hud-muted">{s.expeditions.length} {tn('out')}</span>}>
      <div className="hud-exp-cols">
        {LETTERS.map((L) => {
          const stacks = s.expeditions.filter((st) => letterOf(st) === L);
          return (
            <div key={L} className="hud-exp-col">
              <div className="hud-exp-head" {...tip(`${t('Expedition stack')} ${L}: ${t(`${deckLeft[L]} cards left in the deck.`)}`)}>
                <span>{tn('Stack')} {L}</span>
                <span className="hud-muted">{deckLeft[L]} {tn('left')}</span>
              </div>
              {stacks.length === 0 ? (
                <div className="hud-exp-empty">
                  <span>{tn('Empty')}</span>
                </div>
              ) : (
                stacks.map((st) => <ExpStackView key={st.uid} st={st} />)
              )}
            </div>
          );
        })}
      </div>
    </HudPanel>
  );
}

function ExpStackView({ st }: { st: ExpStack }) {
  // Three stacks share the City column: the card narrows with the column on the narrower windows.
  const narrow = useMedia('(max-width: 1500px)');
  const top = st.cards[st.cards.length - 1];
  if (!top) return null;
  const info = expData[top.id];
  const steps: number = info?.steps ?? 2;
  const pos = st.scout?.pos ?? 0;
  const black = top.flipped;
  const side = black
    ? t('Black side up: the Continue effects of this card resolve when the Scouts return.')
    : t('White side up.');
  const scoutText = st.scout
    ? `${t(`Scout on step ${pos} of ${steps}`)}${st.scenario ? ` ${t('(scenario Expedition: cannot be skipped)')}` : ''}.`
    : t('No Scout on this Expedition.');
  return (
    <div className={'hud-exp' + (black ? ' is-black' : ' is-white') + (st.waiting ? ' is-waiting' : '')}>
      <div className="hud-exp-card">
        <CardImage id={top.id} w={narrow ? 74 : 92} />
        {st.cards.length > 1 ? <span className="hud-exp-depth" {...tip(t(`${st.cards.length} cards in this stack`))}>{st.cards.length}</span> : null}
        {black ? <span className="hud-exp-black" {...tip(side)}>{tn('Black')}</span> : null}
      </div>
      <div className="hud-exp-steps" style={{ ['--n' as string]: steps } as CSSProperties} {...tip(scoutText)}>
        {Array.from({ length: steps }).map((_, i) => {
          const n = i + 1;
          return <i key={n} className={'hud-step' + (n === pos ? ' is-scout' : n < pos ? ' is-passed' : '')} />;
        })}
      </div>
      <div className="hud-exp-foot">
        {st.scout ? <Icon name="scout" size={12} /> : null}
        <span className="hud-small">{st.scout ? tn(`Step ${pos}/${steps}`) : tn('No Scout')}</span>
        {st.bonus && (st.bonus.wood || st.bonus.coal) ? (
          <span className="hud-small hud-muted">
            +{st.bonus.wood ?? 0} {tn('wood')}, +{st.bonus.coal ?? 0} {tn('coal')} {tn('on return')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export const ExpeditionPanel = memo(ExpeditionPanelImpl, sameSig);
