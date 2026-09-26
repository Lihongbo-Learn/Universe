'use client';

/**
 * 黑洞场景 (Task 2-b) — Gargantua-style black hole:
 * - Custom-shader accretion disk (flared pillow geometry, Keplerian differential
 *   rotation, angle-periodic fbm filaments, temperature ramp, Doppler beaming).
 * - Billboarded photon ring, procedural starfield + nebulae.
 * - Screen-space gravitational-lensing post-process + UnrealBloom.
 * Fully procedural — no external image assets.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createFpsMeter } from '@/components/universe/fps';
import { registerCapturer } from '@/components/universe/capture';
import {
  DISK_FRAGMENT_SHADER,
  DISK_VERTEX_SHADER,
  STAR_FRAGMENT_SHADER,
  STAR_VERTEX_SHADER,
} from './blackHoleShaders';
import { createLensingPass } from './lensingPass';
import { getRenderScale, onRenderScaleChange } from '@/components/universe/quality';
import { playEventSound } from '@/components/universe/soundscape';
import { L, useLang } from './i18n';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { AlertTriangle, Cpu, Gauge, Layers, Orbit, Sparkles, Zap, Info, CircleDot, Timer, Hourglass, Eye, Globe, Wind, Rocket, Play, Pause, Waypoints, type LucideIcon } from 'lucide-react';

const DISK_R_IN = 2.7;
const DISK_R_OUT = 15;
const DISK_RADIAL_SEGMENTS = 160;
const DISK_ANGULAR_SEGMENTS = 220;
const STAR_COUNT = 7000;
const BLOOM_STRENGTH = 0.5;
const BLOOM_RADIUS = 0.55;
const BLOOM_THRESHOLD = 0.35;

interface NebulaSpec {
  color: number;
  position: [number, number, number];
  scale: number;
  scaleY: number;
  opacity: number;
}

const NEBULAE: NebulaSpec[] = [
  { color: 0x7c3aed, position: [-430, 150, -330], scale: 260, scaleY: 0.85, opacity: 0.17 }, // deep violet
  { color: 0xd97706, position: [450, -40, -280], scale: 210, scaleY: 0.9, opacity: 0.13 }, // warm amber
  { color: 0x14b8a6, position: [160, 230, 430], scale: 180, scaleY: 1.0, opacity: 0.12 }, // teal
  { color: 0x5b21b6, position: [-250, -190, 400], scale: 240, scaleY: 0.8, opacity: 0.15 }, // violet
];

/** F13 — named camera vantage points (target stays at the hole). */
const VIEW_PRESETS: { key: string; label: string; labelEn: string; en: string; position: [number, number, number]; hint: string; hintEn: string; icon: LucideIcon }[] = [
  { key: 'side', label: '正视', labelEn: 'edge-on view', en: 'EDGE-ON', position: [0, 1.5, 30.5], hint: '赤道面侧视：光弧与透镜最壮观', hintEn: 'Edge-on along the equatorial plane: light arcs and lensing at their most spectacular', icon: Eye },
  { key: 'top', label: '俯瞰', labelEn: 'top-down view', en: 'OVERHEAD', position: [0, 40, 7], hint: '自上方俯视吸积盘全貌', hintEn: 'Look down from above at the full accretion disk', icon: Globe },
  { key: 'skim', label: '掠过', labelEn: 'skim pass', en: 'SKIMMER', position: [10.5, 2.4, 14.5], hint: '近距离低角度贴近盘面', hintEn: 'A close, low-angle skim along the disk surface', icon: Wind },
];
const VIEW_TWEEN_DURATION = 1.7; // seconds, easeInOutCubic

/* F14 — gravitational slingshot: hyperbolic flyby of the hole */
const SS_GM = 30; // gravitational parameter (scene units)
const SS_TIME_SCALE = 2.5; // sim-time multiplier so a full pass takes ~30 s
const SS_TRAIL_POINTS = 260; // trail ring-buffer length
const SS_RESET_RADIUS = 110; // recycle once the rock is this far out

/* F42 — light-ray deflection demo: true Schwarzschild null geodesics (Rs = 1).
   Photons start at x = −LIGHT_START_X moving +x with impact parameter b;
   the trajectory obeys u'' = (3/2)·u² − u (u = 1/r), integrated with RK4.
   b_crit = (3√3/2)·Rs ≈ 2.60 Rs separates escape from capture. */
const LIGHT_START_X = 46;
const LIGHT_PHI_STEP = -0.006; // negative: clockwise sweep for b > 0
const LIGHT_MAX_STEPS = 2600;
const LIGHT_TRAIL_POINTS = 96;
const LIGHT_HEAD_SPEED = 300; // path points per second at 1× time dial
const LIGHT_RESTART_DELAY = 1.6; // seconds after every ray finishes

interface LightRaySpec {
  b: number;
  color: [number, number, number];
  css: string;
  label: string;
  labelEn: string;
}

const LIGHT_RAY_SPECS: LightRaySpec[] = [
  { b: 6.5, color: [0.92, 0.94, 1.0], css: '#ebf0ff', label: '轻微偏折', labelEn: 'slight deflection' },
  { b: 4.2, color: [1.0, 0.78, 0.42], css: '#ffc76b', label: '明显弯折', labelEn: 'strong bending' },
  { b: 2.9, color: [0.42, 0.9, 1.0], css: '#6be5ff', label: '绕行光子球', labelEn: 'orbits the photon sphere' },
  { b: 2.3, color: [1.0, 0.45, 0.4], css: '#ff7368', label: '视界俘获', labelEn: 'captured by the horizon' },
];

interface LightRayPath {
  pts: Float32Array; // xyz per integration step
  count: number;
  captured: boolean;
}

/** Precompute one photon trajectory (RK4 on the u–φ null-geodesic ODE). */
function buildLightPath(b: number): LightRayPath {
  const pts = new Float32Array(LIGHT_MAX_STEPS * 3);
  const r0 = Math.hypot(LIGHT_START_X, b);
  const phi0 = Math.atan2(b, -LIGHT_START_X);
  let u = 1 / r0;
  let w = -LIGHT_START_X / (r0 * b); // du/dφ: pure-tangential launch velocity
  let phi = phi0;
  let count = 0;
  let captured = false;
  const h = LIGHT_PHI_STEP;
  for (let i = 0; i < LIGHT_MAX_STEPS; i++) {
    const r = 1 / u;
    if (r <= 1.02) {
      captured = true; // swallowed by the horizon
      break;
    }
    if (i > 24 && r >= LIGHT_START_X + 3) break; // escaped past the view edge
    pts[count * 3] = r * Math.cos(phi);
    pts[count * 3 + 1] = r * Math.sin(phi);
    pts[count * 3 + 2] = 0;
    count++;
    // RK4 for (u, w): u' = w, w' = 1.5u² − u
    const k1u = w;
    const k1w = 1.5 * u * u - u;
    const u2 = u + 0.5 * h * k1u;
    const w2 = w + 0.5 * h * k1w;
    const k2u = w2;
    const k2w = 1.5 * u2 * u2 - u2;
    const u3 = u + 0.5 * h * k2u;
    const w3 = w + 0.5 * h * k2w;
    const k3u = w3;
    const k3w = 1.5 * u3 * u3 - u3;
    const u4 = u + h * k3u;
    const w4 = w + h * k3w;
    const k4u = w4;
    const k4w = 1.5 * u4 * u4 - u4;
    u += (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    w += (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    phi += h;
  }
  if (count < 2) {
    // degenerate guard: keep a minimal valid segment
    pts[3] = pts[0] + 0.5;
    pts[4] = pts[1];
    pts[5] = pts[2];
    count = 2;
  }
  return { pts, count, captured };
}

/** Flared thickness: thin at the inner rim, thick at the outer rim. */
function diskFlare(r: number): number {
  // Clamp guards against float drift (e.g. r = 2.6999...993) making pow(negative, 1.7) = NaN.
  const s = Math.min(Math.max((r - DISK_R_IN) / (DISK_R_OUT - DISK_R_IN), 0), 1);
  return 0.05 + 1.55 * Math.pow(s, 1.7);
}

/**
 * Closed "pillow" disk surface as one continuous strip loop:
 * top surface (outer -> inner) -> inner rim wall -> bottom surface (inner -> outer),
 * with the outer rim wall closed by wrapping the row index.
 */
function buildDiskGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const rows = DISK_RADIAL_SEGMENTS * 2 + 2;
  const cols = DISK_ANGULAR_SEGMENTS;
  const span = DISK_R_OUT - DISK_R_IN;

  const positions = new Float32Array(rows * cols * 3);
  for (let row = 0; row < rows; row++) {
    let r: number;
    let y: number;
    if (row <= DISK_RADIAL_SEGMENTS) {
      // top surface, outer -> inner
      r = DISK_R_OUT - (row / DISK_RADIAL_SEGMENTS) * span;
      y = diskFlare(r);
    } else {
      // bottom surface, inner -> outer
      r = DISK_R_IN + ((row - DISK_RADIAL_SEGMENTS - 1) / DISK_RADIAL_SEGMENTS) * span;
      y = -diskFlare(r);
    }
    for (let col = 0; col < cols; col++) {
      const theta = (col / cols) * Math.PI * 2;
      const i = (row * cols + col) * 3;
      positions[i] = r * Math.cos(theta);
      positions[i + 1] = y;
      positions[i + 2] = r * Math.sin(theta);
    }
  }

  const indices = new Uint32Array(rows * cols * 6);
  let ptr = 0;
  for (let row = 0; row < rows; row++) {
    const rowNext = (row + 1) % rows; // vertical wrap closes the outer rim wall
    for (let col = 0; col < cols; col++) {
      const colNext = (col + 1) % cols; // angular wrap closes the ring
      const a = row * cols + col;
      const b = row * cols + colNext;
      const c = rowNext * cols + col;
      const d = rowNext * cols + colNext;
      indices[ptr++] = a;
      indices[ptr++] = c;
      indices[ptr++] = b;
      indices[ptr++] = b;
      indices[ptr++] = c;
      indices[ptr++] = d;
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

/** Procedural radial-gradient canvas texture. */
function createRadialTexture(size: number, stops: Array<[number, string]>): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft round star sprite. */
function createStarTexture(): THREE.CanvasTexture {
  return createRadialTexture(64, [
    [0, 'rgba(255,255,255,1)'],
    [0.25, 'rgba(255,255,255,0.85)'],
    [0.55, 'rgba(255,255,255,0.22)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
}

/** Photon-ring band: white-amber peak at r = 1.62 (uv 1.62/1.85 = 0.876). */
function createPhotonRingTexture(): THREE.CanvasTexture {
  return createRadialTexture(512, [
    [0, 'rgba(0,0,0,0)'],
    [0.7, 'rgba(0,0,0,0)'],
    [0.79, 'rgba(255,170,80,0)'],
    [0.845, 'rgba(255,205,140,0.55)'],
    [0.876, 'rgba(255,247,232,1)'],
    [0.908, 'rgba(255,185,105,0.5)'],
    [0.955, 'rgba(255,140,60,0.12)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
}

/** Irregular soft nebula blob (several overlapped radial gradients). */
function createNebulaTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const blobs: Array<[number, number, number]> = [
    [0.5, 0.5, 0.5],
    [0.38, 0.44, 0.3],
    [0.62, 0.58, 0.34],
    [0.56, 0.34, 0.22],
  ];
  for (const [bx, by, br] of blobs) {
    const g = ctx.createRadialGradient(bx * size, by * size, 0, bx * size, by * size, br * size);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildStarField(map: THREE.Texture, pixelRatio: number): { geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial } {
  const positions = new Float32Array(STAR_COUNT * 3);
  const tints = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform direction on a sphere, radius 320..520.
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    const radius = 320 + Math.random() * 200;
    positions[i * 3] = radius * s * Math.cos(phi);
    positions[i * 3 + 1] = radius * u;
    positions[i * 3 + 2] = radius * s * Math.sin(phi);
    // Warm/cool white variation with a few bright stars.
    const k = Math.random();
    const bright = (0.45 + 0.55 * Math.random() * Math.random()) * (Math.random() < 0.02 ? 1.35 : 1);
    tints[i * 3] = (0.72 + 0.28 * k) * bright;
    tints[i * 3 + 1] = (0.82 + 0.06 * k) * bright;
    tints[i * 3 + 2] = (1.0 - 0.28 * k) * bright;
    // Varied small fixed sizes.
    let size = 0.9 + Math.random() * 1.5;
    if (Math.random() < 0.06) size += 1.2;
    if (Math.random() < 0.008) size += 1.8;
    sizes[i] = size;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    uniforms: {
      uMap: { value: map },
      uPixelRatio: { value: pixelRatio },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return { geometry, material };
}

function StatRow({ icon: Icon, label, sub }: { icon: LucideIcon; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300/80" aria-hidden />
      <div className="leading-tight">
        <p className="text-[11px] font-medium text-zinc-200">{label}</p>
        <p className="mt-0.5 text-[10px] text-zinc-500">{sub}</p>
      </div>
    </div>
  );
}

export default function BlackHoleScene() {
  useLang(); // re-render on language change so all L() texts and dilationText update
  const wrapRef = useRef<HTMLDivElement>(null);

  // Mutable refs read by the render loop — UI state never re-creates the scene.
  const diskSpeedRef = useRef(1);
  const lensEnabledRef = useRef(true);
  const bloomEnabledRef = useRef(true);
  const slingshotEnabledRef = useRef(true);
  const viewRequestRef = useRef<number | null>(null);

  const [lensOn, setLensOn] = useState(true);
  const [bloomOn, setBloomOn] = useState(true);
  const [speed, setSpeed] = useState(1);
  const lastNonZeroSpeedRef = useRef(1); // F31 — remembers the pre-pause speed
  const [slingshotOn, setSlingshotOn] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showScience, setShowScience] = useState(false);
  const [timeDilationR, setTimeDilationR] = useState(3); // F16 — distance in Rs units
  // F42 — light-ray geodesic demo
  const lightDemoRef = useRef(false);
  const [lightDemoOn, setLightDemoOn] = useState(false);

  useEffect(() => {
    slingshotEnabledRef.current = slingshotOn;
  }, [slingshotOn]);

  const handleLightDemo = () => {
    const next = !lightDemoRef.current;
    lightDemoRef.current = next;
    setLightDemoOn(next);
    playEventSound('click'); // F23
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let frame = 0;
    let activeRenderer: THREE.WebGLRenderer | null = null;

    try {
      /* ---------------- renderer ---------------- */
      const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
      activeRenderer = renderer;
      const baseDpr = Math.min(window.devicePixelRatio || 1, 1.5);
      renderer.setPixelRatio(baseDpr * getRenderScale());
      renderer.setSize(wrap.clientWidth || 1, wrap.clientHeight || 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.95;
      renderer.domElement.style.display = 'block';
      wrap.appendChild(renderer.domElement);

      /* ---------------- scene & camera ---------------- */
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x020208);

      const camera = new THREE.PerspectiveCamera(60, (wrap.clientWidth || 1) / (wrap.clientHeight || 1), 0.1, 2000);
      camera.position.set(0, 9.5, 31);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.minDistance = 3.4;
      controls.maxDistance = 90;
      controls.update();

      const geometries: THREE.BufferGeometry[] = [];
      const materials: THREE.Material[] = [];
      const textures: THREE.Texture[] = [];

      /* ---------------- black hole (shadow sphere) ---------------- */
      const holeGeometry = new THREE.SphereGeometry(1, 48, 32);
      const holeMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const hole = new THREE.Mesh(holeGeometry, holeMaterial);
      geometries.push(holeGeometry);
      materials.push(holeMaterial);
      scene.add(hole);

      /* ---------------- accretion disk (custom shader) ---------------- */
      const diskGeometry = buildDiskGeometry();
      const diskMaterial = new THREE.ShaderMaterial({
        vertexShader: DISK_VERTEX_SHADER,
        fragmentShader: DISK_FRAGMENT_SHADER,
        uniforms: {
          uDiskPhase: { value: 0 },
          uWallTime: { value: 0 }, // F35 — breathing shimmer (runs even when paused)
        },
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const disk = new THREE.Mesh(diskGeometry, diskMaterial);
      disk.frustumCulled = false;
      geometries.push(diskGeometry);
      materials.push(diskMaterial);
      scene.add(disk);

      /* ---------------- photon ring (billboarded) ---------------- */
      const ringTexture = createPhotonRingTexture();
      const ringGeometry = new THREE.RingGeometry(1.45, 1.85, 128);
      const ringMaterial = new THREE.MeshBasicMaterial({
        map: ringTexture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      geometries.push(ringGeometry);
      materials.push(ringMaterial);
      textures.push(ringTexture);
      scene.add(ring);

      /* ---------------- starfield ---------------- */
      const starTexture = createStarTexture();
      const pixelRatio = renderer.getPixelRatio();
      const { geometry: starGeometry, material: starMaterial } = buildStarField(starTexture, pixelRatio);
      const stars = new THREE.Points(starGeometry, starMaterial);
      stars.frustumCulled = false;
      geometries.push(starGeometry);
      materials.push(starMaterial);
      textures.push(starTexture);
      scene.add(stars);

      /* ---------------- nebulae ---------------- */
      const nebulaTexture = createNebulaTexture();
      textures.push(nebulaTexture);
      for (const spec of NEBULAE) {
        const material = new THREE.SpriteMaterial({
          map: nebulaTexture,
          color: spec.color,
          transparent: true,
          opacity: spec.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        materials.push(material);
        const sprite = new THREE.Sprite(material);
        sprite.position.set(spec.position[0], spec.position[1], spec.position[2]);
        sprite.scale.set(spec.scale, spec.scale * spec.scaleY, 1);
        scene.add(sprite);
      }

      /* ---------------- gravitational slingshot demo (F14) ---------------- */
      const slingshotGroup = new THREE.Group();
      const ssSpawn = new THREE.Vector3(-52, 2.6, 24); // far start point (|r| ≈ 57)
      const ssDirCenter = ssSpawn.clone().negate().normalize();
      const ssPerp = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), ssDirCenter).normalize();
      const ssPos = new THREE.Vector3();
      const ssVel = new THREE.Vector3();
      const ssAim = new THREE.Vector3();
      const ssTrailPositions = new Float32Array(SS_TRAIL_POINTS * 3);
      const ssTrailColors = new Float32Array(SS_TRAIL_POINTS * 3);
      for (let i = 0; i < SS_TRAIL_POINTS; i++) {
        // index 0 = newest (bright head) → tail fades to black (additive = fade out)
        const glow = Math.pow(1 - i / (SS_TRAIL_POINTS - 1), 2.1);
        ssTrailColors[i * 3] = 0.34 * glow;
        ssTrailColors[i * 3 + 1] = 0.78 * glow;
        ssTrailColors[i * 3 + 2] = 1.0 * glow;
      }
      const ssTrailGeo = new THREE.BufferGeometry();
      ssTrailGeo.setAttribute('position', new THREE.BufferAttribute(ssTrailPositions, 3));
      ssTrailGeo.setAttribute('color', new THREE.BufferAttribute(ssTrailColors, 3));
      const ssTrailMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ssTrail = new THREE.Line(ssTrailGeo, ssTrailMat);
      ssTrail.frustumCulled = false;
      const ssRockGeo = new THREE.IcosahedronGeometry(0.16, 1);
      const ssRockMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff });
      const ssRock = new THREE.Mesh(ssRockGeo, ssRockMat);
      const ssGlowTex = createStarTexture();
      const ssGlowMat = new THREE.SpriteMaterial({
        map: ssGlowTex,
        color: 0x67d4ff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const ssGlow = new THREE.Sprite(ssGlowMat);
      ssGlow.scale.set(1.6, 1.6, 1);
      slingshotGroup.add(ssTrail, ssRock, ssGlow);
      scene.add(slingshotGroup);
      geometries.push(ssTrailGeo, ssRockGeo);
      materials.push(ssTrailMat, ssRockMat, ssGlowMat);
      textures.push(ssGlowTex);

      let ssTime = 0;
      /** (Re)spawn the rock on a fresh randomized hyperbolic approach. */
      const ssReset = () => {
        const b = 10 + Math.random() * 4;          // impact parameter 10..14
        const excess = 1.6 + Math.random() * 0.4;  // hyperbolic excess speed
        ssAim.copy(ssPerp).multiplyScalar(b);      // aim point offset from the hole
        ssPos.copy(ssSpawn);
        ssVel.copy(ssAim).sub(ssSpawn).normalize().multiplyScalar(excess);
        ssTime = 0;
        for (let i = 0; i < SS_TRAIL_POINTS; i++) {
          ssTrailPositions[i * 3] = ssPos.x;
          ssTrailPositions[i * 3 + 1] = ssPos.y;
          ssTrailPositions[i * 3 + 2] = ssPos.z;
        }
        ssTrailGeo.attributes.position.needsUpdate = true;
      };
      ssReset();

      /* ---------------- F42: light-ray deflection demo ---------------- */
      const lightGroup = new THREE.Group();
      lightGroup.visible = false;
      scene.add(lightGroup);
      const lightHeadTex = createStarTexture();
      textures.push(lightHeadTex);

      interface LightRayRuntime {
        path: LightRayPath;
        trail: THREE.Line;
        trailGeo: THREE.BufferGeometry;
        trailArr: Float32Array;
        head: THREE.Sprite;
        headMat: THREE.SpriteMaterial;
        hi: number; // head position along the path (float path-point index)
        tail: number; // drain position once the head has finished
        phase: 0 | 1 | 2; // fly / drain / done
        delay: number; // staggered launch (seconds of demo time)
      }
      const lightRays: LightRayRuntime[] = [];
      for (const spec of LIGHT_RAY_SPECS) {
        const path = buildLightPath(spec.b);
        // faint full-path ghost: shows where the geodesic leads (b-profile map)
        const ghostGeo = new THREE.BufferGeometry();
        ghostGeo.setAttribute('position', new THREE.BufferAttribute(path.pts.slice(0, path.count * 3), 3));
        const ghostMat = new THREE.LineBasicMaterial({
          color: new THREE.Color(spec.color[0], spec.color[1], spec.color[2]),
          transparent: true,
          opacity: 0.15,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const ghost = new THREE.Line(ghostGeo, ghostMat);
        ghost.frustumCulled = false;
        lightGroup.add(ghost);
        // moving bright trail (head-first gradient, same pattern as the slingshot)
        const trailArr = new Float32Array(LIGHT_TRAIL_POINTS * 3);
        const trailCol = new Float32Array(LIGHT_TRAIL_POINTS * 3);
        for (let i = 0; i < LIGHT_TRAIL_POINTS; i++) {
          trailArr[i * 3] = path.pts[0];
          trailArr[i * 3 + 1] = path.pts[1];
          trailArr[i * 3 + 2] = path.pts[2];
          const glow = Math.pow(1 - i / (LIGHT_TRAIL_POINTS - 1), 1.8);
          trailCol[i * 3] = spec.color[0] * glow;
          trailCol[i * 3 + 1] = spec.color[1] * glow;
          trailCol[i * 3 + 2] = spec.color[2] * glow;
        }
        const trailGeo = new THREE.BufferGeometry();
        trailGeo.setAttribute('position', new THREE.BufferAttribute(trailArr, 3));
        trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
        const trailMat = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const trail = new THREE.Line(trailGeo, trailMat);
        trail.frustumCulled = false;
        lightGroup.add(trail);
        // glowing photon head
        const headMat = new THREE.SpriteMaterial({
          map: lightHeadTex,
          color: new THREE.Color(spec.color[0], spec.color[1], spec.color[2]),
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const head = new THREE.Sprite(headMat);
        head.scale.set(1.15, 1.15, 1);
        head.position.set(path.pts[0], path.pts[1], path.pts[2]);
        lightGroup.add(head);
        geometries.push(ghostGeo, trailGeo);
        materials.push(ghostMat, trailMat, headMat);
        lightRays.push({
          path,
          trail,
          trailGeo,
          trailArr,
          head,
          headMat,
          hi: 0,
          tail: 0,
          phase: 0,
          delay: 0,
        });
      }

      let lightAllDoneT = 0;
      let lightWasOn = false;
      const lightReset = () => {
        for (let i = 0; i < lightRays.length; i++) {
          const lr = lightRays[i];
          lr.hi = 0;
          lr.tail = 0;
          lr.phase = 0;
          lr.delay = i * 0.55; // staggered launch left → right in the legend
          const sx = lr.path.pts[0];
          const sy = lr.path.pts[1];
          const sz = lr.path.pts[2];
          for (let k = 0; k < LIGHT_TRAIL_POINTS; k++) {
            lr.trailArr[k * 3] = sx;
            lr.trailArr[k * 3 + 1] = sy;
            lr.trailArr[k * 3 + 2] = sz;
          }
          lr.trailGeo.attributes.position.needsUpdate = true;
          lr.trail.visible = true;
          lr.head.visible = true;
          lr.headMat.opacity = 0.95;
          lr.head.position.set(sx, sy, sz);
        }
        lightAllDoneT = 0;
      };
      lightReset();

      /* ---------------- post-processing chain ---------------- */
      const composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      const lensPass = createLensingPass();
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(wrap.clientWidth || 1, wrap.clientHeight || 1), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
      const outputPass = new OutputPass();
      composer.addPass(renderPass);
      composer.addPass(lensPass);
      composer.addPass(bloomPass);
      composer.addPass(outputPass);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(wrap.clientWidth || 1, wrap.clientHeight || 1);

      /* ---------------- resize (ResizeObserver driven) ---------------- */
      const resize = () => {
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        if (w === 0 || h === 0) return;
        const pr = baseDpr * getRenderScale();
        renderer.setPixelRatio(pr);
        renderer.setSize(w, h);
        // composer.setSize resizes both buffers AND every pass (bloom included).
        composer.setPixelRatio(pr);
        composer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        lensPass.uniforms.uAspect.value = w / h;
        starMaterial.uniforms.uPixelRatio.value = pr;
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(wrap);
      resize();

      const unsubQuality = onRenderScaleChange(() => {
        resize();
      });

      /* ---------------- F13 camera view-preset tween ---------------- */
      const tweenFrom = new THREE.Vector3();
      const tweenTo = new THREE.Vector3();
      const tweenFromTgt = new THREE.Vector3();
      const tweenToTgt = new THREE.Vector3();
      let tweenT = 1; // 1 = idle
      const cancelViewTween = () => {
        if (tweenT < 1) {
          tweenT = 1;
          controls.enabled = true;
        }
      };
      renderer.domElement.addEventListener('pointerdown', cancelViewTween);
      renderer.domElement.addEventListener('wheel', cancelViewTween, { passive: true }); // F27 — scroll cancels too

      /* ---------------- animation loop (no per-frame allocations) ---------------- */
      const fps = createFpsMeter();
      const tmpView = new THREE.Vector3();
      const tmpProject = new THREE.Vector3();
      const tmpRight = new THREE.Vector3();
      let lastTime = performance.now();
      let diskPhase = 0;
      let wallTime = 0; // F35 — real-time clock for the pause-breathing shimmer
      let lensTime = 0;
      let lensMix = 0; // lerps toward target each frame (smooth toggle)
      let bloomMix = 0;

      const tick = () => {
        frame = requestAnimationFrame(tick);

        const now = performance.now();
        const delta = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;

        // Disk spin: phase += delta * slider speed (ref-bridged).
        diskPhase += delta * diskSpeedRef.current;
        diskMaterial.uniforms.uDiskPhase.value = diskPhase;
        // F35 — the shimmer always advances so a paused frame keeps breathing
        wallTime += delta;
        diskMaterial.uniforms.uWallTime.value = wallTime;
        lensTime += delta;
        lensPass.uniforms.uTime.value = lensTime;

        // ---- F13: start a requested view-preset flight (UI → loop bridge) ----
        const viewReq = viewRequestRef.current;
        if (viewReq !== null) {
          viewRequestRef.current = null;
          const preset = VIEW_PRESETS[viewReq];
          if (preset) {
            tweenFrom.copy(camera.position);
            tweenTo.set(preset.position[0], preset.position[1], preset.position[2]);
            tweenFromTgt.copy(controls.target);
            tweenToTgt.set(0, 0, 0);
            tweenT = 0;
            controls.enabled = false;
          }
        }
        if (tweenT < 1) {
          tweenT = Math.min(1, tweenT + delta / VIEW_TWEEN_DURATION);
          const s = tweenT < 0.5 ? 4 * tweenT * tweenT * tweenT : 1 - Math.pow(-2 * tweenT + 2, 3) / 2;
          camera.position.lerpVectors(tweenFrom, tweenTo, s);
          controls.target.lerpVectors(tweenFromTgt, tweenToTgt, s);
          if (tweenT >= 1) controls.enabled = true;
        }

        // ---- F14: gravitational slingshot — semi-implicit Euler, 3 substeps ----
        // F27 — time scale is now coupled to the accretion-disk speed slider:
        // slowing the disk slows the whole scene, giving one consistent "time dial".
        slingshotGroup.visible = slingshotEnabledRef.current;
        if (slingshotEnabledRef.current) {
          ssTime += delta * diskSpeedRef.current;
          const h = (delta * SS_TIME_SCALE * diskSpeedRef.current) / 3;
          for (let s = 0; s < 3; s++) {
            const r2 = ssPos.lengthSq();
            const accel = -SS_GM / (r2 * Math.sqrt(r2));
            ssVel.addScaledVector(ssPos, accel * h);
            ssPos.addScaledVector(ssVel, h);
          }
          ssRock.position.copy(ssPos);
          ssGlow.position.copy(ssPos);
          ssTrailPositions.copyWithin(3, 0, (SS_TRAIL_POINTS - 1) * 3);
          ssTrailPositions[0] = ssPos.x;
          ssTrailPositions[1] = ssPos.y;
          ssTrailPositions[2] = ssPos.z;
          ssTrailGeo.attributes.position.needsUpdate = true;
          if (ssPos.lengthSq() > SS_RESET_RADIUS * SS_RESET_RADIUS || ssTime > 70) ssReset();
        }

        // ---- F42: light-ray deflection demo (precomputed geodesics) ----
        lightGroup.visible = lightDemoRef.current;
        if (lightDemoRef.current) {
          lightWasOn = true;
          const adv = delta * LIGHT_HEAD_SPEED * diskSpeedRef.current;
          let allDone = true;
          for (let i = 0; i < lightRays.length; i++) {
            const lr = lightRays[i];
            if (lr.phase === 2) continue;
            allDone = false;
            if (lr.delay > 0) {
              lr.delay = Math.max(0, lr.delay - delta * diskSpeedRef.current);
              continue;
            }
            const total = lr.path.count - 1;
            if (lr.phase === 0) {
              lr.hi = Math.min(lr.hi + adv, total);
              if (lr.hi >= total) lr.phase = 1;
            } else {
              lr.tail = Math.min(lr.tail + adv, total - 1);
              lr.headMat.opacity = Math.max(0, 0.95 * (1 - lr.tail / 40));
              if (lr.tail >= total - 1) {
                lr.phase = 2;
                lr.trail.visible = false;
                lr.head.visible = false;
                continue;
              }
            }
            // trail window = path points [start, end), newest first
            const end = Math.floor(lr.hi);
            const start = Math.max(Math.floor(lr.tail), end - (LIGHT_TRAIL_POINTS - 1));
            const arr = lr.trailArr;
            for (let k = 0; k < LIGHT_TRAIL_POINTS; k++) {
              const pi = Math.max(start, end - 1 - k);
              arr[k * 3] = lr.path.pts[pi * 3];
              arr[k * 3 + 1] = lr.path.pts[pi * 3 + 1];
              arr[k * 3 + 2] = lr.path.pts[pi * 3 + 2];
            }
            lr.trailGeo.attributes.position.needsUpdate = true;
            // head sprite with sub-step interpolation
            const i0 = Math.min(Math.floor(lr.hi), total - 1);
            const fr = lr.hi - i0;
            lr.head.position.set(
              lr.path.pts[i0 * 3] + (lr.path.pts[(i0 + 1) * 3] - lr.path.pts[i0 * 3]) * fr,
              lr.path.pts[i0 * 3 + 1] + (lr.path.pts[(i0 + 1) * 3 + 1] - lr.path.pts[i0 * 3 + 1]) * fr,
              0
            );
          }
          if (allDone) {
            lightAllDoneT += delta;
            if (lightAllDoneT >= LIGHT_RESTART_DELAY) lightReset();
          }
        } else if (lightWasOn) {
          // arming off → rewind so the next run starts fresh
          lightWasOn = false;
          lightReset();
        }

        controls.update();
        ring.quaternion.copy(camera.quaternion); // photon ring billboards to camera
        camera.updateMatrixWorld();

        // ---- lensing uniforms: project BH center + apparent radius ----
        tmpView.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
        const inFront = tmpView.z < 0;
        const lensTarget = lensEnabledRef.current && inFront ? 1 : 0;
        lensMix += (lensTarget - lensMix) * 0.15;
        lensPass.uniforms.uEnabled.value = lensMix;
        lensPass.enabled = lensTarget === 1 || lensMix > 0.005;
        if (inFront) {
          tmpProject.set(0, 0, 0).project(camera); // NDC -> uv (y already bottom-up)
          const cx = tmpProject.x * 0.5 + 0.5;
          const cy = tmpProject.y * 0.5 + 0.5;
          tmpRight.setFromMatrixColumn(camera.matrixWorld, 0); // camera right * 1.0
          tmpProject.copy(tmpRight).project(camera);
          const px = tmpProject.x * 0.5 + 0.5;
          const py = tmpProject.y * 0.5 + 0.5;
          // Aspect-corrected uv distance (in uv-y units), 1.5x the sphere radius.
          const rs = Math.hypot((px - cx) * camera.aspect, py - cy) * 1.5;
          lensPass.uniforms.uCenter.value.set(cx, cy);
          lensPass.uniforms.uRs.value = THREE.MathUtils.clamp(rs, 0.02, 0.48);
        }

        // ---- bloom smooth toggle ----
        const bloomTarget = bloomEnabledRef.current ? 1 : 0;
        bloomMix += (bloomTarget - bloomMix) * 0.15;
        bloomPass.enabled = bloomMix > 0.005;
        bloomPass.strength = BLOOM_STRENGTH * bloomMix;

        composer.render();
        fps.tick();
      };

      /* -------- screenshot capture registration (F3): renders post-processed frame -------- */
      registerCapturer(() => {
        composer.render();
        return renderer.domElement.toDataURL('image/png');
      });

      frame = requestAnimationFrame(tick);

      /* ---------------- cleanup ---------------- */
      return () => {
        cancelAnimationFrame(frame);
        fps.dispose();
        registerCapturer(null);
        unsubQuality();
        resizeObserver.disconnect();
        renderer.domElement.removeEventListener('pointerdown', cancelViewTween);
        renderer.domElement.removeEventListener('wheel', cancelViewTween);
        controls.dispose();
        composer.dispose();
        renderPass.dispose();
        lensPass.dispose();
        bloomPass.dispose();
        outputPass.dispose();
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
        for (const texture of textures) texture.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        activeRenderer = null;
      };
    } catch (error) {
      console.error('BlackHoleScene: failed to initialize WebGL scene', error);
      activeRenderer?.dispose();
      activeRenderer?.forceContextLoss();
      activeRenderer?.domElement.remove();
      activeRenderer = null;
      // Defer the state update so the effect body stays free of synchronous setState.
      window.setTimeout(() => setFailed(true), 0);
    }
  }, []);

  const handleLensChange = (checked: boolean) => {
    setLensOn(checked);
    lensEnabledRef.current = checked;
  };

  const handleBloomChange = (checked: boolean) => {
    setBloomOn(checked);
    bloomEnabledRef.current = checked;
  };

  const handleSpeedChange = (values: number[]) => {
    const next = values[0] ?? 1;
    if (next > 0) lastNonZeroSpeedRef.current = next;
    setSpeed(next);
    diskSpeedRef.current = next;
  };

  /* F31 — freeze / resume the disk (and the slingshot, which shares the time dial) */
  const handleTogglePause = () => {
    if (speed === 0) {
      const next = lastNonZeroSpeedRef.current > 0 ? lastNonZeroSpeedRef.current : 1;
      setSpeed(next);
      diskSpeedRef.current = next;
      playEventSound('success');
    } else {
      lastNonZeroSpeedRef.current = speed;
      setSpeed(0);
      diskSpeedRef.current = 0;
      playEventSound('click');
    }
  };

  // F16 — Schwarzschild time dilation: dτ/dt = √(1 − Rs/r), r in Rs units
  const dilationFactor = Math.sqrt(Math.max(0, 1 - 1 / Math.max(timeDilationR, 1.0001)));
  const dilatedMinutes = 60 * dilationFactor;
  const dilationText = dilatedMinutes >= 1 ? L(`${dilatedMinutes.toFixed(1)} 分钟`, `${dilatedMinutes.toFixed(1)} min`) : L(`${Math.round(dilatedMinutes * 60)} 秒`, `${Math.round(dilatedMinutes * 60)} s`);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      {failed ? (
        /* ---------------- WebGL failure message ---------------- */
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#020208]">
          <div className="mx-4 max-w-sm rounded-2xl border border-white/10 bg-black/45 p-6 text-center backdrop-blur-xl">
            <AlertTriangle className="mx-auto h-6 w-6 text-amber-300" aria-hidden />
            <p className="mt-3 text-sm font-medium text-zinc-200">{L('WebGL 初始化失败', 'WebGL initialization failed')}</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">{L('当前浏览器或设备不支持 WebGL，无法渲染黑洞场景，请更换浏览器或开启硬件加速后重试。', 'Your browser or device does not support WebGL, so the black hole scene cannot be rendered. Try a different browser or enable hardware acceleration.')}</p>
          </div>
        </div>
      ) : (
        <>
          {/* ---------------- top-right stats card ---------------- */}
          <div className="uni-anim-fade-up pointer-events-none absolute right-4 top-20 z-20 w-44 rounded-2xl border border-white/10 bg-black/45 p-3.5 shadow-lg shadow-black/40 backdrop-blur-xl portrait:right-3 portrait:top-[138px]">
            <p className="text-[10px] font-semibold tracking-[0.28em] text-amber-200/70">GARGANTUA</p>
            <div className="mt-3 space-y-3">
              <StatRow icon={Cpu} label={L('自定义 Shader ×2', 'Custom shaders ×2')} sub={L('吸积盘 + 引力透镜', 'Accretion disk + gravitational lensing')} />
              <StatRow icon={Layers} label={L('屏幕空间后处理', 'Screen-space post-processing')} sub={L('透镜 → 辉光 → 输出', 'Lensing → glow → output')} />
              <StatRow icon={Zap} label={L('多普勒成束', 'Doppler beaming')} sub={L('迎光侧增亮偏蓝', 'Approaching side brightened and blueshifted')} />
            </div>
          </div>

          {/* ---------------- left-center camera view presets (F13) ---------------- */}
          <div
            className="uni-anim-slide-left absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-2xl border border-white/10 bg-black/45 p-1.5 shadow-lg shadow-black/40 backdrop-blur-xl portrait:left-3"
            role="group"
            aria-label={L('相机视角预设', 'Camera view presets')}
          >
            <p className="pb-0.5 pt-0.5 text-center text-[9px] font-semibold tracking-[0.22em] text-zinc-500">{L('视角', 'VIEW')}</p>
            {VIEW_PRESETS.map((p, i) => {
              const PresetIcon = p.icon;
              return (
              <button
                key={p.key}
                type="button"
                title={L(`${p.hint}（${p.en}）`, `${p.hintEn} (${p.en})`)}
                aria-label={L(`切换到${p.label}视角`, `Switch to the ${p.labelEn}`)}
                onClick={() => {
                  viewRequestRef.current = i;
                  playEventSound('click'); // F23
                }}
                className="flex min-h-[52px] w-14 flex-col items-center justify-center gap-1 rounded-xl text-zinc-400 transition-all duration-200 hover:bg-white/10 hover:text-amber-200 hover:shadow-[inset_0_0_0_1px_rgba(252,211,77,0.25)]"
              >
                <PresetIcon className="h-4 w-4" aria-hidden />
                <span className="text-[10px] font-medium">{L(p.label, p.en)}</span>
              </button>
              );
            })}
          </div>

          {/* ---------------- bottom-center hint + control bar ---------------- */}
          <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex flex-col items-center gap-2.5 px-4 portrait:bottom-[calc(1.25rem+var(--ui-safe-bottom))]">
            {lightDemoOn && (
              <div
                className="uni-anim-fade-in flex max-w-[94vw] flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-black/50 px-3.5 py-1.5 shadow-lg shadow-black/40 backdrop-blur-xl"
                role="status"
                aria-label={L('光线测地线图例', 'Light-ray geodesic legend')}
              >
                <span className="text-[9.5px] font-semibold tracking-[0.14em] text-zinc-300">
                  {L('光子测地线', 'Photon geodesics')} · b꜀ = 3√3/2 · Rs ≈ 2.60 Rs
                </span>
                {LIGHT_RAY_SPECS.map((s) => (
                  <span key={s.b} className="flex items-center gap-1 text-[9.5px] text-zinc-400">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: s.css, boxShadow: `0 0 6px ${s.css}` }}
                      aria-hidden
                    />
                    b = {s.b} Rs · {L(s.label, s.labelEn)}
                  </span>
                ))}
              </div>
            )}
            <p className="text-center text-[10px] tracking-wide text-zinc-500"><span className="[@media(pointer:coarse)]:hidden">{L('拖拽环绕 · 滚轮缩放（可中断飞行）· 左侧切换预设视角 · 侧倾观察光弧与背景弯折', 'Drag to orbit · scroll to zoom (interrupts flights) · switch presets on the left · tilt to see the light arcs and background bending')}</span><span className="hidden [@media(pointer:coarse)]:inline">{L('单指拖拽环绕 · 双指缩放 · 左侧切换预设视角', 'One-finger drag to orbit · pinch to zoom · switch presets on the left')}</span></p>
            <div className="uni-anim-fade-up pointer-events-auto relative flex max-w-[94vw] flex-wrap items-center justify-center gap-4 rounded-2xl border border-white/10 bg-black/45 px-5 py-3 shadow-lg shadow-black/40 backdrop-blur-xl portrait:gap-x-3 portrait:gap-y-2 portrait:px-3 portrait:py-2.5 sm:gap-6">
              <div className="flex items-center gap-2.5">
                <Orbit className="h-3.5 w-3.5 text-amber-300/80" aria-hidden />
                <Switch checked={lensOn} onCheckedChange={handleLensChange} aria-label={L('切换引力透镜', 'Toggle gravitational lensing')} className="cursor-pointer data-[state=checked]:bg-amber-400" />
                <span className="text-xs text-zinc-300">{L('引力透镜', 'Gravitational lensing')}</span>
              </div>
              <div className="h-5 w-px bg-white/10 portrait:hidden" aria-hidden />
              <div className="flex items-center gap-2.5">
                <Gauge className="h-3.5 w-3.5 text-amber-300/80" aria-hidden />
                <span className="whitespace-nowrap text-xs text-zinc-300">{L('吸积盘速度', 'Accretion disk speed')}</span>
                {/* F31 — pause / resume the disk clock */}
                <button
                  type="button"
                  onClick={handleTogglePause}
                  aria-pressed={speed === 0}
                  aria-label={speed === 0 ? L('恢复吸积盘旋转', 'Resume disk rotation') : L('暂停吸积盘旋转', 'Pause disk rotation')}
                  title={speed === 0 ? L('恢复吸积盘旋转', 'Resume disk rotation') : L('暂停吸积盘旋转', 'Pause disk rotation')}
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all duration-200',
                    speed === 0
                      ? 'border-amber-300/50 bg-amber-300/15 text-amber-200'
                      : 'border-white/10 bg-black/40 text-zinc-300 hover:border-amber-200/40 hover:text-amber-200'
                  )}
                >
                  {speed === 0 ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
                </button>
                <Slider
                  value={[speed]}
                  min={0}
                  max={2}
                  step={0.25}
                  onValueChange={handleSpeedChange}
                  aria-label={L('吸积盘速度', 'Accretion disk speed')}
                  className="w-24 [&_[data-slot=slider-range]]:bg-amber-400 sm:w-28"
                />
                <span className={cn('w-7 text-right font-mono text-xs tabular-nums', speed === 0 ? 'text-amber-300' : 'text-amber-200')}>
                  {speed === 0 ? L('暂停', 'Paused') : speed.toFixed(2).replace('.00', '').replace(/(\.\d)0$/, '$1')}
                </span>
              </div>
              <div className="h-5 w-px bg-white/10 portrait:hidden" aria-hidden />
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-3.5 w-3.5 text-violet-300/80" aria-hidden />
                <Switch checked={bloomOn} onCheckedChange={handleBloomChange} aria-label={L('切换辉光', 'Toggle glow')} className="cursor-pointer data-[state=checked]:bg-violet-400" />
                <span className="text-xs text-zinc-300">{L('辉光', 'Glow')}</span>
              </div>
              <div className="h-5 w-px bg-white/10 portrait:hidden" aria-hidden />
              <button
                type="button"
                onClick={() => {
                  setSlingshotOn((v) => !v);
                  playEventSound('click'); // F23
                }}
                aria-pressed={slingshotOn}
                title={L('小行星双曲线掠过演示：近黑洞时被引力甩弯（时间流速与吸积盘速度滑杆联动）', 'Asteroid hyperbolic flyby demo: bent by gravity as it nears the hole (time flow is coupled to the accretion-disk speed slider)')}
                className={cn(
                  'flex min-h-[32px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all duration-200',
                  slingshotOn
                    ? 'bg-cyan-300/15 text-cyan-200 shadow-[inset_0_0_0_1px_rgba(103,232,249,0.35)]'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                )}
              >
                <Rocket className="h-3.5 w-3.5" aria-hidden />
                {L('引力弹弓', 'Gravity slingshot')}
              </button>
              <div className="h-5 w-px bg-white/10 portrait:hidden" aria-hidden />
              <button
                type="button"
                onClick={handleLightDemo}
                aria-pressed={lightDemoOn}
                title={L('光子测地线演示：四束不同瞄准距离 b 的光线掠过黑洞——被弯折、绕行光子球或俘获坠入视界（时间流速随吸积盘速度滑杆联动）', 'Photon geodesic demo: four rays with different impact parameters b pass the hole — bent, orbiting the photon sphere, or captured through the horizon (time flow is coupled to the accretion-disk speed slider)')}
                className={cn(
                  'flex min-h-[32px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all duration-200',
                  lightDemoOn
                    ? 'bg-emerald-300/15 text-emerald-200 shadow-[inset_0_0_0_1px_rgba(110,231,183,0.35)]'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                )}
              >
                <Waypoints className="h-3.5 w-3.5" aria-hidden />
                {L('光线演示', 'Light-ray demo')}
              </button>
              <div className="h-5 w-px bg-white/10 portrait:hidden" aria-hidden />
              <button
                type="button"
                onClick={() => {
                  setShowScience((v) => !v);
                  playEventSound('click'); // F23
                }}
                aria-pressed={showScience}
                className={cn(
                  'flex min-h-[32px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all duration-200',
                  showScience
                    ? 'bg-amber-300/20 text-amber-200 shadow-[inset_0_0_0_1px_rgba(252,211,77,0.4)]'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                )}
              >
                <Info className="h-3.5 w-3.5" aria-hidden />
                {L('科学注释', 'Science notes')}
              </button>

              {/* -------- science annotation card (F8) -------- */}
              {showScience && (
                <div className="uni-anim-scale-in universe-scroll absolute bottom-full left-1/2 mb-3 max-h-[calc(100dvh-130px)] w-[330px] max-w-[86vw] -translate-x-1/2 overflow-y-auto rounded-2xl border border-white/10 bg-black/65 p-4 shadow-2xl shadow-black/60 backdrop-blur-2xl portrait:left-3 portrait:right-3 portrait:w-auto portrait:max-w-none portrait:translate-x-0">
                  <p className="text-[10px] font-semibold tracking-[0.28em] text-amber-200/70">SCIENCE NOTES</p>
                  <div className="uni-anim-stagger mt-3 space-y-2.5">
                    {[
                      { icon: CircleDot, title: L('事件视界', 'Event horizon'), text: L('r = 2GM/c²。视界之内逃逸速度超过光速，任何信息都无法返回。', 'r = 2GM/c². Inside the horizon the escape velocity exceeds the speed of light — no information can return.') },
                      { icon: Orbit, title: L('光子球 · 光子环', 'Photon sphere · photon ring'), text: L('r = 1.5 Rs。光在此可绕黑洞做圆周运动，勾出细细的光子环。', 'r = 1.5 Rs. Light can circle the hole here, tracing out the thin photon ring.') },
                      { icon: Gauge, title: L('ISCO 内缘', 'ISCO inner edge'), text: L('r = 3 Rs。最内稳定圆轨道，正是吸积盘白热内缘所在。', 'r = 3 Rs. The innermost stable circular orbit — exactly where the white-hot inner rim of the accretion disk lies.') },
                      { icon: Timer, title: L('引力时间膨胀', 'Gravitational time dilation'), text: L('引力越强时间越慢——远处观察者看你贴近视界，会看到你越来越慢、逐渐冻结。', 'Stronger gravity slows time — as you hover near the horizon, a distant observer sees you slow down and gradually freeze.') },
                      { icon: Zap, title: L('多普勒成束', 'Doppler beaming'), text: L('盘内物质以近光速转动，朝向观察者的一侧被相对论性增亮、偏蓝。', 'Disk matter orbits at near light speed; the side moving toward the observer is relativistically brightened and blueshifted.') },
                    ].map((row) => (
                      <div key={row.title} className="flex items-start gap-2.5">
                        <row.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300/80" aria-hidden />
                        <div className="leading-relaxed">
                          <p className="text-[11px] font-semibold text-zinc-100">{row.title}</p>
                          <p className="mt-0.5 text-[10px] text-zinc-400">{row.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* -------- interactive time-dilation calculator (F16) -------- */}
                  <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-100">
                        <Hourglass className="h-3.5 w-3.5 text-amber-300/80" aria-hidden />
                        {L('时间膨胀计算器', 'Time dilation calculator')}
                      </p>
                      <p className="font-mono text-[10px] tabular-nums text-amber-200">r = {timeDilationR.toFixed(2)} Rs</p>
                    </div>
                    <Slider
                      value={[timeDilationR]}
                      min={1.05}
                      max={30}
                      step={0.05}
                      onValueChange={(vals) => setTimeDilationR(vals[0] ?? 3)}
                      aria-label={L('距黑洞的距离（史瓦西半径倍数）', 'Distance from the hole (in Schwarzschild radii)')}
                      className="mt-2.5 w-full [&_[data-slot=slider-range]]:bg-amber-400"
                    />
                    <div className="mt-2 flex items-baseline justify-between gap-2">
                      <span className="text-[10px] text-zinc-400">{L('远处 1 小时 → 此处', '1 hour far away → here')}</span>
                      <span className="font-mono text-xs font-bold tabular-nums text-amber-200">{dilationText}</span>
                    </div>
                    <p className="mt-1.5 text-[9px] leading-relaxed text-zinc-500">
                      dτ/dt = √(1 − Rs/r) = {(dilationFactor * 100).toFixed(1)}%{L(' —— 距视界越近，时间流速越慢', ' — the closer to the horizon, the slower time flows')}
                    </p>
                  </div>
                  <p className="mt-3 border-t border-white/5 pt-2 text-right text-[9px] tracking-wider text-zinc-600">{L('史瓦西度规 · 无自旋黑洞近似', 'Schwarzschild metric · non-spinning black hole approximation')}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
