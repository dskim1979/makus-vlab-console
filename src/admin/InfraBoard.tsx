import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/admin';
import type { Infra, InfraRange } from '../api/types';
import { Gauge, Legend, SERIES, Sparkline, TimeSeries, type Series } from '../components/Charts';
import { Icon } from '../components/Icon';
import { LoadState } from '../components/LoadState';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { bytes, Meter, useCluster } from './pages/ClusterPages';
import { RightSizingSummary, RightSizingTable } from './RightSizing';

// Infrastructure monitoring on the dashboard, panel by panel like the engine's own
// dashboard and its Grafana board: health score, CPU / memory / VMs / sessions with their
// trend, the cluster and per-node history from the 5-minute snapshots, nodes, storage and
// the alerts that are firing. One read: GET /api/vlab/admin/clusters/<id>/infra.

const RANGES: { id: InfraRange; key: MessageKey }[] = [
  { id: '24h', key: 'inf.r24h' }, { id: '7d', key: 'inf.r7d' }, { id: '30d', key: 'inf.r30d' },
];
const REFRESH_MS = 30_000;

export function InfraBoard() {
  const { t } = useI18n();
  const { list, current, pick } = useCluster();
  const [range, setRange] = useState<InfraRange>('24h');
  const [auto, setAuto] = useState(true);
  const cid = current?.id;
  const data = useLoad(useCallback(() => (cid ? adminApi.infra(cid, range) : new Promise<Infra>(() => {})), [cid, range]), [cid, range]);
  const { reload } = data;
  useEffect(() => {
    if (!auto) return;
    const h = setInterval(reload, REFRESH_MS);
    return () => clearInterval(h);
  }, [auto, reload]);

  if (!list.length) return null;
  return (
    <section className="infra" aria-labelledby="infra-title">
      <div className="infra-head">
        <h2 id="infra-title" className="section-title">{t('inf.title')}</h2>
        <div className="infra-controls">
          {list.length > 1 && (
            <select aria-label={t('cl.pick')} value={cid} onChange={(e) => pick(e.target.value)}>
              {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="seg" role="group" aria-label={t('inf.range')}>
            {RANGES.map((r) => (
              <button key={r.id} type="button" className={range === r.id ? 'on' : ''} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{t(r.key)}</button>
            ))}
          </div>
          <label className="check-inline small"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />{t('inf.auto')}</label>
          <button type="button" className="btn" onClick={reload} aria-label={t('common.refresh')}><Icon name="refresh" size={16} /></button>
        </div>
      </div>
      <LoadState value={data} retry={reload}>
        {(d) => <Panels d={d} />}
      </LoadState>
      <RightSizingPanel cid={cid} days={range === '30d' ? 30 : 7} />
    </section>
  );
}

function Panels({ d }: { d: Infra }) {
  const { t, lang } = useI18n();
  const loc = lang === 'ko' ? 'ko-KR' : 'en-US';
  const fmtTime = (ts: number, short: boolean) => {
    const dt = new Date(ts * 1000);
    if (short) return dt.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: false });
    return dt.toLocaleString(loc, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  };
  const axisTime = (ts: number, short: boolean) => short ? fmtTime(ts, true)
    : new Date(ts * 1000).toLocaleDateString(loc, { month: 'numeric', day: 'numeric' });
  const empty = <span className="muted small">{t('inf.noHistory')}</span>;

  const online = d.nodes.filter((n) => n.status === 'online');
  const avg = (k: 'cpu_pct' | 'mem_pct') => online.length ? online.reduce((a, n) => a + n[k], 0) / online.length : 0;
  const memUsed = online.reduce((a, n) => a + n.mem_used, 0), memTotal = online.reduce((a, n) => a + n.mem_total, 0);
  const last = d.history[d.history.length - 1];
  const nowSessions = d.sessions[d.sessions.length - 1]?.sessions ?? 0;
  const peakSessions = Math.max(0, ...d.sessions.map((s) => s.sessions));

  const cluster: Series[] = [
    { name: t('inf.cpu'), color: SERIES[0], points: d.history.map((p) => ({ ts: p.ts, v: p.cpu_pct })) },
    { name: t('inf.mem'), color: SERIES[1], points: d.history.map((p) => ({ ts: p.ts, v: p.mem_pct })) },
  ];
  const nodeNames = Object.keys(d.node_history);
  const perNode: Series[] = nodeNames.map((n, i) => ({ name: n, color: SERIES[i % SERIES.length], points: d.node_history[n].map((p) => ({ ts: p.ts, v: p.cpu })) }));
  const sessions: Series[] = [{ name: t('inf.sessions'), color: SERIES[0], points: d.sessions.map((p) => ({ ts: p.ts, v: p.sessions })) }];

  return (
    <div className="pgrid">
      <div className="stat-row">
      <Panel className="stat-panel" title={t('inf.health')} to="/admin/cluster/overview">
        <Gauge value={d.health.score} label={t('inf.health')} />
        <div className={`stat-sub band-${d.health.band ?? 'none'}`}>{d.health.band ? t(`inf.band.${d.health.band}` as MessageKey) : t('inf.noScore')}</div>
      </Panel>
      <Stat title={t('inf.cpu')} value={`${avg('cpu_pct').toFixed(1)}%`} sub={t('inf.nodesOnline').replace('{n}', String(online.length)).replace('{total}', String(d.nodes.length))}
        spark={d.history.map((p) => p.cpu_pct)} color={SERIES[0]} max={100} />
      <Stat title={t('inf.mem')} value={`${avg('mem_pct').toFixed(1)}%`} sub={memTotal ? `${bytes(memUsed)} / ${bytes(memTotal)}` : ''}
        spark={d.history.map((p) => p.mem_pct)} color={SERIES[1]} max={100} />
      <Stat title={t('inf.vms')} value={String(last?.vms_running ?? '-')} sub={t('inf.vmsSub')} spark={d.history.map((p) => p.vms_running)} color={SERIES[3]} />
      <Stat title={t('inf.sessionsNow')} value={String(nowSessions)} sub={t('inf.peak').replace('{n}', String(peakSessions))}
        spark={d.sessions.map((p) => p.sessions)} color={SERIES[0]} />
      </div>

      <Panel className="span-8" title={t('inf.clusterTrend')}>
        <Legend series={cluster.map((s) => ({ ...s, value: s.points.length ? `${s.points[s.points.length - 1].v.toFixed(1)}%` : undefined }))} />
        <TimeSeries series={cluster} unit="%" max={100} area fmtTime={(ts, s) => (s ? axisTime(ts, true) : fmtTime(ts, false))} empty={empty} />
      </Panel>
      <Panel className="span-4" title={t('inf.alerts')} to="/admin/ops/alerts" count={d.alerts.length}>
        {d.alerts.length === 0 ? (
          <div className="all-clear"><span className="hdot ok" aria-hidden="true" />{t('inf.noAlerts')}</div>
        ) : (
          <ul className="alert-list">
            {d.alerts.map((a) => (
              <li key={a.id} className={`sev-${a.severity}`}>
                <span className={`sev-chip sev-${a.severity}`}>{t(`inf.sev.${a.severity}` as MessageKey) || a.severity}</span>
                <span className="alert-msg">{a.message}<span className="muted small">{a.target_name}{a.triggered_at ? ` · ${fmtTime(Date.parse(a.triggered_at) / 1000, false)}` : ''}</span></span>
              </li>
            ))}
          </ul>
        )}
        {d.health.issues.length > 0 && (
          <div className="issues">
            <div className="field-label">{t('inf.issues')}</div>
            <ul>{d.health.issues.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
        )}
      </Panel>

      <Panel className="span-6" title={t('inf.nodeCpu')}>
        <Legend series={perNode.map((s) => ({ name: s.name, color: s.color }))} />
        <TimeSeries series={perNode} unit="%" max={100} fmtTime={(ts, s) => (s ? axisTime(ts, true) : fmtTime(ts, false))} empty={empty} />
      </Panel>
      <Panel className="span-6" title={t('inf.sessionTrend')} to="/admin/ops/sessions">
        <Legend series={[{ name: t('inf.sessions'), color: SERIES[0], value: String(nowSessions) }]} />
        <TimeSeries series={sessions} area fmtTime={(ts, s) => (s ? axisTime(ts, true) : fmtTime(ts, false))} empty={empty} />
      </Panel>

      <Panel className="span-8" title={t('inf.nodes')} to="/admin/cluster/nodes">
        <div className="table-scroll">
          <table className="table compact-head">
            <thead><tr><th>{t('inf.node')}</th><th>{t('inf.state')}</th><th>CPU</th><th>{t('inf.mem')}</th><th>{t('inf.disk')}</th><th className="num">{t('inf.uptime')}</th></tr></thead>
            <tbody>
              {d.nodes.map((n) => (
                <tr key={n.name}>
                  <td className="strong">{n.name}</td>
                  <td><span className={`state-dot ${n.status === 'online' ? 'ok' : 'bad'}`} />{t(n.status === 'online' ? 'inf.online' : 'inf.offline')}</td>
                  <td><Meter value={n.cpu_pct} label={`${n.cpu_pct.toFixed(0)}%`} /></td>
                  <td><Meter value={n.mem_pct} label={`${n.mem_pct.toFixed(0)}%`} /></td>
                  <td><Meter value={n.disk_pct} label={`${n.disk_pct.toFixed(0)}%`} /></td>
                  <td className="num nowrap">{n.uptime ? t('inf.days').replace('{n}', String(Math.floor(n.uptime / 86400))) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel className="span-4" title={t('inf.storage')} to="/admin/cluster/storage">
        <div className="meters">
          {d.storages.map((s) => {
            const pct = s.total ? (s.used / s.total) * 100 : 0;
            return (
              <div key={`${s.node}/${s.storage}`} className="meter-row meter-row-1">
                <span><span className="strong">{s.storage}</span> <span className="muted small">{s.node ?? t('inf.shared')} · {s.type}</span>
                  <br /><span className="muted small">{bytes(s.used)} / {bytes(s.total)}</span></span>
                <Meter value={pct} label={`${Math.round(pct)}%`} />
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function RightSizingPanel({ cid, days }: { cid?: string; days: 7 | 30 }) {
  const { t } = useI18n();
  const rs = useLoad(useCallback(() => (cid ? adminApi.rightsizing(cid, days) : new Promise<never>(() => {})), [cid, days]), [cid, days]);
  return (
    <div className="pgrid rs-grid">
      <Panel className="span-12" title={`${t('rs.title')} · ${t('rs.basis').replace('{d}', String(days))}`} to="/admin/ops/report">
        <LoadState value={rs} retry={rs.reload}>
          {(r) => (
            <div className="rs-body">
              <RightSizingSummary r={r} />
              <RightSizingTable r={r} limit={6} />
            </div>
          )}
        </LoadState>
      </Panel>
    </div>
  );
}

function Panel({ title, className, to, count, children }: { title: string; className?: string; to?: string; count?: number; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className={`pnl ${className ?? ''}`}>
      <header className="pnl-head">
        <h3>{title}{count != null && count > 0 && <span className="pnl-count">{count}</span>}</h3>
        {to && <Link to={to} className="pnl-link" aria-label={`${title} ${t('inf.more')}`}><Icon name="chevron" size={14} /></Link>}
      </header>
      <div className="pnl-body">{children}</div>
    </section>
  );
}

function Stat({ title, value, sub, spark, color, max }: { title: string; value: string; sub: string; spark: number[]; color: string; max?: number }) {
  return (
    <Panel className="stat-panel" title={title}>
      <div className="stat-big">{value}</div>
      <div className="stat-sub">{sub}</div>
      <Sparkline points={spark} color={color} max={max} />
    </Panel>
  );
}
