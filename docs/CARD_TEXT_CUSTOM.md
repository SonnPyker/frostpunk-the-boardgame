# Card text for `custom:` handlers (transcribed from the card images)

The JSON data has no text for these cards. This file is the source of truth for `fx/custom.ts`.
Card text > Scenario Book > Rulebook.

## Morning event cards (eventAction.custom)
* **M004 Comfort the Sick** – opt1: +1 Care, add D007 to Dusk deck, Event display. Action (Worker|Engineer, once/Round): each time you perform it, take 1+ Wood and/or Coal from the supply and place it on this card. opt2: +1 Discontent, remove.
* **M010 Another Settlement** – opt1: Event display, add D019 to Dusk. Action (Worker|Engineer, once per GAME, only if Beacon is built): take 3+ Resources from the supply and place on this card. opt2: -1 Hope, add D020, remove.
* **M015 A New Project** – opt1: Event display. Action (Engineer, once/Round): each time you perform it take 1 Wood from supply onto this card. Dusk phase: if NO Engineer meeple on this card: +1 Apathy. If 2 Wood on this card: add D030 to the Dusk deck. opt2: +1 Discontent, remove. **Per-Dusk repeat:** the Dusk-phase text is checked at EVERY Dusk phase for as long as M015 is in the Event display (phases.ts runs `eventRunItems(s,'dusk')` each Dusk; `eventTimingFx` adds `custom:M015:dusk`). A Dusk with no Engineer on the card gives +1 Apathy again; each Dusk with exactly 2 Wood adds D030 again.
* **M016 Young Adepts** – opt1 (send engineers): place this card in the Event display; place 1 Child Engineer Meeple on this card; place 1 Spent Engineer token in the supply; add D031 to the Dusk deck. opt2 (send workers): the same with a Child Worker Meeple and a Spent Worker token. opt3: -1 Hope, remove. JSON: `custom:M016:engineer` / `custom:M016:worker` (fx/custom.ts). The Child is taken from the supply and placed on the card (the card holds it until D031 or removal). Frozen Grove: the Child is not placed on a Map tile, so the connectivity rule (scenario book p.5, Map-tile Actions only) does not apply; no placement filter. With no Child in the supply nothing is placed.
* **M029 Wooden Toys** – opt1: Event display, add D053. Action (Worker|Engineer, once/Round): each time take 1+ Wood from supply onto this card. opt2: +1 Discontent, remove. opt3: +1 Apathy, gain 2 Wood, remove.
* **M038 Child's Play** (extra) – opt1: Event display. Action (Worker, once/Round): to perform it you must spend 1 Wood. Dusk phase: if a Worker meeple is on this card: add D070 to the Dusk deck; otherwise +1 Apathy. opt2: add D071 to Dusk deck.

## Dusk cards with custom handlers
* **D005 Have we found them?** – If you have a Scout on any Expedition card go to 1 else 2.
  1: Place 2 Wood below an active Expedition; gain the 2 Wood when the Scout returns from it. If you have active Justice: exhaust 1 Discontent. (remove)
  2: Activate Apathy. +1 Anger. (remove)
* **D007 Did you stay true to your word?** – If there are no Resources on M004 go to 1 else 2.
  1: +1 Greed. Exhaust all Hope. Remove M004 from the game. (remove card)
  2: For each Sickness marker above 4: remove 1 Resource from M004 or -1 Hope. If all Resources were removed from M004: -1 Hope. Place all Resources on M004 into the bank. Remove M004. (remove card)
* **D010 The Comfort of Warmth** – Event display. NIGHT: for each Shelter and each citizen meeple without a warm place to sleep, lose 1 Wood or 1 Coal. If you lost the full amount: discard 1 Discontent token (remove card). Otherwise: for each Resource you could not lose: -1 Hope (remove card).
* **D011 Warmth for Those in Need** – Event display. NIGHT: if any citizen meeples without a warm place to sleep go to 1 else 2.
  1: Count citizen meeples without warm sleep. Spend that many Wood/Coal (any combination). If you do: +1 Hope. If you cannot: +1 Greed. For each active Greed lose 1 Resource. (remove)
  2: Spend ceil(Shelters/2) Wood/Coal. If you do +1 Hope, if cannot +1 Greed. For each active Greed lose 1 Resource. (remove)
* **D016 Consensus** – Exhaust all Discontent of one type or -1 Discontent.
* **D030 Successful Project** – Choose one: A) Build a Hothouse for free. B) Upgrade a Hunter's Hut or Hothouse for free, even if used this Round.
* **D031 Successful Education** – Swap 1 of your Child meeples with the Child Worker/Engineer meeple on M016. That meeple counts as a Child in all respects except it may be used to perform an action as if a Worker/Engineer (as appropriate). Remove M016.
* **D032 Explosion of the Distillery** – Choose a Building with an Engineer meeple on it, or any Shelter. Destroy it. 1 Engineer dies.
* **D036 Unworthy Successor** – Activate Greed or Apathy. If you could not: +1 Discontent.
* **D037 Epidemic** – Exhaust Care. Event display (action Engineer once/Round). DUSK: if an Engineer meeple is on this card: remove it from the game. NIGHT: gain 3 sick Citizens of the current Round's type.
* **D043 A Tripod!** – +1 Anger. Choose a Far tile; destroy all Buildings on it and place all its Resources and Trees into the bank. Lay an Automaton ON THE TILE, covering both spaces; you may not Build on these spaces until the Automaton is removed. The card is in the Event display. ACTION PHASE (as an action): place an Engineer onto one of these Automaton spaces. Check the tile's heating as normal. Repair: spend 1 Steam Core, Automaton to the supply. Salvage: gain 1 Steam Core, Automaton to the bank. Either way the card leaves the display. If the bank has no Automaton, take one from the supply (rulebook, Automatons).
  Implementation: the Automaton is a meeple on the tile's first space (`loc space`), NOT on the card, and not in `ev.meeples`; the tile key is in `ev.extra.tile`; both spaces are in `s.scenarioState.blocked`. A Far tile with a covering Automaton is not offered again. Open (not in this file's owner's code): Construct must refuse blocked spaces; the Engineer action is run by the generic event-action code (it places the Engineer on the card and runs with heating ignored), not on the Automaton space with the heating check.
* **D053 What About the Toys?** – If there is no Wood on M029 go to 1 else 2.
  1: -1 Hope. Activate all Greed. Remove M029. (remove)
  2: If there is as much Wood on M029 as there are Child Meeples: +2 Hope. Otherwise: +1 Hope. (Count = equal, not >=.) "Child Meeples" = every Child-type meeple you have: supply, board, Event cards and Scouts, and Child Worker / Child Engineer too (they count as Children in all respects). Spent Child tokens are not meeples. In either case bank the Resources on M029 and remove M029. (remove)
* **D062 Engineers' Strike** (extra) – opt1: Event display. Engineers may not be used on Engineer-specific actions except the one on this card. Action (Engineer, once/Round): to perform it you must spend 5 Food. DUSK: if an Engineer meeple on this card: remove this card from the game. opt2: +1 Anger, +1 Discontent.
* **D067 Results of the Survey** (extra) – Activate all Hope of one type or +1 Hope.
* **D072 Point of No Return** (extra) – opt1: +2 Discontent. opt2: Activate Apathy or exhaust Care. 1 Worker dies.

## Other texts seen
* L08A Neophytes and Sceptics: if all Discontent exhausted: may exhaust all Hope of one type; per token: Justice -1 Discontent, Motivation take 1 Resource from the Map, Care gain 4 Food. Otherwise per type of active Discontent in order Greed: spend 2 Resources (if cannot +1 Discontent); Apathy: place 1 Spent Worker/Engineer token in supply; Anger: gain 3 sick Citizens.
* L15A Elevated above others: all Discontent active -> +1 Discontent, shuffle back into Dusk; otherwise +1 Justice, activate all Discontent of most common type.

## Counting decisions (fixer "cards")
* **M028 Criticising the Leaders** (opt2, JSON token `hungerPerMeeple:workerEngineer:1`, not a custom handler): "+1 Care. Increase Hunger by 1 for each Worker and Engineer Meeple in the supply." Count only Worker and Engineer Meeples in the supply. A Child Worker / Child Engineer is a Child (D031 text: "counts as a Child in all respects"), so it is NOT counted. Engine status (wave 6, fixed): `fx/tokens_supply.ts` `hungerPerMeeple` counts only Meeples of kind `worker` or `engineer` whose location is the supply. Child Worker and Child Engineer are not counted. Test: `tests/audit5_cards_morning.test.ts` ("a Child Worker in the supply adds no Hunger"; the earlier `it.fails` was flipped).
* **M031 Winter Has Come / M032 The Quack from the Burrow**: base game (inside the 32-card Morning deck). `morning_3.json` flags only M033-M040 `pack:'extra'`, and `ENGINE_SPEC.md` (sec 3, "Scenario and card set") states the same. Resolved: the earlier note that ENGINE_SPEC was stale is withdrawn.
* **C20 Pauline Grogan, option 2** ("discard 1 active Discontent token"): legal only while a Discontent token is active (wave 6, `fx/tokens_supply.ts` `payable`, the check beside the unpayable-Spend check). Test: `tests/audit6_supply.test.ts`.
* **D053**: see the entry above. Child Meeples are counted on every location (supply, board, Event cards, Scouts) plus Child Worker / Child Engineer.
* **hopePerHunger** (+1 Hope per 5 Hunger) is not printed on any card that is used. Removed in wave 6 from `fx/tokens_supply.ts` (describe and supply). **childMeeple** (a token registration in `fx/tokens_people.ts`) is still registered but no card uses it.
