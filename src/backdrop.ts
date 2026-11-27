import { useCallback, useState } from 'react';

// The picture behind the sign-in page and the portal (light theme): one of the built-in ones, picked in
// the user menu and kept in this browser. index.html sets --backdrop before the first paint.
// Photos 1-6: Unsplash licence (credits in NOTICE.md); "moavi" is MOAVI Desk's own drawing.

export const BACKGROUNDS: { key: string; ko: string; en: string }[] = [
  { key: '1', ko: '노을 산 호수', en: 'Alpine lake at dusk' },
  { key: '2', ko: '푸른 호수', en: 'Blue lake' },
  { key: '3', ko: '숲 호수', en: 'Forest lake' },
  { key: '4', ko: '고요한 호수', en: 'Still lake' },
  { key: '5', ko: '구름 하늘', en: 'Cloudy sky' },
  { key: '6', ko: '해 뜨는 호수', en: 'Lake at sunrise' },
  { key: 'moavi', ko: 'MOAVI', en: 'MOAVI' },
];
const KEY = 'moavi-backdrop';
const DEFAULT = '1';

export function readBackdrop(): string {
  try {
    const v = localStorage.getItem(KEY);
    return v && BACKGROUNDS.some((b) => b.key === v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function apply(key: string) {
  document.documentElement.style.setProperty('--backdrop', `url("/backgrounds/${key}.jpg")`);
}

export function useBackdrop() {
  const [key, setKey] = useState(readBackdrop);
  const pick = useCallback((k: string) => {
    try { localStorage.setItem(KEY, k); } catch { /* private window: this visit only */ }
    apply(k);
    setKey(k);
  }, []);
  return { key, pick };
}
