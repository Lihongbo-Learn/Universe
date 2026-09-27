'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Pause,
  Play,
  FastForward,
  X,
  Ruler,
  Orbit as OrbitIcon,
  RotateCw,
  Moon as MoonIcon,
  Globe,
  MousePointerClick,
  Thermometer,
  Weight,
  Gauge,
  Tag,
  Star,
  Spline,
  CalendarDays,
  Sparkles,
  Telescope,
  Zap,
  History,
  Radio,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  PLANETS,
  SUN_INFO,
  SCENE_LAYOUT,
  SECONDS_PER_EARTH_YEAR,
  SECONDS_PER_EARTH_SPIN,
  HALLEY_INFO,
  HALLEY_ORBIT,
  J2000_MEAN_LONGITUDE_DEG,
  J2000_ASCENDING_NODE_DEG,
  J2000_PERIHELION_LON_DEG,
  J2000_ECCENTRICITY,
  DAYS_PER_SIM_SECOND,
  dateMsToSimTime,
  simTimeToDateMs,
  type BodyInfo,
} from '@/components/universe/planetData';
import { L, useLang, subscribeLang, getLang } from '@/components/universe/i18n';
import { createFpsMeter } from '@/components/universe/fps';
import { registerCapturer } from '@/components/universe/capture';
import { getRenderScale, onRenderScaleChange, getDprCap, onDprCapChange } from '@/components/universe/quality';
import { playEnter, playExit, setOriginFromPoint } from '@/components/universe/originTransition';
import { playEventSound } from '@/components/universe/soundscape';
import {
  getPlanetTexture,
  getSaturnRingTexture,
  getGlowTexture,
  getStarSpriteTexture,
  disposeCachedTextures,
} from '@/components/universe/proceduralTextures';

type Speed = 0 | 1 | 10;

interface PlanetNode {
  info: BodyInfo;
  system: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  angSpeed: number;
  spinSpeed: number;
  angle0: number;
  /* F33 — full J2000 orbital elements (mean-orbit approximation) */
  nodeRad: number; // Ω — ascending-node longitude (scene azimuth of the node line)
  periRad: number; // ϖ — longitude of perihelion
  omegaRad: number; // ω = ϖ − Ω — perihelion angle inside the orbital plane
  inclRad: number; // i — orbital-plane tilt around the node line
  ecc: number; // e — real eccentricity (sun at the focus)
  aVis: number; // visual semi-major axis, scene units
  moonPivot: THREE.Group | null;
}

const TAU = Math.PI * 2;

/** F33 — mean anomaly → true anomaly via Newton iteration on Kepler's equation.
 *  Zero allocation; 4–5 iterations keep residual < 1e-6 rad for e ≤ 0.21. */
function keplerTrueAnomaly(M: number, e: number, out: { nu: number; rFactor: number }): void {
  let E = M + e * Math.sin(M);
  for (let it = 0; it < 5; it++) {
    E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }
  if (!Number.isFinite(E)) E = M;
  out.nu = Math.atan2(Math.sqrt(1 - e * e) * Math.sin(E), Math.cos(E) - e);
  out.rFactor = 1 - e * Math.cos(E); // r = aVis · rFactor
}

/** F33 — reusable scratch for keplerTrueAnomaly (avoids per-call object literals) */
const KEPLER_OUT = { nu: 0, rFactor: 1 };

/** F10 — comet-like motion trail: vertices per planet trail arc */
const TRAIL_POINTS = 96;
/** fraction of a full orbit covered by the trailing arc */
const TRAIL_ARC_FRACTION = 0.16;

const LABEL_BODIES: BodyInfo[] = [SUN_INFO, ...PLANETS, HALLEY_INFO];

/** F26 — ISO yyyy-mm-dd of a Date, in local calendar terms */
const toISODateLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** F26 — parse an <input type="date"> value (noon UTC keeps the day stable) */
const parseISODate = (s: string): number | null => {
  const ms = new Date(`${s}T12:00:00Z`).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/** F25 — accent colours for the constellation quick-locate chips */
const CON_CHIP_COLORS = ['#93c5fd', '#f0abfc', '#fda4af', '#fcd34d', '#fdba74', '#6ee7b7', '#c4b5fd'];

/** F29 — real recorded sky events, one tap to time-travel */
const SKY_EVENTS: { label: string; labelEn: string; date: string; desc: string; descEn: string }[] = [
  {
    label: '木土大合',
    labelEn: 'Great conjunction',
    date: '2020-12-21',
    desc: '2020 冬至：木星与土星黄经相差仅 0.1°，是 1623 年以来最接近的一次大合，两星几乎重合',
    descEn:
      'Winter solstice 2020: Jupiter and Saturn just 0.1° apart in ecliptic longitude — the closest great conjunction since 1623, the two planets nearly touching',
  },
  {
    label: '五星同现',
    labelEn: 'Five planets visible',
    date: '2022-06-24',
    desc: '2022 年 6 月下旬：水星、金星、火星、木星、土星按黄经次序同时出现在黎明前天空',
    descEn:
      'Late June 2022: Mercury, Venus, Mars, Jupiter and Saturn lined up in order of ecliptic longitude in the pre-dawn sky',
  },
  {
    label: '金星凌日',
    labelEn: 'Venus transit',
    date: '2012-06-06',
    desc: '2012 年金星从日面掠过（本世纪最后一次），下一次要等到 2117 年',
    descEn:
      'In 2012 Venus crossed the face of the Sun (the last time this century); the next one waits until 2117',
  },
];

/** Scene-unit → AU mapping: Earth orbit = 24.5 units = 1 AU. */
const AU_PER_UNIT = 1 / 24.5;

interface BeltData {
  geo: THREE.BufferGeometry;
  count: number;
  r: Float32Array;
  y: Float32Array;
  angle0: Float32Array;
  angSpeed: Float32Array;
}

interface TrailData {
  line: THREE.Line;
  geo: THREE.BufferGeometry;
  /** F33 — trail length in mean-anomaly radians (time-based, not arc-based) */
  mSpan: number;
}

/** F17 — Halley runtime node (Kepler orbit + dual activity tails) */
interface CometNode {
  info: BodyInfo;
  system: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  coma: THREE.Sprite;
  /** world-space up of the tilted orbit plane (for dust-tail curvature) */
  orbitNormal: THREE.Vector3;
  ionGeo: THREE.BufferGeometry;
  ionMesh: THREE.Mesh;
  dustGeo: THREE.BufferGeometry;
  dustMesh: THREE.Mesh;
}

/* -------- constellations (real RA/Dec stick figures on the sky sphere, F6) -------- */
type ConstellationSpec = {
  name: string;
  en: string;
  /** English display name (chips / card title / canvas sprite) */
  nameEn: string;
  /** [RA hours, Dec degrees] per node star */
  stars: [number, number][];
  /** index pairs chained with faint lines */
  lines: [number, number][];
  /** F15 archive-card facts (zh + parallel En) */
  kind: string;
  kindEn: string;
  brightest: string;
  brightestEn: string;
  magnitude: string;
  distance: string;
  distanceEn: string;
  bestSeason: string;
  bestSeasonEn: string;
  story: string;
  storyEn: string;
};

const CONSTELLATIONS: ConstellationSpec[] = [
  {
    name: '北斗七星',
    en: 'URSA MAJOR',
    nameEn: 'Big Dipper',
    stars: [
      [11.062, 61.75],
      [11.031, 56.38],
      [11.897, 53.69],
      [12.257, 57.03],
      [12.9, 55.96],
      [13.399, 54.93],
      [13.792, 49.31],
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ],
    kind: '北天星座 · 大熊座腰尾',
    kindEn: "Northern · back and tail of Ursa Major",
    brightest: '玉衡 Alioth',
    brightestEn: 'Alioth',
    magnitude: '1.77',
    distance: '约 83 光年',
    distanceEn: '≈ 83 ly',
    bestSeason: '北半球春季（3–6 月）',
    bestSeasonEn: 'Northern spring (Mar–Jun)',
    story:
      '勺口两星（天璇、天枢）连线延长五倍即是北极星，千百年来为旅人指北。它是大熊座的腰与尾，在北纬 40° 以上终年不落；中国古称「北斗」，古人以斗柄指向定四时——斗柄东指，天下皆春。',
    storyEn:
      "Extend the line joining the two stars at the bowl's mouth (Merak and Dubhe) five times to find Polaris — it has pointed travelers north for millennia. These stars form the back and tail of Ursa Major and never set above latitude 40°N; ancient Chinese astronomers read the seasons from the handle's direction — when it pointed east, spring had come to the world.",
  },
  {
    name: '猎户座',
    en: 'ORION',
    nameEn: 'Orion',
    stars: [
      [5.919, 7.41],
      [5.418, 6.35],
      [5.679, -1.94],
      [5.595, -1.2],
      [5.533, -0.3],
      [5.795, -9.67],
      [5.242, -8.2],
      [5.585, 9.93],
    ],
    lines: [
      [7, 0],
      [7, 1],
      [0, 2],
      [1, 4],
      [2, 3],
      [3, 4],
      [2, 5],
      [4, 6],
    ],
    kind: '赤道带 · 冬季之王',
    kindEn: 'Equatorial · king of winter',
    brightest: '参宿七 Rigel',
    brightestEn: 'Rigel',
    magnitude: '0.13',
    distance: '650–1,350 光年',
    distanceEn: '650–1,350 ly',
    bestSeason: '北半球冬季（12–2 月）',
    bestSeasonEn: 'Northern winter (Dec–Feb)',
    story:
      '腰带三星整齐排成一线，是冬夜最易辨认的星群；佩剑处的猎户座大星云 M42 是肉眼可见的恒星育婴室。希腊神话中他是被天蝎蜇死的猎人，至今仍与天蝎座隔着天球遥遥相对、永不相见。',
    storyEn:
      'The three belt stars line up in a neat row — the easiest pattern to recognize on winter nights; the Orion Nebula M42 at the "sword" is a stellar nursery visible to the naked eye. In Greek myth he was the hunter stung to death by the scorpion; to this day Orion and Scorpius stand at opposite ends of the sky, never to meet.',
  },
  {
    name: '仙后座',
    en: 'CASSIOPEIA',
    nameEn: 'Cassiopeia',
    stars: [
      [0.153, 59.15],
      [0.675, 56.54],
      [0.945, 60.72],
      [1.43, 60.24],
      [1.907, 63.67],
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
    kind: '北天拱极星座',
    kindEn: 'Northern circumpolar',
    brightest: '策 Schedar',
    brightestEn: 'Schedar',
    magnitude: '2.24',
    distance: '100–550 光年',
    distanceEn: '100–550 ly',
    bestSeason: '秋冬（9–12 月，北天常显）',
    bestSeasonEn: 'Autumn–winter (Sep–Dec; a fixture of northern skies)',
    story:
      '五颗亮星连成醒目的「W」，与北斗隔北极星遥遥相对，是寻找仙女座的跳板。1572 年第谷在此目睹超新星爆发并写下《论新星》，动摇了「天界永恒不变」的千年信条。',
    storyEn:
      'Five bright stars form a striking "W", facing the Big Dipper across the pole star — a stepping stone to finding Andromeda. In 1572 Tycho Brahe witnessed a supernova here and wrote De Nova Stella, shaking the millennia-old belief that the heavens were unchanging.',
  },
  {
    name: '狮子座',
    en: 'LEO',
    nameEn: 'Leo',
    stars: [
      [10.139, 11.97], // α 轩辕十四 Regulus
      [11.818, 14.57], // β 五帝座一 Denebola
      [10.333, 19.84], // γ 轩辕十二 Algieba
      [11.235, 20.52], // δ 西上相 Zosma
      [9.764, 23.77], // ε 轩辕九 Algenubi
      [11.237, 15.43], // θ 西次相 Chertan
      [10.278, 23.42], // ζ 轩辕十一 Adhafera
      [9.88, 26.01], // μ 轩辕十 Rasalas
      [10.123, 16.76], // η 轩辕十三
    ],
    lines: [
      [0, 8],
      [8, 2],
      [2, 6],
      [6, 7],
      [7, 4],
      [0, 5],
      [5, 3],
      [3, 1],
    ],
    kind: '黄道星座 · 春夜之王',
    kindEn: 'Zodiacal · king of spring nights',
    brightest: '轩辕十四 Regulus',
    brightestEn: 'Regulus',
    magnitude: '1.35',
    distance: '约 79 光年',
    distanceEn: '≈ 79 ly',
    bestSeason: '北半球春季（3–5 月）',
    bestSeasonEn: 'Northern spring (Mar–May)',
    story:
      '头部六星反写的「镰刀」是这个星座的标志，轩辕十四几乎正好压在黄道上，被称为「王者之星」，月与行星时常从它身边掠过。每年 11 月中旬，坦普尔-塔特尔彗星的碎屑从狮口方向辐射而出，形成著名的狮子座流星雨，1833 年曾有「星陨如雨」的夜空盛宴。',
    storyEn:
      'The reversed "sickle" of six stars forming the head is this constellation\'s signature; Regulus sits almost exactly on the ecliptic — the "royal star" that the Moon and planets often pass close by. Every year in mid-November, debris from comet Tempel–Tuttle radiates out of the Lion\'s mouth in the famous Leonid meteor shower; in 1833 the night sky rained stars.',
  },
  {
    name: '天蝎座',
    en: 'SCORPIUS',
    nameEn: 'Scorpius',
    stars: [
      [16.49, -26.43], // α 心宿二 Antares
      [17.56, -37.1], // λ 尾宿八 Shaula
      [17.62, -43.0], // θ 尾宿五 Sargas
      [16.005, -22.62], // δ 房宿三 Dschubba
      [16.09, -19.81], // β 房宿四 Acrab
      [15.98, -26.11], // π 房宿一
      [16.836, -34.29], // ε 尾宿二
      [16.864, -38.05], // μ
      [16.9, -42.36], // ζ
      [17.202, -43.24], // η
      [17.793, -40.13], // ι
    ],
    lines: [
      [4, 3],
      [3, 5],
      [3, 0],
      [0, 6],
      [6, 7],
      [7, 8],
      [8, 9],
      [9, 2],
      [2, 10],
      [10, 1],
    ],
    kind: '黄道星座 · 夏夜毒蝎',
    kindEn: 'Zodiacal · venomous scorpion of summer',
    brightest: '心宿二 Antares',
    brightestEn: 'Antares',
    magnitude: '1.06',
    distance: '约 550 光年',
    distanceEn: '≈ 550 ly',
    bestSeason: '北半球夏季（6–8 月）',
    bestSeasonEn: 'Northern summer (Jun–Aug)',
    story:
      '一只弯钩形的巨蝎横卧在南天银河最浓处。心宿二是一颗红超巨星，色红如火，中国古称「大火」，《诗经》「七月流火」说的正是它西沉。希腊神话中蜇死猎户的天蝎，因此两座被众神安置在天球两端，永不同时出现——猎户座冬季升起时，天蝎座便落下。',
    storyEn:
      'A hook-shaped giant scorpion lies across the densest stretch of the southern Milky Way. Antares is a red supergiant, red as fire; the ancient Chinese called it "the Great Fire" — "in the seventh month the Fire Star sinks westward" in the Book of Songs describes just its setting. It is the scorpion that killed Orion in Greek myth, so the gods placed the two at opposite ends of the sky, never to rise together — when Orion climbs up in winter, Scorpius slips away.',
  },
  {
    name: '南十字座',
    en: 'CRUX',
    nameEn: 'Crux',
    stars: [
      [12.443, -63.1], // α 十字架二 Acrux
      [12.795, -59.69], // β 十字架三 Mimosa
      [12.519, -57.11], // γ 十字架一 Gacrux
      [12.253, -58.75], // δ
    ],
    lines: [
      [0, 2],
      [1, 3],
    ],
    kind: '南天星座 · 航海罗盘',
    kindEn: "Southern · navigator's compass",
    brightest: '十字架二 Acrux',
    brightestEn: 'Acrux',
    magnitude: '0.76',
    distance: '约 320 光年',
    distanceEn: '≈ 320 ly',
    bestSeason: '南半球秋季；北纬 25° 以南低空可见',
    bestSeasonEn: 'Southern autumn; low on the horizon south of latitude 25°N',
    story:
      '全天 88 星座中最小的一个，四颗亮星组成醒目的南天十字。将长轴延长四倍半即是南天极——南半球没有北极星，千百年来水手靠它导航，它也被绘入多个南半球国家的国旗。十字架二是一对相距仅 6 天文单位的炽热双星。',
    storyEn:
      'The smallest of the 88 constellations: four bright stars forming a striking southern cross. Extend the long axis four and a half times to reach the south celestial pole — with no polar star in the south, sailors steered by it for centuries, and it appears on the flags of several southern nations. Acrux is a pair of blazing hot stars only 6 astronomical units apart.',
  },
  {
    name: '船底座',
    en: 'CARINA',
    nameEn: 'Carina',
    stars: [
      [6.399, -52.7], // α 老人星 Canopus
      [9.22, -69.72], // β 南船五 Miaplacidus
      [8.375, -59.51], // ε 海石一 Avior
      [9.285, -59.28], // ι 海石二 Aspidiske
      [9.79, -65.13], // υ
    ],
    lines: [
      [0, 2],
      [2, 3],
      [3, 1],
      [1, 4],
      [4, 2],
    ],
    kind: '南天星座 · 旧南船龙骨',
    kindEn: 'Southern · keel of the old ship Argo',
    brightest: '老人星 Canopus',
    brightestEn: 'Canopus',
    magnitude: '-0.74',
    distance: '约 310 光年',
    distanceEn: '≈ 310 ly',
    bestSeason: '南半球夏夜；北纬 37° 以南可见',
    bestSeasonEn: 'Southern summer nights; visible south of latitude 37°N',
    story:
      '老人星是全天第二亮恒星，中国古称「南极老人星」，长江流域冬夜偶见其贴地掠过，北方则终生无缘。船底座原是巨大的南船座（阿尔戈号）的一部分，18 世纪被拆分为船底、船帆、船尾三座。座内的海山二 Eta Carinae 质量超过太阳百倍，是离我们最近的超新星候选者之一。',
    storyEn:
      'Canopus is the second-brightest star in the entire sky; the ancient Chinese called it "the Old Man of the South Pole" — on winter nights it occasionally skims the horizon south of the Yangtze basin, while northern observers never see it at all. Carina was once part of the vast constellation Argo (the ship of Jason and the Argonauts), split into Carina, Vela and Puppis in the 18th century. Eta Carinae, over a hundred times the mass of the Sun, is one of the nearest supernova candidates.',
  },
];

/** F15 — per-constellation materials the animate loop lerps for the highlight effect. */
interface ConstellationVis {
  lineMat: THREE.LineBasicMaterial;
  pointsMat: THREE.PointsMaterial;
  nameMat: THREE.SpriteMaterial;
}

const CONSTELLATION_DIM = { line: 0.3, points: 0.85, size: 9, name: 0.62 };
const CONSTELLATION_LIT = { line: 0.95, points: 1, size: 15, name: 1 };

/* ---------------- F17 — comet tail ribbon helpers ---------------- */
const TAIL_SEGMENTS = 22;

function makeTailGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(TAIL_SEGMENTS * 2 * 3), 3)
  );
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TAIL_SEGMENTS * 2 * 3), 3));
  const idx: number[] = [];
  for (let i = 0; i < TAIL_SEGMENTS - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);
  return geo;
}

/** Rebuild a comet-tail ribbon: strip along `dir`, widening `wHead→wTail`,
 *  optionally bent along `curve` (dust tail); brightness fades toward the tail. */
function updateTail(
  geo: THREE.BufferGeometry,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  side: THREE.Vector3,
  curve: THREE.Vector3,
  length: number,
  wHead: number,
  wTail: number,
  curveAmt: number,
  color: THREE.Color,
  activity: number
): void {
  const pos = geo.attributes.position.array as Float32Array;
  const col = geo.attributes.color.array as Float32Array;
  for (let k = 0; k < TAIL_SEGMENTS; k++) {
    const t = k / (TAIL_SEGMENTS - 1);
    const w = (wHead + (wTail - wHead) * t) * 0.5;
    const sag = curveAmt * t * t;
    const cx = origin.x + dir.x * (t * length) + curve.x * sag;
    const cy = origin.y + dir.y * (t * length) + curve.y * sag;
    const cz = origin.z + dir.z * (t * length) + curve.z * sag;
    const o = k * 6;
    pos[o] = cx - side.x * w;
    pos[o + 1] = cy - side.y * w;
    pos[o + 2] = cz - side.z * w;
    pos[o + 3] = cx + side.x * w;
    pos[o + 4] = cy + side.y * w;
    pos[o + 5] = cz + side.z * w;
    const b = Math.pow(1 - t, 1.7) * activity;
    const r = color.r * b;
    const g = color.g * b;
    const bl = color.b * b;
    col[o] = r;
    col[o + 1] = g;
    col[o + 2] = bl;
    col[o + 3] = r;
    col[o + 4] = g;
    col[o + 5] = bl;
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
}

function radecToVec3(raHours: number, decDeg: number, radius: number): THREE.Vector3 {
  const ra = (raHours / 24) * Math.PI * 2;
  const dec = THREE.MathUtils.degToRad(decDeg);
  return new THREE.Vector3(
    radius * Math.cos(dec) * Math.cos(ra),
    radius * Math.sin(dec),
    -radius * Math.cos(dec) * Math.sin(ra)
  );
}

/* -------- F22 — Orionid meteor shower (Earth crossing Halley's debris node) -------- */
const METEOR_MAX = 90;
const METEOR_SKY_R = 620; // streaks live just inside the starfield (700+)
const METEOR_CONE = 0.62; // spawn cone half-angle around the radiant, radians
const METEOR_SIGMA = 0.17; // node-crossing gaussian width, radians (~10°)

/** Pooled meteor state — allocated once at init, recycled forever. */
interface MeteorState {
  alive: boolean;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  age: number;
  life: number;
  len: number;
  warm: boolean;
}

function createConstellationLabelTexture(name: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = '500 26px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(206,214,230,0.92)';
    ctx.fillText(name, 128, 34);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildHitProxy(radius: number, bodyId: string): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 12, 8);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.bodyId = bodyId;
  return mesh;
}

function remapRingUV(geo: THREE.RingGeometry, inner: number, outer: number): void {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = v.length();
    uv.setXY(i, (r - inner) / (outer - inner), 0.5);
  }
  uv.needsUpdate = true;
}

/* F19 — mini star chart (canvas) for the constellation archive card */
const CHART_W = 272;
const CHART_H = 150;

function ConstellationChart({ con }: { con: ConstellationSpec }) {
  const lang = useLang();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = CHART_W * dpr;
    canvas.height = CHART_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CHART_W, CHART_H);

    // sky view: RA grows to the LEFT (as on real sky charts), Dec points up
    const pts = con.stars.map(([ra, dec]) => ({ x: -(ra / 24) * 360, y: dec }));
    const pad = 20;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    pts.forEach((p) => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });
    const spanX = Math.max(maxX - minX, 4);
    const spanY = Math.max(maxY - minY, 4);
    const scale = Math.min((CHART_W - pad * 2) / spanX, (CHART_H - pad * 2) / spanY);
    const ox = (CHART_W - spanX * scale) / 2;
    const oy = (CHART_H - spanY * scale) / 2;
    const sx = (x: number) => ox + (x - minX) * scale;
    const sy = (y: number) => CHART_H - (oy + (y - minY) * scale);

    // frame + faint grid
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.strokeRect(6.5, 6.5, CHART_W - 13, CHART_H - 13);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    for (let gx = 1; gx < 4; gx++) {
      const x = 6.5 + ((CHART_W - 13) / 4) * gx;
      ctx.beginPath();
      ctx.moveTo(x, 6.5);
      ctx.lineTo(x, CHART_H - 6.5);
      ctx.stroke();
    }
    for (let gy = 1; gy < 3; gy++) {
      const y = 6.5 + ((CHART_H - 13) / 3) * gy;
      ctx.beginPath();
      ctx.moveTo(6.5, y);
      ctx.lineTo(CHART_W - 6.5, y);
      ctx.stroke();
    }

    // stick lines
    ctx.strokeStyle = 'rgba(157,176,204,0.6)';
    ctx.lineWidth = 1.2;
    con.lines.forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(sx(pts[a].x), sy(pts[a].y));
      ctx.lineTo(sx(pts[b].x), sy(pts[b].y));
      ctx.stroke();
    });

    // stars: soft halo + bright core
    pts.forEach((p) => {
      const x = sx(p.x);
      const y = sy(p.y);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, 7.5);
      grad.addColorStop(0, 'rgba(235,242,255,0.95)');
      grad.addColorStop(0.35, 'rgba(190,210,240,0.35)');
      grad.addColorStop(1, 'rgba(190,210,240,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eef4ff';
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [con]);

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: CHART_H }}
        className="block"
        role="img"
        aria-label={lang === 'en' ? `${con.nameEn} star chart` : `${con.name}星图`}
      />
      <p className="border-t border-white/5 px-3 py-1.5 text-[10px] tracking-wider text-zinc-500">
        {L('星图 · 北在上 · 天空视角（东西翻转）', 'Star chart · North up · sky view (east–west flipped)')}
      </p>
    </div>
  );
}

export default function SolarSystemScene() {
  const lang = useLang(); // re-render (and refresh L()/lang-conditional strings) on language switch
  const wrapRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [speed, setSpeed] = useState<Speed>(1);
  const [liveLock, setLiveLock] = useState(false); // F36 — 实时锁定
  const [showOrbits, setShowOrbits] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showConstellations, setShowConstellations] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [showMeteors, setShowMeteors] = useState(true); // F22 — Orionid meteor shower
  const [selected, setSelected] = useState<BodyInfo | null>(null);
  const [selCon, setSelCon] = useState<number | null>(null);
  /* panel collapse (小屏折叠): remembered across visits via localStorage */
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    try {
      return localStorage.getItem('universe-panel-solar') === '1';
    } catch {
      return false;
    }
  });
  /* keeps the collapsed fab mounted while its uni-origin-out shrink plays */
  const [fabLeaving, setFabLeaving] = useState(false);

  const speedRef = useRef<Speed>(1);
  const liveLockRef = useRef(false); // F36
  const orbitsVisibleRef = useRef(true);
  const labelsVisibleRef = useRef(true);
  const constellationsVisibleRef = useRef(true);
  const trailsVisibleRef = useRef(true);
  const meteorsVisibleRef = useRef(true); // F22
  const meteorBurstUntilRef = useRef(0); // F22 — short guaranteed burst when toggled on
  const meteorStatusRef = useRef<HTMLParagraphElement>(null); // F22 — live activity line
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const nodesRef = useRef<PlanetNode[]>([]);
  const orbitLinesRef = useRef<THREE.Line[]>([]);
  const trailLinesRef = useRef<THREE.Line[]>([]);
  const constellationGroupRef = useRef<THREE.Group | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const constellationVisRef = useRef<ConstellationVis[]>([]);
  const constellationHitSpritesRef = useRef<THREE.Sprite[]>([]);
  const constellationHitPointsRef = useRef<THREE.Points[]>([]);
  const selConIdxRef = useRef<number | null>(null);
  const cometRef = useRef<CometNode | null>(null);
  /* F26 — simulated calendar */
  const simJumpRef = useRef<number | null>(null);
  const simTimeRef = useRef(0);
  const orionidPeakSimRef = useRef<number | null>(null);
  const halleyPeriSimRef = useRef<number | null>(null);
  const dateTextRef = useRef<HTMLDivElement | null>(null);
  const [dateInput, setDateInput] = useState<string>(() => toISODateLocal(new Date()));
  /* F29 — planetary-alignment status line (DOM-written) */
  const alignRef = useRef<HTMLParagraphElement | null>(null);
  /* F25 — constellation quick-locate flight */
  const conFlightRef = useRef<number | null>(null);
  const constellationCentersRef = useRef<THREE.Vector3[]>([]);
  /* 一镜到底 origin-transition bookkeeping (bridges the once-registered scene
     effect and the React card lifecycle). Cards stay mounted during their exit:
     the clearing setState is deferred to the playExit onDone callback. */
  const infoCardRef = useRef<HTMLElement | null>(null);
  const conCardRef = useRef<HTMLElement | null>(null);
  const cardOriginRef = useRef({ x: 0, y: 0 }); // viewport point the card opens from
  const infoGenRef = useRef(0); // invalidates a pending exit when the card reopens
  const conGenRef = useRef(0);
  const infoExitingRef = useRef(false);
  const conExitingRef = useRef(false);
  const closeInfoRef = useRef<() => void>(() => {});
  const closeConRef = useRef<() => void>(() => {});
  const openBodyRef = useRef<(b: BodyInfo) => void>(() => {});
  const openConRef = useRef<(idx: number) => void>(() => {});
  /* panel collapse — 一镜到底 handoff bookkeeping */
  const panelRef = useRef<HTMLDivElement>(null);
  const panelFabRef = useRef<HTMLButtonElement>(null);
  const panelToggleOriginRef = useRef({ x: 0, y: 0 }); // last collapse/expand click point
  const justExpandedRef = useRef(false); // next panel mount should grow out of the fab
  const panelSlidePlayedRef = useRef(false); // uni-anim-slide-left only on the first page load
  const panelExitingRef = useRef(false);
  const fabExitingRef = useRef(false);

  useEffect(() => {
    constellationsVisibleRef.current = showConstellations;
    if (constellationGroupRef.current) {
      constellationGroupRef.current.visible = showConstellations;
    }
  }, [showConstellations]);

  useEffect(() => {
    selConIdxRef.current = selCon;
  }, [selCon]);

  useEffect(() => {
    labelsVisibleRef.current = showLabels;
  }, [showLabels]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  /* F36 — live lock: pin the simulation to the real clock */
  useEffect(() => {
    liveLockRef.current = liveLock;
  }, [liveLock]);

  /* F40 — Space bar toggles solar pause (CustomEvent dispatched by the header) */
  useEffect(() => {
    const onTogglePause = () => {
      if (liveLockRef.current) return; // real-time lock owns the clock — no pause
      setSpeed((v) => (v === 0 ? 1 : 0));
      playEventSound('click');
    };
    window.addEventListener('universe-toggle-pause', onTogglePause);
    return () => window.removeEventListener('universe-toggle-pause', onTogglePause);
  }, []);

  useEffect(() => {
    orbitsVisibleRef.current = showOrbits;
    orbitLinesRef.current.forEach((l) => {
      l.visible = showOrbits;
    });
  }, [showOrbits]);

  useEffect(() => {
    trailsVisibleRef.current = showTrails;
    trailLinesRef.current.forEach((l) => {
      l.visible = showTrails;
    });
  }, [showTrails]);

  useEffect(() => {
    meteorsVisibleRef.current = showMeteors; // F22
    if (showMeteors) {
      // toggle-on grace: guarantee an immediate shower for the first ~9 s
      meteorBurstUntilRef.current = performance.now() + 9000;
    }
  }, [showMeteors]);

  /* highlight selected planet (or comet) */
  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null;
    nodesRef.current.forEach((n) => {
      if (selectedIdRef.current === n.info.id) {
        n.material.emissive.set(0x5a4a22);
        n.material.emissiveIntensity = 0.55;
      } else {
        n.material.emissive.set(0x000000);
        n.material.emissiveIntensity = 0;
      }
    });
    const c = cometRef.current;
    if (c) {
      if (selectedIdRef.current === 'halley') {
        c.material.emissive.set(0x1e4a52);
        c.material.emissiveIntensity = 0.9;
      } else {
        c.material.emissive.set(0x000000);
        c.material.emissiveIntensity = 0;
      }
    }
  }, [selected]);

  /* 一镜到底 — cards stay mounted while their exit plays: the clearing setState
     is deferred to the playExit onDone callback, so content cannot flash. */
  const closeInfoCard = () => {
    if (infoExitingRef.current) return; // an exit is already playing
    const el = infoCardRef.current;
    if (!el) {
      setSelected(null);
      return;
    }
    infoExitingRef.current = true;
    const gen = infoGenRef.current + 1;
    infoGenRef.current = gen;
    playExit(el, 'uni-origin-out', () => {
      if (infoGenRef.current !== gen) return; // reopened while closing — keep it
      infoExitingRef.current = false;
      setSelected(null); // unmount only after the collapse finished
    }, 380);
  };

  const closeConCard = () => {
    if (conExitingRef.current) return;
    const el = conCardRef.current;
    if (!el) {
      setSelCon(null);
      return;
    }
    conExitingRef.current = true;
    const gen = conGenRef.current + 1;
    conGenRef.current = gen;
    playExit(el, 'uni-origin-out', () => {
      if (conGenRef.current !== gen) return;
      conExitingRef.current = false;
      setSelCon(null);
    }, 380);
  };

  const enterInfoCard = () => {
    const el = infoCardRef.current;
    if (el) {
      setOriginFromPoint(el, cardOriginRef.current.x, cardOriginRef.current.y);
      playEnter(el, 'uni-origin-in');
    }
  };

  const enterConCard = () => {
    const el = conCardRef.current;
    if (el) {
      setOriginFromPoint(el, cardOriginRef.current.x, cardOriginRef.current.y);
      playEnter(el, 'uni-origin-in');
    }
  };

  /* open helpers: cancel a still-running exit (a same-body re-click within the
     380 ms close window would otherwise never re-fire the enter effect) */
  const openBody = (b: BodyInfo) => {
    closeConCard();
    if (infoExitingRef.current) {
      infoGenRef.current += 1; // invalidate the pending onDone
      infoExitingRef.current = false;
      if (selected?.id === b.id) enterInfoCard(); // effect won't refire for the same body
    }
    setSelected(b);
  };

  const openCon = (idx: number) => {
    closeInfoCard();
    if (conExitingRef.current) {
      conGenRef.current += 1;
      conExitingRef.current = false;
      if (selCon === idx) enterConCard();
    }
    setSelCon(idx);
    conFlightRef.current = idx;
  };

  /* enter effects: scale the freshly mounted card out of the recorded click
     point (cardOriginRef, written by every trigger before opening) */
  useEffect(() => {
    if (!selected) return;
    infoGenRef.current += 1; // invalidate any pending exit (reopen mid-close)
    infoExitingRef.current = false;
    enterInfoCard();
  }, [selected]);

  useEffect(() => {
    if (selCon === null) return;
    conGenRef.current += 1;
    conExitingRef.current = false;
    enterConCard();
  }, [selCon]);

  /* The scene effect registers its pointer handlers once; keep the card open/
     close fns reachable from there via refs, refreshed on every render. */
  useEffect(() => {
    closeInfoRef.current = closeInfoCard;
    closeConRef.current = closeConCard;
    openBodyRef.current = openBody;
    openConRef.current = openCon;
  });

  /* -------- panel collapse / expand (一镜到底) -------- */
  const collapsePanel = (x: number, y: number) => {
    if (panelExitingRef.current) return; // a collapse is already playing
    panelExitingRef.current = true;
    panelToggleOriginRef.current = { x, y };
    try {
      localStorage.setItem('universe-panel-solar', '1');
    } catch {
      /* storage unavailable — collapse still works for this session */
    }
    playEventSound('click');
    const el = panelRef.current;
    if (!el) {
      panelExitingRef.current = false;
      setPanelCollapsed(true);
      return;
    }
    playExit(el, 'uni-origin-out', () => {
      panelExitingRef.current = false;
      setPanelCollapsed(true); // unmount only after the shrink finished
    }, 380);
  };

  const expandPanel = (x: number, y: number) => {
    if (fabExitingRef.current) return; // the fab shrink is still playing
    fabExitingRef.current = true;
    panelToggleOriginRef.current = { x, y };
    justExpandedRef.current = true;
    try {
      localStorage.setItem('universe-panel-solar', '0');
    } catch {
      /* ignore */
    }
    playEventSound('click');
    setFabLeaving(true); // keep the fab mounted while it shrinks into the point
    setPanelCollapsed(false); // panel mounts now and grows out of the same point
    const fab = panelFabRef.current;
    if (!fab) {
      fabExitingRef.current = false;
      setFabLeaving(false);
      return;
    }
    setOriginFromPoint(fab, x, y);
    playExit(fab, 'uni-origin-out', () => {
      fabExitingRef.current = false;
      setFabLeaving(false); // unmount the fab only after its shrink finished
    }, 380);
  };

  /* fab enter: grow out of the recorded collapse click point */
  useEffect(() => {
    if (!panelCollapsed) return;
    const el = panelFabRef.current;
    if (!el) return;
    const { x, y } = panelToggleOriginRef.current;
    if (x === 0 && y === 0) return; // page loaded collapsed — no handoff point
    setOriginFromPoint(el, x, y);
    playEnter(el, 'uni-origin-in');
  }, [panelCollapsed]);

  /* panel enter: expand-from-fab grows out of the fab point; the very first
     page load keeps the original uni-anim-slide-left (applied imperatively so
     React never overwrites the animation classes mid-exit). */
  useEffect(() => {
    if (panelCollapsed) return;
    const el = panelRef.current;
    if (!el) return;
    if (justExpandedRef.current) {
      justExpandedRef.current = false;
      const { x, y } = panelToggleOriginRef.current;
      setOriginFromPoint(el, x, y);
      playEnter(el, 'uni-origin-in');
      return;
    }
    if (!panelSlidePlayedRef.current) {
      panelSlidePlayedRef.current = true;
      el.classList.add('uni-anim-slide-left');
    }
  }, [panelCollapsed]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      return;
    }
    const baseDpr = Math.min(window.devicePixelRatio || 1, getDprCap());
    const applyRenderScale = () => {
      renderer.setPixelRatio(baseDpr * getRenderScale());
    };
    applyRenderScale();
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.domElement.style.display = 'block';
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020208);

    const camera = new THREE.PerspectiveCamera(
      55,
      wrap.clientWidth / Math.max(1, wrap.clientHeight),
      0.1,
      4000
    );
    camera.position.set(0, 46, 94);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 8;
    controls.maxDistance = 320;
    controls.maxPolarAngle = Math.PI - 0.08;
    controls.update();

    scene.add(new THREE.AmbientLight(0x50586a, 0.5));
    const sunLight = new THREE.PointLight(0xfff1d8, 2.8, 0, 0);
    scene.add(sunLight);

    const disposables: { dispose: () => void }[] = [];

    /* ------------------------------ starfield ------------------------------ */
    {
      const count = 2600;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const r = 700 + Math.random() * 260;
        const theta = Math.random() * TAU;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        const roll = Math.random();
        let c: [number, number, number];
        if (roll < 0.14) c = [1, 0.82, 0.66];
        else if (roll < 0.26) c = [0.78, 0.86, 1];
        else c = [0.92, 0.94, 1];
        const b = 0.45 + Math.random() * 0.55;
        colors[i * 3] = c[0] * b;
        colors[i * 3 + 1] = c[1] * b;
        colors[i * 3 + 2] = c[2] * b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: 5,
        map: getStarSpriteTexture(),
        transparent: true,
        depthWrite: false,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const stars = new THREE.Points(geo, mat);
      stars.matrixAutoUpdate = false; // static starfield — bake the matrix once
      stars.updateMatrix();
      scene.add(stars);
    }

    /* -------- constellation stick figures + names on the sky dome (F6) -------- */
    {
      const group = new THREE.Group();
      // frame Orion into the default camera cone (upper-left of the Sun)
      group.rotation.y = 0.55;
      group.rotation.x = -0.3;
      const SKY_R = 820;
      const conVis: ConstellationVis[] = [];
      const conHitSprites: THREE.Sprite[] = [];
      const conHitPoints: THREE.Points[] = [];
      CONSTELLATIONS.forEach((c, idx) => {
        const nodeVs = c.stars.map(([ra, dec]) => radecToVec3(ra, dec, SKY_R));
        const verts: number[] = [];
        for (const [a, b] of c.lines) {
          const va = nodeVs[a];
          const vb = nodeVs[b];
          verts.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
        }
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        const lineMat = new THREE.LineBasicMaterial({
          color: 0x9db0cc,
          transparent: true,
          opacity: CONSTELLATION_DIM.line,
        });
        const conLines = new THREE.LineSegments(lineGeo, lineMat);
        conLines.matrixAutoUpdate = false; // static stick figure — bake the matrix once
        conLines.updateMatrix();
        group.add(conLines);
        disposables.push(lineGeo, lineMat);

        const parr = new Float32Array(nodeVs.length * 3);
        nodeVs.forEach((v, i) => {
          parr[i * 3] = v.x;
          parr[i * 3 + 1] = v.y;
          parr[i * 3 + 2] = v.z;
        });
        const pgeo = new THREE.BufferGeometry();
        pgeo.setAttribute('position', new THREE.BufferAttribute(parr, 3));
        const pmat = new THREE.PointsMaterial({
          size: CONSTELLATION_DIM.size,
          map: getStarSpriteTexture(),
          transparent: true,
          opacity: CONSTELLATION_DIM.points,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          sizeAttenuation: true,
          color: 0xe8eeff,
        });
        const points = new THREE.Points(pgeo, pmat);
        points.userData.constellationIndex = idx;
        points.matrixAutoUpdate = false; // static node stars — bake the matrix once
        points.updateMatrix();
        group.add(points);
        disposables.push(pgeo, pmat);
        conHitPoints.push(points);

        const nameTex = createConstellationLabelTexture(getLang() === 'en' ? c.nameEn : c.name);
        const nameMat = new THREE.SpriteMaterial({
          map: nameTex,
          transparent: true,
          opacity: CONSTELLATION_DIM.name,
          depthWrite: false,
        });
        const nameSprite = new THREE.Sprite(nameMat);
        const center = nodeVs
          .reduce((acc, v) => acc.add(v), new THREE.Vector3())
          .multiplyScalar(1 / nodeVs.length);
        nameSprite.position.copy(center.normalize().multiplyScalar(SKY_R + 40));
        nameSprite.scale.set(84, 21, 1);
        nameSprite.userData.constellationIndex = idx;
        group.add(nameSprite);
        disposables.push(nameTex, nameMat);
        conHitSprites.push(nameSprite);
        conVis.push({ lineMat, pointsMat: pmat, nameMat });
      });
      // F25 — world-space direction of each constellation centre (for the camera flight)
      {
        const q = new THREE.Quaternion().setFromEuler(group.rotation);
        constellationCentersRef.current = CONSTELLATIONS.map((_c, i) => {
          const dir = conHitSprites[i].position.clone().normalize().applyQuaternion(q);
          return dir;
        });
      }
      group.visible = constellationsVisibleRef.current;
      scene.add(group);
      constellationGroupRef.current = group;
      constellationVisRef.current = conVis;
      constellationHitSpritesRef.current = conHitSprites;
      constellationHitPointsRef.current = conHitPoints;
    }

    /* ------------------------------ the sun ------------------------------ */
    const sunGroup = new THREE.Group();
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(4.6, 64, 48),
      new THREE.MeshBasicMaterial({ map: getPlanetTexture('sun') })
    );
    sunGroup.add(sunMesh);
    const glow1 = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture('sun-glow', 256, 'rgba(255,244,214,0.95)', 'rgba(255,170,60,0.32)', 'rgba(255,120,20,0)'),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      })
    );
    glow1.scale.setScalar(26);
    sunGroup.add(glow1);
    const glow2 = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture('sun-glow2', 256, 'rgba(255,224,160,0.55)', 'rgba(255,150,45,0.18)', 'rgba(255,100,20,0)'),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.7,
      })
    );
    glow2.scale.setScalar(58);
    sunGroup.add(glow2);
    const sunHit = buildHitProxy(5.4, 'sun');
    sunGroup.add(sunHit);
    scene.add(sunGroup);

    /* ------------------------------ planets ------------------------------ */
    const hitMeshes: THREE.Mesh[] = [sunHit];
    const nodes: PlanetNode[] = [];
    const trails: TrailData[] = [];

    PLANETS.forEach((info, idx) => {
      const L = SCENE_LAYOUT[info.id];
      /* F33 — real 3D orbital orientation: the outer group rotates the line of
         nodes to Ω; the inner group tilts the orbit plane by the true
         inclination around that node line. Scene azimuth runs +X→+Z, so the
         node rotation is the NEGATIVE of the astronomical Ω. */
      const nodeDeg = J2000_ASCENDING_NODE_DEG[info.id] ?? 0;
      const periDeg = J2000_PERIHELION_LON_DEG[info.id] ?? 0;
      const nodeGroup = new THREE.Group();
      nodeGroup.rotation.y = -THREE.MathUtils.degToRad(nodeDeg);
      scene.add(nodeGroup);

      const orbitGroup = new THREE.Group();
      orbitGroup.rotation.x = THREE.MathUtils.degToRad(L.inclDeg);
      nodeGroup.add(orbitGroup);

      /* orbit line — the true ellipse in the inclined plane (sun at focus, F33) */
      const ecc = J2000_ECCENTRICITY[info.id] ?? 0;
      const omegaRad = THREE.MathUtils.degToRad(periDeg - nodeDeg);
      const pVis = L.orbit * (1 - ecc * ecc); // semi-latus rectum, scene units
      const seg = 256;
      const linePos = new Float32Array(seg * 3);
      for (let i = 0; i < seg; i++) {
        const nu = (i / seg) * TAU;
        const r = pVis / (1 + ecc * Math.cos(nu));
        const u = omegaRad + nu; // in-plane angle measured from the node
        linePos[i * 3] = Math.cos(u) * r;
        linePos[i * 3 + 1] = 0;
        linePos[i * 3 + 2] = Math.sin(u) * r;
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x9aa7b8,
        transparent: true,
        opacity: 0.3,
      });
      const orbitLine = new THREE.LineLoop(lineGeo, lineMat);
      orbitLine.visible = orbitsVisibleRef.current;
      orbitLine.matrixAutoUpdate = false; // static ellipse — bake the matrix once
      orbitLine.updateMatrix();
      orbitGroup.add(orbitLine);
      orbitLinesRef.current.push(orbitLine);
      disposables.push(lineGeo, lineMat);

      /* comet-like motion trail (F10): analytic gradient arc trailing the planet */
      {
        const trailColor = new THREE.Color(info.accent);
        const tPos = new Float32Array(TRAIL_POINTS * 3);
        const tCol = new Float32Array(TRAIL_POINTS * 3);
        for (let k = 0; k < TRAIL_POINTS; k++) {
          const f = k / (TRAIL_POINTS - 1); // 0 = tail → 1 = head
          const b = Math.pow(f, 2.2) * 0.75;
          tCol[k * 3] = trailColor.r * b;
          tCol[k * 3 + 1] = trailColor.g * b;
          tCol[k * 3 + 2] = trailColor.b * b;
        }
        const trailGeo = new THREE.BufferGeometry();
        trailGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
        trailGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
        const trailMat = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const trailLine = new THREE.Line(trailGeo, trailMat);
        trailLine.frustumCulled = false;
        trailLine.visible = trailsVisibleRef.current;
        trailLine.renderOrder = 1;
        orbitGroup.add(trailLine);
        disposables.push(trailGeo, trailMat);
        trailLinesRef.current.push(trailLine);
        trails.push({
          line: trailLine,
          geo: trailGeo,
          mSpan: TAU * TRAIL_ARC_FRACTION,
        });
      }

      /* planet system */
      const system = new THREE.Group();
      orbitGroup.add(system);

      const tiltGroup = new THREE.Group();
      tiltGroup.rotation.z = THREE.MathUtils.degToRad(L.tiltDeg);
      system.add(tiltGroup);

      const material = new THREE.MeshStandardMaterial({
        map: getPlanetTexture(info.id),
        roughness: 0.95,
        metalness: 0.02,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(L.size, 48, 32), material);
      tiltGroup.add(mesh);
      disposables.push(mesh.geometry, material);

      /* Saturn's ring */
      if (info.id === 'saturn') {
        const rIn = L.size * 1.35;
        const rOut = L.size * 2.35;
        const ringGeo = new THREE.RingGeometry(rIn, rOut, 180, 1);
        remapRingUV(ringGeo, rIn, rOut);
        const ringMat = new THREE.MeshBasicMaterial({
          map: getSaturnRingTexture(),
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          opacity: 0.96,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        tiltGroup.add(ring);
        disposables.push(ringGeo, ringMat);
      }
      /* faint Uranus ring */
      if (info.id === 'uranus') {
        const rIn = L.size * 1.55;
        const rOut = L.size * 1.95;
        const ringGeo = new THREE.RingGeometry(rIn, rOut, 128, 1);
        remapRingUV(ringGeo, rIn, rOut);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xa8c4c4,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        tiltGroup.add(ring);
        disposables.push(ringGeo, ringMat);
      }

      /* Earth's moon */
      let moonPivot: THREE.Group | null = null;
      if (info.id === 'earth') {
        moonPivot = new THREE.Group();
        const moonMat = new THREE.MeshStandardMaterial({
          map: getPlanetTexture('moon'),
          roughness: 1,
          metalness: 0,
        });
        const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), moonMat);
        moonMesh.position.set(2.35, 0, 0);
        moonPivot.add(moonMesh);
        system.add(moonPivot);
        disposables.push(moonMesh.geometry, moonMat);
      }

      /* generous invisible hit proxy */
      const hit = buildHitProxy(Math.max(L.size * 2.1, 1.5), info.id);
      system.add(hit);
      hitMeshes.push(hit);

      nodes.push({
        info,
        system,
        mesh,
        material,
        angSpeed: (TAU / SECONDS_PER_EARTH_YEAR) * (365.25 / L.periodDays),
        spinSpeed: (TAU / SECONDS_PER_EARTH_SPIN) * (0.997 / L.spinDays),
        // F26/F33 — J2000 mean longitude + real orbital elements: any calendar
        // date maps to the true (elliptical, 3D-oriented) configuration.
        angle0: THREE.MathUtils.degToRad(J2000_MEAN_LONGITUDE_DEG[info.id] ?? idx * 0.9),
        nodeRad: THREE.MathUtils.degToRad(nodeDeg),
        periRad: THREE.MathUtils.degToRad(periDeg),
        omegaRad,
        inclRad: THREE.MathUtils.degToRad(L.inclDeg),
        ecc,
        aVis: L.orbit,
        moonPivot,
      });
    });
    nodesRef.current = nodes;

    const moonAngSpeed = (TAU / SECONDS_PER_EARTH_YEAR) * (365.25 / 27.32);
    const sunSpinSpeed = TAU / (SECONDS_PER_EARTH_SPIN * 25.4);

    /* -------- asteroid belt + Kuiper belt (Keplerian differential rotation) -------- */
    const belts: BeltData[] = [];
    const beltSpecs = [
      {
        count: 3500,
        rMin: 33.5,
        rMax: 38.5,
        ySpread: 0.75,
        size: 0.3,
        lum: [0.5, 0.85],
        warm: 0.5,
        opacity: 0.85,
      },
      {
        count: 2600,
        rMin: 84,
        rMax: 97,
        ySpread: 1.5,
        size: 0.26,
        lum: [0.35, 0.6],
        warm: 0.15,
        opacity: 0.7,
      },
    ];
    for (const spec of beltSpecs) {
      const count = spec.count;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const r = new Float32Array(count);
      const y = new Float32Array(count);
      const angle0 = new Float32Array(count);
      const angSpeed = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const t = (Math.random() + Math.random()) * 0.5; // triangular — denser mid-belt
        r[i] = spec.rMin + t * (spec.rMax - spec.rMin);
        y[i] = (Math.random() + Math.random() + Math.random() - 1.5) * spec.ySpread * 0.8;
        angle0[i] = Math.random() * TAU;
        const aAU = r[i] * AU_PER_UNIT;
        angSpeed[i] = TAU / (SECONDS_PER_EARTH_YEAR * Math.pow(aAU, 1.5));
        const lum = spec.lum[0] + Math.random() * (spec.lum[1] - spec.lum[0]);
        const wr = spec.warm * (Math.random() - 0.5);
        colors[i * 3] = Math.min(1, lum * (1 + wr));
        colors[i * 3 + 1] = Math.min(1, lum * (1 + wr * 0.4));
        colors[i * 3 + 2] = Math.min(1, lum * (1 - spec.warm * 0.25 * Math.random()));
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: spec.size,
        map: getStarSpriteTexture(),
        transparent: true,
        opacity: spec.opacity,
        vertexColors: true,
        sizeAttenuation: true,
        depthWrite: false,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.matrixAutoUpdate = false; // belt grains move via the position attribute, not the matrix
      points.updateMatrix();
      scene.add(points);
      disposables.push(geo, mat);
      belts.push({ geo, count, r, y, angle0, angSpeed });
    }

    /* ------- Halley: Keplerian elliptical orbit + dual activity tails (F17) ------- */
    /* F22 — world-space longitude where the orbit crosses the ecliptic: when the
       Earth sweeps past this direction it passes through Halley's debris trail
       and the Orionid meteor shower peaks. Resolved numerically below. */
    let halleyNodeLon = 2.2;
    {
      const orbitGroup = new THREE.Group();
      orbitGroup.rotation.x = THREE.MathUtils.degToRad(HALLEY_ORBIT.inclDeg);
      orbitGroup.rotation.y = 2.2; // ascending-node variety
      scene.add(orbitGroup);

      // dashed elliptical path (E-parameterized, Sun at the focus)
      const seg = 360;
      const aVis = HALLEY_ORBIT.aVis;
      const eVis = HALLEY_ORBIT.eVis;
      const bVis = aVis * Math.sqrt(1 - eVis * eVis);
      const linePos = new Float32Array(seg * 3);
      for (let i = 0; i < seg; i++) {
        const E = (i / seg) * TAU;
        linePos[i * 3] = Math.cos(E) * aVis - aVis * eVis;
        linePos[i * 3 + 2] = -Math.sin(E) * bVis; // mirrored z → retrograde sense
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
      const lineMat = new THREE.LineDashedMaterial({
        color: 0x7fd6e8,
        transparent: true,
        opacity: 0.26,
        dashSize: 2.4,
        gapSize: 2.2,
      });
      const cometOrbitLine = new THREE.Line(lineGeo, lineMat);
      cometOrbitLine.computeLineDistances();
      cometOrbitLine.visible = orbitsVisibleRef.current;
      cometOrbitLine.matrixAutoUpdate = false; // static ellipse — bake the matrix once
      cometOrbitLine.updateMatrix();
      orbitGroup.add(cometOrbitLine);
      orbitLinesRef.current.push(cometOrbitLine);
      disposables.push(lineGeo, lineMat);

      // nucleus: tiny tumbling dark iceberg
      const system = new THREE.Group();
      orbitGroup.add(system);
      const material = new THREE.MeshStandardMaterial({
        color: 0xb8ad9c,
        roughness: 1,
        metalness: 0,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), material);
      system.add(mesh);
      disposables.push(mesh.geometry, material);

      // coma: cyan-white halo that swells with activity
      const comaTex = getGlowTexture(
        'comet-coma',
        128,
        'rgba(224,246,255,0.95)',
        'rgba(127,214,232,0.30)',
        'rgba(127,214,232,0)'
      );
      const comaMat = new THREE.SpriteMaterial({
        map: comaTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.9,
      });
      const coma = new THREE.Sprite(comaMat);
      coma.scale.setScalar(2.2);
      system.add(coma);
      disposables.push(comaMat);

      // world-space tail ribbons (scene root, rebuilt every frame)
      const ionGeo = makeTailGeometry();
      const ionMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ionMesh = new THREE.Mesh(ionGeo, ionMat);
      ionMesh.frustumCulled = false;
      ionMesh.renderOrder = 2;
      scene.add(ionMesh);

      const dustGeo = makeTailGeometry();
      const dustMat = ionMat.clone();
      const dustMesh = new THREE.Mesh(dustGeo, dustMat);
      dustMesh.frustumCulled = false;
      dustMesh.renderOrder = 2;
      scene.add(dustMesh);
      disposables.push(ionGeo, ionMat, dustGeo, dustMat);

      const hit = buildHitProxy(2.6, 'halley');
      system.add(hit);
      hitMeshes.push(hit);

      // world-space orbit-plane normal (group only rotates)
      orbitGroup.updateWorldMatrix(true, false);
      const orbitNormal = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(orbitGroup.quaternion)
        .normalize();

      // F22 — find the orbit's ecliptic crossing (world y = 0) → debris-node longitude
      {
        const m = orbitGroup.matrixWorld;
        const p = new THREE.Vector3();
        let prevX = 0;
        let prevY = 0;
        let prevZ = 0;
        for (let i = 0; i <= 360; i++) {
          const E = (i / 360) * TAU;
          p.set(Math.cos(E) * aVis - aVis * eVis, 0, -Math.sin(E) * bVis).applyMatrix4(m);
          if (i > 0 && prevY * p.y < 0) {
            const t = prevY / (prevY - p.y);
            halleyNodeLon = Math.atan2(
              prevZ + (p.z - prevZ) * t,
              prevX + (p.x - prevX) * t
            );
            break;
          }
          prevX = p.x;
          prevY = p.y;
          prevZ = p.z;
        }
      }

      cometRef.current = {
        info: HALLEY_INFO,
        system,
        mesh,
        material,
        coma,
        orbitNormal,
        ionGeo,
        ionMesh,
        dustGeo,
        dustMesh,
      };
    }

    /* F26 — pre-compute the simTime of the next Orionid peak & Halley perihelion */
    const COMET_PERIOD_S = HALLEY_ORBIT.periodYears * SECONDS_PER_EARTH_YEAR;
    const refreshScienceTargets = (fromSim: number) => {
      const earth = nodes[2];
      const t0 = (halleyNodeLon - earth.angle0) / earth.angSpeed;
      const lap = TAU / earth.angSpeed;
      orionidPeakSimRef.current = t0 + Math.max(0, Math.ceil((fromSim - t0) / lap - 1e-9)) * lap;
      const peri0 = (-HALLEY_ORBIT.m0 / TAU) * COMET_PERIOD_S;
      halleyPeriSimRef.current =
        peri0 + Math.max(0, Math.ceil((fromSim - peri0) / COMET_PERIOD_S - 1e-9)) * COMET_PERIOD_S;
    };
    refreshScienceTargets(dateMsToSimTime(Date.now()));

    /* -------- F22 — Orionid meteor shower: pooled LineSegments on the sky -------- */
    const meteorGeo = new THREE.BufferGeometry();
    const meteorPos = new Float32Array(METEOR_MAX * 2 * 3);
    const meteorCol = new Float32Array(METEOR_MAX * 2 * 3);
    meteorGeo.setAttribute('position', new THREE.BufferAttribute(meteorPos, 3));
    meteorGeo.setAttribute('color', new THREE.BufferAttribute(meteorCol, 3));
    const meteorMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const meteorLines = new THREE.LineSegments(meteorGeo, meteorMat);
    meteorLines.frustumCulled = false;
    meteorLines.renderOrder = 3;
    meteorLines.visible = meteorsVisibleRef.current;
    meteorLines.matrixAutoUpdate = false; // streaks move via the position attribute, not the matrix
    meteorLines.updateMatrix();
    scene.add(meteorLines);
    disposables.push(meteorGeo, meteorMat);

    // radiant: the center of Orion (CONSTELLATIONS[1]) on the tilted sky dome
    const orionCenter = CONSTELLATIONS[1].stars.reduce(
      (acc, s) => [acc[0] + s[0] / CONSTELLATIONS[1].stars.length, acc[1] + s[1] / CONSTELLATIONS[1].stars.length] as [number, number],
      [0, 0] as [number, number]
    );
    const radiant = radecToVec3(orionCenter[0], orionCenter[1], 1)
      .applyQuaternion(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.55, 0, 'XYZ'))
      )
      .normalize();

    // meteor pool — allocated once, recycled forever (zero per-frame allocation)
    const meteors: MeteorState[] = [];
    for (let i = 0; i < METEOR_MAX; i++) {
      meteors.push({
        alive: false,
        pos: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        speed: 0,
        age: 0,
        life: 1,
        len: 20,
        warm: false,
      });
    }
    // collapse all dead streaks to a point so their line segment is invisible
    meteorPos.fill(0);

    let meteorSpawnAcc = 0;
    let meteorDtCarry = 0; // wall-clock dt accumulated on interleaved-off frames
    const meteorTangent = new THREE.Vector3();

    const spawnMeteor = () => {
      const m = meteors.find((x) => !x.alive);
      if (!m) return;
      // random point inside the radiant cone on the sky sphere
      m.dir.copy(radiant);
      m.dir.x += (Math.random() - 0.5) * 2 * Math.sin(METEOR_CONE) * 0.55;
      m.dir.y += (Math.random() - 0.5) * 2 * Math.sin(METEOR_CONE) * 0.55;
      m.dir.z += (Math.random() - 0.5) * 2 * Math.sin(METEOR_CONE) * 0.55;
      m.dir.normalize();
      m.pos
        .copy(m.dir)
        .multiplyScalar(METEOR_SKY_R + Math.random() * 90);
      // fly along the great circle away from the radiant (plus slight jitter)
      meteorTangent
        .copy(m.pos)
        .addScaledVector(radiant, -m.pos.dot(radiant));
      if (meteorTangent.lengthSq() < 1e-4) meteorTangent.set(0, 1, 0);
      meteorTangent.normalize();
      m.dir.copy(meteorTangent);
      m.dir.x += (Math.random() - 0.5) * 0.22;
      m.dir.y += (Math.random() - 0.5) * 0.22;
      m.dir.z += (Math.random() - 0.5) * 0.22;
      if (m.dir.lengthSq() < 1e-6) m.dir.set(0, 1, 0);
      m.dir.normalize();
      m.speed = 90 + Math.random() * 80;
      m.len = 22 + Math.random() * 34;
      m.life = 0.9 + Math.random() * 0.8;
      m.age = 0;
      m.warm = Math.random() < 0.22;
      m.alive = true;
    };

    /* -------- screenshot capture registration (F3) -------- */
    registerCapturer(() => {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    });

    /* Esc — close any open card (releases the follow camera, like the zodiac scene) */
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      closeInfoRef.current();
      closeConRef.current();
    };
    window.addEventListener('keydown', onEsc);

    /* ------------------------------ interaction ------------------------------ */
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 16 };
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let downT = 0;
    let isDown = false;

    const pickBody = (ev: PointerEvent): BodyInfo | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(hitMeshes, false);
      if (hits.length === 0) return null;
      const id = hits[0].object.userData.bodyId as string;
      if (id === 'sun') return SUN_INFO;
      if (id === 'halley') return HALLEY_INFO;
      return nodes.find((n) => n.info.id === id)?.info ?? null;
    };

    /** F15 — constellation hit test: name sprites + generous node-star threshold. */
    const pickConstellation = (ev: PointerEvent): number => {
      if (!constellationsVisibleRef.current) return -1;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const spriteHits = raycaster.intersectObjects(constellationHitSpritesRef.current, false);
      if (spriteHits.length > 0) {
        return (spriteHits[0].object.userData.constellationIndex as number) ?? -1;
      }
      const pointHits = raycaster.intersectObjects(constellationHitPointsRef.current, false);
      if (pointHits.length > 0) {
        return (pointHits[0].object.userData.constellationIndex as number) ?? -1;
      }
      return -1;
    };

    const showTip = (ev: PointerEvent, text: string) => {
      const tip = tooltipRef.current;
      if (!tip) return;
      tip.classList.remove('hidden');
      tip.textContent = text;
      const rect = wrap.getBoundingClientRect();
      tip.style.left = `${ev.clientX - rect.left + 14}px`;
      tip.style.top = `${ev.clientY - rect.top - 10}px`;
    };

    const hideTip = () => {
      tooltipRef.current?.classList.add('hidden');
    };

    const onPointerDown = (ev: PointerEvent) => {
      isDown = true;
      downX = ev.clientX;
      downY = ev.clientY;
      downT = performance.now();
    };

    // hover raycasts (2 per move event) run at most every 100 ms; clicks on
    // pointerup always raycast at full precision regardless of this throttle
    let lastHoverT = 0;
    const onPointerMove = (ev: PointerEvent) => {
      if (isDown) return;
      const nowT = performance.now();
      if (nowT - lastHoverT < 100) return;
      lastHoverT = nowT;
      const el = renderer.domElement;
      const conIdx = pickConstellation(ev);
      if (conIdx >= 0) {
        el.style.cursor = 'pointer';
        showTip(
          ev,
          getLang() === 'en'
            ? `${CONSTELLATIONS[conIdx].nameEn} · Click to open its card`
            : `${CONSTELLATIONS[conIdx].name} · 点击查看档案`
        );
        return;
      }
      const body = pickBody(ev);
      if (body) {
        el.style.cursor = 'pointer';
        showTip(ev, getLang() === 'en' ? body.en : `${body.name} · ${body.en}`);
      } else {
        el.style.cursor = 'grab';
        hideTip();
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (!isDown) return;
      isDown = false;
      const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY);
      const quick = performance.now() - downT < 400;
      if (moved < 6 && quick) {
        // constellations take priority; body and constellation cards are mutually exclusive
        const conIdx = pickConstellation(ev);
        if (conIdx >= 0) {
          cardOriginRef.current.x = downX; // open from the actual tap point
          cardOriginRef.current.y = downY;
          openConRef.current(conIdx); // old card collapses out while the new one opens
          conFlightRef.current = conIdx; // F38 — in-canvas constellation click also flies the camera there
          playEventSound('click'); // F23
          renderer.domElement.style.cursor = 'pointer';
          return;
        }
        const body = pickBody(ev);
        if (body) {
          cardOriginRef.current.x = downX;
          cardOriginRef.current.y = downY;
          openBodyRef.current(body);
          playEventSound('click'); // F23
        } else {
          closeInfoRef.current();
          closeConRef.current();
          hideTip();
        }
        renderer.domElement.style.cursor = body ? 'pointer' : 'grab';
      }
    };

    const onPointerLeave = () => {
      tooltipRef.current?.classList.add('hidden');
    };

    const el = renderer.domElement;
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointerleave', onPointerLeave);

    /* ------------------------------ resize ------------------------------ */
    const onResize = () => {
      const w = wrap.clientWidth;
      const h = Math.max(1, wrap.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(wrap);

    const unsubQuality = onRenderScaleChange(() => {
      applyRenderScale();
      onResize();
    });
    const unsubDpr = onDprCapChange(() => {
      applyRenderScale();
      onResize();
    });

    /* ------------------------------ loop ------------------------------ */
    const clock = new THREE.Clock();
    // F26 — start at *today*: the scene opens on the real current sky
    let simTime = dateMsToSimTime(Date.now());
    let raf = 0;
    const fps = createFpsMeter();
    const tmp = nodes; // local alias
    const tmpV = new THREE.Vector3();
    const labelTargets: THREE.Object3D[] = [sunGroup, ...nodes.map((n) => n.system)];
    if (cometRef.current) labelTargets.push(cometRef.current.system);
    const placedLabels: { sx: number; sy: number }[] = [];

    /* F26 — calendar display (written straight to the DOM, throttled) */
    const dateFmtZh = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const dateFmtEn = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
    let dateFrame = 0;
    // F41 — parity for the interleaved belt/trail buffer updates (see animate)
    let frameParity = 0;

    /* F29 — planetary-alignment detector: sliding window over TRUE ecliptic
       longitudes (F33: solved from the same Kepler geometry as the visuals).
       O(N²) over 8 planets, run every ~0.5 s; zero allocation. */
    const ALIGN_SPAN = THREE.MathUtils.degToRad(45);
    const alignAngles = new Float64Array(PLANETS.length);
    const alignMembers: number[] = [];
    let alignT = 0.5; // fire on the first frame too
    const checkAlignment = () => {
      alignT = 0;
      const n = PLANETS.length;
      for (let i = 0; i < n; i++) {
        const p = tmp[i];
        const M = p.angle0 + simTime * p.angSpeed - p.periRad;
        keplerTrueAnomaly(M, p.ecc, KEPLER_OUT);
        const u = p.omegaRad + KEPLER_OUT.nu;
        // true ecliptic longitude: node + projected in-plane angle
        alignAngles[i] =
          (p.nodeRad + Math.atan2(Math.sin(u) * Math.cos(p.inclRad), Math.cos(u))) % TAU;
      }
      // directed window: count planets within [a_i, a_i + SPAN]
      let bestCount = 0;
      let bestIdx = 0;
      for (let i = 0; i < n; i++) {
        let c = 0;
        for (let j = 0; j < n; j++) {
          let d = alignAngles[j] - alignAngles[i];
          if (d < 0) d += TAU;
          if (d <= ALIGN_SPAN) c++;
        }
        if (c > bestCount) {
          bestCount = c;
          bestIdx = i;
        }
      }
      const el = alignRef.current;
      if (!el) return;
      if (bestCount >= 4) {
        alignMembers.length = 0;
        const memberOffsets: { i: number; d: number }[] = [];
        let spanDeg = 0;
        for (let j = 0; j < n; j++) {
          let d = alignAngles[j] - alignAngles[bestIdx];
          if (d < 0) d += TAU;
          if (d <= ALIGN_SPAN) {
            memberOffsets.push({ i: j, d });
            if (d > spanDeg) spanDeg = d;
          }
        }
        memberOffsets.sort((a, b) => a.d - b.d); // list members along the ecliptic
        for (const m of memberOffsets) alignMembers.push(m.i);
        const isEn = getLang() === 'en';
        const names = alignMembers
          .map((i) => (isEn ? PLANETS[i].en : PLANETS[i].name))
          .join('·');
        const prefix = bestCount >= 5
          ? isEn ? '✦ Five-planet alignment' : '✦ 五星连珠'
          : isEn ? 'Four-planet grouping' : '四星聚拢';
        const spanDegDisplay = Math.round(THREE.MathUtils.radToDeg(spanDeg));
        el.textContent = isEn
          ? `${prefix} · ${names} within ${spanDegDisplay}° of ecliptic longitude`
          : `${prefix} · ${names} 聚于 ${spanDegDisplay}° 黄经`;
        el.style.opacity = '1';
      } else {
        el.style.opacity = '0';
      }
    };

    /* Halley per-frame scratch (zero allocation in the loop) */
    const cometSpinSpeed = (TAU / SECONDS_PER_EARTH_SPIN) * (0.997 / 2.2);
    const cometWorld = new THREE.Vector3();
    const cometDir = new THREE.Vector3();
    const cometToCam = new THREE.Vector3();
    const cometSide = new THREE.Vector3();
    const cometCurve = new THREE.Vector3();
    const cometIonColor = new THREE.Color(0.5, 0.88, 1.0);
    const cometDustColor = new THREE.Color(1.0, 0.9, 0.72);

    /* F25 — constellation quick-locate camera flight (ref-bridged, like F13) */
    const flightFrom = new THREE.Vector3();
    const flightTo = new THREE.Vector3();
    const flightFromTgt = new THREE.Vector3();
    const flightToTgt = new THREE.Vector3();
    let flightT = 1; // 1 = idle
    const cancelFlight = () => {
      if (flightT < 1) {
        flightT = 1;
        controls.enabled = true;
      }
    };
    el.addEventListener('pointerdown', cancelFlight);
    el.addEventListener('wheel', cancelFlight, { passive: true });

    /* F38 — click-to-focus: fly the camera to the selected body, then keep
       tracking it (the card opens at the same time; deselection releases). */
    let focusId: string | null = null; // mirrors selectedIdRef, change-detected per frame
    let focusFlying = false;
    let followActive = false;
    let focusT = 0;
    let focusDist = 10;
    const focusFrom = new THREE.Vector3();
    const focusFromTgt = new THREE.Vector3();
    const focusPos = new THREE.Vector3();
    const focusPrev = new THREE.Vector3();
    const focusDir = new THREE.Vector3();
    const focusCamTo = new THREE.Vector3();

    const bodySizeOf = (id: string): number => {
      if (id === 'sun') return 4.6;
      if (id === 'halley') return 0.9; // frame the coma generously
      return SCENE_LAYOUT[id]?.size ?? 1.2;
    };

    const getBodyWorldPos = (id: string, out: THREE.Vector3): boolean => {
      if (id === 'sun') {
        sunGroup.getWorldPosition(out);
        return true;
      }
      if (id === 'halley') {
        const c = cometRef.current;
        if (!c) return false;
        c.system.getWorldPosition(out);
        return true;
      }
      const n = nodes.find((x) => x.info.id === id);
      if (!n) return false;
      n.system.getWorldPosition(out);
      return true;
    };

    const endFocusFlight = () => {
      focusFlying = false;
      followActive = true;
      focusPrev.copy(focusPos);
      controls.enabled = true;
    };

    /** snap-finish instead of hard cancel: no jump, the user orbits immediately */
    const cancelFocusFlight = () => {
      if (focusFlying) endFocusFlight();
    };
    el.addEventListener('pointerdown', cancelFocusFlight);
    el.addEventListener('wheel', cancelFocusFlight, { passive: true });

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);

      // F26 — a calendar jump resets the epoch directly
      if (simJumpRef.current !== null) {
        simTime = simJumpRef.current;
        simJumpRef.current = null;
        refreshScienceTargets(simTime);
      }
      // F36 — live lock pins the simulation to the real clock (1 s = 1 s):
      // the date read-out shows today and planets sit at their true positions.
      if (liveLockRef.current) {
        simTime = dateMsToSimTime(Date.now());
      } else {
        simTime += dt * speedRef.current;
      }
      simTimeRef.current = simTime;

      // F26 — calendar read-out (~4 Hz, straight DOM write)
      if (++dateFrame >= 15) {
        dateFrame = 0;
        const el2 = dateTextRef.current;
        if (el2)
          el2.textContent = (getLang() === 'en' ? dateFmtEn : dateFmtZh).format(
            new Date(simTimeToDateMs(simTime))
          );
      }

      // F29 — alignment detector (~2 Hz)
      alignT += dt;
      if (alignT >= 0.5) checkAlignment();

      sunMesh.rotation.y = simTime * sunSpinSpeed;

      for (let i = 0; i < tmp.length; i++) {
        const n = tmp[i];
        // F33 — Kepler's equation: mean anomaly → true anomaly, sun at focus.
        // (The flat circular model placed planets at the MEAN longitude; the
        // elliptical solution yields the TRUE longitude, matching the ephemeris.)
        const M = n.angle0 + simTime * n.angSpeed - n.periRad;
        keplerTrueAnomaly(M, n.ecc, KEPLER_OUT);
        const r = n.aVis * KEPLER_OUT.rFactor;
        const u = n.omegaRad + KEPLER_OUT.nu;
        n.system.position.set(Math.cos(u) * r, 0, Math.sin(u) * r);
        n.mesh.rotation.y = simTime * n.spinSpeed + i * 2.1;
        if (n.moonPivot) n.moonPivot.rotation.y = simTime * moonAngSpeed;
      }

      // belts: Keplerian differential rotation (inner grains lap outer ones)
      // F41 — belt + trail rewrites are the heaviest CPU work in the loop
      // (BufferAttribute uploads + Newton solves); they interleave on even/odd
      // frames so each runs at ~half rate with no visible difference.
      frameParity ^= 1;
      if (frameParity === 0) {
        for (let bi = 0; bi < belts.length; bi++) {
          const b = belts[bi];
          const arr = b.geo.attributes.position.array as Float32Array;
          for (let i = 0; i < b.count; i++) {
            const a = b.angle0[i] + simTime * b.angSpeed[i];
            arr[i * 3] = Math.cos(a) * b.r[i];
            arr[i * 3 + 1] = b.y[i];
            arr[i * 3 + 2] = Math.sin(a) * b.r[i];
          }
          b.geo.attributes.position.needsUpdate = true;
        }
      }

      // trails: gradient arc trailing each planet along its true ellipse (F10/F33)
      if (trailsVisibleRef.current && frameParity === 1) {
        for (let i = 0; i < tmp.length; i++) {
          const tr = trails[i];
          if (!tr) continue;
          const n = tmp[i];
          const Mh = n.angle0 + simTime * n.angSpeed - n.periRad;
          const arr = tr.geo.attributes.position.array as Float32Array;
          for (let k = 0; k < TRAIL_POINTS; k++) {
            const f = k / (TRAIL_POINTS - 1); // 0 = tail → 1 = head
            // sample by mean anomaly: equal-time spacing keeps the trail
            // physically behind the planet at any eccentricity
            const Mk = Mh - tr.mSpan * (1 - f);
            keplerTrueAnomaly(Mk, n.ecc, KEPLER_OUT);
            const r = n.aVis * KEPLER_OUT.rFactor;
            const u = n.omegaRad + KEPLER_OUT.nu;
            arr[k * 3] = Math.cos(u) * r;
            arr[k * 3 + 1] = 0.14;
            arr[k * 3 + 2] = Math.sin(u) * r;
          }
          tr.geo.attributes.position.needsUpdate = true;
        }
      }

      // Halley: solve Kepler's equation for elliptical motion (F17)
      const comet = cometRef.current;
      if (comet) {
        const M = HALLEY_ORBIT.m0 + (simTime / COMET_PERIOD_S) * TAU;
        let E = M + HALLEY_ORBIT.eVis * Math.sin(M);
        for (let it = 0; it < 8; it++) {
          E -= (E - HALLEY_ORBIT.eVis * Math.sin(E) - M) / (1 - HALLEY_ORBIT.eVis * Math.cos(E));
        }
        if (!Number.isFinite(E)) E = M;
        const cosE = Math.cos(E);
        const sinE = Math.sin(E);
        const rC = HALLEY_ORBIT.aVis * (1 - HALLEY_ORBIT.eVis * cosE);
        const ang = Math.atan2(
          -HALLEY_ORBIT.aVis * Math.sqrt(1 - HALLEY_ORBIT.eVis ** 2) * sinE,
          HALLEY_ORBIT.aVis * (cosE - HALLEY_ORBIT.eVis)
        );
        comet.system.position.set(Math.cos(ang) * rC, 0, Math.sin(ang) * rC);
        comet.mesh.rotation.y = simTime * cometSpinSpeed;
        comet.mesh.rotation.x = Math.sin(simTime * 0.21) * 0.5; // tumbling

        // outgassing activity rises sharply near perihelion
        const activity = THREE.MathUtils.clamp(
          (HALLEY_ORBIT.fadeR - rC) / (HALLEY_ORBIT.fadeR - HALLEY_ORBIT.fullR),
          0.05,
          1
        );
        comet.system.getWorldPosition(cometWorld);
        comet.coma.scale.setScalar(1.1 + activity * 2.1);
        (comet.coma.material as THREE.SpriteMaterial).opacity = 0.35 + activity * 0.6;

        // ribbons stretch anti-sunward; ion straight, dust broad + curved
        cometDir.copy(cometWorld).normalize();
        cometToCam.copy(camera.position).sub(cometWorld);
        cometSide.crossVectors(cometDir, cometToCam);
        if (cometSide.lengthSq() < 1e-6) cometSide.set(0, 1, 0);
        else cometSide.normalize();
        cometCurve.crossVectors(comet.orbitNormal, cometDir).normalize();
        updateTail(
          comet.ionGeo,
          cometWorld,
          cometDir,
          cometSide,
          cometCurve,
          30 * activity,
          0.16,
          1.7,
          0,
          cometIonColor,
          activity
        );
        updateTail(
          comet.dustGeo,
          cometWorld,
          cometDir,
          cometSide,
          cometCurve,
          22 * activity,
          0.3,
          3.4,
          7.5 * activity,
          cometDustColor,
          activity
        );
      }

      // constellation highlight lerp (F15): selected one brightens, others stay dim
      const selConIdx = selConIdxRef.current;
      const conVis = constellationVisRef.current;
      for (let i = 0; i < conVis.length; i++) {
        const v = conVis[i];
        const lit = constellationsVisibleRef.current && selConIdx === i;
        const target = lit ? CONSTELLATION_LIT : CONSTELLATION_DIM;
        v.lineMat.opacity += (target.line - v.lineMat.opacity) * 0.12;
        v.pointsMat.opacity += (target.points - v.pointsMat.opacity) * 0.12;
        v.pointsMat.size += (target.size - v.pointsMat.size) * 0.12;
        v.nameMat.opacity += (target.name - v.nameMat.opacity) * 0.12;
      }

      // F24 — compensate constellation name sprites so they stay readable
      // when the user zooms far out (sprites shrink linearly with distance)
      const camDist = camera.position.length();
      const sprF = THREE.MathUtils.clamp(camDist / 240, 0.8, 2.6);
      const conSprites = constellationHitSpritesRef.current;
      for (let i = 0; i < conSprites.length; i++) {
        conSprites[i].scale.set(84 * sprF, 21 * sprF, 1);
      }

      // F22 — Orionid meteor shower: intensity peaks while the Earth sweeps
      // past Halley's debris-node longitude (wall-clock burst on toggle-on)
      meteorLines.visible = meteorsVisibleRef.current;
      if (meteorsVisibleRef.current) {
        // Pool update interleaved every other frame (frameParity): wall-clock
        // dt accumulates on skipped frames, so streak speed and spawn rate
        // stay identical to a per-frame update at half the CPU cost.
        meteorDtCarry += dt;
        if (frameParity === 0) {
          const mdt = meteorDtCarry;
          meteorDtCarry = 0;
          let intensity = 0;
          const earth = tmp[2]; // PLANETS[2] = Earth
          // F33 — compare TRUE longitudes (same geometry as the visuals)
          const Mea = earth.angle0 + simTime * earth.angSpeed - earth.periRad;
          keplerTrueAnomaly(Mea, earth.ecc, KEPLER_OUT);
          const uea = earth.omegaRad + KEPLER_OUT.nu;
          const ea =
            earth.nodeRad + Math.atan2(Math.sin(uea) * Math.cos(earth.inclRad), Math.cos(uea));
          let dLon = ea - halleyNodeLon;
          dLon = ((dLon + Math.PI) % TAU + TAU) % TAU - Math.PI; // wrap to [-π, π]
          intensity = Math.exp(-(dLon * dLon) / (2 * METEOR_SIGMA * METEOR_SIGMA));
          if (performance.now() < meteorBurstUntilRef.current) intensity = Math.max(intensity, 0.9);

          meteorSpawnAcc += mdt * (1.4 + 30 * intensity);
          while (meteorSpawnAcc >= 1) {
            meteorSpawnAcc -= 1;
            spawnMeteor();
          }

          // advance streaks (wall-clock: meteors are transient sky events)
          for (let i = 0; i < METEOR_MAX; i++) {
            const m = meteors[i];
            const o = i * 6;
            if (!m.alive) {
              meteorCol[o] = 0;
              meteorCol[o + 1] = 0;
              meteorCol[o + 2] = 0;
              meteorCol[o + 3] = 0;
              meteorCol[o + 4] = 0;
              meteorCol[o + 5] = 0;
              continue;
            }
            m.age += mdt;
            if (m.age >= m.life) {
              m.alive = false;
              meteorCol[o] = 0;
              meteorCol[o + 1] = 0;
              meteorCol[o + 2] = 0;
              meteorCol[o + 3] = 0;
              meteorCol[o + 4] = 0;
              meteorCol[o + 5] = 0;
              continue;
            }
            const f = m.age / m.life;
            const alpha = (1 - f) * (1 - f);
            const grow = Math.min(m.age * 3, 1); // tail stretches in quickly
            const hx = m.pos.x + m.dir.x * m.speed * m.age;
            const hy = m.pos.y + m.dir.y * m.speed * m.age;
            const hz = m.pos.z + m.dir.z * m.speed * m.age;
            meteorPos[o] = hx;
            meteorPos[o + 1] = hy;
            meteorPos[o + 2] = hz;
            meteorPos[o + 3] = hx - m.dir.x * m.len * grow;
            meteorPos[o + 4] = hy - m.dir.y * m.len * grow;
            meteorPos[o + 5] = hz - m.dir.z * m.len * grow;
            const hr = m.warm ? 1.0 : 0.78;
            const hg = m.warm ? 0.86 : 0.9;
            const hb = m.warm ? 0.62 : 1.0;
            meteorCol[o] = hr * alpha;
            meteorCol[o + 1] = hg * alpha;
            meteorCol[o + 2] = hb * alpha;
            meteorCol[o + 3] = hr * alpha * 0.18;
            meteorCol[o + 4] = hg * alpha * 0.18;
            meteorCol[o + 5] = hb * alpha * 0.28;
          }
          meteorGeo.attributes.position.needsUpdate = true;
          meteorGeo.attributes.color.needsUpdate = true;

          // live activity line under the switch (direct DOM write, no re-render)
          const status = meteorStatusRef.current;
          if (status) {
            const en = getLang() === 'en';
            status.textContent =
              intensity > 0.5
                ? en
                  ? "☄ Peak activity · Earth is crossing Halley's orbit"
                  : '☄ 极大期 · 地球正穿越哈雷彗星轨道'
                : intensity > 0.12
                  ? en
                    ? "Increased activity · nearing Halley's orbital node"
                    : '活动增强 · 接近哈雷轨道节点'
                  : en
                    ? 'Sporadic meteors · waiting for Earth to reach the node'
                    : '零星背景流星 · 等待地球抵达节点';
          }
        }
      }

      // projected DOM labels (direct style writes, no React renders)
      // with greedy screen-space de-overlap (F9)
      // Throttled to every other frame (frameParity): projection + style writes
      // are pure CPU, and a 30 Hz label refresh is visually indistinguishable.
      // The whole block — projection, de-overlap, transform — stays in one
      // batch so avoidance always sees a consistent set of positions.
      if (labelsVisibleRef.current && frameParity === 0) {
        const w = wrap.clientWidth;
        const h = Math.max(1, wrap.clientHeight);
        placedLabels.length = 0;
        for (let i = 0; i < labelTargets.length; i++) {
          const el = labelRefs.current[i];
          if (!el) continue;
          labelTargets[i].getWorldPosition(tmpV);
          tmpV.project(camera);
          if (tmpV.z > 1 || tmpV.z < -1) {
            el.style.display = 'none';
            continue;
          }
          const sx = (tmpV.x * 0.5 + 0.5) * w;
          let sy = (-tmpV.y * 0.5 + 0.5) * h;
          for (let p = 0; p < placedLabels.length; p++) {
            const other = placedLabels[p];
            if (Math.abs(other.sx - sx) < 76 && Math.abs(other.sy - sy) < 20) {
              sy = other.sy - 21;
            }
          }
          // viewport-edge clamp: keep labels clear of the top nav & screen edges
          const cx = Math.min(Math.max(sx, 28), w - 28);
          const cy = Math.min(Math.max(sy, 64), h - 24);
          el.style.display = 'block';
          el.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) translate(-50%, -160%)`;
          placedLabels.push({ sx, sy });
        }
      }

      // F38 — focus state machine: watch selection changes (bridge via selectedIdRef)
      if (selectedIdRef.current !== focusId) {
        focusId = selectedIdRef.current;
        if (focusId) {
          if (getBodyWorldPos(focusId, focusPos)) {
            focusFlying = true;
            followActive = false;
            focusT = 0;
            focusDist = Math.max(bodySizeOf(focusId) * 5.4 + 3.2, 7.5);
            focusFrom.copy(camera.position);
            focusFromTgt.copy(controls.target);
            controls.enabled = false;
            // close-ups for small bodies; the sun keeps its old floor
            controls.minDistance = focusId === 'sun' ? 8 : 3.2;
          }
        } else {
          focusFlying = false;
          followActive = false;
          controls.minDistance = 8;
        }
      }
      if (focusFlying && focusId) {
        if (!getBodyWorldPos(focusId, focusPos)) {
          focusFlying = false; // body vanished — release control gracefully
          controls.enabled = true;
        } else {
          focusT = Math.min(1, focusT + dt / 1.5);
          const s =
            focusT < 0.5 ? 4 * focusT * focusT * focusT : 1 - Math.pow(-2 * focusT + 2, 3) / 2;
          focusDir.copy(focusFrom).sub(focusPos).normalize();
          focusCamTo.copy(focusPos).addScaledVector(focusDir, focusDist);
          focusCamTo.y += focusDist * 0.22; // gentle high-angle framing
          camera.position.lerpVectors(focusFrom, focusCamTo, s);
          controls.target.lerpVectors(focusFromTgt, focusPos, s);
          if (focusT >= 1) endFocusFlight();
        }
      } else if (followActive && focusId) {
        if (getBodyWorldPos(focusId, focusPos)) {
          focusDir.copy(focusPos).sub(focusPrev); // body motion since last frame
          camera.position.add(focusDir);
          controls.target.copy(focusPos);
          focusPrev.copy(focusPos);
        }
      }

      // F25 — start a requested constellation fly-to (UI → loop bridge)
      const flightReq = conFlightRef.current;
      if (flightReq !== null) {
        conFlightRef.current = null;
        const dir = constellationCentersRef.current[flightReq];
        if (dir) {
          flightFrom.copy(camera.position);
          flightFromTgt.copy(controls.target);
          flightTo.copy(dir).multiplyScalar(150);
          flightTo.y += 26;
          flightToTgt.copy(dir).multiplyScalar(320);
          flightT = 0;
          controls.enabled = false;
        }
      }
      if (flightT < 1) {
        flightT = Math.min(1, flightT + dt / 1.6);
        const s =
          flightT < 0.5 ? 4 * flightT * flightT * flightT : 1 - Math.pow(-2 * flightT + 2, 3) / 2;
        camera.position.lerpVectors(flightFrom, flightTo, s);
        controls.target.lerpVectors(flightFromTgt, flightToTgt, s);
        if (flightT >= 1) controls.enabled = true;
      }

      controls.update();
      renderer.render(scene, camera);
      fps.tick();
    };
    animate();

    /* ------------------------------ cleanup ------------------------------ */
    return () => {
      cancelAnimationFrame(raf);
      fps.dispose();
      registerCapturer(null);
      unsubQuality();
      unsubDpr();
      window.removeEventListener('keydown', onEsc);
      ro.disconnect();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('pointerdown', cancelFlight);
      el.removeEventListener('wheel', cancelFlight);
      el.removeEventListener('pointerdown', cancelFocusFlight);
      el.removeEventListener('wheel', cancelFocusFlight);
      controls.dispose();
      scene.traverse((obj) => {
        const anyObj = obj as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
        if (anyObj.geometry) anyObj.geometry.dispose();
        const m = anyObj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else if (m) m.dispose();
      });
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      if (el.parentElement === wrap) wrap.removeChild(el);
      nodesRef.current = [];
      orbitLinesRef.current = [];
      cometRef.current = null;
      disposeCachedTextures();
    };
  }, []);

  /* i18n — redraw the constellation name sprites when the language changes
     (canvas textures are baked once, so they must be rebuilt on switch) */
  useEffect(() => {
    const redrawSprites = () => {
      const vis = constellationVisRef.current;
      for (let i = 0; i < vis.length; i++) {
        const spec = CONSTELLATIONS[i];
        if (!spec) continue;
        const mat = vis[i].nameMat;
        const old = mat.map;
        mat.map = createConstellationLabelTexture(getLang() === 'en' ? spec.nameEn : spec.name);
        mat.needsUpdate = true;
        old?.dispose();
      }
    };
    const unsub = subscribeLang(redrawSprites);
    return unsub;
  }, []);

  /* ---------- F26 — calendar jump actions ---------- */

  const jumpToDateMs = (ms: number) => {
    simJumpRef.current = dateMsToSimTime(ms);
  };

  const handleJumpDate = () => {
    const ms = parseISODate(dateInput);
    if (ms === null) return;
    playEventSound('success');
    setLiveLock(false); // F36 — a manual jump leaves live mode
    jumpToDateMs(ms);
  };

  const handleGoToday = () => {
    playEventSound('click');
    setDateInput(toISODateLocal(new Date()));
    setLiveLock(true); // F36 — “回到今天” keeps tracking the real clock
    jumpToDateMs(Date.now());
  };

  const handleGoOrionidPeak = () => {
    const t = orionidPeakSimRef.current;
    if (t === null) return;
    playEventSound('success');
    const ms = simTimeToDateMs(t);
    setDateInput(toISODateLocal(new Date(ms)));
    setLiveLock(false);
    jumpToDateMs(ms);
    // let the user actually see the shower right away
    if (meteorsVisibleRef.current) {
      meteorBurstUntilRef.current = performance.now() + 9000;
    }
  };

  const handleGoHalleyPerihelion = () => {
    const t = halleyPeriSimRef.current;
    if (t === null) return;
    playEventSound('success');
    const ms = simTimeToDateMs(t);
    setDateInput(toISODateLocal(new Date(ms)));
    setLiveLock(false);
    jumpToDateMs(ms);
  };

  /* F29 — jump straight to a real recorded sky event */
  const handleSkyEvent = (iso: string) => {
    const ms = parseISODate(iso);
    if (ms === null) return;
    playEventSound('success');
    setDateInput(iso);
    setLiveLock(false);
    jumpToDateMs(ms);
  };

  /* ---------- F25 — constellation quick-locate ---------- */

  const flyToConstellation = (idx: number) => {
    playEventSound('click');
    if (!constellationsVisibleRef.current) setShowConstellations(true); // auto-open the layer
    openCon(idx); // opens the archive card on arrival (info card collapses to its origin)
  };

  const speedButtons: { v: Speed; label: string; icon: typeof Play }[] = [
    { v: 0, label: L('暂停', 'Pause'), icon: Pause },
    { v: 1, label: '1×', icon: Play },
    { v: 10, label: '10×', icon: FastForward },
  ];

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      {/* hover tooltip */}
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-30 hidden rounded-md border border-white/10 bg-black/75 px-2.5 py-1 text-xs font-medium text-zinc-100 shadow-lg shadow-black/50 backdrop-blur-md"
      />

      {/* ---------------- persistent clickable body labels (F2) ---------------- */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-20',
          !showLabels && 'hidden'
        )}
        aria-hidden={!showLabels}
      >
        {LABEL_BODIES.map((b, i) => (
          <button
            key={b.id}
            ref={(el) => {
              labelRefs.current[i] = el;
            }}
            type="button"
            onClick={(e) => {
              cardOriginRef.current = { x: e.clientX, y: e.clientY };
              openBody(b);
              playEventSound('click'); // F23
            }}
            style={{ display: 'none' }}
            className="pointer-events-auto absolute left-0 top-0 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-2 py-0.5 shadow-md shadow-black/40 backdrop-blur-md transition-colors duration-200 hover:border-amber-200/40 hover:bg-black/75 [@media(pointer:coarse)]:px-2.5 [@media(pointer:coarse)]:py-1.5"
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: b.accent }} aria-hidden />
            <span className="text-[10px] font-medium tracking-[0.14em] text-zinc-200">{L(b.name, b.nameEn)}</span>
          </button>
        ))}
      </div>

      {/* ---------------- bottom-left control panel ---------------- */}
      <div ref={panelRef} className="universe-scroll absolute bottom-[calc(5rem+var(--ui-safe-bottom))] left-4 z-30 max-h-[calc(100dvh-140px)] w-60 overflow-y-auto rounded-2xl border border-white/10 bg-black/45 p-4 shadow-xl shadow-black/40 backdrop-blur-xl portrait:left-3 portrait:max-h-[calc(100dvh-200px)]">
        {/* panel header — collapse into a floating orb (small screens) */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] text-zinc-500">
            <OrbitIcon className="h-3 w-3" aria-hidden /> {L('太阳系控制台', 'Solar system controls')}
          </div>
          <button
            type="button"
            onClick={(e) => collapsePanel(e.clientX, e.clientY)}
            aria-label={L('收起控制面板', 'Collapse controls')}
            title={L('收起控制面板', 'Collapse controls')}
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
          >
            <PanelLeftClose className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {/* F26 — simulated calendar / ephemeris */}
        <div className="mb-4 border-b border-white/5 pb-3">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] text-zinc-500">
            <CalendarDays className="h-3 w-3" aria-hidden /> {L('模拟日期', 'Simulation date')}
          </div>
          <div
            ref={dateTextRef}
            className="text-lg font-semibold leading-tight tracking-wide text-amber-100 tabular-nums"
          >
            —
          </div>
          <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
            {L(
              '行星按 J2000 轨道要素（椭圆 · 升交点）推算 · 彗星为观赏压缩周期',
              'Planets computed from J2000 orbital elements (ellipse · ascending node) · comet period compressed for viewing'
            )}
          </p>
          <div className="mt-2 flex gap-1.5">
            <input
              type="date"
              value={dateInput}
              min="1900-01-01"
              max="2100-12-31"
              onChange={(e) => setDateInput(e.target.value)}
              aria-label={L('选择目标日期', 'Pick target date')}
              className="min-h-[30px] min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 text-[11px] text-zinc-200 outline-none transition-colors focus:border-amber-200/40 [color-scheme:dark]"
            />
            <button
              type="button"
              onClick={handleJumpDate}
              className="flex min-h-[30px] items-center rounded-lg border border-amber-200/25 bg-amber-200/10 px-2.5 text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-200/20 [@media(pointer:coarse)]:min-h-[36px]"
            >
              {L('跳转', 'Jump')}
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={handleGoToday}
              className="rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] text-zinc-300 transition-colors hover:border-amber-200/40 hover:text-amber-200 [@media(pointer:coarse)]:py-1"
            >
              {L('回到今天', 'Today')}
            </button>
            <button
              type="button"
              onClick={handleGoOrionidPeak}
              title={L(
                '跳到地球穿越哈雷碎片流的日子（猎户座流星雨极大）',
                "Jump to the day Earth crosses Halley's debris stream (Orionid peak)"
              )}
              className="flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] text-zinc-300 transition-colors hover:border-amber-200/40 hover:text-amber-200 [@media(pointer:coarse)]:py-1"
            >
              <Zap className="h-2.5 w-2.5 text-amber-300/80" aria-hidden /> {L('流星雨极大', 'Meteor peak')}
            </button>
            <button
              type="button"
              onClick={handleGoHalleyPerihelion}
              title={L('跳到哈雷彗星下一次通过近日点', "Jump to Halley's next perihelion passage")}
              className="flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] text-zinc-300 transition-colors hover:border-sky-300/40 hover:text-sky-200 [@media(pointer:coarse)]:py-1"
            >
              <OrbitIcon className="h-2.5 w-2.5 text-sky-300/80" aria-hidden /> {L('哈雷近日点', 'Halley perihelion')}
            </button>
            {/* F29 — one-tap time travel to recorded sky events */}
            {SKY_EVENTS.map((ev) => (
              <button
                key={ev.date}
                type="button"
                onClick={() => handleSkyEvent(ev.date)}
                title={L(ev.desc, ev.descEn)}
                className="flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] text-zinc-300 transition-colors hover:border-amber-200/40 hover:text-amber-200 [@media(pointer:coarse)]:py-1"
              >
                <History className="h-2.5 w-2.5 text-amber-300/60" aria-hidden /> {L(ev.label, ev.labelEn)}
              </button>
            ))}
          </div>
          {/* F29 — live planetary-alignment status (written straight to the DOM) */}
          <p
            ref={alignRef}
            style={{ opacity: 0 }}
            className="mt-2 rounded-md border border-amber-200/25 bg-gradient-to-r from-amber-200/[0.12] to-transparent px-2 py-1 text-[10px] font-medium leading-snug tracking-wide text-amber-200 shadow-[0_0_12px_rgba(252,211,77,0.12)] transition-opacity duration-700"
          >
            {L('✦ 连珠检测中…', '✦ Detecting alignment…')}
          </p>
          {/* F36 — live lock: keep the scene pinned to the real clock */}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
              <Radio
                className={cn('h-3.5 w-3.5 transition-colors', liveLock ? 'text-emerald-300' : 'text-zinc-500')}
                aria-hidden
              />
              {L('实时锁定', 'Real-time sync')}
            </div>
            <Switch
              checked={liveLock}
              onCheckedChange={(v) => {
                setLiveLock(v);
                playEventSound('click');
              }}
              aria-label={L('实时锁定到现实时间', 'Lock to real time')}
            />
          </div>
          <p
            aria-hidden={!liveLock}
            className={cn(
              'mt-1.5 flex items-center gap-1.5 text-[10px] tracking-wide text-emerald-300/90 transition-opacity duration-500',
              !liveLock && 'opacity-0'
            )}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" aria-hidden />
            {L('与现实时间同步 · 1 秒 = 1 秒', 'Synced with real time · 1 s = 1 s')}
          </p>
        </div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] text-zinc-500">
            <RotateCw className="h-3 w-3" aria-hidden /> {L('时间流速', 'Time speed')}
          </div>
          {liveLock && (
            <span className="text-[9px] font-medium tracking-wider text-emerald-300/80">
              {L('实时锁定中', 'Real-time locked')}
            </span>
          )}
        </div>
        <div
          className={cn(
            'mb-4 flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1 transition-opacity duration-300',
            liveLock && 'pointer-events-none opacity-40'
          )}
          aria-disabled={liveLock}
          title={
            liveLock
              ? L('实时锁定中——关闭「实时锁定」后可调整时间流速', 'Real-time locked — turn off "Real-time sync" to change the time speed')
              : undefined
          }
        >
          {speedButtons.map((b) => {
            const Icon = b.icon;
            const isOn = speed === b.v;
            return (
              <button
                key={b.v}
                type="button"
                onClick={() => {
                  setSpeed(b.v);
                  playEventSound('click'); // F23
                }}
                aria-pressed={isOn}
                className={cn(
                  'flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-all duration-200 [@media(pointer:coarse)]:min-h-[44px]',
                  isOn
                    ? 'bg-amber-300/20 text-amber-200 shadow-[inset_0_0_0_1px_rgba(252,211,77,0.4)]'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {b.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <OrbitIcon className="h-3.5 w-3.5 text-zinc-500" aria-hidden /> {L('轨道线', 'Orbit lines')}
          </div>
          <Switch checked={showOrbits} onCheckedChange={setShowOrbits} aria-label={L('显示轨道线', 'Show orbit lines')} />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <Tag className="h-3.5 w-3.5 text-zinc-500" aria-hidden /> {L('行星标签', 'Planet labels')}
          </div>
          <Switch checked={showLabels} onCheckedChange={setShowLabels} aria-label={L('显示行星标签', 'Show planet labels')} />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <Star className="h-3.5 w-3.5 text-zinc-500" aria-hidden /> {L('星座连线', 'Constellation lines')}
          </div>
          <Switch
            checked={showConstellations}
            onCheckedChange={(checked) => {
              setShowConstellations(checked);
              if (!checked) closeConCard();
            }}
            aria-label={L('显示星座连线', 'Show constellation lines')}
          />
        </div>
        {/* F25 — constellation quick-locate chips */}
        <div className="mt-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.16em] text-zinc-500">
            <Telescope className="h-3 w-3" aria-hidden /> {L('星座定位', 'Constellations')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CONSTELLATIONS.map((c, i) => (
              <button
                key={c.en}
                type="button"
                onClick={(e) => {
                  cardOriginRef.current = { x: e.clientX, y: e.clientY };
                  flyToConstellation(i);
                }}
                title={lang === 'en' ? `Fly to ${c.nameEn} and open its card` : `飞向${c.name}并打开档案`}
                aria-label={lang === 'en' ? `Locate ${c.nameEn}` : `定位到${c.name}`}
                className={cn(
                  'flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] text-zinc-300 transition-all duration-200',
                  'hover:scale-105 hover:border-white/25 hover:bg-black/60 hover:text-white [@media(pointer:coarse)]:py-1',
                  selCon === i && 'border-white/30 bg-white/10 text-white'
                )}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: CON_CHIP_COLORS[i % CON_CHIP_COLORS.length] }}
                  aria-hidden
                />
                {L(c.name, c.nameEn)}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <Spline className="h-3.5 w-3.5 text-zinc-500" aria-hidden /> {L('轨迹尾迹', 'Orbit trails')}
          </div>
          <Switch checked={showTrails} onCheckedChange={setShowTrails} aria-label={L('显示轨迹尾迹', 'Show orbit trails')} />
        </div>
        {/* F22 — Orionid meteor shower */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <Sparkles className="h-3.5 w-3.5 text-zinc-500" aria-hidden /> {L('流星雨', 'Meteor shower')}
          </div>
          <Switch checked={showMeteors} onCheckedChange={setShowMeteors} aria-label={L('显示猎户座流星雨', 'Show Orionid meteor shower')} />
        </div>
        <p
          ref={meteorStatusRef}
          aria-hidden={!showMeteors}
          className={cn(
            'mt-2 rounded-md border border-amber-200/15 bg-amber-200/[0.06] px-2 py-1 text-[10px] leading-snug tracking-wide text-amber-200/80 transition-opacity duration-500',
            !showMeteors && 'opacity-0'
          )}
        >
          {L('零星背景流星 · 等待地球抵达节点', 'Sporadic meteors · waiting for Earth to reach the node')}
        </p>
      </div>

      {/* collapsed-state floating orb — expands the panel back out (一镜到底) */}
      {(panelCollapsed || fabLeaving) && (
        <button
          ref={panelFabRef}
          type="button"
          onClick={(e) => expandPanel(e.clientX, e.clientY)}
          aria-label={L('展开控制面板', 'Show controls')}
          title={L('展开控制面板', 'Show controls')}
          className="absolute bottom-[calc(5rem+var(--ui-safe-bottom))] left-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-zinc-300 shadow-xl shadow-black/40 backdrop-blur-xl transition-colors hover:border-amber-200/40 hover:text-amber-200 portrait:left-3 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]"
        >
          <PanelLeftOpen className="h-5 w-5" aria-hidden />
        </button>
      )}

      {/* ---------------- bottom-center hint (F44: touch hint on portrait/coarse) ---------------- */}
      <div className="pointer-events-none absolute bottom-[calc(1rem+var(--ui-safe-bottom))] left-1/2 z-30 hidden -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-1.5 text-[11px] tracking-wide text-zinc-400 backdrop-blur-xl portrait:flex portrait:bottom-[calc(3.75rem+var(--ui-safe-bottom))] portrait:w-max portrait:max-w-[94vw] portrait:flex-col portrait:items-center portrait:gap-1 portrait:rounded-2xl portrait:px-3.5 portrait:py-2 portrait:text-center sm:flex">
        <span className="flex items-center gap-2 [@media(pointer:coarse)]:hidden">
          <MousePointerClick className="h-3.5 w-3.5 shrink-0 text-amber-200/70" aria-hidden />
          {L(
            '拖拽旋转视角 · 滚轮缩放 · 点击行星/彗星镜头飞近跟随 · 点击星座查看档案',
            'Drag to orbit · scroll to zoom · click a planet/comet to fly close and follow · click a constellation to open its card'
          )}
        </span>
        <span className="hidden items-center gap-1.5 [@media(pointer:coarse)]:flex">
          <MousePointerClick className="h-3.5 w-3.5 shrink-0 text-amber-200/70" aria-hidden />
          {L(
            '单指拖拽旋转 · 双指缩放 · 点行星镜头跟随 · 点星看星座档案',
            'One-finger drag to orbit · pinch to zoom · tap a planet to follow it · tap a star to open the constellation card'
          )}
        </span>
      </div>

      {/* ---------------- origin-scaled info card (一镜到底) ---------------- */}
      {selected && (
        <aside
          ref={infoCardRef}
          className="absolute right-4 top-24 z-40 w-[min(86vw,320px)] overflow-hidden rounded-2xl border border-white/10 bg-black/55 shadow-2xl shadow-black/60 backdrop-blur-2xl portrait:left-3 portrait:right-3 portrait:top-[138px] portrait:w-auto"
        >
            <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${selected.accent}, transparent)` }} />
            <div className="universe-scroll max-h-[calc(100dvh-160px)] overflow-y-auto p-5 portrait:max-h-[calc(100dvh-220px)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-3 w-3 rounded-full shadow-lg"
                      style={{ backgroundColor: selected.accent, boxShadow: `0 0 10px ${selected.accent}` }}
                      aria-hidden
                    />
                    <h2 className="text-xl font-bold tracking-wide text-zinc-50">{L(selected.name, selected.nameEn)}</h2>
                    <span className="text-xs font-medium tracking-[0.18em] text-zinc-500">{selected.en.toUpperCase()}</span>
                  </div>
                  <span className="mt-2 inline-block rounded-full border border-amber-200/25 bg-amber-200/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.2em] text-amber-200/90">
                    {L(selected.kind, selected.kindEn)}
                  </span>
                  <span className="mt-1.5 ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-emerald-200/90">
                    <span className="relative flex h-1.5 w-1.5" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-60" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
                    </span>
                    {L('镜头跟随中', 'Camera following')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={closeInfoCard}
                  aria-label={L('关闭资料卡', 'Close info card')}
                  className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <p className="mt-4 border-l-2 border-amber-200/30 pl-3 text-[13px] leading-relaxed text-zinc-300">
                {L(selected.intro, selected.introEn)}
              </p>

              <dl className="uni-anim-stagger mt-4 grid grid-cols-2 gap-2">
                {[
                  { icon: Ruler, label: L('直径', 'Diameter'), value: `${selected.diameterKm.toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN')} km`, span: false },
                  {
                    icon: Globe,
                    label: L('距太阳', 'Distance from Sun'),
                    value: selected.id === 'halley' ? '0.59 ~ 35.1 AU' : selected.au > 0 ? `${selected.au} AU` : '—',
                    span: false,
                  },
                  { icon: Thermometer, label: L('表面温度', 'Surface temp'), value: L(selected.tempC, selected.tempCEn), span: false },
                  { icon: Weight, label: L('表面重力', 'Surface gravity'), value: L(selected.gravity, selected.gravityEn), span: false },
                  { icon: Gauge, label: L('轨道速度', 'Orbital velocity'), value: L(selected.orbitSpeed, selected.orbitSpeedEn), span: false },
                  {
                    icon: MoonIcon,
                    label: selected.id === 'sun' ? L('行星', 'Planets') : L('已知卫星', 'Known moons'),
                    value:
                      selected.id === 'sun'
                        ? lang === 'en' ? '8 planets' : '8 颗'
                        : lang === 'en' ? `${selected.moons} moons` : `${selected.moons} 颗`,
                    span: false,
                  },
                  {
                    icon: OrbitIcon,
                    label: selected.id === 'sun' ? L('银河系公转', 'Galactic orbit') : L('公转周期', 'Orbital period'),
                    value: L(selected.orbitPeriod, selected.orbitPeriodEn),
                    span: true,
                  },
                  { icon: RotateCw, label: L('自转周期', 'Rotation period'), value: L(selected.rotationPeriod, selected.rotationPeriodEn), span: true },
                ].map((row) => (
                  <div
                    key={row.label}
                    className={cn(
                      'flex flex-col gap-1 rounded-lg bg-white/[0.04] px-2.5 py-1.5 transition-colors hover:bg-white/[0.07]',
                      row.span && 'col-span-2'
                    )}
                  >
                    <dt className="flex items-center gap-1.5 text-[10px] tracking-wider text-zinc-500">
                      <row.icon className="h-3 w-3" aria-hidden />
                      {row.label}
                    </dt>
                    <dd className="break-words font-mono text-[11px] font-semibold leading-tight text-zinc-100">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <p className="mt-4 text-right text-[10px] tracking-wider text-zinc-600">
                {L('数据来源 · NASA 行星档案', 'Data source · NASA Planetary Fact Sheet')}
              </p>
            </div>
        </aside>
      )}

      {/* ---------------- origin-scaled constellation archive card (F15, 一镜到底) ---------------- */}
      {selCon !== null && CONSTELLATIONS[selCon] && (() => {
        const con = CONSTELLATIONS[selCon];
        return (
          <aside
            ref={conCardRef}
            className="absolute right-4 top-24 z-40 w-[min(86vw,320px)] overflow-hidden rounded-2xl border border-white/10 bg-black/55 shadow-2xl shadow-black/60 backdrop-blur-2xl portrait:left-3 portrait:right-3 portrait:top-[138px] portrait:w-auto"
          >
              <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #9db0cc, transparent)' }} />
              <div className="universe-scroll max-h-[calc(100dvh-160px)] overflow-y-auto p-5 portrait:max-h-[calc(100dvh-220px)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <Star className="h-4 w-4 text-sky-200" aria-hidden />
                      <h2 className="text-xl font-bold tracking-wide text-zinc-50">{L(con.name, con.nameEn)}</h2>
                      <span className="text-xs font-medium tracking-[0.18em] text-zinc-500">{con.en}</span>
                    </div>
                    <span className="mt-2 inline-block rounded-full border border-sky-200/25 bg-sky-200/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.2em] text-sky-200/90">
                      {L(con.kind, con.kindEn)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={closeConCard}
                    aria-label={L('关闭星座档案卡', 'Close constellation card')}
                    className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                <p className="mt-4 border-l-2 border-sky-200/30 pl-3 text-[13px] leading-relaxed text-zinc-300">
                  {L(con.story, con.storyEn)}
                </p>

                {/* F19 — mini star chart */}
                <ConstellationChart con={con} />

                <dl className="uni-anim-stagger mt-4 grid grid-cols-2 gap-2">
                  {[
                    { icon: Star, label: L('最亮星', 'Brightest star'), value: L(con.brightest, con.brightestEn), span: false },
                    { icon: Gauge, label: L('视星等', 'Apparent magnitude'), value: con.magnitude, span: false },
                    { icon: Ruler, label: L('距离', 'Distance'), value: L(con.distance, con.distanceEn), span: false },
                    { icon: CalendarDays, label: L('最佳观测', 'Best viewing'), value: L(con.bestSeason, con.bestSeasonEn), span: true },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className={cn(
                        'flex flex-col gap-1 rounded-lg bg-white/[0.04] px-2.5 py-1.5 transition-colors hover:bg-white/[0.07]',
                        row.span && 'col-span-2'
                      )}
                    >
                      <dt className="flex items-center gap-1.5 text-[10px] tracking-wider text-zinc-500">
                        <row.icon className="h-3 w-3" aria-hidden />
                        {row.label}
                      </dt>
                      <dd className="break-words font-mono text-[11px] font-semibold leading-tight text-zinc-100">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>

                <p className="mt-4 text-right text-[10px] tracking-wider text-zinc-600">
                  {L('星表坐标 · J2000.0 历元', 'Catalog coordinates · Epoch J2000.0')}
                </p>
              </div>
          </aside>
        );
      })()}
    </div>
  );
}
