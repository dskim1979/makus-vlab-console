import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// Small SVG charts for the monitoring panels: a time series with a crosshair tooltip,
// a sparkline and a gauge. No chart library: the panels need little and stay light.

// Categorical order for series (nodes): validated for the navy surface (dataviz palette check).
export const SERIES = ['#14A09A', '#3987E5', '#D95926', '#9085E9', '#C98500', '#D55181'];

export type Series = { name: string; color: string; points: { ts: number; v: number }[] };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p;
}

export function TimeSeries({ series, height = 200, unit = '', max, area = false, fmtTime, empty }: {
  series: Series[]; height?: number; unit?: string; max?: number; area?: boolean;
  fmtTime: (ts: number, short: boolean) => string; empty: ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <div className="ts-empty" style={{ height }}>{empty}</div>;

  const pad = { l: 40, r: 10, t: 10, b: 22 };
  const w = Math.max(width, 120), h = height;
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const t0 = Math.min(...all.map((p) => p.ts)), t1 = Math.max(...all.map((p) => p.ts));
  const top = max ?? niceMax(Math.max(...all.map((p) => p.v)) * 1.1);
  const x = (ts: number) => pad.l + (t1 === t0 ? iw / 2 : ((ts - t0) / (t1 - t0)) * iw);
  const y = (v: number) => pad.t + ih - (Math.min(v, top) / top) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const nx = Math.max(2, Math.min(6, Math.floor(iw / 110)));
  const xticks: number[] = Array.from({ length: nx }, (_v, i: number) => t0 + ((t1 - t0) * i) / (nx - 1));
  const base = series.reduce((a, s) => (s.points.length > a.points.length ? s : a), series[0]);

  function move(e: React.MouseEvent<SVGRectElement>) {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const ts = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
    let best = 0;
    base.points.forEach((p, i) => { if (Math.abs(p.ts - ts) < Math.abs(base.points[best].ts - ts)) best = i; });
    setHover(best);
  }
  const hp = hover != null ? base.points[hover] : null;
  const fmt = (v: number) => `${v >= 100 || unit !== '%' ? Math.round(v) : v.toFixed(1)}${unit}`;

  return (
    <div className="ts" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={series.map((s) => s.name).join(', ')}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={i} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity=".28" /><stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="ts-grid" />
              <text x={pad.l - 6} y={y(v)} className="ts-axis" textAnchor="end" dominantBaseline="middle">{fmt(v)}</text>
            </g>
          ))}
          {xticks.map((ts, i) => (
            <text key={i} x={x(ts)} y={h - 6} className="ts-axis" textAnchor={i === 0 ? 'start' : i === xticks.length - 1 ? 'end' : 'middle'}>
              {fmtTime(ts, t1 - t0 <= 2 * 86400)}
            </text>
          ))}
          {series.map((s, i) => {
            if (!s.points.length) return null;
            const d = s.points.map((p, k) => `${k ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
            return (
              <g key={s.name}>
                {area && <path d={`${d}L${x(s.points[s.points.length - 1].ts)},${y(0)}L${x(s.points[0].ts)},${y(0)}Z`} fill={`url(#${gid}-${i})`} />}
                <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {hp && (
            <g>
              <line x1={x(hp.ts)} x2={x(hp.ts)} y1={pad.t} y2={pad.t + ih} className="ts-cross" />
              {series.map((s) => {
                const p = s.points.find((q) => q.ts === hp.ts);
                return p ? <circle key={s.name} cx={x(p.ts)} cy={y(p.v)} r="4" fill={s.color} className="ts-dot" /> : null;
              })}
            </g>
          )}
          <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onMouseMove={move} onMouseLeave={() => setHover(null)} />
        </svg>
      )}
      {hp && (
        <div className="ts-tip" style={{ left: Math.min(x(hp.ts) + 12, w - 170), top: 8 }}>
          <div className="ts-tip-time">{fmtTime(hp.ts, false)}</div>
          {series.map((s) => {
            const p = s.points.find((q) => q.ts === hp.ts);
            return p ? (
              <div key={s.name} className="ts-tip-row"><span className="ts-key" style={{ background: s.color }} />{s.name}<b>{fmt(p.v)}</b></div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

export function Legend({ series }: { series: { name: string; color: string; value?: string }[] }) {
  return (
    <ul className="ts-legend">
      {series.map((s) => <li key={s.name}><span className="ts-key" style={{ background: s.color }} />{s.name}{s.value && <b>{s.value}</b>}</li>)}
    </ul>
  );
}

export function Sparkline({ points, color, max }: { points: number[]; color: string; max?: number }) {
  const gid = useId();
  if (points.length < 2) return null;
  const top = max ?? Math.max(...points, 1);
  const w = 100, h = 28;
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - (Math.min(v, top) / top) * (h - 2) - 1).toFixed(1)}`).join('');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".3" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d}L${w},${h}L0,${h}Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// 0-100 arc; the colour is the status of the value (good / warning / critical).
export function Gauge({ value, label }: { value: number | null; label: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const tone = value == null ? 'var(--subtle)' : v >= 80 ? 'var(--ok)' : v >= 60 ? 'var(--warn)' : 'var(--danger)';
  const r = 40, c = Math.PI * r;
  return (
    <svg className="gauge" viewBox="0 0 100 58" role="img" aria-label={`${label} ${value ?? '-'}`}>
      <path d="M10 52 A40 40 0 0 1 90 52" fill="none" stroke="var(--surface-3)" strokeWidth="9" strokeLinecap="round" />
      <path d="M10 52 A40 40 0 0 1 90 52" fill="none" stroke={tone} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} />
      <text x="50" y="48" textAnchor="middle" className="gauge-n">{value ?? '-'}</text>
    </svg>
  );
}
