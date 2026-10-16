import { useState } from 'react';
import { accountsApi, downloadText, type AccountSettings, type Terms } from '../../api/accounts';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { SettingsSection, SettingsShell, SettingsStatus } from '../../components/SettingsShell';
import { TermsBoxes } from '../../components/Terms';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// 운영 > 플랫폼 설정 > 계정 · 약관: what happens when an account reaches its last day of use, the
// address put in mails (reset links, codes), the terms of use and the privacy policy with their
// version, and who agreed to which version (makus-vlab pegaprox/api/vlab_accounts.py). The mail
// check and the institution domains of a sign-up are in 사용자 › 가입 심사 › 가입 설정.

function useL() {
  const { pick, lang } = useI18n();
  return { L: (ko: string, en: string) => pick({ ko, en }), lang };
}

export function AccountSettingsPage() {
  const { L } = useL();
  const acc = useLoad(accountsApi.accountSettings);
  const terms = useLoad(accountsApi.terms);
  const sections = [
    { id: 'expiry', title: L('사용 기한', 'Expiry') },
    { id: 'mail', title: L('메일의 주소', 'Address in mails') },
    { id: 'terms', title: L('약관 · 개인정보', 'Terms and privacy') },
    { id: 'consents', title: L('동의 기록', 'Consents') },
  ];
  const a = acc.state === 'ok' ? acc.data : null;
  const t = terms.state === 'ok' ? terms.data : null;
  return (
    <SettingsShell sections={sections} status={
      <SettingsStatus items={[
        { label: L('만료 전 안내', 'Notice before'), value: a ? (a.notice_days ? L(`${a.notice_days}일 전`, `${a.notice_days} days`) : L('안 함', 'off')) : '-', tone: a?.notice_days ? 'ok' : 'off' },
        { label: L('만료 뒤 삭제', 'Delete after'), value: a ? (a.delete_after_days ? L(`${a.delete_after_days}일 뒤`, `${a.delete_after_days} days`) : L('안 함 (정지만)', 'never (disabled only)')) : '-' },
        { label: L('약관 동의', 'Terms'), value: t ? (t.terms.enabled ? L(`버전 ${t.terms.version} · ${t.agreed ?? 0}명 동의`, `version ${t.terms.version} · ${t.agreed ?? 0} agreed`) : L('끔', 'off')) : '-', tone: t?.terms.enabled ? 'ok' : 'off' },
      ]} />}>
      <LoadState value={acc} retry={acc.reload}>{(s) => <ExpirySections initial={s} onSaved={acc.reload} />}</LoadState>
      <LoadState value={terms} retry={terms.reload}>{(x) => <TermsSection initial={x.terms} onSaved={terms.reload} />}</LoadState>
      <ConsentsSection version={t?.terms.version} />
    </SettingsShell>
  );
}

function ExpirySections({ initial, onSaved }: { initial: AccountSettings; onSaved: () => void }) {
  const { L } = useL();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    setBusy(true); setMsg(null);
    try { setF(await accountsApi.saveAccountSettings(f)); setMsg({ ok: true, text: L('저장했습니다.', 'Saved.') }); onSaved(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  return (
    <>
      <SettingsSection id="expiry" title={L('사용 기한', 'Expiry')} desc={L('계정마다 사용 기한(마지막 날)을 사용자 목록 · 일괄 등록 · 가입 승인에서 정합니다. 그날이 지나면 1분 안에 로그인이 막히고(정지) 열린 세션이 끝납니다.',
        'Each account can have a last day of use (user list, import, sign-up approval). After it, within a minute, the account is disabled and its sessions end.')}>
        <div className="form-row form-row-even">
          <label><span>{L('만료 전 메일 안내 (일)', 'Mail notice before (days)')}</span>
            <input id="acc-notice" type="number" min={0} max={60} value={f.notice_days} onChange={(e) => setF({ ...f, notice_days: Number(e.target.value) })} />
            <small className="muted">{L('0이면 보내지 않습니다. 메일 주소가 있는 계정에 한 번 보냅니다.', '0: none. Sent once to accounts with a mail address.')}</small></label>
          <label><span>{L('만료 뒤 계정 삭제 (일)', 'Delete after expiry (days)')}</span>
            <input id="acc-delete" type="number" min={0} max={3650} value={f.delete_after_days} onChange={(e) => setF({ ...f, delete_after_days: Number(e.target.value) })} />
            <small className="muted">{L('0이면 지우지 않고 정지만 합니다. 그 사이 관리자가 다시 켜면 지우지 않습니다.', '0: never, disabled only. An account an admin enabled again is not deleted.')}</small></label>
        </div>
        <label className="check"><input id="acc-reclaim" type="checkbox" checked={f.reclaim} onChange={(e) => setF({ ...f, reclaim: e.target.checked })} />
          <span>{L('만료되면 배정된 데스크톱 회수 (초기화 풀은 기준 스냅샷으로 초기화)', 'Take back assigned desktops at expiry (resetting pools go back to their base)')}</span></label>
      </SettingsSection>
      <SettingsSection id="mail" title={L('메일의 주소', 'Address in mails')} desc={L('비밀번호 재설정 링크, 메일 인증 링크, 일괄 등록 안내 메일에 넣는 콘솔 주소입니다. 비우면 요청이 들어온 주소를 씁니다. 메일은 일반 탭의 SMTP로 보냅니다.',
        'The console address put in reset links, verification links and import mails. Empty: the address the request came to. Mail goes through the SMTP of the General tab.')}>
        <label><span>{L('사용자가 여는 주소', 'Address users open')}</span>
          <input id="acc-url" type="url" placeholder="https://desk.univ.ac.kr" value={f.public_url} onChange={(e) => setF({ ...f, public_url: e.target.value })} /></label>
        {msg && <div className={`alert small ${msg.ok ? 'info' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
        <div><button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>{L('저장', 'Save')}</button></div>
      </SettingsSection>
    </>
  );
}

function TermsSection({ initial, onSaved }: { initial: Terms; onSaved: () => void }) {
  const { L } = useL();
  const [f, setF] = useState({ enabled: initial.enabled, version: initial.version, terms: initial.terms, privacy: initial.privacy });
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const textChanged = f.terms !== initial.terms || f.privacy !== initial.privacy;
  const sameVersion = f.version === initial.version && !!initial.version;
  async function save() {
    if (f.enabled && textChanged && sameVersion && !confirm(L('본문을 바꿨지만 버전은 그대로입니다. 버전을 그대로 두면 이미 동의한 사람에게 다시 묻지 않습니다. 저장할까요?',
      'The text changed but the version did not, so nobody who agreed is asked again. Save anyway?'))) return;
    setBusy(true); setMsg(null);
    try {
      await accountsApi.saveTerms(f);
      setMsg({ ok: true, text: f.enabled && f.version !== initial.version ? L('저장했습니다. 다음 로그인부터 모두 새 버전에 다시 동의합니다.', 'Saved. Everyone agrees to the new version at their next sign-in.') : L('저장했습니다.', 'Saved.') });
      onSaved();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  const dirty = f.enabled !== initial.enabled || f.version !== initial.version || textChanged;
  return (
    <SettingsSection id="terms" title={L('약관 · 개인정보 처리 방침', 'Terms and privacy policy')} desc={L('켜면 가입 신청과 첫 로그인 때 동의를 받습니다(필수 체크). 버전을 바꾸면 모두 다시 동의합니다. 본문은 텍스트이며 "# 제목", "- 항목" 정도의 마크다운을 씁니다.',
      'On: sign-up and the first sign-in ask for consent (a required tick). A new version asks everyone again. Plain text with a little markdown ("# heading", "- item").')}>
      <div className="form-row form-row-even">
        <label className="check"><input id="terms-on" type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          <span>{L('동의 받기', 'Ask for consent')}</span></label>
        <label><span>{L('버전', 'Version')}</span>
          <input id="terms-version" value={f.version} maxLength={40} placeholder="2026-10" onChange={(e) => setF({ ...f, version: e.target.value.trim() })} />
          {initial.updated_at && <small className="muted">{L(`마지막 변경 ${initial.updated_at.slice(0, 16).replace('T', ' ')} · ${initial.updated_by ?? ''}`, `Last changed ${initial.updated_at.slice(0, 16).replace('T', ' ')} by ${initial.updated_by ?? ''}`)}</small>}</label>
      </div>
      <label><span>{L('이용 약관', 'Terms of use')}</span>
        <textarea id="terms-text" rows={8} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></label>
      <label><span>{L('개인정보 처리 방침', 'Privacy policy')}</span>
        <textarea id="terms-privacy" rows={8} value={f.privacy} onChange={(e) => setF({ ...f, privacy: e.target.value })} /></label>
      {textChanged && sameVersion && f.enabled && <div className="alert info small">{L('본문을 바꿨다면 버전도 바꿔야 이미 동의한 사용자에게 다시 묻습니다.', 'Change the version too, or those who agreed are not asked again.')}</div>}
      {preview && <TermsBoxes terms={f.terms} privacy={f.privacy} />}
      {msg && <div className={`alert small ${msg.ok ? 'info' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <div className="toolbar">
        <button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>{L('저장', 'Save')}</button>
        <button type="button" className="btn" onClick={() => setPreview((p) => !p)}>{preview ? L('미리 보기 닫기', 'Hide preview') : L('미리 보기', 'Preview')}</button>
      </div>
    </SettingsSection>
  );
}

function ConsentsSection({ version }: { version?: string }) {
  const { L } = useL();
  const [which, setWhich] = useState<'current' | 'all'>('current');
  const v = which === 'current' ? version || undefined : undefined;
  const list = useLoad(() => accountsApi.consents(v), [v]);
  const [q, setQ] = useState('');
  async function csv() {
    try { downloadText(`terms-consents${v ? `-${v}` : ''}.csv`, await accountsApi.consentsCsv(v)); } catch (e) { alert((e as Error).message); }
  }
  return (
    <SettingsSection id="consents" title={L('동의 기록', 'Consents')} desc={L('누가 · 언제 · 어떤 버전에 동의했는지(가입 신청 때 또는 로그인 때)와 접속 주소입니다. CSV로 받아 보관할 수 있습니다.',
      'Who agreed to which version, when (at sign-up or at a sign-in), and from where. Download as CSV to keep.')}>
      <div className="toolbar">
        <select aria-label={L('버전', 'Version')} value={which} onChange={(e) => setWhich(e.target.value as 'current' | 'all')}>
          <option value="current">{L(`현재 버전${version ? ` (${version})` : ''}`, `Current version${version ? ` (${version})` : ''}`)}</option>
          <option value="all">{L('모든 버전', 'Every version')}</option>
        </select>
        <input type="search" placeholder={L('아이디 찾기', 'Find a username')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn" onClick={csv}><Icon name="download" size={16} />CSV</button>
      </div>
      <LoadState value={list} retry={list.reload}>
        {({ consents, not_yet }) => {
          const rows = consents.filter((c) => !q || c.username.includes(q.trim().toLowerCase()));
          return (
            <>
              {which === 'current' && not_yet.length > 0 && <p className="muted small">{L(`아직 동의하지 않은 사용자 ${not_yet.length}명: `, `${not_yet.length} user(s) have not agreed yet: `)}{not_yet.slice(0, 20).join(', ')}{not_yet.length > 20 ? ' …' : ''}</p>}
              {rows.length === 0 ? <div className="empty"><p>{L('기록이 없습니다.', 'No records.')}</p></div> : (
                <div className="table-scroll"><table className="table compact-head">
                  <thead><tr><th>{L('아이디', 'Username')}</th><th>{L('버전', 'Version')}</th><th>{L('언제', 'When')}</th><th>{L('어디서', 'Where')}</th><th>{L('경로', 'How')}</th></tr></thead>
                  <tbody>{rows.slice(0, 300).map((c) => (
                    <tr key={c.id}><td className="strong">{c.username}</td><td>{c.version}</td><td className="small">{c.agreed_at.slice(0, 16).replace('T', ' ')}</td>
                      <td className="small muted">{c.client_ip || '-'}</td><td>{c.via === 'signup' ? L('가입 신청', 'sign-up') : L('로그인', 'sign-in')}</td></tr>))}</tbody>
                </table></div>)}
            </>
          );
        }}
      </LoadState>
    </SettingsSection>
  );
}
