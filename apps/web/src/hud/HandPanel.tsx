// Bottom strip: the Citizen cards in hand for the viewing seat. The cards fan out and overlap only as much as the width
// needs, so every card stays reachable: hover zooms the card that is under the pointer and raises it above its neighbours,
// and pickable cards pulse. The fan is measured from the hand's own width, so it adapts to every window size.
import { memo, useLayoutEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { GameState } from '@frostpunk/engine';
import { t, tn } from '../i18n';
import { CardImage } from './CardImage';
import { tip } from './context';
import { CARD_RATIO, sameSig, sliceSig } from './model';
import type { SigProps } from './model';
import { useMedia } from './storage';

export const HAND_KEYS = ['players'] as const satisfies readonly (keyof GameState)[];
export const handSig = (s: GameState, seat: number) => sliceSig(s, HAND_KEYS, seat);

interface Props extends SigProps {
  state: GameState;
  seat: number;
}

/** Space kept between two cards when the hand has room; below that the cards overlap. */
const GAP = 8;
/**
 * Smallest visible strip of an overlapped card, so every card keeps a hover target. When even this step does not fit,
 * the fan is wider than the strip and the strip scrolls sideways, so the last cards stay reachable.
 */
const MIN_STEP = 22;
const PAD_X = 6;

function HandPanelImpl({ state: s, seat }: Props) {
  const p = s.players[seat];
  const hand = p?.hand ?? [];
  const short = useMedia('(max-height: 860px)');
  const tiny = useMedia('(max-height: 760px)');
  const w = tiny ? 66 : short ? 78 : 96;
  const h = Math.round(w * CARD_RATIO);

  // The strip is tracked through state, not a ref, so the observer follows the live node when the HUD remounts (new game).
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!box) return;
    const measure = () => setWidth(box.clientWidth);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(box);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [box]);

  const n = hand.length;
  const inner = Math.max(0, width - PAD_X * 2);
  let step = w + GAP;
  if (n > 1 && inner > 0) {
    const room = (inner - w) / (n - 1);
    step = Math.max(MIN_STEP, Math.min(w + GAP, room));
  }
  const fanWidth = n === 0 ? 0 : w + (n - 1) * step;

  return (
    <div className="hud-hand" aria-label={t('Hand')}>
      <div className="hud-hand-head">
        <span className="hud-kicker">{tn('Hand')}</span>
        <span className="hud-muted hud-small" {...tip(p ? `${p.name}${t("'s Citizen cards")}` : '')}>
          {p ? p.name : tn('No seat')} · {n} {n === 1 ? tn('card') : tn('cards')}
        </span>
      </div>
      <div className="hud-hand-cards" ref={setBox} style={{ height: h + 18 }}>
        {n === 0 ? (
          <p className="hud-empty">{tn('No Citizen cards in hand.')}</p>
        ) : (
          <div className="hud-hand-fan" style={{ width: fanWidth, height: h }}>
            {hand.map((id, i) => (
              <div
                key={`${i}-${id}`}
                className="hud-hand-slot"
                style={{ left: Math.round(i * step), width: w, height: h, ['--z' as string]: i + 1 } as CSSProperties}
              >
                <CardImage id={id} w={w} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const HandPanel = memo(HandPanelImpl, sameSig);
