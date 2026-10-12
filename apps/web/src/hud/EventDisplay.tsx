// Right column: Event display. Event cards in play with the Resources and Meeples lying on them.
import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { GameState, MeepleKind } from '@frostpunk/engine';
import { cardBackArt } from './assets';
import { CardImage } from './CardImage';
import { HudPanel, tip } from './context';
import { Icon } from './icons';
import type { IconName } from './model';
import { cardTitle, sameSig, sliceSig } from './model';
import type { SigProps } from './model';
import { t, tn } from '../i18n';

export const EVENT_KEYS = ['events', 'meeples', 'round'] as const satisfies readonly (keyof GameState)[];

/** Face-down piles shown above the events. Each back is taken from a card of the deck's family (its back is shared). */
const DECK_PILES = [
  { key: 'morning', label: 'Morning', card: 'M001' },
  { key: 'dusk', label: 'Dusk', card: 'D000' },
  { key: 'citizen', label: 'Citizen', card: 'C01' },
  { key: 'social', label: 'Social', card: 'SD01' },
] as const;

/** Deck name. "Dusk deck" keeps the English term (glossary), so the Dusk pile is not translated. */
function deckName(d: { key: string; label: string }): string {
  return d.key === 'dusk' ? d.label : t(d.label);
}

/** Cards left in each public deck: from the full state (solo), or the view's deckCounts (co-op). */
function deckCountsOf(s: GameState): Partial<Record<string, number>> {
  if (s.decks) {
    return { morning: s.decks.morning.length, dusk: s.decks.dusk.length, citizen: s.decks.citizen.length, social: s.decks.social.length };
  }
  return (s as unknown as { deckCounts?: Partial<Record<string, number>> }).deckCounts ?? {};
}

export const eventSig = (s: GameState) => sliceSig(s, EVENT_KEYS, deckCountsOf(s));

function DeckPiles({ s }: { s: GameState }) {
  const counts = deckCountsOf(s);
  return (
    <div className="hud-decks" aria-label={t('Decks')}>
      {DECK_PILES.map((d) => {
        const n = counts[d.key];
        const back = cardBackArt(d.card);
        const name = deckName(d);
        return (
          <div key={d.key} className="hud-deck" {...tip(`${name} ${t('deck:')} ${n ?? t('unknown')} ${t('cards left. The cards themselves are hidden.')}`)}>
            <span className="hud-deck-stack" style={back ? ({ backgroundImage: `url("${back}")` } as CSSProperties) : undefined} aria-hidden="true" />
            <span className="hud-deck-name">{name}</span>
            <b>{n ?? '-'}</b>
          </div>
        );
      })}
    </div>
  );
}

interface Props extends SigProps {
  state: GameState;
}

const MEEPLE_ICON: Record<MeepleKind, IconName> = {
  worker: 'worker',
  engineer: 'engineer',
  child: 'child',
  automaton: 'automaton',
  childWorker: 'child',
  childEngineer: 'child',
};

const RES_LABEL: Record<string, string> = { wood: 'Wood', coal: 'Coal', core: 'Steam Core', steel: 'Steel' };

function EventDisplayImpl({ state: s }: Props) {
  return (
    <HudPanel title="Event display" icon="event" aside={<span className="hud-muted">{tn(`${s.events.length} in play`)}</span>}>
      <DeckPiles s={s} />
      {s.events.length === 0 ? (
        <p className="hud-empty">{tn('No events in play.')}</p>
      ) : (
        <div className="hud-events">
          {s.events.map((ev) => {
            const meeples = ev.meeples
              .map((id) => s.meeples.find((m) => m.id === id))
              .filter((m): m is NonNullable<typeof m> => !!m);
            const res = Object.entries(ev.res).filter(([, v]) => (v ?? 0) > 0);
            const status = ev.usedThisRound ? 'Used this Round' : 'Ready';
            return (
              <div key={ev.uid} className={'hud-event' + (ev.usedThisRound ? ' is-used' : '')}>
                <CardImage id={ev.card} w={84} dim={ev.usedThisRound} />
                <div className="hud-event-info">
                  <div className="hud-event-title" {...tip(t(cardTitle(ev.card)))}>{tn(cardTitle(ev.card))}</div>
                  <div className="hud-event-status" {...tip(ev.usedEver ? t('This event has been used before.') : t('This event has not been used yet.'))}>
                    {tn(status)}
                    {ev.usedEver ? <span className="hud-muted"> · {tn('used before')}</span> : null}
                  </div>
                  <div className="hud-event-res">
                    {res.length === 0 ? <span className="hud-muted hud-small">{tn('No resources on this card')}</span> : null}
                    {res.map(([k, v]) => (
                      <span key={k} className="hud-chip" {...tip(`${v} ${t(RES_LABEL[k] ?? k)} ${t("on this card: taken by the card's option.")}`)}>
                        <Icon name={k as IconName} size={12} /> {v}
                      </span>
                    ))}
                  </div>
                  <div className="hud-event-meeples">
                    {meeples.length === 0 ? null : (
                      <span className="hud-muted hud-small">{tn('Meeples')}</span>
                    )}
                    {meeples.map((m) => (
                      <span key={m.id} className={`hud-meeple is-${m.kind}`} {...tip(`${t(m.kind)} ${t(`meeple (#${m.id}) on this event.`)}`)}>
                        <Icon name={MEEPLE_ICON[m.kind]} size={13} />
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </HudPanel>
  );
}

export const EventDisplay = memo(EventDisplayImpl, sameSig);
