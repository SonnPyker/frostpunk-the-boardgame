// Bottom strip, right: the last 40 log entries with category icons. Auto-scrolls; "Key events" hides routine lines.
import { memo, useEffect, useRef, useState } from 'react';
import type { GameState, LogEntry } from '@frostpunk/engine';
import { t, tn } from '../i18n';
import { tip } from './context';
import { Icon } from './icons';
import { PHASES, isMinorLog, logIcon } from './model';
import type { SigProps } from './model';

const TAIL = 40;

export function logSig(s: GameState): string {
  const last = s.log[s.log.length - 1];
  return `${s.log.length}:${last?.n ?? -1}:${s.logN}`;
}

interface Props extends SigProps {
  state: GameState;
}

function LogFeedImpl({ state: s }: Props) {
  const [keyOnly, setKeyOnly] = useState(false);
  const ref = useRef<HTMLOListElement>(null);
  // GameState may be mutated in place, so derive the rows on every render (this runs only when the signature changes).
  const tail = s.log.slice(-TAIL);
  const rows: LogEntry[] = keyOnly ? tail.filter((e) => !isMinorLog(e.t)) : tail;
  const newest = tail.length ? tail[tail.length - 1].n : -1;

  // Keep the newest line in view, but do not yank the list while the reader has scrolled up.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [newest, keyOnly]);

  return (
    <section className="hud-log" aria-label={t('Game log')}>
      <header className="hud-log-head">
        <span className="hud-kicker">
          <Icon name="log" size={12} /> {tn('Log')}
        </span>
        <button
          type="button"
          className={'hud-chip-btn' + (keyOnly ? ' is-on' : '')}
          aria-pressed={keyOnly}
          onClick={() => setKeyOnly((v) => !v)}
          {...tip(keyOnly ? t('Showing key events only. Click to show every line.') : t('Hide routine draws, activations and exhausts.'))}
        >
          {keyOnly ? tn('Key events') : tn('All lines')}
        </button>
      </header>
      <ol className="hud-log-list" ref={ref}>
        {rows.length === 0 ? <li className="hud-empty">{tn('The log is empty.')}</li> : null}
        {rows.map((e) => (
          <li
            key={e.n}
            className={`hud-log-row cat-${e.t.split('.')[0]}`}
            {...tip(`${t('Round')} ${e.r}, ${t(PHASES.find((p) => p.id === e.p)?.label ?? e.p)}`)}
          >
            <Icon name={logIcon(e.t)} size={12} className="hud-log-ico" />
            <span className="hud-log-r">{tn('R')}{e.r}</span>
            <span className="hud-log-msg">{tn(e.m)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export const LogFeed = memo(LogFeedImpl, (a: SigProps, b: SigProps) => a.sig === b.sig);
