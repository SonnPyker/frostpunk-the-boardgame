// Merges translations into apps/web/src/i18n/vi.json and glossary.json, and checks every placeholder.
//   vi/chunk_*.json   engine-string translations: [{key, vi}] (key is already a template)
//   ui/*.json         UI-string translations:     [{key, vi}] (key is the literal English; normalised here)
//   glossary.json     [{en, vi}] Vietnamese glosses for the kept-in-English terms
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rd = (p) => JSON.parse(readFileSync(here + p, 'utf8'));

const normalise = (en) => {
  let p = 0;
  const s = en.replace(/\bP[1-4]\b/g, () => '{P}');
  let k = 0;
  return s.replace(/(?<![A-Za-z])\d+/g, () => `{${k++}}`);
  void p;
};
const ph = (s) => {
  const nums = [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort();
  const players = (s.match(/\{P\}/g) ?? []).length;
  return JSON.stringify({ nums, players });
};

const dict = {};
const problems = [];
const add = (src, items, fromKeys) => {
  for (const it of items) {
    const key = fromKeys ? normalise(it.key) : it.key;
    if (!it.vi || typeof it.vi !== 'string') { problems.push(`${src}: empty vi for ${key}`); continue; }
    if (ph(key) !== ph(it.vi)) problems.push(`${src}: placeholder mismatch ${key} -> ${it.vi}`);
    if (key in dict && dict[key] !== it.vi) problems.push(`${src}: conflicting translation for ${key}`);
    dict[key] = it.vi;
  }
};
const viDir = here + 'vi';
for (const f of readdirSync(viDir).filter((x) => x.endsWith('.json')).sort()) add('vi/' + f, rd('vi/' + f), false);
const uiDir = here + 'ui';
if (existsSync(uiDir)) for (const f of readdirSync(uiDir).filter((x) => x.endsWith('.json')).sort()) add('ui/' + f, rd('ui/' + f), true);

const gl = existsSync(here + 'glossary.json') ? rd('glossary.json') : [];
const glossary = Object.fromEntries(gl.map((g) => [g.en, g.vi]));

const webDir = new URL('../../apps/web/src/i18n/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
writeFileSync(webDir + 'vi.json', JSON.stringify(Object.fromEntries(Object.entries(dict).sort()), null, 1) + '\n', 'utf8');
writeFileSync(webDir + 'glossary.json', JSON.stringify(glossary, null, 1) + '\n', 'utf8');
console.log(JSON.stringify({ entries: Object.keys(dict).length, glossary: Object.keys(glossary).length, problems: problems.length }, null, 1));
for (const p of problems.slice(0, 80)) console.log('  ' + p);
