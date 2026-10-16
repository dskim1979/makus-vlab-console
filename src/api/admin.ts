// Admin console calls: /api/vlab/admin/* only (makus-vlab pegaprox/api/vlab.py).
import { ApiError, isMock, request } from './client';
import { mockAdminApi } from './mockAdmin';
import type { Lab, LabInput, LabRun, LabSchedule, LabScheduleInput, Terminal, RightSizing, AlertChannel, AlertChannelInput, AlertRule, AlertRuleInput, AlertMute, ClusterAlerts, MuteInput, Infra, InfraRange, AdminDesktop, AssignableUser, AccelInventory, AdminLease, AuditPage, BackupJob, BackupStorage, Branding, BrandingSlot, PbsServer, VmBackup, PoolPolicy, PoolPolicyAnswer, AuditQuery, GpuApplyResult, GpuPolicy, VgpuProfile, PowerAction, ClusterNode, ClusterStorage, PlatformSettings, UsageReport, Directory, DirectoryTest, CloneResult, Cluster, Guest, NewCluster, Pool, PoolResetResult, PoolType, PoolUpdate, EndedSession, Notice, NoticeInput, SessionRow, Summary, Template, UserAccess } from './types';

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
    call<{ lease: AdminLease; needs_restart: boolean; warnings?: { code: string; severity: string; ko: string; en: string }[] }>('POST', '/api/vlab/admin/leases', l),
  returnLease: async (id: string) => { await call('POST', `/api/vlab/admin/leases/${enc(id)}/return`); },
  extendLease: async (id: string, ends_at: string) => { await call('POST', `/api/vlab/admin/leases/${enc(id)}/extend`, { ends_at }); },
  branding: async () => (await call<{ branding: Branding }>('GET', '/api/vlab/admin/branding')).branding,
  saveBranding: async (b: Branding) => (await call<{ branding: Branding }>('PUT', '/api/vlab/admin/branding', b)).branding,
  uploadBrandingImage: async (slot: BrandingSlot, file: File) => {
    const form = new FormData();
    form.append('slot', slot);
    form.append('file', file);
    const r = await fetch('/api/vlab/admin/branding/image', { method: 'POST', body: form, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data.branding as Branding;
  },
  deleteBrandingImage: async (slot: BrandingSlot) =>
    (await call<{ branding: Branding }>('DELETE', `/api/vlab/admin/branding/image/${slot}`)).branding,
  backupStorages: async (clusterId: string) =>
    (await call<{ storages: BackupStorage[] }>('GET', `/api/vlab/admin/clusters/${enc(clusterId)}/backup/storages`)).storages,
  backupJobs: async (clusterId: string) =>
    (await call<{ jobs: BackupJob[] }>('GET', `/api/vlab/admin/clusters/${enc(clusterId)}/backup/jobs`)).jobs,
  createPoolBackupJob: async (poolId: string, job: Record<string, string | number>) => {
    await call('POST', `/api/vlab/admin/pools/${enc(poolId)}/backup/job`, job);
  },
  deleteBackupJob: async (clusterId: string, jobId: string) => {
    await call('DELETE', `/api/vlab/admin/clusters/${enc(clusterId)}/backup/jobs/${enc(jobId)}`);
  },
  labs: async () => (await call<{ labs: Lab[]; now: string }>('GET', '/api/vlab/admin/labs')).labs,
  saveLab: async (id: string | null, body: LabInput) =>
    (await call<{ lab: Lab }>(id ? 'PUT' : 'POST', id ? `/api/vlab/admin/labs/${enc(id)}` : '/api/vlab/admin/labs', body)).lab,
  deleteLab: async (id: string) => { await call('DELETE', `/api/vlab/admin/labs/${enc(id)}`); },
  terminals: async () => (await call<{ terminals: Terminal[] }>('GET', '/api/vlab/admin/terminals')).terminals,
  addTerminal: async (body: { mac: string; name?: string; lab_id?: string | null }) =>
    (await call<{ terminal: Terminal }>('POST', '/api/vlab/admin/terminals', body)).terminal,
  updateTerminal: async (id: string, body: { name?: string; lab_id?: string | null; state?: Terminal['state'] }) =>
    (await call<{ terminal: Terminal }>('PUT', `/api/vlab/admin/terminals/${enc(id)}`, body)).terminal,
  terminalKey: async (id: string) => call<{ key: string; terminal: Terminal }>('POST', `/api/vlab/admin/terminals/${enc(id)}/key`),
  deleteTerminal: async (id: string) => { await call('DELETE', `/api/vlab/admin/terminals/${enc(id)}`); },
  labSchedules: async () => (await call<{ schedules: LabSchedule[] }>('GET', '/api/vlab/admin/lab-schedules')).schedules,
  saveLabSchedule: async (id: string | null, body: LabScheduleInput) =>
    (await call<{ schedule: LabSchedule }>(id ? 'PUT' : 'POST', id ? `/api/vlab/admin/lab-schedules/${enc(id)}` : '/api/vlab/admin/lab-schedules', body)).schedule,
  deleteLabSchedule: async (id: string) => { await call('DELETE', `/api/vlab/admin/lab-schedules/${enc(id)}`); },
  runLabSchedule: async (id: string, phase: 'prepare' | 'finish') =>
    call<LabRun>('POST', `/api/vlab/admin/lab-schedules/${enc(id)}/run`, { phase }),
  rightsizing: async (clusterId: string, days: 7 | 30) =>
    call<RightSizing>('GET', `/api/vlab/admin/clusters/${enc(clusterId)}/rightsizing?days=${days}`),
  infra: async (clusterId: string, range: InfraRange) =>
    call<Infra>('GET', `/api/vlab/admin/clusters/${enc(clusterId)}/infra?range=${range}`),
  alerts: async (clusterId: string) => call<ClusterAlerts>('GET', `/api/vlab/admin/clusters/${enc(clusterId)}/alerts`),
  createAlertRule: async (clusterId: string, r: AlertRuleInput) =>
    (await call<{ alert: AlertRule }>('POST', `/api/vlab/admin/clusters/${enc(clusterId)}/alerts/rules`, r)).alert,
  updateAlertRule: async (clusterId: string, ruleId: string, r: Partial<AlertRuleInput>) =>
    (await call<{ alert: AlertRule }>('PUT', `/api/vlab/admin/clusters/${enc(clusterId)}/alerts/rules/${enc(ruleId)}`, r)).alert,
  deleteAlertRule: async (clusterId: string, ruleId: string) => {
    await call('DELETE', `/api/vlab/admin/clusters/${enc(clusterId)}/alerts/rules/${enc(ruleId)}`);
  },
  ackAlert: async (clusterId: string, firedId: string | number) => {
    await call('POST', `/api/vlab/admin/clusters/${enc(clusterId)}/alerts/active/${enc(String(firedId))}/ack`);
  },
  muteAlert: async (clusterId: string, m: MuteInput) =>
    (await call<{ mute: AlertMute }>('POST', `/api/vlab/admin/clusters/${enc(clusterId)}/alerts/mutes`, m)).mute,
  unmuteAlert: async (clusterId: string, muteId: string) => {
    await call('DELETE', `/api/vlab/admin/clusters/${enc(clusterId)}/alerts/mutes/${enc(muteId)}`);
  },
  alertChannels: async () => (await call<{ channels: AlertChannel[] }>('GET', '/api/vlab/admin/alert-channels')).channels,
  createAlertChannel: async (c: AlertChannelInput) =>
    (await call<{ channel: AlertChannel }>('POST', '/api/vlab/admin/alert-channels', c)).channel,
  updateAlertChannel: async (id: string, c: AlertChannelInput) =>
    (await call<{ channel: AlertChannel }>('PUT', `/api/vlab/admin/alert-channels/${enc(id)}`, c)).channel,
  deleteAlertChannel: async (id: string) => { await call('DELETE', `/api/vlab/admin/alert-channels/${enc(id)}`); },
  testAlertChannel: async (id: string) => {
    const { data } = await request<{ success?: boolean; detail?: string; error?: string }>('POST', `/api/vlab/admin/alert-channels/${enc(id)}/test`);
    return { ok: !!data?.success, detail: data?.detail || data?.error || '' };
  },
  pbsServers: async () => call<PbsServer[]>('GET', '/api/vlab/admin/pbs'),
  desktopBackups: async (desktopId: string) => {
    const r = await call<{ backups?: VmBackup[] } | VmBackup[]>('GET', `/api/vlab/admin/desktops/${enc(desktopId)}/backups`);
    return Array.isArray(r) ? r : r.backups ?? [];
  },
  backupNow: async (desktopId: string, storage: string, mode: string) => {
    await call('POST', `/api/vlab/admin/desktops/${enc(desktopId)}/backups`, { storage, mode });
  },
  restoreBackup: async (desktopId: string, volid: string, force = false) => {
    await call('POST', `/api/vlab/admin/desktops/${enc(desktopId)}/backups/restore`, { volid, start: false, ...(force ? { force: true } : {}) });
  },
  deleteBackup: async (desktopId: string, volid: string) => {
    await call('DELETE', `/api/vlab/admin/desktops/${enc(desktopId)}/backups/${volid.split('/').map(enc).join('/')}`);
  },
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
  updatePool: async (poolId: string, p: PoolUpdate) =>
    call<{ pool: Pool; changed: string[] }>('PUT', `/api/vlab/admin/pools/${enc(poolId)}`, p),

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
  endSession: async (sessionId: string) =>
    (await call<{ session: EndedSession }>('POST', `/api/vlab/admin/sessions/${enc(sessionId)}/end`)).session,
  endUserSessions: async (username: string) =>
    (await call<{ ended: EndedSession[] }>('POST', `/api/vlab/admin/users/${enc(username)}/sessions/end`)).ended,
  notices: async () => (await call<{ banners: Notice[] }>('GET', '/api/vlab/admin/banners')).banners,
  saveNotice: async (id: string | null, n: Partial<NoticeInput>) =>
    (await call<{ banner: Notice }>(id ? 'PUT' : 'POST', id ? `/api/vlab/admin/banners/${enc(id)}` : '/api/vlab/admin/banners', n)).banner,
  deleteNotice: async (id: string) => { await call('DELETE', `/api/vlab/admin/banners/${enc(id)}`); },
};

export type AdminApi = typeof realAdminApi;
export const adminApi: AdminApi = isMock ? mockAdminApi : realAdminApi;
