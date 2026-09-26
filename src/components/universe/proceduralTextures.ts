/**
 * Fully procedural canvas textures for the solar-system scene.
 * No external images — everything painted pixel-by-pixel with seeded,
 * horizontally-periodic value noise so equirectangular maps wrap seamlessly.
 */
import * as THREE from 'three';

/* ------------------------------ seeded RNG ------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------- horizontally-periodic value noise --------------------- */

class PeriodicNoise {
  private readonly size = 256;
  private readonly values: Float32Array;

  constructor(seed: number) {
    const rnd = mulberry32(seed);
    this.values = new Float32Array(this.size * this.size);
    for (let i = 0; i < this.values.length; i++) this.values[i] = rnd();
  }

  private lattice(ix: number, iy: number, px: number): number {
    const x = ((ix % px) + px) % px;
    const y = ((iy % this.size) + this.size) % this.size;
    return this.values[y * this.size + x];
  }

  /** sample — px must be a positive integer horizontal period */
  sample(x: number, y: number, px: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const v00 = this.lattice(ix, iy, px);
    const v10 = this.lattice(ix + 1, iy, px);
    const v01 = this.lattice(ix, iy + 1, px);
    const v11 = this.lattice(ix + 1, iy + 1, px);
    const a = v00 + (v10 - v00) * sx;
    const b = v01 + (v11 - v01) * sx;
    return a + (b - a) * sy;
  }

  fbm(x: number, y: number, px: number, octaves = 4): number {
    let amp = 0.5;
    let freq = 1;
    let period = px;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.sample(x * freq, y * freq, period);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
      period *= 2;
    }
    return sum / norm;
  }
}

/* ------------------------------ color utils ------------------------------ */

type RGB = [number, number, number];
type Stop = [number, string];

function hex(c: string): RGB {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function ramp(stops: Stop[], t: number): RGB {
  const v = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (v >= p0 && v <= p1) {
      const k = p1 === p0 ? 0 : (v - p0) / (p1 - p0);
      const a = hex(c0);
      const b = hex(c1);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return hex(stops[stops.length - 1][1]);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return [canvas, ctx];
}

function paintPixels(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fn: (u: number, v: number) => RGB
): void {
  const img = ctx.createImageData(w, h);
  const data = img.data;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const c = fn(u, v);
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function addCraters(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, seed: number): void {
  const rnd = mulberry32(seed * 7919 + 13);
  for (let i = 0; i < count; i++) {
    const cx = rnd() * w;
    const cy = h * 0.12 + rnd() * h * 0.76;
    const r = 1.5 + rnd() * rnd() * 11;
    ctx.globalAlpha = 0.18 + rnd() * 0.22;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.14 + rnd() * 0.16;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.9, Math.PI * 1.9);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------ generators ------------------------------ */

const W = 512;
const H = 256;

export function createSunTexture(): HTMLCanvasElement {
  const n = new PeriodicNoise(101);
  const [canvas, ctx] = makeCanvas(W, H);
  const sunStops: Stop[] = [
    [0, '#7a1e00'],
    [0.35, '#e35b0f'],
    [0.6, '#ff9d2e'],
    [0.82, '#ffd86b'],
    [1, '#fff3c4'],
  ];
  paintPixels(ctx, W, H, (u, v) => {
    const big = n.fbm(u * 10, v * 5, 10, 5);
    const fine = n.fbm(u * 42, v * 21, 42, 3);
    let t = big * 0.68 + fine * 0.32;
    const spot = n.fbm(u * 6 + 31, v * 3 + 7, 6, 3);
    if (spot > 0.74) t *= 1 - Math.min(0.55, (spot - 0.74) * 4);
    return ramp(sunStops, t);
  });
  return canvas;
}

interface RockyOpts {
  stops: Stop[];
  craters: number;
  capColor?: string;
  capSize?: number;
}

export function createRockyTexture(seed: number, o: RockyOpts): HTMLCanvasElement {
  const n = new PeriodicNoise(seed);
  const [canvas, ctx] = makeCanvas(W, H);
  paintPixels(ctx, W, H, (u, v) => {
    const base = n.fbm(u * 8, v * 4, 8, 5);
    const detail = n.fbm(u * 28, v * 14, 28, 3);
    let c = ramp(o.stops, base * 0.75 + detail * 0.25);
    if (o.capColor) {
      const cap = Math.max(
        smoothstep(o.capSize ?? 0.08, 0, v),
        smoothstep(o.capSize ?? 0.08, 0, 1 - v)
      );
      const k = hex(o.capColor);
      c = [c[0] + (k[0] - c[0]) * cap, c[1] + (k[1] - c[1]) * cap, c[2] + (k[2] - c[2]) * cap];
    }
    return c;
  });
  if (o.craters > 0) addCraters(ctx, W, H, o.craters, seed);
  return canvas;
}

export function createEarthTexture(): HTMLCanvasElement {
  const n = new PeriodicNoise(42);
  const [canvas, ctx] = makeCanvas(W, H);
  paintPixels(ctx, W, H, (u, v) => {
    const cont = n.fbm(u * 6, v * 3, 6, 6) * 0.72 + n.fbm(u * 15, v * 7.5, 15, 4) * 0.28;
    let c: RGB;
    if (cont > 0.585) {
      // land — green to tan by secondary noise + latitude dryness
      const dry = n.fbm(u * 9 + 40, v * 4.5 + 11, 9, 4);
      const lat = Math.abs(v - 0.5) * 2;
      const g = ramp(
        [
          [0, '#2e6b34'],
          [0.45, '#4d8a3d'],
          [0.7, '#a5914e'],
          [1, '#8a6b42'],
        ],
        dry * 0.6 + lat * 0.4
      );
      // coast brightness
      const coast = 1 - smoothstep(0.585, 0.62, cont);
      c = [g[0] * (1 + coast * 0.25), g[1] * (1 + coast * 0.25), g[2] * (1 + coast * 0.25)];
    } else if (cont > 0.565) {
      c = [40 + (cont - 0.565) * 800, 110 + (cont - 0.565) * 600, 150]; // shallow water
    } else {
      c = ramp(
        [
          [0, '#061e3e'],
          [0.7, '#0d3d6e'],
          [1, '#155c9c'],
        ],
        cont / 0.565
      );
    }
    // polar ice
    const ice = Math.max(smoothstep(0.075, 0.02, v), smoothstep(0.925, 0.98, v));
    c = [c[0] + (232 - c[0]) * ice, c[1] + (240 - c[1]) * ice, c[2] + (246 - c[2]) * ice];
    // clouds
    const cl = n.fbm(u * 9 + 91, v * 4.5 + 23, 9, 4);
    if (cl > 0.615) {
      const a = Math.min(0.6, (cl - 0.615) * 2.6);
      c = [c[0] + (250 - c[0]) * a, c[1] + (252 - c[1]) * a, c[2] + (255 - c[2]) * a];
    }
    return c;
  });
  return canvas;
}

export function createGasTexture(
  seed: number,
  stops: Stop[],
  turbulence: number,
  bandFreq: number
): HTMLCanvasElement {
  const n = new PeriodicNoise(seed);
  const [canvas, ctx] = makeCanvas(W, H);
  paintPixels(ctx, W, H, (u, v) => {
    const swirl = n.fbm(u * 5, v * bandFreq, 5, 5);
    const streak = n.fbm(u * 34, v * bandFreq * 3, 34, 3);
    let vv = v + (swirl - 0.5) * turbulence;
    vv = Math.min(0.999, Math.max(0.001, vv));
    const c = ramp(stops, vv);
    const bright = 1 + (streak - 0.5) * 0.22;
    return [c[0] * bright, c[1] * bright, c[2] * bright];
  });
  return canvas;
}

export function createSaturnRingTexture(): HTMLCanvasElement {
  const rw = 640;
  const rh = 16;
  const n = new PeriodicNoise(77);
  const [canvas, ctx] = makeCanvas(rw, rh);
  const img = ctx.createImageData(rw, rh);
  const data = img.data;
  for (let x = 0; x < rw; x++) {
    const t = x / rw;
    // base band profile
    let a = smoothstep(0, 0.04, t) * (1 - smoothstep(0.96, 1, t)) * 0.85;
    // Cassini division + inner gap
    a *= 1 - 0.92 * Math.exp(-((t - 0.635) ** 2) / (2 * 0.018 ** 2));
    a *= 1 - 0.8 * Math.exp(-((t - 0.3) ** 2) / (2 * 0.014 ** 2));
    // grooves
    a *= 0.55 + 0.45 * n.sample(t * 90, 0.5, 1 << 28);
    a *= 0.75 + 0.25 * n.sample(t * 340, 3.5, 1 << 28);
    const mixN = n.sample(t * 24, 8.2, 1 << 28);
    const c: RGB = [176 + mixN * 70, 152 + mixN * 62, 112 + mixN * 52];
    for (let y = 0; y < rh; y++) {
      const i = (y * rw + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function createGlowTexture(
  size: number,
  inner: string,
  mid: string,
  outer: string
): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, mid);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

export function createStarSpriteTexture(): HTMLCanvasElement {
  const size = 64;
  const [canvas, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/* ------------------------------ cached THREE textures ------------------------------ */

const cache = new Map<string, THREE.CanvasTexture>();

function toTexture(canvas: HTMLCanvasElement, wrap = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (wrap) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  tex.anisotropy = 4;
  return tex;
}

export function getPlanetTexture(id: string): THREE.CanvasTexture {
  const hit = cache.get(id);
  if (hit) return hit;
  let canvas: HTMLCanvasElement;
  switch (id) {
    case 'sun':
      canvas = createSunTexture();
      break;
    case 'mercury':
      canvas = createRockyTexture(11, {
        stops: [
          [0, '#5a5248'],
          [0.5, '#8d8375'],
          [1, '#b9aa96'],
        ],
        craters: 110,
      });
      break;
    case 'venus':
      canvas = createGasTexture(
        22,
        [
          [0, '#b98a4e'],
          [0.3, '#d9b078'],
          [0.55, '#e8cd9a'],
          [0.8, '#d9b078'],
          [1, '#c49a5c'],
        ],
        0.4,
        4
      );
      break;
    case 'earth':
      canvas = createEarthTexture();
      break;
    case 'mars':
      canvas = createRockyTexture(33, {
        stops: [
          [0, '#7c3a20'],
          [0.45, '#b35a30'],
          [0.8, '#d97757'],
          [1, '#e89a6f'],
        ],
        craters: 45,
        capColor: '#f0e8e0',
        capSize: 0.06,
      });
      break;
    case 'jupiter':
      canvas = createGasTexture(
        44,
        [
          [0, '#a67c52'],
          [0.18, '#e8d6b3'],
          [0.32, '#b98d63'],
          [0.45, '#e8dcc8'],
          [0.58, '#c8a97e'],
          [0.72, '#d9c4a0'],
          [0.88, '#a87f58'],
          [1, '#cbb28c'],
        ],
        0.16,
        10
      );
      break;
    case 'saturn':
      canvas = createGasTexture(
        55,
        [
          [0, '#c9b080'],
          [0.25, '#e8d9a8'],
          [0.5, '#f0e6c8'],
          [0.75, '#d9c48f'],
          [1, '#c4a878'],
        ],
        0.1,
        9
      );
      break;
    case 'uranus':
      canvas = createGasTexture(
        66,
        [
          [0, '#8fcfcf'],
          [0.5, '#a5d8d8'],
          [1, '#8cc4c8'],
        ],
        0.06,
        4
      );
      break;
    case 'neptune':
      canvas = createGasTexture(
        88,
        [
          [0, '#2f4f9e'],
          [0.4, '#3f6fb5'],
          [0.62, '#5a8ec4'],
          [0.8, '#3a63a8'],
          [1, '#2c4a92'],
        ],
        0.12,
        5
      );
      break;
    case 'moon':
      canvas = createRockyTexture(99, {
        stops: [
          [0, '#6b6b6b'],
          [0.5, '#9a9a98'],
          [1, '#c4c2bc'],
        ],
        craters: 140,
      });
      break;
    default:
      canvas = createRockyTexture(1, {
        stops: [
          [0, '#777777'],
          [1, '#aaaaaa'],
        ],
        craters: 40,
      });
  }
  const tex = toTexture(canvas);
  cache.set(id, tex);
  return tex;
}

export function getSaturnRingTexture(): THREE.CanvasTexture {
  const hit = cache.get('saturn-ring');
  if (hit) return hit;
  const tex = toTexture(createSaturnRingTexture());
  cache.set('saturn-ring', tex);
  return tex;
}

export function getGlowTexture(
  key: string,
  size: number,
  inner: string,
  mid: string,
  outer: string
): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = toTexture(createGlowTexture(size, inner, mid, outer), false);
  cache.set(key, tex);
  return tex;
}

export function getStarSpriteTexture(): THREE.CanvasTexture {
  const hit = cache.get('star-sprite');
  if (hit) return hit;
  const tex = toTexture(createStarSpriteTexture(), false);
  cache.set('star-sprite', tex);
  return tex;
}

export function disposeCachedTextures(): void {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
