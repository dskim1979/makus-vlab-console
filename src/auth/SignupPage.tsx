import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { nextApi } from '../api/next';
import { BrandLockup } from '../components/Brand';
import { CompanyNotice } from '../components/CompanyNotice';
import { useI18n } from '../i18n';

// /signup: ask for an account (open only when 사용자 > 가입 심사 takes requests). An admin
// approves it; approving gives a portal account in the department picked, no desktop yet.

export function SignupPage() {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [cfg, setCfg] = useState<{ enabled: boolean; departments: { id: string; name: string }[] } | null>(null);
  const [f, setF] = useState({ username: '', password: '', password2: '', display_name: '', email: '', department_id: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => { nextApi.signupConfig().then(setCfg); }, []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.password !== f.password2) { setError(L('비밀번호가 서로 다릅니다.', 'The passwords differ.')); return; }
    setBusy(true); setError(null);
    try {
      await nextApi.signup({ username: f.username.trim().toLowerCase(), password: f.password, display_name: f.display_name.trim(),
        email: f.email.trim(), department_id: f.department_id || null, note: f.note.trim() });
      setDone(true);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="login-page">
      <main className="login-card signup-card">
        <BrandLockup markSize={34} />
        <h1>{L('가입 신청', 'Ask for an account')}</h1>
        {cfg && !cfg.enabled ? (
          <div className="alert info">{L('지금은 가입 신청을 받지 않습니다. 관리자에게 계정을 요청하세요.', 'Sign-up is closed. Ask your administrator for an account.')}</div>
        ) : done ? (
          <div className="alert info" role="status">{L('신청했습니다. 관리자가 승인하면 이 아이디로 로그인할 수 있습니다.', 'Sent. You can sign in with this username once an admin approves it.')}</div>
        ) : (
          <form onSubmit={submit} className="form">
            <p className="muted small">{L('관리자가 확인한 뒤 계정을 만들어 드립니다. 데스크톱은 승인 뒤 따로 배정됩니다.', 'An admin reviews it and makes the account. Desktops are assigned afterwards.')}</p>
            <label><span>{L('아이디', 'Username')}</span><input id="su-user" autoComplete="username" value={f.username} onChange={set('username')} placeholder="kim.minji" /></label>
            <div className="form-row form-row-wide">
              <label><span>{L('비밀번호', 'Password')}</span><input id="su-pass" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></label>
              <label><span>{L('비밀번호 확인', 'Again')}</span><input id="su-pass2" type="password" autoComplete="new-password" value={f.password2} onChange={set('password2')} /></label>
            </div>
            <label><span>{L('이름', 'Name')}</span><input id="su-name" value={f.display_name} onChange={set('display_name')} /></label>
            <label><span>{L('메일 (선택)', 'Mail (optional)')}</span><input id="su-mail" type="email" value={f.email} onChange={set('email')} /></label>
            {cfg && cfg.departments.length > 0 && (
              <label><span>{L('소속 부서', 'Department')}</span>
                <select id="su-dep" value={f.department_id} onChange={set('department_id')}>
                  <option value="">{L('고르지 않음', 'None')}</option>
                  {cfg.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select></label>
            )}
            <label><span>{L('신청 이유 (선택)', 'Why (optional)')}</span><input id="su-note" maxLength={300} value={f.note} onChange={set('note')} placeholder={L('예: 데이터베이스 실습 수강', 'e.g. taking the DB lab')} /></label>
            {error && <div className="alert error" role="alert">{error}</div>}
            <button type="submit" className="btn primary block" disabled={busy || !f.username || !f.password}>{L('신청하기', 'Send')}</button>
          </form>
        )}
        <p className="muted small"><Link to="/login">{L('로그인으로 돌아가기', 'Back to sign-in')}</Link></p>
      </main>
      <footer className="login-foot"><CompanyNotice /></footer>
    </div>
  );
}
