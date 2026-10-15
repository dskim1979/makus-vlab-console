import { BRAND } from '../brand';
import { useBranding } from '../branding';
import { useI18n } from '../i18n';

// MAKUS red (www.makussystems.co.kr) with the desktop glyph of the product.
export const MAKUS_RED = '#E63946';

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
      <rect width="32" height="32" rx="7" fill={MAKUS_RED} />
      <rect x="7" y="8" width="18" height="12" rx="2" fill="none" stroke="#fff" strokeWidth="2.2" />
      <path d="M12 24h8M16 20v4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// "MAKUS vLAB" as a word mark, or the white label's name.
export function BrandName({ withTag = false }: { withTag?: boolean }) {
  const { pick } = useI18n();
  const { b, custom } = useBranding();
  if (custom && b.appName && b.appName !== BRAND.productName) return <span className="brand-name">{b.appName}</span>;
  return (
    <span className="brand-name">
      <span className="brand-makus">MAKUS</span> <span className="brand-product">vLAB</span>
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
