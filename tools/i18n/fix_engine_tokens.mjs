// One-shot repair of Vietnamese values that still show raw engine condition tokens (active:anger, !built:fightingArena,
// toCard:supply:{0}). The English keys keep the tokens (they match the engine text); only the Vietnamese values change.
// Run once from the repo root: node tools/i18n/fix_engine_tokens.mjs. Safe to re-run (it is idempotent).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const COND = { anger: 'Anger', apathy: 'Apathy', greed: 'Greed', care: 'Care', justice: 'Justice', motivation: 'Motivation' };
const BUILD = {
  careHouse: 'Nhà chăm sóc',
  childShelter: 'Nơi trú ẩn cho trẻ em',
  publicHouse: 'Quán rượu công cộng',
  fightingArena: 'Đấu trường',
};

function fixVi(s) {
  return s
    .replace(/toCard:supply:(\{\d\})/g, 'chuyển $1 Tài nguyên từ kho lên thẻ Sự kiện hiện tại')
    .replace(/!active:([a-z]+)/g, (_, c) => `${COND[c] ?? c} không hoạt động`)
    .replace(/active:([a-z]+)/g, (_, c) => `${COND[c] ?? c} đang hoạt động`)
    .replace(/!built:([A-Za-z]+)/g, (_, b) => `chưa xây ${BUILD[b] ?? b}`)
    .replace(/built:([A-Za-z]+)/g, (_, b) => `đã xây ${BUILD[b] ?? b}`);
}

let changed = 0;
for (const sub of ['vi', 'ui']) {
  const dir = join(here, sub);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const p = join(dir, f);
    const arr = JSON.parse(readFileSync(p, 'utf8'));
    let touched = false;
    for (const it of arr) {
      const next = fixVi(it.vi);
      if (next !== it.vi) { it.vi = next; touched = true; changed++; }
    }
    if (touched) writeFileSync(p, JSON.stringify(arr, null, 1), 'utf8');
  }
}

// Building name that the translators left in English.
const CARE_HOUSE = [
  ['Care House', 'Nhà chăm sóc'],
  ['Care House (1 Wood)', 'Nhà chăm sóc ({0} Gỗ)'],
];
const shared = join(here, 'ui', 'shared.json');
const sh = JSON.parse(readFileSync(shared, 'utf8'));
const have = new Set(sh.map((x) => x.key));
for (const [key, vi] of CARE_HOUSE) if (!have.has(key)) sh.push({ key, vi });
writeFileSync(shared, JSON.stringify(sh, null, 1), 'utf8');

console.log(JSON.stringify({ valuesFixed: changed }));
