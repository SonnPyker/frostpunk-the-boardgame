# Frostpunk Web Port — progress log

Read this first when resuming. Update it at the end of each work chunk.

## Layout

```
assets_src/            raw copy of the TTS mod (audio, images, pdf, models, mod json)  — NOT deployed as-is
docs/RULES_CHECKLIST.md   rules checklist (statuses [ ] [~] [x]) — user's first requirement
docs/FX_DSL.md           effect language used by the card data
docs/rules_text/         extracted rulebook + scenario book text
packages/engine/         pure TS rules engine (deterministic, serialisable, replayable)
  src/data/raw/*.json    all card / building / map / scenario data (hand-extracted)
apps/web/                React + Vite + Three.js client (Frostpunk look)
apps/server/             Node + ws realtime server (Render) + Supabase persistence
supabase/migrations/     SQL
tools/                   python helpers (sheet viewer, generators, asset optimiser)
```

## Decisions

* npm workspaces (npm 11, Node 24). TypeScript everywhere. Vitest for tests.
* Engine state is plain JSON. All randomness through a seeded RNG stored in the state. A game is `config + seed + command log`.
* Engine control flow: **op stack** (`state.stack`, data-only continuations) + `state.pending` (one decision awaiting a player). `run(state)` pops ops until a pending appears or the game ends.
* Card effects are data (FX DSL, see docs/FX_DSL.md); ~40 complicated cards use `custom:` handlers.
* Playable scenarios: Crater, Frozen Grove, Dreadnought (only these are documented in the supplied Scenario Book pages). Others are listed in the UI as "rules not available in the supplied scenario book".
* Generator tower is simulated (per-cube probability of the digital drawer), declared in checklist ADP-01.

## Status

- [x] Asset copy, data extraction (22 raw JSON files), rulebook read, checklist, FX DSL
- [x] Monorepo scaffold (npm workspaces: packages/*, apps/*)
- [x] Engine core / phases / FX / scenarios (wave 6: 628 tests, see "State at end of session")
- [x] Engine tests + bot simulation (sim.ts with random, smart, pro and Monte-Carlo bots; 0 wins so far, see KNOWN_ISSUES)
- [x] Server + Supabase (wave 6: rate and connection limits, shutdown grace, Supabase timeout, co-op smoke test PASS; closure pass: migrations run on PGlite (PostgreSQL 18 as WASM), 50/50 checks, not on a hosted Supabase project)
- [x] Wave 4 rules-fidelity audit: 78 findings raised, 65 confirmed, 13 rejected (docs/KNOWN_ISSUES.md "Wave 4 audit"); checklist statuses and notes updated (docs/RULES_CHECKLIST.md); ENGINE_SPEC sec 3.2/3.3 corrected. Fixes for confirmed findings tracked by the checklist notes.
- [x] Wave 5 regression pass: typecheck clean, engine 586/586, server 88/88, token scan 0 unknown; sims 90 games each (solo, co-op, extra, pro) 0 crashed / 0 stuck / 0 invariant, 0 wins; open items in docs/KNOWN_ISSUES.md "Wave 5".
- [~] Web client (playable solo and co-op; typecheck and production build clean)
- [x] 3D models → GLB (14 models), audio, image optimisation (apps/web/public/assets, 46 MB; see docs/ASSETS.md)
- [x] Deploy configs (render.yaml, vercel.json, supabase/), README, docs/DEPLOYMENT.md. The first real deploy is not recorded in the docs.
- [x] Wave 6 (docs and fixes): engine 628 tests, server 106 tests, token scan 0 unknown; fixes listed in KNOWN_ISSUES "Closed in wave 6"

## Gotchas

* Bash tool: heredocs containing apostrophes break — use the Write tool for files.
* TTS card index = row-major in sprite sheet; `CardID = deckId*100 + idx`.
* The cwd of the shell can drift; always use absolute paths.

## End of session: closure pass (2026-10-11)

What changed in this pass:

* **Checklist verified and updated.** docs/RULES_CHECKLIST.md: every item in the closure run has its verdict and an evidence note. The file is now 174 items: 152 done, 21 partial, 1 open (PLT-06, not in the run). `apps/web/public/checklist.json` was regenerated with `tools/gen_checklist_json.py`.
* **Confirmed gaps fixed** (each with a test file in packages/engine/tests/audit7_fix_*.test.ts): MOR-05 (D062 Engineer restriction), GEN-08 (Generator cubes carry over), ACT-11 and FG1 (Frozen Grove restriction for Construct and Use), ACT-CO3 (Beacon cannot be destroyed), DEA-03 (any holder of a matching Citizen card may discard), SCN-02 (Steam Hub free step in Dawn, Morning, Weather and Preparation), ADP-08 (Future Law display shows the undrawn Law cards), PLT-02 (board backdrops and face-down event decks).
* **Gaps not fixed**, with reasons, are listed in docs/KNOWN_ISSUES.md "Closure pass". The fix pass judged MOR-03 and DUS-03 claims to be wrong, and made no change. PLY-02 was already correct.
* **SQL checked on PGlite.** PGlite is PostgreSQL 18.3 compiled to WASM. Result: 50 of 50 checks passed (supabase/tests/pglite_check.mjs). This is a real Postgres engine, not Supabase itself. The check found a migration portability bug (service_role had no table grants without Supabase's defaults), fixed by supabase/migrations/0002_service_role_grants.sql. Store divergences found (conflicting duplicate commands, seq gaps, silent finish on an unknown game) are not changed; the owner must decide. See docs/KNOWN_ISSUES.md.
* **Assets provenance** recorded in docs/ASSETS.md: assets_src is byte-identical to the TTS mod folder (SHA-1: Audio 1/1, Images 175/175, PDF 6/6, Models 14/14). The 14 .obj models were converted to GLB by our own tools/optimize_assets.py. The Blender MCP was not needed.
* **Boosted late-game simulation** (`sim.ts --boost`, scripts/bots/boost.ts): 1440 of 1440 games reached "Survived the Storm" at S04 Round 12 across crater, frozenGrove and dreadnought, solo and co-op, base and extra pack, seeds 1 and 2. 0 stuck, 0 crashed, 0 invariant violations. The top-up supplies food, coal, wood and the other resources, so this proves the late game is reachable in code. It does not prove the game is winnable in normal play.

Winnability, honestly: the unboosted bots still never win (see KNOWN_ISSUES "Winnability"). A competent human winning normal play is UNPROVEN. The boosted result is not evidence of that.

Test status reported in this pass: engine vitest 52 files and 769 tests passing (last reported by the PLT-02 fix pass); server vitest 106 tests in 15 files passing (the PGlite report also records 106/106 before and after its change); web typecheck clean.

## State at end of session (2026-10-11, wave 6)

What exists:

* **Engine** (`packages/engine`): full rules engine for the three playable scenarios (Crater, Frozen Grove,
  Dreadnought), solo and co-op, base and extra pack. Deterministic, seeded, replayable from `config + seed + commands`.
  Hidden information is redacted by `view(s, seat)`. Checked against the rulebook and card images in two audit waves.
* **Web client** (`apps/web`): Vite + React + Three.js. Solo runs the engine in the browser and autosaves to
  localStorage (replay format v2, with Continue). Co-op talks to the server over WebSocket. Loading screen, hand fan,
  decision dock anchored bottom-centre (sticky Pass at 860 px height or less), Rules modal with the rulebook PDF and
  checklist progress, hotkeys in on-screen order. Co-op seat token is stored per tab (sessionStorage). An advisor-count
  guard in New game and Lobby.
* **Server** (`apps/server`): Node + `ws`. Rooms by code, per-seat views, drop and resume by token, snapshots and
  command log to Supabase (or in memory when `SUPABASE_URL` is unset). Limits: `MAX_CONNECTIONS`, `MAX_CONN_PER_IP`
  (soft, see `TRUST_PROXY` caveat), `MAX_ROOMS`, frame size, refusal rate window. `SHUTDOWN_GRACE_MS` on SIGTERM.
* **Data and tools**: `packages/engine/src/data/raw/*.json` (cards, buildings, map, scenarios, expeditions, laws,
  technologies); `tools/gen_checklist_json.py` regenerates `apps/web/public/checklist.json` from
  `docs/RULES_CHECKLIST.md`; `tools/optimize_assets.py` builds the deployable assets.
* **Docs**: `docs/RULES_CHECKLIST.md` (174 items), `docs/KNOWN_ISSUES.md` (the honest open list), `docs/DECISION_IDS.md`,
  `docs/ENGINE_SPEC.md`, `docs/NET_PROTOCOL.md`, `docs/UI_SPEC.md`, `docs/DEPLOYMENT.md`, `docs/ASSETS.md`.

How to run (from the repository root, Node 20 or newer):

```bash
npm ci
npm run dev:server        # game server, PORT default 8080, watch mode
npm run dev:web           # web client on http://localhost:5173
npm run typecheck         # engine, server, web
npm test                  # engine tests (vitest, 940 tests in 64 files)
npm test -w apps/server   # server tests (vitest, 106 tests in 15 files)
npm run build             # web and server builds (the web build runs tsc first, so it fails with the same web errors)
npm run sim               # bot simulation; e.g. npm run sim -- --games 200 --smart --coverage
```

Smoke test (no browser, needs no Supabase): `cd apps/server && npx tsx scripts/smoke.ts` prints `smoke: PASS`.
Token check: `cd packages/engine && npx tsx scripts/scan_tokens.ts` prints `unknown token heads: 0`.
Checklist JSON: `python -I tools/gen_checklist_json.py` after editing `docs/RULES_CHECKLIST.md`.

How to deploy: follow `docs/DEPLOYMENT.md`, in this order. (1) Supabase: create the project, apply
`supabase/migrations/` in filename order. (2) Render: Blueprint from `render.yaml`, fill `CORS_ORIGIN`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the service role key is a secret). (3) Vercel: import the repo,
`vercel.json` sets the build, add the `VITE_*` variables (`VITE_SERVER_URL` is the Render `wss://` URL), deploy.
(4) Put the Vercel origin into `CORS_ORIGIN` on Render. Solo play needs only Vercel.

Test status: engine 940/940 (64 files), server 106/106 (15 files), token scan 0 unknown heads, smoke PASS. Web
typecheck and `npm run build` are clean.

Caveats (details in docs/KNOWN_ISSUES.md "Current state"):

* Winnability is unproven. Bots never win: random and smart about 0%; scripted pro bot average last round about 4.0;
  Monte-Carlo bot, 96 games, 0 wins, average last round about 5.3, maximum 8. The engine is audited against the
  printed rules, but a competent human has not been shown to win. Weak bots are the likely cause, not established.
* Only three scenarios are playable. The DB migrations run on PGlite (PostgreSQL 18 as WASM) but have not been run on a hosted Supabase project. Co-op seat storage has a
  localStorage fallback that was being added. The Future Law display is public: `futureLaws` (Law ids) is in the player view and shown in the Laws panel (ADP-08, audit 7).
* `TRUST_PROXY` and `MAX_CONN_PER_IP` are a soft limit only: a client can spoof the first `X-Forwarded-For` entry.

## Closure pass 2 (2026-10-12)

* Checklist: 174 items, 166 done, 8 partial, 0 open. The 8 partial items are declared readings or need physical
  components: ACT-RS4 (the "E tile effect" is not identifiable), BLD-01 (small basic count 43 vs 42), DUS-03 (meaning
  of the red X glyph), HUN-04, WEA-01, SET-12 (declared), PLT-02 and PLT-04 (see below).
* Fixed in this pass: Steam Hub Coal returned to the bank (generator.ts); D008/D009 run at the end of Night;
  Snow Pit cannot be dismantled; Propaganda Centre no longer offers itself (infinite loop); L17 returned Meeples
  usability is read by the engine; Generator Stress cubes carried to the next round (shown in the HUD); FG1
  Generator adjacency for Construct and Use; D062 Engineers' Strike; any holder may discard a Citizen on death;
  Law display (futureLaws) visible; destroy honours the red Dismantle icon.
* Supabase SQL: executed on PostgreSQL 18 (PGlite, WASM), 50 of 50 checks (`supabase/tests/pglite_check.mjs`),
  including the real SupabaseStore. Added `0002_service_role_grants.sql`. NOT run on a hosted Supabase project.
* Late-game coverage: the "boost" sim (out-of-rules colony top-up, `sim.ts --boost`) reaches the S04 Round 12
  victory in all three scenarios, solo and co-op, base and extra pack (1440 of 1440 games, 0 stuck, 0 crashed,
  0 invariant), so the engine's victory path, techs, expeditions, storms and laws are exercised. Final gate: 40 solo
  and 30 co-op boosted games per scenario all won.
* Without the boost, the bots still never win (pro bot 0 of 100, Monte-Carlo bot 0 of 96): winnability under normal
  play is unproven, most likely because the bots are weak.
* Final gate: typecheck clean, `npm run build` ok, engine 940/940 (64 files), server 106/106 (15 files), token scan 0
  unknown, co-op smoke PASS, `optimize_assets.py --verify` 0 missing.

## Vietnamese UI (2026-10-12)

* The web client is Vietnamese by default, with an English option in Settings → Language (kept per browser). The
  engine and server stay English. See `docs/I18N.md` for the runtime, the build pipeline and the known limits.
* Dictionary: 2,896 entries (`apps/web/src/i18n/vi.json`) and 62 glossary keys (`glossary.json`), built from
  `tools/i18n/` by `node tools/i18n/build_vi.mjs` (0 placeholder or conflict problems). Sources: `tools/i18n/vi/`,
  `tools/i18n/ui/`, `tools/i18n/glossary.json`, style sheet `tools/i18n/terms.md`.
* Game terms stay English and carry a Vietnamese hover gloss (`<abbr class="gl-term">`). Settings lists them under
  "Thuật ngữ trò chơi".
* Language switch remounts the `.app` root by language. Checked in the browser mid-game: the decision, the log and the
  3D map survive the switch, and no console errors.
* Checked in the browser at 1366×768: main menu, New Solo Game setup, a solo game (decision prompts, log, HUD, the in-game
  menu) and Settings in both languages. Leftover English: card artwork and card-face text, the rulebook PDF, player
  names typed by the player, and the Laws and Expeditions tab labels (glossary terms).
* Translations were produced by subagents and reviewed, not by a native speaker. Known wording differences are listed in
  `docs/I18N.md`.

## 3D models in the map (2026-10-12)

* The 14 TTS `.obj` models in `assets_src/models` are GLBs in `apps/web/public/assets/models`. Nine were wired into the map
  (meeples, wood, coal, steam core, trees, Steam Hub), but on medium and high quality they were invisible: `reconcile` and
  `placeMeeple` set the holder scale to 0.001 before the cached GLB loaded, and `swapGlb` measured the world box there, so
  the models came out about 1000× too small. Also, `swapGlb` added the child's world position on top of the holder's, so
  each model was offset. Fixed with `frameBox` in `scene.ts`, which measures the holder's contents in the holder's own
  frame. Child meeples keep their 0.62 base scale (`MeepleView.base`).
* `dreadnought` lies along the scenario's dread tiles (sunk 55% so meeples on it stay readable). `model_1f2abb1e`
  (identified by shape as the Generator tower) stands in the Generator crater, fitted by footprint: `GENERATOR_BASE = 1.6`
  (about the crater's top diameter and one hex flat-to-flat), which makes the tower about 3.4 tall.
* Measured in the browser at 1366×768, medium quality (world units, from the scene graph): Generator 1.6 × 3.42 × 1.57;
  coal 0.115 × 0.087 × 0.12; trees about 0.45 × 0.69 × 0.23; a worker on `F02:bottom` 0.23 × 0.21 × 0.10. The worker is
  squat: the uniform fit is limited by the GLB's width, so it is 0.21 tall against a 0.44 stand-in. Wood's long axis (z)
  does not match the stand-in's (x), so it is probably distorted. Not yet fixed. Decide whether to fit meeples and wood
  by height, or keep the current fit.
* Not verified up close: the pane's default camera shows meeples at only a few pixels, so the sizes above come from the
  scene graph, not a screenshot. Browser rAF does not run in the pane, so tweens were advanced with `renderOnce`.
* Still not placed: `steel`, `leadership_marker`, `round_marker`. The map has no 3D slot for them (see `docs/ASSETS.md`).
  Decide where they should appear before placing them.
* An earlier note here said the nine models were placed and verified in the browser. That was wrong; they were invisible.
  The only console error seen in the dev session is the WebSocket to `ws://localhost:8080/`, because no co-op server ran.
* Review fixes: `loadGltf` ends in `.catch(() => null)`, so a failed loader import cannot cause an unhandled rejection;
  the Dreadnought length is `span + SQRT3 * HEX`, so the ship reaches past the end tiles. Typecheck and `npm run build:web` pass.

## Back to the action menu (2026-10-12)

* A player who picks an action can go back to the action menu from its first decision, to see what the action does
  before committing. The menu comes back as it was, and nothing from the action is kept. This is a house rule (see
  `docs/KNOWN_ISSUES.md`). Mechanism: `docs/DECISION_IDS.md`, "Back to the action menu".
* Engine: `Pending.back`, `BACK_PICK = 'back'`, and `GameState.backPoint` (the state before the action pick, removed from
  views). Back is offered only while the round and phase are the same and nothing hidden has changed.
* Web: "Back to actions" button in `DecisionPanel`. The "Your last decisions" trail drops the undone action (`history.ts`).
  Two strings added to `tools/i18n/ui/decisions.json` and built with `node tools/i18n/build_vi.mjs` (0 problems).
* Checks: engine 947/947 in 65 files (7 new in `tests/back_to_actions.test.ts`), server 106/106 in 15 files, typecheck
  clean for engine, server and web, co-op smoke PASS, `npm run build` ok. Simulator: solo 80 games (`--scenario all
  --smart`) and co-op 40 games (`--coop --extra`), 0 won (the documented baseline), 0 stuck, 0 crashed, 0 invariant.
* Browser (1366×768, solo Crater): Back on the Fuel decision restores the same menu and clears the trail. Back on the
  first Construct decision restores the menu. Continue replays a save that contains a back answer.
* Not run: a hosted Supabase project, or a co-op server restore of a game that contains a back answer.

## Remove Snow hex pick, slider fill, building text (2026-10-12)

* Remove Snow: tile placement asks for a hex on the map (`tileSlot`). The map highlights only the legal hexes and a click
  answers. The same options sit in a folded list, "No map? Pick from a list", for a player whose map cannot draw.
  Browser-verified: a whole Remove Snow (Near (0, 2), then Far (-3, 1)) answered through the list, back to the Action menu.
  Earlier, the map click path was verified (N04 at (0, -2), N08 at (1, -2)).
* Settings sliders: the fill follows the handle. `rangeFill` (`apps/web/src/screens/Overlays.tsx`) sets the `--fill`
  variable on each `.range` input, and the `.range` style in `apps/web/src/styles/components.css` draws it. Browser-verified: 0% gives no fill, 50% stops at the handle, and a UI scale of 1.0
  on the 0.85–1.3 range gives 33.3%.
* Buildings: the effect text and artwork show on building options and in the map tooltip, with the description first.
  Data: `apps/web/src/data/buildingInfo.ts`. Vietnamese: `tools/i18n/ui/buildings.json` (`build_vi`: 0 problems).
  Browser-verified: the Build list (12 kinds, with art and text), the Use list (`b:2`, `b:5`), and the tooltip on a Charcoal Kiln.
* Checks: `npm run typecheck` clean; `npm test` engine 947/947; `npm test -w apps/server` 106/106; `npm run build` ok.
* Not committed.

## Frozen Grove HUD fixes (2026-10-12)

* Rim band: `rimCorners()` in `apps/web/src/map/hex.ts` added the Generator centre to the absolute corners in
  `data/raw/map.json`, so on Frozen Grove (centre [0, 2]) the hatched band was drawn two rows low. The corners are now
  used as they are, matching `packages/engine/src/tiles.ts`. Crater and Dreadnought (centre [0, 0]) are unchanged.
* Hope and Discontent tokens: `SocietyBoard.tsx` looked up `hope-care` and similar names, but the manifest keys are the
  bare names (`care`, `anger`, ...). The chips now show their art. Justice still has no asset (`justice.webp` is not in
  `apps/web/public/assets/tokens`), so it keeps the two-letter fallback.
* Checks: `npm run typecheck` clean. Browser: a new Frozen Grove solo game loads the Hope and Discontent art.
* Open: the faint "4 5 6" numerals in the Society Engineer row and in the Generator come from the `board_panel_b` and
  `board_generator` backdrops at 0.2 opacity with no mask. The City panel's Storm text is clipped at `max-height: 860px`.
  Both need a layout decision.
* Not committed.

## Map-only position decisions (2026-10-12)

* Position decisions (`tileSlot`, `space`, `adjacentSpace`, `treePick`; `MAP_ANSWER_KINDS` in
  `apps/web/src/decisions/DecisionPanel.tsx`) no longer repeat their options as a list when the map can draw. The panel
  shows a status line ("Click a highlighted hex/space on the map") and the disabled options with their reasons. The rows
  stay for the keyboard: Tab reveals them (`.dec-keys:focus-within` in `decisions.css`), Enter answers. They carry no
  number badge, because digits do not answer these kinds (`OptionList` `numbered={false}`).
* Click: a building or Meeple on a highlighted space no longer blocks the click. `scene.ts` `pickCandidates` collects the
  raycast picks and the ground pick, and the click takes the first highlighted one.
* Fallback: `useUi` `mapDown` is set when the WebGL constructor fails (`MapView.tsx`) or the map ErrorBoundary catches
  (`App.tsx` `onError`). The list then shows under "No map? Pick from a list".
* Kept as lists: `buildSpace` (a Large building highlights one of its two spaces), and the building, meeple, citizen,
  reuse and distribute decisions.
* Browser-verified (normal mode): Gather answered by a real click on highlighted N08 top. Remove Snow: two Near tiles
  answered by two map clicks, back to the Action menu. Gather space answered from the keyboard (Tab, Enter). No-WebGL
  (simulated by overriding `getContext`): the map failure text shows and the space decision shows 9 list rows.
* Not yet verified in the browser: `treePick`, `adjacentSpace`, and a hover cursor over a building on a highlighted space.
* Open: a player who loses WebGL after mount (no context-lost handler) keeps the hidden list. Touch players lose hover
  details, because tooltips are hover only. The new Vietnamese strings are drafts and need native review.
* Checks: `npm run typecheck` clean.
* Not committed.

## Build sites and Coal Thumper on the map (2026-10-12)

* Build site (`buildSpace`, the "Đặt Gathering Post" list with "Vị trí xây dựng") is answered on the map: the panel shows
  the status line and no list, and a click on a highlighted space builds. The list stays as the fallback when the map
  cannot draw (`useUi` mapDown).
* Large buildings: `placementOptions` (buildings.ts) offers one option per half of the tile instead of only the top
  half, so each half has its own pick point on the map. Either click builds on the whole tile (`footprint()`). Old saves
  still replay: the top-half option id is unchanged.
* Coal Thumper (`thump`, up to `count` adjacent spaces, one Coal each) is picked on the map too. Each click toggles the
  space; a picked space shows a solid marker (new `selected` prop on `MapView`, `setSelected` in `scene.ts`); Confirm
  sends the picks.
* Dev hook: `__fp.mapScreenPoint(id)` (DEV only) gives the canvas pixel of a pick id, for browser checks.
* Checks: `npm run typecheck` clean; engine `npm test` 944 passed, 3 skipped (65 files); new
  `packages/engine/tests/buildspace_halves.test.ts`. Browser (headless shell, 1600×900, solo Crater): a Tent build site
  shows no visible list rows and answers from a map click (N03 top: "Tent built"); a Beacon build site shows two pick
  points on F01 (top and bottom), and a click on the bottom half built the Beacon over both spaces.
* Not verified in the browser: `thump`. The smart bot did not reach a Coal Thumper distribution in the automated runs
  (the Use step gave no thump decision). The multi-pick path and the selected marker are reviewed in code only.
* i18n: "Click the highlighted spaces on the map" added to `tools/i18n/ui/decisions.json`; `build_vi.mjs` 0 problems.


## Watch mode: a bot plays the game (2026-10-12)

* Main menu → "Xem bot chơi" (Watch a bot play). The set-up is the solo one (scenario, society, difficulty, extra pack,
  seed, one Advisor) plus a bot level: Random (`legalPick`), Heuristic (the sim's `--smart` scoring) or Expert (the
  `--pro` scripted bot). The level is chosen before the game starts.
* The bots moved into the engine so the web can use them: `packages/engine/src/bots/pro.ts` (was scripts/bots/pro.ts),
  `src/bots/heuristic.ts` (the sim's `smartPick`, now `heuristicPick`) and `src/bots/level.ts` (`BOT_LEVELS`, `botPick`,
  `botRng`, exported from the engine index). `sim.ts` output is unchanged: the same seeds give the same games.
* `apps/web/src/controller/WatchController.ts`: the bot answers each decision through `applyAnswer` (same rules as a
  player). Speed is decisions per second (1×, 2×, 4×) or Max (as many as fit in a 40 ms slice per 100 ms tick). Pause,
  step (one decision while paused) and speed are the viewer's controls (`WatchControls`, in the HUD top bar). The
  viewer cannot answer: `canAnswer` is false and the decision panel says "Bot đang chọn".
* Watched games are not autosaved and never touch the solo save: `discardSolo` leaves the solo save alone when a
  watch is attached, and the in-game menu says "Dừng xem và về menu chính" instead of "Save and return".
* Bot stuck (no legal pick) stops the game with a toast and status "Stopped: no legal move"; a finished game shows the
  end screen.
* Tests: `packages/engine/tests/bots.test.ts` (each level answers with legal picks, the same bot seed plays the same
  game, the random level depends on its seed, a Frozen Grove game ends under the heuristic level). Engine `npm test`
  955 passed, 3 skipped (67 files). Typecheck clean. `vite build` clean.
* Browser (headless shell, 1366×820, `npm run dev:web`, Crater): the setup shows the Mức bot choice; Watch starts and
  the bot advances; Pause freezes the board for 2.5 s; Step changes the HUD; Max played a whole game to the end screen
  ("THẤT BẠI"); the solo autosave key was not written; "Dừng xem và về menu chính" returns to the main menu. No page
  errors in the console (only the existing i18n warnings for untranslated log lines).
* Not included: the Monte-Carlo bot (`scripts/bots/mc.ts`) stays a sim-only tool; it was not measured in the browser and
  its rollouts are much heavier than the other levels. The dev bot (`apps/web/src/dev/bot.ts`) still has its own copy of
  the heuristic.
* i18n: 26 strings in `tools/i18n/ui/watch.json`; `build_vi.mjs` 0 problems.
