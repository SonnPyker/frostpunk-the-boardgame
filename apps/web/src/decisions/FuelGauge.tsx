// Generator fuel: a gauge of segments, one per amount of Coal to burn. Segment 0 is "Do not fuel". Each burned Coal
// raises Heat by one (the option labels give the Heat after the burn). A click answers at once.
import { cx } from '../components/ui';
import { tip } from '../hud/context';
import { Icon } from '../hud/icons';
import { t, tn } from '../i18n';
import type { BodyProps } from './OptionList';

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function FuelGauge({ p, live, press, blocked }: BodyProps) {
  const heat = num(p.meta?.heat) ?? 0;
  const coal = num(p.meta?.coal);
  const cold = num(p.meta?.cold);
  return (
    <div className="dec-fuel">
      <div className="dec-fuel-stats">
        <span className="dec-stat">
          <Icon name="heat" size={16} /> {tn('Heat')} <b>{heat}</b>
        </span>
        {coal !== null ? (
          <span className="dec-stat">
            <Icon name="coal" size={16} /> {tn('Coal')} <b>{coal}</b>
          </span>
        ) : null}
        {cold !== null ? (
          <span className="dec-stat">
            <Icon name="cold" size={16} /> {tn('Cold')} <b>{cold}</b>
          </span>
        ) : null}
      </div>
      <div className="dec-gauge" role="group" aria-label={t('Coal to burn')}>
        {p.options.map((o, i) => {
          const offText = o.disabled && t(o.disabled);
          const reason = live ? offText : blocked || offText;
          const burn = i > 0;
          return (
            <button
              key={o.id}
              type="button"
              className={cx('dec-seg', burn ? 'dec-seg--burn' : 'dec-seg--skip', reason && 'is-off')}
              aria-disabled={!!reason || undefined}
              aria-label={t(o.label)}
              {...tip(reason ?? t(o.label))}
              onClick={() => {
                if (!reason) press(o.id);
              }}
            >
              <span className="dec-seg-num">{burn ? `+${i}` : '0'}</span>
              <span className="dec-seg-text">{burn ? tn(`Heat ${heat + i}`) : tn('Do not fuel')}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
