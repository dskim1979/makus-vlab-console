import { useEffect, useRef, useState, type FormEvent } from 'react';
import { adminApi } from '../../api/admin';
import type { Branding, BrandingSlot } from '../../api/types';
import { useBranding } from '../../branding';
import { BrandMark } from '../../components/Brand';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';

// 운영 > 화이트라벨: the engine's front-end branding record (name, texts, logos, favicon,
// colour, links), edited here and shown on every screen including sign-in.
export function BrandingPage() {
  const rec = useLoad(adminApi.branding);
  return (
    <LoadState value={rec} retry={rec.reload}>
      {(b) => <BrandingForm initial={b} />}
    </LoadState>
  );
}

const SLOTS: { slot: BrandingSlot; field: 'logoUrl' | 'loginLogoUrl' | 'faviconUrl'; label: MessageKey }[] = [
  { slot: 'logo', field: 'logoUrl', label: 'wl.logo' },
  { slot: 'loginLogo', field: 'loginLogoUrl', label: 'wl.loginLogo' },
  { slot: 'favicon', field: 'faviconUrl', label: 'wl.favicon' },
];

function BrandingForm({ initial }: { initial: Branding }) {
  const { t, pick } = useI18n();
  const { reload } = useBranding();
  const [b, setB] = useState<Branding>(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  useEffect(() => setB(initial), [initial]);
  const set = <K extends keyof Branding>(k: K, v: Branding[K]) => setB((o) => ({ ...o, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setNotice(null);
    try {
      setB(await adminApi.saveBranding(b));
      setNotice({ kind: 'info', text: t('wl.saved') });
      reload();
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function upload(slot: BrandingSlot, file: File | undefined) {
    if (!file) return;
    setBusy(true); setNotice(null);
    try { const r = await adminApi.uploadBrandingImage(slot, file); setB((o) => ({ ...o, logoUrl: r.logoUrl, loginLogoUrl: r.loginLogoUrl, faviconUrl: r.faviconUrl })); reload(); }
    catch (err) { setNotice({ kind: 'error', text: (err as Error).message }); }
    finally { setBusy(false); }
  }

  async function remove(slot: BrandingSlot) {
    setBusy(true);
    try { const r = await adminApi.deleteBrandingImage(slot); setB((o) => ({ ...o, logoUrl: r.logoUrl, loginLogoUrl: r.loginLogoUrl, faviconUrl: r.faviconUrl })); reload(); }
    catch (err) { setNotice({ kind: 'error', text: (err as Error).message }); }
    finally { setBusy(false); }
  }

  const color = /^#[0-9a-f]{6}$/i.test(b.primaryColor) ? b.primaryColor : '#53B1B1';

  return (
    <div className="wl-layout">
      <form className="settings" onSubmit={save}>
        <label className="check toggle-row">
          <input type="checkbox" checked={b.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          <span><span className="strong">{t('wl.enable')}</span><br /><span className="muted small">{t('wl.enableHint')}</span></span>
        </label>

        <section className="panel form">
          <h2 className="section-title">{t('wl.identity')}</h2>
          <div className="form-row form-row-even">
            <label><span>{t('wl.appName')}</span><input value={b.appName} maxLength={60} onChange={(e) => set('appName', e.target.value)} /></label>
            <label><span>{t('wl.browserTitle')}</span><input value={b.browserTitle} maxLength={80} placeholder={b.appName}
              onChange={(e) => set('browserTitle', e.target.value)} /><small className="muted">{t('wl.browserTitleHint')}</small></label>
          </div>
          <label><span>{t('wl.loginTagline')}</span><input value={b.loginTagline} maxLength={200} placeholder={pick({ ko: '연구·개발·교육을 위한 가상 데스크톱과 자원 할당', en: 'Virtual desktops and shared resources for R&D and labs' })}
            onChange={(e) => set('loginTagline', e.target.value)} /></label>
          <label><span>{t('wl.footer')}</span><input value={b.footerText} maxLength={200} onChange={(e) => set('footerText', e.target.value)} />
            <small className="muted">{t('wl.footerHint')}</small></label>
        </section>

        <section className="panel form">
          <h2 className="section-title">{t('wl.images')}</h2>
          <div className="wl-slots">
            {SLOTS.map((s) => <ImageSlot key={s.slot} label={t(s.label)} url={b[s.field]} busy={busy}
              favicon={s.slot === 'favicon'} onPick={(f) => upload(s.slot, f)} onRemove={() => remove(s.slot)} />)}
          </div>
          <small className="muted">{t('wl.imgHint')}</small>
        </section>

        <section className="panel form">
          <h2 className="section-title">{t('wl.color')}</h2>
          <div className="wl-color">
            <input type="color" value={color} aria-label={t('wl.color')} onChange={(e) => set('primaryColor', e.target.value)} />
            <input value={b.primaryColor} placeholder="#53B1B1" maxLength={7} onChange={(e) => set('primaryColor', e.target.value)} />
            <button type="button" className="btn-ghost" onClick={() => set('primaryColor', '')}>{t('wl.none')}</button>
          </div>
          <small className="muted">{t('wl.colorHint')}</small>
        </section>

        <section className="panel form">
          <h2 className="section-title">{t('wl.links')}</h2>
          <div className="form-row form-row-even">
            <label><span>{t('wl.support')}</span><input value={b.supportUrl} placeholder="https:// 또는 mailto:" onChange={(e) => set('supportUrl', e.target.value)} /></label>
            <label><span>{t('wl.docs')}</span><input value={b.docsUrl} placeholder="https://" onChange={(e) => set('docsUrl', e.target.value)} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={b.hideVersion} onChange={(e) => set('hideVersion', e.target.checked)} /><span>{t('wl.hideVersion')}</span></label>
        </section>

        <div className="callout"><Icon name="info" size={18} /><p>{t('wl.noticeKept')}</p></div>
        {notice && <div className={`alert ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
        <div className="form-actions"><button type="submit" className="btn primary" disabled={busy}>{t('common.save')}</button></div>
      </form>

      <aside className="wl-preview" aria-label={t('wl.preview')}>
        <div className="section-title">{t('wl.preview')}</div>
        <div className="wl-pv-login">
          <div className="wl-pv-card">
            {b.loginLogoUrl || b.logoUrl ? <img src={b.loginLogoUrl || b.logoUrl} alt="" className="wl-pv-logo" /> : <BrandMark size={34} />}
            <div className="strong">{b.enabled ? b.appName : 'MAKUS vLAB'}</div>
            <div className="muted small">{b.loginTagline || pick({ ko: '연구·개발·교육을 위한 가상 데스크톱과 자원 할당', en: 'Virtual desktops and shared resources for R&D and labs' })}</div>
            <span className="wl-pv-btn" style={{ background: color }}>{t('login.submit' as MessageKey)}</span>
          </div>
        </div>
        <div className="wl-pv-bar">
          {b.logoUrl ? <img src={b.logoUrl} alt="" className="wl-pv-barlogo" /> : <><BrandMark size={20} /><span className="strong">{b.enabled ? b.appName : 'MAKUS vLAB'}</span></>}
        </div>
        <p className="muted small">{b.footerText || '© (주)매커스시스템즈 · MAKUS vLAB'}</p>
      </aside>
    </div>
  );
}

function ImageSlot({ label, url, busy, favicon, onPick, onRemove }: {
  label: string; url: string; busy: boolean; favicon: boolean; onPick: (f: File | undefined) => void; onRemove: () => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="wl-slot">
      <span className="field-label">{label}</span>
      <div className={`wl-thumb${favicon ? ' fav' : ''}`}>{url ? <img src={url} alt={label} /> : <span className="muted small">{t('wl.none')}</span>}</div>
      <input ref={input} type="file" hidden accept={favicon ? 'image/png,image/jpeg,image/webp,image/x-icon,.ico' : 'image/png,image/jpeg,image/webp'}
        onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="wl-slot-actions">
        <button type="button" className="btn small-btn" disabled={busy} onClick={() => input.current?.click()}>{t('wl.upload')}</button>
        {url && <button type="button" className="btn-ghost small-btn danger" disabled={busy} onClick={onRemove}>{t('wl.remove')}</button>}
      </div>
    </div>
  );
}
