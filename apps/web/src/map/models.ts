// Procedural low-poly stand-ins for every map object. Used whenever no GLB exists for an object (see assetsStub.ts),
// so the map is complete without any asset. All geometry and materials come from the per-scene Kit.
import * as THREE from 'three';
import { HEX, HALF_DZ, SQRT3, type Slot } from './hex';
import { PAL, INS_COLOR, categoryColor } from './palette';
import type { Kit } from './kit';

/**
 * Sets shadow flags on every mesh under `o`. Meshes tagged `userData.decor` (flat ground-level pieces whose shadow is
 * invisible) only receive: every extra caster costs one more draw call in the shadow pass.
 */
export function shadowed<T extends THREE.Object3D>(o: T, cast = true): T {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = cast && !m.userData.decor;
      m.receiveShadow = true;
    }
  });
  return o;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]): THREE.Mesh {
  return new THREE.Mesh(geo, mat);
}

/** Deterministic 0..1 hash of a string or number (for variants and jitter). */
export function hash01(v: string | number, salt = 0): number {
  const s = typeof v === 'number' ? String(v) : v;
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

// ---- ground ---------------------------------------------------------------------------------------------------

const TILE_DEPTH = 0.2;
const TILE_BEVEL = 0.025;

/** Flat-top hex slab with its top face at y = 0 and bevelled edges. */
export function hexSlab(kit: Kit): THREE.BufferGeometry {
  return kit.geo('hexSlab', () => {
    const shape = new THREE.Shape();
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      const x = Math.cos(a) * 0.965;
      const y = Math.sin(a) * 0.965;
      if (k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: TILE_DEPTH,
      bevelEnabled: true,
      bevelThickness: TILE_BEVEL,
      bevelSize: TILE_BEVEL * 0.8,
      bevelSegments: 1,
      curveSegments: 1,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -(TILE_DEPTH + TILE_BEVEL), 0);
    g.computeVertexNormals();
    return g;
  });
}

export interface GroundMats {
  snow: THREE.Material[];
  warm: THREE.Material[];
  gen: THREE.Material[];
  road: THREE.Material[];
  dread: THREE.Material[];
}

export function groundMats(kit: Kit, snowTex: THREE.Texture): GroundMats {
  const side = (c: number) =>
    kit.mat('side:' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.15 }));
  const top = (c: number, key: string) =>
    kit.mat('top:' + key, () => new THREE.MeshStandardMaterial({ color: c, map: snowTex, roughness: 0.95, metalness: 0 }));
  return {
    snow: [top(PAL.snow, 'snow'), side(PAL.steelDark)],
    warm: [top(PAL.snowWarm, 'warm'), side(PAL.steelDark)],
    gen: [top(PAL.snowGen, 'gen'), side(PAL.steelDark)],
    road: [kit.mat('top:road', () => new THREE.MeshStandardMaterial({ color: PAL.road, roughness: 1 })), side(PAL.steelDark)],
    dread: [top(PAL.snowDread, 'dread'), side(PAL.steel)],
  };
}

/** Triangle fan covering one half of a tile (or a full hex), in tile-local coordinates, lying at y = yOff. */
export function spaceFan(kit: Kit, which: Slot | 'full', yOff = 0.012): THREE.BufferGeometry {
  return kit.geo('fan:' + which + ':' + yOff, () => {
    const h = (SQRT3 / 2) * HEX * 0.93;
    const s = 0.93 * HEX;
    let pts: { x: number; z: number }[];
    let cx = 0;
    let cz = 0;
    if (which === 'full') {
      pts = [];
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        pts.push({ x: Math.cos(a) * s, z: Math.sin(a) * s });
      }
    } else {
      const sign = which === 'top' ? -1 : 1;
      pts = [
        { x: s, z: 0 },
        { x: s / 2, z: sign * h },
        { x: -s / 2, z: sign * h },
        { x: -s, z: 0 },
      ];
      cz = sign * HALF_DZ;
    }
    const pos: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      pos.push(cx, yOff, cz, a.x, yOff, a.z, b.x, yOff, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
}

/** Thin dark seam between the two spaces of a tile (along x through the centre). */
export function seamGeo(kit: Kit): THREE.BufferGeometry {
  return kit.geo('seam', () => new THREE.BoxGeometry(1.86 * HEX, 0.012, 0.022));
}

// ---- resources and trees ----------------------------------------------------------------------------------------

export function pineTree(kit: Kit, seed: number): THREE.Group {
  const g = new THREE.Group();
  const trunk = mesh(
    kit.geo('trunk', () => new THREE.CylinderGeometry(0.025, 0.035, 0.16, 5)),
    kit.mat('trunk', () => new THREE.MeshStandardMaterial({ color: PAL.woodDark, roughness: 1 })),
  );
  trunk.position.y = 0.08;
  g.add(trunk);
  const foliage = kit.mat('pine', () => new THREE.MeshStandardMaterial({ color: PAL.pine, roughness: 0.9, flatShading: true }));
  const cap = kit.mat('pineSnow', () => new THREE.MeshStandardMaterial({ color: PAL.pineSnow, roughness: 0.8, flatShading: true }));
  const tiers: [string, number, number, number][] = [
    ['c1', 0.2, 0.36, 0.26],
    ['c2', 0.15, 0.3, 0.42],
    ['c3', 0.09, 0.24, 0.56],
  ];
  for (const [key, rad, hgt, y] of tiers) {
    const m = mesh(kit.geo('cone' + key, () => new THREE.ConeGeometry(rad, hgt, 7)), foliage);
    m.position.y = y;
    g.add(m);
  }
  const tip = mesh(kit.geo('pinecap', () => new THREE.ConeGeometry(0.05, 0.1, 7)), cap);
  tip.position.y = 0.66;
  g.add(tip);
  const s = 0.85 + seed * 0.3;
  g.scale.setScalar(s);
  g.rotation.y = seed * Math.PI * 2;
  return shadowed(g);
}

export function woodLog(kit: Kit): THREE.Mesh {
  const m = mesh(
    kit.geo('log', () => {
      const geo = new THREE.CylinderGeometry(0.036, 0.036, 0.26, 6);
      geo.rotateZ(Math.PI / 2);
      return geo;
    }),
    kit.mat('wood', () => new THREE.MeshStandardMaterial({ color: PAL.wood, roughness: 0.95, flatShading: true })),
  );
  m.position.y = 0.036;
  return shadowed(m);
}

export function coalLump(kit: Kit): THREE.Mesh {
  const m = mesh(
    kit.geo('coal', () => {
      const geo = new THREE.IcosahedronGeometry(0.08, 0);
      geo.scale(1, 0.7, 0.9);
      return geo;
    }),
    kit.mat('coal', () => new THREE.MeshStandardMaterial({ color: PAL.coal, roughness: 0.55, metalness: 0.2, flatShading: true })),
  );
  m.position.y = 0.056;
  return shadowed(m);
}

export function steamCore(kit: Kit): THREE.Mesh {
  const m = mesh(
    kit.geo('core', () => new THREE.OctahedronGeometry(0.095, 0)),
    kit.mat('core', () =>
      new THREE.MeshStandardMaterial({ color: PAL.core, emissive: PAL.core, emissiveIntensity: 1.5, roughness: 0.3 }),
    ),
  );
  m.position.y = 0.12;
  return shadowed(m);
}

// ---- meeples ----------------------------------------------------------------------------------------------------

export function meepleGroup(kit: Kit, kind: string): THREE.Group {
  const g = new THREE.Group();
  const bodyCol =
    kind === 'engineer' || kind === 'childEngineer'
      ? PAL.meepleEngineer
      : kind === 'child' || kind === 'childWorker' || kind === 'childEngineer'
        ? PAL.meepleChild
        : kind === 'automaton'
          ? PAL.meepleAutomaton
          : PAL.meepleWorker;
  const skin = kit.mat('skin', () => new THREE.MeshStandardMaterial({ color: 0xe2c2a0, roughness: 0.8 }));
  const body = (c: number) =>
    kit.mat('body:' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  if (kind === 'automaton') {
    const metal = kit.mat('automaton', () => new THREE.MeshStandardMaterial({ color: PAL.meepleAutomaton, roughness: 0.4, metalness: 0.6 }));
    const b = mesh(kit.geo('autoBody', () => new THREE.BoxGeometry(0.2, 0.28, 0.16)), metal);
    b.position.y = 0.16;
    const h = mesh(kit.geo('autoHead', () => new THREE.BoxGeometry(0.14, 0.12, 0.14)), metal);
    h.position.y = 0.36;
    const eye = mesh(
      kit.geo('autoEye', () => new THREE.SphereGeometry(0.028, 8, 6)),
      kit.mat('eye', () => new THREE.MeshStandardMaterial({ color: PAL.meepleEye, emissive: PAL.meepleEye, emissiveIntensity: 2 })),
    );
    eye.position.set(0, 0.37, 0.075);
    g.add(b, h, eye);
  } else {
    const b = mesh(kit.geo('torso', () => new THREE.CylinderGeometry(0.085, 0.115, 0.3, 8)), body(bodyCol));
    b.position.y = 0.15;
    const head = mesh(kit.geo('head', () => new THREE.SphereGeometry(0.08, 10, 8)), skin);
    head.position.y = 0.36;
    g.add(b, head);
    if (kind === 'worker' || kind === 'childWorker') {
      const hat = mesh(
        kit.geo('hat', () => new THREE.CylinderGeometry(0.09, 0.09, 0.05, 8)),
        kit.mat('hatWorker', () => new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.9 })),
      );
      hat.position.y = 0.43;
      g.add(hat);
    }
    if (kind === 'engineer' || kind === 'childEngineer') {
      const cap = mesh(
        kit.geo('cap', () => new THREE.CylinderGeometry(0.1, 0.1, 0.04, 10)),
        kit.mat('hatEng', () => new THREE.MeshStandardMaterial({ color: 0x2b5f86, roughness: 0.6 })),
      );
      cap.position.y = 0.43;
      g.add(cap);
    }
  }
  const scale = kind === 'child' || kind === 'childWorker' || kind === 'childEngineer' ? 0.62 : 1;
  g.scale.setScalar(scale);
  return shadowed(g);
}

// ---- buildings --------------------------------------------------------------------------------------------------

export interface BuildingSpec {
  kind: string;
  large: boolean;
  ins: string;
  group?: string;
  upgraded: boolean;
  ruins: boolean;
  seed: number;
}

export function buildingGroup(kit: Kit, spec: BuildingSpec): THREE.Group {
  const root = new THREE.Group();
  const large = spec.large;
  const w = large ? 0.6 : 0.46;
  const d = large ? 0.9 : 0.38;
  const insCol = INS_COLOR[spec.ins] ?? INS_COLOR.W;
  const steelDark = kit.mat('steelDark', () => new THREE.MeshStandardMaterial({ color: PAL.steelDark, roughness: 0.8, metalness: 0.2 }));
  const plinth = mesh(kit.geo('plinth:' + large, () => new THREE.BoxGeometry(w + 0.06, 0.05, d + 0.06)), steelDark);
  plinth.position.y = 0.025;
  plinth.userData.decor = true;
  root.add(plinth);
  const ring = mesh(
    kit.geo('insRing:' + large, () => {
      const g = new THREE.TorusGeometry(1, 0.02, 6, 32);
      g.rotateX(Math.PI / 2);
      return g;
    }),
    kit.mat('ins:' + spec.ins, () => new THREE.MeshStandardMaterial({ color: insCol, emissive: insCol, emissiveIntensity: 0.6, roughness: 0.5 })),
  );
  ring.scale.set(w / 2 + 0.03, 1, d / 2 + 0.03);
  ring.position.y = 0.055;
  ring.userData.decor = true;
  root.add(ring);

  if (spec.ruins) {
    const stone = kit.mat('ruin', () => new THREE.MeshStandardMaterial({ color: PAL.ruin, roughness: 1 }));
    const snowMat = kit.mat('ruinSnow', () => new THREE.MeshStandardMaterial({ color: PAL.frost, roughness: 0.9 }));
    for (let i = 0; i < 4; i++) {
      const hh = 0.1 + hash01(spec.seed, i) * 0.14;
      const b = mesh(kit.geo('rubble' + i, () => new THREE.BoxGeometry(0.16 + i * 0.02, 0.16, 0.1)), stone);
      b.scale.y = hh / 0.16;
      b.position.set((hash01(spec.seed, 10 + i) - 0.5) * w * 0.9, hh / 2 + 0.03, (hash01(spec.seed, 20 + i) - 0.5) * d * 0.8);
      b.rotation.y = hash01(spec.seed, 30 + i) * Math.PI;
      root.add(b);
      const cap = mesh(kit.geo('ruinCap', () => new THREE.BoxGeometry(0.17, 0.02, 0.11)), snowMat);
      cap.position.set(b.position.x, b.position.y + hh / 2 + 0.01, b.position.z);
      cap.rotation.y = b.rotation.y;
      root.add(cap);
    }
    return shadowed(root);
  }

  const bodyH = large ? 0.3 : 0.24;
  const bodyCol = categoryColor(spec.group);
  const body = mesh(
    kit.geo('body:' + large, () => new THREE.BoxGeometry(w * 0.82, bodyH, d * 0.82)),
    kit.mat('bodyCat:' + bodyCol, () => new THREE.MeshStandardMaterial({ color: bodyCol, roughness: 0.9, flatShading: true })),
  );
  body.position.y = 0.05 + bodyH / 2;
  root.add(body);
  const top = 0.05 + bodyH;

  const variant = Math.floor(hash01(spec.kind, 3) * 3);
  const roofMat = kit.mat('roof:' + spec.ins, () => new THREE.MeshStandardMaterial({ color: insCol, roughness: 0.7, flatShading: true }));
  if (variant === 0) {
    const roof = mesh(kit.geo('pyramid', () => new THREE.ConeGeometry(0.5, 0.2, 4)), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set((w * 0.66) / 0.5, 1, (d * 0.66) / 0.5);
    roof.position.y = top + 0.1;
    root.add(roof);
  } else if (variant === 1) {
    const shape = new THREE.Shape();
    shape.moveTo(-w * 0.5, 0);
    shape.lineTo(w * 0.5, 0);
    shape.lineTo(0, 0.2);
    shape.closePath();
    const geo = kit.geo('gable:' + large, () => {
      const g = new THREE.ExtrudeGeometry(shape, { depth: d * 0.9, bevelEnabled: false, curveSegments: 1 });
      g.translate(0, 0, -d * 0.45);
      return g;
    });
    const roof = mesh(geo, roofMat);
    roof.position.y = top;
    root.add(roof);
  } else {
    const slab = mesh(kit.geo('flatRoof:' + large, () => new THREE.BoxGeometry(w * 0.9, 0.05, d * 0.9)), roofMat);
    slab.position.y = top + 0.025;
    root.add(slab);
    const tank = mesh(
      kit.geo('tank', () => new THREE.CylinderGeometry(0.07, 0.07, 0.18, 8)),
      kit.mat('tankSteel', () => new THREE.MeshStandardMaterial({ color: PAL.steel, roughness: 0.4, metalness: 0.7 })),
    );
    tank.position.set(w * 0.2, top + 0.14, 0);
    root.add(tank);
  }

  if (spec.kind === 'generator') {
    const steel = kit.mat('genSteel', () => new THREE.MeshStandardMaterial({ color: PAL.steel, roughness: 0.4, metalness: 0.7 }));
    for (const x of [-0.12, 0.14]) {
      const st = mesh(kit.geo('genStack', () => new THREE.CylinderGeometry(0.035, 0.045, 0.85, 6)), steel);
      st.position.set(x, top + 0.45, -d * 0.2);
      root.add(st);
      const tip = mesh(
        kit.geo('genTip', () => new THREE.SphereGeometry(0.04, 8, 6)),
        kit.mat('emberTip', () => new THREE.MeshStandardMaterial({ color: PAL.ember, emissive: PAL.ember, emissiveIntensity: 2 })),
      );
      tip.position.set(x, top + 0.9, -d * 0.2);
      root.add(tip);
    }
  } else if (!large && spec.group !== 'shelter' && spec.group !== 'law') {
    const chimney = mesh(
      kit.geo('chimney', () => new THREE.CylinderGeometry(0.03, 0.04, 0.26, 6)),
      kit.mat('chimney', () => new THREE.MeshStandardMaterial({ color: PAL.steelDark, roughness: 0.7, metalness: 0.3 })),
    );
    chimney.position.set(w * 0.26, top + 0.18, -d * 0.22);
    root.add(chimney);
  }

  if (spec.upgraded) {
    const marker = mesh(
      kit.geo('upgMarker', () => new THREE.OctahedronGeometry(0.06, 0)),
      kit.mat('upgMarker', () => new THREE.MeshStandardMaterial({ color: PAL.emberHi, emissive: PAL.emberHi, emissiveIntensity: 1.2 })),
    );
    marker.position.y = top + 0.36;
    marker.userData.spin = true;
    root.add(marker);
  }
  return shadowed(root);
}

// ---- generator crater -------------------------------------------------------------------------------------------

export interface CraterParts {
  group: THREE.Group;
  glow: THREE.Mesh;
  sprite: THREE.Sprite;
  light: THREE.PointLight;
}

export function craterParts(kit: Kit, glowTex: THREE.Texture): CraterParts {
  const group = new THREE.Group();
  const pit = mesh(
    kit.geo('pit', () => new THREE.CylinderGeometry(0.8, 0.9, 0.1, 48)),
    kit.mat('pit', () => new THREE.MeshStandardMaterial({ color: 0x1a232b, roughness: 0.95, flatShading: true })),
  );
  pit.position.y = -0.02;
  group.add(pit);
  const rim = mesh(
    kit.geo('craterRim', () => {
      const g = new THREE.TorusGeometry(0.84, 0.05, 8, 56);
      g.rotateX(Math.PI / 2);
      return g;
    }),
    kit.mat('rockHi', () => new THREE.MeshStandardMaterial({ color: PAL.rockHi, roughness: 0.8, metalness: 0.2 })),
  );
  rim.position.y = 0.03;
  group.add(rim);
  const glow = mesh(
    kit.geo('emberDisc', () => {
      const g = new THREE.CircleGeometry(0.66, 40);
      g.rotateX(-Math.PI / 2);
      return g;
    }),
    kit.mat('emberDisc', () =>
      new THREE.MeshBasicMaterial({ color: PAL.ember, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }),
    ),
  );
  glow.position.y = 0.012;
  group.add(glow);
  const sprite = new THREE.Sprite(
    kit.mat('glowSprite', () =>
      new THREE.SpriteMaterial({ map: glowTex, color: PAL.ember, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
    ),
  );
  sprite.scale.setScalar(2.8);
  sprite.position.y = 0.55;
  group.add(sprite);
  const light = new THREE.PointLight(PAL.ember, 1, 9, 1.6);
  light.position.y = 0.8;
  group.add(light);
  return { group, glow, sprite, light };
}

// ---- rim ----------------------------------------------------------------------------------------------------------

/** Dark rock band around the map through the given corner points (world xz), plus instanced boulders on its outer edge. */
export function rimGroup(kit: Kit, corners: { x: number; z: number }[]): THREE.Group {
  const group = new THREE.Group();
  if (corners.length < 3) return group;
  const cx = corners.reduce((a, p) => a + p.x, 0) / corners.length;
  const cz = corners.reduce((a, p) => a + p.z, 0) / corners.length;
  const scaled = (k: number) => corners.map((p) => ({ x: cx + (p.x - cx) * k, z: cz + (p.z - cz) * k }));
  const inner = scaled(1.0);
  const outer = scaled(1.22);
  const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, -p.z)));
  shape.holes.push(new THREE.Path(inner.map((p) => new THREE.Vector2(p.x, -p.z))));
  const band = mesh(
    kit.geo('rimBand', () => {
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 1 });
      g.rotateX(-Math.PI / 2);
      g.translate(0, -0.25, 0);
      return g;
    }),
    kit.mat('rockBand', () => new THREE.MeshStandardMaterial({ color: PAL.rock, roughness: 0.9, metalness: 0.25, flatShading: true })),
  );
  group.add(shadowed(band));

  // boulders along the outer edge
  const boulderPos: { x: number; z: number }[] = [];
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    const n = 9;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      boulderPos.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  const inst = new THREE.InstancedMesh(
    kit.geo('boulder', () => new THREE.DodecahedronGeometry(0.2, 0)),
    kit.mat('boulder', () => new THREE.MeshStandardMaterial({ color: PAL.rockHi, roughness: 0.95, flatShading: true })),
    boulderPos.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  boulderPos.forEach((bp, i) => {
    const h = hash01(i, 11);
    const sc = 0.55 + h * 0.6;
    p.set(bp.x, 0.02 + sc * 0.08, bp.z);
    q.setFromEuler(new THREE.Euler(hash01(i, 13) * 3, hash01(i, 14) * 3, 0));
    s.set(sc, sc * 0.8, sc);
    m.compose(p, q, s);
    inst.setMatrixAt(i, m);
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = true;
  inst.receiveShadow = true;
  group.add(inst);

  // snow plain beyond the rim
  const plain = mesh(
    kit.geo('plain', () => {
      const g = new THREE.CircleGeometry(60, 48);
      g.rotateX(-Math.PI / 2);
      return g;
    }),
    kit.mat('plain', () => new THREE.MeshStandardMaterial({ color: PAL.ground, roughness: 1 })),
  );
  plain.position.y = -0.3;
  group.add(plain);
  return group;
}

/** A pile of resources left on the rim (deposit). */
export function depositPile(kit: Kit, deposit: 'wood' | 'coal'): THREE.Group {
  const g = new THREE.Group();
  if (deposit === 'wood') {
    for (let i = 0; i < 4; i++) {
      const l = woodLog(kit);
      l.position.set(((i % 2) - 0.5) * 0.18, 0.04 + Math.floor(i / 2) * 0.07, (hash01(i, 5) - 0.5) * 0.05);
      l.rotation.y = i * 0.6;
      g.add(l);
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const c = coalLump(kit);
      c.position.set((hash01(i, 6) - 0.5) * 0.22, 0.05 + (i > 2 ? 0.07 : 0), (hash01(i, 7) - 0.5) * 0.18);
      c.rotation.y = i;
      g.add(c);
    }
  }
  return shadowed(g);
}

export const TILE_SIZE = HEX;
