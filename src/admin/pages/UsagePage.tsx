import { useCallback, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { UsageDay, UsageReport } from '../../api/types';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';

const PERIODS = [7, 30, 90];
const fill = (s: string, n: number | string) => s.replace('{n}', String(n));
const hrs = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString();

// 운영 > 사용률 보고서: sessions per day, pool and user over the last 7/30/90 days.
export function UsagePage() {
  const { t } = useI18n();
  const [days, setDays] = useState(7);
  const [poolId, setPoolId] = useState('');
  const pools = useLoad(adminApi.pools);
  const report = useLoad(useCallback(() => adminApi.usage(days, poolId || undefined), [days, poolId]), [days, poolId]);

  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label={t('usage.days').replace('{n}', '')}>
          {PERIODS.map((n) => (
            <button key={n} type="button" className={n === days ? 'on' : ''} aria-pressed={n === days} onClick={() => setDays(n)}>
              {fill(t('usage.days'), n)}
            </button>
          ))}
        </div>
        <select aria-label={t('usage.pool')} value={poolId} onChange={(e) => setPoolId(e.target.value)}>
          <option value="">{t('usage.pool')}: {t('common.all')}</option>
          {pools.state === 'ok' && pools.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className="btn" onClick={report.reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
        {report.state === 'ok' && (
          <button type="button" className="btn" onClick={() => downloadCsv(report.data)}>{t('usage.csv')}</button>
        )}
      </div>

      <LoadState value={report} retry={report.reload}>
        {(r) => (
          <>
            <div className="stats">
              <Stat label={t('usage.sessions')} value={r.totals.sessions.toLocaleString()} sub={fill(t('usage.openNow'), r.totals.open)} />
              <Stat label={t('usage.users')} value={r.totals.users.toLocaleString()} />
              <Stat label={t('usage.hours')} value={fill(t('usage.hoursUnit'), hrs(r.totals.hours))} />
              <Stat label={t('usage.avg')} value={fill(t('usage.minUnit'), Math.round(r.totals.avg_minutes))} />
              <Stat label={t('usage.peak')} value={r.totals.peak.toLocaleString()} />
            </div>
            {r.totals.sessions === 0 && <div className="empty"><p>{t('usage.empty')}</p></div>}
            <DayChart days={r.by_day} />
            <div className="breakdown">
              <PoolTable r={r} />
              <UserTable r={r} />
            </div>
            <p className="muted small">
              {t('usage.protocols')}: {Object.entries(r.by_protocol).map(([k, n]) => `${k.toUpperCase()} ${n}`).join(' · ') || '-'}
            </p>
            <p className="muted small">{fill(t('usage.note'), r.open_session_cap_hours)}</p>
          </>
        )}
      </LoadState>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat static">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

// One series (hours per day) as columns of one hue; hover shows the day's numbers.
function DayChart({ days }: { days: UsageDay[] }) {
  const { t, lang } = useI18n();
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...days.map((d) => d.hours)));
  const label = (iso: string, long = false) => new Date(`${iso}T00:00:00`).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US',
    long ? { month: 'short', day: 'numeric', weekday: 'short' } : { month: 'numeric', day: 'numeric' });
  const every = Math.ceil(days.length / 10);   // keep axis labels apart
  const h = hover === null ? null : days[hover];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="section-title">{t('usage.perDay')}</h2>
        <button type="button" className="btn small-btn" style={{ marginLeft: 'auto' }} onClick={() => setAsTable(!asTable)}>
          {t(asTable ? 'usage.asChart' : 'usage.asTable')}
        </button>
      </div>
      {asTable ? (
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>{t('usage.date')}</th><th>{t('usage.hours')}</th><th>{t('usage.sessions')}</th><th>{t('usage.users')}</th><th>{t('usage.peak')}</th></tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}><td>{label(d.date, true)}</td><td className="num">{hrs(d.hours)}</td>
                  <td className="num">{d.sessions}</td><td className="num">{d.users}</td><td className="num">{d.peak}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="colchart" onMouseLeave={() => setHover(null)}>
          <div className="colchart-axis" aria-hidden="true">
            {[1, 0.5, 0].map((f) => <span key={f}>{fill(t('usage.hoursUnit'), hrs(max * f))}</span>)}
          </div>
          <div className="colchart-plot">
            {[0, 0.5, 1].map((f) => <span key={f} className="colchart-grid" style={{ bottom: `${f * 100}%` }} />)}
            {days.map((d, i) => (
              <div key={d.date} className={`colchart-slot${hover === i ? ' on' : ''}`} onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)} tabIndex={0}
                aria-label={`${label(d.date, true)}: ${fill(t('usage.hoursUnit'), hrs(d.hours))}, ${t('usage.sessions')} ${d.sessions}`}>
                <span className="colchart-col" style={{ height: d.hours > 0 ? `max(2px, ${(d.hours / max) * 100}%)` : 0 }} />
                {i % every === 0 && <span className="colchart-x">{label(d.date)}</span>}
              </div>
            ))}
            {h && hover !== null && (
              <div className="tip" style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}>
                <strong>{label(h.date, true)}</strong>
                <span>{t('usage.hours')} <b>{fill(t('usage.hoursUnit'), hrs(h.hours))}</b></span>
                <span>{t('usage.sessions')} <b>{h.sessions}</b> · {t('usage.users')} <b>{h.users}</b></span>
                <span>{t('usage.peak')} <b>{h.peak}</b></span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

function PoolTable({ r }: { r: UsageReport }) {
  const { t } = useI18n();
  return (
    <section className="panel">
      <h2 className="section-title">{t('usage.byPool')}</h2>
      {r.by_pool.length === 0 ? <p className="muted small">{t('sum.empty')}</p> : (
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>{t('usage.pool')}</th><th>{t('usage.desktops')}</th><th>{t('usage.hours')}</th><th>{t('usage.utilization')}</th></tr></thead>
            <tbody>
              {r.by_pool.map((p) => (
                <tr key={p.id}>
                  <td><span className="strong">{p.name}</span><br /><span className="muted small">{t(`pooltype.${p.type}` as MessageKey)}</span></td>
                  <td className="num">{p.desktops}</td>
                  <td className="num">{hrs(p.hours)}</td>
                  <td>
                    <span className="util">
                      <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(1, p.utilization) * 100}%` }} /></span>
                      <span className="bar-n">{(p.utilization * 100).toFixed(p.utilization < 0.1 ? 1 : 0)}%</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function UserTable({ r }: { r: UsageReport }) {
  const { t, lang } = useI18n();
  const when = (iso: string) => new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <section className="panel">
      <h2 className="section-title">{t('usage.topUsers')}</h2>
      {r.top_users.length === 0 ? <p className="muted small">{t('sum.empty')}</p> : (
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>{t('usage.users')}</th><th>{t('usage.sessions')}</th><th>{t('usage.hours')}</th><th>{t('usage.last')}</th></tr></thead>
            <tbody>
              {r.top_users.map((u) => (
                <tr key={u.username}>
                  <td className="strong">{u.username}</td><td className="num">{u.sessions}</td>
                  <td className="num">{hrs(u.hours)}</td><td className="muted small nowrap">{when(u.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function downloadCsv(r: UsageReport) {
  const q = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [
    ['section', 'key', 'sessions', 'users', 'hours', 'peak_or_utilization'],
    ...r.by_day.map((d) => ['day', d.date, d.sessions, d.users, d.hours, d.peak]),
    ...r.by_pool.map((p) => ['pool', p.name, p.sessions, p.users, p.hours, p.utilization]),
    ...r.top_users.map((u) => ['user', u.username, u.sessions, '', u.hours, '']),
  ];
  const blob = new Blob(['﻿' + rows.map((x) => x.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vlab-usage-${r.days}d-${r.to.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
