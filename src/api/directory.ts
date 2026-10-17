// 내장 디렉터리: the optional Samba AD DC of the install (VLAB_DIRECTORY=1, makus-vlab
// pegaprox/vlab/directory.py, /api/vlab/admin/bundled-directory/*). The portal account is the
// desktop account: the engine makes, disables and deletes the directory account and writes the
// password the user sets - it keeps none. Desktops join the domain through the guest agent.
import { ApiError, isMock, request } from './client';
import { mockVmStore } from './mockAdmin';

export type DirectorySettings = {
  include_admins: boolean; desktop_dns: string[]; set_dns: boolean; computer_name: string; rdp_group: boolean; migrate_on_login: boolean;
};
export type BundledDirectory = {
  enabled: boolean; active: boolean; own_ldap: boolean; realm: string; domain: string; dc: string; ip: string;
  base_dn: string; users_dn: string; groups_dn: string; desktops_dn: string; all_group_dn: string;
  service_account: boolean; join_account: boolean; tls_verified: boolean; settings: DirectorySettings;
  accounts: { total: number; ok: number; failed: number }; joins: { total: number; joined: number; failed: number };
  last_reconcile: string | null;
};
export type DirectoryCheck = { enabled: boolean; active: boolean; reachable: boolean; service_account: boolean; tls_verified: boolean;
  join_account: boolean; ou: boolean; users: number; code: string; detail: string };
export type DirectorySync = { accounts: number; made: number; deleted: number; no_password: number; errors: number;
  groups: number; membership_changes: number; groups_removed: number };
export type DirectoryAccount = { username: string; where: 'directory' | 'waiting' | 'local' | string; ok: boolean | null; code: string;
  detail: string; dn: string; at: string | null };
export type DirectoryGroup = { department_id: string; name: string; parent_id: string | null; cn: string; dn: string };
export type JoinState = 'joined' | 'failed' | 'pending' | 'other' | 'not_joined' | 'unknown';
export type DomainJoin = { desktop_id: string; pool_id?: string; vmid?: number; name?: string; state: JoinState; code: string; detail: string;
  computer: string; domain: string; os: string; at: string | null; auto?: boolean };

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
  get: async () => (await call<{ directory: BundledDirectory }>('GET', '/api/vlab/admin/bundled-directory')).directory,
  save: async (s: Partial<DirectorySettings>) => (await call<{ settings: DirectorySettings }>('PUT', '/api/vlab/admin/bundled-directory', s)).settings,
  check: async () => (await call<{ check: DirectoryCheck }>('POST', '/api/vlab/admin/bundled-directory/check', {})).check,
  sync: async () => (await call<{ sync: DirectorySync }>('POST', '/api/vlab/admin/bundled-directory/sync', {})).sync,
  rotateJoin: () => call<{ success: boolean }>('POST', '/api/vlab/admin/bundled-directory/join-account/rotate', {}),
  accounts: async () => (await call<{ accounts: DirectoryAccount[] }>('GET', '/api/vlab/admin/bundled-directory/accounts')).accounts,
  groups: () => call<{ all: { name: string; dn: string }; groups: DirectoryGroup[] }>('GET', '/api/vlab/admin/bundled-directory/groups'),
  joins: async (poolId: string) => (await call<{ joins: DomainJoin[] }>('GET', `/api/vlab/admin/bundled-directory/joins?pool_id=${enc(poolId)}`)).joins,
  join: async (desktopId: string, restart: boolean) =>
    (await call<{ join: DomainJoin }>('POST', `/api/vlab/admin/desktops/${enc(desktopId)}/domain-join`, { restart })).join,
  checkJoin: async (desktopId: string) =>
    (await call<{ join: DomainJoin }>('POST', `/api/vlab/admin/desktops/${enc(desktopId)}/domain-join/check`, {})).join,
  joinPool: (poolId: string, restart: boolean) =>
    call<{ joins: DomainJoin[]; joined: number; remaining: number }>('POST', `/api/vlab/admin/pools/${enc(poolId)}/domain-join`, { restart }),
};

// --- mock: the bundled directory on, a few accounts, the first desktop of each pool joined ---------

const nowIso = () => new Date().toISOString();
const wait = <T,>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const BASE = 'DC=moavi,DC=lan';
const mockSettings: DirectorySettings = { include_admins: false, desktop_dns: [], set_dns: true, computer_name: 'MD-{vmid}', rdp_group: true, migrate_on_login: true };
const mockJoins: Record<string, DomainJoin> = {};
let joinAccount = true;

function summary(): BundledDirectory {
  const j = Object.values(mockJoins);
  return {
    enabled: true, active: true, own_ldap: false, realm: 'moavi.lan', domain: 'MOAVI', dc: 'dc1.moavi.lan', ip: '10.20.0.5',
    base_dn: BASE, users_dn: `OU=Users,OU=MOAVI,${BASE}`, groups_dn: `OU=Groups,OU=MOAVI,${BASE}`, desktops_dn: `OU=Desktops,OU=MOAVI,${BASE}`,
    all_group_dn: `CN=moavi-users,OU=Groups,OU=MOAVI,${BASE}`, service_account: true, join_account: joinAccount, tls_verified: true,
    settings: { ...mockSettings, desktop_dns: [...mockSettings.desktop_dns] },
    accounts: { total: 42, ok: 41, failed: 1 },
    joins: { total: j.length, joined: j.filter((x) => x.state === 'joined').length, failed: j.filter((x) => x.state === 'failed').length },
    last_reconcile: new Date(Date.now() - 4 * 60e3).toISOString(),
  };
}

function seedJoins() {
  if (Object.keys(mockJoins).length) return;
  const n = new Map<string, number>();
  for (const d of mockVmStore.desks) {
    const i = n.get(d.pool_id) ?? 0;
    n.set(d.pool_id, i + 1);
    const at = new Date(Date.now() - (i + 1) * 3600e3).toISOString();
    // per pool: the first joined, the second waiting for its agent (automatic join), the third a clone not sysprepped
    if (i === 0) mockJoins[d.id] = { desktop_id: d.id, state: 'joined', code: 'OK', detail: '', computer: `MD-${d.vmid}`, domain: 'moavi.lan', os: 'windows', at };
    else if (i === 1) mockJoins[d.id] = { desktop_id: d.id, state: 'pending', code: 'NO_AGENT', detail: 'the QEMU guest agent does not answer', computer: '', domain: '', os: '', at, auto: true };
    else if (i === 2) mockJoins[d.id] = { desktop_id: d.id, state: 'failed', code: 'NOT_SYSPREPPED', detail: 'the same machine SID as another desktop - generalize the template with sysprep', computer: '', domain: '', os: 'windows', at };
  }
}

function mockJoin(desktopId: string, restart: boolean): DomainJoin {
  const d = mockVmStore.desks.find((x) => x.id === desktopId);
  if (!d) throw new ApiError(404, 'Desktop not found');
  const row: DomainJoin = d.state === 'stopped'
    ? { desktop_id: d.id, state: 'failed', code: 'NOT_RUNNING', detail: 'the desktop is not running', computer: '', domain: '', os: '', at: nowIso() }
    : { desktop_id: d.id, state: 'joined', code: restart ? 'RESTARTING' : 'RESTART_NEEDED', detail: 'joined; Windows applies it after a restart',
      computer: mockSettings.computer_name.replace('{vmid}', String(d.vmid)), domain: 'moavi.lan', os: 'windows', at: nowIso() };
  mockJoins[d.id] = row;
  return row;
}

const mock: typeof real = {
  get: () => { seedJoins(); return wait(summary()); },
  save: (s) => {
    if (s.computer_name !== undefined && (!s.computer_name.includes('{vmid}') || s.computer_name.replace('{vmid}', '99999').length > 15)) {
      return Promise.reject(new ApiError(400, 'computer_name: letters, digits and "-" with {vmid}, 15 characters at most'));
    }
    Object.assign(mockSettings, s);
    return wait({ ...mockSettings });
  },
  check: () => wait({ enabled: true, active: true, reachable: true, service_account: true, tls_verified: true, join_account: joinAccount,
    ou: true, users: 42, code: 'OK', detail: '' }, 500),
  sync: () => wait({ accounts: 42, made: 0, deleted: 1, no_password: 1, errors: 0, groups: 6, membership_changes: 2, groups_removed: 0 }, 700),
  rotateJoin: () => { joinAccount = true; return wait({ success: true }); },
  accounts: () => wait([
    { username: 'kim.minsu', where: 'directory', ok: true, code: 'OK', detail: 'in step', dn: `CN=kim.minsu,OU=Users,OU=MOAVI,${BASE}`, at: nowIso() },
    { username: 'lee.jiwon', where: 'directory', ok: false, code: 'NO_PASSWORD', detail: 'the account has no password yet - a reset link sets one',
      dn: `CN=lee.jiwon,OU=Users,OU=MOAVI,${BASE}`, at: nowIso() },
    { username: 'park.sora', where: 'waiting', ok: null, code: '', detail: '', dn: '', at: null },
    { username: 'admin', where: 'local', ok: null, code: '', detail: '', dn: '', at: null },
  ]),
  groups: () => wait({ all: { name: 'moavi-users', dn: `CN=moavi-users,OU=Groups,OU=MOAVI,${BASE}` }, groups: [] }),
  joins: (poolId) => {
    seedJoins();
    return wait(mockVmStore.desks.filter((d) => d.pool_id === poolId).map((d) => ({
      ...(mockJoins[d.id] ?? { desktop_id: d.id, state: 'unknown' as JoinState, code: '', detail: '', computer: '', domain: '', os: '', at: null }),
      pool_id: d.pool_id, vmid: d.vmid, name: d.name })));
  },
  join: (desktopId, restart) => { try { return wait(mockJoin(desktopId, restart), 900); } catch (e) { return Promise.reject(e); } },
  checkJoin: (desktopId) => wait(mockJoins[desktopId] ?? { desktop_id: desktopId, state: 'not_joined', code: 'NOT_JOINED',
    detail: 'the guest is in no domain', computer: '', domain: '', os: 'windows', at: nowIso() }),
  joinPool: (poolId, restart) => {
    seedJoins();
    const todo = mockVmStore.desks.filter((d) => d.pool_id === poolId && mockJoins[d.id]?.state !== 'joined').slice(0, 10);
    const joins = todo.map((d) => mockJoin(d.id, restart));
    return wait({ joins, joined: joins.filter((j) => j.state === 'joined').length, remaining: 0 }, 1200);
  },
};

export const directoryApi = isMock ? mock : real;

export function joinCodeText(code: string, L: (ko: string, en: string) => string): string {
  const m: Record<string, [string, string]> = {
    OK: ['가입됨', 'Joined'], RESTART_NEEDED: ['가입됨 · 재시작 필요', 'Joined · restart needed'], RESTARTING: ['가입됨 · 재시작 중', 'Joined · restarting'],
    NOT_RUNNING: ['꺼져 있음', 'Not running'], NO_AGENT: ['게스트 에이전트 응답 없음', 'No guest agent'], NO_CLUSTER: ['클러스터 연결 안 됨', 'Cluster not connected'],
    UNSUPPORTED: ['컨테이너는 가입 안 함', 'Containers are not joined'], OTHER_DOMAIN: ['다른 도메인에 가입돼 있음', 'In another domain'],
    NO_DNS: ['DNS 에서 DC 를 못 찾음', 'No DC in DNS'], JOIN_FAILED: ['가입 실패', 'Join failed'], NO_TOOLS: ['realmd · sssd 없음', 'No realmd / sssd'],
    RENAME_FAILED: ['이름 바꾸기 실패', 'Rename failed'], AGENT_ERROR: ['에이전트 오류', 'Agent error'], PENDING: ['게스트에서 진행 중', 'Still running'],
    NOT_JOINED: ['가입 안 됨', 'Not joined'], QUEUED: ['조인 대기', 'Queued'], GAVE_UP: ['자동 조인 중단', 'Auto join stopped'],
    NOT_SYSPREPPED: ['sysprep 안 된 복제본', 'Clone not sysprepped'], NO_SERVICE_ACCOUNT: ['서비스 계정 없음', 'No service account'], UNREACHABLE: ['DC 에 연결 안 됨', 'DC unreachable'],
  };
  const v = m[code];
  return v ? L(v[0], v[1]) : code;
}
