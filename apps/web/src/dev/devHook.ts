// DEV ONLY: window.__fp, a console/automation hook for testing the real UI end to end.
// Loaded from main.tsx only when import.meta.env.DEV (Vite drops the branch from production builds).
//
//   __fp.state()                        -> the current GameState (solo)
//   __fp.summary()                      -> compact view of round, phase, pending decision, tracks
//   __fp.newGame({ scenario, ... })     -> starts a solo game through the real session store
//   __fp.botSteps(n)                    -> answers n decisions through the real controller (the UI re-renders)
//   __fp.fastForward(round, {godMode})  -> runs the bot on a copy to `round`, then adopts that state into the UI
//   __fp.settings(patch)                -> updates the persisted settings
//   __fp.stores                         -> the zustand stores (session, ui, settings)
import type { GameConfig, GameState } from '@frostpunk/engine';
import { LocalController } from '../controller/LocalController';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useSettings, type Settings } from '../store/settings';
import { runBot, smartPick, type FastForwardResult } from './bot';
import { debugLiveSceneCount, debugMapScene, type Quality } from '../map/scene';

export interface PerfResult {
  quality: Quality;
  frames: number;
  /** render-load multiplier applied with perf({stress}); 1 = the real board */
  stress: number;
  buildings: number;
  meeples: number;
  /** mean CPU time of one update + renderer.render() call, ms (GPU time is not included) */
  avgMs: number;
  p95Ms: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  canvas: [number, number];
  pixelRatio: number;
  devicePixelRatio: number;
  note: string;
}

export interface FpSummary {
  round: number;
  phase: string;
  status: string;
  endReason: string | null;
  pending: { id: number; kind: string; prompt: string; min: number; max: number; options: string[] } | null;
  hope: string[];
  disc: string[];
  food: number;
  hunger: number;
  heat: number;
  coal: number;
  wood: number;
  laws: number;
  techs: number;
  expeditions: number;
  buildings: number;
  citizens: Record<string, number>;
}

export interface FpApi {
  state(): GameState | null;
  summary(): FpSummary | null;
  newGame(patch?: Partial<GameConfig>): boolean;
  botSteps(n: number): number;
  /** like botSteps, but with the god-mode patch before each answer (keeps Hope up while the panel is sampled) */
  botGodSteps(n: number): number;
  fastForward(round: number, opts?: { godMode?: boolean }): Promise<FastForwardResult>;
  /**
   * Synchronous render benchmark of the mounted map: sets the quality preset (the page keeps it afterwards), warms up
   * 10 frames, then times `frames` calls of scene update + renderer.render(). CPU submission time only.
   */
  perf(opts?: { quality?: Quality; frames?: number; size?: [number, number]; stress?: number }): PerfResult | null;
  /** live map scenes (WebGL contexts owned by the map), canvases in the DOM, and the current scene's renderer memory */
  mapStats(): { liveScenes: number; canvases: number; geometries: number | null; textures: number | null; programs: number | null };
  /** the canvas point (CSS pixels) of a map pick id, e.g. a space id, or null when it is not drawn on screen */
  mapScreenPoint(id: string): { x: number; y: number } | null;
  settings(patch: Partial<Settings>): Settings;
  stores: { session: typeof useSession; ui: typeof useUi; settings: typeof useSettings };
}

const DEFAULT_CONFIG: GameConfig = {
  scenario: 'crater',
  society: 1,
  difficulty: 'normal',
  mode: 'solo',
  players: [{ name: 'Commander' }],
  seed: 20260101,
  extraPack: false,
  advisors: [],
};

/**
 * Render-load probe for perf(): every building, meeple and tree count multiplied by k at the same places. Not a legal
 * game state (the copies overlap), it only exists so the benchmark can see a larger endgame board.
 */
function stressed(s: GameState, k: number): GameState {
  const out = JSON.parse(JSON.stringify(s)) as GameState;
  let uid = 1_000_000;
  let mid = 1_000_000;
  const buildings = out.buildings.slice();
  const meeples = out.meeples.slice();
  for (let i = 1; i < k; i++) {
    for (const b of buildings) out.buildings.push({ ...b, uid: uid++ });
    for (const m of meeples) out.meeples.push({ ...m, id: mid++ });
  }
  for (const sp of Object.values(out.spaces)) sp.trees = sp.trees * k;
  return out;
}

function current(): GameState | null {
  return useSession.getState().snap?.state ?? null;
}

function summaryOf(s: GameState | null): FpSummary | null {
  if (!s) return null;
  const p = s.pending;
  const citizens: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.cit)) citizens[k] = v as number;
  return {
    round: s.round,
    phase: s.phase,
    status: s.status,
    endReason: s.endReason,
    pending: p
      ? {
          id: p.id,
          kind: p.kind,
          prompt: p.prompt,
          min: p.min,
          max: p.max,
          options: p.options.map((o) => `${o.id}${o.disabled ? '(off)' : ''}`),
        }
      : null,
    hope: s.hope.map((t) => `${t.t}${t.a ? '' : '-'}`),
    disc: s.disc.map((t) => `${t.t}${t.a ? '' : '-'}`),
    food: s.food,
    hunger: s.hunger,
    heat: s.gen.heat,
    coal: s.res.coal,
    wood: s.res.wood,
    laws: s.laws.length,
    techs: s.techs.filter((t) => t.state === 'done').length,
    expeditions: s.expeditions.length,
    buildings: s.buildings.length,
    citizens,
  };
}

export function installDevHook(): void {
  const api: FpApi = {
    state: current,
    summary: () => summaryOf(current()),
    newGame(patch = {}) {
      const cfg: GameConfig = { ...DEFAULT_CONFIG, seed: Math.floor(Math.random() * 1e9), ...patch };
      return useSession.getState().startSolo(cfg);
    },
    botSteps(n) {
      let done = 0;
      for (let i = 0; i < n; i++) {
        const s = current();
        if (!s || !s.pending || s.status !== 'playing') break;
        const pick = smartPick(s, s.pending);
        if (!pick) break;
        useSession.getState().answer(pick);
        done++;
      }
      return done;
    },
    botGodSteps(n) {
      const ctrl = useSession.getState().controller;
      const s = current();
      if (!s || !(ctrl instanceof LocalController)) return 0;
      const res = runBot(s, Number.MAX_SAFE_INTEGER, true, n);
      if (res.state) ctrl.adopt(res.state);
      return res.decisions;
    },
    async fastForward(round, opts = {}) {
      const session = useSession.getState();
      const ctrl = session.controller;
      const s = current();
      if (!s || !(ctrl instanceof LocalController)) {
        return { ok: false, round: 0, status: 'playing', decisions: 0, state: null, note: 'no solo game running' };
      }
      // yield once so the UI can paint between chunks; the bot itself is synchronous and fast
      await new Promise((r) => setTimeout(r, 0));
      const res = runBot(s, round, opts.godMode ?? true);
      // adopt the advanced copy when it reached the target, or when the game ended on the way (end screens)
      if (res.state && (res.ok || res.status !== 'playing')) ctrl.adopt(res.state);
      return res;
    },
    mapScreenPoint(id) {
      return debugMapScene()?.screenPoint(id) ?? null;
    },
    mapStats() {
      const scene = debugMapScene();
      // rAF may not run while the pane is hidden: draw once (no time step) so the GPU objects exist before counting
      if (scene) scene.renderOnce(0);
      const info = scene ? scene.debugInfo() : null;
      return {
        liveScenes: debugLiveSceneCount(),
        canvases: document.querySelectorAll('canvas').length,
        geometries: info ? info.geometries : null,
        textures: info ? info.textures : null,
        programs: info ? info.programs : null,
      };
    },
    perf(opts = {}) {
      const scene = debugMapScene();
      if (!scene) return null;
      const quality: Quality = opts.quality ?? 'medium';
      const frames = Math.max(10, Math.min(2000, Math.floor(opts.frames ?? 120)));
      // optional exact canvas size: the host element is resized for the run (the Browser pane may scale the viewport)
      const host = scene.debugHost();
      const prevW = host.style.width;
      const prevH = host.style.height;
      if (opts.size) {
        host.style.width = opts.size[0] + 'px';
        host.style.height = opts.size[1] + 'px';
        scene.debugResize();
      }
      const real = current();
      const stress = opts.stress && opts.stress > 1 && real ? Math.min(8, Math.floor(opts.stress)) : 1;
      if (stress > 1 && real) scene.setState(stressed(real, stress));
      scene.setQuality(quality);
      for (let i = 0; i < 10; i++) scene.renderOnce();
      const times = new Float64Array(frames);
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        scene.renderOnce();
        times[i] = performance.now() - t0;
      }
      const sorted = Array.from(times).sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      const info = scene.debugInfo();
      const shown = stress > 1 && real ? stressed(real, stress) : real;
      if (stress > 1 && real) scene.setState(real);
      if (opts.size) {
        host.style.width = prevW;
        host.style.height = prevH;
        scene.debugResize();
      }
      return {
        quality,
        frames,
        stress,
        buildings: shown ? shown.buildings.length : 0,
        meeples: shown ? shown.meeples.length : 0,
        avgMs: Math.round((sum / frames) * 100) / 100,
        p95Ms: Math.round(sorted[Math.min(frames - 1, Math.floor(frames * 0.95))] * 100) / 100,
        drawCalls: info.calls,
        triangles: info.triangles,
        geometries: info.geometries,
        textures: info.textures,
        programs: info.programs,
        canvas: info.canvas,
        pixelRatio: info.pixelRatio,
        devicePixelRatio: window.devicePixelRatio,
        note: 'CPU submission time per frame (update + render call); GPU execution is not measured',
      };
    },
    settings: (patch) => {
      useSettings.getState().update(patch);
      return useSettings.getState();
    },
    stores: { session: useSession, ui: useUi, settings: useSettings },
  };
  (window as unknown as { __fp: FpApi }).__fp = api;
}
