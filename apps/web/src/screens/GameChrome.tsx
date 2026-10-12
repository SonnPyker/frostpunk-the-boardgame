// Game-screen chrome that sits around the HUD: the menu and sound buttons (passed into the HUD's top-bar `menu`
// slot). Whose decision is open and what it asks is shown once, by the DecisionPanel; the scenario, round track and
// phase chips are drawn by the HUD's own TopBar, so this file does not repeat them.
import { useRef } from 'react';
import { Button } from '../components/ui';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { t, tn } from '../i18n';

const DEFAULT_MUSIC = 0.45;
const DEFAULT_SFX = 0.7;
const REMEMBER_KEY = 'frostpunk.premute.v1';

function readRemembered(): { music: number; sfx: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(REMEMBER_KEY) ?? 'null');
    if (v && typeof v.music === 'number' && typeof v.sfx === 'number' && v.music >= 0 && v.sfx >= 0) return { music: v.music, sfx: v.sfx };
  } catch {
    /* storage unavailable */
  }
  return null;
}

function writeRemembered(v: { music: number; sfx: number } | null) {
  try {
    if (v) localStorage.setItem(REMEMBER_KEY, JSON.stringify(v));
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Menu and sound buttons for the top-right corner of the game screen. */
export function GameMenuControls() {
  const openOverlay = useUi((s) => s.openOverlay);
  const musicVolume = useSettings((s) => s.musicVolume);
  const sfxVolume = useSettings((s) => s.sfxVolume);
  const update = useSettings((s) => s.update);
  // The volumes before a mute, so unmuting restores them (also kept in localStorage so it survives a reload).
  const remembered = useRef<{ music: number; sfx: number } | null>(readRemembered());
  const muted = musicVolume === 0 && sfxVolume === 0;

  const toggleSound = () => {
    if (muted) {
      const r = remembered.current ?? { music: DEFAULT_MUSIC, sfx: DEFAULT_SFX };
      remembered.current = null;
      writeRemembered(null);
      update({ musicVolume: r.music, sfxVolume: r.sfx });
    } else {
      remembered.current = { music: musicVolume, sfx: sfxVolume };
      writeRemembered(remembered.current);
      update({ musicVolume: 0, sfxVolume: 0 });
    }
  };

  return (
    <div className="game-menu-controls">
      <Button
        variant="ghost"
        size="sm"
        icon={muted ? 'mute' : 'sound'}
        aria-label={muted ? t('Turn sound on') : t('Turn sound off')}
        title={muted ? t('Turn sound on') : t('Turn sound off')}
        onClick={toggleSound}
        silent
      />
      <Button variant="secondary" size="sm" icon="gear" onClick={() => openOverlay('ingame')}>
        {tn('Menu')}
      </Button>
    </div>
  );
}

