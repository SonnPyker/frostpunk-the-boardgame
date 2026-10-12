// Chamfered Frostpunk buttons. A disabled button keeps its reason as a tooltip (UI_SPEC section 1).
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { playSfx } from '../../audio';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  /** shown as the tooltip when the button is disabled, e.g. "Needs 2 Wood" */
  disabledReason?: string;
  block?: boolean;
  /** no click sound (e.g. for list rows that already play their own) */
  silent?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  disabledReason,
  block = false,
  silent = false,
  disabled,
  onClick,
  className,
  children,
  title,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isDisabled = Boolean(disabled) || Boolean(disabledReason);
  return (
    <button
      {...rest}
      type={type}
      disabled={isDisabled}
      title={isDisabled && disabledReason ? disabledReason : title}
      aria-disabled={isDisabled || undefined}
      className={cx('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', className)}
      onClick={(e) => {
        if (!silent) playSfx('click');
        onClick?.(e);
      }}
    >
      {icon ? <Icon name={icon} size={size === 'lg' ? 22 : size === 'sm' ? 15 : 18} className="btn__icon" /> : null}
      {children !== undefined ? <span className="btn__label">{children}</span> : null}
    </button>
  );
}
