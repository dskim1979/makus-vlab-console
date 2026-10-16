// Growth forecast (makus-vlab pegaprox/api/vlab_forecast.py): GET /api/vlab/admin/clusters/<id>/forecast?days=
import { ApiError, isMock, request } from './client';

export type ForecastLevel = 'now' | 'soon' | 'watch' | 'ok' | 'unknown';
export type ForecastMetric = {
  key: string; label: string; unit: string; threshold: number; level: ForecastLevel; advice: string; points: number; enough: boolean;
  current?: number; trend_30d?: number; eta_day?: string | null; eta_days?: number | null; over_now?: boolean;
  confidence?: 'high' | 'medium' | 'low'; r2?: number; history: { day: string; value: number }[];
};
export type Forecast = {
  cluster_id: string; days: number; from: string | null; points: number; min_points: number; metrics: ForecastMetric[];
  latest: { desktops?: number; sessions_peak?: number; storage_used?: number; storage_total?: number; cards_in_use?: number; cards_total?: number };
  generated_at: string;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

function mockForecast(cid: string, days: number): Forecast {
  const today = new Date();
  const series = (start: number, perDay: number, noise: number) => Array.from({ length: days }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - (days - 1 - i));
    const wk = d.getDay() === 0 || d.getDay() === 6 ? -6 : 0;
    return { day: iso(d), value: Math.max(0, Math.round((start + perDay * i + wk + Math.sin(i * 1.7) * noise) * 10) / 10) };
  });
  const m = (key: string, label: string, threshold: number, start: number, perDay: number, noise: number): ForecastMetric => {
    const h = series(start, perDay, noise);
    const cur = h[h.length - 1].value;
    const eta = perDay > 0.01 ? Math.max(0, Math.round((threshold - cur) / perDay)) : null;
    const level: ForecastLevel = cur >= threshold ? 'now' : eta === null ? 'ok' : eta <= 90 ? 'soon' : eta <= 365 ? 'watch' : 'ok';
    const d = new Date(today); if (eta !== null) d.setDate(d.getDate() + eta);
    return { key, label, unit: '%', threshold, level, points: h.length, enough: true, current: cur, trend_30d: Math.round(perDay * 300) / 10,
      eta_days: eta !== null && eta <= 730 ? eta : null, eta_day: eta !== null && eta <= 730 ? iso(d) : null, over_now: cur >= threshold,
      confidence: noise > 6 ? 'low' : noise > 3 ? 'medium' : 'high', history: h,
      advice: level === 'soon' ? `이 추세면 약 ${eta}일 뒤(${iso(d)}) 기준에 닿습니다. 예산 · 구매 기간을 생각해 미리 준비하세요.` : '' };
  };
  const metrics = [
    m('storage_pct', '스토리지', 85, 61, 0.21, 1), m('cards_pct', '가속 카드 사용 (대여 · GPU 작업)', 90, 58, 0.25, 8),
    m('mem_avg', '메모리 평균', 85, 55, 0.12, 2), m('mem_peak', '메모리 최대', 95, 71, 0.1, 3),
    m('cpu_avg', 'CPU 평균', 80, 34, 0.05, 3), m('cpu_peak', 'CPU 최대', 95, 66, 0.08, 5), m('sessions_pct', '동시 접속 (데스크톱 대비)', 90, 48, 0.02, 7),
  ];
  const order = { now: 0, soon: 1, watch: 2, ok: 3, unknown: 4 };
  metrics.sort((a, b) => order[a.level] - order[b.level]);
  return { cluster_id: cid, days, from: metrics[0].history[0].day, points: days, min_points: 10, metrics,
    latest: { desktops: 48, sessions_peak: 31, storage_used: 41.2e12, storage_total: 60e12, cards_in_use: 7, cards_total: 10 }, generated_at: new Date().toISOString() };
}

export const forecastApi = {
  get: async (clusterId: string, days: 30 | 90 | 180 = 90): Promise<Forecast> => {
    if (isMock) return new Promise((r) => setTimeout(() => r(mockForecast(clusterId, days)), 150));
    const { status, data } = await request<Forecast & { error?: string }>('GET', `/api/vlab/admin/clusters/${encodeURIComponent(clusterId)}/forecast?days=${days}`);
    if (status !== 200) throw new ApiError(status, data?.error || `HTTP ${status}`, data);
    return data;
  },
};
