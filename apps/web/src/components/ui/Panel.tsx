// Frostpunk panel: dark glass, steel border, corner brackets, a brushed header strip.
import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  kicker?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  /** ember = heat / primary emphasis, frost = cold blue, steel = default */
  tone?: 'steel' | 'ember' | 'frost';
  /** removes the body padding (for maps, lists that bleed to the edge) */
  flush?: boolean;
  /** the body scrolls inside the panel instead of growing */
  scroll?: boolean;
  as?: 'section' | 'div' | 'aside';
}

export function Panel({
  title,
  kicker,
  icon,
  actions,
  tone = 'steel',
  flush = false,
  scroll = false,
  as = 'section',
  className,
  children,
  ...rest
}: PanelProps) {
  const Tag = as;
  const hasHead = title !== undefined || actions !== undefined || icon !== undefined;
  return (
    <Tag className={cx('panel', `panel--${tone}`, scroll && 'panel--scroll', className)} {...rest}>
      <i className="panel__corner panel__corner--tl" aria-hidden="true" />
      <i className="panel__corner panel__corner--tr" aria-hidden="true" />
      <i className="panel__corner panel__corner--bl" aria-hidden="true" />
      <i className="panel__corner panel__corner--br" aria-hidden="true" />
      {hasHead ? (
        <header className="panel__head">
          <div className="panel__title">
            {icon ? <Icon name={icon} size={18} className="panel__icon" /> : null}
            {title !== undefined ? <h3>{title}</h3> : null}
            {kicker !== undefined ? <span className="panel__kicker">{kicker}</span> : null}
          </div>
          {actions !== undefined ? <div className="panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx('panel__body', flush && 'panel__body--flush', scroll && 'panel__body--scroll')}>{children}</div>
    </Tag>
  );
}
