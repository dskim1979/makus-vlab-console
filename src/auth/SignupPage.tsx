import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { accountsApi, type Terms } from '../api/accounts';
import { isMock } from '../api/client';
import { nextApi, type SignupConfig } from '../api/next';
import { BrandLockup } from '../components/Brand';
import { CompanyNotice } from '../components/CompanyNotice';
import { TermsBoxes } from '../components/Terms';
import { useI18n } from '../i18n';

// /signup: ask for an account (open only when 사용자 > 가입 심사 takes requests). An admin
// approves it; approving gives a portal account in the department picked, no desktop yet.
// With the mail check on, a 6-digit code (or the mailed link) confirms the address first;
// an address of an institution domain (가입 설정) gets its account as soon as it is confirmed.

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

type Sent = { id: string; email: string; verify: 'sent' | 'failed' | 'none'; auto: boolean };

export function SignupPage() {
  const L = useL();
  const [cfg, setCfg] = useState<SignupConfig | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [f, setF] = useState({ username: '', password: '', password2: '', display_name: '', email: '', department_id: '', note: '' });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  useEffect(() => { nextApi.signupConfig().then(setCfg); }, []);
  useEffect(() => { if (cfg?.terms?.enabled) accountsApi.publicTerms().then(setTerms); }, [cfg?.terms?.enabled]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const mailNeeded = cfg?.verify_email === 'required';
  const termsOn = !!cfg?.terms?.enabled;
  const domains = cfg?.auto_domains ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.password !== f.password2) { setError(L('비밀번호가 서로 다릅니다.', 'The passwords differ.')); return; }
    if (termsOn && !agree) { setError(L('약관과 개인정보 처리 방침에 동의해 주세요.', 'Agree to the terms and the privacy policy.')); return; }
    setBusy(true); setError(null);
    try {
      const email = f.email.trim();
      const r = await nextApi.signup({ username: f.username.trim().toLowerCase(), password: f.password, display_name: f.display_name.trim(),
        email, department_id: f.department_id || null, note: f.note.trim(), ...(termsOn ? { terms_version: terms?.version ?? cfg?.terms?.version } : {}) });
      setSent({ id: r.request.id, email, verify: r.request.verify ?? 'none', auto: !!r.request.auto });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (sent && sent.verify !== 'none') return <VerifyStep sent={sent} />;
  return (
    <Frame title={L('가입 신청', 'Ask for an account')}>
      {cfg && !cfg.enabled ? (
        <div className="alert info">{L('지금은 가입 신청을 받지 않습니다. 관리자에게 계정을 요청하세요.', 'Sign-up is closed. Ask your administrator for an account.')}</div>
      ) : sent ? (
        <div className="alert info" role="status">{L('신청했습니다. 관리자가 승인하면 이 아이디로 로그인할 수 있습니다.', 'Sent. You can sign in with this username once an admin approves it.')}</div>
      ) : (
        <form onSubmit={submit} className="form">
          <p className="muted small">{L('관리자가 확인한 뒤 계정을 만들어 드립니다. 데스크톱은 승인 뒤 따로 배정됩니다.', 'An admin reviews it and makes the account. Desktops are assigned afterwards.')}</p>
          {domains.length > 0 && <div className="alert info small">{L(`${domains.map((d) => '@' + d).join(', ')} 메일로 신청하고 메일을 인증하면 승인을 기다리지 않고 바로 쓸 수 있습니다.`,
            `Ask with a ${domains.map((d) => '@' + d).join(', ')} address and confirm it: the account is ready at once.`)}</div>}
          <label><span>{L('아이디', 'Username')}</span><input id="su-user" autoComplete="username" value={f.username} onChange={set('username')} placeholder="kim.minji" /></label>
          <div className="form-row form-row-wide">
            <label><span>{L('비밀번호', 'Password')}</span><input id="su-pass" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></label>
            <label><span>{L('비밀번호 확인', 'Again')}</span><input id="su-pass2" type="password" autoComplete="new-password" value={f.password2} onChange={set('password2')} /></label>
          </div>
          <label><span>{L('이름', 'Name')}</span><input id="su-name" value={f.display_name} onChange={set('display_name')} /></label>
          <label><span>{mailNeeded ? L('메일 (인증 필요)', 'Mail (to confirm)') : cfg?.verify_email === 'optional' ? L('메일 (선택, 넣으면 인증)', 'Mail (optional, confirmed)') : L('메일 (선택)', 'Mail (optional)')}</span>
            <input id="su-mail" type="email" required={mailNeeded} value={f.email} onChange={set('email')} placeholder={domains[0] ? `name@${domains[0]}` : ''} /></label>
          {cfg && cfg.departments.length > 0 && (
            <label><span>{L('소속 부서', 'Department')}</span>
              <select id="su-dep" value={f.department_id} onChange={set('department_id')}>
                <option value="">{L('고르지 않음', 'None')}</option>
                {cfg.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select></label>
          )}
          <label><span>{L('신청 이유 (선택)', 'Why (optional)')}</span><input id="su-note" maxLength={300} value={f.note} onChange={set('note')} placeholder={L('예: 데이터베이스 실습 수강', 'e.g. taking the DB lab')} /></label>
          {termsOn && (
            <>
              <details className="terms-details">
                <summary>{L(`이용 약관 · 개인정보 처리 방침 보기 (버전 ${cfg?.terms?.version})`, `Read the terms and the privacy policy (version ${cfg?.terms?.version})`)}</summary>
                {terms ? <TermsBoxes terms={terms.terms} privacy={terms.privacy} /> : <p className="muted small">…</p>}
              </details>
              <label className="check"><input id="su-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>{L('이용 약관과 개인정보 처리 방침에 동의합니다. (필수)', 'I agree to the terms of use and the privacy policy. (required)')}</span></label>
            </>
          )}
          {error && <div className="alert error" role="alert">{error}</div>}
          <button type="submit" className="btn primary block" disabled={busy || !f.username || !f.password || (termsOn && !agree)}>{L('신청하기', 'Send')}</button>
        </form>
      )}
    </Frame>
  );
}

function VerifyStep({ sent }: { sent: Sent }) {
  const L = useL();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(sent.verify === 'failed'
    ? L('인증 메일을 보내지 못했습니다. 잠시 뒤 [코드 다시 받기]를 누르거나 관리자에게 알려 주세요.', 'The mail could not be sent. Try [send again] shortly, or tell the administrator.') : null);
  const [result, setResult] = useState<{ approved: boolean } | null>(null);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { const r = await accountsApi.verifySignup(sent.id, { code: code.trim() }); setResult({ approved: r.approved }); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function resend() {
    setError(null); setInfo(null);
    try { const r = await accountsApi.resendSignup(sent.id); setInfo(r.sent ? L('새 코드를 보냈습니다.', 'A new code is on its way.') : L('보내지 못했습니다.', 'Not sent.')); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <Frame title={L('메일 인증', 'Confirm your mail')}>
      {result ? <VerifyDone approved={result.approved} /> : (
        <form className="form" onSubmit={verify}>
          <p className="muted small">{L(`${sent.email}(으)로 6자리 코드를 보냈습니다. 코드를 넣거나 메일의 링크를 여세요. 코드는 30분 동안 유효합니다.`,
            `A 6-digit code went to ${sent.email}. Enter it, or open the link in the mail. It is valid for 30 minutes.`)}</p>
          {sent.auto && <div className="alert info small">{L('기관 메일입니다. 인증하면 바로 계정이 만들어집니다.', 'An institution address: the account is made as soon as it is confirmed.')}</div>}
          {isMock && <p className="muted small">{L('모의 모드: 코드는 123456', 'Mock mode: the code is 123456')}</p>}
          <label><span>{L('인증 코드', 'Code')}</span>
            <input id="su-code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
          {info && <div className="alert info small" role="status">{info}</div>}
          {error && <div className="alert error" role="alert">{error}</div>}
          <button type="submit" className="btn primary block" disabled={busy || code.length !== 6}>{L('인증', 'Confirm')}</button>
          <button type="button" className="btn-ghost block" onClick={resend}>{L('코드 다시 받기', 'Send again')}</button>
        </form>
      )}
    </Frame>
  );
}

function VerifyDone({ approved }: { approved: boolean }) {
  const L = useL();
  return approved ? (
    <>
      <div className="alert info" role="status">{L('메일을 인증했고 계정이 만들어졌습니다. 신청한 아이디와 비밀번호로 로그인하세요.', 'Mail confirmed and the account is ready. Sign in with the username and password you chose.')}</div>
      <Link className="btn primary block" to="/login">{L('로그인', 'Sign in')}</Link>
    </>
  ) : (
    <div className="alert info" role="status">{L('메일을 인증했습니다. 관리자가 승인하면 이 아이디로 로그인할 수 있습니다.', 'Mail confirmed. You can sign in once an admin approves the request.')}</div>
  );
}

// /signup/verify?id=…&token=…: the link in the mail
export function SignupVerifyPage() {
  const L = useL();
  const [params] = useSearchParams();
  const [state, setState] = useState<{ approved: boolean } | string | null>(null);
  useEffect(() => {
    const id = params.get('id') ?? '', token = params.get('token') ?? '';
    accountsApi.verifySignup(id, { token }).then((r) => setState({ approved: r.approved })).catch((e) => setState((e as Error).message));
  }, [params]);
  return (
    <Frame title={L('메일 인증', 'Confirm your mail')}>
      {state === null ? <p className="muted">{L('확인하는 중…', 'Checking…')}</p>
        : typeof state === 'string' ? <div className="alert error" role="alert">{state}</div>
        : <VerifyDone approved={state.approved} />}
    </Frame>
  );
}
