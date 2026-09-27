'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { X, Flame, Mountain, Wind, Droplets, Expand } from 'lucide-react';
import { L, useLang, getLang, subscribeLang } from './i18n';
import { playEnter, playExit, setOriginFromPoint } from './originTransition';
import { playEventSound } from './soundscape';
import { createFpsMeter } from './fps';
import { registerCapturer } from './capture';
import { getRenderScale, onRenderScaleChange, getDprCap, onDprCapChange } from './quality';
import { getStarSpriteTexture } from './proceduralTextures';

/**
 * Zodiac scene — the twelve ecliptic constellations on a sky sphere.
 * Approximate J2000 star positions, bilingual name sprites, click-to-focus
 * cards with origin-aware transitions.
 */

const R = 100; // sky-sphere radius

type ElementKind = 'fire' | 'earth' | 'air' | 'water';

interface ZodiacSign {
  key: string;
  symbol: string;
  name: string;
  nameEn: string;
  dates: string;
  datesEn: string;
  element: ElementKind;
  ruler: string;
  rulerEn: string;
  brightest: string;
  brightestEn: string;
  magnitude: string;
  color: string;
  story: string;
  storyEn: string;
  /** [RA hours, Dec degrees, magnitude] per node star */
  stars: [number, number, number][];
  /** index pairs chained with lines */
  lines: [number, number][];
}

const SIGNS: ZodiacSign[] = [
  {
    key: 'aries', symbol: '♈', name: '白羊座', nameEn: 'Aries', dates: '3.21 – 4.19', datesEn: 'Mar 21 – Apr 19',
    element: 'fire', ruler: '火星', rulerEn: 'Mars', brightest: '娄宿三 Hamal', brightestEn: 'Hamal', magnitude: '2.0',
    color: '#fb7185',
    story: '金羊毛传说：王子佛里克索斯骑着会飞的金羊渡海逃亡，金羊后来被献祭给宙斯，升上天空成为白羊座；金羊毛的故事由此展开。',
    storyEn: 'The golden ram that carried Prince Phrixus over the sea; sacrificed to Zeus afterwards, it leapt into the sky — and the quest for its fleece became legend.',
    stars: [[2.12, 23.46, 2.0], [1.91, 20.81, 2.6], [1.89, 19.29, 3.9], [2.83, 27.26, 3.6]],
    lines: [[2, 1], [1, 0], [0, 3]],
  },
  {
    key: 'taurus', symbol: '♉', name: '金牛座', nameEn: 'Taurus', dates: '4.20 – 5.20', datesEn: 'Apr 20 – May 20',
    element: 'earth', ruler: '金星', rulerEn: 'Venus', brightest: '毕宿五 Aldebaran', brightestEn: 'Aldebaran', magnitude: '0.9',
    color: '#fbbf24',
    story: '宙斯化身雪白公牛驮走腓尼基公主欧罗巴，渡海到达克里特；这片大陆从此以她命名为欧罗巴（欧洲）。',
    storyEn: 'Zeus carried the princess Europa across the sea as a gleaming white bull — the continent she landed on still bears her name.',
    stars: [[4.6, 16.51, 0.9], [5.44, 28.61, 1.7], [5.63, 21.14, 3.0], [4.48, 15.87, 3.4], [4.33, 15.63, 3.7], [4.48, 19.18, 3.5], [4.01, 12.49, 3.5]],
    lines: [[6, 4], [4, 3], [3, 0], [0, 2], [5, 1], [4, 5]],
  },
  {
    key: 'gemini', symbol: '♊', name: '双子座', nameEn: 'Gemini', dates: '5.21 – 6.21', datesEn: 'May 21 – Jun 21',
    element: 'air', ruler: '水星', rulerEn: 'Mercury', brightest: '北河三 Pollux', brightestEn: 'Pollux', magnitude: '1.1',
    color: '#93c5fd',
    story: '斯巴达双子卡斯托尔与波吕丢刻斯，一个凡人一个永生；弟弟把不朽分给兄长，宙斯感其情义让他们共享神籍，永不分离。',
    storyEn: 'Castor was mortal, Pollux immortal; when Castor fell, Pollux shared his immortality so the twins would never be parted.',
    stars: [[7.58, 31.89, 1.6], [7.75, 28.03, 1.1], [6.63, 16.4, 1.9], [6.38, 22.51, 2.9], [6.73, 25.13, 3.0], [7.33, 21.98, 3.5], [7.74, 24.4, 3.6], [7.19, 30.23, 4.4]],
    lines: [[0, 7], [7, 4], [1, 5], [5, 2], [0, 1], [1, 6]],
  },
  {
    key: 'cancer', symbol: '♋', name: '巨蟹座', nameEn: 'Cancer', dates: '6.22 – 7.22', datesEn: 'Jun 22 – Jul 22',
    element: 'water', ruler: '月亮', rulerEn: 'The Moon', brightest: '柳宿增十 Al Tarf', brightestEn: 'Al Tarf', magnitude: '3.5',
    color: '#60a5fa',
    story: '赫拉克勒斯大战九头蛇时，天后赫拉派出一只巨蟹偷袭；螃蟹被踩碎后，赫拉把它升上天空作为纪念。',
    storyEn: "Hera sent a crab to distract Heracles during his fight with the Hydra; crushed underfoot, it was lifted to the sky in her honour.",
    stars: [[8.97, 11.86, 4.3], [8.28, 9.19, 3.5], [8.75, 18.15, 3.9], [8.72, 21.47, 4.7]],
    lines: [[1, 2], [2, 3], [2, 0]],
  },
  {
    key: 'leo', symbol: '♌', name: '狮子座', nameEn: 'Leo', dates: '7.23 – 8.22', datesEn: 'Jul 23 – Aug 22',
    element: 'fire', ruler: '太阳', rulerEn: 'The Sun', brightest: '轩辕十四 Regulus', brightestEn: 'Regulus', magnitude: '1.4',
    color: '#fcd34d',
    story: '涅墨亚狮子刀枪不入，是赫拉克勒斯十二功绩的第一战；狮子的皮后来成了英雄的战甲。',
    storyEn: "The Nemean lion's hide was impervious to weapons — the first of Heracles' twelve labours; its pelt became the hero's armour.",
    stars: [[10.14, 11.97, 1.4], [11.82, 14.57, 2.1], [10.33, 19.84, 2.6], [11.24, 20.52, 2.6], [11.24, 15.43, 3.3], [9.76, 23.77, 3.0], [9.88, 26.01, 3.9], [10.28, 23.42, 3.4], [10.12, 16.76, 3.5]],
    lines: [[5, 6], [6, 7], [7, 2], [2, 8], [8, 0], [0, 4], [4, 1], [1, 3], [3, 2]],
  },
  {
    key: 'virgo', symbol: '♍', name: '处女座', nameEn: 'Virgo', dates: '8.23 – 9.22', datesEn: 'Aug 23 – Sep 22',
    element: 'earth', ruler: '水星', rulerEn: 'Mercury', brightest: '角宿一 Spica', brightestEn: 'Spica', magnitude: '1.0',
    color: '#a3e635',
    story: '手持麦穗的农业女神得墨忒耳，也是掌管正义的阿斯特赖亚——最亮的那颗星角宿一，就是她手中的麦穗。',
    storyEn: 'The maiden with the ear of wheat — harvest goddess Demeter, or Astraea of justice; her brightest star Spica is the wheat grain itself.',
    stars: [[13.42, -11.16, 1.0], [13.04, 10.96, 2.8], [12.69, -1.45, 2.7], [13.58, -0.6, 3.4], [12.93, 3.4, 3.4], [12.33, -0.67, 3.9], [11.84, 1.76, 3.6]],
    lines: [[6, 5], [5, 2], [2, 3], [3, 1], [2, 0], [0, 4]],
  },
  {
    key: 'libra', symbol: '♎', name: '天秤座', nameEn: 'Libra', dates: '9.23 – 10.23', datesEn: 'Sep 23 – Oct 23',
    element: 'air', ruler: '金星', rulerEn: 'Venus', brightest: '氐宿四 Zubeneschamali', brightestEn: 'Zubeneschamali', magnitude: '2.6',
    color: '#c4b5fd',
    story: '正义女神衡量善恶的天平。它曾属于天蝎座的双螯，罗马人把它独立成座，象征昼夜平分的秋分。',
    storyEn: 'The scales of Astraea weighing good against evil — once the claws of Scorpius, made a constellation of their own at the autumn equinox.',
    stars: [[14.85, -16.04, 2.8], [15.28, -9.38, 2.6], [15.59, -14.79, 3.9], [15.07, -25.28, 3.3]],
    lines: [[0, 1], [1, 2], [0, 3]],
  },
  {
    key: 'scorpius', symbol: '♏', name: '天蝎座', nameEn: 'Scorpius', dates: '10.24 – 11.22', datesEn: 'Oct 24 – Nov 22',
    element: 'water', ruler: '火星 / 冥王星', rulerEn: 'Mars / Pluto', brightest: '心宿二 Antares', brightestEn: 'Antares', magnitude: '1.0',
    color: '#fda4af',
    story: '毒蝎蜇死了傲慢的猎户俄里翁；众神把两者放上天球遥遥相对——猎户座升起时天蝎座便落下，永不相见。',
    storyEn: 'The scorpion that stung the boastful hunter Orion: the two were set on opposite sides of the sky — Orion sets as Scorpius rises, never to meet.',
    stars: [
      [16.49, -26.43, 1.0], [16.01, -22.62, 2.3], [16.09, -19.81, 2.6], [15.98, -26.11, 2.9], [16.35, -25.59, 2.9],
      [16.36, -28.22, 2.8], [16.84, -34.29, 2.3], [16.87, -38.05, 3.0], [16.91, -42.36, 3.6], [17.21, -43.24, 3.3],
      [17.62, -43.0, 1.9], [17.79, -40.13, 3.0], [17.71, -39.03, 2.4], [17.56, -37.1, 1.6], [17.51, -37.3, 2.7],
    ],
    lines: [[2, 1], [1, 4], [4, 0], [0, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 12]],
  },
  {
    key: 'sagittarius', symbol: '♐', name: '射手座', nameEn: 'Sagittarius', dates: '11.23 – 12.21', datesEn: 'Nov 23 – Dec 21',
    element: 'fire', ruler: '木星', rulerEn: 'Jupiter', brightest: '箕宿三 Kaus Australis', brightestEn: 'Kaus Australis', magnitude: '1.8',
    color: '#fdba74',
    story: '半人马贤者喀戎弯弓瞄准天蝎；亮星组成的「茶壶」正对着银河中心——壶嘴冒出的「蒸汽」就是茫茫星海。',
    storyEn: 'The archer centaur Chiron aiming at Scorpius; its bright stars form the famous Teapot, its steam the glow of the galactic centre.',
    stars: [[18.4, -34.38, 1.8], [18.92, -26.3, 2.1], [19.04, -29.88, 2.6], [18.35, -29.83, 2.7], [18.47, -25.42, 2.8], [18.76, -26.99, 3.2], [19.12, -27.67, 3.3]],
    lines: [[3, 0], [0, 2], [2, 6], [6, 1], [1, 4], [4, 3], [3, 5], [5, 1]],
  },
  {
    key: 'capricornus', symbol: '♑', name: '摩羯座', nameEn: 'Capricornus', dates: '12.22 – 1.19', datesEn: 'Dec 22 – Jan 19',
    element: 'earth', ruler: '土星', rulerEn: 'Saturn', brightest: '垒壁阵四 Deneb Algedi', brightestEn: 'Deneb Algedi', magnitude: '2.9',
    color: '#d6d3d1',
    story: '牧神潘为躲避怪物堤丰跃入尼罗河，来不及变完——上半身成了羊，下半身成了鱼。',
    storyEn: 'Pan leapt into the Nile to escape the monster Typhon, half-transformed: goat above water, fish below.',
    stars: [[20.3, -12.54, 3.6], [20.35, -14.78, 3.1], [20.78, -25.27, 4.1], [20.87, -26.92, 4.1], [21.78, -16.13, 2.9], [21.67, -16.66, 3.7], [21.1, -17.23, 4.1], [20.75, -16.8, 4.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0]],
  },
  {
    key: 'aquarius', symbol: '♒', name: '水瓶座', nameEn: 'Aquarius', dates: '1.20 – 2.18', datesEn: 'Jan 20 – Feb 18',
    element: 'air', ruler: '土星 / 天王星', rulerEn: 'Saturn / Uranus', brightest: '虚宿一 Sadalsuud', brightestEn: 'Sadalsuud', magnitude: '2.9',
    color: '#6ee7b7',
    story: '特洛伊王子伽倪墨得斯容貌出众，被宙斯召上天为众神斟酒；宝瓶中倾出的是智慧与灵感之水。',
    storyEn: 'Ganymede, the beautiful Trojan prince, poured nectar for the gods — from his jar flowed the waters of wisdom.',
    stars: [[21.53, -5.57, 2.9], [22.1, -0.32, 3.0], [22.36, -1.39, 3.8], [22.48, -0.02, 3.7], [22.58, -0.12, 4.0], [22.88, -7.58, 3.7], [22.84, -13.59, 4.0], [22.91, -15.82, 3.3]],
    lines: [[1, 0], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]],
  },
  {
    key: 'pisces', symbol: '♓', name: '双鱼座', nameEn: 'Pisces', dates: '2.19 – 3.20', datesEn: 'Feb 19 – Mar 20',
    element: 'water', ruler: '木星 / 海王星', rulerEn: 'Jupiter / Neptune', brightest: '外屏七 Alrescha', brightestEn: 'Alrescha', magnitude: '3.8',
    color: '#7dd3fc',
    story: '怪物堤丰袭来时，爱与美之神阿佛洛狄忒拉着小厄洛斯化身双鱼跃入幼发拉底河；两条鱼被一根丝带永远系在一起。',
    storyEn: 'Aphrodite and Eros escaped Typhon as two fish tied together by a cord — the knot is still drawn on star charts.',
    stars: [[2.03, 2.76, 3.8], [1.75, 9.17, 4.3], [1.53, 15.35, 3.6], [1.05, 7.9, 4.3], [0.81, 7.59, 4.4], [23.29, 3.28, 3.7], [23.46, 6.38, 4.3], [23.66, 5.63, 4.1], [23.7, 1.78, 4.5], [23.44, 1.26, 4.9], [24.0, 6.86, 4.0]],
    lines: [[5, 6], [6, 7], [7, 10], [10, 8], [8, 9], [9, 5], [3, 4], [4, 2], [2, 1], [1, 0], [4, 5]],
  },
];

/* sign boundaries on the ecliptic: Aries 0–30°, Taurus 30–60°, … Pisces 330–360° */
function sunEclipticLon(now: number): number {
  const days = (now - Date.UTC(2000, 0, 1, 12)) / 86400000;
  return ((280.46 + 0.9856474 * days) % 360 + 360) % 360;
}

function radecToVec3(raHours: number, decDeg: number, radius: number): THREE.Vector3 {
  const ra = (raHours / 24) * Math.PI * 2;
  const dec = THREE.MathUtils.degToRad(decDeg);
  return new THREE.Vector3(
    radius * Math.cos(dec) * Math.cos(ra),
    radius * Math.sin(dec) * 0.85,
    -radius * Math.cos(dec) * Math.sin(ra)
  );
}

function makeSignLabelTexture(text: string, color = 'rgba(230,214,170,0.95)'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = '500 26px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 34);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface SignVis {
  lineMat: THREE.LineBasicMaterial;
  nameMat: THREE.SpriteMaterial;
  nameSprite: THREE.Sprite;
}

const ELEMENT_ICONS = { fire: Flame, earth: Mountain, air: Wind, water: Droplets } as const;
const ELEMENT_COLOR: Record<ElementKind, string> = {
  fire: '#fb7185',
  earth: '#fbbf24',
  air: '#67e8f9',
  water: '#60a5fa',
};
const ELEMENT_LABEL: Record<ElementKind, [string, string]> = {
  fire: ['火象', 'Fire'],
  earth: ['土象', 'Earth'],
  air: ['风象', 'Air'],
  water: ['水象', 'Water'],
};


/* -------------------------- mini star chart (card) -------------------------- */
const CHART_W = 272;
const CHART_H = 150;

function ZodiacChart({ sign }: { sign: ZodiacSign }) {
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
    const pts = sign.stars.map(([ra, dec, mag]) => ({ x: -(ra / 24) * 360, y: dec, mag }));
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
    sign.lines.forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(sx(pts[a].x), sy(pts[a].y));
      ctx.lineTo(sx(pts[b].x), sy(pts[b].y));
      ctx.stroke();
    });

    // stars: halo + core, size scaled by magnitude
    let bestIdx = 0;
    pts.forEach((p, i) => {
      if (p.mag < pts[bestIdx].mag) bestIdx = i;
    });
    pts.forEach((p, i) => {
      const x = sx(p.x);
      const y = sy(p.y);
      if (i === bestIdx) {
        const label = getLang() === 'en' ? sign.brightestEn : sign.brightest.split(' ')[0];
        ctx.font = '500 11px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(252,211,77,0.95)';
        ctx.fillText(label, x, y - 12);
      }
      const halo = Math.max(3.5, 9 - p.mag * 1.6);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, halo);
      grad.addColorStop(0, 'rgba(235,242,255,0.95)');
      grad.addColorStop(0.35, 'rgba(190,210,240,0.35)');
      grad.addColorStop(1, 'rgba(190,210,240,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, halo, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eef4ff';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.2, 2.6 - p.mag * 0.35), 0, Math.PI * 2);
      ctx.fill();
    });
  }, [sign]);

  const lang = useLang();
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: CHART_H }}
        className="block"
        role="img"
        aria-label={lang === 'en' ? `${sign.nameEn} star chart` : `${sign.name}星图`}
      />
      <p className="border-t border-white/5 px-3 py-1.5 text-[10px] tracking-wider text-zinc-500">
        {L('星图 · 北在上 · 天空视角（东西翻转）', 'Star chart · North up · sky view (east–west flipped)')}
      </p>
    </div>
  );
}

export default function ZodiacScene() {
  useLang();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [glError, setGlError] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const cardExitingRef = useRef(false);
  const cardGenRef = useRef(0);
  const cardOriginRef = useRef({ x: 0, y: 0 });
  const focusedRef = useRef<number | null>(null);
  const openSignRef = useRef<(i: number) => void>(() => {});
  const closeSignRef = useRef<() => void>(() => {});
  const emptyClickRef = useRef<() => void>(() => {});
  const deselectRef = useRef<() => void>(() => {});
  const panoramaReqRef = useRef(false); // Esc / 返回全景按钮 → 渲染循环
  const signFlightRef = useRef<number | null>(null); // UI → render-loop bridge

  useEffect(() => {
    focusedRef.current = focused;
  }, [focused]);

  const closeCard = () => {
    if (cardExitingRef.current) return;
    const el = cardRef.current;
    if (!el) {
      setSelected(null);
      return;
    }
    cardExitingRef.current = true;
    const gen = cardGenRef.current + 1;
    cardGenRef.current = gen;
    playExit(el, 'uni-origin-out', () => {
      if (cardGenRef.current !== gen) return;
      cardExitingRef.current = false;
      setSelected(null);
    }, 380);
  };

  const openSign = (idx: number, origin?: { x: number; y: number }) => {
    if (origin) cardOriginRef.current = origin;
    if (cardExitingRef.current) {
      cardGenRef.current += 1; // invalidate the pending exit
      cardExitingRef.current = false;
      if (selected === idx) {
        const el = cardRef.current;
        if (el) {
          setOriginFromPoint(el, cardOriginRef.current.x, cardOriginRef.current.y);
          playEnter(el, 'uni-origin-in');
        }
      }
    }
    setSelected(idx);
    setFocused(idx);
    signFlightRef.current = idx;
    playEventSound('click');
  };

  useEffect(() => {
    openSignRef.current = (i: number) => openSign(i);
    closeSignRef.current = closeCard;
    emptyClickRef.current = () => {
      closeCard();
      setFocused(null);
    };
    deselectRef.current = () => {
      closeCard();
      setFocused(null);
    };
  });

  useEffect(() => {
    if (selected === null) return;
    cardGenRef.current += 1;
    cardExitingRef.current = false;
    const el = cardRef.current;
    if (el) {
      setOriginFromPoint(el, cardOriginRef.current.x, cardOriginRef.current.y);
      playEnter(el, 'uni-origin-in');
    }
  }, [selected]);

  /* ------------------------------ scene effect ------------------------------ */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      queueMicrotask(() => setGlError(true));
      return;
    }
    renderer.debug.checkShaderErrors = false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    camera.position.set(0, 42, 124);

    const disposables: { dispose: () => void }[] = [];
    const applyRenderScale = () => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, getDprCap()) * getRenderScale());
    };
    applyRenderScale();
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    wrap.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 30;
    controls.maxDistance = 320;
    controls.maxPolarAngle = Math.PI * 0.55;

    /* --------------------------- background starfield --------------------------- */
    {
      const N = 2200;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const v = new THREE.Vector3()
          .randomDirection()
          .multiplyScalar(380 + Math.random() * 60);
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = Math.abs(v.y) * 0.9;
        pos[i * 3 + 2] = v.z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        size: 1.5,
        map: getStarSpriteTexture(),
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(geo, mat);
      pts.matrixAutoUpdate = false;
      pts.updateMatrix();
      scene.add(pts);
      disposables.push(geo, mat);
    }

    /* ------------------------------- ecliptic ------------------------------- */
    {
      const eclipticMat = new THREE.LineBasicMaterial({
        color: 0xf5d78e,
        transparent: true,
        opacity: 0.16,
      });
      const segs = 256;
      const verts = new Float32Array((segs + 1) * 3);
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        verts[i * 3] = R * Math.cos(a);
        verts[i * 3 + 1] = 0;
        verts[i * 3 + 2] = -R * Math.sin(a);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const ring = new THREE.Line(geo, eclipticMat);
      ring.matrixAutoUpdate = false;
      ring.updateMatrix();
      scene.add(ring);
      disposables.push(geo, eclipticMat);

      const eclTex = makeSignLabelTexture(getLang() === 'en' ? 'ECLIPTIC' : '黄道', 'rgba(245,215,142,0.9)');
      const eclMat = new THREE.SpriteMaterial({ map: eclTex, transparent: true, depthWrite: false, opacity: 0.8 });
      const eclSprite = new THREE.Sprite(eclMat);
      const eclAngle = THREE.MathUtils.degToRad(115);
      eclSprite.position.set(R * Math.cos(eclAngle), 4, -R * Math.sin(eclAngle));
      eclSprite.scale.set(40, 10, 1);
      scene.add(eclSprite);
      disposables.push(eclTex, eclMat);
    }

    /* ------------------------------- the 12 signs ------------------------------- */
    const signVis: SignVis[] = [];
    const hitPoints: THREE.Points[] = [];
    const hitSprites: THREE.Sprite[] = [];
    const centers: THREE.Vector3[] = [];
    const signRadius: number[] = [];
    const DIM = { line: 0.28, name: 0.8 };
    const LIT = { line: 0.95, name: 1 };

    SIGNS.forEach((sign, idx) => {
      const nodeVs = sign.stars.map(([ra, dec]) => radecToVec3(ra, dec, R));
      const verts: number[] = [];
      for (const [a, b] of sign.lines) {
        const va = nodeVs[a];
        const vb = nodeVs[b];
        verts.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x9db0cc,
        transparent: true,
        opacity: DIM.line,
      });
      const lines = new THREE.LineSegments(lineGeo, lineMat);
      lines.matrixAutoUpdate = false;
      lines.updateMatrix();
      scene.add(lines);
      disposables.push(lineGeo, lineMat);

      // node stars split into brightness tiers (PointsMaterial has one size)
      const tiers: { max: number; size: number }[] = [
        { max: 2.2, size: 7.5 },
        { max: 3.2, size: 5 },
        { max: 99, size: 3.4 },
      ];
      tiers.forEach((t, ti) => {
        const lo = ti === 0 ? -99 : tiers[ti - 1].max;
        const chosen = nodeVs.filter((_v, i) => sign.stars[i][2] <= t.max && sign.stars[i][2] > lo);
        if (chosen.length === 0) return;
        const parr = new Float32Array(chosen.length * 3);
        chosen.forEach((v, i) => {
          parr[i * 3] = v.x;
          parr[i * 3 + 1] = v.y;
          parr[i * 3 + 2] = v.z;
        });
        const pgeo = new THREE.BufferGeometry();
        pgeo.setAttribute('position', new THREE.BufferAttribute(parr, 3));
        const pmat = new THREE.PointsMaterial({
          size: t.size,
          map: getStarSpriteTexture(),
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          color: 0xfff3d6,
        });
        const pts = new THREE.Points(pgeo, pmat);
        pts.userData.signIndex = idx;
        pts.matrixAutoUpdate = false;
        pts.updateMatrix();
        scene.add(pts);
        disposables.push(pgeo, pmat);
        hitPoints.push(pts);
      });

      // bounding-box center + radius: stable framing target for curved figures
      const box = new THREE.Box3().setFromPoints(nodeVs);
      const center = box.getCenter(new THREE.Vector3());
      centers.push(center.clone());
      signRadius.push(box.getSize(new THREE.Vector3()).length() / 2);

      const nameTex = makeSignLabelTexture(getLang() === 'en' ? sign.nameEn : sign.name);
      const nameMat = new THREE.SpriteMaterial({
        map: nameTex,
        transparent: true,
        opacity: DIM.name,
        depthWrite: false,
      });
      const nameSprite = new THREE.Sprite(nameMat);
      nameSprite.position.copy(center.clone().normalize().multiplyScalar(R + 16));
      nameSprite.scale.set(30, 7.5, 1);
      nameSprite.userData.signIndex = idx;
      scene.add(nameSprite);
      disposables.push(nameTex, nameMat);
      hitSprites.push(nameSprite);

      signVis.push({ lineMat, nameMat, nameSprite });
    });

    /* --------------------------- sun marker on the ecliptic --------------------------- */
    const sunLon = sunEclipticLon(Date.now());
    const sunSignIdx = Math.floor(sunLon / 30) % 12;
    const sunSign = SIGNS[sunSignIdx];
    const sunAngle = THREE.MathUtils.degToRad(sunLon);
    const sunPos = new THREE.Vector3(R * Math.cos(sunAngle), 0, -R * Math.sin(sunAngle));
    const sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getStarSpriteTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xffc24d,
      })
    );
    sunSprite.position.copy(sunPos);
    sunSprite.scale.set(9, 9, 1);
    scene.add(sunSprite);
    const sunSpriteMat = sunSprite.material as THREE.SpriteMaterial;
    disposables.push(sunSpriteMat);

    let sunLabel: THREE.Sprite | null = null;
    const buildSunLabel = (sgn: ZodiacSign): THREE.Sprite => {
      const text = getLang() === 'en' ? `Sun in ${sgn.nameEn}` : `太阳此刻在 ${sgn.name}`;
      const tex = makeSignLabelTexture(text, 'rgba(252,211,77,0.95)');
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const label = new THREE.Sprite(mat);
      label.position.copy(sunPos.clone().normalize().multiplyScalar(R + 14));
      label.scale.set(52, 13, 1);
      scene.add(label);
      disposables.push(tex, mat);
      return label;
    };
    sunLabel = buildSunLabel(sunSign);
    let lastSunSignIdx = sunSignIdx;

    /* the marker follows the real clock — the Sun advances along the ecliptic */
    const sunClock = window.setInterval(() => {
      const lon = sunEclipticLon(Date.now());
      const a = THREE.MathUtils.degToRad(lon);
      sunSprite.position.set(R * Math.cos(a), 0, -R * Math.sin(a));
      if (sunLabel) {
        sunLabel.position.copy(sunSprite.position.clone().normalize().multiplyScalar(R + 14));
      }
      const idx = Math.floor(lon / 30) % 12;
      if (idx !== lastSunSignIdx) {
        lastSunSignIdx = idx;
        if (sunLabel) scene.remove(sunLabel);
        sunLabel = buildSunLabel(SIGNS[idx]);
      }
    }, 30000);

    /* redraw canvas labels when the language changes */
    const unsubLang = subscribeLang(() => {
      SIGNS.forEach((sign, idx) => {
        const vis = signVis[idx];
        const old = vis.nameMat.map;
        vis.nameMat.map = makeSignLabelTexture(getLang() === 'en' ? sign.nameEn : sign.name);
        vis.nameMat.needsUpdate = true;
        old?.dispose();
      });
      if (sunLabel) {
        const mat = sunLabel.material as THREE.SpriteMaterial;
        const oldMap = mat.map;
        const newTex = makeSignLabelTexture(
          getLang() === 'en' ? `Sun in ${sunSign.nameEn}` : `太阳此刻在 ${sunSign.name}`,
          'rgba(252,211,77,0.95)'
        );
        mat.map = newTex;
        mat.needsUpdate = true;
        oldMap?.dispose();
        disposables.push(newTex);
        sunLabel.position.copy(sunSprite.position.clone().normalize().multiplyScalar(R + 14));
      }
    });

    /* ------------------------------ screenshot ------------------------------ */
    registerCapturer(() => {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    });

    /* ------------------------------ interaction ------------------------------ */
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 7 };
    let downX = 0;
    let downY = 0;
    let downT = 0;
    let hoverIdx: number | null = null;
    const pointer = new THREE.Vector2();
    const pickable = [...hitPoints, ...hitSprites];

    const pickSign = (ev: PointerEvent): number | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickable, false);
      if (hits.length === 0) return null;
      const idx = hits[0].object.userData.signIndex as number;
      return typeof idx === 'number' ? idx : null;
    };

    let lastHoverT = 0;
    const onPointerMove = (ev: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverT < 100) return;
      lastHoverT = now;
      hoverIdx = pickSign(ev);
      renderer.domElement.style.cursor = hoverIdx !== null ? 'pointer' : 'grab';
    };
    const onPointerDown = (ev: PointerEvent) => {
      downX = ev.clientX;
      downY = ev.clientY;
      downT = performance.now();
    };
    const onPointerUp = (ev: PointerEvent) => {
      const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY);
      const dt = performance.now() - downT;
      if (moved > 6 || dt > 550) return; // a drag, not a click
      const idx = pickSign(ev);
      if (idx === null) {
        emptyClickRef.current(); // click on empty sky — deselect like the solar scene
        return;
      }
      cardOriginRef.current = { x: downX, y: downY };
      openSignRef.current(idx);
    };
    const cancelFlight = () => {
      signFlightRef.current = null;
      controls.enabled = true;
    };

    const onPointerLeave = () => {
      hoverIdx = null;
      renderer.domElement.style.cursor = 'grab';
    };
    const el = renderer.domElement;
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('pointerdown', cancelFlight);
    el.addEventListener('wheel', cancelFlight, { passive: true });
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      signFlightRef.current = null;
      panoramaReqRef.current = true;
      deselectRef.current();
    };
    window.addEventListener('keydown', onKey);

    /* ------------------------------ resize / quality ------------------------------ */
    const onResize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
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
    let raf = 0;
    const fps = createFpsMeter();
    let frame = 0;
    let flightT = 1;
    const flightFrom = new THREE.Vector3();
    const flightFromTgt = new THREE.Vector3();
    const flightTo = new THREE.Vector3();
    const flightToTgt = new THREE.Vector3();

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);
      frame++;

      // Esc / 返回全景按钮 → glide back to the overview (UI → loop bridge)
      if (panoramaReqRef.current) {
        panoramaReqRef.current = false;
        flightFrom.copy(camera.position);
        flightFromTgt.copy(controls.target);
        flightTo.set(0, 42, 124);
        flightToTgt.set(0, 0, 0);
        flightT = 0;
        controls.enabled = false;
      }

      // flight tween (UI / click → loop bridge)
      const req = signFlightRef.current;
      if (req !== null) {
        signFlightRef.current = null;
        const dir = centers[req]?.clone().normalize();
        if (dir) {
          flightFrom.copy(camera.position);
          flightFromTgt.copy(controls.target);
          // frame the WHOLE figure: distance from its bounding radius and the
          // narrower of the vertical/horizontal FOV (portrait phones are tight)
          const r = signRadius[req] ?? 20;
          const fovY = (camera.fov * Math.PI) / 180;
          const fovX = 2 * Math.atan(Math.tan(fovY / 2) * camera.aspect);
          const fovMin = Math.min(fovY, fovX);
          // back away from the sky sphere so the whole figure fits the narrower FOV
          const back = THREE.MathUtils.clamp((r * 1.7) / Math.sin(fovMin / 2), 30, 200);
          flightTo.copy(dir).multiplyScalar(R + back);
          flightTo.y += back * 0.1;
          flightToTgt.copy(dir).multiplyScalar(R);
          // portrait: the profile card covers the top half — shift the whole
          // view up so the figure lands in the clear space beneath it
          if (camera.aspect < 0.85) {
            const viewDir = new THREE.Vector3().subVectors(flightToTgt, flightTo).normalize();
            const right = new THREE.Vector3().crossVectors(viewDir, new THREE.Vector3(0, 1, 0)).normalize();
            const screenUp = new THREE.Vector3().crossVectors(right, viewDir).normalize();
            const shift = back * 0.21; // 22% of the viewport height below centre
            flightToTgt.addScaledVector(screenUp, shift);
            flightTo.addScaledVector(screenUp, shift);
          }
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

      // hover / focus highlight lerp (DIM ↔ LIT)
      const focusNow = focusedRef.current;
      SIGNS.forEach((_, i) => {
        const vis = signVis[i];
        const lit = i === hoverIdx || i === focusNow;
        const lineT = lit ? LIT.line : DIM.line;
        const nameT = lit ? LIT.name : DIM.name;
        vis.lineMat.opacity += (lineT - vis.lineMat.opacity) * 0.12;
        vis.nameMat.opacity += (nameT - vis.nameMat.opacity) * 0.12;
      });

      // alternate-frame work: name sprite distance compensation + sun pulse
      if (frame % 2 === 0) {
        const camDist = camera.position.length();
        const k = THREE.MathUtils.clamp((camDist - R) / 140, 0.8, 1.3);
        for (const vis of signVis) {
          vis.nameSprite.scale.set(30 * k, 7.5 * k, 1);
        }
        const p = 1 + 0.08 * Math.sin(clock.elapsedTime * 2.4);
        sunSprite.scale.set(9 * p, 9 * p, 1);
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
      unsubLang();
      ro.disconnect();
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('pointerdown', cancelFlight);
      el.removeEventListener('wheel', cancelFlight);
      window.removeEventListener('keydown', onKey);
      window.clearInterval(sunClock);
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      sunLabel = null;
    };
  }, []);

  /* ------------------------------ render ------------------------------ */
  const sign = selected !== null ? SIGNS[selected] : null;
  const ElementIcon = sign ? ELEMENT_ICONS[sign.element] : null;

  /* 今夜可见性：太阳黄经与星座中心的角距——星座与太阳同侧时被阳光淹没 */
  let visibility: { label: [string, string]; color: string } | null = null;
  if (sign) {
    const signLon = ((selected ?? 0) * 30 + 15) % 360;
    const sunLon = sunEclipticLon(Date.now());
    let d = Math.abs(signLon - sunLon);
    if (d > 180) d = 360 - d;
    if (d < 25) {
      visibility = { label: ['被阳光淹没 · 今夜不可见', 'Lost in the Sun — not visible tonight'], color: '#f87171' };
    } else if (d < 55) {
      visibility = { label: ['贴近太阳 · 黎明/黄昏低空短暂可见', 'Near the Sun — brief low-altitude views'], color: '#fbbf24' };
    } else if (d < 115) {
      visibility = { label: ['今夜适合观测', 'Good for observing tonight'], color: '#4ade80' };
    } else {
      visibility = { label: ['午夜高空 · 最佳观测期', 'High at midnight — peak season'], color: '#22d3ee' };
    }
  }

  return (
    <div ref={wrapRef} className="absolute inset-0" aria-label={L('十二星座场景', 'Zodiac scene')}>
      {/* top quick-focus chips */}
      <div className="pointer-events-auto absolute left-1/2 top-[max(128px,calc(var(--ui-safe-top)+4.6rem))] z-30 flex max-w-[94vw] -translate-x-1/2 flex-wrap justify-center gap-1.5">
        {SIGNS.map((s, i) => {
          const active = focused === i || selected === i;
          return (
            <button
              key={s.key}
              type="button"
              onClick={(e) => openSign(i, { x: e.clientX, y: e.clientY })}
              aria-pressed={active}
              className={
                'flex min-h-[30px] items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-xl transition-all duration-300 [@media(pointer:coarse)]:min-h-[36px] ' +
                (active
                  ? 'border-amber-300/40 bg-amber-200/15 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.15)]'
                  : 'border-white/10 bg-black/40 text-zinc-300 hover:border-amber-200/30 hover:text-amber-100')
              }
            >
              {L(s.name, s.nameEn)}
            </button>
          );
        })}
      </div>

      {/* 返回全景（聚焦时显示，触屏无 Esc 的替代） */}
      {focused !== null && (
        <button
          type="button"
          onClick={(e) => {
            cardOriginRef.current = { x: e.clientX, y: e.clientY };
            panoramaReqRef.current = true;
            closeCard();
            setFocused(null);
            playEventSound('click');
          }}
          aria-label={L('返回全景视角', 'Return to overview')}
          className="uni-anim-fade-up pointer-events-auto absolute bottom-[calc(3.4rem+var(--ui-safe-bottom))] left-1/2 z-30 flex min-h-[36px] -translate-x-1/2 items-center gap-1.5 rounded-full border border-amber-200/30 bg-black/55 px-3.5 text-[11px] font-medium text-amber-100 backdrop-blur-xl transition-all duration-300 hover:border-amber-200/50 hover:bg-black/70 [@media(pointer:coarse)]:min-h-[40px]"
        >
          <Expand className="h-3.5 w-3.5" aria-hidden />
          {L('返回全景', 'Overview')}
        </button>
      )}

      {/* hint */}
      <div className="pointer-events-none absolute bottom-[calc(1.1rem+var(--ui-safe-bottom))] left-1/2 z-30 w-max max-w-[92vw] -translate-x-1/2 rounded-full border border-white/10 bg-black/45 px-4 py-1.5 text-center text-[11px] tracking-wide text-zinc-400 backdrop-blur-xl">
        {typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
          ? L('单指拖拽旋转 · 双指缩放 · 点星座查看档案并聚焦', 'One-finger orbit · pinch to zoom · tap a sign for its card')
          : L('拖拽旋转视角 · 滚轮缩放 · 点击星座查看档案并聚焦 · 金色圆环为黄道', 'Drag to orbit · scroll to zoom · click a sign for its card · the gold ring is the ecliptic')}
      </div>

      {/* sign info card — origin-aware open/close */}
      {sign && (
        <div
          ref={cardRef}
          role="dialog"
          aria-label={L('星座档案', 'Sign profile')}
          className="universe-scroll absolute right-4 top-[calc(var(--ui-safe-top)+4.6rem)] z-40 max-h-[calc(100dvh-150px)] w-[min(92vw,340px)] overflow-y-auto rounded-2xl border border-white/10 bg-black/60 p-5 shadow-2xl shadow-black/50 backdrop-blur-xl portrait:left-3 portrait:right-3 portrait:top-[138px] portrait:w-auto"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl border"
                style={{
                  color: ELEMENT_COLOR[sign.element],
                  borderColor: `${ELEMENT_COLOR[sign.element]}44`,
                  background: `${ELEMENT_COLOR[sign.element]}14`,
                }}
                aria-hidden
              >
                {ElementIcon && <ElementIcon className="h-5 w-5" />}
              </span>
              <div>
                <h2 className="text-base font-semibold tracking-wider text-amber-100">
                  {L(sign.name, sign.nameEn)}
                </h2>
                <p className="text-[10px] tracking-[0.3em] text-zinc-500">{sign.nameEn.toUpperCase()}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => closeSignRef.current()}
              aria-label={L('关闭星座档案', 'Close sign profile')}
              className="rounded-lg border border-white/10 bg-black/40 p-1.5 text-zinc-400 transition-colors duration-200 hover:border-white/25 hover:text-zinc-100"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-amber-200/25 bg-amber-200/10 px-2.5 py-0.5 text-[10px] font-medium text-amber-200">
              {L(sign.dates, sign.datesEn)}
            </span>
            <span
              className="rounded-full border px-2.5 py-0.5 text-[10px] font-medium"
              style={{
                borderColor: `${ELEMENT_COLOR[sign.element]}55`,
                color: ELEMENT_COLOR[sign.element],
                background: `${ELEMENT_COLOR[sign.element]}14`,
              }}
            >
              {ElementIcon && <ElementIcon className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden />}
              {L(ELEMENT_LABEL[sign.element][0], ELEMENT_LABEL[sign.element][1])}
            </span>
            {visibility && (
              <span
                className="rounded-full border px-2.5 py-0.5 text-[10px] font-medium"
                style={{ borderColor: `${visibility.color}55`, color: visibility.color, background: `${visibility.color}14` }}
                title={L('按当前太阳位置推算', 'Based on the current solar position')}
              >
                {L(visibility.label[0], visibility.label[1])}
              </span>
            )}
          </div>

          <dl className="uni-anim-stagger mt-4 space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-1.5">
              <dt className="text-zinc-500">{L('守护星', 'Ruling planet')}</dt>
              <dd className="text-zinc-200">{L(sign.ruler, sign.rulerEn)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-1.5">
              <dt className="text-zinc-500">{L('最亮星', 'Brightest star')}</dt>
              <dd className="text-zinc-200">
                {L(sign.brightest, sign.brightestEn)}
                <span className="ml-1 font-mono text-amber-200/90">{sign.magnitude}</span>
              </dd>
            </div>
          </dl>

          <ZodiacChart sign={sign} />

          <p className="mt-4 text-[11.5px] leading-relaxed text-zinc-300">{L(sign.story, sign.storyEn)}</p>

          <p className="mt-4 border-t border-white/5 pt-2.5 text-right text-[9px] tracking-[0.24em] text-zinc-600">
            {L('黄道十二宫 · J2000 星表', 'ZODIAC · J2000 CATALOGUE')}
          </p>
        </div>
      )}

      {glError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center">
          <div className="rounded-2xl border border-white/10 bg-black/70 px-6 py-5 text-center backdrop-blur-xl">
            <p className="text-sm font-semibold text-zinc-100">{L('无法启动 WebGL', 'WebGL unavailable')}</p>
            <p className="mt-2 text-[11px] text-zinc-400">
              {L('当前环境不支持 WebGL 渲染，请更换浏览器或开启硬件加速。', 'This environment cannot start WebGL — try another browser or enable hardware acceleration.')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
