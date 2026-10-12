// One-line status messages (errors, confirmations). Errors also play the error sound.
import { useEffect } from 'react';
import { playSfx } from '../../audio';
import { t } from '../../i18n';
import { useUi } from '../../store/ui';
import { cx } from './cx';
import { Icon } from './Icon';

export function Toast() {
  const toast = useUi((s) => s.toast);
  const dismiss = useUi((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    if (toast.tone === 'error') playSfx('error');
    const ms = toast.tone === 'error' ? 6000 : 3800;
    const t = window.setTimeout(() => dismiss(toast.id), ms);
    return () => window.clearTimeout(t);
  }, [toast, dismiss]);

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toast ? (
        <div key={toast.id} className={cx('toast', `toast--${toast.tone}`)}>
          <Icon name={toast.tone === 'error' ? 'warning' : toast.tone === 'ok' ? 'check' : 'gear'} size={16} />
          <span>{toast.text}</span>
          <button type="button" className="icon-btn toast__close" onClick={() => dismiss(toast.id)} aria-label={t('Dismiss message')}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
