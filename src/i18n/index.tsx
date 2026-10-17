import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { messages, type Lang, type MessageKey } from './messages';

export type Localized = { ko: string; en: string };

type I18n = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MessageKey) => string;
  pick: (text: Localized) => string;
};

const I18nContext = createContext<I18n | null>(null);
const STORAGE_KEY = 'vlab.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch {
    // storage blocked: fall through to the browser language
  }
  return navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* per-browser convenience only */ }
  }, []);

  const value = useMemo<I18n>(() => ({
    lang,
    setLang,
    // a key built from server data (an alert severity, a state) may be unknown: '' lets the caller's fallback show
    t: (key) => messages[key]?.[lang] ?? '',
    pick: (text) => text[lang],
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}
