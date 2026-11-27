// 데스크톱 풀 > 정책 > 네트워크 격리 - makus-vlab pegaprox/api/vlab_netiso.py (pegaprox/vlab/netiso.py):
// the pool's desktops take inbound traffic only from the MOAVI gateway, in the Proxmox firewall.
import { ApiError, isMock, request } from './client';
import { mockVmStore } from './mockAdmin';
import type { NetRule } from './types';

export type { NetRule };
export type ClusterNetIso = {
  gateway_sources: string[];
  suggested: string[];
  cluster_firewall: { enable: boolean; policy_in: string } | null;   // null: the cluster did not answer
};
export type NetIsoDesktop = { id: string; name: string; vmid: number; applied: boolean; at: string | null; ips: string[]; error: string };
export type PoolNetIso = {
  enabled: boolean; group: string; ipset: string; gateway_sources: string[];
  problem: string; checked_at: number | null; desktops: NetIsoDesktop[];
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}
const enc = encodeURIComponent;

const realApi = {
  cluster: (cid: string) => call<ClusterNetIso>('GET', `/api/vlab/admin/clusters/${enc(cid)}/netiso`),
  setGateway: (cid: string, gateway_sources: string[]) =>
    call<{ gateway_sources: string[] }>('PUT', `/api/vlab/admin/clusters/${enc(cid)}/netiso`, { gateway_sources }),
  pool: (pid: string) => call<PoolNetIso>('GET', `/api/vlab/admin/pools/${enc(pid)}/netiso`),
  apply: (pid: string) => call<PoolNetIso>('POST', `/api/vlab/admin/pools/${enc(pid)}/netiso/apply`),
};
export type NetIsoApi = typeof realApi;

// --- mock -----------------------------------------------------------------------------------------

const delay = <T,>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const fail = (status: number, msg: string) => Promise.reject(new ApiError(status, msg, { error: msg }));
const gateways: Record<string, string[]> = {};
const appliedAt: Record<string, string> = {};
const IP = /^(\d{1,3})(\.\d{1,3}){3}(\/\d{1,2})?$/;

function poolView(pid: string): PoolNetIso | null {
  const pool = mockVmStore.pools.find((p) => p.id === pid);
  if (!pool) return null;
  const on = !!(pool.settings?.policy as { net_isolation?: boolean } | undefined)?.net_isolation;
  const gw = gateways[pool.cluster_id] ?? [];
  const desks = mockVmStore.desks.filter((d) => d.pool_id === pid);
  return {
    enabled: on, group: `vlab-${pid.slice(-8).padStart(8, '0')}`, ipset: `vlabd-${pid.slice(-8).padStart(8, '0')}`, gateway_sources: gw,
    problem: on && !gw.length ? 'no gateway address for this cluster - nothing applied' : '',
    checked_at: on ? Date.now() / 1000 : null,
    desktops: desks.map((d) => ({ id: d.id, name: d.name, vmid: d.vmid, applied: on && !!gw.length && !!appliedAt[d.id],
      at: appliedAt[d.id] ?? null, ips: [`192.168.0.${(d.vmid % 200) + 20}`], error: '' })),
  };
}

const mockApi: NetIsoApi = {
  cluster: (cid) => delay({ gateway_sources: gateways[cid] ?? [], suggested: ['192.168.0.55'],
    cluster_firewall: { enable: true, policy_in: 'DROP' } }),
  setGateway: (cid, list) => {
    const bad = list.find((x) => !IP.test(x));
    if (bad) return fail(400, `gateway_sources: '${bad}' is not an address or network`);
    gateways[cid] = list;
    return delay({ gateway_sources: list });
  },
  pool: (pid) => { const v = poolView(pid); return v ? delay(v) : fail(404, 'pool not found'); },
  apply: (pid) => {
    const v = poolView(pid);
    if (!v) return fail(404, 'pool not found');
    if (v.enabled && v.gateway_sources.length) v.desktops.forEach((d) => { appliedAt[d.id] = new Date().toISOString(); });
    if (!v.enabled) v.desktops.forEach((d) => { delete appliedAt[d.id]; });
    return delay(poolView(pid)!, 600);
  },
};

export const netisoApi: NetIsoApi = isMock ? mockApi : realApi;
