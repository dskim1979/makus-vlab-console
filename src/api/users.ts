// Accounts and roles (사용자 > 사용자 목록, 역할 관리): /api/vlab/admin/users…, /roles…, thin
// wrappers over the engine's core routes (makus-vlab pegaprox/api/vlab_next.py, "accounts and
// roles"). The caller's own account (내 계정: password, two-step sign-in) is /api/auth/*.
import { ApiError, isMock, request } from './client';
import { mockMustChange, mockWhoAmI } from './mock';
import { mockDisabledUsers, mockUsers } from './mockAdmin';
import { mockExpiry, mockMemberOf } from './next';

export type Account = {
  username: string; display_name: string; role: string; auth_source: string; email?: string;
  enabled?: boolean; tenant_id?: string; desktops?: number; last_connected?: string | null;
  totp_enabled?: boolean; last_login?: string | null; must_change_password?: boolean; department_id?: string | null;
  expires_at?: string | null; expired?: boolean;   // last day of use (YYYY-MM-DD); past it the account is disabled
};
export type AccountInput = {
  username: string; password: string; display_name?: string; email?: string; role: string;
  department_id?: string | null; must_change_password?: boolean; expires_at?: string | null;
};
export type AccountUpdate = { display_name?: string; email?: string; role?: string; enabled?: boolean; department_id?: string | null; expires_at?: string | null };
export type LockedAccount = { username: string; locked_until: number; remaining_seconds: number; attempt_count: number };
export type Permission = { permission: string; description: string; category: string; warning?: string };
export type Role = { id: string; name: string; builtin: boolean; permissions: string[]; scope: 'global' | 'tenant'; tenant_id?: string; created_by?: string };
export type RoleTemplate = { id: string; name: string; description: string; permissions: string[]; permission_count: number };
export type RoleInput = { id?: string; name: string; permissions: string[]; tenant_id?: string };
export type TotpSetup = { secret: string; qr_code: string; uri: string };

// managed by AD/LDAP or an identity provider: no password here
export const externalSource = (s?: string) => !!s && s !== 'local';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string; detail?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const d = data && typeof data === 'object' ? data : null;
    const msg = d && typeof d.error === 'string' ? d.error + (typeof d.detail === 'string' ? ` — ${d.detail}` : '') : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}
const enc = encodeURIComponent;
const A = '/api/vlab/admin';

const realUsersApi = {
  list: async () => (await call<{ users: Account[] }>('GET', `${A}/users?all=1`)).users,
  create: async (u: AccountInput) => (await call<{ user: Account }>('POST', `${A}/users`, u)).user,
  update: async (username: string, u: AccountUpdate) => { await call('PUT', `${A}/users/${enc(username)}`, u); },
  remove: async (username: string) => { await call('DELETE', `${A}/users/${enc(username)}`); },
  resetPassword: async (username: string, password: string, must_change_password: boolean) => {
    await call('PUT', `${A}/users/${enc(username)}/password`, { password, must_change_password });
  },
  reset2fa: async (username: string) => { await call('DELETE', `${A}/users/${enc(username)}/2fa`); },
  locked: async () => (await call<{ users: LockedAccount[] }>('GET', `${A}/locked-users`)).users,
  unlock: async (username: string) => { await call('DELETE', `${A}/locked-users/${enc(username)}`); },

  permissions: async () => call<Permission[]>('GET', `${A}/permissions`),
  roles: async () => call<Role[]>('GET', `${A}/roles`),
  templates: async () => call<RoleTemplate[]>('GET', `${A}/roles/templates`),
  createRole: async (r: RoleInput) => { await call('POST', `${A}/roles`, r); },
  updateRole: async (id: string, r: Omit<RoleInput, 'id'>) => { await call('PUT', `${A}/roles/${enc(id)}`, r); },
  deleteRole: async (id: string, tenantId?: string) => {
    await call('DELETE', `${A}/roles/${enc(id)}${tenantId ? `?tenant_id=${enc(tenantId)}` : ''}`);
  },

  // 내 계정: changing the password ends every session, this one too (relogin)
  changeMyPassword: async (current_password: string, new_password: string) => {
    await call('POST', '/api/auth/change-password', { current_password, new_password });
  },
  my2fa: async () => call<{ enabled: boolean; available: boolean }>('GET', '/api/auth/2fa/status'),
  setup2fa: async (password?: string) => call<TotpSetup>('POST', '/api/auth/2fa/setup', password ? { password } : {}),
  verify2fa: async (code: string) => { await call('POST', '/api/auth/2fa/verify', { code }); },
  disable2fa: async (password: string) => { await call('POST', '/api/auth/2fa/disable', { password }); },
};

export type UsersApi = typeof realUsersApi;

// --- mock mode -------------------------------------------------------------------------------

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));
const fail = (status: number, msg: string) => Promise.reject(new ApiError(status, msg));

const extra: Record<string, { totp?: boolean; last_login?: string | null }> = {
  alice: { totp: true, last_login: new Date(Date.now() - 2 * 36e5).toISOString() },
  admin: { totp: false, last_login: new Date().toISOString() },
};
const locked: Record<string, number> = { carol: Date.now() + 9 * 60000 };
const MOCK_PERMS: Permission[] = [
  ['vlab.desk', '내 데스크톱 쓰기'], ['vlab.pool.view', '풀 조회'], ['vlab.pool.manage', '풀 관리'],
  ['vlab.accel.manage', '가속 자원 관리'], ['vlab.report.view', '보고서 조회'],
  ['vm.view', 'View VMs and containers'], ['vm.start', 'Start VMs and containers'], ['vm.stop', 'Stop VMs and containers'],
  ['vm.console', 'Access VM console'], ['vm.create', 'Create VMs'], ['vm.delete', 'Delete VMs'],
  ['storage.view', 'View storage'], ['storage.upload', 'Upload ISO images'],
  ['node.view', 'View nodes'], ['cluster.add', 'Add clusters'],
  ['admin.users', 'Manage users'], ['admin.roles', 'Manage roles'], ['admin.settings', 'Change settings'],
  ['security.lockout.view', 'View locked accounts'], ['security.lockout.manage', 'Unlock accounts'],
].map(([permission, description]) => ({ permission, description, category: permission.split('.')[0],
  warning: permission === 'admin.roles' ? 'Whoever holds this can grant themselves any permission they hold.' : '' }));
const ALL = MOCK_PERMS.map((p) => p.permission);
const BUILTIN: Role[] = [
  { id: 'admin', name: 'Admin', builtin: true, permissions: ALL, scope: 'global' },
  { id: 'user', name: 'User', builtin: true, permissions: ['vlab.desk', 'vm.view', 'vm.start', 'vm.stop', 'vm.console'], scope: 'global' },
  { id: 'viewer', name: 'Viewer', builtin: true, permissions: ['vm.view', 'node.view', 'storage.view'], scope: 'global' },
];
const custom: Role[] = [
  { id: 'ta', name: '조교', builtin: false, permissions: ['vlab.desk', 'vlab.pool.view', 'vlab.report.view', 'vm.view', 'vm.console'], scope: 'global', created_by: 'admin' },
];
const TEMPLATES: RoleTemplate[] = [
  { id: 'helpdesk', name: 'Helpdesk', description: 'Start, stop and open consoles; no changes', permissions: ['vm.view', 'vm.start', 'vm.stop', 'vm.console', 'vlab.pool.view'], permission_count: 5 },
  { id: 'lab_manager', name: 'Lab manager', description: 'Pools, desktops and reports', permissions: ['vlab.desk', 'vlab.pool.view', 'vlab.pool.manage', 'vlab.report.view', 'vm.view'], permission_count: 5 },
];
let my2fa = false;
const ROLE_ID = /^[a-z0-9_-]+$/;

function allAccounts() {
  return [...mockUsers.map((u) => ({ u, enabled: true })), ...mockDisabledUsers.map((u) => ({ u, enabled: false }))];
}
function strong(pw: string) {
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password needs upper case, lower case and a digit';
  return null;
}
const hasRole = (id: string) => BUILTIN.some((r) => r.id === id) || custom.some((r) => r.id === id);

const mockUsersApi: UsersApi = {
  list: () => delay(allAccounts().map(({ u, enabled }) => ({
    ...u, enabled, tenant_id: 'default', totp_enabled: !!extra[u.username]?.totp, last_login: extra[u.username]?.last_login ?? null,
    must_change_password: mockMustChange.has(u.username), department_id: mockMemberOf[u.username] ?? null,
    expires_at: mockExpiry[u.username] ?? null, expired: !!mockExpiry[u.username] && mockExpiry[u.username] < new Date().toISOString().slice(0, 10),
  }))),
  create: (u) => {
    const name = u.username.trim().toLowerCase();
    if (name.length < 3) return fail(400, 'Username must be at least 3 characters');
    if (allAccounts().some((x) => x.u.username === name)) return fail(409, 'Username already exists');
    const weak = strong(u.password);
    if (weak) return fail(400, weak);
    if (!hasRole(u.role)) return fail(400, 'Invalid role');
    mockUsers.push({ username: name, display_name: u.display_name || name, role: u.role, auth_source: 'local', email: u.email ?? '' });
    if (u.department_id) mockMemberOf[name] = u.department_id;
    if (u.must_change_password) mockMustChange.add(name);
    if (u.expires_at) mockExpiry[name] = u.expires_at;
    return delay({ username: name, display_name: u.display_name || name, role: u.role, auth_source: 'local', email: u.email,
      department_id: u.department_id ?? null, must_change_password: !!u.must_change_password });
  },
  update: (username, b) => {
    const at = allAccounts().find((x) => x.u.username === username);
    if (!at) return fail(404, 'User not found');
    if (b.role !== undefined && !hasRole(b.role)) return fail(400, 'Invalid role');
    if (b.role !== undefined && b.role !== at.u.role && username === 'admin') return fail(403, 'Cannot modify your own role');
    Object.assign(at.u, { ...(b.display_name !== undefined ? { display_name: b.display_name || username } : {}),
      ...(b.email !== undefined ? { email: b.email } : {}), ...(b.role !== undefined ? { role: b.role } : {}) });
    if (b.enabled !== undefined && b.enabled !== at.enabled) {
      if (!b.enabled && username === 'admin') return fail(400, 'Cannot disable last admin');
      const [from, to] = b.enabled ? [mockDisabledUsers, mockUsers] : [mockUsers, mockDisabledUsers];
      from.splice(from.indexOf(at.u), 1);
      to.push(at.u);
    }
    if (b.department_id !== undefined) {
      if (b.department_id) mockMemberOf[username] = b.department_id; else delete mockMemberOf[username];
    }
    if (b.expires_at !== undefined) {
      if (b.expires_at) mockExpiry[username] = b.expires_at; else delete mockExpiry[username];
    }
    return delay(undefined);
  },
  remove: (username) => {
    if (username === 'admin') return fail(400, 'Cannot delete your own account');
    for (const arr of [mockUsers, mockDisabledUsers]) {
      const i = arr.findIndex((x) => x.username === username);
      if (i >= 0) { arr.splice(i, 1); delete mockMemberOf[username]; mockMustChange.delete(username); return delay(undefined); }
    }
    return fail(404, 'User not found');
  },
  resetPassword: (username, password, must) => {
    const at = allAccounts().find((x) => x.u.username === username);
    if (!at) return fail(404, 'User not found');
    if (externalSource(at.u.auth_source)) return fail(400, 'This user authenticates via LDAP/Active Directory. Password must be changed there.');
    const weak = strong(password);
    if (weak) return fail(400, weak);
    if (must) mockMustChange.add(username); else mockMustChange.delete(username);
    return delay(undefined);
  },
  reset2fa: (username) => { if (extra[username]) extra[username].totp = false; return delay(undefined); },
  locked: () => delay(Object.entries(locked).filter(([, until]) => until > Date.now()).map(([username, until]) => ({
    username, locked_until: until / 1000, remaining_seconds: Math.round((until - Date.now()) / 1000), attempt_count: 5 }))),
  unlock: (username) => {
    if (!locked[username]) return fail(404, 'User not found in locked list');
    delete locked[username];
    return delay(undefined);
  },

  permissions: () => delay(MOCK_PERMS),
  roles: () => delay([...BUILTIN, ...custom]),
  templates: () => delay(TEMPLATES),
  createRole: (r) => {
    const id = (r.id ?? '').trim().toLowerCase();
    if (!id) return fail(400, 'Role ID required');
    if (!ROLE_ID.test(id)) return fail(400, 'Role ID must be alphanumeric');
    if (hasRole(id)) return fail(400, 'Global role already exists');
    custom.push({ id, name: r.name || id, builtin: false, permissions: [...r.permissions], scope: 'global', created_by: 'admin' });
    return delay(undefined);
  },
  updateRole: (id, r) => {
    if (BUILTIN.some((x) => x.id === id)) return fail(400, 'Cannot modify builtin roles');
    const role = custom.find((x) => x.id === id);
    if (!role) return fail(404, 'Role not found');
    if (r.name) role.name = r.name;
    role.permissions = [...r.permissions];
    return delay(undefined);
  },
  deleteRole: (id) => {
    if (BUILTIN.some((x) => x.id === id)) return fail(400, 'Cannot delete builtin roles');
    const i = custom.findIndex((x) => x.id === id);
    if (i < 0) return fail(404, 'Role not found');
    const holders = allAccounts().filter((x) => x.u.role === id).map((x) => x.u.username);
    if (holders.length) return fail(409, `Role still assigned — ${holders.length} account(s) still hold '${id}': ${holders.join(', ')}`);
    custom.splice(i, 1);
    return delay(undefined);
  },

  changeMyPassword: (current, next) => {
    if (!current) return fail(401, 'Current password is incorrect');
    const weak = strong(next);
    if (weak) return fail(400, weak);
    mockMustChange.delete(mockWhoAmI());
    return delay(undefined);
  },
  my2fa: () => delay({ enabled: my2fa, available: true }),
  setup2fa: (password) => {
    if (my2fa && !password) return fail(400, 'Password required to replace an existing 2FA device');
    const secret = 'JBSWY3DPEHPK3PXP';
    return delay({ secret, qr_code: mockQr(secret), uri: `otpauth://totp/MOAVI:me?secret=${secret}&issuer=MOAVI` });
  },
  verify2fa: (code) => {
    if (!/^\d{6}$/.test(code)) return fail(401, 'Invalid TOTP code');
    my2fa = true;
    return delay(undefined);
  },
  disable2fa: (password) => {
    if (!password) return fail(400, 'Password required to disable 2FA');
    my2fa = false;
    return delay(undefined);
  },
};

// a QR-looking picture for mock mode (not scannable)
function mockQr(seed: string) {
  const n = 25;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const cells: string[] = [];
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let on: boolean;
    if (finder(x, y)) {
      const fx = x >= n - 7 ? x - (n - 7) : x, fy = y >= n - 7 ? y - (n - 7) : y;
      on = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4);
    } else {
      h = (h * 1103515245 + 12345) >>> 0;
      on = (h >>> 16) % 2 === 0;
    }
    if (on) cells.push(`<rect x="${x + 2}" y="${y + 2}" width="1" height="1"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${cells.join('')}</g></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export const usersApi: UsersApi = isMock ? mockUsersApi : realUsersApi;
