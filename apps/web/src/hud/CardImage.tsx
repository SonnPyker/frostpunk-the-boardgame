// Card face for any card id: manifest art when available, otherwise a styled text card built from the engine data.
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t, tn } from '../i18n';
import { cardArt } from './assets';
import { Icon } from './icons';
import { CARD_RATIO, cardInfo } from './model';
import type { CardInfo } from './model';
import { usePick } from './context';

export interface CardImageProps {
  id: string;
  /** width in px of the card on screen (height follows the card ratio) */
  w?: number;
  /** show the large preview on hover (default true) */
  zoom?: boolean;
  className?: string;
  dim?: boolean;
  /** extra badge text drawn in the corner, e.g. "Black" or "x2" */
  badge?: string;
}

/** Styled text card. Used when no art exists; font sizes scale with the card width through --w. */
export function CardFace({ info, w, id }: { info: CardInfo; w: number; id: string }) {
  return (
    <div className="hud-face" style={{ ['--w' as string]: `${w}px`, ['--accent' as string]: info.accent }}>
      <div className="hud-face-kind">
        <Icon name={info.icon} size={Math.max(9, Math.round(w * 0.12))} />
        <span>{tn(info.kindLabel)}</span>
      </div>
      <div className="hud-face-title">{tn(info.title)}</div>
      <div className="hud-face-rule" aria-hidden="true" />
      <div className="hud-face-body">
        {info.lines.map((l, i) => (
          <p key={i}>{tn(l)}</p>
        ))}
      </div>
      <div className="hud-face-id">{id}</div>
    </div>
  );
}

interface ZoomProps {
  info: CardInfo;
  id: string;
  art?: string;
  anchor: DOMRect;
}

const ZOOM_W = 300;

function CardZoom({ info, id, art, anchor }: ZoomProps) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const zw = Math.min(ZOOM_W, vw - 24);
  const zh = Math.round(zw * CARD_RATIO);
  const onRight = anchor.left + anchor.width / 2 > vw / 2;
  const left = onRight ? Math.max(12, anchor.left - zw - 18) : Math.min(vw - zw - 12, anchor.right + 18);
  const top = Math.max(12, Math.min(vh - zh - 12, anchor.top + anchor.height / 2 - zh / 2));
  return createPortal(
    <div className="hud-zoom" role="presentation" style={{ left, top, width: zw, height: zh }}>
      {art ? (
        <img className="hud-zoom-art" src={art} alt="" draggable={false} />
      ) : (
        <CardFace info={info} w={zw} id={id} />
      )}
      {art ? (
        <div className="hud-zoom-text">
          <div className="hud-zoom-kind">{tn(info.kindLabel)}</div>
          <div className="hud-zoom-title">{tn(info.title)}</div>
          {info.lines.map((l, i) => (
            <p key={i}>{tn(l)}</p>
          ))}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

export const CardImage = memo(function CardImage({ id, w = 120, zoom = true, className, dim, badge }: CardImageProps) {
  const info = cardInfo(id);
  const art = cardArt(id);
  const [broken, setBroken] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pick = usePick(id);
  const h = Math.round(w * CARD_RATIO);
  const showArt = !!art && !broken;

  useLayoutEffect(() => {
    if (!anchor) return;
    const off = () => setAnchor(null);
    window.addEventListener('scroll', off, true);
    return () => window.removeEventListener('scroll', off, true);
  }, [anchor]);

  return (
    <>
      <div
        ref={ref}
        className={
          'hud-card' +
          (pick.on ? ' is-pick' : '') +
          (dim ? ' is-dim' : '') +
          (showArt ? ' has-art' : ' is-text') +
          (className ? ' ' + className : '')
        }
        style={{ width: w, height: h }}
        onMouseEnter={() => zoom && ref.current && setAnchor(ref.current.getBoundingClientRect())}
        onMouseLeave={() => setAnchor(null)}
        {...pick.handlers}
        aria-label={t(info.title)}
      >
        {showArt ? (
          <img src={art} alt="" draggable={false} loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <CardFace info={info} w={w} id={id} />
        )}
        {badge ? <span className="hud-card-badge">{tn(badge)}</span> : null}
      </div>
      {anchor && zoom ? <CardZoom info={info} id={id} art={showArt ? art : undefined} anchor={anchor} /> : null}
    </>
  );
});
