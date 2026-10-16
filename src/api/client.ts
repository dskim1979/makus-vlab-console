import type { AuthStatus, Branding, ClientConfig, ConnectInfo, Desktop, KioskInfo, Lease, LoginResult, PowerAction, User } from './types';
import { mockApi } from './mock';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

// Same origin as the engine (vlab-proxy in production, Vite proxy in dev).
// The session lives in the engine's session_id cookie; X-Requested-With satisfies
// the engine's CSRF guard for /api/* calls.
export async function request<T>(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<{ status: number; data: T }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(extra ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: res.status, data: data as T };
}

const realApi = {
  async authStatus(): Promise<AuthStatus> {
    const { data } = await request<AuthStatus>('GET', '/api/auth/check');
    return data ?? { authenticated: false };
  },

  async login(username: string, password: string, opts: { totp?: string; remember?: boolean } = {}): Promise<LoginResult> {
    let r;
    try {
      r = await request<Record<string, unknown>>('POST', '/api/auth/login', {
        username,
        password,
        remember: !!opts.remember,
        ...(opts.totp ? { totp_code: opts.totp } : {}),
      });
    } catch {
      return { kind: 'error', reason: 'network' };
    }
    const d = r.data ?? {};
    if (r.status === 200 && d.requires_2fa) {
      return { kind: 'second_factor', methods: (d.methods as string[]) ?? ['totp'] };
    }
    if (r.status === 200 && d.success && d.user) {
      return { kind: 'ok', user: d.user as User };
    }
    if (d.locked) return { kind: 'error', reason: 'locked' };
    if (r.status === 401) return { kind: 'error', reason: 'invalid' };
    return { kind: 'error', reason: 'other', message: typeof d.error === 'string' ? d.error : undefined };
  },

  // first start only: the engine answers 409 once an administrator exists
  async setup(u: { username: string; password: string; display_name?: string; email?: string }): Promise<void> {
    let r;
    try {
      r = await request<{ error?: string }>('POST', '/api/auth/setup', u);
    } catch {
      throw new ApiError(0, 'network');
    }
    if (r.status !== 200 && r.status !== 201) throw new ApiError(r.status, r.data?.error || `HTTP ${r.status}`, r.data);
  },

  async logout(): Promise<void> {
    try { await request('POST', '/api/auth/logout'); } catch { /* already gone */ }
  },

  // vLAB module endpoints. Until the engine has them they answer 404,
  // which the screens show as "not ready" instead of an error.
  async myDesktops(): Promise<Desktop[]> {
    const { status, data } = await request<{ desktops: Desktop[] }>('GET', '/api/vlab/me/desktops');
    if (status !== 200) throw new ApiError(status, 'vlab_unavailable');
    return data.desktops ?? [];
  },

  async connect(desktopId: string, protocol: 'vnc' | 'spice' | 'rdp' | 'guac'): Promise<ConnectInfo> {
    const { status, data } = await request<ConnectInfo & { error?: string; code?: string }>(
      'POST', `/api/vlab/desktops/${encodeURIComponent(desktopId)}/connect`, { protocol });
    if (status !== 200) throw new ApiError(status, data?.code || data?.error || `HTTP ${status}`, data);
    return data;
  },

  async power(desktopId: string, action: PowerAction): Promise<void> {
    const { status, data } = await request<{ error?: string }>(
      'POST', `/api/vlab/desktops/${encodeURIComponent(desktopId)}/power`, { action });
    if (status !== 200) throw new ApiError(status, data?.error || `HTTP ${status}`, data);
  },

  async endSession(sessionId: string): Promise<void> {
    try { await request('POST', `/api/vlab/sessions/${encodeURIComponent(sessionId)}/end`); } catch { /* best effort */ }
  },

  // white label: public, the sign-in screen reads it too
  async branding(): Promise<Partial<Branding>> {
    const { status, data } = await request<Partial<Branding>>('GET', '/api/vlab/branding');
    if (status !== 200) throw new ApiError(status, 'branding_unavailable');
    return data ?? {};
  },

  // LAB kiosk (/kiosk): the terminal key identifies the room's PC
  async kiosk(key: string): Promise<KioskInfo> {
    const { status, data } = await request<KioskInfo & { error?: string; code?: string }>('GET', '/api/vlab/kiosk', undefined, { 'X-Terminal-Key': key });
    if (status !== 200) throw new ApiError(status, data?.code || data?.error || `HTTP ${status}`, data);
    return data;
  },

  async kioskStart(key: string): Promise<KioskInfo & { desktop: { id: string; name: string } }> {
    const { status, data } = await request<KioskInfo & { desktop: { id: string; name: string }; error?: string; code?: string }>(
      'POST', '/api/vlab/kiosk/start', {}, { 'X-Terminal-Key': key });
    if (status !== 200) throw new ApiError(status, data?.code || data?.error || `HTTP ${status}`, data);
    return data;
  },

  // the Windows client to offer; null when the engine predates it
  async clientConfig(): Promise<ClientConfig | null> {
    try {
      const { status, data } = await request<ClientConfig>('GET', '/api/vlab/client/config');
      return status === 200 ? data : null;
    } catch { return null; }
  },

  async myLeases(): Promise<Lease[]> {
    const { status, data } = await request<{ leases: Lease[] }>('GET', '/api/vlab/me/leases');
    if (status !== 200) throw new ApiError(status, 'vlab_unavailable');
    return data.leases ?? [];
  },
};

export type Api = typeof realApi;

export const isMock = import.meta.env.VITE_MOCK === '1';
export const api: Api = isMock ? mockApi : realApi;
