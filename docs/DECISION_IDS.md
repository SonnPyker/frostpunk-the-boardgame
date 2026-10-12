# Decision ids and kinds (ACTIONS module)

Each `ask` / `askDistribute` raised by `packages/engine/src/actions.ts` and `packages/engine/src/fx/tokens_action.ts`
uses the kind and option-id convention below. `then` is the op that receives `pick` after `answerPending`.
An option with exactly one legal choice is resolved by the engine without a pause (core.ask), so a UI should never
expect a decision of these kinds to appear when only one option is enabled.

| kind          | option ids                                     | data / hint                                  | raised by                        | then (receives pick)     |
|---------------|------------------------------------------------|----------------------------------------------|----------------------------------|--------------------------|
| `action`      | `act:fuel`, `act:removeSnow`, `act:gather`, `act:construct`, `act:use`, `act:deploy`, `act:pass`, `act:special:ev<uid>`, `act:special:law<lawId>` | `data.kind` = menu kind (fuel, main, special, pass); `disabled` = reason | `actTurn` (Action phase, current seat) | `actPick` |
| `meeple`      | `m:<meepleId>`, one representative per kind (lowest free id) | `data.kind` = MeepleKind | `actMeeple` (main action or special) | `actMeeplePick` |
| `citizen`     | Citizen card id (e.g. `C04`) or `normal`        | card act in `data.act`                       | `actCitizen`                     | `actCitizenPick`         |
| `space`       | space id (e.g. `N01:top`)                      | hint: resources and trees on the space       | `actGatherSpace`                 | `actGatherDo`            |
| `gatherRes`   | `<spaceId>\|<wood\|coal\|core>` (distribute)    | `cap` = stock of that resource on the space  | `actGatherDo`, `actAdjTake`      | `actGatherApply`         |
| `building`    | `b:<buildingUid>`                              | hint: space label                            | `actUse`                         | `actUseDo`               |
| `adjacentSpace` | space id                                     | adjacent spaces with Resources only          | `actAdjPick` (gatherAdjacentSpace) | `actAdjTake`           |
| `moveBuilding`| `b:<buildingUid>`                              | small, non-printed, dismantlable only        | `actMoveBuild` (constructMoveSmallBuilding) | `actMoveDo`        |
| `reuseBuilding` | `b:<buildingUid>`                            | hint: space with a Meeple on it              | `actReuseBuild` (reuseBuilding)  | `actReuseDo`             |
| `reuseWorker` | `m:<meepleId>` (Workers that already acted)    | hint: location kind                          | `actReuseWorker` (reuseWorker)   | `actReuseWorkerDo`       |
| `steamHub`    | `b:<buildingUid>` (Steam Hubs without Coal)    | label `Steam Hub #<uid>`; only offered when Heat > red level and Coal >= 1 | `steamHubDo` (menu item `act:steamHub`, free); `ntSteamHub` (Night, night.ts, options `b:<uid>` + `done`) | `steamHubPick` then `steamHubPlace` (spends 1 Coal, sets `steamHubCoal`); `ntSteamHubPick` then `steamHubPlace` (Night) |
| `stockpile`   | `ration` (3 Food), `coal` (2 Coal), `done`     | prompt shows markers used / slots            | `stockpileAction` (scenario card S03/S07, custom `stockpile`; also menu item `act:special:stock<card>`) | `scnStockPick` |
| `lawBuild`    | `yes`, `no`                                    | optional immediate build of a law's building (L02 Child Shelter, L09 Care House, L10 Fighting Arena, L11 Public House); prompt names the law; the leader answers | `bldLawOffer` (buildings.ts, queued by `introduceLaw` in laws.ts when the law has `buildOnIntro`; skipped when the building is not unlocked, cannot be placed or cannot be paid) | `bldLawPick` (`yes` queues a normal paid `bldBuildKind` with `only` = that building; `no` does nothing) |
| `removeSnow`  | `near2` (place two Near tiles), `far1` (place one Far tile) | `disabled` = no tile of that kind can be placed; `back` offered | `tilRemoveSnow` (tiles.ts, variant `normal`; from `removeSnowAction`, i.e. the Remove Snow action and the `removeSnow` token) | `tilSnowPick` (queues two `tilPlace` near, or one `tilPlace` far) |
| `tileKind`    | `near`, `far`                                  | prompt "Place a Near tile or a Far tile?"; only when both kinds can be placed | `tilPlaceMode` with mode `nearOrFar` (tiles.ts; the `placeTile:nearOrFar` token) | `tilKindPick` (queues `tilPlace` of that kind) |
| `tileSlot`    | `q,r` of each empty legal hex (Near: next to the Generator; Far: next to a connected tile) | the map highlights these hexes and a click answers (`App` `onPickOption`, one pick). The map reports the hex as `hex:q,r` (map/pick.ts). The panel shows a status line and no list (the rows are kept for the keyboard, hidden until focus enters them); when the map cannot draw (`useUi` mapDown) the list is shown under "No map? Pick from a list"; number keys do nothing here (see "Map-only kinds" below) | `tilPlace` (tiles.ts; the prompt names Near or Far) | `tilSlotPick` (takes the tile from the stack and reveals it at the hex when the answer arrives) |
| `drawFar3`    | `'0'`, `'1'`, `'2'` (position from the top of the Far stack; the tiles are face down) | prompt: draw 3, place one, the other two go on the top or bottom | `tilDraw3` (tiles.ts; Georgia Taller C08, `removeSnow:drawFar3ChooseOne`) | `tilDraw3Pick` (queues `tilPlace` of the chosen tile, then `tilOrderRest`) |
| `farOrder`    | `top`, `bottom` (one tile left); `TT`, `BB`, `TB`, `BT` (two tiles left: upper and lower) | the face-down tiles are not named | `tilOrderRest` (tiles.ts) | `tilOrderPick` (returns the tiles to the top or bottom of the Far stack) |
| `farReorder`  | `top`, `bottom`                                | prompt names the revealed Far tile (revealed, so its id is shown) | `tilReorderStep` (tiles.ts, after `tilReveal3`; the `revealFar3AndReorder` token, C26) | `tilReorderPick` (asks again for each remaining tile) |

Notes:
- Map-only kinds: `tileSlot`, `space`, `adjacentSpace` and `treePick` (`MAP_ANSWER_KINDS` in `apps/web/src/decisions/DecisionPanel.tsx`).
  When every option resolves on the map (`resolvePickId`) and the map can draw, the panel shows the status line, the
  disabled options with their reasons, and the rows for the keyboard only (no number badges). Digits do not answer these kinds. Click
  answers through `onPickOption`; a building or Meeple standing on a highlighted space does not block the click (scene.ts
  `pickCandidates`). `buildSpace` keeps its list: a Large building highlights one of its two spaces only.
- `gatherRes` count: 2 normally, 3 with T07 (any space on the same tile). Distribute caps follow the stock of each resource.
- `kind: 'distribute'` (the core default) is not used by this module; `gatherRes` is always passed explicitly.
- Automaton coal is paid in `actResolve` before the effect; it is not a decision.
- Deploy Scouts (`act:deploy`) raises no `meeple` decision here; the scout is chosen by the expedition module.
- Fuel (`act:fuel`) runs `fuelAsk` from generator.ts, which owns its own kind and ids.
- Steam Hub coal (Frozen Grove) is offered at these points of the round (decision of the scenario fixer, audit 5):
  1. Action phase: the free menu item `act:steamHub` in every turn menu (as before).
  2. Night, after the Night's Fuel step and before the sleeping is decided: `ntSteamHub` (night.ts) asks `steamHub` with
     options `b:<uid>` per empty Steam Hub plus `done`; after each Coal it is asked again. The Coal heats its tile and
     adjacent tiles for the sleep. It is then returned at the next Generator phase (genStress).
  3. Generator phase: NOT offered. Scenario Book (STEAM HUBS Passive): "Return the Coal to the bank at the end of the
     Generator Phase". A Coal placed before the Stress step is returned in the same phase with no effect; after the Stress
     step Heat is reset to 1, so the "Heat above the red level" condition cannot hold there.
  4. Dusk and Hunger (wave 6): `steamHubStepOps` (night.ts) is prepended to the Dusk and Hunger phase drivers
     (phases.ts). The same free step as the Night one. Eligibility is checked when the phase starts only: a Heat change
     caused by a Dusk or Hunger event during that phase is not seen by this step.
  5. Dawn, Morning, Weather and Preparation (SCN-02 fix, audit 7): `steamHubStepOps` is prepended to these phase
     bodies in phases.ts (`phaseBody`), so the step is asked first in each. Scenario Book (STEAM HUBS Passive): "At any
     time during the round". Eligibility is the same everywhere: Heat above the red indicator, a Steam Hub without Coal,
     1 Coal in the supply. Tests: tests/audit5_scenario_steamhub.test.ts, tests/audit7_fix_scn02.test.ts.
- Stockpile (`act:special:stock<card>`) is listed for S03/S07 cards that are on the Scenario display; `stockDisabled`
  gives the reason (Already used this Round, Stockpile full, Not enough Food or Coal, no free Worker or Engineer).
- The tile rows (`removeSnow` to `farReorder`) are raised by `tiles.ts`, not by the ACTIONS module. Face-down tiles never
  appear as options: `tileSlot` asks for the hex first, and the tile leaves the stack only when the answer arrives.
  The Remove Snow `removeSnow` decision is offered only for variant `normal`.

## Back to the action menu (`back`)

A decision with `back: true` on its `Pending` lets the player return to the action menu its chain began from. The UI
shows "Back to actions" and answers with the pick `['back']` (`BACK_PICK` in core.ts, exported from the engine). The menu
comes back exactly as it was. Nothing from that action is kept, and the id and log counters keep counting up.

- `ask` and `askDistribute` set `back` only when the spec has `back: true` and `backAvailable(s)` holds: a back point
  exists, it was taken in the same round and phase, and nothing hidden has changed since (`hiddenFingerprint` covers rng,
  decks, stacks, expeditions, nextExp, futureLaws, lawConsequenceBank, scenarioState and the other seats' hands).
- The back point is set when an `action` pick is answered (`answerPending`). It is cleared at `actTurn`, `actEnd` and
  `actClose` (actions.ts).
- Offered on the first decision of an action chain: the meeple, citizen card, building, gather space and Steam Hub coal
  asks (actions.ts), Fuel (`fuelAsk`, generator.ts), Deploy Scout and expedition Stack (expedition.ts), Remove Snow
  (`tilRemoveSnow`, tiles.ts), and the decisions of the first Construct sub-action (buildings.ts, `first` flag).
- Not offered on: later Construct sub-actions, the Night Steam Hub step, special, event, law and Stockpile decisions, or
  anything outside the Action phase.
- A `['back']` answer where `back` is not set is a normal unknown-option error. If the back point is no longer valid,
  `goBackToActions` returns `no going back from here`.
- Views: `PendingView.back` is set only for the seat that may answer. `backPoint` is removed from every view (view.ts).
