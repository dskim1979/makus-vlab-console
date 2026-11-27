import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { directoryApi } from '../../api/directory';
import { nextApi, type Department } from '../../api/next';
import { externalSource, usersApi, type Account, type LockedAccount, type Role } from '../../api/users';
import { useAuth } from '../../auth/AuthContext';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { relativeTime } from '../../portal/DesktopCard';
import { Caret, Drop, Modal, Pager } from './TableKit';
import { ImportDialog } from './UserImport';
import { AccountDialog, ExpiryCell, PasswordDialog, roleLabel, SOURCES } from './UsersPage';

// 사용자 > 사용자 목록: the accounts as one dense table - filters, bulk enable / disable / department /
// delete on the checked rows, a status switch per row, and the desktops each one holds.

type Notice = { kind: 'info' | 'error'; text: string };
const PAGE_SIZES = [20, 50, 100];

export function UsersTablePage() {
  const { t, pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const { user: me } = useAuth();
  const users = useLoad(usersApi.list);
  const roles = useLoad(() => usersApi.roles().catch(() => [] as Role[]));
  const deps = useLoad(() => nextApi.departments().catch(() => [] as Department[]));
  const locked = useLoad(() => usersApi.locked().catch(() => [] as LockedAccount[]));
  const bundled = useLoad(() => directoryApi.get().catch(() => null));
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [dep, setDep] = useState('');            // '' all, '-' none
  const [state, setState] = useState<'' | 'on' | 'off'>('');
  const [source, setSource] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(PAGE_SIZES[0]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [pwFor, setPwFor] = useState<Account | null>(null);
  const [importing, setImporting] = useState(false);
  const [depFor, setDepFor] = useState(false);

  const roleList = roles.state === 'ok' ? roles.data : [];
  const depList = deps.state === 'ok' ? deps.data : [];
  const lockedSet = new Set(locked.state === 'ok' ? locked.data.map((x) => x.username) : []);
  const dir = bundled.state === 'ok' ? bundled.data : null;
  const dirOn = !!dir?.enabled;
  const all = users.state === 'ok' ? users.data : [];
  const sources = useMemo(() => [...new Set(all.map((u) => u.auth_source || 'local'))].sort(), [all]);
  const usedRoles = useMemo(() => [...new Set([...roleList.map((r) => r.id), ...all.map((u) => u.role)])], [roleList, all]);
  const depName = (id?: string | null) => (id ? depList.find((d) => d.id === id)?.name ?? '' : '');
  const srcLabel = (s: string) => (s === 'local' || !s ? (dirOn ? L('로컬 · 내장 AD', 'Local · bundled AD') : L('로컬', 'Local')) : SOURCES[s] ?? s.toUpperCase());

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return all.filter((u) => (!state || (state === 'on' ? u.enabled !== false : u.enabled === false))
      && (!dep || (dep === '-' ? !u.department_id : u.department_id === dep))
      && (!source || (u.auth_source || 'local') === source) && (!role || u.role === role)
      && (!n || [u.username, u.display_name, u.email ?? ''].some((s) => s.toLowerCase().includes(n))));
  }, [all, q, dep, state, source, role]);
  useEffect(() => { setPage(0); }, [q, dep, state, source, role, size]);

  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * size, cur * size + size);
  const chosen = rows.filter((u) => picked.has(u.username));
  const others = chosen.filter((u) => u.username !== me?.username);   // never your own account in bulk
  const pageAll = shown.length > 0 && shown.every((u) => picked.has(u.username));
  const toggle = (name: string) => setPicked((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  function reload() { users.reload(); locked.reload(); }
  async function each(list: Account[], what: string, fn: (u: Account) => Promise<unknown>) {
    setBusy(true); setNotice(null);
    const failed: string[] = [];
    for (const u of list) { try { await fn(u); } catch (e) { failed.push(`${u.username}: ${(e as Error).message}`); } }
    setBusy(false);
    setNotice(failed.length
      ? { kind: 'error', text: L(`${what}: ${list.length - failed.length}명 완료, ${failed.length}명 실패 - ${failed.join('; ')}`, `${what}: ${list.length - failed.length} done, ${failed.length} failed - ${failed.join('; ')}`) }
      : { kind: 'info', text: (list.length === 1 ? `${list[0].username}: ` : L(`${list.length}명 `, `${list.length} accounts: `)) + what + L(' 완료했습니다.', ' done.') });
    setPicked(new Set());
    reload();
  }
  function setEnabled(list: Account[], on: boolean) {
    const go = list.filter((u) => (u.enabled !== false) !== on && u.username !== me?.username);
    if (!go.length) return;
    const who = go.length === 1 ? go[0].username : L(`${go.length}명`, `${go.length} accounts`);
    if (!window.confirm(on ? L(`${who}을(를) 사용하도록 바꿀까요?`, `Enable ${who}?`)
      : L(`${who}을(를) 사용 중지할까요? 열린 세션도 끝납니다.`, `Disable ${who}? Open sessions end.`))) return;
    void each(go, on ? L('사용', 'Enable') : L('사용 중지', 'Disable'), (u) => usersApi.update(u.username, { enabled: on }));
  }
  function remove(list: Account[]) {
    const go = list.filter((u) => u.username !== me?.username);
    if (!go.length) return;
    const desks = go.reduce((n, u) => n + (u.desktops ?? 0), 0);
    const who = go.length === 1 ? go[0].username : L(`${go.length}명`, `${go.length} accounts`);
    if (!window.confirm(L(`${who} 계정을 지울까요? 세션과 API 토큰이 끝나고 되돌릴 수 없습니다.${desks ? `\n배정된 데스크톱 ${desks}대는 배정이 풀립니다.` : ''}`,
      `Delete ${who}? Sessions and API tokens end; this cannot be undone.${desks ? `\n${desks} assigned desktop(s) become unassigned.` : ''}`))) return;
    void each(go, L('삭제', 'Delete'), (u) => usersApi.remove(u.username));
  }
  async function sync() {
    setBusy(true); setNotice(null);
    try {
      const r = await directoryApi.sync();
      setNotice({ kind: r.errors ? 'error' : 'info', text: L(`디렉터리 동기화: 계정 ${r.accounts} · 새로 ${r.made} · 지움 ${r.deleted} · 그룹 ${r.groups}${r.no_password ? ` · 비밀번호 대기 ${r.no_password}` : ''}${r.errors ? ` · 오류 ${r.errors}` : ''}`,
        `Directory sync: ${r.accounts} accounts, ${r.made} made, ${r.deleted} removed, ${r.groups} groups${r.no_password ? `, ${r.no_password} waiting for a password` : ''}${r.errors ? `, ${r.errors} errors` : ''}`) });
    } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    setBusy(false);
  }

  return (
    <>
      <div className="vt-bar">
        <div className="vt-row">
          <input className="vt-name" type="search" placeholder={L('계정 · 이름 · 메일', 'Account · name · mail')} aria-label={L('계정 검색', 'Search accounts')} value={draft}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQ(draft)} />
          <select value={dep} onChange={(e) => setDep(e.target.value)} aria-label={L('부서', 'Department')}>
            <option value="">{L('부서 전체', 'All departments')}</option>
            {depList.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="-">{L('부서 없음', 'No department')}</option>
          </select>
          <select value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label={L('상태', 'Status')}>
            <option value="">{L('상태 전체', 'All states')}</option>
            <option value="on">{L('사용', 'Enabled')}</option>
            <option value="off">{L('중지', 'Disabled')}</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={L('디렉터리', 'Directory')}>
            <option value="">{L('디렉터리 전체', 'All directories')}</option>
            {sources.map((s) => <option key={s} value={s}>{srcLabel(s)}</option>)}
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label={t('users.role')}>
            <option value="">{L('역할 전체', 'All roles')}</option>
            {usedRoles.map((r) => <option key={r} value={r}>{roleLabel(t, r, roleList)}</option>)}
          </select>
          <button type="button" className="btn primary" onClick={() => setQ(draft)}><Icon name="search" size={16} />{L('검색', 'Search')}</button>
          <button type="button" className="btn" onClick={reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
          <span className="vt-create vt-btns">
            {dirOn && <button type="button" className="btn" disabled={busy} onClick={sync}>{L('디렉터리 동기화', 'Sync directory')}</button>}
            <button type="button" className="btn" onClick={() => setImporting(true)}><Icon name="list" size={16} />{L('가져오기', 'Import')}</button>
            <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('사용자 추가', 'Add user')}</button>
          </span>
        </div>
        <div className="vt-row">
          <span className={`vt-count${chosen.length ? ' on' : ''}`}>{chosen.length ? L(`${chosen.length}명 선택`, `${chosen.length} selected`) : L('선택 없음', 'None selected')}</span>
          <button type="button" className="btn small-btn" disabled={busy || !others.length} onClick={() => setEnabled(others, true)}>{L('사용', 'Enable')}</button>
          <button type="button" className="btn small-btn" disabled={busy || !others.length} onClick={() => setEnabled(others, false)}>{L('중지', 'Disable')}</button>
          <button type="button" className="btn small-btn" disabled={busy || !chosen.length || !depList.length} onClick={() => setDepFor(true)}>{L('부서 지정', 'Set department')}</button>
          <button type="button" className="btn small-btn danger" disabled={busy || !others.length} onClick={() => remove(others)}>{L('삭제', 'Delete')}</button>
          {chosen.length > 0 && <button type="button" className="btn-ghost small-btn" onClick={() => setPicked(new Set())}>{L('선택 해제', 'Clear')}</button>}
          <HowTo>
            <ul>
              <li>{L('내 계정은 일괄 중지 · 삭제에서 빠집니다.', 'Your own account is left out of bulk disable and delete.')}</li>
              <li>{L('외부 디렉터리(AD/LDAP · OIDC) 계정의 비밀번호는 그쪽에서 바꿉니다.', 'Passwords of external directory accounts change there.')}</li>
              <li>{L('가져오기는 CSV(아이디, 이름, 메일, 부서, 역할, 사용 기한)입니다.', 'Import takes a CSV (id, name, mail, department, role, last day).')}</li>
              {dirOn && <li>{L('디렉터리 동기화는 계정과 부서를 내장 AD에 맞춥니다.', 'Directory sync brings accounts and departments into the bundled AD.')}</li>}
            </ul>
          </HowTo>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}

      <LoadState value={users} retry={users.reload}>
        {() => rows.length === 0 ? <div className="empty"><p>{all.length ? L('조건에 맞는 사용자가 없습니다.', 'Nobody matches.') : t('users.empty')}</p></div> : (
          <>
            <div className="table-scroll">
              <table className="table vt-table">
                <thead>
                  <tr>
                    <th className="vt-check"><input type="checkbox" aria-label={L('이 페이지 전체', 'This page')} checked={pageAll}
                      onChange={() => setPicked((s) => { const n = new Set(s); shown.forEach((u) => (pageAll ? n.delete(u.username) : n.add(u.username))); return n; })} /></th>
                    <th>{L('계정', 'Account')}</th><th>{L('표시 이름', 'Name')}</th><th>{L('디렉터리', 'Directory')}</th><th>{L('부서', 'Department')}</th>
                    <th>{L('역할', 'Role')}</th><th className="num">{L('데스크톱', 'Desktops')}</th><th>{L('최근 로그인', 'Last sign-in')}</th>
                    <th>{L('사용 기한', 'Last day')}</th><th className="vt-center">{L('상태', 'Status')}</th><th className="vt-actions-h">{L('작업', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u) => {
                    const ext = externalSource(u.auth_source);
                    const self = u.username === me?.username;
                    const on = u.enabled !== false;
                    return (
                      <tr key={u.username} className={`${picked.has(u.username) ? 'vt-picked' : ''}${on ? '' : ' vt-off'}`}>
                        <td className="vt-check"><input type="checkbox" aria-label={u.username} checked={picked.has(u.username)} onChange={() => toggle(u.username)} /></td>
                        <td className="nowrap">
                          <span className="ut-avatar" aria-hidden="true">{(u.display_name || u.username).slice(0, 1).toUpperCase()}</span>
                          <span className="strong">{u.username}</span>
                          {self && <span className="vt-st vd-tag">{L('나', 'Me')}</span>}
                          {lockedSet.has(u.username) && <span className="vt-st vt-st-offline vd-tag">{L('잠김', 'Locked')}</span>}
                          {u.totp_enabled && <span className="vt-st vt-st-running vd-tag" title={L('2단계 인증 사용 중', 'Two-step sign-in on')}>2FA</span>}
                          {u.must_change_password && <span className="vt-st vd-tag" title={L('다음 로그인 때 비밀번호 변경', 'New password at next sign-in')}>{L('변경 대기', 'Pw due')}</span>}
                        </td>
                        <td>{u.display_name}{u.email && <div className="muted small">{u.email}</div>}</td>
                        <td className="nowrap"><span className={`ut-src ut-src-${ext ? 'ext' : dirOn ? 'ad' : 'local'}`}>{srcLabel(u.auth_source)}</span></td>
                        <td className="nowrap">{depName(u.department_id) || <span className="muted">-</span>}</td>
                        <td className="nowrap">{roleLabel(t, u.role, roleList)}</td>
                        <td className="num">{u.desktops ? (
                          <Drop className="vt-link ut-desks" label={<>{u.desktops}<Caret /></>}>{() => <DesksOf username={u.username} />}</Drop>
                        ) : <span className="muted">0</span>}</td>
                        <td className="nowrap small">{relativeTime(u.last_login ?? null, lang) ?? <span className="muted">{t('portal.never')}</span>}</td>
                        <td className="nowrap small"><ExpiryCell account={u} /></td>
                        <td className="vt-center">
                          <button type="button" role="switch" aria-checked={on} className={`ut-switch${on ? ' on' : ''}`} disabled={busy || self}
                            title={self ? L('내 계정은 여기서 끌 수 없습니다', 'Not your own account') : on ? L('사용 중 · 눌러서 중지', 'Enabled · click to disable') : L('중지됨 · 눌러서 사용', 'Disabled · click to enable')}
                            aria-label={on ? L(`${u.username} 중지`, `Disable ${u.username}`) : L(`${u.username} 사용`, `Enable ${u.username}`)}
                            onClick={() => setEnabled([u], !on)}><span /></button>
                        </td>
                        <td className="vt-actions">
                          <button type="button" className="vt-link" onClick={() => setEditing(u)}>{L('편집', 'Edit')}</button>
                          {!ext && <button type="button" className="vt-link" onClick={() => setPwFor(u)}>{L('비밀번호 재설정', 'Reset password')}</button>}
                          <Drop className="vt-more" label={<>{L('더보기', 'More')}<Caret /></>}>
                            {(close) => (
                              <>
                                <Link role="menuitem" to={`/admin/users/access/${encodeURIComponent(u.username)}`} onClick={close}>{L('유효 권한 보기', 'Effective access')}</Link>
                                <button type="button" role="menuitem" disabled={!u.totp_enabled} onClick={() => {
                                  close();
                                  if (window.confirm(L(`${u.username}의 2단계 인증을 초기화할까요? 인증 앱을 다시 등록해야 합니다.`, `Reset two-step sign-in for ${u.username}? They enrol their app again.`)))
                                    void each([u], L('2단계 인증 초기화', 'Two-step reset'), (x) => usersApi.reset2fa(x.username));
                                }}>{L('2단계 인증 초기화', 'Reset two-step sign-in')}</button>
                                {lockedSet.has(u.username) && <button type="button" role="menuitem" onClick={() => { close(); void each([u], L('잠금 해제', 'Unlock'), (x) => usersApi.unlock(x.username)); }}>{L('잠금 해제', 'Unlock')}</button>}
                                <hr className="vt-sep" />
                                <button type="button" role="menuitem" className="danger" disabled={self} onClick={() => { close(); remove([u]); }}>{L('삭제', 'Delete')}</button>
                              </>
                            )}
                          </Drop>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="vt-pager">
              <span className="muted small">{L(`총 ${rows.length}명`, `${rows.length} total`)}{rows.length !== all.length ? L(` (전체 ${all.length}명)`, ` (of ${all.length})`) : ''}</span>
              <select className="vt-size" value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label={L('페이지당', 'Per page')}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{L(`${n}명씩`, `${n} / page`)}</option>)}
              </select>
              <Pager page={cur} pages={pages} onPage={setPage} />
            </div>
          </>
        )}
      </LoadState>

      {editing && <AccountDialog account={editing === 'new' ? null : editing} roles={roleList} deps={depList} self={editing !== 'new' && editing.username === me?.username}
        onClose={() => setEditing(null)} onDone={(text) => { setEditing(null); setNotice({ kind: 'info', text }); reload(); }} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={(text) => { setImporting(false); setNotice({ kind: 'info', text }); reload(); }} />}
      {pwFor && <PasswordDialog account={pwFor} onClose={() => setPwFor(null)} onDone={(text) => { setPwFor(null); setNotice({ kind: 'info', text }); reload(); }} />}
      {depFor && <DepDialog deps={depList} count={chosen.length} onClose={() => setDepFor(false)} onSave={(id) => {
        setDepFor(false);
        const name = id ? depName(id) : L('부서 없음', 'no department');
        if (!window.confirm(L(`${chosen.length}명의 부서를 '${name}'(으)로 바꿀까요?`, `Move ${chosen.length} to '${name}'?`))) return;
        void each(chosen, L(`부서 '${name}' 지정`, `department '${name}'`), (u) => usersApi.update(u.username, { department_id: id }));
      }} />}
    </>
  );
}

function DesksOf({ username }: { username: string }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const a = useLoad(useCallback(() => adminApi.userAccess(username), [username]), [username]);
  return (
    <div className="ut-desk-list">
      <p className="vt-menu-note">{L(`${username}의 데스크톱`, `Desktops of ${username}`)}</p>
      <LoadState value={a} retry={a.reload}>
        {(x) => x.desktops.length === 0 ? <p className="vt-menu-note">{L('없음', 'None')}</p> : (
          <>{x.desktops.map((d) => (
            <Link key={d.id} role="menuitem" to={`/admin/vms/desktops/list?vm=${encodeURIComponent(d.id)}`}>
              <span className="strong">{d.name}</span><span className="muted small">{d.pool} · {d.vmid}</span>
            </Link>
          ))}</>
        )}
      </LoadState>
    </div>
  );
}

function DepDialog({ deps, count, onClose, onSave }: { deps: Department[]; count: number; onClose: () => void; onSave: (id: string | null) => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [id, setId] = useState(deps[0]?.id ?? '');
  return (
    <Modal title={L(`부서 지정 · ${count}명`, `Set department · ${count}`)} onClose={onClose}
      actions={<><button type="button" className="btn" onClick={onClose}>{L('취소', 'Cancel')}</button>
        <button type="button" className="btn primary" onClick={() => onSave(id || null)}>{L('지정', 'Set')}</button></>}>
      <label className="vt-field">{L('부서', 'Department')}
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          <option value="">{L('부서 없음', 'No department')}</option>
        </select>
      </label>
    </Modal>
  );
}

