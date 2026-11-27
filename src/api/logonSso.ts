// 데스크톱 자동 로그인 (MOAVI Desk Logon): the Windows module the engine installs by itself on the
// desktops of pools with desktop_sso on (makus-vlab pegaprox/api/vlab_logon.py). Per desktop: installed
// (version) / pending / failed / skipped; 다시 설치 runs the install now.
import { ApiError, isMock, request } from './client';

export type LogonInstallState = 'installed' | 'pending' | 'failed' | 'skipped' | 'none';
export type LogonInstall = {
  desktop_id: string; name: string; state: LogonInstallState; version: string; code: string; detail: string;
  at: string; current: boolean;
};
export type PoolLogon = { desktop_sso: boolean; module_version: string; ready: boolean; desktops: LogonInstall[] };

const enc = encodeURIComponent;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}

const real = {
  pool: (poolId: string) => call<PoolLogon>('GET', `/api/vlab/admin/pools/${enc(poolId)}/logon-sso`),
  reinstall: (desktopId: string) =>
    call<{ installed: boolean }>('POST', `/api/vlab/admin/desktops/${enc(desktopId)}/logon-sso/install`, {}),
};

const wait = <T,>(v: T, ms = 300) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const mockRows: Record<string, LogonInstall> = {};

const mock: typeof real = {
  pool: async () => wait({ desktop_sso: false, module_version: '1.3.3', ready: true, desktops: Object.values(mockRows) }),
  reinstall: async (desktopId) => {
    mockRows[desktopId] = { desktop_id: desktopId, name: desktopId, state: 'installed', version: '1.3.3', code: 'OK',
      detail: '', at: new Date().toISOString(), current: true };
    return wait({ installed: true }, 900);
  },
};

export const logonApi = isMock ? mock : real;
