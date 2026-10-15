// Admin console calls: /api/vlab/admin/* only (makus-vlab pegaprox/api/vlab.py).
import { ApiError, isMock, request } from './client';
import { mockAdminApi } from './mockAdmin';
import type { AdminDesktop, AssignableUser, AccelInventory, AdminLease, AuditPage, PoolPolicy, PoolPolicyAnswer, AuditQuery, GpuApplyResult, GpuPolicy, VgpuProfile, PowerAction, ClusterNode, ClusterStorage, PlatformSettings, UsageReport, Directory, DirectoryTest, CloneResult, Cluster, Guest, NewCluster, Pool, PoolResetResult, PoolType, SessionRow, Summary, Template, UserAccess } from './types';

// Calls that must succeed: a non-2xx answer throws with the engine's own message.
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}

const enc = encodeURIComponent;

const realAdminApi = {
  clusters: async () => (await call<{ clusters: Cluster[] }>('GET', '/api/vlab/admin/clusters')).clusters,
  connectCluster: async (c: NewCluster) => call<{ id: string; api_token_created?: boolean }>('POST', '/api/vlab/admin/clusters', c),
  disconnectCluster: async (clusterId: string) => { await call('DELETE', `/api/vlab/admin/clusters/${enc(clusterId)}`); },
  accelerators: async (clusterId: string) =>
    call<AccelInventory>('GET', `/api/vlab/admin/clusters/${enc(clusterId)}/accelerators`),
  profiles: async (clusterId: string, node: string, pciid: string) =>
    (await call<{ profiles: VgpuProfile[] }>('GET',
      `/api/vlab/admin/clusters/${enc(clusterId)}/nodes/${enc(node)}/pci/${enc(pciid)}/profiles`)).profiles,
  leases: async (all = false) =>
    (await call<{ leases: AdminLease[] }>('GET', `/api/vlab/admin/leases${all ? '?all=1' : ''}`)).leases,
  lend: async (l: { desktop_id: string; mapping: string; ends_at: string; name?: string }) =>
    call<{ lease: AdminLease; needs_restart: boolean }>('POST', '/api/vlab/admin/leases', l),
  returnLease: async (id: string) => { await call('POST', `/api/vlab/admin/leases/${enc(id)}/return`); },
  extendLease: async (id: string, ends_at: string) => { await call('POST', `/api/vlab/admin/leases/${enc(id)}/extend`, { ends_at }); },
  poolPolicy: async (poolId: string) => call<PoolPolicyAnswer>('GET', `/api/vlab/admin/pools/${enc(poolId)}/policy`),
  savePoolPolicy: async (poolId: string, p: PoolPolicy) =>
    (await call<{ policy: PoolPolicy }>('PUT', `/api/vlab/admin/pools/${enc(poolId)}/policy`, p)).policy,
  setPoolGpu: async (poolId: string, g: GpuPolicy) =>
    (await call<{ gpu: GpuPolicy }>('PUT', `/api/vlab/admin/pools/${enc(poolId)}/gpu`, g)).gpu,
  applyPoolGpu: async (poolId: string) => {
    const { data } = await request<GpuApplyResult>('POST', `/api/vlab/admin/pools/${enc(poolId)}/gpu/apply`);
    return data ?? { applied: [], failed: [], needs_restart: [] };
  },
  nodes: async (clusterId: string) =>
    (await call<{ nodes: ClusterNode[] }>('GET', `/api/vlab/admin/clusters/${enc(clusterId)}/nodes`)).nodes,
  storage: async (clusterId: string) =>
    (await call<{ storage: ClusterStorage[] }>('GET', `/api/vlab/admin/clusters/${enc(clusterId)}/storage`)).storage,
  guests: async (clusterId: string) =>
    (await call<{ guests: Guest[] }>('GET', `/api/vlab/admin/clusters/${enc(clusterId)}/guests`)).guests,
  templates: async (clusterId: string, details = false) =>
    (await call<{ templates: Template[] }>('GET', `/api/vlab/admin/clusters/${enc(clusterId)}/templates${details ? '?details=1' : ''}`)).templates,
  powerDesktop: async (desktopId: string, action: PowerAction) => {
    await call('POST', `/api/vlab/admin/desktops/${enc(desktopId)}/power`, { action });
  },
  users: async () => (await call<{ users: AssignableUser[] }>('GET', '/api/vlab/admin/users')).users,
  allUsers: async () => (await call<{ users: AssignableUser[] }>('GET', '/api/vlab/admin/users?all=1')).users,
  directory: async () => (await call<{ directory: Directory }>('GET', '/api/vlab/admin/directory')).directory,
  saveDirectory: async (d: Partial<Directory>) => { await call('PUT', '/api/vlab/admin/directory', d); },
  testDirectory: async (d: Partial<Directory> & { test_username?: string }) => {
    const { data } = await request<DirectoryTest>('POST', '/api/vlab/admin/directory/test', d);
    return data ?? {};
  },
  settings: async () => (await call<{ settings: PlatformSettings }>('GET', '/api/vlab/admin/settings')).settings,
  saveSettings: async (v: Partial<PlatformSettings>) => { await call('PUT', '/api/vlab/admin/settings', v); },
  testSmtp: async (v: Partial<PlatformSettings> & { email: string }) => {
    await call('POST', '/api/vlab/admin/settings/smtp-test', v);
  },
  userAccess: async (username: string) => call<UserAccess>('GET', `/api/vlab/admin/users/${enc(username)}/access`),

  pools: async () => (await call<{ pools: Pool[] }>('GET', '/api/vlab/admin/pools')).pools,
  createPool: async (p: { name: string; type: PoolType; cluster_id: string; description?: string }) =>
    (await call<{ pool: Pool }>('POST', '/api/vlab/admin/pools', p)).pool,
  deletePool: async (poolId: string) => { await call('DELETE', `/api/vlab/admin/pools/${enc(poolId)}`); },

  poolDesktops: async (poolId: string) =>
    (await call<{ desktops: AdminDesktop[] }>('GET', `/api/vlab/admin/pools/${enc(poolId)}/desktops`)).desktops,
  addDesktop: async (poolId: string, g: { vmid: number; node?: string; type?: string; name?: string }) => {
    await call('POST', `/api/vlab/admin/pools/${enc(poolId)}/desktops`, g);
  },
  clone: async (poolId: string, c: { template_vmid: number; count: number; name_prefix: string; full: boolean; start_vmid?: number }) =>
    call<CloneResult>('POST', `/api/vlab/admin/pools/${enc(poolId)}/clone`, c),
  removeDesktop: async (desktopId: string) => { await call('DELETE', `/api/vlab/admin/desktops/${enc(desktopId)}`); },
  assign: async (desktopId: string, username: string | null) => {
    await call('PUT', `/api/vlab/admin/desktops/${enc(desktopId)}/assign`, { username });
  },
  takeBase: async (desktopId: string) => { await call('POST', `/api/vlab/admin/desktops/${enc(desktopId)}/base`); },
  resetDesktop: async (desktopId: string, force = false) => {
    await call('POST', `/api/vlab/admin/desktops/${enc(desktopId)}/reset`, { force });
  },
  resetPool: async (poolId: string, force = false) =>
    call<PoolResetResult>('POST', `/api/vlab/admin/pools/${enc(poolId)}/reset`, { force }),
  audit: async (f: AuditQuery = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) {
      if (v === undefined || v === '' || v === false) continue;
      q.set(k, v === true ? '1' : String(v));
    }
    const qs = q.toString();
    return call<AuditPage>('GET', `/api/vlab/admin/audit${qs ? `?${qs}` : ''}`);
  },
  usage: async (days: number, poolId?: string) =>
    call<UsageReport>('GET', `/api/vlab/admin/usage?days=${days}${poolId ? `&pool_id=${encodeURIComponent(poolId)}` : ''}`),
  summary: async () => call<Summary>('GET', '/api/vlab/admin/summary'),
  desktops: async () => (await call<{ desktops: AdminDesktop[] }>('GET', '/api/vlab/admin/desktops')).desktops,
  sessions: async (f: { username?: string; pool_id?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (f.username) q.set('username', f.username);
    if (f.pool_id) q.set('pool_id', f.pool_id);
    if (f.limit) q.set('limit', String(f.limit));
    const qs = q.toString();
    return (await call<{ sessions: SessionRow[] }>('GET', `/api/vlab/admin/sessions${qs ? `?${qs}` : ''}`)).sessions;
  },
};

export type AdminApi = typeof realAdminApi;
export const adminApi: AdminApi = isMock ? mockAdminApi : realAdminApi;
