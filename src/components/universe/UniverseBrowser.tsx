'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {Orbit, Sparkles, CircleDot, Rocket, Loader2, Camera, Check, Gauge, Volume2, VolumeX, Bell, BellOff, SlidersHorizontal, Settings, Languages, Keyboard, X, Star} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { takeScreenshot, downloadDataUrl } from '@/components/universe/capture';
import { ambient, playEventSound } from '@/components/universe/soundscape';
import { playEnter, playExit, setOriginFromPoint, setOriginFromTrigger } from '@/components/universe/originTransition';
import {
  cycleQuality,
  getQualityLevel,
  getRenderScale,
  onAutoQualityChange,
  type QualityLevel,
} from '@/components/universe/quality';
import {
  L,
  useLang,
  subscribeLang,
  getLang,
  getLangMode,
  setLangMode,
  type LangMode,
} from '@/components/universe/i18n';

type SceneId = 'solar' | 'galaxy' | 'blackhole' | 'zodiac';

/** F37 — persisted preference for the UI event sounds */
const SFX_LS_KEY = 'universe-sfx';
const loadSfxPreference = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(SFX_LS_KEY) !== '0';
  } catch {
    return true;
  }
};

/** F39 — persisted volume sliders (0..100, stored as strings) */
const AMBIENT_VOL_LS_KEY = 'universe-vol-ambient';
const SFX_VOL_LS_KEY = 'universe-vol-sfx';
const loadVolume = (key: string): number => {
  if (typeof window === 'undefined') return 100;
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw === null ? 100 : Number(raw);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100;
  } catch {
    return 100;
  }
};

const SCENE_TABS: { id: SceneId; label: string; en: string; sub: string; icon: typeof Orbit }[] = [
  { id: 'solar', label: '太阳系', en: 'Solar System', sub: 'SOLAR SYSTEM', icon: Orbit },
  { id: 'galaxy', label: '银河系', en: 'Milky Way', sub: 'MILKY WAY', icon: Sparkles },
  { id: 'blackhole', label: '黑洞', en: 'Black Hole', sub: 'BLACK HOLE', icon: CircleDot },
  { id: 'zodiac', label: '十二星座', en: 'Zodiac', sub: 'ZODIAC', icon: Star },
];

/** Bilingual quality labels — quality.ts keeps Chinese-only labels, the UI translates. */
const QUALITY_ZH = ['流畅', '轻量', '均衡', '高清'] as const;
const QUALITY_EN = ['Smooth', 'Light', 'Balanced', 'HD'] as const;
const QUALITY_SCALE_PERCENT = [50, 62.5, 75, 100] as const;

function SceneLoading() {
  useLang(); // subscribe so the loading text follows language switches
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#020208]">
      <Loader2 className="h-8 w-8 animate-spin text-amber-300/80" aria-hidden />
      <p className="text-sm tracking-[0.3em] text-zinc-400">{L('正在初始化场景 …', 'Initializing scene …')}</p>
    </div>
  );
}

const SolarSystemScene = dynamic(() => import('@/components/universe/SolarSystemScene'), {
  ssr: false,
  loading: () => <SceneLoading />,
});
const GalaxyScene = dynamic(() => import('@/components/universe/GalaxyScene'), {
  ssr: false,
  loading: () => <SceneLoading />,
});
const BlackHoleScene = dynamic(() => import('@/components/universe/BlackHoleScene'), {
  ssr: false,
  loading: () => <SceneLoading />,
});
const ZodiacScene = dynamic(() => import('@/components/universe/ZodiacScene'), {
  ssr: false,
  loading: () => <SceneLoading />,
});

export default function UniverseBrowser() {
  useLang(); // re-render on language change so every L() below re-evaluates
  const [active, setActive] = useState<SceneId>('solar');
  const [shotFlash, setShotFlash] = useState(false);
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>(getQualityLevel);
  const [renderScale, setRenderScale] = useState(100);
  const [autoToastLevel, setAutoToastLevel] = useState<QualityLevel | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [sfxOn, setSfxOn] = useState<boolean>(loadSfxPreference); // F37
  const [ambientVol, setAmbientVol] = useState<number>(() => loadVolume(AMBIENT_VOL_LS_KEY)); // F39
  const [sfxVol, setSfxVol] = useState<number>(() => loadVolume(SFX_VOL_LS_KEY)); // F39
  const [audioPanelOpen, setAudioPanelOpen] = useState(false); // F39 — volume popover
  const [showRenderInfo, setShowRenderInfo] = useState(false); // F24 — tap support for touch devices
  const [settingsOpen, setSettingsOpen] = useState(false); // settings dialog
  const [langMode, setLangModeState] = useState<LangMode>(() =>
    typeof window === 'undefined' ? 'auto' : getLangMode()
  );
  const flashTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  /* origin-aware transitions (一镜到底): panels open from the trigger, close back into it */
  const [exitFrame, setExitFrame] = useState<string | null>(null);
  const transitioningRef = useRef(false);
  const pendingSceneRef = useRef<SceneId | null>(null);
  const switchToRef = useRef<(id: SceneId) => void>(() => {});
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [audioClosing, setAudioClosing] = useState(false);
  const settingsOverlayRef = useRef<HTMLDivElement | null>(null);
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const settingsOrigin = useRef<{ x: number; y: number } | null>(null);
  const audioPanelRef = useRef<HTMLDivElement | null>(null);
  const audioBtnRef = useRef<HTMLButtonElement | null>(null);
  const audioOrigin = useRef<{ x: number; y: number } | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );

  /* keep <html lang> in sync with the effective language */
  useEffect(() => {
    const sync = () => {
      document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-CN';
    };
    sync();
    return subscribeLang(sync);
  }, []);

  /* F11 — toast when the FPS governor auto-drops quality */
  useEffect(() => {
    return onAutoQualityChange((level) => {
      setQualityLevel(level);
      setRenderScale(QUALITY_SCALE_PERCENT[level]);
      setAutoToastLevel(level);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setAutoToastLevel(null), 5000);
    });
  }, []);

  /* F18 — keep the soundscape in sync with the active scene */
  useEffect(() => {
    ambient.setScene(active);
  }, [active]);

  /* F37 — push the persisted UI-sound preference into the soundscape */
  useEffect(() => {
    ambient.setSfx(sfxOn);
  }, [sfxOn]);

  /* F39 — push the persisted volume sliders into the soundscape (once) */
  useEffect(() => {
    ambient.setAmbientVolume(ambientVol / 100);
    ambient.setSfxVolume(sfxVol / 100);
    // mount-only sync — later changes go through the live handlers
  }, []);

  const handleSoundToggle = useCallback(() => {
    const next = !soundOn;
    setSoundOn(next);
    if (next) {
      void ambient.enable().then(() => playEventSound('success'));
    } else {
      // F39 — master mute: everything goes silent, no confirmation blip
      ambient.disable();
    }
  }, [soundOn]);

  /* F37 — independent toggle for the UI event sounds */
  const handleSfxToggle = useCallback(() => {
    const next = !sfxOn;
    setSfxOn(next);
    ambient.setSfx(next);
    try {
      window.localStorage.setItem(SFX_LS_KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
    playEventSound(next ? 'success' : 'click');
  }, [sfxOn]);

  /* F39 — live slider handlers (state → soundscape, committed value → disk) */
  const handleAmbientVolChange = useCallback((v: number[]) => {
    const vol = v[0] ?? 100;
    setAmbientVol(vol);
    ambient.setAmbientVolume(vol / 100);
  }, []);
  const handleAmbientVolCommit = useCallback((v: number[]) => {
    try {
      window.localStorage.setItem(AMBIENT_VOL_LS_KEY, String(v[0] ?? 100));
    } catch {
      /* private mode */
    }
  }, []);
  const handleSfxVolChange = useCallback((v: number[]) => {
    const vol = v[0] ?? 100;
    setSfxVol(vol);
    ambient.setSfxVolume(vol / 100);
  }, []);
  const handleSfxVolCommit = useCallback((v: number[]) => {
    try {
      window.localStorage.setItem(SFX_VOL_LS_KEY, String(v[0] ?? 100));
    } catch {
      /* private mode */
    }
  }, []);

  const switchTo = useCallback(
    (id: SceneId) => {
      // reset fps readout while the next scene boots
      const v = document.getElementById('fps-value');
      if (v) v.textContent = '--';
      if (id === active) return;
      // one journey at a time — but a click during a journey is QUEUED, never lost
      if (transitioningRef.current) {
        pendingSceneRef.current = id;
        return;
      }
      playEventSound('switch'); // F23 — airy swish on scene change
      // 一镜到底 scene travel: freeze the outgoing scene into a frame that
      // recedes into a point while the incoming scene grows beneath it.
      const snap = takeScreenshot();
      transitioningRef.current = true;
      setExitFrame(snap);
      setActive(id);
      window.setTimeout(() => {
        setExitFrame(null);
        transitioningRef.current = false;
        const queued = pendingSceneRef.current;
        if (queued) {
          pendingSceneRef.current = null;
          queueMicrotask(() => switchToRef.current(queued));
        }
      }, 1000);
    },
    [active]
  );

  useEffect(() => {
    switchToRef.current = switchTo;
  }, [switchTo]);

  /* settings dialog open/close (both play the shared UI click).
     一镜到底: the dialog scales out of the gear button's position and
     shrinks back into it on close — no jump cuts. */
  const openSettings = useCallback((e?: React.MouseEvent) => {
    // synthetic clicks report (0,0) — fall back to the trigger element in that case
    settingsOrigin.current = e && (e.clientX || e.clientY) ? { x: e.clientX, y: e.clientY } : null;
    setSettingsClosing(false);
    setSettingsOpen(true);
    playEventSound('click');
  }, []);
  const closeSettings = useCallback(() => {
    const overlay = settingsOverlayRef.current;
    const dialog = settingsDialogRef.current;
    if (!overlay || !dialog || settingsClosing) {
      if (!settingsClosing) setSettingsOpen(false);
      return;
    }
    setSettingsClosing(true);
    playEventSound('click');
    playExit(overlay, 'uni-fade-out', undefined, 320);
    playExit(dialog, 'uni-origin-out', () => {
      setSettingsOpen(false);
      setSettingsClosing(false);
    }, 380);
  }, [settingsClosing]);

  /* mount-time enter: collapse open from the trigger point */
  useEffect(() => {
    if (!settingsOpen) return;
    const dialog = settingsDialogRef.current;
    const overlay = settingsOverlayRef.current;
    if (!dialog || !overlay) return;
    if (settingsOrigin.current) setOriginFromPoint(dialog, settingsOrigin.current.x, settingsOrigin.current.y);
    else setOriginFromTrigger(dialog, settingsBtnRef.current);
    playEnter(overlay, 'uni-anim-fade-in');
    playEnter(dialog, 'uni-origin-in');
  }, [settingsOpen]);

  const toggleAudioPanel = useCallback(
    (e?: React.MouseEvent) => {
      if (audioPanelOpen) {
        const panel = audioPanelRef.current;
        if (panel && !audioClosing) {
          setAudioClosing(true);
          playEventSound('click');
          playExit(panel, 'uni-origin-out', () => {
            setAudioPanelOpen(false);
            setAudioClosing(false);
          }, 380);
          return;
        }
        setAudioPanelOpen(false);
        setAudioClosing(false);
        return;
      }
      audioOrigin.current = e && (e.clientX || e.clientY) ? { x: e.clientX, y: e.clientY } : null;
      setAudioPanelOpen(true);
      playEventSound('click');
    },
    [audioPanelOpen, audioClosing]
  );

  /* mount-time enter for the volume popover */
  useEffect(() => {
    if (!audioPanelOpen) return;
    const panel = audioPanelRef.current;
    if (!panel) return;
    if (audioOrigin.current) setOriginFromPoint(panel, audioOrigin.current.x, audioOrigin.current.y);
    else setOriginFromTrigger(panel, audioBtnRef.current);
    playEnter(panel, 'uni-origin-in');
  }, [audioPanelOpen]);

  /* F40 — keyboard shortcuts: 1/2/3 scenes · M master mute · Space solar pause · , settings.
     Ignored while typing in inputs or when a button/switch has focus. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      // typing in a field or activating a control with Space/M must not double-fire
      if (t && t.closest('input, textarea, select, button, [role=switch], [contenteditable]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('universe-toggle-pause'));
        return;
      }
      const k = e.key.toLowerCase();
      if (k === '1') switchTo('solar');
      else if (k === '2') switchTo('galaxy');
      else if (k === '3') switchTo('blackhole');
      else if (k === '4') switchTo('zodiac');
      else if (k === 'm') handleSoundToggle();
      else if (k === ',') openSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [switchTo, handleSoundToggle, openSettings]);

  /* settings dialog: Esc closes (capture phase — works even when a control inside has focus) */
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSettings();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [settingsOpen, closeSettings]);

  const handleQualityCycle = useCallback(() => {
    const level = cycleQuality();
    setQualityLevel(level);
    setRenderScale(getRenderScale() * 100);
    playEventSound('click');
  }, []);

  const handleScreenshot = useCallback(() => {
    const url = takeScreenshot();
    if (!url) return;
    const sceneName =
      active === 'solar' ? 'solar-system' : active === 'galaxy' ? 'milky-way' : 'black-hole';
    downloadDataUrl(url, `universe-${sceneName}-${Date.now()}.png`);
    playEventSound('success'); // F23 — two-note chime
    setShotFlash(true);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setShotFlash(false), 1600);
  }, [active]);

  /* language chips — setLangMode fires listeners; the local state guarantees a
     re-render even when the effective language (and thus useLang) is unchanged */
  const handleLangModeChange = useCallback((mode: LangMode) => {
    setLangMode(mode);
    setLangModeState(mode);
    playEventSound('click');
  }, []);

  const qualityLabel = L(QUALITY_ZH[qualityLevel], QUALITY_EN[qualityLevel]);

  const langOptions: { mode: LangMode; label: string }[] = [
    { mode: 'auto', label: L('跟随设备', 'Follow device') },
    { mode: 'zh', label: '中文' },
    { mode: 'en', label: 'English' },
  ];
  const shortcuts: { keys: string; desc: string }[] = [
    { keys: '1 / 2 / 3 / 4', desc: L('切换场景', 'Switch scenes') },
    { keys: 'M', desc: L('静音', 'Mute') },
    { keys: 'Space', desc: L('暂停太阳系', 'Pause the solar system') },
    { keys: ',', desc: L('打开设置', 'Open settings') },
  ];

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#020208] text-zinc-100 select-none">
      {/* ---------------- 3D scene layer ---------------- */}
      <main className="absolute inset-0" aria-label={L('3D 宇宙场景', '3D universe scene')}>
        {/* key remounts the wrapper on scene switch → the fade plays exactly once per switch */}
        <div key={active} className="uni-scene-in absolute inset-0">
          {active === 'solar' && <SolarSystemScene />}
          {active === 'galaxy' && <GalaxyScene />}
          {active === 'blackhole' && <BlackHoleScene />}
          {active === 'zodiac' && <ZodiacScene />}
        </div>
        {/* frozen frame of the outgoing scene, receding into a point */}
        {exitFrame && (
          <div className="uni-scene-out pointer-events-none absolute inset-0 z-10">
            <img src={exitFrame} alt="" className="h-full w-full object-cover" />
          </div>
        )}
      </main>

      {/* ---------------- top glass header ----------------
           F44 — portrait: wraps into two rows via CSS order
             row 1 = brand (order-1) + icon cluster (order-2)
             row 2 = scene tabs stretched full-width (order-3)
           landscape keeps the original single-row justify-between. */}
      <header
        className="uni-anim-fade-in pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 via-black/25 to-transparent px-4 pb-8 pt-[max(0.75rem,var(--ui-safe-top))] sm:px-6 portrait:flex-wrap portrait:gap-y-2"
      >
        {/* brand */}
        <div className="pointer-events-auto flex items-center gap-3 portrait:order-1 portrait:gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300/25 bg-amber-300/10 shadow-[0_0_18px_rgba(251,191,36,0.15)] portrait:h-8 portrait:w-8">
            <Rocket className="h-4.5 w-4.5 text-amber-300 portrait:h-4 portrait:w-4" aria-hidden />
          </div>
          <div className="leading-tight">
            <h1 className="whitespace-nowrap text-[15px] font-semibold tracking-[0.22em] text-zinc-50 portrait:text-[13px] portrait:tracking-[0.16em]">{L('宇宙浏览器', 'Universe Browser')}</h1>
            <p className="whitespace-nowrap text-[10px] font-medium tracking-[0.34em] text-amber-200/60 portrait:hidden">UNIVERSE EXPLORER</p>
          </div>
        </div>

        {/* tabs */}
        <nav
          aria-label={L('场景切换', 'Scene switcher')}
          className="pointer-events-auto flex items-center gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-black/45 p-1.5 shadow-lg shadow-black/40 backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden portrait:order-3 portrait:max-w-[96vw] portrait:w-full portrait:justify-center"
        >
          {SCENE_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => switchTo(tab.id)}
                aria-pressed={isActive}
                className={cn(
                  'group relative flex min-h-[38px] items-center gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium transition-all duration-300 portrait:px-2.5 sm:px-4',
                  isActive
                    ? 'bg-gradient-to-b from-amber-200/20 to-amber-400/10 text-amber-200 shadow-[inset_0_0_0_1px_rgba(252,211,77,0.35),0_0_22px_rgba(251,191,36,0.12)]'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                )}
              >
                <Icon className={cn('h-4 w-4 transition-transform duration-300', isActive && 'scale-110')} aria-hidden />
                <span>{L(tab.label, tab.en)}</span>
                <span
                  className={cn(
                    'hidden text-[9px] font-semibold tracking-[0.22em] lg:inline',
                    isActive ? 'text-amber-200/60' : 'text-zinc-600'
                  )}
                >
                  {tab.sub}
                </span>
                {isActive && (
                  <span className="absolute bottom-1 left-1/2 h-[2px] w-8 -translate-x-1/2 rounded-full bg-amber-300/80 shadow-[0_0_8px_rgba(252,211,77,0.8)]" />
                )}
              </button>
            );
          })}
        </nav>

        {/* right cluster: sound + quality + screenshot + settings + badge */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 portrait:order-2 portrait:justify-end max-[480px]:gap-1">
          <button
            type="button"
            onClick={handleSoundToggle}
            aria-label={soundOn ? L('关闭全部音效', 'Mute all sound') : L('开启音效', 'Enable sound')}
            aria-pressed={soundOn}
            title={L('音效总开关（环境音 + UI 音）· 快捷键 M', 'Master sound switch (ambient + UI sounds) · shortcut M')}
            className={cn(
              'flex h-9 items-center gap-2 rounded-lg border px-2.5 backdrop-blur-xl transition-all duration-300 portrait:px-2 max-[480px]:px-1.5 max-[480px]:gap-1.5 [@media(pointer:coarse)]:h-11',
              soundOn
                ? 'border-teal-300/40 bg-teal-300/15 text-teal-200 shadow-[0_0_16px_rgba(45,212,191,0.25)]'
                : 'border-white/10 bg-black/40 text-zinc-300 hover:border-teal-200/40 hover:bg-black/60 hover:text-teal-200'
            )}
          >
            {soundOn ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
            <span
              className={cn(
                'hidden whitespace-nowrap text-[11px] font-medium tracking-wider lg:inline',
                soundOn ? 'text-teal-200' : 'text-zinc-400'
              )}
            >
              {L('音效', 'Sound')}
            </span>
          </button>
          <button
            type="button"
            onClick={handleSfxToggle}
            aria-label={sfxOn ? L('关闭 UI 音效', 'Disable UI sounds') : L('开启 UI 音效', 'Enable UI sounds')}
            aria-pressed={sfxOn}
            title={L('UI 事件音效（点击/截图反馈音，受总开关控制）', 'UI event sounds (click/screenshot feedback, gated by the master switch)')}
            className={cn(
              'flex h-9 items-center gap-2 rounded-lg border px-2.5 backdrop-blur-xl transition-all duration-300 portrait:px-2 max-[480px]:px-1.5 max-[480px]:gap-1.5 [@media(pointer:coarse)]:h-11',
              sfxOn && soundOn
                ? 'border-teal-300/40 bg-teal-300/15 text-teal-200 shadow-[0_0_16px_rgba(45,212,191,0.25)]'
                : 'border-white/10 bg-black/40 text-zinc-300 hover:border-teal-200/40 hover:bg-black/60 hover:text-teal-200'
            )}
          >
            {sfxOn ? <Bell className="h-4 w-4" aria-hidden /> : <BellOff className="h-4 w-4" aria-hidden />}
            <span
              className={cn(
                'hidden whitespace-nowrap text-[11px] font-medium tracking-wider lg:inline',
                sfxOn && soundOn ? 'text-teal-200' : 'text-zinc-400'
              )}
            >
              {L('UI 音', 'UI')}
            </span>
          </button>
          {/* F39 — volume sliders popover */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => toggleAudioPanel(e)}
              aria-label={audioPanelOpen ? L('关闭音量设置', 'Close volume settings') : L('打开音量设置', 'Open volume settings')}
              aria-expanded={audioPanelOpen}
              ref={audioBtnRef}
              title={L('音量设置', 'Volume')}
              className={cn(
                'flex h-9 items-center gap-2 rounded-lg border px-2.5 backdrop-blur-xl transition-all duration-300 portrait:px-2 max-[480px]:px-1.5 max-[480px]:gap-1.5 [@media(pointer:coarse)]:h-11',
                audioPanelOpen
                  ? 'border-teal-300/40 bg-teal-300/15 text-teal-200'
                  : 'border-white/10 bg-black/40 text-zinc-300 hover:border-teal-200/40 hover:bg-black/60 hover:text-teal-200'
              )}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
            </button>
            {/* click-away overlay */}
            {audioPanelOpen && (
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => toggleAudioPanel()}
                className="fixed inset-0 z-40 cursor-default"
              />
            )}
            {audioPanelOpen && (
              <div
                ref={audioPanelRef}
                role="dialog"
                aria-label={L('音量设置', 'Volume')}
                className="absolute right-0 top-11 z-50 w-[min(92vw,264px)] rounded-2xl border border-white/10 bg-black/75 p-4 shadow-2xl shadow-black/60 backdrop-blur-2xl"
              >
                <p className="text-[10px] font-semibold tracking-[0.26em] text-zinc-500">{L('音量设置', 'Volume')}</p>
                <div
                  className={cn(
                    'mt-3 space-y-4 transition-opacity duration-200',
                    !soundOn && 'pointer-events-none opacity-40'
                  )}
                >
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label htmlFor="vol-ambient" className="text-[11px] font-medium tracking-wider text-zinc-300">
                        {L('环境音音量', 'Ambient volume')}
                      </label>
                      <span className="font-mono text-[11px] tabular-nums text-teal-200/90">{ambientVol}%</span>
                    </div>
                    <Slider
                      id="vol-ambient"
                      value={[ambientVol]}
                      onValueChange={handleAmbientVolChange}
                      onValueCommit={handleAmbientVolCommit}
                      min={0}
                      max={100}
                      step={1}
                      aria-label={L('环境音音量', 'Ambient volume')}
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label htmlFor="vol-sfx" className="text-[11px] font-medium tracking-wider text-zinc-300">
                        {L('UI 音音量', 'UI sounds volume')}
                      </label>
                      <span className="font-mono text-[11px] tabular-nums text-teal-200/90">{sfxVol}%</span>
                    </div>
                    <Slider
                      id="vol-sfx"
                      value={[sfxVol]}
                      onValueChange={handleSfxVolChange}
                      onValueCommit={handleSfxVolCommit}
                      min={0}
                      max={100}
                      step={1}
                      aria-label={L('UI 音音量', 'UI sounds volume')}
                    />
                  </div>
                </div>
                <p className="mt-3 border-t border-white/5 pt-2 text-[10px] leading-relaxed text-zinc-500">
                  {!soundOn
                    ? L('总开关已关闭 · 打开「音效」后可调节', 'Master switch is off · enable Sound to adjust')
                    : L('「音效」为总开关 · M 键快速静音 · 1/2/3 切场景 · 空格暂停太阳系', 'Sound is the master switch · M to mute · 1/2/3 switch scenes · Space pauses the solar system')}
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleQualityCycle}
            aria-label={L('切换渲染画质（高清 / 均衡 / 轻量 / 流畅）', 'Cycle render quality (HD / Balanced / Light / Smooth)')}
            title={L('渲染分辨率：高清 100% · 均衡 75% · 轻量 62.5% · 流畅 50%', 'Render scale: HD 100% · Balanced 75% · Light 62.5% · Smooth 50%')}
            className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-2.5 text-zinc-300 backdrop-blur-xl transition-all duration-300 hover:border-violet-300/40 hover:bg-black/60 hover:text-violet-200 portrait:px-2 max-[480px]:px-1.5 max-[480px]:gap-1.5 [@media(pointer:coarse)]:h-11"
          >
            <Gauge className="h-4 w-4" aria-hidden />
            <span className="hidden whitespace-nowrap text-[11px] font-medium tracking-wider lg:inline">{qualityLabel}</span>
          </button>
          <button
            type="button"
            onClick={handleScreenshot}
            aria-label={L('截图当前场景并下载', 'Screenshot the current scene and download')}
            title={L('截图当前场景（PNG）', 'Screenshot the current scene (PNG)')}
            className={cn(
              'flex h-9 items-center gap-2 rounded-lg border px-2.5 backdrop-blur-xl transition-all duration-300 portrait:px-2 max-[480px]:px-1.5 max-[480px]:gap-1.5 [@media(pointer:coarse)]:h-11',
              shotFlash
                ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-200 shadow-[0_0_16px_rgba(52,211,153,0.25)]'
                : 'border-white/10 bg-black/40 text-zinc-300 hover:border-amber-200/40 hover:bg-black/60 hover:text-amber-200'
            )}
          >
            {shotFlash ? <Check className="h-4 w-4" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
            <span
              className={cn(
                'hidden whitespace-nowrap text-[11px] font-medium tracking-wider lg:inline',
                shotFlash ? 'text-emerald-200' : 'text-zinc-400'
              )}
            >
              {shotFlash ? L('截图已保存', 'Saved') : L('截图', 'Screenshot')}
            </span>
          </button>
          {/* settings — opens the centered glass dialog */}
          <button
            type="button"
            ref={settingsBtnRef}
            onClick={(e) => (settingsOpen ? closeSettings() : openSettings(e))}
            aria-label={settingsOpen ? L('关闭设置', 'Close settings') : L('打开设置', 'Open settings')}
            aria-expanded={settingsOpen}
            title={L('设置 · 快捷键 ,', 'Settings · shortcut ,')}
            className={cn(
              'flex h-9 items-center gap-2 rounded-lg border px-2.5 backdrop-blur-xl transition-all duration-300 portrait:px-2 max-[480px]:px-1.5 max-[480px]:gap-1.5 [@media(pointer:coarse)]:h-11',
              settingsOpen
                ? 'border-teal-300/40 bg-teal-300/15 text-teal-200'
                : 'border-white/10 bg-black/40 text-zinc-300 hover:border-teal-200/40 hover:bg-black/60 hover:text-teal-200'
            )}
          >
            <Settings className="h-4 w-4" aria-hidden />
          </button>
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 backdrop-blur-xl lg:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
            <span className="whitespace-nowrap text-[11px] tracking-wider text-zinc-400">
              {L('全程序化材质 · Three.js WebGL', 'Fully procedural materials · Three.js WebGL')}
            </span>
          </div>
        </div>
      </header>

      {/* ---------------- persistent FPS badge ---------------- */}
      <div
        className="group absolute bottom-[calc(1rem+var(--ui-safe-bottom))] left-4 z-40 flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-black/50 px-3.5 py-2 shadow-lg shadow-black/50 backdrop-blur-xl"
        role="status"
        aria-label={L('帧率显示（点击查看渲染信息）', 'FPS (click for render info)')}
        onClick={() => setShowRenderInfo((v) => !v)}
      >
        <span id="fps-dot" className="h-2 w-2 rounded-full bg-emerald-400" style={{ backgroundColor: '#4ade80' }} aria-hidden />
        <div className="flex items-baseline gap-1.5 font-mono leading-none">
          <span id="fps-value" className="text-lg font-semibold tabular-nums text-zinc-100">
            --
          </span>
          <span className="text-[10px] tracking-[0.2em] text-zinc-500">FPS</span>
        </div>
        {/* hover detail: live render-resolution info (F24: also tap-toggleable for touch).
            The animated wrapper plays uni-anim-fade-up once on mount; the inner card
            keeps its own hover/tap scale+opacity transitions. */}
        <div className="uni-anim-fade-up pointer-events-none absolute bottom-[calc(100%+8px)] left-0">
          <div
            className={cn(
              'w-max origin-bottom-left rounded-lg border border-white/10 bg-black/75 px-3 py-2 shadow-xl shadow-black/60 backdrop-blur-xl transition-all duration-200 group-hover:scale-100 group-hover:opacity-100',
              showRenderInfo ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
            )}
          >
            <p className="text-[10px] font-semibold tracking-[0.22em] text-zinc-500">{L('渲染信息', 'Render info')}</p>
            <p className="mt-1 text-[11px] text-zinc-300">
              {L('画质档位', 'Quality')} · <span className="font-semibold text-amber-200">{qualityLabel}</span>
              <span className="ml-1 text-zinc-500">{renderScale}%</span>
            </p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">
              {L('帧率持续低于 24 时会自动降档', 'Auto-drops one level when FPS stays below 24')}
            </p>
          </div>
        </div>
      </div>

      {/* ---------------- F11 auto-quality toast ---------------- */}
      <div
        aria-live="polite"
        className={cn(
          'pointer-events-none absolute bottom-[calc(4rem+var(--ui-safe-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-full border border-amber-300/30 bg-black/70 px-4 py-2 text-[12px] font-medium tracking-wide text-amber-100 shadow-xl shadow-black/60 backdrop-blur-xl transition-all duration-300 portrait:w-max portrait:max-w-[92vw] portrait:text-center',
          autoToastLevel !== null ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
        )}
      >
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-300 align-middle shadow-[0_0_8px_rgba(252,211,77,0.9)]" aria-hidden />
        {autoToastLevel !== null
          ? L(
              `帧率偏低，已自动切换至「${QUALITY_ZH[autoToastLevel]}」画质`,
              `Low frame rate — switched to ${QUALITY_EN[autoToastLevel]} quality`
            )
          : null}
      </div>

      {/* ---------------- settings dialog ---------------- */}
      {settingsOpen && (
        <div
          ref={settingsOverlayRef}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={closeSettings}
        >
          <div
            ref={settingsDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={L('设置', 'Settings')}
            className="max-h-[86dvh] w-[min(92vw,28rem)] overflow-y-auto rounded-2xl border border-white/10 bg-black/75 p-5 shadow-2xl shadow-black/70 backdrop-blur-2xl universe-scroll"
            onClick={(e) => e.stopPropagation()}
          >
            {/* dialog header */}
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-[0.22em] text-zinc-50">
                <Settings className="h-4 w-4 text-amber-300" aria-hidden />
                {L('设置', 'Settings')}
              </h2>
              <button
                type="button"
                onClick={closeSettings}
                aria-label={L('关闭设置', 'Close settings')}
                className="rounded-lg border border-white/10 bg-black/40 p-1.5 text-zinc-400 transition-colors duration-200 hover:border-white/25 hover:text-zinc-100"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {/* language */}
            <section className="mt-5">
              <p className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.26em] text-zinc-500">
                <Languages className="h-3.5 w-3.5" aria-hidden />
                {L('语言', 'Language')}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {langOptions.map((opt) => (
                  <button
                    key={opt.mode}
                    type="button"
                    onClick={() => handleLangModeChange(opt.mode)}
                    aria-pressed={langMode === opt.mode}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all duration-300',
                      langMode === opt.mode
                        ? 'border-amber-300/40 bg-gradient-to-b from-amber-200/20 to-amber-400/10 text-amber-200 shadow-[inset_0_0_0_1px_rgba(252,211,77,0.25),0_0_18px_rgba(251,191,36,0.12)]'
                        : 'border-white/10 bg-black/40 text-zinc-300 hover:border-amber-200/30 hover:text-amber-100'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>

            {/* keyboard shortcuts */}
            <section className="mt-5">
              <p className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.26em] text-zinc-500">
                <Keyboard className="h-3.5 w-3.5" aria-hidden />
                {L('键盘快捷键', 'Keyboard shortcuts')}
              </p>
              <ul className="uni-anim-stagger mt-2.5 space-y-1.5">
                {shortcuts.map((s) => (
                  <li
                    key={s.keys}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-1.5"
                  >
                    <kbd className="rounded-md border border-white/10 bg-black/50 px-2 py-0.5 font-mono text-[11px] text-amber-200/90">
                      {s.keys}
                    </kbd>
                    <span className="text-[11px] text-zinc-400">{s.desc}</span>
                  </li>
                ))}
              </ul>
            </section>

            <p className="mt-5 border-t border-white/5 pt-3 text-center text-[10px] font-semibold tracking-[0.34em] text-zinc-600">
              UNIVERSE · v0.6
            </p>
          </div>
        </div>
      )}

      {/* subtle vignette */}
      <div className="pointer-events-none absolute inset-0 z-30 shadow-[inset_0_0_180px_rgba(0,0,0,0.55)]" aria-hidden />
    </div>
  );
}
