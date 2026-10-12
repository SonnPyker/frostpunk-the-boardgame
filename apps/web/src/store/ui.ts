// Screen routing and transient UI state (menus, overlays, toasts). The game view is derived from the
// session (store/session.ts): no session = menus, session without a finished state = lobby, otherwise game.
import { create } from 'zustand';

export type MenuScreen = 'menu' | 'newSolo' | 'coopHost' | 'coopJoin';
export type Overlay = 'settings' | 'rules' | 'credits' | 'ingame' | null;
export type ToastTone = 'info' | 'ok' | 'error';

export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

interface UiStore {
  screen: MenuScreen;
  overlay: Overlay;
  toast: Toast | null;
  setScreen: (screen: MenuScreen) => void;
  openOverlay: (overlay: Exclude<Overlay, null>) => void;
  closeOverlay: () => void;
  notify: (text: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useUi = create<UiStore>()((set) => ({
  screen: 'menu',
  overlay: null,
  toast: null,
  setScreen: (screen) => set({ screen }),
  openOverlay: (overlay) => set({ overlay }),
  closeOverlay: () => set({ overlay: null }),
  notify: (text, tone = 'info') => {
    toastSeq += 1;
    set({ toast: { id: toastSeq, text, tone } });
  },
  dismissToast: (id) => set((s) => (s.toast?.id === id ? { toast: null } : s)),
}));
