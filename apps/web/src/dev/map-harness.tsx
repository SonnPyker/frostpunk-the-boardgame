// Dev harness for the 3D map. Open /map-harness.html under the Vite dev server. Not part of the game shell.
import { useMemo, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { MapView, buildSampleState, type Quality, type PickInfo } from '../map';
import type { GameState } from '@frostpunk/engine';

const HIGHLIGHT_PRESET = ['N01:top', 'GEN:UR', 'b:5', 'm:2', 'm:9'];
const FOCUS_PRESET = ['GEN:LR', 'N03:top', 'b:5', 'm:4', 'tile:0,-2'];

/** Small state edits so the diff animations can be watched: each returns a new GameState. */
const EDITS: { label: string; apply: (s: GameState) => GameState }[] = [
  {
    label: 'move m:6 to N05:top',
    apply: (s) => ({ ...s, meeples: s.meeples.map((m) => (m.id === 6 ? { ...m, loc: { k: 'space', space: 'N05:top' } } : m)) }),
  },
  {
    label: 'send m:1 to supply',
    apply: (s) => ({ ...s, meeples: s.meeples.map((m) => (m.id === 1 ? { ...m, loc: { k: 'supply' } } : m)) }),
  },
  {
    label: 'heat +4',
    apply: (s) => ({ ...s, gen: { ...s.gen, heat: s.gen.heat + 4 } }),
  },
  {
    label: 'remove coal mine',
    apply: (s) => ({
      ...s,
      buildings: s.buildings.filter((b) => b.uid !== 8),
      spaces: Object.fromEntries(Object.entries(s.spaces).map(([k, v]) => [k, v.building === 8 ? { ...v, building: null } : v])),
    }),
  },
  {
    label: 'upgrade workshop',
    apply: (s) => ({ ...s, buildings: s.buildings.map((b) => (b.uid === 4 ? { ...b, upgraded: true } : b)) }),
  },
];

const btn: CSSProperties = {
  font: '12px system-ui, sans-serif',
  padding: '5px 9px',
  borderRadius: 4,
  border: '1px solid #33454f',
  background: '#101a21',
  color: '#dff1f8',
  cursor: 'pointer',
};

function Harness() {
  const [state, setState] = useState<GameState>(() => buildSampleState());
  const [quality, setQuality] = useState<Quality>('medium');
  const [useHighlight, setUseHighlight] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<string>('');
  const [picked, setPicked] = useState<string>('');
  const highlight = useMemo(() => (useHighlight ? new Set(HIGHLIGHT_PRESET) : undefined), [useHighlight]);

  // clear first so pressing the same focus button twice still re-centres the camera
  const doFocus = (id: string) => {
    setFocus(null);
    setTimeout(() => setFocus(id), 0);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#070b0e', color: '#dff1f8' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8, alignItems: 'center', borderBottom: '1px solid #1b2730' }}>
        <span style={{ font: '600 13px system-ui' }}>Map harness</span>
        {(['low', 'medium', 'high'] as Quality[]).map((q) => (
          <button key={q} style={{ ...btn, borderColor: q === quality ? '#6fd3ff' : '#33454f' }} onClick={() => setQuality(q)}>
            {q}
          </button>
        ))}
        <button style={{ ...btn, borderColor: useHighlight ? '#ff9b2f' : '#33454f' }} onClick={() => setUseHighlight((v) => !v)}>
          highlight {useHighlight ? 'on' : 'off'}
        </button>
        {FOCUS_PRESET.map((id) => (
          <button key={id} style={btn} onClick={() => doFocus(id)}>
            focus {id}
          </button>
        ))}
        <span style={{ font: '12px system-ui', opacity: 0.8 }}>|</span>
        {EDITS.map((e) => (
          <button key={e.label} style={btn} onClick={() => setState((s) => e.apply(s))}>
            {e.label}
          </button>
        ))}
        <button style={btn} onClick={() => setState(buildSampleState())}>
          reset state
        </button>
        <span style={{ font: '12px system-ui', opacity: 0.8 }}>hover: {hover || '-'}</span>
        <span style={{ font: '12px system-ui', opacity: 0.8 }}>picked: {picked || '-'}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <MapView
          state={state}
          quality={quality}
          highlight={highlight}
          focus={focus}
          onPick={(id) => setPicked(id)}
          onHover={(id: string | null, info: PickInfo | null) => setHover(info ? `${id} (${info.title})` : '')}
        />
      </div>
    </div>
  );
}

// Vite hot reloads re-run this module; reuse the root instead of creating a second one on the same container.
const container = document.getElementById('root')!;
const existing = (container as HTMLElement & { __mapRoot?: ReturnType<typeof createRoot> }).__mapRoot;
const root = existing ?? createRoot(container);
(container as HTMLElement & { __mapRoot?: ReturnType<typeof createRoot> }).__mapRoot = root;
root.render(<Harness />);
