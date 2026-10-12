// Expedition decisions. Arrive: Skip or Explore the last space of a card. Explore: the card's own outcomes, each
// tagged Return or Continue with its effect text. The card art is drawn by the panel (see DecisionPanel).
import { cx } from '../components/ui';
import { tip } from '../hud/context';
import { t, tn } from '../i18n';
import { ARRIVE_TEXT, contextCardId, expeditionChoices, friendlyLabel } from './meta';
import type { BodyProps } from './OptionList';

export function ExpeditionPanel({ p, live, press, blocked }: BodyProps) {
  const cardId = contextCardId(p);
  const explore = p.kind === 'expExplore';
  const choices = explore && cardId ? expeditionChoices(cardId) : [];
  return (
    <div className="dec-choices" role="group" aria-label={t(p.prompt)}>
      {p.options.map((o, i) => {
        const offText = o.disabled && t(o.disabled);
        const reason = live ? offText : blocked || offText;
        const c = explore ? choices[i] : undefined;
        const tag = explore ? (c?.kind === 'continue' ? 'Continue' : 'Return') : o.id === 'explore' ? 'Explore' : 'Skip';
        const text = explore ? c?.effect : ARRIVE_TEXT[o.id];
        const style = explore ? (c?.kind === 'continue' ? 'continue' : 'return') : o.id;
        return (
          <button
            key={o.id}
            type="button"
            className={cx('dec-choice', `dec-choice--${style}`, reason && 'is-off')}
            aria-disabled={!!reason || undefined}
            {...tip(reason ?? undefined)}
            onClick={() => {
              if (!reason) press(o.id);
            }}
          >
            <span className="dec-choice-tag">{tn(tag)}</span>
            <span className="dec-choice-title">{tn(friendlyLabel(p, o))}</span>
            {text ? <span className="dec-choice-text">{tn(text)}</span> : null}
            {i < 9 ? <kbd className="dec-key">{i + 1}</kbd> : null}
          </button>
        );
      })}
    </div>
  );
}
