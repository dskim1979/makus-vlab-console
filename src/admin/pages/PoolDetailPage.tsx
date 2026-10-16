import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import type { AdminDesktop, AssignableUser, Pool, Template } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { LoadState } from '../../components/LoadState';
import { StateBadge } from '../../components/StateBadge';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { PoolGpuPanel } from './PoolGpu';
import { PoolPolicyPanel } from './PoolPolicy';
import { PoolGrantsPanel } from './PoolGrants';
import type { MessageKey } from '../../i18n/messages';

// 데스크톱 풀 > 풀 관리 > (풀): its desktops, add an existing VM, assign / unassign, take out.
export function PoolDetailPage({ poolId }: { poolId: string }) {
  const { t } = useI18n();
  const pools = useLoad(adminApi.pools);
  const desktops = useLoad(useCallback(() => adminApi.poolDesktops(poolId), [poolId]), [poolId]);
  const users = useLoad(adminApi.users);
  const [adding, setAdding] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  // while clones are running, look again every 5 seconds until they turn ready
  const provisioning = desktops.state === 'ok' && desktops.data.some((d) => d.state === 'provisioning');
  useEffect(() => {
    if (!provisioning) return;
    const id = setInterval(desktops.reload, 5000);
    return () => clearInterval(id);
  }, [provisioning, desktops.reload]);

  const pool = pools.state === 'ok' ? pools.data.find((p) => p.id === poolId) : undefined;
  if (pools.state === 'ok' && !pool) {
    return <div className="alert">{t('pool.notFound')} <Link to="/admin/pools/list">{t('common.back')}</Link></div>;
  }

  async function act(fn: () => Promise<void>) {
    try { await fn(); } catch (e) { alert((e as Error).message); }
    desktops.reload();
    pools.reload();
  }

  async function resetAll() {
    if (!pool || !confirm(t('reset.poolConfirm'))) return;
    try {
      const r = await adminApi.resetPool(pool.id);
      setNotice({
        kind: r.failed.length ? 'error' : 'info',
        text: t('reset.done').replace('{done}', String(r.reset.length)).replace('{skipped}', String(r.skipped.length))
          .replace('{failed}', String(r.failed.length))
          + (r.failed.length ? ` - ${r.failed.map((f) => `${f.name}: ${f.error}`).join(', ')}` : ''),
      });
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    }
    desktops.reload();
  }

  async function resetOne(d: AdminDesktop) {
    if (!confirm(t('reset.oneConfirm'))) return;
    try {
      await adminApi.resetDesktop(d.id);
    } catch (e) {
      if ((e as Error).message !== 'IN_USE' && (e as { body?: { code?: string } }).body?.code !== 'IN_USE') {
        setNotice({ kind: 'error', text: (e as Error).message }); return;
      }
      if (!confirm(t('reset.inUse'))) return;
      try { await adminApi.resetDesktop(d.id, true); } catch (e2) { setNotice({ kind: 'error', text: (e2 as Error).message }); return; }
    }
    setNotice({ kind: 'info', text: `${d.name}: ${t('reset.started')}` });
    desktops.reload();
  }

  async function retakeBase(d: AdminDesktop) {
    if (!confirm(t('reset.baseConfirm'))) return;
    try { await adminApi.takeBase(d.id); setNotice({ kind: 'info', text: `${d.name}: ${t('reset.baseTaken')}` }); }
    catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    desktops.reload();
  }

  const resettable = pool?.type === 'reset' || pool?.type === 'classroom';

  return (
    <>
      <div className="crumbs-row">
        <Link to="/admin/pools/list" className="btn-ghost">← {t('common.back')}</Link>
        {pool && (
          <span className="muted">
            {t(`pooltype.${pool.type}` as MessageKey)} · {pool.desktops} {t('desk.count')} · {t('pool.assigned')} {pool.assigned}
          </span>
        )}
      </div>
      {pool && <h2 className="page-sub">{pool.name}</h2>}

      <div className="toolbar">
        <button type="button" className="btn primary" disabled={!pool} onClick={() => setCloning(true)}>{t('clone.open')}</button>
        <button type="button" className="btn" disabled={!pool} onClick={() => setAdding(true)}>{t('desk.addVm')}</button>
        {resettable && <button type="button" className="btn" onClick={resetAll}>{t('reset.pool')}</button>}
        <button type="button" className="btn" onClick={desktops.reload}>{t('common.refresh')}</button>
      </div>
      {notice && <div className={`alert ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      {pool && <PoolPolicyPanel pool={pool} onChanged={pools.reload} />}
      {pool && <PoolGrantsPanel pool={pool} />}
      {pool && <PoolGpuPanel pool={pool} onChanged={() => { pools.reload(); desktops.reload(); }} />}
      <p className="muted small">{t('desk.assignNote')}</p>

      <LoadState value={desktops} retry={desktops.reload}>
        {(list) => list.length === 0 ? (
          <div className="empty"><p>{t('desk.empty')}</p></div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('desk.name')}</th><th className="num">VMID</th><th>{t('desk.node')}</th>
                <th>{t('desk.state')}</th><th>{t('desk.user')}</th><th />
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <DesktopRow key={d.id} d={d} users={users.state === 'ok' ? users.data : []}
                  onAssign={(u) => act(() => adminApi.assign(d.id, u))}
                  onReset={() => resetOne(d)} onBase={() => retakeBase(d)}
                  onRemove={() => { if (confirm(t('desk.removeConfirm'))) act(() => adminApi.removeDesktop(d.id)); }} />
              ))}
            </tbody>
          </table>
        )}
      </LoadState>

      {cloning && pool && (
        <CloneDialog pool={pool} onClose={() => setCloning(false)}
          onDone={(n) => { setCloning(false); setNotice(n); desktops.reload(); pools.reload(); }} />
      )}

      {adding && pool && (
        <AddVmDialog pool={pool} onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); desktops.reload(); pools.reload(); }} />
      )}
    </>
  );
}

function DesktopRow({ d, users, onAssign, onReset, onBase, onRemove }: {
  d: AdminDesktop; users: AssignableUser[]; onAssign: (u: string | null) => void;
  onReset: () => void; onBase: () => void; onRemove: () => void;
}) {
  const { t } = useI18n();
  const [pick, setPick] = useState('');
  return (
    <tr>
      <td>
        <span className="strong">{d.name}</span>
        {d.has_base && <span className="chip chip-base" title={t('reset.hasBase')}>{t('reset.hasBase')}</span>}
      </td>
      <td className="num">{d.vmid}</td>
      <td>{d.node}</td>
      <td><StateBadge state={d.state} /></td>
      <td>
        {d.assigned_user ? (
          <span className="assign">
            <span className="chip">{d.assigned_user}</span>
            <button type="button" className="btn-ghost" onClick={() => onAssign(null)}>{t('desk.unassign')}</button>
          </span>
        ) : (
          <span className="assign">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('desk.assignTo')}>
              <option value="">{t('desk.unassigned')}</option>
              {users.map((u) => (
                <option key={u.username} value={u.username}>
                  {u.display_name !== u.username ? `${u.display_name} (${u.username})` : u.username}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={!pick} onClick={() => onAssign(pick)}>{t('desk.assign')}</button>
          </span>
        )}
      </td>
      <td className="actions">
        {d.has_base && <button type="button" className="btn-ghost" onClick={onReset}>{t('reset.one')}</button>}
        <button type="button" className="btn-ghost" disabled={d.state === 'provisioning'} onClick={onBase}>{t('reset.base')}</button>
        <button type="button" className="btn-ghost danger" onClick={onRemove}>{t('desk.remove')}</button>
      </td>
    </tr>
  );
}

function AddVmDialog({ pool, onClose, onAdded }: { pool: Pool; onClose: () => void; onAdded: () => void }) {
  const { t } = useI18n();
  const guests = useLoad(useCallback(() => adminApi.guests(pool.cluster_id), [pool.cluster_id]), [pool.cluster_id]);
  const [vmid, setVmid] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (vmid == null || guests.state !== 'ok') return;
    const g = guests.data.find((x) => x.vmid === vmid);
    setBusy(true); setError(null);
    try {
      await adminApi.addDesktop(pool.id, { vmid, node: g?.node, type: g?.type });
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={t('desk.addVm')} onClose={onClose} onSubmit={submit} submitLabel={t('common.add')}
      busy={busy || vmid == null} error={error}>
      <p className="muted small">{t('desk.addVmHint')}</p>
      <LoadState value={guests} retry={guests.reload}>
        {(list) => {
          const free = list.filter((g) => !g.desktop_id);
          if (free.length === 0) return <p className="muted">{t('desk.noFreeVm')}</p>;
          return (
            <div className="pick-list" role="radiogroup" aria-label={t('desk.pickVm')}>
              {list.map((g) => (
                <label key={g.vmid} className={`pick${g.desktop_id ? ' off' : ''}${vmid === g.vmid ? ' on' : ''}`}>
                  <input type="radio" name="vm" aria-label={`${g.name} (${g.vmid})`} disabled={!!g.desktop_id} checked={vmid === g.vmid}
                    onChange={() => setVmid(g.vmid)} />
                  <span className="strong">{g.name}</span>
                  <span className="muted small">{g.vmid} · {g.node} · {g.status}</span>
                  {g.desktop_id && <span className="muted small">{g.pool_id === pool.id ? '✓' : t('desk.inOtherPool')}</span>}
                </label>
              ))}
            </div>
          );
        }}
      </LoadState>
    </Dialog>
  );
}

function slug(name: string) {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  // a Korean name leaves little or nothing behind: fall back to a neutral prefix
  return s.length >= 3 && /^[a-z0-9]/.test(s) ? s : 'desk';
}

// From a pool (pool given) or from 가상머신 > 템플릿 관리 (pools to pick from, template preselected).
export function CloneDialog({ pool: fixed, pools, templateVmid, defaultFull = false, onClose, onDone }: {
  pool?: Pool; pools?: Pool[]; templateVmid?: number; defaultFull?: boolean;
  onClose: () => void; onDone: (n: { kind: 'info' | 'error'; text: string }) => void;
}) {
  const { t } = useI18n();
  const [poolId, setPoolId] = useState(fixed?.id ?? pools?.[0]?.id ?? '');
  const pool = (fixed ?? pools?.find((x) => x.id === poolId))!;
  const templates = useLoad(useCallback(() => adminApi.templates(pool.cluster_id), [pool.cluster_id]), [pool.cluster_id]);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [count, setCount] = useState(10);
  const [prefix, setPrefix] = useState(slug(pool.name));
  useEffect(() => {
    if (templateVmid !== undefined && templates.state === 'ok') {
      const x = templates.data.find((y) => y.vmid === templateVmid) ?? null;
      setTpl(x);
      if (x?.type === 'lxc') setFull(true);
    }
  }, [templates, templateVmid]);
  const [full, setFull] = useState(defaultFull);
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!tpl) return;
    setBusy(true); setError(null);
    try {
      const r = await adminApi.clone(pool.id, {
        template_vmid: tpl.vmid, count, name_prefix: prefix.trim(), full,
        ...(start.trim() ? { start_vmid: Number(start) } : {}),
      });
      onDone(r.failed
        ? { kind: 'error', text: t('clone.partial').replace('{n}', String(r.created.length)).replace('{vmid}', String(r.failed.vmid)).replace('{error}', r.failed.error) }
        : { kind: 'info', text: t('clone.started').replace('{n}', String(r.created.length)) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={t('clone.open')} onClose={onClose} onSubmit={submit} submitLabel={t('clone.submit')}
      busy={busy || !tpl} error={error}>
      {pools && !fixed && (
        <label>
          <span>{t('clone.pool')}</span>
          <select value={poolId} onChange={(e) => {
            setPoolId(e.target.value);
            const next = pools.find((x) => x.id === e.target.value);
            if (next) setPrefix(slug(next.name));
          }}>
            {pools.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      )}
      <LoadState value={templates} retry={templates.reload}>
        {(list) => list.length === 0 ? <p className="muted">{t('clone.noTemplates')}</p> : (
          <div className="pick-list" role="radiogroup" aria-label={t('clone.template')}>
            {list.map((x) => (
              <label key={x.vmid} className={`pick${tpl?.vmid === x.vmid ? ' on' : ''}`}>
                <input type="radio" name="tpl" aria-label={`${x.name} (${x.vmid})`} checked={tpl?.vmid === x.vmid}
                  onChange={() => { setTpl(x); if (x.type === 'lxc') setFull(true); }} />
                <span className="strong">{x.name}</span>
                <span className="muted small">
                  {x.vmid} · {x.node}{x.spec.cpu ? ` · ${x.spec.cpu} vCPU` : ''}{x.spec.memory_gb ? ` · ${x.spec.memory_gb} GB` : ''}
                </span>
              </label>
            ))}
          </div>
        )}
      </LoadState>
      <div className="form-row">
        <label>
          <span>{t('clone.count')}</span>
          <input type="number" min={1} max={100} required value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
        </label>
        <label>
          <span>{t('clone.prefix')}</span>
          <input required pattern="[A-Za-z0-9][A-Za-z0-9-]{0,40}" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </label>
      </div>
      <small className="muted">{t('clone.prefixHint')}</small>
      <label className="check">
        <input type="checkbox" checked={full} disabled={tpl?.type === 'lxc'} onChange={(e) => setFull(e.target.checked)} />
        <span>{t('clone.full')}</span>
      </label>
      {!full && <small className="muted">{t('clone.linkedNote')}</small>}
      <label>
        <span>{t('clone.startVmid')}</span>
        <input inputMode="numeric" pattern="[0-9]*" value={start} onChange={(e) => setStart(e.target.value.replace(/D/g, ''))} />
      </label>
    </Dialog>
  );
}
