// Private HUD harness: renders <Hud> over a dark stage with the fixture state. Not part of the game shell.
import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/theme.css';
import { Hud } from '../hud/Hud';
import { makeHudFixture } from '../hud/fixtures';

const PICKABLE = new Set<string>(['C01', 'C02', 'C03', 'X01', 'M001', 'T04']);

function Harness() {
  const [state] = useState(() => makeHudFixture());
  const [picked, setPicked] = useState<string>('none');
  const onPick = useCallback((id: string) => setPicked(id), []);

  return (
    <>
      <Hud state={state} seat={0} pickable={PICKABLE} onPick={onPick}>
        <div className="hud-panel" style={{ width: 'min(560px, 100%)', pointerEvents: 'auto' }}>
          <div className="hud-panel-head">
            <span className="hud-panel-title">Decision (harness placeholder)</span>
            <span className="hud-panel-aside">picked: {picked}</span>
          </div>
          <p className="hud-muted hud-small" style={{ margin: 0 }}>
            The decision panel is mounted here. Pickable ids pulse: C01, C02, C03, X01, M001, T04.
          </p>
        </div>
      </Hud>
    </>
  );
}

const el = document.getElementById('root');
if (!el) throw new Error('#root missing in hud-harness.html');
createRoot(el).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
