/**
 * Real solar-system data (sources: NASA Planetary Fact Sheet, JPL).
 * All figures are actual scientific values, used verbatim in the info card.
 * Each body carries parallel "*En" fields so the UI can render either language;
 * Chinese fields stay untouched (zh mode reads them directly, zero regression).
 */

export type PlanetKind = '恒星' | '岩质行星' | '气态巨行星' | '冰巨星' | '周期彗星';

export interface BodyInfo {
  id: string;
  name: string;
  en: string;
  /** English display name (labels / card title) */
  nameEn: string;
  kind: PlanetKind;
  kindEn: string;
  /** true diameter, km */
  diameterKm: number;
  /** orbital period around the Sun */
  orbitPeriod: string;
  orbitPeriodEn: string;
  /** sidereal rotation period (negative = retrograde) */
  rotationPeriod: string;
  rotationPeriodEn: string;
  /** known natural satellites */
  moons: number;
  /** mean distance from the Sun, AU */
  au: number;
  /** surface / cloud-top temperature (real, NASA) */
  tempC: string;
  tempCEn: string;
  /** surface gravity in Earth g */
  gravity: string;
  gravityEn: string;
  /** mean orbital velocity */
  orbitSpeed: string;
  orbitSpeedEn: string;
  /** one-line intro */
  intro: string;
  introEn: string;
  /** css color used for the accent dot */
  accent: string;
}

export const SUN_INFO: BodyInfo = {
  id: 'sun',
  name: '太阳',
  en: 'Sun',
  nameEn: 'Sun',
  kind: '恒星',
  kindEn: 'Star',
  diameterKm: 1392700,
  orbitPeriod: '—（绕银心约 2.3 亿年）',
  orbitPeriodEn: '— (≈ 230 million years around the galactic center)',
  rotationPeriod: '约 25.4 天（赤道差旋）',
  rotationPeriodEn: '≈ 25.4 days (differential equatorial spin)',
  moons: 8, // 行星数（在此字段展示“行星”）
  au: 0,
  tempC: '5,505°C（光球层）',
  tempCEn: '5,505°C (photosphere)',
  gravity: '27.9 g',
  gravityEn: '27.9 g',
  orbitSpeed: '220 km/s（绕银心）',
  orbitSpeedEn: '220 km/s (around the galactic center)',
  intro: '太阳系的中心恒星，占据整个太阳系 99.86% 的质量，其核心每秒聚变约 6 亿吨氢。',
  introEn:
    'The central star of the solar system, holding 99.86% of its total mass; its core fuses about 600 million tonnes of hydrogen every second.',
  accent: '#fbbf24',
};

export const PLANETS: BodyInfo[] = [
  {
    id: 'mercury',
    name: '水星',
    en: 'Mercury',
    nameEn: 'Mercury',
    kind: '岩质行星',
    kindEn: 'Rocky planet',
    diameterKm: 4879,
    orbitPeriod: '88.0 天',
    orbitPeriodEn: '88.0 days',
    rotationPeriod: '58.6 天',
    rotationPeriodEn: '58.6 days',
    moons: 0,
    au: 0.387,
    tempC: '-173 ~ 427°C',
    tempCEn: '-173 ~ 427°C',
    gravity: '0.38 g',
    gravityEn: '0.38 g',
    orbitSpeed: '47.4 km/s',
    orbitSpeedEn: '47.4 km/s',
    intro: '距离太阳最近的行星，没有大气保温，昼夜温差超过 600°C。',
    introEn:
      'The closest planet to the Sun; with no insulating atmosphere, its day–night temperature swing exceeds 600°C.',
    accent: '#b9aa96',
  },
  {
    id: 'venus',
    name: '金星',
    en: 'Venus',
    nameEn: 'Venus',
    kind: '岩质行星',
    kindEn: 'Rocky planet',
    diameterKm: 12104,
    orbitPeriod: '224.7 天',
    orbitPeriodEn: '224.7 days',
    rotationPeriod: '243 天（逆向自转）',
    rotationPeriodEn: '243 days (retrograde rotation)',
    moons: 0,
    au: 0.723,
    tempC: '约 465°C',
    tempCEn: '≈ 465°C',
    gravity: '0.91 g',
    gravityEn: '0.91 g',
    orbitSpeed: '35.0 km/s',
    orbitSpeedEn: '35.0 km/s',
    intro: '被浓硫酸云覆盖的最热行星，失控温室效应使表面高达约 465°C。',
    introEn:
      'The hottest planet, shrouded in dense sulfuric-acid clouds; a runaway greenhouse effect pushes the surface to about 465°C.',
    accent: '#e8c78d',
  },
  {
    id: 'earth',
    name: '地球',
    en: 'Earth',
    nameEn: 'Earth',
    kind: '岩质行星',
    kindEn: 'Rocky planet',
    diameterKm: 12756,
    orbitPeriod: '365.25 天',
    orbitPeriodEn: '365.25 days',
    rotationPeriod: '23.93 小时',
    rotationPeriodEn: '23.93 hours',
    moons: 1,
    au: 1.0,
    tempC: '平均 15°C',
    tempCEn: '15°C average',
    gravity: '1.00 g（9.81 m/s²）',
    gravityEn: '1.00 g (9.81 m/s²)',
    orbitSpeed: '29.8 km/s',
    orbitSpeedEn: '29.8 km/s',
    intro: '目前已知唯一存在生命的星球，表面 71% 被液态水覆盖。',
    introEn:
      'The only world known to harbor life; 71% of its surface is covered by liquid water.',
    accent: '#5fa8d3',
  },
  {
    id: 'mars',
    name: '火星',
    en: 'Mars',
    nameEn: 'Mars',
    kind: '岩质行星',
    kindEn: 'Rocky planet',
    diameterKm: 6779,
    orbitPeriod: '687.0 天',
    orbitPeriodEn: '687.0 days',
    rotationPeriod: '24.62 小时',
    rotationPeriodEn: '24.62 hours',
    moons: 2,
    au: 1.524,
    tempC: '平均 -63°C',
    tempCEn: '-63°C average',
    gravity: '0.38 g',
    gravityEn: '0.38 g',
    orbitSpeed: '24.1 km/s',
    orbitSpeedEn: '24.1 km/s',
    intro: '红色荒漠行星，拥有太阳系最高的火山——约 22 km 高的奥林帕斯山。',
    introEn:
      'A red desert planet, home to the tallest volcano in the solar system — Olympus Mons, about 22 km high.',
    accent: '#d97757',
  },
  {
    id: 'jupiter',
    name: '木星',
    en: 'Jupiter',
    nameEn: 'Jupiter',
    kind: '气态巨行星',
    kindEn: 'Gas giant',
    diameterKm: 139820,
    orbitPeriod: '11.86 年',
    orbitPeriodEn: '11.86 years',
    rotationPeriod: '9.93 小时',
    rotationPeriodEn: '9.93 hours',
    moons: 95,
    au: 5.203,
    tempC: '约 -110°C（云顶）',
    tempCEn: '≈ -110°C (cloud tops)',
    gravity: '2.53 g',
    gravityEn: '2.53 g',
    orbitSpeed: '13.1 km/s',
    orbitSpeedEn: '13.1 km/s',
    intro: '太阳系最大的行星，大红斑是一场持续了至少 300 年的巨型风暴。',
    introEn:
      'The largest planet in the solar system; the Great Red Spot is a giant storm that has raged for at least 300 years.',
    accent: '#d8b48a',
  },
  {
    id: 'saturn',
    name: '土星',
    en: 'Saturn',
    nameEn: 'Saturn',
    kind: '气态巨行星',
    kindEn: 'Gas giant',
    diameterKm: 116460,
    orbitPeriod: '29.45 年',
    orbitPeriodEn: '29.45 years',
    rotationPeriod: '10.66 小时',
    rotationPeriodEn: '10.66 hours',
    moons: 146,
    au: 9.537,
    tempC: '约 -140°C（云顶）',
    tempCEn: '≈ -140°C (cloud tops)',
    gravity: '1.07 g',
    gravityEn: '1.07 g',
    orbitSpeed: '9.7 km/s',
    orbitSpeedEn: '9.7 km/s',
    intro: '拥有太阳系最壮观行星环的气态巨星，平均密度比水还低。',
    introEn:
      'A gas giant with the most spectacular ring system in the solar system; its average density is lower than water.',
    accent: '#e3d3a5',
  },
  {
    id: 'uranus',
    name: '天王星',
    en: 'Uranus',
    nameEn: 'Uranus',
    kind: '冰巨星',
    kindEn: 'Ice giant',
    diameterKm: 50724,
    orbitPeriod: '84.02 年',
    orbitPeriodEn: '84.02 years',
    rotationPeriod: '17.24 小时（侧躺自转）',
    rotationPeriodEn: '17.24 hours (spins on its side)',
    moons: 28,
    au: 19.191,
    tempC: '约 -195°C',
    tempCEn: '≈ -195°C',
    gravity: '0.89 g',
    gravityEn: '0.89 g',
    orbitSpeed: '6.8 km/s',
    orbitSpeedEn: '6.8 km/s',
    intro: '自转轴倾斜 98°，几乎是“躺着”绕太阳滚动的冰巨星。',
    introEn:
      'An ice giant whose 98°-tilted axis makes it roll around the Sun almost lying down.',
    accent: '#a5d8d8',
  },
  {
    id: 'neptune',
    name: '海王星',
    en: 'Neptune',
    nameEn: 'Neptune',
    kind: '冰巨星',
    kindEn: 'Ice giant',
    diameterKm: 49244,
    orbitPeriod: '164.8 年',
    orbitPeriodEn: '164.8 years',
    rotationPeriod: '16.11 小时',
    rotationPeriodEn: '16.11 hours',
    moons: 16,
    au: 30.069,
    tempC: '约 -200°C',
    tempCEn: '≈ -200°C',
    gravity: '1.14 g',
    gravityEn: '1.14 g',
    orbitSpeed: '5.4 km/s',
    orbitSpeedEn: '5.4 km/s',
    intro: '距离太阳最远的行星，风速可达约 2100 km/h，是太阳系最强风暴。',
    introEn:
      'The farthest planet from the Sun; winds reach about 2,100 km/h — the fiercest storms in the solar system.',
    accent: '#6a8fd8',
  },
];

/**
 * F17 — 1P/Halley, the first comet ever predicted to return.
 * Real figures: nucleus ≈ 15×8 km, a = 17.8 AU, e = 0.967,
 * period ≈ 76 y, perihelion 0.586 AU (1986), next return 2061.
 */
export const HALLEY_INFO: BodyInfo = {
  id: 'halley',
  name: '哈雷彗星',
  en: 'Halley',
  nameEn: 'Comet 1P/Halley',
  kind: '周期彗星',
  kindEn: 'Periodic comet',
  diameterKm: 11,
  orbitPeriod: '约 76 年 · 下次回归 2061 年',
  orbitPeriodEn: '≈ 76 years · next return 2061',
  rotationPeriod: '2.2 天（自转轴翻转）',
  rotationPeriodEn: '2.2 days (flipped rotation axis)',
  moons: 0,
  au: 17.8,
  tempC: '-70 ~ 77°C（随日距剧变）',
  tempCEn: '-70 ~ 77°C (varies sharply with solar distance)',
  gravity: '≈ 0（约 5×10⁻¹¹ g）',
  gravityEn: '≈ 0 (about 5×10⁻¹¹ g)',
  orbitSpeed: '近日点 54.6 · 远日点 0.9 km/s',
  orbitSpeedEn: '54.6 km/s at perihelion · 0.9 km/s at aphelion',
  intro:
    '首颗被成功预言回归的彗星——哈雷 1705 年认出 1531/1607/1682 年三次记录是同一天体，并在 1758 年如期归来。中国《史记》中公元前 240 年的记载是世界最早的可靠记录；1986 年乔托号近距离掠过，拍下只反射 4% 阳光的“黑雪球”彗核。',
  introEn:
    'The first comet whose return was successfully predicted — in 1705 Halley recognized the sightings of 1531/1607/1682 as one and the same object, and it returned on schedule in 1758. China\'s Records of the Grand Historian holds the world\'s earliest reliable record (240 BC); in 1986 the Giotto probe flew close by and photographed a "black snowball" nucleus reflecting only 4% of sunlight.',
  accent: '#7fd6e8',
};

/** Scene layout constants (compressed, non-physical but proportion-flavoured) */
export const SCENE_LAYOUT: Record<
  string,
  { orbit: number; size: number; spinDays: number; periodDays: number; tiltDeg: number; inclDeg: number }
> = {
  mercury: { orbit: 14, size: 0.62, spinDays: 58.65, periodDays: 87.97, tiltDeg: 0.03, inclDeg: 7.0 },
  venus: { orbit: 19, size: 1.05, spinDays: -243.02, periodDays: 224.7, tiltDeg: 177.4, inclDeg: 3.4 },
  earth: { orbit: 24.5, size: 1.1, spinDays: 0.997, periodDays: 365.25, tiltDeg: 23.4, inclDeg: 0.0 },
  mars: { orbit: 30, size: 0.8, spinDays: 1.026, periodDays: 686.98, tiltDeg: 25.2, inclDeg: 1.85 },
  jupiter: { orbit: 42, size: 2.7, spinDays: 0.414, periodDays: 4332.6, tiltDeg: 3.1, inclDeg: 1.3 },
  saturn: { orbit: 55, size: 2.3, spinDays: 0.444, periodDays: 10759, tiltDeg: 26.7, inclDeg: 2.49 },
  uranus: { orbit: 67, size: 1.55, spinDays: -0.718, periodDays: 30688.5, tiltDeg: 97.8, inclDeg: 0.77 },
  neptune: { orbit: 78, size: 1.5, spinDays: 0.671, periodDays: 60182, tiltDeg: 28.3, inclDeg: 1.77 },
};

/** F17 — compressed visual orbit for Halley (real e=0.967 is undrawable at this scale) */
export const HALLEY_ORBIT = {
  /** visual semi-major axis, scene units (perihelion ≈13, aphelion ≈100) */
  aVis: 56.5,
  /** visual eccentricity (peri 13 / aph 100) */
  eVis: 0.77,
  /** visual orbital period in scene-years (real: 76 y) */
  periodYears: 16,
  /** initial mean anomaly, radians (starts just before perihelion) */
  m0: -0.045 * Math.PI * 2,
  /** orbit-plane tilt, degrees */
  inclDeg: 12,
  /** tail fades in inside this sun-distance, full brightness below fullR */
  fadeR: 55,
  fullR: 26,
};

/** Base time mapping at speed 1x: one Earth year (orbit) lasts 40 seconds. */
export const SECONDS_PER_EARTH_YEAR = 40;
/** Base visual mapping at speed 1x: Earth spins once every 6 seconds. */
export const SECONDS_PER_EARTH_SPIN = 6;

/* ---------------------- F26 — calendar / ephemeris mapping ---------------------- */

/**
 * Mean longitudes at the J200.0 epoch (degrees). Standard values
 * (JPL / Standish), used to place planets at their real positions for
 * any calendar date (mean-orbit approximation, good to ~1° over ±100 y).
 */
export const J2000_MEAN_LONGITUDE_DEG: Record<string, number> = {
  mercury: 252.251,
  venus: 181.98,
  earth: 100.464,
  mars: 355.433,
  jupiter: 34.396,
  saturn: 49.954,
  uranus: 313.238,
  neptune: 304.88,
};

/**
 * F33 — J2000 orbital-plane orientation (degrees, JPL / Standish approximate
 * elements). Ω = longitude of the ascending node, ϖ = longitude of perihelion.
 * Each orbit plane is now oriented in real 3D: the node line points at Ω and
 * the plane is tilted by the true inclination around it, while the planet's
 * ecliptic longitude (mean-orbit approximation) stays date-accurate because
 * the in-plane angle is measured from the node (u = L − Ω).
 */
export const J2000_ASCENDING_NODE_DEG: Record<string, number> = {
  mercury: 48.331,
  venus: 76.68,
  earth: -11.261,
  mars: 49.579,
  jupiter: 100.556,
  saturn: 113.715,
  uranus: 74.23,
  neptune: 131.722,
};

export const J2000_PERIHELION_LON_DEG: Record<string, number> = {
  mercury: 77.456,
  venus: 131.564,
  earth: 102.947,
  mars: 336.041,
  jupiter: 14.754,
  saturn: 92.432,
  uranus: 170.964,
  neptune: 44.971,
};

/** F33 — real orbital eccentricities (JPL). Planets move on true ellipses
 *  (sun at the focus) solved via Kepler's equation each frame. */
export const J2000_ECCENTRICITY: Record<string, number> = {
  mercury: 0.2056,
  venus: 0.0068,
  earth: 0.0167,
  mars: 0.0934,
  jupiter: 0.0484,
  saturn: 0.0542,
  uranus: 0.0472,
  neptune: 0.0086,
};

/** J2000.0 epoch: 2000-01-01 12:00 UTC, in milliseconds. */
export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

/** Simulated seconds (at 1×) that elapse per calendar day. */
export const DAYS_PER_SIM_SECOND = 365.25 / SECONDS_PER_EARTH_YEAR; // ≈ 9.13 d/s

/** Convert a calendar date (ms since epoch) to the scene's simTime. */
export const dateMsToSimTime = (ms: number): number =>
  (ms - J2000_MS) / 86_400_000 / DAYS_PER_SIM_SECOND;

/** Convert scene simTime back to a calendar date (ms since epoch). */
export const simTimeToDateMs = (t: number): number =>
  J2000_MS + t * DAYS_PER_SIM_SECOND * 86_400_000;
