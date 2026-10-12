// The Action phase command bar: grouped action buttons with icons. Fuel is the ember call to action; Pass sits apart
// at the end as a dashed, quiet button. Disabled reasons are tooltips.
import type { PendingOption } from '@frostpunk/engine';
import { cx } from '../components/ui';
import { tip } from '../hud/context';
import { Icon } from '../hud/icons';
import { t, tn } from '../i18n';
import { actionIcon } from './labels';
import type { BodyProps } from './OptionList';

interface Group {
  key: string;
  title: string;
  items: { option: PendingOption; n: number }[];
}

const GROUPS: { key: string; title: string; test: (id: string) => boolean }[] = [
  {
    key: 'gen',
    title: 'Generator and resources',
    test: (id) => id === 'act:fuel' || id === 'act:gather' || id === 'act:removeSnow',
  },
  { key: 'build', title: 'Build and use', test: (id) => id === 'act:construct' || id === 'act:use' },
  { key: 'exp', title: 'Expedition', test: (id) => id === 'act:deploy' },
  { key: 'special', title: 'Special', test: (id) => id.startsWith('act:special') },
];

/** The action options split into display groups, in the order they are drawn (Pass is always last). */
function groupActions(options: readonly PendingOption[]): { groups: { key: string; title: string; options: PendingOption[] }[]; pass: PendingOption[] } {
  const pass = options.filter((o) => o.id === 'act:pass');
  const placed = new Set<string>(['act:pass']);
  const groups: { key: string; title: string; options: PendingOption[] }[] = [];
  for (const g of GROUPS) {
    const items = options.filter((o) => g.test(o.id));
    items.forEach((o) => placed.add(o.id));
    if (items.length > 0) groups.push({ key: g.key, title: g.title, options: items });
  }
  const other = options.filter((o) => !placed.has(o.id));
  if (other.length > 0) groups.push({ key: 'other', title: 'Other', options: other });
  return { groups, pass };
}

/**
 * The action options in on-screen order (groups top to bottom, Pass last). Keys 1..9 follow this order, so the number
 * on a button is the key that presses it. Used by the keyboard handler too.
 */
export function actionOrder(options: readonly PendingOption[]): PendingOption[] {
  const { groups, pass } = groupActions(options);
  return [...groups.flatMap((g) => g.options), ...pass];
}

export function ActionMenu({ p, live, press, blocked }: BodyProps) {
  const ordered = actionOrder(p.options);
  const numbered = (o: PendingOption) => ({ option: o, n: ordered.indexOf(o) + 1 });
  const { groups: rawGroups, pass: passOpts } = groupActions(p.options);
  const groups: Group[] = rawGroups.map((g) => ({ key: g.key, title: g.title, items: g.options.map(numbered) }));
  const pass = passOpts.map(numbered);

  return (
    <div className="dec-cmd" role="toolbar" aria-label={t('Actions')}>
      {groups.map((g) => (
        <div key={g.key} className="dec-cmd-group">
          <div className="dec-cmd-title">{tn(g.title)}</div>
          <div className="dec-cmd-row">
            {g.items.map((it) => (
              <ActionButton key={it.option.id} option={it.option} n={it.n} live={live} blocked={blocked} press={press} />
            ))}
          </div>
        </div>
      ))}
      {pass.length > 0 ? (
        <div className="dec-cmd-group dec-cmd-group--end">
          <div className="dec-cmd-row">
            {pass.map((it) => (
              <ActionButton key={it.option.id} option={it.option} n={it.n} live={live} blocked={blocked} press={press} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface ButtonProps {
  option: PendingOption;
  n: number;
  live: boolean;
  blocked: string;
  press: (id: string) => void;
}

function ActionButton({ option: o, n, live, blocked, press }: ButtonProps) {
  const offText = o.disabled && t(o.disabled);
  const reason = live ? offText : blocked || offText;
  const style = o.id === 'act:fuel' ? 'fuel' : o.id === 'act:pass' ? 'pass' : 'std';
  return (
    <button
      type="button"
      className={cx('dec-act', `dec-act--${style}`, reason && 'is-off')}
      aria-disabled={!!reason || undefined}
      {...tip(reason ?? t(o.hint ?? ''))}
      onClick={() => {
        if (!reason) press(o.id);
      }}
    >
      <Icon name={actionIcon(o.id)} size={20} />
      <span className="dec-act-text">
        <span className="dec-act-label">{tn(o.label)}</span>
        {o.hint ? <span className="dec-act-hint">{tn(o.hint)}</span> : null}
      </span>
      {n <= 9 ? <kbd className="dec-key">{n}</kbd> : null}
    </button>
  );
}
