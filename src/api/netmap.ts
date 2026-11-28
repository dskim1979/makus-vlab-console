// 클러스터 > 네트워크 구성도 - makus-vlab pegaprox/api/vlab_netmap.py: segments, pools, what the
// firewall lets in and out, and what is set up wrong (read only).
import { ApiError, isMock, request } from './client';
import { mockVmStore } from './mockAdmin';
import type { NetZone, Reach, Segment } from './netseg';

export type FindingLevel = 'critical' | 'warning' | 'info';
export type FindingCode =
  | 'dc_firewall_off' | 'no_gateway' | 'rules_missing' | 'rules_differ' | 'vm_firewall_off' | 'gateway_unreachable' | 'sdn_node_problem'
  | 'dc_firewall_unknown' | 'pool_not_isolated' | 'pool_on_management' | 'segment_without_isolation' | 'allow_in_wide' | 'segment_pending' | 'pool_problem'
  | 'egress_open' | 'peers_open' | 'segment_shared' | 'segment_unused';
export type Finding = { level: FindingLevel; code: FindingCode; pool: string; segment: string; detail: string };
export type MapRule = { dir: 'in' | 'out'; peer: 'gateway' | 'pool' | 'cidr' | 'any'; cidr: string; proto: string; port: string; note: string };
export type MapPool = {
  id: string; name: string; type: string;
  isolation: boolean; peers: boolean; egress: 'any' | 'list'; segment: string; from_bridge: string;
  rules: MapRule[]; live: 'match' | 'differ' | 'missing' | 'unknown' | 'off';
  bridges: string[];
  desktops: { total: number; read: number; isolated: number; fw_off: number; on_segment: number; errors: number };
  problem: string;
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
  map: (cid: string) => call<NetMap>('GET', `/api/vlab/admin/clusters/${encodeURIComponent(cid)}/netmap`),
};
export type NetMapApi = typeof realApi;

// --- mock: one cluster with a bit of everything ------------------------------------------------------

const delay = <T,>(v: T, ms = 400) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const GW: MapRule = { dir: 'in', peer: 'gateway', cidr: '', proto: 'any', port: '', note: 'MOAVI gateway' };
const ANY_OUT: MapRule = { dir: 'out', peer: 'any', cidr: '', proto: 'any', port: '', note: '' };

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
    desktops: { total: 4, read: 4, isolated: 4, fw_off: 0, on_segment: 0, errors: 0 }, problem: '', ...o,
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
        rules: [GW, { dir: 'in', peer: 'cidr', cidr: '10.10.0.0/24', proto: 'tcp', port: '22', note: '관리자 SSH' }, ANY_OUT] }),
      pool(b, { segment: 'seg_bbbbbb', peers: true, egress: 'list', bridges: ['mvbbbbbb'], live: 'differ',
        desktops: { total: 4, read: 4, isolated: 4, fw_off: 1, on_segment: 3, errors: 0 },
        rules: [GW, { dir: 'in', peer: 'pool', cidr: '', proto: 'any', port: '', note: 'same pool' },
          { dir: 'out', peer: 'gateway', cidr: '', proto: 'any', port: '', note: 'MOAVI gateway' },
          { dir: 'out', peer: 'pool', cidr: '', proto: 'any', port: '', note: 'same pool' },
          { dir: 'out', peer: 'cidr', cidr: '10.30.0.10', proto: 'tcp', port: '443,8443', note: '라이선스 서버' }] }),
      pool(c, { segment: 'seg_cccccc', bridges: ['mvcccccc'], desktops: { total: 3, read: 3, isolated: 3, fw_off: 0, on_segment: 3, errors: 0 },
        rules: [GW, { dir: 'in', peer: 'cidr', cidr: '0.0.0.0/0', proto: 'tcp', port: '3389', note: '' }, ANY_OUT] }),
      pool(d, { isolation: false, rules: [], live: 'off', bridges: ['vmbr0'], desktops: { total: 8, read: 8, isolated: 0, fw_off: 0, on_segment: 0, errors: 0 } }),
    ],
    findings: [
      { level: 'critical', code: 'rules_differ', pool: b.id, segment: '', detail: 'vlab-1a2b3c4d' },
      { level: 'critical', code: 'vm_firewall_off', pool: b.id, segment: '', detail: 'lab-r-03' },
      { level: 'critical', code: 'gateway_unreachable', pool: '', segment: 'seg_cccccc', detail: '10.20.3.1' },
      { level: 'warning', code: 'pool_not_isolated', pool: d.id, segment: '', detail: '' },
      { level: 'warning', code: 'pool_on_management', pool: d.id, segment: '', detail: 'vmbr0' },
      { level: 'warning', code: 'allow_in_wide', pool: c.id, segment: '', detail: '0.0.0.0/0' },
      { level: 'warning', code: 'segment_pending', pool: b.id, segment: 'seg_bbbbbb', detail: '3/4' },
      { level: 'info', code: 'egress_open', pool: a.id, segment: '', detail: '' },
      { level: 'info', code: 'egress_open', pool: c.id, segment: '', detail: '' },
      { level: 'info', code: 'peers_open', pool: b.id, segment: '', detail: '' },
      { level: 'info', code: 'segment_unused', pool: '', segment: 'seg_dddddd', detail: '' },
    ],
  };
}

const mockApi: NetMapApi = { map: (cid) => delay(mockMap(cid)) };

export const netmapApi: NetMapApi = isMock ? mockApi : realApi;
