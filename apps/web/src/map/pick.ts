// Map object identity: canonical pick ids, option-id normalisation, world <-> board lookups and hover text.
//
// Canonical pick ids (what the scene reports and what highlights are matched against):
//   space    'N03:top'  (also 'GEN:T', 'GEN:UR', 'GEN:LR', 'GEN:LL', 'GEN:UL')
//   building 'b:<uid>'
//   meeple   'm:<id>'
//   tile     'tile:<key>'  (key "q,r" or "GEN"; only reported for the generator centre)
//   hex      'hex:<q,r>'   (an empty board hex: reported for any empty ground, so a tileSlot option can be clicked)
import { buildings as buildingDefs } from '@frostpunk/engine';
import type { GameState, Meeple, MapTile, Building } from '@frostpunk/engine';
import { GEN_SLOT_OFFSET, halfXz, hexXz, genSlotAxial, tileZone, zoneHeated, worldToAxial, type Xz, type Slot } from './hex';
import { INS_NAME, MEEPLE_NAME } from './palette';
import { t } from '../i18n';
import { buildingText } from '../data/buildingInfo';

export interface PickInfo {
  id: string;
  title: string;
  lines: string[];
}

const SLOT_OF = (sp: string): Slot => (sp === 'top' ? 'top' : 'bottom');

export function tileOfSpace(s: GameState, spaceId: string): MapTile | undefined {
  const sp = s.spaces[spaceId];
  if (!sp || sp.tile === 'GEN') return undefined;
  return s.tiles.find((t) => t.key === sp.tile);
}

/** Centre of the space: the centroid of its half for map tiles, the hex centre for generator spaces. */
export function spaceXz(s: GameState, spaceId: string): Xz | null {
  const sp = s.spaces[spaceId];
  if (!sp) return null;
  if (sp.tile === 'GEN') {
    const a = genSlotAxial(s.genCentre, sp.slot);
    return a ? hexXz(a[0], a[1]) : null;
  }
  const t = tileOfSpace(s, spaceId);
  return t ? halfXz(t.q, t.r, SLOT_OF(sp.slot)) : null;
}

/** Centre of the tile (or generator hex) that holds the space. */
export function spaceTileCentre(s: GameState, spaceId: string): Xz | null {
  const sp = s.spaces[spaceId];
  if (!sp) return null;
  if (sp.tile === 'GEN') return spaceXz(s, spaceId);
  const t = tileOfSpace(s, spaceId);
  return t ? hexXz(t.q, t.r) : null;
}

export function buildingCentre(s: GameState, b: Building): Xz | null {
  if (!b.spaces.length) return null;
  const large = b.spaces.length >= 2;
  return large ? spaceTileCentre(s, b.spaces[0]) : spaceXz(s, b.spaces[0]);
}

export function isLargeBuilding(b: Building): boolean {
  return b.spaces.length >= 2 || buildingDefs[b.kind]?.size === 'L';
}

/** Where every meeple standing on a board space is drawn (ring around the space centre). Keyed by meeple id. */
export function meepleSpots(s: GameState): Map<number, Xz> {
  const bySpace = new Map<string, Meeple[]>();
  for (const m of s.meeples) {
    const sid = visibleSpaceOf(m);
    if (!sid) continue;
    const list = bySpace.get(sid) ?? [];
    list.push(m);
    bySpace.set(sid, list);
  }
  const out = new Map<number, Xz>();
  for (const [sid, list] of bySpace) {
    const c = spaceXz(s, sid);
    if (!c) continue;
    list.sort((a, b) => a.id - b.id);
    const n = list.length;
    list.forEach((m, i) => {
      const ang = n === 1 ? Math.PI * 0.25 : (i * Math.PI * 2) / n + Math.PI * 0.25;
      const rad = n === 1 ? 0.3 : 0.34;
      out.set(m.id, { x: c.x + Math.cos(ang) * rad, z: c.z + Math.sin(ang) * rad });
    });
  }
  return out;
}

/** The space a meeple is drawn on, or null when it is in supply, on a card, in the expedition, etc. */
export function visibleSpaceOf(m: Meeple): string | null {
  if (m.loc.k === 'space' && m.loc.space) return m.loc.space;
  if (m.loc.k === 'sleep' && m.loc.space) return m.loc.space;
  return null;
}

/** Canonical pick id under a world point on the board plane (or null). */
export function worldToPick(s: GameState, x: number, z: number): string | null {
  const [q, r] = worldToAxial(x, z);
  // generator tile
  const gc = s.genCentre;
  if (q === gc[0] && r === gc[1]) return 'tile:GEN';
  for (const [slot, [dq, dr]] of Object.entries(GEN_SLOT_OFFSET)) {
    if (gc[0] + dq === q && gc[1] + dr === r) return `GEN:${slot}`;
  }
  // map tiles
  const key = `${q},${r}`;
  const t = s.tiles.find((tt) => tt.kind !== 'gen' && tt.key === key);
  if (!t) return 'hex:' + key;
  const cz = hexXz(q, r).z;
  const slot = z - cz < 0 ? 'top' : 'bottom';
  const sid = t.spaces.find((id) => s.spaces[id]?.slot === slot);
  return sid ?? 'tile:' + key;
}

/**
 * Normalise an option id from a Decision (space ids, building uids, meeple ids, tile ids or keys) to the canonical pick id.
 * Prefixed ids ('b:12', 'm:3') are authoritative. Bare numbers resolve to a building uid first, then a meeple id.
 */
export function resolvePickId(s: GameState, optionId: string): string | null {
  if (!optionId) return null;
  if (s.spaces[optionId]) return optionId;
  if (optionId.startsWith('b:')) {
    const uid = Number(optionId.slice(2));
    return s.buildings.some((b) => b.uid === uid) ? `b:${uid}` : null;
  }
  if (optionId.startsWith('m:')) {
    const id = Number(optionId.slice(2));
    return s.meeples.some((m) => m.id === id) ? `m:${id}` : null;
  }
  if (optionId.startsWith('tile:')) return optionId;
  if (/^-?\d+$/.test(optionId)) {
    const n = Number(optionId);
    if (s.buildings.some((b) => b.uid === n)) return `b:${n}`;
    if (s.meeples.some((m) => m.id === n)) return `m:${n}`;
    return null;
  }
  if (optionId === 'GEN') return 'tile:GEN';
  const tile = s.tiles.find((t) => t.id === optionId || t.key === optionId);
  if (tile) return 'tile:' + tile.key;
  // an empty hex named by "q,r" (tileSlot options)
  if (/^-?\d+,-?\d+$/.test(optionId)) return 'hex:' + optionId;
  return null;
}

/** Board-plane centre of a canonical pick id (used for highlight markers and focus). */
export function pickCentre(s: GameState, id: string, meeples: Map<number, Xz>): Xz | null {
  if (id.startsWith('m:')) return meeples.get(Number(id.slice(2))) ?? null;
  if (id.startsWith('b:')) {
    const b = s.buildings.find((x) => x.uid === Number(id.slice(2)));
    return b ? buildingCentre(s, b) : null;
  }
  if (id.startsWith('tile:')) {
    const key = id.slice(5);
    if (key === 'GEN') return hexXz(s.genCentre[0], s.genCentre[1]);
    const [q, r] = key.split(',').map(Number);
    return Number.isFinite(q) && Number.isFinite(r) ? hexXz(q, r) : null;
  }
  if (id.startsWith('hex:')) {
    const [q, r] = id.slice(4).split(',').map(Number);
    return Number.isFinite(q) && Number.isFinite(r) ? hexXz(q, r) : null;
  }
  return spaceXz(s, id);
}

/** Insulation colour key of a building as shown on the map (ruins flip to Blue). */
export function insulationOf(b: Building): string {
  if (b.ruins) return 'B';
  const def = buildingDefs[b.kind];
  if (!def) return 'W';
  return b.upgraded && def.upgIns ? def.upgIns : def.ins;
}

function meepleKindName(kind: string): string {
  return t(MEEPLE_NAME[kind] ?? kind);
}

function buildingName(kind: string): string {
  return t(buildingDefs[kind]?.name ?? kind);
}

/** Title and short lines for the hover tooltip. */
export function describePick(s: GameState, id: string): PickInfo | null {
  if (id.startsWith('b:')) {
    const b = s.buildings.find((x) => x.uid === Number(id.slice(2)));
    if (!b) return null;
    const def = buildingDefs[b.kind];
    const lines = [
      isLargeBuilding(b) ? t('Large building') : t('Small building'),
      t('Insulation') + ': ' + t(INS_NAME[insulationOf(b)]),
    ];
    const effect = buildingText(b);
    if (effect) lines.unshift(t(effect));
    if (b.upgraded) lines.push(t('Upgraded'));
    if (b.ruins) lines.push(t('Ruins'));
    if (b.printed) lines.push(t('Printed on the Generator tile'));
    return { id, title: buildingName(b.kind) + (b.ruins ? ' (' + t('ruins') + ')' : ''), lines };
  }
  if (id.startsWith('m:')) {
    const m = s.meeples.find((x) => x.id === Number(id.slice(2)));
    if (!m) return null;
    const where = visibleSpaceOf(m);
    const lines = [where ? t('On') + ' ' + spaceLabel(s, where) : t('Off map')];
    if (m.used) lines.push(t('Already acted this round'));
    if (m.lying) lines.push(t('Asleep'));
    return { id, title: meepleKindName(m.kind), lines };
  }
  if (id.startsWith('tile:')) {
    const key = id.slice(5);
    const tl = key === 'GEN' ? undefined : s.tiles.find((x) => x.key === key);
    if (key === 'GEN') {
      return { id, title: t('Generator'), lines: heatLines(s, 'A') };
    }
    if (!tl) return null;
    const zone = tileZone(s.genCentre, tl.q, tl.r);
    return { id, title: tl.id, lines: [t(tl.kind + ' tile'), ...heatLines(s, zone)] };
  }
  if (id.startsWith('hex:')) {
    const [q, r] = id.slice(4).split(',').map(Number);
    if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
    return { id, title: t('Free hex'), lines: [t('Coordinates') + ': ' + q + ', ' + r] };
  }
  const sp = s.spaces[id];
  if (!sp) return null;
  const lines: string[] = [];
  const res = (['wood', 'coal', 'core'] as const)
    .filter((k) => (sp.res[k] ?? 0) > 0)
    .map((k) => `${t(k)} ${sp.res[k]}`);
  lines.push(res.length ? res.join(' · ') : t('No resources'));
  if (sp.trees) lines.push(t('Trees') + ' ' + sp.trees);
  if (sp.building != null) {
    const b = s.buildings.find((x) => x.uid === sp.building);
    lines.push(b ? t('Building') + ': ' + buildingName(b.kind) : t('Building'));
  } else {
    lines.push(t('Empty space'));
  }
  const zone = sp.tile === 'GEN' ? 'A' : tileOfSpace(s, id) ? tileZone(s.genCentre, tileOfSpace(s, id)!.q, tileOfSpace(s, id)!.r) : null;
  lines.push(...heatLines(s, zone));
  return { id, title: spaceLabel(s, id), lines };
}

function heatLines(s: GameState, zone: 'A' | 'B' | 'C' | null): string[] {
  if (!zone) return [t('Outside the heat zones')];
  const heated = zoneHeated(s.gen, zone);
  return [t('Zone') + ' ' + zone + ' · ' + t(heated ? 'heated' : 'cold')];
}

/** Human label for a space id, e.g. "N03 top" or "Generator (LR)". */
export function spaceLabel(s: GameState, spaceId: string): string {
  const sp = s.spaces[spaceId];
  if (!sp) return spaceId;
  if (sp.tile === 'GEN') return `${t('Generator')} ${sp.slot}`;
  const tl = tileOfSpace(s, spaceId);
  return `${tl?.id ?? sp.tile} ${t(sp.slot)}`;
}
