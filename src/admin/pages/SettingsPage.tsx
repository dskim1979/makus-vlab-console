import { useEffect, useState, type FormEvent } from 'react';
import { adminApi } from '../../api/admin';
import type { PlatformSettings } from '../../api/types';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// 운영 > 플랫폼 설정: sign-in and sessions, password policy, audit retention, air-gap, mail.
// The engine stores them; ports, TLS and the proxy belong to the install (nginx).
export function SettingsPage() {
  const s = useLoad(adminApi.settings);
  return (
    <LoadState value={s} retry={s.reload}>
      {(v) => <SettingsForm initial={v} onSaved={s.reload} />}
    </LoadState>
  );
}

type Num = { [K in keyof PlatformSettings]: PlatformSettings[K] extends number ? K : never }[keyof PlatformSettings];
type Bool = { [K in keyof PlatformSettings]: PlatformSettings[K] extends boolean ? K : never }[keyof PlatformSettings];

function SettingsForm({ initial, onSaved }: { initial: PlatformSettings; onSaved: () => void }) {
  const { t } = useI18n();
  const fresh = () => ({ ...initial, smtp_password: '' });
  const [v, setV] = useState<PlatformSettings>(fresh);
  const [recipients, setRecipients] = useState(initial.alert_email_recipients.join(', '));
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [mailNote, setMailNote] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const pwStored = initial.smtp_password === '********';

  useEffect(() => { setV(fresh()); setRecipients(initial.alert_email_recipients.join(', ')); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof PlatformSettings>(k: K, x: PlatformSettings[K]) => setV((o) => ({ ...o, [k]: x }));

  // numbers kept in seconds by the engine, shown in minutes here
  const minutes = (k: Num, min = 1) => (
    <span className="with-unit">
      <input type="number" min={min} value={Math.round(v[k] / 60)} onChange={(e) => set(k, Math.max(0, Number(e.target.value)) * 60)} />
      <span className="muted small">{t('set.minutes')}</span>
    </span>
  );
  const num = (k: Num, unit: string, min = 1, max?: number, disabled = false) => (
    <span className="with-unit">
      <input type="number" min={min} max={max} disabled={disabled} value={v[k]} onChange={(e) => set(k, Number(e.target.value))} />
      <span className="muted small">{unit}</span>
    </span>
  );
  const check = (k: Bool, label: string, disabled = false) => (
    <label className="check">
      <input type="checkbox" disabled={disabled} checked={v[k]} onChange={(e) => set(k, e.target.checked)} />
      <span>{label}</span>
    </label>
  );

  const body = (): Partial<PlatformSettings> => ({
    ...v,
    smtp_password: v.smtp_password || (pwStored ? '********' : ''),
    alert_email_recipients: recipients.split(',').map((x) => x.trim()).filter(Boolean),
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setNotice(null);
    try {
      await adminApi.saveSettings(body());
      setNotice({ kind: 'info', text: t('set.saved') });
      onSaved();
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function testMail() {
    setBusy(true); setMailNote(null);
    const b = body();
    try {
      await adminApi.testSmtp({
        email: testTo.trim(), smtp_host: b.smtp_host, smtp_port: b.smtp_port, smtp_user: b.smtp_user,
        smtp_password: b.smtp_password, smtp_from_email: b.smtp_from_email, smtp_from_name: b.smtp_from_name,
        smtp_tls: b.smtp_tls, smtp_ssl: b.smtp_ssl,
      });
      setMailNote({ kind: 'info', text: t('set.testOk') });
    } catch (err) {
      setMailNote({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const mailSec = v.smtp_ssl ? 'ssl' : v.smtp_tls ? 'tls' : 'none';
  function security(x: string) {
    setV((o) => ({ ...o, smtp_ssl: x === 'ssl', smtp_tls: x === 'tls',
      smtp_port: x === 'ssl' && o.smtp_port === 587 ? 465 : x !== 'ssl' && o.smtp_port === 465 ? 587 : o.smtp_port }));
  }

  return (
    <form className="settings" onSubmit={save}>
      <section className="panel form">
        <h2 className="section-title">{t('set.signin')}</h2>
        <div className="form-row form-row-even">
          <label><span>{t('set.sessionTimeout')}</span>{minutes('session_timeout', 5)}</label>
          <span />
        </div>
        <div className="form-row form-row-three">
          <label><span>{t('set.maxAttempts')}</span>{num('login_max_attempts', t('set.times'), 1, 50)}</label>
          <label><span>{t('set.window')}</span>{minutes('login_attempt_window')}</label>
          <label><span>{t('set.lockout')}</span>{minutes('login_lockout_time')}</label>
        </div>
        {check('strict_session_ip', t('set.strictIp'))}
        <small className="muted hint-indent">{t('set.strictIpHint')}</small>
        {check('force_2fa', t('set.force2fa'))}
        <div className="hint-indent">{check('force_2fa_exclude_admins', t('set.force2faAdmins'), !v.force_2fa)}</div>
      </section>

      <section className="panel form">
        <h2 className="section-title">{t('set.passwords')}</h2>
        <p className="muted small">{t('set.passwordsHint')}</p>
        <div className="form-row form-row-even">
          <label><span>{t('set.minLength')}</span>{num('password_min_length', '', 4, 64)}</label>
          <span />
        </div>
        <span className="field-label">{t('set.require')}</span>
        <div className="check-row">
          {check('password_require_uppercase', t('set.upper'))}
          {check('password_require_lowercase', t('set.lower'))}
          {check('password_require_numbers', t('set.numbers'))}
          {check('password_require_special', t('set.special'))}
        </div>
        {check('password_expiry_enabled', t('set.expiry'))}
        <div className="form-row form-row-even">
          <label><span>{t('set.expiryDays')}</span>{num('password_expiry_days', t('set.days'), 7, 365, !v.password_expiry_enabled)}</label>
          <label><span>{t('set.warnDays')}</span>{num('password_expiry_warning_days', t('set.days'), 1, 30, !v.password_expiry_enabled)}</label>
        </div>
      </section>

      <section className="panel form">
        <h2 className="section-title">{t('set.audit')}</h2>
        <div className="form-row form-row-even">
          <label><span>{t('set.retention')}</span>{num('audit_retention_days', t('set.days'), 30, 3650)}
            <small className="muted">{t('set.retentionHint')}</small></label>
          <span />
        </div>
        {check('air_gap_mode', t('set.airGap'))}
        <small className="muted hint-indent">{t('set.airGapHint')}</small>
      </section>

      <section className="panel form">
        <h2 className="section-title">{t('set.mail')}</h2>
        {check('smtp_enabled', t('set.mailEnable'))}
        <div className="form-row form-row-wide">
          <label><span>{t('set.smtpHost')}</span>
            <input value={v.smtp_host} placeholder="mail.lab.example" onChange={(e) => set('smtp_host', e.target.value)} /></label>
          <label><span>{t('set.port')}</span>
            <input type="number" min={1} max={65535} value={v.smtp_port} onChange={(e) => set('smtp_port', Number(e.target.value) || 587)} /></label>
        </div>
        <div className="form-row form-row-even">
          <label><span>{t('set.security')}</span>
            <select value={mailSec} onChange={(e) => security(e.target.value)}>
              <option value="tls">STARTTLS</option>
              <option value="ssl">SSL/TLS</option>
              <option value="none">{t('set.secNone')}</option>
            </select></label>
          <span />
        </div>
        <div className="form-row form-row-even">
          <label><span>{t('set.smtpUser')}</span>
            <input value={v.smtp_user} autoComplete="off" onChange={(e) => set('smtp_user', e.target.value)} /></label>
          <label><span>{t('set.smtpPw')}</span>
            <input type="password" autoComplete="new-password" value={v.smtp_password} placeholder={pwStored ? '••••••••' : ''}
              onChange={(e) => set('smtp_password', e.target.value)} />
            <small className="muted">{t('set.pwHint')}</small></label>
        </div>
        <div className="form-row form-row-even">
          <label><span>{t('set.fromEmail')}</span>
            <input type="email" value={v.smtp_from_email} placeholder="vlab@lab.example" onChange={(e) => set('smtp_from_email', e.target.value)} /></label>
          <label><span>{t('set.fromName')}</span>
            <input value={v.smtp_from_name} placeholder="MAKUS vLAB" onChange={(e) => set('smtp_from_name', e.target.value)} /></label>
        </div>
        <label><span>{t('set.recipients')}</span>
          <input value={recipients} placeholder="ops@lab.example, it@lab.example" onChange={(e) => setRecipients(e.target.value)} />
          <small className="muted">{t('set.recipientsHint')}</small></label>
        <div className="form-row form-row-wide">
          <label><span>{t('set.testTo')}</span>
            <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} /></label>
          <div className="check-bottom">
            <button type="button" className="btn" disabled={busy || !testTo.trim() || !v.smtp_host.trim()} onClick={testMail}>{t('set.test')}</button>
          </div>
        </div>
        {mailNote && <div className={`alert small ${mailNote.kind === 'error' ? 'error' : 'info'}`} role="status">{mailNote.text}</div>}
      </section>

      {notice && <div className={`alert ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={busy}>{t('common.save')}</button>
      </div>
    </form>
  );
}
