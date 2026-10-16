import { BRAND } from '../brand';
import { useBranding } from '../branding';
import { useI18n } from '../i18n';

// "MOAVI Desk는 100% 무료 오픈소스로 배포됩니다" with the source links (AGPL-3.0 section 13: the
// people who use it over the network are offered its source). A white label keeps the source
// link and drops the slogan.
export function OpenSourceNote() {
  const { pick } = useI18n();
  const { custom } = useBranding();
  return (
    <p className="oss-note">
      {!custom && <span className="oss-slogan">{pick(BRAND.openSource)}</span>}
      <span className="oss-links">
        {pick({ ko: '소스 코드', en: 'Source' })}: <a href={BRAND.sources.console} target="_blank" rel="noreferrer">{pick({ ko: '콘솔', en: 'console' })}</a>
        {' · '}<a href={BRAND.sources.engine} target="_blank" rel="noreferrer">{pick({ ko: '엔진', en: 'engine' })}</a>
        {' · '}<a href={BRAND.sources.client} target="_blank" rel="noreferrer">{pick({ ko: '클라이언트', en: 'client' })}</a>
        {' · AGPL-3.0 / MIT'}
      </span>
    </p>
  );
}
