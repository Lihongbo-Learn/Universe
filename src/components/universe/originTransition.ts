'use client';

/**
 * Origin-aware transitions (一镜到底): panels open *from* the trigger the user
 * clicked and close *back into* it, with no jump cuts.
 *
 * Usage (vanilla DOM, works in effects and render loops):
 *   // on open — before/while the panel mounts or becomes visible:
 *   setOriginFromTrigger(panelEl, triggerEl);   // or setOriginFromPoint(panelEl, x, y)
 *   playEnter(panelEl, 'uni-origin-in');
 *
 *   // on close — keep the panel mounted until onDone:
 *   playExit(panelEl, 'uni-origin-out', () => { /* actually hide/unmount now *\/ });
 */

/** Set transform-origin so scale animations collapse toward a viewport point. */
export function setOriginFromPoint(el: HTMLElement, x: number, y: number) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  const ox = Math.min(Math.max(x - r.left, 0), r.width);
  const oy = Math.min(Math.max(y - r.top, 0), r.height);
  el.style.transformOrigin = `${ox}px ${oy}px`;
}

/** Set transform-origin toward the center of a trigger element (clamped into the panel). */
export function setOriginFromTrigger(el: HTMLElement, trigger: Element | null) {
  if (!el || !trigger) return;
  const tr = trigger.getBoundingClientRect();
  if (tr.width === 0 && tr.height === 0) return;
  setOriginFromPoint(el, tr.left + tr.width / 2, tr.top + tr.height / 2);
}

/** Replay an enter animation (restarts even if the same class is already applied). */
export function playEnter(el: HTMLElement, cls = 'uni-origin-in') {
  el.classList.remove('uni-origin-in', 'uni-origin-out', 'uni-fade-out');
  void el.offsetWidth; // reflow to restart the animation
  el.classList.add(cls);
}

/**
 * Play an exit animation; `onDone` fires when it finishes (animationend or the
 * duration timeout, whichever first). The caller should hide/unmount afterwards.
 */
export function playExit(el: HTMLElement, cls = 'uni-origin-out', onDone?: () => void, durationMs = 380) {
  if (!el) {
    onDone?.();
    return;
  }
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    el.removeEventListener('animationend', onEnd);
    onDone?.();
  };
  const onEnd = (e: AnimationEvent) => {
    if (e.animationName.includes('out')) finish();
  };
  el.addEventListener('animationend', onEnd);
  window.setTimeout(finish, durationMs + 40);
  el.classList.remove('uni-origin-in', 'uni-origin-out', 'uni-fade-out');
  void el.offsetWidth;
  el.classList.add(cls);
}
