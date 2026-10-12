"""Build the deployable asset set from assets_src/ (raw TTS mod copy).

usage:
  python -I tools/optimize_assets.py            # build (cached; unchanged sources are skipped)
  python -I tools/optimize_assets.py --all-pdfs  # also ship the advisor responsibility sheets
  python -I tools/optimize_assets.py --verify    # only validate existing outputs (GLB headers/accessors, manifest paths)

Outputs (apps/web/public/assets/):
  cards/   <ID>.webp (card face, ID = our id, e.g. M001 D012 C07 L01A X12 W03 T05 S1N SD03 N12 F01 ADV_HEALTH)
           <ID>_back.webp for unique-back decks, back_<family>.webp for shared card backs
  tokens/  Custom_Token images (+ _back when the token has a second side)
  tiles/   Custom_Tile images: buildings, map tiles N##/F##, generator tile, rim strips, status tiles
  boards/  CardCustom boards (generator board, setup/reference boards) and large board panels
  models/  <key>.glb  (OBJ -> binary glTF 2.0, diffuse baked in when the mod assigns one)
  audio/   frostpunk_theme.mp3
  pdf/     frostpunk_rulebook.pdf, frostpunk_rules_supplement.pdf (+ advisor sheets with --all-pdfs)
  manifest.json            every produced file by logical key, with sizes / dimensions
Also writes apps/web/src/assets/manifest.ts (typed accessors: cardUrl, cardBackUrl, tokenUrl, tileUrl,
boardUrl, modelUrl, modelInfo, audioUrl, pdfUrl, pdfs, manifest).

Mapping rules (see docs/ASSETS.md for the full table):
  cards   : data/raw/*.json records carry deck + idx (CardID = deckId*100 + idx in TTS). Sheet crop = row-major cell idx.
            morning cards use the deck from the mod (543) and the 'idx' field of morning_*.json.
  maps    : map.json tiles: sheet (550 near / 551 far) + idx.
  tokens  : TTS Custom_Token / Custom_Tile objects; key = nickname slug, overridden by IMG_OVERRIDES when the
            nickname is empty or ambiguous (matched on the 8-hex suffix of the image hash).
  models  : Custom_Model* MeshURL -> assets_src/models/<hash>.obj; key from nickname/description.
Cache: tools/.optimize_cache.json keyed by sha1(source bytes + parameters + VERSION).
"""
import argparse
import hashlib
import json
import os
import re
import struct
import sys

from PIL import Image

VERSION = 3
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets_src')
RAW = os.path.join(ROOT, 'packages', 'engine', 'src', 'data', 'raw')
MOD = os.path.join(SRC, 'mod', 'frostpunk_tts_mod.json')
PUB = os.path.join(ROOT, 'apps', 'web', 'public', 'assets')
TS_OUT = os.path.join(ROOT, 'apps', 'web', 'src', 'assets', 'manifest.ts')
CACHE_PATH = os.path.join(ROOT, 'tools', '.optimize_cache.json')
CATEGORIES = ['cards', 'tokens', 'tiles', 'boards', 'models', 'audio', 'pdf']

CARD_MAX_W = 420
CARD_Q = 80
TILE_MAX = 512
BOARD_MAX = 1600
BOARD_Q = 82
TEX_MAX = 512

# deck id -> family used for shared card backs
DECK_FAMILY = {
    '541': 'citizen', '543': 'morning', '544': 'society', '545': 'socialdispute',
    '550': 'near', '551': 'far', '552': 'scenario', '553': 'expedition', '554': 'weather',
    '557': 'laws', '713': 'tech', '725': 'advisor', '726': 'lawcons', '727': 'dusk', '728': 'dusk',
}
# decks whose BackURL is a sheet (each card has its own back): value = True
UNIQUE_BACK_DECKS = {'552', '553', '557', '725'}

# Data files that carry card records (id, idx, deck). default_deck used when the record has no deck.
CARD_FILES = [
    ('morning_1.json', '543'), ('morning_2.json', '543'), ('morning_3.json', '543'),
    ('dusk_1.json', None), ('dusk_2.json', None), ('dusk_3.json', None),
    ('dusk_4.json', None), ('dusk_5.json', None), ('dusk_6.json', None),
    ('citizens.json', None), ('expeditions.json', None), ('law_consequences.json', None),
    ('laws.json', None), ('technologies.json', None), ('weather.json', None),
    ('social_dispute.json', None), ('societies.json', None), ('advisors.json', None),
]

# Image overrides keyed by the last 8 hex chars of the normalised image URL (identical images share it).
IMG_OVERRIDES = {
    '848305C9': 'token_generator_home', 'E37FED77': 'token_platform', 'E3E876BA': 'cookhouse',
    '9E80C8B2': 'generator_tile',
    '3CDCEA69': 'rim_strip_1', 'B1EFB59F': 'rim_strip_2', '52E6578F': 'rim_strip_3',
    '5AE3B478': 'rim_strip_4', '3F923A6B': 'rim_strip_5', 'C472FD49': 'rim_strip_6',
    'C60925A5': 'board_round_track', '674685A7': 'board_heat_track', '3C7FE746': 'board_panel_a',
    'DADD163B': 'board_panel_b', '63EFB2E1': 'board_phase_track', '0A420D3A': 'board_storm_track',
    '9B696DC2': 'bunkhouse', '32A9E6A9': 'cemetery', 'D1FC031E': 'faith_keepers',
    'FD41AD32': 'field_kitchen', '9D1634F2': 'house', '6EB41BBB': 'temple', '2A32134D': 'tent',
    '43A874B1': 'stocked_coal', '35294C57': 'stocked_rations', 'D9649DE5': 'stocked_wood',
    'E2FDD844': 'board_setup_compass', '925DECF5': 'board_generator',
    'A079F8FF': 'board_call_to_rise', '4635AB77': 'board_reference',
    '28CFC6E5': 'engineer_count', 'D9900B93': 'engineer_token',
    '2A98814F': 'worker_count', '39859A60': 'worker_token',
    '57BE659F': 'child_count', '38633B33': 'child_token',
}
PDF_NAMES = {
    '7CE5B9201D39C': 'frostpunk_rulebook',
    '1AB196D49D479': 'frostpunk_rules_supplement',
}
PDF_NICK = {
    'Foreman Advisor': 'advisor_foreman', 'Generator Advisor': 'advisor_generator',
    'Health Advisor': 'advisor_health', 'Social Advisor': 'advisor_social',
}
DEFAULT_PDFS = {'frostpunk_rulebook', 'frostpunk_rules_supplement'}
MODEL_NAMES_BY_NICK = {
    'Steam Core': 'steam_core', 'Steel': 'steel', 'Steam Hub': 'steam_hub',
    'Leadership marker': 'leadership_marker', 'Round marker': 'round_marker',
    'Automatons': 'automatons', 'Children': 'children', 'Coal': 'coal', 'Engineers': 'engineers',
    'Trees': 'trees', 'Wood': 'wood', 'Workers': 'workers',
}


# Custom_Tile keys that are buildings (or building-like tiles) rather than tokens/markers.
BUILDING_KEYS = {
    'cookhouse', 'generator_tile', 'charcoal_kiln', 'sawmill', 'coal_mine', 'wall_drill', 'hothouse',
    'infirmary', 'coal_thumper', 'hunters_hut', 'workshop', 'gathering_post', 'factory', 'beacon',
    'public_house', 'fighting_arena', 'child_shelter', 'care_house', 'medical_post', 'tent', 'house',
    'bunkhouse', 'field_kitchen', 'temple', 'cemetery', 'faith_keepers', 'heat_range_2nd_ring',
}


def classify(key, obj_name):
    """Category for a TTS Custom_Tile / Custom_Token key: boards/, tiles/ (buildings) or tokens/."""
    if key.startswith('board_'):
        return 'boards'
    if key in BUILDING_KEYS or key.startswith('rim_strip_'):
        return 'tiles'
    return 'tokens'


def norm(url):
    return re.sub(r'[^A-Za-z0-9]', '', url or '')


def suffix8(url):
    return norm(url)[-8:].upper()


def slug(text):
    text = (text or '').encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'[^a-z0-9]+', '_', text).strip('_')


def first_line(desc):
    for line in (desc or '').splitlines():
        s = slug(line)
        if s:
            return line
    return ''


def sha1_file(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def sha1_bytes(*parts):
    h = hashlib.sha1()
    for p in parts:
        h.update(p if isinstance(p, bytes) else str(p).encode('utf-8'))
    return h.hexdigest()


def index_dir(path):
    out = {}
    if os.path.isdir(path):
        for f in os.listdir(path):
            out[os.path.splitext(f)[0]] = os.path.join(path, f)
    return out


class Sources:
    def __init__(self):
        self.images = index_dir(os.path.join(SRC, 'images'))
        self.models = index_dir(os.path.join(SRC, 'models'))
        self.audio = index_dir(os.path.join(SRC, 'audio'))
        self.pdf = index_dir(os.path.join(SRC, 'pdf'))
        self.mod = json.load(open(MOD, encoding='utf-8'))
        self.objects = []
        self._walk(self.mod['ObjectStates'])
        self.decks = {}
        for o in self.objects:
            for k, v in (o.get('CustomDeck') or {}).items():
                self.decks.setdefault(k, v)
        self.missing = []

    def _walk(self, objs):
        for o in objs:
            self.objects.append(o)
            self._walk(o.get('ContainedObjects', []))

    def image(self, url):
        p = self.images.get(norm(url))
        if p is None and url:
            self.missing.append(url)
        return p

    def find_any(self, url):
        n = norm(url)
        for d in (self.images, self.models, self.audio, self.pdf):
            if n in d:
                return d[n]
        return None


class Cache:
    def __init__(self):
        self.data = {}
        if os.path.exists(CACHE_PATH):
            try:
                self.data = json.load(open(CACHE_PATH, encoding='utf-8'))
            except Exception:
                self.data = {}
        self.used = {}

    def get(self, rel, key):
        e = self.data.get(rel)
        if e and e.get('key') == key and os.path.exists(os.path.join(PUB, rel)):
            self.used[rel] = e
            return e
        return None

    def put(self, rel, key, entry):
        entry = dict(entry, key=key)
        self.data[rel] = entry
        self.used[rel] = entry

    def save(self):
        keep = {k: v for k, v in self.data.items() if k in self.used}
        with open(CACHE_PATH, 'w', encoding='utf-8') as f:
            json.dump(keep, f, indent=0, sort_keys=True)


def write_bytes(rel, data):
    path = os.path.join(PUB, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)


def encode_image(im, max_side, quality):
    if im.mode not in ('RGB', 'RGBA'):
        im = im.convert('RGBA' if 'A' in im.getbands() or im.mode == 'P' else 'RGB')
    if max(im.size) > max_side:
        im = im.copy()
        im.thumbnail((max_side, max_side), Image.LANCZOS)
    import io
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=quality, method=6)
    return buf.getvalue(), im.size


class Builder:
    def __init__(self, src, cache):
        self.src = src
        self.cache = cache
        self.manifest = {c: {} for c in CATEGORIES}
        self.sheet_cache = {}
        self.sheet_hash = {}
        self.log = []
        self.written = 0
        self.reused = 0
        self.unresolved = []
        self.skipped = []

    # ---- generic image emit -------------------------------------------------------------------------
    def emit_image(self, category, rel_key, material, make_im, max_side, quality, entry_extra=None):
        rel = category + '/' + rel_key + '.webp'
        key = sha1_bytes(VERSION, material, max_side, quality)
        hit = self.cache.get(rel, key)
        if hit:
            self.reused += 1
            meta = {'path': rel, 'w': hit['w'], 'h': hit['h'], 'bytes': hit['bytes']}
        else:
            data, size = encode_image(make_im(), max_side, quality)
            write_bytes(rel, data)
            meta = {'path': rel, 'w': size[0], 'h': size[1], 'bytes': len(data)}
            self.cache.put(rel, key, meta)
            self.written += 1
        if entry_extra:
            meta.update(entry_extra)
        return meta

    def sheet_path(self, url):
        p = self.src.image(url)
        if p is not None and p not in self.sheet_hash:
            self.sheet_hash[p] = sha1_file(p)
        return p

    def sheet(self, url):
        """Return (path, RGB sheet), decoding lazily; keeps at most two sheets in memory."""
        p = self.sheet_path(url)
        if p is None:
            return None
        if p not in self.sheet_cache:
            if len(self.sheet_cache) >= 2:
                self.sheet_cache.pop(next(iter(self.sheet_cache)))
            self.sheet_cache[p] = Image.open(p).convert('RGB')
        return p, self.sheet_cache[p]

    def crop_card(self, deck, idx, which):
        url = deck[which]
        path = self.sheet_path(url)
        if path is None:
            return None
        cols, rows = int(deck['NumWidth']), int(deck['NumHeight'])
        r, c = divmod(idx, cols)
        material = (self.sheet_hash[path], which, idx, cols, rows)

        def make():
            _, im = self.sheet(url)
            cw, ch = im.size[0] // cols, im.size[1] // rows
            return im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
        return material, make

    def whole_back(self, deck):
        url = deck['BackURL']
        p = self.src.image(url)
        if p is None:
            return None
        return (sha1_file(p),), (lambda: Image.open(p).convert('RGB'))

    # ---- cards --------------------------------------------------------------------------------------
    def card_records(self):
        recs = []  # (id, deck, idx)
        for fname, default_deck in CARD_FILES:
            data = json.load(open(os.path.join(RAW, fname), encoding='utf-8'))
            for r in data:
                if 'id' not in r or 'idx' not in r:
                    continue
                deck = str(r.get('deck') or default_deck)
                recs.append((r['id'], deck, int(r['idx'])))
        # map tiles: near (550) / far (551)
        m = json.load(open(os.path.join(RAW, 'map.json'), encoding='utf-8'))
        for t in m['tiles']:
            recs.append((t['id'], str(t['sheet']), int(t['idx'])))
        # scenario cards
        s = json.load(open(os.path.join(RAW, 'scenarios.json'), encoding='utf-8'))
        cards = s.get('cards')
        if isinstance(cards, dict):
            for k, v in cards.items():
                if re.match(r'^S\d\d$', k):
                    recs.append((k, '552', int(k[1:]) - 1))
        elif isinstance(cards, list):
            for v in cards:
                if isinstance(v, dict) and 'id' in v and 'idx' in v:
                    recs.append((v['id'], '552', int(v['idx'])))
        seen = set()
        out = []
        for rec in recs:
            if rec[0] in seen:
                continue
            seen.add(rec[0])
            out.append(rec)
        return out

    def build_cards(self):
        recs = self.card_records()
        decks = self.src.decks
        cards = self.manifest['cards']
        family_back_done = set()
        for cid, deck_id, idx in sorted(recs, key=lambda r: (r[1], r[2])):
            deck = decks.get(deck_id)
            if deck is None:
                self.unresolved.append('card %s: deck %s not in mod' % (cid, deck_id))
                continue
            fam = DECK_FAMILY.get(deck_id, 'deck' + deck_id)
            got = self.crop_card(deck, idx, 'FaceURL')
            if got is None:
                self.unresolved.append('card %s: face sheet missing (%s)' % (cid, deck['FaceURL'][-12:]))
                continue
            material, make = got
            entry = self.emit_image('cards', cid, ('face',) + material, make, CARD_MAX_W, CARD_Q,
                                    {'deck': deck_id, 'idx': idx})
            if deck_id in UNIQUE_BACK_DECKS:
                bgot = self.crop_card(deck, idx, 'BackURL')
                if bgot is not None:
                    bm, bmake = bgot
                    bentry = self.emit_image('cards', cid + '_back', ('back',) + bm, bmake, CARD_MAX_W, CARD_Q)
                    entry['back'] = cid + '_back'
                    cards[cid + '_back'] = bentry
            else:
                bkey = 'back_' + fam
                entry['back'] = bkey
                if bkey not in family_back_done and bkey not in cards:
                    wb = self.whole_back(deck)
                    if wb is not None:
                        bm, bmake = wb
                        cards[bkey] = self.emit_image('cards', bkey, ('wholeback',) + bm, bmake, CARD_MAX_W, CARD_Q)
                    family_back_done.add(bkey)
            cards[cid] = entry
        return len(recs)

    # ---- tokens / tiles / boards --------------------------------------------------------------------
    def object_key(self, o, url):
        ov = IMG_OVERRIDES.get(suffix8(url))
        if ov:
            return ov
        nick = o.get('Nickname') or ''
        if slug(nick):
            return slug(nick)
        return slug(first_line(o.get('Description'))) or ('img_' + suffix8(url).lower())

    def build_tiles(self):
        taken = {}  # key -> image norm url
        for o in self.src.objects:
            name = o.get('Name')
            if name not in ('Custom_Tile', 'Custom_Token', 'CardCustom'):
                continue
            if name == 'CardCustom':
                for k, v in (o.get('CustomDeck') or {}).items():
                    self._emit_board_like(taken, v['FaceURL'], o, k)
                continue
            ci = o.get('CustomImage') or {}
            front = ci.get('ImageURL')
            if not front:
                continue
            if not self.src.image(front):
                continue
            key = self.object_key(o, front)
            if key in taken and taken[key] != norm(front):
                key = key + '_' + suffix8(front).lower()
            if key in taken:
                continue
            taken[key] = norm(front)
            cat = classify(key, name)
            self._emit_tile(cat, key, front, ci.get('ImageSecondaryURL'))

    def _emit_board_like(self, taken, url, o, deck_key):
        if not self.src.image(url):
            return
        key = IMG_OVERRIDES.get(suffix8(url)) or ('board_deck_' + deck_key)
        if key in taken:
            return
        taken[key] = norm(url)
        self._emit_tile('boards', key, url, None)

    def _emit_tile(self, cat, key, front, back):
        p = self.src.image(front)
        big = cat == 'boards'
        max_side = BOARD_MAX if big else TILE_MAX
        quality = BOARD_Q if big else 86
        if key in self.manifest[cat]:
            return
        entry = self.emit_image(cat, key, ('tile', sha1_file(p)), lambda: Image.open(p),
                                max_side, quality)
        self.manifest[cat][key] = entry
        if back and norm(back) != norm(front):
            bp = self.src.image(back)
            if bp:
                bkey = key + '_back'
                if bkey not in self.manifest[cat]:
                    self.manifest[cat][bkey] = self.emit_image(
                        cat, bkey, ('tile-back', sha1_file(bp)), lambda: Image.open(bp),
                        max_side, quality)
        if key.startswith(('img_', 'board_deck_')):
            self.unresolved.append('%s: unnamed image %s' % (cat, key))

    def build_map_tiles(self):
        """Map tiles reuse the card path: tiles/N01.webp etc. (and cards/ for backs)."""
        m = json.load(open(os.path.join(RAW, 'map.json'), encoding='utf-8'))
        decks = self.src.decks
        for t in m['tiles']:
            deck = decks.get(str(t['sheet']))
            if deck is None:
                self.unresolved.append('map tile %s: deck %s missing' % (t['id'], t['sheet']))
                continue
            got = self.crop_card(deck, int(t['idx']), 'FaceURL')
            if got is None:
                self.unresolved.append('map tile %s: sheet missing' % t['id'])
                continue
            material, make = got
            self.manifest['tiles'][t['id']] = self.emit_image(
                'tiles', t['id'], ('maptile',) + material, make, TILE_MAX, 86,
                {'deck': str(t['sheet']), 'idx': int(t['idx'])})

    # ---- audio / pdf --------------------------------------------------------------------------------
    def build_audio(self):
        mp = self.src.mod.get('MusicPlayer') or {}
        url = mp.get('CurrentAudioURL') or ''
        p = self.src.find_any(url)
        if p:
            rel = 'audio/frostpunk_theme.mp3'
            data = open(p, 'rb').read()
            key = sha1_bytes(VERSION, 'audio', sha1_file(p))
            if not self.cache.get(rel, key):
                write_bytes(rel, data)
                self.cache.put(rel, key, {'path': rel, 'bytes': len(data)})
                self.written += 1
            else:
                self.reused += 1
            self.manifest['audio']['theme'] = {'path': rel, 'bytes': len(data),
                                               'title': mp.get('CurrentAudioTitle', '')}
        else:
            self.unresolved.append('audio: MusicPlayer track not found')

    def build_pdfs(self, all_pdfs):
        for o in self.src.objects:
            if o.get('Name') != 'Custom_PDF':
                continue
            url = (o.get('CustomPDF') or {}).get('PDFUrl') or ''
            p = self.src.find_any(url)
            if not p:
                self.unresolved.append('pdf: %s missing' % suffix8(url))
                continue
            stem = os.path.splitext(os.path.basename(p))[0]
            name = PDF_NAMES.get(stem[-13:]) or PDF_NICK.get(o.get('Nickname') or '')
            if not name:
                name = 'pdf_' + stem[-8:].lower()
            if name in self.manifest['pdf']:
                continue
            if name not in DEFAULT_PDFS and not all_pdfs:
                self.skipped.append({'pdf': name, 'bytes': os.path.getsize(p),
                                     'reason': 'advisor responsibility sheet; digital game automates it (run with --all-pdfs to ship)'})
                continue
            rel = 'pdf/%s.pdf' % name
            key = sha1_bytes(VERSION, 'pdf', sha1_file(p))
            if not self.cache.get(rel, key):
                data = open(p, 'rb').read()
                write_bytes(rel, data)
                self.cache.put(rel, key, {'path': rel, 'bytes': len(data)})
                self.written += 1
            else:
                self.reused += 1
            self.manifest['pdf'][name] = {'path': rel, 'bytes': os.path.getsize(os.path.join(PUB, rel))}

    # ---- models -------------------------------------------------------------------------------------
    def build_models(self):
        seen = {}
        for o in self.src.objects:
            if o.get('Name') not in ('Custom_Model', 'Custom_Model_Bag', 'Custom_Model_B'):
                continue
            cm = o.get('CustomMesh') or {}
            url = cm.get('MeshURL')
            if not url:
                continue
            mesh = self.src.models.get(norm(url))
            if mesh is None:
                self.unresolved.append('model %s: obj missing' % suffix8(url))
                continue
            if mesh in seen:
                continue
            nick = o.get('Nickname') or ''
            key = MODEL_NAMES_BY_NICK.get(nick) or slug(nick)
            if not key or key in self.manifest['models']:
                key = slug(first_line(o.get('Description'))) or ('model_' + suffix8(url).lower())
            if key in self.manifest['models']:
                key = key + '_' + suffix8(url).lower()
            seen[mesh] = key
            diffuse = cm.get('DiffuseURL')
            tex = self.src.find_any(diffuse) if diffuse else None
            self.manifest['models'][key] = self.build_glb(key, mesh, tex)

    def build_glb(self, key, obj_path, tex_path):
        rel = 'models/%s.glb' % key
        h = sha1_bytes(VERSION, 'glb', sha1_file(obj_path), sha1_file(tex_path) if tex_path else '-')
        cached = self.cache.get(rel, h)
        if cached:
            self.reused += 1
            return dict(cached['meta'])
        verts, uvs, norms, faces = obj_parse(obj_path)
        glb, meta = obj_to_glb(key, verts, uvs, norms, faces, tex_path)
        write_bytes(rel, glb)
        meta['path'] = rel
        meta['bytes'] = len(glb)
        self.cache.put(rel, h, {'path': rel, 'bytes': len(glb), 'meta': meta})
        self.written += 1
        return meta


# ---- OBJ / GLB ----------------------------------------------------------------------------------------
def obj_parse(path):
    verts, uvs, norms, faces = [], [], [], []
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            parts = line.split()
            if not parts or parts[0].startswith('#'):
                continue
            t = parts[0]
            if t == 'v':
                verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif t == 'vt':
                uvs.append((float(parts[1]), float(parts[2]) if len(parts) > 2 else 0.0))
            elif t == 'vn':
                norms.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif t == 'f':
                face = []
                for tok in parts[1:]:
                    bits = tok.split('/')
                    vi = int(bits[0])
                    vi = vi - 1 if vi > 0 else len(verts) + vi
                    ti = ni = None
                    if len(bits) > 1 and bits[1]:
                        ti = int(bits[1])
                        ti = ti - 1 if ti > 0 else len(uvs) + ti
                    if len(bits) > 2 and bits[2]:
                        ni = int(bits[2])
                        ni = ni - 1 if ni > 0 else len(norms) + ni
                    face.append((vi, ti, ni))
                for k in range(1, len(face) - 1):  # fan triangulation (OBJ faces are convex polygons)
                    faces.append((face[0], face[k], face[k + 1]))
    return verts, uvs, norms, faces


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def obj_to_glb(key, verts, uvs, norms, faces, tex_path):
    """Pure-python binary glTF 2.0. Coordinates are kept as authored (Y-up, TTS/Unity source), the
    triangle winding is fixed so the signed volume is positive (outward faces), the mesh is centred on the
    origin and uniformly scaled so its largest extent is 1 unit. Original extent is kept in the manifest."""
    has_n = any(ni is not None for tri in faces for (_, _, ni) in tri)
    has_t = any(ti is not None for tri in faces for (_, ti, _) in tri)
    index = {}
    P, N, T, idx = [], [], [], []
    for tri in faces:
        for (vi, ti, ni) in tri:
            k = (vi, ti if has_t else None, ni if has_n else None)
            if k not in index:
                index[k] = len(P)
                P.append(verts[vi])
                N.append(norms[ni] if ni is not None else (0.0, 1.0, 0.0))
                if ti is not None:
                    u, v = uvs[ti]
                    T.append((u, 1.0 - v))
                else:
                    T.append((0.0, 0.0))
            idx.append(index[k])
    # winding: make signed volume positive
    vol = 0.0
    for t in range(0, len(idx), 3):
        vol += _dot(P[idx[t]], _cross(P[idx[t + 1]], P[idx[t + 2]]))
    flipped = vol < 0
    if flipped:
        for t in range(0, len(idx), 3):
            idx[t + 1], idx[t + 2] = idx[t + 2], idx[t + 1]
    mn = [min(p[i] for p in P) for i in range(3)] if P else [0, 0, 0]
    mx = [max(p[i] for p in P) for i in range(3)] if P else [0, 0, 0]
    center = [(mn[i] + mx[i]) / 2 for i in range(3)]
    ext = max(mx[i] - mn[i] for i in range(3)) or 1.0
    s = 1.0 / ext
    P = [((p[0] - center[0]) * s, (p[1] - center[1]) * s, (p[2] - center[2]) * s) for p in P]
    emn = [min(p[i] for p in P) for i in range(3)]
    emx = [max(p[i] for p in P) for i in range(3)]

    # binary buffer
    blob = bytearray()
    views, accessors = [], []

    def add_view(data, target=None):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(data)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def add_accessor(vi, comp, count, typ, mn_=None, mx_=None):
        a = {'bufferView': vi, 'componentType': comp, 'count': count, 'type': typ}
        if mn_ is not None:
            a['min'] = mn_
            a['max'] = mx_
        accessors.append(a)
        return len(accessors) - 1

    pos_bytes = b''.join(struct.pack('<3f', *p) for p in P)
    a_pos = add_accessor(add_view(pos_bytes, 34962), 5126, len(P), 'VEC3', list(emn), list(emx))
    attrs = {'POSITION': a_pos}
    if has_n:
        nb = b''.join(struct.pack('<3f', *n) for n in N)
        attrs['NORMAL'] = add_accessor(add_view(nb, 34962), 5126, len(N), 'VEC3')
    if has_t:
        tb = b''.join(struct.pack('<2f', *t) for t in T)
        attrs['TEXCOORD_0'] = add_accessor(add_view(tb, 34962), 5126, len(T), 'VEC2')
    ib = struct.pack('<%dI' % len(idx), *idx)
    a_idx = add_accessor(add_view(ib, 34963), 5125, len(idx), 'SCALAR')

    textured = False
    images, textures = [], []
    material = {'name': key, 'doubleSided': True,
                'pbrMetallicRoughness': {'baseColorFactor': [0.78, 0.78, 0.78, 1.0],
                                         'metallicFactor': 0.0, 'roughnessFactor': 0.85}}
    if tex_path and has_t:
        import io
        im = Image.open(tex_path)
        if max(im.size) > TEX_MAX:
            im.thumbnail((TEX_MAX, TEX_MAX), Image.LANCZOS)
        buf = io.BytesIO()
        if im.mode in ('RGBA', 'LA', 'P') and 'A' in im.getbands():
            im.convert('RGBA').save(buf, 'PNG', optimize=True)
            mime = 'image/png'
        else:
            im.convert('RGB').save(buf, 'JPEG', quality=88)
            mime = 'image/jpeg'
        vi = add_view(buf.getvalue())
        images.append({'bufferView': vi, 'mimeType': mime})
        textures.append({'source': 0})
        material['pbrMetallicRoughness']['baseColorTexture'] = {'index': 0}
        material['pbrMetallicRoughness']['baseColorFactor'] = [1.0, 1.0, 1.0, 1.0]
        textured = True

    while len(blob) % 4:
        blob.append(0)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'tools/optimize_assets.py'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': key}],
        'meshes': [{'name': key, 'primitives': [{'attributes': attrs, 'indices': a_idx, 'material': 0}]}],
        'materials': [material],
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': len(blob)}],
    }
    if textures:
        gltf['textures'] = textures
        gltf['images'] = images
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(blob)
    out = bytearray()
    out += struct.pack('<4sII', b'glTF', 2, total)
    out += struct.pack('<I4s', len(js), b'JSON') + js
    out += struct.pack('<I4s', len(blob), b'BIN\x00') + bytes(blob)
    meta = {
        'extent': [round(emx[i] - emn[i], 4) for i in range(3)],
        'sourceExtent': round(ext, 4),
        'textured': textured,
        'tris': len(idx) // 3,
        'flipped': flipped,
    }
    return bytes(out), meta


def validate_glb(path):
    data = open(path, 'rb').read()
    magic, ver, length = struct.unpack_from('<4sII', data, 0)
    assert magic == b'glTF' and ver == 2 and length == len(data), 'bad GLB header'
    off = 12
    chunks = {}
    while off < len(data):
        clen, ctype = struct.unpack_from('<I4s', data, off)
        chunks[ctype] = data[off + 8: off + 8 + clen]
        off += 8 + clen
    g = json.loads(chunks[b'JSON'].decode('utf-8'))
    blob = chunks.get(b'BIN\x00', b'')
    assert g['buffers'][0]['byteLength'] <= len(blob)
    for a in g['accessors']:
        v = g['bufferViews'][a['bufferView']]
        size = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']] * (4 if a['componentType'] in (5126, 5125) else 2)
        assert v['byteOffset'] + a['count'] * size <= v['byteOffset'] + v['byteLength'], 'accessor overflow'
        if 'min' in a and a['type'] == 'VEC3':
            vals = struct.unpack_from('<%df' % (a['count'] * 3), blob, v['byteOffset'])
            xs = vals[0::3]
            assert abs(min(xs) - a['min'][0]) < 1e-4 and abs(max(xs) - a['max'][0]) < 1e-4, 'min/max mismatch'
    prim = g['meshes'][0]['primitives'][0]
    n = g['accessors'][prim['attributes']['POSITION']]['count']
    ia = g['accessors'][prim['indices']]
    assert ia['count'] % 3 == 0
    raw = blob[g['bufferViews'][ia['bufferView']]['byteOffset']:][:ia['count'] * 4]
    idx = struct.unpack('<%dI' % ia['count'], raw)
    assert max(idx) < n, 'index out of range'
    return {'verts': n, 'tris': ia['count'] // 3, 'images': len(g.get('images', [])), 'bytes': len(data)}


# ---- TS / manifest output ---------------------------------------------------------------------------
def write_ts(manifest, meta):
    lines = [
        '/* Generated by tools/optimize_assets.py. Do not edit by hand. */',
        '/* eslint-disable */',
        '',
        'export interface AssetFile {',
        '  /** path relative to the assets root, e.g. "cards/M001.webp" */',
        '  path: string;',
        '  bytes: number;',
        '  w?: number;',
        '  h?: number;',
        '  /** TTS deck id the image was cropped from (sheet records only) */',
        '  deck?: string;',
        '  /** row-major cell index within that deck sheet */',
        '  idx?: number;',
        '}',
        '',
        'export interface CardFile extends AssetFile {',
        '  /** key of the back image in CARDS (cardBackUrl) */',
        '  back?: string;',
        '}',
        '',
        'export interface ModelFile extends AssetFile {',
        '  extent: [number, number, number];',
        '  sourceExtent: number;',
        '  textured: boolean;',
        '  tris: number;',
        '  flipped: boolean;',
        '}',
        '',
        'export interface AudioFile extends AssetFile {',
        '  title?: string;',
        '}',
        '',
        "const BASE: string = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL) ?? '/';",
        '',
        'function assetUrl(path: string): string {',
        "  return BASE + 'assets/' + path;",
        '}',
        '',
        '/** card faces (key = our card id), unique backs (`<id>_back`) and shared backs (`back_<family>`) */',
        'const CARDS: Record<string, CardFile> = ' + json.dumps(manifest['cards'], indent=1, sort_keys=True) + ';',
        '/** Custom_Token images; second sides are `<key>_back` */',
        'const TOKENS: Record<string, AssetFile> = ' + json.dumps(manifest['tokens'], indent=1, sort_keys=True) + ';',
        '/** Custom_Tile images (buildings, map tiles N##/F##, status tiles) */',
        'const TILES: Record<string, AssetFile> = ' + json.dumps(manifest['tiles'], indent=1, sort_keys=True) + ';',
        '/** CardCustom boards and large board panels */',
        'const BOARDS: Record<string, AssetFile> = ' + json.dumps(manifest['boards'], indent=1, sort_keys=True) + ';',
        '/** 3D models as binary glTF (Y-up, centred, largest extent = 1) */',
        'const MODELS: Record<string, ModelFile> = ' + json.dumps(manifest['models'], indent=1, sort_keys=True) + ';',
        '/** audio tracks */',
        'const AUDIO: Record<string, AudioFile> = ' + json.dumps(manifest['audio'], indent=1, sort_keys=True) + ';',
        '/** PDFs shipped in this build */',
        'export const pdfs: Record<string, AssetFile> = ' + json.dumps(manifest['pdf'], indent=1, sort_keys=True) + ';',
        '',
        '/** logical keys that could not be produced from assets_src (UI must fall back) */',
        'export const unresolvedAssets: readonly string[] = ' + json.dumps(meta['unresolved'], indent=1) + ';',
        '',
        'export function cardUrl(id: string): string | undefined {',
        '  const e = CARDS[id];',
        '  return e ? assetUrl(e.path) : undefined;',
        '}',
        '',
        '/** back image for a card id (its own `<id>_back` or the shared family back) */',
        'export function cardBackUrl(id: string): string | undefined {',
        '  const e = CARDS[id];',
        '  if (!e) return undefined;',
        '  if (e.back) {',
        '    const b = CARDS[e.back];',
        '    return b ? assetUrl(b.path) : undefined;',
        '  }',
        '  return undefined;',
        '}',
        '',
        'export function tokenUrl(key: string): string | undefined {',
        '  const e = TOKENS[key];',
        '  return e ? assetUrl(e.path) : undefined;',
        '}',
        '',
        'export function tileUrl(key: string): string | undefined {',
        '  const e = TILES[key];',
        '  return e ? assetUrl(e.path) : undefined;',
        '}',
        '',
        'export function boardUrl(key: string): string | undefined {',
        '  const e = BOARDS[key];',
        '  return e ? assetUrl(e.path) : undefined;',
        '}',
        '',
        'export function modelUrl(key: string): string | undefined {',
        '  const e = MODELS[key];',
        '  return e ? assetUrl(e.path) : undefined;',
        '}',
        '',
        'export function modelInfo(key: string): (ModelFile & { url: string }) | undefined {',
        '  const e = MODELS[key];',
        '  return e ? { ...e, url: assetUrl(e.path) } : undefined;',
        '}',
        '',
        'export function audioUrl(key: string): string | undefined {',
        '  const e = AUDIO[key];',
        '  return e ? assetUrl(e.path) : undefined;',
        '}',
        '',
        'export function pdfUrl(key: string): string | undefined {',
        '  const e = pdfs[key];',
        '  return e ? assetUrl(e.path) : undefined;',
        '}',
        '',
        '/** all keys, for tests and preloading */',
        'export const manifest = { cards: CARDS, tokens: TOKENS, tiles: TILES, boards: BOARDS, models: MODELS, audio: AUDIO, pdfs } as const;',
        '',
    ]
    os.makedirs(os.path.dirname(TS_OUT), exist_ok=True)
    with open(TS_OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))


def prune(valid_rels):
    for cat in CATEGORIES:
        d = os.path.join(PUB, cat)
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            rel = cat + '/' + f
            if rel not in valid_rels:
                os.remove(os.path.join(d, f))


def run_build(all_pdfs):
    os.makedirs(PUB, exist_ok=True)
    src = Sources()
    cache = Cache()
    b = Builder(src, cache)
    n_cards = b.build_cards()
    b.build_map_tiles()
    b.build_tiles()
    b.build_models()
    b.build_audio()
    b.build_pdfs(all_pdfs)
    # keep cache for used keys only
    unresolved = list(b.unresolved)
    rels = set()
    for cat in CATEGORIES:
        for k, v in b.manifest[cat].items():
            if isinstance(v, dict) and 'path' in v:
                rels.add(v['path'])
    for k, v in b.manifest['cards'].items():
        rels.add(v['path'])
    prune(rels)
    cache.save()
    total = 0
    counts = {}
    for cat in CATEGORIES:
        counts[cat] = len(b.manifest[cat])
    for dirpath, _, files in os.walk(PUB):
        for f in files:
            total += os.path.getsize(os.path.join(dirpath, f))
    meta = {
        'version': VERSION,
        'generatedBy': 'tools/optimize_assets.py',
        'totalBytes': total,
        'counts': counts,
        'unresolved': sorted(set(unresolved)),
        'skipped': b.skipped,
        'missingImageUrls': sorted(set(src.missing)),
    }
    out = {'meta': meta}
    out.update(b.manifest)
    out['cards'] = b.manifest['cards']
    with open(os.path.join(PUB, 'manifest.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, indent=1, sort_keys=True)
    write_ts(b.manifest, meta)
    print('cards %d (faces+backs %d)  tokens %d  tiles %d  boards %d  models %d  audio %d  pdf %d'
          % (n_cards, len(b.manifest['cards']), counts['tokens'], counts['tiles'], counts['boards'],
             counts['models'], counts['audio'], counts['pdf']))
    print('written %d reused %d total %.1f MB' % (b.written, b.reused, total / 1048576.0))
    if meta['skipped']:
        print('skipped pdfs: %s' % ', '.join(s['pdf'] for s in meta['skipped']))
    for u in meta['unresolved']:
        print('UNRESOLVED', u)


def verify():
    mf = json.load(open(os.path.join(PUB, 'manifest.json'), encoding='utf-8'))
    bad = 0
    for cat in CATEGORIES:
        for k, v in mf.get(cat, {}).items():
            if 'path' in v and not os.path.exists(os.path.join(PUB, v['path'])):
                print('MISSING file', v['path'])
                bad += 1
    for k, v in mf['models'].items():
        info = validate_glb(os.path.join(PUB, v['path']))
        print('glb ok', k, info)
    print('manifest check: %d missing' % bad)
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--all-pdfs', action='store_true', help='also ship the advisor responsibility sheets')
    ap.add_argument('--verify', action='store_true')
    args = ap.parse_args()
    if args.verify:
        sys.exit(1 if verify() else 0)
    run_build(args.all_pdfs)
    verify()


if __name__ == '__main__':
    main()
