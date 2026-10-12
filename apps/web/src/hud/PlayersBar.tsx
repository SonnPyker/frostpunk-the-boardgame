// Bottom strip: player seats with advisor, the Citizen card played this Round, leader and active-turn markers.
import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { GameState } from '@frostpunk/engine';
import { t, tn } from '../i18n';
import { CardImage } from './CardImage';
import { tip } from './context';
import { Icon } from './icons';
import { cardInfo, sameSig, sliceSig } from './model';
import type { SigProps } from './model';
import { useMedia } from './storage';

export const PLAYER_KEYS = ['players', 'leader', 'turn', 'phase'] as const satisfies readonly (keyof GameState)[];
export const playersSig = (s: GameState, seat: number) => sliceSig(s, PLAYER_KEYS, seat);

interface Props extends SigProps {
  state: GameState;
  seat: number;
}

function PlayersBarImpl({ state: s, seat }: Props) {
  // Seat cards shrink on the shortest windows so the bottom band leaves height for the City column.
  const tiny = useMedia('(max-height: 760px)');
  const cardW = tiny ? 46 : 58;
  return (
    <div className="hud-seats" aria-label={t('Players')}>
      {s.players.map((p) => {
        const isLeader = p.seat === s.leader;
        const isTurn = s.phase === 'action' && p.seat === s.turn;
        const isYou = p.seat === seat;
        const style = { ['--c' as string]: p.color } as CSSProperties;
        const leaderTip = isLeader ? ` ${t('(leader: has the final word on advisors)')}` : '';
        const turnTip = isTurn ? t(', to act now') : '';
        const handTip = t(`Hand: ${p.hand.length} Citizen card${p.hand.length === 1 ? '' : 's'}.`);
        return (
          <div
            key={p.id}
            className={'hud-seat' + (isYou ? ' is-you' : '') + (isTurn ? ' is-turn' : '') + (isLeader ? ' is-leader' : '')}
            style={style}
            {...tip(`${p.name}${leaderTip}${turnTip}. ${handTip}`)}
          >
            <div className="hud-seat-head">
              <span className="hud-seat-swatch" aria-hidden="true" />
              {isLeader ? <Icon name="leader" size={12} className="hud-seat-crown" /> : null}
              <span className="hud-seat-name">{p.name}</span>
              {isYou ? <span className="hud-tag">{tn('You')}</span> : null}
              {isTurn ? <span className="hud-tag is-turn"><Icon name="turn" size={10} /> {tn('Turn')}</span> : null}
            </div>
            <div className="hud-seat-cards">
              <SeatCard
                label="Advisor"
                id={p.advisor}
                w={cardW}
                emptyText="No advisor"
                tipText={p.advisor ? `${t('Advisor:')} ${t(cardInfo(p.advisor).title)}` : t('No advisor chosen.')}
              />
              <SeatCard
                label="Played"
                id={p.playedCitizen}
                w={cardW}
                emptyText="Nothing played"
                tipText={p.playedCitizen ? t('Citizen card played this Round: its main ability is available.') : t('No Citizen card played this Round.')}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SeatCard({ label, id, w, emptyText, tipText }: { label: string; id: string | null; w: number; emptyText: string; tipText: string }) {
  return (
    <div className="hud-seat-slot" {...tip(tipText)}>
      <span className="hud-seat-label">{tn(label)}</span>
      {id ? (
        <CardImage id={id} w={w} />
      ) : (
        <div className="hud-seat-empty" style={{ width: w, height: Math.round(w * 1.42) }}>
          <span>{tn(emptyText)}</span>
        </div>
      )}
    </div>
  );
}

export const PlayersBar = memo(PlayersBarImpl, sameSig);
