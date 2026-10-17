// Next-phase screens: departments, sign-up review, USB library, gateways, external desktops,
// golden images, board lab, build farm, licence servers (makus-vlab pegaprox/api/vlab_next.py),
// and the Windows client settings (pegaprox/api/vlab.py /api/vlab/admin/client).
import { forProfile } from './mockProfile';
import { ApiError, isMock, request } from './client';
import { mockGateways, mockLinkBoards } from './jtag';
import { mockHaVmids } from './ops';
import type { GpuEnv, GpuJobFields, Notify, Runtime, WaitReason } from './research';

export type Department = { id: string; name: string; parent_id: string | null; sort: number; members: number; created_at: string; manager?: string };
export type Member = { username: string; department_id: string };
export type SignupStatus = 'pending' | 'approved' | 'rejected';
export type Signup = {
  id: string; username: string; display_name: string; email: string; department_id: string | null; note: string;
  status: SignupStatus; reviewed_by: string; reviewed_at: string | null; reason: string; client_ip: string; created_at: string;
  email_verified?: boolean; verify_sent?: boolean;
};
export type VerifyMode = 'off' | 'optional' | 'required';
export type SignupSettings = {
  enabled: boolean; verify_email: VerifyMode; auto_domains: string[]; auto_role: string; auto_department_id: string | null;
  auto_pool_ids: string[]; auto_expires_at: string | null;
};
export type SignupConfig = {
  enabled: boolean; departments: { id: string; name: string; parent_id: string | null }[];
  verify_email?: VerifyMode; auto_domains?: string[]; terms?: { enabled: boolean; version: string };
};
export type SignupInput = { username: string; password: string; display_name: string; email: string; department_id: string | null; note: string; terms_version?: string };
export type SignupAnswer = { request: { id: string; status: string; verify?: 'sent' | 'failed' | 'none'; auto?: boolean } };
export type UsbCategory = 'jtag' | 'security-key' | 'storage' | 'serial' | 'camera' | 'other';
export type UsbDevice = { id: string; name: string; vid: string; pid: string; category: UsbCategory; notes: string; builtin: number; pools: number };
export type UsbInput = { name: string; vid: string; pid: string; category: UsbCategory; notes: string };
export type GatewayKind = 'guacamole' | 'rdpgw' | 'msrdgw';
export type Gateway = {
  id: string; name: string; kind: GatewayKind; address: string; port: number; notes: string; enabled: number;
  last_check: string | null; last_ok: number | null; last_detail: string; external: number; has_key?: boolean;
};
export type GatewayInput = { name: string; kind: GatewayKind; address: string; port: number; notes: string; enabled: boolean; secret_key?: string };
export type ExternalDesktop = { id: string; name: string; address: string; port: number; assigned_user: string | null; gateway_id: string | null; notes: string };
export type ExternalInput = Omit<ExternalDesktop, 'id'>;
export type GoldenVersion = { name: string; description: string; time: number | null };
export type GoldenImage = {
  id: string; cluster_id: string; node: string; vmid: number; name: string; current_version: string; notes: string;
  created_by: string; created_at: string; versions: GoldenVersion[] | null; status: string; pools: string[];
  rollout?: { pool_id: string; pool: string; total: number; outdated: number }[];
};
export type RolloutResult = { replaced: { name: string; old_vmid: number; new_vmid: number; user: string | null; old_deleted: boolean }[];
  skipped: string[]; failed: { name: string; error: string } | null };
// target 'usb': USB-JTAG passthrough to the desktop VM (slot usb4, the desktop runs on the board's node).
// target 'network': the JTAG cable is shared over TCP (Xilinx hw_server / XVC, Intel Quartus jtagd); lending
// records the grant and hands out host:port, the VM config is not touched, any display protocol works.
export type BoardTarget = 'usb' | 'network';
export type BoardProtocol = 'hw_server' | 'xvc' | 'quartus';
export const BOARD_PORTS: Record<BoardProtocol, number> = { hw_server: 3121, xvc: 2542, quartus: 1309 };
// A network board usually sits on a JTAG gateway VM (api/jtag.ts): the gateway's address, the cable's
// serial number (the hw_server target), an optional UART (ser2net port on the gateway).
export type BoardConn = { target: 'network'; protocol: BoardProtocol; host: string; port: number | null; endpoint: string; label: string; howto: string;
  cable_serial?: string; gateway_id?: string; uart?: string; tcl?: string[] };
export type BoardGateway = { id: string; name: string; state: 'up' | 'down' | 'unknown' };
export type Board = {
  id: string; name: string; cluster_id: string; node: string; usb: string; kind: string; notes: string;
  target?: BoardTarget; host?: string; port?: number | null; protocol?: BoardProtocol | ''; label?: string;
  gateway_id?: string; cable_serial?: string; uart_port?: number | null; power?: string;
  attached_desktop: string | null; attached_vmid: number | null; attached_by: string; attached_at: string | null;
  lease_user?: string; lease_until?: string | null;
  desktop: { id: string; name: string; assigned_user: string | null } | null;
  connection?: BoardConn | null; gateway?: BoardGateway | null; available?: boolean;
};
export type BoardInput = { name: string; cluster_id: string; node: string; usb: string; kind: string; notes: string;
  target?: BoardTarget; host?: string; port?: number | null; protocol?: BoardProtocol; label?: string;
  gateway_id?: string; cable_serial?: string; uart_port?: number | null };
// 포털 › 내 자원: a board lent to me (GET /api/vlab/me/boards)
export type MyBoard = { id: string; name: string; kind: string; target: BoardTarget; desktop: { id: string; name: string } | null;
  lease_until: string | null; connection: BoardConn | null; available?: boolean; gateway?: { name: string; state: BoardGateway['state'] } | null };
export type FarmDesktop = { id: string; name: string; status: string; assigned_user: string | null; in_session: boolean; cpu: number; maxcpu?: number; mem: number; maxmem?: number };
export type FarmPool = { id: string; name: string; cluster_id: string; total: number; running: number; in_use: number; free: number; cpu_pct: number; mem_used: number; mem_total: number; desktops: FarmDesktop[];
  gpus_per_vm?: number; gpu_kind?: string; max_minutes?: number; runtime?: Runtime };
export type PortCheck = { port: number; ok: boolean; ms: number; error: string };
export type LicenseServer = {
  id: string; name: string; host: string; ports: number[]; cluster_id: string; vmid: number | null; fixed_mac: string; notes: string;
  last_check: string | null; last_ok: number | null; last_detail: PortCheck[]; vm_status?: string; vm_ha?: boolean;
  watch?: number; alerted_at?: string | null;
  // licence seats (api/licenses.ts): how they are read and the last read
  usage_mode?: 'off' | 'engine' | 'agent'; usage_at?: string | null; usage_ok?: number | null; usage_error?: string; seat_alerted?: Record<string, string>;
};
export type LicenseInput = { name: string; host: string; ports: string; cluster_id: string; vmid: number | null; fixed_mac: string; notes: string; watch: boolean };
export type GrantType = 'user' | 'department' | 'group';
export type Grant = { pool_id?: string; subject_type: GrantType; subject_id: string; include_children: number | boolean };
export type MyPool = { id: string; name: string; type: string; description: string; action: 'claim' | 'shared' | 'other'; desktops: number; free: number; mine: string[];
  environment?: { name: string; kind: 'ai' | 'fpga' | 'npu' | 'general'; highlights: string[] } | null };
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type BuildJob = {
  id: string; pool_id: string; pool: string | null; username: string; name: string; command: string; workdir: string; status: JobStatus;
  desktop_id: string | null; desktop: string | null; pid: number | null; exit_code: number | null; output: string; error: string;
  created_at: string; started_at: string | null; finished_at: string | null;
  // GPU jobs (research.ts): what it asked for, the GPUs it got, why it waits
  gpus?: number; gpu_kind?: string; memory_gb?: number; max_minutes?: number; env?: GpuEnv | null; notify?: Notify;
  gpu_index?: number[]; wait_reason?: WaitReason; gpu_job?: boolean;
  // the result files kept at its end (builds.ts) and where it came from (a CI connection)
  artifacts?: { path: string; size: number }[]; artifacts_kept?: 'nas' | 'workdir' | '';
  source?: { kind?: 'gitlab' | 'jenkins' | 'generic'; link?: string; link_name?: string; repo?: string; ref?: string; commit?: string; url?: string; pipeline?: string } | null;
};
// pool_id '' with gpus > 0: the queue picks any GPU pool granted to the user
export type JobInput = { pool_id: string; name: string; command: string; workdir: string; username?: string } & GpuJobFields;
export type JobPool = { id: string; name: string; workdir?: string; gpus_per_vm?: number; gpu_kind?: string; max_minutes?: number; runtime?: Runtime };
export type CardRow = { card: string; resource_id: string; loans: number; hours: number; users: string[]; active: number; use_pct: number;
  // what the card really did while lent (GPU/NPU samples): average use, hours under the idle threshold or off, hours measured
  util_avg?: number | null; idle_hours?: number; measured_hours?: number; unmeasured_hours?: number };
export type ClientSettings = { latest_version: string; min_version: string; download_url: string; protocol: 'auto' | 'rdp' | 'spice' | 'vnc' };
export type MyExternal = { id: string; name: string; address: string; port: number; notes: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}
const enc = encodeURIComponent;
const A = '/api/vlab/admin';

const realNextApi = {
  departments: async () => (await call<{ departments: Department[] }>('GET', `${A}/departments`)).departments,
  saveDepartment: async (id: string | null, b: { name: string; parent_id: string | null; sort?: number; manager?: string }) =>
    (await call<{ department: Department }>(id ? 'PUT' : 'POST', id ? `${A}/departments/${enc(id)}` : `${A}/departments`, b)).department,
  deleteDepartment: async (id: string) => { await call('DELETE', `${A}/departments/${enc(id)}`); },
  members: async (id: string, children: boolean) =>
    (await call<{ members: Member[] }>('GET', `${A}/departments/${enc(id)}/members${children ? '?children=1' : ''}`)).members,
  setUserDepartment: async (username: string, department_id: string | null) => {
    await call('PUT', `${A}/users/${enc(username)}/department`, { department_id });
  },

  signups: async (status?: SignupStatus) =>
    call<{ signups: Signup[]; pending: number; verify_email?: VerifyMode }>('GET', `${A}/signups${status ? `?status=${status}` : ''}`),
  approveSignup: async (id: string, expires_at?: string | null) => { await call('POST', `${A}/signups/${enc(id)}/approve`, expires_at ? { expires_at } : {}); },
  rejectSignup: async (id: string, reason: string) => { await call('POST', `${A}/signups/${enc(id)}/reject`, { reason }); },
  signupSettings: async () => withDefaults((await call<{ signup: Partial<SignupSettings> }>('GET', `${A}/signup-settings`)).signup),
  saveSignupSettings: async (b: Partial<SignupSettings>) => withDefaults((await call<{ signup: Partial<SignupSettings> }>('PUT', `${A}/signup-settings`, b)).signup),

  usbDevices: async () => (await call<{ devices: UsbDevice[] }>('GET', `${A}/usb-devices`)).devices,
  saveUsbDevice: async (id: string | null, b: UsbInput) =>
    (await call<{ device: UsbDevice }>(id ? 'PUT' : 'POST', id ? `${A}/usb-devices/${enc(id)}` : `${A}/usb-devices`, b)).device,
  deleteUsbDevice: async (id: string) => { await call('DELETE', `${A}/usb-devices/${enc(id)}`); },

  gateways: async () => (await call<{ gateways: Gateway[] }>('GET', `${A}/gateways`)).gateways,
  saveGateway: async (id: string | null, b: GatewayInput) =>
    (await call<{ gateway: Gateway }>(id ? 'PUT' : 'POST', id ? `${A}/gateways/${enc(id)}` : `${A}/gateways`, b)).gateway,
  deleteGateway: async (id: string) => { await call('DELETE', `${A}/gateways/${enc(id)}`); },
  checkGateway: async (id: string) => call<{ gateway: Gateway; ok: boolean; ms: number; error: string }>('POST', `${A}/gateways/${enc(id)}/check`),

  externalDesktops: async () => (await call<{ desktops: ExternalDesktop[] }>('GET', `${A}/external-desktops`)).desktops,
  saveExternal: async (id: string | null, b: ExternalInput) =>
    (await call<{ desktop: ExternalDesktop }>(id ? 'PUT' : 'POST', id ? `${A}/external-desktops/${enc(id)}` : `${A}/external-desktops`, b)).desktop,
  deleteExternal: async (id: string) => { await call('DELETE', `${A}/external-desktops/${enc(id)}`); },

  goldenImages: async () => (await call<{ images: GoldenImage[] }>('GET', `${A}/golden-images`)).images,
  addGolden: async (b: { cluster_id: string; vmid: number; name?: string; notes?: string }) =>
    (await call<{ image: GoldenImage }>('POST', `${A}/golden-images`, b)).image,
  deleteGolden: async (id: string) => { await call('DELETE', `${A}/golden-images/${enc(id)}`); },
  makeVersion: async (id: string, description: string) =>
    call<{ image: GoldenImage; version: string }>('POST', `${A}/golden-images/${enc(id)}/versions`, { description }),
  setCurrentVersion: async (id: string, version: string) => { await call('PUT', `${A}/golden-images/${enc(id)}/current`, { version }); },
  deployGolden: async (id: string, b: { pool_id: string; count: number; name_prefix: string }) =>
    call<{ created: { id: string; vmid: number; name: string }[]; failed: { vmid: number; name: string; error: string } | null }>(
      'POST', `${A}/golden-images/${enc(id)}/deploy`, b),

  boards: async () => (await call<{ boards: Board[] }>('GET', `${A}/boards`)).boards,
  saveBoard: async (id: string | null, b: BoardInput) =>
    (await call<{ board: Board }>(id ? 'PUT' : 'POST', id ? `${A}/boards/${enc(id)}` : `${A}/boards`, b)).board,
  deleteBoard: async (id: string) => { await call('DELETE', `${A}/boards/${enc(id)}`); },
  attachBoard: async (id: string, desktop_id: string) => { await call('POST', `${A}/boards/${enc(id)}/attach`, { desktop_id }); },
  detachBoard: async (id: string) => { await call('POST', `${A}/boards/${enc(id)}/detach`); },

  buildfarm: async () => (await call<{ pools: FarmPool[] }>('GET', `${A}/buildfarm`)).pools,

  licenseServers: async () => (await call<{ servers: LicenseServer[] }>('GET', `${A}/license-servers`)).servers,
  saveLicense: async (id: string | null, b: LicenseInput) =>
    (await call<{ server: LicenseServer }>(id ? 'PUT' : 'POST', id ? `${A}/license-servers/${enc(id)}` : `${A}/license-servers`, b)).server,
  deleteLicense: async (id: string) => { await call('DELETE', `${A}/license-servers/${enc(id)}`); },
  checkLicense: async (id: string) => call<{ server: LicenseServer; ok: boolean }>('POST', `${A}/license-servers/${enc(id)}/check`),

  poolGrants: async (poolId: string) => call<{ grants: Grant[]; max_sessions: number }>('GET', `${A}/pools/${enc(poolId)}/grants`),
  savePoolGrants: async (poolId: string, grants: Grant[], max_sessions?: number) =>
    call<{ grants: Grant[]; max_sessions: number }>('PUT', `${A}/pools/${enc(poolId)}/grants`, max_sessions ? { grants, max_sessions } : { grants }),
  rollout: async (id: string, b: { pool_id: string; delete_old: boolean }) => call<RolloutResult>('POST', `${A}/golden-images/${enc(id)}/rollout`, b),
  attachBoardFor: async (id: string, b: { desktop_id: string; lease_user?: string; lease_until?: string }) => { await call('POST', `${A}/boards/${enc(id)}/attach`, b); },
  buildJobs: async (poolId?: string) => call<{ jobs: BuildJob[]; counts: Record<JobStatus, number> }>('GET', `${A}/build-jobs${poolId ? `?pool_id=${enc(poolId)}` : ''}`),
  submitJob: async (b: JobInput) => (await call<{ job: BuildJob }>('POST', `${A}/build-jobs`, b)).job,
  cancelJob: async (id: string) => { await call('POST', `${A}/build-jobs/${enc(id)}/cancel`); },
  cardReport: async (days: number) => call<{ days: number; cards: CardRow[]; total_hours: number; idle_threshold_pct?: number }>('GET', `${A}/reports/cards?days=${days}`),

  myPools: async () => {
    const { status, data } = await request<{ pools: MyPool[] }>('GET', '/api/vlab/me/pools');
    return status === 200 ? data.pools ?? [] : [];
  },
  claim: async (poolId: string) => call<{ desktop: { id: string; name: string }; new: boolean }>('POST', `/api/vlab/me/pools/${enc(poolId)}/claim`),
  route: async (poolId: string) => call<{ desktop: { id: string; name: string }; sessions: number; limit: number }>('POST', `/api/vlab/me/pools/${enc(poolId)}/route`),
  myExternalGuac: async (id: string) => call<{ url: string }>('GET', `/api/vlab/me/external/${enc(id)}/guac`),
  // pools[].workdir: the user's scratch folder when build jobs start there (each job in <workdir>/<job id>), else ''
  myJobs: async () => call<{ jobs: BuildJob[]; pools: JobPool[] }>('GET', '/api/vlab/me/build-jobs'),
  myBoards: async () => (await call<{ boards: MyBoard[] }>('GET', '/api/vlab/me/boards')).boards,
  mySubmitJob: async (b: JobInput) => (await call<{ job: BuildJob }>('POST', '/api/vlab/me/build-jobs', b)).job,
  myCancelJob: async (id: string) => { await call('POST', `/api/vlab/me/build-jobs/${enc(id)}/cancel`); },

  clientSettings: async () => (await call<{ client: ClientSettings }>('GET', `${A}/client`)).client,
  saveClientSettings: async (b: ClientSettings) => (await call<{ client: ClientSettings }>('PUT', `${A}/client`, b)).client,

  // the portal and the sign-in screen
  myExternal: async () => {
    const { status, data } = await request<{ desktops: MyExternal[] }>('GET', '/api/vlab/me/external');
    return status === 200 ? data.desktops ?? [] : [];
  },
  myExternalRdp: async (id: string) => call<{ filename: string; rdp: string }>('GET', `/api/vlab/me/external/${enc(id)}/rdp`),
  signupConfig: async (): Promise<SignupConfig> => {
    try {
      const { status, data } = await request<SignupConfig>('GET', '/api/vlab/signup/config');
      return status === 200 ? data : { enabled: false, departments: [] };
    } catch { return { enabled: false, departments: [] }; }
  },
  signup: async (b: SignupInput) => call<SignupAnswer>('POST', '/api/vlab/signup', b),
};

// an engine before the mail check answers {enabled} only
function withDefaults(s: Partial<SignupSettings>): SignupSettings {
  return { enabled: !!s.enabled, verify_email: s.verify_email ?? 'off', auto_domains: s.auto_domains ?? [], auto_role: s.auto_role ?? 'user',
    auto_department_id: s.auto_department_id ?? null, auto_pool_ids: s.auto_pool_ids ?? [], auto_expires_at: s.auto_expires_at ?? null };
}

export type NextApi = typeof realNextApi;

// --- mock mode -------------------------------------------------------------------------------

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(forProfile(v)), 120));
const fail = (status: number, msg: string) => Promise.reject(new ApiError(status, msg));
let seq = 100;
const nid = (p: string) => `${p}_${++seq}`;
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString().slice(0, 19);

const deps: Department[] = [
  { id: 'dep_eng', name: '공과대학', parent_id: null, sort: 0, members: 0, created_at: iso(9000) },
  { id: 'dep_ee', name: '전자공학과', parent_id: 'dep_eng', sort: 0, members: 0, created_at: iso(9000) },
  { id: 'dep_cs', name: '컴퓨터공학과', parent_id: 'dep_eng', sort: 1, members: 0, created_at: iso(9000) },
  { id: 'dep_lab', name: 'FPGA 설계 연구실', parent_id: 'dep_ee', sort: 0, members: 0, created_at: iso(8000), manager: 'admin' },
  { id: 'dep_rnd', name: '연구개발본부', parent_id: null, sort: 1, members: 0, created_at: iso(8000) },
];
const memberOf: Record<string, string> = { alice: 'dep_lab', bob: 'dep_cs', carol: 'dep_rnd', dave: 'dep_ee' };
export { memberOf as mockMemberOf };   // the user list's 부서 (api/users.ts)
// accounts' last day of use (api/users.ts, api/accounts.ts)
export const mockExpiry: Record<string, string> = { bob: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), olduser: '2026-08-31' };
export const mockNextDeps = () => deps;
const signupSettings: SignupSettings = { enabled: true, verify_email: 'optional', auto_domains: [], auto_role: 'user', auto_department_id: null, auto_pool_ids: [], auto_expires_at: null };
const signups: Signup[] = [
  { id: 'sig_1', username: 'kim.minji', display_name: '김민지', email: 'minji@univ.ac.kr', department_id: 'dep_cs', note: '데이터베이스 실습 수강생',
    status: 'pending', reviewed_by: '', reviewed_at: null, reason: '', client_ip: '10.20.1.33', created_at: iso(42), email_verified: true, verify_sent: true },
  { id: 'sig_2', username: 'lee.junho', display_name: '이준호', email: 'junho@gmail.com', department_id: 'dep_lab', note: 'FPGA 연구실 신입 연구원',
    status: 'pending', reviewed_by: '', reviewed_at: null, reason: '', client_ip: '10.20.4.12', created_at: iso(180), email_verified: false, verify_sent: true },
  { id: 'sig_3', username: 'park.sora', display_name: '박소라', email: 'sora@univ.ac.kr', department_id: 'dep_ee', note: '',
    status: 'approved', reviewed_by: 'admin', reviewed_at: iso(1500), reason: '', client_ip: '10.20.2.7', created_at: iso(1600) },
  { id: 'sig_4', username: 'guest01', display_name: '외부인', email: 'guest@mail.com', department_id: null, note: '',
    status: 'rejected', reviewed_by: 'admin', reviewed_at: iso(3000), reason: '소속 확인 불가', client_ip: '203.0.113.5', created_at: iso(3100) },
];
const usb: UsbDevice[] = [
  { id: 'usb_1', name: 'FPGA 플랫폼 케이블 (USB JTAG)', vid: '03fd', pid: '0008', category: 'jtag', notes: '벤더 03fd · 실물로 PID 확인', builtin: 1, pools: 2 },
  { id: 'usb_2', name: 'FTDI 기반 JTAG (보드 내장)', vid: '0403', pid: '', category: 'jtag', notes: 'VID 0403 전체 · 보드마다 PID가 다름', builtin: 1, pools: 1 },
  { id: 'usb_3', name: 'Digilent JTAG', vid: '1443', pid: '', category: 'jtag', notes: 'VID 1443 전체', builtin: 1, pools: 0 },
  { id: 'usb_4', name: 'YubiKey 5 NFC', vid: '1050', pid: '0407', category: 'security-key', notes: '연구 보안 구역 로그인용', builtin: 0, pools: 1 },
];
const gateways: Gateway[] = [
  { id: 'gw_1', name: '외부망 RDP 게이트웨이', kind: 'rdpgw', address: 'rdgw.univ.ac.kr', port: 443, notes: '재택 · 출장 접속', enabled: 1,
    last_check: iso(12), last_ok: 1, last_detail: '18 ms', external: 2 },
  { id: 'gw_2', name: '브라우저 RDP (Guacamole)', kind: 'guacamole', address: 'guac.univ.ac.kr', port: 8443, notes: '설치 없는 RDP', enabled: 1,
    last_check: iso(60), last_ok: 1, last_detail: '9 ms', external: 0, has_key: true },
];
const external: ExternalDesktop[] = [
  { id: 'ext_1', name: '측정실 PC (오실로스코프)', address: '10.30.5.21', port: 3389, assigned_user: 'alice', gateway_id: 'gw_1', notes: '계측 장비 연결 PC' },
  { id: 'ext_2', name: '설계실 워크스테이션 3', address: '10.30.6.13', port: 3389, assigned_user: 'bob', gateway_id: 'gw_1', notes: '' },
  { id: 'ext_3', name: '전산실 서버 콘솔', address: '10.30.1.5', port: 3389, assigned_user: null, gateway_id: null, notes: '배정 대기' },
];
const golden: GoldenImage[] = [
  { id: 'gold_1', cluster_id: 'c1', node: 'pve1', vmid: 9001, name: 'win11-실습-골든', current_version: 'gold-20261010-090000', notes: 'Windows 11 · Office · Python',
    created_by: 'admin', created_at: iso(20000), status: 'stopped', pools: ['공용 LAB A', '교육장 A 수업용'],
    versions: [{ name: 'gold-20261010-090000', description: '10월 보안 패치', time: Date.now() / 1000 - 6 * 86400 },
               { name: 'gold-20260901-090000', description: '2학기 시작 버전', time: Date.now() / 1000 - 45 * 86400 }] },
  { id: 'gold_2', cluster_id: 'c1', node: 'pve2', vmid: 9002, name: 'ubuntu-fpga-빌드', current_version: 'gold-20261002-140000', notes: 'Vivado 도구는 NFS /tools 마운트',
    created_by: 'admin', created_at: iso(15000), status: 'running', pools: ['FPGA 빌드 팜'],
    versions: [{ name: 'gold-20261002-140000', description: 'PetaLinux 추가', time: Date.now() / 1000 - 14 * 86400 }] },
  { id: 'gold_3', cluster_id: 'lab-cluster', node: 'pve2', vmid: 9003, name: 'ubuntu-ai-pytorch', current_version: 'gold-20261012-100000', notes: 'CUDA 12.4 · PyTorch · Jupyter',
    created_by: 'admin', created_at: iso(12000), status: 'running', pools: ['LLM 실습 (A100 MIG)'],
    versions: [{ name: 'gold-20261012-100000', description: 'PyTorch 2.4 · CUDA 12.4', time: Date.now() / 1000 - 4 * 86400 }] },
  { id: 'gold_4', cluster_id: 'lab-cluster', node: 'pve3', vmid: 9004, name: 'ubuntu-npu-sdk', current_version: 'gold-20261005-110000', notes: 'Rebellions · FuriosaAI SDK',
    created_by: 'admin', created_at: iso(9000), status: 'stopped', pools: [],
    versions: [{ name: 'gold-20261005-110000', description: 'RBLN SDK 0.5', time: Date.now() / 1000 - 11 * 86400 }] },
];
const boards: Board[] = [
  { id: 'brd_1', name: 'ZCU102 #1', cluster_id: 'c1', node: 'pve1', usb: '03fd:0008', kind: 'ZCU102', notes: '랙 A-3', attached_desktop: 'd2', attached_vmid: 302,
    attached_by: 'admin', attached_at: iso(300), desktop: { id: 'd2', name: 'board-lab-zcu102', assigned_user: 'alice' } },
  { id: 'brd_2', name: 'VCK190 #1', cluster_id: 'c1', node: 'pve2', usb: '1-4.2', kind: 'VCK190', notes: '포트 경로로 지정 (같은 케이블 여러 개)', attached_desktop: null,
    attached_vmid: null, attached_by: '', attached_at: null, desktop: null },
  { id: 'brd_3', name: 'Kria KV260 #2', cluster_id: 'c1', node: 'pve1', usb: '0403:6011', kind: 'KV260', notes: '', attached_desktop: null,
    attached_vmid: null, attached_by: '', attached_at: null, desktop: null },
  { id: 'brd_4', name: 'VCU118 (hw_server)', cluster_id: 'c1', node: '', usb: '', kind: 'VCU118', notes: '', target: 'network',
    host: '', port: null, protocol: 'hw_server', label: '랙 B-2 · 케이블 1', gateway_id: 'jgw_1', cable_serial: '210251A08870', uart_port: 7001,
    attached_desktop: 'd2', attached_vmid: 302, attached_by: 'admin', attached_at: iso(120),
    desktop: { id: 'd2', name: 'board-lab-zcu102', assigned_user: 'alice' } },
  { id: 'brd_5', name: 'Agilex 7 (jtagd)', cluster_id: 'c1', node: '', usb: '', kind: 'Agilex 7', notes: '', target: 'network',
    host: '', port: null, protocol: 'quartus', label: '', gateway_id: 'jgw_1', cable_serial: 'USB-BlasterII-1', attached_desktop: null,
    attached_vmid: null, attached_by: '', attached_at: null, desktop: null },
  { id: 'brd_6', name: 'ZCU104 #2', cluster_id: 'c1', node: '', usb: '', kind: 'ZCU104', notes: '', target: 'network',
    host: '', port: null, protocol: 'hw_server', label: '랙 C-1', gateway_id: 'jgw_2', cable_serial: '210308FF0001', attached_desktop: null,
    attached_vmid: null, attached_by: '', attached_at: null, desktop: null },
];
mockLinkBoards((gid) => boards.filter((b) => b.gateway_id === gid).map((b) => ({ id: b.id, name: b.name, cable_serial: b.cable_serial ?? '',
  protocol: b.protocol || 'hw_server', lent: !!b.attached_desktop })));
// what the engine's _board_conn answers (pegaprox/api/vlab_next.py)
const gwOf = (b: Board) => (b.gateway_id ? mockGateways.find((g) => g.id === b.gateway_id) : undefined);
function mockView(b: Board): Board {
  const g = gwOf(b);
  return { ...b, connection: mockConn(b), gateway: g ? { id: g.id, name: g.name, state: g.state } : null, available: g?.state !== 'down' };
}
function mockConn(b: Board): BoardConn | null {
  if (b.target !== 'network') return null;
  const protocol = (b.protocol || 'hw_server') as BoardProtocol;
  const g = gwOf(b);
  const host = g ? g.host : b.host ?? '';
  const port = g ? (protocol === 'xvc' ? b.port ?? null : protocol === 'quartus' ? g.jtagd_port : g.hw_port) : b.port ?? null;
  if (!host) return null;
  const endpoint = port ? `${host}:${port}` : host;
  const serial = b.cable_serial ?? '';
  const tcl = protocol === 'hw_server' ? [`connect_hw_server -url ${endpoint}`, serial ? `open_hw_target [lindex [get_hw_targets */${serial}] 0]` : 'open_hw_target']
    : protocol === 'xvc' ? ['connect_hw_server', `open_hw_target -xvc_url ${endpoint}`] : [`jtagconfig --addserver ${host} <password>`, 'jtagconfig'];
  const extra = { cable_serial: serial, gateway_id: b.gateway_id ?? '', uart: b.uart_port && host ? `${host}:${b.uart_port}` : '', tcl };
  return { ...mockConnBase({ ...b, host, port }, protocol, endpoint), ...extra };
}
function mockConnBase(b: Board, protocol: BoardProtocol, endpoint: string): BoardConn {
  const howto = {
    hw_server: `Vivado Hardware Manager > Open Target > Open New Target > Remote server: ${endpoint} (hw_server). Or: connect_hw_server -url ${endpoint}`,
    xvc: `Vivado Hardware Manager > Open New Target > Add Xilinx Virtual Cable (XVC): ${endpoint}. Or: open_hw_target -xvc_url ${endpoint}`,
    quartus: `Quartus Programmer > Hardware Setup > JTAG Settings > Add Server: ${b.host} (jtagd ${endpoint}). Or: jtagconfig --addserver ${b.host} <password>  (the cable host ran jtagconfig --enableremote).`,
  }[protocol];
  return { target: 'network', protocol, host: b.host ?? '', port: b.port ?? null, endpoint, label: b.label ?? '', howto };
}
const GB = 1024 ** 3;
const farm: FarmPool[] = [
  { id: 'p_farm', name: 'FPGA 빌드 팜', cluster_id: 'c1', total: 6, running: 5, in_use: 4, free: 2, cpu_pct: 63.5, mem_used: 312 * GB, mem_total: 384 * GB,
    desktops: [
      { id: 'b1', name: 'vivado-build-01', status: 'running', assigned_user: 'alice', in_session: true, cpu: 92.1, maxcpu: 16, mem: 58 * GB, maxmem: 64 * GB },
      { id: 'b2', name: 'vivado-build-02', status: 'running', assigned_user: 'dave', in_session: false, cpu: 78.4, maxcpu: 16, mem: 61 * GB, maxmem: 64 * GB },
      { id: 'b3', name: 'vivado-build-03', status: 'running', assigned_user: 'carol', in_session: true, cpu: 55.0, maxcpu: 16, mem: 49 * GB, maxmem: 64 * GB },
      { id: 'b4', name: 'vivado-build-04', status: 'running', assigned_user: null, in_session: true, cpu: 61.2, maxcpu: 16, mem: 52 * GB, maxmem: 64 * GB },
      { id: 'b5', name: 'vivado-build-05', status: 'running', assigned_user: null, in_session: false, cpu: 30.8, maxcpu: 16, mem: 92 * GB, maxmem: 64 * GB },
      { id: 'b6', name: 'vivado-build-06', status: 'stopped', assigned_user: null, in_session: false, cpu: 0, maxcpu: 16, mem: 0, maxmem: 64 * GB },
    ], gpus_per_vm: 0, gpu_kind: '', max_minutes: 0, runtime: 'docker' },
  { id: 'p_gpu', name: 'A100 학습 팜', cluster_id: 'c1', total: 3, running: 3, in_use: 0, free: 3, cpu_pct: 71.2, mem_used: 610 * GB, mem_total: 768 * GB,
    desktops: [
      { id: 'gb1', name: 'gpu-build-01', status: 'running', assigned_user: null, in_session: false, cpu: 88.0, maxcpu: 32, mem: 230 * GB, maxmem: 256 * GB },
      { id: 'gb2', name: 'gpu-build-02', status: 'running', assigned_user: null, in_session: false, cpu: 74.5, maxcpu: 32, mem: 180 * GB, maxmem: 256 * GB },
      { id: 'gb3', name: 'gpu-build-03', status: 'running', assigned_user: null, in_session: false, cpu: 51.0, maxcpu: 32, mem: 200 * GB, maxmem: 256 * GB },
    ], gpus_per_vm: 4, gpu_kind: 'A100', max_minutes: 2880, runtime: 'docker' },
  { id: 'p_l40', name: 'L40S 추론 팜', cluster_id: 'c1', total: 2, running: 2, in_use: 0, free: 2, cpu_pct: 22.4, mem_used: 90 * GB, mem_total: 256 * GB,
    desktops: [
      { id: 'lb1', name: 'l40s-01', status: 'running', assigned_user: null, in_session: false, cpu: 20.0, maxcpu: 16, mem: 45 * GB, maxmem: 128 * GB },
      { id: 'lb2', name: 'l40s-02', status: 'running', assigned_user: null, in_session: false, cpu: 24.8, maxcpu: 16, mem: 45 * GB, maxmem: 128 * GB },
    ], gpus_per_vm: 2, gpu_kind: 'L40S', max_minutes: 720, runtime: 'apptainer' },
];
const licenses: LicenseServer[] = [
  { id: 'lic_1', name: 'FPGA 설계 툴 라이선스 (FlexLM)', host: 'lic01.univ.ac.kr', ports: [2100, 27000], cluster_id: 'lab-cluster', vmid: 210, fixed_mac: '52:54:00:1a:2b:3c',
    notes: 'Proxmox HA 등록 · MAC 고정', last_check: iso(5), last_ok: 1, usage_mode: 'agent', usage_at: iso(3), usage_ok: 1, usage_error: '', seat_alerted: {},
    last_detail: [{ port: 2100, ok: true, ms: 3, error: '' }, { port: 27000, ok: true, ms: 2, error: '' }], vm_status: 'running', vm_ha: true },
  { id: 'lic_2', name: 'NVIDIA vGPU 라이선스 (DLS)', host: 'dls.univ.ac.kr', ports: [443], cluster_id: '', vmid: null, fixed_mac: '',
    notes: '', last_check: iso(30), last_ok: 0, last_detail: [{ port: 443, ok: false, ms: 2001, error: 'timed out' }] },
  { id: 'lic_3', name: 'EDA 툴 라이선스 (Cadence)', host: 'lic02.univ.ac.kr', ports: [5280], cluster_id: 'lab-cluster', vmid: 220, fixed_mac: '52:54:00:4d:5e:6f',
    notes: 'MAC 고정', last_check: iso(5), last_ok: 1, usage_mode: 'engine', usage_at: iso(3), usage_ok: 1, usage_error: '', seat_alerted: {}, last_detail: [{ port: 5280, ok: true, ms: 4, error: '' }], vm_status: 'running', vm_ha: false },
];
let client: ClientSettings = { latest_version: '0.9.0', min_version: '0.9.0', download_url: '', protocol: 'auto' };
const grants: Record<string, Grant[]> = {
  pool_1: [{ subject_type: 'department', subject_id: 'dep_cs', include_children: true }, { subject_type: 'group', subject_id: 'CN=Lab-Users,OU=Groups,DC=univ,DC=ac,DC=kr', include_children: true }],
};
const maxSessions: Record<string, number> = {};
const myPools: MyPool[] = [
  { id: 'p_res', name: '연구원 전용 VM', type: 'dedicated', description: '신규 연구원용 Windows 11', action: 'claim', desktops: 12, free: 4, mine: [] },
  { id: 'p_term', name: '공용 리눅스 서버', type: 'shared', description: 'EDA 툴 · 터미널 서버', action: 'shared', desktops: 3, free: 3, mine: [] },
  { id: 'p_llm', name: 'LLM 실습 (A100 MIG)', type: 'dedicated', description: 'A100 3g.40gb 한 조각씩', action: 'claim', desktops: 4, free: 2, mine: [],
    environment: { name: 'ubuntu-ai-pytorch', kind: 'ai', highlights: ['CUDA 12.4', 'PyTorch 2.4.1+cu124', 'NVIDIA driver 550.127.05'] } },
];
const jobs: BuildJob[] = [
  { id: 'job_g1', pool_id: 'p_gpu', pool: 'A100 학습 팜', username: 'alice', name: 'llama-7b LoRA', command: 'torchrun --nproc_per_node 4 train.py', workdir: '/nas/scratch/alice/job_g1',
    status: 'running', desktop_id: 'gb1', desktop: 'gpu-build-01', pid: 5001, exit_code: null, output: '', error: '', created_at: iso(190), started_at: iso(185), finished_at: null,
    gpus: 4, gpu_kind: 'A100', memory_gb: 200, max_minutes: 1440, env: { kind: 'container', image: 'nvcr.io/nvidia/pytorch:24.08-py3' }, notify: { mail: true }, gpu_index: [0, 1, 2, 3], gpu_job: true },
  { id: 'job_g5', pool_id: '', pool: null, username: 'alice', name: 'ablation #2', command: 'python train.py --abl 2', workdir: '', status: 'queued', desktop_id: null, desktop: null,
    pid: null, exit_code: null, output: '', error: '', created_at: iso(40), started_at: null, finished_at: null,
    gpus: 1, gpu_kind: '', memory_gb: 32, max_minutes: 240, env: { kind: 'conda', name: 'torch24' }, notify: { mail: true, webhook: true }, gpu_index: [], wait_reason: 'quota_gpus', gpu_job: true },
  { id: 'job_1', pool_id: 'p_farm', pool: 'FPGA 빌드 팜', username: 'alice', name: 'zcu102 비트스트림', command: 'make bit', workdir: '/proj/zcu102', status: 'running',
    desktop_id: 'b4', desktop: 'vivado-build-04', pid: 4242, exit_code: null, output: '', error: '', created_at: iso(48), started_at: iso(47), finished_at: null },
  { id: 'job_2', pool_id: 'p_farm', pool: 'FPGA 빌드 팜', username: 'dave', name: 'vck190 합성', command: 'vivado -mode batch -source synth.tcl', workdir: '/proj/vck190',
    status: 'queued', desktop_id: null, desktop: null, pid: null, exit_code: null, output: '', error: '', created_at: iso(20), started_at: null, finished_at: null },
  { id: 'job_ci1', pool_id: 'p_farm', pool: 'FPGA 빌드 팜', username: 'alice', name: 'FPGA팀 GitLab main a1b2c3d4', command: 'make -C ~/src/zcu102 bit',
    workdir: '/nas/scratch/alice/job_ci1', status: 'done', desktop_id: 'b2', desktop: 'vivado-build-02', pid: 4180, exit_code: 0,
    output: 'write_bitstream completed successfully\nWNS 0.142 ns, TNS 0.000 ns', error: '', created_at: iso(95), started_at: iso(94), finished_at: iso(52),
    artifacts: [{ path: 'build/zcu102_top.bit', size: 26_543_104 }, { path: 'build/zcu102_top.ltx', size: 412_331 },
      { path: 'reports/timing_summary.rpt', size: 1_204_210 }, { path: 'vivado.log', size: 3_812_004 }], artifacts_kept: 'nas',
    source: { kind: 'gitlab', link: 'ci-1', link_name: 'FPGA팀 GitLab', repo: 'fpga/zcu102-top', ref: 'main', commit: 'a1b2c3d4e5f60718', pipeline: '9812',
      url: 'https://gitlab.lab.example/fpga/zcu102-top/-/pipelines/9812' } },
  { id: 'job_3', pool_id: 'p_farm', pool: 'FPGA 빌드 팜', username: 'alice', name: '시뮬레이션 회귀', command: 'make sim', workdir: '/proj/zcu102', status: 'done',
    desktop_id: 'b5', desktop: 'vivado-build-05', pid: 4100, exit_code: 0, output: 'INFO: 128 tests passed\nsimulation finished in 41m 12s', error: '',
    created_at: iso(300), started_at: iso(299), finished_at: iso(258),
    artifacts: [{ path: 'sim/regress_summary.rpt', size: 88_120 }, { path: 'sim/xsim.log', size: 2_412_009 }], artifacts_kept: 'workdir' },
  { id: 'job_4', pool_id: 'p_farm', pool: 'FPGA 빌드 팜', username: 'carol', name: 'kv260 타이밍', command: 'make timing', workdir: '/proj/kv260', status: 'failed',
    desktop_id: 'b3', desktop: 'vivado-build-03', pid: 4011, exit_code: 2, output: 'ERROR: [Timing 38-282] The design failed to meet the timing requirements.', error: '',
    created_at: iso(600), started_at: iso(599), finished_at: iso(540) },
];
const cards: CardRow[] = [
  // FPGA cards report no use figure (no vendor tool is read for them): only the hours their desktop was off count as idle
  { card: 'Alveo U250 #1', resource_id: 'alveo-u250-1', loans: 9, hours: 412.5, users: ['alice', 'dave', 'kim.minji'], active: 1, use_pct: 57.3,
    util_avg: null, idle_hours: 96.5, measured_hours: 0, unmeasured_hours: 316.0 },
  { card: 'Alveo U55C #1', resource_id: 'alveo-u55c-1', loans: 6, hours: 298.0, users: ['carol', 'park.sora'], active: 1, use_pct: 41.4,
    util_avg: null, idle_hours: 41.0, measured_hours: 0, unmeasured_hours: 257.0 },
  { card: 'RNGD #1 (FuriosaAI)', resource_id: 'rngd-1', loans: 4, hours: 156.2, users: ['bob', 'lee.junho'], active: 0, use_pct: 21.7,
    util_avg: 38.4, idle_hours: 61.3, measured_hours: 150.1, unmeasured_hours: 0 },
  { card: 'NVIDIA L40S #2', resource_id: 'l40s-2', loans: 11, hours: 520.8, users: ['alice', 'bob', 'carol', 'dave'], active: 1, use_pct: 72.3,
    util_avg: 64.2, idle_hours: 88.0, measured_hours: 508.3, unmeasured_hours: 4.2 },
  { card: 'ATOM+ #1 (Rebellions)', resource_id: 'atom-1', loans: 2, hours: 38.0, users: ['lee.junho'], active: 0, use_pct: 5.3,
    util_avg: 3.1, idle_hours: 35.5, measured_hours: 38.0, unmeasured_hours: 0 },
];
golden[0].rollout = [{ pool_id: 'p1', pool: '공용 LAB A', total: 12, outdated: 5 }, { pool_id: 'p_c', pool: '교육장 A 수업용', total: 30, outdated: 0 }];
golden[1].rollout = [{ pool_id: 'p_farm', pool: 'FPGA 빌드 팜', total: 6, outdated: 2 }];
boards[0].lease_user = 'alice'; boards[0].lease_until = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);
licenses[0].watch = 1; licenses[1].watch = 1; licenses[1].alerted_at = iso(30);

const counts = () => deps.map((d) => ({ ...d, members: Object.values(memberOf).filter((x) => x === d.id).length }));
const under = (id: string) => { const out = new Set([id]); let grew = true; while (grew) { grew = false; for (const d of deps) if (d.parent_id && out.has(d.parent_id) && !out.has(d.id)) { out.add(d.id); grew = true; } } return out; };

const mockNextApi: NextApi = {
  departments: () => delay(counts()),
  saveDepartment: (id, b) => {
    if (!b.name.trim()) return fail(400, 'name is required');
    if (id) { const d = deps.find((x) => x.id === id); if (!d) return fail(404, 'Department not found');
      if (b.parent_id && under(id).has(b.parent_id)) return fail(400, 'A department cannot move under itself');
      Object.assign(d, { name: b.name, parent_id: b.parent_id }, b.manager !== undefined ? { manager: b.manager } : {}); return delay({ ...d }); }
    const d = { id: nid('dep'), name: b.name, parent_id: b.parent_id, sort: b.sort ?? 0, members: 0, created_at: iso(0), manager: b.manager ?? '' };
    deps.push(d); return delay({ ...d });
  },
  deleteDepartment: (id) => {
    if (under(id).size > 1) return fail(409, 'Move or delete its sub-departments first');
    const i = deps.findIndex((d) => d.id === id); if (i >= 0) deps.splice(i, 1);
    for (const u of Object.keys(memberOf)) if (memberOf[u] === id) delete memberOf[u];
    return delay(undefined);
  },
  members: (id, children) => {
    const ids = children ? under(id) : new Set([id]);
    return delay(Object.entries(memberOf).filter(([, d]) => ids.has(d)).map(([username, department_id]) => ({ username, department_id })));
  },
  setUserDepartment: (u, d) => { if (d) memberOf[u] = d; else delete memberOf[u]; return delay(undefined); },

  signups: (status) => delay({ signups: signups.filter((s) => !status || s.status === status).map((s) => ({ ...s })), pending: signups.filter((s) => s.status === 'pending').length }),
  approveSignup: (id, expires_at) => {
    const s = signups.find((x) => x.id === id); if (!s) return fail(404, 'Request not found');
    if (s.status !== 'pending') return fail(409, `This request is already ${s.status}`);
    Object.assign(s, { status: 'approved', reviewed_by: 'admin', reviewed_at: iso(0) });
    if (s.department_id) memberOf[s.username] = s.department_id;
    if (expires_at) mockExpiry[s.username] = expires_at;
    return delay(undefined);
  },
  rejectSignup: (id, reason) => {
    const s = signups.find((x) => x.id === id); if (!s) return fail(404, 'Request not found');
    Object.assign(s, { status: 'rejected', reviewed_by: 'admin', reviewed_at: iso(0), reason }); return delay(undefined);
  },
  signupSettings: () => delay({ ...signupSettings }),
  saveSignupSettings: (b) => {
    if (b.auto_role === 'admin') return fail(400, 'role: admin accounts are made one by one');
    const bad = (b.auto_domains ?? []).find((d) => !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d));
    if (bad) return fail(400, `auto_domains: "${bad}" is not a domain`);
    Object.assign(signupSettings, b);
    return delay({ ...signupSettings });
  },

  usbDevices: () => delay(usb.map((d) => ({ ...d }))),
  saveUsbDevice: (id, b) => {
    if (!/^[0-9a-f]{4}$/.test(b.vid)) return fail(400, 'vid must be 4 hex digits');
    if (b.pid && !/^[0-9a-f]{4}$/.test(b.pid)) return fail(400, 'pid must be 4 hex digits, or empty');
    if (usb.some((d) => d.vid === b.vid && d.pid === b.pid && d.id !== id)) return fail(409, `${b.vid}:${b.pid || '*'} is already in the library`);
    if (id) { const d = usb.find((x) => x.id === id)!; Object.assign(d, b); return delay({ ...d }); }
    const d: UsbDevice = { id: nid('usb'), ...b, builtin: 0, pools: 0 }; usb.push(d); return delay({ ...d });
  },
  deleteUsbDevice: (id) => {
    const d = usb.find((x) => x.id === id); if (d?.pools) return fail(409, 'Pools still use this device in their USB policy');
    usb.splice(usb.findIndex((x) => x.id === id), 1); return delay(undefined);
  },

  gateways: () => delay(gateways.map((g) => ({ ...g, external: external.filter((e) => e.gateway_id === g.id).length }))),
  saveGateway: (id, b) => {
    const { secret_key, ...rest } = b;
    if (secret_key && (b.kind !== 'guacamole' || !/^[0-9a-f]{32}$/.test(secret_key))) return fail(400, 'secret_key: 32 hex digits, Guacamole only');
    if (id) { const g = gateways.find((x) => x.id === id)!; Object.assign(g, { ...rest, enabled: b.enabled ? 1 : 0 }, secret_key ? { has_key: true } : {}); return delay({ ...g }); }
    const g: Gateway = { id: nid('gw'), ...rest, enabled: b.enabled ? 1 : 0, last_check: null, last_ok: null, last_detail: '', external: 0, has_key: !!secret_key };
    gateways.push(g); return delay({ ...g });
  },
  deleteGateway: (id) => { gateways.splice(gateways.findIndex((x) => x.id === id), 1); external.forEach((e) => { if (e.gateway_id === id) e.gateway_id = null; }); return delay(undefined); },
  checkGateway: (id) => {
    const g = gateways.find((x) => x.id === id)!; const ok = g.kind !== 'guacamole';
    Object.assign(g, { last_check: iso(0), last_ok: ok ? 1 : 0, last_detail: ok ? '16 ms' : 'Connection refused' });
    return delay({ gateway: { ...g }, ok, ms: ok ? 16 : 2001, error: ok ? '' : 'Connection refused' });
  },

  externalDesktops: () => delay(external.map((e) => ({ ...e }))),
  saveExternal: (id, b) => {
    if (id) { const e = external.find((x) => x.id === id)!; Object.assign(e, b); return delay({ ...e }); }
    const e = { id: nid('ext'), ...b }; external.push(e); return delay({ ...e });
  },
  deleteExternal: (id) => { external.splice(external.findIndex((x) => x.id === id), 1); return delay(undefined); },

  goldenImages: () => delay(golden.map((g) => ({ ...g, versions: g.versions ? [...g.versions] : null }))),
  addGolden: (b) => {
    if (golden.some((g) => g.vmid === b.vmid)) return fail(409, 'This VM is already a golden image');
    const g: GoldenImage = { id: nid('gold'), cluster_id: b.cluster_id, node: 'pve1', vmid: b.vmid, name: b.name || `vm-${b.vmid}`, current_version: '',
      notes: b.notes ?? '', created_by: 'admin', created_at: iso(0), versions: [], status: 'stopped', pools: [] };
    golden.push(g); return delay({ ...g });
  },
  deleteGolden: (id) => { golden.splice(golden.findIndex((x) => x.id === id), 1); return delay(undefined); },
  makeVersion: (id, description) => {
    const g = golden.find((x) => x.id === id)!; const d = new Date();
    const name = `gold-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toTimeString().slice(0, 8).replace(/:/g, '')}`;
    g.versions = [{ name, description, time: Date.now() / 1000 }, ...(g.versions ?? [])]; g.current_version = name;
    return delay({ image: { ...g }, version: name });
  },
  setCurrentVersion: (id, version) => { const g = golden.find((x) => x.id === id)!; g.current_version = version; return delay(undefined); },
  deployGolden: (id, b) => {
    const g = golden.find((x) => x.id === id)!;
    if (!g.current_version) return fail(409, 'Make a version of the image first');
    const created = Array.from({ length: b.count }, (_, i) => ({ id: nid('d'), vmid: 1100 + i, name: `${b.name_prefix}-${String(i + 1).padStart(2, '0')}` }));
    return delay({ created, failed: null });
  },

  boards: () => delay(boards.map(mockView)),
  saveBoard: (id, input) => {
    let b: BoardInput = { ...input, target: input.target ?? 'usb' };
    if (b.target === 'network' && b.gateway_id) {
      const protocol = b.protocol ?? 'hw_server';
      const serial = (b.cable_serial ?? '').trim();
      if (protocol === 'hw_server' && !serial) return fail(400, 'cable_serial: hw_server serves every cable of the gateway - say which one is this board');
      const port = protocol === 'xvc' ? b.port || BOARD_PORTS.xvc : null;
      const twin = boards.find((o) => o.id !== id && o.gateway_id === b.gateway_id && ((serial && o.cable_serial === serial) || (port && o.protocol === 'xvc' && o.port === port)
        || (b.uart_port && o.uart_port === b.uart_port)));
      if (twin) return fail(400, `cable_serial: that cable or port is board '${twin.name}' already - one cable, one board`);
      b = { ...b, protocol, port, host: '', cable_serial: serial, usb: '', node: '' };
    } else if (b.target === 'network') {
      if (!b.host || !/^[A-Za-z0-9._-]+$/.test(b.host)) return fail(400, 'host: the cable host MOAVI Desk VMs reach over the network (or pick a JTAG gateway)');
      const protocol = b.protocol ?? 'hw_server';
      const port = b.port || BOARD_PORTS[protocol];
      if (!(port >= 1 && port <= 65535)) return fail(400, 'port: 1-65535');
      b = { ...b, protocol, port, gateway_id: '', usb: '', node: '' };
    } else {
      if (!/^([0-9a-f]{4}:[0-9a-f]{4}|\d+-\d+(\.\d+)*)$/.test(b.usb)) return fail(400, 'usb: vendor:product (03fd:0008) or a port path (1-2.3)');
      b = { ...b, host: '', port: null, protocol: undefined, label: '', gateway_id: '', cable_serial: '', uart_port: null };
    }
    const withConn = mockView;
    if (id) { const x = boards.find((y) => y.id === id)!; Object.assign(x, b, { protocol: b.protocol ?? '' }); return delay(withConn(x)); }
    const x: Board = { id: nid('brd'), ...b, protocol: b.protocol ?? '', attached_desktop: null, attached_vmid: null, attached_by: '', attached_at: null, desktop: null };
    boards.push(x); return delay(withConn(x));
  },
  deleteBoard: (id) => {
    const x = boards.find((y) => y.id === id); if (x?.attached_desktop) return fail(409, 'Detach the board first');
    boards.splice(boards.findIndex((y) => y.id === id), 1); return delay(undefined);
  },
  attachBoard: (id, desktop_id) => {
    const x = boards.find((y) => y.id === id)!;
    Object.assign(x, { attached_desktop: desktop_id, attached_vmid: 300, attached_by: 'admin', attached_at: iso(0), desktop: { id: desktop_id, name: 'lab-win11-01', assigned_user: 'bob' } });
    return delay(undefined);
  },
  detachBoard: (id) => {
    Object.assign(boards.find((y) => y.id === id)!, { attached_desktop: null, attached_vmid: null, attached_by: '', attached_at: null, desktop: null });
    return delay(undefined);
  },

  buildfarm: () => delay(farm.map((p) => ({ ...p, desktops: p.desktops.map((d) => ({ ...d })) }))),

  // vm_ha follows the mock HA set of api/ops.ts (클러스터 > 고가용성, 라이선스 서버 > HA 등록)
  licenseServers: () => delay(licenses.map((l) => ({ ...l, ...(l.cluster_id === 'lab-cluster' && l.vmid ? { vm_ha: mockHaVmids.has(l.vmid) } : {}) }))),
  saveLicense: (id, b) => {
    const ports = b.ports.split(/[\s,]+/).filter(Boolean).map(Number);
    if (!ports.length || ports.some((p) => !(p >= 1 && p <= 65535))) return fail(400, 'ports: 1 to 10 port numbers');
    const row = { name: b.name, host: b.host, ports: [...new Set(ports)].sort((a, c) => a - c), cluster_id: b.cluster_id, vmid: b.vmid, fixed_mac: b.fixed_mac, notes: b.notes, watch: b.watch ? 1 : 0 };
    if (id) { const l = licenses.find((x) => x.id === id)!; Object.assign(l, row); return delay({ ...l }); }
    const l: LicenseServer = { id: nid('lic'), ...row, last_check: null, last_ok: null, last_detail: [] }; licenses.push(l); return delay({ ...l });
  },
  deleteLicense: (id) => { licenses.splice(licenses.findIndex((x) => x.id === id), 1); return delay(undefined); },
  checkLicense: (id) => {
    const l = licenses.find((x) => x.id === id)!; const ok = l.id === 'lic_1';
    Object.assign(l, { last_check: iso(0), last_ok: ok ? 1 : 0, last_detail: l.ports.map((port) => ({ port, ok, ms: ok ? 3 : 2001, error: ok ? '' : 'timed out' })) });
    return delay({ server: { ...l }, ok });
  },

  poolGrants: (poolId) => delay({ grants: [...(grants[poolId] ?? [])], max_sessions: maxSessions[poolId] ?? 10 }),
  savePoolGrants: (poolId, g, ms) => { grants[poolId] = [...g]; if (ms) maxSessions[poolId] = ms; return delay({ grants: [...g], max_sessions: maxSessions[poolId] ?? 10 }); },
  rollout: (id, b) => {
    const g = golden.find((x) => x.id === id)!; const row = g.rollout?.find((r) => r.pool_id === b.pool_id);
    const n = row?.outdated ?? 0; if (row) row.outdated = 0;
    return delay({ replaced: Array.from({ length: n }, (_, i) => ({ name: `lab-a-${String(i + 1).padStart(2, '0')}`, old_vmid: 300 + i, new_vmid: 1200 + i, user: i % 2 ? 'bob' : 'alice', old_deleted: b.delete_old })),
      skipped: n ? ['lab-a-07'] : [], failed: null });
  },
  attachBoardFor: (id, b) => {
    const x = boards.find((y) => y.id === id)!;
    const g = gwOf(x);
    if (g?.state === 'down') return fail(409, `The JTAG gateway ${g.name} is down (VM stopped or hw_server not answering) - the board cannot be lent now`);
    Object.assign(x, { attached_desktop: b.desktop_id, attached_vmid: 300, attached_by: 'admin', attached_at: iso(0), lease_user: b.lease_user ?? '', lease_until: b.lease_until ?? null,
      desktop: { id: b.desktop_id, name: 'lab-win11-01', assigned_user: b.lease_user || 'bob' } });
    return delay(undefined);
  },
  buildJobs: (poolId) => {
    const list = jobs.filter((j) => !poolId || j.pool_id === poolId).map((j) => ({ ...j }));
    const counts = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 } as Record<JobStatus, number>;
    list.forEach((j) => { counts[j.status] += 1; });
    return delay({ jobs: list, counts });
  },
  submitJob: (b) => {
    const j: BuildJob = { id: nid('job'), pool_id: b.pool_id, pool: 'FPGA 빌드 팜', username: b.username || 'admin', name: b.name, command: b.command, workdir: b.workdir,
      status: 'queued', desktop_id: null, desktop: null, pid: null, exit_code: null, output: '', error: '', created_at: iso(0), started_at: null, finished_at: null };
    jobs.unshift(j); return delay({ ...j });
  },
  cancelJob: (id) => {
    const j = jobs.find((x) => x.id === id)!; if (j.status !== 'queued') return fail(409, 'Only a queued job can be cancelled');
    Object.assign(j, { status: 'cancelled', finished_at: iso(0) }); return delay(undefined);
  },
  cardReport: (days) => {
    const k = (h?: number) => Math.round((h ?? 0) * days / 30 * 10) / 10;
    return delay({ days, idle_threshold_pct: 5, total_hours: Math.round(cards.reduce((a, c) => a + c.hours, 0) * days / 30),
      cards: cards.map((c) => ({ ...c, hours: k(c.hours), idle_hours: k(c.idle_hours), measured_hours: k(c.measured_hours), unmeasured_hours: k(c.unmeasured_hours) })) });
  },

  myPools: () => delay(myPools.map((p) => ({ ...p }))),
  claim: (poolId) => {
    const p = myPools.find((x) => x.id === poolId)!; if (p.free < 1) return fail(409, 'FULL');
    p.free -= 1; p.mine = ['d_claimed']; return delay({ desktop: { id: 'd_claimed', name: 'research-win11-05' }, new: true });
  },
  route: () => delay({ desktop: { id: 'd1', name: 'eda-server-02' }, sessions: 3, limit: 10 }),
  myExternalGuac: () => delay({ url: 'https://guac.univ.ac.kr:8443/guacamole/?data=mock' }),
  myBoards: () => delay(boards.filter((b) => b.attached_desktop && (b.lease_user || b.desktop?.assigned_user) === 'alice').map((b) => ({
    id: b.id, name: b.name, kind: b.kind, target: b.target ?? 'usb', desktop: b.desktop ? { id: b.desktop.id, name: b.desktop.name } : null,
    lease_until: b.lease_until ?? null, connection: mockConn(b), available: mockView(b).available,
    gateway: gwOf(b) ? { name: gwOf(b)!.name, state: gwOf(b)!.state } : null }))),
  myJobs: () => delay({ jobs: jobs.filter((j) => j.username === 'alice').map((j) => ({ ...j })), pools: [{ id: 'p_farm', name: 'FPGA 빌드 팜', workdir: '/nas/scratch/alice', gpus_per_vm: 0 },
    { id: 'p_gpu', name: 'A100 학습 팜', workdir: '/nas/scratch/alice', gpus_per_vm: 4, gpu_kind: 'A100', max_minutes: 2880, runtime: 'docker' }] }),
  mySubmitJob: (b) => {
    const id = nid('job');
    if (b.gpus && b.gpus > 4) return fail(409, 'No GPU build pool you may use has that many GPUs of that kind');
    const gpu = !!b.gpus;
    const j: BuildJob = { id, pool_id: b.pool_id || (gpu ? 'p_gpu' : ''), pool: gpu ? 'A100 학습 팜' : 'FPGA 빌드 팜', username: 'alice', name: b.name, command: b.command, workdir: b.workdir || `/nas/scratch/alice/${id}`,
      status: gpu ? 'running' : 'queued', desktop_id: gpu ? 'gb3' : null, desktop: gpu ? 'gpu-build-03' : null, pid: gpu ? 5100 : null, exit_code: null, output: '', error: '',
      created_at: iso(0), started_at: gpu ? iso(0) : null, finished_at: null,
      ...(gpu ? { gpus: b.gpus, gpu_kind: b.gpu_kind ?? '', memory_gb: b.memory_gb ?? 0, max_minutes: b.max_minutes ?? 1440, env: b.env ?? null, notify: b.notify ?? {},
        gpu_index: Array.from({ length: b.gpus! }, (_, i) => i), gpu_job: true } : {}) };
    jobs.unshift(j); return delay({ ...j });
  },
  myCancelJob: (id) => { const j = jobs.find((x) => x.id === id)!; Object.assign(j, { status: 'cancelled', finished_at: iso(0) }); return delay(undefined); },

  clientSettings: () => delay({ ...client }),
  saveClientSettings: (b) => {
    for (const k of ['latest_version', 'min_version'] as const) if (b[k] && !/^\d+(\.\d+){0,3}$/.test(b[k])) return fail(400, `${k} must look like 1.2.3`);
    if (b.download_url && !/^https?:\/\//.test(b.download_url)) return fail(400, 'download_url must start with http:// or https://');
    client = { ...b }; return delay({ ...client });
  },

  myExternal: () => delay(external.filter((e) => e.assigned_user === 'alice').map(({ id, name, address, port, notes }) => ({ id, name, address, port, notes }))),
  myExternalRdp: (id) => {
    const e = external.find((x) => x.id === id); if (!e) return fail(404, 'External desktop not found');
    return delay({ filename: `${e.name.replace(/[^A-Za-z0-9._-]+/g, '-') || 'desktop'}.rdp`, rdp: `full address:s:${e.address}:${e.port}\r\nusername:s:alice\r\n` });
  },
  signupConfig: () => delay(signupSettings.enabled
    ? { enabled: true, departments: deps.map(({ id, name, parent_id }) => ({ id, name, parent_id })), verify_email: signupSettings.verify_email,
        auto_domains: [...signupSettings.auto_domains], terms: { enabled: true, version: '2026-09' } }
    : { enabled: false, departments: [] }),
  signup: (b) => {
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(b.username)) return fail(400, 'username: 3-32 lower-case letters, digits, ".", "_" or "-"');
    if (b.password.length < 8) return fail(400, 'Password must be at least 8 characters');
    if (signupSettings.verify_email === 'required' && !b.email) return fail(400, 'email: a mail address is needed to check it');
    if (!b.terms_version) return fail(400, 'Agree to the terms of use and the privacy policy');
    if (signups.some((s) => s.username === b.username && s.status === 'pending')) return fail(409, 'This username is taken or already waiting for review');
    const { terms_version: _tv, ...rest } = b;
    void _tv;
    const auto = !!b.email && signupSettings.auto_domains.some((d) => b.email.toLowerCase().endsWith('@' + d) || b.email.toLowerCase().endsWith('.' + d));
    const verify = b.email && (signupSettings.verify_email !== 'off' || auto) ? 'sent' as const : 'none' as const;
    const s: Signup = { id: nid('sig'), ...rest, status: 'pending', reviewed_by: '', reviewed_at: null, reason: '', client_ip: '127.0.0.1', created_at: iso(0),
      email_verified: false, verify_sent: verify === 'sent' };
    signups.unshift(s); return delay({ request: { id: s.id, status: 'pending', verify, auto } });
  },
};

// the mail check in mock mode (api/accounts.ts): code 123456
export const mockSignupState = { signups, settings: signupSettings };

export const nextApi: NextApi = isMock ? mockNextApi : realNextApi;
export { licenses as mockLicenses };   // the seat settings of the mock servers (api/licenses.ts)

