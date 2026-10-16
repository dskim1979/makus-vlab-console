import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/admin';
import type { Infra, InfraRange, Summary } from '../api/types';
import { Legend, SERIES, Sparkline, TimeSeries, type Series } from '../components/Charts';
import { Icon } from '../components/Icon';
import { LoadState } from '../components/LoadState';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { bytes, useCluster } from './pages/ClusterPages';
import { RightSizingSummary, RightSizingTable } from './RightSizing';

// The dashboard on one screen (1440 x 900 and up), like the engine's own dashboard and its
// Grafana board: one strip of numbers with their trend, then two rows of panels - the
// cluster and per-node history, the alerts, right-sizing, nodes and storage.
// One read for the monitoring part: GET /api/vlab/admin/clusters/<id>/infra.

const RANGES: { id: InfraRange; key: MessageKey }[] = [
  { id: '24h', key: 'inf.r24h' }, { id: '7d', key: 'inf.r7d' }, { id: '30d', key: 'inf.r30d' },
];
const REFRESH_MS = 30_000;

export function InfraBoard({ s, onRefresh }: { s: Summary; onRefresh: () => void }) {
  const { t } = useI18n();
  const { list, current, pick } = useCluster();
  const [range, setRange] = useState<InfraRange>('24h');
  const [auto, setAuto] = useState(true);
  const cid = current?.id;
  const data = useLoad(useCallback(() => (cid ? adminApi.infra(cid, range) : new Promise<Infra>(() => {})), [cid, range]), [cid, range]);
  const days = range === '30d' ? 30 : 7;
  const rs = useLoad(useCallback(() => (cid ? adminApi.rightsizing(cid, days) : new Promise<never>(() => {})), [cid, days]), [cid, days]);
  const reload = data.reload, reloadRs = rs.reload;
  const refresh = useCallback(() => { reload(); reloadRs(); onRefresh(); }, [reload, reloadRs, onRefresh]);
  useEffect(() => {
    if (!auto) return;
    const h = setInterval(reload, REFRESH_MS);
    return () => clearInterval(h);
  }, [auto, reload]);

  return (
    <>
      <header className="dash-head">
        <h1>{t('nav.dashboard')}</h1>
        <div className="dash-controls">
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
          <button type="button" className="btn" onClick={refresh} aria-label={t('common.refresh')} title={t('common.refresh')}><Icon name="refresh" size={16} /></button>
          <Link to="/admin/pools/list" className="btn primary"><Icon name="plus" size={16} />{t('dash.qPool')}</Link>
        </div>
      </header>
      {!list.length ? <Strip s={s} /> : (
        <LoadState value={data} retry={reload}>
          {(d) => <Board d={d} s={s} rs={rs} />}
        </LoadState>
      )}
    </>
  );
}

function useFmt() {
  const { lang } = useI18n();
  const loc = lang === 'ko' ? 'ko-KR' : 'en-US';
  const full = (ts: number) => new Date(ts * 1000).toLocaleString(loc, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const axis = (ts: number, short: boolean) => short
    ? new Date(ts * 1000).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: false })
    : new Date(ts * 1000).toLocaleDateString(loc, { month: 'numeric', day: 'numeric' });
  return { full, chart: (ts: number, short: boolean) => (short ? axis(ts, true) : full(ts)), axis };
}

// Without a cluster: the counts alone.
function Strip({ s, d }: { s: Summary; d?: Infra }) {
  const { t } = useI18n();
  const online = d ? d.nodes.filter((n) => n.status === 'online') : [];
  const avg = (k: 'cpu_pct' | 'mem_pct') => online.length ? online.reduce((a, n) => a + n[k], 0) / online.length : 0;
  const memUsed = online.reduce((a, n) => a + n.mem_used, 0), memTotal = online.reduce((a, n) => a + n.mem_total, 0);
  const last = d?.history[d.history.length - 1];
  const nowSessions = d?.sessions[d.sessions.length - 1]?.sessions ?? s.desktops.in_session;
  const band = d?.health.band;
  return (
    <div className="kstrip">
      {d && (
        <KCell label={t('inf.health')} to="/admin/cluster/overview" tone={band ? `band-${band}` : ''}
          value={d.health.score == null ? '-' : String(d.health.score)} sub={band ? t(`inf.band.${band}` as MessageKey) : t('inf.noScore')} />
      )}
      {d && (
        <KCell label={t('inf.cpu')} value={`${avg('cpu_pct').toFixed(1)}%`}
          sub={t('inf.nodesOnline').replace('{n}', String(online.length)).replace('{total}', String(d.nodes.length))}
          spark={d.history.map((p) => p.cpu_pct)} color={SERIES[0]} max={100} />
      )}
      {d && (
        <KCell label={t('inf.mem')} value={`${avg('mem_pct').toFixed(1)}%`} sub={memTotal ? `${bytes(memUsed)} / ${bytes(memTotal)}` : ''}
          spark={d.history.map((p) => p.mem_pct)} color={SERIES[1]} max={100} />
      )}
      {d && <KCell label={t('inf.vms')} value={String(last?.vms_running ?? '-')} sub={t('inf.vmsSub')} spark={d.history.map((p) => p.vms_running)} color={SERIES[3]} />}
      <KCell label={t('inf.sessionsNow')} to="/admin/ops/sessions" value={String(nowSessions)}
        sub={t('sum.sessionsToday').replace('{n}', String(s.sessions_today))}
        spark={d?.sessions.map((p) => p.sessions)} color={SERIES[0]} />
      <KCell label={t('sum.desktops')} to="/admin/pools/status" value={String(s.desktops.total)}
        sub={`${t('sum.assignedOf').replace('{n}', String(s.desktops.assigned))} · ${t('dash.pools').replace('{n}', String(s.pools.total))}`} />
      <KCell label={t('sum.users')} to="/admin/users/list" value={String(s.users.total)} sub={t('sum.enabledOf').replace('{n}', String(s.users.enabled))} />
      {d && (
        <KCell label={t('inf.alerts')} to="/admin/ops/alerts" value={String(d.alerts.length)}
          tone={d.alerts.some((a) => a.severity === 'critical') ? 'band-critical' : d.alerts.length ? 'band-warning' : 'band-good'}
          sub={d.alerts.length ? t('dash.alertsOpen') : t('dash.alertsNone')} />
      )}
    </div>
  );
}

function KCell({ label, value, sub, to, tone = '', spark, color, max }: {
  label: string; value: string; sub?: string; to?: string; tone?: string; spark?: number[]; color?: string; max?: number;
}) {
  const body = (
    <>
      <span className="kcell-l">{label}</span>
      <span className={`kcell-v ${tone}`}>{value}</span>
      {sub && <span className="kcell-s">{sub}</span>}
      {spark && color && <Sparkline points={spark} color={color} max={max} />}
    </>
  );
  return to ? <Link to={to} className="kcell">{body}</Link> : <div className="kcell">{body}</div>;
}

function Board({ d, s, rs }: { d: Infra; s: Summary; rs: ReturnType<typeof useLoad<import('../api/types').RightSizing>> }) {
  const { t } = useI18n();
  const f = useFmt();
  const empty = <span className="muted small">{t('inf.noHistory')}</span>;
  const cluster: Series[] = [
    { name: t('inf.cpu'), color: SERIES[0], points: d.history.map((p) => ({ ts: p.ts, v: p.cpu_pct })) },
    { name: t('inf.mem'), color: SERIES[1], points: d.history.map((p) => ({ ts: p.ts, v: p.mem_pct })) },
  ];
  const perNode: Series[] = Object.keys(d.node_history).map((n, i) => ({
    name: n, color: SERIES[i % SERIES.length], points: d.node_history[n].map((p) => ({ ts: p.ts, v: p.cpu })) }));

  return (
    <>
      <Strip s={s} d={d} />
      <div className="dgrid row-b">
        <Panel className="c5" title={t('inf.clusterTrend')}>
          <Legend series={cluster.map((x) => ({ ...x, value: x.points.length ? `${x.points[x.points.length - 1].v.toFixed(1)}%` : undefined }))} />
          <TimeSeries series={cluster} unit="%" max={100} area height={168} fmtTime={f.chart} empty={empty} />
        </Panel>
        <Panel className="c4" title={t('inf.nodeCpu')} to="/admin/cluster/nodes">
          <Legend series={perNode.map((x) => ({ name: x.name, color: x.color }))} />
          <TimeSeries series={perNode} unit="%" max={100} height={168} fmtTime={f.chart} empty={empty} />
        </Panel>
        <Panel className="c3" title={t('inf.alerts')} to="/admin/ops/alerts" count={d.alerts.length}>
          {d.alerts.length === 0 ? (
            <div className="all-clear"><span className="hdot ok" aria-hidden="true" />{t('inf.noAlerts')}</div>
          ) : (
            <ul className="alert-list">
              {d.alerts.map((a) => (
                <li key={a.id}>
                  <span className={`sev-chip sev-${a.severity}`}>{t(`inf.sev.${a.severity}` as MessageKey) || a.severity}</span>
                  <span className="alert-msg">{a.message}<span className="muted small">{a.target_name}{a.triggered_at ? ` · ${f.full(Date.parse(a.triggered_at) / 1000)}` : ''}</span></span>
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
      </div>
      <div className="dgrid row-c">
        <Panel className="c5" title={`${t('rs.title')} · ${t('rs.basis').replace('{d}', String(rs.state === 'ok' ? rs.data.days : ''))}`} to="/admin/ops/report">
          <LoadState value={rs} retry={rs.reload}>
            {(r) => <div className="rs-body"><RightSizingSummary r={r} /><RightSizingTable r={r} limit={4} compact /></div>}
          </LoadState>
        </Panel>
        <Panel className="c4" title={t('inf.nodes')} to="/admin/cluster/nodes">
          <div className="nlist">
            <div className="nrow nhead"><span>{t('inf.node')}</span><span>CPU</span><span>{t('inf.mem')}</span><span>{t('inf.disk')}</span></div>
            {d.nodes.map((n) => (
              <div key={n.name} className="nrow">
                <span className="strong"><span className={`state-dot ${n.status === 'online' ? 'ok' : 'bad'}`} />{n.name}</span>
                <Bar v={n.cpu_pct} /><Bar v={n.mem_pct} /><Bar v={n.disk_pct} />
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="c3" title={t('inf.storage')} to="/admin/cluster/storage">
          <div className="slist">
            {d.storages.map((x) => {
              const pct = x.total ? (x.used / x.total) * 100 : 0;
              return (
                <div key={`${x.node}/${x.storage}`} className="srow" title={`${bytes(x.used)} / ${bytes(x.total)}`}>
                  <span className="srow-name"><span className="strong">{x.storage}</span> <span className="muted small">{x.node ?? t('inf.shared')}</span></span>
                  <Bar v={pct} />
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </>
  );
}

function Bar({ v }: { v: number }) {
  const tone = v >= 90 ? 'hot' : v >= 75 ? 'warm' : '';
  return (
    <span className={`mbar ${tone}`} title={`${v.toFixed(1)}%`}>
      <span className="mbar-track"><span className="mbar-fill" style={{ width: `${Math.min(100, v)}%` }} /></span>
      <span className="mbar-n">{Math.round(v)}%</span>
    </span>
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
