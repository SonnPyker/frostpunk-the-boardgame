// Public audio API. Usage: playSfx('confirm') from any module; unlockAudio() on the first user gesture.
import { audio, type SfxName } from './audio';
import { useSettings } from '../store/settings';

export type { SfxName };

/** Call from a pointer/key handler once (the App does this on the first gesture). */
export function unlockAudio(): void {
  audio.unlock();
}

/** Procedural UI sound (click, confirm, error, heatUp, snowWind, bell, tick). Silent before unlock. */
export function playSfx(name: SfxName): void {
  audio.playSfx(name);
}

/**
 * Keeps the audio engine in step with the Settings store and the page visibility. Returns a disposer.
 * Safe to call more than once in StrictMode: each call returns its own disposer.
 */
export function bindAudioToSettings(): () => void {
  const apply = () => {
    const s = useSettings.getState();
    audio.setVolumes(s.musicVolume, s.sfxVolume);
  };
  apply();
  const unsub = useSettings.subscribe(apply);
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') audio.suspend();
    else audio.resume();
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    unsub();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
