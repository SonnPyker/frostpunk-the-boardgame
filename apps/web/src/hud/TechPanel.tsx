// Right column: Technologies T01-T17 with their state and the development progress of the one in progress.
import { memo } from 'react';
import type { CSSProperties } from 'react';
import { techs as techData } from '@frostpunk/engine';
import type { GameState } from '@frostpunk/engine';
import { t, tn } from '../i18n';
import { HudPanel, tip } from './context';
import { Icon } from './icons';
import { sameSig, sliceSig } from './model';
import type { SigProps } from './model';

export const TECH_KEYS = ['techs', 'techInProgress', 'round'] as const satisfies readonly (keyof GameState)[];
export const techSig = (s: GameState) => sliceSig(s, TECH_KEYS);

interface Props extends SigProps {
  state: GameState;
}

function TechPanelImpl({ state: s }: Props) {
  const done = s.techs.filter((t) => t.state === 'done').length;
  const developing = s.techs.find((t) => t.state === 'developing' && t.dueRound !== null);
  const dev = developing ? techData[developing.id] : undefined;
  const left = developing && developing.dueRound !== null ? developing.dueRound - s.round : null;
  const progress = dev && left !== null ? Math.max(0, Math.min(1, (dev.cost - left) / dev.cost)) : 0;

  return (
    <HudPanel title={t('Technologies')} icon="tech" aside={<span className="hud-muted">{done}/{s.techs.length || 0} {tn('developed')}</span>}>
      {s.techs.length === 0 ? (
        <p className="hud-empty">{tn('Technologies appear once the first Workshop is built.')}</p>
      ) : (
        <>
          {developing && dev ? (
            <div className="hud-dev-line" {...tip(`${developing.id} ${dev.title}: ${dev.text}`)}>
              <Icon name="tech" size={13} />
              <span className="hud-dev-name">{dev.title}</span>
              <span className="hud-muted">{left === 0 ? tn('completes this Round') : tn(`${left} Round${left === 1 ? '' : 's'} left`)}</span>
              <span className="hud-dev-bar" style={{ ['--p' as string]: progress } as CSSProperties}>
                <i />
              </span>
            </div>
          ) : (
            <p className="hud-muted hud-small">{tn('No Technology in development. The next inactive one starts with a Workshop.')}</p>
          )}
          <div className="hud-techs">
            {s.techs.map((t) => {
              const d = techData[t.id];
              const pct =
                t.state === 'done'
                  ? 1
                  : t.state === 'developing' && d && t.dueRound !== null
                    ? Math.max(0, Math.min(1, (d.cost - (t.dueRound - s.round)) / d.cost))
                    : 0;
              const text = d ? `${t.id} ${d.title} (${t.state}). ${d.text}` : t.id;
              return (
                <div key={t.id} className={`hud-tech is-${t.state}`} style={{ ['--p' as string]: pct } as CSSProperties} {...tip(text)}>
                  <span className="hud-tech-id">{t.id}</span>
                  <span className="hud-tech-name">{d?.title ?? t.id}</span>
                  <i className="hud-tech-bar" />
                  {t.state === 'done' ? <span className="hud-tech-done"><Icon name="check" size={10} /></span> : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </HudPanel>
  );
}

export const TechPanel = memo(TechPanelImpl, sameSig);
