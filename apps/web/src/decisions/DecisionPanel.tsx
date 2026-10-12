// The DECISIONS module: the pending decision for the addressed seat, drawn in the bottom dock. The body depends on the
// decision kind; unknown kinds fall back to a plain list or a Continue button. Picks made here and on the map or HUD
// share one selection store (./selection), so a multi-choice decision looks the same wherever it is answered from.
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { BACK_PICK, type GameState, type Pending } from '@frostpunk/engine';
import { playSfx } from '../audio';
import { Button, Panel, cx } from '../components/ui';
import { CardImage } from '../hud/CardImage';
import { Icon } from '../hud/icons';
import { isMinorLog } from '../hud/model';
import { t, tn } from '../i18n';
import { resolvePickId } from '../map/pick';
import { useUi } from '../store/ui';
import { ActionMenu, actionOrder } from './ActionMenu';
import { ConfirmBar, countText } from './ConfirmBar';
import { Distribute } from './Distribute';
import { ExpeditionPanel } from './Expedition';
import { FuelGauge } from './FuelGauge';
import { useDecisionHistory } from './history';
import { kindIcon, kindLabel } from './labels';
import { contextCardId, friendlyLabel, friendlyText, sourceTitle } from './meta';
import { OptionList, type BodyProps } from './OptionList';
import { bumpPick, clearSelection, pickArray, toggleBoardPick, totalOf, useCounts } from './selection';
import { WORKSHOP_HINT, noteWorkshopStep, resetWorkshopRun, workshopPosition } from './workshop';
import './decisions.css';

export interface DecisionPanelProps {
  state: GameState;
  /** the seat this client plays (solo: the only seat) */
  seat: number;
  /** sends the picks for the open decision (ids repeated for distribute) */
  answer: (pick: string[]) => void;
  /** the viewer is the addressed seat (or anyone may answer) */
  canAnswer: boolean;
  /** an answer is on its way to the server */
  busy?: boolean;
  /** watch mode: the bot plays this decision, so the panel says so instead of naming a player */
  watching?: boolean;
}

/** Kinds whose card is worth drawing large beside the options. */
const ART_KINDS = new Set(['law', 'tech', 'card', 'citizen', 'scenario', 'type', 'expArrive', 'expExplore']);

/**
 * Kinds whose options are board spaces or empty hexes. The map highlights each legal option and a click answers, so the
 * panel shows no list of them: the rows stay in the DOM for the keyboard and show when focus enters them. The list
 * comes back in full when the map cannot draw (useUi mapDown). `thump` and `distribute` kinds pick several spaces: the
 * map toggles them (App onPickOption) and the panel's Confirm sends them.
 */
const MAP_ANSWER_KINDS = new Set(['tileSlot', 'space', 'adjacentSpace', 'treePick', 'buildSpace', 'thump']);
const MAP_HINT: Record<string, string> = {
  tileSlot: 'Click a highlighted hex on the map',
  space: 'Click a highlighted space on the map',
  adjacentSpace: 'Click a highlighted space on the map',
  treePick: 'Click a highlighted space on the map',
  buildSpace: 'Click a highlighted space on the map',
  thump: 'Click the highlighted spaces on the map',
};

function lastEventLine(state: GameState): string {
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i];
    if (!isMinorLog(e.t)) return e.m;
  }
  return '';
}

export function DecisionPanel({ state, answer, canAnswer, busy = false, watching = false }: DecisionPanelProps) {
  const engine = state.pending;
  // A Workshop effect shows its place in the run and what each option does; everything else is shown as the engine gives it.
  const wsPos = workshopPosition(engine);
  const p: Pending | null = useMemo(() => {
    if (!engine || !wsPos) return engine;
    return {
      ...engine,
      prompt: `Workshop effect ${wsPos.k} of ${wsPos.n}`,
      options: engine.options.map((o) => (WORKSHOP_HINT[o.id] ? { ...o, hint: WORKSHOP_HINT[o.id] } : o)),
    };
  }, [engine, wsPos?.k, wsPos?.n]);
  useEffect(() => {
    noteWorkshopStep(engine);
  }, [engine]);
  const counts = useCounts(p);
  const total = totalOf(counts);
  const distribute = !!p?.meta?.caps;
  const mapDown = useUi((s) => s.mapDown);
  // a position decision the map answers: its options are shown on the map, not in the panel
  const mapOnly =
    !!p &&
    !mapDown &&
    p.options.length > 0 &&
    MAP_ANSWER_KINDS.has(p.kind) &&
    p.options.every((o) => resolvePickId(state, o.id) !== null);
  // several map picks (a distribute or N-of-M) are sent by the Confirm bar; a single pick answers on the map click
  const confirmOnMap = mapOnly && (distribute || (!!p && p.max > 1));
  const multi = !!p && !distribute && p.max > 1;
  const confirmable = !!p && total >= p.min && total <= p.max;
  const live = !!p && canAnswer && !busy;
  const who = p && p.who >= 0 ? state.players[p.who]?.name : undefined;
  const blocked = !canAnswer
    ? watching
      ? t('The bot is choosing')
      : `${t('Waiting for')} ${who ?? t('another player')}`
    : busy
      ? t('Sending the answer...')
      : '';
  const lastEvent = useMemo(() => lastEventLine(state), [state.log]);

  const press = useCallback(
    (id: string) => {
      if (!p || !live) return;
      const o = p.options.find((x) => x.id === id);
      if (!o || o.disabled) return;
      if (distribute) {
        playSfx('tick');
        bumpPick(p, id, 1);
      } else if (multi) {
        playSfx('tick');
        toggleBoardPick(p, id);
      } else {
        answer([id]);
      }
    },
    [p, live, distribute, multi, answer],
  );

  const confirm = useCallback(() => {
    if (!p || !live || !confirmable) return;
    answer(pickArray(p, counts));
  }, [p, live, confirmable, counts, answer]);

  // Back to the action menu this decision came from (offered only while Pending.back is set). The engine restores the
  // state from before the action was picked, so the picks made in it are dropped too.
  const goBack = useCallback(() => {
    if (!p || !live || !p.back) return;
    clearSelection();
    resetWorkshopRun();
    answer([BACK_PICK]);
  }, [p, live, answer]);

  // Keyboard: 1-9 pick the option with that number, Enter confirms a multi-choice selection, Escape clears it (when
  // there is one; otherwise Escape reaches the App and opens the menu). Capture phase, so it runs before App's listener.
  useEffect(() => {
    if (!p) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'Escape') {
        if (total > 0) {
          e.preventDefault();
          clearSelection();
        }
        return;
      }
      if (!live) return;
      if (e.key === 'Enter' && (multi || distribute) && confirmable) {
        // Enter on a focused control keeps its own action.
        if (t && t.closest('button, [role="button"]')) return;
        e.preventDefault();
        confirm();
        return;
      }
      // a map-only decision has no list on the panel, so number keys would pick from an invisible list: the map does it
      if (mapOnly) return;
      if (/^[1-9]$/.test(e.key)) {
        const ordered = p.kind === 'action' ? actionOrder(p.options) : p.options;
        const o = ordered[Number(e.key) - 1];
        if (o) {
          e.preventDefault();
          press(o.id);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [p, live, total, multi, distribute, mapOnly, confirmable, press, confirm]);

  if (!p) return null;

  const artId = ART_KINDS.has(p.kind) ? contextCardId(p) : null;
  const confirmReason = !canAnswer || busy ? blocked : confirmable ? undefined : t(`Choose ${countText(p.min, p.max)}`);
  const body: BodyProps = { p, state, live, counts, total, multi, press, blocked, confirm, confirmReason };

  let content: ReactNode;
  if (p.kind === 'action') {
    content = <ActionMenu {...body} />;
  } else if (p.kind === 'fuel') {
    content = <FuelGauge {...body} />;
  } else if (p.kind === 'expArrive' || p.kind === 'expExplore') {
    content = <ExpeditionPanel {...body} />;
  } else if (mapOnly) {
    // the legal options are highlighted on the map and a click answers (App.onPickOption), or toggles the pick of a
    // multi-pick decision until Confirm. The panel says where to click and why an option is off; the rows are kept for
    // the keyboard and show only when focus enters them.
    const off = p.options.filter((o) => o.disabled);
    content = (
      <>
        {live ? <div className="dec-status">{tn(MAP_HINT[p.kind])}</div> : null}
        {off.length > 0 ? (
          <ul className="dec-off-list">
            {off.map((o) => (
              <li key={o.id}>
                <span className="dec-off-name">{tn(friendlyLabel(p, o))}</span>
                <span className="dec-off">{tn(o.disabled ?? '')}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="dec-keys">
          <OptionList {...body} numbered={false} />
        </div>
        {confirmOnMap ? (
          <ConfirmBar
            text={t(`${total} of ${countText(p.min, p.max)} ${distribute ? 'assigned' : 'chosen'}`)}
            label={busy ? t('Sending...') : t('Confirm')}
            reason={confirmReason}
            onConfirm={confirm}
          />
        ) : p.min === 0 ? (
          <div className="dec-only">
            <Button variant="ghost" disabledReason={live ? undefined : blocked} onClick={() => answer([])}>
              {tn('Skip')}
            </Button>
          </div>
        ) : null}
      </>
    );
  } else if (distribute) {
    content = <Distribute {...body} />;
  } else if (p.options.length === 0) {
    content = (
      <div className="dec-only">
        <Button variant="primary" disabledReason={live ? undefined : blocked} onClick={() => answer([])}>
          {tn('Continue')}
        </Button>
      </div>
    );
  } else {
    content = (
      <>
        {mapDown && MAP_ANSWER_KINDS.has(p.kind) ? <div className="dec-status">{tn('No map? Pick from a list')}</div> : null}
        <OptionList {...body} />
        {multi ? (
          <ConfirmBar
            text={t(`${total} of ${countText(p.min, p.max)} chosen`)}
            label={busy ? t('Sending...') : t('Confirm')}
            reason={confirmReason}
            onConfirm={confirm}
          />
        ) : p.min === 0 ? (
          <div className="dec-only">
            <Button variant="ghost" disabledReason={live ? undefined : blocked} onClick={() => answer([])}>
              {tn('Skip')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <Panel
      tone="ember"
      className={cx('decision', 'dec', !live && 'is-blocked')}
      title={tn(friendlyText(p.prompt))}
      kicker={
        <span className="dec-kicker">
          <Icon name={wsPos ? 'tech' : kindIcon(p.kind)} size={12} />
          {wsPos ? tn('Workshop') : tn(kindLabel(p.kind))}
        </span>
      }
    >
      <div className="dec-why">
        <span className="dec-why-k">{tn('Asked because')}</span>
        <b>{tn(sourceTitle(p.src) ?? kindLabel(p.kind))}</b>
        {lastEvent ? (
          <span className="dec-why-log" title={t(lastEvent)}>
            {tn(lastEvent)}
          </span>
        ) : null}
      </div>
      {blocked ? (
        <div className={cx('dec-wait', busy && canAnswer && 'dec-wait--busy')} role="status">
          <span className="dec-pulse" aria-hidden="true" />
          {blocked}
        </div>
      ) : null}
      <div className={cx('dec-body', artId && 'dec-body--art')}>
        {artId ? (
          <div className="dec-art">
            <CardImage id={artId} w={112} />
          </div>
        ) : null}
        <div className="dec-main">
          {content}
          {p.back ? (
            <div className="dec-only">
              <Button
                variant="ghost"
                title={t('Go back to the action menu. Nothing from this action is kept.')}
                disabledReason={live ? undefined : blocked}
                onClick={goBack}
              >
                {tn('Back to actions')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <Recent />
    </Panel>
  );
}

/** The last few answers this player sent, newest first. */
function Recent() {
  const entries = useDecisionHistory((s) => s.entries);
  if (entries.length === 0) return null;
  return (
    <ol className="dec-recent" aria-label={t('Your last decisions')}>
      {entries
        .slice(-3)
        .reverse()
        .map((e) => (
          <li key={e.n}>
            <span className="dec-recent-r">{t('R')}{e.round}</span>
            {tn(e.title)}: <b>{tn(e.picked)}</b>
          </li>
        ))}
    </ol>
  );
}
