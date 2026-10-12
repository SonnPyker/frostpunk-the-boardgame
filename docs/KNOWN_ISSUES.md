# Known issues (engine, from the full-game simulator)

Reproduce with `cd packages/engine` and:

    npx tsx scripts/sim.ts --games 200 --smart              # heuristic bot, solo, all scenarios
    npx tsx scripts/sim.ts --games 200 --smart --coop --extra
    npx tsx scripts/sim.ts --games 300 --smart --coverage   # adds the never-exercised report

Each game is replayable from the `repro:` line the sim prints (scenario, society, difficulty, mode, players,
extraPack, config seed, bot seed).

## Current state (end of session, wave 6, 2026-10-11)

Verified on this date: engine `vitest` 628 tests in 37 files, all passing; server `vitest` 106 tests in 15 files,
all passing; `packages/engine/scripts/scan_tokens.ts` reports 0 unknown token heads; `apps/server/scripts/smoke.ts`
prints `smoke: PASS`. The web typecheck and `npm run build` pass (re-verified at the end of the session).

### Winnability (honest statement)

Bots never win. This is not evidence that the game is unwinnable, and it is not evidence that a competent human
cannot win. What was measured:

- Random and smart bots: about 0% wins.
- Scripted `pro` bot (scripts/bots/pro.ts): average last round about 4.0.
- Monte-Carlo bot (scripts/bots/mc.ts, `sim --mc`: 32 rollouts for each of the top 6 candidate decisions, the pro bot
  as the rollout policy, a 1-round horizon): 96 games (Crater, Frozen Grove and Dreadnought solo normal, 24 games
  each, plus Crater co-op 2 players, 24 games). Result: 0 wins, average last round about 5.3, maximum 8. The exact
  command lines for that run are not recorded in the docs.
- Loss causes in those games: "All Hope has been lost" about 65%, then Discontent overflow and the Corpse track.

The engine has been audited against the rulebook and the card images in two waves (waves 4 and 5 plus the wave 6
fixes), and the victory path is covered by direct tests (Round 10 and Round 11 starts). Winnability by a competent
human is UNPROVEN. The most likely cause of the zero wins is weak bots (myopic search, no long-term opening plan),
not necessarily the rules. Next step that would settle it: a stronger search bot (longer horizon, opening book) or
human play-testing, and a check of whether the loss causes match the printed difficulty of the Society cards.

### Closed in wave 6

- C20 option 2 (discard 1 active Discontent) is legal only with an active Discontent token (fx/tokens_supply.ts
  `payable`). Test: tests/audit6_supply.test.ts.
- M028 Criticising the Leaders counts only plain Worker and Engineer Meeples in the supply (Child Worker and Child
  Engineer are not counted). The `it.fails` case in tests/audit5_cards_morning.test.ts is now a normal `it`.
- Dead tokens `hopePerHunger` (tokens_supply.ts) and the card-unused part of `childMeeple` removed from describe and
  supply. `childMeeple` is still registered in fx/tokens_people.ts and is unused.
- Build at introduction (`buildOnIntro`): L02, L09, L10, L11 offer an optional immediate paid build (decision kind
  `lawBuild`, yes/no; ops `bldLawOffer`, `bldLawPick`). Test: tests/audit6_laws.test.ts.
- `LawInPlay.hopeTok` is typed in src/types.ts.
- View redaction: `view(s, seat)` no longer exposes the RNG, the deck order or the Law Consequence bank. It sends
  `futureLaws` (Law card ids, public under rulebook p37) and `futureLawCount`. Debug option `{ omniscient: true }` is
  for the simulator and dev harness only. The Future Law display is shown in the City > Laws panel (ADP-08, fixed in audit 7).
- `answer()` is transactional: a rejected answer leaves the state unchanged (core.ts `snapshotState`).
- Steam Hub coal is a shared module (src/steamHub.ts). Its free step is also offered at the start of Dusk and Hunger
  (src/phases.ts prepends `steamHubStepOps`). Still not offered in Dawn, Morning, Weather or Preparation.
- Engine bug: the first Workshop now starts a Technology choice. buildings.ts pushed the nonexistent op `techStart`;
  the real op is `techStartCheck`. Test: tests/audit6_tech_start.test.ts.
- Grammar fixes (article and resource-name helpers `aAn` and `nRes` in src/util.ts).
- Server: `MAX_CONN_PER_IP` (default 20) closes the "no per-IP connection limit" item of wave 5. Caveat: with
  `TRUST_PROXY=1` the address is the first `X-Forwarded-For` entry, which a client can set itself. That weakens this
  soft limit; it does not protect against a determined client. `SHUTDOWN_GRACE_MS` (default 20000) replaces the
  hard-coded 5000 ms and is in `apps/server/.env.example` and `render.yaml`. The Supabase per-call timeout is 8000 ms
  (supabase-store.ts `DEFAULT_TIMEOUT_MS`), which closes the "no per-attempt timeout" item.
- Server co-op smoke test (apps/server/scripts/smoke.ts): join by code, drop and resume a seat, restart the server and
  check that the restored state has the same SHA-256 and the same open decision. Result: PASS.

### Remaining gaps (not fixed)

Scenarios and rules:
- Only Crater, Frozen Grove and Dreadnought are playable. The other scenarios are not in the supplied Scenario Book.
- The Generator tower is simulated digitally (per-cube probability of the drawer, checklist ADP-01).
- Steam Hub heat changes made inside a Dusk or Hunger event are only seen at the start of that phase. The Steam Hub
  step is not offered in Dawn, Morning, Weather or Preparation. Its printed timing is not verified against the cards
  (docs/DECISION_IDS.md).
- L18 printed face not verified (only the card back was rendered). C30 child use of a Gathering Post is uncapped
  (no printed source for a cap). L20 does not substitute for Hope removal (only for exhausting a Hope token).
- Event card texts for Dusk and Night (D003, D008-D011, D022, D023, D037, D062) are still only verified against the JSON.

Server and platform:
- The database migrations (`supabase/migrations/0001_init.sql`, `0002_service_role_grants.sql`) have run on PGlite
  (PostgreSQL 18 as WASM) but not on a hosted Supabase project; see "Closure pass". The smoke
  test uses an in-memory store and the Supabase adapter is tested with a fake client.
- A command write dropped after all retries leaves holes in `room.commands`; recovery would then end the game with an
  internal error (documented, not changed).
- SIGTERM handling is not exercised on Windows.
- Co-op seat token: stored per tab in sessionStorage. A localStorage fallback was being added at the time of writing;
  the code comment in RemoteController.ts still says localStorage, so check the code before relying on either.

Web client and UX:
- The public game log carries card ids, not card names.
- Frame time has not been measured on a visible GPU tab.
- The Society column is dense at small screen heights.
- Technology, expedition and storm decisions were checked in the browser only with crafted pending decisions; the
  engine simulations cover them.
- (Closed) The transient web typecheck failure in `map/scene.ts` was fixed; CI and the Vercel build command pass locally.

## Status of the last sim run

- 24 cells (3 scenarios x solo/co-op x extra pack on/off x smart/random bot), 60 games each: 1,440 games.
- Crashes: 0. Stuck states: 0. Invariant violations: 0 (after the fixes below).
- Wins: 0. Every game ends by Hope loss, Discontent overflow or Hunger between round 2 and round 6.
  Median length is round 3 (about 90 decisions).

## Wave 4 audit (rules fidelity)

Read-only audit of the engine against the rulebook, the Scenario Book and the card images (card text beats the
Scenario Book, which beats the Rulebook). Every finding below was raised by one slice auditor; "confirmed" means the
auditor proved it by reading code and/or a probe, or by comparing the card image with the data. The per-ID result is in
docs/RULES_CHECKLIST.md (confirmed findings mark the item [~] with the finding id).

| Slice | Raised | Confirmed | Rejected |
|-------|-------:|----------:|---------:|
| setup | 7 | 4 | 3 |
| rounds15 (Dawn, Morning, Generator, Weather) | 1 | 1 | 0 |
| actionCore (Preparation, Action core) | 2 | 2 | 0 |
| actionBuild (Construct, Use, Deploy, Citizen cards) | 6 | 5 | 1 |
| evening (Dusk, Hunger, Night) | 4 | 1 | 3 |
| hopeSick (Hope, Sickness, Death, lose) | 1 | 0 | 1 |
| lawsTech (Laws, Technologies, Automatons, Child Workers) | 6 | 6 | 0 |
| expeditions | 1 | 1 | 0 |
| buildings (map limits, buildings) | 2 | 2 | 0 |
| scenarios | 4 | 4 | 0 |
| players (solo, co-op, routing) | 5 | 5 | 0 |
| lua (TTS Lua and mod cross-check) | 6 | 6 | 0 |
| dataMorning (M001-M040) | 5 | 5 | 0 |
| dataDuskA (D000-D038) | 3 | 3 | 0 |
| dataDuskB (D039-D074) | 3 | 3 | 0 |
| dataCitizens (C01-C30) | 2 | 2 | 0 |
| dataLaws (L01-L20, consequences) | 10 | 9 | 1 |
| dataTech (technologies, advisors, generator) | 2 | 1 | 1 |
| dataExp (X01-X40, SD01-SD10) | 2 | 1 | 1 |
| dataBuild (buildings.json, map.json) | 3 | 3 | 0 |
| dataScn (S01-S09, W01-W13, society) | 1 | 0 | 1 |
| strategy (bots, win rate) | 2 | 1 | 1 |
| **Total** | **78** | **65** | **13** |

Confirmed findings by severity: 42 major, 23 minor (65 in total). The finding ids in the checklist notes are the keys.
Fixes were in progress when this section was written; the checklist notes read "fix pending/applied, see audit_*.test.ts".

Major findings (summary, id in brackets):

- Setup: Dreadnought starts with 8 Steel in the supply instead of the bank [setup-01, scenarios-02, lua-01].
- Advisors are dealt at random with no player choice; the co-op pool is ignored [setup-02, players-01, players-03].
- Call to Rise omits the "Otherwise" cure clause [actionCore-01]; solo Call to Rise is forced, not optional [players-02].
- Field Kitchen passive does not heat tile actions at heat 1 [actionCore-02].
- Engineer-only buildings block Worker/Child Citizen cards that list them [actionBuild-01].
- Cemetery grants Hope without the corpse move [actionBuild-02, lua-03, dataBuild-01].
- C10 Construct budget 2 instead of 3; C06 cuts budget to 1 [actionBuild-03, actionBuild-04].
- Child Worker/Engineer cannot act as Worker/Engineer [lawsTech-01]; L01 Gathering Post cap missing [lawsTech-02].
- L15 Public Council token choice never read [lawsTech-03, dataLaws-05]; L19 action not implemented [lawsTech-05, dataLaws-09].
- Coal Thumper draws from supply, not the bank [buildings-01].
- Frozen Grove action-tile rule not applied to Construct or Use a Building [scenarios-01]. (Closed: ACT-11 fix; SCN-02 audit 7 found it already applied, tests/audit7_fix_scn02.test.ts.)
- Steam Hub coal only in the Action-phase menu [scenarios-03, lua-02]. (Closed by the SCN-02 fix: free step at the start of Dawn, Morning, Weather, Preparation, Dusk, Hunger and Night.)
- Lua excludes three techs from the Frozen Grove display [lua-06].
- M016 child Meeple never placed; M028 counts every Worker/Engineer; M038 has no Wood cost [dataMorning-01..03].
- D012 Hunger branch sign and rounding; D030 build filters not implemented; D053 uses >= instead of = [dataDuskA-01, dataDuskA-02, dataDuskB-01].
- D000 untyped sickness uses the Round type instead of a player choice [dataDuskA-03].
- ~~D062 Engineer restriction not enforced [dataDuskB-02].~~ Closed (MOR-05 fix, tests/audit7_fix_mor05.test.ts): while D062 is on display, Engineers are refused at Engineer-only Buildings (buildings.ts usageProblem) and at other cards' Engineer event actions (actions.ts eventDisabled, specialKinds, actSpecial). Open detail: T15 Hothouse Engineer bonus is not treated as Engineer-specific.
- C22 Remove Snow base action missing; C20 4 Food cost not enforced [dataCitizens-01, dataCitizens-02].
- L02B paid upgrade coded as free [dataLaws-01]; L20 Hope swap and Care hunger (+1 instead of +2) [dataLaws-03, dataLaws-06].
- Law intro build (buildOnIntro) ignored [dataLaws-04]; L18 Generator use not implemented [dataLaws-07].
- SD04 Mistrust justice offers a choice instead of the printed rule [dataExp-01].
- Beacon has a red Dismantle icon but can be dismantled [dataBuild-02].

Minor findings are listed by id in docs/RULES_CHECKLIST.md (the "audit:" notes). Items the audit could not confirm
(for example the discard-routing for death cards, hopeSick-01, and the Hunger overshoot, evening-04) are not counted.

Strategy analyst (bots in packages/engine/scripts/bots/pro.ts, `sim.ts --pro`):

- 720 solo normal games (2 bots x 6 cells x 60 games; Crater, Frozen Grove, Dreadnought; seeds 1 and 2): 0 wins.
- Pro bot mean last round about 4.2-4.7; smart bot about 3.4-3.7.
- Loss causes (pro, 360 games): All Hope lost 297 (about 82%), Corpse track full 35, Discontent overflow 28.
- Winnability: NOT established. Zero wins in 720 games shows the bots cannot win; it does not show the game is
  unwinnable. The analyst's written conclusion was truncated in the audit input, so only the measured facts are kept
  here. The earlier explanation (economy, sickness, Coal runs out) is unverified and is replaced by the fact that Hope
  loss dominates.

## Open: coverage gaps caused by the early deaths

With 300 solo games (`--coverage`), these were never exercised:

- Technologies: 0 of 17 (T01-T17). Tech ops (`techNext`, `techPick`, `techStartCheck`) are only reached by surviving
  to round 4-6.
- Expeditions and Scouts: `deployScouts`, `expedition`, `expeditionBonus`, `scoutsReturnNoReward`, and the ops
  `expArrive`, `expMove`, `expSetup`, `expDeployMeeple`, `expFinishReturn`.
- Scenario cards S02, S03, S04, S05, S07 (5 of 9 never shown). S03/S07 Stockpile is only reachable with a card on
  display; custom `stockpile` is also unexercised.
- Late Dusk cards (38 of 75) and Morning cards M033-M040. Law consequences L03A, L13B, L14A, L17A-L20B.
- Upgrades and Steam Hub coal: `bldUpgradeDo`, `bldUpgradeCost`, `steamHubDo`, `steamHubPick`, `steamHubPlace`.
- Prison: custom `prisonStay`. Frozen Grove cemetery custom `cemetery`.

Run the sim longer (more rounds survive) or with a better bot to close these. Unit tests exercise several of them
directly (tests/scenario.test.ts, tests/expedition.test.ts, tests/laws.test.ts).

## Open: text verification of Dusk and Night events

Event card texts for the Dusk and Night events (D003, D008-D011, D022, D023, D037, D062, L06B in the event lists)
are not in the repo beyond the JSON effects. Timing lives in `src/night.ts` (`eventRunItems`) and
`src/fx/custom.ts` (`eventTimingFx`). The effects were audited against the JSON only, not against the printed cards.

## Closed (SCN-02, audit 7): Steam Hub coal as an anytime action

`act:steamHub` (src/actions.ts, `steamHubState`) is the Action-phase menu item. The free step (`ntSteamHub`, night.ts) is
now also asked at the start of Dawn, Morning, Weather, Preparation, Dusk, Hunger and Night (phases.ts `phaseBody`, Scenario
Book STEAM HUBS Passive: "At any time during the round"). Not in the Generator phase. Recorded in docs/DECISION_IDS.md.

## Audit 1 (buildings, actions, people, laws): fixes, rulings and open items

Fixed (tests: tests/audit_1_buildings_actions_people_laws.test.ts):
- Field Kitchen (and a lit Steam Hub) heats its own tile at Heat 1: `actionHeated` checks `tileForcedHeated` before the
  Heat-1 cut-off (src/actions.ts).
- Beacon has `noDismantle` (src/data/raw/buildings.json); `canDismantle` honours it.
- Upgrades are paid in Wood only: Steel does not replace Wood (`costPayable(..., allowSteel=false)`, `bldPay.noSteel`).
- Coal Thumper places Coal from the bank regardless of the bank's Coal stock; only the 5-Coal cap per space applies.
- Child workers and child engineers use their adult role (`roleOf`) in `normalAllowed`. Only plain `child` Meeples are
  blocked by the Citizen-card rule in `usageProblem`. Workers may use the Generator when `workersUseGenerator` is granted.
- constructUpgrade uses the default Construct budget (3, +1 with T08). Move Building rebuilds from a budget of 1 (+1 with T08).
- Law consequences: L01A `sickPerActedChildMeeple` (counts used child Meeples), L02B paid `upgradeBuilding:small`,
  L07B/L08B `flipSickness:any`, L20B `hunger-2` plus `hunger-2` per active Care.
- `upgradeBuilding` takes its size scope from its argument; `huntersHutOrHothouse` scope added.
- Citizen overflow (gain beyond the 50 cap) is the player's choice among types with room (`citizenOverflow`).
- Gain Sickness per corpse (D000) asks the player for each Sickness type (`sickAny`).

Open or needs a decision (not changed):
- L18 Generator permission: the covering passive `workersUseWorkshopsAndGenerator` grants the Generator, but the L18 law
  permission in laws.json does not list `workersUseGenerator`. Workers use the Generator only through the passive.
- Construct as an action (`isAction`) for Engineers is not modelled; the sub-action budget for those cards is default.
- Test harness: tests/audit_5_citizens_data.test.ts stubs `phAdvance` only when it is missing. phases.ts now defines it,
  so the stub is skipped and two of its cases (C22, C20) end with "stack ran dry". Owned by the phases/test owner.
- Frozen Grove connectivity for placement (M016) and the L01 Gathering Post cap of 3 children were not changed here.

## Fixed in this pass (kept for reference)

- Dreadnought start: `placeDreadTile` used `s.nextUid++`, so DN1 reused the platform's building uid (4).
  Now `++s.nextUid`, like `placeBuilding` (src/tiles.ts:304). Found by `board.buildingDup`.
- Invariant `board.buildingDup` falsely fired for buildings spanning several spaces. It now checks duplicate building
  entries only (src/invariants.ts).
- Scenario triggers fired one round early (Dawn start instead of end). Fixed in `scnPhase` (src/scenario.ts).
- Storm hits bypassed the token system. Now `stormHit:<card>` (src/phases.ts, src/fx/tokens_scenario.ts).
- Prison gave double sickness. `prisonStay` no longer adds sick (src/fx/tokens_build.ts).
- Child meeple passives (M022 `noChildMeeples`, `nightChildrenFirst`) were collected but unused. Now enforced
  (src/actions.ts, src/night.ts).

## Wave 5 (regression pass, fixes and open items)

Note (added in wave 6): the "Open" items of this section that wave 6 closed (C20 discard gate, buildOnIntro, M028,
unused tokens, L20 hopeTok typing, Steam Hub Dusk/Hunger, server per-IP limit and database timeout, the stale
ENGINE_SPEC note) are listed under "Closed in wave 6" at the top of this file. This section is kept as history.

Verification at the end of wave 5: `npm run typecheck` clean; engine `vitest` 586/586 (33 files); server `vitest`
88/88 (13 files); `scripts/scan_tokens.ts` 0 unknown heads.

Sim (90 games per cell, seed 21, all scenarios): 0 crashed, 0 stuck, 0 invariant violations in all four cells.
Wins 0 in every cell. Most games end in round 3 (smart bot) or round 4 (pro bot, median 136 decisions).

Closed in wave 5 (tests: tests/audit5_*.test.ts, apps/server/tests/audit5_*.test.ts):
- Citizen cards with an unpayable required Spend are not playable (C20, C23 blocked; C17 optional Spend stays playable)
  (src/actions.ts `citizenCostProblem`, `playableCards`, `actCitizenPick`).
- Construct as an action (`isAction`): T08 +1 sub-action only for the action; Engineer budget of 2 sub-actions with
  Upgrade costing 2 through `constructActionOpts` (src/buildings.ts). C10 Upgrade costs 2 sub-actions.
- L01 Gathering Post: a plain child use gathers up to 3 Resources, and the player picks the spaces when more are
  possible (src/buildings.ts `gatheringPostLimit`, `bldGatherAdj`, `bldGatherChosen`).
- D030 Hothouse: only Hothouses are buildable on that card (src/buildings.ts `buildFilterOk`).
- D043 A Tripod!: the Automaton is laid on the tile's first space and blocks both spaces
  (`scenarioState.blocked`, `spaceFreeFor`); Repair and Salvage free the spaces; the Engineer action on an unheated
  tile is cold (src/fx/custom.ts, src/actions.ts `d043TileHeated`).
- D032: destroying the last Workshop removes the Technology's active state (src/fx/custom.ts `destroyBuilding`).
- M016 Young Adepts places a Child Engineer or Child Worker from the supply; D031 swaps it with a Child.
- D053 counting checked and unchanged; M028 decision recorded (a Child Worker or Child Engineer is not a Child for
  Hunger; docs/CARD_TEXT_CUSTOM.md).
- L20 The Virtue of Humanity: the printed card (Hope token from the bag onto the Law; no +1 Hope), the Otherwise branch
  follows that token, substitution when an active Hope token of the type is exhausted (single, typed and bulk
  exhausts), and the Law Consequence swap (src/hope.ts, src/fx/tokens_people.ts).
- L18: the Workers' Workshop and Generator permissions match the printed L18 and L18A cards (no data change).
- Weather deck: all 13 cards in every scenario (rulebook set-up step 5; Scenario Book sets follow Crater). No change.
- Steam Hub coal: optional free Night step while Heat is above the red indicator (src/night.ts `ntSteamHub`). The
  Generator phase is deliberately not offered (the Coal would return to the bank in the same phase; docs/DECISION_IDS.md).
- Round limit: no cap added; the scenario finale (S04) ends the game with `victory` by Round 12.
- Server: a table the rules refuse returns `bad_request` with the rule text on start (`validateConfig`, src/rooms.ts).
  CORS_ORIGIN is validated at boot; SHUTDOWN_GRACE_MS (default 20000) replaces the hard-coded 5000 ms; the rate limit
  is a 20-refusals-in-10-seconds window, and binary frames take tokens (apps/server/src/util.ts `RefusalWindow`,
  src/server.ts). Restart determinism is covered with and without snapshots.

Open (with reasons):
- C20 option 2 (discard) is not gated on an active Discontent: the check belongs in `payable` (src/fx/tokens_supply.ts).
- L18 printed face is not verified (only the card back was rendered); the Engineer budget of 2 follows the data comments.
- C30 child use of a Gathering Post outside L01 is uncapped: no printed source for a cap was found.
- Build-at-intro for L02, L09, L10, L11 (`buildOnIntro` in data/laws.json is inert): the printed faces say "you may
  immediately build X by paying its cost", which contradicts ENGINE_SPEC sec 3. Needs a decision on the spec.
- Hope removal (discard or remove) is not substituted by L20: the printed text covers only exhausting a Hope token.
- M028: tokens_supply.ts `hungerPerMeeple` still counts Child Worker and Child Engineer. Test is `it.fails` in
  tests/audit5_cards_morning.test.ts; flip it to `it` when fixed.
- Unused registrations: `hopePerHunger` (tokens_supply.ts) and `childMeeple` (tokens_people.ts) have no card use.
- L20 hopeTok is not in `LawInPlay` (src/types.ts) and not shown in the UI.
- Steam Hub: no coal step in Dawn, Morning, Weather, Preparation, Dusk or Hunger; eligibility rule duplicated in
  night.ts (`steamHubFreeCandidates`) pending an export of `steamHubState` from actions.ts.
- The bots never win (see the sim line above), so the Victory branch is covered only by direct tests and by
  Round-10 and Round-11 starts.
- Docs stale: docs/ENGINE_SPEC.md line 105 (M031/M032 pack flag; morning_3.json has none), sec 3 buildOnIntro.
- Server: no per-IP connection limit (needs a decision on trusting proxy headers); no per-attempt timeout on database
  writes (a hung write stalls that game's queue until the transport times out; visible as persistPending in /health);
  a command write dropped after all retries leaves holes in room.commands, and recovery would then end the game with
  an internal error (documented, not changed); SIGTERM wiring is not exercised on Windows.
- Server config: apps/server/.env.example and render.yaml need SHUTDOWN_GRACE_MS, and the default must fit the Render
  SIGTERM-to-SIGKILL window. apps/server/src/engine.ts lines 2-4 describe a shim that no longer exists.

## Closure pass (end of session, 2026-10-11)

Checklist items were verified in a closure run. Fix passes followed for the confirmed gaps. The per-item result is in
docs/RULES_CHECKLIST.md (each note cites its evidence). Final checklist: 174 items, 152 done, 21 partial, 1 open
(PLT-06, not in the closure run). The engine vitest total last reported by the PLT-02 fix pass was 52 files and 769
tests, all passing. Server vitest 106 tests in 15 files, passing, unchanged since wave 6.

### Fixed in the closure pass (confirmed gaps)

- MOR-05: the D062 Engineer restriction is enforced (src/laws.ts `engineerSpecificBarred`; buildings.ts; actions.ts). Test: tests/audit7_fix_mor05.test.ts.
- GEN-08: cubes that fall out of the Generator when the drawer is inserted carry to the next Stress step (generator.ts,
  `s.gen.carry`, pDeferred 0.25 as a design choice). Seeded replays change. Test: tests/audit7_fix_gen08.test.ts.
- ACT-11 and FG1: Frozen Grove restriction (tiles connected to the Generator) applies to Construct and Use a Building
  (map.ts `spaceAllowed`). Test: tests/audit7_fix_act11.test.ts.
- ACT-CO3: a Beacon (red Dismantle icon) cannot be destroyed (buildings.ts bldDestroy). Test: tests/audit7_fix_actco3.test.ts.
  Open: which starting buildings carry the red icon is not confirmed against the art (see below).
- DEA-03: each holder of a matching Citizen card is asked in seat order; the first to discard wins, all passing draws
  (sickness.ts deathHold). Test: tests/audit7_fix_dea03.test.ts.
- SCN-02: the Steam Hub free step is also offered at the start of Dawn, Morning, Weather and Preparation. Not in the
  Generator phase. Test: tests/audit7_fix_scn02.test.ts.
- ADP-08: `futureLaws` (Law card ids) is in the player view and shown in the City > Laws panel. Test: tests/audit7_fix_adp08.test.ts.
- PLT-02 (partial): panel backdrops with board art and a face-down deck strip in the Event display. Test: tests/audit7_fix_plt02.test.ts.
- PLT-04 (migration portability): supabase/migrations/0002_service_role_grants.sql grants service_role table access
  (0001 relied on Supabase's default privileges). Found on PGlite (see below).

### Gaps confirmed but not fixed (declared deviations or open questions)

Declared deviations (not rules gaps):
- SET-12 / ADP-07: advisors are dealt from a shuffled pool; the lobby sets the table choice, not the seat order.

Open questions or real gaps left for a decision:
- MOR-03: Resources on a removed Event card leave play (the bank is outside the city). The fix pass judged the auditor
  wrong and made no change; tests/audit7_setup-dawn-morning.test.ts has an it.fails that asserts the opposite and must be rewritten.
- DUS-03: the red-X glyph meaning is unconfirmed; the claimed impact is not reachable with shipped data. No change.
- HUN-04: whether the overshoot past 25 is carried or dropped is a reading of an ambiguous rule. Carry is implemented.
- NIG-06: D008/D009 run before standing sickness; the rulebook order puts sickness last. Card text not yet read.
- WEA-01: an empty Weather deck is reshuffled from the discard. Rulebook silent; unreachable in the playable scenarios.
- ACT-CO3: the blanket start-building exclusion (buildings.ts:265) may be stricter than the rule for the Cookhouse and Platform.
- ACT-RS4: the "Foreman / E tile" Remove Snow effect named in the checklist was not identified; C08, C09, C21, C26 have no test.
- SCN-02: Remove Snow under Frozen Grove is not re-verified.
- ACT-SP1: Night removal of Meeples from special-action cards and usedEver for once-per-game event actions are not verified.
- PLT-02: 79 map tiles and most token images are unused; ExpeditionPanel reads s.decks.expA, which the co-op view omits
  (may throw; needs a browser check). No visual browser check was done.
- PLT-04: the migrations run on PGlite but not on a hosted Supabase project. See the PGlite section below.
- LAW-06 / LAW-07 / DUS-02 / UB8 / TEC-04: card-level and test coverage gaps listed in RULES_CHECKLIST.md.
- MAP-02 / BLD-01 / BLD-02: piece counts and Rim-deposit adjacency need a physical board check (small basic 43 vs 42 printed).

### Boosted late-game simulation (sim.ts --boost)

A new top-up mode (scripts/bots/boost.ts; `--boost` in scripts/sim.ts; `pickBy` exported from scripts/bots/pro.ts).
Before each decision and each engine op, the top-up keeps food, coal, wood, core, sickness, hunger, corpse,
discontent, hope and Generator heat and stress in range. The engine runs all cards, techs, expeditions, storms, laws
and scenario goals itself.

Result: 1440 of 1440 games reached "Survived the Storm" at S04 Round 12 (crater, frozenGrove and dreadnought; solo and
co-op 2 players; base and extra pack; seeds 1 and 2; 60 games per file, 24 files). 0 stuck, 0 crashed, 0 invariant
violations. Max round 12 in every game. No bugs were fixed by this run.

What this does and does not show:
- It shows the victory path (S04 Round 12) runs end to end when the economy is supplied. It is evidence that the late
  game is reachable in code.
- It does NOT show that the game is winnable in normal play. The top-up supplies the resources the bots fail to produce.
  The winnability statement in the "Winnability (honest statement)" section above still holds: unproven for a human, and
  the unboosted bots never win.

Not covered by the boosted runs (from the report):
- Dusk cards: about 45 per scenario were never drawn. D001-D004 need the M001 Theft choice "Expose" or "Keep secret",
  which the bot never picks. Dusk_3..6 sets need specific triggers.
- Morning M033-M040 only in extra-pack runs.
- Law consequences never hit: L01A/B, L03, L05, L07, L13, L14, L16-L17, L19. L18 and L20 are never introduced by the bot.
- Card-specific custom ids never hit: D007, D011, D016, D030, D031, D036, D053, D062, D067, D072, M004, M010, M016,
  M029, M038, duskPeek3, generatorSick:noFuel, prisonStay.
- Ops never hit: bldDestroy and bldDismantle variants, cureOne, cureApply, treatApply, sickAny2, sickOneType,
  phHungerDeaths, phL03, loseNoHope, and Steam Hub ops in crater and dreadnought (expected).
- Tokens never hit: workshop head (only from SD09/SD10 and citizen effects), activateDisc, removeTree/gatherTree,
  heatRange (S09 only), removeAllStress, clearSupply, corpseBack, devTokenOnRound, childMeeple, retrieveDuskDiscard.
- Dead code, not a rules bug: ops `expNoReward` (src/expedition.ts ~428) and `expSetup` (src/expedition.ts ~114) are
  registered but never pushed by any code or data. Left in place; removal is a separate cleanup.

### PGlite check of the Supabase SQL (not a hosted Supabase)

`supabase/tests/pglite_check.mjs` (run from apps/server: `npx tsx ../../supabase/tests/pglite_check.mjs`; see
supabase/tests/README.md). Engine: PostgreSQL 18.3 compiled to WASM through @electric-sql/pglite 0.5.8. This is a real
PostgreSQL engine, not a Supabase project, and Supabase runs its own PostgreSQL major version. Result: 50 of 50 checks
passed. Checks covered:
- Roles anon, authenticated and service_role with a stub auth schema. Migrations 0001 and 0002 apply in order and
  re-running them changes nothing. Seed is idempotent.
- Tables, primary keys, indexes, the games_read_finished policy, the append-only trigger on game_commands, and RLS on
  all four tables.
- Privileges: anon and authenticated have no table privileges on game tables (a column grant covers games summary
  columns). service_role has full table privileges.
- Constraints: 15 invalid games values rejected; NOT NULL; boundary seeds accepted.
- The real SupabaseStore class through a PostgREST-style adapter: create, retries, command order, paging across 1000
  rows, snapshots, reload with the exact config, finish, and an anon key refused.
- RLS as anon and authenticated: only finished games visible; other reads and writes refused (42501).

Problems the PGlite check found:
- Migration portability: without Supabase's default privileges, every server write failed with "permission denied for
  table games". Fixed by 0002_service_role_grants.sql.
- Store divergence (not changed; the test is outside the owner of this pass): SupabaseStore.appendCommand uses
  INSERT ... ON CONFLICT DO NOTHING, so a DIFFERENT command written to an occupied seq is silently dropped (the first
  write wins). MemoryStore throws "already stored with other data". Pinned by apps/server/tests/supabase-store.test.ts
  lines 42-48. Owner decision: make both throw, and update that test.
- Command log seq gaps are accepted by the schema and by SupabaseStore; MemoryStore throws "command seq gap". A dropped
  write leaves a gap, and the restore then fails and is logged.
- finishGame on a never-created game updates 0 rows and resolves silently (MemoryStore throws "unknown game"). Minor.
- docs/DEPLOYMENT.md said migrations are ordered by a timestamp prefix; they use numeric prefixes. Corrected.
- The statement that the migrations have never run on a real Postgres (above and in docs/PROGRESS.md) is out of date:
  they now run on PGlite. Supabase itself is still untested.

### Closure pass 2 (2026-10-12)

Final checklist: 174 items, 166 done, 8 partial, 0 open (details in docs/PROGRESS.md "Closure pass 2"). Engine vitest
940 tests in 64 files, server 106 in 15 files, all passing. Still true: unboosted bots never win, so winnability
under normal play is unproven; the SQL ran on PGlite (PostgreSQL 18) but never on hosted Supabase; only Crater,
Frozen Grove and Dreadnought are playable. Open question: T08 also adds a sub-action to Move Building
(fx/tokens_action.ts ~129), not verified against the card.

## Back to the action menu: house rule and limits (2026-10-12)

The rulebook has no take-back, so Back is a declared house rule. It lets a player look at what an action does before
committing, not undo a resolved action. Limits (all deliberate unless noted):

- Only the first decision of an action chain can go back (`docs/DECISION_IDS.md`). Later steps of a chain, later
  Construct sub-actions, and the Night, special, event, law and Stockpile decisions have no Back.
- Back is gone once anything hidden has changed since the action was picked: a drawn card, a shuffled deck, an
  expedition change or another seat's hand. This keeps a hidden card from being seen and then undone. An action that
  changes hidden state before its first decision has no Back.
- Not verified: a game that contains a back answer, restored from the server's snapshot and command log. The engine's
  replay test (`packages/engine/tests/back_to_actions.test.ts`) covers replay. The server smoke test does not use Back.

## Buildings: text and artwork in decisions; Remove Snow hex pick (2026-10-12)

- Building options (the Construct build list, Use, Dismantle, Upgrade, Destroy) show the building's artwork (56 px) and an
  effect line. The text is `BUILDING_TEXT` in `apps/web/src/data/buildingInfo.ts`: a paraphrase of the rulebook's building
  appendix (`docs/rules_text/5B9201D39C.clean.txt`, around lines 4190–4390) and of the Steam Hub text
  (`docs/rules_text/196D49D479.clean.txt`, around lines 194–206). The Vietnamese is `tools/i18n/ui/buildings.json`.
- No 2D artwork for Steam Hub or Dreadnought in the asset set, so both show the icon fallback. Their effect text still shows.
- Platform uses the yellow platform token (`token_platform`), not a tile face, because the asset set has no tile for it.
- Remove Snow: number keys do nothing for a tile-placement decision. The map answers it; the list appears only when the map cannot draw.
- Not verified in a browser: the map hover on Steam Hub or Dreadnought, and any Frozen Grove game. Verified: the Build list,
  the Use list, the map tooltip on a Charcoal Kiln, and a whole Remove Snow through the folded list. The map hover on
  hex (0, 2) was not checked; that hex was answered through the list.

