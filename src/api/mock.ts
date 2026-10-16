// Fake engine for `npm run dev:mock`: lets the screens run without vlab-engine.
import { ApiError, type Api } from './client';
import type { AuthStatus, Branding, Desktop, Lease, Notice, User, KioskInfo } from './types';

// Kept in sessionStorage so a page reload stays signed in, like the real session cookie.
const KEY = 'vlab.mock.user';
function load(): User | null {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}
function save(u: User | null) {
  try { u ? sessionStorage.setItem(KEY, JSON.stringify(u)) : sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
let current: User | null = load();
// ?fresh on the URL plays a first start: no administrator yet, the setup form shows
const params = new URLSearchParams(location.search);
let initialized = !params.has('fresh');
// ?as=<user>[&name=<display name>] signs straight in (demos and README screenshots; mock only)
if (params.get('as')) {
  const as = params.get('as')!;
  current = { username: as, role: as === 'admin' ? 'admin' : 'user', display_name: params.get('name') || as, auth_source: 'local' };
  save(current);
}
let setupAdmin = '';
// accounts that must pick a new password at the next sign-in (사용자 목록, api/users.ts); 'newbie' to try it
export const mockMustChange = new Set<string>(['newbie']);
export const mockWhoAmI = () => current?.username ?? '';

const desktops: Desktop[] = [
  { id: 'd1', name: 'vivado-build-01', pool: 'FPGA 빌드 팜', state: 'ready', os: 'Rocky Linux 9', spec: { cpu: 16, memory_gb: 64 }, protocols: ['spice', 'vnc'], resources: [{ kind: 'card', name: 'Alveo U250 #2' }], pool_type: 'buildfarm', last_connected: new Date(Date.now() - 3 * 864e5).toISOString() },
  { id: 'd2', name: 'board-lab-zcu102', pool: '보드 LAB', state: 'in_use', os: 'Ubuntu 22.04', spec: { cpu: 8, memory_gb: 32 }, protocols: ['spice', 'vnc'], resources: [{ kind: 'usb', name: 'JTAG ZCU102 #1' }], pool_type: 'dedicated', last_connected: new Date(Date.now() - 2 * 36e5).toISOString() },
  { id: 'd4', name: 'ai-ws-03', pool: 'AI 연구실', state: 'ready', os: 'Windows 11', spec: { cpu: 8, memory_gb: 32 }, protocols: ['spice', 'vnc', 'rdp', 'guac'], gpu: { mode: 'vgpu', label: 'A16-4Q' }, pool_type: 'dedicated', last_connected: new Date(Date.now() - 26 * 36e5).toISOString() },
  { id: 'd3', name: 'lab-win11-07', pool: '공용 LAB A', state: 'stopped', os: 'Windows 11', spec: { cpu: 4, memory_gb: 8 }, protocols: ['vnc', 'spice'], pool_type: 'reset', last_connected: null, policy: { clipboard: 'to_desktop', allow_power: false, start_on_connect: true } },
];

const leases: Lease[] = [
  { id: 'l1', kind: 'card', name: 'Alveo U250 #2', ends_at: '2026-10-31T18:00:00+09:00' },
  { id: 'l2', kind: 'usb', name: 'JTAG ZCU102 #1', ends_at: '2026-10-20T18:00:00+09:00' },
];

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));

// the white label, shared with the admin mock (운영 > 화이트라벨)
export const mockBranding: Branding = {
  enabled: false, appName: 'MOAVI Desk', browserTitle: '', logoUrl: '', loginLogoUrl: '', faviconUrl: '',
  primaryColor: '', footerText: '', loginTagline: '', docsUrl: '', supportUrl: '', hideVersion: false,
};

// notices, shared with the admin mock (플랫폼 설정 > 공지): one running for everyone, one for
// administrators, one that starts tomorrow
const inHours = (h: number) => new Date(Date.now() + h * 36e5).toISOString().slice(0, 19) + 'Z';
export const mockNotices: Notice[] = [
  { id: 'a1b2c3d4e5f60718', text: '이번 주 토요일 02:00~06:00 정기 점검으로 데스크톱 접속이 중단됩니다. 작업 중인 파일을 미리 저장하세요.',
    severity: 'warning', audience: 'all', starts_at: null, expires_at: inHours(72), rev: 1, state: 'running',
    created_at: inHours(-2), created_by: 'admin', updated_at: inHours(-2), updated_by: 'admin' },
  { id: '0f1e2d3c4b5a6978', text: '새 골든 이미지(Windows 11 24H2) 배포가 끝났습니다. 강의실 풀은 다음 수업부터 적용됩니다.',
    severity: 'info', audience: 'admins', starts_at: null, expires_at: null, rev: 1, state: 'running',
    created_at: inHours(-30), created_by: 'admin', updated_at: inHours(-30), updated_by: 'admin' },
  { id: '9988776655443322', text: '다음 주부터 외부망 접속은 RDP 게이트웨이로만 됩니다.',
    severity: 'info', audience: 'all', starts_at: inHours(24), expires_at: inHours(24 * 8), rev: 1, state: 'scheduled',
    created_at: inHours(-1), created_by: 'admin', updated_at: inHours(-1), updated_by: 'admin' },
];

export function noticeState(n: Pick<Notice, 'starts_at' | 'expires_at'>, now = Date.now()): Notice['state'] {
  if (n.expires_at && new Date(n.expires_at).getTime() <= now) return 'ended';
  if (n.starts_at && new Date(n.starts_at).getTime() > now) return 'scheduled';
  return 'running';
}

// the kiosk in mock mode: room 교육장 A, a session running now
function mockKioskInfo(): KioskInfo {
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  // local wall-clock text, as the engine sends it
  const at = (h: number, m = 0) => { const x = new Date(now); x.setHours(h, m, 0, 0); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}T${p2(x.getHours())}:${p2(x.getMinutes())}`; };
  const h = now.getHours();
  return {
    terminal: { id: 'term_a4', name: 'A-PC-04' }, lab: { id: 'lab_a', name: '교육장 A', location: '본관 3층 301호' },
    current: { schedule_id: 'sch_1', pool_id: 'pool_c', pool: '교육장 A 수업용', title: '파이썬 데이터 분석', start: at(h), end: at(h + 2), preparing: false },
    next: { schedule_id: 'sch_2', pool_id: 'pool_c', pool: '교육장 A 수업용', title: 'FPGA 설계 기초', start: at(h + 3), end: at(h + 5) },
    now: at(now.getHours(), now.getMinutes()),
  };
}

export const mockApi: Api = {
  async branding() { return delay({ ...mockBranding }); },
  async authStatus(): Promise<AuthStatus> {
    return delay(current ? { authenticated: true, user: current } : { authenticated: false, initialized, ldap_enabled: initialized, oidc_enabled: false });
  },
  async login(username, password, opts = {}) {
    if (!username || !password) return delay({ kind: 'error' as const, reason: 'invalid' as const });
    if (username === 'otp' && !opts.totp) return delay({ kind: 'second_factor' as const, methods: ['totp'] });
    current = { username, role: username === 'admin' || username === setupAdmin ? 'admin' : 'user', display_name: username, auth_source: 'local' };
    save(current);
    return delay({ kind: 'ok' as const, user: current, mustChange: mockMustChange.has(username) });
  },
  async setup(u) {
    if (initialized) throw new ApiError(409, 'Already initialised');
    if (u.password.length < 8) throw new ApiError(400, 'Password must be at least 8 characters');
    initialized = true;
    setupAdmin = u.username;
    await delay(undefined);
  },
  async logout() { current = null; save(null); },
  async myDesktops() { return delay(desktops); },
  async clientConfig() {
    return delay({ latest_version: '0.9.0', min_version: '', download_url: '', protocol: 'auto', support_url: 'https://support.makussystems.co.kr/' });
  },
  async myLeases() { return delay(leases); },
  async notices() {
    const admin = current?.role === 'admin';
    const order = { critical: 0, warning: 1, info: 2 };
    return delay(mockNotices.filter((n) => noticeState(n) === 'running' && (n.audience === 'all' || admin))
      .sort((a, b) => order[a.severity] - order[b.severity])
      .map((n) => ({ id: n.id, text: n.text, severity: n.severity, rev: n.rev, expires_at: n.expires_at })));
  },
  async kiosk(key) {
    if (!key.startsWith('mdt_')) throw new ApiError(401, 'BAD_KEY');
    return delay(mockKioskInfo());
  },
  async kioskStart(key) {
    if (!key.startsWith('mdt_')) throw new ApiError(401, 'BAD_KEY');
    if (!current) throw new ApiError(401, 'Sign in first');
    let d = desktops.find((x) => x.id === 'k1');
    if (!d) {
      d = { id: 'k1', name: 'class-win11-04', pool: '교육장 A 수업용', state: 'ready', os: 'Windows 11', spec: { cpu: 4, memory_gb: 8 },
        protocols: ['vnc', 'spice'], pool_type: 'classroom', last_connected: null };
      desktops.push(d);
    }
    return delay({ ...mockKioskInfo(), desktop: { id: d.id, name: d.name } });
  },

  async connect(desktopId, protocol) {
    const d = desktops.find((x) => x.id === desktopId);
    if (!d) throw new ApiError(404, 'Desktop not found');
    if (d.state === 'stopped') {
      if (d.policy?.start_on_connect === false) throw new ApiError(409, 'VM_STOPPED');
      setTimeout(() => { d.state = 'ready'; }, 2500);   // the mock desktop comes up
      throw new ApiError(409, 'STARTING');
    }
    if (protocol === 'rdp') {
      return delay({ type: 'rdp' as const, filename: `${d.name}.rdp`, session_id: 'mock-sess', rdp: 'full address:s:10.20.3.41:3389\r\nusername:s:alice\r\n' });
    }
    if (protocol === 'guac') {
      return delay({ type: 'guac' as const, session_id: 'mock-sess', url: 'https://guac.univ.ac.kr:8443/guacamole/?data=mock' });
    }
    if (protocol === 'spice') {
      return delay({ type: 'spice' as const, filename: `${d.name}.vv`, session_id: 'mock-sess',
        vv: '[virt-viewer]\ntype=spice\nhost=mock.invalid\npassword=mock\nproxy=http://mock.invalid:3128\n' });
    }
    // nothing answers this websocket in mock mode: the console shows "disconnected"
    return delay({ type: 'vnc' as const, ws_path: '/api/mock/vncwebsocket', password: 'mock', session_id: 'mock-sess', clipboard: d.policy?.clipboard ?? 'both' });
  },
  async endSession() { /* nothing to close */ },
  async power(desktopId, action) {
    const d = desktops.find((x) => x.id === desktopId);
    if (!d) throw new ApiError(404, 'Desktop not found');
    d.state = action === 'start' || action === 'reboot' ? 'ready' : 'stopped';
    await delay(undefined);
  },
};
