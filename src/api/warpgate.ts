// Warpgate 접근 게이트웨이(bastion) — 관리자 설정과 포털 연결 (makus-vlab pegaprox/api/vlab_warpgate.py).
// 모든 데스크톱 RDP/SSH/VNC를 Warpgate 하나로 중계한다. 접속할 때 비밀번호는 저장·전달하지 않는다.
import { ApiError, isMock, request } from './client';

export type WarpgateProto = 'rdp' | 'ssh' | 'vnc';

export type WarpgateConfig = {
  base_url: string; ssh_port: number; rdp_port: number; vnc_port: number;
  verify_tls: boolean; enabled: boolean; rdp_nla_user: string; has_nla_password: boolean;
  has_token: boolean; last_check: string | null; last_ok: boolean | null; last_detail: string;
};

// 저장 입력: 키가 없으면 기존값 유지(토큰·NLA 비번은 건드리지 않음), ''이면 지움.
export type WarpgateInput = {
  base_url: string; ssh_port: number; rdp_port: number; vnc_port: number;
  verify_tls: boolean; enabled: boolean; rdp_nla_user?: string;
  admin_token?: string; rdp_nla_password?: string;
};

export type WarpgateConnection = {
  proto: WarpgateProto; host: string; port: number; username: string;
  full_address?: string; ssh?: string; browser_url: string;
};

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
};

// --- mock --------------------------------------------------------------------------------
let mockCfg: WarpgateConfig = {
  base_url: '', ssh_port: 2222, rdp_port: 3389, vnc_port: 5900, verify_tls: false, enabled: false,
  rdp_nla_user: '', has_nla_password: false, has_token: false, last_check: null, last_ok: null, last_detail: '',
};

const mockWarpgateApi: WarpgateApi = {
  get: async () => ({ config: { ...mockCfg }, targets: mockCfg.enabled ? 3 : 0 }),
  save: async (b) => {
    mockCfg = {
      ...mockCfg, base_url: (b.base_url || '').replace(/\/$/, ''), ssh_port: b.ssh_port, rdp_port: b.rdp_port,
      vnc_port: b.vnc_port, verify_tls: b.verify_tls, enabled: b.enabled,
      rdp_nla_user: b.rdp_nla_user ?? mockCfg.rdp_nla_user,
      has_token: b.admin_token !== undefined ? !!b.admin_token : mockCfg.has_token,
      has_nla_password: b.rdp_nla_password !== undefined ? !!b.rdp_nla_password : mockCfg.has_nla_password,
    };
    return { ...mockCfg };
  },
  test: async () => {
    const ok = !!mockCfg.base_url && mockCfg.has_token;
    mockCfg = { ...mockCfg, last_check: new Date().toISOString(), last_ok: ok, last_detail: ok ? '대상 3개' : '설정 없음' };
    return { ok, detail: mockCfg.last_detail, config: { ...mockCfg } };
  },
  sessionsUrl: async (sessionId) => `${mockCfg.base_url || 'https://warpgate.example:8888'}/@warpgate/admin/sessions${sessionId ? `/${sessionId}` : ''}`,
  myStatus: async () => ({ enabled: mockCfg.enabled, protocols: ['rdp', 'ssh', 'vnc'] }),
  connect: async (_desktopId, protocol) => {
    const host = (mockCfg.base_url || 'https://warpgate.example:8888').replace(/^[a-z]+:\/\//, '').replace(/:\d+$/, '');
    const secret = 'TKT-MOCK-123';
    const port = protocol === 'ssh' ? mockCfg.ssh_port : protocol === 'vnc' ? mockCfg.vnc_port : mockCfg.rdp_port;
    return {
      proto: protocol, host, port, username: `ticket-${secret}`,
      full_address: protocol === 'rdp' ? `${host}:${port}` : undefined,
      ssh: protocol === 'ssh' ? `ssh ticket-${secret}@${host} -p ${port}` : undefined,
      browser_url: `${mockCfg.base_url || 'https://warpgate.example:8888'}/?warpgate-target=moavi-mock&warpgate-ticket=${secret}`,
    };
  },
};

export const warpgateApi: WarpgateApi = isMock ? mockWarpgateApi : realWarpgateApi;
