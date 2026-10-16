// The fake engine's side of 장시간 작업 보호 · GPU/NPU 사용률 · 유휴 카드 회수 (src/api/work.ts). Kept apart
// from work.ts so mock.ts and mockAdmin.ts can use it without importing client.ts back.
import type { AccelUse, Deferral, DesktopWork, ReclaimInfo, WorkHold, WorkSettings } from './types';

const ago = (min: number) => new Date(Date.now() - min * 6e4).toISOString();
const ahead = (h: number) => new Date(Date.now() + h * 36e5).toISOString();

const use = (util: number | null, used: number | null, total: number | null, status: AccelUse['status'] = 'ok', vendor = 'nvidia', name = ''): AccelUse => ({
  util, mem_used_mb: used, mem_total_mb: total, status, at: ago(2), vendor,
  cards: [{ vendor, idx: 0, name, util, mem_used_mb: used, mem_total_mb: total, status }],
});

export const mockWorkSettings: WorkSettings = {
  sample_minutes: 5, retention_days: 90, hold_max_hours: 72,
  reclaim: { enabled: true, idle_hours: 24, threshold_pct: 5, auto_return: false, auto_return_hours: 12 },
};

// by desktop name, so the portal mock (d1..d4) and the admin mock (desk_N) find the same figures
export const mockUse: Record<string, AccelUse> = {
  'ai-ws-03': use(78, 18432, 24576, 'ok', 'nvidia', 'NVIDIA A16-4Q'),
  'vivado-build-01': use(null, null, null, 'unavailable', '', ''),
  'lab-win11-01': use(1, 410, 46068, 'ok', 'nvidia', 'NVIDIA L40S'),
  'lab-win11-03': use(72, 30120, 46068, 'ok', 'nvidia', 'NVIDIA L40S'),
  'npu-lab-02': use(41, 6200, 16384, 'ok', 'rebellions', 'RBLN-CA22'),
};

export const mockHolds: WorkHold[] = [
  { id: 'hold_1', desktop_id: 'd4', desktop: 'ai-ws-03', username: 'alice', note: 'LLaMA 파인튜닝 3 epoch', until: ahead(20), created_at: ago(240) },
];

export const mockDeferrals: Deferral[] = [
  { id: 'defer_1', desktop_id: 'd4', desktop: 'ai-ws-03', pool_id: null, action: 'shutdown', source: 'idle', source_id: '', username: 'alice',
    reason: { kind: 'hold', until: ahead(20), by: 'alice', note: 'LLaMA 파인튜닝 3 epoch' }, first_at: ago(95), checked_at: ago(3),
    deadline: ahead(10.4), state: 'waiting', ended_at: null, result: '' },
  { id: 'defer_2', desktop_id: 'desk_x2', desktop: 'lab-win11-03', pool_id: null, action: 'reset', source: 'lab', source_id: 'sched_1', username: 'kim',
    reason: { kind: 'gpu', value: 72, threshold: 10 }, first_at: ago(40), checked_at: ago(1), deadline: ahead(11.3), state: 'waiting', ended_at: null, result: '' },
  { id: 'defer_3', desktop_id: 'desk_x3', desktop: 'vivado-build-02', pool_id: null, action: 'shutdown', source: 'schedule', source_id: 'sa_1', username: 'bob',
    reason: { kind: 'job', job: 'synth top_u250', by: 'bob' }, first_at: ago(600), checked_at: ago(300), deadline: ahead(6), state: 'done',
    ended_at: ago(300), result: 'work finished' },
  { id: 'defer_4', desktop_id: 'desk_x4', desktop: 'npu-lab-02', pool_id: null, action: 'expire', source: 'session_limit', source_id: 's_9', username: 'lee',
    reason: { kind: 'cpu', value: 93, threshold: 50 }, first_at: ago(2000), checked_at: ago(1300), deadline: ago(1280), state: 'forced',
    ended_at: ago(1280), result: 'longest extension reached' },
];

export const mockReclaims: Record<string, ReclaimInfo> = {
  lease_b: { state: 'suggested', suggested_at: ago(180), avg_util: 0.8 },
};

export function mockDeskWork(id: string, name: string): DesktopWork {
  return {
    hold: mockHolds.find((h) => h.desktop_id === id || h.desktop === name) ?? null,
    deferrals: mockDeferrals.filter((d) => d.state === 'waiting' && (d.desktop_id === id || d.desktop === name)),
    use: mockUse[name] ?? null,
  };
}

// a loan's latest figures: the lent L40S has sat near 0 % for a day (a reclaim suggestion); the U250 is an FPGA
// the vendor tools do not measure
export function mockLeaseExtras(leaseId: string, desktop: string | null) {
  return {
    use: leaseId === 'lease_a' ? mockUse['vivado-build-01'] : leaseId === 'lease_b' ? mockUse['lab-win11-01'] : (desktop ? mockUse[desktop] ?? null : null),
    reclaim: mockReclaims[leaseId] ?? null,
  };
}
