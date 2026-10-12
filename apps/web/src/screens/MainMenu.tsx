// Main menu: title, Continue / New solo / Co-op host / Join / Rules / Settings / Credits.
import { useState } from 'react';
import { Button, Icon } from '../components/ui';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { Backdrop } from './Backdrop';
import { t, tn } from '../i18n';

export function MainMenu() {
  const setScreen = useUi((s) => s.setScreen);
  const openOverlay = useUi((s) => s.openOverlay);
  const notify = useUi((s) => s.notify);
  const continueSolo = useSession((s) => s.continueSolo);
  const resumeCoop = useSession((s) => s.resumeCoop);
  const [saved, setSaved] = useState(() => useSession.getState().hasSaved());
  const canContinue = saved.solo || saved.coop;
  // Only the localStorage fallback holds the co-op seat (this tab was closed or is fresh): offer the rejoin by code.
  const rejoinOnly = saved.coop && saved.coopFallback && !saved.solo;

  const onRejoin = () => {
    if (!resumeCoop()) notify(t('The co-op seat could not be resumed. Join again with the room code.'), 'error');
  };

  const onContinue = () => {
    if (saved.solo) {
      // continueSolo() tells the player why a save could not be restored (and removes a stale one)
      if (!continueSolo()) setSaved(useSession.getState().hasSaved());
      return;
    }
    onRejoin();
  };

  return (
    <div className="menu">
      <Backdrop />
      <div className="menu__content">
        <div className="menu__title-block">
          <p className="menu__kicker label-caps">{tn('A New Home')}</p>
          <h1 className="menu__title">{tn('Frostpunk')}</h1>
          <p className="menu__subtitle">{tn('The Board Game · Web Edition')}</p>
        </div>

        <nav className="menu__nav" aria-label={t('Main menu')}>
          <Button
            variant="primary"
            size="lg"
            icon="heat"
            block
            disabledReason={canContinue ? undefined : t('No saved game in this browser yet')}
            onClick={rejoinOnly ? onRejoin : onContinue}
          >
            {rejoinOnly && saved.coopCode ? <>{tn('Rejoin room')} {saved.coopCode}</> : tn('Continue')}
          </Button>
          {saved.solo && saved.coop && saved.coopFallback && saved.coopCode ? (
            <Button variant="secondary" size="lg" block onClick={onRejoin}>
              {tn('Rejoin room')} {saved.coopCode}
            </Button>
          ) : null}
          <Button variant="secondary" size="lg" block onClick={() => setScreen('newSolo')}>
            {tn('New solo game')}
          </Button>
          <div className="menu__group" role="group" aria-label={t('Solo scenarios')}>
            <span className="label-caps menu__group-label">{tn('Solo · scenario set-up')}</span>
            <div className="menu__group-row">
              <Button variant="secondary" block onClick={() => setScreen('scenarioRandom')}>
                {tn('Random scenario')}
              </Button>
              <Button variant="secondary" block onClick={() => setScreen('scenarioCustom')}>
                {tn('Custom game')}
              </Button>
            </div>
          </div>
          <div className="menu__group" role="group" aria-label={t('Co-op')}>
            <span className="label-caps menu__group-label">{tn('Co-op · 2 to 4 seats')}</span>
            <div className="menu__group-row">
              <Button variant="secondary" block onClick={() => setScreen('coopHost')}>
                {tn('Host a room')}
              </Button>
              <Button variant="secondary" block onClick={() => setScreen('coopJoin')}>
                {tn('Join by code')}
              </Button>
            </div>
          </div>
          <div className="menu__group-row menu__utility">
            <Button variant="ghost" icon="book" onClick={() => openOverlay('rules')}>
              {tn('Rules')}
            </Button>
            <Button variant="ghost" icon="gear" onClick={() => openOverlay('settings')}>
              {tn('Settings')}
            </Button>
            <Button variant="ghost" onClick={() => openOverlay('credits')}>
              {tn('Credits')}
            </Button>
          </div>
        </nav>

        <p className="menu__legal">
          <Icon name="warning" size={13} /> {tn('Unofficial fan project. Frostpunk and its artwork, sounds and models belong to their rights holders.')}
        </p>
      </div>
    </div>
  );
}
