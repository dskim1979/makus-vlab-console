// Fake admin API for `npm run dev:mock`: same rules as the engine, kept in memory.
import { forProfile } from './mockProfile';
import type { AdminApi } from './admin';
import { ApiError } from './client';
import { mockBranding, mockNotices, noticeState } from './mock';
import { mockNodeState } from './ops';
import { mockDeskWork, mockLeaseExtras } from './mockWork';
import type { Lab, LabAfter, LabSchedule, Terminal, TerminalEnrollment, ActiveAlert, AlertChannel, AlertMute, AlertRule, AccelDevice, BackupJob, VmBackup, AccelUser, AdminDesktop, AdminLease, PoolPolicy, ClusterNode, ClusterStorage, Guest, PciMapping, Pool, SessionRow, VgpuProfile } from './types';

const CLUSTER = { id: 'lab-cluster', name: 'LAB-PVE', connected: true, host: '10.20.0.11', connection_error: null as string | null, pools: 0 };
const clusters = [CLUSTER];

const guests: Omit<Guest, 'desktop_id' | 'pool_id'>[] = [
  ...Array.from({ length: 6 }, (_, i) => ({
    vmid: 300 + i, name: `lab-win11-${String(i + 1).padStart(2, '0')}`, node: i < 3 ? 'pve1' : 'pve2',
    type: 'qemu' as const, status: i % 3 === 2 ? 'stopped' : 'running',
  })),
  { vmid: 400, name: 'vivado-build-01', node: 'pve3', type: 'qemu', status: 'running' },
  { vmid: 401, name: 'vivado-build-02', node: 'pve3', type: 'qemu', status: 'running' },
  { vmid: 410, name: 'board-lab-zcu102', node: 'pve2', type: 'qemu', status: 'stopped' },
];

const templates = [
  { vmid: 900, name: 'tpl-win11-lab', node: 'pve1', type: 'qemu' as const, spec: { cpu: 4, memory_gb: 8 } },
  { vmid: 901, name: 'tpl-rocky9-vivado', node: 'pve3', type: 'qemu' as const, spec: { cpu: 16, memory_gb: 64 } },
];
const readyAt = new Map<string, number>();   // mock clones finish a few seconds later
const withBase = new Set<string>();

const users = [
  { username: 'alice', display_name: 'Alice Kim', role: 'user', auth_source: 'ldap', email: 'alice@lab.example' },
  { username: 'bob', display_name: 'Bob Lee', role: 'user', auth_source: 'ldap', email: 'bob@lab.example' },
  { username: 'carol', display_name: 'carol', role: 'user', auth_source: 'local', email: '' },
  { username: 'dave', display_name: 'dave', role: 'viewer', auth_source: 'local', email: '' },
];
let platform = {
  session_timeout: 28800, strict_session_ip: false, login_max_attempts: 5, login_lockout_time: 300, login_attempt_window: 600,
  force_2fa: false, force_2fa_exclude_admins: false, password_min_length: 8, password_require_uppercase: true,
  password_require_lowercase: true, password_require_numbers: true, password_require_special: false,
  password_expiry_enabled: false, password_expiry_days: 90, password_expiry_warning_days: 14,
  audit_retention_days: 90, air_gap_mode: false, smtp_enabled: false, smtp_host: '', smtp_port: 587, smtp_user: '',
  smtp_password: '', smtp_from_email: '', smtp_from_name: '', smtp_tls: true, smtp_ssl: false,
  alert_email_recipients: [] as string[],
};
let directory = {
  ldap_enabled: false, ldap_server: '', ldap_port: 389, ldap_use_ssl: false, ldap_use_starttls: false, ldap_verify_tls: false,
  ldap_bind_dn: '', ldap_bind_password: '', ldap_base_dn: '', ldap_user_filter: '(&(objectClass=person)(sAMAccountName={username}))',
  ldap_username_attribute: 'sAMAccountName', ldap_email_attribute: 'mail', ldap_display_name_attribute: 'displayName',
  ldap_group_base_dn: '', ldap_group_filter: '(&(objectClass=group)(member={user_dn}))', ldap_default_role: 'viewer',
  ldap_auto_create_users: false, ldap_group_mappings: [] as { group_dn: string; role: string }[],
};
const disabledUsers = [{ username: 'olduser', display_name: 'olduser', role: 'user', auth_source: 'local', email: '' }];
export { users as mockUsers, disabledUsers as mockDisabledUsers };   // made and changed by api/users.ts

let seq = 1;
const pools: Pool[] = [];
const desks: (AdminDesktop & { pool_id: string })[] = [];

function addPool(name: string, type: Pool['type']) {
  const p: Pool = { id: `pool_${seq++}`, name, type, cluster_id: CLUSTER.id, tenant_id: '', description: '',
    enabled: true, created_at: new Date().toISOString(), created_by: 'admin', desktops: 0, assigned: 0 };
  pools.push(p);
  return p;
}

function addDesk(pool: Pool, vmid: number, user: string | null = null) {
  const g = guests.find((x) => x.vmid === vmid)!;
  desks.push({ id: `desk_${seq++}`, name: g.name, pool: pool.name, pool_id: pool.id, cluster_id: CLUSTER.id,
    state: 'ready', protocols: ['vnc', 'spice'], vmid, node: g.node, assigned_user: user });
}

{
  const a = addPool('공용 LAB A', 'reset');
  addDesk(a, 300, 'alice'); addDesk(a, 301); addDesk(a, 302);
  desks.forEach((d) => withBase.add(d.id));   // the sample lab already has its bases
  const b = addPool('FPGA 빌드 팜', 'buildfarm');
  addDesk(b, 400, 'bob'); addDesk(b, 401, 'carol');
}

{
  const c = addPool('교육장 A 수업용', 'classroom');
  addDesk(c, 303); addDesk(c, 304); addDesk(c, 305);
}

// LABs: two rooms, their PCs, and a week of sessions (local time, 0 = Monday)
const mockLabs: Omit<Lab, 'terminals' | 'pending' | 'schedules' | 'current' | 'next'>[] = [
  { id: 'lab_a', name: '교육장 A', location: '본관 3층 301호', description: '신입 연구원 교육·사내 교육', seats: 24, tenant_id: '', created_at: '2026-09-01T09:00:00Z' },
  { id: 'lab_b', name: '공용 연구실 B', location: '연구동 2층', description: '교대 근무·야간 분석', seats: 12, tenant_id: '', created_at: '2026-09-01T09:00:00Z' },
];
// the MOAVI Desk Agent's view of a PC (heartbeats every 2 minutes; offline after 3 missed)
const agoMs = (ms: number) => new Date(Date.now() - ms).toISOString();
function agent(n: number, mac: string, ip: string, beat: number, state: TerminalEnrollment['state'], code = '301호 일괄 설치',
  kind: 'admin' | 'user' = 'admin', by = 'admin', user = false): TerminalEnrollment {
  return {
    state, code_id: kind === 'user' ? 'enc_u1' : 'enc_1', code, code_kind: kind, requested_by: by, created_at: '2026-10-14T08:50:00Z',
    last_poll_at: agoMs(beat), last_heartbeat_at: agoMs(beat), delivered_at: state === 'delivered' ? '2026-10-14T09:02:00Z' : null,
    online: beat < 6 * 60e3, heartbeat_seconds: 120,
    info: { hostname: `LAB301-PC${String(n).padStart(2, '0')}`, mac, ip, os: 'Microsoft Windows 10.0.26100', client_version: '0.9.1',
      agent_version: '0.9.1', user_logged_in: user },
    recent: Array.from({ length: 6 }, (_, k) => ({ at: agoMs(beat + k * 120e3), ip, user: user && k < 3 })),
  };
}
export const mockTerminals: Terminal[] = [
  ...Array.from({ length: 6 }, (_, i): Terminal => {
    const mac = `52:54:00:a1:00:${String(i + 1).padStart(2, '0')}`;
    const ip = `10.30.1.${21 + i}`;
    return {
      id: `term_a${i + 1}`, lab_id: 'lab_a', name: `A-PC-${String(i + 1).padStart(2, '0')}`, mac, ip, state: 'approved', registered_by: 'admin',
      last_seen: agoMs(i === 4 ? 2 * 86400e3 : (i + 1) * 60e3), created_at: '2026-09-02T09:00:00Z', has_key: true,
      // A-PC-05 has been off for two days; A-PC-06 got its key typed in by hand, before the agent
      enrollment: i < 5 ? agent(i + 1, mac, ip, i === 4 ? 2 * 86400e3 : (i + 1) * 40e3, 'delivered', undefined, undefined, undefined, i < 2) : null,
    };
  }),
  { id: 'term_b1', lab_id: 'lab_b', name: 'B-PC-01', mac: '52:54:00:b2:00:01', ip: '10.30.2.11', state: 'approved', registered_by: 'admin',
    last_seen: agoMs(3 * 3600e3), created_at: '2026-09-02T09:00:00Z' },
  { id: 'term_new1', lab_id: 'lab_a', name: 'LAB301-PC07', mac: '52:54:00:a1:00:07', ip: '10.30.1.27', state: 'pending', registered_by: 'admin',
    last_seen: agoMs(40e3), created_at: agoMs(4 * 60e3), enrollment: agent(7, '52:54:00:a1:00:07', '10.30.1.27', 40e3, 'waiting') },
  { id: 'term_new3', lab_id: 'lab_a', name: 'LAB301-PC09', mac: '52:54:00:a1:00:09', ip: '10.30.1.29', state: 'pending', registered_by: 'kim_ta',
    last_seen: agoMs(25e3), created_at: agoMs(3 * 60e3),
    enrollment: agent(9, '52:54:00:a1:00:09', '10.30.1.29', 25e3, 'waiting', 'kim_ta 포털 설치', 'user', 'kim_ta') },
  { id: 'term_new4', lab_id: null, name: 'LAB302-PC01', mac: '52:54:00:a2:00:01', ip: '10.30.2.41', state: 'pending', registered_by: 'kim_ta',
    last_seen: agoMs(70e3), created_at: agoMs(2 * 60e3),
    enrollment: agent(1, '52:54:00:a2:00:01', '10.30.2.41', 70e3, 'waiting', 'kim_ta 포털 설치', 'user', 'kim_ta') },
];
type MockSchedule = Omit<LabSchedule, 'lab' | 'pool' | 'pool_type'>;
const mockSchedules: MockSchedule[] = [];
function addSchedule(lab_id: string, pool: Pool, title: string, weekdays: number[], start_time: string, end_time: string, after: LabAfter = 'reset', prepare_min = 15) {
  mockSchedules.push({ id: `sch_${seq++}`, lab_id, pool_id: pool.id, title, weekdays, start_time, end_time, prepare_min, after, enabled: true,
    last_prepared: '', last_finished: '' });
}
{
  const cls = pools.find((p) => p.type === 'classroom')!;
  const reset = pools.find((p) => p.type === 'reset')!;
  addSchedule('lab_a', cls, '파이썬 데이터 분석', [0, 2], '09:00', '12:00');
  addSchedule('lab_a', cls, 'FPGA 설계 기초', [1, 3], '13:00', '17:00');
  addSchedule('lab_a', reset, '신입 연구원 교육', [4], '10:00', '16:00');
  addSchedule('lab_b', reset, '야간 분석 근무', [0, 1, 2, 3, 4], '19:00', '23:00', 'off', 10);
}
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const dayOf = (d: Date) => (d.getDay() + 6) % 7;   // 0 = Monday
const iso = (d: Date, mins: number) => { const x = new Date(d); x.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
function labState(labId: string): Pick<Lab, 'current' | 'next'> {
  const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
  const mine = mockSchedules.filter((s) => s.lab_id === labId && s.enabled);
  let current: Lab['current'] = null, next: Lab['next'] = null;
  for (const s of mine) if (s.weekdays.includes(dayOf(now)) && mins >= hm(s.start_time) - s.prepare_min && mins < hm(s.end_time))
    current = { schedule_id: s.id, pool_id: s.pool_id, title: s.title, start: iso(now, hm(s.start_time)), end: iso(now, hm(s.end_time)), preparing: mins < hm(s.start_time) };
  for (let i = 0; i < 8 && !next; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i);
    for (const s of [...mine].sort((a, b) => hm(a.start_time) - hm(b.start_time)))
      if (s.weekdays.includes(dayOf(d)) && (i > 0 || hm(s.start_time) > mins)) { next = { schedule_id: s.id, pool_id: s.pool_id, title: s.title, start: iso(d, hm(s.start_time)), end: iso(d, hm(s.end_time)) }; break; }
  }
  return { current, next };
}

const mockJobs: BackupJob[] = [
  { id: 'backup-nightly', schedule: '02:00', storage: 'pbs-lab', vmid: '400,401', enabled: 1, mode: 'snapshot',
    comment: 'vlab-pool:pool_5 FPGA 빌드 팜', 'prune-backups': 'keep-last=7', vlab_pool_id: 'pool_5', vlab_pool: null },
];
const mockBackups: VmBackup[] = [0, 1, 2].flatMap((k) => [300, 301, 400].map((v) => ({
  volid: `pbs-lab:backup/vm/${v}/${new Date(Date.now() - (k + 1) * 864e5).toISOString().slice(0, 10)}T02:00:00Z`,
  ctime: Date.now() / 1000 - (k + 1) * 86400, size: (v >= 400 ? 92 : 21) * 1024 ** 3, notes: 'vlab-pool nightly', storage: 'pbs-lab' })));

const POLICY_DEFAULTS: PoolPolicy = {
  protocols: ['vnc', 'spice', 'rdp'], spice_fullscreen: false, clipboard: 'both', usb_redirect: true, usb_autoshare: false,
  client_drives: false, client_printers: true, rdp_tune: true, start_on_connect: true, idle_shutdown_min: 0, reset_on_logout: false, allow_power: true, screen_thumbnail: true, max_session_hours: 0,
  defer_when_busy: true, busy_gpu_pct: 10, busy_cpu_pct: 50, defer_max_hours: 12, web_ide: [], web_ide_idle_min: 240,
};
const cloneSources = new Map<number, Set<string>>();   // template -> pools cloned from it

function usage(vmid: number, running: boolean): AdminDesktop['usage'] {
  const big = vmid >= 400;
  const cpus = big ? 16 : 4, maxmem = (big ? 64 : 8) * 1024 ** 3;
  return { cpu_percent: running ? ((vmid * 37) % 70) + 3 : 0, cpus, maxmem,
    mem: running ? Math.round(maxmem * (0.35 + ((vmid * 13) % 40) / 100)) : 0, uptime: running ? 3600 * ((vmid % 9) + 1) : 0 };
}

const MOCK_DEVICES: Omit<AccelDevice, 'used_by' | 'mappings'>[] = [
  { node: 'pve1', pciid: '0000:41:00.0', kind: 'gpu', vendor: 'NVIDIA', vendor_id: '10de', device_id: '25b6', model: 'A16 (GA107GL)', subsystem: 'A16 64GB', iommu_group: 40, vgpu_capable: true },
  { node: 'pve1', pciid: '0000:42:00.0', kind: 'gpu', vendor: 'NVIDIA', vendor_id: '10de', device_id: '25b6', model: 'A16 (GA107GL)', subsystem: 'A16 64GB', iommu_group: 41, vgpu_capable: true },
  { node: 'pve2', pciid: '0000:61:00.0', kind: 'gpu', vendor: 'NVIDIA', vendor_id: '10de', device_id: '26b9', model: 'L40S (AD102GL)', subsystem: 'L40S 48GB', iommu_group: 22, vgpu_capable: true },
  { node: 'pve2', pciid: '0000:a1:00.0', kind: 'gpu', vendor: 'NVIDIA', vendor_id: '10de', device_id: '20b5', model: 'GA100 [A100 PCIe 80GB]', subsystem: 'A100 80GB · MIG', iommu_group: 25, vgpu_capable: true },
  { node: 'pve2', pciid: '0000:a1:00.4', kind: 'gpu', vendor: 'NVIDIA', vendor_id: '10de', device_id: '20b5', model: 'GA100 [A100 PCIe 80GB] (VF)', subsystem: 'SR-IOV VF', iommu_group: 26, vgpu_capable: true, virtual_function: true },
  { node: 'pve2', pciid: '0000:81:00.0', kind: 'gpu', vendor: 'AMD', vendor_id: '1002', device_id: '7448', model: 'Radeon PRO W7900', subsystem: '48GB', iommu_group: 30, vgpu_capable: false },
  { node: 'pve3', pciid: '0000:c1:00.0', kind: 'fpga', vendor: 'AMD Xilinx', vendor_id: '10ee', device_id: '5004', model: 'Alveo U250', subsystem: 'XDMA', iommu_group: 51, vgpu_capable: false },
  { node: 'pve3', pciid: '0000:c2:00.0', kind: 'fpga', vendor: 'AMD Xilinx', vendor_id: '10ee', device_id: '5058', model: 'Alveo U55C', subsystem: 'HBM2e 16GB', iommu_group: 52, vgpu_capable: false },
  { node: 'pve3', pciid: '0000:d1:00.0', kind: 'npu', vendor: 'FuriosaAI', vendor_id: '1ed2', device_id: '0001', model: 'RNGD', subsystem: 'HBM3 48GB', iommu_group: 61, vgpu_capable: false },
  { node: 'pve3', pciid: '0000:d2:00.1', kind: 'npu', vendor: 'Rebellions', vendor_id: '1eff', device_id: '1221', model: 'RBLN-CA22 (VF)', subsystem: 'ATOM', iommu_group: 62, vgpu_capable: false, virtual_function: true },
  { node: 'pve3', pciid: '0000:d2:00.2', kind: 'npu', vendor: 'Rebellions', vendor_id: '1eff', device_id: '1221', model: 'RBLN-CA22 (VF)', subsystem: 'ATOM', iommu_group: 63, vgpu_capable: false, virtual_function: true },
];
const MOCK_MAPPINGS: Omit<PciMapping, 'used_by' | 'pools'>[] = [
  { id: 'gpu-a16', description: 'NVIDIA A16 vGPU (pve1, 2장)', mdev: true,
    devices: [{ node: 'pve1', path: '0000:41:00.0', id: '10de:25b6' }, { node: 'pve1', path: '0000:42:00.0', id: '10de:25b6' }] },
  { id: 'gpu-l40s', description: 'NVIDIA L40S (AI·렌더링)', mdev: true, devices: [{ node: 'pve2', path: '0000:61:00.0', id: '10de:26b9' }] },
  { id: 'gpu-a100', description: 'NVIDIA A100 80GB VF (pve2, MIG-backed vGPU)', mdev: true, devices: [{ node: 'pve2', path: '0000:a1:00.4', id: '10de:20b5' }] },
  { id: 'gpu-w7900', description: 'AMD Radeon PRO W7900 전체', mdev: false, devices: [{ node: 'pve2', path: '0000:81:00.0', id: '1002:7448' }] },
];
const FPGA_MAPPINGS: Omit<PciMapping, 'used_by' | 'pools'>[] = [
  { id: 'fpga-u250', description: 'AMD Xilinx Alveo U250 (pve3)', mdev: false, devices: [{ node: 'pve3', path: '0000:c1:00.0', id: '10ee:5004' }] },
  { id: 'fpga-u55c', description: 'AMD Xilinx Alveo U55C (pve3)', mdev: false, devices: [{ node: 'pve3', path: '0000:c2:00.0', id: '10ee:5058' }] },
  { id: 'npu-rngd', description: 'FuriosaAI RNGD (pve3)', mdev: false, devices: [{ node: 'pve3', path: '0000:d1:00.0', id: '1ed2:0001' }] },
  { id: 'npu-atom-vf', description: 'Rebellions ATOM VF (pve3, 2개)', mdev: false,
    devices: [{ node: 'pve3', path: '0000:d2:00.1', id: '1eff:1221' }, { node: 'pve3', path: '0000:d2:00.2', id: '1eff:1221' }] },
];
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
const mockLeases: AdminLease[] = [
  { id: 'lease_a', resource_type: 'fpga', resource_id: 'fpga-u250', resource_name: 'Alveo U250', username: 'bob', cluster_id: 'lab-cluster',
    vmid: 400, starts_at: inDays(-6), ends_at: inDays(8), returned_at: null, state: 'active', desktop_id: null, desktop: null, vm_running: false },
  { id: 'lease_b', resource_type: 'gpu', resource_id: 'gpu-l40s', resource_name: 'NVIDIA L40S', username: 'alice', cluster_id: 'lab-cluster',
    vmid: 300, starts_at: inDays(-2), ends_at: inDays(0.6), returned_at: null, state: 'active', desktop_id: null, desktop: null, vm_running: false },
  { id: 'lease_c', resource_type: 'fpga', resource_id: 'fpga-u55c', resource_name: 'Alveo U55C', username: 'carol', cluster_id: 'lab-cluster',
    vmid: 301, starts_at: inDays(-20), ends_at: inDays(-6), returned_at: inDays(-6), state: 'returned', desktop_id: null, desktop: null, vm_running: false },
];

function a16Profiles(used: number): VgpuProfile[] {
  // A16: 4 GPUs of 16 GB on one board; Q = workstation, B = virtual PC, A = app streaming
  return [['1Q', 1, 16], ['2Q', 2, 8], ['4Q', 4, 4], ['8Q', 8, 2], ['16Q', 16, 1], ['2B', 2, 8], ['1B', 1, 16], ['4A', 4, 4]]
    .map(([n, gb, max], i) => ({ type: `nvidia-${745 + i}`, name: `NVIDIA A16-${n}`, available: n === '2Q' ? Math.max(0, (max as number) - used) : max as number,
      framebuffer_mb: (gb as number) * 1024, max_instance: max as number, heads: String(n).endsWith('A') ? 1 : 4,
      max_resolution: String(n).endsWith('A') ? '1280x1024' : '5120x2880',
      description: `num_heads=4, framebuffer=${(gb as number) * 1024}M, max_instance=${max}` }));
}

function live(d: AdminDesktop): AdminDesktop {
  const at = readyAt.get(d.id);
  if (at && Date.now() < at) return { ...d, state: 'provisioning' };
  const pool = pools.find((p) => p.id === d.pool_id);
  if (at && pool && (pool.type === 'reset' || pool.type === 'classroom')) withBase.add(d.id);
  const g = guests.find((x) => x.vmid === d.vmid);
  const gpu = pool?.settings?.gpu && pool.settings.gpu.mode !== 'none'
    ? { mode: pool.settings.gpu.mode as 'vgpu' | 'passthrough', label: pool.settings.gpu.label || pool.settings.gpu.mdev_type || pool.settings.gpu.mapping || '' } : undefined;
  return { ...d, state: g?.status === 'running' ? 'ready' : 'stopped', has_base: withBase.has(d.id), usage: usage(d.vmid, g?.status === 'running'), gpu,
    work: mockDeskWork(d.id, d.name) };
}

// 운영 > 경보: rules, firing incidents, mutes, notification channels
// the engine writes local time without a zone (datetime.now().isoformat())
const localIso = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60e3).toISOString().slice(0, 19);
const minsAgo = (m: number) => localIso(Date.now() - m * 60e3);
const mockRules: AlertRule[] = [
  { id: 'r-cpu', name: '노드 CPU 과부하', metric: 'cpu', operator: '>', threshold: 90, target_type: 'cluster', target_id: null,
    channels: ['email', 'ch-slack'], severity: 'critical', enabled: true },
  { id: 'r-mem', name: '메모리 80% 초과', metric: 'memory', operator: '>', threshold: 80, target_type: 'cluster', target_id: null,
    channels: ['ch-slack'], severity: 'warning', enabled: true },
  { id: 'r-bk', name: '백업 실패', metric: 'task_failed', operator: 'event', threshold: 1, target_type: 'cluster', target_id: null,
    channels: ['email'], severity: 'auto', enabled: true, notify_resolved: true },
  { id: 'r-disk', name: '로컬 디스크 85%', metric: 'disk', operator: '>', threshold: 85, target_type: 'node', target_id: 'pve3',
    channels: [], severity: 'info', enabled: false },
];
const mockActive: ActiveAlert[] = [
  { id: 7, alert_id: 'r-mem', severity: 'warning', message: 'Memory above 80%', target_type: 'node', target_name: 'pve3', metric: 'memory',
    current_value: 82.4, threshold: 80, operator: '>', triggered_at: minsAgo(42), last_fired_at: minsAgo(2), acked_at: null, acked_by: null,
    escalation_step: 0, object_key: 'node:pve3', muted_until: null },
  { id: 9, alert_id: 'r-bk', severity: 'critical', message: 'vzdump failed: lab-win11-03 (VM 302)', target_type: 'vm', target_name: 'lab-win11-03',
    metric: 'task_failed', current_value: null, threshold: 1, operator: 'event', triggered_at: minsAgo(185), last_fired_at: minsAgo(185),
    acked_at: minsAgo(170), acked_by: 'admin', escalation_step: 1, object_key: 'task:vzdump:302', muted_until: null },
];
const mockMutes: AlertMute[] = [
  { id: 'mu-1', cluster_id: CLUSTER.id, rule_id: 'r-disk', object_key: 'node:pve3', object_label: 'pve3',
    until: localIso(Date.now() + 5 * 36e5), reason: '디스크 증설 작업', created_by: 'admin', created_at: minsAgo(60) },
];
const mockChannels: AlertChannel[] = [
  { id: 'ch-slack', name: '운영팀 Slack', type: 'slack', url: 'https://hooks.slack.com/services/T000/B000/XXXX', enabled: true },
  { id: 'ch-ntfy', name: '야간 당직 ntfy', type: 'ntfy', url: 'https://ntfy.sh', topic: 'moavi-oncall', enabled: true },
];
// the engine never hands a webhook URL or token back (alerts.py _mask_channel)
const maskChannel = (c: AlertChannel): AlertChannel => ({ ...c,
  url: c.url.length > 32 ? `${c.url.slice(0, 24)}…${c.url.slice(-6)}` : c.url ? '********' : '',
  ...(c.token ? { token: '********' } : {}), ...(c.topic ? { topic: '********' } : {}) });
const liveMutes = () => mockMutes.filter((m) => Date.parse(m.until) > Date.now());
const muteOf = (a: ActiveAlert) => liveMutes().find((m) =>
  (!m.rule_id || m.rule_id === a.alert_id) && (!m.object_key || m.object_key === a.object_key));

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(forProfile(v)), 120));
const fail = (status: number, msg: string) => Promise.reject(new ApiError(status, msg));

export const mockAdminApi: AdminApi = {
  clusters: () => delay(clusters.map((c) => ({ ...c, pools: pools.filter((p) => p.cluster_id === c.id).length }))),
  connectCluster: (c) => {
    if (!c.name.trim() || !c.host.trim() || !c.user.trim() || !c.pass) return fail(400, 'name, host, user and pass are required');
    if (c.host === 'bad') return fail(400, 'Failed to connect: Connection refused');
    const id = `c${seq++}`;
    clusters.push({ id, name: c.name, connected: true, host: c.host, connection_error: null, pools: 0 });
    return delay({ id, api_token_created: true });
  },
  disconnectCluster: (id) => {
    if (pools.some((p) => p.cluster_id === id)) return fail(409, 'vLAB pools still use this cluster - delete them first');
    const i = clusters.findIndex((c) => c.id === id);
    if (i < 0) return fail(404, 'Cluster not found');
    clusters.splice(i, 1);
    return delay(undefined);
  },
  accelerators: (clusterId) => {
    if (clusterId !== CLUSTER.id) return fail(404, 'Cluster not found');
    const user = (vmid: number, slot: string, mdev: string | null): AccelUser => {
      const g = guests.find((x) => x.vmid === vmid);
      const d = desks.find((x) => x.vmid === vmid);
      return { vmid, name: g?.name ?? `vm-${vmid}`, node: g?.node ?? '', status: g?.status ?? '', slot, mdev,
        desktop_id: d?.id ?? null, pool: d?.pool ?? null };
    };
    const gpuPools = pools.filter((p) => p.settings?.gpu && p.settings.gpu.mode !== 'none');
    const onMapping = (id: string) => gpuPools.filter((p) => p.settings!.gpu!.mapping === id)
      .flatMap((p) => desks.filter((d) => d.pool_id === p.id).map((d) => user(d.vmid, 'hostpci15', p.settings!.gpu!.mdev_type ?? null)));
    const mappings: PciMapping[] = [...MOCK_MAPPINGS, ...FPGA_MAPPINGS].map((m) => ({ ...m, used_by: onMapping(m.id),
      pools: gpuPools.filter((p) => p.settings!.gpu!.mapping === m.id).map((p) => p.name) }));
    const devices: AccelDevice[] = MOCK_DEVICES.map((d) => ({ ...d,
      used_by: d.pciid === '0000:c1:00.0' ? [user(400, 'hostpci0', null)] : [],
      mappings: [...MOCK_MAPPINGS, ...FPGA_MAPPINGS].filter((m) => m.devices.some((x) => x.node === d.node && x.path === d.pciid)).map((m) => m.id) }));
    const gpus = devices.filter((d) => d.kind === 'gpu');
    return delay({ devices, mappings, mappings_readable: true, unreadable_nodes: [], summary: {
      gpus: gpus.length, fpgas: devices.filter((d) => d.kind === 'fpga').length, npus: devices.filter((d) => d.kind === 'npu').length, vgpu_capable: gpus.filter((d) => d.vgpu_capable).length,
      in_use: devices.filter((d) => d.used_by.length).length + mappings.filter((m) => m.used_by.length).length } });
  },
  profiles: (_clusterId, node, pciid) => {
    const dev = MOCK_DEVICES.find((d) => d.node === node && d.pciid === pciid);
    if (!dev) return fail(404, 'no such card');
    if (!dev.vgpu_capable) return delay([]);
    if (dev.device_id === '20b5') {   // A100 in MIG mode: only the MIG-backed profiles
      const mk = (type: string, name: string, gb: number, max: number, available: number, slices: number): VgpuProfile => ({ type, name,
        description: `num_heads=1, frl_config=60, framebuffer=${gb * 1024}M, max_resolution=4096x2160, max_instance=${max}`, available,
        framebuffer_mb: gb * 1024, max_instance: max, heads: 1, max_resolution: '4096x2160', mig_slices: slices });
      return delay([mk('nvidia-699', 'NVIDIA A100D-1-10C', 10, 7, 1, 1), mk('nvidia-700', 'NVIDIA A100D-2-20C', 20, 3, 0, 2),
        mk('nvidia-701', 'NVIDIA A100D-3-40C', 40, 2, 0, 3), mk('nvidia-702', 'NVIDIA A100D-4-40C', 40, 1, 0, 4), mk('nvidia-703', 'NVIDIA A100D-7-80C', 80, 1, 0, 7)]);
    }
    const used = pools.filter((p) => p.settings?.gpu?.mode === 'vgpu' && MOCK_MAPPINGS.some((m) => m.id === p.settings!.gpu!.mapping
      && m.devices.some((x) => x.path === pciid))).reduce((n, p) => n + desks.filter((d) => d.pool_id === p.id).length, 0);
    return delay(a16Profiles(Math.min(used, 8)));
  },
  leases: (all) => delay(mockLeases.filter((l) => all || l.state === 'active').map((l) => {
    const d = desks.find((x) => x.vmid === l.vmid);
    return { ...l, desktop_id: d?.id ?? null, desktop: d?.name ?? null, vm_running: guests.find((g) => g.vmid === l.vmid)?.status === 'running',
      ...(l.state === 'active' ? mockLeaseExtras(l.id, d?.name ?? null) : {}) };
  })),
  lend: (l) => {
    const d = desks.find((x) => x.id === l.desktop_id);
    if (!d) return fail(404, 'Desktop not found');
    if (!d.assigned_user) return fail(409, 'The desktop is not assigned to anyone - assign it first');
    const m = MOCK_MAPPINGS.find((x) => x.id === l.mapping) ?? FPGA_MAPPINGS.find((x) => x.id === l.mapping);
    if (!m) return fail(404, `No PCI mapping '${l.mapping}'`);
    if (mockLeases.some((x) => x.state === 'active' && x.vmid === d.vmid)) return fail(409, 'This desktop has a card on loan already');
    if (mockLeases.filter((x) => x.state === 'active' && x.resource_id === m.id).length >= m.devices.length) return fail(409, `Every card of '${m.id}' is lent out`);
    if (new Date(l.ends_at) <= new Date()) return fail(400, 'ends_at must be in the future');
    const lease: AdminLease = { id: `lease_${seq++}`, resource_type: m.devices[0]?.id.startsWith('10ee') ? 'fpga' : 'gpu',
      resource_id: m.id, resource_name: l.name || m.description || m.id, username: d.assigned_user, cluster_id: CLUSTER.id,
      vmid: d.vmid, starts_at: new Date().toISOString(), ends_at: new Date(l.ends_at).toISOString(), returned_at: null,
      state: 'active', desktop_id: d.id, desktop: d.name, vm_running: false };
    mockLeases.unshift(lease);
    return delay({ lease, needs_restart: guests.find((g) => g.vmid === d.vmid)?.status === 'running' });
  },
  returnLease: (id) => {
    const l = mockLeases.find((x) => x.id === id && x.state === 'active');
    if (!l) return fail(409, 'This loan is closed already');
    l.state = 'returned'; l.returned_at = new Date().toISOString();
    return delay(undefined);
  },
  extendLease: (id, ends_at) => {
    const l = mockLeases.find((x) => x.id === id && x.state === 'active');
    if (!l) return fail(409, 'This loan is closed already');
    if (l.ends_at && new Date(ends_at) <= new Date(l.ends_at)) return fail(400, 'ends_at: a later ISO date and time');
    l.ends_at = new Date(ends_at).toISOString();
    return delay(undefined);
  },
  branding: () => delay({ ...mockBranding }),
  saveBranding: (b) => {
    const hex = /^#?[0-9a-f]{6}$/i.test(b.primaryColor) ? (b.primaryColor.startsWith('#') ? b.primaryColor : '#' + b.primaryColor).toLowerCase() : '';
    Object.assign(mockBranding, { ...b, primaryColor: hex, appName: b.appName.trim() || 'MOAVI Desk',
      logoUrl: mockBranding.logoUrl, loginLogoUrl: mockBranding.loginLogoUrl, faviconUrl: mockBranding.faviconUrl });
    return delay({ ...mockBranding });
  },
  uploadBrandingImage: async (slot, file) => {
    if (!/^image\/(png|jpeg|webp|x-icon|vnd\.microsoft\.icon)$/.test(file.type)) throw new Error('Unsupported image (PNG, JPEG, WebP; ICO for the favicon)');
    const url = URL.createObjectURL(file);
    if (slot === 'logo') mockBranding.logoUrl = url;
    if (slot === 'loginLogo') mockBranding.loginLogoUrl = url;
    if (slot === 'favicon') mockBranding.faviconUrl = url;
    return delay({ ...mockBranding });
  },
  deleteBrandingImage: (slot) => {
    if (slot === 'logo') mockBranding.logoUrl = '';
    if (slot === 'loginLogo') mockBranding.loginLogoUrl = '';
    if (slot === 'favicon') mockBranding.faviconUrl = '';
    return delay({ ...mockBranding });
  },
  backupStorages: (cid) => cid !== CLUSTER.id ? fail(404, 'Cluster not found') : delay([
    { storage: 'pbs-lab', type: 'pbs', pbs: true, shared: true, status: 'available', used: 3.1 * 1024 ** 4, total: 16 * 1024 ** 4 },
    { storage: 'pbs-offsite', type: 'pbs', pbs: true, shared: true, status: 'available', used: 2.2 * 1024 ** 4, total: 20 * 1024 ** 4 },
    { storage: 'nfs-iso', type: 'nfs', pbs: false, shared: true, status: 'available', used: 1.4 * 1024 ** 4, total: 8 * 1024 ** 4 },
  ]),
  backupJobs: (cid) => cid !== CLUSTER.id ? fail(404, 'Cluster not found') : delay(mockJobs.map((j) => ({ ...j,
    vlab_pool: pools.find((p) => p.id === j.vlab_pool_id)?.name ?? null }))),
  createPoolBackupJob: (poolId, job) => {
    const p = pools.find((x) => x.id === poolId);
    if (!p) return fail(404, 'Pool not found');
    mockJobs.push({ id: `backup-${seq++}`, schedule: String(job.schedule), storage: String(job.storage), vmid: String(job.vmid),
      enabled: 1, mode: String(job.mode ?? 'snapshot'), comment: String(job.comment), 'prune-backups': String(job['prune-backups'] ?? ''),
      vlab_pool_id: poolId, vlab_pool: p.name });
    return delay(undefined);
  },
  deleteBackupJob: (_cid, jobId) => { mockJobs.splice(mockJobs.findIndex((j) => j.id === jobId), 1); return delay(undefined); },
  labs: () => delay(mockLabs.map((l) => ({ ...l,
    terminals: mockTerminals.filter((t) => t.lab_id === l.id && t.state === 'approved').length,
    pending: mockTerminals.filter((t) => t.lab_id === l.id && t.state === 'pending').length,
    schedules: mockSchedules.filter((s) => s.lab_id === l.id).length, ...labState(l.id) }))),
  saveLab: (id, body) => {
    if (!body.name?.trim()) return fail(400, 'A name of 1-80 characters is required');
    let l = id ? mockLabs.find((x) => x.id === id) : undefined;
    if (id && !l) return fail(404, 'LAB not found');
    if (!l) { l = { id: `lab_${seq++}`, name: '', location: '', description: '', seats: 0, tenant_id: '', created_at: new Date().toISOString() }; mockLabs.push(l); }
    Object.assign(l, { name: body.name.trim(), location: body.location ?? '', description: body.description ?? '', seats: body.seats ?? 0 });
    return delay({ ...l, terminals: 0, pending: 0, schedules: 0, ...labState(l.id) });
  },
  deleteLab: (id) => {
    const i = mockLabs.findIndex((x) => x.id === id);
    if (i < 0) return fail(404, 'LAB not found');
    mockLabs.splice(i, 1);
    for (let k = mockSchedules.length - 1; k >= 0; k--) if (mockSchedules[k].lab_id === id) mockSchedules.splice(k, 1);
    mockTerminals.forEach((t) => { if (t.lab_id === id) t.lab_id = null; });
    return delay(undefined);
  },
  terminals: () => delay(mockTerminals.map((t) => ({ ...t }))),
  addTerminal: (body) => {
    const hex = body.mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    if (hex.length !== 12) return fail(400, 'A MAC address like 00:11:22:33:44:55 is required');
    const mac = hex.match(/../g)!.join(':');
    if (mockTerminals.some((t) => t.mac === mac)) return fail(409, 'This MAC address is registered already');
    const t: Terminal = { id: `term_${seq++}`, lab_id: body.lab_id ?? null, name: body.name ?? '', mac, ip: '', state: 'approved',
      registered_by: 'admin', last_seen: null, created_at: new Date().toISOString() };
    mockTerminals.push(t);
    return delay({ ...t });
  },
  updateTerminal: (id, body) => {
    const t = mockTerminals.find((x) => x.id === id);
    if (!t) return fail(404, 'Terminal not found');
    Object.assign(t, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
    return delay({ ...t });
  },
  terminalKey: (id) => {
    const t = mockTerminals.find((x) => x.id === id);
    if (!t) return fail(404, 'Terminal not found');
    Object.assign(t, { state: 'approved', has_key: true });
    return delay({ key: `mdt_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`, terminal: { ...t } });
  },
  deleteTerminal: (id) => {
    const i = mockTerminals.findIndex((x) => x.id === id);
    if (i < 0) return fail(404, 'Terminal not found');
    mockTerminals.splice(i, 1);
    return delay(undefined);
  },
  labSchedules: () => delay(mockSchedules.map((s) => {
    const p = pools.find((x) => x.id === s.pool_id);
    return { ...s, lab: mockLabs.find((l) => l.id === s.lab_id)?.name ?? null, pool: p?.name ?? null, pool_type: p?.type ?? null };
  })),
  saveLabSchedule: (id, body) => {
    if (!body.weekdays.length) return fail(400, 'Pick at least one weekday');
    if (!/^\d\d:\d\d$/.test(body.start_time) || !/^\d\d:\d\d$/.test(body.end_time)) return fail(400, 'Times are HH:MM');
    if (hm(body.end_time) <= hm(body.start_time)) return fail(400, 'The end must be after the start (same day)');
    const pool = pools.find((p) => p.id === body.pool_id);
    if (!pool) return fail(404, 'Pool not found');
    if (!['classroom', 'reset', 'shared'].includes(pool.type)) return fail(400, 'A LAB schedule takes a scheduled (classroom), reset or shared pool');
    const clash = mockSchedules.find((s) => s.id !== id && s.lab_id === body.lab_id && s.enabled && body.enabled !== false
      && s.weekdays.some((d) => body.weekdays.includes(d)) && hm(s.start_time) < hm(body.end_time) && hm(body.start_time) < hm(s.end_time));
    if (clash) return Promise.reject(new ApiError(409, 'This LAB has another schedule at that time', { code: 'OVERLAP' }));
    let s = id ? mockSchedules.find((x) => x.id === id) : undefined;
    if (id && !s) return fail(404, 'Schedule not found');
    if (!s) { s = { id: `sch_${seq++}`, lab_id: '', pool_id: '', title: '', weekdays: [], start_time: '', end_time: '', prepare_min: 10,
      after: 'reset', enabled: true, last_prepared: '', last_finished: '' }; mockSchedules.push(s); }
    Object.assign(s, { ...body, title: body.title ?? '', enabled: body.enabled !== false, weekdays: [...body.weekdays].sort() });
    return delay({ ...s, lab: mockLabs.find((l) => l.id === s!.lab_id)?.name ?? null, pool: pool.name, pool_type: pool.type });
  },
  deleteLabSchedule: (id) => {
    const i = mockSchedules.findIndex((x) => x.id === id);
    if (i < 0) return fail(404, 'Schedule not found');
    mockSchedules.splice(i, 1);
    return delay(undefined);
  },
  runLabSchedule: (id, phase) => {
    const s = mockSchedules.find((x) => x.id === id);
    if (!s) return fail(404, 'Schedule not found');
    const mine = desks.filter((d) => d.pool_id === s.pool_id);
    const busy = phase === 'finish' ? mine.slice(0, 1) : [];
    return delay({ phase, done: mine.filter((d) => !busy.includes(d)).map((d) => ({ id: d.id, name: d.name })),
      skipped: busy.map((d) => ({ id: d.id, name: d.name, reason: 'in_use' })), failed: [] });
  },
  rightsizing: (cid, days) => {
    if (cid !== CLUSTER.id) return fail(404, 'Cluster not found');
    const row = (vmid: number, name: string, cpu: [number, number], mem: [number, number], cores: number, gb: number,
                 flags: { kind: string; current?: number; recommended?: number; current_gb?: number; recommended_gb?: number }[]) => {
      const d = desks.find((x) => x.vmid === vmid);
      const p = d ? pools.find((x) => x.id === d.pool_id) : undefined;
      const act = (k: string) => (k.startsWith('under') ? 'grow' : k === 'idle' ? 'idle' : 'reclaim');
      return { vmid: String(vmid), type: 'qemu', name, node: d?.node ?? 'pve1', cpu_avg: cpu[0], cpu_p95: cpu[1], mem_avg: mem[0], mem_max: mem[1],
        maxcpu: cores, maxmem_gb: gb, samples: days * 288,
        flags: flags.map((f) => ({ severity: f.kind.startsWith('under') ? 'warning' : 'info', detail: '', rationale: '', ...f })),
        actions: [...new Set(flags.map((f) => act(f.kind)))].sort(),
        desktop_id: d?.id ?? null, desktop: d?.name ?? null, pool_id: p?.id ?? null, pool: p?.name ?? null, assigned_to: d?.assigned_user ?? null };
    };
    return delay({
      cluster_id: cid, days, snapshots: days * 288, min_samples: 24, total_vms: 12,
      counts: { grow: 2, reclaim: 2, idle: 1, ok: 6, no_data: 1 },
      recommendations: [
        row(400, 'vivado-build-01', [71, 96], [78, 94], 16, 64, [{ kind: 'undersized_cpu', current: 16, recommended: 20 }, { kind: 'undersized_mem', current_gb: 64, recommended_gb: 96 }]),
        row(401, 'vivado-build-02', [58, 91], [61, 72], 16, 64, [{ kind: 'undersized_cpu', current: 16, recommended: 20 }]),
        row(300, 'lab-win11-01', [3.1, 17], [21, 34], 8, 16, [{ kind: 'oversized_cpu', current: 8, recommended: 4 }, { kind: 'oversized_mem', current_gb: 16, recommended_gb: 8 }]),
        row(301, 'lab-win11-02', [0.4, 1.8], [12, 19], 4, 8, [{ kind: 'idle' }, { kind: 'oversized_mem', current_gb: 8, recommended_gb: 4 }]),
      ],
    });
  },
  infra: (cid, range) => {
    if (cid !== CLUSTER.id) return fail(404, 'Cluster not found');
    const GB = 1024 ** 3, TB = 1024 ** 4;
    const [days, step] = range === '24h' ? [1, 300] : range === '7d' ? [7, 3600] : [30, 4 * 3600];
    const end = Math.floor(Date.now() / 1000 / step) * step, n = Math.floor((days * 86400) / step);
    const ts = Array.from({ length: n + 1 }, (_, i) => end - (n - i) * step);
    // a working-day curve: busy 9-18 h on weekdays, quiet at night
    const load = (t: number, base: number, amp: number, seed: number) => {
      const d = new Date(t * 1000), h = d.getHours() + d.getMinutes() / 60, wd = d.getDay() % 6 !== 0;
      const day = wd && h >= 8 && h <= 19 ? Math.sin(((h - 8) / 11) * Math.PI) : 0;
      return Math.max(1, Math.min(99, base + amp * day + 4 * Math.sin(t / 1700 + seed) + 2 * Math.sin(t / 333 + seed * 3)));
    };
    const nodeBase: Record<string, [number, number, number]> = { pve1: [14, 38, 1], pve2: [9, 24, 2], pve3: [22, 52, 3] };
    const node_history = Object.fromEntries(Object.entries(nodeBase).map(([nn, [b, a, s]]) =>
      [nn, ts.map((t) => ({ ts: t, cpu: +load(t, b, a, s).toFixed(1), mem: +load(t, 35 + b, a / 2, s + 1).toFixed(1) }))]));
    const history = ts.map((t, i) => {
      const cpu = Object.values(node_history).reduce((a, h) => a + h[i].cpu, 0) / 3;
      const mem = Object.values(node_history).reduce((a, h) => a + h[i].mem, 0) / 3;
      return { ts: t, cpu_pct: +cpu.toFixed(1), mem_pct: +mem.toFixed(1), vms_running: Math.round(14 + cpu / 6) };
    });
    const sessions = ts.map((t) => ({ ts: t, sessions: Math.round(load(t, 0, 9, 5) / 1.2) }));
    const lastNode = (nn: string) => node_history[nn][node_history[nn].length - 1];
    return delay({
      cluster_id: cid, range, step, connected: true,
      health: { score: 86, band: 'good', issues: ['pve3: memory 82% (above 80%)', 'pbs-offsite: last verify 9 days ago'] },
      nodes: (['pve1', 'pve2', 'pve3'] as const).map((nn, i) => ({
        name: nn, status: 'online', cpu_pct: lastNode(nn).cpu, mem_pct: lastNode(nn).mem,
        mem_used: Math.round((lastNode(nn).mem / 100) * [256, 256, 512][i]) * GB, mem_total: [256, 256, 512][i] * GB,
        disk_pct: [19, 22, 31][i], uptime: 86400 * (12 + i * 5), netin: 0, netout: 0 })),
      history, node_history, sessions,
      storages: [
        { storage: 'ceph-vm', node: null, type: 'rbd', used: 41 * TB, total: 64 * TB },
        { storage: 'pbs-lab', node: null, type: 'pbs', used: 3.1 * TB, total: 16 * TB },
        { storage: 'nfs-iso', node: null, type: 'nfs', used: 1.4 * TB, total: 8 * TB },
        { storage: 'local-lvm', node: 'pve3', type: 'lvmthin', used: 0.6 * TB, total: 1.8 * TB },
      ],
      alerts: mockActive.map(({ id, severity, message, target_type, target_name, metric, triggered_at, acked_at }) =>
        ({ id, severity, message, target_type, target_name, metric, triggered_at, acked_at })),
    });
  },
  alerts: (cid) => cid !== CLUSTER.id ? fail(404, 'Cluster not found') : delay({
    rules: mockRules.map((r) => ({ ...r })), mutes: liveMutes().map((m) => ({ ...m })),
    active: mockActive.map((a) => ({ ...a, muted_until: muteOf(a)?.until ?? null })) }),
  createAlertRule: (cid, r) => {
    if (cid !== CLUSTER.id) return fail(404, 'Cluster not found');
    if (r.target_type === 'vm' && !/^\d+$/.test(String(r.target_id ?? ''))) return fail(400, 'a VM target needs its numeric ID');
    if (r.target_type === 'node' && !String(r.target_id ?? '').trim()) return fail(400, 'a node target needs the node name');
    const rule: AlertRule = { ...r, id: `r-${seq++}`, cluster_id: cid, created_at: new Date().toISOString() };
    mockRules.push(rule);
    return delay({ ...rule });
  },
  updateAlertRule: (_cid, id, r) => {
    const rule = mockRules.find((x) => x.id === id);
    if (!rule) return fail(404, 'Alert not found');
    Object.assign(rule, r);
    return delay({ ...rule });
  },
  deleteAlertRule: (_cid, id) => {
    const i = mockRules.findIndex((x) => x.id === id);
    if (i >= 0) mockRules.splice(i, 1);
    for (let k = mockMutes.length - 1; k >= 0; k--) if (mockMutes[k].rule_id === id) mockMutes.splice(k, 1);
    return delay(undefined);
  },
  ackAlert: (_cid, firedId) => {
    const a = mockActive.find((x) => String(x.id) === String(firedId));
    if (!a) return fail(404, 'Active alert not found or already resolved');
    a.acked_at = localIso(Date.now());
    a.acked_by = 'admin';
    return delay(undefined);
  },
  muteAlert: (cid, m) => {
    let rule_id = '', object_key = '', object_label: string | null = null;
    if ('active_alert_id' in m) {
      const a = mockActive.find((x) => String(x.id) === String(m.active_alert_id));
      if (!a) return fail(404, 'Active alert not found');
      object_label = a.target_name;
      if (m.whole_object) object_key = a.object_key ?? '';
      else { rule_id = a.alert_id; object_key = a.object_key ?? ''; }
    } else {
      if (!mockRules.some((r) => r.id === m.rule_id)) return fail(404, 'Alert not found');
      rule_id = m.rule_id;
    }
    const now = Date.now();
    const mute: AlertMute = { id: `mu-${seq++}`, cluster_id: cid, rule_id, object_key, object_label,
      until: localIso(now + m.minutes * 60e3), reason: m.reason || null,
      created_by: 'admin', created_at: localIso(now) };
    mockMutes.push(mute);
    return delay({ ...mute });
  },
  unmuteAlert: (_cid, id) => {
    const i = mockMutes.findIndex((x) => x.id === id);
    if (i < 0) return fail(404, 'Mute not found');
    mockMutes.splice(i, 1);
    return delay(undefined);
  },
  alertChannels: () => delay(mockChannels.map(maskChannel)),
  createAlertChannel: (c) => {
    if (!c.url) return fail(400, 'url required');
    const ch: AlertChannel = { id: `ch-${seq++}`, name: c.name || 'channel', type: c.type || 'generic', url: c.url,
      ...(c.token ? { token: c.token } : {}), ...(c.topic ? { topic: c.topic } : {}), enabled: c.enabled ?? true };
    mockChannels.push(ch);
    return delay(maskChannel(ch));
  },
  updateAlertChannel: (id, c) => {
    const ch = mockChannels.find((x) => x.id === id);
    if (!ch) return fail(404, 'channel not found');
    for (const [k, v] of Object.entries(c)) {
      if (['url', 'token', 'topic'].includes(k) && typeof v === 'string' && (v.includes('…') || v === '********')) continue;
      (ch as unknown as Record<string, unknown>)[k] = v;
    }
    return delay(maskChannel(ch));
  },
  deleteAlertChannel: (id) => {
    const i = mockChannels.findIndex((x) => x.id === id);
    if (i < 0) return fail(404, 'channel not found');
    mockChannels.splice(i, 1);
    return delay(undefined);
  },
  testAlertChannel: (id) => {
    const ch = mockChannels.find((x) => x.id === id);
    if (!ch) return fail(404, 'channel not found');
    return delay(ch.enabled ? { ok: true, detail: 'Delivered' }
      : { ok: false, detail: 'Delivery failed — check the channel URL and that the endpoint is reachable' });
  },
  pbsServers: () => delay([
    { id: 'pbs1', name: 'PBS 본사', host: '10.20.0.40', port: 8007, enabled: true, connected: true },
    { id: 'pbs2', name: 'PBS 원격지', host: '10.30.0.40', port: 8007, enabled: true, connected: false },
  ]),
  desktopBackups: (id) => {
    const d = desks.find((x) => x.id === id);
    if (!d) return fail(404, 'Desktop not found');
    return delay(mockBackups.filter((b) => b.volid.includes(`/vm/${d.vmid}/`)));
  },
  backupNow: (id, storage) => {
    const d = desks.find((x) => x.id === id);
    if (!d) return fail(404, 'Desktop not found');
    mockBackups.unshift({ volid: `${storage}:backup/vm/${d.vmid}/${new Date().toISOString().slice(0, 19)}Z`, ctime: Date.now() / 1000,
      size: 18.5 * 1024 ** 3, notes: 'manual', storage });
    return delay(undefined);
  },
  restoreBackup: (id) => (desks.some((x) => x.id === id) ? delay(undefined) : fail(404, 'Desktop not found')),
  deleteBackup: (_id, volid) => { mockBackups.splice(mockBackups.findIndex((b) => b.volid === volid), 1); return delay(undefined); },
  poolPolicy: (poolId) => {
    const p = pools.find((x) => x.id === poolId);
    if (!p) return fail(404, 'Pool not found');
    return delay({ policy: { ...POLICY_DEFAULTS, ...(p.settings?.policy ?? {}) }, defaults: POLICY_DEFAULTS,
      reset_allowed: p.type === 'reset' || p.type === 'classroom' });
  },
  savePoolPolicy: (poolId, pol) => {
    const p = pools.find((x) => x.id === poolId);
    if (!p) return fail(404, 'Pool not found');
    if (!pol.protocols.length) return fail(400, 'protocols: a non-empty list of vnc, spice');
    if (pol.reset_on_logout && p.type !== 'reset' && p.type !== 'classroom') return fail(400, 'reset_on_logout is for reset and scheduled pools only');
    p.settings = { ...(p.settings ?? {}), policy: pol, protocols: pol.protocols };
    return delay(pol);
  },
  setPoolGpu: (poolId, g) => {
    const p = pools.find((x) => x.id === poolId);
    if (!p) return fail(404, 'Pool not found');
    if (g.mode !== 'none' && !MOCK_MAPPINGS.some((m) => m.id === g.mapping)) return fail(404, `No PCI mapping '${g.mapping}'`);
    p.settings = { ...(p.settings ?? {}), gpu: g };
    return delay(g);
  },
  applyPoolGpu: (poolId) => {
    const mine = desks.filter((d) => d.pool_id === poolId);
    return delay({ applied: mine.map((d) => d.id), failed: [],
      needs_restart: mine.filter((d) => guests.find((g) => g.vmid === d.vmid)?.status === 'running').map((d) => d.id) });
  },
  nodes: (clusterId) => {
    if (clusterId !== CLUSTER.id) return fail(404, 'Cluster not found');
    const GB = 1024 ** 3;
    const spec: Record<string, [number, number, number, string]> = {   // cores, memory GB, cpu %, model
      pve1: [32, 256, 41, 'AMD EPYC 9124 16-Core'], pve2: [32, 256, 23, 'AMD EPYC 9124 16-Core'],
      pve3: [64, 512, 78, 'AMD EPYC 9354 32-Core'],
    };
    return delay(Object.entries(spec).map(([node, [cpus, mem, cpu, model]], i): ClusterNode => {
      const mine = guests.filter((g) => g.node === node);
      const used = Math.round(mem * (0.3 + 0.2 * i)) * GB;
      const ns = mockNodeState(node);   // 유지보수, a restart (api/ops.ts)
      if (!ns.online) return { node, status: 'offline', online: false, cpu_percent: 0, cpus, cpu_model: model, mem_used: 0, mem_total: mem * GB,
        mem_percent: 0, disk_used: 0, disk_total: 96 * GB, uptime: 0, loadavg: [], version: 'pve-manager/8.2.4', maintenance: ns.maintenance,
        guests: mine.length, running: 0, desktops: desks.filter((d) => d.node === node).length };
      return { node, status: 'online', online: true, cpu_percent: cpu, cpus, cpu_model: model,
        mem_used: used, mem_total: mem * GB, mem_percent: Math.round(used / (mem * GB) * 1000) / 10,
        disk_used: 18 * GB, disk_total: 96 * GB, uptime: 86400 * (12 + i * 5), loadavg: [(cpu / 10).toFixed(2), '2.10', '1.95'],
        version: 'pve-manager/8.2.4', maintenance: ns.maintenance, guests: mine.length,
        running: mine.filter((g) => g.status === 'running').length, desktops: desks.filter((d) => d.node === node).length };
    }));
  },
  storage: (clusterId) => {
    if (clusterId !== CLUSTER.id) return fail(404, 'Cluster not found');
    const TB = 1024 ** 4;
    const s = (storage: string, type: string, shared: boolean, content: string[], used: number, total: number, nodes: string[]): ClusterStorage =>
      ({ storage, type, shared, content, status: 'available', used: used * TB, total: total * TB, nodes });
    return delay([
      s('ceph-vm', 'rbd', true, ['images', 'rootdir'], 9.2, 24, ['pve1', 'pve2', 'pve3']),
      s('nfs-iso', 'nfs', true, ['iso', 'vztmpl', 'backup'], 1.4, 8, ['pve1', 'pve2', 'pve3']),
      s('local', 'dir', false, ['iso', 'vztmpl'], 0.02, 0.09, ['pve1']),
      s('local', 'dir', false, ['iso', 'vztmpl'], 0.03, 0.09, ['pve2']),
      s('local-lvm', 'lvmthin', false, ['images'], 1.1, 1.8, ['pve3']),
    ]);
  },
  guests: (cid) => cid !== CLUSTER.id ? fail(404, 'Cluster not found') : delay(guests.map((g) => {
    const d = desks.find((x) => x.vmid === g.vmid);
    return { ...g, desktop_id: d?.id ?? null, pool_id: d?.pool_id ?? null };
  })),
  templates: (cid, details) => {
    if (cid !== CLUSTER.id) return fail(404, 'Cluster not found');
    if (!details) return delay(templates);
    return delay(templates.map((x) => {
      const ceph = x.node !== 'pve1';
      const disk = ceph ? { storage: 'ceph-vm', volume: `base-${x.vmid}-disk-0`, plugin: 'rbd' }
        : { storage: 'san-lvm', volume: `vm-${x.vmid}-disk-0`, plugin: 'lvm' };
      return { ...x, spec: { ...x.spec, disk_gb: ceph ? 200 : 64 }, disks: [{ key: 'scsi0', ...disk }],
        linked_clone: ceph, pools: cloneSources.get(x.vmid)?.size ?? 0 };
    }));
  },
  powerDesktop: (id, action) => {
    const d = desks.find((x) => x.id === id);
    if (!d) return fail(404, 'Desktop not found');
    const g = guests.find((x) => x.vmid === d.vmid);
    if (g) g.status = action === 'start' || action === 'reboot' ? 'running' : 'stopped';
    return delay(undefined);
  },
  users: () => delay(users),
  allUsers: () => delay([...users.map((u) => ({ ...u, enabled: true })), ...disabledUsers.map((u) => ({ ...u, enabled: false }))].map((u) => ({
    ...u, tenant_id: 'default',
    desktops: desks.filter((d) => d.assigned_user === u.username).length,
    last_connected: sessions.find((x) => x.username === u.username)?.started_at ?? null,
  }))),
  directory: () => delay({ ...directory, ldap_bind_password: directory.ldap_bind_password ? '********' : '' }),
  saveDirectory: (d) => {
    const pw = d.ldap_bind_password && d.ldap_bind_password !== '********' ? d.ldap_bind_password : directory.ldap_bind_password;
    directory = { ...directory, ...d, ldap_bind_password: pw };
    return delay(undefined);
  },
  testDirectory: (d) => {
    const server = d.ldap_server ?? directory.ldap_server;
    if (!server) return delay({ error: 'LDAP server is required' });
    if (server.includes('bad')) return delay({ steps: [{ step: 'Server connection', status: 'error', detail: 'timed out' }], error: 'Connection failed' });
    const steps = [
      { step: 'Server connection', status: 'ok', detail: `${server}:${d.ldap_port ?? directory.ldap_port}` },
      { step: 'Service account bind', status: 'ok' },
      { step: 'Base DN accessible', status: 'ok', detail: d.ldap_base_dn ?? directory.ldap_base_dn },
    ];
    if (d.test_username) steps.push({ step: 'User search', status: 'ok', detail: `CN=${d.test_username},OU=Students,${d.ldap_base_dn ?? ''}` });
    return delay({ steps });
  },
  settings: () => delay({ ...platform, smtp_password: platform.smtp_password ? '********' : '' }),
  saveSettings: (v) => {
    const pw = v.smtp_password && v.smtp_password !== '********' ? v.smtp_password : platform.smtp_password;
    // the engine clamps like this too
    const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
    platform = { ...platform, ...v, smtp_password: pw };
    platform.session_timeout = clamp(platform.session_timeout, 300, 604800);
    platform.audit_retention_days = clamp(platform.audit_retention_days, 30, 3650);
    platform.password_min_length = clamp(platform.password_min_length, 4, 64);
    return delay(undefined);
  },
  testSmtp: (v) => {
    const host = v.smtp_host || platform.smtp_host;
    if (!host) return fail(400, 'SMTP host required');
    if (host.includes('bad')) return fail(502, 'SMTP connection failed: timed out');
    return delay(undefined);
  },
  userAccess: (username) => {
    const u = [...users, ...disabledUsers].find((x) => x.username === username);
    if (!u) return fail(404, 'User not found');
    const mine = desks.filter((d) => d.assigned_user === username);
    return delay({
      user: { ...u, enabled: users.includes(u), tenant_id: 'default', portal: u.role !== 'viewer' },
      desktops: mine.map((d) => ({ id: d.id, name: d.name, pool: d.pool, pool_id: d.pool_id, vmid: d.vmid, cluster_id: CLUSTER.id })),
      vm_acl: [
        ...mine.map((d) => ({ cluster_id: CLUSTER.id, vmid: d.vmid, desktop: d.name, source: 'vlab' as const, permissions: [], inherit_role: true })),
        ...(username === 'alice' ? [{ cluster_id: CLUSTER.id, vmid: 410, desktop: null, source: 'direct' as const, permissions: ['vm.console'], inherit_role: false }] : []),
      ],
      vm_acl_unavailable: false,
      sessions: sessions.filter((x) => x.username === username),
    });
  },
  pools: () => delay(pools.map((p) => ({
    ...p,
    desktops: desks.filter((d) => d.pool_id === p.id).length,
    assigned: desks.filter((d) => d.pool_id === p.id && d.assigned_user).length,
  }))),
  createPool: (p) => {
    if (!p.name.trim()) return fail(400, 'name is required');
    return delay(addPool(p.name.trim(), p.type));
  },
  updatePool: (id, u) => {
    const p = pools.find((x) => x.id === id);
    if (!p) return fail(404, 'Pool not found');
    const changed: string[] = [];
    if (u.name !== undefined) {
      const name = u.name.trim();
      if (!name || name.length > 80) return fail(400, 'name is required (at most 80 characters)');
      if (name !== p.name) { p.name = name; changed.push('name'); }
    }
    if (u.description !== undefined && u.description.trim() !== p.description) { p.description = u.description.trim(); changed.push('description'); }
    if (u.enabled !== undefined && u.enabled !== p.enabled) { p.enabled = u.enabled; changed.push('enabled'); }
    if (u.settings) {
      const s = { ...(p.settings ?? {}) };
      if (u.settings.max_sessions !== undefined) {
        if (p.type !== 'shared') return fail(400, 'max_sessions is for shared pools only');
        if (!(u.settings.max_sessions >= 1 && u.settings.max_sessions <= 500)) return fail(400, 'max_sessions must be 1 to 500');
        if (s.shared?.max_sessions !== u.settings.max_sessions) { s.shared = { ...s.shared, max_sessions: u.settings.max_sessions }; changed.push('max_sessions'); }
      }
      p.settings = s;
    }
    desks.forEach((d) => { if (d.pool_id === p.id) d.pool = p.name; });
    return delay({ pool: { ...p, desktops: desks.filter((d) => d.pool_id === p.id).length }, changed });
  },
  deletePool: (id) => {
    if (desks.some((d) => d.pool_id === id)) return fail(409, 'The pool still has desktops - take them out first');
    pools.splice(pools.findIndex((p) => p.id === id), 1);
    return delay(undefined);
  },
  poolDesktops: (id) => delay(desks.filter((d) => d.pool_id === id).map(live)),
  addDesktop: (id, g) => {
    const pool = pools.find((p) => p.id === id);
    if (!pool) return fail(404, 'Pool not found');
    if (desks.some((d) => d.vmid === g.vmid)) return fail(409, `Guest ${g.vmid} is already a desktop`);
    if (!guests.some((x) => x.vmid === g.vmid)) return fail(404, `Guest ${g.vmid} not found on the cluster`);
    addDesk(pool, g.vmid);
    return delay(undefined);
  },
  clone: (id, c) => {
    const pool = pools.find((p) => p.id === id);
    const tpl = templates.find((x) => x.vmid === c.template_vmid);
    if (!pool) return fail(404, 'Pool not found');
    if (!tpl) return fail(404, 'not a template');
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,40}$/.test(c.name_prefix)) return fail(400, 'name_prefix: letters, digits and "-"');
    const used = new Set(guests.map((g) => g.vmid));
    let v = c.start_vmid || 310, n = 1;
    const created: { id: string; vmid: number; name: string }[] = [];
    while (created.length < c.count) {
      while (used.has(v)) v++;
      let name = `${c.name_prefix}-${String(n).padStart(2, '0')}`;
      while (desks.some((d) => d.pool_id === id && d.name === name)) { n++; name = `${c.name_prefix}-${String(n).padStart(2, '0')}`; }
      guests.push({ vmid: v, name, node: tpl.node, type: 'qemu', status: 'stopped' });
      addDesk(pool, v);
      const d = desks[desks.length - 1];
      readyAt.set(d.id, Date.now() + 4000 + created.length * 1500);
      created.push({ id: d.id, vmid: v, name });
      used.add(v); n++;
    }
    if (!cloneSources.has(tpl.vmid)) cloneSources.set(tpl.vmid, new Set());
    cloneSources.get(tpl.vmid)!.add(id);
    return delay({ created, failed: null });
  },
  removeDesktop: (id) => { desks.splice(desks.findIndex((d) => d.id === id), 1); return delay(undefined); },
  assign: (id, username) => {
    const d = desks.find((x) => x.id === id);
    if (!d) return fail(404, 'Desktop not found');
    if (username && !users.some((u) => u.username === username)) return fail(404, 'User not found');
    d.assigned_user = username;
    return delay(undefined);
  },
  takeBase: (id) => { withBase.add(id); return delay(undefined); },
  resetDesktop: (id, force) => {
    if (!withBase.has(id)) return fail(409, 'This desktop has no base snapshot yet');
    const d = desks.find((x) => x.id === id);
    if (d?.assigned_user === 'alice' && !force) return fail(409, 'IN_USE');
    return delay(undefined);
  },
  resetPool: (id, force) => {
    const out: { reset: { id: string; name: string }[]; skipped: { id: string; name: string; reason: 'no_base' | 'in_use' }[]; failed: { id: string; name: string; error: string }[] } = { reset: [], skipped: [], failed: [] };
    for (const d of desks.filter((x) => x.pool_id === id)) {
      if (!withBase.has(d.id)) out.skipped.push({ id: d.id, name: d.name, reason: 'no_base' });
      else if (d.assigned_user === 'alice' && !force) out.skipped.push({ id: d.id, name: d.name, reason: 'in_use' });
      else out.reset.push({ id: d.id, name: d.name });
    }
    return delay(out);
  },
  audit: (f = {}) => {
    const all = auditLog.filter((e) =>
      (!f.vlab_only || f.q || /vlab/i.test(e.action + (e.details ?? ''))) &&
      (!f.q || [e.user, e.action, e.details ?? ''].some((x) => x.toLowerCase().includes(f.q!.toLowerCase()))) &&
      (!f.user || e.user.includes(f.user)));
    const offset = f.offset ?? 0, limit = f.limit ?? 50;
    return delay({ entries: all.slice(offset, offset + limit), total: all.length, offset, limit, has_more: offset + limit < all.length });
  },
  usage: (days, poolId) => {
    // deterministic fake usage: weekdays busier, the build farm busiest
    const ps = pools.filter((p) => !poolId || p.id === poolId);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const wave = (i: number, k: number) => Math.abs(Math.sin(i * 1.7 + k * 2.3));
    const by_day = Array.from({ length: days }, (_, i) => {
      const d = new Date(today.getTime() - (days - 1 - i) * 864e5);
      const weekday = d.getDay() % 6 !== 0 ? 1 : 0.25;
      const sessions = Math.round(ps.reduce((n, p, k) => n + (p.desktops || 1) * 1.6 * wave(i, k), 0) * weekday);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { date, sessions, users: Math.max(0, Math.round(sessions * 0.6)), hours: Math.round(sessions * 1.9 * 10) / 10,
        peak: Math.min(sessions, Math.ceil(sessions / 2.5)) };
    });
    const total = by_day.reduce((a, d) => ({ s: a.s + d.sessions, h: a.h + d.hours }), { s: 0, h: 0 });
    const windowH = days * 24;
    const weight = ps.map((p, k) => (p.type === 'buildfarm' ? 3 : 1) * (desks.filter((x) => x.pool_id === p.id).length || 1) * (1 + k % 2));
    const wsum = weight.reduce((a, b) => a + b, 0) || 1;
    const by_pool = ps.map((p, k) => {
      const n = desks.filter((x) => x.pool_id === p.id).length;
      const hours = Math.round(total.h * weight[k] / wsum * 10) / 10;
      return { id: p.id, name: p.name, type: p.type, desktops: n, sessions: Math.round(total.s * weight[k] / wsum),
        users: Math.min(users.length, 1 + k), hours, utilization: n ? Math.min(1, hours / (n * windowH)) : 0 };
    }).sort((a, b) => b.hours - a.hours);
    const top_users = users.slice(0, 6).map((u, k) => ({ username: u.username, sessions: Math.round(total.s / (k + 2)),
      hours: Math.round(total.h / (k + 2) * 10) / 10, last: new Date(Date.now() - (k + 1) * 36e5).toISOString() }));
    return delay({
      days, from: new Date(today.getTime() - (days - 1) * 864e5).toISOString(), to: new Date().toISOString(),
      totals: { sessions: total.s, users: Math.min(users.length, top_users.length), hours: Math.round(total.h * 10) / 10,
        avg_minutes: total.s ? Math.round(total.h * 60 / total.s * 10) / 10 : 0, peak: Math.max(0, ...by_day.map((d) => d.peak)), open: 1 },
      by_day, by_pool, top_users, by_protocol: { vnc: Math.round(total.s * 0.7), spice: total.s - Math.round(total.s * 0.7) },
      open_session_cap_hours: 12,
    });
  },
  summary: () => {
    const all = desks.map(live);
    const by_state: Record<string, number> = {};
    all.forEach((d) => { by_state[d.state] = (by_state[d.state] ?? 0) + 1; });
    const by_type: Record<string, number> = {};
    pools.forEach((p) => { by_type[p.type] = (by_type[p.type] ?? 0) + 1; });
    return delay({
      clusters: { total: clusters.length, connected: clusters.filter((c) => c.connected).length },
      pools: { total: pools.length, by_type },
      desktops: { total: all.length, assigned: all.filter((d) => d.assigned_user).length, in_session: 1, by_state },
      users: { total: users.length + disabledUsers.length, enabled: users.length },
      sessions_today: 3,
      versions: { engine: '1.3.0', vlab_api: 1, build: '2026.10.12' },
    });
  },
  desktops: () => delay(desks.map(live)),
  sessions: (f = {}) => delay(sessions.filter((x) =>
    (!f.username || x.username === f.username) && (!f.pool_id || x.pool_id === f.pool_id)).slice(0, f.limit ?? 200)),
  endSession: (id) => {
    const s = sessions.find((x) => x.id === id);
    if (!s) return fail(404, 'Session not found');
    if (s.ended_at) return fail(409, 'The session has already ended');
    return delay(endOne(s));
  },
  endUserSessions: (username) => delay(sessions.filter((x) => x.username === username && !x.ended_at).map(endOne)),
  notices: () => delay(mockNotices.map((n) => ({ ...n, state: noticeState(n) }))),
  saveNotice: (id, b) => {
    const cur = id ? mockNotices.find((n) => n.id === id) : undefined;
    if (id && !cur) return fail(404, 'Notice not found');
    const next = { text: '', severity: 'info' as const, audience: 'all' as const, starts_at: null, expires_at: null, ...cur, ...b };
    if (!next.text.trim()) return fail(400, 'Enter the text of the banner');
    if (next.text.length > 500) return fail(400, 'The text is longer than 500 characters');
    if (next.audience !== 'all' && next.audience !== 'admins') return fail(400, 'audience is all or admins');
    if (b.expires_at && new Date(b.expires_at).getTime() <= Date.now()) return fail(400, 'The expiry time has already passed');
    if (next.starts_at && next.expires_at && new Date(next.starts_at) >= new Date(next.expires_at)) return fail(400, 'The notice must start before it ends');
    const at = new Date().toISOString().slice(0, 19) + 'Z';
    if (cur) {
      if (b.text !== undefined && b.text !== cur.text) cur.rev += 1;
      Object.assign(cur, next, { updated_at: at, updated_by: 'admin' });
      cur.state = noticeState(cur);
      return delay({ ...cur });
    }
    if (mockNotices.length >= 20) return fail(409, 'There are already 20 notices - delete one first');
    const n = { ...next, id: Math.random().toString(16).slice(2, 10).padEnd(16, '0'), rev: 1, state: noticeState(next),
      created_at: at, created_by: 'admin', updated_at: at, updated_by: 'admin' };
    mockNotices.push(n);
    return delay({ ...n });
  },
  deleteNotice: (id) => {
    const i = mockNotices.findIndex((n) => n.id === id);
    if (i < 0) return fail(404, 'Notice not found');
    mockNotices.splice(i, 1);
    return delay(undefined);
  },
};

function endOne(s: SessionRow) {
  s.ended_at = new Date().toISOString().slice(0, 19) + '+00:00';
  s.result = 'terminated';
  return { id: s.id, username: s.username, protocol: s.protocol, hung_up: s.protocol === 'vnc' ? 1 : 0,
    record_only: s.protocol !== 'vnc' };
}

const ago = (h: number) => new Date(Date.now() - h * 36e5).toISOString().slice(0, 19) + '+00:00';
const sessions: SessionRow[] = [
  { id: 's4', username: 'alice', desktop_id: 'desk_2', desktop: 'lab-win11-01', vmid: 300, pool_id: 'pool_1', pool: '공용 LAB A',
    protocol: 'vnc', client_ip: '10.20.1.31', started_at: ago(0.3), ended_at: null, result: 'started' },
  { id: 's5', username: 'bob', desktop_id: 'desk_6', desktop: 'vivado-build-01', vmid: 400, pool_id: 'pool_5', pool: 'FPGA 빌드 팜',
    protocol: 'spice', client_ip: '10.20.3.7', started_at: ago(1.2), ended_at: null, result: 'started' },
  { id: 's3', username: 'bob', desktop_id: 'desk_6', desktop: 'vivado-build-01', vmid: 400, pool_id: 'pool_5', pool: 'FPGA 빌드 팜',
    protocol: 'spice', client_ip: '10.20.3.7', started_at: ago(5), ended_at: ago(5), result: 'ended' },
  { id: 's2', username: 'alice', desktop_id: 'desk_2', desktop: 'lab-win11-01', vmid: 300, pool_id: 'pool_1', pool: '공용 LAB A',
    protocol: 'vnc', client_ip: '10.20.1.31', started_at: ago(26), ended_at: ago(24.5), result: 'ended' },
  { id: 's1', username: 'bob', desktop_id: 'desk_6', desktop: 'vivado-build-01', vmid: 400, pool_id: 'pool_5', pool: 'FPGA 빌드 팜',
    protocol: 'vnc', client_ip: '10.20.3.7', started_at: ago(50), ended_at: ago(46), result: 'ended' },
];

const auditLog = [
  ['admin', 'vlab.desktop.assign', 'qemu/301: - -> bob', 0.2],
  ['alice', 'vm.console', "vLAB: vnc to desktop 'lab-win11-01' (qemu/300)", 0.4],
  ['admin', 'vlab.desktop.clone', "3/3 from template 900 into pool '공용 LAB A'", 2],
  ['admin', 'vlab.pool.reset', "pool '공용 LAB A': 2 reset, 1 skipped, 0 failed", 3],
  ['admin', 'settings.ldap', 'LDAP settings updated (enabled=True)', 20],
  ['admin', 'cluster.added', 'Added Proxmox cluster: LAB-PVE (10.20.0.11)', 30],
  ['bob', 'vm.start', "vLAB: start desktop 'vivado-build-01' (qemu/400)", 40],
].map(([user, action, details, h], i) => ({
  id: 100 - i, timestamp: new Date(Date.now() - (h as number) * 36e5).toISOString(), user: user as string,
  action: action as string, details: details as string, ip_address: '10.20.1.31', cluster: 'LAB-PVE', severity: 'info',
}));

// 가상머신 > 데스크톱(VM) 관리 in mock mode (api/vmManage.ts) works on these same desktops and guests
export const mockVmStore = { desks, guests, templates, withBase };
