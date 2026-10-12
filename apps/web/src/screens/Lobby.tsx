// Co-op lobby: room code, seats and readiness, host settings, chat. The game view takes over once the
// server sends the first state after Start.
import { useState, type FormEvent } from 'react';
import type { RemoteController } from '../controller/RemoteController';
import type { LobbySettings } from '../controller/remoteTypes';
import { Button, Icon, Panel, cx } from '../components/ui';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { Backdrop } from './Backdrop';
import { t, tn } from '../i18n';

const ADVISOR_IDS: { id: string; label: string }[] = [
  { id: 'ADV_GENERATOR', label: 'Generator' },
  { id: 'ADV_HEALTH', label: 'Health' },
  { id: 'ADV_SOCIAL', label: 'Social' },
  { id: 'ADV_FOREMAN', label: 'Foreman' },
];

const CONNECTION_TEXT: Record<string, string> = {
  idle: 'Not connected',
  connecting: 'Connecting',
  open: 'Connected',
  reconnecting: 'Reconnecting',
  closed: 'Disconnected',
  local: 'Local',
};

export function Lobby() {
  const snap = useSession((s) => s.snap);
  const controller = useSession((s) => s.controller);
  const leaveRoom = useSession((s) => s.leaveRoom);
  const notify = useUi((s) => s.notify);
  const setScreen = useUi((s) => s.setScreen);
  const [chatText, setChatText] = useState('');

  const leave = () => {
    leaveRoom();
    setScreen('menu');
  };

  const room = snap?.room ?? null;
  const seat = snap?.seat ?? -1;
  const rc = controller as RemoteController | null;
  const me = room?.players.find((p) => p.seat === seat) ?? null;
  const isHost = Boolean(me?.host);
  const settings = room?.settings;
  const allReady = Boolean(room && room.players.length > 0 && room.players.every((p) => p.ready));
  const connection = snap?.connection ?? 'idle';
  // The game starts with the seated players, so the Advisors must cover them (engine validateConfig). Advisors chosen
  // for the full seat count are a warning, not a block, while seats are still open.
  const advisorCount = settings?.advisors.length ?? 0;
  const tableSize = room?.players.length ?? 0;
  const advisorShortfall =
    advisorCount > 0 && tableSize > 0 && advisorCount < tableSize
      ? `${tableSize} players are seated and only ${advisorCount} Advisor${advisorCount === 1 ? ' is' : 's are'} chosen. Choose at least ${tableSize}, or none.`
      : null;
  const seatsOpen = settings ? settings.seats > tableSize : false;
  const advisorSeatHint =
    !advisorShortfall && settings && advisorCount > 0 && advisorCount < settings.seats && seatsOpen
      ? `All ${settings.seats} seats need at least ${settings.seats} Advisors, or none.`
      : null;
  const startBlock = advisorShortfall
    ? t(advisorShortfall)
    : !allReady
      ? t('Every seat must be ready before the game starts')
      : undefined;

  const update = (patch: Partial<LobbySettings>) => {
    if (!rc || !isHost) return;
    rc.updateSettings(patch);
  };

  const copyCode = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      notify(t('Room code copied.'), 'ok');
    } catch {
      notify(`${t('Room code:')} ${room.code}`);
    }
  };

  const sendChat = (e: FormEvent) => {
    e.preventDefault();
    if (!rc || !chatText.trim()) return;
    rc.chat(chatText);
    setChatText('');
  };

  if (!room || !settings) {
    return (
      <div className="lobby lobby--wait">
        <Backdrop intensity={0.6} />
        <Panel className="lobby__wait" title={tn('Co-op room')} icon="worker">
          <p className="lobby__wait-text">
            {connection === 'reconnecting' ? tn('Reconnecting to the room…') : tn('Connecting to the game server…')}
          </p>
          {snap?.error ? <p className="lobby__error">{tn(snap.error)}</p> : null}
          <div className="lobby__wait-actions">
            <span className="chip">{tn(CONNECTION_TEXT[connection] ?? connection)}</span>
            <Button variant="ghost" onClick={leave}>
              {tn('Back to menu')}
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  const seatRows = Array.from({ length: settings.seats }, (_, i) => room.players.find((p) => p.seat === i) ?? null);

  return (
    <div className="lobby">
      <Backdrop intensity={0.7} />
      <div className="lobby__grid">
        <header className="lobby__head">
          <div>
            <p className="label-caps">{tn('Room')}</p>
            <h1 className="lobby__title">{settings.roomName}</h1>
          </div>
          <button type="button" className="room-code" onClick={copyCode} title={t('Copy the room code')}>
            <span className="label-caps">{tn('Code')}</span>
            <span className="room-code__value">{room.code}</span>
            <Icon name="book" size={14} />
          </button>
          <span className={cx('chip', connection === 'open' ? 'chip--ok' : 'chip--warn')}>
            {tn(CONNECTION_TEXT[connection] ?? connection)}
          </span>
        </header>

        <Panel title={tn('Seats')} icon="worker" className="lobby__seats" kicker={`${room.players.length} / ${settings.seats}`}>
          <ul className="seat-list">
            {seatRows.map((p, i) => (
              <li key={i} className={cx('seat', p && 'seat--taken', p?.seat === seat && 'seat--me')}>
                <span className="seat__num num">{i + 1}</span>
                {p ? (
                  <>
                    <span className="seat__name">
                      {p.name}
                      {p.host ? <span className="chip chip--on seat__host">{tn('Host')}</span> : null}
                      {p.seat === seat ? <span className="chip seat__you">{tn('You')}</span> : null}
                    </span>
                    <span className={cx('seat__state', p.ready ? 'seat__state--ready' : undefined)}>
                      {!p.connected ? tn('Away') : p.ready ? tn('Ready') : tn('Not ready')}
                    </span>
                  </>
                ) : (
                  <span className="seat__name muted">{tn('Open seat')}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="lobby__ready">
            {room.status === 'lobby' ? (
              <Button
                variant={me?.ready ? 'secondary' : 'primary'}
                block
                icon="check"
                disabledReason={me ? undefined : t('Waiting to be seated')}
                onClick={() => rc?.setReady(!me?.ready)}
              >
                {me?.ready ? tn('Not ready') : tn('I am ready')}
              </Button>
            ) : null}
          </div>
          {isHost && room.status === 'lobby' ? (
            <div className="lobby__start">
              <Button
                variant="primary"
                size="lg"
                block
                icon="heat"
                disabledReason={startBlock}
                onClick={() => rc?.start()}
              >
                {tn('Start the game')}
              </Button>
              {advisorShortfall ? (
                <p className="setup__warn" role="alert">
                  <Icon name="warning" size={13} /> {tn(advisorShortfall)}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="lobby__leave">
            <Button variant="ghost" size="sm" onClick={leave}>
              {tn('Leave the room')}
            </Button>
          </div>
        </Panel>

        <Panel title={tn('Settings')} icon="gear" className="lobby__settings" kicker={isHost ? tn('Host') : tn('Read only')}>
          <div className="setup__stack">
            <label className="field">
              <span className="field__label">{tn('Room name')}</span>
              <input
                className="input"
                defaultValue={settings.roomName}
                maxLength={40}
                disabled={!isHost}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== settings.roomName) update({ roomName: v.slice(0, 40) });
                }}
              />
            </label>

            <div className="field">
              <span className="field__label" id="lobby-scenario">
                {tn('Scenario')}
              </span>
              <div className="seg" role="group" aria-labelledby="lobby-scenario">
                {(['crater', 'frozenGrove', 'dreadnought'] as const).map((k) => (
                  <button key={k} type="button" aria-pressed={settings.scenario === k} disabled={!isHost} onClick={() => update({ scenario: k })}>
                    {k === 'crater' ? tn('Crater') : k === 'frozenGrove' ? tn('Frozen Grove') : tn('Dreadnought')}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="field__label" id="lobby-society">
                {tn('Society')}
              </span>
              <div className="seg" role="group" aria-labelledby="lobby-society">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button key={n} type="button" aria-pressed={settings.society === n} disabled={!isHost} onClick={() => update({ society: n })}>
                    {['I', 'II', 'III', 'IV', 'V', 'VI'][n - 1]}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="field__label" id="lobby-diff">
                {tn('Difficulty')}
              </span>
              <div className="seg" role="group" aria-labelledby="lobby-diff">
                {(['normal', 'hard'] as const).map((d) => (
                  <button key={d} type="button" aria-pressed={settings.difficulty === d} disabled={!isHost} onClick={() => update({ difficulty: d })}>
                    {tn(d)}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="field__label" id="lobby-seats">
                {tn('Seats')}
              </span>
              <div className="seg" role="group" aria-labelledby="lobby-seats">
                {([2, 3, 4] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={settings.seats === n}
                    disabled={!isHost || n < room.players.length}
                    onClick={() => update({ seats: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={settings.extraPack}
                disabled={!isHost}
                onChange={(e) => update({ extraPack: e.target.checked })}
              />
              <span className="check__text">{tn('Extra pack (Survivalist societies and extra cards)')}</span>
            </label>

            <fieldset className="fieldset">
              <legend className="field__label">{tn('Advisors')}</legend>
              <div className="advisor-grid">
                {ADVISOR_IDS.map((a) => {
                  const on = settings.advisors.includes(a.id);
                  return (
                    <label key={a.id} className="check advisor-check">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!isHost}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...settings.advisors, a.id]
                            : settings.advisors.filter((x) => x !== a.id);
                          update({ advisors: next.slice(0, 4) });
                        }}
                      />
                      <span className="check__text">{tn(a.label)}</span>
                    </label>
                  );
                })}
              </div>
              {advisorSeatHint ? (
                <p className="setup__warn setup__warn--soft">
                  <Icon name="warning" size={13} /> {tn(advisorSeatHint)}
                </p>
              ) : null}
            </fieldset>

            <p className="muted setup__note">{tn(`Seed ${settings.seed}. The same settings and seed give the same game.`)}</p>
          </div>
        </Panel>

        <Panel title={tn('Chat')} icon="sound" className="lobby__chat" scroll>
          <ol className="chat-list" aria-live="polite">
            {snap?.chat.length ? (
              snap.chat.map((line, i) => (
                <li key={`${line.ts}-${i}`} className="chat-line">
                  <span className="chat-line__name">{line.name}</span>
                  <span className="chat-line__text">{line.text}</span>
                </li>
              ))
            ) : (
              <li className="muted">{tn('No messages yet.')}</li>
            )}
          </ol>
          <form className="chat-form" onSubmit={sendChat}>
            <input
              className="input"
              value={chatText}
              maxLength={300}
              placeholder={t('Say something to the table')}
              onChange={(e) => setChatText(e.target.value)}
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!chatText.trim()}>
              {tn('Send')}
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
