import { useId } from 'react';
import { BRAND } from '../brand';
import { useBranding } from '../branding';
import { useI18n } from '../i18n';

// The vLAB symbol, drawn like MOAVI's: navy-to-blue tile, white stroke, teal nodes (a V for vLAB).
export function BrandMark({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="brand-mark">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0A2A66" /><stop offset="1" stopColor="#1668E3" /></linearGradient></defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id})`} />
      <path d="M16 19 L32 44 L48 19" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="19" r="3.4" fill="#2FD4C4" /><circle cx="48" cy="19" r="3.4" fill="#2FD4C4" />
      <circle cx="32" cy="44" r="7" fill="#fff" /><circle cx="32" cy="44" r="5.2" fill="#2FD4C4" />
    </svg>
  );
}

// "MAKUS vLAB" as a word mark (v in the accent, like MOAVI's VI), or the white label's name.
export function BrandName({ withTag = false }: { withTag?: boolean }) {
  const { pick } = useI18n();
  const { b, custom } = useBranding();
  if (custom && b.appName && b.appName !== BRAND.productName) return <span className="brand-name">{b.appName}</span>;
  return (
    <span className="brand-name">
      <span className="brand-makus">MAKUS</span> <span className="brand-product"><span className="brand-v">v</span>LAB</span>
      {withTag && <span className="brand-tag">{pick(BRAND.productTag)}</span>}
    </span>
  );
}

// The top bar's brand: the white label's logo image when it has one, else mark + name.
export function BrandLockup({ markSize = 26, login = false }: { markSize?: number; login?: boolean }) {
  const { b } = useBranding();
  const src = login ? b.loginLogoUrl || b.logoUrl : b.logoUrl;
  if (src) return <img className={login ? 'brand-logo-login' : 'brand-logo'} src={src} alt={b.appName} />;
  return <><BrandMark size={markSize} /><BrandName /></>;
}
