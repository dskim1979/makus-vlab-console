import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, isMock } from '../api/client';
import { BRAND } from '../brand';
import { useBranding } from '../branding';
import { BrandMark, BrandName } from '../components/Brand';
import { CompanyNotice } from '../components/CompanyNotice';
import { LangSwitch } from '../components/LangSwitch';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { useAuth } from './AuthContext';
import { SetupPage } from './SetupPage';

const ERRORS: Record<string, MessageKey> = {
  invalid: 'login.errInvalid',
  locked: 'login.errLocked',
  network: 'login.errNetwork',
};

export function LoginPage() {
  const { t, pick } = useI18n();
  const { b: brand } = useBranding();
  const { status, signedIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // "/" is only the default landing page, so admins still go to the admin console.
  const from = (location.state as { from?: string } | null)?.from;
  const next = from && from !== '/' ? from : undefined;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [totp, setTotp] = useState('');
  const [step, setStep] = useState<'password' | 'totp'>('password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unauth = status && !status.authenticated ? status : null;
  const firstStart = unauth?.initialized === false;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api.login(username.trim(), password, { remember, totp: step === 'totp' ? totp : undefined });
    setBusy(false);
    if (r.kind === 'ok') {
      signedIn(r.user);
      navigate(next ?? (r.user.role === 'admin' ? '/admin' : '/'), { replace: true });
    } else if (r.kind === 'second_factor') {
      if (!r.methods.includes('totp')) { setError(t('login.errWebauthn')); return; }
      setStep('totp');
    } else {
      setError(ERRORS[r.reason] ? t(ERRORS[r.reason]) : (r.message ?? t('login.errInvalid')));
    }
  }

  if (firstStart) return <SetupPage />;
  const b = brand;

  return (
    <div className="login-page">
      <div className="login-top"><LangSwitch /></div>

      <main className="login-card">
        <div className="login-brand">
          <BrandMark size={44} />
          <div>
            <h1><BrandName withTag /></h1>
            <p className="muted">{b.loginTagline || pick(BRAND.tagline)}</p>
          </div>
        </div>

        {isMock && <div className="alert info">{t('login.mock')}</div>}

        <form onSubmit={submit} className="form">
          <h2>{t('login.title')}</h2>
          {step === 'password' ? (
            <>
              <label>
                <span>{t('login.username')}</span>
                <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </label>
              <label>
                <span>{t('login.password')}</span>
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <label className="check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>{t('login.remember')}</span>
              </label>
            </>
          ) : (
            <label>
              <span>{t('login.totp')}</span>
              <input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
                value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} required />
              <small className="muted">{t('login.totpHint')}</small>
            </label>
          )}

          {error && <div className="alert error" role="alert">{error}</div>}

          <button type="submit" className="btn primary block" disabled={busy}>
            {step === 'password' ? t('login.submit') : t('login.verify')}
          </button>
          {step === 'totp' && (
            <button type="button" className="btn-ghost block" onClick={() => { setStep('password'); setTotp(''); setError(null); }}>
              {t('login.back')}
            </button>
          )}

          {unauth?.oidc_enabled && step === 'password' && (
            <a className="btn block" href={`/api/auth/oidc/authorize?redirect_after=${encodeURIComponent(next ?? '/')}`}>
              {unauth.oidc_button_text || t('login.sso')}
            </a>
          )}
          {unauth?.ldap_enabled && <p className="muted small">{t('login.ldapOn')}</p>}
        </form>
      </main>

      <footer className="login-foot">
        <CompanyNotice />
      </footer>
    </div>
  );
}
