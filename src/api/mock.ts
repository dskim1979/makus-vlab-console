// Fake engine for `npm run dev:mock`: lets the screens run without vlab-engine.
import { ApiError, type Api } from './client';
import type { AuthStatus, Branding, Desktop, Lease, User } from './types';

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

const desktops: Desktop[] = [
  { id: 'd1', name: 'vivado-build-01', pool: 'FPGA 빌드 팜', state: 'ready', os: 'Rocky Linux 9', spec: { cpu: 16, memory_gb: 64 }, protocols: ['spice', 'vnc'], resources: [{ kind: 'card', name: 'Alveo U250 #2' }], pool_type: 'buildfarm', last_connected: new Date(Date.now() - 3 * 864e5).toISOString() },
  { id: 'd2', name: 'board-lab-zcu102', pool: '보드 랩', state: 'in_use', os: 'Ubuntu 22.04', spec: { cpu: 8, memory_gb: 32 }, protocols: ['spice', 'vnc'], resources: [{ kind: 'usb', name: 'JTAG ZCU102 #1' }], pool_type: 'dedicated', last_connected: new Date(Date.now() - 2 * 36e5).toISOString() },
  { id: 'd4', name: 'ai-ws-03', pool: 'AI 연구실', state: 'ready', os: 'Windows 11', spec: { cpu: 8, memory_gb: 32 }, protocols: ['spice', 'vnc'], gpu: { mode: 'vgpu', label: 'A16-4Q' }, pool_type: 'dedicated', last_connected: new Date(Date.now() - 26 * 36e5).toISOString() },
  { id: 'd3', name: 'lab-win11-07', pool: '공용 랩 A', state: 'stopped', os: 'Windows 11', spec: { cpu: 4, memory_gb: 8 }, protocols: ['vnc', 'spice'], pool_type: 'reset', last_connected: null, policy: { clipboard: 'to_desktop', allow_power: false, start_on_connect: true } },
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
    return delay({ kind: 'ok' as const, user: current });
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
  async myLeases() { return delay(leases); },
  async connect(desktopId, protocol) {
    const d = desktops.find((x) => x.id === desktopId);
    if (!d) throw new ApiError(404, 'Desktop not found');
    if (d.state === 'stopped') {
      if (d.policy?.start_on_connect === false) throw new ApiError(409, 'VM_STOPPED');
      setTimeout(() => { d.state = 'ready'; }, 2500);   // the mock desktop comes up
      throw new ApiError(409, 'STARTING');
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
