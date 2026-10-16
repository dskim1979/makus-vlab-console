import { useEffect, useState, type ReactNode } from 'react';
import { accountsApi, type MyTerms } from '../api/accounts';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';

// 약관 · 개인정보 처리 방침 (플랫폼 설정 > 계정 · 약관): shown at sign-up and, after a sign-in,
// to anyone who has not agreed to the current version. The engine refuses /api/vlab/me/* and
// a desktop until they agree (TERMS_REQUIRED), so the console asks first.

// a little markdown: "# heading", "- item", blank lines; everything else as typed (no HTML)
export function TermsText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={blocks.length}>{list.map((x, i) => <li key={i}>{x}</li>)}</ul>); list = []; } };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) { list.push(li[1]); continue; }
    flush();
    if (h) blocks.push(<h4 key={blocks.length}>{h[2]}</h4>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{line}</p>);
  }
  flush();
  return <div className="terms-text">{blocks}</div>;
}

export function TermsBoxes({ terms, privacy }: { terms?: string; privacy?: string }) {
  const { pick } = useI18n();
  return (
    <div className="terms-boxes">
      {!!terms?.trim() && <section className="terms-box" aria-label={pick({ ko: '이용 약관', en: 'Terms of use' })}><TermsText text={terms} /></section>}
      {!!privacy?.trim() && <section className="terms-box" aria-label={pick({ ko: '개인정보 처리 방침', en: 'Privacy policy' })}><TermsText text={privacy} /></section>}
    </div>
  );
}

// wraps the signed-in screens: a full-page consent while it is due
export function TermsGate({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [due, setDue] = useState<MyTerms | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = user?.username;
  useEffect(() => {
    let alive = true;
    if (name) accountsApi.myTerms().then((t) => alive && setDue(t?.required ? t : null));
    return () => { alive = false; };
  }, [name]);

  async function accept() {
    if (!due?.version) return;
    setBusy(true); setError(null);
    try { await accountsApi.agreeTerms(due.version); setDue(null); }
    catch (e) {
      // the version changed while reading: show the new one
      const t = await accountsApi.myTerms();
      setDue(t?.required ? t : null); setAgree(false); setError((e as Error).message);
    } finally { setBusy(false); }
  }

  if (!due) return <>{children}</>;
  return (
    <div className="terms-gate" role="dialog" aria-modal="true" aria-labelledby="terms-gate-title">
      <div className="terms-gate-card">
        <h2 id="terms-gate-title">{due.agreed_version ? L('약관이 바뀌었습니다', 'The terms have changed') : L('이용 약관 · 개인정보 처리 방침', 'Terms of use and privacy policy')}</h2>
        <p className="muted small">{L(`계속하려면 아래 내용에 동의해 주세요. (버전 ${due.version})`, `Agree to continue. (version ${due.version})`)}</p>
        <TermsBoxes terms={due.terms} privacy={due.privacy} />
        <label className="check"><input id="terms-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>{L('이용 약관과 개인정보 처리 방침을 읽었고 동의합니다. (필수)', 'I have read and agree to the terms of use and the privacy policy. (required)')}</span></label>
        {error && <div className="alert error small" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => void logout()}>{L('동의하지 않고 로그아웃', 'Decline and sign out')}</button>
          <button type="button" className="btn primary" disabled={!agree || busy} onClick={accept}>{L('동의하고 계속', 'Agree and continue')}</button>
        </div>
      </div>
    </div>
  );
}
