# UI_SPEC — Frostpunk web client (apps/web)

Desktop-first (min 1280×720, designed at 1920×1080), React 18 + Vite 6 + TypeScript strict + zustand + three 0.171. No UI kit —
hand-written CSS (CSS variables + a few CSS modules or one global stylesheet per area). Pure client; the engine
(`@frostpunk/engine`) is consumed as source. Everything the player sees is derived from `GameState` (or `view(s, seat)`), the
log and `state.pending`. The player ONLY makes choices: every `pending` is rendered as a decision; the engine does all rules and
all asset movement (the UI animates by diffing consecutive states and reading `state.log`).

## 1. Look & feel ("Frostpunk")
Dark, cold, industrial, hopeless-but-warm-at-the-core. Heat is the only warm colour on the screen.

CSS tokens (put in `apps/web/src/styles/theme.css`, use everywhere):
```
--bg-0:#070b0e; --bg-1:#0c1318; --bg-2:#121c23; --panel:#0f171dcc; --panel-solid:#101a21;
--steel:#7c93a1; --steel-hi:#b9cdd8; --frost:#dff1f8; --frost-dim:#8fb2c2;
--ember:#ff9b2f; --ember-hi:#ffc766; --ember-lo:#8a4b10;          /* generator / heat / primary action */
--hope:#6fd3ff; --disc:#d8483f; --danger:#ff4d3d; --ok:#74d08a;
--care:#8bd2ff; --justice:#d9c27a; --motivation:#d98cff;           /* Hope types   */
--anger:#e5533d; --apathy:#8f8f9b; --greed:#c9a227;                /* Discontent types */
--wood:#b07a45; --coal:#2a2a2e; --core:#ff8a3d; --steel-res:#9fb4c4; --food:#e8d9a0;
--radius:4px; --edge:1px solid #2b3d49; --glow:0 0 18px #ff9b2f55;
```
Typography (Google Fonts, load in index.html): headings/numerals **Oswald** (uppercase, letter-spacing .08em), body **Barlow Condensed** / **Barlow**, small caps labels. Panels: dark glass (`backdrop-filter: blur(6px)`), 1px steel border, corner brackets drawn with pseudo-elements, riveted/brushed-metal header strips, subtle frost vignette + animated snow particles (canvas) over the 3D map background, ember glow around the generator. Buttons: rectangular, chamfered corners (clip-path), amber fill for the primary choice, outlined steel for secondary, disabled = dim with the reason as tooltip. Sound: ambient wind/music loop from the mod audio, procedural UI SFX (Web Audio, no files).

## 2. Layout (1920×1080 reference; everything is a CSS grid, panels collapsible)
```
┌────────────────────────── TOP BAR: scenario · ROUND TRACK 1..15 (round marker, storm marker, tech dev token, triggers) · PHASE chips · menu ┐
│ LEFT (≈360px)            │            CENTER: 3D hex map (three.js)            │ RIGHT (≈360px)                                    │
│ Society board:           │  tiles, resources, trees, buildings, meeples,        │ Generator board: heat track, indicators,          │
│  Citizen markers ×3,     │  scouts, snow; hover/click highlights for           │  stress cubes, Fuel; Weather card + hunt/scout;   │
│  sickness (skull/syringe)│  the options of the current decision                │  Storm card; Laws (≤4), Technologies,             │
│  Hunger, Food, Corpses   │                                                      │  Event display, Expeditions (3 stacks + scouts)   │
│  Hope & Discontent tracks│  floating context tooltip + minimap                  │                                                   │
│  Supply (Wood Coal Core  │                                                      │                                                   │
│  Steel, Automatons)      │                                                      │                                                   │
├──────────────────────────┴──────────────────────────────────────────────────────┴───────────────────────────────────────────────────┤
│ BOTTOM: Resource strip · player seats (name, advisor, played Citizen card) · hand of Citizen cards · DECISION PANEL (current pending) · LOG│
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Modal/overlay screens: Main menu, New game (solo / co-op create / join by code), Scenario & society picker (card art), Settings (volume, quality),
Rules (rulebook PDF viewer + checklist), Victory/Defeat summary. Card zoom: hovering any card image shows a large version.

## 3. Decisions
`state.pending` (kind, prompt, src, options[{id,label,hint,disabled,data}], min,max, meta{allowRepeat,caps,count}) is rendered in the Decision
panel: 1-of-N (buttons / card tiles), N-of-M (checkbox tiles with Confirm), distribute (+/- steppers using meta.caps), confirm-only, and — when option ids are
map objects (space ids like `N03:top`, building uids, meeple ids) — ALSO highlighted and clickable directly on the 3D map. Disabled options show their reason.
For position decisions (space, adjacent space, tree, empty hex; see `MAP_ANSWER_KINDS`) the map is the only picker: the panel shows a status line and the disabled reasons, with no duplicate list. The option rows stay for the keyboard, without number badges, and show on focus. The full list returns only when the map cannot draw.
Only the addressed seat (`pending.who`, −1 = any) can answer; others see "Waiting for <name>". Answers go through a `Controller` interface:
`{ state, answer(pick:string[]): void }` implemented by `LocalController` (solo, engine in-browser, with undo-free autosave to localStorage) and `RemoteController` (WebSocket to the server).

## 4. Modules & ownership (each agent edits only its own paths)
* **SHELL**: `index.html`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`, `src/styles/*`, `src/store/*` (zustand: controller, ui state, settings), `src/controller/*` (Local + Remote controllers; protocol in `docs/NET_PROTOCOL.md` / `packages/engine/src/protocol.ts` if present), `src/screens/*` (menu, lobby, new game, settings, rules, end screen), `src/audio/*` (music + procedural SFX), `src/components/ui/*` (Panel, Button, Tooltip, Modal, Icon set as inline SVG).
* **MAP3D**: `src/map/*` — three.js scene (hex tiles from `state.tiles`/`spaces`, trees, resources, buildings (GLB models via the assets manifest with procedural fallbacks), meeples, scouts, snow, lights/fog), camera controls (pan/zoom/rotate limits, focus on selection), raycast picking mapped to option ids, highlight system, animation of meeple/resource movement by diffing states, quality settings. Exposes `<MapView/>`.
* **HUD**: `src/hud/*` — Society board, Generator board, Round track, Weather/Storm, Laws, Technologies, Event display, Expeditions panel, Resource strip, Players bar + hand, Log feed, Card component (`<CardImage id/>` using the assets manifest, with text fallback built from the engine data), tooltips with rules text (via `describeFx`). Exposes the panels + `<Hud/>`.
* **DECISIONS** (wave 4, after the engine's action pipeline exists): `src/decisions/*` — DecisionPanel, option tiles, distribute widget, action menu grouping, confirmations.

## 5. Assets
Use `apps/web/src/assets/manifest.ts` (written by the ASSETS agent: `cardUrl(id)`, `tokenUrl(key)`, `modelUrl(key)`, `audioUrl(key)`, `boardUrl(key)`, `pdfs`). Every image/model use must have a graceful fallback
(styled placeholder / procedural primitive) if the manifest has no entry — the build must never fail on a missing asset.
Dev harness: `import { blankState } from '@frostpunk/engine'` gives an empty state for isolated component work; `apps/web/src/dev/*` may hold fixtures (owned by whoever needs them).

## 6. Current state (end of wave 6, 2026-10-11)

Sections 1 to 5 are the original plan. What the client does now, as built:

* Boot: a loading screen (`src/screens/Boot.tsx`) before the menu.
* Solo: the engine runs in the browser (`src/controller/LocalController.ts`). Autosave in localStorage with the replay
  format v2; Continue on the menu. The save is per origin, not per tab.
* Co-op: `src/controller/RemoteController.ts` over the WebSocket protocol in `docs/NET_PROTOCOL.md`. The seat token is
  stored per tab in sessionStorage (`controller/persistence.ts`), so two tabs never share a seat. A localStorage fallback
  was being added; check the code before relying on it.
* Layout: CityTabs (`src/hud/CityTabs.tsx`) in the right column; the hand is a fan of cards; the decision dock sits bottom-centre and keeps Pass
  visible at 860 px height or less.
* Decisions: friendlyText repairs labels for display; hotkeys follow the on-screen order; the Workshop counter and the
  history are reset per game.
* Guards: New game and Lobby check the advisor count before a game starts.
* Rules modal: the rulebook PDF plus the checklist progress (from `apps/web/public/checklist.json`).
* Known gaps in the UI (see docs/KNOWN_ISSUES.md "Remaining gaps"): Society column density at small screen heights;
  face-up Future Laws not shown; the public log carries card ids; tech, expedition and storm decisions only checked in
  the browser with crafted pending decisions; the web typecheck was failing at the end of wave 6.
