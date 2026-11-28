// 클러스터 > 네트워크 구성도 - makus-vlab pegaprox/api/vlab_netmap.py: segments, pools, what the
// firewall lets in and out, and what is set up wrong (read only).
import { ApiError, isMock, request } from './client';
import { mockVmStore } from './mockAdmin';
import type { NetZone, Reach, Segment } from './netseg';

export type FindingLevel = 'critical' | 'warning' | 'info';
export type FindingCode =
  | 'dc_firewall_off' | 'no_gateway' | 'rules_missing' | 'rules_differ' | 'vm_firewall_off' | 'gateway_unreachable' | 'sdn_node_problem'
  | 'dc_firewall_unknown' | 'pool_not_isolated' | 'pool_on_management' | 'segment_without_isolation' | 'allow_in_wide' | 'segment_pending' | 'pool_problem'
  | 'egress_open' | 'peers_open' | 'segment_shared' | 'segment_unused' | 'peer_out_missing' | 'rule_pool_missing';
export type Finding = { level: FindingLevel; code: FindingCode; pool: string; segment: string; detail: string };
// peer pool = the pool itself (같은 풀), pool_other = another pool (its id in pool)
export type MapRule = { dir: 'in' | 'out'; peer: 'gateway' | 'pool' | 'pool_other' | 'cidr' | 'any'; cidr: string; proto: string; port: string; note: string;
  action: 'accept' | 'drop'; pool?: string };
export type MapVm = { id: string; name: string; vmid: number; node: string; status: string; ips: string[] | null; bridge: string | null;
  nic_fw: boolean | null; vm_fw: boolean | null; policy_in: string | null; isolated: boolean; read: boolean; error: string | null };
export type MapPool = {
  id: string; name: string; type: string;
  isolation: boolean; peers: boolean; egress: 'any' | 'list'; segment: string; from_bridge: string;
  rules: MapRule[]; live: 'match' | 'differ' | 'missing' | 'unknown' | 'off';
  bridges: string[];
  desktops: { total: number; read: number; isolated: number; fw_off: number; on_segment: number; errors: number };
  problem: string;
  vms: MapVm[];
};
export type MapBridge = { name: string; type: string; nodes: string[]; vlan_aware: string[]; addressed: string[]; comments: string };
export type NetMap = {
  connected: boolean;
  cluster_firewall: { enable: boolean; policy_in: string } | null;
  gateway: { sources: string[]; hosts: string[] };
  zone: NetZone | null;
  sdn: { available: boolean; problem: string; node_problem: string; nodes: Record<string, string> };
  segments: (Segment & { gateway_reach?: Reach })[];
  bridges: MapBridge[]; nodes: string[];
  pools: MapPool[];
  findings: Finding[];
};

async function call<T>(method: string, path: string): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}

const realApi = {
  // the engine answers a map again from memory for a minute; fresh reads Proxmox again (다시 점검)
  map: (cid: string, fresh = false) => call<NetMap>('GET', `/api/vlab/admin/clusters/${encodeURIComponent(cid)}/netmap${fresh ? '?fresh=1' : ''}`),
};
export type NetMapApi = typeof realApi;

// --- mock: one cluster with a bit of everything ------------------------------------------------------

const delay = <T,>(v: T, ms = 400) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const GW: MapRule = { dir: 'in', peer: 'gateway', cidr: '', proto: 'any', port: '', note: 'MOAVI gateway', action: 'accept' };
const ANY_OUT: MapRule = { dir: 'out', peer: 'any', cidr: '', proto: 'any', port: '', note: '', action: 'accept' };
const vmsOf = (prefix: string, n: number, net: string, iso: boolean, offFw = -1): MapVm[] => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}-${i}`, name: `${prefix}-${String(i + 1).padStart(2, '0')}`, vmid: 200 + i + prefix.length * 10, node: `pve${(i % 3) + 1}`,
  status: i === n - 1 ? 'stopped' : 'running', ips: i === n - 1 ? [] : [`${net}.${20 + i}`], bridge: 'vmbr1',
  nic_fw: iso, vm_fw: iso ? i !== offFw : null, policy_in: iso ? 'DROP' : null, isolated: iso, read: true, error: null }));

function mockMap(cid: string): NetMap {
  const names = mockVmStore.pools.filter((p) => p.cluster_id === cid).map((p) => ({ id: p.id, name: p.name }));
  const pick = (i: number, fallback: string) => names[i] ?? { id: `mock_${i}`, name: fallback };
  const [a, b, c, d] = [pick(0, '설계팀'), pick(1, '연구소'), pick(2, '협력사'), pick(3, '실습실')];
  const seg = (id: string, name: string, tag: number, net: string, reach: Reach, pools: string[]): NetMap['segments'][number] => ({
    id, cluster_id: cid, name, department: name, tag, subnet: `${net}.0/24`, gateway: `${net}.1`, dhcp_start: '', dhcp_end: '', snat: false,
    vnet: `mv${id.slice(-6)}`, created_at: '', created_by: '', sdn: 'applied', pools, desktops: 4, usable: 254, gateway_reach: reach,
  } as unknown as NetMap['segments'][number]);
  const pool = (p: { id: string; name: string }, o: Partial<MapPool>): MapPool => ({
    id: p.id, name: p.name, type: 'dedicated', isolation: true, peers: false, egress: 'any', segment: '', from_bridge: '',
    rules: [GW, ANY_OUT], live: 'match', bridges: ['vmbr1'],
    desktops: { total: 4, read: 4, isolated: 4, fw_off: 0, on_segment: 0, errors: 0 }, problem: '', vms: vmsOf(p.name, 4, '10.20.9', true), ...o,
  });
  return {
    connected: true,
    cluster_firewall: { enable: true, policy_in: 'ACCEPT' },
    gateway: { sources: ['192.168.0.55'], hosts: ['192.168.0.55', 'warp.makus.local'] },
    zone: { zone: 'moavi', type: 'vlan', bridge: 'vmbr1', peers: '', mtu: 0, existing: false },
    sdn: { available: true, problem: '', node_problem: '', nodes: { pve1: 'available', pve2: 'available', pve3: 'available' } },
    segments: [seg('seg_aaaaaa', '설계', 110, '10.20.1', 'reachable', [a.name]), seg('seg_bbbbbb', '연구', 120, '10.20.2', 'reachable', [b.name]),
      seg('seg_cccccc', '외부 협력', 130, '10.20.3', 'unreachable', [c.name]), seg('seg_dddddd', '예비', 140, '10.20.4', 'reachable', [])],
    bridges: [{ name: 'vmbr0', type: 'bridge', nodes: ['pve1', 'pve2', 'pve3'], vlan_aware: [], addressed: ['pve1', 'pve2', 'pve3'], comments: '관리' },
      { name: 'vmbr1', type: 'OVSBridge', nodes: ['pve1', 'pve2', 'pve3'], vlan_aware: [], addressed: [], comments: 'VM' }],
    nodes: ['pve1', 'pve2', 'pve3'],
    pools: [
      pool(a, { segment: 'seg_aaaaaa', bridges: ['mvaaaaaa'], desktops: { total: 6, read: 6, isolated: 6, fw_off: 0, on_segment: 6, errors: 0 },
        vms: vmsOf('design', 6, '10.20.1', true),
        rules: [GW, { dir: 'in', peer: 'cidr', cidr: '10.10.0.0/24', proto: 'tcp', port: '22', note: '관리자 SSH', action: 'accept' },
          { dir: 'in', peer: 'pool_other', cidr: '', proto: 'tcp', port: '445', note: '도면 공유', action: 'accept', pool: b.id },
          { dir: 'out', peer: 'cidr', cidr: '0.0.0.0/0', proto: 'tcp', port: '25', note: '메일 직접 발송 금지', action: 'drop' }, ANY_OUT] }),
      pool(b, { segment: 'seg_bbbbbb', peers: true, egress: 'list', bridges: ['mvbbbbbb'], live: 'differ',
        desktops: { total: 4, read: 4, isolated: 4, fw_off: 1, on_segment: 3, errors: 0 },
        vms: vmsOf('lab-r', 4, '10.20.2', true, 2),
        rules: [GW, { dir: 'in', peer: 'pool', cidr: '', proto: 'any', port: '', note: 'same pool', action: 'accept' },
          { dir: 'out', peer: 'gateway', cidr: '', proto: 'any', port: '', note: 'MOAVI gateway', action: 'accept' },
          { dir: 'out', peer: 'pool', cidr: '', proto: 'any', port: '', note: 'same pool', action: 'accept' },
          { dir: 'out', peer: 'cidr', cidr: '10.30.0.10', proto: 'tcp', port: '443,8443', note: '라이선스 서버', action: 'accept' }] }),
      pool(c, { segment: 'seg_cccccc', bridges: ['mvcccccc'], desktops: { total: 3, read: 3, isolated: 3, fw_off: 0, on_segment: 3, errors: 0 },
        vms: vmsOf('partner', 3, '10.20.3', true),
        rules: [GW, { dir: 'in', peer: 'cidr', cidr: '0.0.0.0/0', proto: 'tcp', port: '3389', note: '', action: 'accept' }, ANY_OUT] }),
      pool(d, { isolation: false, rules: [], live: 'off', bridges: ['vmbr0'], desktops: { total: 8, read: 8, isolated: 0, fw_off: 0, on_segment: 0, errors: 0 },
        vms: vmsOf('class', 8, '192.168.0', false).map((v) => ({ ...v, bridge: 'vmbr0' })) }),
    ],
    findings: [
      { level: 'critical', code: 'rules_differ', pool: b.id, segment: '', detail: 'vlab-1a2b3c4d' },
      { level: 'critical', code: 'vm_firewall_off', pool: b.id, segment: '', detail: 'lab-r-03' },
      { level: 'critical', code: 'gateway_unreachable', pool: '', segment: 'seg_cccccc', detail: '10.20.3.1' },
      { level: 'warning', code: 'pool_not_isolated', pool: d.id, segment: '', detail: '' },
      { level: 'warning', code: 'pool_on_management', pool: d.id, segment: '', detail: 'vmbr0' },
      { level: 'warning', code: 'allow_in_wide', pool: c.id, segment: '', detail: '0.0.0.0/0' },
      { level: 'warning', code: 'segment_pending', pool: b.id, segment: 'seg_bbbbbb', detail: '3/4' },
      { level: 'warning', code: 'peer_out_missing', pool: b.id, segment: '', detail: `${a.name} tcp 445` },
      { level: 'info', code: 'egress_open', pool: a.id, segment: '', detail: '' },
      { level: 'info', code: 'egress_open', pool: c.id, segment: '', detail: '' },
      { level: 'info', code: 'peers_open', pool: b.id, segment: '', detail: '' },
      { level: 'info', code: 'segment_unused', pool: '', segment: 'seg_dddddd', detail: '' },
    ],
  };
}

const mockApi: NetMapApi = { map: (cid) => delay(mockMap(cid)) };   // fresh: the mock is always fresh

export const netmapApi: NetMapApi = isMock ? mockApi : realApi;
