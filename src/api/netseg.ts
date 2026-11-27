// 클러스터 > 네트워크 분리 - makus-vlab pegaprox/api/vlab_netseg.py (pegaprox/vlab/netseg.py):
// segments (a department's network) as Proxmox SDN VNets with a subnet in the PVE IPAM, and pools
// whose desktops are moved onto one (pool policy net_segment).
import { ApiError, isMock, request } from './client';
import { mockVmStore } from './mockAdmin';

export type ZoneType = 'vlan' | 'vxlan' | 'simple';
export type NetZone = { zone: string; type: ZoneType; bridge: string; peers: string; mtu: number; existing: boolean | number };
export type SegmentInput = {
  name: string; department: string; tag: number; subnet: string; gateway: string;
  dhcp_start: string; dhcp_end: string; snat: boolean;
};
export type Segment = SegmentInput & {
  id: string; cluster_id: string; vnet: string; created_at: string;
  pools: string[]; desktops: number; usable: number;
  sdn: 'missing' | 'applied' | 'new' | 'changed' | 'deleted';
};
export type ClusterNetSeg = {
  zone: NetZone | null;
  segments: Segment[];
  sdn: { available: boolean; problem: string; zones: { zone: string; type: string; pending: string }[];
    pending_ours: string[]; pending_other: string[];
    nodes?: Record<string, string>; node_problem?: string };   // the zone on each node: available / error / pending / missing
};
export type IpEntry = { ip: string; mac: string; vmid: number | null; name: string; desktop_id: string; sources: string[]; problem: string };
export type SegmentIpam = {
  segment_id: string; vnet: string; subnet: string; usable: number; used: number; free: number;
  dhcp: { start: string; end: string } | null; entries: IpEntry[];
  outside: { ip: string; vmid: number; name: string; desktop_id: string }[]; duplicates: number;
};
export type Ipam = { ipam: boolean; segments: SegmentIpam[] };
export type SegState = 'on' | 'off' | 'waiting' | 'waiting_sdn' | 'waiting_back' | 'error';
export type PoolNetSeg = {
  segment: (SegmentInput & { id: string; vnet: string }) | null; problem: string; checked_at: number | null;
  desktops: { id: string; name: string; vmid: number; state: SegState; bridge: string; orig_bridge: string; running: boolean; error: string }[];
};
export type SdnResult = { changed: string[]; applied: boolean; problem: string; nodes?: Record<string, string>; node_problem?: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}
const enc = encodeURIComponent;
const C = (cid: string) => `/api/vlab/admin/clusters/${enc(cid)}/netseg`;

const realApi = {
  cluster: (cid: string) => call<ClusterNetSeg>('GET', C(cid)),
  setZone: (cid: string, z: Partial<NetZone>) => call<{ zone: NetZone }>('PUT', `${C(cid)}/zone`, z),
  removeZone: (cid: string) => call<{ deleted: string; removed_from_sdn: boolean }>('DELETE', `${C(cid)}/zone`),
  add: (cid: string, s: SegmentInput) => call<Segment>('POST', `${C(cid)}/segments`, s),
  update: (cid: string, id: string, s: SegmentInput) => call<Segment>('PUT', `${C(cid)}/segments/${enc(id)}`, s),
  remove: (cid: string, id: string) => call<{ deleted: string }>('DELETE', `${C(cid)}/segments/${enc(id)}`),
  applySdn: (cid: string) => call<SdnResult>('POST', `${C(cid)}/sdn`),
  ipam: (cid: string) => call<Ipam>('GET', `${C(cid)}/ipam`),
  reserve: (cid: string, id: string, ip: string, mac: string) => call<{ reserved: string }>('POST', `${C(cid)}/segments/${enc(id)}/ips`, { ip, mac }),
  unreserve: (cid: string, id: string, ip: string, mac: string) => call<{ released: string }>('DELETE', `${C(cid)}/segments/${enc(id)}/ips`, { ip, mac }),
  pool: (pid: string) => call<PoolNetSeg>('GET', `/api/vlab/admin/pools/${enc(pid)}/netseg`),
  applyPool: (pid: string, restart: boolean) => call<PoolNetSeg>('POST', `/api/vlab/admin/pools/${enc(pid)}/netseg/apply`, { restart }),
};
export type NetSegApi = typeof realApi;

// --- mock -----------------------------------------------------------------------------------------

const delay = <T,>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const fail = (status: number, msg: string) => Promise.reject(new ApiError(status, msg, { error: msg }));
const zones: Record<string, NetZone> = {};
const segs: Record<string, (Segment & { _sdn: Segment['sdn'] })[]> = {};
const moved: Record<string, { seg: string; orig: string }> = {};   // desktop id
const reserved: Record<string, { ip: string; mac: string }[]> = {};
let n = 0;

const ipNum = (ip: string) => ip.split('.').reduce((a, x) => a * 256 + Number(x), 0);
const ipStr = (v: number) => [24, 16, 8, 0].map((s) => (v >>> s) & 255).join('.');
function cidr(s: string): [number, number] | null {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const p = Number(m[2]);
  const mask = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0;
  return [(ipNum(m[1]) & mask) >>> 0, p];
}
const inNet = (ip: string, net: string) => { const c = cidr(net); if (!c) return false; const mask = (0xffffffff << (32 - c[1])) >>> 0; return ((ipNum(ip) & mask) >>> 0) === c[0]; };
const vnetOf = (id: string) => `mv${id.slice(-6).padStart(6, '0')}`;
const isRunning = (vmid: number) => mockVmStore.guests.find((g) => g.vmid === vmid)?.status === 'running';
const policyOf = (pid: string) => (mockVmStore.pools.find((p) => p.id === pid)?.settings?.policy ?? {}) as { net_segment?: string };

function check(cid: string, s: SegmentInput, self?: string): string | null {
  const z = zones[cid];
  if (!s.name.trim()) return 'name: 1 to 40 characters';
  if (z?.type !== 'simple' && (!s.tag || s.tag < 1 || s.tag > (z?.type === 'vxlan' ? 16777215 : 4094))) return `tag: 1 to ${z?.type === 'vxlan' ? 16777215 : 4094}`;
  const c = cidr(s.subnet);
  if (!c || c[1] < 16 || c[1] > 29) return 'subnet: IPv4, from /16 to /29';
  if (!inNet(s.gateway, s.subnet)) return `gateway: ${s.gateway} is not a host address of ${s.subnet}`;
  if (!!s.dhcp_start !== !!s.dhcp_end) return 'dhcp_start and dhcp_end go together';
  for (const o of segs[cid] ?? []) {
    if (o.id === self) continue;
    if (z?.type !== 'simple' && o.tag === s.tag) return `tag ${s.tag} is already segment '${o.name}'`;
    const a = cidr(o.subnet)!;
    const p = Math.min(a[1], c[1]); const mask = (0xffffffff << (32 - p)) >>> 0;
    if (((a[0] & mask) >>> 0) === ((c[0] & mask) >>> 0)) return `${s.subnet} overlaps segment '${o.name}' (${o.subnet})`;
  }
  return null;
}
function view(cid: string): ClusterNetSeg {
  const list = (segs[cid] ?? []).map((s) => {
    const pools = mockVmStore.pools.filter((p) => p.cluster_id === cid && policyOf(p.id).net_segment === s.id).map((p) => p.name);
    const c = cidr(s.subnet)!;
    return { ...s, sdn: s._sdn, pools, desktops: Object.values(moved).filter((m) => m.seg === s.id).length, usable: 2 ** (32 - c[1]) - 2 };
  });
  const pending = list.filter((s) => s.sdn !== 'applied').map((s) => `vnet ${s.vnet} (${s.sdn === 'missing' ? 'new' : s.sdn})`);
  return { zone: zones[cid] ?? null, segments: list,
    sdn: { available: true, problem: '', zones: [{ zone: 'ops', type: 'vlan', pending: '' }, ...(zones[cid] && !zones[cid].existing ? [{ zone: zones[cid].zone, type: zones[cid].type, pending: '' }] : [])],
      pending_ours: pending, pending_other: [],
      nodes: zones[cid] ? { pve1: 'available', pve2: 'available', pve3: 'available' } : {}, node_problem: '' } };
}
function poolView(pid: string): PoolNetSeg | null {
  const pool = mockVmStore.pools.find((p) => p.id === pid);
  if (!pool) return null;
  const segId = policyOf(pid).net_segment || '';
  const seg = (segs[pool.cluster_id] ?? []).find((s) => s.id === segId) ?? null;
  return {
    segment: seg, problem: seg && seg._sdn !== 'applied' ? 'the segment is not applied in Proxmox SDN yet (네트워크 분리 > SDN 적용)' : '', checked_at: Date.now() / 1000,
    desktops: mockVmStore.desks.filter((d) => d.pool_id === pid).map((d) => {
      const m = moved[d.id];
      const running = isRunning(d.vmid);
      const state: SegState = seg ? (m?.seg === seg.id ? 'on' : seg._sdn !== 'applied' ? 'waiting_sdn' : running ? 'waiting' : 'on')
        : m ? (running ? 'waiting_back' : 'off') : 'off';
      return { id: d.id, name: d.name, vmid: d.vmid, state, bridge: state === 'on' && seg ? seg.vnet : 'vmbr0', orig_bridge: m?.orig ?? '', running, error: '' };
    }),
  };
}
function settle(pid: string, restart: boolean) {
  const v = poolView(pid);
  if (!v) return;
  for (const d of v.desktops) {
    const desk = mockVmStore.desks.find((x) => x.id === d.id)!;
    const running = isRunning(desk.vmid);
    if (v.segment && (d.state === 'on' || (d.state === 'waiting' && restart))) moved[d.id] = { seg: v.segment.id, orig: moved[d.id]?.orig ?? 'vmbr0' };
    if (!v.segment && moved[d.id] && (!running || restart)) delete moved[d.id];
  }
}

const mockApi: NetSegApi = {
  cluster: (cid) => delay(view(cid)),
  setZone: (cid, z) => {
    if ((segs[cid] ?? []).length && zones[cid] && (zones[cid].zone !== (z.zone || 'moavi') || zones[cid].type !== z.type))
      return fail(409, 'the zone cannot change while it has segments - delete them first');
    if (!z.existing && z.type === 'vlan' && !z.bridge) return fail(400, "bridge: the nodes' bridge the VLANs ride on (e.g. vmbr0)");
    if (!z.existing && z.type === 'vxlan' && !z.peers) return fail(400, "peers: the nodes' addresses, comma separated");
    zones[cid] = { zone: z.zone || 'moavi', type: (z.type ?? 'vlan') as ZoneType, bridge: z.bridge ?? '', peers: z.peers ?? '', mtu: z.mtu ?? 0, existing: !!z.existing };
    return delay({ zone: zones[cid] });
  },
  removeZone: (cid) => {
    if (!zones[cid]) return fail(404, 'no zone set');
    if ((segs[cid] ?? []).length) return fail(409, 'delete the segments first');
    const z = zones[cid].zone;
    delete zones[cid];
    return delay({ deleted: z, removed_from_sdn: true });
  },
  add: (cid, s) => {
    if (!zones[cid]) return fail(409, 'set the zone first');
    const e = check(cid, s);
    if (e) return fail(400, e);
    const id = `seg_${(++n).toString(16).padStart(12, '0')}`;
    const row = { ...s, id, cluster_id: cid, vnet: vnetOf(id), created_at: new Date().toISOString(), pools: [], desktops: 0, usable: 0, sdn: 'missing' as const, _sdn: 'missing' as const };
    (segs[cid] ??= []).push(row);
    return delay(row);
  },
  update: (cid, id, s) => {
    const row = (segs[cid] ?? []).find((x) => x.id === id);
    if (!row) return fail(404, 'segment not found');
    const e = check(cid, s, id);
    if (e) return fail(400, e);
    Object.assign(row, s, { _sdn: row._sdn === 'missing' ? 'missing' : 'changed' });
    return delay({ ...row, sdn: row._sdn });
  },
  remove: (cid, id) => {
    const v = view(cid).segments.find((s) => s.id === id);
    if (!v) return fail(404, 'segment not found');
    if (v.pools.length || v.desktops) return fail(409, `in use: pools ${v.pools.join(', ') || '-'}, ${v.desktops} desktop(s) still on it`);
    segs[cid] = segs[cid].filter((s) => s.id !== id);
    return delay({ deleted: id });
  },
  applySdn: (cid) => {
    if (!zones[cid]) return fail(409, 'no zone set for this cluster');
    const changed = (segs[cid] ?? []).filter((s) => s._sdn !== 'applied').map((s) => `vnet ${s.vnet}`);
    (segs[cid] ?? []).forEach((s) => { s._sdn = 'applied'; });
    mockVmStore.pools.filter((p) => p.cluster_id === cid).forEach((p) => settle(p.id, false));
    return delay({ changed, applied: changed.length > 0, problem: '' }, 900);
  },
  ipam: (cid) => delay({ ipam: true, segments: (segs[cid] ?? []).map((s) => {
    const c = cidr(s.subnet)!;
    const usable = 2 ** (32 - c[1]) - 2;
    const entries: IpEntry[] = [{ ip: s.gateway, mac: '', vmid: null, name: 'gateway', desktop_id: '', sources: ['segment'], problem: '' }];
    const on = Object.entries(moved).filter(([, m]) => m.seg === s.id).map(([id]) => mockVmStore.desks.find((d) => d.id === id)!).filter(Boolean);
    on.forEach((d, i) => entries.push({ ip: ipStr(c[0] + 20 + i), mac: `BC:24:11:00:${(d.vmid >> 8 & 255).toString(16).padStart(2, '0')}:${(d.vmid & 255).toString(16).padStart(2, '0')}`.toUpperCase(),
      vmid: d.vmid, name: d.name, desktop_id: d.id, sources: isRunning(d.vmid) ? ['ipam', 'agent'] : ['ipam'], problem: '' }));
    (reserved[s.id] ?? []).forEach((r) => entries.push({ ip: r.ip, mac: r.mac, vmid: null, name: '', desktop_id: '', sources: ['ipam'], problem: '' }));
    entries.sort((a, b) => ipNum(a.ip) - ipNum(b.ip));
    return { segment_id: s.id, vnet: s.vnet, subnet: s.subnet, usable, used: entries.length, free: usable - entries.length,
      dhcp: s.dhcp_start ? { start: s.dhcp_start, end: s.dhcp_end } : null, entries, outside: [], duplicates: 0 };
  }) }),
  reserve: (cid, id, ip, mac) => {
    const s = (segs[cid] ?? []).find((x) => x.id === id);
    if (!s) return fail(404, 'segment not found');
    if (!inNet(ip, s.subnet)) return fail(400, `${ip} is not in ${s.subnet}`);
    (reserved[id] ??= []).push({ ip, mac: mac.toUpperCase() });
    return delay({ reserved: ip });
  },
  unreserve: (_cid, id, ip) => { reserved[id] = (reserved[id] ?? []).filter((r) => r.ip !== ip); return delay({ released: ip }); },
  pool: (pid) => { const v = poolView(pid); return v ? delay(v) : fail(404, 'pool not found'); },
  applyPool: (pid, restart) => { settle(pid, restart); const v = poolView(pid); return v ? delay(v, 600) : fail(404, 'pool not found'); },
};

export const netsegApi: NetSegApi = isMock ? mockApi : realApi;
