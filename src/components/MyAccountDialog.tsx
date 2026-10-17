import { useEffect, useRef, useState, type FormEvent } from 'react';
import { noticesApi, type NoticeKind } from '../api/notices';
import { usersApi, type TotpSetup } from '../api/users';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput, roleLabel } from '../admin/pages/UsersPage';
import { useI18n } from '../i18n';
import { useLoad } from './useLoad';
import { accountErrorText, PasswordRules, policyProblems, usePasswordPolicy } from './PasswordRules';

// 내 계정 (the user menu, portal and admin console alike): who I am, a new password, and
// two-step sign-in (TOTP) - enrol with a QR code, replace the device, or turn it off - and the
// notice mails I take (api/notices.ts).
// The engine's /api/auth/* routes; a new password ends every session, this one too.
export function MyAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const { user, logout } = useAuth();
  const policy = usePasswordPolicy();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  if (!user) return null;
  const source = user.auth_source || 'local';
  const idp = source === 'oidc' || source === 'entra';
  // an account of the bundled directory changes its password here: the engine writes it to the DC
  const ownPassword = source === 'local' || (source === 'ldap' && !!policy?.unified);

  return (
    <dialog ref={ref} className="dialog dialog-wide" onClose={onClose}>
      {open && (
        <div className="form my-account">
          <h2>{L('내 계정', 'My account')}</h2>
          <dl className="kv">
            <dt>{t('users.username')}</dt><dd>{user.username}</dd>
            <dt>{t('users.name')}</dt><dd>{user.display_name || '-'}</dd>
            <dt>{L('메일', 'Email')}</dt><dd>{user.email || '-'}</dd>
            <dt>{t('users.role')}</dt><dd>{roleLabel(t, user.role)}</dd>
            <dt>{t('users.source')}</dt><dd>{source === 'local' ? L('로컬', 'Local') : source.toUpperCase()}</dd>
          </dl>
          {ownPassword
            ? <ChangePassword onChanged={() => { alert(L('비밀번호를 바꿨습니다. 모든 세션이 끝났으니 새 비밀번호로 다시 로그인하세요.', 'Password changed. Every session ended - sign in again with the new password.')); onClose(); logout(); }} />
            : <section className="acct-section"><h3>{L('비밀번호', 'Password')}</h3>
                <p className="muted small">{idp ? L('비밀번호는 조직의 로그인 서비스(SSO)에서 바꿉니다.', 'Change your password at your organisation’s sign-in service (SSO).')
                  : L('AD/LDAP 계정입니다. 비밀번호는 조직의 디렉터리(Windows 로그인 등)에서 바꿉니다.', 'An AD/LDAP account: change the password in your organisation’s directory (e.g. Windows sign-in).')}</p></section>}
          {idp
            ? <section className="acct-section"><h3>{L('2단계 인증', 'Two-step sign-in')}</h3><p className="muted small">{L('2단계 인증은 조직의 로그인 서비스에서 관리합니다.', 'Your organisation’s sign-in service manages two-step sign-in.')}</p></section>
            : <TwoFactor />}
          {user.role !== 'viewer' && <MyNoticeChoices />}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>{t('about.close')}</button>
          </div>
        </div>
      )}
    </dialog>
  );
}

// also the forced change after signing in (LoginPage)
export function ChangePassword({ onChanged, current: given }: { onChanged: (next: string) => void; current?: string }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const policy = usePasswordPolicy();
  const { user } = useAuth();
  const names = [user?.username ?? '', user?.display_name ?? ''];
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== again) { setError(L('두 비밀번호가 다릅니다.', 'The passwords do not match.')); return; }
    const missing = policy ? policyProblems(next, policy, L, names) : [];
    if (missing.length) { setError(L(`비밀번호 규칙: ${missing.join(', ')}`, `Password rule: ${missing.join(', ')}`)); return; }
    setBusy(true); setError(null);
    try { await usersApi.changeMyPassword(given ?? current, next); onChanged(next); } catch (err) { setError(accountErrorText(err, L)); } finally { setBusy(false); }
  }
  return (
    <form className="form acct-section" onSubmit={submit}>
      <h3>{L('비밀번호 변경', 'Change password')}</h3>
      {given === undefined && <label><span>{L('현재 비밀번호', 'Current password')}</span>
        <input id="my-pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>}
      <div className={given === undefined ? 'form-row form-row-even' : 'form'}>
        <label><span>{L('새 비밀번호', 'New password')}</span><PasswordInput id="my-pw-new" value={next} onChange={setNext} /></label>
        <label><span>{L('새 비밀번호 확인', 'Repeat new password')}</span><input id="my-pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></label>
      </div>
      <PasswordRules policy={policy} pw={next} names={names} />
      <small className="muted">{L('바꾸면 이 기기를 포함한 모든 세션과 API 토큰이 끝납니다.', 'Changing it ends every session and API token, this one too.')}</small>
      {error && <div className="alert error small" role="alert">{error}</div>}
      <div><button type="submit" className="btn primary" disabled={busy || !next || (given === undefined && !current)}>{L('비밀번호 바꾸기', 'Change password')}</button></div>
    </form>
  );
}

// 알림: which mails I take (GPU jobs, quotas, loans, web IDEs, desktops, requests). Saved as it
// is ticked; security notices always go.
function MyNoticeChoices() {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const got = useLoad(noticesApi.get);
  const [kinds, setKinds] = useState<NoticeKind[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = kinds ?? (got.state === 'ok' ? got.data.kinds : null);
  async function flip(id: string, on: boolean) {
    setError(null);
    try { setKinds((await noticesApi.save({ [id]: on })).kinds); } catch (e) { setError((e as Error).message); }
  }
  return (
    <section className="acct-section">
      <h3>{L('알림 메일', 'Notice mails')}</h3>
      {got.state === 'loading' && <p className="muted small">…</p>}
      {got.state === 'error' && <p className="alert error small">{got.message}</p>}
      {got.state === 'ok' && <>
        <p className="muted small">{got.data.email
          ? L(`${got.data.email} 로 보냅니다. 받지 않을 종류는 끄세요. 비밀번호·2단계 인증 초기화와 계정 중지·만료 안내는 항상 보냅니다.`,
            `Sent to ${got.data.email}. Turn off what you do not want. Password / two-step resets and account disabled / expired notices always go.`)
          : L('계정에 메일 주소가 없어 알림 메일을 보낼 수 없습니다. 관리자에게 메일 주소 등록을 요청하세요.', 'Your account has no mail address, so no notice can be sent. Ask an administrator to add one.')}</p>
        <div className="notice-choices">
          {shown?.map((k) => (
            <label key={k.id} className="check"><input id={`notice-${k.id}`} type="checkbox" checked={k.on} disabled={!got.data.email} onChange={(e) => flip(k.id, e.target.checked)} />
              <span>{pick({ ko: k.label_ko, en: k.label_en })}</span></label>))}
        </div>
      </>}
      {error && <div className="alert error small" role="alert">{error}</div>}
    </section>
  );
}

function TwoFactor() {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const status = useLoad(usersApi.my2fa);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [mode, setMode] = useState<'idle' | 'replace' | 'disable'>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null); setDone(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const start = (pw?: string) => run(async () => { setSetup(await usersApi.setup2fa(pw)); setCode(''); });
  const reset = () => { setSetup(null); setMode('idle'); setPassword(''); setCode(''); };

  return (
    <section className="acct-section">
      <h3>{L('2단계 인증 (인증 앱)', 'Two-step sign-in (authenticator app)')}</h3>
      {status.state === 'loading' && <p className="muted small">…</p>}
      {status.state === 'error' && <p className="alert error small">{status.message}</p>}
      {status.state === 'ok' && !status.data.available && <p className="muted small">{L('엔진에 2단계 인증 모듈이 설치되어 있지 않습니다.', 'Two-step sign-in is not installed on the engine.')}</p>}
      {status.state === 'ok' && status.data.available && <>
        <p className="small">
          {status.data.enabled ? <span className="chip chip-on">{L('사용 중', 'On')}</span> : <span className="chip chip-free">{L('사용 안 함', 'Off')}</span>}{' '}
          <span className="muted">{L('로그인할 때 비밀번호와 함께 인증 앱(Google Authenticator, Microsoft Authenticator 등)의 6자리 코드를 넣습니다.',
            'Sign-in asks for the 6-digit code of an authenticator app (Google Authenticator, Microsoft Authenticator, …) after the password.')}</span>
        </p>
        {setup ? (
          <form className="totp-setup" onSubmit={(e) => { e.preventDefault(); run(async () => { await usersApi.verify2fa(code); reset(); setDone(L('2단계 인증을 켰습니다.', 'Two-step sign-in is on.')); status.reload(); }); }}>
            <img src={setup.qr_code} alt={L('인증 앱으로 찍을 QR 코드', 'QR code for the authenticator app')} width={180} height={180} />
            <div className="form">
              <ol className="small totp-steps">
                <li>{L('인증 앱에서 QR 코드를 찍습니다.', 'Scan the QR code with the authenticator app.')}</li>
                <li>{L('찍을 수 없으면 이 키를 직접 넣습니다:', 'Or type this key:')} <code className="totp-key">{setup.secret}</code></li>
                <li>{L('앱에 나온 6자리 코드를 넣고 확인합니다.', 'Enter the 6-digit code the app shows.')}</li>
              </ol>
              <label><span>{L('인증 코드', 'Code')}</span>
                <input id="totp-code" autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></label>
              <div className="row-gap">
                <button type="submit" className="btn primary" disabled={busy || code.length !== 6}>{L('확인하고 켜기', 'Verify and turn on')}</button>
                <button type="button" className="btn" onClick={reset}>{L('취소', 'Cancel')}</button>
              </div>
            </div>
          </form>
        ) : mode !== 'idle' ? (
          <form className="form" onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'replace') start(password);
            else run(async () => { await usersApi.disable2fa(password); reset(); setDone(L('2단계 인증을 껐습니다.', 'Two-step sign-in is off.')); status.reload(); });
          }}>
            <label><span>{L('비밀번호 확인', 'Confirm with your password')}</span>
              <input id="totp-password" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <div className="row-gap">
              <button type="submit" className={`btn ${mode === 'disable' ? 'danger' : 'primary'}`} disabled={busy || !password}>{mode === 'disable' ? L('끄기', 'Turn off') : L('다음', 'Next')}</button>
              <button type="button" className="btn" onClick={reset}>{L('취소', 'Cancel')}</button>
            </div>
          </form>
        ) : (
          <div className="row-gap">
            {!status.data.enabled && <button type="button" className="btn primary" disabled={busy} onClick={() => start()}>{L('등록하기', 'Set up')}</button>}
            {status.data.enabled && <>
              <button type="button" className="btn" onClick={() => setMode('replace')}>{L('다른 기기로 바꾸기', 'Move to another device')}</button>
              <button type="button" className="btn danger" onClick={() => setMode('disable')}>{L('끄기', 'Turn off')}</button>
            </>}
          </div>
        )}
      </>}
      {error && <div className="alert error small" role="alert">{error}</div>}
      {done && <div className="alert info small" role="status">{done}</div>}
    </section>
  );
}
