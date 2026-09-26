'use client';

import { useSyncExternalStore } from 'react';

/**
 * Universe i18n core.
 * - Language mode: 'auto' (follow navigator.language) | 'zh' | 'en', persisted in localStorage.
 * - L(zh, en): inline bilingual helper — call it during render so it re-evaluates on language switch.
 * - useLang(): React hook that re-renders the component when the effective language changes.
 * - subscribeLang(fn): non-React subscription for canvas sprite redraws / document.lang etc.
 */

export type LangMode = 'auto' | 'zh' | 'en';
export type Lang = 'zh' | 'en';

const MODE_KEY = 'universe-lang';

let listeners = new Set<() => void>();

function loadMode(): LangMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'zh' || v === 'en' || v === 'auto') return v;
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}

let mode: LangMode = 'auto';
if (typeof window !== 'undefined') mode = loadMode();

export function getLangMode(): LangMode {
  return mode;
}

export function getLang(): Lang {
  if (mode === 'auto') {
    try {
      const nav = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN';
      return nav && nav.toLowerCase().startsWith('en') ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  }
  return mode;
}

export function setLangMode(next: LangMode) {
  mode = next;
  try {
    localStorage.setItem(MODE_KEY, next);
  } catch {
    /* storage unavailable */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-CN';
  }
  listeners.forEach((fn) => fn());
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React hook: re-renders when the effective language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, () => 'zh' as Lang);
}

/** Inline bilingual text: call during render; falls back to zh before hydration. */
export function L(zh: string, en: string): string {
  return getLang() === 'en' ? en : zh;
}
