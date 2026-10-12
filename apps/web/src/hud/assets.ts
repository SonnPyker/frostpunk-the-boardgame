// Defensive access to the ASSETS agent's manifest (apps/web/src/assets/manifest.ts).
// import.meta.glob with eager loading yields nothing while the file does not exist, so the build never breaks on a
// missing asset; every lookup then returns undefined and the HUD draws its own procedural fallback.

type ManifestFn = (key: string) => string | undefined;
type Manifest = Partial<Record<'cardUrl' | 'cardBackUrl' | 'tokenUrl' | 'modelUrl' | 'audioUrl' | 'boardUrl', ManifestFn>>;

const modules = import.meta.glob('../assets/manifest.{ts,tsx,js}', { eager: true }) as Record<string, Manifest>;
const manifest: Manifest = (Object.values(modules)[0] ?? {}) as Manifest;

function lookup(fn: keyof Manifest, key: string): string | undefined {
  const f = manifest[fn];
  if (typeof f !== 'function') return undefined;
  try {
    const url = f(key);
    return typeof url === 'string' && url.length > 0 ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Card art (front face) for a card id such as C01, M001, L02, W05, X01, T04, ADV_HEALTH. */
export const cardArt = (id: string): string | undefined => lookup('cardUrl', id);
/** Token art by its bare name, e.g. 'care', 'anger', 'wood', 'coal', 'core', 'steel', 'food', 'citizen-worker'. */
export const tokenArt = (key: string): string | undefined => lookup('tokenUrl', key);
/** Board art by key (board_generator, board_panel_b, ...), drawn as a backdrop behind a HUD panel. */
export const boardArt = (key: string): string | undefined => lookup('boardUrl', key);
/** Face-down back of a card id: its own back, or the shared back of its deck family (M001 -> back_morning). */
export const cardBackArt = (id: string): string | undefined => lookup('cardBackUrl', id);
