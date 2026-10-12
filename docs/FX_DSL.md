# FX DSL — the card-effect language

All card data in `packages/engine/src/data/raw/*.json` encodes effects as JSON using this language.
The interpreter lives in `packages/engine/src/fx/`. **Every token that appears in the data must have a handler**
(`npm test -w packages/engine` fails if the data contains an unknown token — see `tests/data-coverage.test.ts`).

An **effect list** is an array of *items*. Items execute left to right. An item is a **string token** or an **object form**.
A token that needs a decision raises a `pending` for the responsible player and the rest of the list waits
(the list is stored as plain data on the engine's continuation stack, so the whole game state stays serialisable).

Notation: `N` integer, `<t>` one of the listed values, `[x]` optional, `a|b` alternatives (literal `|` inside a token = player picks).

## 1. Citizens, sickness, death

| Token | Meaning |
|-------|---------|
| `gain:worker\|engineer\|child:N` | Citizen marker +N (cap 50 per type; excess spills into another type of the player's choice) |
| `gain:automaton:N` | Automaton to the supply from the bank (limit 6) |
| `sick:<type>:N` | +N sick Citizens of that type. `<type>` = `worker\|engineer\|child` · `any` (player chooses per sick) · `anyOneType` (player picks one type, all N go there) · `current` (type of the current Round column). Overflow flips the marker (SIC-02) |
| `sickPerChildMeeple[:child:N]` | +N sick (default 1) for each Child Meeple (supply + board) of that type |
| `sickAll:12:minus2PerCoalStock` | Scenario S04: +12 sick of EACH type minus 2 per Coal Stock marker |
| `gainSickPerCorpse` | D000: +1 sick Citizen of the current type per Corpse marker space ≥ 1 |
| `die:<type>:N[:noCards]` | N Citizens die (SIC death rules). `any`/`current`/`workerOrEngineer` resolved like `sick`. `noCards` skips drawing Citizen cards |
| `lose:worker\|engineer\|child:N` | N Citizens leave the city: Citizen marker −N, **no corpse, no card** |
| `lose:res:N` | Lose N Resources (Wood/Coal/Steam Core) from the supply — player chooses which if mixed |
| `lose:food:N` | Food −N (not below 0) |
| `spent:<type>:N` | Place N Spent Citizen tokens of that type in the supply (`workerEngineer` = player chooses per token) |
| `removeSpentUnoccupied:1` | Return 1 Spent token that has no Meeple on it to the bank |
| `returnSpentCitizenTokens:upTo2` | Return up to 2 Spent tokens, Meeples freed immediately |
| `cure:N[:oneType]` | Cure N (move Sickness markers back 1 per point; split freely unless `oneType`) |
| `cure:perChildMeeple` | Cure 1 per Child Meeple |
| `treat:N` | Treat N (flip Skull→Syringe with no death) |
| `cureOrTreat:a[:b]` | Choose: Cure `a` OR Treat `b` (b defaults to `a`) |
| `flipSickness:toSkull\|toSyringe\|any:N\|all` | Flip N (or all) Sickness markers. `toSkull` = Syringe→Skull, `toSyringe` = Skull→Syringe **with death** |
| `flipSicknessType:<type>` | Flip that type's Sickness marker once |
| `coldSick:<type>:N` | Citizen-card variant: when the action was cold, the cold-sickness is N instead of 1 |
| `childMeeple:worker\|engineer` | A Child Meeple becomes a Child-Worker / Child-Engineer Meeple (acts as Worker/Engineer, counts as Child). **No card uses it any more**: M016 uses `custom:M016:worker\|engineer`, which also places the Child on the card. The token stays registered in `fx/tokens_people.ts`. |
| `spentPerSkull` | One Spent token for each Sickness marker on its Skull side |

## 2. Hope and Discontent

| Token | Meaning |
|-------|---------|
| `hope+N[:type]` | Increase Hope N times. Untyped: choose draw (new exhausted token) or activate an exhausted one. Typed: draw a token, then activate an exhausted token of that type if possible. `care\|justice` = either type (ask) |
| `hope-N` | Decrease Hope N times (exhaust an active token, or remove an exhausted one; must remove if none active; last Hope removed ⇒ lose) |
| `disc+N[:type]` / `disc-N` | Same for Discontent; 6th Discontent placed ⇒ lose |
| `disc-discard:N[:active]` | Remove N Discontent tokens from the track to the bag (`active` = only active ones) |
| `discardHope:1` | Remove 1 Hope token from the track to the bag (chosen) |
| `activate:<hopeType\|discType>[:all]` | Activate one (`all` = every) exhausted token of that type |
| `activate:hope\|disc[:allOfType\|:oneOfEachType\|:mostCommon:all]` | Generic activation (player picks the type for `allOfType`) |
| `activateHope:N` / `activateDisc:N` / `activateDisc:allOfType` | Activate N exhausted tokens (player picks) |
| `exhaust:<type>[:all]` | Exhaust one (`all`) active token of that type (cost forms: if impossible the effect/requirement fails) |
| `exhaust:hope\|disc:N\|allOfType\|oneOfEachType` | Generic exhaust |
| `exhaustHope:1\|all\|allOfType` | Exhaust Hope tokens |
| `exhaustAll:hope` | S03: exhaust every active Hope token |
| `exhaustHopeActive:1:apply` | L20: exhaust an active Hope, and apply its Virtue effect |
| `exhaustHopeOrDisc` | Exhaust one active Hope **or** one active Discontent (player picks) |
| `drawHope:activate` | Draw 1 Hope token from the bag and place it **active** |
| `virtueEffect` / `virtueHopeFromBag` / `virtueHopeSubstitute` | L20 mechanics (see `law_consequences.json`) |

## 3. Supplies and map resources

| Token | Meaning |
|-------|---------|
| `gain:wood\|coal\|core\|steel\|food:N[:perFoodRation]` | Add to supply (Food capped at 50, Steel at 8) |
| `pay:<res>:N` | **Cost** inside building actions: pay from the supply (inside a `choose` option it makes the option conditional on being payable) |
| `spend:<res>:N`, `spend:2res`, `spend:3res\|6food` | Cost in card `start`/`req`: spend; `Nres` = any N Wood/Coal/Steam Core |
| `payFoodOrHunger:N` | Spend N Food; each missing Food = +1 Hunger |
| `loseResOrHunger:A:B` | Lose A Resources; for each you can't lose, +B Hunger |
| `hunger+N` / `hunger-N` | Hunger marker ±N (0..50) |
| `hunger+N:perCitizenMeeple` | S04 |
| `hungerPerMeeple:workerEngineer:N` | +N Hunger per Worker/Engineer Meeple in the supply (M028). Child Worker/Engineer are NOT counted (implemented in wave 6 in `fx/tokens_supply.ts`; see docs/CARD_TEXT_CUSTOM.md) |
| `gainFoodRound` | Gain Food equal to the Round number |
| `takeMapRes:N[:plusPerActive<Type>]` | Take N Resources from the map (player picks spaces) into the supply; for each you cannot take, gain 1 Coal |
| `mapRemove:coal\|wood:N` | **Start-card cost:** remove N such Resources from map spaces (player picks) |
| `removeMapRes:N:coalWood:bank` | Remove N Coal/Wood from the map to the bank |
| `stress+N` / `removeStress:N\|upTo:N\|all` / `removeAllStress` | Generator Stress cubes |
| `toCard:supply:N` | Move N Resources from the supply onto the current Event card |
| `cardResToSupply:Mxxx` / `cardResOneToSupplyRestBank:Mxxx` / `cardResToBank:Mxxx` | Resources lying on an Event card |
| `clearSupply` | All Resources (not Food) in the supply to the bank |

## 4. Cards, decks and phases

| Token | Meaning |
|-------|---------|
| `dusk:Dxxx` | Add that Dusk card to the Dusk deck unseen and shuffle |
| `event` | Place the current card in the Event display (stop auto-removal) |
| `remove` | Remove the current card from the game (Resources → bank, Meeples → supply) |
| `removeCard:Mxxx\|Dxxx` | Remove a card of that id from the Event display |
| `shuffleBack` | Put the current Dusk card back into the Dusk deck and shuffle |
| `discard` | Put the current Dusk card on the Dusk discard pile |
| `coverToDiscard` | Law-cover consequence goes to the Dusk discard pile and uncovers its Law |
| `stop` | Stop executing the current effect list |
| `retrieveDuskDiscard:1[:plusPerActiveJustice]` | Return card(s) from the Dusk discard pile to the deck and shuffle |
| `custom:ID` | Hand-written handler in `packages/engine/src/fx/custom.ts` (see §9) |

## 5. Control forms (objects)

| Form | Meaning |
|------|---------|
| `{"choose":[[...],[...]]}` | The responsible player picks one list. Options containing a `pay:`/`ifPay` that can't be paid, or a `req`, are disabled. Auto when only one is legal |
| `{"if":COND,"then":[...],"else":[...]}` | Conditional (see §8) |
| `{"ifPay":COST,"then":[...],"else":[...]}` | Optional payment. **Ask** whether to pay if possible; `then` if paid, otherwise `else` |
| `{"each":COND,"fx":[...]}` | Run `fx` once per unit of a counter (`active:greed` = number of active Greed tokens, `unsheltered`, `spentCitizenInSupply`, ...) |
| `{"times":N,"fx":[...]}` | Repeat |
| `{"perActiveHope":{"order":[...],"<type>":[...]}}` | For every type in `order` with active Hope tokens run its list once per active token |
| `{"perActiveDisc":{...}}` | Same for Discontent |
| `{"activateAllDiscOfType":{"greed":[...],...}}` | Law consequences: the player picks one Discontent type present on the track; its list runs |
| `{"exhaustAllHopeOfType":{...}}` | Same for Hope |
| `{"spendOr":{"food":2},"else":[...]}` | Dusk event upkeep: spend 2 Food or run `else` |
| `{"custom":"ID"}` | See §9 |

## 6. Building / action tokens

| Token | Meaning |
|-------|---------|
| `gatherAdjacent:1` | Gathering Post: take 1 Resource from each adjacent space |
| `thump:SPACES:EACH` | Coal Thumper |
| `removeTree:tile\|tileOrAdjacent` | Remove a Tree on the building's tile / or adjacent spaces (fails the action when none) |
| `gatherTree:wood:2` / `gatherTreeWood:2` | Gather with Trees instead of resources |
| `upgradeBuilding` / `upgradeFree:small\|any[:ignoreUsed]` | Upgrade a building (paying its cost / free) |
| `buildFree:wood1\|maxWood2\|upgradedMedicalPost` | Build a building for free (constraints) |
| `devBack:N` / `devToken-1` / `devTokenBack:N` / `devTokenOnRound` | Technology development token |
| `workshop:N` / `workshopEffects:N` | N Workshop effects |
| `corpseBack:min-max` | Corpse marker back |
| `removeSnow:*` / `placeTile:nearElseFar\|nearOrFar\|far` / `revealFar3AndReorder` | Map tile placement variants |
| `deployScouts:normal\|replaceWithB`, `expeditionBonus:wood\|coal:N` | Expedition citizen-cards |
| `reuseBuilding[:occupied:heated]` / `reuseWorker` | Re-use an action (Ask which) |
| `destroyBuilding:choose\|occupied[:N]` | Destroy building(s) (not red-Dismantle ones) |
| `buildingNormal`, `buildingCureEffect` | Citizen cards: perform the building's normal / cure effect |
| `cookhouseTiers:a:b:c:d:e:f` | Pay a Food → Hunger −b etc. |
| `constructSubactions:N`, `constructUpgrade:2subactions`, `constructMoveSmallBuilding:2subactions`, `constructOverRuins:woodDiscount:1` | Construct variants |
| `heated` | The action counts as heated |
| `platform:chooseConsequence` | Choose which Law Consequence goes into the Dusk deck |
| `gatherFoodAdjacent`, `gatheringPostOrAdjacent:3` | Citizen-card gather variants |

## 7. Scenario tokens

`scenario:place:<id>` · `scenario:resolve:<id>` · `scenario:remove:<id>` · `trigger:<round>` · `expedition:place:<id>` ·
`loseHalfFood` · `scoutsReturnNoReward` · `victory` · `defeat` · `goto:A|B` ·
`phase:generator|hungerSpend|hungerResolve|sicknessResolve` · `shelters:allHeated` · `nightSleep:sick3PerUnsheltered` ·
`flip:tent|bunkhouse:ruins` · `stormMarker:set:N|remove` ·
`heatRange:remove:<red|orange|yellow>` · `heatRange:advance:<cold|red|orange|yellow>:N` · `custom:stockpile`.

## 8. Conditions

Strings (prefix `!` negates). Parameter after `:`.

`beaconBuilt` · `revealed:<scenarioId>` · `round<=N` · `round>=N` · `round:odd` · `active:<type>` (an active token of that type) ·
`built:<buildingId>` · `hunger>=N` · `hunger==0` · `hunger<=food` · `supplyRes<2` · `noActiveHope` · `noActiveDisc` ·
`allDiscActive` · `activeDisc>=N` · `activeHope>=N` · `hopeTokens>=N` · `mostCommonDisc` (branch map) ·
`anySicknessSkull` · `anyCitizenUnsheltered` · `allCitizensWarm` · `allCitizensWarmNoRuins` · `allSleepWarm` · `moreHalfSleepWarm` ·
`allTechsDeveloped` · `devTokenOnRound` · `hasScout` · `engineerOnCard` · `cardHasRes:Mxxx` · `cardNoRes:Mxxx`.

## 9. Custom handlers (`custom:ID`)

`introduceLaw`, `generatorUpgradeOnFirstCore`, `cemetery`, `duskPeek3`, `prisonStay`, `socialAdvisor`, `stockpile`,
`M004`, `M010`, `M015`, `M016`, `M029`, `M038`, `D005`, `D007`, `D010`, `D011`, `D016`, `D030`, `D031`, `D032`, `D036`, `D037`,
`D043`, `D053`, `D062`, `D067`, `D072`, `generatorSick:noFuel`.

Arguments: `custom:M016:engineer` / `custom:M016:worker` (Child becomes Child Engineer / Child Worker, placed on M016);
`custom:M015:dusk` (Dusk hook, also added by `eventTimingFx`). The D043 Automaton is on the tile: its space is in
`s.scenarioState.blocked` (the Build code must refuse those spaces; see docs/CARD_TEXT_CUSTOM.md).

Custom handlers are documented next to their implementation. If a handler cannot decide something automatically it raises an
explicit decision — it never silently skips an effect.

## 10. Card JSON shapes

* **Morning / Dusk card**: `{id,title,top?,opts[],branch?,eventAction?,eventDusk?,eventNight?,eventPassive?,pile?}`
  `top` = instant effects; `opts[]` = `{label,req?,fx}`; `branch` = `{if,then,else}` or `{if:"mostCommonDisc",map}` selecting option 1/2/3 automatically.
* **Citizen card**: `{id,name,type,start[],act,buildings[],fx[],death{worker,engineer,child}}`.
* **Law**: `{id,intro[],unlock[],perm{},pairedWith}`. **Law consequence**: `{id,law,top|night|weather|passive,coverLaw?}`.
* **Technology**: `{id,cost,mod[],weather[],generator[]}`.
* **Expedition**: `{id,letter,steps,options[{kind:return\|continue,next,fx}]}`.
