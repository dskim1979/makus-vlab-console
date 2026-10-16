import { useEffect, useRef, useState, type FormEvent } from 'react';
import { adminApi } from '../../api/admin';
import type { Branding, BrandingSlot } from '../../api/types';
import { BRAND } from '../../brand';
import { useBranding } from '../../branding';
import { BrandMark } from '../../components/Brand';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { SettingsSection, SettingsShell, SettingsStatus } from '../../components/SettingsShell';
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

  const sections = [
    { id: 'identity', title: t('wl.identity') }, { id: 'images', title: t('wl.images') },
    { id: 'color', title: t('wl.color') }, { id: 'links', title: t('wl.links') },
  ];
  const logos = [b.logoUrl, b.loginLogoUrl, b.faviconUrl].filter(Boolean).length;
  const name = b.enabled ? b.appName : BRAND.productName;
  const tagline = b.loginTagline || pick({ ko: '연구·개발·교육을 위한 가상 데스크톱과 자원 할당', en: 'Virtual desktops and shared resources for R&D and labs' });

  const preview = (
    <div className="wl-preview" aria-label={t('wl.preview')}>
      <div className="wl-pv-title">{t('wl.preview')}</div>
      <div className="wl-pv-tab">
        {b.faviconUrl ? <img src={b.faviconUrl} alt="" /> : <BrandMark size={14} />}
        <span>{(b.enabled && (b.browserTitle || b.appName)) || BRAND.productName}</span>
      </div>
      <div className="wl-pv-bar">
        {b.logoUrl ? <img src={b.logoUrl} alt="" className="wl-pv-barlogo" /> : <><BrandMark size={20} /><span className="strong">{name}</span></>}
      </div>
      <div className="wl-pv-login">
        <div className="wl-pv-card">
          {b.loginLogoUrl || b.logoUrl ? <img src={b.loginLogoUrl || b.logoUrl} alt="" className="wl-pv-logo" /> : <BrandMark size={34} />}
          <div className="strong">{name}</div>
          <div className="muted small">{tagline}</div>
          <span className="wl-pv-field" /><span className="wl-pv-field" />
          <span className="wl-pv-btn" style={{ background: color }}>{t('login.submit' as MessageKey)}</span>
        </div>
      </div>
      <p className="muted small wl-pv-foot">{b.footerText || `© (주)매커스시스템즈 · ${BRAND.productName}`}</p>
    </div>
  );

  return (
    <form className="settings sform" onSubmit={save}>
      <SettingsShell sections={sections} aside={preview}
        status={(
          <SettingsStatus items={[
            { label: t('wl.enable'), tone: b.enabled ? 'ok' : 'off', value: (
              <label className="sstatus-toggle"><input type="checkbox" checked={b.enabled} onChange={(e) => set('enabled', e.target.checked)} />
                {b.enabled ? t('dir.on') : t('dir.off')}</label>) },
            { label: t('wl.appName'), value: name },
            { label: t('wl.images'), value: t('wl.nImages').replace('{n}', String(logos)) },
            { label: t('wl.color'), value: <span className="wl-swatch"><i style={{ background: color }} />{b.primaryColor || t('wl.none')}</span> },
            { label: t('wl.support'), value: b.supportUrl ? t('wl.custom') : t('wl.defaultSupport') },
          ]} />
        )}
        footer={(
          <div className="form-actions">
            <span className="muted small form-actions-note">{t('wl.noticeKept')}</span>
            {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
            <button type="submit" className="btn primary" disabled={busy}>{t('common.save')}</button>
          </div>
        )}>
        <SettingsSection id="identity" title={t('wl.identity')} desc={t('wl.enableHint')}>
          <div className="form-row form-row-even">
            <label><span>{t('wl.appName')}</span><input value={b.appName} maxLength={60} onChange={(e) => set('appName', e.target.value)} /></label>
            <label><span>{t('wl.browserTitle')}</span><input value={b.browserTitle} maxLength={80} placeholder={b.appName}
              onChange={(e) => set('browserTitle', e.target.value)} /><small className="muted">{t('wl.browserTitleHint')}</small></label>
          </div>
          <label><span>{t('wl.loginTagline')}</span><input value={b.loginTagline} maxLength={200} placeholder={tagline}
            onChange={(e) => set('loginTagline', e.target.value)} /></label>
          <label><span>{t('wl.footer')}</span><input value={b.footerText} maxLength={200} onChange={(e) => set('footerText', e.target.value)} />
            <small className="muted">{t('wl.footerHint')}</small></label>
        </SettingsSection>

        <SettingsSection id="images" title={t('wl.images')} desc={t('wl.imgHint')}>
          <div className="wl-slots">
            {SLOTS.map((x) => <ImageSlot key={x.slot} label={t(x.label)} url={b[x.field]} busy={busy}
              favicon={x.slot === 'favicon'} onPick={(f) => upload(x.slot, f)} onRemove={() => remove(x.slot)} />)}
          </div>
        </SettingsSection>

        <SettingsSection id="color" title={t('wl.color')} desc={t('wl.colorHint')}>
          <div className="wl-color">
            <input type="color" value={color} aria-label={t('wl.color')} onChange={(e) => set('primaryColor', e.target.value)} />
            <input value={b.primaryColor} placeholder="#53B1B1" maxLength={7} onChange={(e) => set('primaryColor', e.target.value)} />
            <button type="button" className="btn-ghost" onClick={() => set('primaryColor', '')}>{t('wl.none')}</button>
          </div>
        </SettingsSection>

        <SettingsSection id="links" title={t('wl.links')} desc={t('wl.linksDesc')}>
          <div className="form-row form-row-even">
            <label><span>{t('wl.support')}</span><input value={b.supportUrl} placeholder={BRAND.supportUrl} onChange={(e) => set('supportUrl', e.target.value)} /></label>
            <label><span>{t('wl.docs')}</span><input value={b.docsUrl} placeholder="https://" onChange={(e) => set('docsUrl', e.target.value)} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={b.hideVersion} onChange={(e) => set('hideVersion', e.target.checked)} /><span>{t('wl.hideVersion')}</span></label>
        </SettingsSection>
      </SettingsShell>
    </form>
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
