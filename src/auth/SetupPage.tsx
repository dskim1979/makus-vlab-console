import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { BrandMark, BrandName } from '../components/Brand';
import { useBranding } from '../branding';
import { CompanyNotice } from '../components/CompanyNotice';
import { LangSwitch } from '../components/LangSwitch';
import { useI18n } from '../i18n';
import { useAuth } from './AuthContext';

// First start: the engine has no account yet (/api/auth/check says initialized: false).
// Creates the first administrator through the engine's setup route, then signs in with it.
export function SetupPage() {
  const { t } = useI18n();
  const { b } = useBranding();
  const { signedIn } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('vlabadmin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== password2) { setError(t('setup.mismatch')); return; }
    setBusy(true); setError(null);
    try {
      await api.setup({ username: username.trim(), password, display_name: displayName.trim(), email: email.trim() });
      setDone(true);
      const r = await api.login(username.trim(), password);
      if (r.kind === 'ok') {
        signedIn(r.user);
        navigate('/admin', { replace: true });   // the site profile first (AdminHome), then the cluster
      } else {
        window.location.assign('/login');
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-top"><LangSwitch /></div>
      <main className="login-card">
        <div className="login-brand">
          {b.loginLogoUrl || b.logoUrl ? <img className="brand-logo-login" src={b.loginLogoUrl || b.logoUrl} alt={b.appName} /> : <BrandMark size={44} />}
          <div><h1><BrandName /></h1><p className="muted">{t('setup.title')}</p></div>
        </div>
        <p className="small">{t('setup.intro')}</p>
        <div className="alert small">{t('setup.warn')}</div>
        <form className="form" onSubmit={submit}>
          <label><span>{t('setup.username')}</span>
            <input autoFocus required minLength={2} maxLength={64} autoComplete="username" value={username}
              onChange={(e) => setUsername(e.target.value)} /></label>
          <label><span>{t('setup.displayName')}</span>
            <input maxLength={128} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
          <label><span>{t('setup.email')}</span>
            <input type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label><span>{t('setup.password')}</span>
            <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label><span>{t('setup.password2')}</span>
            <input type="password" required autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} /></label>
          {error && <div className="alert error" role="alert">{error}</div>}
          {done && !error && <div className="alert info" role="status">{t('setup.done')}</div>}
          <button type="submit" className="btn primary block" disabled={busy}>{t('setup.submit')}</button>
        </form>
      </main>
      <footer className="login-foot"><CompanyNotice /></footer>
    </div>
  );
}
