import { useState } from 'react';
import type { Department } from '../../api/next';
import { externalSource, usersApi, type Account, type Role } from '../../api/users';
import { Dialog } from '../../components/Dialog';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';

export function roleLabel(t: (k: MessageKey) => string, role: string, roles?: Role[]) {
  if (['admin', 'user', 'viewer'].includes(role)) return t(`role.${role}` as MessageKey);
  return roles?.find((r) => r.id === role)?.name || role;
}

function useL() {
  const { pick } = useI18n();
  return (ko: string, en: string) => pick({ ko, en });
}
const errText = (e: unknown) => (e as Error).message;
export const SOURCES: Record<string, string> = { local: 'Local', ldap: 'AD/LDAP', oidc: 'OIDC', entra: 'Entra ID' };

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
      {generate && <button type="button" className="btn small-btn" onClick={() => onChange(makePassword())}>{L('자동 생성', 'Generate')}</button>}
    </div>
  );
}

export function daysLeft(day?: string | null) {
  if (!day) return null;
  const end = new Date(`${day}T00:00:00`).getTime();
  const today = new Date(new Date().toDateString()).getTime();
  return Math.round((end - today) / 864e5);
}

export function ExpiryCell({ account }: { account: Account }) {
  const L = useL();
  if (!account.expires_at) return <span className="muted">-</span>;
  const left = daysLeft(account.expires_at)!;
  return (
    <>
      {account.expires_at}
      {account.expired ? <span className="chip chip-off chip-gap">{L('만료됨', 'Expired')}</span>
        : left <= 7 ? <span className="chip chip-warn chip-gap">D-{left}</span>
        : left <= 30 ? <span className="chip chip-free chip-gap">D-{left}</span> : null}
    </>
  );
}

export function AccountDialog({ account, roles, deps, self, onClose, onDone }: {
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
  const [until, setUntil] = useState(account?.expires_at ?? '');
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
          ...(name.trim() ? { display_name: name.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}), ...(dep ? { department_id: dep } : {}),
          ...(until && role !== 'admin' ? { expires_at: until } : {}) });
        onDone(L(`${username.trim().toLowerCase()} 계정을 만들었습니다.`, `${username.trim().toLowerCase()} created.`));
      } else {
        const b: Parameters<typeof usersApi.update>[1] = {};
        if (name !== account.display_name) b.display_name = name.trim();
        if (email !== (account.email ?? '')) b.email = email.trim();
        if (role !== account.role) b.role = role;
        if (enabled !== (account.enabled !== false)) b.enabled = enabled;
        if (dep !== (account.department_id ?? '')) b.department_id = dep || null;
        if (until !== (account.expires_at ?? '')) b.expires_at = until || null;
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
      <label><span>{L('사용 기한 (선택)', 'Last day of use (optional)')}</span>
        <input id="acc-until" type="date" value={until} disabled={role === 'admin'} onChange={(e) => setUntil(e.target.value)} />
        <small className="muted">{role === 'admin' ? L('관리자 계정은 기한을 두지 않습니다.', 'Administrator accounts do not expire.')
          : L('이 날이 지나면 로그인이 막히고 배정된 데스크톱이 회수됩니다(플랫폼 설정 > 계정 · 약관). 비우면 기한 없음.', 'After this day the account cannot sign in and its desktops are taken back (Platform settings > Accounts and terms). Empty: no limit.')}</small>
        {account?.expired && <small className="muted">{L('만료된 계정입니다. 앞으로의 날짜를 넣으면 다시 쓸 수 있습니다.', 'Expired. A day still to come makes it usable again.')}</small>}
      </label>
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

export function PasswordDialog({ account, onClose, onDone }: { account: Account; onClose: () => void; onDone: (text: string) => void }) {
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
