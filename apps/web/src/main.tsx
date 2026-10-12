// Entry point: global styles, the saved settings applied to the document, then the app.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/tutorial.css';
import { App } from './App';
import { Boot } from './screens/Boot';
import { applySettingsToDocument, getSettings, useSettings } from './store/settings';

applySettingsToDocument(getSettings());
useSettings.subscribe((s) => applySettingsToDocument(s));

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('index.html has no #root element');

// Boot shows the loading screen until the fonts, board art and scene models are warm (bounded by a timeout).
createRoot(rootEl).render(
  <StrictMode>
    <Boot>
      <App />
    </Boot>
  </StrictMode>,
);

// DEV only: window.__fp (fast-forward helper for testing the late game). Dropped from production builds.
if (import.meta.env.DEV) {
  void import('./dev/devHook').then((m) => m.installDevHook());
}
