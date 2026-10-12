// Fallback decision panel used until the DECISIONS module exists. Handles the three basic shapes:
//   confirm-only (no options)  -> one Continue button
//   1-of-N (max <= 1)          -> one button per option (+ Skip when min is 0)
//   N-of-M (max > 1)           -> checkboxes and a Confirm button, enabled between min and max
// Options with `disabled` set show their reason as a tooltip. Only the addressed seat may answer.
import { useEffect, useState } from 'react';
import type { GameState } from '@frostpunk/engine';
import { Button, Panel, cx } from '../components/ui';
import { t, tn } from '../i18n';

export interface SimpleDecisionPanelProps {
  state: GameState;
  seat: number;
  answer: (pick: string[]) => void;
  canAnswer: boolean;
  /** true while an answer is on its way to the server (co-op) */
  busy?: boolean;
  /** watch mode: the bot plays this decision */
  watching?: boolean;
}

function countText(min: number, max: number): string {
  if (min === max) return String(max);
  return `${min} to ${max}`;
}

export function SimpleDecisionPanel({ state, answer, canAnswer, busy = false, watching = false }: SimpleDecisionPanelProps) {
  const p = state.pending;
  const pendingId = p?.id ?? null;
  const [chosen, setChosen] = useState<string[]>([]);

  // A new decision starts with an empty selection.
  useEffect(() => {
    setChosen([]);
  }, [pendingId]);

  if (!p) return null;

  const live = canAnswer && !busy;
  const waitReason = canAnswer ? undefined : watching ? t('The bot is choosing') : t('Waiting for another player');
  const confirmable = chosen.length >= p.min && chosen.length <= p.max;
  const multi = p.max > 1;

  const toggle = (id: string) => {
    setChosen((c) => {
      if (c.includes(id)) return c.filter((x) => x !== id);
      return c.length < p.max ? [...c, id] : c;
    });
  };

  return (
    <Panel tone="ember" className={cx('decision', multi && 'decision--multi')} title={tn(p.prompt)} icon="heat" kicker={p.kind}>
      {p.options.length === 0 ? (
        <div className="decision__options">
          <Button variant="primary" disabledReason={live ? undefined : waitReason} onClick={() => answer([])}>
            {tn('Continue')}
          </Button>
        </div>
      ) : !multi ? (
        <div className="decision__options">
          {p.options.map((o) => (
            <Button
              key={o.id}
              variant="secondary"
              disabledReason={!live ? waitReason : o.disabled && t(o.disabled)}
              title={o.hint ? t(o.hint) : undefined}
              onClick={() => answer([o.id])}
            >
              <span className="decision__label">{tn(o.label)}</span>
              {o.hint ? <span className="decision__hint">{tn(o.hint)}</span> : null}
            </Button>
          ))}
          {p.min === 0 ? (
            <Button variant="ghost" disabledReason={live ? undefined : waitReason} onClick={() => answer([])}>
              {tn('Skip')}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="decision__checks">
            {p.options.map((o) => {
              const on = chosen.includes(o.id);
              const reason = !live ? waitReason : o.disabled && t(o.disabled);
              const full = !on && chosen.length >= p.max;
              return (
                <li key={o.id}>
                  <label className={cx('check', (reason || full) && 'check--disabled')} title={reason ?? (o.hint && t(o.hint))}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={Boolean(reason) || full}
                      onChange={() => toggle(o.id)}
                    />
                    <span className="check__text">
                      {tn(o.label)}
                      {o.hint ? <span className="decision__hint"> {tn(o.hint)}</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="decision__foot">
            <span className="muted">
              {tn(`${chosen.length} of ${countText(p.min, p.max)} chosen`)}
            </span>
            <Button
              variant="primary"
              disabledReason={
                !live ? waitReason : !confirmable ? t(`Choose ${countText(p.min, p.max)} option(s)`) : undefined
              }
              onClick={() => answer(chosen)}
            >
              {tn('Confirm')}
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}
