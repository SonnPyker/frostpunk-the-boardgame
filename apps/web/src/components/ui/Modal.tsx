// Modal dialog in a portal. Escape and the backdrop close it, Tab stays inside, focus returns on close.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n';
import { cx } from './cx';
import { Icon } from './Icon';

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
  /** hide the close button (the dialog must be answered) */
  locked?: boolean;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, title, onClose, children, footer, width = 720, className, locked = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
        if (items.length === 0) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === firstEl || !panel.contains(active))) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && (active === lastEl || !panel.contains(active))) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [open, locked]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) closeRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('modal__panel', className)}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      >
        <i className="panel__corner panel__corner--tl" aria-hidden="true" />
        <i className="panel__corner panel__corner--tr" aria-hidden="true" />
        <i className="panel__corner panel__corner--bl" aria-hidden="true" />
        <i className="panel__corner panel__corner--br" aria-hidden="true" />
        <header className="modal__head">
          <h2 id={titleId}>{title}</h2>
          {!locked ? (
            <button type="button" className="icon-btn" onClick={() => closeRef.current()} aria-label={t('Close')}>
              <Icon name="close" size={18} />
            </button>
          ) : null}
        </header>
        <div className="modal__body">{children}</div>
        {footer !== undefined ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
