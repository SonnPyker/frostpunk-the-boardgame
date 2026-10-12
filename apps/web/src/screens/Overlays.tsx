// Modal overlays driven by ui.overlay: Settings, Rules (rulebook PDF + checklist progress), Credits and the
// in-game menu. OverlayHost mounts all of them; only the one named by ui.overlay is open.
import { useEffect, useState, type CSSProperties } from 'react';
import { Button, Icon, Modal, cx, rulebookPdfUrl } from '../components/ui';
import { useSession } from '../store/session';
import { useSettings, type Quality } from '../store/settings';
import { useUi } from '../store/ui';
import { glossaryEntries, t, tn, useLang } from '../i18n';

// ---- Settings ---------------------------------------------------------------

const QUALITY: { id: Quality; label: string; note: string }[] = [
  { id: 'low', label: 'Low', note: 'Fewer shadows and particles' },
  { id: 'medium', label: 'Medium', note: 'Default for most machines' },
  { id: 'high', label: 'High', note: 'Full detail and fog' },
];

/**
 * Inline style for a `.range` input: sets --fill so the orange part of the track ends at the thumb centre.
 * The thumb is 16px wide, so the thumb centre moves from 8px to (100% - 8px) across the track.
 */
function rangeFill(value: number, min: number, max: number): CSSProperties {
  const span = max - min;
  const raw = span > 0 ? (value - min) / span : 0;
  const p = Math.min(1, Math.max(0, raw));
  return { '--fill': `calc(8px + (100% - 16px) * ${p.toFixed(4)})` } as CSSProperties;
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const musicVolume = useSettings((s) => s.musicVolume);
  const sfxVolume = useSettings((s) => s.sfxVolume);
  const quality = useSettings((s) => s.quality);
  const uiScale = useSettings((s) => s.uiScale);
  const colourBlind = useSettings((s) => s.colourBlind);
  const update = useSettings((s) => s.update);
  const reset = useSettings((s) => s.reset);
  const lang = useLang((s) => s.lang);
  const setLang = useLang((s) => s.setLang);

  return (
    <Modal
      open={open}
      title={tn('Settings')}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={reset}>
            {tn('Reset to defaults')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {tn('Done')}
          </Button>
        </>
      }
    >
      <div className="setup__stack">
        <div className="field">
          <span className="field__label" id="settings-lang">
            {tn('Language')}
          </span>
          <div className="seg" role="group" aria-labelledby="settings-lang">
            <button type="button" aria-pressed={lang === 'vi'} onClick={() => setLang('vi')}>
              Tiếng Việt
            </button>
            <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
              English
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field__label">{tn(`Music volume · ${Math.round(musicVolume * 100)}%`)}</span>
          <input
            className="range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={musicVolume}
            style={rangeFill(musicVolume, 0, 1)}
            aria-label={t('Music volume')}
            onChange={(e) => update({ musicVolume: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <span className="field__label">{tn(`Sound effects · ${Math.round(sfxVolume * 100)}%`)}</span>
          <input
            className="range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sfxVolume}
            style={rangeFill(sfxVolume, 0, 1)}
            aria-label={t('Sound effect volume')}
            onChange={(e) => update({ sfxVolume: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <span className="field__label" id="settings-quality">
            {tn('Graphics quality')}
          </span>
          <div className="seg" role="group" aria-labelledby="settings-quality">
            {QUALITY.map((q) => (
              <button
                key={q.id}
                type="button"
                aria-pressed={quality === q.id}
                title={t(q.note)}
                onClick={() => update({ quality: q.id })}
              >
                {tn(q.label)}
              </button>
            ))}
          </div>
          <span className="muted settings__hint">{tn(QUALITY.find((q) => q.id === quality)?.note ?? '')}</span>
        </div>

        <div className="field">
          <span className="field__label">{tn(`Interface scale · ${Math.round(uiScale * 100)}%`)}</span>
          <input
            className="range"
            type="range"
            min={0.85}
            max={1.3}
            step={0.05}
            value={uiScale}
            style={rangeFill(uiScale, 0.85, 1.3)}
            aria-label={t('Interface scale')}
            onChange={(e) => update({ uiScale: Number(e.target.value) })}
          />
        </div>

        <label className="check">
          <input type="checkbox" checked={colourBlind} onChange={(e) => update({ colourBlind: e.target.checked })} />
          <span className="check__text">
            {tn('Colour-blind markers: show a shape next to every colour-coded token (Hope, Discontent, sickness)')}
          </span>
        </label>

        {lang === 'vi' ? (
          <details className="glossary">
            <summary>{tn('Game terms')}</summary>
            <p className="muted glossary__hint">
              {tn('Underlined terms in the game show their Vietnamese meaning when you hover over them.')}
            </p>
            <dl className="glossary__list">
              {glossaryEntries().map((g) => (
                <div className="glossary__row" key={g.term}>
                  <dt>{g.term}</dt>
                  <dd>{g.vi}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
      </div>
    </Modal>
  );
}

// ---- Rules ------------------------------------------------------------------

interface ChecklistItem {
  id: string;
  text: string;
  section: string;
  status: 'done' | 'partial' | 'open';
}

const STATUS_WORDS: Record<string, ChecklistItem['status']> = {
  x: 'done',
  '[x]': 'done',
  done: 'done',
  '~': 'partial',
  '[~]': 'partial',
  partial: 'partial',
  ' ': 'open',
  '[ ]': 'open',
  open: 'open',
};

/** Accepts an array of items, {items: [...]} or {sections: [{title, items}]}. Unknown shapes give an empty list. */
export function readChecklist(json: unknown): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const walk = (node: unknown, section: string) => {
    if (Array.isArray(node)) {
      node.forEach((n, i) => {
        if (n && typeof n === 'object') {
          const o = n as Record<string, unknown>;
          if (Array.isArray(o.items)) {
            walk(o.items, typeof o.title === 'string' ? o.title : section);
            return;
          }
          const raw = typeof o.status === 'string' ? o.status.trim().toLowerCase() : null;
          const status: ChecklistItem['status'] =
            o.done === true ? 'done' : raw !== null ? (STATUS_WORDS[raw] ?? 'open') : 'open';
          out.push({
            id: String(o.id ?? `${section}-${i}`),
            text: String(o.text ?? o.title ?? o.id ?? ''),
            section,
            status,
          });
        }
      });
    } else if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (Array.isArray(o.items)) walk(o.items, section);
      if (Array.isArray(o.sections)) walk(o.sections, section);
    }
  };
  walk(json, 'Rules');
  return out;
}

type ChecklistState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; items: ChecklistItem[] };

function useChecklist(open: boolean): ChecklistState {
  const [state, setState] = useState<ChecklistState>({ status: 'loading' });
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setState({ status: 'loading' });
    fetch(`${import.meta.env.BASE_URL}checklist.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : Promise.reject(new Error(String(r.status)))))
      .then((json) => {
        if (!alive) return;
        const items = readChecklist(json);
        setState(items.length > 0 ? { status: 'ready', items } : { status: 'missing' });
      })
      .catch(() => {
        // Absent file, or a dev server that answers with its HTML fallback: both mean "no progress file yet".
        if (alive) setState({ status: 'missing' });
      });
    return () => {
      alive = false;
    };
  }, [open]);
  return state;
}

export function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pdf = rulebookPdfUrl();
  const checklist = useChecklist(open);

  const counts =
    checklist.status === 'ready'
      ? checklist.items.reduce(
          (acc, it) => {
            acc[it.status] += 1;
            return acc;
          },
          { done: 0, partial: 0, open: 0 },
        )
      : null;

  const sections =
    checklist.status === 'ready'
      ? Array.from(new Set(checklist.items.map((i) => i.section))).map((sec) => ({
          title: sec,
          items: checklist.items.filter((i) => i.section === sec),
        }))
      : [];

  return (
    <Modal open={open} title={tn('Rules')} onClose={onClose} width={1080} className="rules-modal">
      <div className="rules">
        <div className="rules__pdf">
          {pdf ? (
            <iframe className="rules__frame" src={pdf} title={t('Frostpunk rulebook (PDF)')} />
          ) : (
            <p className="muted">
              {tn('The rulebook is not part of this build. It appears here once the asset manifest lists the PDF.')}
            </p>
          )}
        </div>
        <aside className="rules__check" aria-label={t('Rules checklist progress')}>
          <h3 className="rules__check-title">{tn('Checklist')}</h3>
          {checklist.status === 'loading' ? <p className="muted">{tn('Loading progress…')}</p> : null}
          {checklist.status === 'missing' ? (
            <p className="muted">{tn('No checklist progress file was generated for this build.')}</p>
          ) : null}
          {counts ? (
            <>
              <p className="rules__counts">
                <span className="chip chip--ok">{tn(`${counts.done} done`)}</span>{' '}
                <span className="chip chip--warn">{tn(`${counts.partial} partial`)}</span>{' '}
                <span className="chip">{tn(`${counts.open} open`)}</span>
              </p>
              <div className="rules__sections">
                {sections.map((sec) => (
                  <details key={sec.title} className="rules__section">
                    <summary>
                      {sec.title} · {sec.items.filter((i) => i.status === 'done').length}/{sec.items.length}
                    </summary>
                    <ul>
                      {sec.items.map((it) => (
                        <li key={it.id} className={cx('rules__item', `rules__item--${it.status}`)}>
                          <span className="rules__item-id num">{it.id}</span> {it.text}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </Modal>
  );
}

// ---- Credits ----------------------------------------------------------------

export function CreditsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title={tn('Credits')} onClose={onClose} width={560}>
      <div className="credits">
        <p>
          {tn('Frostpunk: The Board Game, Web Edition is an unofficial fan project. It is not made, endorsed or sponsored by the rights holders of Frostpunk or of the board game.')}
        </p>
        <p className="muted">
          {tn('Artwork, sounds, models and rules text belong to their rights holders and are used here only to play the game. Please buy the physical game to support its makers.')}
        </p>
        <p className="muted">
          <Icon name="warning" size={14} /> {tn('Frostpunk is a trademark of its owners. This page does not claim any of it.')}
        </p>
      </div>
    </Modal>
  );
}

// ---- In-game menu -----------------------------------------------------------

export function InGameMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mode = useSession((s) => s.snap?.mode ?? 'solo');
  const watching = useSession((s) => (s.snap?.watch ?? null) !== null);
  const detach = useSession((s) => s.detach);
  const leaveRoom = useSession((s) => s.leaveRoom);
  const openOverlay = useUi((s) => s.openOverlay);
  const setScreen = useUi((s) => s.setScreen);
  const notify = useUi((s) => s.notify);

  const saveAndExit = () => {
    // Solo: every answer is already autosaved, so detaching keeps the game. Co-op: the seat stays on the server.
    // A watched game is not kept: leaving it simply stops the viewing.
    detach();
    setScreen('menu');
    onClose();
    if (!watching) {
      notify(
        mode === 'solo' ? t('Game saved in this browser.') : t('You left the table. Your seat is kept for you.'),
        'ok',
      );
    }
  };

  const leaveForGood = () => {
    leaveRoom();
    setScreen('menu');
    onClose();
  };

  return (
    <Modal open={open} title={tn('Game menu')} onClose={onClose} width={400}>
      <nav className="ingame-menu" aria-label={t('Game menu')}>
        <Button variant="primary" block icon="heat" data-autofocus onClick={onClose}>
          {tn('Resume')}
        </Button>
        <Button variant="secondary" block icon="gear" onClick={() => openOverlay('settings')}>
          {tn('Settings')}
        </Button>
        <Button variant="secondary" block icon="book" onClick={() => openOverlay('rules')}>
          {tn('Rules')}
        </Button>
        <Button variant="secondary" block onClick={saveAndExit}>
          {watching
            ? tn('Stop watching and return to menu')
            : mode === 'solo'
              ? tn('Save and return to menu')
              : tn('Leave the table, keep my seat')}
        </Button>
        {mode === 'coop' ? (
          <Button variant="danger" block onClick={leaveForGood}>
            {tn('Leave the room for good')}
          </Button>
        ) : null}
      </nav>
    </Modal>
  );
}

// ---- Host -------------------------------------------------------------------

/** Mounts every overlay; ui.overlay decides which one is open. */
export function OverlayHost() {
  const overlay = useUi((s) => s.overlay);
  const close = useUi((s) => s.closeOverlay);
  return (
    <>
      <SettingsModal open={overlay === 'settings'} onClose={close} />
      <RulesModal open={overlay === 'rules'} onClose={close} />
      <CreditsModal open={overlay === 'credits'} onClose={close} />
      <InGameMenu open={overlay === 'ingame'} onClose={close} />
    </>
  );
}
