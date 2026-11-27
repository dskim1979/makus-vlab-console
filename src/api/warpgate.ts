// Warpgate 접근 게이트웨이(bastion) — 관리자 설정과 포털 연결 (makus-vlab pegaprox/api/vlab_warpgate.py).
// 모든 데스크톱 RDP/SSH/VNC를 Warpgate 하나로 중계한다. 접속할 때 비밀번호는 저장·전달하지 않는다.
import { ApiError, isMock, request } from './client';

export type WarpgateProto = 'rdp' | 'ssh' | 'vnc';

export type WarpgateConfig = {
  base_url: string; ssh_port: number; rdp_port: number; vnc_port: number;
  verify_tls: boolean; enabled: boolean; rdp_nla_user: string; has_nla_password: boolean;
  rdp_via_warpgate: boolean;   // the client's / mstsc's .rdp aimed at Warpgate (single-use ticket)
  allow_direct_fallback: boolean;   // Warpgate down: go direct / Guacamole (security weakened); default off = refuse
  has_token: boolean; last_check: string | null; last_ok: boolean | null; last_detail: string;
};

// 저장 입력: 키가 없으면 기존값 유지(토큰·NLA 비번은 건드리지 않음), ''이면 지움.
export type WarpgateInput = {
  base_url: string; ssh_port: number; rdp_port: number; vnc_port: number;
  verify_tls: boolean; enabled: boolean; rdp_nla_user?: string;
  admin_token?: string; rdp_nla_password?: string; rdp_via_warpgate?: boolean; allow_direct_fallback?: boolean;
};

export type WarpgateConnection = {
  proto: WarpgateProto; host: string; port: number; username: string;
  full_address?: string; ssh?: string; browser_url: string;
};

// 보안 게이트웨이 · 장치 연결 방식 (rdpgw): set up by the deploy (.env), read-only here
export type RdpgwStatus = {
  config: { enabled: boolean; requested: boolean; problem: string; host: string; verify_client_ip: boolean; token_minutes: number };
  reachable: boolean; pools: { id: string; name: string }[];
};

export type SshKey = { id: string; label: string; openssh_public_key: string; date_added?: string | null; last_used?: string | null };
export type SshConfigEntry = {
  host: string; hostname: string; port: number; user: string; target_name: string;
  ssh_command: string; config_snippet: string; desktop_id: string; desktop_name: string;
};
export type SshConfig = { enabled: boolean; warpgate_host?: string; ssh_port?: number; login?: string; entries: SshConfigEntry[]; managed_block?: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string; code?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, (data && data.code) || msg, data);
  }
  return data;
}

const A = '/api/vlab/admin/warpgate';
const enc = encodeURIComponent;

export type WarpgateApi = {
  get: () => Promise<{ config: WarpgateConfig; targets: number }>;
  save: (b: WarpgateInput) => Promise<WarpgateConfig>;
  test: () => Promise<{ ok: boolean; detail: string; config: WarpgateConfig }>;
  sessionsUrl: (sessionId?: string) => Promise<string>;
  myStatus: () => Promise<{ enabled: boolean; protocols: WarpgateProto[] }>;
  connect: (desktopId: string, protocol: WarpgateProto) => Promise<WarpgateConnection>;
  sshKeys: () => Promise<{ enabled: boolean; keys: SshKey[] }>;
  addSshKey: (label: string, openssh_public_key: string) => Promise<SshKey[]>;
  deleteSshKey: (id: string) => Promise<SshKey[]>;
  sshConfig: () => Promise<SshConfig>;
  rdpgw: () => Promise<RdpgwStatus>;
};

const realWarpgateApi: WarpgateApi = {
  get: () => call<{ config: WarpgateConfig; targets: number }>('GET', A),
  save: async (b) => (await call<{ config: WarpgateConfig }>('PUT', A, b)).config,
  test: () => call<{ ok: boolean; detail: string; config: WarpgateConfig }>('POST', `${A}/test`),
  sessionsUrl: async (sessionId) =>
    (await call<{ url: string }>('GET', `${A}/sessions${sessionId ? `?session_id=${enc(sessionId)}` : ''}`)).url,
  myStatus: () => call<{ enabled: boolean; protocols: WarpgateProto[] }>('GET', '/api/vlab/me/warpgate'),
  connect: async (desktopId, protocol) =>
    (await call<{ type: string; connection: WarpgateConnection }>(
      'POST', `/api/vlab/me/desktops/${enc(desktopId)}/warpgate`, { protocol })).connection,
  sshKeys: () => call<{ enabled: boolean; keys: SshKey[] }>('GET', '/api/vlab/me/ssh-keys'),
  addSshKey: async (label, openssh_public_key) =>
    (await call<{ keys: SshKey[] }>('POST', '/api/vlab/me/ssh-keys', { label, openssh_public_key })).keys,
  deleteSshKey: async (id) => (await call<{ keys: SshKey[] }>('DELETE', `/api/vlab/me/ssh-keys/${enc(id)}`)).keys,
  sshConfig: () => call<SshConfig>('GET', '/api/vlab/me/ssh-config'),
  rdpgw: () => call<RdpgwStatus>('GET', '/api/vlab/admin/rdpgw'),
};

// --- mock --------------------------------------------------------------------------------
// Kept in localStorage (mock only) so a setting saved on the admin page still holds after a reload or
// on the portal; screenshot scripts can seed 'vlab.mock.warpgate' with a configured gateway.
const MOCK_CFG_KEY = 'vlab.mock.warpgate';
const MOCK_KEYS_KEY = 'vlab.mock.sshkeys';
const MOCK_DEFAULT: WarpgateConfig = {
  base_url: '', ssh_port: 2222, rdp_port: 3389, vnc_port: 5900, verify_tls: false, enabled: false,
  rdp_nla_user: '', has_nla_password: false, rdp_via_warpgate: false, allow_direct_fallback: false,
  has_token: false, last_check: null, last_ok: null, last_detail: '',
};
function mockLoad<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : fallback; } catch { return fallback; }
}
function mockStore(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* per-browser only */ }
}
let mockCfg: WarpgateConfig = mockLoad(MOCK_CFG_KEY, MOCK_DEFAULT);
let mockKeys: SshKey[] = (() => { try { return JSON.parse(localStorage.getItem(MOCK_KEYS_KEY) || '[]') as SshKey[]; } catch { return []; } })();
const saveCfg = () => mockStore(MOCK_CFG_KEY, mockCfg);
const saveKeys = () => mockStore(MOCK_KEYS_KEY, mockKeys);

const mockWarpgateApi: WarpgateApi = {
  get: async () => ({ config: { ...mockCfg }, targets: mockCfg.enabled ? 3 : 0 }),
  save: async (b) => {
    mockCfg = {
      ...mockCfg, base_url: (b.base_url || '').replace(/\/$/, ''), ssh_port: b.ssh_port, rdp_port: b.rdp_port,
      vnc_port: b.vnc_port, verify_tls: b.verify_tls, enabled: b.enabled,
      rdp_nla_user: b.rdp_nla_user ?? mockCfg.rdp_nla_user,
      has_token: b.admin_token !== undefined ? !!b.admin_token : mockCfg.has_token,
      has_nla_password: b.rdp_nla_password !== undefined ? !!b.rdp_nla_password : mockCfg.has_nla_password,
      rdp_via_warpgate: b.rdp_via_warpgate ?? mockCfg.rdp_via_warpgate,
      allow_direct_fallback: b.allow_direct_fallback ?? mockCfg.allow_direct_fallback,
    };
    saveCfg();
    return { ...mockCfg };
  },
  test: async () => {
    const ok = !!mockCfg.base_url && mockCfg.has_token;
    mockCfg = { ...mockCfg, last_check: new Date().toISOString(), last_ok: ok, last_detail: ok ? '대상 3개' : '설정 없음' };
    saveCfg();
    return { ok, detail: mockCfg.last_detail, config: { ...mockCfg } };
  },
  sessionsUrl: async (sessionId) => `${mockCfg.base_url || 'https://warpgate.example:8888'}/@warpgate/admin/sessions${sessionId ? `/${sessionId}` : ''}`,
  myStatus: async () => ({ enabled: mockCfg.enabled, protocols: ['rdp', 'ssh', 'vnc'] }),
  rdpgw: async () => ({
    config: { enabled: true, requested: true, problem: '', host: 'vlab.lab.example:443', verify_client_ip: true, token_minutes: 5 },
    reachable: true, pools: [{ id: 'pool-design', name: '디자인실' }],
  }),
  connect: async (_desktopId, protocol) => {
    const host = (mockCfg.base_url || 'https://warpgate.example:8888').replace(/^[a-z]+:\/\//, '').replace(/:\d+$/, '');
    const secret = 'TKT-MOCK-123';
    const port = protocol === 'ssh' ? mockCfg.ssh_port : protocol === 'vnc' ? mockCfg.vnc_port : mockCfg.rdp_port;
    return {
      proto: protocol, host, port, username: `ticket-${secret}`,
      full_address: protocol === 'rdp' ? `${host}:${port}` : undefined,
      ssh: protocol === 'ssh' ? `ssh ticket-${secret}@${host} -p ${port}` : undefined,
      // the engine never puts a ticket in a browser link: Warpgate opens no web session from a ticket
      // for an RDP/SSH target, so the browser goes to Warpgate's web UI (sign in, open the desktop)
      browser_url: `${mockCfg.base_url || 'https://warpgate.example:8888'}/@warpgate#/`,
    };
  },
  sshKeys: async () => ({ enabled: mockCfg.enabled, keys: [...mockKeys] }),
  addSshKey: async (label, openssh_public_key) => {
    // the engine's codes (pegaprox/api/vlab_warpgate.py add_my_ssh_key)
    if (/PRIVATE KEY|PuTTY-User-Key-File/i.test(openssh_public_key)) throw new ApiError(400, 'PRIVATE_KEY');
    if (!/^(ssh-|ecdsa-|sk-)/.test(openssh_public_key.trim())) throw new ApiError(400, 'BAD_PUBLIC_KEY');
    mockKeys.push({ id: `key-${mockKeys.length + 1}`, label: label || 'MOAVI Desk', openssh_public_key, date_added: new Date().toISOString() });
    saveKeys();
    return [...mockKeys];
  },
  deleteSshKey: async (id) => { mockKeys = mockKeys.filter((k) => k.id !== id); saveKeys(); return [...mockKeys]; },
  sshConfig: async () => {
    let me = 'alice';
    try { me = JSON.parse(localStorage.getItem('vlab.mock.user') || 'null')?.username || 'alice'; } catch { /* mock only */ }
    const host = (mockCfg.base_url || 'https://warpgate.example:8888').replace(/^[a-z]+:\/\//, '').replace(/:\d+$/, '');
    const mk = (id: string, name: string): SshConfigEntry => {
      const target = `moavi-${name}-${id}`;
      const user = `${me}:${target}`;
      return { host: `moavi-${name}`, hostname: host, port: mockCfg.ssh_port, user, target_name: target,
        ssh_command: `ssh moavi-${name}`, desktop_id: id, desktop_name: name,
        config_snippet: `Host moavi-${name}\n    HostName ${host}\n    Port ${mockCfg.ssh_port}\n    User ${user}\n` };
    };
    // the mock's Linux desktops (src/api/mock.ts), as a pool with researcher_ssh would list them
    const entries = mockCfg.enabled ? [mk('d2', 'board-lab-zcu102'), mk('d1', 'vivado-build-01')] : [];
    return { enabled: mockCfg.enabled, warpgate_host: host, ssh_port: mockCfg.ssh_port, login: me,
      entries, managed_block: entries.map((e) => e.config_snippet).join('\n').trim() };
  },
};

export const warpgateApi: WarpgateApi = isMock ? mockWarpgateApi : realWarpgateApi;
