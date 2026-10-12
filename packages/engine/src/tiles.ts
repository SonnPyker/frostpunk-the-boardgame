// Map tiles: Remove Snow and tile placement, Far-tile reordering, and the board set-up per scenario (rulebook p9-10, p25-26).
//
// Conventions:
// * A tile stack (`s.stacks.near` / `s.stacks.far`) is bottom -> top: the TOP tile is the LAST element (pop()), as cards.ts does.
// * Face-down tiles never appear in a pending decision: the player chooses a slot (or top/bottom, or a position in the stack)
//   first, and the tile is taken from the stack only when that answer arrives. Revealed tiles (revealFar3AndReorder) may show ids.
// * Tiles are placed face up immediately; no decision happens between placing and flipping, so the outcome is identical.
import { ask, defOp, log, opt, push, pushSeq } from './core';
import { lawConsequences, mapData } from './data';
import { farSlots, hexKey, nearSlots, placeTileAt, treesOnMap } from './map';
import { pickOne, shuffle } from './rng';
import { gainRes, LIMITS } from './util';
import type { GameState, MapTile } from './types';

export type TileKind = 'near' | 'far';
/** placeTile:<mode> token arguments */
export type PlaceMode = 'far' | 'near' | 'nearElseFar' | 'nearOrFar';
/** removeSnow:<variant> token arguments (citizen-card variants of the Remove Snow action) */
export type SnowVariant = 'normal' | 'drawFar3ChooseOne' | 'nearAndFar' | 'twoFar' | 'oneNearElseFar';

const stackOf = (s: GameState, kind: TileKind) => (kind === 'near' ? s.stacks.near : s.stacks.far);
const slotsOf = (s: GameState, kind: TileKind) => (kind === 'near' ? nearSlots(s) : farSlots(s));

/** a tile of this kind can be placed now: the stack has a tile and there is a legal space */
export function tileAvailable(s: GameState, kind: TileKind): boolean {
  return stackOf(s, kind).length > 0 && slotsOf(s, kind).length > 0;
}

const placeOp = (who: number, kind: TileKind, src?: string, from = 0) => ({ k: 'tilPlace', kind, from, who, src });

// ---- stacks, placing, trees and food --------------------------------------------------------------------

/** Fill both tile stacks from the tile data (face down, shuffled). */
export function initTileStacks(s: GameState) {
  const ids = (deck: string) => mapData.tiles.filter((t: any) => t.deck === deck).map((t: any) => t.id as string);
  s.stacks.near = shuffle(s.rng, ids('near'));
  s.stacks.far = shuffle(s.rng, ids('far'));
}

/**
 * Turn a tile face up at a hex: create its spaces, place Trees and Resources from the bank (Trees are capped by
 * LIMITS.trees) and gain its Food bonus at once.
 */
export function revealTile(s: GameState, id: string, q: number, r: number, kind: TileKind, src?: string): MapTile {
  let bank = LIMITS.trees - treesOnMap(s);
  const t = placeTileAt(s, id, q, r, kind);
  for (const sid of t.spaces) {
    const sp = s.spaces[sid];
    if (sp.trees > bank) sp.trees = Math.max(0, bank);
    bank -= sp.trees;
  }
  log(s, 'tile.place', `${id} placed at (${q}, ${r})`, { id, q, r, kind, src });
  if (t.food > 0) gainRes(s, 'food', t.food);
  return t;
}

// ---- placeTile:<mode> -------------------------------------------------------------------------------------

/** Place a tile as an effect (events, advisors, laws). Modes: far | near | nearElseFar | nearOrFar. */
export function pushPlaceTile(s: GameState, mode: PlaceMode, who: number, src?: string) {
  push(s, { k: 'tilPlaceMode', mode, who, src });
}

defOp('tilPlaceMode', (s, op) => {
  const mode = op.mode as PlaceMode;
  const n = tileAvailable(s, 'near');
  const f = tileAvailable(s, 'far');
  if (mode === 'nearOrFar' && n && f) {
    ask(s, {
      who: op.who,
      kind: 'tileKind',
      prompt: 'Place a Near tile or a Far tile?',
      src: op.src,
      options: [opt('near', 'Near tile (adjacent to the Generator)'), opt('far', 'Far tile (adjacent to a connected tile)')],
      then: { k: 'tilKindPick', who: op.who, src: op.src },
    });
    return;
  }
  let kind: TileKind | null = null;
  if (mode === 'near') kind = n ? 'near' : null;
  else if (mode === 'far') kind = f ? 'far' : null;
  else kind = n ? 'near' : f ? 'far' : null; // nearElseFar, nearOrFar with only one kind possible
  if (!kind) {
    log(s, 'tile.none', 'No tile can be placed', { mode });
    return;
  }
  push(s, placeOp(op.who, kind, op.src));
});

defOp('tilKindPick', (s, op) => {
  push(s, placeOp(op.who, op.pick?.[0] === 'near' ? 'near' : 'far', op.src));
});

/**
 * Place one tile of `kind` from the top of its stack: the player chooses the legal space first; the tile is drawn when
 * the answer arrives. `from` = position from the top of the stack (0 = top), used by Georgia Taller's draw of three.
 */
defOp('tilPlace', (s, op) => {
  const kind = op.kind as TileKind;
  const from = op.from ?? 0;
  if (stackOf(s, kind).length <= from) return;
  const slots = slotsOf(s, kind);
  if (!slots.length) return;
  ask(s, {
    who: op.who,
    kind: 'tileSlot',
    prompt: kind === 'near' ? 'Place the Near tile next to the Generator' : 'Place the Far tile next to a connected tile',
    src: op.src,
    options: slots.map(([q, r]) => opt(`${q},${r}`, `${kind === 'near' ? 'Near' : 'Far'} space (${q}, ${r})`)),
    then: { k: 'tilSlotPick', kind, from, who: op.who, src: op.src },
  });
});

defOp('tilSlotPick', (s, op) => {
  if (!op.pick?.length) return;
  const [q, r] = String(op.pick[0]).split(',').map(Number);
  const kind = op.kind as TileKind;
  const stack = stackOf(s, kind);
  const idx = stack.length - 1 - (op.from ?? 0);
  if (idx < 0) return;
  const id = stack.splice(idx, 1)[0];
  revealTile(s, id, q, r, kind, op.src);
});

// ---- Remove Snow -----------------------------------------------------------------------------------------

/**
 * The Remove Snow action body (the meeple is already on the Remove Snow space). `variant` selects the base rule
 * (normal: two Near or one Far) or a citizen-card variant. Called by the ACTIONS module and by the `removeSnow:<variant>` token.
 */
export function removeSnowAction(s: GameState, who: number, meeple: number | null, variant: SnowVariant = 'normal', src?: string) {
  push(s, { k: 'tilRemoveSnow', who, meeple, variant, src });
}

defOp('tilRemoveSnow', (s, op) => {
  const who = op.who as number;
  const src = op.src as string | undefined;
  switch (op.variant as SnowVariant) {
    case 'normal':
      ask(s, {
        who,
        kind: 'removeSnow',
        prompt: 'Remove Snow: place two Near tiles, or one Far tile?',
        src,
        options: [
          opt('near2', 'Place two Near tiles', tileAvailable(s, 'near') ? undefined : { disabled: 'no Near tile can be placed' }),
          opt('far1', 'Place one Far tile', tileAvailable(s, 'far') ? undefined : { disabled: 'no Far tile can be placed' }),
        ],
        then: { k: 'tilSnowPick', who, src },
        back: true,
      });
      return;
    case 'nearAndFar':
      // one Near and one Far; two Far once all Near tiles have been placed
      if (s.stacks.near.length > 0) pushSeq(s, placeOp(who, 'near', src), placeOp(who, 'far', src));
      else pushSeq(s, placeOp(who, 'far', src), placeOp(who, 'far', src));
      return;
    case 'twoFar':
      pushSeq(s, placeOp(who, 'far', src), placeOp(who, 'far', src));
      return;
    case 'oneNearElseFar':
      push(s, placeOp(who, s.stacks.near.length > 0 ? 'near' : 'far', src));
      return;
    case 'drawFar3ChooseOne':
      push(s, { k: 'tilDraw3', who, src });
      return;
    default:
      throw new Error('unknown removeSnow variant ' + op.variant);
  }
});

defOp('tilSnowPick', (s, op) => {
  const who = op.who as number;
  const src = op.src as string | undefined;
  if (op.pick?.[0] === 'near2') pushSeq(s, placeOp(who, 'near', src), placeOp(who, 'near', src));
  else if (op.pick?.[0] === 'far1') push(s, placeOp(who, 'far', src));
});

/** C08 (Georgia Taller): draw 3 Far tiles, place one, the other two go on top or bottom of the stack. */
defOp('tilDraw3', (s, op) => {
  const n = Math.min(3, s.stacks.far.length);
  if (n === 0 || !farSlots(s).length) return;
  ask(s, {
    who: op.who,
    kind: 'drawFar3',
    prompt: 'Draw 3 Far tiles: choose one to place. The other two go on the top or bottom of the Far tiles stack.',
    src: op.src,
    options: Array.from({ length: n }, (_, i) => opt(String(i), `Far tile ${i + 1} from the top (face down)`)),
    then: { k: 'tilDraw3Pick', n, who: op.who, src: op.src },
  });
});

defOp('tilDraw3Pick', (s, op) => {
  const i = Number(op.pick?.[0]);
  if (!Number.isFinite(i)) return;
  pushSeq(s, placeOp(op.who, 'far', op.src, i), { k: 'tilOrderRest', n: (op.n as number) - 1, who: op.who, src: op.src });
});

/**
 * Place the remaining drawn tiles (still on the top of the stack, face down) on the top or the bottom of the stack.
 * Options are phrased by position so that no hidden tile id is exposed; the order of face-down tiles is not observable.
 */
defOp('tilOrderRest', (s, op) => {
  const n = Math.min(op.n ?? 0, s.stacks.far.length);
  if (n <= 0) return;
  const options =
    n === 1
      ? [opt('top', 'Top of the Far tiles stack'), opt('bottom', 'Bottom of the Far tiles stack')]
      : [
          opt('TT', 'Both on top'),
          opt('BB', 'Both on bottom'),
          opt('TB', 'Upper tile on top, lower tile on bottom'),
          opt('BT', 'Upper tile on bottom, lower tile on top'),
        ];
  ask(s, {
    who: op.who,
    kind: 'farOrder',
    prompt: n === 1 ? 'Place the other Far tile on the top or the bottom of the stack' : 'Place the other two Far tiles on the top or the bottom of the stack',
    src: op.src,
    options,
    then: { k: 'tilOrderPick', n, who: op.who, src: op.src },
  });
});

defOp('tilOrderPick', (s, op) => {
  const far = s.stacks.far;
  const n = Math.min(op.n as number, far.length);
  if (n <= 0) return;
  const code = String(op.pick?.[0] ?? 'top');
  const pieces = far.splice(far.length - n, n); // deepest first, the upper tile last
  const letters: string[] = n === 1 ? [code === 'bottom' ? 'B' : 'T'] : [code[1], code[0]];
  const top: string[] = [];
  const bottom: string[] = [];
  pieces.forEach((id, i) => (letters[i] === 'T' ? top : bottom).push(id));
  far.unshift(...bottom);
  far.push(...top);
  log(s, 'tile.order', `${n} Far tile(s) returned to the stack (${code})`, { n, code });
});

// ---- revealFar3AndReorder (C26) ------------------------------------------------------------------------

/** Reveal the top 3 Far tiles and place each on the top or the bottom of the Far stack, in order (no tile is placed). */
export function pushReveal3(s: GameState, who: number, src?: string) {
  push(s, { k: 'tilReveal3', who, src });
}

defOp('tilReveal3', (s, op) => {
  const far = s.stacks.far;
  const n = Math.min(3, far.length);
  if (n === 0) return;
  const ids = far.splice(far.length - n, n).reverse(); // revealed: top first
  log(s, 'tile.reveal', `Revealed Far tiles ${ids.join(', ')}`, { ids });
  push(s, { k: 'tilReorderStep', ids, who: op.who, src: op.src });
});

defOp('tilReorderStep', (s, op) => {
  const ids = op.ids as string[];
  if (!ids.length) return;
  ask(s, {
    who: op.who,
    kind: 'farReorder',
    prompt: `Place Far tile ${ids[0]} on the top or the bottom of the Far tiles stack`,
    src: op.src,
    options: [opt('top', 'Top of the stack'), opt('bottom', 'Bottom of the stack')],
    then: { k: 'tilReorderPick', ids, who: op.who, src: op.src },
  });
});

defOp('tilReorderPick', (s, op) => {
  const [id, ...rest] = op.ids as string[];
  if (op.pick?.[0] === 'bottom') s.stacks.far.unshift(id);
  else s.stacks.far.push(id);
  push(s, { k: 'tilReorderStep', ids: rest, who: op.who, src: op.src });
});

// ---- passive: removeSnowChildSpendFood (L04A) --------------------------------------------------------------

/** Food a Child pays for a Remove Snow action, from the covering law consequences (`removeSnowChildSpendFood:N[:heated]`). */
export function childRemoveSnowFood(s: GameState): { food: number; heated: boolean } {
  let food = 0;
  let heated = false;
  for (const l of s.laws) {
    if (!l.covered) continue;
    for (const tok of (lawConsequences[l.covered]?.passive ?? []) as string[]) {
      const m = /^removeSnowChildSpendFood:(\d+)(?::(heated))?$/.exec(tok);
      if (m) {
        food += Number(m[1]);
        heated = heated || !!m[2];
      }
    }
  }
  return { food, heated };
}

// ---- board set-up per scenario (rulebook p9-10; data: map.json boards) -------------------------------------

function rimCorners(): { corner: number; q: number; r: number }[] {
  return (mapData.rim.corners as any[]).map((c) => ({ corner: c.corner as number, q: c.q as number, r: c.r as number }));
}

function placeDreadTile(s: GameState, i: number, q: number, r: number) {
  const id = `DN${i + 1}`;
  const key = hexKey(q, r);
  const sid = `${id}:top`;
  const uid = ++s.nextUid; // pre-increment, like placeBuilding: post-increment reused the platform's uid
  s.spaces[sid] = { id: sid, tile: key, slot: 'top', res: {}, trees: 0, building: uid };
  s.buildings.push({ uid, kind: 'dreadnoughtTile', upgraded: false, ruins: false, spaces: [sid], printed: true });
  s.tiles.push({ key, id, kind: 'dread', q, r, spaces: [sid], food: 0 });
}

/**
 * Board set-up for the chosen scenario: stacks, Generator centre, Rim wall tokens (deposits), the corner tiles
 * (crater), the Frozen Grove Near tiles, and the Dreadnought tiles. Crater asks which corner to start from.
 */
export function setupBoardTiles(s: GameState) {
  if (!s.stacks.near.length && !s.stacks.far.length) initTileStacks(s);
  const board = (mapData.boards as any)[s.config.scenario];
  s.genCentre = [board.generatorCentre[0], board.generatorCentre[1]];
  push(s, { k: 'tilSetupBoard' });
}

defOp('tilSetupBoard', (s) => {
  const sc = s.config.scenario;
  if (sc === 'crater') {
    ask(s, {
      who: s.leader,
      kind: 'setup',
      prompt: 'Crater: choose the Rim corner to start placing the Starting Wall tokens from (then clockwise)',
      src: 'setup:crater',
      options: [1, 2, 3, 4, 5, 6].map((c) => opt(String(c), `Corner ${c}`)),
      then: { k: 'tilCraterStart', who: s.leader },
    });
    return;
  }
  if (sc === 'frozenGrove') {
    // only the top corner has a Starting Wall token: one random Deposit, the rest return to the box
    const dep = pickOne(s.rng, ['wood', 'coal'] as const);
    s.rim = rimCorners().map((c) => ({ corner: c.corner, q: c.q, r: c.r, deposit: c.corner === 1 ? dep : null }));
    for (const [q, r] of mapData.boards.frozenGrove.nearTiles as [number, number][]) {
      const id = s.stacks.near.pop();
      if (id) revealTile(s, id, q, r, 'near', 'setup:frozenGrove');
    }
    return;
  }
  // dreadnought: Wood and Coal deposits on corners 3 and 4 (shuffled); Dreadnought tiles are Small Buildings
  const deps = shuffle(s.rng, ['wood', 'coal'] as ('wood' | 'coal')[]);
  s.rim = rimCorners().map((c) => {
    const i = [3, 4].indexOf(c.corner);
    return { corner: c.corner, q: c.q, r: c.r, deposit: i >= 0 ? deps[i] : null };
  });
  const b = mapData.boards.dreadnought;
  (b.dreadnoughtTiles as [number, number][]).forEach(([q, r], i) => placeDreadTile(s, i, q, r));
  for (const [q, r] of b.nearTiles as [number, number][]) {
    const id = s.stacks.near.pop();
    if (id) revealTile(s, id, q, r, 'near', 'setup:dreadnought');
  }
  for (const [q, r] of b.farTiles as [number, number][]) {
    const id = s.stacks.far.pop();
    if (id) revealTile(s, id, q, r, 'far', 'setup:dreadnought');
  }
});

/** Crater: walk clockwise from the chosen corner, drawing one Wall token per corner until 3 Deposits are placed. */
defOp('tilCraterStart', (s, op) => {
  const start = Number(op.pick?.[0]);
  const tokens: string[] = shuffle(s.rng, ['blank', 'blank', 'blank', 'wood', 'wood', 'coal', 'coal']);
  const deposit: Record<number, 'wood' | 'coal'> = {};
  let k = 0;
  let placed = 0;
  for (let step = 0; step < 6 && placed < 3 && k < tokens.length; step++) {
    const corner = ((start - 1 + step) % 6) + 1;
    const tok = tokens[k++];
    if (tok === 'wood' || tok === 'coal') {
      deposit[corner] = tok;
      placed++;
    }
  }
  s.rim = rimCorners().map((c) => ({ corner: c.corner, q: c.q, r: c.r, deposit: deposit[c.corner] ?? null }));
  // every corner without a Deposit gets a Far tile on its Far position and a Near tile between it and the Generator
  for (const c of mapData.boards.crater.corners as any[]) {
    if (deposit[c.corner]) continue;
    const far = s.stacks.far.pop();
    const near = s.stacks.near.pop();
    if (!far || !near) {
      log(s, 'setup.tile', `No tile left for corner ${c.corner}`, {});
      continue;
    }
    revealTile(s, near, c.nearPos[0], c.nearPos[1], 'near', 'setup:crater');
    revealTile(s, far, c.farPos[0], c.farPos[1], 'far', 'setup:crater');
  }
  log(s, 'setup.rim', `Rim Deposits: ${Object.keys(deposit).length}`, { start });
});
