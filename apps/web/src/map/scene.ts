// The imperative three.js scene behind <MapView/>. No React in here: MapView owns one MapScene per canvas.
//
// Data flow: setState(next) reconciles the scene graph against the new GameState (keyed by tile key, space id,
// building uid and meeple id) and queues animations for what changed (meeples slide or arc, resources pop in and
// fade out, buildings rise from the snow, tiles drop in). Nothing in the scene mutates game state.
//
// Render loop is on demand: a frame is scheduled only while something moves (tweens, camera damping, held keys,
// highlight pulse). On 'high' the ambient layer (falling snow, ember flicker, upgrade markers) keeps it running.
import * as THREE from 'three';
import { buildings as buildingDefs, type Building, type GameState, type Meeple, type MapTile, type Space } from '@frostpunk/engine';
import { FLOWER, GEN_DRAWER_OFFSET, HEX, SQRT3, hexXz, rimCorners, tileZone, zoneHeated, type Xz } from './hex';
import { PAL } from './palette';
import { Kit, makeRadialTexture, makeSnowTexture } from './kit';
import * as M from './models';
import { CameraRig } from './camera';
import { Tweens, easeInOutCubic, easeOutBack, easeOutCubic, linear } from './tween';
import {
  buildingCentre,
  describePick,
  insulationOf,
  isLargeBuilding,
  meepleSpots,
  pickCentre,
  spaceTileCentre,
  spaceXz,
  worldToPick,
  type PickInfo,
} from './pick';
import { modelUrl } from '../assets/manifest';

/** GLB key (assets manifest) per map object. Anything without a key keeps its procedural stand-in. */
const MODEL_OF_MEEPLE: Record<string, string> = {
  worker: 'workers',
  engineer: 'engineers',
  child: 'children',
  childWorker: 'children',
  childEngineer: 'children',
  automaton: 'automatons',
};
const MODEL_OF_RESOURCE: Record<string, string> = { wood: 'wood', coal: 'coal', core: 'steam_core' };
const MODEL_OF_BUILDING: Record<string, string> = { steamHub: 'steam_hub' };
/** Unnamed in the TTS mod (mesh suffix 1F2ABB1E). Its shape is the Generator tower, so it stands in the Generator crater. */
const GENERATOR_MODEL = 'model_1f2abb1e';
/** Base width of the tower, about the crater's top diameter (pit radius 0.8) and a little under a hex tile's 1.73 flat to flat. */
const GENERATOR_BASE = 1.6;
/** The Dreadnought model lies along the scenario's dread tiles. */
const DREADNOUGHT_MODEL = 'dreadnought';

export type Quality = 'low' | 'medium' | 'high';

/** Scenes that are mounted and not yet disposed. Used by the DEV perf hook only. */
const liveScenes = new Set<MapScene>();

/** DEV: the most recently created scene that is still alive, or null. */
export function debugMapScene(): MapScene | null {
  let last: MapScene | null = null;
  for (const s of liveScenes) last = s;
  return last;
}

/** DEV: number of mounted, not yet disposed map scenes (each owns one WebGL context). */
export function debugLiveSceneCount(): number {
  return liveScenes.size;
}

export interface MapSceneHooks {
  /** Hover changed or moved. info is null when nothing pickable is under the cursor. x/y are CSS pixels inside the canvas. */
  onHover(info: PickInfo | null, x: number, y: number): void;
  /** A canonical pick id was clicked (left button, no drag). */
  onPick(id: string): void;
}

interface TileView {
  group: THREE.Group;
  mesh: THREE.Mesh;
  heated: boolean;
  dread: boolean;
}

interface SpaceView {
  group: THREE.Group;
  kids: Map<string, THREE.Object3D>;
  sig: string;
}

interface BuildingView {
  group: THREE.Group;
  visual: THREE.Group | null;
  sig: string;
  spinners: THREE.Object3D[];
  xz: Xz;
}

interface MeepleView {
  kind: string;
  group: THREE.Group;
  /** The group's resting scale (children are smaller); the pop-in and shrink tweens go to and from this. */
  base: number;
  visible: boolean;
  space: string | null;
  /** Bumped by every pop/shrink so a stale tween never overrides a newer one. */
  pop: number;
  move: number;
  tilt: number;
}

interface Want {
  key: string;
  x: number;
  z: number;
  rotY: number;
  make: () => THREE.Object3D;
}

const GEN_KEY = (gc: [number, number]) => gc.join(',');
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const SNOW_BOX = 24;

/** True when the object and every ancestor are visible (the raycaster does not check visibility on its own). */
function shown(o: THREE.Object3D | null): boolean {
  for (let c = o; c; c = c.parent) if (!c.visible) return false;
  return true;
}

export class MapScene {
  private readonly host: HTMLElement;
  private readonly hooks: MapSceneHooks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig: CameraRig;
  private readonly kit = new Kit();
  private readonly tweens = new Tweens();
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly layers = {
    ground: new THREE.Group(),
    gen: new THREE.Group(),
    rim: new THREE.Group(),
    spaces: new THREE.Group(),
    buildings: new THREE.Group(),
    meeples: new THREE.Group(),
    markers: new THREE.Group(),
  };
  private readonly moon: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly glowTex: THREE.Texture;
  private readonly dotTex: THREE.Texture;
  private readonly mats: M.GroundMats;
  private readonly crater: M.CraterParts;
  private readonly ro: ResizeObserver | null;
  private readonly canvas: HTMLCanvasElement;
  private readonly depositGroup = new THREE.Group();
  private readonly tileViews = new Map<string, TileView>();
  private readonly spaceViews = new Map<string, SpaceView>();
  private readonly buildingViews = new Map<number, BuildingView>();
  private readonly meepleViews = new Map<number, MeepleView>();
  private readonly markerMeshes = new Map<string, THREE.Mesh>();
  private readonly pointer = { down: -1, sx: 0, sy: 0, lx: 0, ly: 0, moved: false, inside: false };
  private readonly keys = new Set<string>();
  private readonly handlers: { target: EventTarget; type: string; fn: EventListener; opts?: AddEventListenerOptions }[] = [];

  private quality: Quality;
  private state: GameState | null = null;
  private genKey = '';
  private rimKey = '';
  private depKey = '';
  private genGround: THREE.Group | null = null;
  private dreadShip: THREE.Group | null = null;
  private dreadKey = '';
  private rimGroup: THREE.Group | null = null;
  private meeplePos = new Map<number, Xz>();
  private snow: THREE.Points | null = null;
  private snowSpeed: Float32Array = new Float32Array(0);
  private highlight = new Set<string>();
  private selected = new Set<string>();
  private hoverId: string | null = null;
  private hlMat!: THREE.MeshBasicMaterial;
  private hoverMat!: THREE.MeshBasicMaterial;
  private selMat!: THREE.MeshBasicMaterial;
  private heatNorm = 0;

  private raf = 0;
  private lastNow = 0;
  private time = 0;
  private disposed = false;

  constructor(host: HTMLElement, hooks: MapSceneHooks, quality: Quality = 'medium') {
    this.host = host;
    this.hooks = hooks;
    this.quality = quality;

    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.touchAction = 'none';
    this.canvas.style.outline = 'none';
    host.appendChild(this.canvas);

    this.scene.background = new THREE.Color(PAL.bg);
    this.scene.fog = new THREE.FogExp2(PAL.fog, 0.018);
    for (const l of Object.values(this.layers)) this.scene.add(l);
    this.layers.rim.add(this.depositGroup);

    this.hemi = new THREE.HemisphereLight(0xbcd6e6, 0x1b2730, 0.9);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0xcfe3f5, 1.5);
    this.moon.position.set(-7, 13, 6);
    this.moon.target.position.set(0, 0, 0);
    this.scene.add(this.moon, this.moon.target);
    this.moon.shadow.camera.left = -11;
    this.moon.shadow.camera.right = 11;
    this.moon.shadow.camera.top = 11;
    this.moon.shadow.camera.bottom = -11;
    this.moon.shadow.camera.near = 1;
    this.moon.shadow.camera.far = 40;
    this.moon.shadow.bias = -0.0008;
    this.moon.shadow.normalBias = 0.02;

    const snowTex = this.kit.tex('snow', makeSnowTexture);
    this.glowTex = this.kit.tex('glow', () => makeRadialTexture(128, 0.35));
    this.dotTex = this.kit.tex('dot', () => makeRadialTexture(32, 0.6));
    this.mats = M.groundMats(this.kit, snowTex);
    this.crater = M.craterParts(this.kit, this.glowTex);
    this.layers.gen.add(this.crater.group);
    this.addGlb(this.crater.group, GENERATOR_MODEL, (size) => GENERATOR_BASE / Math.max(size.x, size.z));
    this.hlMat = this.kit.mat(
      'mkHl',
      () => new THREE.MeshBasicMaterial({ color: PAL.ember, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.hoverMat = this.kit.mat(
      'mkHover',
      () => new THREE.MeshBasicMaterial({ color: PAL.hope, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.selMat = this.kit.mat(
      'mkSel',
      () => new THREE.MeshBasicMaterial({ color: PAL.hope, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );

    this.rig = new CameraRig(1);
    // size first so the initial overview fits the real aspect; later resizes keep the player's zoom
    this.resize();
    this.rig.overview();
    this.rig.snap();
    this.applyQuality();
    this.bindEvents();
    liveScenes.add(this);

    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.ro?.observe(host);
  }

  // ---- public API ----------------------------------------------------------------------------------------------

  setState(next: GameState): void {
    if (this.disposed) return;
    this.state = next;
    this.syncGround(next);
    this.syncRim(next);
    this.syncGenerator(next);
    this.syncSpaces(next);
    this.syncBuildings(next);
    this.syncMeeples(next);
    this.refreshMarkers();
    this.requestFrame();
  }

  setQuality(q: Quality): void {
    if (q === this.quality || this.disposed) return;
    this.quality = q;
    this.applyQuality();
    if (this.state) this.setState(this.state);
    this.requestFrame();
  }

  setHighlight(ids: Set<string>): void {
    if (this.disposed) return;
    this.highlight = new Set(ids);
    this.refreshMarkers();
    this.requestFrame();
  }

  /** Options already picked in a multi-pick decision: a solid marker, so the pick shows before Confirm. */
  setSelected(ids: Set<string>): void {
    if (this.disposed) return;
    this.selected = new Set(ids);
    this.refreshMarkers();
    this.requestFrame();
  }

  /** DEV: where a pick id sits on the canvas, in CSS pixels (null when it is not on screen). Used by the dev hook. */
  screenPoint(id: string): { x: number; y: number } | null {
    if (!this.state || this.disposed) return null;
    const xz = pickCentre(this.state, id, this.meeplePos);
    if (!xz) return null;
    const v = new THREE.Vector3(xz.x, 0, xz.z).project(this.rig.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  focus(id: string | null): void {
    if (!id || !this.state || this.disposed) return;
    const xz = pickCentre(this.state, id, this.meeplePos);
    if (!xz) return;
    this.rig.flyTo(xz.x, xz.z, true);
    this.requestFrame();
  }

  resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.rig.setViewport(w, h);
    this.requestFrame();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const h of this.handlers) h.target.removeEventListener(h.type, h.fn, h.opts);
    this.handlers.length = 0;
    this.ro?.disconnect();
    this.tweens.clear();
    if (this.snow) {
      this.snow.geometry.dispose();
      (this.snow.material as THREE.Material).dispose();
      this.snow = null;
    }
    this.moon.shadow.map?.dispose();
    this.scene.clear();
    this.kit.dispose();
    this.renderer.dispose();
    // Browsers cap live WebGL contexts (about 16); without this every new game leaks one until GC.
    this.renderer.forceContextLoss();
    this.canvas.remove();
    liveScenes.delete(this);
  }

  // ---- quality -----------------------------------------------------------------------------------------------

  private applyQuality(): void {
    const q = this.quality;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.renderer.setPixelRatio(Math.min(dpr, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
    this.renderer.shadowMap.enabled = q !== 'low';
    const mapSize = q === 'high' ? 2048 : 1024;
    if (this.moon.shadow.mapSize.x !== mapSize) {
      this.moon.shadow.mapSize.set(mapSize, mapSize);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    }
    this.moon.castShadow = q !== 'low';

    if (this.snow) {
      this.scene.remove(this.snow);
      this.snow.geometry.dispose();
      (this.snow.material as THREE.Material).dispose();
      this.snow = null;
    }
    const flakes = q === 'low' ? 0 : q === 'medium' ? 500 : 1100;
    if (flakes > 0) this.createSnow(flakes);
  }

  private createSnow(count: number): void {
    const pos = new Float32Array(count * 3);
    this.snowSpeed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * SNOW_BOX;
      pos[i * 3 + 1] = Math.random() * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * SNOW_BOX;
      this.snowSpeed[i] = 0.5 + Math.random() * 0.7;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: PAL.frost,
      size: 0.085,
      map: this.dotTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  // ---- ground and map tiles ----------------------------------------------------------------------------------------

  private syncGround(s: GameState): void {
    const gk = GEN_KEY(s.genCentre);
    if (gk !== this.genKey) {
      this.genKey = gk;
      if (this.genGround) this.layers.ground.remove(this.genGround);
      this.genGround = new THREE.Group();
      const gc = s.genCentre;
      for (const [dq, dr] of FLOWER) {
        const isDrawer = dq === GEN_DRAWER_OFFSET[0] && dr === GEN_DRAWER_OFFSET[1];
        const slab = new THREE.Mesh(M.hexSlab(this.kit), isDrawer ? this.mats.road : this.mats.gen);
        slab.receiveShadow = true;
        slab.castShadow = false;
        const c = hexXz(gc[0] + dq, gc[1] + dr);
        slab.position.set(c.x, 0, c.z);
        this.genGround.add(slab);
      }
      this.layers.ground.add(this.genGround);
      const cc = hexXz(gc[0], gc[1]);
      this.crater.group.position.set(cc.x, 0, cc.z);
    }

    const seen = new Set<string>();
    s.tiles.forEach((t, idx) => {
      if (t.kind === 'gen') return;
      seen.add(t.key);
      const heated = zoneHeated(s.gen, tileZone(s.genCentre, t.q, t.r));
      const dread = t.kind === 'dread';
      let v = this.tileViews.get(t.key);
      if (!v) {
        const made = this.makeTile(t, heated);
        v = made;
        this.tileViews.set(t.key, made);
        this.layers.ground.add(made.group);
        if (this.quality === 'low') {
          made.group.position.y = 0;
        } else {
          // drop in from above, staggered; the whole cascade stays under 0.6 s
          made.group.position.y = 2.6;
          const delay = Math.min(idx, 12) * 0.02;
          this.tweens.add({
            dur: 0.35,
            delay,
            ease: easeOutCubic,
            apply: (k) => (made.group.position.y = 2.6 * (1 - k)),
          });
        }
      }
      if (v.heated !== heated || v.dread !== dread) {
        v.heated = heated;
        v.dread = dread;
        v.mesh.material = dread ? this.mats.dread : heated ? this.mats.warm : this.mats.snow;
      }
    });
    for (const [key, v] of this.tileViews) {
      if (!seen.has(key)) {
        this.layers.ground.remove(v.group);
        this.tileViews.delete(key);
      }
    }
    this.syncDreadnought(s);
  }

  /**
   * The Dreadnought lies along its dread tiles. The model is laid on the line through the two farthest tile centres,
   * one tile longer than that line, and sunk 55% into the snow so the meeples on its tiles stay visible from the
   * default camera.
   */
  private syncDreadnought(s: GameState): void {
    const dread = s.tiles.filter((t) => t.kind === 'dread');
    const key = dread.map((t) => t.key).join('|');
    if (key === this.dreadKey) return;
    this.dreadKey = key;
    if (this.dreadShip) this.layers.ground.remove(this.dreadShip);
    this.dreadShip = null;
    if (dread.length === 0) return;

    const pts = dread.map((t) => hexXz(t.q, t.r));
    let a = pts[0];
    let b = pts[0];
    let span = 0;
    for (const p of pts) {
      for (const q of pts) {
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d > span) {
          span = d;
          a = p;
          b = q;
        }
      }
    }
    // a neighbour tile reaches its apothem (sqrt(3)/2 * HEX) past its centre along the line, at each end
    const len = span + SQRT3 * HEX;
    const holder = new THREE.Group();
    holder.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    // the model's long axis is local x; rotating by atan2(-dz, dx) turns it onto the a → b line
    holder.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    this.layers.ground.add(holder);
    this.dreadShip = holder;
    this.addGlb(holder, DREADNOUGHT_MODEL, (size) => len / size.x, 0.55);
  }

  /**
   * Adds the GLB `key` to `holder`, scaled uniformly by `fit(size)` (size = unscaled bounding box), centred on x and z,
   * with its lowest point `sink` (a fraction of its scaled height) below y = 0. Does nothing when the manifest has no
   * such model.
   */
  private addGlb(holder: THREE.Group, key: string, fit: (size: THREE.Vector3) => number, sink = 0): void {
    const url = modelUrl(key);
    if (!url) return;
    loadGltf(url).then((model) => {
      if (!model || this.disposed) return;
      const inst = model.clone(true);
      const size = new THREE.Box3().setFromObject(inst).getSize(new THREE.Vector3());
      const k = fit(size);
      if (!Number.isFinite(k) || k <= 0) return;
      inst.scale.setScalar(k);
      const box = new THREE.Box3().setFromObject(inst);
      const c = box.getCenter(new THREE.Vector3());
      inst.position.set(-c.x, -box.min.y - sink * (box.max.y - box.min.y), -c.z);
      M.shadowed(inst);
      holder.add(inst);
      this.requestFrame();
    });
  }

  private makeTile(t: MapTile, heated: boolean): TileView {
    const group = new THREE.Group();
    const dread = t.kind === 'dread';
    const mat = dread ? this.mats.dread : heated ? this.mats.warm : this.mats.snow;
    const mesh = new THREE.Mesh(M.hexSlab(this.kit), mat);
    // flat ground: receives shadows only (a caster here would add a shadow-pass draw for no visible change)
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    const seam = new THREE.Mesh(
      M.seamGeo(this.kit),
      this.kit.mat('seam', () => new THREE.MeshStandardMaterial({ color: PAL.steelDark, roughness: 0.6, metalness: 0.3 })),
    );
    seam.position.y = 0.006;
    seam.receiveShadow = true;
    group.add(mesh, seam);
    const c = hexXz(t.q, t.r);
    group.position.set(c.x, 0, c.z);
    return { group, mesh, heated, dread };
  }

  // ---- rim and deposits ----------------------------------------------------------------------------------------------

  private syncRim(s: GameState): void {
    const key = GEN_KEY(s.genCentre);
    if (key !== this.rimKey) {
      this.rimKey = key;
      if (this.rimGroup) this.layers.rim.remove(this.rimGroup);
      const pts = rimCorners().map((c) => hexXz(c.q, c.r));
      this.rimGroup = M.rimGroup(this.kit, pts);
      this.layers.rim.add(this.rimGroup);
    }
    const depKey = s.rim.map((c) => `${c.corner}:${c.deposit ?? ''}:${c.q},${c.r}`).join('|');
    if (depKey !== this.depKey) {
      this.depKey = depKey;
      this.depositGroup.clear();
      const cc = hexXz(s.genCentre[0], s.genCentre[1]);
      for (const c of s.rim) {
        if (!c.deposit) continue;
        const p = hexXz(c.q, c.r);
        const dx = p.x - cc.x;
        const dz = p.z - cc.z;
        const len = Math.hypot(dx, dz) || 1;
        const pile = M.depositPile(this.kit, c.deposit);
        pile.position.set(p.x + (dx / len) * 0.35, 0, p.z + (dz / len) * 0.35);
        pile.rotation.y = -Math.atan2(dz, dx);
        this.depositGroup.add(pile);
      }
    }
  }

  // ---- generator -------------------------------------------------------------------------------------------------------

  private syncGenerator(s: GameState | null): void {
    if (!s) return;
    const h = clamp01((s.gen.heat - 1) / 15);
    this.heatNorm = h;
    const col = s.gen.broken ? PAL.danger : PAL.ember;
    (this.crater.glow.material as THREE.MeshBasicMaterial).color.setHex(col);
    (this.crater.sprite.material as THREE.SpriteMaterial).color.setHex(col);
    this.crater.light.color.setHex(col);
    this.crater.sprite.scale.setScalar(2.2 + 1.6 * h);
    this.applyGlow(1);
  }

  /** Ember brightness for the current heat, multiplied by a flicker factor (1 when static). */
  private applyGlow(flicker: number): void {
    const h = this.heatNorm;
    (this.crater.glow.material as THREE.MeshBasicMaterial).opacity = (0.12 + 0.7 * h) * flicker;
    (this.crater.sprite.material as THREE.SpriteMaterial).opacity = (0.22 + 0.55 * h) * flicker;
    this.crater.light.intensity = (0.6 + 2.6 * h) * flicker;
  }

  // ---- spaces: resources and trees ------------------------------------------------------------------------------------

  private syncSpaces(s: GameState): void {
    const instant = this.quality === 'low';
    for (const sp of Object.values(s.spaces)) {
      let v = this.spaceViews.get(sp.id);
      if (!v) {
        v = { group: new THREE.Group(), kids: new Map(), sig: '' };
        this.layers.spaces.add(v.group);
        this.spaceViews.set(sp.id, v);
      }
      const c = spaceXz(s, sp.id);
      if (c) v.group.position.set(c.x, 0, c.z);
      const sig = `${sp.res.wood ?? 0}.${sp.res.coal ?? 0}.${sp.res.core ?? 0}.${sp.trees}.${sp.building ?? ''}.${sp.tile === 'GEN' ? 'g' : 'm'}`;
      if (sig === v.sig) continue;
      v.sig = sig;
      this.reconcile(v.group, v.kids, this.wantsFor(sp), instant);
    }
    for (const [id, v] of this.spaceViews) {
      if (!s.spaces[id]) {
        this.layers.spaces.remove(v.group);
        this.spaceViews.delete(id);
      }
    }
  }

  private wantsFor(sp: Space): Want[] {
    const out: Want[] = [];
    const full = sp.tile === 'GEN';
    const outward = sp.slot === 'top' ? -1 : 1;
    if (sp.building == null) {
      const kinds: ['wood' | 'coal' | 'core', number][] = [
        ['wood', sp.res.wood ?? 0],
        ['coal', sp.res.coal ?? 0],
        ['core', sp.res.core ?? 0],
      ];
      kinds.forEach(([kind, n], ki) => {
        for (let j = 0; j < n; j++) {
          const r = n === 1 ? 0 : 0.2;
          const a = ki * 2.1 + j * 2.3 + 0.4;
          out.push({
            key: `${kind}${j}`,
            x: Math.cos(a) * r,
            z: Math.sin(a) * r,
            rotY: j * 0.7,
            make: () => {
              const g = new THREE.Group();
              g.add(kind === 'wood' ? M.woodLog(this.kit) : kind === 'coal' ? M.coalLump(this.kit) : M.steamCore(this.kit));
              this.swapGlb(g, MODEL_OF_RESOURCE[kind]);
              return g;
            },
          });
        }
      });
    }
    for (let j = 0; j < sp.trees; j++) {
      let x: number;
      let z: number;
      if (full) {
        const a = j * 1.3 + 0.8;
        x = Math.cos(a) * 0.4;
        z = Math.sin(a) * 0.4;
      } else {
        x = (j - (sp.trees - 1) / 2) * 0.26;
        z = outward * 0.22;
      }
      out.push({
        key: `tree${j}`,
        x,
        z,
        rotY: 0,
        make: () => {
          const g = new THREE.Group();
          g.add(M.pineTree(this.kit, M.hash01(sp.id + j)));
          this.swapGlb(g, 'trees');
          return g;
        },
      });
    }
    return out;
  }

  /** Keyed reconciliation: new children pop in, vanished ones shrink away. */
  private reconcile(parent: THREE.Group, kids: Map<string, THREE.Object3D>, wants: Want[], instant: boolean): void {
    const want = new Set(wants.map((w) => w.key));
    for (const w of wants) {
      if (kids.has(w.key)) continue;
      const obj = w.make();
      obj.position.set(w.x, 0, w.z);
      obj.rotation.y = w.rotY;
      obj.scale.setScalar(0.001);
      parent.add(obj);
      kids.set(w.key, obj);
      this.tweens.add({ dur: 0.42, ease: easeOutBack, apply: (k) => obj.scale.setScalar(Math.max(0.001, k)) }, instant);
    }
    for (const [key, obj] of kids) {
      if (want.has(key)) continue;
      kids.delete(key);
      this.tweens.add(
        {
          dur: 0.28,
          ease: linear,
          apply: (k) => obj.scale.setScalar(Math.max(0.001, 1 - k)),
          done: () => parent.remove(obj),
        },
        instant,
      );
    }
  }

  // ---- buildings ----------------------------------------------------------------------------------------------------

  private syncBuildings(s: GameState): void {
    const instant = this.quality === 'low';
    const seen = new Set<number>();
    for (const b of s.buildings) {
      seen.add(b.uid);
      const xz = buildingCentre(s, b);
      if (!xz) continue;
      const large = isLargeBuilding(b);
      const sig = `${b.kind}|${b.upgraded ? 1 : 0}|${b.ruins ? 1 : 0}|${large ? 'L' : 'S'}|${insulationOf(b)}`;
      let v = this.buildingViews.get(b.uid);
      if (!v) {
        const group = new THREE.Group();
        group.userData.pick = `b:${b.uid}`;
        this.layers.buildings.add(group);
        v = { group, visual: null, sig: '', spinners: [], xz: { x: NaN, z: NaN } };
        this.buildingViews.set(b.uid, v);
      }
      if (v.xz.x !== xz.x || v.xz.z !== xz.z) {
        v.group.position.set(xz.x, 0, xz.z);
        v.xz = xz;
      }
      if (v.sig === sig) continue;

      const owner = v;
      const old = owner.visual;
      const fresh = this.buildingVisual(b, large);
      owner.visual = fresh.group;
      owner.spinners = fresh.spinners;
      owner.sig = sig;
      owner.group.add(fresh.group);
      if (old) {
        this.tweens.add(
          {
            dur: 0.3,
            ease: linear,
            apply: (k) => old.scale.setScalar(Math.max(0.001, 1 - k)),
            done: () => owner.group.remove(old),
          },
          instant,
        );
      }
      // new buildings rise out of the snow
      this.tweens.add(
        {
          dur: 0.6,
          ease: easeOutCubic,
          apply: (k) => (fresh.group.position.y = -0.7 * (1 - k)),
        },
        instant,
      );
      this.loadGlbInto(b.kind, fresh.group, large, sig, b.uid);
    }
    for (const [uid, v] of this.buildingViews) {
      if (seen.has(uid)) continue;
      this.buildingViews.delete(uid);
      const vis = v.visual;
      if (instant || !vis) {
        this.layers.buildings.remove(v.group);
        continue;
      }
      this.tweens.add({
        dur: 0.5,
        ease: linear,
        apply: (k) => {
          vis.position.y = -0.6 * k;
          vis.scale.setScalar(Math.max(0.001, 1 - k));
        },
        done: () => this.layers.buildings.remove(v.group),
      });
    }
  }

  private buildingVisual(b: Building, large: boolean): { group: THREE.Group; spinners: THREE.Object3D[] } {
    const group = M.buildingGroup(this.kit, {
      kind: b.kind,
      large,
      ins: insulationOf(b),
      group: buildingDefs[b.kind]?.group,
      upgraded: b.upgraded,
      ruins: b.ruins,
      seed: b.uid,
    });
    const spinners: THREE.Object3D[] = [];
    group.traverse((o) => {
      if (o.userData.spin) spinners.push(o);
    });
    return { group, spinners };
  }

  /** Swap the procedural stand-in for a GLB model when the assets manifest provides one. */
  private loadGlbInto(kind: string, procedural: THREE.Group, large: boolean, sig: string, uid: number): void {
    const url = modelUrl(MODEL_OF_BUILDING[kind] ?? '');
    if (!url) return;
    loadGltf(url).then((model) => {
      if (!model || this.disposed) return;
      const v = this.buildingViews.get(uid);
      if (!v || v.visual !== procedural || v.sig !== sig) return;
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      const target = large ? 0.9 : 0.5;
      const inst = model.clone(true);
      inst.scale.setScalar(target / Math.max(0.001, Math.max(size.x, size.z)));
      const lift = new THREE.Box3().setFromObject(inst);
      inst.position.y -= lift.min.y;
      M.shadowed(inst);
      procedural.clear();
      procedural.add(inst);
      this.requestFrame();
    });
  }

  /**
   * Replaces the procedural stand-in inside `holder` with a clone of the GLB `key`, scaled uniformly to fit the
   * stand-in's bounding box and centred on it, in the holder's own frame. Geometry and materials stay shared between
   * clones. Does nothing when the manifest has no such model, when the holder has already left the scene, or when
   * `stillWanted` says so.
   */
  private swapGlb(holder: THREE.Group, key: string | undefined, stillWanted?: () => boolean): void {
    if (!key) return;
    const url = modelUrl(key);
    if (!url) return;
    loadGltf(url).then((model) => {
      if (!model || this.disposed || holder.parent === null) return;
      if (stillWanted && !stillWanted()) return;
      const want = frameBox(holder);
      if (want.isEmpty()) return;
      const inst = model.clone(true);
      const have = new THREE.Box3().setFromObject(inst);
      const hs = have.getSize(new THREE.Vector3());
      const ws = want.getSize(new THREE.Vector3());
      let k = Infinity;
      if (hs.x > 1e-6) k = Math.min(k, ws.x / hs.x);
      if (hs.y > 1e-6) k = Math.min(k, ws.y / hs.y);
      if (hs.z > 1e-6) k = Math.min(k, ws.z / hs.z);
      if (!Number.isFinite(k) || k <= 0) return;
      inst.scale.setScalar(k);
      const scaled = new THREE.Box3().setFromObject(inst);
      const wc = want.getCenter(new THREE.Vector3());
      const sc = scaled.getCenter(new THREE.Vector3());
      inst.position.set(wc.x - sc.x, want.min.y - scaled.min.y, wc.z - sc.z);
      M.shadowed(inst);
      holder.clear();
      holder.add(inst);
      this.requestFrame();
    });
  }

  // ---- meeples ----------------------------------------------------------------------------------------------------------

  private syncMeeples(s: GameState): void {
    const instant = this.quality === 'low';
    const spots = meepleSpots(s);
    this.meeplePos = spots;
    const seen = new Set<number>();
    for (const m of s.meeples) {
      seen.add(m.id);
      let v = this.meepleViews.get(m.id);
      if (v && v.kind !== m.kind) {
        this.layers.meeples.remove(v.group);
        this.meepleViews.delete(m.id);
        v = undefined;
      }
      if (!v) {
        v = this.makeMeepleView(m);
        this.meepleViews.set(m.id, v);
        this.layers.meeples.add(v.group);
      }
      this.placeMeeple(v, m, spots.get(m.id), instant);
    }
    for (const [id, v] of this.meepleViews) {
      if (seen.has(id)) continue;
      this.layers.meeples.remove(v.group);
      this.meepleViews.delete(id);
    }
  }

  private placeMeeple(v: MeepleView, m: Meeple, spot: Xz | undefined, instant: boolean): void {
    const g = v.group;
    if (!spot) {
      if (v.visible) {
        v.visible = false;
        const token = ++v.pop;
        this.tweens.add(
          {
            dur: 0.3,
            ease: linear,
            apply: (k) => {
              if (v.pop === token) g.scale.setScalar(Math.max(0.001, (1 - k) * v.base));
            },
            done: () => {
              if (v.pop === token) g.visible = false;
            },
          },
          instant,
        );
      }
    } else if (!v.visible) {
      v.visible = true;
      v.space = m.loc.space ?? null;
      g.visible = true;
      g.position.set(spot.x, 0, spot.z);
      const token = ++v.pop;
      g.scale.setScalar(0.001);
      this.tweens.add(
        {
          dur: 0.45,
          ease: easeOutBack,
          apply: (k) => {
            if (v.pop === token) g.scale.setScalar(Math.max(0.001, k * v.base));
          },
        },
        instant,
      );
    } else {
      const fromX = g.position.x;
      const fromZ = g.position.z;
      const dx = spot.x - fromX;
      const dz = spot.z - fromZ;
      const dist = Math.hypot(dx, dz);
      const space = m.loc.space ?? null;
      if (dist > 0.01) {
        const token = ++v.move;
        if (instant) {
          g.position.set(spot.x, 0, spot.z);
        } else if (v.space !== space) {
          // changing space: a hop over the snow
          const h = 0.3 + 0.12 * dist;
          this.tweens.add({
            dur: 0.6,
            ease: easeInOutCubic,
            apply: (k) => {
              if (v.move === token) g.position.set(fromX + dx * k, Math.sin(Math.PI * k) * h, fromZ + dz * k);
            },
            done: () => {
              if (v.move === token) g.position.set(spot.x, 0, spot.z);
            },
          });
        } else {
          this.tweens.add({
            dur: 0.3,
            ease: easeOutCubic,
            apply: (k) => {
              if (v.move === token) g.position.set(fromX + dx * k, 0, fromZ + dz * k);
            },
            done: () => {
              if (v.move === token) g.position.set(spot.x, 0, spot.z);
            },
          });
        }
      }
      v.space = space;
    }

    const target = m.lying ? -Math.PI / 2 : 0;
    if (Math.abs(g.rotation.x - target) > 1e-3) {
      const token = ++v.tilt;
      const from = g.rotation.x;
      this.tweens.add(
        {
          dur: 0.35,
          ease: easeOutCubic,
          apply: (k) => {
            if (v.tilt === token) g.rotation.x = from + (target - from) * k;
          },
        },
        instant,
      );
    }
  }

  private makeMeepleView(m: Meeple): MeepleView {
    const group = M.meepleGroup(this.kit, m.kind);
    group.userData.pick = `m:${m.id}`;
    group.visible = false;
    const base = group.scale.x;
    this.swapGlb(group, MODEL_OF_MEEPLE[m.kind]);
    return { kind: m.kind, group, base, visible: false, space: null, pop: 0, move: 0, tilt: 0 };
  }

  // ---- markers (hover and highlight) -------------------------------------------------------------------------------------

  private refreshMarkers(): void {
    if (!this.state) return;
    const want = new Map<string, { id: string; hl: boolean; sel?: boolean }>();
    for (const id of this.highlight) want.set(id + '|l', { id, hl: true });
    for (const id of this.selected) want.set(id + '|s', { id, hl: true, sel: true });
    if (this.hoverId && !this.highlight.has(this.hoverId)) want.set(this.hoverId + '|h', { id: this.hoverId, hl: false });
    for (const [key, mesh] of this.markerMeshes) {
      if (!want.has(key)) {
        this.layers.markers.remove(mesh);
        this.markerMeshes.delete(key);
      }
    }
    for (const [key, w] of want) {
      const xz = pickCentre(this.state, w.id, this.meeplePos);
      if (!xz) continue;
      let mesh = this.markerMeshes.get(key);
      if (!mesh) {
        mesh = new THREE.Mesh(this.markerGeometry(w.id), w.sel ? this.selMat : w.hl ? this.hlMat : this.hoverMat);
        mesh.renderOrder = 2;
        this.markerMeshes.set(key, mesh);
        this.layers.markers.add(mesh);
      }
      // space fans are drawn around their tile centre; everything else around its own centre
      const isSpace = !w.id.startsWith('b:') && !w.id.startsWith('m:') && !w.id.startsWith('tile:') && !w.id.startsWith('hex:');
      const centre = (isSpace && spaceTileCentre(this.state, w.id)) || xz;
      mesh.position.set(centre.x, w.sel ? 0.03 : 0.02, centre.z);
    }
    this.requestFrame();
  }

  private markerGeometry(id: string): THREE.BufferGeometry {
    if (id.startsWith('b:')) return this.kit.geo('ringB', () => ringGeo(0.36, 0.46));
    if (id.startsWith('m:')) return this.kit.geo('ringM', () => ringGeo(0.2, 0.27));
    if (id.startsWith('tile:') || id.startsWith('hex:')) return M.spaceFan(this.kit, 'full', 0);
    const sp = this.state?.spaces[id];
    if (sp?.tile === 'GEN') return M.spaceFan(this.kit, 'full', 0);
    return M.spaceFan(this.kit, sp?.slot === 'top' ? 'top' : 'bottom', 0);
  }

  // ---- pointer, keys, picking --------------------------------------------------------------------------------------------

  private bindEvents(): void {
    const on = (target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, opts);
      this.handlers.push({ target, type, fn, opts });
    };
    on(this.canvas, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    on(this.canvas, 'pointermove', (e) => this.onMove(e as PointerEvent));
    on(this.canvas, 'pointerup', (e) => this.onUp(e as PointerEvent));
    on(this.canvas, 'pointerleave', () => this.onLeave());
    on(this.canvas, 'pointerenter', () => (this.pointer.inside = true));
    on(this.canvas, 'contextmenu', (e) => e.preventDefault());
    on(this.canvas, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    on(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    on(window, 'blur', () => this.keys.clear());
  }

  private localXY(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onDown(e: PointerEvent): void {
    const [x, y] = this.localXY(e);
    this.pointer.down = e.button;
    this.pointer.sx = x;
    this.pointer.sy = y;
    this.pointer.lx = x;
    this.pointer.ly = y;
    this.pointer.moved = false;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer to capture */
    }
    this.canvas.style.cursor = 'grabbing';
  }

  private onMove(e: PointerEvent): void {
    const [x, y] = this.localXY(e);
    if (this.pointer.down >= 0) {
      const dx = x - this.pointer.lx;
      const dy = y - this.pointer.ly;
      if (Math.hypot(x - this.pointer.sx, y - this.pointer.sy) > 4) this.pointer.moved = true;
      this.pointer.lx = x;
      this.pointer.ly = y;
      if (this.pointer.moved) {
        // left drag rotates; right / middle drag (or shift + left) pans
        if (this.pointer.down === 0 && !e.shiftKey) this.rig.rotatePixels(dx, dy);
        else this.rig.panPixels(dx, dy);
        this.requestFrame();
      }
      return;
    }
    this.setHover(this.pickAt(x, y), x, y);
  }

  private onUp(e: PointerEvent): void {
    const [x, y] = this.localXY(e);
    const wasClick = this.pointer.down === 0 && !this.pointer.moved;
    this.pointer.down = -1;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released */
    }
    this.canvas.style.cursor = '';
    if (wasClick) {
      // a click answers the first highlighted pick under the pointer, so a building or Meeple standing on a highlighted
      // space does not block it; with nothing highlighted it reports the nearest pick, as before
      const ids = this.pickCandidates(x, y);
      const id = ids.find((c) => this.highlight.has(c)) ?? ids[0];
      // empty ground ('hex:') is only a pick when it is a highlighted option
      if (id && (!id.startsWith('hex:') || this.highlight.has(id))) this.hooks.onPick(id);
    }
  }

  private onLeave(): void {
    this.pointer.inside = false;
    if (this.pointer.down < 0) this.setHover(null, 0, 0);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.rig.zoom(e.deltaY);
    this.requestFrame();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.pointer.inside) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    e.preventDefault();
    this.requestFrame();
  }

  private setHover(id: string | null, x: number, y: number): void {
    // ordinary empty ground ('hex:') gets no tooltip, marker or pointer unless it is a highlighted option
    if (id?.startsWith('hex:') && !this.highlight.has(id)) id = null;
    let info: PickInfo | null = null;
    if (id && this.state) info = describePick(this.state, id);
    if (!info) id = null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.refreshMarkers();
    }
    this.canvas.style.cursor = id && this.highlight.has(id) ? 'pointer' : '';
    this.hooks.onHover(info, x, y);
    this.requestFrame();
  }

  /** Canonical pick id under a canvas pixel: meeples and buildings first, then the board plane. */
  private pickAt(x: number, y: number): string | null {
    return this.pickCandidates(x, y)[0] ?? null;
  }

  /** Every canonical pick id under a canvas pixel, nearest first: meeples and buildings, then the board plane. */
  private pickCandidates(x: number, y: number): string[] {
    if (!this.state) return [];
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    const out: string[] = [];
    const hits = this.raycaster.intersectObjects([this.layers.meeples, this.layers.buildings], true);
    for (const h of hits) {
      if (!shown(h.object)) continue;
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.pick === undefined) o = o.parent;
      if (o) out.push(o.userData.pick as string);
    }
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, p)) {
      const ground = worldToPick(this.state, p.x, p.z);
      if (ground) out.push(ground);
    }
    return out;
  }

  // ---- frame loop ------------------------------------------------------------------------------------------------------------

  private requestFrame(): void {
    if (this.raf || this.disposed) return;
    this.lastNow = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const busy = this.update(dt);
    this.renderer.render(this.scene, this.rig.camera);
    if (busy) this.raf = requestAnimationFrame(this.frame);
  };

  /** DEV perf hook: one simulation step plus one synchronous render, no requestAnimationFrame involved. */
  renderOnce(dt = 1 / 60): void {
    if (this.disposed) return;
    this.update(dt);
    this.renderer.render(this.scene, this.rig.camera);
  }

  /** DEV perf hook: sync resize (ResizeObserver is asynchronous, so the bench calls this after it changes the host size). */
  debugResize(): void {
    this.resize();
  }

  /** DEV perf hook: the element the canvas lives in (its size drives resize()). */
  debugHost(): HTMLElement {
    return this.host;
  }

  /** DEV perf hook: renderer statistics (info.render is reset by every render call, so it holds the last frame). */
  debugInfo(): { calls: number; triangles: number; geometries: number; textures: number; programs: number; canvas: [number, number]; pixelRatio: number } {
    const info = this.renderer.info;
    const size = this.renderer.getSize(new THREE.Vector2());
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      canvas: [Math.round(size.x), Math.round(size.y)],
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  /** One simulation step (tweens, camera, held keys, pulse, ambient layer). Returns true while something still moves. */
  private update(dt: number): boolean {
    this.time += dt;
    const instant = this.quality === 'low';
    const ambient = this.quality === 'high';
    const pulsing = this.quality !== 'low' && (this.highlight.size > 0 || this.hoverId !== null);

    let busy = this.tweens.update(dt);

    if (this.keys.size) {
      const step = this.rig.camera.position.length() * 0.6 * dt;
      let fx = 0;
      let fz = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
      if (fx || fz) this.rig.panGoal(fx * step, fz * step);
      busy = true;
    }
    if (this.rig.update(dt, instant)) busy = true;

    if (pulsing) {
      this.hlMat.opacity = 0.3 + 0.16 * Math.sin(this.time * 4.2);
      this.hoverMat.opacity = 0.26 + 0.08 * Math.sin(this.time * 6);
      busy = true;
    }
    if (ambient) {
      busy = true;
      this.applyGlow(0.94 + 0.05 * Math.sin(this.time * 3.1) + 0.03 * Math.sin(this.time * 11.3));
      for (const v of this.buildingViews.values()) {
        for (const sp of v.spinners) sp.rotation.y += dt * 1.6;
      }
      this.stepSnow(dt);
    }
    return busy;
  }

  private stepSnow(dt: number): void {
    if (!this.snow) return;
    const pos = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const wind = 0.35;
    for (let i = 0; i < this.snowSpeed.length; i++) {
      const o = i * 3;
      arr[o + 1] -= this.snowSpeed[i] * dt;
      arr[o] += wind * dt;
      if (arr[o + 1] < 0) {
        arr[o + 1] = 9 + Math.random();
        arr[o] = (Math.random() - 0.5) * SNOW_BOX;
        arr[o + 2] = (Math.random() - 0.5) * SNOW_BOX;
      }
      if (arr[o] > SNOW_BOX / 2) arr[o] -= SNOW_BOX;
    }
    pos.needsUpdate = true;
  }
}

// ---- helpers --------------------------------------------------------------------------------------------------------------

function ringGeo(inner: number, outer: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(inner, outer, 32);
  g.rotateX(-Math.PI / 2);
  return g;
}

const gltfCache = new Map<string, Promise<THREE.Object3D | null>>();

/**
 * Lazily loads a GLB through three's GLTFLoader (only reached when the assets manifest provides a URL). A failed load,
 * including a failed import of the loader chunk, resolves to null, so no caller sees an unhandled rejection.
 */
/**
 * Bounding box of the holder's contents in the holder's own frame. Ancestors' transforms and the holder's own position,
 * scale and rotation are left out, because the pop-in tweens and the parent group change them while a GLB is loading.
 * The holder's matrixWorld is set to identity for the measurement, so its children are measured without the parents.
 */
function frameBox(holder: THREE.Object3D): THREE.Box3 {
  const world = holder.matrixWorld.clone();
  holder.matrixWorld.identity();
  const box = new THREE.Box3();
  for (const child of holder.children) box.union(new THREE.Box3().setFromObject(child));
  holder.matrixWorld.copy(world);
  return box;
}

function loadGltf(url: string): Promise<THREE.Object3D | null> {
  let p = gltfCache.get(url);
  if (!p) {
    p = import('three/examples/jsm/loaders/GLTFLoader.js')
      .then(
        ({ GLTFLoader }) =>
          new Promise<THREE.Object3D | null>((resolve) => {
            new GLTFLoader().load(
              url,
              (gltf) => resolve(gltf.scene),
              undefined,
              () => resolve(null),
            );
          }),
      )
      .catch(() => null);
    gltfCache.set(url, p);
  }
  return p;
}
