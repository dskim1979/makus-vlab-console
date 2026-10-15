import { BRAND } from '../brand';
import { useI18n } from '../i18n';

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#1559d6" />
      <rect x="7" y="8" width="18" height="12" rx="2" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M12 24h8M16 20v4" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function BrandName({ withTag = false }: { withTag?: boolean }) {
  const { pick } = useI18n();
  return (
    <span className="brand-name">
      {BRAND.productName}
      {withTag && <span className="brand-tag">{pick(BRAND.productTag)}</span>}
    </span>
  );
}
