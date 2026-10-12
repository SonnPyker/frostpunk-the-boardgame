// Victory / defeat summary shown when the game state leaves 'playing'. Solo: the autosave is removed so
// Continue cannot reopen a finished game. Co-op: the seat leaves the room for good.
import { useMemo } from 'react';
import type { GameState } from '@frostpunk/engine';
import { Button, Icon, Panel, cx } from '../components/ui';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { Backdrop } from './Backdrop';
import { tn } from '../i18n';

/** Turns an engine reason key such as "societyCollapsed" into a readable sentence fragment. */
export function humaniseReason(reason: string | null): string | null {
  if (!reason) return null;
  if (/\s/.test(reason)) return reason;
  const spaced = reason
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1) + '.';
}

export interface EndStats {
  round: number;
  population: number;
  workers: number;
  engineers: number;
  children: number;
  sick: number;
  hopeActive: number;
  discontentActive: number;
  laws: number;
  buildings: number;
  techsDone: number;
}

export function endStats(s: GameState): EndStats {
  const sick = (s.sick.worker?.n ?? 0) + (s.sick.engineer?.n ?? 0) + (s.sick.child?.n ?? 0);
  return {
    round: s.round,
    population: s.cit.worker + s.cit.engineer + s.cit.child,
    workers: s.cit.worker,
    engineers: s.cit.engineer,
    children: s.cit.child,
    sick,
    hopeActive: s.hope.filter((t) => t.a).length,
    discontentActive: s.disc.filter((t) => t.a).length,
    laws: s.laws.length,
    buildings: s.buildings.filter((b) => !b.ruins).length,
    techsDone: s.techs.filter((t) => t.state === 'done').length,
  };
}

export function EndScreen() {
  const snap = useSession((s) => s.snap);
  const discardSolo = useSession((s) => s.discardSolo);
  const leaveRoom = useSession((s) => s.leaveRoom);
  const setScreen = useUi((s) => s.setScreen);

  const state = snap?.state ?? null;
  const stats = useMemo(() => (state ? endStats(state) : null), [state]);
  const recent = useMemo(() => (state ? state.log.slice(-8) : []), [state]);

  if (!state || !stats || !snap) return null;

  const won = state.status === 'won';
  const reason = humaniseReason(state.endReason);
  const isCoop = snap.mode === 'coop';

  const toMenu = () => {
    if (isCoop) leaveRoom();
    else discardSolo();
    setScreen('menu');
  };

  const rows: { label: string; value: string | number; icon?: 'worker' | 'sick' | 'hope' | 'discontent' | 'core' }[] = [
    { label: 'Rounds survived', value: `${stats.round} / 15` },
    { label: 'Population', value: stats.population, icon: 'worker' },
    { label: 'Workers · Engineers · Children', value: `${stats.workers} · ${stats.engineers} · ${stats.children}` },
    { label: 'Sick citizens', value: stats.sick, icon: 'sick' },
    { label: 'Active Hope tokens', value: stats.hopeActive, icon: 'hope' },
    { label: 'Active Discontent tokens', value: stats.discontentActive, icon: 'discontent' },
    { label: 'Laws in force', value: stats.laws },
    { label: 'Buildings standing', value: stats.buildings },
    { label: 'Technologies completed', value: stats.techsDone, icon: 'core' },
  ];

  return (
    <div className={cx('end', won ? 'end--won' : 'end--lost')}>
      <Backdrop intensity={won ? 0.8 : 1.2} glow={won ? 'right' : 'center'} />
      <div className="end__grid">
        <header className="end__head">
          <p className="label-caps">{won ? tn('The city endures') : tn('The city has fallen')}</p>
          <h1 className="end__title">{won ? tn('Victory') : tn('Defeat')}</h1>
          {reason ? <p className="end__reason">{tn(reason)}</p> : null}
        </header>

        <Panel title={tn('Summary')} icon={won ? 'hope' : 'skull'} className="end__stats" tone={won ? 'ember' : 'frost'}>
          <dl className="stat-list">
            {rows.map((r) => (
              <div key={r.label} className="stat-list__row">
                <dt>
                  {r.icon ? <Icon name={r.icon} size={15} className="stat-list__icon" /> : null}
                  {tn(r.label)}
                </dt>
                <dd className="num">{r.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title={tn('Last events')} icon="book" className="end__log" scroll>
          {recent.length === 0 ? (
            <p className="muted">{tn('The log is empty.')}</p>
          ) : (
            <ol className="end-log">
              {recent.map((e) => (
                <li key={e.n} className="end-log__row">
                  <span className="end-log__round num">{tn('R')}{e.r}</span>
                  <span className="end-log__text">{tn(e.m)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <footer className="end__actions">
          <Button variant="primary" size="lg" icon="check" onClick={toMenu}>
            {isCoop ? tn('Leave the room') : tn('Return to the main menu')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
