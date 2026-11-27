// 자원 회수 (makus-vlab pegaprox/api/vlab_reclaim.py): what can be taken back - unused assigned
// desktops, oversized VMs, long-stopped VMs, VMs in no pool, old snapshots, idle card loans -
// why, what it frees, the recommended step; 제외 keeps an item out; 적용 runs one step.
import { ApiError, isMock, request } from './client';

export type ReclaimKind = 'unused' | 'oversized' | 'stopped' | 'orphan' | 'snapshot' | 'loan';
export const RECLAIM_KINDS: ReclaimKind[] = ['unused', 'oversized', 'stopped', 'orphan', 'snapshot', 'loan'];
export type ReclaimActionId = 'unassign' | 'shutdown' | 'resize' | 'delete_vm' | 'delete_snapshot' | 'return_card' | 'review';
export type ReclaimAction = { id: ReclaimActionId; label: string; destructive: boolean; params: { confirm?: string; cores?: number; memory_mb?: number } };
export type Free = { vcpu: number; ram_gb: number; disk_gb: number; cards: number; seats: number };
export type ReclaimItem = {
  key: string; kind: ReclaimKind; cluster_id: string; vmid: number | null; node: string; vm_type: string;
  name: string; vm_name?: string; status: string; desktop_id: string | null; desktop: string | null;
  pool_id: string | null; pool: string | null; user: string | null; exempt: boolean;
  reason: string; detail: Record<string, unknown>; free: Free; action: ReclaimAction; more: ReclaimAction[];
  snapshot?: string; lease_id?: string;
};
export type ReclaimReport = {
  days: number; generated_at: string;
  spec: { vcpu: number; ram_gb: number; disk_gb: number; from_desktops: number };
  totals: Free & { more_desktops: number; snapshots: number; items: number; review?: number };
  counts: Record<ReclaimKind, number>; exempt_count: number; items: ReclaimItem[]; notes: string[];
  pools: { id: string; name: string }[];
  exemptions: { key: string; kind: string; target: string; note: string; by_user: string; at: string }[];
};
export type ReclaimSettings = { weekly: boolean; weekday: number; hour: number; days: number };
export type ApplyBody = { key: string; action: ReclaimActionId; cluster_id?: string; vmid?: number | null; desktop_id?: string | null;
  snapshot?: string; lease_id?: string; cores?: number; memory_mb?: number; confirm_name?: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}

const realApi = {
  report: (days: number, exempt = false) => call<ReclaimReport>('GET', `/api/vlab/admin/reclaim?days=${days}${exempt ? '&exempt=1' : ''}`),
  exempt: (key: string, target: string, note = '') => call<{ ok: true }>('POST', '/api/vlab/admin/reclaim/exempt', { key, target, note }),
  unexempt: (key: string) => call<{ ok: true }>('DELETE', `/api/vlab/admin/reclaim/exempt?key=${encodeURIComponent(key)}`),
  apply: (b: ApplyBody) => call<{ success: true }>('POST', '/api/vlab/admin/reclaim/apply', b),
  settings: () => call<{ settings: ReclaimSettings; last_sent: string | null }>('GET', '/api/vlab/admin/reclaim/settings'),
  saveSettings: (s: Partial<ReclaimSettings>) => call<{ settings: ReclaimSettings }>('PUT', '/api/vlab/admin/reclaim/settings', s),
};

// --- mock ------------------------------------------------------------------------------------

const delay = <T,>(v: T, ms = 220) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const F = (vcpu = 0, ram_gb = 0, disk_gb = 0, cards = 0, seats = 0): Free => ({ vcpu, ram_gb, disk_gb, cards, seats });
const A = (id: ReclaimActionId, params: ReclaimAction['params'] = {}): ReclaimAction => ({
  id, params, destructive: id === 'delete_vm' || id === 'delete_snapshot',
  label: { unassign: '배정 해제', shutdown: '끄기', resize: '크기 줄이기', delete_vm: 'VM 삭제', delete_snapshot: '스냅숏 삭제', return_card: '카드 반납', review: '확인' }[id],
});
const base = (kind: ReclaimKind, vmid: number | null, name: string, o: Partial<ReclaimItem> = {}): ReclaimItem => ({
  key: `${kind}:cluster_1:${vmid ?? ''}${o.snapshot ? `:${o.snapshot}` : o.lease_id ? `:${o.lease_id}` : ''}`, kind, cluster_id: 'cluster_1',
  vmid, node: 'pve1', vm_type: 'qemu', name, status: 'running', desktop_id: null, desktop: null, pool_id: null, pool: null, user: null,
  exempt: false, reason: '', detail: {}, free: F(), action: A('review'), more: [], ...o,
});
const MOCK: ReclaimItem[] = [
  base('unused', 1012, 'cad-12', { desktop_id: 'd-cad-12', desktop: 'cad-12', pool_id: 'p-cad', pool: 'CAD 실습', user: 'jkim',
    reason: 'jkim 님이 41일째 접속 안 함', free: F(4, 8, 0, 0, 1), action: A('unassign'), more: [A('shutdown')] }),
  base('unused', 1019, 'cad-19', { desktop_id: 'd-cad-19', desktop: 'cad-19', pool_id: 'p-cad', pool: 'CAD 실습', user: 'shlee', status: 'stopped',
    reason: 'shlee 님이 한 번도 접속 안 함', free: F(0, 0, 0, 0, 1), action: A('unassign') }),
  base('oversized', 2103, 'sim-03', { desktop_id: 'd-sim-03', desktop: 'sim-03', pool_id: 'p-sim', pool: '시뮬레이션', user: 'hpark',
    reason: 'CPU 평균 3.1% · p95 14% / 메모리 평균 18% · 최대 31%', free: F(8, 16), action: A('resize', { cores: 8, memory_mb: 16384 }),
    detail: { current: { vcpu: 16, ram_gb: 32 }, recommended: { vcpu: 8, ram_gb: 16 } } }),
  base('oversized', 2107, 'sim-07', { desktop_id: 'd-sim-07', desktop: 'sim-07', pool_id: 'p-sim', pool: '시뮬레이션', user: 'ychoi',
    reason: '거의 안 씀 (CPU 평균 0.4%)', free: F(8, 16), action: A('shutdown') }),
  base('stopped', 3301, 'build-old-01', { status: 'stopped', reason: '풀 밖 · 74일 넘게 꺼짐 · 디스크 200 GB', free: F(0, 0, 200),
    action: A('delete_vm', { confirm: 'build-old-01' }) }),
  base('stopped', 1033, 'cad-33', { status: 'stopped', desktop_id: 'd-cad-33', desktop: 'cad-33', pool_id: 'p-cad', pool: 'CAD 실습',
    reason: '52일 꺼짐 · 디스크 120 GB', free: F(0, 0, 120), action: A('delete_vm', { confirm: 'cad-33' }) }),
  base('orphan', 4410, 'test-ubuntu', { reason: '어느 풀에도 없음 · 켜져 있음', free: F(2, 4, 32), action: A('review'),
    more: [A('shutdown'), A('delete_vm', { confirm: 'test-ubuntu' })] }),
  base('snapshot', 2103, 'sim-03', { desktop_id: 'd-sim-03', desktop: 'sim-03', pool_id: 'p-sim', pool: '시뮬레이션', snapshot: 'before-ansys-2025',
    reason: "'before-ansys-2025' 96일 지남 · 메모리 포함", action: A('delete_snapshot', { confirm: 'before-ansys-2025' }) }),
  base('snapshot', 3301, 'build-old-01', { status: 'stopped', snapshot: 'pre-upgrade', reason: "'pre-upgrade' 140일 지남",
    action: A('delete_snapshot', { confirm: 'pre-upgrade' }) }),
  base('loan', 2211, 'NVIDIA A100 #2', { desktop_id: 'd-dl-11', desktop: 'dl-11', pool_id: 'p-dl', pool: '딥러닝', user: 'mjung', lease_id: 'L-a100-2',
    reason: '3일째 거의 안 씀 (평균 2%)', free: F(0, 0, 0, 1), action: A('return_card') }),
];
const mockExempt = new Map<string, { key: string; kind: string; target: string; note: string; by_user: string; at: string }>();
let mockSettings: ReclaimSettings = { weekly: false, weekday: 0, hour: 9, days: 30 };

function mockReport(days: number, withExempt: boolean): ReclaimReport {
  const items = MOCK.map((i) => ({ ...i, exempt: mockExempt.has(i.key) }));
  const live = items.filter((i) => !i.exempt);
  const perVm = new Map<string, Free>(); const other: Free[] = [];
  const review = live.filter((i) => i.action.id === 'review').length;
  for (const i of live) {
    if (i.action.id === 'review') continue;
    if (i.kind === 'snapshot' || i.kind === 'loan') { other.push(i.free); continue; }
    const k = `${i.cluster_id}:${i.vmid}`; const c = perVm.get(k) ?? F();
    perVm.set(k, { vcpu: Math.max(c.vcpu, i.free.vcpu), ram_gb: Math.max(c.ram_gb, i.free.ram_gb), disk_gb: Math.max(c.disk_gb, i.free.disk_gb),
      cards: Math.max(c.cards, i.free.cards), seats: Math.max(c.seats, i.free.seats) });
  }
  const t = [...perVm.values(), ...other].reduce((a, f) => ({ vcpu: a.vcpu + f.vcpu, ram_gb: a.ram_gb + f.ram_gb, disk_gb: a.disk_gb + f.disk_gb,
    cards: a.cards + f.cards, seats: a.seats + f.seats }), F());
  const counts = Object.fromEntries(RECLAIM_KINDS.map((k) => [k, live.filter((i) => i.kind === k).length])) as Record<ReclaimKind, number>;
  return {
    days, generated_at: new Date().toISOString(), spec: { vcpu: 4, ram_gb: 8, disk_gb: 80, from_desktops: 46 },
    totals: { ...t, more_desktops: Math.floor(Math.min(t.vcpu / 4, t.ram_gb / 8)), snapshots: counts.snapshot, items: live.length, review },
    counts, exempt_count: items.length - live.length, items: withExempt ? items : live, notes: [],
    pools: [{ id: 'p-cad', name: 'CAD 실습' }, { id: 'p-dl', name: '딥러닝' }, { id: 'p-sim', name: '시뮬레이션' }],
    exemptions: [...mockExempt.values()],
  };
}

const mockApi: typeof realApi = {
  report: (days, exempt = false) => delay(mockReport(days, exempt)),
  exempt: (key, target, note = '') => { mockExempt.set(key, { key, kind: key.split(':')[0], target, note, by_user: 'admin', at: new Date().toISOString() }); return delay({ ok: true as const }); },
  unexempt: (key) => { mockExempt.delete(key); return delay({ ok: true as const }); },
  apply: (b) => {
    const i = MOCK.findIndex((x) => x.key === b.key);
    if (i < 0) return Promise.reject(new ApiError(404, 'Not found', { error: 'Not found' }));
    if ((b.action === 'delete_vm' || b.action === 'delete_snapshot') && b.confirm_name !== MOCK[i].action.params.confirm
      && !MOCK[i].more.some((m) => m.params.confirm === b.confirm_name)) {
      return Promise.reject(new ApiError(400, 'confirm_name must be the name', { error: 'confirm_name must be the name', code: 'CONFIRM' }));
    }
    MOCK.splice(i, 1);
    return delay({ success: true as const }, 500);
  },
  settings: () => delay({ settings: mockSettings, last_sent: null }),
  saveSettings: (s) => { mockSettings = { ...mockSettings, ...s }; return delay({ settings: mockSettings }); },
};

export const reclaimApi = isMock ? mockApi : realApi;
