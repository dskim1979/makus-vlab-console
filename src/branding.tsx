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
      root.setProperty('--accent-hover', `color-mix(in srgb, ${b.primaryColor} 82%, #000)`);
      root.setProperty('--accent-soft', `color-mix(in srgb, ${b.primaryColor} 12%, var(--surface))`);
      root.setProperty('--accent-ring', `color-mix(in srgb, ${b.primaryColor} 25%, transparent)`);
    } else {
      ['--accent', '--accent-hover', '--accent-soft', '--accent-ring'].forEach((v) => root.removeProperty(v));
    }
  }, [b, custom]);

  return <Ctx.Provider value={{ b: custom ? b : DEFAULT_BRANDING, custom, reload: load }}>{children}</Ctx.Provider>;
}

export const useBranding = () => useContext(Ctx);
