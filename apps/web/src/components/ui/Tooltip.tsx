// Hover/focus tooltip. The bubble is always in the DOM and is referenced by aria-describedby,
// so keyboard users get the same text as mouse users.
import { useId, type ReactNode } from 'react';
import { cx } from './cx';

export interface TooltipProps {
  text: ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** wider bubble for rules text */
  wide?: boolean;
  className?: string;
  children: ReactNode;
}

export function Tooltip({ text, placement = 'top', wide = false, className, children }: TooltipProps) {
  const id = useId();
  return (
    <span className={cx('tip', `tip--${placement}`, className)} aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className={cx('tip__bubble', wide && 'tip__bubble--wide')}>
        {text}
      </span>
    </span>
  );
}
