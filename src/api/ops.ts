// 운영 기본: the long Proxmox tasks (작업 진행), a node's maintenance, restart and shutdown, its log,
// sensors and tasks (클러스터 > 노드), Proxmox HA (클러스터 > 고가용성) - makus-vlab
// pegaprox/api/vlab_next.py, /api/vlab/tasks and /api/vlab/admin/clusters/<id>/... - and
// MOAVI Desk's own server pair (플랫폼 설정 > 서버 이중화). The pair is the engine's /api/ha/*
// itself, not a /api/vlab wrapper: on a standby the engine hands every other write to the
// active, and a promotion must happen on the standby it is asked of.
import { ApiError, isMock, request } from './client';
import { mockWhoAmI } from './mock';
import { mockVmStore } from './mockAdmin';

export type TaskDesk = { id: string; name: string; pool_id: string };
export type OpsTask = {
  cluster_id: string; cluster: string; node: string; upid: string; type: string; vmid: number | null;
  running: boolean; ok: boolean; status: string; starttime: number | null; endtime: number | null;
  user: string; desktop: TaskDesk | null; percent: number | null;
};
export type TaskList = { scope: 'all' | 'mine'; running: number; tasks: OpsTask[] };
export type TaskLog = { upid: string; node: string; type: string; running: boolean; ok: boolean; status: string; lines: string[] };

export type MaintDesk = { id: string; name: string; vmid: number; pool_id: string; pool: string; status: string; assigned_user: string; in_use: boolean };
export type MaintPreview = {
  node: string; desktops: MaintDesk[];
  guests: { vmid: number; name: string; type: string; status: string }[];
  capacity: { ok: boolean; reason?: string; threshold?: number; guest_count: number; over_threshold: string[]; headroom_sufficient: boolean;
    nodes: { node: string; current_pct: number; projected_pct: number }[] } | null;
  plan: { templates: number; blocking_rules: string[]; online_nodes: number } | null;
};
export type MaintStatus = {
  maintenance_mode?: boolean; node?: string; status?: string; total_vms?: number; migrated_vms?: number;
  failed_vms?: { vmid: number; name: string; error: string }[]; pending_vms?: { vmid: number; name: string }[];
  progress_percent?: number; current_vm?: string | number | null; error?: string | null; note?: string | null;
};
export type MaintOptions = { skip_evacuation?: boolean; migrate_templates?: boolean; relax_anti_affinity?: boolean };
export type Sensor = { chip: string; label: string; kind: 'temp' | 'fan' | 'volt' | 'other'; value: number | null; max: number | null; crit: number | null; alarm: boolean };

export type HaResource = {
  sid: string; vmid: number; type: 'vm' | 'ct'; name: string; node: string; state: string; status: string; group: string;
  max_restart: number; max_relocate: number; comment: string; desktop: TaskDesk | null;
};
export type HaGroup = { group: string; nodes: string; restricted: boolean; nofailback: boolean; comment: string; rule: boolean; resources: string };
export type ClusterHa = { resources: HaResource[]; groups: HaGroup[]; quorate: boolean | null; master: string };
export type HaAdd = { vmid: number; state?: string; group?: string; max_restart?: number; max_relocate?: number; comment?: string };
export type HaGroupAdd = { group: string; nodes: string; restricted?: boolean; nofailback?: boolean; comment?: string; resources?: string };

// /api/ha/status (the engine's own server pair)
export type PairMember = {
  instance_id: string; url: string; fingerprint: string; role_seen: string | null; epoch_seen: number | null;
  confirmed_standby: boolean; serve: boolean; serving_seen: boolean; last_contact: string | null; last_error: string;
  joined_at: string | null; is_source: boolean; site: string;
};
export type PairStatus = {
  role: 'standalone' | 'active' | 'standby'; epoch: number; instance_id: string; interval: number;
  members: PairMember[]; max_members: number; standby_count: number; pairing_open_until: number | null;
  sync: { last_ok_at?: string; last_error?: string; restart_pending?: boolean };
  suggested_url: string; own_fingerprint: string; broken: string;
  removed: { epoch: number; at: string; by: string } | null;
  peer: { url: string | null; last_contact: string | null; last_error: string } | null;
  auto: unknown | null;   // automatic failover: null until a release offers it
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
const C = (cid: string) => `/api/vlab/admin/clusters/${enc(cid)}`;
const N = (cid: string, node: string) => `${C(cid)}/nodes/${enc(node)}`;

const realOpsApi = {
  tasks: async (limit = 100) => call<TaskList>('GET', `/api/vlab/tasks?limit=${limit}`),
  taskLog: async (cid: string, upid: string) => call<TaskLog>('GET', `/api/vlab/tasks/log?cluster=${enc(cid)}&upid=${enc(upid)}`),

  maintenance: async (cid: string, node: string) => call<MaintStatus>('GET', `${N(cid, node)}/maintenance`),
  maintenancePreview: async (cid: string, node: string) => call<MaintPreview>('GET', `${N(cid, node)}/maintenance-preview`),
  setMaintenance: async (cid: string, node: string, enable: boolean, opts: MaintOptions = {}) => {
    await call('PUT', `${N(cid, node)}/maintenance`, { enable, ...opts });
  },
  nodePower: async (cid: string, node: string, action: 'reboot' | 'shutdown') => {
    await call('POST', `${N(cid, node)}/action`, { action, confirm: node });
  },
  syslog: async (cid: string, node: string) => (await call<{ lines: string[] }>('GET', `${N(cid, node)}/syslog?limit=300`)).lines,
  sensors: async (cid: string, node: string) => call<{ sensors: Sensor[]; error: string | null }>('GET', `${N(cid, node)}/sensors`),
  nodeTasks: async (cid: string, node: string) => (await call<{ tasks: OpsTask[] }>('GET', `${N(cid, node)}/tasks?limit=50`)).tasks,

  ha: async (cid: string) => call<ClusterHa>('GET', `${C(cid)}/ha`),
  haAdd: async (cid: string, b: HaAdd) => { await call('POST', `${C(cid)}/ha/resources`, b); },
  haRemove: async (cid: string, vmid: number) => { await call('DELETE', `${C(cid)}/ha/resources/${vmid}`); },
  haGroupAdd: async (cid: string, b: HaGroupAdd) => { await call('POST', `${C(cid)}/ha/groups`, b); },
  haGroupRemove: async (cid: string, group: string) => { await call('DELETE', `${C(cid)}/ha/groups/${enc(group)}`); },

  pair: async () => call<PairStatus>('GET', '/api/ha/status'),
  pairingCode: async (url: string, user_password: string) =>
    call<{ code: string; expires_at: number }>('POST', '/api/ha/pairing-code', { url, user_password }),
  join: async (code: string, own_url: string, user_password: string) =>
    call<{ restarting: boolean }>('POST', '/api/ha/join', { code, own_url, user_password, confirm: true }),
  promote: async (user_password: string, force = false) =>
    call<{ epoch: number; restarting: boolean }>('POST', '/api/ha/promote', { confirm: 'PROMOTE', user_password, ...(force ? { force } : {}) }),
  removeMember: async (id: string, user_password: string, shut_down = false) => {
    await call('POST', `/api/ha/members/${enc(id)}/remove`, { confirm: 'REMOVE', user_password, ...(shut_down ? { shut_down } : {}) });
  },
  unpair: async (user_password: string) => call<{ restarting: boolean }>('POST', '/api/ha/unpair', { confirm: 'UNPAIR', user_password }),
  syncNow: async () => { await call('POST', '/api/ha/sync-now'); },
};
export type OpsApi = typeof realOpsApi;

// --- mock: tasks that run for a while, three nodes, an HA set, a pair of two -----------------

const delay = <T,>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const fail = (status: number, msg: string, body?: unknown) => Promise.reject(new ApiError(status, msg, body ?? { error: msg }));
const CID = 'lab-cluster';
const NODES = ['pve1', 'pve2', 'pve3'];
const now = () => Math.floor(Date.now() / 1000);
const deskOf = (vmid: number | null) => {
  const d = vmid === null ? undefined : mockVmStore.desks.find((x) => x.vmid === vmid);
  return d ? { id: d.id, name: d.name, pool_id: d.pool_id } : null;
};

type MockTask = { node: string; type: string; vmid: number | null; start: number; secs: number; fail?: string; user: string; log: string[] };
const t0 = now();
const mockTasks: MockTask[] = [
  { node: 'pve3', type: 'qmclone', vmid: 402, start: t0 - 40, secs: 180, user: 'admin',
    log: ['create full clone of drive scsi0 (ceph-vm:base-901-disk-0)', 'transferred 12.0 GiB of 120.0 GiB'] },
  { node: 'pve1', type: 'qmigrate', vmid: 302, start: t0 - 15, secs: 90, user: 'admin',
    log: ['starting migration of VM 302 to node \'pve2\' (10.20.0.12)', 'migration status: active (transferred 1.2 GiB)'] },
  { node: 'pve2', type: 'vzdump', vmid: 304, start: t0 - 3600, secs: 600, user: 'root@pam',
    log: ['INFO: starting new backup job: vzdump 304 --storage pbs-main --mode snapshot', 'INFO: Starting Backup of VM 304 (qemu)',
      'ERROR: VM 304 qmp command \'backup\' failed - got timeout', 'INFO: Failed at 2026-10-16 09:12:41', 'TASK ERROR: job errors'], fail: 'job errors' },
  { node: 'pve1', type: 'qmclone', vmid: 305, start: t0 - 7200, secs: 300, user: 'admin', log: ['create full clone of drive scsi0', 'transferred 64.0 GiB of 64.0 GiB (100.00%)', 'TASK OK'] },
  { node: 'pve2', type: 'qmigrate', vmid: 303, start: t0 - 9000, secs: 120, user: 'alice', log: ['migration finished successfully', 'TASK OK'] },
  { node: 'pve3', type: 'vzdump', vmid: 400, start: t0 - 86000, secs: 900, user: 'root@pam', log: ['INFO: Finished Backup of VM 400', 'TASK OK'] },
];
const upidOf = (t: MockTask, i: number) => `UPID:${t.node}:0000${1000 + i}:0001:${t.start.toString(16).toUpperCase()}:${t.type}:${t.vmid ?? ''}:${t.user.includes('@') ? t.user : 'root@pam'}:`;

function taskView(t: MockTask, i: number): OpsTask {
  const done = now() >= t.start + t.secs;
  const pct = done ? 100 : Math.round(((now() - t.start) / t.secs) * 1000) / 10;
  return { cluster_id: CID, cluster: 'LAB-PVE', node: t.node, upid: upidOf(t, i), type: t.type, vmid: t.vmid, running: !done,
    ok: done && !t.fail, status: done ? (t.fail ?? 'OK') : '', starttime: t.start, endtime: done ? t.start + t.secs : null,
    user: t.user.includes('@') ? '' : t.user, desktop: deskOf(t.vmid), percent: done ? null : pct };
}
export function mockStartTask(node: string, type: string, vmid: number | null, secs: number, log: string[]) {
  mockTasks.unshift({ node, type, vmid, start: now(), secs, user: mockWhoAmI() || 'admin', log });
}

type MockMaint = { started: number; total: number; status: string };
const maint = new Map<string, MockMaint>();
const offline = new Map<string, number>();     // node -> back online at (a reboot)
export function mockNodeState(node: string) {
  const m = maint.get(node);
  const back = offline.get(node);
  return { maintenance: !!m, online: !(back && back > Date.now()) };
}
function maintView(node: string): MaintStatus {
  const m = maint.get(node);
  if (!m) return { maintenance_mode: false };
  const moved = Math.min(m.total, Math.floor((Date.now() - m.started) / 2500));
  if (moved >= m.total && m.status === 'evacuating') {
    m.status = 'completed';
    for (const g of mockVmStore.guests.filter((x) => x.node === node && x.status === 'running')) g.node = NODES.find((n) => n !== node && !maint.has(n)) ?? g.node;
    for (const d of mockVmStore.desks) {
      const g = mockVmStore.guests.find((x) => x.vmid === d.vmid);
      if (g) d.node = g.node;
    }
  }
  return { node, status: m.status, total_vms: m.total, migrated_vms: moved, failed_vms: [], pending_vms: [],
    progress_percent: m.total ? Math.round((moved / m.total) * 1000) / 10 : 100, current_vm: null, error: null,
    note: m.total === 0 ? 'No running guests to move' : null };
}

export const mockHaVmids = new Set<number>([210]);
const haMeta = new Map<number, { state: string; group: string; max_restart: number; max_relocate: number; comment: string }>([
  [210, { state: 'started', group: '', max_restart: 1, max_relocate: 1, comment: 'FlexLM 라이선스 서버' }]]);
const haGroups: HaGroup[] = [{ group: 'lab-nodes', nodes: 'pve1:2,pve2:1', restricted: false, nofailback: false, comment: '', rule: true, resources: 'vm:210' }];
const extraGuests = [{ vmid: 210, name: 'lic-flexlm', node: 'pve1', type: 'qemu' as const, status: 'running' },
  { vmid: 220, name: 'lic-cadence', node: 'pve2', type: 'qemu' as const, status: 'running' }];
const guestOf = (vmid: number) => mockVmStore.guests.find((g) => g.vmid === vmid) ?? extraGuests.find((g) => g.vmid === vmid);

const pair: PairStatus = {
  role: 'active', epoch: 3, instance_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', interval: 30,
  members: [{ instance_id: '0f1e2d3c4b5a69788796a5b4c3d2e1f0', url: 'https://moavi-b.univ.ac.kr:5000', fingerprint: 'SHA256:9c:41:…:7e',
    role_seen: 'standby', epoch_seen: 3, confirmed_standby: true, serve: false, serving_seen: false,
    last_contact: new Date(Date.now() - 20e3).toISOString(), last_error: '', joined_at: '2026-09-02T10:14:00', is_source: false, site: '' }],
  max_members: 4, standby_count: 1, pairing_open_until: null, sync: {}, suggested_url: 'https://moavi-a.univ.ac.kr:5000',
  own_fingerprint: 'SHA256:3a:9f:…:c2', broken: '', removed: null, peer: null, auto: null,
};
const PW = (pw: string) => (pw ? null : fail(403, 'Confirm with your password', { error: 'Confirm with your password', code: 'HA_REAUTH' }));

const mockOpsApi: OpsApi = {
  tasks: (limit = 100) => {
    const admin = mockWhoAmI() === 'admin';
    const rows = mockTasks.map(taskView).filter((t) => admin || t.user === mockWhoAmI())
      .sort((a, b) => Number(b.running) - Number(a.running) || (b.starttime ?? 0) - (a.starttime ?? 0)).slice(0, limit);
    return delay({ scope: admin ? 'all' as const : 'mine' as const, running: rows.filter((t) => t.running).length, tasks: rows }, 150);
  },
  taskLog: (_cid, upid) => {
    const i = mockTasks.findIndex((t, k) => upidOf(t, k) === upid);
    if (i < 0) return fail(404, 'Task not found');
    const v = taskView(mockTasks[i], i);
    const lines = v.running ? [...mockTasks[i].log, `progress ${v.percent}%`] : mockTasks[i].log;
    return delay({ upid, node: v.node, type: v.type, running: v.running, ok: v.ok, status: v.status, lines });
  },

  maintenance: (_cid, node) => delay(maintView(node)),
  maintenancePreview: (_cid, node) => {
    const on = mockVmStore.desks.filter((d) => (mockVmStore.guests.find((g) => g.vmid === d.vmid)?.node ?? d.node) === node);
    const deskVmids = new Set(on.map((d) => d.vmid));
    const others = [...mockVmStore.guests, ...extraGuests].filter((g) => g.node === node && !deskVmids.has(g.vmid));
    const running = on.filter((d) => mockVmStore.guests.find((g) => g.vmid === d.vmid)?.status === 'running').length
      + others.filter((g) => g.status === 'running').length;
    const rest = NODES.filter((n) => n !== node && !maint.has(n));
    const projected = rest.map((n, i) => ({ node: n, current_pct: 48 + i * 17, projected_pct: Math.round((48 + i * 17 + running * 3.4) * 10) / 10 }));
    const over = projected.filter((p) => p.projected_pct > 90).map((p) => p.node);
    return delay({
      node,
      desktops: on.map((d) => ({ id: d.id, name: d.name, vmid: d.vmid, pool_id: d.pool_id, pool: d.pool_id,
        status: mockVmStore.guests.find((g) => g.vmid === d.vmid)?.status ?? 'unknown', assigned_user: d.assigned_user ?? '',
        in_use: d.assigned_user === 'alice' })),
      guests: others.map((g) => ({ vmid: g.vmid, name: g.name, type: g.type, status: g.status })),
      capacity: rest.length ? { ok: !over.length, threshold: 90, guest_count: running, over_threshold: over, headroom_sufficient: true, nodes: projected }
        : { ok: running === 0, reason: 'no_target_nodes', guest_count: running, over_threshold: [], headroom_sufficient: running === 0, nodes: [] },
      plan: { templates: node === 'pve1' || node === 'pve3' ? 1 : 0, blocking_rules: [], online_nodes: 3 },
    }, 400);
  },
  setMaintenance: (_cid, node, enable, opts = {}) => {
    if (!enable) {
      if (!maint.has(node)) return fail(400, `Node ${node} is not in maintenance mode`);
      maint.delete(node); return delay(undefined);
    }
    if (maint.has(node)) return fail(400, `Node ${node} is already in maintenance mode`);
    const total = opts.skip_evacuation ? 0 : mockVmStore.guests.filter((g) => g.node === node && g.status === 'running').length;
    maint.set(node, { started: Date.now(), total, status: total ? 'evacuating' : 'completed' });
    if (total) mockStartTask(node, 'qmigrate', null, Math.ceil(total * 2.5), [`maintenance: moving ${total} guest(s) off ${node}`]);
    return delay(undefined, 500);
  },
  nodePower: (_cid, node, action) => {
    const m = maint.get(node);
    if (!m) return fail(400, `Node ${node} not in maintenance mode`);
    if (maintView(node).status !== 'completed') return fail(400, 'Evacuation still in progress');
    offline.set(node, Date.now() + (action === 'reboot' ? 20000 : 3600e3));
    return delay(undefined, 600);
  },
  syslog: (_cid, node) => delay(Array.from({ length: 40 }, (_, i) => {
    const d = new Date(Date.now() - i * 47e3);
    const ts = d.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', '');
    const msg = [`pvedaemon[2211]: <root@pam> successful auth for user 'root@pam'`, 'pmxcfs[1532]: [status] notice: received log',
      'pveproxy[3301]: worker 3302 finished', `corosync[1611]: [KNET  ] link: host: 2 link: 0 is up`, 'kernel: vmbr0: port 3(tap302i0) entered forwarding state',
      'systemd[1]: Started session-412.scope - Session 412 of User root.', 'pvestatd[1801]: status update time (1.204 seconds)'][i % 7];
    return `${ts} ${node} ${msg}`;
  }), 300),
  sensors: (_cid, node) => node === 'pve3'
    ? delay({ sensors: [], error: 'no temperature sensors: lm-sensors is not installed and the kernel reports none under /sys/class/hwmon (normal inside a VM)' })
    : delay({ sensors: [
      { chip: 'k10temp-pci-00c3', label: 'Tctl', kind: 'temp' as const, value: node === 'pve1' ? 58.4 : 46.1, max: null, crit: 95, alarm: false },
      { chip: 'k10temp-pci-00c3', label: 'Tccd1', kind: 'temp' as const, value: node === 'pve1' ? 52.0 : 41.3, max: null, crit: null, alarm: false },
      { chip: 'nvme-pci-0100', label: 'Composite', kind: 'temp' as const, value: 39.9, max: 81.8, crit: 84.8, alarm: false },
      { chip: 'nct6779-isa-0290', label: 'fan1', kind: 'fan' as const, value: 1830, max: null, crit: null, alarm: false },
      { chip: 'nct6779-isa-0290', label: 'Vcore', kind: 'volt' as const, value: 1.03, max: 1.74, crit: null, alarm: false },
    ], error: null }, 500),
  nodeTasks: (_cid, node) => delay(mockTasks.map(taskView).filter((t) => t.node === node)),

  ha: () => {
    const resources: HaResource[] = [...mockHaVmids].sort((a, b) => a - b).map((vmid) => {
      const g = guestOf(vmid); const m = haMeta.get(vmid)!;
      return { sid: `vm:${vmid}`, vmid, type: 'vm', name: g?.name ?? '', node: g?.node ?? '', state: m.state,
        status: m.state === 'started' ? (g?.status === 'running' ? 'started' : 'starting') : m.state, group: m.group,
        max_restart: m.max_restart, max_relocate: m.max_relocate, comment: m.comment, desktop: deskOf(vmid) };
    });
    return delay({ resources, groups: haGroups.map((g) => ({ ...g })), quorate: true, master: 'pve2' });
  },
  haAdd: (_cid, b) => {
    const g = guestOf(b.vmid);
    if (!g) return fail(404, 'No such VM or container on the cluster');
    if (mockHaVmids.has(b.vmid)) return fail(502, `resource ID 'vm:${b.vmid}' already defined`);
    mockHaVmids.add(b.vmid);
    haMeta.set(b.vmid, { state: b.state ?? 'started', group: b.group ?? '', max_restart: b.max_restart ?? 1, max_relocate: b.max_relocate ?? 1, comment: b.comment ?? '' });
    return delay(undefined, 400);
  },
  haRemove: (_cid, vmid) => { mockHaVmids.delete(vmid); haMeta.delete(vmid); return delay(undefined); },
  haGroupAdd: (_cid, b) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(b.group)) return fail(400, 'group: letters, digits, "-" and "_", starting with a letter');
    if (haGroups.some((g) => g.group === b.group)) return fail(400, `duplicate rule name '${b.group}'`);
    if (!b.resources) return fail(400, 'no resources were specified');
    haGroups.push({ group: b.group, nodes: b.nodes, restricted: !!b.restricted, nofailback: !!b.nofailback, comment: b.comment ?? '', rule: true, resources: b.resources });
    return delay(undefined);
  },
  haGroupRemove: (_cid, group) => { const i = haGroups.findIndex((g) => g.group === group); if (i >= 0) haGroups.splice(i, 1); return delay(undefined); },

  pair: () => delay({ ...pair, members: pair.members.map((m) => ({ ...m, last_contact: new Date(Date.now() - 12e3).toISOString() })),
    sync: { last_ok_at: new Date(Date.now() - 12e3).toISOString() } }),
  pairingCode: (url, pw) => {
    const refused = PW(pw); if (refused) return refused;
    if (!/^https:\/\//.test(url)) return fail(400, 'Enter the https:// address the standby will use to reach this instance');
    if (pair.members.length >= pair.max_members - 1) return fail(409, 'The group is full');
    const expires = now() + 900;
    pair.pairing_open_until = expires;
    return delay({ code: `PGXHA1.${btoa(`${url}|${pair.instance_id}`).replace(/=+$/, '')}.mock`, expires_at: expires });
  },
  join: () => fail(409, 'Only a standalone, unpaired instance can become a standby'),
  promote: () => fail(409, 'Only a standby can be promoted'),
  removeMember: (id, pw, shut) => {
    const refused = PW(pw); if (refused) return refused;
    const m = pair.members.find((x) => x.instance_id === id);
    if (!m) return fail(404, 'That instance is not a member of this group');
    if (!m.confirmed_standby && !shut) return fail(409, 'The member did not answer as a standby', { code: 'HA_REMOVE_UNCONFIRMED', error: 'The member did not answer as a standby' });
    pair.members = pair.members.filter((x) => x !== m);
    pair.standby_count = pair.members.length;
    if (!pair.members.length) pair.role = 'standalone';
    return delay(undefined, 600);
  },
  unpair: (pw) => {
    const refused = PW(pw); if (refused) return refused;
    pair.members = []; pair.standby_count = 0; pair.role = 'standalone';
    return delay({ restarting: false });
  },
  syncNow: () => delay(undefined),
};

export const opsApi: OpsApi = isMock ? mockOpsApi : realOpsApi;
