import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import type { AdminDesktop, Pool, PowerAction, Template } from '../../api/types';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { StateBadge } from '../../components/StateBadge';
import { useLoad } from '../../components/useLoad';
import { duration as fmtDuration } from '../../format';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { bytes, ClusterFrame, Meter, useCluster } from './ClusterPages';
import { CloneDialog } from './PoolDetailPage';

type Notice = { kind: 'info' | 'error'; text: string };
const ACTIONS: PowerAction[] = ['start', 'shutdown', 'reboot', 'stop'];

function uptime(s: number, lang: 'ko' | 'en') {
  return s ? fmtDuration(s / 60, lang) : '-';
}

// 가상머신 > 데스크톱(VM) 관리: every desktop VM with what it uses, switched on/off here,
// one by one or several at once.
export function VmDesktopsPage() {
  const { t, lang } = useI18n();
  const desktops = useLoad(adminApi.desktops);
  const [pool, setPool] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const pools = useMemo(() => {
    if (desktops.state !== 'ok') return [];
    const m = new Map<string, string>();
    desktops.data.forEach((d) => d.pool_id && m.set(d.pool_id, d.pool));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [desktops]);

  const label = (a: PowerAction) => t(`vm.${a}` as MessageKey);

  async function power(list: AdminDesktop[], action: PowerAction) {
    if (list.length === 1 && (action === 'stop' || action === 'shutdown')
        && !window.confirm(t(action === 'stop' ? 'vm.stopConfirm' : 'vm.shutdownConfirm').replace('{name}', list[0].name))) return;
    if (list.length > 1 && (action === 'stop' || action === 'shutdown')
        && !window.confirm(`${t('vm.selected').replace('{n}', String(list.length))}: ${label(action)}?`)) return;
    setBusy(true); setNotice(null);
    const failed: string[] = [];
    for (const d of list) {
      try { await adminApi.powerDesktop(d.id, action); } catch (e) { failed.push(`${d.name}: ${(e as Error).message}`); }
    }
    setBusy(false);
    const ok = list.length - failed.length;
    if (failed.length) {
      setNotice({ kind: 'error', text: t('vm.bulkFailed').replace('{n}', String(failed.length)).replace('{error}', failed.join('; ')) });
    } else {
      setNotice({ kind: 'info', text: list.length === 1
        ? t('vm.done').replace('{name}', list[0].name).replace('{action}', label(action))
        : t('vm.bulkDone').replace('{n}', String(ok)).replace('{action}', label(action)) });
    }
    setPicked(new Set());
    // the cluster's guest list catches up within a few seconds
    window.setTimeout(desktops.reload, 2500);
    desktops.reload();
  }

  return (
    <>
      <div className="toolbar">
        <select value={pool} onChange={(e) => setPool(e.target.value)} aria-label={t('desk.pool')}>
          <option value="">{t('desk.pool')}: {t('common.all')}</option>
          {pools.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <input type="search" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn" onClick={desktops.reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}

      <LoadState value={desktops} retry={desktops.reload}>
        {(list) => {
          const needle = q.trim().toLowerCase();
          const rows = list.filter((d) => (!pool || d.pool_id === pool) &&
            (!needle || [d.name, d.assigned_user ?? '', String(d.vmid), d.node].some((s) => s.toLowerCase().includes(needle))));
          const chosen = rows.filter((d) => picked.has(d.id));
          const all = rows.length > 0 && chosen.length === rows.length;
          const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
          return rows.length === 0 ? <div className="empty"><p>{t('desk.allEmpty')}</p></div> : (
            <>
              <div className="bulkbar">
                {chosen.length > 0 ? (
                  <>
                    <span className="strong">{t('vm.selected').replace('{n}', String(chosen.length))}</span>
                    {ACTIONS.map((a) => (
                      <button key={a} type="button" className={`btn small-btn${a === 'stop' ? ' danger' : ''}`} disabled={busy}
                        onClick={() => power(chosen, a)}>{label(a)}</button>
                    ))}
                  </>
                ) : <span className="muted small">{t('vm.bulkHint')}</span>}
              </div>
              <div className="table-scroll">
                <table className="table compact-head">
                  <thead>
                    <tr>
                      <th><input type="checkbox" aria-label={t('common.all')} checked={all}
                        onChange={() => setPicked(all ? new Set() : new Set(rows.map((d) => d.id)))} /></th>
                      <th>{t('desk.name')}</th><th>{t('desk.pool')}</th><th>{t('desk.node')}</th><th>{t('desk.state')}</th>
                      <th>{t('vm.cpu')}</th><th>{t('vm.memory')}</th><th>{t('vm.uptime')}</th><th>{t('desk.user')}</th>
                      <th>{t('vm.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => {
                      const u = d.usage;
                      const memPct = u && u.maxmem ? (u.mem / u.maxmem) * 100 : 0;
                      const running = d.state === 'ready' || d.state === 'in_use';
                      return (
                        <tr key={d.id}>
                          <td><input type="checkbox" aria-label={d.name} checked={picked.has(d.id)} onChange={() => toggle(d.id)} /></td>
                          <td className="nowrap"><span className="strong">{d.name}</span><br /><span className="muted small">VMID {d.vmid}</span></td>
                          <td className="nowrap">{d.pool_id ? <Link to={`/admin/pools/list/${d.pool_id}`}>{d.pool}</Link> : d.pool}</td>
                          <td>{d.node}</td>
                          <td className="nowrap"><StateBadge state={d.state} /></td>
                          <td>{u && running ? <><Meter value={u.cpu_percent} label={`${Math.round(u.cpu_percent)}%`} />
                            <span className="muted small">{u.cpus} vCPU</span></> : <span className="muted small">{u ? `${u.cpus} vCPU` : '-'}</span>}</td>
                          <td>{u && running ? <><Meter value={memPct} label={`${Math.round(memPct)}%`} />
                            <span className="muted small">{bytes(u.mem)} / {bytes(u.maxmem)}</span></> : <span className="muted small">{u ? bytes(u.maxmem) : '-'}</span>}</td>
                          <td className="nowrap muted small">{u ? uptime(u.uptime, lang) : '-'}</td>
                          <td>{d.assigned_user ?? <span className="muted">{t('desk.unassigned')}</span>}</td>
                          <td className="nowrap">
                            {running ? (
                              <>
                                <button type="button" className="btn-ghost" disabled={busy} onClick={() => power([d], 'shutdown')}>{label('shutdown')}</button>
                                <button type="button" className="btn-ghost" disabled={busy} onClick={() => power([d], 'reboot')}>{label('reboot')}</button>
                                <button type="button" className="btn-ghost danger" disabled={busy} onClick={() => power([d], 'stop')}>{label('stop')}</button>
                              </>
                            ) : d.state === 'stopped' ? (
                              <button type="button" className="btn-ghost" disabled={busy} onClick={() => power([d], 'start')}>{label('start')}</button>
                            ) : <span className="muted small">-</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          );
        }}
      </LoadState>
    </>
  );
}

// 가상머신 > 템플릿 관리: the cluster's templates, whether linked clones work from each,
// how many pools were cloned from it, and "clone into a pool" from here.
export function TemplatesPage() {
  const { current } = useCluster();
  const templates = useLoad(useCallback(() => (current ? adminApi.templates(current.id, true) : Promise.resolve([])), [current?.id]),
    [current?.id]);
  const pools = useLoad(adminApi.pools);
  return (
    <ClusterFrame reload={templates.reload}>
      {(c) => (
        <LoadState value={templates} retry={templates.reload}>
          {(list) => <TemplateTable list={list} pools={pools.state === 'ok' ? pools.data.filter((p) => p.cluster_id === c.id) : []}
            onCloned={templates.reload} />}
        </LoadState>
      )}
    </ClusterFrame>
  );
}

function TemplateTable({ list, pools, onCloned }: { list: Template[]; pools: Pool[]; onCloned: () => void }) {
  const { t } = useI18n();
  const [cloning, setCloning] = useState<Template | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const linked = (v: boolean | null | undefined) => v === true
    ? <span className="status st-ready"><span className="dot" />{t('tpl.linkedYes')}</span>
    : v === false ? <span className="muted small">{t('tpl.linkedNo')}</span>
      : <span className="muted small">{t('tpl.linkedUnknown')}</span>;

  if (list.length === 0) return <div className="empty"><p>{t('tpl.empty')}</p></div>;
  return (
    <>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      {pools.length === 0 && <div className="alert small">{t('tpl.noPools')}</div>}
      <div className="table-scroll">
        <table className="table compact-head">
          <thead>
            <tr><th>{t('tpl.name')}</th><th>{t('desk.node')}</th><th>{t('tpl.spec')}</th><th>{t('tpl.disks')}</th>
              <th>{t('tpl.linked')}</th><th className="num">{t('tpl.pools')}</th><th /></tr>
          </thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.vmid}>
                <td className="nowrap"><span className="strong">{x.name}</span><br /><span className="muted small">VMID {x.vmid} · {x.type.toUpperCase()}</span></td>
                <td>{x.node}</td>
                <td className="small nowrap">
                  {[x.spec.cpu && `${x.spec.cpu} vCPU`, x.spec.memory_gb && `${x.spec.memory_gb} GB`, x.spec.disk_gb && `${x.spec.disk_gb} GB disk`]
                    .filter(Boolean).join(' · ') || '-'}
                </td>
                <td className="small">
                  {x.disks === null ? <span className="muted">-</span> : (x.disks ?? []).map((d) => (
                    <div key={d.key} className="nowrap"><code className="code">{d.key}</code> {d.storage}{d.plugin && <span className="muted"> ({d.plugin})</span>}</div>
                  ))}
                </td>
                <td className="nowrap">{linked(x.linked_clone)}</td>
                <td className="num">{x.pools ?? 0}</td>
                <td className="nowrap">
                  <button type="button" className="btn small-btn" disabled={pools.length === 0} onClick={() => setCloning(x)}>{t('tpl.clone')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t('tpl.note')}</p>
      {cloning && (
        <CloneDialog pools={pools} templateVmid={cloning.vmid} defaultFull={cloning.linked_clone === false} onClose={() => setCloning(null)}
          onDone={(n) => { setCloning(null); setNotice(n); onCloned(); }} />
      )}
    </>
  );
}
