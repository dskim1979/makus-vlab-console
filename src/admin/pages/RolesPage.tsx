import { useMemo, useState } from 'react';
import { usersApi, type Account, type Permission, type Role, type RoleTemplate } from '../../api/users';
import { Dialog } from '../../components/Dialog';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { roleLabel } from './UsersPage';

// 사용자 > 역할 관리: the built-in roles and the custom ones - a name and a set of permissions
// ticked by category (engine /api/vlab/admin/roles, /permissions, /roles/templates).

function useL() {
  const { pick } = useI18n();
  return (ko: string, en: string) => pick({ ko, en });
}
const errText = (e: unknown) => (e as Error).message;

const CATEGORIES: Record<string, [string, string]> = {
  vlab: ['MOAVI Desk (데스크톱·풀·가속 자원)', 'MOAVI Desk (desktops, pools, accelerators)'],
  vm: ['가상머신', 'Virtual machines'], storage: ['스토리지', 'Storage'], node: ['노드', 'Nodes'], cluster: ['클러스터', 'Clusters'],
  backup: ['백업', 'Backup'], pbs: ['Proxmox Backup Server', 'Proxmox Backup Server'], ha: ['고가용성(HA)', 'High availability'],
  admin: ['관리', 'Administration'], security: ['보안', 'Security'], pool: ['리소스 풀', 'Resource pools'], firewall: ['방화벽', 'Firewall'],
  replication: ['복제', 'Replication'], site_recovery: ['사이트 복구', 'Site recovery'], alert: ['경보', 'Alerts'], ceph: ['Ceph', 'Ceph'],
  sdn: ['SDN', 'SDN'], metrics: ['지표', 'Metrics'], update: ['업데이트', 'Updates'], plugins: ['플러그인', 'Plugins'],
  autoinstall: ['자동 설치', 'Automated installs'], xapi: ['XCP-ng', 'XCP-ng'], vmware: ['VMware', 'VMware'],
};
const ORDER = Object.keys(CATEGORIES);

export function RolesPage() {
  const { t } = useI18n();
  const L = useL();
  const roles = useLoad(usersApi.roles);
  const perms = useLoad(usersApi.permissions);
  const templates = useLoad(() => usersApi.templates().catch(() => [] as RoleTemplate[]));
  const users = useLoad(() => usersApi.list().catch(() => [] as Account[]));
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const holders = useMemo(() => {
    const n: Record<string, number> = {};
    for (const u of users.state === 'ok' ? users.data : []) n[u.role] = (n[u.role] ?? 0) + 1;
    return n;
  }, [users]);

  async function remove(r: Role) {
    if (!confirm(L(`'${r.name}' 역할을 지울까요?`, `Delete the role '${r.name}'?`))) return;
    setNotice(null);
    try { await usersApi.deleteRole(r.id, r.scope === 'tenant' ? r.tenant_id : undefined); setNotice({ kind: 'info', text: L('역할을 지웠습니다.', 'Role deleted.') }); roles.reload(); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }

  return (
    <>
      <p className="muted small page-intro">{L('필요한 권한만 묶은 역할을 만들어 사용자에게 줍니다.',
        'Make roles with just the permissions needed and give them to users.')}</p>
      <HowTo><ul>
        <li>{L('기본 역할(관리자 · 사용자 · 조회 전용)은 바꿀 수 없습니다.', 'The built-in roles (administrator, user, read-only) cannot change.')}</li>
        <li>{L('자기 권한보다 넓은 역할은 만들 수 없습니다.', 'Nobody can make a role wider than their own permissions.')}</li>
      </ul></HowTo>
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('역할 만들기', 'Add role')}</button>
        <button type="button" className="btn" onClick={() => { roles.reload(); users.reload(); }}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
      <LoadState value={roles} retry={roles.reload}>
        {(list) => (
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{L('역할', 'Role')}</th><th>ID</th><th>{L('범위', 'Scope')}</th><th className="num">{L('권한', 'Permissions')}</th>
                <th className="num">{L('사용자', 'Users')}</th><th />
              </tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={`${r.tenant_id ?? ''}/${r.id}`}>
                    <td className="strong">{roleLabel(t, r.id, list)}{r.builtin && <span className="chip chip-free chip-gap">{L('기본', 'Built-in')}</span>}</td>
                    <td className="muted">{r.id}</td>
                    <td>{r.scope === 'tenant' ? L(`테넌트 ${r.tenant_id}`, `Tenant ${r.tenant_id}`) : L('전체', 'Global')}</td>
                    <td className="num">{r.permissions.length}</td>
                    <td className="num">{holders[r.id] ?? 0}</td>
                    <td className="actions">
                      <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(r)}>{r.builtin ? L('보기', 'View') : t('common.edit')}</button>
                      {!r.builtin && <button type="button" className="btn-ghost small-btn danger" onClick={() => remove(r)}>{t('common.delete')}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </LoadState>
      {editing && (
        <LoadState value={perms} retry={perms.reload}>
          {(all) => <RoleDialog role={editing === 'new' ? null : editing} perms={all} templates={templates.state === 'ok' ? templates.data : []}
            onClose={() => setEditing(null)} onDone={(text) => { setEditing(null); setNotice({ kind: 'info', text }); roles.reload(); }} />}
        </LoadState>
      )}
    </>
  );
}

function RoleDialog({ role, perms, templates, onClose, onDone }: {
  role: Role | null; perms: Permission[]; templates: RoleTemplate[]; onClose: () => void; onDone: (text: string) => void;
}) {
  const { pick } = useI18n();
  const L = useL();
  const [id, setId] = useState(role?.id ?? '');
  const [name, setName] = useState(role?.name ?? '');
  const [sel, setSel] = useState<Set<string>>(new Set(role?.permissions ?? ['vlab.desk']));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = !!role?.builtin;

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const by: Record<string, Permission[]> = {};
    for (const p of perms) {
      if (needle && !`${p.permission} ${p.description}`.toLowerCase().includes(needle)) continue;
      (by[p.category] ??= []).push(p);
    }
    return Object.entries(by).sort(([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  }, [perms, q]);

  function toggle(names: string[], on: boolean) {
    setSel((s) => { const n = new Set(s); for (const x of names) { if (on) n.add(x); else n.delete(x); } return n; });
  }
  async function submit() {
    setBusy(true); setError(null);
    const permissions = perms.map((p) => p.permission).filter((p) => sel.has(p));
    try {
      if (role) {
        await usersApi.updateRole(role.id, { name: name.trim() || role.id, permissions, ...(role.scope === 'tenant' && role.tenant_id ? { tenant_id: role.tenant_id } : {}) });
        onDone(L('역할을 저장했습니다.', 'Role saved.'));
      } else {
        await usersApi.createRole({ id: id.trim().toLowerCase(), name: name.trim() || id.trim(), permissions });
        onDone(L('역할을 만들었습니다.', 'Role created.'));
      }
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  const idOk = /^[a-z0-9_-]{2,40}$/.test(id.trim().toLowerCase()) && !['admin', 'user', 'viewer'].includes(id.trim().toLowerCase());
  const title = role ? (readOnly ? L(`${role.name} (기본 역할)`, `${role.name} (built-in)`) : L(`${role.name} 수정`, `Edit ${role.name}`)) : L('역할 만들기', 'Add role');

  return (
    <Dialog open wide title={title} onClose={onClose} onSubmit={readOnly ? undefined : submit} busy={busy || (!role && !idOk)} error={error}
      submitLabel={role ? L('저장', 'Save') : L('만들기', 'Create')}>
      {readOnly && <div className="alert info small">{L('기본 역할은 바꿀 수 없습니다. 비슷한 역할이 필요하면 새로 만드세요.', 'Built-in roles cannot change. Make a new one if you need something similar.')}</div>}
      {!readOnly && (
        <div className="form-row form-row-even">
          <label><span>{L('역할 ID', 'Role ID')}</span>
            <input id="role-id" value={id} disabled={!!role} maxLength={40} placeholder="lab_assistant" autoFocus={!role} onChange={(e) => setId(e.target.value)} />
            {!role && <small className="muted">{L('영문 소문자 · 숫자 · _ · - (나중에 바꿀 수 없음)', 'Lower-case letters, digits, _ and - (cannot change later)')}</small>}
          </label>
          <label><span>{L('이름', 'Name')}</span><input id="role-name" value={name} maxLength={80} placeholder={L('예: 조교', 'e.g. Lab assistant')} onChange={(e) => setName(e.target.value)} /></label>
        </div>)}
      {!role && templates.length > 0 && (
        <label><span>{L('템플릿에서 시작', 'Start from a template')}</span>
          <select id="role-template" defaultValue="" onChange={(e) => {
            const tpl = templates.find((x) => x.id === e.target.value);
            if (tpl) { setSel(new Set(tpl.permissions)); if (!name) setName(tpl.name); }
          }}>
            <option value="">{L('선택 안 함', 'None')}</option>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.permission_count}) — {x.description}</option>)}
          </select>
        </label>)}
      <div className="perm-head">
        <input type="search" placeholder={L('권한 검색', 'Search permissions')} aria-label={L('권한 검색', 'Search permissions')} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{L(`${sel.size}개 선택`, `${sel.size} selected`)}</span>
      </div>
      <div className="perm-groups">
        {groups.map(([cat, list]) => {
          const on = list.filter((p) => sel.has(p.permission)).length;
          const label = CATEGORIES[cat] ? pick({ ko: CATEGORIES[cat][0], en: CATEGORIES[cat][1] }) : cat;
          return (
            <details key={cat} className="perm-group" open={!!q || cat === 'vlab' || (on > 0 && on < list.length)}>
              <summary>
                <input type="checkbox" aria-label={label} disabled={readOnly} checked={on === list.length}
                  ref={(el) => { if (el) el.indeterminate = on > 0 && on < list.length; }}
                  onClick={(e) => e.stopPropagation()} onChange={(e) => toggle(list.map((p) => p.permission), e.target.checked)} />
                <span className="strong">{label}</span><span className="muted small">{on}/{list.length}</span>
              </summary>
              <div className="perm-list">
                {list.map((p) => (
                  <label key={p.permission} className="check perm-item">
                    <input type="checkbox" disabled={readOnly} checked={sel.has(p.permission)} onChange={(e) => toggle([p.permission], e.target.checked)} />
                    <span><code>{p.permission}</code> <span className="muted">{p.description}</span>
                      {p.warning && sel.has(p.permission) && <small className="perm-warn">{p.warning}</small>}</span>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </Dialog>
  );
}
