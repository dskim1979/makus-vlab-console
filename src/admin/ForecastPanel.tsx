import { useCallback, useState } from 'react';
import { forecastApi, type Forecast, type ForecastLevel } from '../api/forecast';
import { Sparkline } from '../components/Charts';
import { LoadState } from '../components/LoadState';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';
import { useCluster } from './pages/ClusterPages';

// 대시보드 > 증설 예측: a straight line through the daily numbers of the cluster and the day each
// metric would reach its threshold (pegaprox/vlab/forecast.py). Worst first.

const TONE: Record<ForecastLevel, string> = { now: 'chip chip-warn', soon: 'chip chip-warn', watch: 'chip chip-accent', ok: 'chip chip-on', unknown: 'chip' };
const COLOR: Record<ForecastLevel, string> = { now: 'var(--danger, #e5484d)', soon: 'var(--warn, #f0a35e)', watch: 'var(--accent, #53b1b1)', ok: 'var(--ok, #46a758)', unknown: 'var(--muted, #8a9ab4)' };

export function ForecastPanel() {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const { current } = useCluster();
  const cid = current?.id;
  const [days, setDays] = useState<30 | 90 | 180>(90);
  const data = useLoad(useCallback(() => (cid ? forecastApi.get(cid, days) : new Promise<Forecast>(() => {})), [cid, days]), [cid, days]);
  const LEVEL: Record<ForecastLevel, string> = { now: L('지금 넘음', 'over now'), soon: L('90일 안', 'within 90 d'), watch: L('1년 안', 'within a year'),
    ok: L('여유', 'fine'), unknown: L('기록 부족', 'not enough data') };
  const dateText = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '-');
  if (!cid) return null;
  return (
    <section className="card forecast">
      <div className="card-head">
        <h2 className="card-title">{L('증설 예측', 'Growth forecast')}</h2>
        <div className="segmented small" role="tablist">
          {([30, 90, 180] as const).map((d) => (
            <button key={d} type="button" role="tab" className={days === d ? 'on' : ''} aria-selected={days === d} onClick={() => setDays(d)}>{L(`${d}일`, `${d} d`)}</button>))}
        </div>
      </div>
      <LoadState value={data} retry={data.reload}>
        {(f) => (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>{f.points < f.min_points
              ? L(`하루 한 번 기록을 쌓는 중입니다 (${f.points} / ${f.min_points}일). 기록이 모이면 언제쯤 모자랄지 보여 드립니다.`, `Collecting a row a day (${f.points} / ${f.min_points} days).`)
              : L(`최근 ${f.points}일 기록의 추세선으로, 지금 속도라면 언제 기준에 닿는지 봅니다. 학기 · 과제 시작처럼 갑자기 늘면 몇 주 뒤에 반영됩니다.`,
                `A trend line through the last ${f.points} days: when each metric reaches its threshold at this pace. A sudden step shows after some weeks.`)}</p>
            <div className="table-scroll"><table className="table compact-head forecast-table">
              <thead><tr><th>{L('항목', 'Metric')}</th><th className="num">{L('지금', 'Now')}</th><th className="num">{L('30일 추세', '30-day trend')}</th><th>{L('기준', 'Threshold')}</th>
                <th>{L('닿는 날', 'Reached')}</th><th>{L('추이', 'History')}</th><th>{L('판단', 'Verdict')}</th></tr></thead>
              <tbody>{f.metrics.map((m) => (
                <tr key={m.key}>
                  <td><span className="strong">{m.label}</span>{m.advice && <div className="muted small">{m.advice}</div>}</td>
                  <td className="num">{m.enough ? `${m.current}${m.unit}` : '-'}</td>
                  <td className="num">{m.enough ? `${(m.trend_30d ?? 0) > 0 ? '+' : ''}${m.trend_30d}${m.unit}` : '-'}</td>
                  <td className="muted small">{m.threshold}{m.unit}</td>
                  <td className="nowrap">{m.over_now ? L('이미 넘음', 'already') : m.eta_day ? <>{dateText(m.eta_day)}<div className="muted small">{L(`약 ${m.eta_days}일 뒤`, `in ~${m.eta_days} d`)}</div></> : '-'}
                    {m.confidence === 'low' && <div className="muted small">{L('추세가 고르지 않음', 'uneven trend')}</div>}</td>
                  <td className="spark-cell">{m.history.length > 1 && <Sparkline points={m.history.map((h) => h.value)} color={COLOR[m.level]} max={Math.max(100, ...m.history.map((h) => h.value))} />}</td>
                  <td><span className={TONE[m.level]}>{LEVEL[m.level]}</span></td>
                </tr>))}</tbody>
            </table></div>
          </>
        )}
      </LoadState>
    </section>
  );
}
