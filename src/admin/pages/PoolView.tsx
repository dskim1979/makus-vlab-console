import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { directoryApi, type DomainJoin } from '../../api/directory';
import { nextApi, type Grant, type GrantType } from '../../api/next';
import type { AdminDesktop, AssignableUser, Pool } from '../../api/types';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { relativeTime } from '../../portal/DesktopCard';
import { PoolDomainJoinPanel } from './BundledDirectory';
import { AddVmDialog, CloneDialog, JoinChip, JoinStates } from './PoolDetailPage';
import { PoolEditDialog } from './PoolEdit';
import { PoolGpuPanel } from './PoolGpu';
import { PoolPolicyPanel } from './PoolPolicy';
import { PoolNetIsoPanel, PoolNetSegPanel } from './PoolNetIso';
import { DeskChip } from './PoolTable';
import { PoolStoragePanel } from './PoolStorage';
import { Caret, Drop, Modal, Usage } from './TableKit';
import { useAdminConsole } from './VmManage';

// 데스크톱 풀 > 풀 > (풀): one toolbar, the pool's desktops on the left and who it is granted to on the right,
// the recent connections and audit entries below; policy, storage, domain join and GPU under 설정.

type Notice = { kind: 'info' | 'error'; text: string };
type View = 'desktops' | 'settings';

export function PoolDetailPage({ poolId }: { poolId: string }) {
  const { t, pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const pools = useLoad(adminApi.pools);
  const desks = useLoad(useCallback(() => adminApi.poolDesktops(poolId), [poolId]), [poolId]);
  const live = useLoad(() => adminApi.desktops().catch(() => [] as AdminDesktop[]));   // usage (CPU, memory)
  const grants = useLoad(useCallback(() => nextApi.poolGrants(poolId), [poolId]), [poolId]);
  const users = useLoad(adminApi.users);
  const dirOn = useLoad(() => Promise.all([
    directoryApi.get().then((d) => d.enabled).catch(() => false),
    adminApi.directory().then((d) => !!d.ldap_enabled).catch(() => false),
  ]).then(([a, b]) => a || b));
  const sessions = useLoad(useCallback(() => adminApi.sessions({ pool_id: poolId, limit: 200 }).catch(() => []), [poolId]), [poolId]);
  const [view, setView] = useState<View>('desktops');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [joinRows, setJoinRows] = useState<Record<string, DomainJoin>>({});
  const [dlg, setDlg] = useState<null | 'clone' | 'add' | 'edit' | GrantType>(null);
  const adminConsole = useAdminConsole(useCallback((text: string) => setNotice({ kind: 'error', text }), []));

  const provisioning = desks.state === 'ok' && desks.data.some((d) => d.state === 'provisioning');
  useEffect(() => {
    if (!provisioning) return undefined;
    const id = setInterval(desks.reload, 5000);
    return () => clearInterval(id);
  }, [provisioning, desks.reload]);

  const pool = pools.state === 'ok' ? pools.data.find((p) => p.id === poolId) : undefined;
  if (pools.state === 'ok' && !pool) return <div className="alert">{t('pool.notFound')} <Link to="/admin/pools/list">{t('common.back')}</Link></div>;

  const list = desks.state === 'ok' ? desks.data : [];
  const usage = new Map((live.state === 'ok' ? live.data : []).map((d) => [d.id, d.usage]));
  const missing = list.filter((d) => d.state === 'missing').length;
  const running = list.filter((d) => d.state === 'ready' || d.state === 'in_use').length;
  const resettable = pool?.type === 'reset' || pool?.type === 'classroom';
  const reload = () => { pools.reload(); desks.reload(); live.reload(); sessions.reload(); };

  async function run(fn: () => Promise<unknown>, ok: string) {
    setNotice(null);
    try { await fn(); setNotice({ kind: 'info', text: ok }); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    reload();
  }
  async function resetAll() {
    if (!pool || !window.confirm(t('reset.poolConfirm'))) return;
    try {
      const r = await adminApi.resetPool(pool.id);
      setNotice({ kind: r.failed.length ? 'error' : 'info', text: t('reset.done').replace('{done}', String(r.reset.length)).replace('{skipped}', String(r.skipped.length))
        .replace('{failed}', String(r.failed.length)) + (r.failed.length ? ` - ${r.failed.map((f) => `${f.name}: ${f.error}`).join(', ')}` : '') });
    } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    desks.reload();
  }
  async function prune() {
    if (!pool || !window.confirm(t('desk.pruneConfirm').replace('{n}', String(missing)))) return;
    void run(async () => { await adminApi.pruneDesktops(pool.id); }, t('desk.pruned').replace('{n}', String(missing)));
  }
  async function saveGrants(next: Grant[], text: string) {
    if (grants.state !== 'ok' || !pool) return;
    try {
      await nextApi.savePoolGrants(pool.id, next, pool.type === 'shared' ? grants.data.max_sessions : undefined);
      setNotice({ kind: 'info', text }); grants.reload(); pools.reload();
    } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
  }

  return (
    <div className="vd">
      <Link className="vd-back" to="/admin/pools/list"><Icon name="chevron" size={14} />{L('풀 목록', 'Pools')}</Link>
      {pool && (
        <section className="vd-head">
          <div className="vd-title">
            <span className={`vd-icon pv-icon pt-${pool.type}`} aria-hidden="true"><Icon name="pool" size={20} /></span>
            <h2 className="vd-name">{pool.name}</h2>
            <span className={`pt-type pt-${pool.type}`}>{t(`pooltype.${pool.type}` as MessageKey)}</span>
            {!pool.enabled && <span className="vt-st vt-st-offline">{L('중지됨', 'Disabled')}</span>}
            <div className="vd-actions">
              <button type="button" className="btn" onClick={() => setDlg('edit')}>{L('편집', 'Edit')}</button>
            </div>
          </div>
          <dl className="vd-strip">
            <div><dt>{L('데스크톱', 'Desktops')}</dt><dd className="vd-num">{pool.desktops}</dd></div>
            <div><dt>{L('배정', 'Assigned')}</dt><dd className="vd-num">{pool.assigned}</dd></div>
            <div><dt>{L('실행 중', 'Running')}</dt><dd className="vd-num">{running}</dd></div>
            <div><dt>{L('지금 접속', 'Connected')}</dt><dd className="vd-num">{sessions.state === 'ok' ? sessions.data.filter((s) => !s.ended_at).length : '-'}</dd></div>
            <div className="vd-wide"><dt>{L('설명', 'Description')}</dt><dd title={pool.description}>{pool.description || '-'}</dd></div>
          </dl>
          {!pool.enabled && <p className="muted small pv-off">{t('pool.offNote')}</p>}
        </section>
      )}

      <nav className="page-tabs vd-tabs" role="tablist">
        {([['desktops', L('데스크톱 · 권한', 'Desktops · access')], ['settings', L('설정', 'Settings')]] as [View, string][]).map(([id, label]) => (
          <a key={id} href="#" role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={(e) => { e.preventDefault(); setView(id); }}>{label}</a>
        ))}
      </nav>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}

      {view === 'settings' && pool && (
        <div className="vd-body">
          <PoolPolicyPanel pool={pool} onChanged={pools.reload} />
          <PoolNetIsoPanel pool={pool} />
          <PoolNetSegPanel pool={pool} />
          <PoolStoragePanel pool={pool} />
          <PoolDomainJoinPanel pool={pool} />
          <PoolGpuPanel pool={pool} onChanged={reload} />
        </div>
      )}

      {view === 'desktops' && pool && (
        <>
          <div className="vt-row pv-toolbar">
            <button type="button" className="btn" onClick={reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
            <Drop className="btn primary" align="left" label={<><Icon name="plus" size={16} />{L('데스크톱 추가', 'Add desktops')}<Caret /></>}>
              {(close) => (
                <>
                  <button type="button" role="menuitem" onClick={() => { close(); setDlg('clone'); }}>{L('템플릿에서 복제', 'Clone a template')}</button>
                  <button type="button" role="menuitem" onClick={() => { close(); setDlg('add'); }}>{L('기존 VM 넣기', 'Add an existing VM')}</button>
                </>
              )}
            </Drop>
            <span className="pv-sep" aria-hidden="true" />
            <button type="button" className="btn" disabled={grants.state !== 'ok'} onClick={() => setDlg('user')}><Icon name="users" size={16} />{L('사용자 추가', 'Add users')}</button>
            <button type="button" className="btn" disabled={grants.state !== 'ok'} onClick={() => setDlg('department')}>{L('부서 추가', 'Add department')}</button>
            {dirOn.state === 'ok' && dirOn.data && <button type="button" className="btn" disabled={grants.state !== 'ok'} onClick={() => setDlg('group')}>{L('그룹 추가', 'Add group')}</button>}
            <span className="vt-create vt-btns">
              {resettable && <button type="button" className="btn" onClick={resetAll}>{t('reset.pool')}</button>}
              {missing > 0 && <button type="button" className="btn danger" onClick={prune}>{t('desk.prune').replace('{n}', String(missing))}</button>}
            </span>
          </div>

          <div className="pv-split">
            <Desktops pool={pool} list={list} loaded={desks} usage={usage} joinRows={joinRows} sessions={sessions.state === 'ok' ? sessions.data : []}
              maxSessions={grants.state === 'ok' ? grants.data.max_sessions : null} users={users.state === 'ok' ? users.data : []}
              onConsole={(d) => adminConsole.start({ id: d.id, name: d.name })}
              onAct={run} />
            <Grants pool={pool} loaded={grants} onRemove={(g, label) => {
              if (grants.state !== 'ok' || !window.confirm(L(`'${label}'의 이용 권한을 뺄까요?`, `Remove access of '${label}'?`))) return;
              void saveGrants(grants.data.grants.filter((x) => !(x.subject_type === g.subject_type && x.subject_id === g.subject_id)), L(`'${label}'을(를) 뺐습니다.`, `Removed '${label}'.`));
            }} />
          </div>

          <Logs pool={pool} sessions={sessions} />
        </>
      )}
      <JoinStates poolId={poolId} tick={desks.state} onRows={setJoinRows} />

      {pool && dlg === 'edit' && <PoolEditDialog pool={pool} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); setNotice({ kind: 'info', text: t('pool.saved') }); reload(); }} />}
      {pool && dlg === 'clone' && <CloneDialog pool={pool} onClose={() => setDlg(null)} onDone={(n) => { setDlg(null); setNotice(n); reload(); }} />}
      {pool && dlg === 'add' && <AddVmDialog pool={pool} onClose={() => setDlg(null)} onAdded={() => { setDlg(null); reload(); }} />}
      {pool && (dlg === 'user' || dlg === 'department' || dlg === 'group') && grants.state === 'ok' && (
        <AddGrant kind={dlg} have={grants.data.grants} onClose={() => setDlg(null)} onSave={(g, label) => {
          setDlg(null);
          void saveGrants([...grants.data.grants, ...g], L(`${label}에게 이용 권한을 줬습니다.`, `Granted to ${label}.`));
        }} />
      )}
      {adminConsole.view}
    </div>
  );
}

function Desktops({ pool, list, loaded, usage, joinRows, sessions, maxSessions, users, onConsole, onAct }: {
  pool: Pool; list: AdminDesktop[]; loaded: Parameters<typeof LoadState>[0]['value']; usage: Map<string, AdminDesktop['usage']>;
  joinRows: Record<string, DomainJoin>; sessions: { desktop_id: string | null; ended_at: string | null }[]; maxSessions: number | null;
  users: AssignableUser[]; onConsole: (d: AdminDesktop) => void; onAct: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const { t, pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const multi = pool.type === 'shared' || pool.type === 'classroom';
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return list.filter((d) => (!state || (state === 'on' ? d.state === 'ready' || d.state === 'in_use' : d.state === state))
      && (!n || d.name.toLowerCase().includes(n) || String(d.vmid).startsWith(n) || (d.assigned_user ?? '').toLowerCase().includes(n)));
  }, [list, q, state]);
  const open = (id: string) => sessions.filter((s) => s.desktop_id === id && !s.ended_at).length;

  return (
    <section className="vd-card pv-desks">
      <header>
        <h3>{L('데스크톱', 'Desktops')} <span className="muted small">{list.length}</span></h3>
        <span className="vd-head-tools">
          <input type="search" className="pv-search" placeholder={L('이름 · VMID · 사용자', 'Name · VMID · user')} aria-label={L('데스크톱 검색', 'Search desktops')}
            value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={state} onChange={(e) => setState(e.target.value)} aria-label={L('상태', 'State')}>
            <option value="">{L('상태 전체', 'All states')}</option>
            <option value="on">{L('켜짐', 'On')}</option>
            <option value="stopped">{L('꺼짐', 'Stopped')}</option>
            <option value="provisioning">{L('준비 중', 'Preparing')}</option>
            <option value="missing">{L('삭제됨', 'Deleted')}</option>
            <option value="error">{L('오류', 'Error')}</option>
          </select>
        </span>
      </header>
      <LoadState value={loaded} retry={() => undefined}>
        {() => rows.length === 0 ? <p className="muted small">{list.length ? L('조건에 맞는 데스크톱이 없습니다.', 'Nothing matches.') : t('desk.empty')}</p> : (
          <div className="table-scroll">
            <table className="table vt-table">
              <thead>
                <tr>
                  <th>{L('이름', 'Name')}</th><th>{L('상태', 'State')}</th><th>CPU</th><th>{L('메모리', 'Memory')}</th>
                  {multi && <th className="num">{L('세션', 'Sessions')}</th>}
                  <th>{L('사용자', 'User')}</th><th className="vt-actions-h">{L('작업', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const u = usage.get(d.id);
                  const on = d.state === 'ready' || d.state === 'in_use';
                  const memPct = u && on && u.maxmem ? (u.mem / u.maxmem) * 100 : null;
                  const gone = d.state === 'missing';
                  return (
                    <tr key={d.id}>
                      <td className="nowrap">
                        <span className="vt-vm-id">{d.vmid}</span> {gone ? <span>{d.name}</span>
                          : <Link className="strong" to={`/admin/vms/desktops/list?vm=${encodeURIComponent(d.id)}`}>{d.name}</Link>}
                        {d.has_base && <span className="vt-st vd-tag" title={t('reset.hasBase')}>{L('기준', 'Base')}</span>}
                        {joinRows[d.id] && <> <JoinChip j={joinRows[d.id]} /></>}
                      </td>
                      <td><DeskChip d={d} /></td>
                      <td className="pv-use">{u ? <Usage main={`${u.cpus}`} pct={on ? u.cpu_percent : null} /> : <span className="muted">-</span>}</td>
                      <td className="pv-use">{u ? <Usage main={`${Math.round(u.maxmem / 1024 ** 3)}G`} pct={memPct} /> : <span className="muted">-</span>}</td>
                      {multi && <td className="num nowrap">{open(d.id)}{maxSessions ? <span className="muted"> / {maxSessions}</span> : null}</td>}
                      <td className="nowrap">{d.assigned_user ?? <span className="muted">-</span>}</td>
                      <td className="vt-actions">
                        <button type="button" className="vt-link" disabled={!on} title={t('vm.screenHint')} onClick={() => onConsole(d)}>{L('접속', 'Connect')}</button>
                        {!gone && <Link className="vt-link" to={`/admin/vms/desktops/list?vm=${encodeURIComponent(d.id)}`}>{L('관리', 'Manage')}</Link>}
                        <Drop className="vt-link" disabled={gone} label={<>{L('배정', 'Assign')}<Caret /></>}>
                          {(close) => <AssignBox d={d} users={users} onDone={(user) => {
                            close();
                            onAct(() => adminApi.assign(d.id, user), user ? L(`${d.name}을(를) ${user}에게 배정했습니다.`, `${d.name} assigned to ${user}.`) : L(`${d.name} 배정을 풀었습니다.`, `${d.name} unassigned.`));
                          }} />}
                        </Drop>
                        <Drop className="vt-more" label={<>{L('더보기', 'More')}<Caret /></>}>
                          {(close) => (
                            <>
                              {d.has_base && <button type="button" role="menuitem" disabled={gone} onClick={() => {
                                close();
                                if (!window.confirm(t('reset.oneConfirm'))) return;
                                onAct(async () => {
                                  try { await adminApi.resetDesktop(d.id); } catch (e) {
                                    if ((e as { body?: { code?: string } }).body?.code !== 'IN_USE' || !window.confirm(t('reset.inUse'))) throw e;
                                    await adminApi.resetDesktop(d.id, true);
                                  }
                                }, `${d.name}: ${t('reset.started')}`);
                              }}>{t('reset.one')}</button>}
                              <button type="button" role="menuitem" disabled={gone || d.state === 'provisioning'} onClick={() => {
                                close();
                                if (window.confirm(t('reset.baseConfirm'))) onAct(() => adminApi.takeBase(d.id), `${d.name}: ${t('reset.baseTaken')}`);
                              }}>{t('reset.base')}</button>
                              <hr className="vt-sep" />
                              <button type="button" role="menuitem" className="danger" onClick={() => {
                                close();
                                if (window.confirm(t('desk.removeConfirm'))) onAct(() => adminApi.removeDesktop(d.id), L(`${d.name}을(를) 풀에서 뺐습니다.`, `${d.name} taken out.`));
                              }}>{L('풀에서 빼기', 'Take out')}</button>
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
        )}
      </LoadState>
    </section>
  );
}

function AssignBox({ d, users, onDone }: { d: AdminDesktop; users: AssignableUser[]; onDone: (u: string | null) => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [u, setU] = useState(d.assigned_user ?? '');
  return (
    <div className="vt-assign">
      <span className="vt-menu-note">{L(`${d.name} 사용자`, `User of ${d.name}`)}</span>
      <select value={u} onChange={(e) => setU(e.target.value)} autoFocus>
        <option value="">{L('선택', 'Pick')}</option>
        {users.map((x) => <option key={x.username} value={x.username}>{x.display_name && x.display_name !== x.username ? `${x.display_name} (${x.username})` : x.username}</option>)}
      </select>
      <div className="vt-assign-btns">
        {d.assigned_user && <button type="button" className="btn-ghost small-btn danger" onClick={() => onDone(null)}>{L('배정 해제', 'Unassign')}</button>}
        <button type="button" className="btn primary small-btn" disabled={!u || u === d.assigned_user} onClick={() => onDone(u)}>{L('배정', 'Assign')}</button>
      </div>
    </div>
  );
}

function Grants({ pool, loaded, onRemove }: {
  pool: Pool; loaded: ReturnType<typeof useLoad<{ grants: Grant[]; max_sessions: number }>>; onRemove: (g: Grant, label: string) => void;
}) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [tab, setTab] = useState<GrantType>('user');
  const [q, setQ] = useState('');
  const all = useLoad(adminApi.allUsers);
  const deps = useLoad(nextApi.departments);
  const user = (id: string) => (all.state === 'ok' ? all.data.find((u) => u.username === id) : undefined);
  const dep = (id: string) => (deps.state === 'ok' ? deps.data.find((d) => d.id === id) : undefined);
  const label = (g: Grant) => g.subject_type === 'department' ? dep(g.subject_id)?.name ?? g.subject_id
    : g.subject_type === 'group' ? (g.subject_id.match(/^CN=([^,]+)/i)?.[1] ?? g.subject_id) : g.subject_id;
  const tabs: [GrantType, string][] = [['user', L('사용자', 'Users')], ['department', L('부서', 'Departments')], ['group', L('그룹', 'Groups')]];
  const firstKind = loaded.state === 'ok' ? tabs.find(([k]) => loaded.data.grants.some((g) => g.subject_type === k))?.[0] : undefined;
  useEffect(() => { if (firstKind) setTab(firstKind); }, [firstKind]);   // open on a tab that has something
  return (
    <section className="vd-card pv-grants">
      <header>
        <h3>{L('이용 권한', 'Access')}</h3>
        <input type="search" className="pv-search" placeholder={L('찾기', 'Find')} aria-label={L('권한 찾기', 'Find')} value={q} onChange={(e) => setQ(e.target.value)} />
      </header>
      <nav className="pv-gtabs" role="tablist">
        {tabs.map(([id, text]) => {
          const n = loaded.state === 'ok' ? loaded.data.grants.filter((g) => g.subject_type === id).length : 0;
          return <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{text} <span>{n}</span></button>;
        })}
      </nav>
      <LoadState value={loaded} retry={loaded.reload}>
        {(d) => {
          const n = q.trim().toLowerCase();
          const rows = d.grants.filter((g) => g.subject_type === tab).filter((g) => !n || label(g).toLowerCase().includes(n) || g.subject_id.toLowerCase().includes(n)
            || (user(g.subject_id)?.display_name ?? '').toLowerCase().includes(n));
          return rows.length === 0 ? <p className="muted small">{d.grants.length ? L('여기는 없습니다.', 'None here.') : L('아직 없음 — 관리자가 배정한 사람만 씁니다.', 'Nobody yet — only people an admin assigns.')}</p> : (
            <table className="table vt-table">
              <thead><tr><th>{L('이름', 'Name')}</th><th>{L('표시 이름', 'Display')}</th><th>{L('상태', 'State')}</th><th /></tr></thead>
              <tbody>
                {rows.map((g) => {
                  const u = g.subject_type === 'user' ? user(g.subject_id) : undefined;
                  return (
                    <tr key={g.subject_type + g.subject_id}>
                      <td className="nowrap strong">{label(g)}</td>
                      <td className="small">{g.subject_type === 'user' ? (u?.display_name ?? '-') : g.subject_type === 'group' ? <span className="muted" title={g.subject_id}>{g.subject_id.slice(0, 32)}{g.subject_id.length > 32 ? '…' : ''}</span>
                        : (g.include_children ? L('하위 부서 포함', 'With sub-departments') : L('이 부서만', 'This one only'))}</td>
                      <td>{g.subject_type === 'user' ? (u ? (u.enabled === false ? <span className="vt-st vt-st-offline">{L('중지', 'Disabled')}</span> : <span className="vt-st vt-st-running">{L('사용', 'Enabled')}</span>) : <span className="vt-st vt-st-error">{L('없는 계정', 'No account')}</span>)
                        : <span className="vt-st vt-st-running">{L('적용', 'Active')}</span>}</td>
                      <td className="vt-actions"><button type="button" className="vt-link danger-text" onClick={() => onRemove(g, label(g))}>{L('빼기', 'Remove')}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        }}
      </LoadState>
      {pool.type === 'shared' && loaded.state === 'ok' && <p className="muted small">{L(`데스크톱 한 대에 최대 ${loaded.data.max_sessions}명 (편집에서 바꿈)`, `At most ${loaded.data.max_sessions} per desktop`)}</p>}
    </section>
  );
}

function AddGrant({ kind, have, onClose, onSave }: { kind: GrantType; have: Grant[]; onClose: () => void; onSave: (g: Grant[], label: string) => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const users = useLoad(adminApi.allUsers);
  const deps = useLoad(nextApi.departments);
  const [ids, setIds] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [children, setChildren] = useState(true);
  const taken = new Set(have.filter((g) => g.subject_type === kind).map((g) => g.subject_id));
  const opts: { id: string; name: string; sub: string }[] = kind === 'user'
    ? (users.state === 'ok' ? users.data : []).filter((u) => u.enabled !== false).map((u) => ({ id: u.username, name: u.username, sub: u.display_name }))
    : kind === 'department' ? (deps.state === 'ok' ? deps.data : []).map((d) => ({ id: d.id, name: d.name, sub: '' })) : [];
  const n = q.trim().toLowerCase();
  const shown = opts.filter((o) => !taken.has(o.id) && (!n || o.name.toLowerCase().includes(n) || o.sub.toLowerCase().includes(n))).slice(0, 200);
  const title = kind === 'user' ? L('사용자 추가', 'Add users') : kind === 'department' ? L('부서 추가', 'Add departments') : L('그룹 추가', 'Add a group');
  const pickIds = kind === 'group' ? (group.trim() && !taken.has(group.trim()) ? [group.trim()] : []) : ids;
  return (
    <Modal title={title} onClose={onClose} actions={(
      <>
        <button type="button" className="btn" onClick={onClose}>{L('취소', 'Cancel')}</button>
        <button type="button" className="btn primary" disabled={!pickIds.length} onClick={() => onSave(
          pickIds.map((id) => ({ subject_type: kind, subject_id: id, include_children: kind === 'department' ? children : false })),
          pickIds.length === 1 ? (opts.find((o) => o.id === pickIds[0])?.name ?? pickIds[0]) : L(`${pickIds.length}개`, `${pickIds.length}`))}>
          {L(`${pickIds.length}개 추가`, `Add ${pickIds.length}`)}</button>
      </>
    )}>
      {kind === 'group' ? (
        <label className="vt-field">{L('AD/LDAP 그룹 (DN 또는 이름)', 'AD/LDAP group (DN or name)')}
          <input autoFocus value={group} placeholder="CN=Lab-Users,OU=Groups,DC=example,DC=com" onChange={(e) => setGroup(e.target.value)} />
        </label>
      ) : (
        <>
          <input type="search" className="pv-pick-search" autoFocus placeholder={L('찾기', 'Find')} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="pv-pick">
            {shown.length === 0 ? <p className="muted small">{L('더 고를 것이 없습니다.', 'Nothing left to pick.')}</p> : shown.map((o) => (
              <label key={o.id} className="check">
                <input type="checkbox" checked={ids.includes(o.id)} onChange={() => setIds((s) => (s.includes(o.id) ? s.filter((x) => x !== o.id) : [...s, o.id]))} />
                <span><b>{o.name}</b>{o.sub && o.sub !== o.name && <span className="muted small"> · {o.sub}</span>}</span>
              </label>
            ))}
          </div>
          {kind === 'department' && <label className="check"><input type="checkbox" checked={children} onChange={(e) => setChildren(e.target.checked)} />{L('하위 부서도 포함', 'Include sub-departments')}</label>}
        </>
      )}
    </Modal>
  );
}

function Logs({ pool, sessions }: { pool: Pool; sessions: ReturnType<typeof useLoad<Awaited<ReturnType<typeof adminApi.sessions>>>> }) {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [tab, setTab] = useState<'sessions' | 'audit'>('sessions');
  const audit = useLoad(useCallback(() => adminApi.audit({ q: pool.name, vlab_only: true, limit: 30 }), [pool.name]), [pool.name]);
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '-');
  return (
    <section className="vd-card">
      <header>
        <nav className="pv-gtabs pv-logtabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'sessions'} className={tab === 'sessions' ? 'on' : ''} onClick={() => setTab('sessions')}>{L('접속 기록', 'Connections')}</button>
          <button type="button" role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'on' : ''} onClick={() => setTab('audit')}>{L('작업 기록', 'Audit')}</button>
        </nav>
        <Link className="vt-link" to={tab === 'sessions' ? `/admin/ops/logs/sessions?pool=${encodeURIComponent(pool.id)}` : `/admin/ops/logs/audit?q=${encodeURIComponent(pool.name)}`}>{L('전체 보기', 'See all')}</Link>
      </header>
      {tab === 'sessions' ? (
        <LoadState value={sessions} retry={sessions.reload}>
          {(rows) => rows.length === 0 ? <p className="muted small">{L('접속 기록이 없습니다.', 'No connections yet.')}</p> : (
            <div className="table-scroll">
              <table className="table vt-table">
                <thead><tr><th>{L('시작', 'Started')}</th><th>{L('사용자', 'User')}</th><th>{L('데스크톱', 'Desktop')}</th><th>{L('방식', 'Protocol')}</th><th>{L('결과', 'Result')}</th><th>{L('끝', 'Ended')}</th><th>IP</th></tr></thead>
                <tbody>
                  {rows.slice(0, 15).map((s) => (
                    <tr key={s.id}>
                      <td className="nowrap muted small">{time(s.started_at)}</td>
                      <td className="nowrap">{s.username}</td>
                      <td className="nowrap">{s.desktop}</td>
                      <td className="nowrap small">{s.protocol}</td>
                      <td>{!s.ended_at ? <span className="vt-st vt-st-in_use">{L('접속 중', 'Connected')}</span>
                        : <span className={`vt-st ${/fail|error|denied/i.test(s.result) ? 'vt-st-error' : ''}`} title={s.result}>{s.result || L('끝남', 'Ended')}</span>}</td>
                      <td className="nowrap muted small">{s.ended_at ? relativeTime(s.ended_at, lang) : '-'}</td>
                      <td className="nowrap muted small">{s.client_ip || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </LoadState>
      ) : (
        <LoadState value={audit} retry={audit.reload}>
          {(page) => page.entries.length === 0 ? <p className="muted small">{L('이 풀 이름이 들어간 작업 기록이 없습니다.', 'No audit entries mention this pool.')}</p> : (
            <div className="table-scroll">
              <table className="table vt-table">
                <thead><tr><th>{L('시각', 'Time')}</th><th>{L('사용자', 'User')}</th><th>{L('작업', 'Action')}</th><th>{L('내용', 'Details')}</th></tr></thead>
                <tbody>
                  {page.entries.slice(0, 15).map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap muted small">{time(e.timestamp)}</td>
                      <td className="nowrap">{e.user}</td>
                      <td className="nowrap"><code className="code small">{e.action}</code></td>
                      <td className="small">{e.details ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </LoadState>
      )}
      <HowTo><p>{L('작업 기록은 풀 이름이 적힌 항목만 보입니다(데스크톱 이름만 적힌 항목은 전체 보기에서).',
        'Audit shows entries that name the pool; entries naming only a desktop are under See all.')}</p></HowTo>
    </section>
  );
}
