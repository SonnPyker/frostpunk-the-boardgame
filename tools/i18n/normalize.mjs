// Collapses numeric and player-name variants into templates: "Hope +2" -> "Hope +{0}", "P1 passes" -> "{P} passes".
import { readFileSync, writeFileSync } from 'node:fs';
const src = JSON.parse(readFileSync(new URL('./strings.json', import.meta.url), 'utf8'));
const tpl = (en) => {
  let k = 0;
  let t = en.replace(/\bP[1-4]\b/g, '{P}');
  t = t.replace(/(?<![A-Za-z])\d+/g, () => `{${k++}}`);
  return t;
};
const groups = new Map();
for (const r of src) {
  const key = tpl(r.en);
  let g = groups.get(key);
  if (!g) { g = { key, en: r.en, cats: new Set(), variants: 0, example: r.example }; groups.set(key, g); }
  g.variants++;
  for (const c of r.cats) g.cats.add(c.split(':')[0]);
}
const out = [...groups.values()].map((g) => ({ key: g.key, example: g.en, cats: [...g.cats].sort(), variants: g.variants })).sort((a, b) => a.key.localeCompare(b.key));
writeFileSync(new URL('./templates.json', import.meta.url), JSON.stringify(out, null, 1), 'utf8');
const bycat = {};
for (const o of out) for (const c of o.cats) bycat[c] = (bycat[c] ?? 0) + 1;
console.log(JSON.stringify({ raw: src.length, templates: out.length, bycat }, null, 1));
