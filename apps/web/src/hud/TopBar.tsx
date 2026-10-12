// Top bar: scenario, Round track 1..15 (round marker, storm marker, development token, scenario triggers, round type), phase chips.
import { memo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { roundType, scenarioCards } from '@frostpunk/engine';
import type { GameState } from '@frostpunk/engine';
import { t, tn } from '../i18n';
import { tip } from './context';
import { Icon } from './icons';
import { PHASES, ROUND_LEN, SCENARIO_NAME, cardTitle, sameSig, sliceSig } from './model';
import type { SigProps } from './model';


export const TOPBAR_KEYS = [
  'config',
  'round',
  'phase',
  'stormMarker',
  'stormsHit',
  'techs',
  'techInProgress',
  'triggers',
] as const satisfies readonly (keyof GameState)[];
export const topBarSig = (s: GameState) => sliceSig(s, TOPBAR_KEYS);

interface TopBarProps {
  state: GameState;
  menu?: ReactNode;
}

export function TopBar({ state, menu }: TopBarProps) {
  return (
    <div className="hud-topbar">
      <ScenarioBadge state={state} />
      <RoundTrack state={state} sig={topBarSig(state)} />
      <div className="hud-topbar-right">
        <PhaseChips phase={state.phase} sig={sliceSig(state, ['phase'] as const)} />
        {menu ? <div className="hud-menu">{menu}</div> : null}
      </div>
    </div>
  );
}

export function ScenarioBadge({ state: s }: { state: GameState }) {
  const name = SCENARIO_NAME[s.config.scenario] ?? s.config.scenario;
  const difficulty = s.config.difficulty === 'hard' ? 'Hard' : 'Normal';
  const mode = s.config.mode === 'coop' ? 'Co-op' : 'Solo';
  return (
    <div className="hud-scenario" {...tip(`${t(name)} · ${t(`Society ${s.config.society}`)} · ${t(difficulty)} · ${t(mode)}`)}>
      <span className="hud-scenario-name">{tn(name)}</span>
      <span className="hud-scenario-sub">
        {tn('Society')} {s.config.society} · {tn(difficulty)} · {tn('Round')} <b>{s.round}</b>/{ROUND_LEN}
      </span>
    </div>
  );
}

// ---- Round track -----------------------------------------------------------------------------------------

function RoundTrackImpl({ state: s }: { state: GameState } & SigProps) {
  const rounds = Array.from({ length: ROUND_LEN }, (_, i) => i + 1);
  const dev = s.techs.filter((tk) => tk.state === 'developing' && tk.dueRound !== null);
  const trig = s.triggers.map((tg) => ({ round: tg.round, card: tg.card }));
  const style = { ['--n' as string]: ROUND_LEN } as CSSProperties;
  return (
    <div className="hud-rounds" style={style} aria-label={t('Round track')}>
      <div className="hud-rounds-cells">
        {rounds.map((r) => {
          const type = roundType(r);
          const devHere = dev.filter((tk) => tk.dueRound === r);
          const trigHere = trig.filter((tg) => tg.round === r);
          const storm = s.stormMarker === r;
          const cls = [
            'hud-round',
            r === s.round ? 'is-current' : r < s.round ? 'is-past' : '',
            storm ? 'has-storm' : '',
          ].join(' ');
          const text = [
            `${t('Round')} ${r} (${t(type)} ${t('round')})`,
            r === s.round ? t('Round marker is here.') : '',
            storm ? t('Storm marker: the Storm card strikes on this Round.') : '',
            ...devHere.map((tk) => `${t('Technology')} ${tk.id} (${t(cardTitle(tk.id))}) ${t('completes this Round.')}`),
            ...trigHere.map((tg) => `${t('Scenario trigger:')} ${t(scenarioTrigger(tg.card))}`),
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={r} className={cls} {...tip(text)}>
              <span className="hud-round-num">{r}</span>
              <span className={`hud-round-type is-${type}`} aria-hidden="true">
                <Icon name={type} size={12} />
              </span>
              {storm ? <span className="hud-round-storm" aria-hidden="true"><Icon name="storm" size={13} /></span> : null}
              {devHere.map((tk) => (
                <span key={tk.id} className="hud-round-dev" aria-hidden="true">{tk.id.replace('T', '')}</span>
              ))}
              {trigHere.length ? <span className="hud-round-trig" aria-hidden="true" /> : null}
            </div>
          );
        })}
      </div>
      <div className="hud-rounds-legend">
        <span {...tip(t('The Round marker advances each Round. The Round type icon is the Citizen type that feeds this Round.'))}>
          <Icon name="round" size={12} /> {tn('Round')} {s.round}
        </span>
        <span {...tip(s.stormMarker ? t(`Storm marker on Round ${s.stormMarker}. Storms hit so far: ${s.stormsHit}.`) : t(`No Storm marker left on the Round track. Storms hit so far: ${s.stormsHit}.`))}>
          <Icon name="storm" size={12} /> {s.stormMarker ? tn(`Storm at ${s.stormMarker}`) : tn('No storm left')}
        </span>
        {s.techInProgress ? (
          <span {...tip(`${t('Technology under development:')} ${s.techInProgress} ${t(cardTitle(s.techInProgress))}.`)}>
            <Icon name="tech" size={12} /> {tn('Developing')} {s.techInProgress}
          </span>
        ) : null}
        {trig.length ? (
          <span {...tip(t('Scenario triggers: scenario events that fire when the Round marker reaches their space.'))}>
            <i className="hud-trig-key" /> {trig.length} {trig.length === 1 ? tn('trigger') : tn('triggers')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function scenarioTrigger(card: string): string {
  const d = scenarioCards[card];
  return d?.title ?? card;
}

export const RoundTrack = memo(RoundTrackImpl, sameSig);

// ---- Phase chips -----------------------------------------------------------------------------------------

export const PhaseChips = memo(function PhaseChips({ phase }: { phase: GameState['phase']; sig: string }) {
  return (
    <ol className="hud-phases" aria-label={t('Phases')}>
      {PHASES.map((p) => (
        <li
          key={p.id}
          className={'hud-phase' + (p.id === phase ? ' is-current' : '')}
          aria-current={p.id === phase ? 'step' : undefined}
          {...tip(t(p.hint))}
        >
          {tn(p.label)}
        </li>
      ))}
    </ol>
  );
}, sameSig);
