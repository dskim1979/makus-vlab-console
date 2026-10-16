import { useId } from 'react';
import { BRAND } from '../brand';
import { useBranding } from '../branding';

// The MOAVI family symbol (navy-to-blue tile, white M, teal nodes), as MOAVI draws it.
export function BrandMark({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="brand-mark">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0A2A66" /><stop offset="1" stopColor="#1668E3" /></linearGradient></defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id})`} />
      <path d="M16 46 V20 L32 37 L48 20 V46" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="20" r="3.4" fill="#2FD4C4" /><circle cx="48" cy="20" r="3.4" fill="#2FD4C4" />
      <circle cx="32" cy="37" r="7" fill="#fff" /><circle cx="32" cy="37" r="5.2" fill="#2FD4C4" />
    </svg>
  );
}

// "MOAVI Desk" as a word mark: MOA + VI (accent) like MOAVI's own, then the product word. Or the white label's name.
export function BrandName() {
  const { b, custom } = useBranding();
  if (custom && b.appName && b.appName !== BRAND.productName) return <span className="brand-name">{b.appName}</span>;
  return (
    <span className="brand-name">
      <span className="brand-family">MOA<span className="brand-vi">VI</span></span> <span className="brand-product">Desk</span>
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
