'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Orbit, Sparkles, CircleDot, Rocket, Loader2, Camera, Check, Gauge, Volume2, VolumeX, Bell, BellOff, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { takeScreenshot, downloadDataUrl } from '@/components/universe/capture';
import { ambient, playEventSound } from '@/components/universe/soundscape';
import {
  cycleQuality,
  getQualityLabel,
  getRenderScale,
  onAutoQualityChange,
} from '@/components/universe/quality';

type SceneId = 'solar' | 'galaxy' | 'blackhole';

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

const SCENE_TABS: { id: SceneId; label: string; sub: string; icon: typeof Orbit }[] = [
  { id: 'solar', label: '太阳系', sub: 'SOLAR SYSTEM', icon: Orbit },
  { id: 'galaxy', label: '银河系', sub: 'MILKY WAY', icon: Sparkles },
  { id: 'blackhole', label: '黑洞', sub: 'BLACK HOLE', icon: CircleDot },
];

function SceneLoading() {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#020208]">
      <Loader2 className="h-8 w-8 animate-spin text-amber-300/80" aria-hidden />
      <p className="text-sm tracking-[0.3em] text-zinc-400">正在初始化场景 …</p>
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

export default function UniverseBrowser() {
  const [active, setActive] = useState<SceneId>('solar');
  const [shotFlash, setShotFlash] = useState(false);
  const [qualityLabel, setQualityLabel] = useState('高清');
  const [renderScale, setRenderScale] = useState(100);
  const [autoToast, setAutoToast] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [sfxOn, setSfxOn] = useState<boolean>(loadSfxPreference); // F37
  const [ambientVol, setAmbientVol] = useState<number>(() => loadVolume(AMBIENT_VOL_LS_KEY)); // F39
  const [sfxVol, setSfxVol] = useState<number>(() => loadVolume(SFX_VOL_LS_KEY)); // F39
  const [audioPanelOpen, setAudioPanelOpen] = useState(false); // F39 — volume popover
  const [showRenderInfo, setShowRenderInfo] = useState(false); // F24 — tap support for touch devices
  const flashTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );

  /* F11 — toast when the FPS governor auto-drops quality */
  useEffect(() => {
    return onAutoQualityChange((level) => {
      const labels = ['流畅', '均衡', '高清'];
      const scales = [50, 75, 100];
      setQualityLabel(labels[level]);
      setRenderScale(scales[level]);
      setAutoToast(`帧率偏低，已自动切换至「${labels[level]}」画质`);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setAutoToast(null), 5000);
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
      if (id !== active) playEventSound('switch'); // F23 — airy swish on scene change
      setActive(id);
    },
    [active]
  );

  /* F40 — keyboard shortcuts: 1/2/3 scenes · M master mute · Space solar pause.
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
      else if (k === 'm') handleSoundToggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [switchTo, handleSoundToggle]);

  const handleQualityCycle = useCallback(() => {
    cycleQuality();
    setQualityLabel(getQualityLabel());
    setRenderScale(Math.round(getRenderScale() * 100));
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

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#020208] text-zinc-100 select-none">
      {/* ---------------- 3D scene layer ---------------- */}
      <main className="absolute inset-0" aria-label="3D 宇宙场景">
        {active === 'solar' && <SolarSystemScene />}
        {active === 'galaxy' && <GalaxyScene />}
        {active === 'blackhole' && <BlackHoleScene />}
      </main>

      {/* ---------------- top glass header ----------------
           F44 — portrait: wraps into two rows via CSS order
             row 1 = brand (order-1) + icon cluster (order-2)
             row 2 = scene tabs stretched full-width (order-3)
           landscape keeps the original single-row justify-between. */}
      <header
        className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 via-black/25 to-transparent px-4 pb-8 pt-[max(0.75rem,var(--ui-safe-top))] sm:px-6 portrait:flex-wrap portrait:gap-y-2"
      >
        {/* brand */}
        <div className="pointer-events-auto flex items-center gap-3 portrait:order-1 portrait:gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300/25 bg-amber-300/10 shadow-[0_0_18px_rgba(251,191,36,0.15)] portrait:h-8 portrait:w-8">
            <Rocket className="h-4.5 w-4.5 text-amber-300 portrait:h-4 portrait:w-4" aria-hidden />
          </div>
          <div className="leading-tight">
            <h1 className="whitespace-nowrap text-[15px] font-semibold tracking-[0.22em] text-zinc-50 portrait:text-[13px] portrait:tracking-[0.16em]">宇宙浏览器</h1>
            <p className="whitespace-nowrap text-[10px] font-medium tracking-[0.34em] text-amber-200/60 portrait:hidden">UNIVERSE EXPLORER</p>
          </div>
        </div>

        {/* tabs */}
        <nav
          aria-label="场景切换"
          className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/10 bg-black/45 p-1.5 shadow-lg shadow-black/40 backdrop-blur-xl portrait:order-3 portrait:w-full portrait:justify-center"
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
                <span>{tab.label}</span>
                <span
                  className={cn(
                    'hidden text-[9px] font-semibold tracking-[0.22em] lg:inline',
                    isActive ? 'text-amber-200/60' : 'text-zinc-600'
                  )}
                >
                  {tab.sub}
                </span>
                {isActive && (
                  <span className="absolute -bottom-[7px] left-1/2 h-[2px] w-8 -translate-x-1/2 rounded-full bg-amber-300/80 shadow-[0_0_8px_rgba(252,211,77,0.8)]" />
                )}
              </button>
            );
          })}
        </nav>

        {/* right cluster: sound + quality + screenshot + badge */}
        <div className="pointer-events-auto flex items-center gap-2 portrait:order-2 portrait:gap-1">
          <button
            type="button"
            onClick={handleSoundToggle}
            aria-label={soundOn ? '关闭全部音效' : '开启音效'}
            aria-pressed={soundOn}
            title="音效总开关（环境音 + UI 音）· 快捷键 M"
            className={cn(
              'flex h-9 items-center gap-2 rounded-lg border px-2.5 backdrop-blur-xl transition-all duration-300 portrait:px-2 [@media(pointer:coarse)]:h-11',
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
              音效
            </span>
          </button>
          <button
            type="button"
            onClick={handleSfxToggle}
            aria-label={sfxOn ? '关闭 UI 音效' : '开启 UI 音效'}
            aria-pressed={sfxOn}
            title="UI 事件音效（点击/截图反馈音，受总开关控制）"
            className={cn(
              'flex h-9 items-center gap-2 rounded-lg border px-2.5 backdrop-blur-xl transition-all duration-300 portrait:px-2 [@media(pointer:coarse)]:h-11',
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
              UI 音
            </span>
          </button>
          {/* F39 — volume sliders popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setAudioPanelOpen((v) => !v)}
              aria-label={audioPanelOpen ? '关闭音量设置' : '打开音量设置'}
              aria-expanded={audioPanelOpen}
              title="音量设置"
              className={cn(
                'flex h-9 items-center gap-2 rounded-lg border px-2.5 backdrop-blur-xl transition-all duration-300 portrait:px-2 [@media(pointer:coarse)]:h-11',
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
                onClick={() => setAudioPanelOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
            )}
            {audioPanelOpen && (
              <div
                role="dialog"
                aria-label="音量设置"
                className="absolute right-0 top-11 z-50 w-[264px] rounded-2xl border border-white/10 bg-black/75 p-4 shadow-2xl shadow-black/60 backdrop-blur-2xl"
              >
                <p className="text-[10px] font-semibold tracking-[0.26em] text-zinc-500">音量设置</p>
                <div
                  className={cn(
                    'mt-3 space-y-4 transition-opacity duration-200',
                    !soundOn && 'pointer-events-none opacity-40'
                  )}
                >
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label htmlFor="vol-ambient" className="text-[11px] font-medium tracking-wider text-zinc-300">
                        环境音音量
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
                      aria-label="环境音音量"
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label htmlFor="vol-sfx" className="text-[11px] font-medium tracking-wider text-zinc-300">
                        UI 音音量
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
                      aria-label="UI 音音量"
                    />
                  </div>
                </div>
                <p className="mt-3 border-t border-white/5 pt-2 text-[10px] leading-relaxed text-zinc-500">
                  {!soundOn
                    ? '总开关已关闭 · 打开「音效」后可调节'
                    : '「音效」为总开关 · M 键快速静音 · 1/2/3 切场景 · 空格暂停太阳系'}
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleQualityCycle}
            aria-label="切换渲染画质（高清 / 均衡 / 流畅）"
            title="渲染分辨率：高清 100% · 均衡 75% · 流畅 50%"
            className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-2.5 text-zinc-300 backdrop-blur-xl transition-all duration-300 hover:border-violet-300/40 hover:bg-black/60 hover:text-violet-200 portrait:px-2 [@media(pointer:coarse)]:h-11"
          >
            <Gauge className="h-4 w-4" aria-hidden />
            <span className="hidden whitespace-nowrap text-[11px] font-medium tracking-wider lg:inline">{qualityLabel}</span>
          </button>
          <button
            type="button"
            onClick={handleScreenshot}
            aria-label="截图当前场景并下载"
            title="截图当前场景（PNG）"
            className={cn(
              'flex h-9 items-center gap-2 rounded-lg border px-2.5 backdrop-blur-xl transition-all duration-300 portrait:px-2 [@media(pointer:coarse)]:h-11',
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
              {shotFlash ? '截图已保存' : '截图'}
            </span>
          </button>
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 backdrop-blur-xl lg:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
            <span className="whitespace-nowrap text-[11px] tracking-wider text-zinc-400">全程序化材质 · Three.js WebGL</span>
          </div>
        </div>
      </header>

      {/* ---------------- persistent FPS badge ---------------- */}
      <div
        className="group absolute bottom-[calc(1rem+var(--ui-safe-bottom))] left-4 z-40 flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-black/50 px-3.5 py-2 shadow-lg shadow-black/50 backdrop-blur-xl"
        role="status"
        aria-label="帧率显示（点击查看渲染信息）"
        onClick={() => setShowRenderInfo((v) => !v)}
      >
        <span id="fps-dot" className="h-2 w-2 rounded-full bg-emerald-400" style={{ backgroundColor: '#4ade80' }} aria-hidden />
        <div className="flex items-baseline gap-1.5 font-mono leading-none">
          <span id="fps-value" className="text-lg font-semibold tabular-nums text-zinc-100">
            --
          </span>
          <span className="text-[10px] tracking-[0.2em] text-zinc-500">FPS</span>
        </div>
        {/* hover detail: live render-resolution info (F24: also tap-toggleable for touch) */}
        <div
          className={cn(
            'pointer-events-none absolute bottom-[calc(100%+8px)] left-0 w-max origin-bottom-left rounded-lg border border-white/10 bg-black/75 px-3 py-2 shadow-xl shadow-black/60 backdrop-blur-xl transition-all duration-200 group-hover:scale-100 group-hover:opacity-100',
            showRenderInfo ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          )}
        >
          <p className="text-[10px] font-semibold tracking-[0.22em] text-zinc-500">渲染信息</p>
          <p className="mt-1 text-[11px] text-zinc-300">
            画质档位 · <span className="font-semibold text-amber-200">{qualityLabel}</span>
            <span className="ml-1 text-zinc-500">{renderScale}%</span>
          </p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">
            帧率持续低于 24 时会自动降档
          </p>
        </div>
      </div>

      {/* ---------------- F11 auto-quality toast ---------------- */}
      <div
        aria-live="polite"
        className={cn(
          'pointer-events-none absolute bottom-[calc(4rem+var(--ui-safe-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-full border border-amber-300/30 bg-black/70 px-4 py-2 text-[12px] font-medium tracking-wide text-amber-100 shadow-xl shadow-black/60 backdrop-blur-xl transition-all duration-300 portrait:w-max portrait:max-w-[92vw] portrait:text-center',
          autoToast ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
        )}
      >
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-300 align-middle shadow-[0_0_8px_rgba(252,211,77,0.9)]" aria-hidden />
        {autoToast}
      </div>

      {/* subtle vignette */}
      <div className="pointer-events-none absolute inset-0 z-30 shadow-[inset_0_0_180px_rgba(0,0,0,0.55)]" aria-hidden />
    </div>
  );
}
