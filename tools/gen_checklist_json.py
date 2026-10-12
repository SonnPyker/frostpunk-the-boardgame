#!/usr/bin/env python3
"""Builds apps/web/public/checklist.json from docs/RULES_CHECKLIST.md.

The Rules overlay (apps/web/src/screens/Overlays.tsx) shows the progress of each section.
Input lines look like:   - [x] SET-01 Scenario selection ... **Auto**
Sections are the "## " and "### " headings of the checklist.

Usage (from the repo root):  python -I tools/gen_checklist_json.py
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'docs', 'RULES_CHECKLIST.md')
OUT = os.path.join(ROOT, 'apps', 'web', 'public', 'checklist.json')

STATUS = {'[ ]': 'open', '[~]': 'partial', '[x]': 'done'}
ITEM = re.compile(r'^\s*-\s*\[( |~|x|X)\]\s+([A-Z]{2,5}-[A-Z0-9-]*\d[A-Z0-9-]*)\s+(.*)$')
HEAD = re.compile(r'^(#{2,3})\s+(.*)$')


def parse(text: str):
    sections = []
    cur = None
    for line in text.splitlines():
        h = HEAD.match(line)
        if h:
            title = h.group(2).strip()
            cur = {'title': title, 'items': []}
            sections.append(cur)
            continue
        m = ITEM.match(line)
        if not m:
            continue
        if cur is None:
            cur = {'title': 'Rules', 'items': []}
            sections.append(cur)
        mark = '[' + m.group(1).lower() + ']'
        cur['items'].append({
            'id': m.group(2),
            'status': STATUS.get(mark, 'open'),
            'text': re.sub(r'\*\*', '', m.group(3)).strip(),
        })
    return [s for s in sections if s['items']]


def main() -> int:
    with open(SRC, encoding='utf-8') as f:
        sections = parse(f.read())
    items = [i for s in sections for i in s['items']]
    counts = {k: sum(1 for i in items if i['status'] == k) for k in ('open', 'partial', 'done')}
    doc = {
        'source': 'docs/RULES_CHECKLIST.md',
        'legend': {'open': '[ ]', 'partial': '[~]', 'done': '[x]'},
        'counts': {'total': len(items), **counts},
        'sections': sections,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f"checklist.json: {len(items)} items in {len(sections)} sections "
          f"(open {counts['open']}, partial {counts['partial']}, done {counts['done']})")
    return 0


if __name__ == '__main__':
    sys.exit(main())
