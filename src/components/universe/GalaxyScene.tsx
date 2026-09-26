'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Play, Square, Sparkles, Orbit, Zap, MapPin, BookOpen, X, Star, Trash2, Crosshair, Download, Upload, Telescope, Users, Hourglass, CircleDot, Ruler, Scale, Sun, GitMerge, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { createFpsMeter } from '@/components/universe/fps';
import { registerCapturer } from '@/components/universe/capture';
import { getRenderScale, onRenderScaleChange } from '@/components/universe/quality';
import { playEventSound } from '@/components/universe/soundscape';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { L, useLang, getLang } from './i18n';
import { playEnter, playExit, setOriginFromPoint, setOriginFromTrigger } from './originTransition';
import {
  STAR_VERTEX,
  STAR_FRAGMENT,
  DUST_VERTEX,
  DUST_FRAGMENT,
} from '@/components/universe/galaxyShaders';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const STAR_COUNT = 120000;
const DUST_COUNT = 26000;
const GALAXY_R_MAX = 100;
const PITCH_TAN = 0.23; // tan(13 deg) — log-spiral tightness
const ARM_COUNT = 4;
const SPIN_RATE = 0.012; // galaxy yaw, rad per real-time second
const TOUR_DURATION = 24; // seconds, 3 stages x 8 s
const STAGE_LEN = 8;

const STAGE_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['俯瞰', 'Top-down'],
  ['侧视', 'Side view'],
  ['穿入旋臂', 'Dive into arms'],
];

/* -------- F12: spiral-arm science layer (real Milky Way arm names) -------- */
interface ArmSpec {
  arm: number; // arm index in the 4-arm model
  r: number; // marker radius along the ridge (model units)
  name: string;
  en: string;
  nameEn: string; // title-case English name (chip primary text in en mode)
  kind: string;
  kindEn: string;
  dist: string; // approx distance from the galactic center
  distEn: string;
  desc: string;
  descEn: string;
  color: string;
}

const ARM_SPECS: ArmSpec[] = [
  {
    arm: 0,
    r: 30,
    name: '猎户臂',
    en: 'ORION SPUR',
    nameEn: 'Orion Spur',
    kind: '支臂 · 本地臂',
    kindEn: 'Spur · Local Arm',
    dist: '距银心 ≈ 1.5 万光年',
    distEn: '≈ 15,000 ly from center',
    desc: '太阳系所在的支臂，长约 1 万光年。著名的猎户座大星云（M42）就位于这条臂上。',
    descEn:
      'The spur where the Solar System resides, about 10,000 ly long. The famous Orion Nebula (M42) lies on this arm.',
    color: '#fbbf24',
  },
  {
    arm: 1,
    r: 62,
    name: '人马臂',
    en: 'SAGITTARIUS ARM',
    nameEn: 'Sagittarius Arm',
    kind: '主旋臂',
    kindEn: 'Major arm',
    dist: '距银心 ≈ 3.1 万光年',
    distEn: '≈ 31,000 ly from center',
    desc: '银河系主要旋臂之一，富含发射星云与年轻疏散星团，M8 礁湖星云位于其中。',
    descEn:
      "One of the Milky Way's major arms, rich in emission nebulae and young open clusters; the Lagoon Nebula (M8) lies within.",
    color: '#a78bfa',
  },
  {
    arm: 2,
    r: 74,
    name: '盾牌-半人马臂',
    en: 'SCUTUM-CENTAURUS ARM',
    nameEn: 'Scutum–Centaurus Arm',
    kind: '主旋臂 · 最亮',
    kindEn: 'Major arm · brightest',
    dist: '距银心 ≈ 3.7 万光年',
    distEn: '≈ 37,000 ly from center',
    desc: '银河系最显著的主旋臂之一，靠近银核一侧，恒星密度极高，拥有大量大质量恒星形成区。',
    descEn:
      'One of the most prominent major arms, on the side closer to the galactic core, with extremely high stellar density and many massive star-forming regions.',
    color: '#34d399',
  },
  {
    arm: 3,
    r: 66,
    name: '英仙臂',
    en: 'PERSEUS ARM',
    nameEn: 'Perseus Arm',
    kind: '主旋臂',
    kindEn: 'Major arm',
    dist: '距银心 ≈ 3.3 万光年',
    distEn: '≈ 33,000 ly from center',
    desc: '太阳外侧的最近主旋臂，距我们约 6,400 光年，以超新星遗迹仙后座 A 闻名。',
    descEn:
      "The nearest major arm beyond the Sun's orbit, about 6,400 ly from us, famed for the Cassiopeia A supernova remnant.",
    color: '#fb7185',
  },
];

/* ------------------------------------------------------------------ */
/* Deterministic randomness (stable galactic layout)                   */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller gaussian built on top of a seeded PRNG. */
function makeGauss(rand: () => number): () => number {
  return () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/* ------------------------------------------------------------------ */
/* Blackbody-ish temperature ramp: blue-white / yellow / red           */
/* ------------------------------------------------------------------ */

const TEMP_STOPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [2500, 1.0, 0.45, 0.22], // deep red
  [4500, 1.0, 0.72, 0.45], // orange
  [6000, 1.0, 0.87, 0.68], // yellow-white
  [8000, 1.0, 0.97, 0.92], // white
  [10000, 0.68, 0.78, 1.0], // blue-white
];

function tempToColor(t: number, out: THREE.Color): void {
  const tt = t < 2500 ? 2500 : t > 10000 ? 10000 : t;
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const b = TEMP_STOPS[i];
    if (tt <= b[0]) {
      const a = TEMP_STOPS[i - 1];
      const x = (tt - a[0]) / (b[0] - a[0]);
      out.setRGB(a[1] + (b[1] - a[1]) * x, a[2] + (b[2] - a[2]) * x, a[3] + (b[3] - a[3]) * x);
      return;
    }
  }
  out.setRGB(0.68, 0.78, 1.0);
}

function saturateColor(c: THREE.Color, k: number): void {
  const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  c.r = lum + (c.r - lum) * k;
  c.g = lum + (c.g - lum) * k;
  c.b = lum + (c.b - lum) * k;
}

/* ------------------------------------------------------------------ */
/* Procedural radial-gradient sprite texture (no external images)      */
/* ------------------------------------------------------------------ */

function makeGlowTexture(stops: ReadonlyArray<readonly [number, string]>): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const s of stops) grad.addColorStop(s[0], s[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Three-stage cinematic tour                                          */
/* ------------------------------------------------------------------ */

interface TourKey {
  t: number; // seconds from tour start
  p: THREE.Vector3; // camera position
  l: THREE.Vector3; // look-at point
}

function buildTourKeys(fromPos: THREE.Vector3, fromLook: THREE.Vector3): TourKey[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  return [
    // intro glide from wherever the user currently is (no jump)
    { t: 0.0, p: fromPos.clone(), l: fromLook.clone() },
    // stage 1 — 俯瞰 OVERHEAD
    { t: 1.8, p: v(0, 130, 14), l: v(0, 0, 0) },
    { t: 4.9, p: v(22, 125, 34), l: v(0, 0, 0) },
    { t: 8.0, p: v(46, 118, 58), l: v(0, 0, 0) },
    // stage 2 — 侧视 EDGE-ON (dust lane obvious)
    { t: 12.0, p: v(118, 42, 0), l: v(0, 0, 0) },
    { t: 16.0, p: v(112, 4, 46), l: v(0, 0, 0) },
    // stage 3 — 穿入旋臂 DIVE (look drifts from center to a point ahead)
    { t: 19.2, p: v(64, 2.5, 14), l: v(16, 0.5, -18) },
    { t: 21.6, p: v(26, 2, -8), l: v(-4, 0.5, -46) },
    { t: 24.0, p: v(18, 26, -30), l: v(0, 0, 0) },
  ];
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/* F30 — personal star map */
interface StarBookmark {
  id: string;
  name: string;
  temp: number;
  rGal: number; // 万光年
  spectral: string;
  typeName: string;
  armName: string;
  x: number; // galaxy-local coordinates
  y: number;
  z: number;
}

const STAR_NAMES = ['天枢', '天璇', '天玑', '天权', '玉衡', '开阳', '摇光', '文昌', '天市', '太微', '紫微', '钩陈'];
const STAR_NAMES_EN = ['Dubhe', 'Merak', 'Phecda', 'Megrez', 'Alioth', 'Mizar', 'Alkaid', 'Sirius', 'Vega', 'Altair', 'Deneb', 'Polaris'];
const BOOKMARK_LIMIT = 12;
const BOOKMARK_LS_KEY = 'universe-star-bookmarks';
/* collapsible stats card — remembers its collapsed state across visits */
const PANEL_COLLAPSED_LS_KEY = 'universe-panel-galaxy';

const loadBookmarks = (): StarBookmark[] => {
  try {
    const raw = window.localStorage.getItem(BOOKMARK_LS_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as StarBookmark[]).slice(0, BOOKMARK_LIMIT) : [];
  } catch {
    return [];
  }
};

const saveBookmarks = (list: StarBookmark[]) => {
  try {
    window.localStorage.setItem(BOOKMARK_LS_KEY, JSON.stringify(list));
  } catch {
    /* private mode etc. */
  }
};

/* F34 — clipboard copy with a legacy fallback (non-secure contexts) */
const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

/* F34 — validate an imported bookmark record */
const parseBookmark = (raw: unknown): StarBookmark | null => {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return null;
  if (typeof o.x !== 'number' || typeof o.y !== 'number' || typeof o.z !== 'number') return null;
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.z)) return null;
  return {
    id: o.id.slice(0, 64),
    name: o.name.slice(0, 24),
    temp: typeof o.temp === 'number' && Number.isFinite(o.temp) ? o.temp : 0,
    rGal: typeof o.rGal === 'number' && Number.isFinite(o.rGal) ? o.rGal : 0,
    spectral: typeof o.spectral === 'string' ? o.spectral.slice(0, 16) : '',
    typeName: typeof o.typeName === 'string' ? o.typeName.slice(0, 24) : '',
    armName: typeof o.armName === 'string' ? o.armName.slice(0, 32) : '',
    x: o.x,
    y: o.y,
    z: o.z,
  };
};

/** i18n — X 万光年 → X×10,000 ly, formatted for the en locale */
const fmtWanToLy = (wan: number): string => `${Math.round(wan * 10000).toLocaleString('en-US')} ly`;

/* ------------------------------------------------------------------ */
/* 一镜到底 — origin-aware open/close for the three dossier cards      */
/* ------------------------------------------------------------------ */

type CardKey = 'bookmark' | 'arm' | 'galaxy';
/** Either the trigger element itself, or the viewport point of a click (arm chips). */
type CardTrigger = HTMLElement | { x: number; y: number } | null;

/** useLayoutEffect on the client (no SSR warning); useEffect on the server. */
const useIsoLayoutEffect: typeof useLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Set the expand origin toward the stored trigger, then replay the enter animation. */
function playCardEnter(el: HTMLElement, trigger: CardTrigger): void {
  if (trigger instanceof HTMLElement) setOriginFromTrigger(el, trigger);
  else if (trigger) setOriginFromPoint(el, trigger.x, trigger.y);
  playEnter(el, 'uni-origin-in');
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function GalaxyScene() {
  const lang = useLang(); // re-render on language change so all L() texts update
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const tourApiRef = useRef<{ start: () => void; stop: () => void }>({ start: () => {}, stop: () => {} });
  const [tourOn, setTourOn] = useState(false);
  const [stage, setStage] = useState(-1);
  const [webglFailed, setWebglFailed] = useState(false);
  const [showSunMarker, setShowSunMarker] = useState(true);
  const sunMarkerVisibleRef = useRef(true);
  const sunLabelRef = useRef<HTMLDivElement | null>(null);
  const [showArmLabels, setShowArmLabels] = useState(true);
  const armLabelsVisibleRef = useRef(true);
  const armLabelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [armCardOpen, setArmCardOpen] = useState(false);
  /* F28 — hover star inspector (content written straight to the DOM) */
  const hoverTipRef = useRef<HTMLDivElement | null>(null);
  /* F30 — personal star map */
  const [bookmarks, setBookmarks] = useState<StarBookmark[]>(() => loadBookmarks());
  const bookmarksRef = useRef<StarBookmark[]>(bookmarks);
  const bookmarksVersionRef = useRef(0);
  const bookmarkLabelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const bookmarkFlightRef = useRef<number | null>(null); // index into bookmarks
  const [bookmarkCardOpen, setBookmarkCardOpen] = useState(false);
  // F43 — Milky Way encyclopedia dossier
  const [galaxyCardOpen, setGalaxyCardOpen] = useState(false);
  /* F34 — export/import feedback line */
  const [bmMsg, setBmMsg] = useState<string | null>(null);
  const bmMsgTimer = useRef<number | null>(null);

  /* 一镜到底 — plumbing for the three dossier cards: keep each card mounted
     while it plays its exit animation, then unmount it for real. */
  const cardRefs = useRef<Record<CardKey, HTMLDivElement | null>>({ bookmark: null, arm: null, galaxy: null });
  const cardTriggerRef = useRef<Record<CardKey, CardTrigger>>({ bookmark: null, arm: null, galaxy: null });
  const cardOpenRef = useRef<Record<CardKey, boolean>>({ bookmark: false, arm: false, galaxy: false });
  const cardClosingRef = useRef<Record<CardKey, boolean>>({ bookmark: false, arm: false, galaxy: false });
  const cardCloseEpochRef = useRef<Record<CardKey, number>>({ bookmark: 0, arm: 0, galaxy: 0 });

  const setOpenCard = useCallback((key: CardKey, open: boolean) => {
    cardOpenRef.current[key] = open;
    if (key === 'bookmark') setBookmarkCardOpen(open);
    else if (key === 'arm') setArmCardOpen(open);
    else setGalaxyCardOpen(open);
  }, []);

  /** Collapse a card back into its opening trigger (原路缩回); unmount on done. */
  const closeCard = useCallback(
    (key: CardKey) => {
      if (!cardOpenRef.current[key]) return;
      const el = cardRefs.current[key];
      if (!el) {
        cardClosingRef.current[key] = false;
        setOpenCard(key, false);
        return;
      }
      cardClosingRef.current[key] = true;
      const trig = cardTriggerRef.current[key];
      if (trig instanceof HTMLElement) setOriginFromTrigger(el, trig);
      else if (trig) setOriginFromPoint(el, trig.x, trig.y);
      const epoch = ++cardCloseEpochRef.current[key];
      playExit(
        el,
        'uni-origin-out',
        () => {
          if (cardCloseEpochRef.current[key] !== epoch) return; // a reopen cancelled this close
          cardClosingRef.current[key] = false;
          setOpenCard(key, false);
        },
        380
      );
    },
    [setOpenCard]
  );

  /** Open a card from a trigger (element or click point); close the others in parallel. */
  const openCard = useCallback(
    (key: CardKey, trigger: CardTrigger) => {
      cardTriggerRef.current[key] = trigger;
      (['bookmark', 'arm', 'galaxy'] as const).forEach((k) => {
        if (k !== key) closeCard(k); // mutual exclusion — each card exits into its own origin
      });
      if (cardOpenRef.current[key]) {
        if (!cardClosingRef.current[key]) return; // already fully open
        // mid-close: cancel the pending close and replay the enter from the new origin
        cardCloseEpochRef.current[key]++;
        cardClosingRef.current[key] = false;
        const el = cardRefs.current[key];
        if (el) playCardEnter(el, trigger);
        return;
      }
      setOpenCard(key, true);
    },
    [closeCard, setOpenCard]
  );

  /** Trigger buttons toggle: open when closed, collapse back when open. */
  const toggleCard = useCallback(
    (key: CardKey, trigger: HTMLElement) => {
      if (cardOpenRef.current[key] && !cardClosingRef.current[key]) closeCard(key);
      else openCard(key, trigger);
    },
    [closeCard, openCard]
  );

  /* 一镜到底 — each dossier card plays its origin enter the moment it mounts */
  useIsoLayoutEffect(() => {
    if (!bookmarkCardOpen) return;
    const el = cardRefs.current.bookmark;
    if (el) playCardEnter(el, cardTriggerRef.current.bookmark);
  }, [bookmarkCardOpen]);
  useIsoLayoutEffect(() => {
    if (!armCardOpen) return;
    const el = cardRefs.current.arm;
    if (el) playCardEnter(el, cardTriggerRef.current.arm);
  }, [armCardOpen]);
  useIsoLayoutEffect(() => {
    if (!galaxyCardOpen) return;
    const el = cardRefs.current.galaxy;
    if (el) playCardEnter(el, cardTriggerRef.current.galaxy);
  }, [galaxyCardOpen]);

  /* ---- collapsible stats card (right-top MILKY WAY card) ---- */
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(PANEL_COLLAPSED_LS_KEY) === '1';
    } catch {
      return false; // SSR / private mode
    }
  });
  const [fabExiting, setFabExiting] = useState(false); // keeps the FAB mounted while it plays its exit
  const [statsFromFab, setStatsFromFab] = useState(false); // suppresses uni-anim-fade-up when expanding from the FAB
  const statsRef = useRef<HTMLDivElement | null>(null);
  const statsFabRef = useRef<HTMLButtonElement | null>(null);
  const statsCollapseBtnRef = useRef<HTMLButtonElement | null>(null);
  /* viewport anchor point for the 一镜到底 choreography (collapse button ↔ FAB) */
  const statsAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const statsFromFabRef = useRef(false); // next stats-card mount should play uni-origin-in from the FAB
  const fabEnterPendingRef = useRef(false); // next FAB mount should play uni-origin-in from the collapse point

  useEffect(() => {
    try {
      window.localStorage.setItem(PANEL_COLLAPSED_LS_KEY, panelCollapsed ? '1' : '0');
    } catch {
      /* private mode etc. */
    }
  }, [panelCollapsed]);

  /** The FAB mounts right after the card collapsed into the button — replay its origin-in. */
  useIsoLayoutEffect(() => {
    if (panelCollapsed && fabEnterPendingRef.current) {
      fabEnterPendingRef.current = false;
      const fab = statsFabRef.current;
      const p = statsAnchorRef.current;
      if (fab && p) {
        setOriginFromPoint(fab, p.x, p.y);
        playEnter(fab, 'uni-origin-in');
      }
    }
  }, [panelCollapsed]);

  /** The stats card mounts from the FAB point (一镜到底); first load keeps uni-anim-fade-up. */
  useIsoLayoutEffect(() => {
    if (!panelCollapsed && statsFromFabRef.current) {
      statsFromFabRef.current = false;
      const el = statsRef.current;
      const p = statsAnchorRef.current;
      if (el && p) {
        setOriginFromPoint(el, p.x, p.y);
        playEnter(el, 'uni-origin-in');
      }
    }
  }, [panelCollapsed]);

  /** Collapse: any open dossier card closes in parallel, then the card shrinks into the header button. */
  const handleCollapseStats = useCallback(() => {
    const btn = statsCollapseBtnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      statsAnchorRef.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    (['bookmark', 'arm', 'galaxy'] as const).forEach((k) => closeCard(k)); // no-op when nothing is open
    playEventSound('click');
    fabEnterPendingRef.current = true;
    const el = statsRef.current;
    if (!el) {
      setPanelCollapsed(true);
      return;
    }
    playExit(el, 'uni-origin-out', () => setPanelCollapsed(true), 380);
  }, [closeCard]);

  /** Expand: the FAB shrinks away while the card grows out of the same point. */
  const handleExpandStats = useCallback(() => {
    const fab = statsFabRef.current;
    if (fab) {
      const r = fab.getBoundingClientRect();
      statsAnchorRef.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      setFabExiting(true);
      playExit(fab, 'uni-origin-out', () => setFabExiting(false), 380);
    }
    playEventSound('click');
    statsFromFabRef.current = true;
    setStatsFromFab(true);
    setPanelCollapsed(false);
  }, []);

  const flashBmMsg = useCallback((text: string) => {
    setBmMsg(text);
    if (bmMsgTimer.current) window.clearTimeout(bmMsgTimer.current);
    bmMsgTimer.current = window.setTimeout(() => setBmMsg(null), 3200);
  }, []);

  useEffect(
    () => () => {
      if (bmMsgTimer.current) window.clearTimeout(bmMsgTimer.current);
    },
    []
  );

  /** F30 — add/remove/persist a bookmark (called from inside the render effect) */
  const commitBookmarks = useCallback((next: StarBookmark[]) => {
    bookmarksRef.current = next;
    bookmarksVersionRef.current++;
    saveBookmarks(next);
    setBookmarks(next);
  }, []);

  /* F34 — copy the collection JSON to the clipboard */
  const handleExportBookmarks = useCallback(async () => {
    const list = bookmarksRef.current;
    const en = getLang() === 'en';
    if (list.length === 0) {
      flashBmMsg(en ? 'Collection is empty — click stars on the canvas to bookmark them' : '收藏为空——先点击画面收藏几颗星吧');
      playEventSound('click');
      return;
    }
    const ok = await copyTextToClipboard(JSON.stringify(list));
    if (ok) {
      flashBmMsg(en ? `Copied profile JSON for ${list.length} stars` : `已复制 ${list.length} 颗星的档案 JSON`);
      playEventSound('success');
    } else {
      flashBmMsg(en ? 'Copy failed, please retry' : '复制失败，请重试');
      playEventSound('click');
    }
  }, [flashBmMsg]);

  /* F34 — read JSON from the clipboard and merge into the collection */
  const handleImportBookmarks = useCallback(async () => {
    const en = getLang() === 'en';
    let raw: string | null = null;
    try {
      if (navigator.clipboard?.readText) {
        raw = await navigator.clipboard.readText();
      }
    } catch {
      raw = null;
    }
    if (raw === null) {
      flashBmMsg(en ? 'Cannot read the clipboard (permission required or content empty)' : '无法读取剪贴板（需浏览器授权或内容为空）');
      playEventSound('click');
      return;
    }
    try {
      const arr: unknown = JSON.parse(raw);
      if (!Array.isArray(arr)) throw new Error('not an array');
      const cur = bookmarksRef.current.slice();
      const seen = new Set(cur.map((b) => b.id));
      let added = 0;
      for (const item of arr) {
        if (cur.length >= BOOKMARK_LIMIT) break;
        const bm = parseBookmark(item);
        if (!bm || seen.has(bm.id)) continue;
        seen.add(bm.id);
        cur.push(bm);
        added++;
      }
      if (added > 0) commitBookmarks(cur);
      flashBmMsg(added > 0 ? (en ? `Imported ${added} new stars` : `已导入 ${added} 颗新星`) : en ? 'No new stars to import (duplicates or invalid)' : '没有可导入的新星（重复或无效）');
      playEventSound(added > 0 ? 'success' : 'click');
    } catch {
      flashBmMsg(en ? 'Import failed: the clipboard content is not valid star-map JSON' : '导入失败：剪贴板内容不是有效的星图 JSON');
      playEventSound('click');
    }
  }, [flashBmMsg, commitBookmarks]);

  useEffect(() => {
    armLabelsVisibleRef.current = showArmLabels;
    if (!showArmLabels) {
      armLabelRefs.current.forEach((el) => {
        if (el) el.style.display = 'none';
      });
    }
  }, [showArmLabels]);

  useEffect(() => {
    sunMarkerVisibleRef.current = showSunMarker;
    if (!showSunMarker && sunLabelRef.current) sunLabelRef.current.style.display = 'none';
  }, [showSunMarker]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      // async so React does not cascade-render synchronously inside the effect body
      queueMicrotask(() => setWebglFailed(true));
      return;
    }

    const baseDpr = Math.min(window.devicePixelRatio || 1, 2);
    let pixelRatio = baseDpr;
    renderer.setPixelRatio(pixelRatio);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x020208, 1);
    renderer.domElement.style.display = 'block';
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020208);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    camera.position.set(0, 95, 62);
    camera.lookAt(0, 0, 0);

    const galaxy = new THREE.Group();
    scene.add(galaxy);

    /* ---------------- star field: 120k GPU points ---------------- */

    const rand = mulberry32(1337);
    const gauss = makeGauss(rand);
    const col = new THREE.Color();

    const starPos = new Float32Array(STAR_COUNT * 3);
    const starCol = new Float32Array(STAR_COUNT * 3);
    const starSize = new Float32Array(STAR_COUNT);
    const starPhase = new Float32Array(STAR_COUNT);
    /* F28 — hover inspector metadata */
    const starTemp = new Float32Array(STAR_COUNT);
    const starType = new Uint8Array(STAR_COUNT); // 0 bulge / 1 disk field / 2 ridge hot / 3 giant
    const starArm = new Uint8Array(STAR_COUNT); // 255 = bulge, else arm index

    for (let i = 0; i < STAR_COUNT; i++) {
      const i3 = i * 3;
      let x: number;
      let y: number;
      let z: number;
      let rXZ: number;
      let ridge = false;
      let arm = 0;
      const bulge = rand() < 0.18;

      if (bulge) {
        // central bulge: flattened gaussian ball
        x = gauss() * 9;
        z = gauss() * 9;
        y = gauss() * 9 * 0.55;
        rXZ = Math.sqrt(x * x + z * z);
      } else {
        // exponential disk sampled onto 4 log-spiral arms
        let r = -Math.log(1 - rand()) * 24;
        r = r < 3 ? 3 : r > GALAXY_R_MAX ? GALAXY_R_MAX : r;
        arm = Math.floor(rand() * ARM_COUNT);
        const baseAngle = arm * (Math.PI / 2);
        const jitter = gauss() * (0.16 + 0.1 * (r / GALAXY_R_MAX)) * 2.2;
        ridge = Math.abs(jitter) < 0.16; // tight around arm centerline = ridge
        const angle = baseAngle + Math.log(Math.max(r, 1) / 4) / PITCH_TAN + jitter;
        r += gauss() * 2; // small radial jitter
        x = Math.cos(angle) * r;
        z = Math.sin(angle) * r;
        y = gauss() * (0.7 + 5.5 * Math.exp(-r / 26));
        rXZ = r;
      }

      starPos[i3] = x;
      starPos[i3 + 1] = y;
      starPos[i3 + 2] = z;

      // temperature by region
      let temp: number;
      if (bulge || rXZ < 12) {
        temp = 2600 + Math.pow(rand(), 2.2) * 4200; // old red-yellow core/inner disk
      } else if (ridge) {
        temp = rand() < 0.3 ? 8000 + rand() * 5000 : 3800 + rand() * 4200; // hot young on ridges
      } else {
        temp = 3000 + Math.pow(rand(), 1.5) * 5200; // mixed field
      }
      tempToColor(temp, col);

      let size: number;
      if (rand() < 0.04) {
        // giants: bigger and color-saturated
        size = 2.2 + rand() * 1.4;
        saturateColor(col, 1.7);
        col.multiplyScalar(1.5);
      } else {
        size = 0.55 + Math.pow(rand(), 1.8) * 0.95;
        if (ridge) col.multiplyScalar(1.3); // brighten arm ridges
      }

      starCol[i3] = col.r;
      starCol[i3 + 1] = col.g;
      starCol[i3 + 2] = col.b;
      starSize[i] = size;
      starPhase[i] = rand() * Math.PI * 2;
      /* F28 — science metadata for the hover inspector */
      starTemp[i] = temp;
      starType[i] = bulge ? 0 : ridge && temp >= 8000 ? 2 : size >= 2.2 ? 3 : 1;
      starArm[i] = bulge ? 255 : arm;
    }

    /* F28 — uniform grid over the XZ plane so hover queries touch a handful of cells */
    const HOVER_CELL = 8;
    const HOVER_GRID_N = Math.ceil(GALAXY_R_MAX / HOVER_CELL) + 1; // cells per axis
    const hoverGrid = new Map<number, number[]>();
    for (let i = 0; i < STAR_COUNT; i++) {
      const gx = Math.floor((starPos[i * 3] + GALAXY_R_MAX) / HOVER_CELL);
      const gz = Math.floor((starPos[i * 3 + 2] + GALAXY_R_MAX) / HOVER_CELL);
      const key = gx * HOVER_GRID_N + gz;
      const bucket = hoverGrid.get(key);
      if (bucket) bucket.push(i);
      else hoverGrid.set(key, [i]);
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhase, 1));

    const starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });

    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    stars.renderOrder = 0;
    // perf: local transform never changes (only the parent galaxy group spins)
    stars.matrixAutoUpdate = false;
    stars.updateMatrix();
    galaxy.add(stars);

    /* ---------------- dark dust lanes: 26k GPU points ---------------- */

    const dustPos = new Float32Array(DUST_COUNT * 3);
    const dustSize = new Float32Array(DUST_COUNT);

    for (let i = 0; i < DUST_COUNT; i++) {
      const i3 = i * 3;
      let r = -Math.log(1 - rand()) * 24;
      r = r < 6 ? 6 : r > 96 ? 96 : r;
      const arm = Math.floor(rand() * ARM_COUNT);
      const baseAngle = arm * (Math.PI / 2);
      // shifted inward ~0.22 rad along the arm, narrower jitter, thinner y
      const jitter = gauss() * (0.16 + 0.1 * (r / GALAXY_R_MAX)) * 1.35;
      const angle = baseAngle + Math.log(Math.max(r, 1) / 4) / PITCH_TAN - 0.22 + jitter;
      r += gauss() * 1.6;
      dustPos[i3] = Math.cos(angle) * r;
      dustPos[i3 + 1] = gauss() * (0.7 + 5.5 * Math.exp(-r / 26)) * 0.4;
      dustPos[i3 + 2] = Math.sin(angle) * r;
      dustSize[i] = 2 + rand() * 3;
    }

    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dustSize, 1));

    const dustMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });

    const dust = new THREE.Points(dustGeo, dustMat);
    dust.frustumCulled = false;
    dust.renderOrder = 1; // above stars so it darkens them
    // perf: static local transform — skip per-frame matrix compose
    dust.matrixAutoUpdate = false;
    dust.updateMatrix();
    galaxy.add(dust);

    /* ---------------- glowing galactic core sprites ---------------- */

    const coreTexA = makeGlowTexture([
      [0.0, 'rgba(255,255,255,1)'],
      [0.16, 'rgba(255,244,222,0.85)'],
      [0.4, 'rgba(255,206,132,0.30)'],
      [0.72, 'rgba(255,172,96,0.08)'],
      [1.0, 'rgba(255,160,84,0)'],
    ]);
    const coreTexB = makeGlowTexture([
      [0.0, 'rgba(255,236,204,0.55)'],
      [0.3, 'rgba(255,202,132,0.22)'],
      [0.68, 'rgba(255,172,102,0.06)'],
      [1.0, 'rgba(255,160,92,0)'],
    ]);
    const haloTex = makeGlowTexture([
      [0.0, 'rgba(214,186,255,0.30)'],
      [0.34, 'rgba(172,142,255,0.11)'],
      [0.7, 'rgba(142,112,232,0.035)'],
      [1.0, 'rgba(124,102,224,0)'],
    ]);

    const mkSprite = (tex: THREE.CanvasTexture, scale: number, opacity: number): THREE.Sprite => {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity,
      });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(scale, scale, 1);
      // perf: core glow sprites are static — skip per-frame matrix compose
      sp.matrixAutoUpdate = false;
      sp.updateMatrix();
      sp.renderOrder = 2;
      galaxy.add(sp);
      return sp;
    };

    const spriteCore = mkSprite(coreTexA, 14, 1);
    const spriteMid = mkSprite(coreTexB, 34, 1);
    const spriteHalo = mkSprite(haloTex, 55, 0.75);

    /* -------- Sun position marker on the Orion arm (F7 science layer) -------- */
    const SUN_R = 53; // ≈ 26,000 ly ≈ 53% of the modelled disk radius
    const sunAngle = Math.log(SUN_R / 4) / 0.23; // arm-0 ridge, same log-spiral law as the stars
    const sunMarker = new THREE.Group();
    sunMarker.position.set(Math.cos(sunAngle) * SUN_R, 0.6, Math.sin(sunAngle) * SUN_R);
    // perf: the marker's local transform never changes (only the ring child pulses)
    sunMarker.matrixAutoUpdate = false;
    sunMarker.updateMatrix();
    const sunDotGeo = new THREE.SphereGeometry(0.55, 16, 12);
    const sunDotMat = new THREE.MeshBasicMaterial({ color: 0xffd57a });
    const sunDot = new THREE.Mesh(sunDotGeo, sunDotMat);
    sunDot.matrixAutoUpdate = false;
    sunDot.updateMatrix();
    sunMarker.add(sunDot);
    const markerRingTex = makeGlowTexture([
      [0.0, 'rgba(255,205,110,0)'],
      [0.52, 'rgba(255,205,110,0)'],
      [0.62, 'rgba(255,215,140,0.9)'],
      [0.7, 'rgba(255,232,180,1)'],
      [0.78, 'rgba(255,215,140,0.9)'],
      [0.88, 'rgba(255,205,110,0)'],
      [1.0, 'rgba(255,205,110,0)'],
    ]);
    const markerRingMat = new THREE.SpriteMaterial({
      map: markerRingTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const sunMarkerRing = new THREE.Sprite(markerRingMat);
    sunMarkerRing.scale.set(5, 5, 1);
    sunMarker.add(sunMarkerRing);
    galaxy.add(sunMarker); // rotates together with the disk

    /* -------- spiral-arm markers + labels (F12 science layer) -------- */
    const armGlowTex = makeGlowTexture([
      [0.0, 'rgba(255,255,255,0.95)'],
      [0.3, 'rgba(255,255,255,0.4)'],
      [1.0, 'rgba(255,255,255,0)'],
    ]);
    const armMarkerSprites: THREE.Sprite[] = [];
    for (const spec of ARM_SPECS) {
      const ang = spec.arm * (Math.PI / 2) + Math.log(Math.max(spec.r, 1) / 4) / PITCH_TAN;
      const mat = new THREE.SpriteMaterial({
        map: armGlowTex,
        color: new THREE.Color(spec.color),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.95,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(Math.cos(ang) * spec.r, 0.5, Math.sin(ang) * spec.r);
      sp.scale.set(3.4, 3.4, 1);
      // perf: arm markers are static — skip per-frame matrix compose
      sp.matrixAutoUpdate = false;
      sp.updateMatrix();
      galaxy.add(sp);
      armMarkerSprites.push(sp);
    }

    /* ---------------- camera controls ---------------- */

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.minDistance = 4;
    controls.maxDistance = 260;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.target.set(0, 0, 0);
    controls.update();

    /* ---------------- resize handling ---------------- */

    const applyUniformScale = (hCss: number) => {
      const s = hCss * pixelRatio * 0.75; // renderHeight * 0.75
      starMat.uniforms.uScale.value = s;
      dustMat.uniforms.uScale.value = s;
    };

    const onResize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      applyUniformScale(h);
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(wrap);

    const unsubQuality = onRenderScaleChange((scale) => {
      pixelRatio = baseDpr * scale;
      renderer.setPixelRatio(pixelRatio);
      onResize();
    });

    /* ---------------- three-stage auto tour ---------------- */

    const clock = new THREE.Clock();
    let lastT = 0;
    let raf = 0;
    let tourActive = false;
    let tourStart = 0;
    let tourKeys: TourKey[] = [];
    let stageShown = -1;
    const lastLook = new THREE.Vector3(0, 0, 0);
    const tmpPos = new THREE.Vector3();
    const tmpLook = new THREE.Vector3();
    const markerWorld = new THREE.Vector3();

    const resetBars = () => {
      for (let i = 0; i < 3; i++) {
        const el = barRefs.current[i];
        if (el) el.style.transform = 'scaleX(0)';
      }
    };

    const stopTour = () => {
      if (!tourActive) return;
      tourActive = false;
      stageShown = -1;
      controls.target.copy(lastLook); // seamless takeover, no view snap
      controls.enabled = true;
      controls.update();
      setTourOn(false);
      setStage(-1);
      resetBars();
    };

    /* F30 — camera flight to a bookmarked star (UI → loop bridge) */
    const bmFlightFrom = new THREE.Vector3();
    const bmFlightTo = new THREE.Vector3();
    const bmFlightFromTgt = new THREE.Vector3();
    const bmFlightToTgt = new THREE.Vector3();
    let bmFlightT = 1; // 1 = idle
    const tmpBmWorld = new THREE.Vector3();
    const tmpBmDir = new THREE.Vector3();
    const cancelBmFlight = () => {
      if (bmFlightT < 1) {
        bmFlightT = 1;
        controls.enabled = true;
      }
    };

    const startTour = () => {
      if (tourActive) return;
      tourActive = true;
      cancelBmFlight(); // F30 — the tour overrides the flight
      controls.enabled = false;
      tourKeys = buildTourKeys(camera.position, controls.target);
      tourStart = clock.getElapsedTime();
      stageShown = 0;
      setTourOn(true);
      setStage(0);
    };

    tourApiRef.current = { start: startTour, stop: stopTour };

    const canvas = renderer.domElement;
    const onUserGrab = () => stopTour(); // any pointerdown / wheel cancels the tour
    canvas.addEventListener('pointerdown', onUserGrab);
    canvas.addEventListener('wheel', onUserGrab, { passive: true });

    /* ------- F28 — hover star inspector: ray→disk plane, nearest star via uniform grid ------- */
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const hoverPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // galactic plane y=0
    const hoverHit = new THREE.Vector3();
    /* i18n — these run inside the render loop / event callbacks, so pick the language at call time */
    const spectralOf = (t: number): string => {
      if (getLang() === 'en') {
        if (t < 3700) return 'M type · red star';
        if (t < 5200) return 'K type · orange star';
        if (t < 6000) return 'G type · yellow star (Sun-like)';
        if (t < 7500) return 'F type · yellow-white star';
        if (t < 10000) return 'A type · white star';
        return 'B type · blue-white star';
      }
      if (t < 3700) return 'M 型 · 红星';
      if (t < 5200) return 'K 型 · 橙星';
      if (t < 6000) return 'G 型 · 黄星（太阳同类）';
      if (t < 7500) return 'F 型 · 黄白星';
      if (t < 10000) return 'A 型 · 白星';
      return 'B 型 · 蓝白星';
    };
    const typeOf = (k: number): string => {
      if (getLang() === 'en') {
        return k === 0 ? 'Old bulge star' : k === 2 ? 'Young hot ridge star' : k === 3 ? 'Giant star' : 'Disk field star';
      }
      return k === 0 ? '核球老年星' : k === 2 ? '旋臂脊线年轻热星' : k === 3 ? '巨星' : '盘场恒星';
    };
    const armNameOf = (idx: number): string => {
      const en = getLang() === 'en';
      if (idx === 255) return en ? 'Central Bulge' : '核球区';
      const spec = ARM_SPECS[idx];
      if (!spec) return en ? 'Disk Field' : '盘场';
      return en ? spec.nameEn : spec.name;
    };
    let hoverT = 0;
    let hoverBestIdx = -1; // F30 — exposed for the click-to-bookmark handler
    let hoverPointer: { x: number; y: number } | null = null; // css px inside the wrap
    const onHoverMove = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      hoverPointer = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const onHoverLeave = () => {
      hoverPointer = null;
      hoverBestIdx = -1;
      const tip = hoverTipRef.current;
      if (tip) tip.style.display = 'none';
    };
    canvas.addEventListener('pointermove', onHoverMove, { passive: true });
    canvas.addEventListener('pointerleave', onHoverLeave);

    /* F30 — bookmark the currently-hovered star on a clean click (< 6 px move) */
    let downX = 0;
    let downY = 0;
    const onBookDown = (ev: PointerEvent) => {
      downX = ev.clientX;
      downY = ev.clientY;
    };
    const onBookUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downX, ev.clientY - downY) >= 6) return;
      const i = hoverBestIdx;
      if (i < 0) return;
      const list = bookmarksRef.current;
      if (list.length >= BOOKMARK_LIMIT) return; // full — UI shows the hint
      const rGal = Math.hypot(starPos[i * 3], starPos[i * 3 + 2]) * 0.05; // 万光年
      const spectral = spectralOf(starTemp[i]);
      const bm: StarBookmark = {
        id: `${Date.now()}-${i}`,
        name: (getLang() === 'en' ? STAR_NAMES_EN : STAR_NAMES)[list.length % STAR_NAMES.length],
        temp: starTemp[i],
        rGal,
        spectral,
        typeName: typeOf(starType[i]),
        armName: armNameOf(starArm[i]),
        x: starPos[i * 3],
        y: starPos[i * 3 + 1],
        z: starPos[i * 3 + 2],
      };
      commitBookmarks([...list, bm]);
      playEventSound('success');
      // F38 — fly the camera in to the freshly-bookmarked star (dossier was on screen)
      tmpBmWorld.set(bm.x, bm.y, bm.z).applyMatrix4(galaxy.matrixWorld);
      tmpBmDir.copy(camera.position).sub(tmpBmWorld).normalize();
      bmFlightFrom.copy(camera.position);
      bmFlightFromTgt.copy(controls.target);
      bmFlightTo.copy(tmpBmWorld).addScaledVector(tmpBmDir, 7);
      bmFlightTo.y = Math.max(bmFlightTo.y, tmpBmWorld.y + 1.5);
      bmFlightToTgt.copy(tmpBmWorld);
      bmFlightT = 0;
      controls.enabled = false;
    };
    canvas.addEventListener('pointerdown', onBookDown);
    canvas.addEventListener('pointerup', onBookUp);
    // F38-fix — the flight previously couldn't be interrupted by drag/zoom
    canvas.addEventListener('pointerdown', cancelBmFlight);
    canvas.addEventListener('wheel', cancelBmFlight, { passive: true });

    /* F30 — bookmark markers: rebuilt when the collection version changes */
    const bookmarkTex = makeGlowTexture([
      [0.0, 'rgba(255,240,200,0)'],
      [0.55, 'rgba(255,214,130,0)'],
      [0.68, 'rgba(255,220,150,0.95)'],
      [0.74, 'rgba(255,240,210,1)'],
      [0.8, 'rgba(255,220,150,0.95)'],
      [0.92, 'rgba(255,214,130,0)'],
      [1.0, 'rgba(255,240,200,0)'],
    ]);
    const bookmarkSprites: THREE.Sprite[] = [];
    let markerVersion = -1;
    const syncBookmarkSprites = () => {
      const v = bookmarksVersionRef.current;
      if (v === markerVersion) return;
      markerVersion = v;
      for (const sp of bookmarkSprites) {
        galaxy.remove(sp);
        sp.material.dispose();
      }
      bookmarkSprites.length = 0;
      for (const bm of bookmarksRef.current) {
        const mat = new THREE.SpriteMaterial({
          map: bookmarkTex,
          color: 0xffd57a,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        });
        const sp = new THREE.Sprite(mat);
        sp.position.set(bm.x, bm.y, bm.z);
        sp.scale.set(2.8, 2.8, 1);
        sp.renderOrder = 2;
        galaxy.add(sp);
        bookmarkSprites.push(sp);
      }
    };

    const applyTour = (tau: number) => {
      const keys = tourKeys;
      const last = keys[keys.length - 1];
      if (tau >= last.t) {
        tmpPos.copy(last.p);
        tmpLook.copy(last.l);
      } else {
        let a = keys[0];
        let b = last;
        for (let i = 0; i < keys.length - 1; i++) {
          if (tau >= keys[i].t && tau <= keys[i + 1].t) {
            a = keys[i];
            b = keys[i + 1];
            break;
          }
        }
        const span = Math.max(b.t - a.t, 1e-4);
        const x = Math.min(Math.max((tau - a.t) / span, 0), 1);
        const e = easeInOutCubic(x);
        tmpPos.copy(a.p).lerp(b.p, e);
        tmpLook.copy(a.l).lerp(b.l, e);
      }
      camera.position.copy(tmpPos);
      camera.lookAt(tmpLook);
      lastLook.copy(tmpLook);
    };

    /* ---------------- render loop ---------------- */

    const fps = createFpsMeter();
    let chipFrame = 0; // perf: DOM chip projection runs every other frame (30 Hz, visually identical)

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const dt = Math.min(t - lastT, 0.1);
      lastT = t;
      chipFrame++;
      const updateChips = chipFrame % 2 === 0;

      galaxy.rotation.y += SPIN_RATE * dt;
      starMat.uniforms.uTime.value = t;

      // F30 — rebuild bookmark markers when the collection changed; pulse them
      syncBookmarkSprites();
      const bmPulse = 2.8 + Math.sin(t * 2.2) * 0.35;
      for (let i = 0; i < bookmarkSprites.length; i++) {
        bookmarkSprites[i].scale.set(bmPulse, bmPulse, 1);
      }

      // pulsing ring + projected DOM label for the Sun marker
      const ringS = 4.6 + Math.sin(t * 2.6) * 0.9;
      sunMarkerRing.scale.set(ringS, ringS, 1);
      const sw = wrap.clientWidth;
      const sh = Math.max(1, wrap.clientHeight);
      const sunEl = sunLabelRef.current;
      if (updateChips && sunEl) {
        if (sunMarkerVisibleRef.current) {
          sunMarker.getWorldPosition(markerWorld);
          markerWorld.project(camera);
          if (markerWorld.z > 1 || markerWorld.z < -1) {
            sunEl.style.display = 'none';
          } else {
            // viewport-edge clamp: keep the label clear of the top nav
            const lx = Math.min(Math.max((markerWorld.x * 0.5 + 0.5) * sw, 46), sw - 46);
            const ly = Math.min(Math.max((-markerWorld.y * 0.5 + 0.5) * sh, 74), sh - 30);
            sunEl.style.display = 'block';
            sunEl.style.transform =
              'translate3d(' + lx.toFixed(1) + 'px,' + ly.toFixed(1) + 'px,0) translate(-50%,-140%)';
          }
        }
      }

      // projected DOM labels for spiral-arm markers (F12)
      if (updateChips && armLabelsVisibleRef.current) {
        for (let i = 0; i < ARM_SPECS.length; i++) {
          const el = armLabelRefs.current[i];
          if (!el) continue;
          const sp = armMarkerSprites[i];
          if (!sp) continue;
          sp.getWorldPosition(markerWorld);
          markerWorld.project(camera);
          if (markerWorld.z > 1 || markerWorld.z < -1) {
            el.style.display = 'none';
            continue;
          }
          const lx = Math.min(Math.max((markerWorld.x * 0.5 + 0.5) * sw, 50), sw - 50);
          const ly = Math.min(Math.max((-markerWorld.y * 0.5 + 0.5) * sh, 76), sh - 30);
          el.style.display = 'flex';
          el.style.transform =
            'translate3d(' + lx.toFixed(1) + 'px,' + ly.toFixed(1) + 'px,0) translate(-50%,-50%)';
        }
      }

      if (tourActive) {
        const tau = t - tourStart;
        applyTour(tau);
        const idx = tau < STAGE_LEN ? 0 : tau < 2 * STAGE_LEN ? 1 : 2;
        if (idx !== stageShown) {
          stageShown = idx;
          setStage(idx);
        }
        const p = Math.min(Math.max((tau - idx * STAGE_LEN) / STAGE_LEN, 0), 1);
        for (let i = 0; i < 3; i++) {
          const el = barRefs.current[i];
          if (!el) continue;
          const v = i < idx ? 1 : i > idx ? 0 : p;
          el.style.transform = 'scaleX(' + v.toFixed(4) + ')';
        }
        if (tau >= TOUR_DURATION) stopTour();
      } else {
        // F30 — start a requested bookmark flight, then run the tween
        const bmReq = bookmarkFlightRef.current;
        if (bmReq !== null) {
          bookmarkFlightRef.current = null;
          const sp = bookmarkSprites[bmReq];
          if (sp) {
            sp.getWorldPosition(tmpBmWorld);
            tmpBmDir.copy(camera.position).sub(controls.target).normalize();
            bmFlightFrom.copy(camera.position);
            bmFlightFromTgt.copy(controls.target);
            bmFlightTo.copy(tmpBmWorld).addScaledVector(tmpBmDir, 7);
            bmFlightTo.y = Math.max(bmFlightTo.y, tmpBmWorld.y + 1.5);
            bmFlightToTgt.copy(tmpBmWorld);
            bmFlightT = 0;
            controls.enabled = false;
          }
        }
        if (bmFlightT < 1) {
          bmFlightT = Math.min(1, bmFlightT + dt / 1.5);
          const fs =
            bmFlightT < 0.5
              ? 4 * bmFlightT * bmFlightT * bmFlightT
              : 1 - Math.pow(-2 * bmFlightT + 2, 3) / 2;
          camera.position.lerpVectors(bmFlightFrom, bmFlightTo, fs);
          controls.target.lerpVectors(bmFlightFromTgt, bmFlightToTgt, fs);
          if (bmFlightT >= 1) controls.enabled = true;
        }
        controls.update();
      }

      // F30 — projected DOM chips for bookmarked stars
      if (updateChips && bookmarkSprites.length > 0) {
        for (let i = 0; i < bookmarkSprites.length; i++) {
          const el = bookmarkLabelRefs.current[i];
          if (!el) continue;
          bookmarkSprites[i].getWorldPosition(markerWorld);
          markerWorld.project(camera);
          if (markerWorld.z > 1 || markerWorld.z < -1) {
            el.style.display = 'none';
            continue;
          }
          const lx = Math.min(Math.max((markerWorld.x * 0.5 + 0.5) * sw, 40), sw - 40);
          const ly = Math.min(Math.max((-markerWorld.y * 0.5 + 0.5) * sh, 74), sh - 30);
          el.style.display = 'inline-flex';
          el.style.transform =
            'translate3d(' + lx.toFixed(1) + 'px,' + ly.toFixed(1) + 'px,0) translate(-50%,-160%)';
        }
      }

      /* F28 — hover star inspector (~5.5 Hz throttled, grid lookup is O(bucket)) */
      hoverT += dt;
      const tip = hoverTipRef.current;
      if (tip && hoverPointer && !tourActive && hoverT >= 0.18) {
        hoverT = 0;
        pointerNdc.set((hoverPointer.x / sw) * 2 - 1, -(hoverPointer.y / sh) * 2 + 1);
        raycaster.setFromCamera(pointerNdc, camera);
        if (raycaster.ray.intersectPlane(hoverPlane, hoverHit)) {
          // world → star-local: undo the disk spin (R_y inverse)
          const rot = galaxy.rotation.y;
          const c = Math.cos(rot);
          const s = Math.sin(rot);
          const lx = hoverHit.x * c - hoverHit.z * s;
          const lz = hoverHit.x * s + hoverHit.z * c;
          const gx = Math.floor((lx + GALAXY_R_MAX) / HOVER_CELL);
          const gz = Math.floor((lz + GALAXY_R_MAX) / HOVER_CELL);
          let best = -1;
          let bestD2 = Infinity;
          const tol = Math.max(1.6, camera.position.distanceTo(controls.target) * 0.045);
          const tol2 = tol * tol;
          for (let ax = gx - 1; ax <= gx + 1; ax++) {
            for (let az = gz - 1; az <= gz + 1; az++) {
              const bucket = hoverGrid.get(ax * HOVER_GRID_N + az);
              if (!bucket) continue;
              for (let k = 0; k < bucket.length; k++) {
                const si = bucket[k];
                const dx = starPos[si * 3] - lx;
                const dy = starPos[si * 3 + 1] - hoverHit.y;
                const dz = starPos[si * 3 + 2] - lz;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < bestD2) {
                  bestD2 = d2;
                  best = si;
                }
              }
            }
          }
          if (best >= 0 && bestD2 <= tol2) {
            hoverBestIdx = best;
            // local → world: re-apply the spin for observer distance
            const sx = starPos[best * 3];
            const sz = starPos[best * 3 + 2];
            const wx = sx * c + sz * s;
            const wz = -sx * s + sz * c;
            const wy = starPos[best * 3 + 1];
            const rGal = Math.hypot(sx, sz) * 500; // 1 scene unit = 500 ly (disk r=100 ↔ 5万光年)
            const en = getLang() === 'en';
            const armTxt = armNameOf(starArm[best]);
            const dObs = camera.position.distanceTo(tmpPos.set(wx, wy, wz)) * 500;
            const dObsTxt = en
              ? `≈ ${Math.round(dObs).toLocaleString('en-US')} ly`
              : dObs >= 10000
                ? `≈ ${(dObs / 10000).toFixed(1)} 万光年`
                : `≈ ${Math.round(dObs)} 光年`;
            const distCenterTxt = en ? `≈ ${fmtWanToLy(rGal)} from center` : `距银心 ≈ ${(rGal / 10000).toFixed(1)} 万光年`;
            tip.innerHTML =
              `<div class="text-[11px] font-semibold text-zinc-100">${spectralOf(starTemp[best])}</div>` +
              `<div class="mt-0.5 text-[10px] text-zinc-400">${typeOf(starType[best])} · ${armTxt} · ${distCenterTxt}</div>` +
              `<div class="text-[9px] text-zinc-500">${en ? `${dObsTxt} from observer` : `距观察者 ${dObsTxt}`} · ${en ? 'Surface temp' : '表面温度'} ~${Math.round(starTemp[best]).toLocaleString('en-US')} K</div>`;
            tip.style.display = 'block';
            const tx = Math.min(Math.max(hoverPointer.x + 14, 8), sw - 190);
            const ty = Math.min(Math.max(hoverPointer.y + 14, 8), sh - 76);
            tip.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`;
          } else {
            hoverBestIdx = -1;
            tip.style.display = 'none';
          }
        } else {
          hoverBestIdx = -1;
          tip.style.display = 'none';
        }
      }

      fps.tick();
      renderer.render(scene, camera);
    };
    /* ---------------- screenshot capture registration (F3) ---------------- */
    registerCapturer(() => {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    });

    raf = requestAnimationFrame(animate);

    /* ---------------- cleanup ---------------- */

    return () => {
      cancelAnimationFrame(raf);
      fps.dispose();
      registerCapturer(null);
      unsubQuality();
      canvas.removeEventListener('pointerdown', onUserGrab);
      canvas.removeEventListener('wheel', onUserGrab);
      canvas.removeEventListener('pointermove', onHoverMove);
      canvas.removeEventListener('pointerleave', onHoverLeave);
      canvas.removeEventListener('pointerdown', onBookDown);
      canvas.removeEventListener('pointerup', onBookUp);
      canvas.removeEventListener('pointerdown', cancelBmFlight);
      canvas.removeEventListener('wheel', cancelBmFlight);
      hoverGrid.clear();
      bookmarkTex.dispose();
      for (const sp of bookmarkSprites) sp.material.dispose();
      bookmarkSprites.length = 0;
      ro.disconnect();
      controls.dispose();
      starGeo.dispose();
      starMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      sunDotGeo.dispose();
      sunDotMat.dispose();
      markerRingTex.dispose();
      markerRingMat.dispose();
      armGlowTex.dispose();
      for (const sp of armMarkerSprites) sp.material.dispose();
      for (const sp of [spriteCore, spriteMid, spriteHalo]) {
        sp.material.map?.dispose();
        sp.material.dispose();
      }
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      tourApiRef.current = { start: () => {}, stop: () => {} };
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      {webglFailed ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <div className="rounded-2xl border border-white/10 bg-black/45 px-6 py-5 text-center backdrop-blur-xl">
            <p className="text-sm font-medium text-zinc-200">{L('WebGL 初始化失败', 'WebGL initialization failed')}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
              {L('当前浏览器或设备不支持 WebGL，无法渲染银河系场景', 'Your browser or device does not support WebGL, so the galaxy scene cannot be rendered')}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* top-right stats card (collapsible) */}
          {!panelCollapsed && (
            <div
              ref={statsRef}
              className={cn(
                'absolute right-4 top-20 z-20 w-[190px] rounded-2xl border border-white/10 bg-black/45 p-3 backdrop-blur-xl portrait:right-3 portrait:top-[138px]',
                !statsFromFab && 'uni-anim-fade-up'
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <p className="text-[10px] font-semibold tracking-[0.28em] text-zinc-500">MILKY WAY</p>
                <button
                  ref={statsCollapseBtnRef}
                  type="button"
                  onClick={handleCollapseStats}
                  aria-label={L('收起统计卡', 'Collapse stats')}
                  title={L('收起统计卡', 'Collapse stats')}
                  className="-mr-1 rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
                >
                  <PanelRightClose className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
                <span className="text-[11px] text-zinc-200">{L('120,000 颗恒星', '120,000 stars')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Orbit className="h-3.5 w-3.5 shrink-0 text-violet-300" aria-hidden />
                <span className="text-[11px] text-zinc-200">{L('4 条对数螺旋旋臂', '4 log-spiral arms')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
                <span className="text-[11px] text-zinc-200">{L('GPU Points 渲染', 'GPU Points rendering')}</span>
              </div>
            </div>
            <p className="mt-2.5 border-t border-white/5 pt-2 text-[10px] leading-relaxed text-zinc-500">
              {L('拖拽旋转 · 滚轮缩放 · 悬停银盘看恒星档案 · 点击收藏', 'Drag to rotate · Scroll to zoom · Hover the disk for star profiles · Click to bookmark')}
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2">
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-amber-300" aria-hidden />
                <span className="text-[11px] text-zinc-200">{L('太阳位置', 'Sun position')}</span>
              </div>
              <Switch
                checked={showSunMarker}
                onCheckedChange={setShowSunMarker}
                aria-label={L('显示太阳位置标记', 'Show Sun position marker')}
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Orbit className="h-3.5 w-3.5 text-violet-300" aria-hidden />
                <span className="text-[11px] text-zinc-200">{L('旋臂标注', 'Arm labels')}</span>
              </div>
              <Switch
                checked={showArmLabels}
                onCheckedChange={setShowArmLabels}
                aria-label={L('显示旋臂标注', 'Show arm labels')}
              />
            </div>
            <button
              type="button"
              onClick={(e) => toggleCard('arm', e.currentTarget)}
              aria-expanded={armCardOpen}
              className={cn(
                'mt-2.5 flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-lg border text-[11px] font-medium transition-all duration-200 [@media(pointer:coarse)]:min-h-[40px]',
                armCardOpen
                  ? 'border-violet-300/40 bg-violet-300/15 text-violet-200'
                  : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-violet-300/30 hover:text-violet-200'
              )}
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
              {L('旋臂档案', 'Spiral arm profiles')}
            </button>
            {/* F43 — Milky Way encyclopedia dossier */}
            <button
              type="button"
              onClick={(e) => {
                toggleCard('galaxy', e.currentTarget);
                playEventSound('click'); // F23
              }}
              aria-expanded={galaxyCardOpen}
              className={cn(
                'mt-1.5 flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-lg border text-[11px] font-medium transition-all duration-200 [@media(pointer:coarse)]:min-h-[40px]',
                galaxyCardOpen
                  ? 'border-teal-300/40 bg-teal-300/15 text-teal-200'
                  : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-teal-300/30 hover:text-teal-200'
              )}
            >
              <Telescope className="h-3.5 w-3.5" aria-hidden />
              {L('银河系档案', 'Milky Way fact sheet')}
            </button>
            {/* F30 — open the personal star map */}
            <button
              type="button"
              onClick={(e) => toggleCard('bookmark', e.currentTarget)}
              aria-expanded={bookmarkCardOpen}
              className={cn(
                'mt-1.5 flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-lg border text-[11px] font-medium transition-all duration-200 [@media(pointer:coarse)]:min-h-[40px]',
                bookmarkCardOpen
                  ? 'border-amber-300/40 bg-amber-300/15 text-amber-200'
                  : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-amber-300/30 hover:text-amber-200'
              )}
            >
              <Star className="h-3.5 w-3.5" aria-hidden />
              {L(`星图收藏（${bookmarks.length}）`, `Star Bookmarks (${bookmarks.length})`)}
            </button>
            </div>
          )}

          {/* collapsed stats FAB — the card grows back out of this point on click */}
          {(panelCollapsed || fabExiting) && (
            <button
              ref={statsFabRef}
              type="button"
              onClick={handleExpandStats}
              aria-label={L('展开统计卡', 'Show stats')}
              title={L('展开统计卡', 'Show stats')}
              className="absolute right-4 top-20 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-zinc-300 shadow-lg shadow-black/50 backdrop-blur-xl transition-colors hover:border-white/25 hover:text-zinc-100 portrait:right-3"
            >
              <PanelRightOpen className="h-4 w-4" aria-hidden />
            </button>
          )}

          {/* Sun marker DOM label (F7) */}
          <div
            ref={sunLabelRef}
            style={{ display: 'none' }}
            title={L(
              '太阳系位于猎户臂，距银心约 2.6 万光年，绕银心一周约 2.3 亿年',
              'The Solar System lies on the Orion Spur, about 26,000 ly from the galactic center, completing one orbit in about 230 million years'
            )}
            className="pointer-events-none absolute left-0 top-0 z-20 flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-black/60 px-2.5 py-1 shadow-[0_0_14px_rgba(251,191,36,0.25)] backdrop-blur-md"
          >
            <MapPin className="h-3 w-3 text-amber-300" aria-hidden />
            <span className="text-[10px] font-medium tracking-wider text-amber-100">{L('太阳系 · 猎户臂', 'Solar System · Orion Spur')}</span>
            <span className="text-[9px] tracking-wider text-zinc-400">{L('≈ 2.6 万光年', '≈ 26,000 ly')}</span>
          </div>

          {/* F28 — hover star inspector tooltip */}
          <div
            ref={hoverTipRef}
            style={{ display: 'none' }}
            role="status"
            aria-live="polite"
            className="uni-anim-fade-in pointer-events-none absolute left-0 top-0 z-30 rounded-lg border border-white/10 bg-black/70 px-2.5 py-1.5 shadow-lg shadow-black/50 backdrop-blur-md"
          />

          {/* Spiral-arm DOM labels (F12) — click for the arm dossier */}
          {ARM_SPECS.map((spec, i) => (
            <button
              key={spec.name}
              ref={(el) => {
                armLabelRefs.current[i] = el;
              }}
              type="button"
              style={{ display: 'none', borderColor: `${spec.color}40` }}
              onClick={(e) => {
                openCard('arm', { x: e.clientX, y: e.clientY });
              }}
              title={L(`${spec.name} · ${spec.desc}`, `${spec.nameEn} · ${spec.descEn}`)}
              className="pointer-events-auto absolute left-0 top-0 z-[25] flex items-center gap-1.5 rounded-full border bg-black/55 px-2.5 py-1 shadow-md shadow-black/40 backdrop-blur-md transition-transform duration-150 hover:scale-105"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: spec.color, boxShadow: `0 0 6px ${spec.color}` }} aria-hidden />
              <span className="text-[10px] font-medium tracking-wider text-zinc-100">{L(spec.name, spec.nameEn)}</span>
              {lang === 'zh' && <span className="text-[9px] tracking-wider text-zinc-400">{spec.en}</span>}
            </button>
          ))}

          {/* F30 — bookmarked-star chips above each marker */}
          {bookmarks.map((bm, i) => (
            <button
              key={bm.id}
              ref={(el) => {
                bookmarkLabelRefs.current[i] = el;
              }}
              type="button"
              style={{ display: 'none' }}
              onClick={() => {
                bookmarkFlightRef.current = i;
                playEventSound('click');
              }}
              title={L(
                `${bm.name} · ${bm.spectral} · 距银心 ≈ ${bm.rGal.toFixed(1)} 万光年 · 点击定位`,
                `${bm.name} · ${bm.spectral} · ≈ ${fmtWanToLy(bm.rGal)} from center · Click to locate`
              )}
              className="pointer-events-auto absolute left-0 top-0 z-[25] items-center gap-1 rounded-full border border-amber-300/40 bg-black/60 px-2 py-0.5 shadow-[0_0_10px_rgba(251,191,36,0.22)] backdrop-blur-md transition-transform duration-150 hover:scale-105"
            >
              <Star className="h-2.5 w-2.5 fill-amber-300 text-amber-300" aria-hidden />
              <span className="text-[10px] font-medium tracking-wider text-amber-100">{bm.name}</span>
            </button>
          ))}

          {/* F30 — personal star-map dossier card (opens from / collapses into its trigger) */}
          {bookmarkCardOpen && (
            <div
              ref={(el) => {
                cardRefs.current.bookmark = el;
              }}
              className="absolute bottom-24 right-4 z-30 w-[min(92vw,280px)] rounded-2xl border border-white/10 bg-black/60 p-4 shadow-2xl shadow-black/60 backdrop-blur-2xl portrait:bottom-[calc(8rem+var(--ui-safe-bottom))] portrait:left-3 portrait:right-3 portrait:w-auto max-[480px]:left-3 max-[480px]:right-3 max-[480px]:w-auto"
            >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.26em] text-amber-200/90">{L('星图收藏', 'STAR BOOKMARKS')}</p>
                <p className="mt-0.5 text-[9px] tracking-[0.3em] text-zinc-500">MY STAR MAP</p>
              </div>
              <button
                type="button"
                onClick={() => closeCard('bookmark')}
                aria-label={L('关闭星图收藏', 'Close star bookmarks')}
                className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            {bookmarks.length === 0 ? (
              <p className="mt-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5 text-[10px] leading-relaxed text-zinc-500">
                {L('悬停银盘任意恒星查看档案，然后', 'Hover any star on the galactic disk to view its profile, then ')}
                <span className="text-amber-200/80">{L('直接点击画面', 'click directly on the canvas')}</span>
                {L(
                  `即可收藏（上限 ${BOOKMARK_LIMIT} 颗），收藏会保存在本机浏览器中。`,
                  ` to bookmark it (up to ${BOOKMARK_LIMIT} stars). Your collection is saved in this browser.`
                )}
              </p>
            ) : (
              <div className="uni-anim-stagger universe-scroll mt-3 max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
                {bookmarks.map((bm, i) => (
                  <div
                    key={bm.id}
                    className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1.5"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.8)]"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-[11px] font-semibold text-zinc-100">
                        {bm.name}
                        <span className="ml-1.5 text-[9px] font-normal text-zinc-500">{bm.spectral}</span>
                      </p>
                      <p className="truncate text-[9px] text-zinc-500">
                        {bm.armName} · {L(`距银心 ≈ ${bm.rGal.toFixed(1)} 万光年`, `≈ ${fmtWanToLy(bm.rGal)} from center`)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        bookmarkFlightRef.current = i;
                        playEventSound('click');
                      }}
                      aria-label={L(`定位到${bm.name}`, `Fly to ${bm.name}`)}
                      title={L('飞往这颗星', 'Fly to this star')}
                      className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-amber-200/10 hover:text-amber-200"
                    >
                      <Crosshair className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        commitBookmarks(bookmarks.filter((b) => b.id !== bm.id));
                        playEventSound('click');
                      }}
                      aria-label={L(`移除${bm.name}`, `Remove ${bm.name}`)}
                      title={L('移除收藏', 'Remove bookmark')}
                      className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-rose-400/10 hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                ))}
                {bookmarks.length >= BOOKMARK_LIMIT && (
                  <p className="px-1 pt-1 text-[9px] text-amber-200/60">
                    {L(
                      `收藏已满（${BOOKMARK_LIMIT}）——移除一些以继续收藏。`,
                      `Collection is full (${BOOKMARK_LIMIT}) — remove some to keep bookmarking.`
                    )}
                  </p>
                )}
              </div>
            )}
            {/* F34 — export / import the collection as JSON via the clipboard */}
            <div className="mt-3 border-t border-white/5 pt-2.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleExportBookmarks}
                  title={L('把收藏列表复制为 JSON（可分享给别人）', 'Copy the collection as JSON (shareable with others)')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[10px] font-medium text-zinc-300 transition-colors hover:border-amber-200/40 hover:bg-amber-200/10 hover:text-amber-200 [@media(pointer:coarse)]:py-2"
                >
                  <Download className="h-3 w-3" aria-hidden /> {L('导出星图', 'Export star map')}
                </button>
                <button
                  type="button"
                  onClick={handleImportBookmarks}
                  title={L('从剪贴板读取星图 JSON 并合并（重复自动跳过）', 'Read star-map JSON from the clipboard and merge (duplicates skipped)')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[10px] font-medium text-zinc-300 transition-colors hover:border-emerald-200/40 hover:bg-emerald-200/10 hover:text-emerald-200 [@media(pointer:coarse)]:py-2"
                >
                  <Upload className="h-3 w-3" aria-hidden /> {L('导入星图', 'Import star map')}
                </button>
              </div>
              <p
                aria-live="polite"
                className={cn(
                  'mt-1.5 text-[9.5px] leading-snug text-amber-200/80 transition-opacity duration-300',
                  bmMsg ? 'opacity-100' : 'opacity-0'
                )}
              >
                {bmMsg ?? '　'}
              </p>
            </div>
          </div>
            )}

          {/* Spiral-arm dossier card (F12) — opens from / collapses into its trigger */}
          {armCardOpen && (
            <div
              ref={(el) => {
                cardRefs.current.arm = el;
              }}
              className="absolute bottom-24 left-4 z-30 w-[min(92vw,312px)] rounded-2xl border border-white/10 bg-black/60 p-4 shadow-2xl shadow-black/60 backdrop-blur-2xl portrait:bottom-[calc(8rem+var(--ui-safe-bottom))] portrait:right-3 portrait:left-3 portrait:w-auto max-[480px]:left-3 max-[480px]:right-3 max-[480px]:w-auto"
            >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.26em] text-violet-200/90">{L('旋臂档案', 'SPIRAL ARM PROFILES')}</p>
                <p className="mt-0.5 text-[9px] tracking-[0.3em] text-zinc-500">MILKY WAY SPIRAL ARMS</p>
              </div>
              <button
                type="button"
                onClick={() => closeCard('arm')}
                aria-label={L('关闭旋臂档案', 'Close spiral arm profiles')}
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div className="uni-anim-stagger universe-scroll mt-3 max-h-[42vh] space-y-2 overflow-y-auto pr-1">
              {ARM_SPECS.map((spec) => (
                <div key={spec.name} className="rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: spec.color, boxShadow: `0 0 8px ${spec.color}` }}
                      aria-hidden
                    />
                    <span className="text-[12px] font-semibold text-zinc-100">{L(spec.name, spec.nameEn)}</span>
                    <span className="rounded-full border border-white/10 bg-black/40 px-1.5 py-0.5 text-[8px] font-medium tracking-wider text-zinc-400">
                      {L(spec.kind, spec.kindEn)}
                    </span>
                  </div>
                  <p className="mt-1 text-[9px] tracking-[0.18em] text-zinc-500">
                    {lang === 'zh' && `${spec.en} · `}
                    {L(spec.dist, spec.distEn)}
                  </p>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-zinc-400">{L(spec.desc, spec.descEn)}</p>
                </div>
              ))}
            </div>
            <p className="mt-2.5 border-t border-white/5 pt-2 text-[9.5px] leading-relaxed text-zinc-500">
              {L(
                '另有矩尺臂（Norma）等小旋臂贴近银核；太阳系位于猎户支臂上，距银心约 2.6 万光年。',
                'Smaller arms such as the Norma Arm hug the galactic core; the Solar System sits on the Orion Spur, about 26,000 ly from the center.'
              )}
            </p>
          </div>
            )}

          {/* F43 — Milky Way encyclopedia dossier card (mutually exclusive with the arm dossier) — origin open/close */}
          {galaxyCardOpen && (
            <div
              ref={(el) => {
                cardRefs.current.galaxy = el;
              }}
              className="absolute bottom-24 left-4 z-30 w-[min(92vw,312px)] rounded-2xl border border-white/10 bg-black/60 p-4 shadow-2xl shadow-black/60 backdrop-blur-2xl portrait:bottom-[calc(8rem+var(--ui-safe-bottom))] portrait:right-3 portrait:left-3 portrait:w-auto max-[480px]:left-3 max-[480px]:right-3 max-[480px]:w-auto"
            >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.26em] text-teal-200/90">{L('银河系档案', 'MILKY WAY FACT SHEET')}</p>
                <p className="mt-0.5 text-[9px] tracking-[0.3em] text-zinc-500">{L('MILKY WAY FACT SHEET', 'QUICK FACTS')}</p>
              </div>
              <button
                type="button"
                onClick={() => closeCard('galaxy')}
                aria-label={L('关闭银河系档案', 'Close Milky Way fact sheet')}
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div className="uni-anim-stagger universe-scroll mt-3 max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {[
                { icon: Telescope, label: L('星系类型', 'Galaxy type'), value: L('棒旋星系 SBbc', 'Barred spiral SBbc'), sub: L('中心棒结构 + 四条主旋臂', 'A central bar + four major spiral arms') },
                { icon: Ruler, label: L('盘面直径', 'Disk diameter'), value: L('≈ 10 万光年', '≈ 100,000 ly'), sub: L('核球隆起约 1 万光年厚，银盘厚约 1000 光年', 'The bulge is ~10,000 ly thick; the disk only ~1,000 ly') },
                { icon: Sparkles, label: L('恒星总数', 'Total stars'), value: L('1000 – 4000 亿颗', '100–400 billion'), sub: L('本场景渲染 12 万颗 + 2.6 万尘埃粒子', 'This scene renders 120,000 stars + 26,000 dust particles') },
                { icon: Users, label: L('年龄', 'Age'), value: L('≈ 136 亿年', '≈ 13.6 billion years'), sub: L('几乎与宇宙（138 亿年）同龄', 'Nearly as old as the universe (13.8 billion years)') },
                { icon: Sun, label: L('太阳系位置', 'Solar System location'), value: L('猎户支臂 · 距银心 2.6 万光年', 'Orion Spur · 26,000 ly from the center'), sub: L('约在银心到边缘一半处，避开强辐射区', 'About halfway to the edge, away from intense radiation zones') },
                { icon: Orbit, label: L('银河年', 'Galactic year'), value: L('≈ 2.3 亿年/圈', '≈ 230 million years per orbit'), sub: L('太阳绕银心公转一周所需时间，时速约 828,000 km/h', 'Time for one solar orbit around the center, at ~828,000 km/h') },
                { icon: CircleDot, label: L('中心黑洞', 'Central black hole'), value: L('人马座 A*（Sgr A*）', 'Sagittarius A* (Sgr A*)'), sub: L('质量 ≈ 430 万倍太阳，2022 年被事件视界望远镜成像', 'Mass ≈ 4.3 million suns; imaged by the Event Horizon Telescope in 2022') },
                { icon: Scale, label: L('总质量', 'Total mass'), value: L('≈ 1.5 万亿倍太阳', '≈ 1.5 trillion solar masses'), sub: L('约 85% 来自看不见的暗物质晕', 'About 85% of it from the invisible dark matter halo') },
                { icon: Hourglass, label: L('未来命运', 'Future fate'), value: L('与仙女座星系相撞', 'Collision with the Andromeda Galaxy'), sub: L('预计 ≈ 45 亿年后合并为一个椭圆星系', 'Expected to merge into an elliptical galaxy in ≈ 4.5 billion years') },
              ].map((row) => (
                <div key={row.label} className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
                  <row.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-200/80" aria-hidden />
                  <div className="min-w-0 leading-tight">
                    <p className="text-[10px] tracking-wider text-zinc-500">{row.label}</p>
                    <p className="mt-0.5 text-[11.5px] font-semibold text-zinc-100">{row.value}</p>
                    <p className="mt-0.5 text-[9.5px] leading-relaxed text-zinc-500">{row.sub}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2.5 flex items-center gap-1.5 border-t border-white/5 pt-2 text-[9.5px] leading-relaxed text-zinc-500">
              <GitMerge className="h-3 w-3 shrink-0 text-teal-200/60" aria-hidden />
              {L(
                '场景换算：1 场景单位 = 500 光年 · 银盘以对数螺旋臂模型生成',
                'Scale: 1 scene unit = 500 ly · the disk is generated with a log-spiral arm model'
              )}
            </p>
          </div>
            )}

          {/* bottom-center tour control bar */}
          <div className="uni-anim-fade-up absolute bottom-5 left-1/2 z-20 -translate-x-1/2 portrait:bottom-[calc(3.75rem+var(--ui-safe-bottom))] portrait:w-max portrait:max-w-[96vw]">
            <div
              className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/45 px-2.5 py-2 shadow-lg shadow-black/50 backdrop-blur-xl portrait:max-w-[96vw] portrait:gap-1.5 portrait:px-2"
              role="group"
              aria-label={L('自动巡游控制', 'Automatic tour controls')}
            >
              <button
                type="button"
                aria-pressed={tourOn}
                onClick={() => {
                  playEventSound('click'); // F23
                  if (tourOn) tourApiRef.current.stop();
                  else tourApiRef.current.start();
                }}
                className="flex min-h-[34px] items-center gap-1.5 rounded-xl bg-gradient-to-b from-amber-200 via-amber-300 to-amber-400 px-3.5 text-[12px] font-semibold text-zinc-950 shadow-[0_0_18px_rgba(251,191,36,0.35)] transition-transform duration-150 active:scale-95 portrait:min-h-[40px] portrait:px-3 portrait:text-[11px] [@media(pointer:coarse)]:min-h-[44px]"
              >
                {tourOn ? (
                  <Square className="h-3 w-3 fill-current" aria-hidden />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
                )}
                {tourOn ? L('停止巡游', 'Stop tour') : L('开始巡游', 'Start tour')}
              </button>

              <div className="mx-0.5 h-6 w-px bg-white/10" aria-hidden />

              <div className="flex items-center gap-1">
                {STAGE_LABELS.map((label, i) => {
                  const active = stage === i;
                  return (
                    <div
                      key={label[0]}
                      className={
                        'relative flex min-h-[30px] items-center rounded-lg border px-3 pb-2 pt-1.5 text-[11px] font-medium transition-colors duration-300 portrait:min-h-[34px] portrait:px-2 portrait:pb-1.5 portrait:pt-1 portrait:text-[10px] [@media(pointer:coarse)]:min-h-[40px] ' +
                        (active
                          ? 'border-amber-300/35 bg-amber-300/15 text-amber-200 shadow-[0_0_14px_rgba(252,211,77,0.15)]'
                          : 'border-transparent text-zinc-400')
                      }
                    >
                      <span>{L(label[0], label[1])}</span>
                      <span className="absolute bottom-[3px] left-2 right-2 h-[2px] overflow-hidden rounded-full bg-white/10">
                        <span
                          ref={(el) => {
                            barRefs.current[i] = el;
                          }}
                          className="block h-full w-full origin-left rounded-full bg-gradient-to-r from-amber-300 to-violet-300"
                          style={{ transform: 'scaleX(0)' }}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
