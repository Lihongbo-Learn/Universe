/**
 * Shared FPS meter for all universe scenes.
 * Scenes call `createFpsMeter()` inside their animation loop setup and
 * invoke `fps.tick()` once per rendered frame. The meter writes results
 * directly into the DOM nodes rendered by <FpsBadge /> so React never
 * re-renders at 60fps.
 */

import { notifyFps } from '@/components/universe/quality';

function colorFor(fps: number): string {
  if (fps >= 50) return '#4ade80'; // green
  if (fps >= 30) return '#facc15'; // yellow
  if (fps >= 24) return '#fb923c'; // orange
  return '#f87171'; // red
}

export function updateFpsDisplay(fps: number): void {
  const value = document.getElementById('fps-value');
  if (value) value.textContent = String(fps);
  const dot = document.getElementById('fps-dot');
  if (dot) {
    dot.style.backgroundColor = colorFor(fps);
    dot.style.boxShadow = `0 0 6px ${colorFor(fps)}`;
  }
  notifyFps(fps); // feed the F11 auto-quality governor
}

export interface FpsMeter {
  tick: () => void;
  dispose: () => void;
}

export function createFpsMeter(): FpsMeter {
  let frames = 0;
  let last = performance.now();
  let disposed = false;

  const tick = () => {
    if (disposed) return;
    frames += 1;
    const now = performance.now();
    const elapsed = now - last;
    if (elapsed >= 500) {
      const fps = Math.round((frames * 1000) / elapsed);
      frames = 0;
      last = now;
      updateFpsDisplay(fps);
    }
  };

  const dispose = () => {
    disposed = true;
  };

  return { tick, dispose };
}
