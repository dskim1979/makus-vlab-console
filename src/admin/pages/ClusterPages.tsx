import { useCallback, useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import type { Cluster, ClusterNode, ClusterStorage } from '../../api/types';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { messages, type MessageKey } from '../../i18n/messages';

// 클러스터 > 개요 · 노드 · 스토리지: read-only views of one cluster at a time. The cluster
// picked is kept in the address (?c=) so the three pages and a reload stay on it.

const fill = (s: string, n: number | string) => s.replace('{n}', String(n));
const pct = (used: number, total: number) => (total > 0 ? Math.min(100, (used / total) * 100) : 0);

export function bytes(n: number) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

export function useCluster() {
  const [params, setParams] = useSearchParams();
  const clusters = useLoad(adminApi.clusters);
  const list = clusters.state === 'ok' ? clusters.data : [];
  const wanted = params.get('c');
  const current = list.find((c) => c.id === wanted) ?? list[0];
  useEffect(() => {
    if (current && current.id !== wanted) setParams({ c: current.id }, { replace: true });
  }, [current, wanted, setParams]);
  return { clusters, list, current, pick: (id: string) => setParams({ c: id }) };
}

export function ClusterFrame({ children, reload }: { children: (c: Cluster) => ReactNode; reload?: () => void }) {
  const { t } = useI18n();
  const { clusters, list, current, pick } = useCluster();
  return (
    <LoadState value={clusters} retry={clusters.reload}>
      {() => !current ? <div className="empty"><p>{t('cl.none')}</p></div> : (
        <>
          <div className="toolbar">
            {list.length > 1 && (
              <select aria-label={t('cl.pick')} value={current.id} onChange={(e) => pick(e.target.value)}>
                {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {list.length === 1 && <span className="strong">{current.name}</span>}
            {reload && <button type="button" className="btn" onClick={reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>}
          </div>
          {!current.connected && <div className="alert small">{t('cl.disconnected')}</div>}
          {children(current)}
        </>
      )}
    </LoadState>
  );
}

// reloads come from the frame's button; each page owns its loads
function useClusterLoads(clusterId: string | undefined) {
  const nodes = useLoad(useCallback(() => (clusterId ? adminApi.nodes(clusterId) : Promise.resolve([])), [clusterId]), [clusterId]);
  const storage = useLoad(useCallback(() => (clusterId ? adminApi.storage(clusterId) : Promise.resolve([])), [clusterId]), [clusterId]);
  return { nodes, storage };
}

export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <span className="util" title={`${value.toFixed(1)}%`}>
      <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, value)}%` }} /></span>
      <span className="bar-n">{label}</span>
    </span>
  );
}

function uptime(s: number, t: (k: MessageKey) => string) {
  return s >= 86400 ? fill(t('cl.days'), Math.floor(s / 86400)) : fill(t('cl.hours'), Math.floor(s / 3600));
}

// --- 개요 --------------------------------------------------------------------------

export function ClusterOverviewPage() {
  const { current } = useCluster();
  const { nodes, storage } = useClusterLoads(current?.id);
  return (
    <ClusterFrame reload={() => { nodes.reload(); storage.reload(); }}>
      {() => (
        <LoadState value={nodes} retry={nodes.reload}>
          {(ns) => <Overview nodes={ns} storage={storage.state === 'ok' ? storage.data : null} />}
        </LoadState>
      )}
    </ClusterFrame>
  );
}

function Overview({ nodes, storage }: { nodes: ClusterNode[]; storage: ClusterStorage[] | null }) {
  const { t } = useI18n();
  const on = nodes.filter((n) => n.online);
  const cores = on.reduce((a, n) => a + n.cpus, 0);
  const cpuAvg = cores ? on.reduce((a, n) => a + n.cpu_percent * n.cpus, 0) / cores : 0;
  const memUsed = on.reduce((a, n) => a + n.mem_used, 0);
  const memTotal = on.reduce((a, n) => a + n.mem_total, 0);
  const st = (storage ?? []).filter((s) => s.status === 'available');
  const stUsed = st.reduce((a, s) => a + s.used, 0);
  const stTotal = st.reduce((a, s) => a + s.total, 0);
  const guests = nodes.reduce((a, n) => a + n.guests, 0);
  const running = nodes.reduce((a, n) => a + n.running, 0);
  const desktops = nodes.reduce((a, n) => a + n.desktops, 0);
  const tiles = [
    { label: t('cl.nodes'), value: String(nodes.length), sub: fill(t('cl.onlineOf'), on.length) },
    { label: t('cl.cpu'), value: fill(t('cl.cores'), cores), sub: fill(t('cl.avgUse'), Math.round(cpuAvg)) },
    { label: t('cl.memory'), value: bytes(memTotal), sub: `${bytes(memUsed)} · ${Math.round(pct(memUsed, memTotal))}%` },
    { label: t('cl.storage'), value: storage ? bytes(stTotal) : '-', sub: storage ? `${bytes(stUsed)} · ${Math.round(pct(stUsed, stTotal))}%` : '' },
    { label: t('cl.guests'), value: String(guests), sub: fill(t('cl.runningOf'), running) },
    { label: t('cl.desktops'), value: String(desktops), sub: '' },
  ];
  return (
    <>
      <div className="stats">
        {tiles.map((x) => (
          <div key={x.label} className="stat static">
            <span className="stat-label">{x.label}</span>
            <span className="stat-value">{x.value}</span>
            {x.sub && <span className="stat-sub">{x.sub}</span>}
          </div>
        ))}
      </div>
      <div className="breakdown">
        <section className="panel">
          <h2 className="section-title">{t('cl.perNode')}</h2>
          <div className="meters">
            {nodes.map((n) => (
              <div key={n.node} className="meter-row">
                <span className="strong">{n.node}{!n.online && <span className="muted small"> · {t('cl.offline')}</span>}</span>
                <span className="muted small">{t('cl.cpu')}</span><Meter value={n.cpu_percent} label={`${Math.round(n.cpu_percent)}%`} />
                <span className="muted small">{t('cl.memory')}</span><Meter value={n.mem_percent} label={`${Math.round(n.mem_percent)}%`} />
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2 className="section-title">{t('cl.storageUse')}</h2>
          {storage === null ? <p className="muted small">-</p> : (
            <div className="meters">
              {storage.map((s) => (
                <div key={`${s.storage}/${s.nodes.join(',')}`} className="meter-row meter-row-1">
                  <span><span className="strong">{s.storage}</span>
                    <span className="muted small"> · {s.shared ? t('cl.shared') : s.nodes.join(', ')}</span></span>
                  <Meter value={pct(s.used, s.total)} label={`${Math.round(pct(s.used, s.total))}%`} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <p className="muted small">{t('cl.readOnly')}</p>
    </>
  );
}

// --- 노드 --------------------------------------------------------------------------

export function ClusterNodesPage() {
  const { t } = useI18n();
  const { current } = useCluster();
  const { nodes } = useClusterLoads(current?.id);
  return (
    <ClusterFrame reload={nodes.reload}>
      {() => (
        <LoadState value={nodes} retry={nodes.reload}>
          {(ns) => (
            <>
              <div className="table-scroll">
                <table className="table compact-head">
                  <thead>
                    <tr><th>{t('cl.node')}</th><th>{t('cl.status')}</th><th>{t('cl.cpu')}</th><th>{t('cl.memory')}</th>
                      <th className="num">{t('cl.guests')}</th><th className="num">{t('cl.desktops')}</th><th>{t('cl.uptime')}</th><th>{t('cl.version')}</th></tr>
                  </thead>
                  <tbody>
                    {ns.map((n) => (
                      <tr key={n.node}>
                        <td className="node-cell"><span className="strong">{n.node}</span>{n.cpu_model && <><br /><span className="muted small">{n.cpu_model}</span></>}</td>
                        <td className="nowrap">
                          <span className={`status ${n.online ? 'st-ready' : 'st-error'}`}><span className="dot" />{t(n.online ? 'cl.online' : 'cl.offline')}</span>
                          {n.maintenance && <span className="tag tag-soft">{t('cl.maintenance')}</span>}
                        </td>
                        <td>{n.online ? <><Meter value={n.cpu_percent} label={`${Math.round(n.cpu_percent)}%`} />
                          <span className="muted small">{fill(t('cl.cores'), n.cpus)}{n.loadavg[0] ? ` · ${t('cl.load')} ${n.loadavg.join(' ')}` : ''}</span></> : '-'}</td>
                        <td>{n.online ? <><Meter value={n.mem_percent} label={`${Math.round(n.mem_percent)}%`} />
                          <span className="muted small">{bytes(n.mem_used)} / {bytes(n.mem_total)}</span></> : '-'}</td>
                        <td className="num nowrap">{n.running} / {n.guests}</td>
                        <td className="num">{n.desktops}</td>
                        <td className="nowrap">{n.online ? uptime(n.uptime, t) : '-'}</td>
                        <td className="muted small">{n.version.replace('pve-manager/', 'PVE ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">{t('cl.readOnly')}</p>
            </>
          )}
        </LoadState>
      )}
    </ClusterFrame>
  );
}

// --- 스토리지 ----------------------------------------------------------------------

export function ClusterStoragePage() {
  const { t } = useI18n();
  const { current } = useCluster();
  const { storage } = useClusterLoads(current?.id);
  const content = (c: string) => (`content.${c}` in messages ? t(`content.${c}` as MessageKey) : c);
  return (
    <ClusterFrame reload={storage.reload}>
      {() => (
        <LoadState value={storage} retry={storage.reload}>
          {(ss) => (
            <>
              <div className="table-scroll">
                <table className="table compact-head">
                  <thead>
                    <tr><th>{t('cl.name')}</th><th>{t('cl.type')}</th><th>{t('cl.scope')}</th><th>{t('cl.content')}</th>
                      <th>{t('cl.usage')}</th><th>{t('cl.status')}</th></tr>
                  </thead>
                  <tbody>
                    {ss.map((s) => (
                      <tr key={`${s.storage}/${s.nodes.join(',')}`}>
                        <td className="strong nowrap">{s.storage}</td>
                        <td><code className="code">{s.type}</code></td>
                        <td>{s.shared ? t('cl.shared') : t('cl.local')}<br /><span className="muted small">{s.nodes.join(', ')}</span></td>
                        <td className="small">{s.content.map(content).join(', ')}</td>
                        <td>{s.total > 0 ? <><Meter value={pct(s.used, s.total)} label={`${Math.round(pct(s.used, s.total))}%`} />
                          <span className="muted small">{bytes(s.used)} / {bytes(s.total)}</span></> : '-'}</td>
                        <td className="nowrap">
                          <span className={`status ${s.status === 'available' ? 'st-ready' : 'st-error'}`}><span className="dot" />{t(s.status === 'available' ? 'cl.available' : 'cl.unavailable')}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">{t('cl.readOnly')}</p>
            </>
          )}
        </LoadState>
      )}
    </ClusterFrame>
  );
}
