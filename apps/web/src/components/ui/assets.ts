// Defensive access to the asset manifest written by the ASSETS agent (src/assets/manifest.ts).
// The manifest is loaded with an eager glob, so a missing file never breaks the build: every helper then
// returns undefined and the caller draws its procedural fallback instead.

type Manifest = Record<string, unknown>;
type UrlFn = (key: string) => unknown;

const modules = import.meta.glob(
  ['../../assets/manifest.ts', '../../assets/manifest.tsx', '../../assets/manifest.js'],
  { eager: true },
) as Record<string, Manifest>;

const manifest: Manifest = (Object.values(modules)[0] as Manifest | undefined) ?? {};

function callUrl(name: string, key: string): string | undefined {
  const f = manifest[name];
  if (typeof f !== 'function') return undefined;
  try {
    const u = (f as UrlFn)(key);
    return typeof u === 'string' && u.length > 0 ? u : undefined;
  } catch {
    return undefined;
  }
}

function urlOf(v: unknown): string | undefined {
  if (typeof v === 'string' && v) return v;
  if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') {
    return (v as { url: string }).url;
  }
  return undefined;
}

/** Image of a card by our card id (M001, D012, L03A, T05, C07, X12, W03, S08 ...). */
export function cardImageUrl(id: string): string | undefined {
  return callUrl('cardUrl', id);
}

/** Token artwork by key (citizen, hope, discontent, resource, ...). */
export function tokenImageUrl(key: string): string | undefined {
  return callUrl('tokenUrl', key);
}

/** Tile artwork by key (building tile faces and their flip sides, the generator tile, scenario tiles). */
export function tileImageUrl(key: string): string | undefined {
  return callUrl('tileUrl', key);
}

/** Artwork for a reference that names a tile face or a token (see data/buildingInfo.ts). */
export function artImageUrl(art: { tile?: string; token?: string } | undefined): string | undefined {
  if (!art) return undefined;
  if (art.tile) return tileImageUrl(art.tile);
  if (art.token) return tokenImageUrl(art.token);
  return undefined;
}

/** Board artwork by key (generator, buildings, scenario boards ...). */
export function boardImageUrl(key: string): string | undefined {
  return callUrl('boardUrl', key);
}

/** GLB model by key. */
export function modelUrl(key: string): string | undefined {
  return callUrl('modelUrl', key);
}

/** Sound by key. */
export function audioUrl(key: string): string | undefined {
  return callUrl('audioUrl', key);
}

/** Ambient loop: the 'ambient' key, else the first audio key. */
export function ambientTrackUrl(): string | undefined {
  const direct = callUrl('audioUrl', 'ambient');
  if (direct) return direct;
  const audio = manifest.audio;
  if (audio && typeof audio === 'object') {
    const first = Object.keys(audio as Record<string, unknown>)[0];
    if (first) return callUrl('audioUrl', first);
  }
  return undefined;
}

interface ManifestIndex {
  cards?: Record<string, { back?: string }>;
  models?: Record<string, unknown>;
}

/** Boards the first screens draw at once: warmed by the loading screen. */
const CRITICAL_BOARDS = ['board_generator', 'board_round_track', 'board_heat_track'] as const;

/**
 * What the loading screen warms before the menu: the critical board images, one face-down back per card family and
 * every GLB model of the scene. Only URLs the manifest actually has are returned (no entry, no request).
 */
export function warmupTargets(): { images: string[]; models: string[] } {
  const index = (manifest.manifest ?? {}) as ManifestIndex;
  const images: string[] = [];
  const add = (u: string | undefined) => {
    if (u && !images.includes(u)) images.push(u);
  };
  for (const key of CRITICAL_BOARDS) add(boardImageUrl(key));
  const families = new Set<string>();
  for (const [id, card] of Object.entries(index.cards ?? {})) {
    if (!card.back || families.has(card.back)) continue;
    families.add(card.back);
    add(callUrl('cardBackUrl', id));
  }
  const models = Object.keys(index.models ?? {})
    .map((key) => modelUrl(key))
    .filter((u): u is string => Boolean(u));
  return { images, models };
}

/** Rulebook PDF URL from the manifest's `pdfs` (a map, an array or a single entry). */
export function rulebookPdfUrl(): string | undefined {
  // the generated manifest exposes pdfUrl(key); its `pdfs` records hold paths, not URLs
  const direct = callUrl('pdfUrl', 'frostpunk_rulebook');
  if (direct) return direct;
  const pdfs = manifest.pdfs;
  if (Array.isArray(pdfs)) return urlOf(pdfs[0]);
  if (pdfs && typeof pdfs === 'object') {
    const entries = Object.entries(pdfs as Record<string, unknown>);
    const hit = entries.find(([k]) => /rule/i.test(k)) ?? entries[0];
    return hit ? urlOf(hit[1]) : undefined;
  }
  return urlOf(pdfs) ?? callUrl('pdfUrl', 'rulebook');
}
