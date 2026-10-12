// Walks every effect list in the raw data and reports token heads that no module defines yet.
import '../src/fx/index';
import * as D from '../src/data';
import { hasTok, parseToken } from '../src/fx/core';

const seen = new Map<string, { n: number; ex: string; src: string }>();
const conds = new Map<string, string>();

function visit(item: any, src: string) {
  if (typeof item === 'string') {
    if (item === 'stop') return;
    const { head } = parseToken(item);
    if (!hasTok(head)) {
      const e = seen.get(head);
      if (e) e.n++;
      else seen.set(head, { n: 1, ex: item, src });
    }
    return;
  }
  if (Array.isArray(item)) return item.forEach((x) => visit(x, src));
  if (item && typeof item === 'object') {
    if ('ifPay' in item) visit(item.ifPay, src);
    if ('custom' in item) visit('custom:' + item.custom, src);
    if ('if' in item && typeof item.if === 'string') conds.set(item.if, src);
    for (const k of ['then', 'else', 'fx']) if (item[k]) visit(item[k], src);
    if (item.choose) item.choose.forEach((l: any) => visit(l, src));
    for (const k of ['perActiveHope', 'perActiveDisc', 'activateAllDiscOfType', 'exhaustAllHopeOfType']) {
      if (item[k]) for (const [kk, v] of Object.entries(item[k])) if (kk !== 'order') visit(v, src);
    }
    if (item.spendOr) visit(item.else, src);
  }
}

function card(c: any, src: string) {
  visit(c.top, src);
  for (const o of c.opts ?? []) {
    visit(o.fx, src);
  }
  if (c.eventAction) {
    visit(c.eventAction.fx, src);
    visit(c.eventAction.cost, src);
    if (c.eventAction.custom) visit('custom:' + c.eventAction.custom, src);
  }
  visit(c.eventDusk, src);
  visit(c.eventNight, src);
  for (const k of ['coverLaw', 'passive', 'night', 'weather', 'pack']) if (Array.isArray(c[k])) visit(c[k], src);
  if (c.virtue) for (const v of Object.values(c.virtue)) visit(v, src);
}

for (const c of Object.values(D.morning)) card(c, c.id);
for (const c of Object.values(D.dusk)) card(c, c.id);
for (const c of Object.values(D.lawConsequences)) card(c, c.id);
for (const c of Object.values(D.socialDispute)) {
  for (const k of ['more', 'same', 'yes', 'no']) {
    const v = (c as any)[k];
    if (Array.isArray(v)) visit(v, c.id);
    else if (v && typeof v === 'object') {
      if (v.choose) visit(v, c.id);
      else for (const l of Object.values(v)) visit(l, c.id);
    }
  }
  if (c.fewer) for (const l of Object.values(c.fewer.fx)) visit(l, c.id);
  if (c.yes?.perType) for (const l of Object.values(c.yes.perType)) visit(l, c.id);
}
for (const c of Object.values(D.techs)) card(c, c.id);
for (const c of Object.values(D.laws)) {
  visit(c.intro, c.id);
  for (const v of Object.values(c.perm ?? {}) as any[]) {
    if (v && typeof v === 'object') {
      visit(v.pay, c.id);
      visit(v.fx, c.id);
      for (const l of v.choose ?? []) visit(l, c.id);
    }
  }
}
for (const c of Object.values(D.citizens)) {
  visit(c.fx, c.id);
  visit(c.start, c.id);
}
for (const b of Object.values(D.buildings)) {
  if (b.action) {
    visit(b.action.fx, b.id);
    visit(b.action.cost, b.id);
  }
  if (b.upgAction && typeof b.upgAction === 'object') {
    visit(b.upgAction.fx, b.id);
    visit(b.upgAction.cost, b.id);
  }
  visit(b.onBuild, b.id);
}
for (const c of Object.values(D.expeditions)) {
  for (const o of c.options ?? []) visit(o.fx, c.id);
  visit(c.fx, c.id);
}
visit(D.scenarioCards, 'scenarioCards');
visit(D.scenarios, 'scenarios');
visit(D.scenarioStart, 'scenarioStart');

const rows = [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log(`unknown token heads: ${rows.length}`);
for (const [h, e] of rows) console.log(`${h.padEnd(34)} x${String(e.n).padEnd(3)} ${e.ex.padEnd(50)} ${e.src}`);
