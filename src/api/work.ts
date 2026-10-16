// 장시간 작업 보호 · GPU/NPU 사용률 · 유휴 카드 회수 (makus-vlab pegaprox/api/vlab_work.py). A desktop that is
// working - a busy GPU / CPU, a build job, or the user's "작업 중 - 끄지 마세요" - is not shut down or reset by the
// idle shutdown, the session limit, a LAB / booking clean-up or a scheduled stop: the step waits up to the pool's
// longest extension. The card desktops report GPU / NPU use every few minutes; a loaned card idle for N hours is
// suggested for a reclaim. The figures on desktops and loans come with those lists (work, use, reclaim).
import { ApiError, isMock, request } from './client';
import { mockDeferrals, mockDeskWork, mockHolds, mockReclaims, mockUse, mockWorkSettings } from './mockWork';
import type { Deferral, DesktopWork, ReclaimInfo, UseSummary, WorkHold, WorkSettings } from './types';

export type MyWorkDesktop = DesktopWork & { id: string; name: string };
export type AdminWork = { deferrals: Deferral[]; holds: WorkHold[]; waiting: number };
export type UsePoint = { at: string; minutes: number; util: number | null; status: string; mem_used_mb: number | null; mem_total_mb: number | null };
export type UseSeries = { hours: number; threshold_pct: number; series: UsePoint[]; summary: UseSummary };
export type Reclaim = ReclaimInfo & { lease_id: string; idle_since: string; card: string; username: string; desktop: string | null;
  desktop_id: string | null; starts_at: string; ends_at: string | null; dismissed_by: string; dismissed_at: string | null;
  summary: UseSummary | null };
export type WorkSettingsChange = Partial<Omit<WorkSettings, 'reclaim'>> & { reclaim?: Partial<WorkSettings['reclaim']> };

export type WorkApi = {
  myWork(): Promise<{ desktops: MyWorkDesktop[]; hold_max_hours: number }>;
  setHold(desktopId: string, hours: number, note: string): Promise<WorkHold>;
  clearHold(desktopId: string): Promise<void>;
  adminWork(): Promise<AdminWork>;
  release(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  clearAnyHold(id: string): Promise<void>;
  settings(): Promise<WorkSettings>;
  saveSettings(s: WorkSettingsChange): Promise<WorkSettings>;
  usage(q: { desktop_id?: string; lease_id?: string; hours?: number }): Promise<UseSeries>;
  reclaims(): Promise<{ reclaims: Reclaim[]; rules: WorkSettings['reclaim'] }>;
  dismiss(leaseId: string): Promise<void>;
};

const enc = encodeURIComponent;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}

const real: WorkApi = {
  myWork: () => call('GET', '/api/vlab/me/work'),
  setHold: async (id, hours, note) => (await call<{ hold: WorkHold }>('POST', `/api/vlab/me/desktops/${enc(id)}/hold`, { hours, note })).hold,
  clearHold: async (id) => { await call('DELETE', `/api/vlab/me/desktops/${enc(id)}/hold`); },
  adminWork: () => call('GET', '/api/vlab/admin/work'),
  release: async (id) => { await call('POST', `/api/vlab/admin/deferrals/${enc(id)}/release`); },
  cancel: async (id) => { await call('POST', `/api/vlab/admin/deferrals/${enc(id)}/cancel`); },
  clearAnyHold: async (id) => { await call('DELETE', `/api/vlab/admin/holds/${enc(id)}`); },
  settings: async () => (await call<{ settings: WorkSettings }>('GET', '/api/vlab/admin/work-settings')).settings,
  saveSettings: async (s) => (await call<{ settings: WorkSettings }>('PUT', '/api/vlab/admin/work-settings', s)).settings,
  usage: (q) => {
    const p = new URLSearchParams();
    if (q.desktop_id) p.set('desktop_id', q.desktop_id);
    if (q.lease_id) p.set('lease_id', q.lease_id);
    if (q.hours) p.set('hours', String(q.hours));
    return call('GET', `/api/vlab/admin/accel-usage?${p}`);
  },
  reclaims: () => call('GET', '/api/vlab/admin/reclaims'),
  dismiss: async (id) => { await call('POST', `/api/vlab/admin/reclaims/${enc(id)}/dismiss`); },
};

// --- mock ----------------------------------------------------------------------------------

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));
const fail = (status: number, msg: string) => Promise.reject(new ApiError(status, msg));
const PORTAL = [['d1', 'vivado-build-01'], ['d2', 'board-lab-zcu102'], ['d4', 'ai-ws-03'], ['d3', 'lab-win11-07']] as const;
let seq = 10;

function series(name: string | null, hours: number, off: boolean): UseSeries {
  const base = off ? null : name ? mockUse[name]?.util ?? null : 30;
  const points: UsePoint[] = [];
  const n = Math.min(288, hours * 12);
  for (let i = n - 1; i >= 0; i -= 1) {
    const at = new Date(Date.now() - i * 5 * 6e4).toISOString();
    const wave = base === null ? null : Math.max(0, Math.min(100, Math.round(base + Math.min(25, base / 2 + 1) * Math.sin(i / 9) + ((i % 7) - 3) * Math.min(1, base / 20))));
    points.push({ at, minutes: 5, util: wave, status: off ? 'off' : base === null ? 'unavailable' : 'ok', mem_used_mb: null, mem_total_mb: null });
  }
  const ok = points.filter((p) => p.util !== null);
  const avg = ok.length ? Math.round(ok.reduce((a, p) => a + (p.util ?? 0), 0) / ok.length * 10) / 10 : null;
  const h = (k: number) => Math.round(k * 5 / 60 * 10) / 10;
  return { hours, threshold_pct: mockWorkSettings.reclaim.threshold_pct, series: points, summary: {
    measured_hours: h(ok.length), idle_hours: h(off ? points.length : ok.filter((p) => (p.util ?? 0) < 5).length), off_hours: h(off ? points.length : 0),
    unmeasured_hours: h(off ? 0 : points.length - ok.length), util_avg: avg, util_max: ok.length ? Math.max(...ok.map((p) => p.util ?? 0)) : null } };
}

const mock: WorkApi = {
  myWork: () => delay({ desktops: PORTAL.map(([id, name]) => ({ id, name, ...mockDeskWork(id, name) })), hold_max_hours: mockWorkSettings.hold_max_hours }),
  setHold: (id, hours, note) => {
    const desk = PORTAL.find(([x]) => x === id);
    if (!desk) return fail(404, 'desktop not found');
    if (!(hours > 0 && hours <= mockWorkSettings.hold_max_hours)) return fail(400, `hours must be more than 0 and at most ${mockWorkSettings.hold_max_hours}`);
    mockHolds.splice(0, mockHolds.length, ...mockHolds.filter((h) => h.desktop_id !== id));
    const h: WorkHold = { id: `hold_${seq++}`, desktop_id: id, desktop: desk[1], username: 'alice', note, until: new Date(Date.now() + hours * 36e5).toISOString(),
      created_at: new Date().toISOString() };
    mockHolds.unshift(h);
    return delay(h);
  },
  clearHold: (id) => { mockHolds.splice(0, mockHolds.length, ...mockHolds.filter((h) => h.desktop_id !== id)); return delay(undefined); },
  adminWork: () => delay({ deferrals: mockDeferrals.map((d) => ({ ...d })), holds: mockHolds.map((h) => ({ ...h })),
    waiting: mockDeferrals.filter((d) => d.state === 'waiting').length }),
  release: (id) => {
    const d = mockDeferrals.find((x) => x.id === id);
    if (!d) return fail(404, 'deferral not found');
    if (d.state !== 'waiting') return fail(409, 'it is not waiting any more');
    Object.assign(d, { state: 'forced', ended_at: new Date().toISOString(), result: 'longest extension reached' });
    return delay(undefined);
  },
  cancel: (id) => {
    const d = mockDeferrals.find((x) => x.id === id);
    if (!d) return fail(404, 'deferral not found');
    if (d.state !== 'waiting') return fail(409, 'it is not waiting any more');
    Object.assign(d, { state: 'cancelled', ended_at: new Date().toISOString(), result: 'cancelled by admin' });
    return delay(undefined);
  },
  clearAnyHold: (id) => { mockHolds.splice(0, mockHolds.length, ...mockHolds.filter((h) => h.id !== id)); return delay(undefined); },
  settings: () => delay(JSON.parse(JSON.stringify(mockWorkSettings)) as WorkSettings),
  saveSettings: (s) => {
    const { reclaim, ...rest } = s;
    Object.assign(mockWorkSettings, rest);
    if (reclaim) Object.assign(mockWorkSettings.reclaim, reclaim);
    return delay(JSON.parse(JSON.stringify(mockWorkSettings)) as WorkSettings);
  },
  usage: (q) => {
    const hours = q.hours ?? 24;
    if (q.lease_id) return delay(series(q.lease_id === 'lease_b' ? 'lab-win11-01' : 'vivado-build-01', hours, false));
    const name = PORTAL.find(([id]) => id === q.desktop_id)?.[1] ?? q.desktop_id ?? null;
    return delay(series(name, hours, false));
  },
  reclaims: () => delay({ rules: { ...mockWorkSettings.reclaim }, reclaims: Object.entries(mockReclaims).filter(([, r]) => r.state !== 'returned').map(([lease_id, r]) => ({
    ...r, lease_id, idle_since: new Date(Date.now() - 27 * 36e5).toISOString(), card: 'NVIDIA L40S', username: 'alice', desktop: 'lab-win11-01',
    desktop_id: null, starts_at: new Date(Date.now() - 6 * 864e5).toISOString(), ends_at: new Date(Date.now() + 8 * 864e5).toISOString(),
    dismissed_by: r.state === 'dismissed' ? 'admin' : '', dismissed_at: null,
    summary: { measured_hours: 24, idle_hours: 24, off_hours: 0, unmeasured_hours: 0, util_avg: 0.8, util_max: 3 } })) }),
  dismiss: (id) => {
    const r = mockReclaims[id];
    if (!r) return fail(404, 'no suggestion for that loan');
    r.state = 'dismissed';
    return delay(undefined);
  },
};

export const workApi: WorkApi = isMock ? mock : real;

// --- shared bits for the screens -----------------------------------------------------------

export const ACTION_TEXT: Record<string, [string, string]> = {
  shutdown: ['종료', 'shut down'], stop: ['강제 종료', 'stop'], reboot: ['재시작', 'reboot'], reset: ['초기화', 'reset'], expire: ['접속 종료', 'end session'],
};
export const SOURCE_TEXT: Record<string, [string, string]> = {
  idle: ['미사용 자동 종료', 'Idle shutdown'], session_limit: ['최대 접속 시간', 'Session limit'], lab: ['LAB 시간표 정리', 'LAB class clean-up'],
  booking: ['LAB 예약 정리', 'Booking clean-up'], schedule: ['예약 작업(일정)', 'Scheduled action'],
};

export function reasonText(r: Deferral['reason'], L: (ko: string, en: string) => string) {
  if (r.kind === 'hold') return L(`사용자가 '작업 중' 표시${r.note ? ` · ${r.note}` : ''}`, `Marked as working by the user${r.note ? ` · ${r.note}` : ''}`);
  if (r.kind === 'job') return L(`빌드 작업 실행 중 · ${r.job ?? ''}`, `Build job running · ${r.job ?? ''}`);
  if (r.kind === 'gpu') return L(`GPU/NPU 사용률 ${r.value}% (기준 ${r.threshold}%)`, `GPU/NPU use ${r.value}% (threshold ${r.threshold}%)`);
  return L(`CPU 부하 ${r.value}% (기준 ${r.threshold}%)`, `CPU load ${r.value}% (threshold ${r.threshold}%)`);
}
