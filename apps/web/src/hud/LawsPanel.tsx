// Right column: up to four Laws in play, each with its covering Law Consequence card, then the Future Law display: the
// undrawn Law cards, which are public (rulebook p37). Their Law Consequence cards are hidden and never shown here.
import { memo } from 'react';
import { laws as lawData } from '@frostpunk/engine';
import type { GameState } from '@frostpunk/engine';
import { t, tn } from '../i18n';
import { CardImage } from './CardImage';
import { HudPanel, tip } from './context';
import { EmptySlot } from './WeatherPanel';
import { MAX_LAWS, cardTitle, sameSig, sliceSig } from './model';
import type { SigProps } from './model';

export const LAW_KEYS = ['laws', 'futureLaws', 'round'] as const satisfies readonly (keyof GameState)[];
export const lawsSig = (s: GameState) => sliceSig(s, LAW_KEYS);

interface Props extends SigProps {
  state: GameState;
}

function LawsPanelImpl({ state: s }: Props) {
  const slots = Array.from({ length: MAX_LAWS }, (_, i) => s.laws[i] ?? null);
  // The engine view sends the Law card ids in display order; an older server may not send them yet.
  const future = s.futureLaws ?? [];
  return (
    <HudPanel title={t('Laws')} icon="law" aside={<span className="hud-muted">{s.laws.length}/{MAX_LAWS}</span>}>
      <div className="hud-laws">
        {slots.map((law, i) =>
          law ? (
            <div key={law.id + i} className="hud-law">
              <CardImage id={law.id} w={88} />
              <div className="hud-law-info">
                <div className="hud-law-title">{lawData[law.id]?.title ?? law.id}</div>
                <div className="hud-law-state" {...tip(law.covered ? `${t('Consequence card covering this Law:')} ${cardTitle(law.covered)}.` : t('No consequence card has been revealed for this Law yet.'))}>
                  {law.covered ? <span className="hud-covered">{tn('Covered')}</span> : <span className="hud-muted">{tn('Uncovered')}</span>}
                </div>
                {law.covered ? (
                  <div className="hud-law-cover">
                    <CardImage id={law.covered} w={56} />
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div key={'empty' + i} className="hud-law is-empty">
              <EmptySlot w={88} label={t('Law slot')} />
            </div>
          ),
        )}
      </div>
      <div className="hud-future" aria-label={t('Future Law display')}>
        <div className="hud-future-title">
          {tn('Future Law display')} <span className="hud-muted">{future.length}</span>
        </div>
        {future.length === 0 ? (
          <div className="hud-muted hud-future-empty">{tn('No Laws left to introduce.')}</div>
        ) : (
          <div className="hud-future-cards">
            {future.map((id) => (
              <div key={id} className="hud-future-card" {...tip(`${t('Future Law:')} ${lawData[id]?.title ?? id}. ${t('Its two Law Consequence cards stay face down.')}`)}>
                <CardImage id={id} w={64} />
                <div className="hud-future-name">{lawData[id]?.title ?? id}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </HudPanel>
  );
}

export const LawsPanel = memo(LawsPanelImpl, sameSig);
