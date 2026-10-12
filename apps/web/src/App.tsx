// App shell. The visible screen is derived from the session and ui stores:
//   no controller            -> MainMenu, or NewGame / co-op forms by ui.screen
//   co-op without a playing state (or room in lobby) -> Lobby
//   state not 'playing'      -> EndScreen
//   otherwise                -> game: 3D map (background) + HUD with the decision dock on top.
// The map and HUD (and an optional decisions module) are loaded defensively: when a module is missing from the
// build, a plain fallback is drawn so the shell still runs.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { GameState } from '@frostpunk/engine';
import { bindAudioToSettings, playSfx, unlockAudio } from './audio';
import { ErrorBoundary, Toast } from './components/ui';
import { useSession } from './store/session';
import { useUi } from './store/ui';
import { MainMenu } from './screens/MainMenu';
import { NewGame, type NewGameMode } from './screens/NewGame';
import { ScenarioSetup, type ScenarioSetupMode } from './screens/ScenarioSetup';
import { Lobby } from './screens/Lobby';
import { EndScreen } from './screens/EndScreen';
import { OverlayHost } from './screens/Overlays';
import { SimpleDecisionPanel, type SimpleDecisionPanelProps } from './screens/SimpleDecisionPanel';
import { GameMenuControls } from './screens/GameChrome';
import { recordDecision } from './decisions/history';
import { toggleBoardPick, useCounts } from './decisions/selection';
import { setPlayerNames, t, tn, useLang } from './i18n';

// ---- contracts with the MAP3D, HUD and DECISIONS modules --------------------

export interface MapViewProps {
  state: GameState;
  /** a clickable map object was clicked: its option id (space id, building uid, meeple id ...) */
  onPick: (optionId: string) => void;
  /** option ids the player may click now (they are highlighted on the map) */
  highlight: ReadonlySet<string>;
  /** option ids already picked in a multi-pick decision (drawn as picked on the map) */
  selected?: ReadonlySet<string>;
}

export interface HudSlotProps {
  state: GameState;
  seat: number;
  pickable?: ReadonlySet<string>;
  onPick?: (id: string) => void;
  /** rendered into the bottom-centre region (the decision dock) */
  children?: ReactNode;
  /** optional controls at the right end of the top bar */
  menu?: ReactNode;
}

export type DecisionPanelProps = SimpleDecisionPanelProps;

type Loader = () => Promise<Record<string, unknown>>;

/** The first module a glob matched, or null when none of the candidate files exist in this build. */
function firstLoader(mods: Record<string, unknown>): Loader | null {
  const key = Object.keys(mods)[0];
  return key ? (mods[key] as Loader) : null;
}

const mapLoader = firstLoader(import.meta.glob(['./map/index.ts', './map/index.tsx', './map.ts', './map.tsx']));
const hudLoader = firstLoader(import.meta.glob(['./hud/index.ts', './hud/index.tsx']));
const decisionsLoader = firstLoader(import.meta.glob(['./decisions/index.ts', './decisions/index.tsx']));

function FallbackMap(_props: MapViewProps) {
  return <div className="map-fallback" aria-hidden="true" />;
}

function FallbackHud({ state, children, menu }: HudSlotProps) {
  return (
    <div className="hud" data-phase={state.phase}>
      <div className="hud-fallback-top">
        <span className="label-caps">
          {tn(`Round ${state.round} of 15`)}
        </span>
        <span className="hud-fallback-phase">{state.phase}</span>
        <div className="hud-menu">{menu}</div>
      </div>
      {children}
    </div>
  );
}

const MapView = lazy<ComponentType<MapViewProps>>(async () => {
  if (!mapLoader) return { default: FallbackMap };
  const mod = (await mapLoader()) as { MapView?: ComponentType<MapViewProps> };
  return { default: mod.MapView ?? FallbackMap };
});

const Hud = lazy<ComponentType<HudSlotProps>>(async () => {
  if (!hudLoader) return { default: FallbackHud };
  const mod = (await hudLoader()) as { Hud?: ComponentType<HudSlotProps> };
  return { default: mod.Hud ?? FallbackHud };
});

const DecisionPanel = lazy<ComponentType<DecisionPanelProps>>(async () => {
  if (!decisionsLoader) return { default: SimpleDecisionPanel };
  const mod = (await decisionsLoader()) as { DecisionPanel?: ComponentType<DecisionPanelProps> };
  return { default: mod.DecisionPanel ?? SimpleDecisionPanel };
});

const NO_OPTIONS: ReadonlySet<string> = new Set<string>();
const noop = () => undefined;

// ---- shell ------------------------------------------------------------------

const SETUP_MODES: Record<string, NewGameMode> = { newSolo: 'solo', coopHost: 'host', coopJoin: 'join' };
const SCENARIO_MODES: Record<string, ScenarioSetupMode> = { scenarioRandom: 'random', scenarioCustom: 'custom' };

function menuScreenFor(screen: string): ReactNode {
  const mode = SETUP_MODES[screen];
  if (mode) return <NewGame mode={mode} />;
  const scenarioMode = SCENARIO_MODES[screen];
  if (scenarioMode) return <ScenarioSetup mode={scenarioMode} />;
  return <MainMenu />;
}

export function App() {
  const controller = useSession((s) => s.controller);
  const snap = useSession((s) => s.snap);
  const answerSession = useSession((s) => s.answer);
  const screen = useUi((s) => s.screen);
  const notify = useUi((s) => s.notify);
  const lang = useLang((s) => s.lang);

  // The pending id of the last answer sent; the Confirm buttons stay busy until the state moves on or an error arrives.
  const [sentId, setSentId] = useState<number | null>(null);
  const prevCue = useRef<{ round: number; heat: number } | null>(null);

  const state: GameState | null = snap?.state ?? null;
  // Set during render, before the children read the names: log lines that name a player are translated with them.
  setPlayerNames(state?.players.map((p) => p.name) ?? []);
  const room = snap?.room ?? null;
  const mode = snap?.mode ?? 'solo';
  const seat = snap?.seat ?? 0;
  const pending = state?.pending ?? null;
  const canAnswer = pending !== null && (mode === 'solo' || pending.who === -1 || pending.who === seat);

  const inLobby = controller !== null && mode === 'coop' && (state === null || room?.status === 'lobby');
  const inEnd =
    controller !== null && state !== null && !inLobby && (state.status !== 'playing' || room?.status === 'ended');
  const inGame = controller !== null && state !== null && !inLobby && !inEnd;

  const inGameRef = useRef(inGame);
  inGameRef.current = inGame;

  const errorSeq = snap?.errorSeq ?? 0;

  // Audio: bind to the settings once, unlock on the first gesture.
  useEffect(() => {
    const dispose = bindAudioToSettings();
    const onFirstGesture = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', onFirstGesture, true);
      window.removeEventListener('keydown', onFirstGesture, true);
    };
    window.addEventListener('pointerdown', onFirstGesture, true);
    window.addEventListener('keydown', onFirstGesture, true);
    return () => {
      dispose();
      window.removeEventListener('pointerdown', onFirstGesture, true);
      window.removeEventListener('keydown', onFirstGesture, true);
    };
  }, []);

  // Escape opens the in-game menu (the modals handle Escape themselves while they are open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!inGameRef.current || useUi.getState().overlay !== null) return;
      useUi.getState().openOverlay('ingame');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Errors from either controller become one toast each (errorSeq increments on every error).
  useEffect(() => {
    setSentId(null);
    const err = useSession.getState().snap?.error;
    if (err) notify(t(err), 'error');
  }, [errorSeq, notify]);

  // Sound cues: a new round rings the bell, a rise in heat plays the heat-up sound.
  useEffect(() => {
    if (!state) {
      prevCue.current = null;
      return;
    }
    const before = prevCue.current;
    if (before) {
      if (state.round > before.round) playSfx('bell');
      if (state.gen.heat > before.heat) playSfx('heatUp');
    }
    prevCue.current = { round: state.round, heat: state.gen.heat };
  }, [state]);

  const answerNow = useCallback(
    (pick: string[]) => {
      if (!pending || !canAnswer) return;
      setSentId(pending.id);
      recordDecision(state, pending, pick);
      playSfx('confirm');
      answerSession(pick);
    },
    [state, pending, canAnswer, answerSession],
  );

  // Map and HUD clicks answer single-choice decisions directly. Multi-choice decisions (N-of-M and distribute) add or
  // remove the pick in the shared selection; the decision panel's Confirm sends it.
  const onPickOption = useCallback(
    (id: string) => {
      if (!pending || !canAnswer || sentId === pending.id) return;
      const opt = pending.options.find((o) => o.id === id);
      if (!opt || opt.disabled) return;
      if (pending.max > 1) {
        playSfx('tick');
        toggleBoardPick(pending, id);
        return;
      }
      answerNow([id]);
    },
    [pending, canAnswer, sentId, answerNow],
  );

  const highlight = useMemo<ReadonlySet<string>>(() => {
    if (!pending || !canAnswer) return NO_OPTIONS;
    return new Set(pending.options.filter((o) => !o.disabled).map((o) => o.id));
  }, [pending, canAnswer]);

  // the options already picked for a multi-pick decision (distribute or N-of-M), so the map can show them
  const picked = useCounts(pending);
  const selected = useMemo<ReadonlySet<string>>(() => {
    const ids = Object.keys(picked).filter((id) => (picked[id] ?? 0) > 0);
    return ids.length ? new Set(ids) : NO_OPTIONS;
  }, [picked]);

  let body: ReactNode;
  if (!controller) {
    body = menuScreenFor(screen);
  } else if (inLobby) {
    body = <Lobby />;
  } else if (inEnd) {
    body = <EndScreen />;
  } else if (inGame && state) {
    const busy = pending !== null && sentId === pending.id;
    body = (
      <div className="game-view">
        <div className="app-layer app-layer--map">
          <ErrorBoundary
            name={t('3D map')}
            variant="corner"
            onError={() => useUi.getState().setMapDown()}
            fallback={() => <FallbackMap state={state} onPick={noop} highlight={NO_OPTIONS} />}
          >
            <Suspense fallback={<FallbackMap state={state} onPick={noop} highlight={NO_OPTIONS} />}>
              <MapView state={state} onPick={onPickOption} highlight={highlight} selected={selected} />
            </Suspense>
          </ErrorBoundary>
        </div>
        <div className="hud-layer">
          <ErrorBoundary name={t('HUD')} variant="corner">
            <Suspense fallback={null}>
              <Hud state={state} seat={seat} pickable={highlight} onPick={onPickOption} menu={<GameMenuControls />}>
                <div className="decision-dock">
                  {pending ? (
                    <ErrorBoundary name={t('Decision panel')} variant="inline">
                      <Suspense fallback={null}>
                        <DecisionPanel
                          state={state}
                          seat={seat}
                          answer={answerNow}
                          canAnswer={canAnswer}
                          busy={busy}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  ) : null}
                </div>
              </Hud>
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  return (
    // Keyed by language: t() and tn() read the language when they render, so a switch remounts the tree.
    // Game state and the open overlay live in stores, so nothing is lost by the remount.
    <div key={lang} className="app" data-view={!controller ? screen : inLobby ? 'lobby' : inEnd ? 'end' : 'game'}>
      <ErrorBoundary name={t('This screen')} variant="corner">
        {body}
      </ErrorBoundary>
      <ErrorBoundary name={t('Overlay')} variant="corner">
        <OverlayHost />
      </ErrorBoundary>
      <Toast />
    </div>
  );
}
