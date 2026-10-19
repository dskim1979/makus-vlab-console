import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { accountsApi, type ResetCheck } from '../api/accounts';
import { isMock } from '../api/client';
import { BrandLockup } from '../components/Brand';
import { CompanyNotice } from '../components/CompanyNotice';
import { useI18n } from '../i18n';

// /forgot-password: a username or a mail address -> a one-time link by mail (30 minutes). The
// engine answers the same whether an account matched or not, so this page never says either.
// /reset-password?token=…: the link's page, a new password under the platform's policy.

function useL() {
  const { pick } = useI18n();
  return (ko: string, en: string) => pick({ ko, en });
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  const L = useL();
  return (
    <div className="login-page">
      <main className="login-card signup-card">
        <BrandLockup markSize={34} />
        <h1>{title}</h1>
        {children}
        <p className="muted small"><Link to="/login">{L('로그인으로 돌아가기', 'Back to sign-in')}</Link></p>
      </main>
      <footer className="login-foot"><CompanyNotice /></footer>
    </div>
  );
}

export function ForgotPasswordPage() {
  const L = useL();
  const [login, setLogin] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await accountsApi.requestReset(login.trim()); setSent(true); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <Frame title={L('비밀번호 찾기', 'Forgot password')}>
      {sent ? (
        <div className="alert info" role="status">
          {L('계정이 있으면 재설정 링크를 메일로 보냈습니다. 링크는 30분 동안 한 번 쓸 수 있습니다.',
            'If the account exists, a reset link is on its way. It works once, for 30 minutes.')}
          {isMock && <div className="small"><Link to="/reset-password?token=mock-reset">{L('모의 모드: 링크 열기', 'Mock mode: open the link')}</Link></div>}
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <p className="muted small">{L('아이디나 계정에 등록한 메일 주소를 넣으세요. 메일로 새 비밀번호를 정하는 링크를 보냅니다.',
            'Enter your username or the mail address of your account. We mail you a link to set a new password.')}</p>
          <label><span>{L('아이디 또는 메일', 'Username or mail')}</span>
            <input id="fp-login" autoFocus autoComplete="username" value={login} maxLength={120} onChange={(e) => setLogin(e.target.value)} required /></label>
          <div className="alert info small">{L('학교 · 기관 계정(AD/LDAP, SSO)으로 로그인한다면 비밀번호는 기관 포털에서 바꿉니다.',
            'If you sign in with your institution account (AD/LDAP, SSO), change the password on its portal.')}</div>
          {error && <div className="alert error" role="alert">{error}</div>}
          <button type="submit" className="btn primary block" disabled={busy || !login.trim()}>{L('재설정 링크 받기', 'Send me a link')}</button>
        </form>
      )}
    </Frame>
  );
}

export function policyText(p: ResetCheck['policy'], L: (ko: string, en: string) => string) {
  const parts = [L(`${p.min_length}자 이상`, `${p.min_length}+ characters`)];
  if (p.uppercase) parts.push(L('대문자', 'upper case'));
  if (p.lowercase) parts.push(L('소문자', 'lower case'));
  if (p.numbers) parts.push(L('숫자', 'a digit'));
  if (p.special) parts.push(L('특수 문자', 'a symbol'));
  return parts.join(' · ');
}

export function ResetPasswordPage() {
  const L = useL();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [check, setCheck] = useState<ResetCheck | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    accountsApi.checkReset(token).then(setCheck).catch((e) => setError((e as Error).message));
    // the token is in the address only to get here: keep it out of the history
    if (token) window.history.replaceState(null, '', '/reset-password');
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw !== pw2) { setError(L('비밀번호가 서로 다릅니다.', 'The passwords differ.')); return; }
    setBusy(true); setError(null);
    try { const r = await accountsApi.confirmReset(token, pw); setDone(r.username); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <Frame title={L('새 비밀번호', 'New password')}>
      {done ? (
        <>
          <div className="alert info" role="status">{L(`${done} 계정의 비밀번호를 바꿨습니다. 다른 곳에 열려 있던 로그인은 모두 끝났습니다.`,
            `The password of ${done} is changed. Every other sign-in has ended.`)}</div>
          <button type="button" className="btn primary block" onClick={() => navigate('/login', { replace: true })}>{L('로그인', 'Sign in')}</button>
        </>
      ) : !check ? (
        error ? <div className="alert error" role="alert">{error}</div> : <p className="muted">{L('링크를 확인하는 중…', 'Checking the link…')}</p>
      ) : !check.valid ? (
        <>
          <div className="alert error" role="alert">{L('링크가 만료되었거나 이미 쓰였습니다. 새 링크를 받으세요.', 'The link has expired or was used already. Ask for a new one.')}</div>
          <Link className="btn block" to="/forgot-password">{L('비밀번호 찾기', 'Forgot password')}</Link>
        </>
      ) : (
        <form className="form" onSubmit={submit}>
          <p className="muted small">{L(`계정: ${check.username}`, `Account: ${check.username}`)}</p>
          <label><span>{L('새 비밀번호', 'New password')}</span>
            <input id="rp-pass" type="password" autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            <small className="muted">{policyText(check.policy, L)}</small></label>
          <label><span>{L('비밀번호 확인', 'Again')}</span>
            <input id="rp-pass2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></label>
          {error && <div className="alert error" role="alert">{error}</div>}
          <button type="submit" className="btn primary block" disabled={busy || !pw}>{L('비밀번호 바꾸기', 'Change password')}</button>
        </form>
      )}
    </Frame>
  );
}
