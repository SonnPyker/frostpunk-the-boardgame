// Right column, top: the Generator. Heat track (16), Cold marker, Heat Range indicators, Stress (10 + overflow), fuel hint.
import { memo } from 'react';
import type { CSSProperties } from 'react';
import { heatTrack } from '@frostpunk/engine';
import type { CitizenType, GameState } from '@frostpunk/engine';
import { t, tn } from '../i18n';
import { boardArt } from './assets';
import { HudPanel, tip } from './context';
import { Icon } from './icons';
import {
  CITIZEN_COLOR,
  CITIZEN_LABEL,
  CITIZEN_SHORT,
  HEAT_LEN,
  STRESS_SLOTS,
  coldIcons,
  cubesForHeat,
  fuelRoomOf,
  sameSig,
  sliceSig,
} from './model';
import type { SigProps } from './model';

export const GENERATOR_KEYS = ['gen', 'res', 'round'] as const satisfies readonly (keyof GameState)[];
export const generatorSig = (s: GameState) => sliceSig(s, GENERATOR_KEYS);

interface Props extends SigProps {
  state: GameState;
}

type Zone = 'red' | 'orange' | 'yellow';
const ZONE_LABEL: Record<Zone, string> = { red: 'Red', orange: 'Orange', yellow: 'Yellow' };

function GeneratorBoardImpl({ state: s }: Props) {
  const g = s.gen;
  const icons = coldIcons(g.heat, g.cold);
  const room = fuelRoomOf(s.res.coal, g.heat, g.cold);
  const cubes = cubesForHeat(g.heat);
  const total = g.stress + g.overflow;
  const carried = g.carry ?? 0;

  const flags = (
    <span className="hud-flags">
      {g.broken ? <span className="hud-flag is-bad" {...tip(t('The Generator broke down once. A second overflow of the Stress track makes it explode and the game is lost.'))}>
        <Icon name="broken" size={12} /> {tn('Broken')}
      </span> : null}
      {g.upgraded ? <span className="hud-flag is-good" {...tip(t('Generator Upgrade placed: the drawer catches more Stress cubes.'))}>{tn('Upgraded')}</span> : null}
      {carried > 0 ? (
        <span
          className="hud-flag is-carry"
          {...tip(carried === 1
            ? t('1 Coal cube fell out of the Generator when the drawer was inserted. It is placed on the Stress track at the next Generator phase.')
            : t(`${carried} Coal cubes fell out of the Generator when the drawer was inserted. They are placed on the Stress track at the next Generator phase.`))}
        >
          {carried} {carried === 1 ? tn('cube') : tn('cubes')} {tn('carried to next round')}
        </span>
      ) : null}
    </span>
  );

  return (
    <HudPanel title={t('Generator')} icon="generator" aside={flags} className="hud-generator" persistKey="generator" art={boardArt('board_generator')}>
      <div className="hud-heat-head">
        <span className="hud-heat-read">
          <Icon name="heat" size={14} /> {tn('Heat')} <b>{g.heat}</b>
        </span>
        <span className="hud-heat-read is-cold" {...tip(t('Cold marker: sickness icons between Heat and Cold strike when the Generator phase is not fuelled.'))}>
          <Icon name="cold" size={14} /> {tn('Cold')} <b>{g.cold}</b>
        </span>
      </div>

      <div className="hud-heat-track" style={{ ['--n' as string]: HEAT_LEN } as CSSProperties} role="img" aria-label={t(`Heat ${g.heat}, Cold ${g.cold}`)}>
        {heatTrack.map((sp) => {
          const pos = sp.pos;
          const icon = sp.icon as CitizenType | null;
          const isHeat = pos === g.heat;
          const isCold = pos === g.cold;
          const between = pos > g.heat && pos < g.cold;
          const zones = (['red', 'orange', 'yellow'] as Zone[]).filter((z) => g.ind[z] === pos);
          const cls = ['hud-hc', isHeat ? 'is-heat' : '', isCold ? 'is-cold' : '', between && icon ? 'is-between' : '', pos > g.cold ? 'is-beyond' : ''].join(' ');
          const text =
            t(`Space ${pos}: ${sp.cubes} Coal cube${sp.cubes === 1 ? '' : 's'} drop on the stress check`) +
            (icon ? `. ${t(CITIZEN_LABEL[icon])} ${t('icon: sickness if the Heat marker is below it and not fuelled.')}` : '.') +
            (isHeat ? ` ${t('Heat marker is here.')}` : '') +
            (isCold ? ` ${t('Cold marker is here.')}` : '');
          return (
            <div key={pos} className={cls} {...tip(text)}>
              <span className="hud-hc-num">{pos}</span>
              <span className="hud-hc-cubes" aria-hidden="true">{sp.cubes}</span>
              <span className="hud-hc-icon" style={icon ? ({ ['--c' as string]: CITIZEN_COLOR[icon] } as CSSProperties) : undefined}>
                {icon ? <Icon name={icon} size={10} /> : null}
              </span>
              {zones.map((z) => (
                <span key={z} className={`hud-zone-pin is-${z}`}>{t(ZONE_LABEL[z])[0]}</span>
              ))}
            </div>
          );
        })}
      </div>

      <div className="hud-zones">
        {(['red', 'orange', 'yellow'] as Zone[]).map((z) => {
          const v = g.ind[z];
          const heated = v !== null && g.heat > v;
          const text =
            v === null
              ? `${t(ZONE_LABEL[z])} ${t('Heat Range indicator was removed. Buildings in this zone stay unheated.')}`
              : `${t(ZONE_LABEL[z])} ${t(`Heat Range indicator on space ${v}. Zone is heated while the Heat marker is above ${v} (currently ${g.heat}).`)}`;
          return (
            <span key={z} className={`hud-zone is-${z} ${v === null ? 'is-removed' : heated ? 'is-heated' : 'is-cold'}`} {...tip(text)}>
              <i />
              {tn(ZONE_LABEL[z])} {v === null ? tn('removed') : <>{tn('above')} {v} · <b>{heated ? tn('heated') : tn('unheated')}</b></>}
            </span>
          );
        })}
      </div>

      <div className="hud-stress" aria-label={t('Stress')}>
        <div className="hud-block-head">
          <span>{tn('Stress')}</span>
          <span className="hud-num" {...tip(t('Stress cubes on the track. Overflow beyond 10 breaks the Generator.'))}>
            {total}
            <span className="hud-muted"> / {STRESS_SLOTS}</span>
          </span>
        </div>
        <div className="hud-stress-slots">
          {Array.from({ length: STRESS_SLOTS }).map((_, i) => (
            <i key={i} className={'hud-cube' + (i < g.stress ? ' is-on' : '')} />
          ))}
          <i
            className={'hud-cube is-overflow' + (g.overflow > 0 ? ' is-on' : '')}
            {...tip(t('Overflow space: any cube here breaks the Generator.'))}
          />
        </div>
      </div>

      <div className="hud-gen-foot">
        <div className="hud-fuel" {...tip(t('Fuel: spend Coal into the Generator (Heat +1 per Coal, never above Cold). Fuelling protects the citizens between Heat and Cold.'))}>
          <Icon name="fuel" size={14} />
          <span>
            {tn('Fuel room')} <b>{room}</b> <span className="hud-muted">({tn('coal')} {s.res.coal})</span>
          </span>
        </div>
        <div className="hud-drop" {...tip(t('Cubes dropped at the stress check: the space the Heat marker is on.'))}>
          <span>{tn('Drop')} <b>{cubes}</b> {tn('Coal on the stress check')}</span>
        </div>
        <div className="hud-cold-hit">
          {icons.length === 0 ? (
            <span className="hud-muted">{tn('No citizen icon between Heat and Cold: no cold sickness.')}</span>
          ) : (
            <>
              <span className="hud-muted">{tn('Cold sickness if not fuelled:')}</span>
              {icons.map((t, i) => (
                <span key={i} className="hud-cold-chip" style={{ ['--c' as string]: CITIZEN_COLOR[t] } as CSSProperties}>
                  <Icon name={t} size={11} /> {tn(CITIZEN_SHORT[t])}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
    </HudPanel>
  );
}

export const GeneratorBoard = memo(GeneratorBoardImpl, sameSig);
