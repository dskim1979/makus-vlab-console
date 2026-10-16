import { useState } from 'react';
import { adminApi } from '../../api/admin';
import { nextApi } from '../../api/next';
import type { Grant, GrantType } from '../../api/next';
import type { Pool } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// 이용 권한: who may claim a desktop from this pool (dedicated) or be routed into it (shared):
// single users, departments (optionally with their sub-departments) and AD/LDAP groups.
export function PoolGrantsPanel({ pool }: { pool: Pool }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const data = useLoad(() => nextApi.poolGrants(pool.id), [pool.id]);
  const deps = useLoad(nextApi.departments);
  const [editing, setEditing] = useState(false);
  const depName = (id: string) => (deps.state === 'ok' ? deps.data.find((d) => d.id === id)?.name : undefined) ?? id;
  const grants = data.state === 'ok' ? data.data.grants : [];
  const shared = pool.type === 'shared';
  const label = (g: Grant) => g.subject_type === 'department' ? depName(g.subject_id) + (g.include_children ? L(' (하위 포함)', ' (with sub)') : '')
    : g.subject_type === 'group' ? (g.subject_id.match(/^CN=([^,]+)/i)?.[1] ?? g.subject_id) : g.subject_id;
  const KIND: Record<GrantType, string> = { user: L('사용자', 'User'), department: L('부서', 'Dept'), group: L('그룹', 'Group') };

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="stat-icon tone-green"><Icon name="shield" size={18} /></span>
        <div>
          <h2 className="section-title">{L('이용 권한', 'Who may use it')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{shared
            ? L(`여기 적힌 사람은 포털에서 이 풀로 바로 연결됩니다. 데스크톱 한 대에 최대 ${data.state === 'ok' ? data.data.max_sessions : 10}명.`, `People listed here connect to this pool from the portal; at most ${data.state === 'ok' ? data.data.max_sessions : 10} per desktop.`)
            : L('여기 적힌 사람은 포털에서 이 풀의 데스크톱을 하나 받을 수 있습니다. 관리자가 직접 배정할 필요가 없습니다.', 'People listed here can get a desktop from this pool in the portal, without an admin assigning one.')}</p>
          <div className="grant-chips">
            {grants.length === 0 ? <span className="muted small">{L('아직 없음 (관리자 배정만)', 'Nobody yet (admin assignment only)')}</span>
              : grants.map((g) => <span key={g.subject_type + g.subject_id} className="chip"><span className="muted">{KIND[g.subject_type]}</span> {label(g)}</span>)}
          </div>
        </div>
        <div className="panel-actions"><button type="button" className="btn" onClick={() => setEditing(true)} disabled={data.state !== 'ok'}>{L('권한 편집', 'Edit')}</button></div>
      </div>
      {editing && data.state === 'ok' && (
        <GrantsDialog pool={pool} initial={data.data.grants} maxSessions={data.data.max_sessions} deps={deps.state === 'ok' ? deps.data : []}
          onClose={() => setEditing(false)} onDone={() => { setEditing(false); data.reload(); }} />
      )}
    </section>
  );
}

function GrantsDialog({ pool, initial, maxSessions, deps, onClose, onDone }: {
  pool: Pool; initial: Grant[]; maxSessions: number; deps: { id: string; name: string }[]; onClose: () => void; onDone: () => void;
}) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const users = useLoad(adminApi.allUsers);
  const [list, setList] = useState<Grant[]>(initial);
  const [type, setType] = useState<GrantType>('department');
  const [subject, setSubject] = useState('');
  const [children, setChildren] = useState(true);
  const [max, setMax] = useState(maxSessions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shared = pool.type === 'shared';

  function add() {
    const id = subject.trim();
    if (!id || list.some((g) => g.subject_type === type && g.subject_id === id)) return;
    setList([...list, { subject_type: type, subject_id: id, include_children: type === 'department' ? children : false }]);
    setSubject('');
  }
  async function submit() {
    setBusy(true); setError(null);
    try { await nextApi.savePoolGrants(pool.id, list, shared ? max : undefined); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const name = (g: Grant) => g.subject_type === 'department' ? deps.find((d) => d.id === g.subject_id)?.name ?? g.subject_id : g.subject_id;

  return (
    <Dialog open title={L(`${pool.name} 이용 권한`, `${pool.name}: who may use it`)} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy} error={error}>
      <div className="form-row form-row-wide">
        <label><span>{L('종류', 'Kind')}</span>
          <select id="gr-type" value={type} onChange={(e) => { setType(e.target.value as GrantType); setSubject(''); }}>
            <option value="department">{L('부서', 'Department')}</option>
            <option value="group">{L('AD/LDAP 그룹', 'AD/LDAP group')}</option>
            <option value="user">{L('사용자', 'User')}</option>
          </select></label>
        <label><span>{type === 'department' ? L('부서', 'Department') : type === 'group' ? L('그룹 (DN 또는 이름)', 'Group (DN or name)') : L('사용자', 'User')}</span>
          {type === 'department' ? (
            <select id="gr-subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">{L('고르세요', 'Pick one')}</option>
              {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          ) : type === 'user' ? (
            <select id="gr-subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">{L('고르세요', 'Pick one')}</option>
              {(users.state === 'ok' ? users.data : []).map((u) => <option key={u.username} value={u.username}>{u.display_name || u.username} ({u.username})</option>)}
            </select>
          ) : <input id="gr-subject" value={subject} placeholder="CN=Lab-Users,OU=Groups,DC=example,DC=com" onChange={(e) => setSubject(e.target.value)} />}
        </label>
      </div>
      {type === 'department' && <label className="check"><input type="checkbox" checked={children} onChange={(e) => setChildren(e.target.checked)} /><span>{L('하위 부서도 포함', 'Include sub-departments')}</span></label>}
      <button type="button" className="btn small-btn" disabled={!subject.trim()} onClick={add}><Icon name="plus" size={14} />{L('추가', 'Add')}</button>
      <ul className="grant-list">
        {list.length === 0 && <li className="muted small">{L('권한이 없으면 관리자가 배정한 사람만 씁니다.', 'With nobody listed, only people an admin assigns can use it.')}</li>}
        {list.map((g, i) => (
          <li key={g.subject_type + g.subject_id}>
            <span className="chip">{g.subject_type === 'department' ? L('부서', 'Dept') : g.subject_type === 'group' ? L('그룹', 'Group') : L('사용자', 'User')}</span>
            <span className="grant-name">{name(g)}{g.subject_type === 'department' && g.include_children ? L(' · 하위 포함', ' · with sub') : ''}</span>
            <button type="button" className="btn-ghost small-btn danger" onClick={() => setList(list.filter((_, j) => j !== i))}>{L('빼기', 'Remove')}</button>
          </li>
        ))}
      </ul>
      {shared && <label><span>{L('데스크톱 한 대당 최대 접속', 'Most sessions per desktop')}</span>
        <input id="gr-max" type="number" min={1} max={200} value={max} onChange={(e) => setMax(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} /></label>}
    </Dialog>
  );
}
