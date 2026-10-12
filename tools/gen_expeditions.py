"""Generates packages/engine/src/data/raw/expeditions.json (40 Expedition cards, deck 553) from a compact transcription table.

Card anatomy (UniqueBack deck): BackURL sheet = path side (white, letter A/B/C, location, reward icon, step count),
FaceURL sheet = black text side (title, story, options). Each option is a Return (yellow curved arrow) or a Continue
(blue arrow); the label under the arrow is the deck of the next card ("B"/"C") or "newA".
Rules: Return resolves this option now plus the Continue effect of every black-side card below in the stack.
Continue effects are DEFERRED until the Scout finally returns (they are not gained when you continue).
Reward icon: res = Food/Resources, cit = Citizens, any = Food/Resources/Citizens.
steps = number of Scout moves from the first (pickaxe) space to the top space.
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'packages', 'engine', 'src', 'data', 'raw', 'expeditions.json')


def fx(s):
    """'food:6 coal:2 hope+1 sick:worker:1 worker:3' -> engine tokens."""
    out = []
    for t in s.split():
        if t.startswith(('hope', 'hunger', 'sick')):
            out.append(t)
        else:
            out.append('gain:' + t)
    return out


def R(nxt, label, s):
    return {'kind': 'return', 'next': nxt, 'label': label, 'fx': fx(s)}


def C(nxt, label, s):
    return {'kind': 'continue', 'next': nxt, 'label': label, 'fx': fx(s)}


A, B, CC = 'A', 'B', 'C'
rows = [
 # idx, letter, location, reward, steps, title, options
 (0, A, 'campsite', 'res', 2, 'The Thing We Found', [R('B', 'Run back!', 'food:6'), C('B', 'Only the frost can scare us. Onward!', 'food:6')]),
 (1, A, 'campsite', 'res', 2, 'A Scene of Terrible Beauty', [R('B', 'I miss my family. Let\'s go back.', 'coal:2 food:2'), C('B', 'Love is a luxury few can now afford.', 'coal:2 food:2')]),
 (2, A, 'campsite', 'cit', 3, 'Smoke and Mirrors', [R('B', 'Come with us or die. The machinery stays.', 'engineer:3'), R('B', 'We can take your precious stuff, but you carry it.', 'hope+1 engineer:3 sick:engineer:2 core:1')]),
 (3, A, 'campsite', 'cit', 3, 'A Matter of Life and Death', [R('B', 'Take only the strong. Swallow the tears.', 'worker:3'), R('B', 'We must stay together.', 'hope+1 worker:4 child:2 sick:worker:1')]),
 (4, A, 'ruins', 'res', 3, 'Not a Fairy Tale', [R('B', 'Let us forget.', 'wood:3 food:2'), C('B', 'Look for a set of small sized tracks.', 'wood:3 food:2')]),
 (5, A, 'ruins', 'res', 3, 'Heart of Steam', [R('B', 'Hurry back with the findings and a tale.', 'core:1 coal:1'), C('B', 'Another relic of the past. Let\'s move on.', 'core:1 coal:1')]),
 (6, A, 'ruins', 'cit', 3, 'Hades', [R('B', 'Gather the few survivors.', 'worker:3'), R('B', 'Rush to help rescue those buried alive.', 'hope+1 worker:4 engineer:2 sick:worker:1 sick:engineer:1')]),
 (7, A, 'snow', 'any', 2, 'Black Gold Rush', [R('B', 'We must get some rest.', 'coal:3'), C('B', 'Focus and push forward!', 'coal:3')]),
 (8, A, 'snow', 'any', 2, 'Cabin in the Woods', [R('B', 'Head home. That\'s enough!', 'wood:2 food:2'), C('B', 'The hell with it! People depend on us.', 'wood:2 food:2')]),
 (9, A, 'snow', 'any', 3, 'A Letter in the Snow', [R('B', 'Maybe it\'s time to go back.', 'wood:2 coal:2'), C('B', 'Keep walking.', 'wood:2 coal:2')]),
 (10, A, 'snow', 'any', 3, 'The Other Side', [R('B', 'Turn away from the light.', 'worker:2 engineer:2'), R('B', 'Walk towards the light.', 'hope+1 worker:3 engineer:2 child:1 sick:child:1')]),
 (11, A, 'cave', 'res', 3, 'Misleading Star', [R('B', 'It\'s time to go back!', 'coal:3 food:2'), C('B', 'Leave them. Follow the star.', 'coal:3 food:2')]),
 (12, A, 'cave', 'res', 3, 'Mushroom Kingdom', [R('B', 'It\'s time to go back!', 'core:1 food:3'), C('B', 'What? Why? Let\'s just go.', 'core:1 food:3')]),
 (13, A, 'cave', 'any', 3, 'Devil\'s Crossroads', [R('B', 'Grab the loot and run!', 'wood:2 coal:2'), R('B', 'Act like a civilised human.', 'hope+1 worker:4 child:3 sick:child:1'), C('B', 'Take it and simply walk away.', 'wood:2 coal:2')]),
 (14, B, 'ruins', 'res', 3, 'Humanity\'s Long Fall', [R('C', 'Their loss, our gain.', 'wood:2 coal:3'), C('C', 'Gather what\'s left and continue.', 'wood:2 coal:3')]),
 (15, B, 'ruins', 'res', 3, 'The King and His Subjects', [R('C', 'The man ate the mice.', 'wood:3 food:4'), C('C', 'The mice ate the man.', 'wood:3 food:4')]),
 (16, B, 'ruins', 'cit', 3, 'Desperate Measures', [R('C', 'The dead don\'t need it. We do.', 'wood:3 coal:2'), R('C', 'We can save them! We must!', 'hope+1 worker:5 engineer:2 sick:worker:1')]),
 (17, B, 'ruins', 'cit', 3, 'Of Mice and Men', [R('C', 'Take. Take. Take!', 'wood:1 coal:3'), R('C', 'Don\'t be afraid. We won\'t hurt you.', 'hope+1 engineer:4 child:3 sick:child:1')]),
 (18, B, 'snow', 'any', 2, 'Fool\'s Gold', [R('C', 'Carry the prize back home.', 'coal:4'), C('C', 'The hunt continues.', 'coal:4')]),
 (19, B, 'snow', 'any', 2, 'A Carrion\'s Feast', [R('C', 'Return to your tribe.', 'core:1 coal:2'), C('C', 'Look for other prey.', 'core:1 coal:2')]),
 (20, B, 'snow', 'any', 2, 'Why We Fail', [R('C', 'Ask who wants to live.', 'engineer:3 sick:engineer:1'), R('C', 'Throw the idol into a fire.', 'hope+1 worker:2 engineer:3 child:2 sick:worker:1 sick:engineer:1 sick:child:1')]),
 (21, B, 'cave', 'res', 3, 'The Beginning and the End', [R('C', 'Maybe... but the past matters.', 'wood:2 coal:3'), C('C', 'Because you\'re long dead. Let\'s go.', 'wood:2 coal:3')]),
 (22, B, 'cave', 'res', 3, 'Solitude - The Foe of Sanity', [R('C', 'Sweet dreams.', 'core:1 coal:2 food:2'), C('C', 'Dream on.', 'core:1 coal:2 food:2')]),
 (23, B, 'cave', 'cit', 3, 'Lord of Lies', [R('C', 'Fear you should, adults are all liars!', 'automaton:1'), R('C', 'Smile, and reach out to the boys.', 'hope+1 child:4 sick:child:2 automaton:1')]),
 (24, B, 'campsite', 'any', 2, 'A Not-So-Romantic Realism', [R('C', 'We should be ashamed and suffer penance.', 'wood:2 food:6'), C('C', 'Maybe no one will notice...', 'wood:2 food:6')]),
 (25, B, 'campsite', 'any', 2, 'Valley of Shadows', [R('C', 'Only the strong will survive.', 'worker:4'), R('C', 'Only cowards are afraid to show mercy.', 'hope+1 worker:7 sick:worker:2 hunger+2')]),
 (26, B, 'campsite', 'res', 3, 'Humankind\'s Last Battle', [R('C', 'Set fire to this shameful place.', 'core:1 wood:2 food:1'), C('C', 'Leave it to serve as a warning.', 'core:1 wood:2 food:1')]),
 (27, B, 'campsite', 'cit', 3, 'White Lies', [R('C', 'Heed their words.', 'engineer:3'), R('C', 'Who\'d trust a Dalton?! Help them all.', 'hope+1 engineer:5 sick:engineer:1 hunger+3')]),
 (28, CC, 'ruins', 'res', 3, 'Old Man Logan', [R('newA', 'Honour him, keep going.', 'wood:4 food:6')]),
 (29, CC, 'ruins', 'res', 3, 'Down to Earth', [R('newA', 'Scavenge and head back.', 'core:1 wood:4')]),
 (30, CC, 'ruins', 'cit', 3, 'At the Threshold', [R('newA', 'Accept the gift and never come back.', 'coal:2 food:10'), R('newA', 'Help them escape the lurking danger.', 'hope+1 worker:4 engineer:5 child:3 sick:worker:1 sick:engineer:1')]),
 (31, CC, 'snow', 'any', 3, 'That Could Have Been Us', [R('newA', 'Go home.', 'core:1 food:8')]),
 (32, CC, 'snow', 'any', 3, 'It Serves Even in Death', [R('newA', 'All praise the technology!', 'core:2 coal:2')]),
 (33, CC, 'snow', 'any', 3, 'New Hope', [R('newA', 'Separate the strong from the weak.', 'worker:4 engineer:2'), R('newA', 'United we stand. Divided we fall.', 'hope+1 worker:6 engineer:4 child:2 sick:worker:1 sick:engineer:1 sick:child:2')]),
 (34, CC, 'campsite', 'res', 4, 'Fear of the Dark', [R('newA', 'Superstition was a luxury of days gone by.', 'core:1 wood:3 coal:3')]),
 (35, CC, 'campsite', 'cit', 4, 'Hippocratic Oath', [R('newA', 'Grab their children and they will follow.', 'engineer:3 child:3'), R('newA', 'Embrace your humanity.', 'hope+1 engineer:7 child:4 sick:engineer:2 sick:child:1')]),
 (36, CC, 'campsite', 'cit', 4, 'Who Are We?', [R('newA', 'We don\'t know them. Our people need supplies.', 'coal:4 food:7'), R('newA', 'We can\'t. That food would taste of blood.', 'hope+1 engineer:5 child:3 sick:engineer:1 sick:child:1')]),
 (37, CC, 'cave', 'res', 4, 'An Epic Deed', [R('newA', 'With steam technology comes great responsibility.', 'core:2 wood:3')]),
 (38, CC, 'cave', 'res', 4, 'Forgotten Stash', [R('newA', 'We will remember.', 'coal:4 food:7')]),
 (39, CC, 'cave', 'cit', 4, 'Bear Favour', [R('newA', 'They are already dead; they just don\'t know it.', 'wood:6 coal:2'), R('newA', 'Life will find a way.', 'hope+1 worker:6 engineer:5 sick:engineer:2')]),
]
out = []
for idx, letter, loc, reward, steps, title, opts in rows:
    out.append({'id': 'X%02d' % (idx + 1), 'idx': idx, 'deck': '553', 'letter': letter, 'location': loc,
                'reward': reward, 'steps': steps, 'title': title, 'options': opts})
assert len(out) == 40 and [r[0] for r in rows] == list(range(40))
json.dump({'rules': 'continue fx is deferred until the Scout returns; return resolves chosen fx plus continue fx of every black-side card below it in the stack. next: B/C = draw from that deck, newA = remove stack and start a new A stack. Skip only on letter A/B cards (draw next letter, overlay).',
           'cards': out}, open(OUT, 'w', encoding='utf-8'), indent=0, ensure_ascii=False)
print('wrote', OUT, len(out))
