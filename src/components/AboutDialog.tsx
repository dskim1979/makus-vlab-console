import { useEffect, useRef } from 'react';
import { BRAND, ENGINE_NOTICE } from '../brand';
import { useI18n } from '../i18n';
import { BrandMark, BrandName } from './Brand';

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, pick } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

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
          <div className="dialog-title"><BrandName withTag /></div>
          <div className="muted">{pick(BRAND.tagline)}</div>
        </div>
      </div>
      <dl className="about-list">
        <dt>{t('about.version')}</dt>
        <dd>{__APP_VERSION__}</dd>
        <dt>{t('about.engine')}</dt>
        <dd>
          {ENGINE_NOTICE.name} · {ENGINE_NOTICE.copyright} · {ENGINE_NOTICE.license}
          <br />
          <span className="muted">{t('about.engineText')}</span>
          <br />
          <a href={ENGINE_NOTICE.source} target="_blank" rel="noreferrer">{ENGINE_NOTICE.source}</a>
        </dd>
      </dl>
      <div className="muted small">© {pick(BRAND.company)}</div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>{t('about.close')}</button>
      </div>
    </dialog>
  );
}
