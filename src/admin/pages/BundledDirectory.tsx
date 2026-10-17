import { useCallback, useState } from 'react';
import { directoryApi, joinCodeText } from '../../api/directory';
import type { BundledDirectory, DirectoryAccount, DirectorySettings, DomainJoin } from '../../api/directory';
import type { Pool } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { useLoad } from '../../components/useLoad';
import { useL } from './OpsPages';

// 사용자 > 도메인(AD/LDAP), top: the bundled directory (Samba AD DC of the install) when it is on.
// Shown only with VLAB_DIRECTORY=1; a site with its own AD sees the AD form alone.
export function BundledDirectoryPanel() {
  const { L, when } = useL();
  const data = useLoad(directoryApi.get);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [accounts, setAccounts] = useState<DirectoryAccount[] | null>(null);
  const d = data.state === 'ok' ? data.data : null;
  if (!d || !d.enabled) return null;

  async function run(what: string, fn: () => Promise<string>) {
    setBusy(what); setNotice(null);
    try { setNotice({ kind: 'info', text: await fn() }); data.reload(); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); } finally { setBusy(''); }
  }
  const check = () => run('check', async () => {
    const c = await directoryApi.check();
    if (c.code !== 'OK') throw new Error(L(`DC 확인 실패: ${joinCodeText(c.code, L)} ${c.detail}`, `DC check failed: ${c.code} ${c.detail}`));
    return L(`DC 에 연결됨 · 계정 ${c.users}개${c.tls_verified ? ' · 인증서 확인됨' : ' · 인증서 확인 안 됨'}`,
      `DC reachable · ${c.users} accounts${c.tls_verified ? ' · certificate checked' : ' · certificate not checked'}`);
  });
  const sync = () => run('sync', async () => {
    const s = await directoryApi.sync();
    return L(`맞춤 완료: 계정 ${s.accounts} · 새로 만듦 ${s.made} · 지움 ${s.deleted} · 비밀번호 없음 ${s.no_password} · 그룹 ${s.groups} · 오류 ${s.errors}`,
      `Reconciled: ${s.accounts} accounts · ${s.made} made · ${s.deleted} deleted · ${s.no_password} without password · ${s.groups} groups · ${s.errors} errors`);
  });
  const rotate = () => run('rotate', async () => {
    await directoryApi.rotateJoin();
    return L('가입 계정 비밀번호를 새로 정했습니다.', 'vlab-join has a new password.');
  });
  async function showAccounts() {
    if (accounts) { setAccounts(null); return; }
    try { setAccounts(await directoryApi.accounts()); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
  }

  return (
    <section className="panel storage-panel">
      <div className="panel-head">
        <span className="stat-icon tone-blue"><Icon name="users" size={18} /></span>
        <div>
          <h2 className="section-title">{L('내장 디렉터리', 'Bundled directory')} <span className="muted small">Samba AD DC</span></h2>
          <div className="policy-chips">
            <span className={d.active ? 'chip chip-accent' : 'chip'}>{d.active ? L('포털 계정 = 데스크톱 계정', 'Portal account = desktop account')
              : L('기관 AD 사용 중 — 로그인에 쓰지 않음', 'Own AD configured — not used for sign-in')}</span>
            <span className="chip">{d.domain} · {d.realm}</span>
            <span className="chip">DC {d.dc}{d.ip ? ` (${d.ip})` : ''}</span>
            <span className={d.tls_verified ? 'chip' : 'chip chip-warn'}>{d.tls_verified ? L('LDAPS 인증서 확인', 'LDAPS certificate checked') : L('인증서 확인 안 됨', 'Certificate not checked')}</span>
          </div>
        </div>
        <div className="panel-actions">
          <button type="button" className="btn" onClick={() => setEditing(true)}>{L('설정', 'Settings')}</button>
          <button type="button" className="btn" disabled={!!busy} onClick={check}>{busy === 'check' ? L('확인 중…', 'Checking…') : L('연결 확인', 'Check')}</button>
          <button type="button" className="btn primary" disabled={!!busy || !d.active} onClick={sync}>{busy === 'sync' ? L('맞추는 중…', 'Reconciling…') : L('지금 맞추기', 'Reconcile now')}</button>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      {!d.service_account && <div className="alert error small">{L('vlab-svc 비밀번호가 없습니다 · vlab-directory 컨테이너를 확인하세요', 'No vlab-svc password · check the vlab-directory container')}</div>}
      <p className="small">
        {L(`계정 ${d.accounts.total} · 정상 ${d.accounts.ok} · 문제 ${d.accounts.failed}`, `Accounts ${d.accounts.total} · ok ${d.accounts.ok} · problems ${d.accounts.failed}`)}
        <span className="muted"> · {L(`도메인 가입 데스크톱 ${d.joins.joined}/${d.joins.total}`, `Joined desktops ${d.joins.joined}/${d.joins.total}`)}</span>
        <span className="muted"> · {L('마지막 맞춤', 'Last reconcile')} {d.last_reconcile ? when(d.last_reconcile) : '-'}</span>
        {' '}<button type="button" className="btn-ghost small-btn" onClick={showAccounts}>{accounts ? L('계정 목록 닫기', 'Hide accounts') : L('계정 목록', 'Accounts')}</button>
      </p>
      <p className="muted small">{L('비밀번호는 DC 에만 있고 엔진은 저장하지 않습니다.', 'Passwords live on the DC only; the engine keeps none.')}</p>
      {accounts && (
        <div className="table-scroll"><table className="table compact-head">
          <thead><tr><th>{L('아이디', 'User')}</th><th>{L('위치', 'Where')}</th><th>{L('결과', 'Result')}</th><th>{L('시각', 'At')}</th></tr></thead>
          <tbody>{accounts.map((a) => (
            <tr key={a.username}>
              <td>{a.username}{a.dn && <div className="muted small"><code className="code">{a.dn}</code></div>}</td>
              <td>{a.where === 'directory' ? L('디렉터리', 'Directory') : a.where === 'waiting' ? L('다음 로그인 때 옮김', 'Moves at next sign-in')
                : a.where === 'local' ? L('포털 계정', 'Portal account') : a.where}</td>
              <td>{a.ok === true ? <span className="chip chip-ok">OK</span> : a.ok === false ? <><span className="chip chip-warn">{a.code}</span><div className="muted small">{a.detail}</div></> : '-'}</td>
              <td className="muted small">{a.at ? when(a.at) : '-'}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <details className="small">
        <summary>{L('자세히', 'Details')}</summary>
        <ul className="plain-list">
          <li>{L('사용자', 'Users')}: <code className="code">{d.users_dn}</code></li>
          <li>{L('그룹', 'Groups')}: <code className="code">{d.groups_dn}</code> · {L('부서마다 dep-…, 모두 moavi-users', 'dep-… per department, everyone in moavi-users')}</li>
          <li>{L('데스크톱', 'Desktops')}: <code className="code">{d.desktops_dn}</code></li>
          <li>{L('풀 권한 "AD 그룹" 예', 'Pool grant "AD group", e.g.')}: <code className="code">{d.all_group_dn}</code></li>
          <li>{L('관리자 계정은 포털 계정으로 남아 DC 가 멈춰도 콘솔에 들어옵니다.', 'Administrators stay portal accounts, so the console works when the DC does not.')}</li>
          <li>{L('가입 계정 vlab-join', 'Join account vlab-join')}: {d.join_account ? L('비밀번호 봉인됨', 'password sealed') : L('첫 가입 때 만듦', 'made at the first join')}
            {' '}<button type="button" className="btn-ghost small-btn" disabled={!!busy || !d.active} onClick={rotate}>{L('비밀번호 새로 정하기', 'New password')}</button></li>
        </ul>
      </details>
      {editing && <DirectorySettingsDialog initial={d} onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); setNotice({ kind: 'info', text: L('저장했습니다.', 'Saved.') }); data.reload(); }} />}
    </section>
  );
}

function DirectorySettingsDialog({ initial, onClose, onSaved }: { initial: BundledDirectory; onClose: () => void; onSaved: () => void }) {
  const { L } = useL();
  const [s, setS] = useState<DirectorySettings>({ ...initial.settings });
  const [dns, setDns] = useState(initial.settings.desktop_dns.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof DirectorySettings>(k: K, v: DirectorySettings[K]) => setS((o) => ({ ...o, [k]: v }));
  async function save() {
    setBusy(true); setError(null);
    try {
      await directoryApi.save({ ...s, desktop_dns: dns.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean) });
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('내장 디렉터리 설정', 'Bundled directory settings')} onClose={onClose} onSubmit={save} submitLabel={L('저장', 'Save')} busy={busy} error={error}>
      <label className="check"><input type="checkbox" checked={s.migrate_on_login} onChange={(e) => set('migrate_on_login', e.target.checked)} />
        {L('기존 포털 계정은 다음 로그인 때 옮김', 'Move existing portal accounts at their next sign-in')}</label>
      <label className="check"><input type="checkbox" checked={s.include_admins} onChange={(e) => set('include_admins', e.target.checked)} />
        {L('관리자 계정도 디렉터리에 둠', 'Administrators too')}</label>
      <label className="field"><span>{L('데스크톱 이름', 'Desktop name')}</span>
        <input value={s.computer_name} onChange={(e) => set('computer_name', e.target.value)} />
        <small className="muted">{L('{vmid} 포함 · 15자 이내', '{vmid} · up to 15')}</small></label>
      <label className="check"><input type="checkbox" checked={s.set_dns} onChange={(e) => set('set_dns', e.target.checked)} />
        {L('가입할 때 DNS 를 DC 로 바꿈', 'Point the desktop DNS at the DC')}</label>
      <label className="field"><span>{L('DNS 서버', 'DNS servers')}</span>
        <input value={dns} placeholder={initial.ip} onChange={(e) => setDns(e.target.value)} disabled={!s.set_dns} /></label>
      <label className="check"><input type="checkbox" checked={s.rdp_group} onChange={(e) => set('rdp_group', e.target.checked)} />
        {L('moavi-users 에 원격 로그인 허용', 'Let moavi-users sign in remotely')}</label>
      <details className="small"><summary>{L('자세히', 'Details')}</summary>
        <ul className="plain-list">
          <li>{L('관리자도 디렉터리에 두면 DC 가 멈췄을 때 관리자도 로그인하지 못합니다.', 'Administrators in the directory cannot sign in while the DC is down.')}</li>
          <li>{L('DNS 를 바꾸지 않으면 데스크톱 망 DHCP 가 DC 를 DNS 로 줘야 합니다. DNS 서버를 비우면 DC 주소를 씁니다.', 'Without it, DHCP must hand out the DC as DNS. Empty DNS servers: the DC.')}</li>
          <li>{L('원격 로그인: Windows 는 원격 데스크톱 사용자 그룹, Linux 는 realm permit.', 'Remote sign-in: Remote Desktop Users on Windows, realm permit on Linux.')}</li>
        </ul></details>
    </Dialog>
  );
}

// 풀 상세: the domain join of the pool's desktops (only while the bundled directory is on)
export function PoolDomainJoinPanel({ pool }: { pool: Pool }) {
  const { L, when } = useL();
  const dir = useLoad(directoryApi.get);
  const on = dir.state === 'ok' && dir.data.enabled && dir.data.active;
  const rows = useLoad(useCallback(() => (on ? directoryApi.joins(pool.id) : Promise.resolve([] as DomainJoin[])), [pool.id, on]), [pool.id, on]);
  const [restart, setRestart] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  if (!on) return null;
  const list = rows.state === 'ok' ? rows.data : [];
  const joined = list.filter((r) => r.state === 'joined').length;
  const dom = dir.state === 'ok' ? dir.data.domain : 'MOAVI';

  async function joinAll() {
    setBusy('pool'); setNotice(null);
    try {
      const r = await directoryApi.joinPool(pool.id, restart);
      setNotice({ kind: r.joined === r.joins.length ? 'info' : 'error', text: L(`${r.joins.length}대 중 ${r.joined}대 가입.${r.remaining ? ` 남은 ${r.remaining}대는 다시 누르세요.` : ''}`,
        `${r.joined} of ${r.joins.length} joined.${r.remaining ? ` Press again for the other ${r.remaining}.` : ''}`) });
      rows.reload();
    } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); } finally { setBusy(''); }
  }
  async function one(r: DomainJoin, checkOnly: boolean) {
    setBusy(r.desktop_id); setNotice(null);
    try {
      const j = checkOnly ? await directoryApi.checkJoin(r.desktop_id) : await directoryApi.join(r.desktop_id, restart);
      setNotice({ kind: j.state === 'joined' ? 'info' : 'error', text: `${r.name ?? r.desktop_id}: ${joinCodeText(j.code, L)}${j.detail ? ` — ${j.detail}` : ''}` });
      rows.reload();
    } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); } finally { setBusy(''); }
  }
  const chip = (r: DomainJoin) => (r.state === 'joined' ? 'chip chip-ok' : r.state === 'failed' || r.state === 'other' ? 'chip chip-warn' : 'chip');

  return (
    <section className="panel storage-panel">
      <div className="panel-head">
        <span className="stat-icon tone-blue"><Icon name="link" size={18} /></span>
        <div>
          <h2 className="section-title">{L('도메인 가입', 'Domain join')}</h2>
          <div className="policy-chips">
            <span className="chip chip-accent">{dir.state === 'ok' ? `${dir.data.domain} · ${dir.data.realm}` : ''}</span>
            <span className="chip">{L(`가입 ${joined}/${list.length}`, `Joined ${joined}/${list.length}`)}</span>
          </div>
        </div>
        <div className="panel-actions">
          <label className="check small"><input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} />{L('가입 후 재시작', 'Restart after joining')}</label>
          <button type="button" className="btn primary" disabled={!!busy || list.length === 0} onClick={joinAll}>{busy === 'pool' ? L('가입 중…', 'Joining…') : L('켜진 데스크톱 모두 가입', 'Join running desktops')}</button>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      <p className="muted small">{L(`가입한 데스크톱에는 ${dom}\\아이디 로 로그인합니다.`, `Joined desktops sign in as ${dom}\\user.`)}</p>
      <details className="small"><summary>{L('자세히', 'Details')}</summary>
        <ul className="plain-list">
          <li>{L('게스트 에이전트로 가입합니다: Windows 는 Add-Computer, Linux 는 realm join.', 'Through the guest agent: Add-Computer on Windows, realm join on Linux.')}</li>
          <li>{L('Windows 템플릿은 sysprep 으로 일반화해 둡니다. 같은 설치본의 복제는 SID · 이름이 같습니다.', 'Generalize Windows templates with sysprep; clones of one install share SID and name.')}</li>
          <li>{L('Windows 는 재시작해야 가입이 적용됩니다.', 'Windows applies the join after a restart.')}</li>
        </ul></details>
      {list.length > 0 && (
        <div className="table-scroll"><table className="table compact-head">
          <thead><tr><th>{L('데스크톱', 'Desktop')}</th><th>{L('상태', 'State')}</th><th>{L('도메인 이름', 'Computer')}</th><th>{L('시각', 'At')}</th><th /></tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.desktop_id}>
              <td>{r.name ?? r.desktop_id} <span className="muted small">#{r.vmid}</span></td>
              <td><span className={chip(r)}>{r.state === 'unknown' ? L('모름', 'Unknown') : joinCodeText(r.code, L)}</span>
                {r.detail && r.state !== 'joined' && <div className="muted small">{r.detail}</div>}</td>
              <td className="small">{r.computer || '-'}{r.domain ? <span className="muted"> · {r.domain}</span> : null}</td>
              <td className="muted small">{r.at ? when(r.at) : '-'}</td>
              <td>
                <button type="button" className="btn-ghost small-btn" disabled={!!busy} onClick={() => one(r, true)}>{L('확인', 'Check')}</button>
                <button type="button" className="btn-ghost small-btn" disabled={!!busy || r.state === 'joined'} onClick={() => one(r, false)}>
                  {busy === r.desktop_id ? L('가입 중…', 'Joining…') : L('가입', 'Join')}</button>
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
    </section>
  );
}
