import { useCallback, useEffect, useState } from 'react';

// Light or dark: the viewer's choice, kept in this browser. "system" follows the OS.
// index.html sets data-theme before the first paint, so a light viewer sees no dark flash.

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'moavi-theme';

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'light';   // light by default
  } catch {
    return 'light';
  }
}

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

export function effective(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref;
}

function apply(pref: ThemePref) {
  document.documentElement.dataset.theme = effective(pref);
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  useEffect(() => {
    apply(pref);
    if (pref !== 'system' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => apply('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [pref]);
  const setPref = useCallback((p: ThemePref) => {
    try { localStorage.setItem(KEY, p); } catch { /* private window: this visit only */ }
    setPrefState(p);
  }, []);
  return { pref, mode: effective(pref), setPref };
}

// Colour theme: the accent and the console's top bar, the viewer's choice in this browser (the
// user menu). 'default' is the site's own colour (teal, or the white label's primary colour);
// the others are in src/themes.css as html[data-accent].
export type ColorTheme = 'default' | 'blue' | 'mint' | 'indigo' | 'violet' | 'rose' | 'orange' | 'green' | 'graphite';
export const COLOR_THEMES: { id: ColorTheme; ko: string; en: string; swatch: string; bar: string }[] = [
  { id: 'default', ko: '기본 (청록)', en: 'Default (teal)', swatch: '#0B7373', bar: '#0F182C' },
  { id: 'blue', ko: '블루', en: 'Blue', swatch: '#1F6FEB', bar: '#FFFFFF' },
  { id: 'mint', ko: '민트', en: 'Mint', swatch: '#0E9384', bar: '#FFFFFF' },
  { id: 'indigo', ko: '인디고', en: 'Indigo', swatch: '#4F46E5', bar: '#4F46E5' },
  { id: 'violet', ko: '바이올렛', en: 'Violet', swatch: '#7C3AED', bar: '#FFFFFF' },
  { id: 'rose', ko: '로즈', en: 'Rose', swatch: '#C8235E', bar: '#FFFFFF' },
  { id: 'orange', ko: '오렌지', en: 'Orange', swatch: '#C2410C', bar: '#FFFFFF' },
  { id: 'green', ko: '그린', en: 'Green', swatch: '#15803D', bar: '#FFFFFF' },
  { id: 'graphite', ko: '그래파이트', en: 'Graphite', swatch: '#334155', bar: '#FFFFFF' },
];
const COLOR_KEY = 'moavi-color';

export function readColor(): ColorTheme {
  try {
    const v = localStorage.getItem(COLOR_KEY);
    return COLOR_THEMES.some((x) => x.id === v) ? (v as ColorTheme) : 'default';
  } catch {
    return 'default';
  }
}

function applyColor(c: ColorTheme) {
  if (c === 'default') delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = c;
}

export function useColorTheme() {
  const [color, setState] = useState<ColorTheme>(readColor);
  useEffect(() => { applyColor(color); }, [color]);
  const setColor = useCallback((c: ColorTheme) => {
    try { localStorage.setItem(COLOR_KEY, c); } catch { /* private window: this visit only */ }
    setState(c);
  }, []);
  return { color, setColor };
}
