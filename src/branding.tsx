import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api/client';
import type { Branding } from './api/types';
import { BRAND } from './brand';

// White label (운영 > 화이트라벨): the engine keeps it (its front-end branding record) and
// /api/vlab/branding hands it to every screen, the sign-in one included. Disabled or not
// set, the product's own look (brand.ts) shows.

export const DEFAULT_BRANDING: Branding = {
  enabled: false, appName: BRAND.productName, browserTitle: '', logoUrl: '', loginLogoUrl: '', faviconUrl: '',
  primaryColor: '', footerText: '', loginTagline: '', docsUrl: '', supportUrl: '', hideVersion: false,
};

const Ctx = createContext<{ b: Branding; custom: boolean; reload: () => void }>({
  b: DEFAULT_BRANDING, custom: false, reload: () => undefined,
});

function setFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = href.endsWith('.svg') ? 'image/svg+xml' : '';
  link.href = href;
}

// Text on the accent colour: navy on light accents (the teal default), white on dark ones.
function onAccent(hex: string) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#0F182C';
  const n = parseInt(m[1], 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.3 ? '#0F182C' : '#FFFFFF';
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [b, setB] = useState<Branding>(DEFAULT_BRANDING);
  const load = useCallback(() => {
    api.branding().then((x) => setB({ ...DEFAULT_BRANDING, ...x })).catch(() => setB(DEFAULT_BRANDING));
  }, []);
  useEffect(load, [load]);

  const custom = b.enabled;
  useEffect(() => {
    document.title = (custom && (b.browserTitle || b.appName)) || BRAND.productName;
    setFavicon((custom && b.faviconUrl) || '/favicon.svg');
    const root = document.documentElement.style;
    if (custom && b.primaryColor) {
      root.setProperty('--accent', b.primaryColor);
      root.setProperty('--accent-hover', `color-mix(in srgb, ${b.primaryColor} 80%, #fff)`);
      root.setProperty('--accent-soft', `color-mix(in srgb, ${b.primaryColor} 18%, var(--surface))`);
      root.setProperty('--accent-ring', `color-mix(in srgb, ${b.primaryColor} 35%, transparent)`);
      root.setProperty('--on-accent', onAccent(b.primaryColor));
    } else {
      ['--accent', '--accent-hover', '--accent-soft', '--accent-ring', '--on-accent'].forEach((v) => root.removeProperty(v));
    }
  }, [b, custom]);

  return <Ctx.Provider value={{ b: custom ? b : DEFAULT_BRANDING, custom, reload: load }}>{children}</Ctx.Provider>;
}

export const useBranding = () => useContext(Ctx);
