// 클러스터 > 고가용성 (HA) extras and 클러스터 > 부하 분산 - makus-vlab pegaprox/api/vlab_hadrs.py.
// The HA resource list itself and the node-priority groups stay in ops.ts (opsApi.ha*).
import { ApiError, isMock, request } from './client';
import { mockHaVmids, mockHaAdd, mockHaRemove } from './ops';
import { mockVmStore } from './mockAdmin';

export type StaysReason = 'pci' | 'usb' | 'local_disk' | 'container' | 'template' | 'unknown_storage' | 'excluded';
export type SeparateRule = { name: string; vmids: number[]; ha_rule: boolean; balancer_rule: boolean; enabled: boolean; comment: string };
export type HaPool = { id: string; name: string; type: string; ha_enabled: boolean; desktops: number; in_ha: number };
export type HaExtra = {
  nodes_online: number; nodes_total: number; quorate: boolean | null; rules_supported: boolean;
  storage: Record<string, 'shared' | 'local' | 'unknown' | 'nodisk'>; passthrough: Record<string, 'pci' | 'usb'>;
  separate: SeparateRule[]; pools: HaPool[]; waiting: number;
  names?: Record<string, string>;   // the names of the VMs the rules name
};
export type PoolHaResult = { done: number[]; failed: { vmid: number; name: string; error: string }[] };

export type BalanceMode = 'off' | 'recommend' | 'auto';
export type BalanceSettings = {
  check_interval: number; migration_threshold: number; balance_cpu_weight: number; balance_mem_weight: number; balance_io_weight: number;
  balance_local_disks: boolean; balance_containers: boolean; excluded_nodes: string[];
};
export type BalanceNode = { node: string; online: boolean; maintenance: boolean; excluded: boolean; score: number; cpu: number; mem: number };
export type BalanceMove = { vmid: number; name: string; type: string; from: string; to: string; mem: number; local_disks: boolean; before: number; after: number; pool: string };
export type Excluded = { vmid: number; name: string; node: string; reason: StaysReason; pool: string };
export type MoveLog = { at: string; vmid: number; name: string; from: string; to: string; how: 'auto' | 'apply' | 'run'; by: string; ok: boolean; error: string };
export type Balance = {
  mode: BalanceMode; settings: BalanceSettings; nodes: BalanceNode[]; recommendations: BalanceMove[]; computed_at: number | null;
  last_run: string | null; excluded: Excluded[]; history: MoveLog[];
};
export type BalancePut = Partial<Omit<BalanceSettings, 'excluded_nodes'>> & { mode?: BalanceMode };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}
const enc = encodeURIComponent;
const C = (cid: string) => `/api/vlab/admin/clusters/${enc(cid)}`;

const realApi = {
  haExtra: (cid: string, refresh = false) => call<HaExtra>('GET', `${C(cid)}/ha/extra${refresh ? '?refresh=1' : ''}`),
  poolHa: (cid: string, pool_id: string, action: 'add' | 'remove') => call<PoolHaResult>('POST', `${C(cid)}/ha/pool`, { pool_id, action }),
  separateAdd: (cid: string, name: string, vmids: number[]) => call<{ ha_rule: boolean }>('POST', `${C(cid)}/ha/separate`, { name, vmids }),
  separateRemove: async (cid: string, name: string) => { await call('DELETE', `${C(cid)}/ha/separate/${enc(name)}`); },
  balance: (cid: string, refresh = false) => call<Balance>('GET', `${C(cid)}/balance${refresh ? '?refresh=1' : ''}`),
  balancePut: (cid: string, b: BalancePut) => call<{ mode: BalanceMode; settings: BalanceSettings }>('PUT', `${C(cid)}/balance`, b),
  balanceApply: (cid: string, vmid: number, to: string) => call<{ task: string | null }>('POST', `${C(cid)}/balance/apply`, { vmid, to }),
  balanceRun: async (cid: string) => { await call('POST', `${C(cid)}/balance/run`); },
};
export type HaDrsApi = typeof realApi;

// --- mock: three nodes, pve1 busy, an FPGA build VM with its card, a build VM on local disk --------

const delay = <T,>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const fail = (status: number, msg: string, body?: unknown) => Promise.reject(new ApiError(status, msg, body ?? { error: msg }));
const GB = 1024 ** 3;
const STAYS: Record<number, StaysReason> = { 400: 'pci', 401: 'local_disk', 410: 'usb' };
const LOCAL = new Set([401]);
const separate: SeparateRule[] = [];
let mode: BalanceMode = 'recommend';
const settings: BalanceSettings = { check_interval: 300, migration_threshold: 20, balance_cpu_weight: 1, balance_mem_weight: 1, balance_io_weight: 0,
  balance_local_disks: false, balance_containers: false, excluded_nodes: [] };
const history: MoveLog[] = [
  { at: new Date(Date.now() - 5 * 3600e3).toISOString(), vmid: 303, name: 'lab-win11-04', from: 'pve2', to: 'pve3', how: 'apply', by: 'admin', ok: true, error: '' },
  { at: new Date(Date.now() - 26 * 3600e3).toISOString(), vmid: 401, name: 'vivado-build-02', from: 'pve3', to: 'pve1', how: 'apply', by: 'admin', ok: false,
    error: "can't migrate local disk 'local-lvm:vm-401-disk-0': can't live migrate attached local disks without with-local-disks option" },
];
const memOf = (vmid: number) => (vmid >= 400 ? 16 : vmid === 240 || vmid === 241 ? 4 : 8) * GB;
const NODE_MEM = 128 * GB;

function nodeView() {
  const ns = ['pve1', 'pve2', 'pve3'];
  return ns.map((n) => {
    const on = mockVmStore.guests.filter((g) => g.node === n && g.status === 'running');
    const mem = 100 * (10 * GB + on.reduce((s, g) => s + memOf(g.vmid), 0)) / NODE_MEM;
    const cpu = 8 + on.length * 6;
    const w = settings;
    return { node: n, online: true, maintenance: false, excluded: false, cpu, mem: Math.round(mem * 10) / 10,
      score: Math.round((cpu * w.balance_cpu_weight + mem * w.balance_mem_weight) * 10) / 10 };
  });
}
function planMock(): BalanceMove[] {
  const nodes = nodeView().map((n) => ({ ...n }));
  const out: BalanceMove[] = [];
  const taken = new Set<number>();
  const spread = () => { const s = nodes.map((n) => n.score); return Math.round((Math.max(...s) - Math.min(...s)) * 10) / 10; };
  for (let i = 0; i < 3; i++) {
    nodes.sort((a, b) => b.score - a.score);
    const hi = nodes[0], lo = nodes[nodes.length - 1];
    if (hi.score - lo.score <= settings.migration_threshold) break;
    const cand = mockVmStore.guests.filter((g) => g.node === hi.node && g.status === 'running' && !taken.has(g.vmid)
      && (!STAYS[g.vmid] || (STAYS[g.vmid] === 'local_disk' && settings.balance_local_disks))
      // a keep-apart rule: not onto a node that holds another of its VMs (the engine's enforced 'separate' rule)
      && !separate.some((r) => r.vmids.includes(g.vmid) && r.vmids.some((v) => v !== g.vmid && mockVmStore.guests.find((x) => x.vmid === v)?.node === lo.node)))
      .sort((a, b) => memOf(a.vmid) - memOf(b.vmid))[0];
    if (!cand) break;
    const before = spread();
    const dm = 100 * memOf(cand.vmid) / NODE_MEM;
    hi.mem -= dm; lo.mem += dm; hi.cpu -= 6; lo.cpu += 6;
    hi.score = hi.cpu + hi.mem; lo.score = lo.cpu + lo.mem;
    taken.add(cand.vmid);
    const d = mockVmStore.desks.find((x) => x.vmid === cand.vmid);
    out.push({ vmid: cand.vmid, name: cand.name, type: 'qemu', from: hi.node, to: lo.node, mem: memOf(cand.vmid), local_disks: LOCAL.has(cand.vmid),
      before, after: spread(), pool: d ? (mockVmStore.pools.find((p) => p.id === d.pool_id)?.name ?? '') : '' });
  }
  return out;
}
function poolName(vmid: number) {
  const d = mockVmStore.desks.find((x) => x.vmid === vmid);
  return d ? (mockVmStore.pools.find((p) => p.id === d.pool_id)?.name ?? '') : '';
}
function haOn(p: { type: string; settings?: { policy?: { ha_enabled?: boolean } } }) {
  return p.settings?.policy?.ha_enabled ?? p.type === 'dedicated';
}

const mockApi: HaDrsApi = {
  haExtra: () => {
    const storage: HaExtra['storage'] = {};
    const passthrough: HaExtra['passthrough'] = {};
    for (const v of mockHaVmids) {
      storage[String(v)] = LOCAL.has(v) ? 'local' : 'shared';
      if (STAYS[v] === 'pci' || STAYS[v] === 'usb') passthrough[String(v)] = STAYS[v] as 'pci' | 'usb';
    }
    const pools = mockVmStore.pools.map((p) => {
      const ds = mockVmStore.desks.filter((d) => d.pool_id === p.id);
      return { id: p.id, name: p.name, type: p.type, ha_enabled: haOn(p as never), desktops: ds.length, in_ha: ds.filter((d) => mockHaVmids.has(d.vmid)).length };
    });
    return delay({ nodes_online: 3, nodes_total: 3, quorate: true, rules_supported: true, storage, passthrough,
      separate: separate.map((r) => ({ ...r, vmids: [...r.vmids] })), pools, waiting: 0,
      names: Object.fromEntries(separate.flatMap((r) => r.vmids).map((v) => [String(v), mockVmStore.guests.find((g) => g.vmid === v)?.name ?? ''])) });
  },
  poolHa: (_cid, poolId, action) => {
    const ds = mockVmStore.desks.filter((d) => d.pool_id === poolId);
    if (!mockVmStore.pools.some((p) => p.id === poolId)) return fail(404, 'No such pool on this cluster');
    const done: number[] = [];
    for (const d of ds) {
      if (action === 'add' && !mockHaVmids.has(d.vmid)) {
        const g = mockVmStore.guests.find((x) => x.vmid === d.vmid);
        mockHaAdd(d.vmid, g?.status === 'running' ? 'started' : 'stopped', `MOAVI Desk pool ${mockVmStore.pools.find((p) => p.id === poolId)?.name}`);
        done.push(d.vmid);
      } else if (action === 'remove' && mockHaVmids.has(d.vmid)) { mockHaRemove(d.vmid); done.push(d.vmid); }
    }
    return delay({ done, failed: [] }, 500);
  },
  separateAdd: (_cid, name, vmids) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(name)) return fail(400, 'name: letters, digits, "-" and "_", starting with a letter');
    if (vmids.length < 2) return fail(400, 'vmids: 2 to 32 VM ids');
    if (separate.some((r) => r.name === name)) return fail(409, 'A rule of that name exists');
    const ha = vmids.every((v) => mockHaVmids.has(v));
    separate.push({ name, vmids: [...vmids].sort((a, b) => a - b), ha_rule: ha, balancer_rule: true, enabled: true, comment: 'MOAVI Desk: keep apart' });
    return delay({ ha_rule: ha });
  },
  separateRemove: (_cid, name) => { const i = separate.findIndex((r) => r.name === name); if (i >= 0) separate.splice(i, 1); return delay(undefined); },
  balance: () => {
    const excluded: Excluded[] = mockVmStore.guests.filter((g) => g.status === 'running' && STAYS[g.vmid]
      && !(STAYS[g.vmid] === 'local_disk' && settings.balance_local_disks))
      .map((g) => ({ vmid: g.vmid, name: g.name, node: g.node, reason: STAYS[g.vmid], pool: poolName(g.vmid) }));
    return delay({ mode, settings: { ...settings }, nodes: nodeView(), recommendations: mode === 'off' ? [] : planMock(),
      computed_at: mode === 'off' ? null : Math.floor(Date.now() / 1000), last_run: new Date(Date.now() - 140e3).toISOString(),
      excluded, history: history.map((h) => ({ ...h })) }, 400);
  },
  balancePut: (_cid, b) => {
    if (b.mode) mode = b.mode;
    const { mode: _m, ...rest } = b;
    Object.assign(settings, rest);
    return delay({ mode, settings: { ...settings } });
  },
  balanceApply: (_cid, vmid, to) => {
    const g = mockVmStore.guests.find((x) => x.vmid === vmid);
    if (!g) return fail(404, 'No such VM on the cluster');
    if (STAYS[vmid] === 'pci' || STAYS[vmid] === 'usb') return fail(409, 'This VM cannot live-migrate', { error: 'This VM cannot live-migrate', code: 'NOT_MOVABLE', reason: STAYS[vmid] });
    history.unshift({ at: new Date().toISOString(), vmid, name: g.name, from: g.node, to, how: 'apply', by: 'admin', ok: true, error: '' });
    g.node = to;
    const d = mockVmStore.desks.find((x) => x.vmid === vmid);
    if (d) d.node = to;
    return delay({ task: `UPID:${to}:0000AA01:qmigrate:${vmid}:root@pam:` }, 600);
  },
  balanceRun: () => {
    for (const m of planMock()) {
      const g = mockVmStore.guests.find((x) => x.vmid === m.vmid)!;
      history.unshift({ at: new Date().toISOString(), vmid: m.vmid, name: m.name, from: m.from, to: m.to, how: 'run', by: 'admin', ok: true, error: '' });
      g.node = m.to;
    }
    return delay(undefined, 800);
  },
};

export const haDrsApi: HaDrsApi = isMock ? mockApi : realApi;
