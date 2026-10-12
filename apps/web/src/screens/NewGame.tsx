// New game set-up: solo, host a co-op room, or join one by code.
// Scenario cards, society I-VI, difficulty, extra pack, seed, advisors (and seats / names for co-op).
import { useMemo, useState, type FormEvent } from 'react';
import { scenarios, societies } from '@frostpunk/engine';
import type { GameConfig } from '@frostpunk/engine';
import { engineReady } from '../controller/engineApi';
import type { LobbySettings } from '../controller/remoteTypes';
import { Button, Icon, Panel, Tooltip } from '../components/ui';
import { SERVER_URL, useSession } from '../store/session';
import { useUi } from '../store/ui';
import { Backdrop } from './Backdrop';
import { t, tn } from '../i18n';

export type NewGameMode = 'solo' | 'host' | 'join';

export const SCENARIO_KEYS = ['crater', 'frozenGrove', 'dreadnought'] as const;
export type ScenarioKey = (typeof SCENARIO_KEYS)[number];

export const SOCIETY_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI'];

export const ADVISORS: { id: string; label: string; hint: string }[] = [
  { id: 'ADV_GENERATOR', label: 'Generator', hint: 'Keeps the Generator running' },
  { id: 'ADV_HEALTH', label: 'Health', hint: 'Medical care and sickness' },
  { id: 'ADV_SOCIAL', label: 'Social', hint: 'Dusk cards and public mood' },
  { id: 'ADV_FOREMAN', label: 'Foreman', hint: 'Workers and construction' },
];

export function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

export function scenarioInfo(key: ScenarioKey): { name: string; stars: number; storm: string } {
  const s = (scenarios as Record<string, { name?: string; difficulty?: number; stormCard?: string }>)[key];
  return {
    name: s?.name ?? key,
    stars: typeof s?.difficulty === 'number' ? s.difficulty : 1,
    storm: s?.stormCard ?? '',
  };
}

interface SocietyCard {
  pop: [number, number, number];
  food: number;
  wood: number;
  coal: number;
  cores: number;
  hope: [number, number];
  discontent: [number, number];
}

function societyCard(n: number, difficulty: 'normal' | 'hard', survivalist: boolean): SocietyCard | null {
  const list = societies as Array<Record<string, unknown>>;
  const row = list.find((c) => c.society === n && c.difficulty === (survivalist ? 'survivalist' : difficulty));
  const row2 = row ?? list.find((c) => c.society === n && c.difficulty === 'normal');
  if (!row2) return null;
  return {
    pop: (row2.pop as [number, number, number]) ?? [0, 0, 0],
    food: Number(row2.food ?? 0),
    wood: Number(row2.wood ?? 0),
    coal: Number(row2.coal ?? 0),
    cores: Number(row2.cores ?? 0),
    hope: (row2.hope as [number, number]) ?? [0, 0],
    discontent: (row2.discontent as [number, number]) ?? [0, 0],
  };
}

export function NewGame({ mode }: { mode: NewGameMode }) {
  const setScreen = useUi((s) => s.setScreen);
  const notify = useUi((s) => s.notify);
  const startSolo = useSession((s) => s.startSolo);
  const openCoop = useSession((s) => s.openCoop);

  const [scenario, setScenario] = useState<ScenarioKey>('crater');
  const [society, setSociety] = useState(1);
  const [difficulty, setDifficulty] = useState<'normal' | 'hard'>('normal');
  const [extraPack, setExtraPack] = useState(false);
  const [seedText, setSeedText] = useState(() => String(randomSeed()));
  // Solo: one Advisor (rulebook p14; the solo Call to Rise card is separate). Co-op: the Advisors at the table (checkboxes).
  const [soloAdvisor, setSoloAdvisor] = useState<string>('ADV_GENERATOR');
  const [adv, setAdv] = useState<Record<string, boolean>>({
    ADV_GENERATOR: true,
    ADV_HEALTH: true,
    ADV_SOCIAL: true,
    ADV_FOREMAN: true,
  });
  const [seats, setSeats] = useState<2 | 3 | 4>(2);
  const [name, setName] = useState('');
  const [joinSuffix] = useState(() => String(10 + Math.floor(Math.random() * 90)));
  const [roomName, setRoomName] = useState('New Home');
  const [code, setCode] = useState('');

  const seed = useMemo(() => {
    const n = Number(seedText);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) % 4294967296 : 0;
  }, [seedText]);
  const seedValid = /^\d{1,10}$/.test(seedText.trim());
  const advisorIds = ADVISORS.filter((a) => adv[a.id]).map((a) => a.id);
  // The engine needs one Advisor per player at the table, or none (validateConfig: "the table needs at least N Advisors").
  // A co-op room fills up to `seats`, so a partial Advisor table is refused here instead of failing at the server.
  const advisorShortfall =
    mode === 'host' && advisorIds.length > 0 && advisorIds.length < seats
      ? `Choose at least ${seats} Advisors for ${seats} seats, or none (${advisorIds.length} chosen).`
      : null;
  const preview = societyCard(society, difficulty, extraPack);
  const engineOk = engineReady();

  const back = () => setScreen('menu');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!seedValid) {
      notify(t('The seed must be a whole number up to 10 digits.'), 'error');
      return;
    }
    // A joiner who types no name gets a unique default, so two seats never read the same at the table.
    const playerName = name.trim() || (mode === 'solo' ? 'Commander' : mode === 'host' ? 'Leader' : `Settler ${joinSuffix}`);
    if (mode === 'solo') {
      const config: GameConfig = {
        scenario,
        society,
        difficulty,
        mode: 'solo',
        players: [{ name: playerName }],
        seed,
        extraPack,
        advisors: [soloAdvisor],
      };
      // on success the session attaches and App switches to the game view
      startSolo(config);
      return;
    }
    if (mode === 'host') {
      if (advisorShortfall) {
        notify(t(advisorShortfall), 'error');
        return;
      }
      const settings: Partial<LobbySettings> = {
        roomName: roomName.trim().slice(0, 40) || 'New Home',
        seats,
        scenario,
        society,
        difficulty,
        extraPack,
        advisors: advisorIds,
        seed,
      };
      openCoop().create(playerName, settings);
      return;
    }
    const cleanCode = code.trim().toUpperCase();
    if (!/^[A-Z]{6}$/.test(cleanCode)) {
      notify(t('Room codes have six letters.'), 'error');
      return;
    }
    openCoop().join(cleanCode, playerName);
  };

  const title = mode === 'solo' ? 'New solo game' : mode === 'host' ? 'Host a co-op room' : 'Join a co-op room';

  return (
    <div className="setup">
      <Backdrop intensity={0.7} />
      <form className="setup__form" onSubmit={submit} noValidate>
        <header className="setup__head">
          <Button variant="ghost" icon="close" size="sm" onClick={back} aria-label={t('Back to menu')}>
            {tn('Back')}
          </Button>
          <h1 className="setup__title">{tn(title)}</h1>
          <span className="setup__head-spacer" />
        </header>

        {/* display: contents on tall screens (the grid is unchanged); a scrolling body on short ones, see screens.css */}
        <div className="setup__body">
        {mode === 'join' ? (
          <Panel title={tn('Room')} icon="worker" className="setup__join">
            <div className="setup__stack">
              <label className="field">
                <span className="field__label">{tn('Room code')}</span>
                <input
                  className="input input--code"
                  value={code}
                  maxLength={6}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABCDEF"
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                />
              </label>
              <label className="field">
                <span className="field__label">{tn('Your name at the table')}</span>
                <input className="input" value={name} maxLength={24} placeholder={t('Settler')} onChange={(e) => setName(e.target.value)} />
              </label>
              <p className="muted setup__note">{tn('The host shares the six-letter code. You take the first free seat.')}</p>
            </div>
          </Panel>
        ) : (
          <>
            <section className="setup__scenarios" aria-label={t('Scenario')}>
              <h2 className="setup__section">{tn('Scenario')}</h2>
              <div className="setup__cards">
                {SCENARIO_KEYS.map((key) => {
                  const info = scenarioInfo(key);
                  const on = scenario === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`scenario-card${on ? ' scenario-card--on' : ''}`}
                      aria-pressed={on}
                      onClick={() => setScenario(key)}
                    >
                      <span className="scenario-card__art" aria-hidden="true">
                        <Icon name="cold" size={34} />
                      </span>
                      <span className="scenario-card__body">
                        <span className="scenario-card__name">{tn(info.name)}</span>
                        <span className="scenario-card__meta">
                          <span className="stars" aria-label={t(`Difficulty ${info.stars} of 3`)}>
                            {[0, 1, 2].map((i) => (
                              <span key={i} className={i < info.stars ? 'star star--on' : 'star'} />
                            ))}
                          </span>
                          {info.storm ? <span className="muted">{tn('Storm card')} {info.storm}</span> : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="setup__note muted">
                {tn('Other scenarios are not covered by the supplied scenario book, so they are not offered here.')}
              </p>
            </section>

            <section className="setup__society" aria-label={t('Society')}>
              <h2 className="setup__section">{tn('Society')}</h2>
              <div className="society-grid" role="radiogroup" aria-label={t('Society card')}>
                {SOCIETY_NUMERALS.map((numeral, i) => {
                  const n = i + 1;
                  const on = society === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`society-chip${on ? ' society-chip--on' : ''}`}
                      onClick={() => setSociety(n)}
                    >
                      <span className="society-chip__num">{numeral}</span>
                      <span className="society-chip__pop">
                        {societyCard(n, difficulty, extraPack)?.pop.map((p, k) => (
                          <span key={k} className="society-chip__count">
                            <Icon name={k === 0 ? 'worker' : k === 1 ? 'engineer' : 'child'} size={13} />
                            {p}
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              {preview ? (
                <dl className="society-facts">
                  <div>
                    <dt>{tn('Food')}</dt>
                    <dd>{preview.food}</dd>
                  </div>
                  <div>
                    <dt>{tn('Wood')}</dt>
                    <dd>{preview.wood}</dd>
                  </div>
                  <div>
                    <dt>{tn('Coal')}</dt>
                    <dd>{preview.coal}</dd>
                  </div>
                  <div>
                    <dt>{tn('Cores')}</dt>
                    <dd>{preview.cores}</dd>
                  </div>
                  <div>
                    <dt>{tn('Hope')}</dt>
                    <dd>{tn(`${preview.hope[0]} tokens, ${preview.hope[1]} active`)}</dd>
                  </div>
                  <div>
                    <dt>{tn('Discontent')}</dt>
                    <dd>{tn(`${preview.discontent[0]} tokens, ${preview.discontent[1]} active`)}</dd>
                  </div>
                </dl>
              ) : null}
            </section>

            <Panel title={tn('Rules & table')} icon="gear" className="setup__options">
              <div className="setup__stack">
                <div className="field">
                  <span className="field__label" id="difficulty-label">
                    {tn('Difficulty')}
                  </span>
                  <div className="seg" role="group" aria-labelledby="difficulty-label">
                    {(['normal', 'hard'] as const).map((d) => (
                      <button key={d} type="button" aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
                        {tn(d)}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="check">
                  <input type="checkbox" checked={extraPack} onChange={(e) => setExtraPack(e.target.checked)} />
                  <span className="check__text">
                    {tn('Extra pack')} <span className="muted">{tn('(Survivalist societies, cards M033 to M040, D061 to D074)')}</span>
                  </span>
                </label>

                {mode === 'solo' ? (
                  <fieldset className="fieldset">
                    <legend className="field__label">{tn('Advisor')}</legend>
                    <div className="advisor-grid">
                      {ADVISORS.map((a) => (
                        <Tooltip key={a.id} text={tn(a.hint)} placement="bottom">
                          <label className="check advisor-check">
                            <input
                              type="radio"
                              name="solo-advisor"
                              checked={soloAdvisor === a.id}
                              onChange={() => setSoloAdvisor(a.id)}
                            />
                            <span className="check__text">{tn(a.label)} {tn('Advisor')}</span>
                          </label>
                        </Tooltip>
                      ))}
                    </div>
                    <p className="muted setup__note">
                      {tn('Choose one Advisor (the solo game also takes the Call to Rise card). Advisors are optional: one may be used per round in the Preparation phase.')}
                    </p>
                  </fieldset>
                ) : (
                  <fieldset className="fieldset">
                    <legend className="field__label">{tn('Advisors at the table')}</legend>
                    <div className="advisor-grid">
                      {ADVISORS.map((a) => (
                        <label key={a.id} className="check advisor-check">
                          <input
                            type="checkbox"
                            checked={adv[a.id]}
                            onChange={(e) => setAdv((prev) => ({ ...prev, [a.id]: e.target.checked }))}
                          />
                          <span className="check__text">{tn(a.label)}</span>
                        </label>
                      ))}
                    </div>
                    {advisorShortfall ? (
                      <p className="setup__warn" role="alert">
                        <Icon name="warning" size={13} /> {tn(advisorShortfall)}
                      </p>
                    ) : null}
                  </fieldset>
                )}

                <label className="field">
                  <span className="field__label">{tn('Seed')}</span>
                  <span className="seed-row">
                    <input
                      className="input"
                      inputMode="numeric"
                      value={seedText}
                      onChange={(e) => setSeedText(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      aria-invalid={!seedValid}
                    />
                    <Button size="sm" variant="secondary" onClick={() => setSeedText(String(randomSeed()))} title={t('Random seed')}>
                      {tn('Shuffle')}
                    </Button>
                  </span>
                  <span className="muted setup__note">{tn('The same seed and options give the same deck order and map.')}</span>
                </label>

                <label className="field">
                  <span className="field__label">{mode === 'solo' ? tn('Your name') : tn('Your name at the table')}</span>
                  <input className="input" value={name} maxLength={24} placeholder={t('Commander')} onChange={(e) => setName(e.target.value)} />
                </label>

                {mode === 'host' ? (
                  <>
                    <label className="field">
                      <span className="field__label">{tn('Room name')}</span>
                      <input className="input" value={roomName} maxLength={40} onChange={(e) => setRoomName(e.target.value)} />
                    </label>
                    <div className="field">
                      <span className="field__label" id="seats-label">
                        {tn('Seats')}
                      </span>
                      <div className="seg" role="group" aria-labelledby="seats-label">
                        {([2, 3, 4] as const).map((n) => (
                          <button key={n} type="button" aria-pressed={seats === n} onClick={() => setSeats(n)}>
                            {tn(`${n} players`)}
                          </button>
                        ))}
                      </div>
                      <span className="muted setup__note">{tn('Seats can be changed in the lobby before the game starts.')}</span>
                    </div>
                  </>
                ) : null}
              </div>
            </Panel>
          </>
        )}
        </div>

        <footer className="setup__foot">
          {mode === 'solo' && !engineOk ? (
            <span className="chip chip--warn" title={t('The engine exports are not complete in this build yet')}>
              <Icon name="warning" size={13} /> {tn('Rules engine pending')}
            </span>
          ) : null}
          {mode !== 'solo' ? <span className="muted setup__note">{tn('Game server:')} {SERVER_URL}</span> : null}
          <span className="setup__foot-spacer" />
          <Button variant="ghost" onClick={back}>
            {tn('Cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            icon={mode === 'join' ? 'worker' : 'heat'}
            disabledReason={advisorShortfall ? t(advisorShortfall) : undefined}
          >
            {mode === 'solo' ? tn('Begin') : mode === 'host' ? tn('Open the room') : tn('Join room')}
          </Button>
        </footer>
      </form>
    </div>
  );
}
