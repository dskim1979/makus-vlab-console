import { useCallback, useEffect, useState } from 'react';

// Light or dark: the viewer's choice, kept in this browser. "system" follows the OS.
// index.html sets data-theme before the first paint, so a light viewer sees no dark flash.

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'moavi-theme';

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
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
