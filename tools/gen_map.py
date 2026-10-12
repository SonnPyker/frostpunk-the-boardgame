"""Generates packages/engine/src/data/raw/map.json from the TTS Lua tables (docs/tts_lua_script.lua).

Hex frame: flat-top hexes, axial (q, r), screen x = 1.5*q, screen y(down) = sqrt(3)*(r + q/2), unit = hex side length.
TTS (x, z) -> (q, r): q = (x - cx)/1.5 ; y_down = -(z - cz) ; r = y_down/sqrt(3) - q/2   (TTS +z is the top of the rulebook pictures).
Frame origin (0,0) is the centre of the Generator tile in the standard (Crater) layout.
Generator tile = 7-hex flower (centre + ring 1). Near tiles sit on ring 2, Far tiles on ring 3 of the standard layout.
"""
import json, math, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LUA = os.path.join(ROOT, 'docs', 'tts_lua_script.lua')
OUT = os.path.join(ROOT, 'packages', 'engine', 'src', 'data', 'raw', 'map.json')
src = open(LUA, encoding='utf-8', errors='replace').read()
CX, CZ = 2.28, -0.43
S3 = math.sqrt(3)


def to_axial(x, z):
    q = (x - CX) / 1.5
    yd = -(z - CZ)
    r = yd / S3 - q / 2
    return round(q), round(r)


def check(x, z):
    q, r = to_axial(x, z)
    ex, ey = 1.5 * q + CX, -(S3 * (r + q / 2)) + CZ
    assert abs(ex - x) < 0.2 and abs(ey - z) < 0.2, (x, z, q, r, ex, ey)
    return q, r


def dist(q, r):
    return max(abs(q), abs(r), abs(q + r))


def table(name):
    out = {}
    for m in re.finditer(r'^' + name + r'\[(\d+)\]\s*=\s*\{([^}]*)\}', src, re.M):
        out[int(m.group(1))] = [float(v) for v in m.group(2).split(',')]
    return out


A = {i: check(v[0], v[2]) for i, v in table('TblTileAPos').items()}
B = {i: check(v[0], v[2]) for i, v in table('TblTileBPos').items()}
W = {i: to_axial(v[0], v[2]) for i, v in table('TblWallTokenPos').items()}
assert len(A) == 12 and len(B) == 18 and len(W) == 6
assert all(dist(*p) == 2 for p in A.values()), A
assert all(dist(*p) == 3 for p in B.values()), B
print('wall corners', W)

# tile contents -----------------------------------------------------------------------------------------------
tiles = []
for m in re.finditer(r"^TblTile\[(\d+)\]\s*=\s*\{GUID\s*=\s*'(\w+)',\s*Ress\s*=\s*\{([^}]*)\}\}(.*)$", src, re.M):
    n, guid, ress, rest = int(m.group(1)), m.group(2), [int(v) for v in m.group(3).split(',')], m.group(4)
    tiles.append((n, guid, ress, rest))
tiles.sort()

# CardID by tile number from the mod (nickname = tile number)
mod = json.load(open(os.path.join(ROOT, 'assets_src', 'mod', 'frostpunk_tts_mod.json'), encoding='utf-8'))
cardid = {}


def walk(o):
    if isinstance(o, dict):
        if o.get('GUID') in ('eee823', 'cea286') and 'ContainedObjects' in o:
            for c in o['ContainedObjects']:
                cardid[c['GUID']] = c['CardID']
        for v in o.values():
            walk(v)
    elif isinstance(o, list):
        for v in o:
            walk(v)


walk(mod)
out_tiles = []
for n, guid, ress, rest in tiles:
    if n > 30 or guid not in cardid:
        continue
    cid = cardid[guid]
    deck = 'near' if cid < 55100 else 'far'
    idx = cid - 55000 if deck == 'near' else cid - 55100
    tt, bt, tw, bw, tc, bc, tk, bk, food = ress
    out_tiles.append({
        'id': ('N%02d' if deck == 'near' else 'F%02d') % (idx + 1),
        'tileNo': n, 'deck': deck, 'sheet': '550' if deck == 'near' else '551', 'idx': idx, 'cardId': cid,
        'top': {k: v for k, v in (('tree', tt), ('wood', tw), ('coal', tc), ('core', tk)) if v},
        'bottom': {k: v for k, v in (('tree', bt), ('wood', bw), ('coal', bc), ('core', bk)) if v},
        'food': food,
    })
out_tiles.sort(key=lambda t: (t['deck'], t['idx']))
assert len([t for t in out_tiles if t['deck'] == 'near']) == 12 and len([t for t in out_tiles if t['deck'] == 'far']) == 18

# sanity: per-space limit 5, a space holds a single resource type
for t in out_tiles:
    for side in ('top', 'bottom'):
        s = t[side]
        assert len(s) <= 2 and sum(s.values()) <= 5, t
        if 'tree' in s and len(s) > 1:
            raise SystemExit('tree + resource on one space: %s' % t)

# scenario boards ------------------------------------------------------------------------------------------------
b2 = table('TblBoard2HexTilePos')
board2 = [to_axial(v[0], v[2]) for _, v in sorted(b2.items())]
GEN_BOTTOM = to_axial(2.28, -3.90)
DREAD_TILES = [B[16], B[17], B[18], B[1]]
dm = re.search(r'DreadnoughtPos\s*=\s*\{([^}]*)\}', src)
dx, dy, dz = [float(v) for v in dm.group(1).split(',')]
board5 = {'near': [A[11], A[12], A[1]], 'far': [B[2], B[15]], 'dreadnoughtTiles': DREAD_TILES}

crater_corners = [{'corner': i, 'q': W[i][0], 'r': W[i][1], 'nearPos': list(A[2 * i - 1]), 'farPos': list(B[3 * i - 2])} for i in range(1, 7)]
for c in crater_corners:
    assert c['q'] != 0 or True

ring2 = sorted(A.items())
ring3 = sorted(B.items())

data = {
    'note': 'Hex frame: flat-top, axial (q,r), x=1.5q, y_down=sqrt3*(r+q/2). Origin = centre of the Generator tile in the standard layout. Directions N(0,-1) NE(1,-1) SE(1,0) S(0,1) SW(-1,1) NW(-1,0). Generator tile = centre + ring 1 (7 hexes) but only 5 SPACES (see generatorTile). Map tiles have 2 spaces: top and bottom. Tile art is never rotated. Near tiles: ring 2 (12 positions) in standard layout, must be adjacent to the Generator tile; Far tiles: ring 3 (18 positions), adjacent to a tile connected to the Generator tile but never to the Generator tile itself. Zones by hex distance from the Generator tile (7-hex flower): Generator tile = zone A; zone B (Orange) = Generator tile + tiles adjacent to it; zone C (Yellow) = Generator tile + all tiles within 2 hexes. Placing a building on a space returns any Resources/Trees there to the bank (rulebook p26). Rim board: hexagon around the map, corner hexes of ring 4 hold the Starting Wall tokens; a tile is adjacent to a Rim Deposit if it shares an edge with the Rim edge next to the token (= the ring-3 corner Far tile).',
    'hex': {'orientation': 'flat-top', 'directions': [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]]},
    'generatorTile': {
        'flower': [[0, 0], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]],
        'spaces': {
            'T': {'hex': [0, -1], 'start': 'cookhouse'},
            'UR': {'hex': [1, -1], 'start': 'coal5'},
            'LR': {'hex': [1, 0], 'start': 'generatorBuilding', 'printed': True},
            'LL': {'hex': [-1, 1], 'start': 'platform', 'printed': True},
            'UL': {'hex': [-1, 0], 'start': 'wood5'},
        },
        'nonSpace': {'hex': [0, 1], 'note': 'Generator drawer / road, not a space'},
        'adjacency': 'A Generator-tile space (outer hex) is adjacent to every map-tile space on tiles sharing an edge with that outer hex; a map tile is adjacent to the Generator-tile spaces whose outer hex it shares an edge with (0-2). Generator spaces are not adjacent to each other.',
    },
    'tiles': out_tiles,
    'standardPositions': {
        'near': [{'slot': i, 'q': p[0], 'r': p[1]} for i, p in ring2],
        'far': [{'slot': i, 'q': p[0], 'r': p[1]} for i, p in ring3],
    },
    'rim': {
        'corners': [{'corner': i, 'q': W[i][0], 'r': W[i][1]} for i in range(1, 7)],
        'wallTokens': {'blank': 3, 'wood': 2, 'coal': 2},
        'adjacentFarTileOfCorner': {str(i): list(B[3 * i - 2]) for i in range(1, 7)},
    },
    'boards': {
        'crater': {
            'name': 'A New Home: Crater', 'generatorCentre': [0, 0],
            'wallSetup': 'Shuffle the 7 Starting Wall tokens; from a chosen corner go clockwise placing a drawn token on each corner until 3 Deposit tokens (Wood/Coal) are placed; blanks are discarded; remaining corners stay empty.',
            'cornerTiles': 'For every corner without a Deposit: place a Far tile at that corner Far position and a Near tile between it and the Generator tile; flip face up and place Resources/Trees (Food bonus is gained).',
            'corners': crater_corners,
        },
        'frozenGrove': {
            'name': 'A New Home: Frozen Grove', 'generatorCentre': list(GEN_BOTTOM),
            'wallSetup': 'Only the top corner has a Starting Wall token: draw 1 of {Wood Deposit, Coal Deposit} at random; all other Wall tokens return to the box. Generator tile touches the bottom corner of the Rim.',
            'nearTiles': [list(p) for p in board2],
            'note': '8 Near tiles from the Near deck are placed face up at the listed positions (in Lua order: 2 connecting towards the Wall corner, 2 top corners, 2 adjacent to the Generator tile and the Rim, rest per setup image). Action Phase restriction: actions only on map tiles adjacent to or connected to the Generator tile; heating still applies everywhere.',
            'steamHubTech': 'T09 is always displayed + 3 random techs; Storm card is S09 instead of S08.',
        },
        'dreadnought': {
            'name': 'A New Home: Dreadnought', 'generatorCentre': [0, 0],
            'wallSetup': 'Two Starting Wall tokens (1 Wood Deposit, 1 Coal Deposit), shuffled, placed at corners 3 and 4 (the two corners opposite the Dreadnought tiles).',
            'wallCorners': [3, 4],
            'dreadnoughtTiles': [list(p) for p in DREAD_TILES],
            'dreadnoughtMarkerTts': [dx, dy, dz],
            'nearTiles': [list(p) for p in board5['near']], 'farTiles': [list(p) for p in board5['far']],
            'note': 'Dreadnought tiles act as Small Buildings with Blue insulation: a Meeple on one is a Use a Building action gaining 1 Steel. Steel can replace Wood when building.',
        },
    },
}
json.dump(data, open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('wrote', OUT)
print('frozenGrove gen', GEN_BOTTOM, 'near', board2)
print('dread tiles', DREAD_TILES, 'near', board5['near'], 'far', board5['far'])
print('crater corners', [(c['corner'], (c['q'], c['r']), c['nearPos'], c['farPos']) for c in crater_corners])
print('Dreadnought marker', dx, dz, to_axial(dx, dz))
