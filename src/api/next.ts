// Next-phase screens: departments, sign-up review, USB library, gateways, external desktops,
// golden images, board lab, build farm, licence servers (makus-vlab pegaprox/api/vlab_next.py),
// and the Windows client settings (pegaprox/api/vlab.py /api/vlab/admin/client).
import { ApiError, isMock, request } from './client';

export type Department = { id: string; name: string; parent_id: string | null; sort: number; members: number; created_at: string };
export type Member = { username: string; department_id: string };
export type SignupStatus = 'pending' | 'approved' | 'rejected';
export type Signup = {
  id: string; username: string; display_name: string; email: string; department_id: string | null; note: string;
  status: SignupStatus; reviewed_by: string; reviewed_at: string | null; reason: string; client_ip: string; created_at: string;
};
export type UsbCategory = 'jtag' | 'security-key' | 'storage' | 'serial' | 'camera' | 'other';
export type UsbDevice = { id: string; name: string; vid: string; pid: string; category: UsbCategory; notes: string; builtin: number; pools: number };
export type UsbInput = { name: string; vid: string; pid: string; category: UsbCategory; notes: string };
export type GatewayKind = 'guacamole' | 'rdpgw' | 'msrdgw';
export type Gateway = {
  id: string; name: string; kind: GatewayKind; address: string; port: number; notes: string; enabled: number;
  last_check: string | null; last_ok: number | null; last_detail: string; external: number;
};
export type GatewayInput = { name: string; kind: GatewayKind; address: string; port: number; notes: string; enabled: boolean };
export type ExternalDesktop = { id: string; name: string; address: string; port: number; assigned_user: string | null; gateway_id: string | null; notes: string };
export type ExternalInput = Omit<ExternalDesktop, 'id'>;
export type GoldenVersion = { name: string; description: string; time: number | null };
export type GoldenImage = {
  id: string; cluster_id: string; node: string; vmid: number; name: string; current_version: string; notes: string;
  created_by: string; created_at: string; versions: GoldenVersion[] | null; status: string; pools: string[];
};
export type Board = {
  id: string; name: string; cluster_id: string; node: string; usb: string; kind: string; notes: string;
  attached_desktop: string | null; attached_vmid: number | null; attached_by: string; attached_at: string | null;
  desktop: { id: string; name: string; assigned_user: string | null } | null;
};
export type BoardInput = { name: string; cluster_id: string; node: string; usb: string; kind: string; notes: string };
export type FarmDesktop = { id: string; name: string; status: string; assigned_user: string | null; in_session: boolean; cpu: number; maxcpu?: number; mem: number; maxmem?: number };
export type FarmPool = { id: string; name: string; cluster_id: string; total: number; running: number; in_use: number; free: number; cpu_pct: number; mem_used: number; mem_total: number; desktops: FarmDesktop[] };
export type PortCheck = { port: number; ok: boolean; ms: number; error: string };
export type LicenseServer = {
  id: string; name: string; host: string; ports: number[]; cluster_id: string; vmid: number | null; fixed_mac: string; notes: string;
  last_check: string | null; last_ok: number | null; last_detail: PortCheck[]; vm_status?: string; vm_ha?: boolean;
};
export type LicenseInput = { name: string; host: string; ports: string; cluster_id: string; vmid: number | null; fixed_mac: string; notes: string };
export type ClientSettings = { latest_version: string; min_version: string; download_url: string; protocol: 'auto' | 'spice' | 'vnc' };
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
  saveDepartment: async (id: string | null, b: { name: string; parent_id: string | null; sort?: number }) =>
    (await call<{ department: Department }>(id ? 'PUT' : 'POST', id ? `${A}/departments/${enc(id)}` : `${A}/departments`, b)).department,
  deleteDepartment: async (id: string) => { await call('DELETE', `${A}/departments/${enc(id)}`); },
  members: async (id: string, children: boolean) =>
    (await call<{ members: Member[] }>('GET', `${A}/departments/${enc(id)}/members${children ? '?children=1' : ''}`)).members,
  setUserDepartment: async (username: string, department_id: string | null) => {
    await call('PUT', `${A}/users/${enc(username)}/department`, { department_id });
  },

  signups: async (status?: SignupStatus) =>
    call<{ signups: Signup[]; pending: number }>('GET', `${A}/signups${status ? `?status=${status}` : ''}`),
  approveSignup: async (id: string) => { await call('POST', `${A}/signups/${enc(id)}/approve`); },
  rejectSignup: async (id: string, reason: string) => { await call('POST', `${A}/signups/${enc(id)}/reject`, { reason }); },
  signupSettings: async () => (await call<{ signup: { enabled: boolean } }>('GET', `${A}/signup-settings`)).signup,
  saveSignupSettings: async (enabled: boolean) => (await call<{ signup: { enabled: boolean } }>('PUT', `${A}/signup-settings`, { enabled })).signup,

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

  clientSettings: async () => (await call<{ client: ClientSettings }>('GET', `${A}/client`)).client,
  saveClientSettings: async (b: ClientSettings) => (await call<{ client: ClientSettings }>('PUT', `${A}/client`, b)).client,

  // the portal and the sign-in screen
  myExternal: async () => {
    const { status, data } = await request<{ desktops: MyExternal[] }>('GET', '/api/vlab/me/external');
    return status === 200 ? data.desktops ?? [] : [];
  },
  myExternalRdp: async (id: string) => call<{ filename: string; rdp: string }>('GET', `/api/vlab/me/external/${enc(id)}/rdp`),
  signupConfig: async () => {
    try {
      const { status, data } = await request<{ enabled: boolean; departments: { id: string; name: string; parent_id: string | null }[] }>('GET', '/api/vlab/signup/config');
      return status === 200 ? data : { enabled: false, departments: [] };
    } catch { return { enabled: false, departments: [] }; }
  },
  signup: async (b: { username: string; password: string; display_name: string; email: string; department_id: string | null; note: string }) =>
    call<{ request: { id: string; status: string } }>('POST', '/api/vlab/signup', b),
};

export type NextApi = typeof realNextApi;

// --- mock mode -------------------------------------------------------------------------------

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));
const fail = (status: number, msg: string) => Promise.reject(new ApiError(status, msg));
let seq = 100;
const nid = (p: string) => `${p}_${++seq}`;
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString().slice(0, 19);

const deps: Department[] = [
  { id: 'dep_eng', name: '공과대학', parent_id: null, sort: 0, members: 0, created_at: iso(9000) },
  { id: 'dep_ee', name: '전자공학과', parent_id: 'dep_eng', sort: 0, members: 0, created_at: iso(9000) },
  { id: 'dep_cs', name: '컴퓨터공학과', parent_id: 'dep_eng', sort: 1, members: 0, created_at: iso(9000) },
  { id: 'dep_lab', name: 'FPGA 설계 연구실', parent_id: 'dep_ee', sort: 0, members: 0, created_at: iso(8000) },
  { id: 'dep_rnd', name: '연구개발본부', parent_id: null, sort: 1, members: 0, created_at: iso(8000) },
];
const memberOf: Record<string, string> = { alice: 'dep_lab', bob: 'dep_cs', carol: 'dep_rnd', dave: 'dep_ee' };
let signupOpen = true;
const signups: Signup[] = [
  { id: 'sig_1', username: 'kim.minji', display_name: '김민지', email: 'minji@univ.ac.kr', department_id: 'dep_cs', note: '데이터베이스 실습 수강생',
    status: 'pending', reviewed_by: '', reviewed_at: null, reason: '', client_ip: '10.20.1.33', created_at: iso(42) },
  { id: 'sig_2', username: 'lee.junho', display_name: '이준호', email: 'junho@univ.ac.kr', department_id: 'dep_lab', note: 'FPGA 연구실 신입 연구원',
    status: 'pending', reviewed_by: '', reviewed_at: null, reason: '', client_ip: '10.20.4.12', created_at: iso(180) },
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
  { id: 'gw_2', name: '브라우저 RDP (Guacamole)', kind: 'guacamole', address: 'guac.univ.ac.kr', port: 8080, notes: '설치 없는 RDP', enabled: 1,
    last_check: iso(60), last_ok: 0, last_detail: 'Connection refused', external: 0 },
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
];
const boards: Board[] = [
  { id: 'brd_1', name: 'ZCU102 #1', cluster_id: 'c1', node: 'pve1', usb: '03fd:0008', kind: 'ZCU102', notes: '랙 A-3', attached_desktop: 'd2', attached_vmid: 302,
    attached_by: 'admin', attached_at: iso(300), desktop: { id: 'd2', name: 'board-lab-zcu102', assigned_user: 'alice' } },
  { id: 'brd_2', name: 'VCK190 #1', cluster_id: 'c1', node: 'pve2', usb: '1-4.2', kind: 'VCK190', notes: '포트 경로로 지정 (같은 케이블 여러 개)', attached_desktop: null,
    attached_vmid: null, attached_by: '', attached_at: null, desktop: null },
  { id: 'brd_3', name: 'Kria KV260 #2', cluster_id: 'c1', node: 'pve1', usb: '0403:6011', kind: 'KV260', notes: '', attached_desktop: null,
    attached_vmid: null, attached_by: '', attached_at: null, desktop: null },
];
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
    ] },
];
const licenses: LicenseServer[] = [
  { id: 'lic_1', name: 'FPGA 설계 툴 라이선스 (FlexLM)', host: 'lic01.univ.ac.kr', ports: [2100, 27000], cluster_id: 'c1', vmid: 210, fixed_mac: '52:54:00:1a:2b:3c',
    notes: 'Proxmox HA 등록 · MAC 고정', last_check: iso(5), last_ok: 1,
    last_detail: [{ port: 2100, ok: true, ms: 3, error: '' }, { port: 27000, ok: true, ms: 2, error: '' }], vm_status: 'running', vm_ha: true },
  { id: 'lic_2', name: 'NVIDIA vGPU 라이선스 (DLS)', host: 'dls.univ.ac.kr', ports: [443], cluster_id: '', vmid: null, fixed_mac: '',
    notes: '', last_check: iso(30), last_ok: 0, last_detail: [{ port: 443, ok: false, ms: 2001, error: 'timed out' }] },
];
let client: ClientSettings = { latest_version: '0.9.0', min_version: '0.9.0', download_url: '', protocol: 'auto' };

const counts = () => deps.map((d) => ({ ...d, members: Object.values(memberOf).filter((x) => x === d.id).length }));
const under = (id: string) => { const out = new Set([id]); let grew = true; while (grew) { grew = false; for (const d of deps) if (d.parent_id && out.has(d.parent_id) && !out.has(d.id)) { out.add(d.id); grew = true; } } return out; };

const mockNextApi: NextApi = {
  departments: () => delay(counts()),
  saveDepartment: (id, b) => {
    if (!b.name.trim()) return fail(400, 'name is required');
    if (id) { const d = deps.find((x) => x.id === id); if (!d) return fail(404, 'Department not found');
      if (b.parent_id && under(id).has(b.parent_id)) return fail(400, 'A department cannot move under itself');
      Object.assign(d, { name: b.name, parent_id: b.parent_id }); return delay({ ...d }); }
    const d = { id: nid('dep'), name: b.name, parent_id: b.parent_id, sort: b.sort ?? 0, members: 0, created_at: iso(0) };
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
  approveSignup: (id) => {
    const s = signups.find((x) => x.id === id); if (!s) return fail(404, 'Request not found');
    if (s.status !== 'pending') return fail(409, `This request is already ${s.status}`);
    Object.assign(s, { status: 'approved', reviewed_by: 'admin', reviewed_at: iso(0) });
    if (s.department_id) memberOf[s.username] = s.department_id;
    return delay(undefined);
  },
  rejectSignup: (id, reason) => {
    const s = signups.find((x) => x.id === id); if (!s) return fail(404, 'Request not found');
    Object.assign(s, { status: 'rejected', reviewed_by: 'admin', reviewed_at: iso(0), reason }); return delay(undefined);
  },
  signupSettings: () => delay({ enabled: signupOpen }),
  saveSignupSettings: (enabled) => { signupOpen = enabled; return delay({ enabled }); },

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
    if (id) { const g = gateways.find((x) => x.id === id)!; Object.assign(g, { ...b, enabled: b.enabled ? 1 : 0 }); return delay({ ...g }); }
    const g: Gateway = { id: nid('gw'), ...b, enabled: b.enabled ? 1 : 0, last_check: null, last_ok: null, last_detail: '', external: 0 };
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

  boards: () => delay(boards.map((b) => ({ ...b }))),
  saveBoard: (id, b) => {
    if (!/^([0-9a-f]{4}:[0-9a-f]{4}|\d+-\d+(\.\d+)*)$/.test(b.usb)) return fail(400, 'usb: vendor:product (03fd:0008) or a port path (1-2.3)');
    if (id) { const x = boards.find((y) => y.id === id)!; Object.assign(x, b); return delay({ ...x }); }
    const x: Board = { id: nid('brd'), ...b, attached_desktop: null, attached_vmid: null, attached_by: '', attached_at: null, desktop: null };
    boards.push(x); return delay({ ...x });
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

  licenseServers: () => delay(licenses.map((l) => ({ ...l }))),
  saveLicense: (id, b) => {
    const ports = b.ports.split(/[\s,]+/).filter(Boolean).map(Number);
    if (!ports.length || ports.some((p) => !(p >= 1 && p <= 65535))) return fail(400, 'ports: 1 to 10 port numbers');
    const row = { name: b.name, host: b.host, ports: [...new Set(ports)].sort((a, c) => a - c), cluster_id: b.cluster_id, vmid: b.vmid, fixed_mac: b.fixed_mac, notes: b.notes };
    if (id) { const l = licenses.find((x) => x.id === id)!; Object.assign(l, row); return delay({ ...l }); }
    const l: LicenseServer = { id: nid('lic'), ...row, last_check: null, last_ok: null, last_detail: [] }; licenses.push(l); return delay({ ...l });
  },
  deleteLicense: (id) => { licenses.splice(licenses.findIndex((x) => x.id === id), 1); return delay(undefined); },
  checkLicense: (id) => {
    const l = licenses.find((x) => x.id === id)!; const ok = l.id === 'lic_1';
    Object.assign(l, { last_check: iso(0), last_ok: ok ? 1 : 0, last_detail: l.ports.map((port) => ({ port, ok, ms: ok ? 3 : 2001, error: ok ? '' : 'timed out' })) });
    return delay({ server: { ...l }, ok });
  },

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
  signupConfig: () => delay({ enabled: signupOpen, departments: signupOpen ? deps.map(({ id, name, parent_id }) => ({ id, name, parent_id })) : [] }),
  signup: (b) => {
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(b.username)) return fail(400, 'username: 3-32 lower-case letters, digits, ".", "_" or "-"');
    if (b.password.length < 8) return fail(400, 'Password must be at least 8 characters');
    if (signups.some((s) => s.username === b.username && s.status === 'pending')) return fail(409, 'This username is taken or already waiting for review');
    const s: Signup = { id: nid('sig'), ...b, status: 'pending', reviewed_by: '', reviewed_at: null, reason: '', client_ip: '127.0.0.1', created_at: iso(0) };
    signups.unshift(s); return delay({ request: { id: s.id, status: 'pending' } });
  },
};

export const nextApi: NextApi = isMock ? mockNextApi : realNextApi;
