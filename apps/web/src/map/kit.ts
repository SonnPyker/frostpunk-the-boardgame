// Per-scene cache of geometries, materials and textures. Everything the map builds comes from here,
// so disposing a scene is one loop and objects can be removed from the graph without leaking GPU memory.
import * as THREE from 'three';

type Disposable = { dispose(): void };

export class Kit {
  private geos = new Map<string, THREE.BufferGeometry>();
  private mats = new Map<string, THREE.Material>();
  private texs = new Map<string, THREE.Texture>();
  private disposed = false;

  geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geos.get(key);
    if (!g) {
      g = make();
      this.geos.set(key, g);
    }
    return g;
  }

  mat<M extends THREE.Material>(key: string, make: () => M): M {
    let m = this.mats.get(key);
    if (!m) {
      m = make();
      this.mats.set(key, m);
    }
    return m as M;
  }

  tex(key: string, make: () => THREE.Texture): THREE.Texture {
    let t = this.texs.get(key);
    if (!t) {
      t = make();
      this.texs.set(key, t);
    }
    return t;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const all: Disposable[] = [...this.geos.values(), ...this.mats.values(), ...this.texs.values()];
    for (const d of all) d.dispose();
    this.geos.clear();
    this.mats.clear();
    this.texs.clear();
  }
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Procedural snow: soft drifts plus faint wind streaks. Tileable. */
export function makeSnowTexture(): THREE.CanvasTexture {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#dbe8ef';
  g.fillRect(0, 0, size, size);
  const rand = rng(7);
  const blob = (x: number, y: number, r: number, col: string, a: number) => {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, col.replace('A', String(a)));
        gr.addColorStop(1, col.replace('A', '0'));
        g.fillStyle = gr;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  };
  for (let i = 0; i < 90; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 14 + rand() * 46;
    blob(x, y, r, rand() > 0.5 ? 'rgba(255,255,255,A)' : 'rgba(120,150,170,A)', 0.14 + rand() * 0.12);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = rand() * size;
    const y = rand() * size;
    g.strokeStyle = `rgba(255,255,255,${0.12 + rand() * 0.14})`;
    g.lineWidth = 1 + rand() * 2;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + 30, y - 6, x + 60, y + 8, x + 90 + rand() * 40, y - 4);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Round soft sprite (glow / flakes). White core fading to transparent. */
export function makeRadialTexture(size: number, inner = 1): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d')!;
  const c = size / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, `rgba(255,255,255,1)`);
  gr.addColorStop(inner, `rgba(255,255,255,0.45)`);
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
