// The active game session: which controller is attached and its latest snapshot. Screens read `snap`
// and call the actions; controllers push new snapshots into the store.
import { create } from 'zustand';
import type { GameConfig } from '@frostpunk/engine';
import { LocalController } from '../controller/LocalController';
import { RemoteController } from '../controller/RemoteController';
import { EngineUnavailableError, createGameState } from '../controller/engineApi';
import { clearSoloSave, hasSoloSave, readCoopSession } from '../controller/persistence';
import type { Controller, ControllerSnapshot } from '../controller/types';
import { useUi } from './ui';
import { clearDecisionHistory } from '../decisions/history';
import { t } from '../i18n';

/** Co-op server (WebSocket). Set VITE_SERVER_URL at build time; local development defaults to localhost. */
export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() || 'ws://localhost:8080';

interface SessionStore {
  controller: Controller | null;
  snap: ControllerSnapshot | null;
  /** starts a new solo game (throws nothing: failures become toasts and false is returned) */
  startSolo: (config: GameConfig) => boolean;
  continueSolo: () => boolean;
  /** creates a co-op controller and attaches it; the caller then sends create/join */
  openCoop: () => RemoteController;
  /** re-attaches the stored co-op seat */
  resumeCoop: () => boolean;
  answer: (pick: string[]) => void;
  /** leaves the screen: a solo game stays autosaved; co-op keeps the seat on the server */
  detach: () => void;
  /** leaves the co-op lobby for good (sends leave) */
  leaveRoom: () => void;
  /** ends the current solo game for good (removes the autosave) */
  discardSolo: () => void;
  /** coop: a seat exists (in this tab or as the fallback); coopFallback: only the localStorage fallback holds it */
  hasSaved: () => { solo: boolean; coop: boolean; coopCode: string | null; coopFallback: boolean };
}

let unsubscribe: (() => void) | null = null;

function attach(controller: Controller): void {
  unsubscribe?.();
  const previous = useSession.getState().controller;
  if (previous && previous !== controller) previous.dispose();
  // A new or continued game starts with an empty decision trail (it belongs to the game that was on screen).
  clearDecisionHistory();
  unsubscribe = controller.subscribe((snap) => useSession.setState({ snap }));
  useSession.setState({ controller, snap: controller.getSnapshot() });
}

function detachAll(): void {
  unsubscribe?.();
  unsubscribe = null;
  const c = useSession.getState().controller;
  c?.dispose();
  clearDecisionHistory();
  useSession.setState({ controller: null, snap: null });
}

export const useSession = create<SessionStore>()((set, get) => ({
  controller: null,
  snap: null,

  startSolo: (config) => {
    try {
      const state = createGameState(config);
      const controller = new LocalController(state, config);
      attach(controller);
      return true;
    } catch (e) {
      const msg =
        e instanceof EngineUnavailableError
          ? t('The rules engine is not wired into this build yet.')
          : e instanceof Error
            ? e.message
            : t('Could not start the game.');
      useUi.getState().notify(msg, 'error');
      return false;
    }
  },

  continueSolo: () => {
    let result: ReturnType<typeof LocalController.restore>;
    try {
      result = LocalController.restore();
    } catch {
      // restore() handles stale saves itself; anything else must not crash the menu
      useUi.getState().notify(t('The saved game could not be restored. Start a new one.'), 'error');
      return false;
    }
    if (!result.ok) {
      useUi.getState().notify(result.message, 'error');
      return false;
    }
    attach(result.controller);
    return true;
  },

  openCoop: () => {
    const controller = new RemoteController(SERVER_URL);
    attach(controller);
    return controller;
  },

  resumeCoop: () => {
    const stored = readCoopSession();
    if (!stored) return false;
    const controller = new RemoteController(stored.serverUrl || SERVER_URL);
    attach(controller);
    return controller.resume();
  },

  answer: (pick) => {
    get().controller?.answer(pick);
  },

  detach: () => {
    const c = get().controller;
    if (c instanceof RemoteController) c.detach();
    detachAll();
  },

  leaveRoom: () => {
    const c = get().controller;
    if (c instanceof RemoteController) c.leave();
    detachAll();
  },

  discardSolo: () => {
    clearSoloSave();
    detachAll();
  },

  hasSaved: () => {
    const seat = readCoopSession();
    return {
      solo: hasSoloSave(),
      coop: seat !== null,
      coopCode: seat?.code ?? null,
      coopFallback: seat?.fallback === true,
    };
  },
}));

/** Lets screens refer to the session without subscribing to every snapshot. */
export function currentSnapshot(): ControllerSnapshot | null {
  return useSession.getState().snap;
}
