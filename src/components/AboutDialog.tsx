import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../api/admin';
import type { Summary } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { BRAND, ENGINE_NOTICE } from '../brand';
import { useI18n } from '../i18n';
import { useBranding, useSupportUrl } from '../branding';
import { BrandMark, BrandName } from './Brand';

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, pick } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const { b } = useBranding();
  const support = useSupportUrl();
  const { isAdmin } = useAuth();
  const [versions, setVersions] = useState<Summary['versions'] | null>(null);
  // admins see the engine's version too (the summary call is theirs only)
  useEffect(() => {
    if (!open || !isAdmin || versions) return;
    adminApi.summary().then((s) => setVersions(s.versions)).catch(() => setVersions(null));
  }, [open, isAdmin, versions]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <div className="dialog-head">
        <BrandMark size={36} />
        <div>
          <div className="dialog-title"><BrandName /></div>
          <div className="muted">{pick(BRAND.tagline)}</div>
        </div>
      </div>
      <dl className="about-list">
        {!b.hideVersion && <><dt>{t('sum.console')}</dt><dd>{__APP_VERSION__}</dd></>}
        {!b.hideVersion && versions && <>
          <dt>{t('sum.engine')}</dt><dd>{versions.engine} · Desk API {versions.vlab_api}</dd>
          {versions.build && <><dt>{t('sum.build')}</dt><dd>{versions.build}</dd></>}
        </>}
        <dt>{t('sup.remote')}</dt><dd><a href={support} target="_blank" rel="noopener noreferrer">{pick({ ko: '지원 사이트 열기', en: 'Open the support site' })}</a></dd>
        {b.docsUrl && <><dt>{t('wl.docs')}</dt><dd><a href={b.docsUrl} target="_blank" rel="noreferrer">{pick({ ko: '문서 열기', en: 'Open the docs' })}</a></dd></>}
        <dt>{pick({ ko: '라이선스', en: 'Licence' })}</dt>
        <dd>
          {pick({ ko: '콘솔 · 엔진 AGPL-3.0, Windows 클라이언트 MIT', en: 'Console and engine AGPL-3.0, Windows client MIT' })}
          <br />
          <a href={BRAND.sources.console} target="_blank" rel="noreferrer">{pick({ ko: '콘솔 소스', en: 'Console source' })}</a>
          {' · '}
          <a href={BRAND.sources.client} target="_blank" rel="noreferrer">{pick({ ko: '클라이언트 소스', en: 'Client source' })}</a>
        </dd>
        <dt>{t('about.engine')}</dt>
        <dd>
          <span className="strong">Powered by <a href={ENGINE_NOTICE.homepage} target="_blank" rel="noreferrer">{ENGINE_NOTICE.name}</a></span>
          <br />
          {ENGINE_NOTICE.copyright} · {ENGINE_NOTICE.license}
          <br />
          <span className="muted">{t('about.engineText')}</span>
          <br />
          <a href={ENGINE_NOTICE.source} target="_blank" rel="noreferrer">{pick({ ko: '엔진 소스', en: 'Engine source' })}</a>
        </dd>
      </dl>
      <div className="muted small">{b.footerText || `© ${pick(BRAND.company)}`}</div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>{t('about.close')}</button>
      </div>
    </dialog>
  );
}
