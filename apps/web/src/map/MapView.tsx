// React wrapper around MapScene. One scene per mounted <MapView/>. React state changes go in through the imperative
// API (setState / setQuality / setHighlight / focus), and pointer events come back out as option ids.
//
// Option ids: a Decision option may be a space id ('N03:top', 'GEN:T'), a building uid ('b:12' or bare 12), a meeple
// id ('m:3' or bare 3), a tile key ('tile:2,-1') or an empty hex named 'q,r' (tileSlot; canonical 'hex:2,-1').
// resolvePickId normalises each to the canonical pick id the scene reports. onPick and onHover hand back the option id
// that maps to the canonical id, otherwise the canonical id.
import { useEffect, useRef } from 'react';
import type { GameState } from '@frostpunk/engine';
import { MapScene, type Quality } from './scene';
import { resolvePickId, type PickInfo } from './pick';
import { PAL } from './palette';
import { t } from '../i18n';
import { useUi } from '../store/ui';

export type { Quality } from './scene';

export interface MapViewProps {
  state: GameState;
  /** Clicked option id. When `highlight` is defined only highlighted options are reported. */
  onPick?: (id: string) => void;
  /** Option ids that can be picked right now. They get pulsing markers and are the only ones reported to onPick. */
  highlight?: Set<string>;
  /** Option id to fly the camera to. Changing it re-centres the map. */
  focus?: string | null;
  quality?: Quality;
  /** Hovered option id (or canonical id) and its description, or null when nothing pickable is under the cursor. */
  onHover?: (id: string | null, info: PickInfo | null) => void;
}

/** Canonical pick ids of every highlighted option. */
function highlightedCanon(p: MapViewProps): Set<string> {
  const set = new Set<string>();
  for (const opt of p.highlight ?? []) {
    const c = resolvePickId(p.state, opt);
    if (c) set.add(c);
  }
  return set;
}

/** The option id behind a canonical id (falls back to the canonical id when no option maps to it). */
function optionFor(p: MapViewProps, canonical: string): string {
  if (!p.highlight) return canonical;
  for (const opt of p.highlight) if (resolvePickId(p.state, opt) === canonical) return opt;
  return canonical;
}

export function MapView(props: MapViewProps) {
  const { state, highlight, focus, quality = 'medium' } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const failRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<MapScene | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const lastHover = useRef<string | null>(null);

  // create once per mount; the hooks read the latest props so they never go stale
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: MapScene;
    try {
      scene = new MapScene(
        host,
        {
          onHover: (info, x, y) => {
            const tip = tipRef.current;
            if (tip) {
              if (!info) {
                tip.style.display = 'none';
              } else {
                tip.replaceChildren();
                const title = document.createElement('div');
                title.textContent = info.title;
                title.style.fontWeight = '600';
                tip.appendChild(title);
                for (const line of info.lines) {
                  const row = document.createElement('div');
                  row.textContent = line;
                  row.style.opacity = '0.85';
                  tip.appendChild(row);
                }
                tip.style.display = 'block';
                const maxX = Math.max(0, host.clientWidth - tip.offsetWidth - 8);
                const maxY = Math.max(0, host.clientHeight - tip.offsetHeight - 8);
                tip.style.left = Math.min(x + 14, maxX) + 'px';
                tip.style.top = Math.min(y + 14, maxY) + 'px';
              }
            }
            const cur = latest.current;
            const id = info ? optionFor(cur, info.id) : null;
            if (id !== lastHover.current) {
              lastHover.current = id;
              cur.onHover?.(id, info);
            }
          },
          onPick: (canonical) => {
            const cur = latest.current;
            if (cur.highlight && !highlightedCanon(cur).has(canonical)) return;
            cur.onPick?.(optionFor(cur, canonical));
          },
        },
        quality,
      );
    } catch (err) {
      // WebGL unavailable or context creation failed: say so instead of showing a blank box, and tell the decision panel
      // that the map cannot answer, so position decisions list their options
      const fail = failRef.current;
      if (fail) {
        fail.style.display = 'flex';
        fail.textContent = t('3D map unavailable') + ': ' + (err instanceof Error ? err.message : String(err));
      }
      useUi.getState().setMapDown();
      return;
    }
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setState(state);
    lastHover.current = null;
  }, [state]);

  useEffect(() => {
    sceneRef.current?.setQuality(quality);
  }, [quality]);

  useEffect(() => {
    sceneRef.current?.setHighlight(highlightedCanon({ state, highlight }));
  }, [state, highlight]);

  useEffect(() => {
    if (!focus) return;
    sceneRef.current?.focus(resolvePickId(latest.current.state, focus) ?? focus);
  }, [focus]);

  return (
    <div
      ref={hostRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 240,
        overflow: 'hidden',
        background: '#' + PAL.bg.toString(16).padStart(6, '0'),
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <div
        ref={tipRef}
        role="tooltip"
        style={{
          display: 'none',
          position: 'absolute',
          left: 0,
          top: 0,
          pointerEvents: 'none',
          maxWidth: 240,
          padding: '6px 9px',
          borderRadius: 4,
          background: 'rgba(11,18,24,0.92)',
          border: '1px solid #33454f',
          color: '#dff1f8',
          font: '12px/1.35 Barlow, system-ui, sans-serif',
          zIndex: 2,
        }}
      />
      <div
        ref={failRef}
        style={{
          display: 'none',
          position: 'absolute',
          inset: 0,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          color: '#b9cdd8',
          font: '14px system-ui, sans-serif',
          textAlign: 'center',
        }}
      />
    </div>
  );
}
