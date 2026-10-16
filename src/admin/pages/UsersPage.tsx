import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { nextApi, type Department } from '../../api/next';
import { externalSource, usersApi, type Account, type LockedAccount, type Role } from '../../api/users';
import { useAuth } from '../../auth/AuthContext';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { relativeTime } from '../../portal/DesktopCard';

export function roleLabel(t: (k: MessageKey) => string, role: string, roles?: Role[]) {
  if (['admin', 'user', 'viewer'].includes(role)) return t(`role.${role}` as MessageKey);
  return roles?.find((r) => r.id === role)?.name || role;
}

function useL() {
  const { pick } = useI18n();
  return (ko: string, en: string) => pick({ ko, en });
}
const errText = (e: unknown) => (e as Error).message;
const SOURCES: Record<string, string> = { local: 'Local', ldap: 'AD/LDAP', oidc: 'OIDC', entra: 'Entra ID' };

// a password the default policy accepts: upper, lower, digit, symbol, 14 long
export function makePassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!#%+=?@'];
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const out = sets.map(pick);
  while (out.length < 14) out.push(pick(sets.join('')));
  return out.sort(() => crypto.getRandomValues(new Uint8Array(1))[0] - 128).join('');
}

export function PasswordInput({ id, value, onChange, generate, autoComplete = 'new-password' }: {
  id: string; value: string; onChange: (v: string) => void; generate?: boolean; autoComplete?: string;
}) {
  const L = useL();
  const [show, setShow] = useState(false);
  return (
    <div className="pw-input">
      <input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="btn-ghost small-btn" onClick={() => setShow((s) => !s)}>{show ? L('숨기기', 'Hide') : L('보기', 'Show')}</button>
      {generate && <button type="button" className="btn small-btn" onClick={() => { onChange(makePassword()); setShow(true); }}>{L('자동 생성', 'Generate')}</button>}
    </div>
  );
}

// ⋯ menu of a table row; fixed position so the table's scroll box does not clip it
function RowMenu({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => { if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setAt(null); };
    const gone = () => setAt(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', gone, true);
    window.addEventListener('resize', gone);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', gone, true); window.removeEventListener('resize', gone); };
  }, [at]);
  // below the button, or above it when it would run off the bottom
  useLayoutEffect(() => {
    if (!at || !box.current || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = box.current.offsetHeight;
    const top = r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - 4 - h) : r.bottom + 4;
    if (top !== at.top) setAt({ ...at, top });
  }, [at]);
  function toggle() {
    if (at) { setAt(null); return; }
    const r = btn.current!.getBoundingClientRect();
    setAt({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }
  return (
    <>
      <button ref={btn} type="button" className="btn-ghost small-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={!!at} onClick={toggle}>
        <Icon name="more" size={16} />
      </button>
      {at && <div ref={box} className="menu row-menu" role="menu" style={{ position: 'fixed', top: at.top, right: at.right }}>{children(() => setAt(null))}</div>}
    </>
  );
}

type Notice = { kind: 'info' | 'error'; text: string } | null;

// 사용자 > 사용자 목록: accounts of the caller's tenant - make, change, delete, reset a password
// or two-step sign-in, unlock; with their desktops and last connect.
export function UsersPage() {
  const { t, lang } = useI18n();
  const L = useL();
  const { user: me } = useAuth();
  const users = useLoad(usersApi.list);
  const roles = useLoad(() => usersApi.roles().catch(() => [] as Role[]));
  const deps = useLoad(() => nextApi.departments().catch(() => [] as Department[]));
  const locked = useLoad(() => usersApi.locked().catch(() => [] as LockedAccount[]));
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [source, setSource] = useState('');
  const [showDisabled, setShowDisabled] = useState(false);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [pwFor, setPwFor] = useState<Account | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const roleList = roles.state === 'ok' ? roles.data : [];
  const depList = deps.state === 'ok' ? deps.data : [];
  const lockedList = locked.state === 'ok' ? locked.data : [];
  const lockedSet = new Set(lockedList.map((x) => x.username));
  const all = users.state === 'ok' ? users.data : [];
  const sources = useMemo(() => [...new Set(all.map((u) => u.auth_source || 'local'))].sort(), [all]);
  const usedRoles = useMemo(() => [...new Set([...roleList.map((r) => r.id), ...all.map((u) => u.role)])], [roleList, all]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((u) => (showDisabled || u.enabled !== false) &&
      (!role || u.role === role) && (!source || (u.auth_source || 'local') === source) &&
      (!needle || [u.username, u.display_name, u.email ?? ''].some((s) => s.toLowerCase().includes(needle))));
  }, [all, q, role, source, showDisabled]);

  function reload() { users.reload(); locked.reload(); }
  async function act(fn: () => Promise<void>, done: string) {
    setNotice(null);
    try { await fn(); setNotice({ kind: 'info', text: done }); reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  const depName = (id?: string | null) => (id ? depList.find((d) => d.id === id)?.name ?? '' : '');

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('사용자 만들기', 'Add user')}</button>
        <input type="search" placeholder={t('common.search')} aria-label={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('users.role')} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">{L('모든 역할', 'All roles')}</option>
          {usedRoles.map((r) => <option key={r} value={r}>{roleLabel(t, r, roleList)}</option>)}
        </select>
        <select aria-label={t('users.source')} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">{L('모든 출처', 'All sources')}</option>
          {sources.map((s) => <option key={s} value={s}>{SOURCES[s] ?? s.toUpperCase()}</option>)}
        </select>
        <label className="check-inline">
          <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} />
          <span>{t('users.showDisabled')}</span>
        </label>
        <button type="button" className="btn" onClick={reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
      </div>
      <p className="muted small">{t('users.note')}</p>
      {lockedList.length > 0 && (
        <div className="alert locked-bar" role="status">
          <Icon name="shield" size={16} />
          <span>{L(`로그인 실패로 잠긴 계정 ${lockedList.length}개`, `${lockedList.length} account(s) locked after failed sign-ins`)}:</span>
          {lockedList.map((x) => (
            <span key={x.username} className="locked-item">
              <span className="strong">{x.username}</span>
              <span className="muted small">{L(`${Math.ceil(x.remaining_seconds / 60)}분 남음`, `${Math.ceil(x.remaining_seconds / 60)} min left`)}</span>
              <button type="button" className="btn small-btn" onClick={() => act(() => usersApi.unlock(x.username), L(`${x.username} 잠금을 풀었습니다.`, `${x.username} unlocked.`))}>{L('잠금 해제', 'Unlock')}</button>
            </span>
          ))}
        </div>
      )}
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
      <LoadState value={users} retry={users.reload}>
        {() => rows.length === 0 ? <div className="empty"><p>{t('users.empty')}</p></div> : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('users.username')}</th><th>{t('users.name')}</th><th>{t('users.role')}</th><th>{L('부서', 'Department')}</th>
                  <th>{t('users.source')}</th><th className="num">{t('users.desktops')}</th><th>{t('portal.lastConnected')}</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const ext = externalSource(u.auth_source);
                  const self = u.username === me?.username;
                  return (
                    <tr key={u.username} className={u.enabled === false ? 'row-off' : ''}>
                      <td className="strong">
                        {u.username}
                        {u.enabled === false && <span className="chip chip-off">{t('users.disabled')}</span>}
                        {lockedSet.has(u.username) && <span className="chip chip-warn chip-gap">{L('잠김', 'Locked')}</span>}
                        {u.totp_enabled && <span className="chip chip-on chip-gap" title={L('2단계 인증 사용 중', 'Two-step sign-in on')}>2FA</span>}
                        {u.must_change_password && <span className="chip chip-free chip-gap" title={L('다음 로그인 때 비밀번호를 바꿔야 합니다', 'Must change the password at next sign-in')}>{L('비밀번호 변경 대기', 'New password due')}</span>}
                      </td>
                      <td>{u.display_name}{u.email && <div className="muted small">{u.email}</div>}</td>
                      <td>{roleLabel(t, u.role, roleList)}</td>
                      <td>{depName(u.department_id) || <span className="muted">-</span>}</td>
                      <td><span className="chip">{SOURCES[u.auth_source] ?? u.auth_source.toUpperCase()}</span></td>
                      <td className="num">{u.desktops ?? 0}</td>
                      <td>{relativeTime(u.last_connected, lang) ?? <span className="muted">{t('portal.never')}</span>}</td>
                      <td className="actions">
                        <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(u)}>{t('common.edit')}</button>
                        <RowMenu label={L('더 보기', 'More')}>
                          {(close) => <>
                            <Link role="menuitem" to={`/admin/users/access/${encodeURIComponent(u.username)}`} onClick={close}><Icon name="search" size={16} />{t('users.access')}</Link>
                            {!ext && <button type="button" role="menuitem" onClick={() => { close(); setPwFor(u); }}><Icon name="shield" size={16} />{L('비밀번호 초기화', 'Reset password')}</button>}
                            <button type="button" role="menuitem" disabled={!u.totp_enabled} onClick={() => {
                              close();
                              if (confirm(L(`${u.username}의 2단계 인증을 초기화할까요? 다음 로그인은 비밀번호만으로 하고, 인증 앱을 다시 등록해야 합니다.`,
                                `Reset two-step sign-in for ${u.username}? They sign in with the password only and enrol their app again.`)))
                                act(() => usersApi.reset2fa(u.username), L('2단계 인증을 초기화했습니다.', 'Two-step sign-in reset.'));
                            }}><Icon name="clock" size={16} />{L('2단계 인증 초기화', 'Reset two-step sign-in')}</button>
                            {lockedSet.has(u.username) && <button type="button" role="menuitem" onClick={() => { close(); act(() => usersApi.unlock(u.username), L(`${u.username} 잠금을 풀었습니다.`, `${u.username} unlocked.`)); }}><Icon name="shield" size={16} />{L('잠금 해제', 'Unlock')}</button>}
                            <button type="button" role="menuitem" onClick={() => { close(); act(() => usersApi.update(u.username, { enabled: u.enabled === false }), u.enabled === false ? L('사용하도록 바꿨습니다.', 'Enabled.') : L('사용 중지했습니다. 열린 세션도 끝났습니다.', 'Disabled; open sessions ended.')); }} disabled={self}>
                              <Icon name="users" size={16} />{u.enabled === false ? L('사용하기', 'Enable') : L('사용 중지', 'Disable')}
                            </button>
                            <button type="button" role="menuitem" className="danger" disabled={self} onClick={() => {
                              close();
                              if (confirm(L(`${u.username} 계정을 지울까요? 열린 세션과 API 토큰도 끝납니다. 되돌릴 수 없습니다.${u.desktops ? `\n할당된 데스크톱이 ${u.desktops}대 있습니다.` : ''}`,
                                `Delete ${u.username}? Their sessions and API tokens end. This cannot be undone.${u.desktops ? `\nThey have ${u.desktops} assigned desktop(s).` : ''}`)))
                                act(() => usersApi.remove(u.username), L(`${u.username} 계정을 지웠습니다.`, `${u.username} deleted.`));
                            }}><Icon name="logout" size={16} />{t('common.delete')}</button>
                          </>}
                        </RowMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </LoadState>
      {editing && <AccountDialog account={editing === 'new' ? null : editing} roles={roleList} deps={depList} self={editing !== 'new' && editing.username === me?.username}
        onClose={() => setEditing(null)} onDone={(text) => { setEditing(null); setNotice({ kind: 'info', text }); reload(); }} />}
      {pwFor && <PasswordDialog account={pwFor} onClose={() => setPwFor(null)} onDone={(text) => { setPwFor(null); setNotice({ kind: 'info', text }); reload(); }} />}
    </>
  );
}

function AccountDialog({ account, roles, deps, self, onClose, onDone }: {
  account: Account | null; roles: Role[]; deps: Department[]; self: boolean; onClose: () => void; onDone: (text: string) => void;
}) {
  const { t } = useI18n();
  const L = useL();
  const [username, setUsername] = useState(account?.username ?? '');
  const [name, setName] = useState(account?.display_name ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [role, setRole] = useState(account?.role ?? 'user');
  const [dep, setDep] = useState(account?.department_id ?? '');
  const [enabled, setEnabled] = useState(account?.enabled !== false);
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ext = externalSource(account?.auth_source);
  const roleIds = roles.length ? roles.map((r) => r.id) : ['admin', 'user', 'viewer'];
  if (account && !roleIds.includes(account.role)) roleIds.push(account.role);

  async function submit() {
    setBusy(true); setError(null);
    try {
      if (!account) {
        await usersApi.create({ username: username.trim().toLowerCase(), password, role, must_change_password: mustChange,
          ...(name.trim() ? { display_name: name.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}), ...(dep ? { department_id: dep } : {}) });
        onDone(L(`${username.trim().toLowerCase()} 계정을 만들었습니다.`, `${username.trim().toLowerCase()} created.`));
      } else {
        const b: Parameters<typeof usersApi.update>[1] = {};
        if (name !== account.display_name) b.display_name = name.trim();
        if (email !== (account.email ?? '')) b.email = email.trim();
        if (role !== account.role) b.role = role;
        if (enabled !== (account.enabled !== false)) b.enabled = enabled;
        if (dep !== (account.department_id ?? '')) b.department_id = dep || null;
        if (Object.keys(b).length) await usersApi.update(account.username, b);
        onDone(L('저장했습니다.', 'Saved.'));
      }
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  const ready = account ? true : username.trim().length >= 3 && password.length > 0;
  return (
    <Dialog open title={account ? L(`${account.username} 수정`, `Edit ${account.username}`) : L('사용자 만들기', 'Add user')} onClose={onClose}
      onSubmit={submit} submitLabel={account ? t('common.save') : L('만들기', 'Create')} busy={busy || !ready} error={error}>
      {!account && (
        <label><span>{t('users.username')}</span>
          <input id="acc-username" autoFocus value={username} maxLength={64} autoComplete="off" placeholder={L('예: kim.minji', 'e.g. kim.minji')} onChange={(e) => setUsername(e.target.value)} />
          <small className="muted">{L('3자 이상, 소문자로 저장됩니다. 만든 뒤에는 바꿀 수 없습니다.', 'At least 3 characters, stored in lower case. It cannot change later.')}</small>
        </label>)}
      {account && ext && <div className="alert info small">{L(`${account.auth_source.toUpperCase()} 계정입니다. 비밀번호는 디렉터리에서 관리합니다.`, `A ${account.auth_source.toUpperCase()} account: the directory manages its password.`)}</div>}
      <div className="form-row form-row-even">
        <label><span>{t('users.name')}</span><input id="acc-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
        <label><span>{L('메일', 'Email')}</span><input id="acc-email" type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} /></label>
      </div>
      <div className="form-row form-row-even">
        <label><span>{t('users.role')}</span>
          <select id="acc-role" value={role} disabled={self} onChange={(e) => setRole(e.target.value)}>
            {roleIds.map((r) => <option key={r} value={r}>{roleLabel(t, r, roles)}</option>)}
          </select>
          {self && <small className="muted">{L('내 역할은 바꿀 수 없습니다.', 'You cannot change your own role.')}</small>}
        </label>
        <label><span>{L('부서', 'Department')}</span>
          <select id="acc-dep" value={dep} onChange={(e) => setDep(e.target.value)}>
            <option value="">{L('없음', 'None')}</option>
            {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>
      {!account && <>
        <label><span>{L('초기 비밀번호', 'Initial password')}</span>
          <PasswordInput id="acc-password" value={password} onChange={setPassword} generate />
          <small className="muted">{L('플랫폼 설정의 비밀번호 정책을 따릅니다. 만든 뒤 사용자에게 따로 알려 주세요.', 'Follows the password policy in Platform settings. Tell the user separately.')}</small>
        </label>
        <label className="check"><input id="acc-must-change" type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} /><span>{L('다음 로그인 때 비밀번호 변경', 'Change the password at next sign-in')}</span></label>
      </>}
      {account && (
        <label className="check"><input id="acc-enabled" type="checkbox" checked={enabled} disabled={self} onChange={(e) => setEnabled(e.target.checked)} />
          <span>{L('사용 (끄면 로그인할 수 없고 열린 세션이 끝납니다)', 'Enabled (off: no sign-in, open sessions end)')}</span></label>)}
    </Dialog>
  );
}

function PasswordDialog({ account, onClose, onDone }: { account: Account; onClose: () => void; onDone: (text: string) => void }) {
  const L = useL();
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      await usersApi.resetPassword(account.username, password, mustChange);
      onDone(L(`${account.username}의 비밀번호를 바꿨습니다. 열린 세션과 API 토큰은 끝났습니다.`, `Password of ${account.username} changed; their sessions and API tokens ended.`));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L(`${account.username} 비밀번호 초기화`, `Reset password of ${account.username}`)} onClose={onClose} onSubmit={submit}
      submitLabel={L('초기화', 'Reset')} busy={busy || !password} error={error}>
      <label><span>{L('새 비밀번호', 'New password')}</span><PasswordInput id="reset-password" value={password} onChange={setPassword} generate /></label>
      <label className="check"><input id="reset-must-change" type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} /><span>{L('다음 로그인 때 비밀번호 변경', 'Change the password at next sign-in')}</span></label>
      <p className="muted small">{L('이 계정의 열린 세션과 API 토큰이 모두 끝납니다.', 'Every open session and API token of this account ends.')}</p>
    </Dialog>
  );
}
