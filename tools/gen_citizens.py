"""Generates packages/engine/src/data/raw/citizens.json (30 Citizen cards, deck 541) from a compact transcription table."""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'packages', 'engine', 'src', 'data', 'raw', 'citizens.json')


def d(w, e, c):
    """death columns (worker, engineer, child): each (pre-effect or None, hope loss)."""
    def col(s, loss):
        return ([s] if s else []) + ['hope-%d' % loss]
    return {'worker': col(*w), 'engineer': col(*e), 'child': col(*c)}


N = None
rows = [
 # id, name, type, start-cost fx, act, buildings, text, fx, death
 ('C01', 'Matilda Oakwood', 'worker', ['spend:coal:1'], 'useBuilding', ['medicalPost', 'infirmary'], 'Cure 3 of one type of Citizen.', ['cure:3:oneType'], d((N, 1), ('exhaust:care', 1), ('exhaust:motivation', 2))),
 ('C02', 'Olivia Carebear', 'worker', ['spent:worker:1'], 'useBuilding', ['platform'], '+1 Hope or -1 Discontent.', [{'choose': [['hope+1'], ['disc-1']]}], d((N, 1), ('activate:anger', 1), ('activate:anger', 2))),
 ('C03', 'Dave Tadel', 'worker', ['sick:worker:1'], 'deployScouts', [], 'Perform this action as normal and then place 2 Wood below the chosen Expedition. Gain the 2 Wood when the Scout returns from that Expedition.', ['deployScouts:normal', 'expeditionBonus:wood:2'], d((N, 1), ('exhaust:motivation', 1), ('exhaust:care', 2))),
 ('C04', 'Paolo Feldman', 'worker', ['spend:coal:1'], 'gatherResources', [], 'Perform this action on an unoccupied space that has 1 or more Trees. Remove 1 Tree from that space and gain 2 Wood. Count this action as heated.', ['gatherTree:wood:2', 'heated'], d((N, 1), ('activate:greed', 1), ('activate:apathy', 2))),
 ('C05', 'Greg Bellowsky', 'worker', ['spend:wood:1'], 'deployScouts', [], 'Replace an unoccupied Expedition stack with a B Expedition card and Deploy a Scout to it.', ['deployScouts:replaceWithB'], d((N, 1), ('exhaust:motivation', 1), ('exhaust:justice', 2))),
 ('C06', 'Rufus Gladstone', 'worker', ['stress+3'], 'construct', [], 'Perform this action as normal except you may use 2 sub-actions to move a Small Building without the non-dismantle icon to a valid Build space (remove Resources and Trees as normal).', ['constructMoveSmallBuilding:2subactions'], d((N, 1), ('exhaust:care', 1), ('exhaust:care', 2))),
 ('C07', "Caroline O'Hare", 'worker', ['hunger+3'], 'deployScouts', [], 'Perform this action as normal and then place 2 Coal below the chosen Expedition. Gain the 2 Coal when the Scout returns from that Expedition.', ['deployScouts:normal', 'expeditionBonus:coal:2'], d((N, 1), ('activate:apathy', 1), ('activate:anger', 2))),
 ('C08', 'Georgia Taller', 'worker', ['mapRemove:wood:1'], 'removeSnow', [], 'Perform this action as normal except draw 3 Far tiles and choose 1 to place. Place each of the other 2 on either the top or bottom of the Far tiles stack.', ['removeSnow:drawFar3ChooseOne'], d((N, 1), ('activate:anger', 1), ('activate:greed', 2))),
 ('C09', "Pat O'Bara", 'worker', ['mapRemove:wood:1'], 'removeSnow', [], 'Perform this action as normal except place 1 Near tile and 1 Far tile. If all Near tiles have already been placed, place 2 Far tiles instead.', ['removeSnow:nearAndFar'], d((N, 1), ('exhaust:motivation', 1), ('exhaust:justice', 2))),
 ('C10', 'Chrissy Klemowsky', 'worker', ['mapRemove:coal:2'], 'construct', [], 'Perform this action as normal except you may use 2 sub-actions to upgrade a Building by paying its upgrade cost.', ['constructUpgrade:2subactions'], d((N, 1), ('exhaust:justice', 1), ('exhaust:motivation', 2))),
 ('C11', 'Agnes Hamsterville', 'engineer', ['spend:coal:1'], 'useBuilding', ['platform'], 'Perform this action as normal except you may choose which of the 2 Law Consequence cards to shuffle into the Dusk deck.', ['platform:chooseConsequence'], d(('activate:anger', 1), (N, 1), ('activate:greed', 2))),
 ('C12', 'Rafael Curae', 'engineer', ['stress+3'], 'useBuilding', ['medicalPost', 'infirmary', 'careHouse'], "Activate Care. Perform the Building's Cure effect.", ['activate:care', 'buildingCureEffect'], d(('exhaust:motivation', 1), (N, 1), ('activate:greed', 2))),
 ('C13', 'Jesse Quackerson', 'engineer', ['sick:engineer:1'], 'removeSnow', [], 'Perform this action as normal except place 2 Far tiles and, if cold, gain 2 sick Engineers (instead of 1).', ['removeSnow:twoFar', 'coldSick:engineer:2'], d(('exhaust:care', 1), (N, 1), ('exhaust:justice', 2))),
 ('C14', 'Paul Unclestone', 'engineer', ['mapRemove:coal:2'], 'useBuilding', ['platform'], 'Reuse a Building. This action counts as heated.', ['reuseBuilding', 'heated'], d(('activate:apathy', 1), (N, 1), ('activate:greed', 2))),
 ('C15', 'Davetta Hen', 'engineer', ['mapRemove:wood:1'], 'useBuilding', ['medicalPost', 'infirmary'], "Perform the Building's Cure effect. Treat 1.", ['buildingCureEffect', 'treat:1'], d(('activate:apathy', 1), (N, 1), ('activate:anger', 2))),
 ('C16', 'Derek Allgire', 'engineer', ['sick:engineer:1'], 'useBuilding', ['generator'], 'Remove up to 8 Stress cubes from the Stress track.', ['removeStress:8'], d(('exhaust:justice', 1), (N, 1), ('exhaust:care', 2))),
 ('C17', 'Marshal Primislao', 'engineer', ['spend:wood:1'], 'useBuilding', ['medicalPost', 'infirmary'], 'Perform this action as normal. You may then spend 3 Food to Cure 2.', ['buildingNormal', {'ifPay': 'spend:food:3', 'then': ['cure:2'], 'else': []}], d(('exhaust:care', 1), (N, 1), ('activate:anger', 2))),
 ('C18', 'Christina Marchant', 'engineer', ['spend:coal:1'], 'construct', [], 'Perform this action as normal except you may Build over Ruins (remove the Ruins from the game). Each of these Builds cost 1 fewer Wood.', ['constructOverRuins:woodDiscount:1'], d(('activate:greed', 1), (N, 1), ('activate:apathy', 2))),
 ('C19', 'Adele Quapinsky', 'engineer', ['hunger+3'], 'useBuilding', ['workshop'], 'Perform 3 Workshop effects.', ['workshopEffects:3'], d(('exhaust:justice', 1), (N, 1), ('exhaust:care', 2))),
 ('C20', 'Pauline Grogan', 'engineer', ['stress+3'], 'useBuilding', ['cookhouse'], 'Spend 4 Food. Draw 1 Hope token and activate it, or discard 1 active Discontent token.', ['spend:food:4', {'choose': [['drawHope:activate'], ['disc-discard:1:active']]}], d(('exhaust:justice', 1), (N, 1), ('exhaust:motivation', 2))),
 ('C21', 'Michael Plower', 'child', ['hunger+3'], 'removeSnow', [], 'Perform this action as normal but only place 1 Near tile. If all Near tiles have already been placed, place 1 Far tile instead.', ['removeSnow:oneNearElseFar'], d(('exhaust:justice', 1), ('exhaust:justice', 1), (N, 2))),
 ('C22', 'Patick McGretchak', 'child', ['hunger+3'], 'removeSnow', [], 'Perform this action as normal except, if cold, gain 2 sick Children (instead of 1).', ['coldSick:child:2'], d(('exhaust:motivation', 1), ('exhaust:motivation', 1), (N, 2))),
 ('C23', 'Michael Ozone', 'child', ['mapRemove:coal:2'], 'useBuilding', ['cookhouse'], 'Spend 4 / 8 / 12 Food to reduce Hunger by 6 / 12 / 18.', ['cookhouseTiers:4:6:8:12:12:18'], d(('activate:greed', 1), ('activate:greed', 1), (N, 2))),
 ('C24', 'Margaret Ozone', 'child', ['spent:worker:1'], 'useBuilding', ['medicalPost', 'infirmary'], 'Cure 2.', ['cure:2'], d(('exhaust:care', 1), ('exhaust:care', 1), (N, 2))),
 ('C25', 'Jacin Schock', 'child', ['mapRemove:coal:2'], 'construct', [], 'Perform up to 2 Construct sub-actions.', ['constructSubactions:2'], d(('exhaust:motivation', 1), ('exhaust:motivation', 1), (N, 2))),
 ('C26', 'Phillipa Bullsky', 'child', ['spend:wood:1'], 'removeSnow', [], 'Reveal 3 Far tiles and place each on either the top or bottom of the Far tiles stack.', ['revealFar3AndReorder'], d(('activate:greed', 1), ('activate:greed', 1), (N, 2))),
 ('C27', 'Christina Wardrobe', 'child', ['spend:wood:1'], 'useBuilding', ['medicalPost', 'infirmary'], 'Activate Care or Motivation.', [{'choose': [['activate:care'], ['activate:motivation']]}], d(('activate:anger', 1), ('activate:anger', 1), (N, 2))),
 ('C28', 'Godna Grellak', 'child', ['sick:child:1'], 'gatherResources', [], 'Perform this action on an unoccupied space on a tile to gain Food equal to the Food bonus on that tile and all adjacent tiles.', ['gatherFoodAdjacent'], d(('exhaust:care', 1), ('exhaust:care', 1), (N, 2))),
 ('C29', 'Nathaniel Apfel', 'child', ['spend:coal:1'], 'useBuilding', ['workshop'], 'Perform 1 Workshop effect.', ['workshopEffects:1'], d(('activate:apathy', 1), ('activate:apathy', 1), (N, 2))),
 ('C30', 'Peter Byerush', 'child', ['stress+3'], 'useBuilding', ['gatheringPost'], 'Perform this action as normal, or take up to 3 Resources from 1 adjacent space and place them in the supply.', ['gatheringPostOrAdjacent:3'], d(('exhaust:justice', 1), ('exhaust:justice', 1), (N, 2))),
]
out = []
for i, (cid, name, typ, start, act, blds, text, fx, death) in enumerate(rows):
    out.append({'id': cid, 'idx': i, 'deck': '541', 'name': name, 'type': typ, 'start': start,
                'act': act, 'buildings': blds, 'text': text, 'fx': fx, 'death': death})
assert len(out) == 30
json.dump(out, open(OUT, 'w', encoding='utf-8'), indent=0, ensure_ascii=False)
print('wrote', OUT, len(out))
