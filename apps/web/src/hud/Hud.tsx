// The HUD: Society board (left), Generator / Weather / Laws / Technologies / Events / Expeditions (right), round track and
// phases (top), resources, seats, hand and log (bottom). The centre is transparent so the 3D map shows through; the decision
// panel is rendered into `children`, which fills the bottom-centre region.
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { GameState } from '@frostpunk/engine';
import './hud.css';
import { t } from '../i18n';
import { HudContext, TipLayer } from './context';
import type { HudCtx } from './context';
import { CityTabs } from './CityTabs';
import { eventSig } from './EventDisplay';
import { expeditionSig } from './ExpeditionPanel';
import { GeneratorBoard, generatorSig } from './GeneratorBoard';
import { HandPanel, handSig } from './HandPanel';
import { lawsSig } from './LawsPanel';
import { LogFeed, logSig } from './LogFeed';
import { PlayersBar, playersSig } from './PlayersBar';
import { ResourceStrip, resourceSig } from './ResourceStrip';
import { SocietyBoard, societySig } from './SocietyBoard';
import { techSig } from './TechPanel';
import { TopBar } from './TopBar';
import { weatherSig } from './WeatherPanel';

export interface HudProps {
  state: GameState;
  /** the viewing seat (player index): its hand is shown and it is marked "You" */
  seat: number;
  /** ids the player may pick (card ids, building uids, space ids ...): they pulse and call onPick on click */
  pickable?: ReadonlySet<string>;
  onPick?: (id: string) => void;
  /** rendered into the bottom-centre region (the Decision panel) */
  children?: ReactNode;
  /** optional controls at the right end of the top bar (menu button etc.) */
  menu?: ReactNode;
}

const NOTHING: ReadonlySet<string> = new Set<string>();

export function Hud({ state, seat, pickable, onPick, children, menu }: HudProps) {
  const ctx = useMemo<HudCtx>(() => ({ pickable: pickable ?? NOTHING, onPick }), [pickable, onPick]);

  // One signature per panel: a panel re-renders only when the slice of state it reads has changed.
  const sig = {
    society: societySig(state),
    generator: generatorSig(state),
    weather: weatherSig(state),
    laws: lawsSig(state),
    tech: techSig(state),
    events: eventSig(state),
    expeditions: expeditionSig(state),
    players: playersSig(state, seat),
    hand: handSig(state, seat),
    resources: resourceSig(state),
    log: logSig(state),
  };

  return (
    <HudContext.Provider value={ctx}>
      <div className="hud" data-phase={state.phase}>
        <TipLayer />

        <div className="hud-top">
          <TopBar state={state} menu={menu} />
        </div>

        <aside className="hud-left" aria-label={t('Society')}>
          <SocietyBoard state={state} sig={sig.society} />
        </aside>

        <div className="hud-center" aria-hidden="true" />

        <aside className="hud-right" aria-label={t('Generator and city')}>
          <GeneratorBoard state={state} sig={sig.generator} />
          <CityTabs state={state} sig={sig} />
        </aside>

        <footer className="hud-bottom">
          <div className="hud-bottom-l">
            <ResourceStrip state={state} sig={sig.resources} />
            <PlayersBar state={state} seat={seat} sig={sig.players} />
            <HandPanel state={state} seat={seat} sig={sig.hand} />
          </div>
          <div className="hud-bottom-c">{children}</div>
          <div className="hud-bottom-r">
            <LogFeed state={state} sig={sig.log} />
          </div>
        </footer>
      </div>
    </HudContext.Provider>
  );
}
