/**
 * F5 — global render-scale quality switcher.
 * The FPS badge area hosts a cyclic button (流畅 → 均衡 → 高清).
 * Every mounted scene subscribes and applies `basePixelRatio * scale`
 * to its renderer (and composer where present) on change.
 */

export type QualityLevel = 0 | 1 | 2; // 0 = 流畅, 1 = 均衡, 2 = 高清

const SCALE_BY_LEVEL = [0.5, 0.75, 1.0] as const;
const LABELS = ['流畅', '均衡', '高清'] as const;

let level: QualityLevel = 2;
const listeners = new Set<(scale: number) => void>();

/* -------- F41: FPS-driven recovery — restore levels the governor dropped -------- */

/** Consecutive ≥45 fps samples (0.5 s each) before restoring one level. */
const HIGH_STREAK_NEEDED = 24; // ≈ 12 s of headroom before stepping back up

let autoDropped = false; // true only between an auto drop and a manual override
let highStreak = 0;

/* -------- F11: FPS-driven auto quality (drop one level when stuck low) -------- */

/** Ignore low FPS during scene boot / JIT warmup. */
const GRACE_ON_LOAD_MS = 10000;
/** After a manual change (or an auto drop) wait before judging again. */
const GRACE_AFTER_CHANGE_MS = 6000;
/** Consecutive sub-24fps samples (0.5 s each) before dropping. */
const LOW_STREAK_NEEDED = 6;

let graceUntil = 0;
let booted = false;
let lowStreak = 0;
const autoListeners = new Set<(level: QualityLevel, scale: number) => void>();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Called by the shared FPS meter twice a second. */
export function notifyFps(fps: number): void {
  if (!booted) {
    booted = true;
    graceUntil = now() + GRACE_ON_LOAD_MS;
    return;
  }
  if (now() < graceUntil) return;
  if (fps >= 24) {
    lowStreak = 0;
    // F41 — sustained headroom: hand back one level every HIGH_STREAK_NEEDED
    // samples, but only levels this governor dropped itself (a manual choice
    // is respected and never silently overwritten upward).
    if (fps >= 45) {
      if (autoDropped && level < 2) {
        highStreak += 1;
        if (highStreak >= HIGH_STREAK_NEEDED) {
          highStreak = 0;
          level = (level + 1) as QualityLevel;
          graceUntil = now() + GRACE_AFTER_CHANGE_MS;
          const scale = SCALE_BY_LEVEL[level];
          listeners.forEach((fn) => fn(scale));
          autoListeners.forEach((fn) => fn(level, scale));
        }
      }
    } else {
      highStreak = 0;
    }
    return;
  }
  highStreak = 0;
  lowStreak += 1;
  if (lowStreak >= LOW_STREAK_NEEDED && level > 0) {
    level = (level - 1) as QualityLevel;
    lowStreak = 0;
    autoDropped = true;
    graceUntil = now() + GRACE_AFTER_CHANGE_MS;
    const scale = SCALE_BY_LEVEL[level];
    listeners.forEach((fn) => fn(scale));
    autoListeners.forEach((fn) => fn(level, scale));
  }
}

/** Subscribe to automatic quality drops (for UI toast). */
export function onAutoQualityChange(fn: (level: QualityLevel, scale: number) => void): () => void {
  autoListeners.add(fn);
  return () => {
    autoListeners.delete(fn);
  };
}

export function getQualityLevel(): QualityLevel {
  return level;
}

export function getQualityLabel(): string {
  return LABELS[level];
}

export function getRenderScale(): number {
  return SCALE_BY_LEVEL[level];
}

export function cycleQuality(): QualityLevel {
  level = ((level + 1) % 3) as QualityLevel;
  lowStreak = 0;
  highStreak = 0;
  autoDropped = false; // manual choice wins — no automatic step-up afterwards
  graceUntil = now() + GRACE_AFTER_CHANGE_MS; // manual override wins for a while
  const scale = SCALE_BY_LEVEL[level];
  listeners.forEach((fn) => fn(scale));
  return level;
}

/** Returns an unsubscribe function. The current scale is applied immediately. */
export function onRenderScaleChange(fn: (scale: number) => void): () => void {
  fn(SCALE_BY_LEVEL[level]);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
