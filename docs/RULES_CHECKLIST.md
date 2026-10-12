# Frostpunk: The Board Game — Rules Checklist (web port)

Source of truth, in priority order: **card text → Scenario Book → Rulebook**.
Rulebook text: `docs/rules_text/5B9201D39C.clean.txt` (page refs `p#`). Scenario Book: `docs/rules_text/196D49D479.clean.txt`.
Card data: `packages/engine/src/data/raw/*.json` (see `docs/FX_DSL.md` for the effect language).

Status legend: `[ ]` not done · `[~]` implemented, not yet covered by a test (or partial) · `[x]` implemented + tested.
Every item has an ID so engine code / tests can reference it (`// R:HUN-03`).
"**Auto**" = the engine does it without asking; "**Ask**" = the engine raises a decision for a player.

Counts (closure pass, end of session 2026-10-11, as printed by `tools/gen_checklist_json.py`): 174 items, 1 open `[ ]`, 21 partial `[~]`, 152 done `[x]`. The web Rules overlay reads `apps/web/public/checklist.json`, which is regenerated from this file.

Closure pass: every item that was checked in the closure verification run carries its verdict and a short note citing the evidence. Items whose fix pass changed the engine say so in the note. Items not covered by that run keep their earlier status.

---

## A. Setup (p8-15)

- [x] SET-01 Scenario selection: Crater, Frozen Grove, Dreadnought playable. Others listed as *unavailable* (not in supplied Scenario Book pages). **Auto**
- [x] SET-02 Society card I–VI × Normal/Hard (+Survivalist extra) gives: Citizens [W,E,C], sick [W,E,C], Automatons, Discontent X/Y, Hope X/Y, Corpse start, Food, Wood, Coal, Steam Cores. **Auto**
- [x] SET-03 Generator tile in centre: Cookhouse on the top space, 5 Wood on UL, 5 Coal on UR, Generator & Platform printed on LR/LL (5 spaces; drawer hex is NOT a space).
- [x] SET-04 Rim: 7 Starting Wall tokens (3 blank, 2 Wood, 2 Coal) shuffled; from a chosen corner go clockwise placing tokens until 3 Deposits are placed; corners without a Deposit get a Far tile (face up) and a Near tile between it and the Generator tile. **Auto** (random start corner)
- [x] SET-05 Revealed setup tiles: place Trees/Resources from the bank; Food bonuses are added to starting Food.
- [x] SET-06 Meeples in supply from Citizen marker thresholds (0→0, 1-4→1, 5-9→2, 10-14→3, 15-19→4, 20-25→5, 26-32→6, 33-39→7, 40-50→8).
- [x] SET-07 Hope/Discontent bags (9 tokens each). Draw X, first Y active (leftmost), rest exhausted.
- [x] SET-08 Round marker 1; Morning deck shuffled (M001–M032 base game, 32 cards; M033–M040 added with the extra pack); Storm marker on 9 (Crater, stormCard S08). **Auto** *(closure: done. setup.ts createGame ~85-223; tests/audit7_setup-dawn-morning.test.ts 'SET-08'; text corrected to M001–M032 as the engine and rulebook use.)*
- [x] SET-09 Future Law display: L01–L08 + 4 random of L09–L16 (+extra pack L17–L20 optional); Law Consequence cards face down; law-specific buildings made available.
- [x] SET-10 Generator board: Heat marker (normal side) on 1, Cold on 5, Red/Orange/Yellow indicators on Generator track 1/2/3; Weather deck W01–W13 shuffled.
- [x] SET-11 Dusk board: D000 "The Inevitable" + top Social Dispute card shuffled (face down) form the Dusk deck; other Social Disputes stay in their pile (reading it = shown to players once).
- [~] SET-12 Advisors: each player chooses 1 (random if disagreement); solo also takes **Call to Rise**. Choice made in the lobby (ADP-07); in-game ask not implemented. *(closure: DECLARED adaptation ADP-07: advisors are chosen in the lobby; the in-game per-player choice and seat order are not implemented.)*
- [x] SET-13 Citizen deck shuffled; hand sizes: solo 7, 2p 6, 3p 5, 4p 4.
- [x] SET-14 Each player discards one Citizen card **paying its starting cost** (cannot pick a card whose cost can't be paid; if none payable: discard any, add 1 sick Citizen of the card's type). **Ask** *(closure: done. setup.ts:239-285; tests/audit7_setup-dawn-morning.test.ts 'SET-14'.)*
- [x] SET-15 Expedition decks A/B/C (white side up); 3 A cards start the 3 stacks. *(closure: done. setup.ts expeditions block; decks.expA holds only A cards; 'SET-15' test for crater, frozenGrove, dreadnought.)*
- [x] SET-16 Technology display: 4 random (T09 only in Frozen Grove, always shown there), each with an *inactive* Development token. *(closure: done. setup.ts techs ~177-185; T09 only in frozenGrove; 'SET-16' test seeds 1-8, three scenarios.)*
- [x] SET-17 Scenario cards: S01 face up, Scenario Trigger tokens on Round 4 and 11, Storm card S08 (S09 Frozen Grove) set aside face down. *(closure: done. Crater scenarioDisplay S01, triggers rounds 4 and 11, stormCard S08; Frozen Grove stormCard S09; 'SET-17' test.)*
- [x] SET-18 Leadership marker to a random player; game starts in the **Action Phase of Round 1** (phases 1-5 are skipped in Round 1).
- [x] SET-19 Hunger marker 0; Stress track empty; Heat marker normal side; no Laws. *(closure: done. newGameState: hunger 0, stress 0, overflow 0, broken false, heat 1, laws []; 'SET-19' test.)*

## B. Round structure (p16-29)

Order each Round: 1 Dawn · 2 Morning · 3 Generator · 4 Weather · 5 Preparation · 6 Action · 7 Dusk · 8 Hunger · 9 Night. **Round 1 starts at phase 6.**

### 1 Dawn (p19)
- [x] DAW-01 Pass Leadership clockwise (solo: no change). **Auto**
- [x] DAW-02 Round marker +1.
- [x] DAW-03 If the Round marker reaches the Development token: flip it active on the Technology card that has no token; **Ask** which inactive Technology to develop next (token placed `cost` spaces ahead, max 15). Tech is active for the rest of the game.
- [x] DAW-04 Scenario Trigger token on the Round marker's space: remove the token and resolve its Scenario card section (S01 Round 4 / Round 11, S04 Round 12 replaces the whole Round).
- [x] DAW-05 Dawn-phase text on face-up Scenario cards (S06 Vox Populi). *(closure: done. fireDawnTriggers (scenario.ts ~178-200) applies Discontent +1 each Dawn while S06 is face up; a repeated Dawn Discontent is a player choice, as the card text says; tests audit7_setup-dawn-morning.test.ts 'DAW-05'.)*
- [x] DAW-06 Storm marker on the Round marker's space is resolved in the Weather phase, not here. *(closure: done. phDawn leaves the Storm to phWxStorm (phases.ts ~203-206); 'DAW-06' test.)*

### 2 Morning (p19, p34)
- [x] MOR-01 Reveal top Morning card; resolve instant effect (`top`). **Auto** *(closure: done. cards.ts morningDraw ~89-94, cardResolve ~105-130; tests audit7 'MOR-01' and audit5_cards_morning.test.ts.)*
- [x] MOR-02 If options exist: **Ask** the group (Leadership decides) to pick an option; options with a red prerequisite (`req`) are only selectable when it holds. Cards with a `branch` auto-select the option.
- [x] MOR-03 After resolution: card is **removed** (back in the box; Resources on it → bank, Meeples on it → supply) or **placed in the Event display**. *(closure: done. Meeples return to the supply (cards.ts removeEventCard ~41-52). Resources on a removed card go to the bank, which is the stock outside the city supply, so they leave play and s.res is unchanged; tests/audit7_setup-dawn-morning.test.ts asserts both.)*
- [x] MOR-04 Adds the named Dusk card (`dusk:Dxxx`) to the Dusk deck unseen and shuffles. *(closure: done. M003 option 0 adds D005 to decks.dusk (not the display) and M003 is removed; 'MOR-04' test; audit_2_custom_fx.test.ts.)*
- [x] MOR-05 Event display: cards with an Action Phase special action (M004, M010, M015, M029, M038, D037, D043, D062), Dusk/Night phase text (D003, D008-D011, D022, D023, D037, D062), passive effects (M022, D062, D064). *(closure: fixed. D062 passive noEngineerSpecific is now enforced: engineerSpecificBarred in laws.ts, checked in buildings.ts usageProblem (Engineer-only buildings) and actions.ts (other cards' Engineer event actions). normalAllowed was deliberately not changed. Tests: audit7_fix_mor05.test.ts. Open detail: the T15 Hothouse Engineer bonus is not treated as Engineer-specific.)*
- [x] MOR-06 Morning deck empty → nothing is revealed. *(closure: done. cards.ts morningDraw ~89-94: no card, no decision, no log; 'MOR-06' test.)*

### 3 Generator (p20)
- [x] GEN-01 Optional fuel at the start: spend any Coal (supply→bank); Heat marker +1 per Coal; may reach the Cold marker but not beyond. **Ask**
- [x] GEN-02 Cold sickness: for each citizen icon on Heat-track spaces **strictly between** the Heat and Cold markers, +1 sick of that type (overflow flips the marker). (Start: Heat 1, Cold 5 ⇒ spaces 2,3,4 = Child+Worker+Engineer.)
- [x] GEN-03 Stress check: cubes dropped = value of the Heat marker's space ([2,2,3,3,4,4,4,5,5,6,6,7,7,8,8,9]). Digital tower: each cube independently lands in the drawer with p=0.55 (0.40 once the Generator Upgrade piece is placed); cubes land on the 10 Stress slots then the overflow. (House approximation of the physical tower.)
- [x] GEN-04 T06 Generator Safety: before the breakdown check, ≤2 cubes in overflow are removed without effect.
- [x] GEN-05 Overflow > 0 ⇒ breakdown. **First**: flip Heat marker overheated, Cold +1 & all three Heat Range indicators +1, return all Stress cubes. **Second** (already overheated): the Generator explodes → **LOSE**.
- [x] GEN-06 Heat marker returns to space 1 after the check (also after a breakdown).
- [x] GEN-07 Steam Hub coal (Frozen Grove) returns to the bank at the end of the Generator phase. *(Stress step returns it; tests/audit5_scenario_steamhub.test.ts)*
- [x] GEN-08 Cubes that fall out while *inserting* the drawer carry over to next round: each cube in the drawer after the drop falls out again with p=`pDeferred` (0.25, a design choice; the rulebook prints no value); the carry (`s.gen.carry`) is placed on the Stress track at the start of the next Generator Stress step. *(closure: fixed (audit7 fix pass). generator.ts genStress; the existing s.gen.carry field is reused; older saves load with 0; tests/audit7_fix_gen08.test.ts, 5 tests. The web HUD does not show the carried cubes.)*

### 4 Weather (p21)
- [~] WEA-01 Reveal & discard top Weather card. If the Weather deck is empty, the Weather discard pile is reshuffled into a new deck and the top card is revealed (engine: `phases.ts` `drawFrom`; the rulebook is silent on an empty deck); with both piles empty there is no effect. Unreachable in play: the deck holds 13 cards and every scenario ends by victory at S04 (Round 12), so at most 11 Weather Phases occur (`scenario.ts` `checkEnd` / S04 trigger). Tests: `audit_8_rules_checklist_docs.test.ts`. *(closure: DECLARED: reshuffle of an empty Weather deck is an interpretation (rulebook silent) and unreachable in the three playable scenarios.)*
- [x] WEA-02 (A) Advance Cold marker and Yellow/Orange/Red indicators by the card values, clamped to 16.
- [x] WEA-03 (B) Gain `hunt` Food per Hunting symbol (Hunter's Hut 1, upgraded 2; D064 event adds 1); T02 +1 Food per 2 symbols; T14 +1 Food per Map tile with a Food bonus.
- [x] WEA-04 (C) Advance every Scout by `scout` spaces (see EXP-xx).
- [x] WEA-05 (D) Storm marker moves back `storm` spaces; if on/before the Round marker a Storm hits: reveal the scenario Storm card (S08/S09). Crater: Round ≤7 flip all Tents to Ruins and Storm marker → 12; Round ≥8 flip Bunkhouses and remove the marker. Card text beats rulebook wording.
- [x] WEA-06 L16B (Survival of the Fittest) weather effect while covering its Law. *(closure: done. law_consequences.json L16B weather: each active Greed hunger+2, then coverToDiscard; laws.ts coverRuns; tech.ts weatherFxRuns; phases.ts phWxFx; test in audit7_gen-weather-prep-dusk-hunger-night.test.ts. The coverToDiscard handler (fx/tokens_cards.ts:75) is not asserted there.)*

### 5 Preparation (p22, p31)
- [x] PRE-01 **Ask** which Advisor (if any) is used this Round (Leadership has the final word; one per Round, same one may repeat). Use = exhaust the stated Hope (Generator: any Hope; Health: Care; Social: Justice; Foreman: Motivation).
- [x] PRE-02 Advisor effects: Generator remove ≤3 Stress; Health Cure 2; Social reveal 3 Dusk cards, may discard 1 (not a red-icon Social Dispute) w/o effect, shuffle other 2 back; Foreman place a tile as Remove Snow (Near else Far).
- [x] PRE-03 Solo: **Call to Rise** (once, independent of the Advisor, then removed): draw 1/2/3/4 Citizen cards if ≥1/2/4/6 Hope tokens. *(closure: done. phases.ts callToRiseRow (advisors.json callToRise.table) and phCallToRise (247-284): solo only, once, optional play or keep. No dedicated test found in this pass.)*
- [x] PRE-04 Check lose: ANY single Sickness marker on space ≥26 ⇒ **LOSE**.
- [x] PRE-05 Resolve each Sickness marker lowest→highest by band: 5-9 flip 1 · 10-14 spent 1 + flip 1 · 15-19 spent 2 + flip 2 · 20-25 spent 3 + flip 3 · 0-4 nothing.
- [x] PRE-06 Spent Citizen tokens of the matching type are placed in the supply; flips follow FLIP rules (SIC-xx). *(closure: done. sickness.ts addSpent (capped at 5 per type, 15 total) and sicknessResolve (183-203); tests in audit7_gen-weather-prep-dusk-hunger-night.test.ts.)*

### 6 Action (p22-27)
- [x] ACT-01 Start: adjust supply Meeples to the Citizen thresholds (Scouts count as in supply); place a supply Meeple of the matching type on each Spent Citizen token (those Meeples cannot act; if not enough Meeples the token stays empty). *(closure: done. actions.ts:402-432; audit7_action-a.test.ts ACT-01 (two tests). Scout-counting path not directly tested.)*
- [x] ACT-02 Turn order: Leadership holder first, clockwise, until Meeples run out or all players pass in a row. **Ask** (current player).
- [x] ACT-03 Free before an action: Fuel the Generator (no stress check). *(closure: done. Once per turn (rulebook p23): actions.ts:382, 473-478, flag cleared in actEnd and on pass; regressions.test.ts. The ENGINE_SPEC once-per-phase wording was the stale part.)*
- [x] ACT-04 Main actions with one available Meeple: Remove Snow, Gather Resources, Construct, Use a Building, Deploy Scouts, Special Action. *(closure: done. actions.ts:174-191, 258-277, 334-341, 375-391; actions.test.ts:70-92; audit7_action-a.test.ts ACT-04.)*
- [x] ACT-05 Child Meeples cannot take actions unless a Law/effect allows (L01 Child Labour: Gather + Gathering Post up to 3; T16 Cookhouse; M022 forbids). *(closure: done. normalAllowed and usageProblem; M022 path at actions.ts:179 and 230 (morning_2.json). The M022 path is code-read only, with no direct test. Child Worker/Engineer act as adult role via roleOf (util.ts:39-48).)*
- [x] ACT-06 Automaton acts as a Worker for 1 Coal per use; cannot go on Expeditions or fill Event cards that require a Worker/Engineer; T17 any building / free when Heat above Red. *(closure: done. actions.ts:78-82 (1 Coal; free with T17 above Red), 189 (no Deploy), 297-314 (no Event cards needing Worker/Engineer). The Event-card exclusion (eventDisabled) has no direct test.)*
- [x] ACT-07 Heated vs cold: Construct, Deploy Scouts, Special Actions always heated; Remove Snow always cold (T11: always heated); Gather and Use a Building heated iff Heat marker level is **strictly above** the matching indicator for the *tile zone* OR the *building insulation*. Heat marker on space 1 ⇒ all cold.
- [x] ACT-08 Cold action: before resolving, +1 sick Citizen of the acting Meeple's type (Automatons: none).
- [x] ACT-09 Zones: Red/A = Generator tile; Orange/B = Generator tile + adjacent tiles; Yellow/C = within 2 hexes. Insulation: R→Red indicator, O→Orange, Y→Yellow, B→zone only, W→irrelevant.
- [x] ACT-10 Field Kitchen: actions/buildings on its tile (and shelter at Night) count as heated. Steam Hub (Frozen Grove): holds 1 Coal ⇒ its tile and adjacent tiles heated. *(closure: done. map.ts:181-212 (tileForcedHeated, spaceHeated, buildingHeated); actions.ts:128-137; audit_1 test (Heat 1); audit7 Field Kitchen shelter tests; audit5_scenario_steamhub.test.ts.)*
- [x] ACT-11 Frozen Grove: actions allowed only on tiles adjacent/connected to the Generator tile. *(closure: fixed. spaceAllowed moved to map.ts (re-exported from actions.ts) and applied in buildings.ts placementOptions (Small and Large) and usageProblem ("Not connected to the Generator"). Heating and Dismantle/Destroy untouched. Tests: audit7_fix_act11.test.ts (6 tests); it.fails flipped to it in audit7_action-a.test.ts and audit7_scn-lose-players-digital.test.ts.)*

**Remove Snow (p25)**
- [x] ACT-RS1 Choose: two Near tiles (not necessarily adjacent) OR one Far tile (only one if one slot left). Repeatable.
- [x] ACT-RS2 Near tile adjacent to the Generator tile; Far tile adjacent to a tile connected to the Generator tile but never adjacent to the Generator tile.
- [x] ACT-RS3 Tiles drawn face down, then flipped; place Trees/Resources from the bank; gain Food bonus.
- [~] ACT-RS4 Citizen-card variants (C08, C09, C13, C21, C22, C26) and Foreman/E tile effects. *(closure: Citizen variants C08, C09, C13, C21, C22, C26 and the Foreman advisor checked against the images and tested (tests/audit8_group_rs4.test.ts). Still open: the "E tile effect" named by this item is not identifiable in the data or rulebook; C26 reorder outcome only checked as a prompt.)*

**Gather Resources (p25)**
- [x] ACT-GR1 Place Meeple on an unoccupied space with Coal/Wood/Steam Core; take up to 2 Resources from that space (T07: up to 3 from any spaces on that tile). Each space once per Round. Repeatable.
- [x] ACT-GR2 T04 Chainsaw / C04 Paolo: unoccupied space with Trees: remove 1 Tree, gain 2 Wood.
- [x] ACT-GR3 Space limit: ≤5 Resources of one type, ≤1 Building per space. Generator tile has 5 spaces.

**Construct (p26)**
- [x] ACT-CO1 Meeple on the Construction space; up to 3 sub-actions (Build/Dismantle) in any order (T08: 4). *(closure: done. Budget: buildings.ts:494-514 and startConstruct 471; C10 Upgrade costs 2 (tokens_action.ts:133-138); C06 move (tokens_action.ts:100-127) code-verified, no test. Tests: audit5_actions_spend_construct_gather.test.ts; audit5_repair_construct_gather.test.ts.)*
- [x] ACT-CO2 Build: pay Wood/Steam Cores (column cost) or law/event cost; building goes on a space without Meeple or Building; Resources/Trees there return to the bank; Large = both spaces of one tile; red Build icon (Ruins) cannot be built; Coal Mine/Wall Drill only on a tile adjacent to a Rim Deposit of that type; Field Kitchen not on the Generator tile; supply of pieces limited (see `limits`).
- [x] ACT-CO3 Dismantle: building with no Meeple returns to the Buildings board; a red Dismantle icon cannot (modelled as the printed starting pieces plus the Beacon; icon set not yet confirmed against the art); Ruins removed from the game; T08 +1 Wood. *(closure: Red Dismantle icon checked on the tile images: Cookhouse, Beacon, Snow Pit (field_kitchen_back); Snow Pit now has noDismantle. tests/audit8_group_actco3.test.ts.)*
- [x] ACT-CO4 Dreadnought: Steel substitutes for Wood (mixing allowed); paying the full Wood cost in Steel upgrades the new building free. *(closure: done. buildings.ts:83-90 (costPayable), 655-691 (bldPay, fullSteel upgrade), 769 (upgrades Wood-only); audit7_action-b.test.ts 'ACT-CO4' (3 cases).)*
- [x] ACT-CO5 First Workshop built ⇒ **Ask** which Technology to start; its Development token goes `cost` spaces ahead of the Round marker (max 15). Further Workshops don't add tokens. If all Workshops are gone the token returns (progress lost). *(Wave 6: the hook used the nonexistent op `techStart`; now `techStartCheck`, buildings.ts; tests/audit6_tech_start.test.ts)*

**Use a Building (p26, p39-44)** — one Meeple per Small, two per Large per Round.
- [x] ACT-UB1 Engineer-only buildings: Workshop, Platform, Generator, Factory, Medical Post, Infirmary, Temple, Propaganda Centre. *(closure: done. buildings.ts:372-379 (L18 Worker exception for Workshop and Generator; T17 Automaton); roleOf maps child engineers and workers; audit7_action-b.test.ts 'ACT-UB1'.)*
- [x] ACT-UB2 Cookhouse: spend 3 Food → +1 Hope or −1 Discontent. *(closure: done. buildings.json cost pay:food:3; bldUse buildings.ts:1031-1054; audit7 'ACT-UB2'. The two option contents are checked by count only.)*
- [x] ACT-UB3 Platform: introduce a Law (LAW-xx). *(closure: done. buildings.json action custom:introduceLaw; fx/tokens_law.ts:69 → laws.introduceLaw. The Platform path was not tested end to end.)*
- [x] ACT-UB4 Generator: remove ≤5 Stress cubes, or spend 1 Steam Core to remove all (first Core spent places the Generator Upgrade piece); T06 removes 1 more. *(closure: done. buildings.ts:329; fx/tokens_build.ts:81-85 (generatorUpgradeOnFirstCore); audit7 'ACT-UB4 / ACT-UB3'.)*
- [x] ACT-UB5 Workshop: two effects (may repeat): upgrade a building (cost from board; not with a Meeple on it) or move the Development token back 1 (develops immediately on reaching the Round marker). *(closure: done. Repeats allowed per rulebook p42; canUpgrade buildings.ts:244-249; laws.test.ts:118.)*
- [x] ACT-UB6 Charcoal Kiln (1 Wood→4 Coal / upg. 5; T03 Tree instead of Wood), Hunter's Hut (gain 4/5 Food), Gathering Post (take 1 Resource from each adjacent space), Factory (1 Core → Automaton), Sawmill (remove 1 Tree on the same tile (upg. also adjacent) → 3 Wood; T10 +1), Medical Post (Cure 3 / upg. Cure 4 or Treat 1; T05 Treat 2). *(closure: done. buildings.json matches the appendix; buildings.ts:319-328; coverage_tech.test.ts. Factory has no direct test.)*
- [x] ACT-UB7 Beacon: passive 1/2 Expeditions. Coal Thumper: 3 Coal on each of 3 (upg. 4) different adjacent spaces that hold Coal or are empty of Resources/Trees/Buildings (≤5 Coal per space; T13 +2 Coal). Infirmary: Cure 4 or Treat 2 (upg. 5/3). Hothouse: 7/9 Food (T15). Coal Mine 4/5 Coal; Wall Drill 3 Wood. *(closure: done. buildings.ts ~897-959 (Coal Thumper from the bank, 5-per-space cap); audit_1 'Coal Thumper places Coal independent of the bank stock'; values checked against pp43-44.)*
- [x] ACT-UB8 Law buildings: Child Shelter, Care House (Cure 2, or Cure 5 exhausting an active Care), Fighting Arena (−1 Disc), Public House (+1 Hope), Field Kitchen, Cemetery (corpse back 1-2 then +Hope), Temple (activate all Hope of one type), Faith Keepers (draw 3 Dusk, discard 1), Snow Pit (on build: corpse back 1-3), Propaganda Centre (reuse an occupied building, heated), Agitator (exhaust all active Discontent of one type), Prison (Hunger −4, Meeple sleeps there). *(closure: Temple, Agitator, Faith Keepers, Propaganda Centre tested (tests/audit8_group_ub8.test.ts); fixed Propaganda Centre offering itself for reuse (infinite loop). Reading note: engine allows any occupied building, rulebook says Citizen Meeple.)*
- [x] ACT-UB9 Dreadnought tile: Small Building, Blue insulation; Meeple placed there gains 1 Steel. *(closure: done. buildings.json dreadnoughtTile (gain:steel:1, count 4); util.ts:120-124; tiles.ts:306; audit7 'ACT-UB9'.)*
- [x] ACT-UB10 Upgrading flips the building; upgraded cannot upgrade further; diamond-marked buildings cannot be upgraded. *(closure: done. canUpgrade and upgradeCostOf buildings.ts:93-102, 244-249; buildings.test.ts:95-99.)*

**Deploy Scouts (p26, p35)**
- [x] ACT-DS1 Beacon required. A Worker/Engineer Meeple becomes a Scout on the first space of an unoccupied Expedition stack. Max active Expeditions: 1 (2 upgraded Beacon). T01 +1 space when deploying/continuing.
- [x] ACT-DS2 Citizen-card variants C03/C07 (bonus resources under the stack), C05 (replace stack with a B card). *(closure: done. citizens.json deployScouts / expeditionBonus; expedition.ts:131-160 (C05 offered only when the replacement can happen); audit7_action-b.test.ts 'ACT-DS2'.)*

**Special actions (p27)**
- [x] ACT-SP1 Scenario/Event card special actions; once per Round (some once per game); heated unless noted; Meeples on them are removed at Night, Resources on the card stay. *(closure: Night removal of Meeples from special-action cards, usedEver and once-per-Round tested through the real ops (tests/audit8_group_sp1.test.ts).)*
- [x] ACT-SP2 Stockpile (S03 3 slots / S07 6 slots): spend Food/Coal → Food Ration (3 Food) / Coal Stock (2 Coal) markers, total ≤ slots; Worker/Engineer only. *(closure: done. scenario.ts:382-440 (stockpileAction, scnStock, scnStockPick); scenarios.json S03/S07; scenario.test.ts 'Stockpile (ACT-SP2, custom:stockpile)' and menu tests.)*

**Citizen cards in the Action Phase (p32)**
- [x] ACT-CC1 Using a Meeple of the card's type on the card's action (and building where relevant) may play that card instead of the normal effect; one card per action, one per player per Round; card then goes to the discard pile. *(closure: done. playableCards blocks a second card per player per Round (actions.ts:229), card recorded at 565, playedCitizen cleared at each Round start (phases.ts:138). C20 and C23 cost gating in citizenCostProblem. Discard path actions.ts:845-847 read in the closure pass, not re-tested.)*
- [x] ACT-CC2 Death effects (columns per dead type) used when a Citizen dies (DEA-03). *(closure: done. sickness.ts:124-173 (deathCard, deathCard2, deathCard3); citizens.json death map.)*

### 7 Dusk (p27)
- [x] DUS-01 Resolve all "DUSK PHASE:" text on Scenario & Event-display cards first (any order). **Ask** order if >1. *(closure: done. phases.ts duskRuns / duskPick (295-318): Leadership holder is asked when more than one item is pending; a single item runs without a question.)*
- [x] DUS-02 Shuffle the Dusk deck, reveal the top card; instant effect; options (**Ask** with `req`); `branch` cards auto-select. *(closure: D012, D030, D053, D073 compared with the card images; behavioural tests in tests/audit8_group_cards_dusk.test.ts.)*
- [~] DUS-03 Card fate: removed / Event display / **Dusk discard pile** (default for cards without an icon). Red-icon cards (Social Disputes, some Law consequence) never go to the discard pile. *(closure: partial. The fix pass found the claimed gap not reachable with shipped data: the red X is on 12 of 40 Law consequence cards and on 38 of 39 Dusk cards, so it is not a clear "never discard" marker (meaning unconfirmed); every red-X Law card sets an explicit fate; no Dusk card uses the discard token. No code change.)*
- [x] DUS-04 Social Dispute: after resolving remove it, take the next Social Dispute card and shuffle it with the Dusk deck AND discard pile into a new deck (none left → no new one).
- [x] DUS-05 Dusk deck empty (and discard pile) → no card. *(closure: done. cards.ts drawDusk (84-101) reshuffles the discard into an empty deck and returns null when both piles are empty; rulebook p27 supports the reshuffle reading; audit7 tests.)*
- [x] DUS-06 Social Dispute behaviours (SD01-SD10) per `social_dispute.json` (most-common-token, hope vs discontent, no active discontent, all hope types). *(closure: done. social_dispute.json SD01-SD10 checked line by line against the card images (sheet 545_0); cards.ts socialResolve 270-330. Runtime helpers (takeMapRes coal fallback, buildFree:maxWood2) not individually traced.)*

### 8 Hunger (p28)
- [x] HUN-01 Spend Food to reduce Hunger as far as possible (1 Food = −1 Hunger). Auto, with L03 Food Additives optional at the start.
- [x] HUN-02 After spending: Hunger ≥25 ⇒ **LOSE**; 1-24 ⇒ apply table: 1-4 +1 Disc · 5-9 +1 Disc, 1 dies · 10-14 +1, 2 die · 15-19 +1, 3 die · 20-24 +1, 4 die. Deaths are of the type of the **previous** Round's column (Round 1: current Round). Hunger then resets to 0.
- [x] HUN-03 Feed: 1 Food per Citizen of the type of the current Round column (round r → (r−1)%3: 0 Child, 1 Engineer, 2 Worker). Each missing Food = +1 Hunger. L16 Starvation Rations: cost reduced by number of Meeples of that type.
- [~] HUN-04 Hunger reaching ≥25 here flips the marker to the 25+ side and restarts at 0; the loss is checked next Hunger phase (so effectively next phase's start value is ≥25 + carry). *(closure: DECLARED reading: rulebook says "flip the marker to the 25+ side and place it back at the start of the track"; the engine keeps the excess over 25 (flipped marker at position = excess), so the loss is checked next Hunger phase. The text does not state the excess explicitly.)*
- [x] HUN-05 Food max 50, Hunger max 50. *(closure: done. util.ts LIMITS; util.ts gainRes; fx/tokens_people.ts (Food cap 50); tokens_supply.ts Hunger clamp 0..50; invariants.ts; audit7 'gaining Food stops at 50'.)*

### 9 Night (p29)
- [x] NIG-01 Return Spent tokens that hold Meeples (Meeples back to supply); tokens without Meeples stay.
- [x] NIG-02 Return all Meeples placed this Round (map, supply board, Event cards) except Scouts.
- [x] NIG-03 Optional fuel (Generator).
- [x] NIG-04 Count sleeping slots in **heated** shelters (Tent/Bunkhouse/House 2 each; Ruins 0 unless L06; Child Shelter 4 Children; L05 +1 per heated shelter; T12 heated Medical Post/Infirmary 1 Engineer; Prison). **Ask** which Meeples sleep.
- [x] NIG-05 Every Meeple still standing (not Scouts, not Automatons): +1 sick Citizen of its type.
- [x] NIG-06 Night-phase text: L05A, L06A, L06B, D008-D011, D037. *(closure: D008/D009 print "At the end of the Night Phase": marked atEnd in dusk_1.json so they run after the standing-sickness step; D010/D011/D037 print no end timing and stay in the normal run. Tests in audit8_group_cards_dusk.test.ts.)*

## C. Hope & Discontent (p17-18)

- [x] HOP-01 Hope 6 spaces, Discontent 5 spaces (+ the 6th placement loses). Tokens slide left; exhausted/active sides.
- [x] HOP-02 Untyped **increase Hope/decrease Discontent**: choose to draw a random token from the bag and place it exhausted at the leftmost empty space, **or** activate an exhausted token. (Digital: automatic choice-free rule — draw if the track has room and the bag isn't empty, else activate; the player can choose when both are possible — **Ask**).
- [x] HOP-03 Typed increase (`hope+1:care`): draw a random token (any type), place it exhausted, then activate one exhausted token of the indicated type if possible.
- [x] HOP-04 Decrease Hope: exhaust an active token, or (if none active, or the effect says remove) remove an exhausted token to the bag and slide left. Last Hope removed ⇒ **LOSE**. "Must remove if no active token exists."
- [x] HOP-05 Activate / exhaust effects are ignored if impossible, unless exhausting is a cost.
- [x] HOP-06 Discontent increase: same rules for the Discontent track; a 6th Discontent placed ⇒ **LOSE**. Discontent decrease = exhaust an active token or discard an exhausted one.
- [x] HOP-07 "Spend" requires the full amount; "lose" takes what is available. *(closure: done. fx/core.ts (feasible, payable, ifPay, doSpendOr); fx/tokens_supply.ts (payable, spendTok); fx/tokens_people.ts 'lose' asks via supplyDist/askDistribute; 5 audit7 HOP-07 tests.)*
- [x] HOP-08 L15 Public Council: you choose the token when drawing. L20 Virtue effects. *(closure: done. hope.ts askChosenDraw (L15); audit_9_orphans.test.ts (L15); L20 virtue behaviour in audit5_virtue_virtue.test.ts.)*

## D. Sickness, Death, Cure (p30-31)

- [x] SIC-01 Sickness marker per type 0-50 with Syringe/Skull side; Citizen marker per type 0-50.
- [x] SIC-02 Gain sick (+1): marker +1; if that would exceed the Citizen marker, flip instead (Syringe→Skull = gravely ill, no effect; already Skull ⇒ nothing).
- [x] SIC-03 Flip Skull→Syringe: one Citizen of that type dies and the Sickness marker moves back 1.
- [x] SIC-04 If the Citizen marker drops below the Sickness marker, move the Sickness marker back.
- [x] SIC-05 Unspecified type = player's choice (**Ask**); "current" = type of the current Round column. *(closure: done. D000 gainSickPerCorpse maps to sickAny (fx/tokens_people.ts): the player picks the type for each corpse; audit7 SIC-05 test.)*
- [x] SIC-06 Cure N: move Sickness markers back (any type split) 1 per point; unused points lost. A Skull marker cannot be cured to 0 until Treated.
- [x] SIC-07 Treat N: flip Skull→Syringe **without** death per point.
- [x] DEA-01 Death: Corpse marker +1 (reaching the last Corpse space ⇒ **LOSE**), Citizen marker −1.
- [x] DEA-02 `noCards` death skips the Citizen-card draw.
- [x] DEA-03 Each death: draw a Citizen card and apply the dead type's death effect, or any player discards a matching-type card from hand instead. **Ask** (auto when no matching card). *(closure: fixed. sickness.ts deathHold asks each holder of a matching card in seat order from the leader; the first to discard goes on to deathCard2/3; if all pass, the top card is drawn; no matching card means no question. Tests: tests/audit7_fix_dea03.test.ts (5 tests); audit7 DEA-03 tests 1-3 still pass.)*
- [x] DEA-04 Citizens gained are capped at 50 per type, overflow becomes another type; Food max 50 (excess lost). *(closure: done. gainCitizens with 50 clamp and citizenOverflow askDistribute (fx/tokens_people.ts); LIMITS in util.ts; audit7 DEA-04 (4 tests); Food and Hunger caps covered.)*

## E. Laws (p37)

- [x] LAW-01 Platform action: **Ask** which Law from the Future Law display; max 4 Laws in total; Laws are permanent.
- [x] LAW-02 Take the Law's 2 Law Consequence cards; shuffle ONE AT RANDOM into the Dusk deck unseen; remove the other unseen (C11 Agnes may choose).
- [x] LAW-03 Apply the Law's introduction effect immediately; place Law in the Law display.
- [x] LAW-04 Starting pairs L01/L02 · L03/L04 · L05/L06 · L07/L08: introducing one removes its pair.
- [x] LAW-05 Unlocked buildings become buildable (cost on the Law/Event). L02 Child Shelter, L09 Care House, L10 Fighting Arena, L11 Public House: at introduction an optional immediate build, paid at its cost (`buildOnIntro`; decision `lawBuild` yes/no, ops `bldLawOffer`/`bldLawPick`, buildings.ts). *(Wave 6; dataLaws-04 closed; tests/audit6_laws.test.ts)*
- [x] LAW-06 Law consequence cards (40) resolve per `law_consequences.json`; cards with `coverLaw` cover the Law and replace its effect until they go to the discard pile. *(closure: 24 behavioural tests for L03A, L13B, L14A, L17A-L20B (tests/audit8_laws_cons_cards.test.ts); data matches the images.)*
- [x] LAW-07 Individual law passives: L01 child labour, L03 Food Additives (once/round at Hunger start: pay 2 Food → Hunger −10, +1 Greed), L04 heated meals (spend Food to heat), L05 +1 slot, L06 Ruins shelter, L07/L08 buildings, L12 Food→Cure, L13 Time to Rest, L14 Extended Shift, L15 Public Council, L16 Starvation Rations, L17-L20 (extra). *(closure: returnedMeeplesUsableThisRound (L17) was never read: now gates freeSupply via returnedMeeplesUsable (util.ts, Meeple.returnedRound). Tests in audit8_laws_cons_cards.test.ts.)*

## F. Technology (p38)

- [x] TEC-01 4 face-up Technology cards, each with an inactive token; first Workshop starts development of one (token `cost` spaces ahead of the Round marker, max 15). One development at a time.
- [x] TEC-02 Reaching the token (Dawn) or Workshop `devBack` develops it; then **Ask** for the next.
- [x] TEC-03 All Workshops dismantled/destroyed ⇒ in-progress token goes back inactive.
- [x] TEC-04 Passive modifiers T01-T17 per `technologies.json`. *(closure: done. Every modifier T01-T17 has a with/without behavioural probe (tests/audit8_tec04_t07_t11.test.ts, audit8_tec04_rest.test.ts); found and fixed: Steam Hub Coal was not returned to the bank in the Generator phase. Open question: T08 also adds a sub-action to Move Building, unverified against the card.)*

## G. Expeditions (p35-36)

- [x] EXP-01 Three stacks (A cards). Beacon needed to deploy; 1 active (2 with upgraded Beacon).
- [x] EXP-02 Scouts advance in the Weather phase by the card's value (T01 +1 on Deploy/Continue) up the stack's circular spaces; at the top the group must **Skip** (A/B cards only) or **Explore**.
- [x] EXP-03 Skip: draw a card from the next deck (A→B, B→C), overlay it, Scout goes to its first space; leftover movement continues on the new card.
- [x] EXP-04 Explore: card flips black; choose an option: **Continue** (take a B/C card, put the Scout on its first space, remaining movement lost, effects deferred) or **Return** (Scout back to supply, resolve the chosen option plus all deferred Continue effects of black cards in the stack).
- [x] EXP-05 Return `next`: "New A" ⇒ remove the stack, start a new A stack; "B"/"C" ⇒ flip all cards back white, overlay a new card of that letter.
- [x] EXP-06 C and Scenario expedition cards cannot be skipped. *(closure: done. expedition.ts expArriveChoice (266-282): skipOk false with the disabled reasons; doSkip enforces it. Tests: audit_6_cards_expeditions.test.ts; coverage_expedition.test.ts.)*
- [x] EXP-07 Citizen-card bonus resources under a stack are gained on return (C03/C07).
- [x] EXP-08 Scouts count as in supply for Meeple totals and are not returned at Night; they don't sleep.

## H. Buildings & map data (p39-44)

- [x] MAP-01 Hex axial board (see `map.json`), Near ring 2 (12 slots), Far ring 3 (18 slots), Generator flower with 5 spaces.
- [x] MAP-02 Adjacency: same tile; tiles sharing a straight edge; Generator-tile spaces adjacent to map-tile spaces whose tile shares an edge with that outer hex (0-2); Rim deposit adjacency. *(closure: Rim and Generator-tile adjacency checked against rulebook p40; map.json rim.adjacentFarTileOfCorner matches. Single-tile reading of the Rim example (no physical board to confirm).)*
- [x] MAP-03 Limits: ≤5 Resources of one type per space, ≤1 Building per space; Trees 30; Steel 8; Automatons 6; Citizens 50/type; Food 50; Hunger 50; Wood/Coal/Cores unlimited. *(closure: done. util.ts LIMITS; caps tested in tiles.test.ts (Trees), audit_0 (Steel), audit_2 and audit5_cards_dusk (Automatons), audit7 (Food, Hunger, Coal Thumper 5-per-space).)*
- [~] BLD-01 Catalogue in `buildings.json` (costs, upgrade costs, insulation, engineer-only, limits). *(closure: Build and upgrade costs match the board and rulebook; only the small-basic piece count (mod 43 vs printed 42) needs a physical count.)*
- [x] BLD-02 Shelter piece limits (House 10, Bunkhouse 8, Tent 4). *(closure: Limits House 10, Bunkhouse 8, Tent 4 equal the per-type counts of the TTS mod; the rulebook gives only totals.)*

## I. Scenarios (Scenario Book)

- [x] SCN-01 Crater: S01-S08 chain (Round 4 Beacon check, Round 11 S04/S03, Round 12 storm finale).
- [x] SCN-02 Frozen Grove: Generator at the bottom Rim corner, 8 Near tiles, S09 storm (relative Heat Range removals), Steam Hub / T09, Action Phase tile restriction. *(closure: Steam Hub timing matches the Scenario Book; FG1 Remove Snow/Construct/Use adjacency verified (tests/audit8_scn02_snow.test.ts). Declared: no Steam Hub Coal step in the Generator phase because Stress returns the Coal to the bank in that phase.)*
- [x] SCN-03 Dreadnought: Dreadnought tiles + Steel. *(closure: done. scenario.ts:23 DREADNOUGHT_STEEL 0 in the bank, capped at 8; tiles.ts:306, 344-358 (4 tiles at setup); scenario.test.ts:154; audit_0 setup-01; audit_9 scenarios-02/lua-01. The DN1 Use path is data-driven and has no direct use test.)*
- [x] SCN-04 S04 Round 12: lose half Food (round up), Scouts return no reward, Generator phase, Hunger +2 per Meeple & +5 Food per Food Ration, spend Food, Hunger table, Frostbite (12 sick each type −2 per Coal Stock; unsheltered Meeples +3), resolve Sickness, then **WIN** if alive.
- [x] SCN-05 Win condition and every lose condition below. *(closure: done. S04 Round 12 victory (card image I/04 reads "If you have survived: YOU ARE VICTORIOUS"). The extra Round-15 "Time ran out" lose is gone: checkEnd (scenario.ts:68) only returns the stored status. Test 'checkEnd reports only the stored status' in audit7_scn-lose-players-digital.test.ts.)*

## J. Lose conditions (p30)

- [x] LOS-01 Last Hope removed.
- [x] LOS-02 6th Discontent placed.
- [x] LOS-03 Generator breaks down a second time.
- [x] LOS-04 Any Sickness marker ≥26 at the Preparation check.
- [x] LOS-05 Hunger ≥25 after spending Food in the Hunger phase.
- [x] LOS-06 Corpse marker reaches the last Corpse space.
- [x] LOS-07 Scenario defeat (explicit card text). *(closure: done. The supplied Scenario Book has no defeat clause; card faces S01-S08 show none; the 'defeat' token (fx/tokens_scenario.ts:120) is used by no card. Caveat: the S09 storm card face was not imaged; its text is in the Scenario Book transcription, which has no defeat clause.)*

## K. Players, solo & co-op

- [x] PLY-01 1-4 seats; solo has Call to Rise and a 7-card hand; 2-4 players share one city, hands are private. *(closure: done. Hand sizes solo 7 / 2p 6 / 3p 5 / 4p 4 (advisors.json handSize, setup.ts handCount); solo Call to Rise is optional (phases.ts 247-284); the advisor pool comes from the lobby table and unchosen Advisors return to the box (setup.ts 209-212). The in-game Advisor choice is the declared deviation ADP-07.)*
- [x] PLY-02 Group decisions (events, laws, advisor, technologies) are made by the Leadership holder after table discussion; turn decisions by the active player. *(closure: done. The death-card discard is offered to every holder of a matching Citizen card in seat order (sickness.ts deathHold, after the fix pass). The earlier auditor's finding was stale. audit7_scn-lose-players-digital.test.ts 'PLY-02 / DEA-03' passes, including the non-leader holder.)*
- [x] PLY-03 Responsibility sheets only split bookkeeping — automated away.
- [x] PLY-04 Online co-op: authoritative server validates every action; deterministic engine; reconnect restores the full state; each seat has a private hand. *(closure: done. apps/server/tests persist.test.ts (8), e2e.test.ts (2), rooms.test.ts; 33/33 across the three files. Seat-private hands via view redaction (view.ts). The smoke test (apps/server/scripts/smoke.ts) was not re-run in this pass. Caveat in KNOWN_ISSUES: a dropped command write leaves holes in room.commands.)*
- [x] PLY-05 Undo only for pure UI selection (never after randomness is revealed).

## L. Digital adaptations (declared deviations)

| ID | Physical rule | Digital rule |
|----|---------------|--------------|
| ADP-01 | Physical drop-tower | Per-cube random landing probability (0.55 / 0.40 upgraded); seeded RNG |
| ADP-02 | "Free choice" of which token to draw | Random draw from the seeded bag; explicit choice where the rules give one |
| ADP-03 | Citizen-card hand play | Hands are per player; playable cards are offered on the matching action |
| ADP-04 | Responsibility sheets | Dropped |
| ADP-05 | Alternative Generator placement (Scenario Book p2) | Not implemented in v1 |
| ADP-06 | Scenarios not in the supplied Scenario Book | Listed as unavailable |
| ADP-07 | Advisor choice in set-up (p14: each player chooses 1; random if they cannot agree) | The choice is made in the lobby before the game (NewGame/Lobby pass `config.advisors`, one per seat); unchosen Advisors go to the box. With no choice given, the engine assigns at random (the disagreement fallback). No in-game set-up ask. |

- [x] ADP-08 Hidden information in the player view: `view(s, seat)` sends `futureLaws` (the Law card ids of the Future Law display, public under rulebook p37 "look through the Law cards at any time") and `futureLawCount`; no deck order, no Law Consequence bank, no RNG. The Future Law display is shown in the City > Laws panel. Debug option `{ omniscient: true }` is for the simulator and dev harness only. *(closure: fixed (audit7 fix pass). view.ts sends futureLaws; server redactView keeps it; LawsPanel.tsx shows the undrawn Law cards; the Law Consequence bank stays hidden. Tests: audit6_core.test.ts (updated), audit7_fix_adp08.test.ts (7 tests); apps/web/public/checklist.json regenerated. Browser visual check of the panel not done.)*

## M. Platform / delivery

- [x] PLT-01 Monorepo: `packages/engine`, `apps/web`, `apps/server`, `supabase/`. *(closure: done. Root package.json workspaces ["packages/*","apps/*"]; all four folders present; audit7_platform.test.ts 'plt-01'.)*
- [~] PLT-02 Desktop-first Frostpunk-style UI (hex map, boards, card panels with real art, animations, audio). *(closure: partial. Done: card faces, society tokens, 14 GLB models, Tweens, ambient mp3 and procedural SFX (earlier pass). Fix pass: panel backdrops with board art (GeneratorBoard board_generator, SocietyBoard board_panel_b, picked by eye) and a face-down deck strip in EventDisplay (family backs; no backs for expedition decks, since their cards have unique backs). Not done: the 79 map tiles and most token images are unused. Open: in co-op the view omits decks, so ExpeditionPanel s.decks.expA (hud/ExpeditionPanel.tsx:31) may throw; needs a browser check. No visual browser check done. Tests: audit7_fix_plt02.test.ts (5 source scans).)*
- [x] PLT-03 Solo (local, offline, deterministic) and co-op (server rooms). *(closure: done. LocalController runs the engine in the browser with no network calls; autosave in localStorage (controller/persistence.ts); setup.test.ts:231 replay test; server rooms and e2e tests pass (106 server tests). KNOWN_ISSUES notes the seat fallback as "being added", which the code (persistence.ts:15, 224-249) now has.)*
- [~] PLT-04 Supabase schema (games, players, snapshots, action log) + migrations + RLS. *(closure: partial. Checked on PostgreSQL 18.3 running as WASM (PGlite 0.5.8), 50 of 50 checks: migrations 0001 and 0002 applied, constraints, append-only trigger, RLS and grants, and the real SupabaseStore class through a PostgREST-style adapter. Fix pass added supabase/migrations/0002_service_role_grants.sql (service_role grants). Not run on a hosted Supabase project. The store's conflicting-command behaviour differs from MemoryStore (pinned by supabase-store.test.ts), an owner decision.)*
- [x] PLT-05 Render service (`render.yaml`), Vercel (`vercel.json`), `.env.example`, README. *(closure: done. README deploy step 3 now lists only VITE_SERVER_URL; render.yaml, vercel.json, root, server and web .env.example files agree with docs/DEPLOYMENT.md; SHUTDOWN_GRACE_MS is in apps/server/.env.example and render.yaml.)*
- [x] PLT-06 3D models converted to GLB; images → WebP; audio copied. *(closure: done. apps/web/public/assets: 14 GLB models, 250 card + 55 token + 79 tile + 13 board WebP images, 1 mp3, 2 PDFs; `python -I tools/optimize_assets.py --verify` reports every GLB valid and 0 missing manifest paths. The models were converted from the TTS .obj files by the project's own converter, the Blender MCP was not needed. Sources are byte-identical copies (docs/ASSETS.md Provenance).)*
