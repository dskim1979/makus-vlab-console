// Shapes the console uses. Auth comes from the engine core (/api/auth/*);
// everything else from the vLAB module (/api/vlab/*), see docs/vlab-design.md 3-1, 8-3.

export type User = {
  username: string;
  role: string; // 'admin' | 'user' | 'viewer' | custom
  display_name?: string;
  email?: string;
  auth_source?: string; // 'local' | 'ldap' | 'oidc' | 'entra'
  tenant_id?: string;
  permissions?: string[];
  language?: string;
};

export type AuthStatus =
  | { authenticated: true; user: User }
  | {
      authenticated: false;
      initialized?: boolean;
      ldap_enabled?: boolean;
      oidc_enabled?: boolean;
      oidc_button_text?: string;
    };

export type LoginResult =
  | { kind: 'ok'; user: User; mustChange?: boolean }   // requires_password_change: a new password before going on
  | { kind: 'second_factor'; methods: string[] }
  | { kind: 'error'; reason: 'invalid' | 'locked' | 'network' | 'other'; message?: string };

export type DesktopState = 'ready' | 'in_use' | 'stopped' | 'provisioning' | 'error';

export type Desktop = {
  id: string;
  name: string;
  pool: string;
  state: DesktopState;
  os?: string;
  spec?: { cpu?: number; memory_gb?: number; gpu?: string };
  protocols: string[];
  resources?: { kind: 'card' | 'usb'; name: string }[];
  pool_type?: string;
  last_connected?: string | null;
  gpu?: { mode: 'passthrough' | 'vgpu'; label: string };
  policy?: { clipboard: Clipboard; allow_power: boolean; start_on_connect: boolean };
  // 공유 저장소: the user's folders on the pool's NAS, and how the last check went
  storage?: StoragePaths & { ok: boolean | null; code: string; warnings: string[] };
};

// --- shared storage (공유 저장소, makus-vlab pegaprox/vlab/nas.py) ----------------------
export type FolderKey = 'home' | 'project' | 'scratch';
export type StorageFolder = { linux: string; windows: string | null; nas: string; folder: string; quota_gb: number; retention_days?: number };
export type StoragePaths = { kind: 'nfs' | 'smb'; folders: Partial<Record<FolderKey, StorageFolder>>; data_on_nas_only: boolean };
export type StorageResult = {
  ok: boolean | null; code: string; detail: string; path: string; os: string; at: string; changed: boolean;
  warnings: string[]; usage: Partial<Record<FolderKey, number>>; paths?: StoragePaths;
};

export type Branding = {
  enabled: boolean; appName: string; browserTitle: string; logoUrl: string; loginLogoUrl: string; faviconUrl: string;
  primaryColor: string; footerText: string; loginTagline: string; docsUrl: string; supportUrl: string; hideVersion: boolean;
};
export type BrandingSlot = 'logo' | 'loginLogo' | 'favicon';

// --- backup (운영 > 백업) ---------------------------------------------------------
export type BackupStorage = { storage: string; type: string; pbs: boolean; shared: boolean; status: string; used: number; total: number };
export type BackupJob = { id: string; schedule?: string; storage?: string; vmid?: string; enabled?: number | boolean; mode?: string;
  comment?: string; 'prune-backups'?: string; 'next-run'?: number; vlab_pool_id: string | null; vlab_pool: string | null };
export type VmBackup = { volid: string; ctime?: number; size?: number; notes?: string; storage?: string; format?: string; protected?: number | boolean };
export type PbsServer = { id: string; name: string; host: string; port?: number; enabled?: boolean; connected?: boolean };

export type Clipboard = 'both' | 'to_desktop' | 'from_desktop' | 'off';

export type Lease = {
  id: string;
  kind: 'card' | 'fpga' | 'gpu' | 'usb' | 'desktop';
  name: string;
  ends_at?: string;
  desktop?: string | null;
};

// --- admin (/api/vlab/admin/*) ---------------------------------------------------

export type PoolType = 'dedicated' | 'reset' | 'shared' | 'classroom' | 'buildfarm';

// LABs: rooms of terminals and the weekly schedules of their pools (/api/vlab/admin/labs ...)
export type LabSlot = { schedule_id: string; pool_id: string; title: string; start: string; end: string; preparing?: boolean };
export type Lab = { id: string; name: string; location: string; description: string; seats: number; tenant_id: string;
  created_at: string; terminals: number; pending: number; schedules: number; current: LabSlot | null; next: LabSlot | null };
export type LabInput = { name: string; location?: string; description?: string; seats?: number };
export type Terminal = { id: string; lab_id: string | null; name: string; mac: string; ip: string; state: 'pending' | 'approved';
  registered_by: string; last_seen: string | null; created_at: string; has_key?: boolean; enrollment?: TerminalEnrollment | null };
// a terminal that came in with an enrolment code (src/api/enroll.ts): whether its kiosk key went out to the client
export type TerminalEnrollment = { state: 'waiting' | 'delivered' | 'manual' | 'expired'; code_id: string; code: string;
  created_at: string; last_poll_at: string | null; delivered_at: string | null };
export type LabAfter = 'reset' | 'off' | 'none';
// GET /api/vlab/kiosk (terminal key): the room and what runs now and next
export type KioskSlot = LabSlot & { pool: string | null };
export type KioskInfo = { terminal: { id: string; name: string }; lab: { id: string; name: string; location: string };
  current: KioskSlot | null; next: KioskSlot | null; now: string };
export type LabSchedule = { id: string; lab_id: string; pool_id: string; title: string; weekdays: number[]; start_time: string;
  end_time: string; prepare_min: number; after: LabAfter; enabled: boolean; last_prepared: string; last_finished: string;
  lab: string | null; pool: string | null; pool_type: PoolType | null };
export type LabScheduleInput = { lab_id: string; pool_id: string; title?: string; weekdays: number[]; start_time: string;
  end_time: string; prepare_min: number; after: LabAfter; enabled?: boolean };
export type LabRun = { phase: 'prepare' | 'finish'; done: { id: string; name: string }[];
  skipped: { id: string; name: string; reason: string }[]; failed: { id: string; name: string; error: string }[] };


export type Pool = {
  id: string;
  name: string;
  type: PoolType;
  cluster_id: string;
  tenant_id: string;
  description: string;
  enabled: boolean;
  created_at: string;
  created_by: string;
  desktops: number;
  assigned: number;
  settings?: { gpu?: GpuPolicy; protocols?: string[]; templates?: number[]; policy?: PoolPolicy;
    shared?: { max_sessions?: number }; rdp_gateway_id?: string; guac_gateway_id?: string };
};

// PUT /api/vlab/admin/pools/<id>: what the pool form changes (the cluster and the type stay)
export type PoolUpdate = {
  name?: string; description?: string; enabled?: boolean;
  settings?: { max_sessions?: number; rdp_gateway_id?: string | null; guac_gateway_id?: string | null };
};

// --- pool policy (데스크톱 풀 > 풀 > 정책) ------------------------------------------
export type PoolPolicy = {
  protocols: ('vnc' | 'spice' | 'rdp' | 'guac')[]; spice_fullscreen: boolean;
  clipboard: Clipboard;
  usb_redirect: boolean; usb_autoshare: boolean;
  start_on_connect: boolean; idle_shutdown_min: number; reset_on_logout: boolean;
  allow_power: boolean; max_session_hours: number;
};
export type PoolPolicyAnswer = { policy: PoolPolicy; defaults: PoolPolicy; reset_allowed: boolean };

// --- accelerators (가속 자원, docs/vlab-design.md 10-0) ---------------------------
export type GpuPolicy = { mode: 'none' | 'passthrough' | 'vgpu'; mapping?: string; mdev_type?: string; label?: string; x_vga?: boolean };
export type AccelUser = { vmid: number; name: string; node: string; status: string; slot: string; mdev: string | null;
  desktop_id: string | null; pool: string | null };
export type AccelKind = 'gpu' | 'fpga' | 'npu';
export type AccelDevice = { node: string; pciid: string; kind: AccelKind; vendor: string; vendor_id: string; device_id: string;
  model: string; subsystem: string; iommu_group: number | null; vgpu_capable: boolean; virtual_function?: boolean; used_by: AccelUser[]; mappings: string[] };
export type PciMapping = { id: string; description: string; mdev: boolean; devices: { node: string; path: string; id: string }[];
  used_by: AccelUser[]; pools: string[] };
export type AccelInventory = { devices: AccelDevice[]; mappings: PciMapping[]; mappings_readable: boolean; unreadable_nodes: string[];
  summary: { gpus: number; fpgas: number; npus?: number; vgpu_capable: number; in_use: number } };
export type VgpuProfile = { type: string; name: string; description: string; available: number; framebuffer_mb: number | null;
  max_instance: number | null; heads: number | null; max_resolution: string };
export type AdminLease = {
  id: string; resource_type: 'fpga' | 'gpu' | 'npu' | 'card' | 'usb'; resource_id: string; resource_name: string; username: string;
  cluster_id: string; vmid: number; starts_at: string; ends_at: string | null; returned_at: string | null;
  state: 'active' | 'returned'; desktop_id: string | null; desktop: string | null; vm_running: boolean;
};
export type GpuApplyResult = { applied: string[]; failed: { id: string; name: string; error: string }[]; needs_restart: string[] };

export type AdminDesktop = Desktop & {
  vmid: number;
  has_base?: boolean;
  node: string;
  assigned_user: string | null;
  cluster_id?: string;
  pool_id?: string;
  usage?: { cpu_percent: number; cpus: number; mem: number; maxmem: number; uptime: number };
};

export type Cluster = { id: string; name: string; connected: boolean; host?: string; connection_error?: string | null; pools?: number };

export type NewCluster = { name: string; host: string; user: string; pass: string; ssl_verification: boolean };

export type Guest = {
  vmid: number;
  name: string;
  node: string;
  type: 'qemu' | 'lxc';
  status: string;
  desktop_id: string | null;
  pool_id: string | null;
};

export type AssignableUser = {
  username: string; display_name: string; role: string; auth_source: string;
  email?: string; enabled?: boolean; tenant_id?: string; desktops?: number; last_connected?: string | null;
};

export type UserAccess = {
  user: { username: string; display_name: string; role: string; auth_source: string; enabled: boolean; tenant_id: string; portal: boolean };
  desktops: { id: string; name: string; pool: string; pool_id: string; vmid: number; cluster_id: string }[];
  vm_acl: { cluster_id: string; vmid: number; desktop: string | null; source: 'vlab' | 'direct'; permissions: string[]; inherit_role: boolean }[];
  vm_acl_unavailable: boolean;
  sessions: SessionRow[];
};

// --- connecting (/api/vlab/desktops/<id>/connect) ----------------------------------

export type ConnectInfo = (
  | { type: 'vnc'; ws_path: string; password: string; session_id: string; clipboard?: Clipboard }
  | { type: 'spice'; vv: string; filename: string; session_id: string }
  | { type: 'rdp'; rdp: string; filename: string; session_id: string }
  | { type: 'guac'; url: string; session_id: string }
) & { storage?: StorageResult };
export type ConnectProtocol = 'vnc' | 'spice' | 'rdp' | 'guac';

export type PowerAction = 'start' | 'shutdown' | 'reboot' | 'stop';

// GET /api/vlab/client/config: the Windows client to offer (set under the engine's client settings)
export type ClientConfig = { latest_version: string; min_version: string; download_url: string; protocol: string; support_url: string };

export type SessionRow = {
  id: string;
  username: string;
  desktop_id: string | null;
  desktop: string;
  vmid: number | null;
  pool_id: string | null;
  pool: string;
  protocol: string;
  client_ip: string;
  started_at: string;
  ended_at: string | null;
  result: string;
};

// POST /api/vlab/admin/sessions/<id>/end: record_only when the engine does not carry the
// connection (SPICE, RDP, browser RDP) - the viewer stays open on the user's side
export type EndedSession = { id: string; username: string; protocol: string; hung_up: number; record_only: boolean };

// notices (플랫폼 설정 > 공지): the engine's broadcast banners with a start and an audience
export type NoticeSeverity = 'info' | 'warning' | 'critical';
export type Notice = {
  id: string; text: string; severity: NoticeSeverity; audience: 'all' | 'admins' | 'other';
  starts_at: string | null; expires_at: string | null; rev: number; state: 'scheduled' | 'running' | 'ended';
  created_at: string | null; created_by: string | null; updated_at: string | null; updated_by: string | null;
};
export type NoticeInput = { text: string; severity: NoticeSeverity; audience: 'all' | 'admins'; starts_at: string | null; expires_at: string | null };
// GET /api/vlab/banners: what the signed-in user sees now
export type ActiveNotice = { id: string; text: string; severity: NoticeSeverity; rev: number; expires_at: string | null };

export type Template = {
  vmid: number; name: string; node: string; type: 'qemu' | 'lxc'; spec: { cpu?: number; memory_gb?: number; disk_gb?: number };
  // with ?details=1 only
  disks?: { key: string; storage: string; volume: string; plugin: string }[] | null;
  linked_clone?: boolean | null;
  pools?: number;
};

export type CloneResult = {
  created: { id: string; vmid: number; name: string }[];
  failed: { vmid: number; name: string; error: string } | null;
};

export type PoolResetResult = {
  reset: { id: string; name: string }[];
  skipped: { id: string; name: string; reason: 'no_base' | 'in_use' }[];
  failed: { id: string; name: string; error: string }[];
};

export type Directory = {
  ldap_enabled: boolean; ldap_server: string; ldap_port: number; ldap_use_ssl: boolean; ldap_use_starttls: boolean;
  ldap_verify_tls: boolean; ldap_bind_dn: string; ldap_bind_password: string; ldap_base_dn: string;
  ldap_user_filter: string; ldap_username_attribute: string; ldap_email_attribute: string;
  ldap_display_name_attribute: string; ldap_group_base_dn: string; ldap_group_filter: string;
  ldap_default_role: string; ldap_auto_create_users: boolean;
  ldap_group_mappings: { group_dn: string; role: string }[];
};

export type DirectoryTest = {
  steps?: { step: string; status: string; detail?: string }[];
  user?: Record<string, unknown>;
  error?: string;
};

export type Summary = {
  clusters: { total: number; connected: number };
  pools: { total: number; by_type: Partial<Record<PoolType, number>> };
  desktops: { total: number; assigned: number; in_session: number; by_state: Partial<Record<DesktopState, number>> };
  users: { total: number; enabled: number };
  sessions_today: number;
  versions: { engine: string; vlab_api: number; build: string };
};

export type AuditEntry = {
  id: number; timestamp: string; user: string; action: string; details: string | null;
  ip_address: string | null; cluster: string | null; severity?: string | null;
};
export type AuditPage = { entries: AuditEntry[]; total: number; offset: number; limit: number; has_more: boolean };
export type AuditQuery = { q?: string; user?: string; date_from?: string; date_to?: string; vlab_only?: boolean; offset?: number; limit?: number };

export type UsageDay = { date: string; sessions: number; users: number; hours: number; peak: number };
export type UsagePool = { id: string; name: string; type: PoolType; desktops: number; sessions: number; users: number;
  hours: number; utilization: number };
export type UsageUser = { username: string; sessions: number; hours: number; last: string };
export type UsageReport = {
  days: number; from: string; to: string;
  totals: { sessions: number; users: number; hours: number; avg_minutes: number; peak: number; open: number };
  by_day: UsageDay[]; by_pool: UsagePool[]; top_users: UsageUser[]; by_protocol: Record<string, number>;
  open_session_cap_hours: number;
};

export type PlatformSettings = {
  session_timeout: number; strict_session_ip: boolean;
  login_max_attempts: number; login_lockout_time: number; login_attempt_window: number;
  force_2fa: boolean; force_2fa_exclude_admins: boolean;
  password_min_length: number; password_require_uppercase: boolean; password_require_lowercase: boolean;
  password_require_numbers: boolean; password_require_special: boolean;
  password_expiry_enabled: boolean; password_expiry_days: number; password_expiry_warning_days: number;
  audit_retention_days: number; air_gap_mode: boolean;
  smtp_enabled: boolean; smtp_host: string; smtp_port: number; smtp_user: string; smtp_password: string;
  smtp_from_email: string; smtp_from_name: string; smtp_tls: boolean; smtp_ssl: boolean;
  alert_email_recipients: string[];
};

export type ClusterNode = {
  node: string; status: string; online: boolean; cpu_percent: number; cpus: number; cpu_model: string;
  mem_used: number; mem_total: number; mem_percent: number; disk_used: number; disk_total: number;
  uptime: number; loadavg: string[]; version: string; maintenance: boolean;
  guests: number; running: number; desktops: number;
};
export type ClusterStorage = {
  storage: string; type: string; shared: boolean; content: string[]; status: string;
  used: number; total: number; nodes: string[];
};

// GET /api/vlab/admin/clusters/<id>/infra - the dashboard's monitoring panels
export type InfraRange = '24h' | '7d' | '30d';
export interface InfraNode {
  name: string; status: string; cpu_pct: number; mem_pct: number; mem_used: number; mem_total: number;
  disk_pct: number; uptime: number; netin: number; netout: number;
}
export interface Infra {
  cluster_id: string; range: InfraRange; step: number; connected: boolean;
  health: { score: number | null; band: string | null; issues: string[] };
  nodes: InfraNode[];
  history: { ts: number; cpu_pct: number; mem_pct: number; vms_running: number }[];
  node_history: Record<string, { ts: number; cpu: number; mem: number }[]>;
  sessions: { ts: number; sessions: number }[];
  storages: { storage: string; node: string | null; type: string; used: number; total: number }[];
  alerts: { id: number | string; severity: string; message: string; target_type: string; target_name: string;
    metric: string; triggered_at: string; acked_at: string | null }[];
}

// 운영 > 경보: the engine's alert rules, firing incidents, mutes and notification channels
// (core routes reached through /api/vlab/admin/clusters/<id>/alerts and /alert-channels)
export type AlertSeverity = 'auto' | 'critical' | 'warning' | 'info';
export type AlertTargetType = 'cluster' | 'node' | 'vm';
export interface AlertRule {
  id: string; name: string; cluster_id?: string; metric: string; operator: string; threshold: number;
  target_type: AlertTargetType; target_id: string | number | null; channels: string[];
  severity: AlertSeverity; enabled: boolean; notify_resolved?: boolean; created_at?: string;
}
export type AlertRuleInput = Pick<AlertRule, 'name' | 'metric' | 'operator' | 'threshold' | 'target_type' | 'target_id' |
  'channels' | 'severity' | 'enabled'> & { notify_resolved?: boolean };
export interface ActiveAlert {
  id: number | string; alert_id: string; severity: string; message: string; target_type: string; target_name: string;
  metric: string; current_value: number | null; threshold: number | null; operator: string | null;
  triggered_at: string; last_fired_at: string | null; acked_at: string | null; acked_by: string | null;
  escalation_step: number | null; object_key: string | null; muted_until: string | null;
}
export interface AlertMute {
  id: string; cluster_id: string; rule_id: string; object_key: string; object_label: string | null;
  until: string; reason: string | null; created_by: string; created_at: string;
}
export interface ClusterAlerts { rules: AlertRule[]; active: ActiveAlert[]; mutes: AlertMute[] }
export type MuteInput = { minutes: number; reason?: string } & (
  { rule_id: string } | { active_alert_id: string | number; whole_object?: boolean });
export type ChannelType = 'slack' | 'discord' | 'teams' | 'ntfy' | 'generic';
export interface AlertChannel {
  id: string; name: string; type: ChannelType; url: string; token?: string; topic?: string; enabled: boolean;
}
export type AlertChannelInput = Partial<Omit<AlertChannel, 'id'>>;

// GET /api/vlab/admin/clusters/<id>/rightsizing - which VMs need more / can give back
export interface RightSizingFlag {
  kind: string; severity: string; detail: string; rationale: string;
  current?: number; recommended?: number; current_gb?: number; recommended_gb?: number;
}
export interface RightSizingRow {
  vmid: string; type: string; name: string; node: string; cpu_avg: number; cpu_p95: number; mem_avg: number; mem_max: number;
  maxcpu: number; maxmem_gb: number; samples: number; flags: RightSizingFlag[]; actions: string[];
  desktop_id: string | null; desktop: string | null; pool_id: string | null; pool: string | null; assigned_to: string | null;
}
export interface RightSizing {
  cluster_id: string; days: number; snapshots: number; min_samples: number; total_vms: number;
  counts: { grow: number; reclaim: number; idle: number; ok: number; no_data: number };
  recommendations: RightSizingRow[];
}
