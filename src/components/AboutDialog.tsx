import { useEffect, useRef } from 'react';
import { BRAND, ENGINE_NOTICE } from '../brand';
import { useI18n } from '../i18n';
import { useBranding, useSupportUrl } from '../branding';
import { BrandMark, BrandName } from './Brand';

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, pick } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const { b } = useBranding();
  const support = useSupportUrl();

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
        {!b.hideVersion && <><dt>{t('about.version')}</dt>
        <dd>{__APP_VERSION__}</dd></>}
        <dt>{t('sup.remote')}</dt><dd><a href={support} target="_blank" rel="noopener noreferrer">{support}</a></dd>
        {b.docsUrl && <><dt>{t('wl.docs')}</dt><dd><a href={b.docsUrl} target="_blank" rel="noreferrer">{b.docsUrl}</a></dd></>}
        <dt>{t('about.engine')}</dt>
        <dd>
          <span className="strong">Powered by <a href={ENGINE_NOTICE.homepage} target="_blank" rel="noreferrer">{ENGINE_NOTICE.name}</a></span>
          <br />
          {ENGINE_NOTICE.copyright} · {ENGINE_NOTICE.license}
          <br />
          <span className="muted">{t('about.engineText')}</span>
          <br />
          {t('about.source')}: <a href={ENGINE_NOTICE.source} target="_blank" rel="noreferrer">{ENGINE_NOTICE.source}</a>
        </dd>
      </dl>
      <div className="muted small">{b.footerText || `© ${pick(BRAND.company)}`}</div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>{t('about.close')}</button>
      </div>
    </dialog>
  );
}
