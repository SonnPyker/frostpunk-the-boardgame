// Viewer controls for a watched game (watch mode): the bot's status, pause or play, one step at a time, and the speed.
// They sit in the HUD's top bar, in front of the game menu. The viewer cannot answer decisions; the bot does.
import type { ReactNode } from 'react';
import { Button } from '../components/ui';
import { WatchController, WATCH_SPEEDS } from '../controller/WatchController';
import type { WatchView } from '../controller/types';
import { useSession } from '../store/session';
import { t, tn } from '../i18n';

function statusLabel(status: WatchView['status']): ReactNode {
  switch (status) {
    case 'playing':
      return tn('Playing');
    case 'paused':
      return tn('Paused');
    case 'ended':
      return tn('Game over');
    case 'stuck':
      return tn('Stopped: no legal move');
  }
}

export function WatchControls() {
  const controller = useSession((s) => s.controller);
  const watch = useSession((s) => s.snap?.watch ?? null);
  if (!watch || !(controller instanceof WatchController)) return null;
  const running = watch.status === 'playing' || watch.status === 'paused';

  return (
    <div className="watch-controls" role="group" aria-label={t('Watch controls')}>
      <span className="chip">{statusLabel(watch.status)}</span>
      <Button size="sm" variant="secondary" disabled={!running} onClick={() => controller.togglePause()}>
        {watch.status === 'paused' ? tn('Play') : tn('Pause')}
      </Button>
      <Button size="sm" variant="ghost" disabled={watch.status !== 'paused'} onClick={() => controller.step()}>
        {tn('Step')}
      </Button>
      <div className="seg" role="group" aria-label={t('Speed')}>
        {WATCH_SPEEDS.map((sp) => (
          <button key={sp.id} type="button" aria-pressed={watch.speed === sp.id} onClick={() => controller.setSpeed(sp.id)}>
            {sp.id === 'max' ? tn('Max') : sp.label}
          </button>
        ))}
      </div>
    </div>
  );
}
