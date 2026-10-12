# ENGINE_SPEC — contract for the remaining engine modules

Read this together with `docs/FX_DSL.md`, `docs/RULES_CHECKLIST.md` (rule IDs), `docs/CARD_TEXT_CUSTOM.md`, and the rulebook text
`docs/rules_text/5B9201D39C.clean.txt` (action phase ~lines 2700-3200, expeditions ~3755-3985). Project root: `E:\Claude\frostpunk-web`.
Engine: `E:\Claude\frostpunk-web\packages\engine` (TypeScript strict, ESM, `.ts` imports WITHOUT extension, vitest).

## 0. Working rules for every agent

* **File ownership.** Edit ONLY the files listed as yours. Never edit `types.ts`, `core.ts`, `fx/core.ts`, `fx/index.ts`, `data/*`
  or another agent's file. If you need a type field / helper that does not exist, put it in YOUR file (e.g. `s.flags.xyz`,
  `s.scenarioState.xyz`, `op` payloads) and report it. `types.ts` already contains the additions listed in §2.
* **Cross-module calls** to modules owned by other agents (which may not exist yet) go through *op names* (`push(s,{k:'name'})`) or
  *FX token names* (`exec(s,'token:arg',ctx)` / `runFx`) resolved at runtime — NOT through imports — unless the target is
  listed under "Existing modules" below. Your own exported helpers are for others to import; list them in your report.
* **Typecheck:** `cd /e/Claude/frostpunk-web/packages/engine && npx tsc --noEmit -p .` — your files must be error-free. Errors in
  *other* agents' unfinished files are expected; ignore them (but report anything that blocks you).
* **Token scanner:** `npx tsx scripts/scan_tokens.ts` lists FX token heads without a handler. Your tokens must disappear from it.
  (The scanner imports `src/fx/index.ts`, which already has `import './tokens_xxx'` lines for every owned token module; a module
  may not be empty-checked by tsc yet — placeholder files `export {}` exist for all of them.)
* **Determinism / serialisability.** GameState is plain JSON. No Date/Math.random/Map/Set/class instances/functions in state or in
  op payloads. All randomness via `rng.ts` (`rand, randInt, chance, pickOne, shuffle(st,arr)→new array`, with `s.rng`).
* **Decisions** are always raised with `ask(...)` / `askDistribute(...)` from `core.ts` and continue in a registered `defOp(...)`
  handler named in `then`. The answer arrives as `op.pick: string[]` (`op.none===true` when auto-resolved with nothing).
  `ask` auto-resolves trivial choices; set `forced:true` only for confirmations that must be seen. **Op payloads must be
  JSON** — never rely on mutating an object shared by reference (ctx is *copied* when serialised). Persistent working data
  lives in `s.flags.*`, `s.scenarioState.*`, `Building.extra`, `EventCardInPlay.extra`.
* **Side-effect registration.** `fx/index.ts` already imports every `fx/tokens_*.ts` + `fx/custom.ts`. Ops defined in your non-fx
  modules (e.g. `buildings.ts`) must be registered when that file is imported, so your `fx/tokens_*.ts` file MUST `import '../<your module>'`
  (and the phase/setup modules are imported by `index.ts`). Never create import cycles that call `defOp`/`defTok` at module top level
  before the registry in `core.ts` / `fx/core.ts` exists (those two files have no imports of yours).
* **Op names are global** (`defOp` throws on duplicates): prefix yours with your module (`bld*`, `act*`, `exp*`, `law*`, `tech*`, `ph*`, `nt*`, `scn*`, `cus*`).
* **FX token heads are global** (`defTok` throws on duplicates).
* Write unit tests in `packages/engine/tests/<module>.test.ts` when it is cheap to do with `blankState` (see `src/testing.ts`).
  Do not leave failing tests: if something cannot be tested before integration, skip the test rather than leave it red.
* Write files with the Write tool (bash heredocs choke on apostrophes). Absolute paths. The shell cwd drifts.
* **Report format** (your final message, raw data): files written; exported function signatures others need; op names you
  registered; FX tokens registered; `custom:` ids registered; assumptions/deviations; anything left undone. Keep it under 60 lines.

## 1. Existing modules (import freely)

`types.ts` (GameState & friends), `core.ts` (`defOp, pushSeq, push, log, ask, askDistribute, answerPending, run, lose, win, opt`),
`rng.ts`, `util.ts` (RES_KINDS, LIMITS, citizenTypeOf, roleOf, gainRes, spendRes, totalSupplyRes, meepleById, meeplesAtSpace,
inSupply, freeSupply, newMeeple, removeMeeple, toSupply, bdef, buildingByUid, buildingAtSpace, buildingsOfKind, hasBuilt, hasLaw,
lawActive, techDone, huntingSymbols, …), `map.ts` (spaceHeated, buildingHeated, zoneHeated, insulationHeated, tileForcedHeated,
nearSlots, farSlots, placeTileAt, adjacentSpaces, tilesAdjacentToSpace, tileAdjacentToRimDeposit, connectedTileKeys, tileZone,
hexOfSpace, treesOnMap, spacesWith, spaceLabel), `generator.ts` (totalStress, addStress, removeStress, fuelRoom, doFuel,
advanceIndicators, removeIndicator, breakdown, cubesForHeat; ops fuelAsk, fuelDo, genCold, genStress, generatorPhase),
`hope.ts`, `sickness.ts` (killCitizen, addSick, flipSick, cureOne, treatOne, canCure, curableTotal/Of, skullTypes, spentCount,
addSpent, checkSicknessLoss; ops deathCard…, sicknessResolve, addSpent, flipOp), `cards.ts` (card flow: morning/dusk draw, events,
laws' consequence covers, social dispute; `cardDef, cardTitle, isSocial, eventOf, placeEvent, removeEventCard, addToDusk,
rebuildDusk, drawMorning, drawDusk, currentCardId`), `fx/core.ts` (`Ctx, defTok, N, runFx, exec, evalCond, evalCount, feasible,
payable, setPayable, hasTok, tokenHeads, parseToken`), `fx/tokens_people.ts`, `fx/tokens_supply.ts`, `fx/tokens_cards.ts`
(`defCustom(id, fn(s,ctx,args))`, `hasCustom`, `customIds`), `data/index.ts` (typed JSON: `buildings, buildingMeta, weatherCards,
heatRangeSetup, advisors, callToRise, handSize, societies, mapData, tileDefs, laws, lawRules, techs, citizens, lawConsequences,
socialDispute, morning, dusk, expeditions, scenarioCards, scenarioStart, scenarios, generatorData, heatTrack, eventCard,
meepleCountFor, sicknessBand`).

Read the files you build on — they are short. FX semantics: `runFx(s,list,ctx)` pushes an `fx` op; the *last* `runFx` call
executes first, so to run A then B call `runFx(s,[...A,...B],ctx)`. String item `'stop'` halts the rest of the list. Conditions
unknown to `evalCond` throw.

## 2. State additions already in types.ts (added by the lead)

* `ExpStack.bonus?: { wood?: number; coal?: number }` — stack bonus resources gained on Return.
* `Meeple.stay?: boolean` — Meeple stays on its space through the Night (Prison etc.).
* `src/testing.ts` exports `blankState(config?)`: a fully initialised empty GameState (no tiles/decks) for unit tests.

## 3. Rules decisions (authoritative — do not re-derive)

### 3.1 Phases & turn structure
Phase order: Dawn → Morning → Generator → Weather → Preparation → Action → Dusk → Hunger → Night, then round+1. Round 1 starts at the
Action phase (setup includes Weather draw & adjust). `roundType(r)` = child/engineer/worker cycling from round 1 = child.
Feeding uses the *current* round type; Hunger deaths use the *previous* round's type (round 1: current).
Hunger table: 1–4 → +1 Disc; 5–9 → +1 Disc + 1 death; 10–14 → +1 Disc + 2 deaths; 15–19 → +1 Disc + 3 deaths; 20–24 → +1 Disc + 4 deaths; ≥25 → lose (after spending Food).
Leader: first player marker rotates each round (co-op). `s.leader` answers phase-level decisions; in the Action phase `s.turn` rotates clockwise.

### 3.2 Action phase
* Start: adjust supply Meeples to the Population track (`meepleCountFor(cit)`; Scouts count as supply), then place a Meeple on each Spent token (those Meeples cannot act this round).
* Turn = one player: optional free **Fuel** (does not end the turn; once per TURN, rulebook p23; the earlier "once per phase" wording was stale), then ONE of: Pass, or choose a Main action with ONE Meeple (Worker/Engineer/Automaton/Child-Worker/Child-Engineer as allowed): **Remove Snow** (place two Near tiles OR one Far tile), **Gather** (take up to 2 resources from ONE space, once per space per round — `s.usedSpaces`), **Construct** (up to 3 sub-actions: Build / Dismantle; tech T08 → 4), **Use a Building** (Small: 1 Meeple; Large: up to 2), **Deploy Scouts** (Beacon needed), **Special actions** (event-card actions, stockpile S03/S07, laws L13/L14/L17 `actionOncePerRound`) placing a Worker/Engineer on the card.
* A player may play ONE Citizen card per round (`playedCitizen`) whose *main ability* replaces the normal effect of the action chosen (the card's `act` names which main action it replaces; `fx` is the replacement list).
* **Reuse a Building** (counts as heated, from L14 etc.) and **Reuse a Worker** (a Worker that already acted; never on Scenario/Event cards) are token-driven (`reuseBuilding`, `reuseWorker`).
* Child Meeples act only through Citizen cards of child type (or L01, T16; M022 forbids). Automatons: cost 1 Coal each use (free with T17 when Heat above red), may Remove Snow, Gather, Construct and use non-Engineer buildings (any building with T17); no expeditions, no Special actions.
* **Heated check** (map.ts `spaceHeated`): Remove Snow always cold (T11 → heated); Construct, Deploy Scouts, Special always heated; Gather and Use Building depend on the target space heating. If the Generator has not started (Heat on space 1) every Gather/Use is cold. A cold action costs +1 sick of the Meeple's type (`coldSick:<type>:N` on the Citizen card overrides N) BEFORE resolving. `heated` token = counts as heated. Heat-by-spending-Food laws via `heatedBySpendFood:N` marker.
* The phase ends when all players pass consecutively or no Meeple can act. Meeples placed on the board stay until the Night.

### 3.3 Night
Order: (scenario/passive night text that is not `atEnd`) → return Spent tokens that hold Meeples → return all placed Meeples (not Scouts; Meeples with `stay` stay) → optional Fuel → heated shelter sleeping slots (Tent/Bunkhouse/House 2 each; Ruins 0 unless L06; Child Shelter 4 children; L05 +1 per heated shelter; T12 engineer slot at medical buildings; Prison) — the player chooses who sleeps → each standing (not sleeping) Meeple adds +1 sick of its type → `atEnd` night text. Sickness is NOT resolved in the Night: it resolves only in the Preparation phase (rulebook p22; the earlier "sickness resolve at Night" wording was stale). Citizens that die in the Night are handled by sickness.ts.

### 3.4 Building rules
* Dreadnought Steel substitutes Wood (any mix); paying the full Wood cost in Steel upgrades for free. Ruins cannot be built over (C18 can: −1 Wood, removes the Ruins). Large buildings need a map tile with both spaces free (not the Generator tile). Coal Mine / Wall Drill need `tileAdjacentToRimDeposit`. Field Kitchen not on the Generator tile. Printed buildings and the Cookhouse cannot be dismantled. A building holding a Meeple cannot be upgraded/dismantled. Building limits are counted over all buildings of that kind on the map including Ruins.
* **Laws unlock their building; four laws also offer an immediate build at intro.** A law building requires `s.laws.some(l => l.id === def.law)` and is otherwise built through Construct at its normal `build` cost. **Build at intro (`buildOnIntro` in `laws.json`, closed):** the printed card text of L02 Child Shelter, L09 Care House, L10 Fighting Arena and L11 Public House reads "When this Law is introduced, you may immediately build [building] by paying its cost" (verified on the law deck card backs, sheet 557). On introduction, after the intro Hope/Discontent change, the engine asks an optional yes/no (`kind:'lawBuild'`, options `yes`/`no`; op `bldLawOffer` / `bldLawPick` in `buildings.ts`). Yes queues a normal paid build of that one kind (`bldBuildKind` with `only`). The offer is skipped when the building is not unlocked, cannot be placed, or cannot be paid. `steamHub` requires T09 done. Faith/Order exclusivity = L07 xor L08 (handled by laws.ts).
* Dismantle returns nothing unless T08 (+1 Wood). Dismantling Ruins removes them from the game. D043 Tripod's blocked tile in `s.scenarioState.blocked`.
* The first Workshop built starts a tech choice (op `techStartCheck`, which calls `techStart(s, who)` in `tech.ts`; the op was `techStart` before wave 6, a name that no op had, so no tech was ever offered). If all Workshops are gone the in-progress tech returns to inactive.
* Steam Hub coal (Frozen Grove, shared module `src/steamHub.ts`): a free optional step while Heat is above the red Insulation level, offered in the Action-phase menu (`act:steamHub`), at Night (`ntSteamHub`), and at the start of Dawn, Morning, Weather, Preparation, Dusk and Hunger (`steamHubStepOps` in `night.ts`, prepended by `phases.ts` `phaseBody`). Not offered in the Generator phase. The Coal returns to the bank in the Generator Stress step. Decision kind and options: docs/DECISION_IDS.md.
* Building action modifiers (via `effectiveAction(s, building, meeple)` in `buildings.ts`): T05 medicalPost gains a `treat:2` choice; L12 medical buildings (medicalPost, infirmary, careHouse) get an extra `{ifPay:'spend:food:2', then:['cure:1']}`; T03 charcoalKiln `pay:wood:1` → choose [pay wood 1] or [remove a Tree from any tile]; T13 coalThumper `+gain:coal:2`; T10 sawmill/wallDrill `+gain:wood:1`; T06 generator `+removeStress:1`; T15 hothouse with an Engineer gets an optional corpse-back for +3 Food; T16 cookhouse may use a Child; L18 Workers may use Workshops. Upgraded building actions come from `upgAction` (`'same'` | object). Engineer-only buildings: workshop, platform, generator, factory, medicalPost, infirmary, temple, propagandaCentre.

### 3.5 Laws (max 4) & Technologies
Laws: when a law is introduced one random consequence of its pair goes into the Dusk deck unseen (`lawConsequenceBank[lawId]` holds the 2 ids; the other is removed). `coverLaw` consequences cover the Law (`law.covered=id`) with `passive`/`night`/`weather` lists run with `ctx.card=id`; `coverToDiscard` uncovers (token exists). Starting pairs L01/L02, L03/L04, L05/L06, L07/L08. Extra pack: L17–L20.
Technologies T01–T17: starting the first Workshop selects a tech; token `dueRound = min(15, round + cost)`; one at a time; done at Dawn when `round >= dueRound` (the development check is `techDawn(s)` in tech.ts). Mod names in `technologies.json` are informational: no code queries a mod key by name. Each printed Technology effect is implemented by its tech id (`techDone(s, 'Txx')`, e.g. buildings.ts, actions.ts, expedition.ts); tests/audit_4_tech_mods.test.ts maps every mod key to its implementing line. The T06 `generator` and T09 `unlock` arrays are informational too (Steam Hub availability is `unlockedBy: T09` in buildings.json). The `weather` arrays are live (tech.ts `techWeatherRuns`).
Passive-effect aggregation: `passive(s, name)` / `hasPassive(s, name)` in `laws.ts` collects law perms, covering consequence cards, tech mods, and event passives (eventPassive M022/D062/D064…).

### 3.6 Expeditions (rulebook p35–36)
Three stacks, each starting with an A card; Beacon required; 1 active expedition (2 if the Beacon is upgraded). Deploy puts a Worker/Engineer as a Scout on pos 1 of a stack without a Scout (T01: +1 space on Deploy/Continue). Weather phase moves each Scout by the weather card's `scout` value along `steps` positions. On reaching the last space the player chooses **Skip** (A/B only; not C/scenario) — draw from the next deck (A→B, B→C), overlay it, Scout to pos 1, leftover movement used — or **Explore**: the top card flips black, the Scout is set aside, choose an option: **Continue** (leave card black, record `cont`, draw a new card from `opt.next` letter, Scout to pos 1, remaining movement lost, effect deferred) or **Return** (Scout to supply; run the chosen option's fx PLUS the Continue-fx of every black card below, as ONE combined list; `next=newA`: remove stack and start a new white A stack; `next=B/C`: flip all cards white and overlay a new card of that letter; scenario S05 stack: after Return the stack is removed, no new A). Stack `bonus` resources are gained on Return. Scouts count as supply and are not returned at Night. Cards are in `expeditions.json` (`X01–X40`: `letter, location, reward, steps, title, options[{kind,next,label,fx}]`), decks `s.decks.expA/B/C`.

### 3.7 Scenarios, setup, API
See `data/raw/scenarios.json`, `rules_text` scenario book. Playable: crater, frozenGrove, dreadnought. Start config: round 1, stormMarker 9, stormCard S08, scenarioDisplay [S01], trigger tokens [4, 11], remove T09. Base card set = M001–M032, D000–D060, L01–L16, T01–T09, 32 law consequences (M031/M032 carry no `pack` flag in `morning_3.json`; the base/extra split is `BASE_MORNING_MAX = 32` in `setup.ts`, so M031/M032 are base cards). Extra pack = M033–M040, D061–D074, L17–L20, T10–T17, Survivalist societies. Advisors: ADV_GENERATOR/HEALTH/SOCIAL/FOREMAN + Call to Rise (solo), used in the Preparation phase.
Public engine API (index.ts): `createGame(config): GameState` (runs setup and `run` to the first pending), `answer(s, who, pendingId, pick)` (transactional since wave 6: a rejected answer leaves the state unchanged, via `snapshotState`/restore in `core.ts`), `view(s, who)` (redacted: hide deck order, hidden law consequences, the RNG and hand of other players in co-op where hidden; the Future Law display is public, so `futureLaws` (Law card ids) is sent with `futureLawCount`), `serialize/deserialize`, plus re-exports of types/data helpers the UI needs. `view(s, who, { omniscient: true })` is a debug option for the simulator and dev harness only; never send it to a player.

### 3.8 Open-rule assumptions (document in code comments)
Untyped "+1 sick" = random citizen type from the bag; "1 Citizen dies" = `die:current:1`; ties in `mostCommonDisc` branch maps → leader picks; Cookhouse undismantlable; L12 once per use; D007 "Sickness marker above 4" = n > 4.

## 4. Module ownership & required deliverables

### 4.1 BUILD — `src/buildings.ts`, `src/fx/tokens_build.ts`
Tokens: `buildFree, upgradeFree, upgradeBuilding, destroyBuilding, corpseBack, removeTree, gatherAdjacent, thump` (see FX_DSL §6) and customs `generatorUpgradeOnFirstCore, cemetery, duskPeek3, prisonStay` (`defCustom`).
Exports: `unlockedKinds(s)`, `builtCount(s,kind)`, `canBuildKind(s,kind)`, `buildCost(s,kind)`, `startConstruct(s,who,meeple,opts)` (the Construct main action loop of up to N sub-actions: Build / Dismantle / Upgrade; ends with an `onDone` op supplied by caller), `placeBuilding(s,kind,spaceId,opts)`, `removeBuilding(s,uid)`, `upgradeBuilding`, `buildingAction(s,uid,meeple)`/`effectiveAction`, `usableBuildings(s, meeple)` (kinds/uids a given Meeple can use now, with reasons for disabled ones), `startUseBuilding(s,who,meeple,uid,opts)` (runs the building's action fx with ctx `{who,bld,meeple,space,heated}`), ops `bldConstructStep, bldUse, …`. Include onBuild effects (`buildings.json onBuild`), shelters' sleeping capacity helper `sleepSlots(s)`, flip-to-Ruins helper `flipToRuins(s,uid)`.

### 4.2 MAP+EXP — `src/tiles.ts`, `src/expedition.ts`, `src/fx/tokens_map.ts`
Tokens: `placeTile:{far|nearElseFar|nearOrFar}`, `removeSnow:{normal|drawFar3ChooseOne|nearAndFar|twoFar|oneNearElseFar}`, `revealFar3AndReorder`, `removeSnowChildSpendFood`, `deployScouts:{normal|replaceWithB}`, `expeditionBonus:{wood|coal}:N`, `scoutsReturnNoReward`, `expedition:place:<id>`.
Exports: `removeSnowAction(s,who,meeple,variant)`, `placeTileOnMap(s,tileId,…)` (choose legal slot via `nearSlots/farSlots`, create spaces/trees/resources per `mapData`/`tileDefs`, trigger `tile revealed` effects like food bonus), `deployScout(s,…)`, `advanceScouts(s)` (called in the Weather phase; op `expAdvance`), `setupExpeditions(s)` (build the 3 stacks), `expeditionTokens`. Provide `legalExpeditionDeploy(s)` for the action menu.

### 4.3 LAWS+TECH — `src/laws.ts`, `src/tech.ts`, `src/fx/tokens_law.ts`
Tokens: `devBack, devToken-, devTokenBack, workshop, workshopEffects, introduceLawOrExhaustDisc, platform:chooseConsequence, heatedBySpendFood, workersUseWorkshopsAndGenerator, engineerConstructTwoSubactionsUpgrade` (the last three are passive markers: no-ops with data via `passive()`), plus customs `introduceLaw` (+ any law-introduction helper `introduceLaw(s,lawId?)` that lets the player pick a law from `futureLaws`, hides the consequence, applies `intro` fx, enforces max 4 and L07 xor L08).
Exports: `passive, hasPassive, techMod`, `introduceLaw`, `lawPermission(s, key)`, `techStart(s,who)`, `techDawn(s)` (op `techDawnCheck`), `techActive`, `allLawIds`. Also `lawActionsAvailable(s,who)` listing law special actions (`actionOncePerRound`).

### 4.4 CUSTOM — `src/fx/custom.ts`
`defCustom` handlers: `M004, M010, M015, M029, M038, D005, D007, D010, D011, D016, D030, D031, D032, D036, D037, D043, D053, D062, D067, D072, socialAdvisor, generatorSick:noFuel` and every other `custom:` id referenced in the raw data not owned by another agent (run a grep over `src/data/raw/*.json` for `"custom"` / `custom:` to enumerate; `introduceLaw`, `generatorUpgradeOnFirstCore, cemetery, duskPeek3, prisonStay` (BUILD) and `stockpile` (SCENARIO) are owned elsewhere). Text in `docs/CARD_TEXT_CUSTOM.md` + the card JSON. Event-card actions (M004, M010, M015, M029, M038, D037, D043, D062) are `eventAction.custom` and run when a player takes the special action — implement them as `custom:<id>` handlers (`ctx.evUid` identifies the event in play).

### 4.5 ACTIONS — `src/actions.ts`, `src/fx/tokens_action.ts`  (wave 2)
Action-phase pipeline described in §3.2. Pending ids for the UI: top-level decision `kind:'action'` with options for each legal (action, meeple) combination grouped; sub-decisions for targets. Tokens: citizen-card tokens `gatherTree, gatherFoodAdjacent, gatheringPostOrAdjacent, constructMoveSmallBuilding, constructUpgrade, constructSubactions, constructOverRuins, buildingNormal, buildingCureEffect, cookhouseTiers, reuseBuilding, reuseWorker`, `coldSick`/`heated` interplay. Exports `actionPhase` op `actStart`, `actionMenuFor(s, who)`.

### 4.6 PHASES+NIGHT — `src/phases.ts`, `src/night.ts`  (wave 2)
Dawn, Morning (cards.ts), Generator, Weather (draw, apply `heat`, `hunt`, `scout`, `storm`; Storm card; tech/law weather lists), Preparation (sickness resolve, supply adjust, advisors, Call to Rise), Dusk, Hunger, Night; `nextRound`, win/loss checks; `phaseStart` op that is the single driver `s.phase` state machine.

### 4.7 SETUP+SCENARIO+API — `src/setup.ts`, `src/scenario.ts`, `src/fx/tokens_scenario.ts`, `src/index.ts`, `src/view.ts`  (wave 3)

### 4.8 Integration (lead / wave 4)
`tests/data-coverage.test.ts`, `scripts/sim.ts` bot that plays full games (random legal answers) without exceptions.

## 5. Cross-cutting contracts (server / web / assets / deploy)

### 5.1 Engine public API (`packages/engine/src/index.ts`, built in wave 3 — code against this signature now)
```ts
createGame(config: GameConfig): GameState                         // setup + run() to the first pending decision
answer(s: GameState, who: number, pendingId: number, pick: string[]): { ok: boolean; error?: string }   // mutates s
view(s: GameState, who: number, opts?: { omniscient?: boolean }): GameView   // JSON-safe, redacted (no deck order / hidden law consequences / RNG; futureLaws = Law card ids, public); omniscient = debug only
serialize(s: GameState): string ; deserialize(json: string): GameState
replay(config: GameConfig, commands: Command[]): GameState         // determinism: same config+commands => same state
type Command = { who: number; pendingId: number; pick: string[] }
GameView = Omit<GameState,'rng'|'stack'|'decks'|'lawConsequenceBank'|'pending'|'players'|'config'> & { deckCounts: {...}, futureLaws: string[], futureLawCount, legal?: ... }
```
`GameState.pending` (kind, prompt, options with `disabled`, min/max, `meta`) is what a client renders; `GameState.log` is the event feed; the
UI animates by diffing consecutive states and by `log[].t/d`.

### 5.2 Network protocol — owned by SERVER (`packages/engine/src/protocol.ts`, types only, re-exported from the engine index)
WebSocket JSON messages client→server `{t:'create'|'join'|'ready'|'answer'|'chat'|'leave'|'resume', …}` and server→client
`{t:'state'|'lobby'|'error'|'chat'|'ended', …}`. The server is authoritative: it owns `GameState`, validates `answer` with the engine and
broadcasts `view(s, seat)` per player (co-op: 2–4 seats, same city; each seat answers decisions addressed to it). Persists to Supabase
(`games`, `game_players`, `game_commands`, `game_snapshots`) with a service-role key; anonymous guest ids; reconnect with `resume`.
Solo mode runs the engine entirely in the browser (no server needed); co-op needs the server.

### 5.3 Environment variables (use exactly these names)
Server (Render): `PORT`, `CORS_ORIGIN` (comma list), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PERSIST_SNAPSHOT_EVERY` (default 10).
Web (Vercel, build-time): `VITE_SERVER_URL` (e.g. `wss://frostpunk-server.onrender.com`).

### 5.4 Assets
Raw copy lives in `assets_src/` (never deployed). `python tools/optimize_assets.py` (owned by ASSETS) writes the deployable set to
`apps/web/public/assets/{cards,boards,tokens,tiles,models,audio,pdf}/` and a manifest `apps/web/public/assets/manifest.json` + typed accessor
`apps/web/src/assets/manifest.ts`. Card images are keyed by OUR card ids (M001, D012, L03A?, T05, C07, X12, W03, …) — resolve the TTS deck/sheet
→ id mapping from `assets_src/mod/frostpunk_tts_mod.json`, `tools/sheet.py` (`CardID = deckId*100 + idx`) and the existing generator scripts
`tools/gen_*.py` / data JSON. 3D models: OBJ → GLB with a pure-Python converter (no pip installs; Pillow is available; check numpy);
apply the mesh's diffuse texture from the mod JSON if it exists; centre/scale to ~1 unit, Y-up.

## 6. Wave-2 contracts (ACTIONS ↔ PHASES+NIGHT ↔ SCENARIO)  — written after wave 1 landed

Wave 1 modules now exist and are importable: `buildings.ts` (startConstruct, startUseBuilding, usableBuildings, placeBuilding, sleepSlots, flipToRuins…),
`tiles.ts` (removeSnowAction, pushPlaceTile…), `expedition.ts` (deployScout, legalExpeditionDeploy, advanceScouts, op `expAdvance`), `laws.ts`
(passive, hasPassive, techMod, lawActionsAvailable, runLawAction, introduceLaw, coverRuns), `tech.ts` (techDawn → op `techDawnCheck`, techWeatherRuns,
weatherFxRuns, devMove), `fx/custom.ts` (eventTimingFx(card,'dusk'|'night'), shelterCount). Read their report-level exports straight from the source.

**Phase driver (owned by PHASES):** op `phStart` `{phase}` runs a phase; op `phAdvance` moves `s.phase` to the next phase in order
(`dawn→morning→generator→weather→preparation→action→dusk→hunger→night→(round+1) dawn`), checks end of game, then pushes `phStart`. Every phase
implementation ends by pushing `{k:'phAdvance'}` as its LAST continuation. The Action phase is implemented by ACTIONS: PHASES' `phStart{phase:'action'}`
just pushes `{k:'actStart'}`; ACTIONS pushes `{k:'phAdvance'}` when everybody has passed / nobody can act. Setup (wave 3) begins a game with `push {k:'phStart', phase:'action'}`
(round 1 starts at the Action phase after the Setup weather draw — SETUP owns that).
**Sub-step ops (owned by PHASES, callable by scenario tokens `phase:X`):** `phGenerator`, `phHungerSpend`, `phHungerResolve`, `phSicknessResolve`
(the latter two are the Hunger-phase "spend Food / resolve deaths+discontent" halves; `phSicknessResolve` = the Preparation-phase sickness step).
**Scenario hook (owned by SCENARIO, wave 3):** at the start and end of every phase P, PHASES pushes `{k:'scnPhase', phase:P, when:'start'|'end'}`
ONLY IF `hasOp('scnPhase')` (so wave 2 works without it). Round-start/end hooks are covered the same way (`phase:'dawn'`, `when:'start'` is the round start).
Cards: `morningDraw`/`duskDraw` ops exist in cards.ts (Dusk card resolution incl. event Dusk effects: call `eventTimingFx(card,'dusk')` from custom.ts for every
Event card in `s.events`, using ctx `{who:leader, src:'card:'+card, card, evUid}`; same for 'night').
**End of game:** `lose()`/`win()` from core.ts clear the stack; nothing else needed. Round limit: after Night of round 15 with no victory the game is lost
unless scenario data says otherwise (SCENARIO decides via `scnPhase`; PHASES calls `lose(s,'Time ran out')` only if `s.round>15` and no scenario handler claimed it via `s.flags.roundLimitHandled`).

**Action menu (owned by ACTIONS):** one decision per turn, `kind:'action'`, `who = s.turn`, options with stable ids:
`act:fuel` (free; does not end the turn), `act:removeSnow`, `act:gather`, `act:construct`, `act:use`, `act:deploy`, `act:special:<key>` (key = `ev<uid>` | `law<ID>` | `stock<id>`), `act:pass`;
each disabled option carries a `disabled` reason. After choosing, sub-decisions: `kind:'meeple'` (ids `m:<meepleId>` — pick the acting Meeple; auto when only one equivalent),
`kind:'citizen'` (option ids = card ids in hand that can replace this action + `normal`), then action-specific targets (`kind:'space'` ids = space ids, `kind:'building'` ids `b:<uid>`).
Write `docs/DECISION_IDS.md` documenting EVERY `ask(...)` kind and option-id convention you introduce (the UI uses it to highlight map objects).
