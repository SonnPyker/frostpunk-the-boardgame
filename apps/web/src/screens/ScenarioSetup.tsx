// Solo set-up from the main menu, in two modes:
//  - "Kịch bản ngẫu nhiên" (random): one draw of scenario, printed Society card, Advisor and seed. "Ngẫu nhiên" draws again.
//  - "Tùy chỉnh" (custom): the same choices by hand, plus the starting numbers, each held to the engine's START_LIMITS.
// Both show the set-up summary before Begin. Begin starts a solo game, as New solo game does.
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { GameConfig, StartOverride } from '@frostpunk/engine';
import { checkConfig, randomSetupConfig, startLimits, startValuesOf, type StartLimits } from '../controller/engineApi';
import { Button, Icon, Panel } from '../components/ui';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { Backdrop } from './Backdrop';
import { ADVISORS, SCENARIO_KEYS, SOCIETY_NUMERALS, randomSeed, scenarioInfo, type ScenarioKey } from './NewGame';
import { t, tn } from '../i18n';

export type ScenarioSetupMode = 'random' | 'custom';

type Difficulty = 'normal' | 'hard' | 'survivalist';

interface Form {
  scenario: ScenarioKey;
  society: number;
  difficulty: Difficulty;
  extraPack: boolean;
  advisor: string;
  seed: number;
  name: string;
  /** null: the Society card's printed numbers */
  start: StartOverride | null;
}

const clampInt = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo);

/** The engine config for a form. Survivalist is the card flag, as in the engine (it needs the extra pack). */
function configOf(f: Form): GameConfig {
  const survivalist = f.difficulty === 'survivalist';
  return {
    scenario: f.scenario,
    society: f.society,
    difficulty: f.difficulty === 'hard' ? 'hard' : 'normal',
    ...(survivalist ? { survivalist: true } : {}),
    mode: 'solo',
    players: [{ name: f.name }],
    seed: f.seed,
    extraPack: f.extraPack,
    advisors: [f.advisor],
    ...(f.start ? { start: f.start } : {}),
  };
}

const sameStart = (a: StartOverride, b: StartOverride) => JSON.stringify(a) === JSON.stringify(b);

/** The config when the engine accepts it, else null. */
function checked(build: () => GameConfig): GameConfig | null {
  try {
    const config = build();
    checkConfig(config);
    return config;
  } catch {
    return null;
  }
}

/** The printed Society card's numbers for a card choice, used to reset the custom start when the card changes. */
function printedStart(society: number, difficulty: Difficulty): StartOverride {
  return startValuesOf({
    scenario: 'crater',
    society,
    difficulty: difficulty === 'hard' ? 'hard' : 'normal',
    ...(difficulty === 'survivalist' ? { survivalist: true } : {}),
    mode: 'solo',
    players: [{ name: '' }],
    seed: 0,
    extraPack: difficulty === 'survivalist',
  });
}

export function ScenarioSetup({ mode }: { mode: ScenarioSetupMode }) {
  const setScreen = useUi((s) => s.setScreen);
  const notify = useUi((s) => s.notify);
  const startSolo = useSession((s) => s.startSolo);
  const limits: StartLimits = startLimits();

  const [name, setName] = useState('');
  const [extraPack, setExtraPack] = useState(false);
  const playerName = name.trim() || 'Commander';

  // Random mode: one draw. The same draw seed always gives the same set-up.
  const [draw, setDraw] = useState(() => randomSeed());
  const randomConfig = useMemo(() => checked(() => randomSetupConfig(draw, playerName, extraPack)), [draw, playerName, extraPack]);

  // Custom mode: the player's own choices.
  const [scenario, setScenario] = useState<ScenarioKey>('crater');
  const [society, setSociety] = useState(1);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [advisor, setAdvisor] = useState<string>('ADV_GENERATOR');
  const [seedText, setSeedText] = useState(() => String(randomSeed()));
  const [start, setStart] = useState<StartOverride>(() => printedStart(1, 'normal'));

  const seedValid = /^\d{1,10}$/.test(seedText.trim());
  // Custom numbers are kept in the config only when they differ from the card as printed.
  const edited = !sameStart(start, printedStart(society, difficulty)) ? start : null;
  const customConfig = seedValid
    ? checked(() =>
        configOf({
          scenario,
          society,
          difficulty,
          extraPack,
          advisor,
          seed: Number(seedText.trim()),
          name: playerName,
          start: edited,
        }),
      )
    : null;

  const config = mode === 'random' ? randomConfig : customConfig;
  const invalid = mode === 'custom' && !seedValid ? t('The seed must be a whole number up to 10 digits.') : null;

  // Society card, difficulty and the extra pack change the printed numbers, so the custom start resets to the new card.
  const chooseCard = (n: number, d: Difficulty) => {
    setSociety(n);
    setDifficulty(d);
    setStart(printedStart(n, d));
  };
  const toggleExtraPack = (on: boolean) => {
    setExtraPack(on);
    if (!on && difficulty === 'survivalist') chooseCard(society, 'normal');
  };

  const setPop = (i: number, v: number) =>
    setStart((s) => {
      const pop = s.pop.map((x, k) => (k === i ? clampInt(v, 0, limits.citizens) : x)) as StartOverride['pop'];
      const sick = s.sick.map((x, k) => Math.min(x, pop[k], limits.sick)) as StartOverride['sick'];
      return { ...s, pop, sick };
    });
  const setSick = (i: number, v: number) =>
    setStart((s) => {
      const sick = s.sick.map((x, k) => (k === i ? clampInt(v, 0, Math.min(s.pop[k], limits.sick)) : x)) as StartOverride['sick'];
      return { ...s, sick };
    });
  const setHope = (drawn: number, active: number | null) =>
    setStart((s) => {
      const d = clampInt(drawn, 1, limits.hope);
      const a = clampInt(active ?? s.hope[1], 0, d);
      return { ...s, hope: [d, a] };
    });
  const setDiscontent = (drawn: number, active: number | null) =>
    setStart((s) => {
      const d = clampInt(drawn, 0, limits.discontent);
      const a = clampInt(active ?? s.discontent[1], 0, d);
      return { ...s, discontent: [d, a] };
    });
  const setSupply = (k: 'food' | 'wood' | 'coal' | 'cores', v: number) =>
    setStart((s) => ({ ...s, [k]: clampInt(v, 0, limits.supply) }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!config) {
      notify(invalid ?? t('This set-up cannot start a game. Check the starting numbers.'), 'error');
      return;
    }
    // on success the session attaches and App switches to the game view
    startSolo(config);
  };

  const shown = config;
  const shownStart = shown ? startValuesOf(shown) : null;
  const shownDifficulty = shown?.survivalist ? 'survivalist' : shown?.difficulty;
  const title = mode === 'random' ? 'Random scenario' : 'Custom game';

  return (
    <div className="setup">
      <Backdrop intensity={0.7} />
      <form className="setup__form" onSubmit={submit} noValidate>
        <header className="setup__head">
          <Button variant="ghost" icon="close" size="sm" onClick={() => setScreen('menu')} aria-label={t('Back to menu')}>
            {tn('Back')}
          </Button>
          <h1 className="setup__title">{tn(title)}</h1>
          <span className="setup__head-spacer" />
        </header>

        <div className="setup__body">
          <div className="setup__main">
            {mode === 'random' ? (
              <Panel title={tn('Random draw')} icon="cold" className="setup__panel">
                <div className="setup__stack">
                  <p className="muted setup__note">
                    {tn(
                      'Each draw picks one of the three playable scenarios and an Advisor, then draws every starting number at random within the limits of the game. The seed shuffles the map and the decks.',
                    )}
                  </p>
                  <div className="setup__draw">
                    <Button variant="secondary" icon="heat" onClick={() => setDraw(randomSeed())}>
                      {tn('Random')}
                    </Button>
                  </div>
                </div>
              </Panel>
            ) : (
              <>
                <section className="setup__scenarios" aria-label={t('Scenario')}>
                  <h2 className="setup__section">{tn('Scenario')}</h2>
                  <div className="setup__cards">
                    {SCENARIO_KEYS.map((key) => {
                      const sc = scenarioInfo(key);
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
                            <span className="scenario-card__name">{tn(sc.name)}</span>
                            <span className="scenario-card__meta">
                              {sc.storm ? <span className="muted">{tn('Storm card')} {sc.storm}</span> : null}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="setup__society" aria-label={t('Society')}>
                  <h2 className="setup__section">{tn('Society')}</h2>
                  <div className="society-grid" role="radiogroup" aria-label={t('Society card')}>
                    {SOCIETY_NUMERALS.map((numeral, i) => {
                      const n = i + 1;
                      return (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={society === n}
                          className={`society-chip${society === n ? ' society-chip--on' : ''}`}
                          onClick={() => chooseCard(n, difficulty)}
                        >
                          <span className="society-chip__num">{numeral}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </>
            )}

            {mode === 'custom' ? (
              <Panel title={tn('Starting values')} icon="worker" className="setup__panel">
                <div className="setup__stack">
                  <p className="muted setup__note">{tn('Starts from the Society card you chose.')}</p>
                  <p className="muted setup__note">
                    {tn(
                      `Limits: population 0–${limits.citizens} per type, sick up to ${limits.sick}, Automatons 0–${limits.automaton}, supplies 0–${limits.supply}, Hope 1–${limits.hope} tokens, Discontent 0–${limits.discontent} tokens, Corpse 0–${limits.corpse}.`,
                    )}
                  </p>
                  <table className="start-table">
                    <thead>
                      <tr>
                        <th scope="col">{tn('Citizens')}</th>
                        <th scope="col">{tn('Population')}</th>
                        <th scope="col">{tn('Sick')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(['worker', 'engineer', 'child'] as const).map((type, i) => (
                        <tr key={type}>
                          <th scope="row">{tn(type === 'worker' ? 'Workers' : type === 'engineer' ? 'Engineers' : 'Children')}</th>
                          <td>
                            <NumField bare label={t('Population')} value={start.pop[i]} min={0} max={limits.citizens} onChange={(v) => setPop(i, v)} />
                          </td>
                          <td>
                            <NumField
                              bare label={t('Sick')}
                              value={start.sick[i]}
                              min={0}
                              max={Math.min(start.pop[i], limits.sick)}
                              onChange={(v) => setSick(i, v)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="start-grid">
                    <NumField label={tn('Automatons')} value={start.automaton} min={0} max={limits.automaton} onChange={(v) => setStart((s) => ({ ...s, automaton: clampInt(v, 0, limits.automaton) }))} />
                    <NumField label={tn('Food')} value={start.food} min={0} max={limits.supply} onChange={(v) => setSupply('food', v)} />
                    <NumField label={tn('Wood')} value={start.wood} min={0} max={limits.supply} onChange={(v) => setSupply('wood', v)} />
                    <NumField label={tn('Coal')} value={start.coal} min={0} max={limits.supply} onChange={(v) => setSupply('coal', v)} />
                    <NumField label={tn('Cores')} value={start.cores} min={0} max={limits.supply} onChange={(v) => setSupply('cores', v)} />
                    <NumField label={tn('Corpse')} value={start.corpse} min={0} max={limits.corpse} onChange={(v) => setStart((s) => ({ ...s, corpse: clampInt(v, 0, limits.corpse) }))} />
                    <NumField label={tn('Hope tokens')} value={start.hope[0]} min={1} max={limits.hope} onChange={(v) => setHope(v, null)} />
                    <NumField label={tn('Active Hope')} value={start.hope[1]} min={0} max={start.hope[0]} onChange={(v) => setHope(start.hope[0], v)} />
                    <NumField label={tn('Discontent tokens')} value={start.discontent[0]} min={0} max={limits.discontent} onChange={(v) => setDiscontent(v, null)} />
                    <NumField label={tn('Active Discontent')} value={start.discontent[1]} min={0} max={start.discontent[0]} onChange={(v) => setDiscontent(start.discontent[0], v)} />
                  </div>
                </div>
              </Panel>
            ) : null}

          </div>

          <div className="setup__side">
            <Panel title={tn('Rules & table')} icon="gear" className="setup__panel">
              <div className="setup__stack">
                {mode === 'custom' ? (
                  <div className="field">
                    <span className="field__label" id="scenario-difficulty-label">
                      {tn('Difficulty')}
                    </span>
                    <div className="seg" role="group" aria-labelledby="scenario-difficulty-label">
                      {(extraPack ? (['normal', 'hard', 'survivalist'] as const) : (['normal', 'hard'] as const)).map((d) => (
                        <button key={d} type="button" aria-pressed={difficulty === d} onClick={() => chooseCard(society, d)}>
                          {tn(d)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <label className="check">
                  <input type="checkbox" checked={extraPack} onChange={(e) => toggleExtraPack(e.target.checked)} />
                  <span className="check__text">
                    {tn('Extra pack')} <span className="muted">{tn('(Survivalist societies, cards M033 to M040, D061 to D074)')}</span>
                  </span>
                </label>

                <fieldset className="fieldset">
                  <legend className="field__label">{tn('Advisor')}</legend>
                  <div className="advisor-grid">
                    {ADVISORS.map((a) => (
                      <label key={a.id} className="check advisor-check">
                        <input
                          type="radio"
                          name={`${mode}-advisor`}
                          checked={mode === 'random' ? shown?.advisors?.[0] === a.id : advisor === a.id}
                          disabled={mode === 'random'}
                          onChange={() => setAdvisor(a.id)}
                        />
                        <span className="check__text">
                          {tn(a.label)} {tn('Advisor')}
                        </span>
                      </label>
                    ))}
                  </div>
                  {mode === 'random' ? (
                    <p className="muted setup__note">{tn('The draw chooses the Advisor.')}</p>
                  ) : null}
                </fieldset>

                {mode === 'custom' ? (
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
                ) : null}

                <label className="field">
                  <span className="field__label">{tn('Your name')}</span>
                  <input className="input" value={name} maxLength={24} placeholder={t('Commander')} onChange={(e) => setName(e.target.value)} />
                </label>
              </div>
            </Panel>

            <Panel title={tn('Set-up summary')} icon="book" className="setup__panel">
              {shown && shownStart ? (
                <>
                  <dl className="society-facts setup__summary">
                    <div>
                      <dt>{tn('Scenario')}</dt>
                      <dd>{tn(scenarioInfo(shown.scenario as ScenarioKey).name)}</dd>
                    </div>
                    <div>
                      <dt>{tn('Society')}</dt>
                      <dd>
                        {mode === 'random' ? (
                          tn('Random')
                        ) : (
                          <>
                            {SOCIETY_NUMERALS[shown.society - 1]} · {tn(shownDifficulty ?? 'normal')}
                          </>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{tn('Advisor')}</dt>
                      <dd>{tn(ADVISORS.find((a) => a.id === shown.advisors?.[0])?.label ?? 'Generator')}</dd>
                    </div>
                    <div>
                      <dt>{tn('Seed')}</dt>
                      <dd>{shown.seed}</dd>
                    </div>
                    <div>
                      <dt>{tn('Workers')}</dt>
                      <dd>
                        {shownStart.pop[0]} · {shownStart.sick[0]} {tn('sick')}
                      </dd>
                    </div>
                    <div>
                      <dt>{tn('Engineers')}</dt>
                      <dd>
                        {shownStart.pop[1]} · {shownStart.sick[1]} {tn('sick')}
                      </dd>
                    </div>
                    <div>
                      <dt>{tn('Children')}</dt>
                      <dd>
                        {shownStart.pop[2]} · {shownStart.sick[2]} {tn('sick')}
                      </dd>
                    </div>
                    <div>
                      <dt>{tn('Automatons')}</dt>
                      <dd>{shownStart.automaton}</dd>
                    </div>
                    <div>
                      <dt>{tn('Food')}</dt>
                      <dd>{shownStart.food}</dd>
                    </div>
                    <div>
                      <dt>{tn('Wood')}</dt>
                      <dd>{shownStart.wood}</dd>
                    </div>
                    <div>
                      <dt>{tn('Coal')}</dt>
                      <dd>{shownStart.coal}</dd>
                    </div>
                    <div>
                      <dt>{tn('Cores')}</dt>
                      <dd>{shownStart.cores}</dd>
                    </div>
                    <div>
                      <dt>{tn('Hope')}</dt>
                      <dd>{tn(`${shownStart.hope[0]} drawn, ${shownStart.hope[1]} active`)}</dd>
                    </div>
                    <div>
                      <dt>{tn('Discontent')}</dt>
                      <dd>{tn(`${shownStart.discontent[0]} drawn, ${shownStart.discontent[1]} active`)}</dd>
                    </div>
                    <div>
                      <dt>{tn('Corpse')}</dt>
                      <dd>{shownStart.corpse}</dd>
                    </div>
                  </dl>
                  {mode === 'random' ? (
                    <p className="muted setup__note">{tn('Numbers drawn at random within the limits of the game.')}</p>
                  ) : shown.start ? (
                    <p className="muted setup__note">{tn('Custom starting values: not the numbers printed on the card.')}</p>
                  ) : null}
                </>
              ) : (
                <p className="setup__warn" role="alert">
                  <Icon name="warning" size={13} /> {tn('This set-up cannot start a game. Check the starting numbers.')}
                </p>
              )}
            </Panel>
          </div>
        </div>

        <footer className="setup__foot">
          <span className="setup__foot-spacer" />
          <Button variant="ghost" onClick={() => setScreen('menu')}>
            {tn('Cancel')}
          </Button>
          <Button type="submit" variant="primary" size="lg" icon="heat" disabledReason={config ? undefined : (invalid ?? t('Check the starting numbers.'))}>
            {tn('Begin')}
          </Button>
        </footer>
      </form>
    </div>
  );
}

/**
 * A whole-number field. The parent clamps the value, so the typed number is always within the limits.
 * `bare` drops the visible label (inside the table, whose headers already name the column) and keeps it as aria-label.
 */
function NumField({
  label,
  bare = false,
  value,
  min,
  max,
  onChange,
}: {
  label: ReactNode;
  bare?: boolean;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const input = (
    <input
      className="input start-field__input"
      type="number"
      inputMode="numeric"
      step={1}
      min={min}
      max={max}
      value={value}
      aria-label={bare && typeof label === 'string' ? label : undefined}
      onChange={(e) => onChange(e.target.value === '' ? min : Number(e.target.value))}
    />
  );
  if (bare) return input;
  return (
    <label className="start-field">
      <span className="field__label start-field__label">{label}</span>
      {input}
    </label>
  );
}
