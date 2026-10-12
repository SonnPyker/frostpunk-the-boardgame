// The City section of the right column: Weather & Storm, Laws, Technologies, Event display and Expeditions as tabs, each
// with a count badge. The tab that matches the open decision (a Law, a Technology, an Expedition, an event card, a
// Weather card) is opened by itself. The section's open state and the last tab picked by hand are remembered per viewer.
import { useEffect, useRef, useState } from 'react';
import type { GameState } from '@frostpunk/engine';
import { t, tn } from '../i18n';
import { EmbeddedContext, tip } from './context';
import { EventDisplay } from './EventDisplay';
import { ExpeditionPanel } from './ExpeditionPanel';
import { Icon } from './icons';
import { LawsPanel } from './LawsPanel';
import { MAX_LAWS } from './model';
import type { IconName } from './model';
import { TechPanel } from './TechPanel';
import { WeatherPanel } from './WeatherPanel';
import { readFlag, readPref, writeFlag, writePref } from './storage';

export type CityTab = 'weather' | 'laws' | 'tech' | 'events' | 'expeditions';

interface TabDef {
  id: CityTab;
  label: string;
  icon: IconName;
}

const TABS: TabDef[] = [
  { id: 'weather', label: 'Weather', icon: 'cold' },
  { id: 'laws', label: 'Laws', icon: 'law' },
  { id: 'tech', label: 'Tech', icon: 'tech' },
  { id: 'events', label: 'Events', icon: 'event' },
  { id: 'expeditions', label: 'Expeditions', icon: 'expedition' },
];

const TAB_KEY = 'city.tab';
const OPEN_KEY = 'city.open';

export interface CitySigs {
  weather: string;
  laws: string;
  tech: string;
  events: string;
  expeditions: string;
}

/** The City tab a pending decision belongs to, from its kind and its source tag (e.g. 'law:L04', 'card:M022'), or null. */
export function focusTabFor(p: GameState['pending']): CityTab | null {
  if (!p) return null;
  const src = p.src ?? '';
  const id = src.includes(':') ? (src.split(':')[1] ?? '') : src;
  if (p.kind === 'law' || /^L\d/.test(id)) return 'laws';
  if (p.kind === 'tech' || /^T\d+$/.test(id)) return 'tech';
  if (p.kind === 'expArrive' || p.kind === 'expExplore' || p.kind === 'expStack' || p.kind === 'deployScout' || /^X\d+$/.test(id)) {
    return 'expeditions';
  }
  if (p.kind === 'card' || /^[MD]\d+$/.test(id)) return 'events';
  if (p.kind === 'weather' || /^W\d+$/.test(id)) return 'weather';
  return null;
}

function isTab(v: string | null): v is CityTab {
  return v === 'weather' || v === 'laws' || v === 'tech' || v === 'events' || v === 'expeditions';
}

interface Badge {
  text: string;
  tip: string;
}

function badgesOf(s: GameState): Record<CityTab, Badge> {
  const done = s.techs.filter((tk) => tk.state === 'done').length;
  return {
    weather: {
      text: s.stormMarker === null ? '–' : `${t('R')}${s.stormMarker}`,
      tip: s.stormMarker === null ? 'Weather & Storm: no Storm marker left on the Round track.' : `Weather & Storm: the Storm marker is on Round ${s.stormMarker}.`,
    },
    laws: { text: `${s.laws.length}/${MAX_LAWS}`, tip: `Laws in play: ${s.laws.length} of ${MAX_LAWS} slots.` },
    tech: { text: `${done}/${s.techs.length}`, tip: `Technologies developed: ${done} of ${s.techs.length}.` },
    events: { text: String(s.events.length), tip: `Event cards in play: ${s.events.length}.` },
    expeditions: { text: String(s.expeditions.length), tip: `Expedition stacks out: ${s.expeditions.length}.` },
  };
}

interface Props {
  state: GameState;
  sig: CitySigs;
}

export function CityTabs({ state: s, sig }: Props) {
  const [open, setOpen] = useState<boolean>(() => readFlag(OPEN_KEY, true));
  const [active, setActive] = useState<CityTab>(() => {
    const v = readPref(TAB_KEY);
    return isTab(v) ? v : 'weather';
  });

  // A new decision opens its tab (and the section), without overwriting the remembered preference.
  const pid = s.pending?.id ?? null;
  const focus = focusTabFor(s.pending);
  const lastFocused = useRef<number | null>(null);
  useEffect(() => {
    if (pid === null || focus === null || lastFocused.current === pid) return;
    lastFocused.current = pid;
    setActive(focus);
    setOpen(true);
  }, [pid, focus]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    writeFlag(OPEN_KEY, next);
  };
  const choose = (id: CityTab) => {
    setActive(id);
    writePref(TAB_KEY, id);
  };

  const badges = badgesOf(s);
  const body = (() => {
    switch (active) {
      case 'weather':
        return <WeatherPanel state={s} sig={sig.weather} />;
      case 'laws':
        return <LawsPanel state={s} sig={sig.laws} />;
      case 'tech':
        return <TechPanel state={s} sig={sig.tech} />;
      case 'events':
        return <EventDisplay state={s} sig={sig.events} />;
      case 'expeditions':
        return <ExpeditionPanel state={s} sig={sig.expeditions} />;
    }
  })();

  return (
    <section className={'hud-panel hud-city' + (open ? '' : ' is-collapsed')} aria-label={t('City')}>
      <header className="hud-panel-head">
        <button type="button" className="hud-panel-toggle" aria-expanded={open} onClick={toggleOpen} {...tip(open ? t('Collapse City') : t('Expand City'))}>
          <Icon name="round" size={14} />
          <span className="hud-panel-title">{tn('City')}</span>
          <span className="hud-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
      </header>
      {open ? (
        <>
          <div className="hud-tabs" role="tablist" aria-label={t('City sections')}>
            {TABS.map((tab) => {
              const on = tab.id === active;
              const needed = tab.id === focus;
              const b = badges[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`city-tab-${tab.id}`}
                  aria-selected={on}
                  aria-controls="city-tabpanel"
                  tabIndex={on ? 0 : -1}
                  className={'hud-tab' + (on ? ' is-on' : '') + (needed ? ' is-needed' : '')}
                  onClick={() => choose(tab.id)}
                  {...tip(needed ? `${t(b.tip)} ${t('A decision is waiting for you here.')}` : t(b.tip))}
                >
                  <Icon name={tab.icon} size={12} />
                  <span className="hud-tab-label">{tn(tab.label)}</span>
                  <span className="hud-tab-count">{b.text}</span>
                </button>
              );
            })}
          </div>
          <div className="hud-city-body" role="tabpanel" id="city-tabpanel" aria-labelledby={`city-tab-${active}`}>
            <EmbeddedContext.Provider value={true}>{body}</EmbeddedContext.Provider>
          </div>
        </>
      ) : null}
    </section>
  );
}
