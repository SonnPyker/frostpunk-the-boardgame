"""Crop cards out of TTS sprite sheets.

usage:
  python -I tools/sheet.py view <deckId> <startIdx> <count> [perRow=3] [scale=1.0]
      -> writes scratch/view_<deckId>_<start>.jpg  (cards side by side, index labelled)
  python -I tools/sheet.py export <deckId> <outDir> [maxW=512]
      -> writes <outDir>/<deckId>_<idx>.webp for every card
  python -I tools/sheet.py back <deckId>   -> scratch/back_<deckId>.jpg
Card index = position in sheet, row-major from top-left (TTS CardID % 100).
"""
import json, os, re, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.join(ROOT, 'assets_src', 'mod', 'frostpunk_tts_mod.json')
IMG = os.path.join(ROOT, 'assets_src', 'images')
SCR = os.path.join(ROOT, 'scratch')


def norm(url):
    return re.sub(r'[^A-Za-z0-9]', '', url)


def index_files():
    m = {}
    for f in os.listdir(IMG):
        m[os.path.splitext(f)[0]] = os.path.join(IMG, f)
    return m


def load_decks():
    d = json.load(open(MOD, encoding='utf-8'))
    decks = {}

    def walk(objs):
        for o in objs:
            for k, v in (o.get('CustomDeck') or {}).items():
                decks[int(k)] = v
            walk(o.get('ContainedObjects', []))
    walk(d['ObjectStates'])
    return decks


def card(deck, files, idx, which='FaceURL'):
    im = Image.open(files[norm(deck[which])]).convert('RGB')
    cw, ch = im.size[0] // deck['NumWidth'], im.size[1] // deck['NumHeight']
    r, c = divmod(idx, deck['NumWidth'])
    return im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))


def main():
    cmd = sys.argv[1]
    decks, files = load_decks(), index_files()
    os.makedirs(SCR, exist_ok=True)
    did = int(sys.argv[2])
    deck = decks[did]
    n = deck['NumWidth'] * deck['NumHeight']
    if cmd == 'view':
        start, count = int(sys.argv[3]), int(sys.argv[4])
        per = int(sys.argv[5]) if len(sys.argv) > 5 else 3
        scale = float(sys.argv[6]) if len(sys.argv) > 6 else 1.0
        which = 'BackURL' if os.environ.get('SHEET_BACK') else 'FaceURL'
        cards = [(i, card(deck, files, i, which)) for i in range(start, min(start + count, n))]
        cw, ch = cards[0][1].size
        rows = (len(cards) + per - 1) // per
        W, H = int(cw * per * scale), int(ch * rows * scale)
        sheet = Image.new('RGB', (W, H), (20, 20, 20))
        dr = ImageDraw.Draw(sheet)
        for k, (i, im) in enumerate(cards):
            im = im.resize((int(cw * scale), int(ch * scale)))
            x, y = (k % per) * im.size[0], (k // per) * im.size[1]
            sheet.paste(im, (x, y))
            dr.rectangle((x, y, x + 90, y + 34), fill=(255, 0, 0))
            dr.text((x + 6, y + 8), f'#{i}', fill=(255, 255, 255))
        out = os.path.join(SCR, f'view_{did}_{start}{"b" if which=="BackURL" else ""}.jpg')
        sheet.save(out, quality=88)
        print(out, sheet.size)
    elif cmd == 'crop':
        # crop <deck> <idx> <x0> <y0> <x1> <y1> [scale]  (fractions of the card)
        idx = int(sys.argv[3]); x0, y0, x1, y1 = [float(v) for v in sys.argv[4:8]]
        scale = float(sys.argv[8]) if len(sys.argv) > 8 else 1.0
        im = card(deck, files, idx); w, h = im.size
        im = im.crop((int(w*x0), int(h*y0), int(w*x1), int(h*y1)))
        im = im.resize((int(im.size[0]*scale), int(im.size[1]*scale)))
        out = os.path.join(SCR, f'crop_{did}_{idx}.png'); im.save(out); print(out, im.size)
    elif cmd == 'back':
        out = os.path.join(SCR, f'back_{did}.jpg')
        Image.open(files[norm(deck['BackURL'])]).convert('RGB').save(out, quality=85)
        print(out)
    elif cmd == 'export':
        outdir = sys.argv[3]
        maxw = int(sys.argv[4]) if len(sys.argv) > 4 else 512
        os.makedirs(outdir, exist_ok=True)
        for i in range(n):
            im = card(deck, files, i)
            if im.size[0] > maxw:
                im = im.resize((maxw, int(im.size[1] * maxw / im.size[0])), Image.LANCZOS)
            im.save(os.path.join(outdir, f'{did}_{i:02d}.webp'), quality=82)
        print('exported', n)


if __name__ == '__main__':
    main()
