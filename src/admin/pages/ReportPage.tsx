import { useCallback, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { Infra, RightSizing, Summary, UsageReport } from '../../api/types';
import { BRAND } from '../../brand';
import { useBranding } from '../../branding';
import { BrandLockup } from '../../components/Brand';
import { Legend, SERIES, TimeSeries, type Series } from '../../components/Charts';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { RightSizingSummary, RightSizingTable } from '../RightSizing';
import { bytes, useCluster } from './ClusterPages';

// 운영 > 운영 보고서 (PDF): one printable page for a period - the numbers, the infrastructure
// trend, the right-sizing proposals, desktop use and the alerts. "PDF로 저장" prints it
// (the browser's Save as PDF keeps the Korean type and the charts sharp).

type Bundle = { summary: Summary; infra: Infra; rs: RightSizing; usage: UsageReport };

export function ReportPage() {
  const { t } = useI18n();
  const { list, current, pick } = useCluster();
  const [days, setDays] = useState<7 | 30>(7);
  const cid = current?.id;
  const data = useLoad(useCallback(async (): Promise<Bundle> => {
    if (!cid) return new Promise<Bundle>(() => {});
    const [summary, infra, rs, usage] = await Promise.all([
      adminApi.summary(), adminApi.infra(cid, days === 7 ? '7d' : '30d'), adminApi.rightsizing(cid, days), adminApi.usage(days)]);
    return { summary, infra, rs, usage };
  }, [cid, days]), [cid, days]);

  return (
    <div className="report-wrap">
      <div className="toolbar no-print">
        {list.length > 1 && (
          <select aria-label={t('cl.pick')} value={cid} onChange={(e) => pick(e.target.value)}>
            {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <div className="seg" role="group" aria-label={t('inf.range')}>
          {([7, 30] as const).map((d) => (
            <button key={d} type="button" className={days === d ? 'on' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>{t(d === 7 ? 'inf.r7d' : 'inf.r30d')}</button>
          ))}
        </div>
        <button type="button" className="btn primary" disabled={data.state !== 'ok'} onClick={() => window.print()}>
          <Icon name="download" size={16} />{t('rep.pdf')}</button>
        <span className="muted small">{t('rep.pdfHint')}</span>
      </div>
      <LoadState value={data} retry={data.reload}>
        {(b) => <Report b={b} days={days} cluster={current?.name ?? ''} />}
      </LoadState>
    </div>
  );
}

function Report({ b, days, cluster }: { b: Bundle; days: number; cluster: string }) {
  const { t, lang, pick } = useI18n();
  const { b: brand } = useBranding();
  const loc = lang === 'ko' ? 'ko-KR' : 'en-US';
  const day = (ts: number) => new Date(ts * 1000).toLocaleDateString(loc, { month: 'numeric', day: 'numeric' });
  const full = (ts: number) => new Date(ts * 1000).toLocaleString(loc, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const { infra, rs, usage, summary } = b;
  const avg = (k: 'cpu_pct' | 'mem_pct') => infra.history.length ? infra.history.reduce((a, p) => a + p[k], 0) / infra.history.length : 0;
  const peak = (k: 'cpu_pct' | 'mem_pct') => Math.max(0, ...infra.history.map((p) => p[k]));
  const trend: Series[] = [
    { name: t('inf.cpu'), color: SERIES[0], points: infra.history.map((p) => ({ ts: p.ts, v: p.cpu_pct })) },
    { name: t('inf.mem'), color: SERIES[1], points: infra.history.map((p) => ({ ts: p.ts, v: p.mem_pct })) },
  ];
  const sessions: Series[] = [{ name: t('inf.sessions'), color: SERIES[0], points: infra.sessions.map((p) => ({ ts: p.ts, v: p.sessions })) }];
  const now = new Date();
  const from = new Date(now.getTime() - days * 86400e3);

  return (
    <article className="report">
      <header className="rep-head">
        <div className="rep-brand"><BrandLockup markSize={30} /></div>
        <div>
          <h1>{t('rep.title')}</h1>
          <p className="muted">{cluster} · {from.toLocaleDateString(loc)} – {now.toLocaleDateString(loc)} ({t(days === 7 ? 'inf.r7d' : 'inf.r30d')})</p>
        </div>
        <p className="muted small rep-made">{t('rep.made').replace('{when}', now.toLocaleString(loc))}</p>
      </header>

      <section className="rep-sec">
        <h2>{t('rep.overview')}</h2>
        <div className="rep-kpis">
          <Kpi label={t('inf.health')} value={infra.health.score == null ? '-' : String(infra.health.score)} />
          <Kpi label={t('rep.cpuAvg')} value={`${avg('cpu_pct').toFixed(1)}%`} sub={t('rep.peak').replace('{n}', `${peak('cpu_pct').toFixed(0)}%`)} />
          <Kpi label={t('rep.memAvg')} value={`${avg('mem_pct').toFixed(1)}%`} sub={t('rep.peak').replace('{n}', `${peak('mem_pct').toFixed(0)}%`)} />
          <Kpi label={t('rep.desktops')} value={String(summary.desktops.total)} sub={t('rep.pools').replace('{n}', String(summary.pools.total))} />
          <Kpi label={t('rep.sessions')} value={String(usage.totals.sessions)} sub={t('rep.hours').replace('{n}', usage.totals.hours.toFixed(0))} />
          <Kpi label={t('rep.users')} value={String(usage.totals.users)} sub={t('rep.peakUsers').replace('{n}', String(usage.totals.peak))} />
        </div>
      </section>

      <section className="rep-sec">
        <h2>{t('inf.clusterTrend')}</h2>
        <Legend series={trend.map((s) => ({ name: s.name, color: s.color }))} />
        <TimeSeries series={trend} unit="%" max={100} area height={180} fmtTime={(ts, short) => (short ? day(ts) : full(ts))} empty={<span className="muted small">{t('inf.noHistory')}</span>} />
      </section>

      <section className="rep-sec">
        <h2>{t('rs.title')}</h2>
        <p className="muted small">{t('rs.basis').replace('{d}', String(rs.days))}</p>
        <RightSizingSummary r={rs} />
        <RightSizingTable r={rs} links={false} />
      </section>

      <section className="rep-sec rep-two">
        <div>
          <h2>{t('inf.sessionTrend')}</h2>
          <TimeSeries series={sessions} area height={160} fmtTime={(ts, short) => (short ? day(ts) : full(ts))} empty={<span className="muted small">{t('inf.noHistory')}</span>} />
        </div>
        <div>
          <h2>{t('rep.byPool')}</h2>
          <table className="table compact-head">
            <thead><tr><th>{t('rep.pool')}</th><th className="num">{t('rep.sessions')}</th><th className="num">{t('rep.hoursCol')}</th><th className="num">{t('rep.util')}</th></tr></thead>
            <tbody>
              {usage.by_pool.map((p) => (
                <tr key={p.id}><td>{p.name}</td><td className="num">{p.sessions}</td><td className="num">{p.hours.toFixed(1)}</td><td className="num">{Math.round(p.utilization)}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rep-sec rep-two">
        <div>
          <h2>{t('inf.storage')}</h2>
          <table className="table compact-head">
            <thead><tr><th>{t('rep.storage')}</th><th className="num">{t('rep.used')}</th><th className="num">%</th></tr></thead>
            <tbody>
              {infra.storages.map((s) => (
                <tr key={`${s.node}/${s.storage}`}><td>{s.storage} <span className="muted small">{s.node ?? t('inf.shared')}</span></td>
                  <td className="num">{bytes(s.used)} / {bytes(s.total)}</td><td className="num">{s.total ? Math.round((s.used / s.total) * 100) : 0}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2>{t('inf.alerts')}</h2>
          {infra.alerts.length === 0 ? <p className="muted small">{t('inf.noAlerts')}</p> : (
            <ul className="alert-list">
              {infra.alerts.map((a) => <li key={a.id}><span className={`sev-chip sev-${a.severity}`}>{t(`inf.sev.${a.severity}` as MessageKey) || a.severity}</span><span className="alert-msg">{a.message}<span className="muted small">{a.target_name}</span></span></li>)}
            </ul>
          )}
          {infra.health.issues.length > 0 && <><div className="field-label">{t('inf.issues')}</div><ul className="small">{infra.health.issues.map((i) => <li key={i}>{i}</li>)}</ul></>}
        </div>
      </section>

      <footer className="rep-foot muted small">{brand.footerText || `© ${now.getFullYear()} ${pick(BRAND.company)} · ${BRAND.productName}`}</footer>
    </article>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rep-kpi"><span className="rep-kpi-l">{label}</span><span className="rep-kpi-v">{value}</span>{sub && <span className="rep-kpi-s">{sub}</span>}</div>;
}
