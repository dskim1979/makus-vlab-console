import { BRAND } from '../brand';
import { useBranding } from '../branding';
import { useI18n } from '../i18n';

// The sign-in and first-start screens carry the company's line. The engine's attribution
// ("Powered by PegaProx", AGPL-3.0, its source) is in About and 운영 > 시스템 요약.
export function CompanyNotice() {
  const { pick } = useI18n();
  const { b } = useBranding();
  return <p className="engine-notice">{b.footerText || `© ${new Date().getFullYear()} ${pick(BRAND.company)} · ${BRAND.productName}`}</p>;
}
