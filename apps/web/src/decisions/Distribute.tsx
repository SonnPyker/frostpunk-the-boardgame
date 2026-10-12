// Distribute decisions (meta.caps): steppers per option, each capped by its stock or by meta.caps, with a running
// total against meta.count (the decision's min = max). Confirm sends the picks with each id repeated by its count.
import { playSfx } from '../audio';
import { cx } from '../components/ui';
import { tip } from '../hud/context';
import { Icon } from '../hud/icons';
import { t, tn } from '../i18n';
import { ConfirmBar, countText } from './ConfirmBar';
import { optionIcon } from './labels';
import { friendlyLabel, prettyHint } from './meta';
import type { BodyProps } from './OptionList';
import { bumpPick } from './selection';

export function Distribute({ p, live, counts, total, blocked, confirm, confirmReason }: BodyProps) {
  const caps = (p.meta?.caps ?? {}) as Record<string, number>;
  const repeat = p.meta?.allowRepeat !== false;
  const step = (id: string, d: 1 | -1) => {
    if (!live) return;
    playSfx('tick');
    bumpPick(p, id, d);
  };
  return (
    <>
      <ul className="dec-steppers" aria-label={t(p.prompt)}>
        {p.options.map((o) => {
          const n = counts[o.id] ?? 0;
          const cap = Math.min(p.max, caps[o.id] ?? (repeat ? p.max : 1));
          const offText = o.disabled && t(o.disabled);
          const reason = live ? offText : blocked || offText;
          const up = !reason && n < cap && total < p.max;
          const down = !reason && n > 0;
          return (
            <li
              key={o.id}
              className={cx('dec-stepper', n > 0 && 'is-on', reason && 'is-off')}
              {...tip(reason ?? t(o.hint ?? ''))}
            >
              <span className="dec-ico">
                <Icon name={optionIcon(p.kind, o.id, o.data)} size={18} />
              </span>
              <span className="dec-text">
                <span className="dec-label">{tn(friendlyLabel(p, o))}</span>
                {o.hint ? <span className="dec-hint">{tn(prettyHint(o.hint) ?? '')}</span> : null}
                {o.disabled ? <span className="dec-off">{tn(o.disabled)}</span> : null}
              </span>
              <span className="dec-cap">{tn(`${n} of ${cap}`)}</span>
              <span className="dec-step">
                <button type="button" aria-label={`${t('Remove one')} ${o.label}`} disabled={!down} onClick={() => step(o.id, -1)}>
                  −
                </button>
                <output aria-live="polite">{n}</output>
                <button type="button" aria-label={`${t('Add one')} ${o.label}`} disabled={!up} onClick={() => step(o.id, 1)}>
                  +
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <ConfirmBar text={t(`${total} of ${countText(p.min, p.max)} assigned`)} label={t('Confirm')} reason={confirmReason} onConfirm={confirm} />
    </>
  );
}
