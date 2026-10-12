// Generic choices: a list of options (1-of-N answers at once, N-of-M toggles), card tiles when every option has card
// art, and a two-button layout for yes/no. Every option that is pickable here is also highlighted on the map and HUD
// (the same option ids), and a click from any surface reaches the same press() path.
import type { MouseEvent, KeyboardEvent } from 'react';
import type { GameState, Pending } from '@frostpunk/engine';
import { cx } from '../components/ui';
import { artImageUrl } from '../components/ui/assets';
import { buildingArt, buildingText } from '../data/buildingInfo';
import { tip, usePick } from '../hud/context';
import { CardImage } from '../hud/CardImage';
import { Icon } from '../hud/icons';
import { t, tn } from '../i18n';
import { optionIcon } from './labels';
import { buildingOf, friendlyLabel, prettyHint, thumbFor } from './meta';

/** Props shared by every body of the decision panel. */
export interface BodyProps {
  p: Pending;
  /** the game state: building options are drawn with their building's artwork and text */
  state?: GameState;
  /** the viewer may pick now (can answer, not busy) */
  live: boolean;
  counts: Record<string, number>;
  total: number;
  multi: boolean;
  /** an option was chosen: answers, toggles or steps it, depending on the decision */
  press: (id: string) => void;
  /** why nothing can be picked right now, e.g. "Waiting for Ada"; empty when live */
  blocked: string;
  confirm: () => void;
  /** why Confirm is off; undefined when it can be pressed */
  confirmReason?: string;
}

export function OptionList(props: BodyProps) {
  const { p, multi } = props;
  const yesNo = !multi && p.options.length === 2 && p.options.every((o) => o.id === 'yes' || o.id === 'no');
  const tiles = !yesNo && p.options.length > 0 && p.options.every((o) => thumbFor(p, o) !== null);
  return (
    <div
      className={cx('dec-list', yesNo && 'dec-list--yesno', tiles && 'dec-list--tiles')}
      role={multi ? 'group' : 'list'}
      aria-label={t(p.prompt)}
    >
      {p.options.map((o, i) => (
        <OptionItem
          key={o.id}
          {...props}
          id={o.id}
          index={i}
          tiles={tiles}
          yesNo={yesNo}
        />
      ))}
    </div>
  );
}

interface ItemProps extends BodyProps {
  id: string;
  index: number;
  tiles: boolean;
  yesNo: boolean;
}

function OptionItem({ p, state, live, counts, multi, press, blocked, id, index, tiles, yesNo }: ItemProps) {
  const o = p.options.find((x) => x.id === id);
  const hud = usePick(id);
  if (!o) return null;
  const on = (counts[o.id] ?? 0) > 0;
  const offText = o.disabled && t(o.disabled);
  const reason = live ? offText : blocked || offText;
  const enabled = !reason;
  const thumb = thumbFor(p, o);
  // A building option (a Construct kind, or a building the player picks) shows the building's art and its effect text.
  const bld = thumb ? null : buildingOf(p, o, state);
  const bldArt = bld ? artImageUrl(buildingArt(bld)) : undefined;
  const desc = bld ? buildingText(bld) : undefined;
  const hint = prettyHint(o.hint);
  const label = friendlyLabel(p, o);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    // A pickable HUD card is handled by the HUD itself (App routes it to the same press): skip it here.
    const target = e.target as Element;
    if (target.closest && target.closest('.hud-card.is-pick')) return;
    if (enabled) press(o.id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (enabled) press(o.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={enabled ? 0 : -1}
      aria-disabled={!enabled || undefined}
      aria-pressed={multi ? on : undefined}
      className={cx(
        'dec-opt',
        tiles && 'dec-opt--tile',
        yesNo && 'dec-opt--yesno',
        on && 'is-on',
        !enabled && 'is-off',
        hud.on && 'is-hot',
      )}
      {...tip(reason ?? t(hint ?? ''))}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <kbd className="dec-key">{index < 9 ? index + 1 : ''}</kbd>
      {thumb ? (
        <CardImage id={thumb} w={tiles ? 96 : 56} className="dec-card" />
      ) : bldArt ? (
        <img className="dec-bld" src={bldArt} alt="" width={56} height={56} loading="lazy" draggable={false} />
      ) : (
        <span className="dec-ico">
          <Icon name={optionIcon(p.kind, o.id, o.data)} size={yesNo ? 26 : 18} />
        </span>
      )}
      <span className="dec-text">
        <span className="dec-label">{tn(label)}</span>
        {hint ? <span className="dec-hint">{tn(hint)}</span> : null}
        {desc ? <span className="dec-desc">{tn(desc)}</span> : null}
        {o.disabled ? <span className="dec-off">{tn(o.disabled)}</span> : null}
      </span>
      {multi && on ? (
        <span className="dec-tick" aria-hidden="true">
          <Icon name="check" size={14} />
        </span>
      ) : null}
    </div>
  );
}
