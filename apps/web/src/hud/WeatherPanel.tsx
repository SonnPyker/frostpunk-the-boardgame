// Right column: current Weather card (heat / hunting / scouts / storm) and the Storm card with the Storm marker.
import { memo } from 'react';
import { scenarioCards, weatherCards } from '@frostpunk/engine';
import type { GameState } from '@frostpunk/engine';
import { t, tn } from '../i18n';
import { CardImage } from './CardImage';
import { HudPanel, tip } from './context';
import { Icon } from './icons';
import { ROUND_LEN, cardInfo, sameSig, sliceSig } from './model';
import type { SigProps } from './model';

const HEAT_CHIPS: { label: string; icon: 'cold' | 'heat'; text: string }[] = [
  { label: 'Cold', icon: 'cold', text: 'the Cold marker moves up the Heat track.' },
  { label: 'Yellow', icon: 'heat', text: 'the Yellow Heat Range indicator moves up.' },
  { label: 'Orange', icon: 'heat', text: 'the Orange Heat Range indicator moves up.' },
  { label: 'Red', icon: 'heat', text: 'the Red Heat Range indicator moves up.' },
];

export const WEATHER_KEYS =['weatherCard', 'weatherHunt', 'stormCard', 'stormMarker', 'stormsHit', 'round'] as const satisfies readonly (keyof GameState)[];
export const weatherSig = (s: GameState) => sliceSig(s, WEATHER_KEYS);

interface Props extends SigProps {
  state: GameState;
}

function WeatherPanelImpl({ state: s }: Props) {
  const w = s.weatherCard ? weatherCards.find((x: any) => x.id === s.weatherCard) : undefined;
  const storm = scenarioCards[s.stormCard];
  return (
    <HudPanel title={t('Weather & Storm')} icon="cold" className="hud-weather-panel">
      <div className="hud-weather">
        <div className="hud-weather-card">
          {s.weatherCard ? <CardImage id={s.weatherCard} w={96} /> : <EmptySlot w={96} label={t('No weather yet')} />}
        </div>
        <div className="hud-weather-info">
          <div className="hud-kicker">{tn('Weather')}</div>
          {w ? (
            <>
              <div className="hud-weather-title">{cardInfo(w.id).title}</div>
              <div className="hud-heat-chips">
                {HEAT_CHIPS.map((c, i) => {
                  const v = w.heat[i] as number;
                  return (
                    <span key={c.label} className={`hud-heat-chip is-${c.label.toLowerCase()}`} {...tip(`${t(c.label)}: ${t(c.text)} ${v ? t(`Advances ${v} space${v === 1 ? '' : 's'}.`) : t('No change.')}`)}>
                      <Icon name={c.icon} size={11} />
                      {tn(c.label)} <b>{v === 0 ? '0' : `+${v}`}</b>
                    </span>
                  );
                })}
              </div>
              <dl className="hud-kv">
                <div {...tip(t('Hunting: Food gained per Hunting symbol on the Hunter Huts.'))}>
                  <dt>{tn('Hunt')}</dt>
                  <dd>+{w.hunt} {tn('Food / symbol')}</dd>
                </div>
                <div {...tip(t('Scouts on expeditions move this many spaces.'))}>
                  <dt>{tn('Scouts')}</dt>
                  <dd>{w.scout} {w.scout === 1 ? tn('space') : tn('spaces')}</dd>
                </div>
                {w.storm ? (
                  <div {...tip(t('The Storm marker moves back this many Rounds.'))}>
                    <dt>{tn('Storm')}</dt>
                    <dd>{tn('back')} {w.storm}</dd>
                  </div>
                ) : null}
              </dl>
            </>
          ) : (
            <p className="hud-empty">{tn('The Weather deck reveals a card in this phase.')}</p>
          )}
        </div>
      </div>

      <div className="hud-divider" />

      <div className="hud-weather">
        <div className="hud-weather-card">
          <CardImage id={s.stormCard} w={96} />
        </div>
        <div className="hud-weather-info">
          <div className="hud-kicker">{tn('Storm')}</div>
          <div className="hud-weather-title">{storm?.title ?? tn('Storm')}</div>
          <p className="hud-muted hud-small">
            {s.stormMarker !== null
              ? tn(`Storm marker on Round ${s.stormMarker} of ${ROUND_LEN}.`)
              : tn('No Storm marker left on the Round track.')}
          </p>
          <p className="hud-muted hud-small">{tn('Storms hit so far:')} <b>{s.stormsHit}</b></p>
          {s.weatherHunt ? <p className="hud-muted hud-small">{tn('Hunt gained this Weather:')} {s.weatherHunt}</p> : null}
        </div>
      </div>
    </HudPanel>
  );
}

export function EmptySlot({ w, label }: { w: number; label: string }) {
  return (
    <div className="hud-empty-slot" style={{ width: w, height: Math.round(w * 1.42) }}>
      <span>{label}</span>
    </div>
  );
}

export const WeatherPanel = memo(WeatherPanelImpl, sameSig);
