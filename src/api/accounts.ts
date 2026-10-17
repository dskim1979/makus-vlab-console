// Account extras for universities and labs (makus-vlab pegaprox/api/vlab_accounts.py): password
// reset by mail, the mail check of a sign-up, bulk import from CSV, account expiry and the terms /
// privacy consent. The sign-up routes and the review are in api/next.ts.
import { ApiError, isMock, request } from './client';
import { mockWhoAmI } from './mock';
import { mockDisabledUsers, mockUsers } from './mockAdmin';
import { mockExpiry, mockMemberOf, mockNextDeps, mockSignupState } from './next';

// complexity: the directory's (three kinds, no username); unified: one password for the portal and
// the desktops (the bundled directory), domain its NetBIOS name
export type PasswordPolicy = { min_length: number; uppercase: boolean; lowercase: boolean; numbers: boolean; special: boolean;
  complexity?: boolean; unified?: boolean; domain?: string };
export type ResetCheck = { valid: boolean; username?: string; expires_at?: string; policy: PasswordPolicy };
export type Terms = { enabled: boolean; version: string; terms: string; privacy: string; updated_at: string | null; updated_by?: string };
export type MyTerms = { required: boolean; enabled: boolean; version?: string; terms?: string; privacy?: string; updated_at?: string | null; agreed_version?: string | null };
export type Consent = { id: string; username: string; version: string; via: 'login' | 'signup'; client_ip: string; agreed_at: string };
export type AccountSettings = { notice_days: number; delete_after_days: number; reclaim: boolean; public_url: string };
export type ImportRow = {
  line: number; username: string; display_name: string; email: string; department_id: string | null; department: string;
  role: string; expires_at: string | null; errors: string[]; duplicate: boolean;
};
export type ImportResult = { created: { username: string; display_name: string; email: string; mailed: boolean }[];
  skipped: { line: number; username: string; errors: string[] }[]; csv: string; mailed: number };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string; code?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const d = data && typeof data === 'object' ? data : null;
    throw new ApiError(status, d && typeof d.error === 'string' ? d.error : `HTTP ${status}`, data);
  }
  return data;
}
const enc = encodeURIComponent;
const A = '/api/vlab/admin';

const realAccountsApi = {
  // the sign-in screen: the answer is the same whether an account matched or not
  passwordPolicy: async () => (await call<{ policy: PasswordPolicy }>('GET', '/api/vlab/password-policy')).policy,
  requestReset: async (login: string) => { await call('POST', '/api/vlab/password-reset', { login }); },
  checkReset: async (token: string) => call<ResetCheck>('POST', '/api/vlab/password-reset/check', { token }),
  confirmReset: async (token: string, password: string) => call<{ username: string }>('POST', '/api/vlab/password-reset/confirm', { token, password }),

  verifySignup: async (id: string, b: { code?: string; token?: string }) => call<{ verified: boolean; approved: boolean }>('POST', '/api/vlab/signup/verify', { id, ...b }),
  resendSignup: async (id: string) => call<{ sent: boolean }>('POST', '/api/vlab/signup/resend', { id }),

  publicTerms: async () => {
    try {
      const { status, data } = await request<Terms>('GET', '/api/vlab/terms');
      return status === 200 && data ? data : null;
    } catch { return null; }
  },
  // null when the engine predates terms: nothing to agree to
  myTerms: async (): Promise<MyTerms | null> => {
    try {
      const { status, data } = await request<MyTerms>('GET', '/api/vlab/me/terms');
      return status === 200 ? data : null;
    } catch { return null; }
  },
  agreeTerms: async (version: string) => { await call('POST', '/api/vlab/me/terms', { version }); },
  terms: async () => call<{ terms: Terms; agreed?: number }>('GET', `${A}/terms`),
  saveTerms: async (b: Partial<Pick<Terms, 'enabled' | 'version' | 'terms' | 'privacy'>>) => (await call<{ terms: Terms }>('PUT', `${A}/terms`, b)).terms,
  consents: async (version?: string) => call<{ consents: Consent[]; version: string; not_yet: string[] }>('GET', `${A}/terms/consents${version ? `?version=${enc(version)}` : ''}`),
  consentsCsv: async (version?: string) => {
    const { status, data } = await request<string>('GET', `${A}/terms/consents?format=csv${version ? `&version=${enc(version)}` : ''}`);
    if (status !== 200) throw new ApiError(status, `HTTP ${status}`);
    return String(data);
  },

  accountSettings: async () => (await call<{ accounts: AccountSettings }>('GET', `${A}/account-settings`)).accounts,
  saveAccountSettings: async (b: Partial<AccountSettings>) => (await call<{ accounts: AccountSettings }>('PUT', `${A}/account-settings`, b)).accounts,
  setExpiry: async (username: string, expires_at: string | null) => { await call('PUT', `${A}/users/${enc(username)}/expiry`, { expires_at }); },

  importPreview: async (csv: string) => call<{ rows: ImportRow[]; ok: number; errors: number }>('POST', `${A}/users/import/preview`, { csv }),
  importAccounts: async (csv: string, deliver: 'csv' | 'mail', must_change_password: boolean) =>
    call<ImportResult>('POST', `${A}/users/import`, { csv, deliver, must_change_password }),
};

export type AccountsApi = typeof realAccountsApi;

export const EXAMPLE_CSV = '아이디,이름,메일,부서,역할,사용 기한\r\nkim.minji,김민지,kim.minji@univ.ac.kr,컴퓨터공학과,user,2027-02-28\r\nlee.junho,이준호,lee.junho@univ.ac.kr,컴퓨터공학과,user,2027-02-28\r\n';

// save a text as a file (CSV with a BOM so a spreadsheet reads Korean right)
export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const body = type.startsWith('text/csv') && !text.startsWith('﻿') ? '﻿' + text : text;
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- mock mode -------------------------------------------------------------------------------

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));
const fail = (status: number, msg: string, code?: string) => Promise.reject(new ApiError(status, msg, code ? { error: msg, code } : undefined));
const now = () => new Date().toISOString().slice(0, 19);
// the mock site runs the bundled directory: one password for the portal and the desktops
// Samba AD keeps its default complexity on (three kinds, no account name), as the bundled DC does
const policy: PasswordPolicy = { min_length: 8, uppercase: true, lowercase: true, numbers: true, special: false, complexity: true, unified: true, domain: 'MOAVI' };
const weak = (pw: string) => pw.length < 8 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)
  ? 'Password must contain: at least 8 characters, an upper and a lower case letter and a number' : null;

// a reset link in mock mode: ask for "alice" and open /reset-password?token=mock-reset
const resets = new Map<string, { username: string; used: boolean }>();
let terms: Terms = {
  enabled: true, version: '2026-09', updated_at: '2026-09-01T09:00:00', updated_by: 'admin',
  terms: '# 이용 약관\n\n1. 이 서비스는 교육 · 연구 목적으로만 씁니다.\n2. 계정을 다른 사람과 함께 쓰지 않습니다.\n3. 데스크톱의 파일은 사용 기한이 끝나면 지워질 수 있으니 공유 저장소에 보관합니다.\n4. 소프트웨어 라이선스 조건을 지킵니다.',
  privacy: '# 개인정보 처리 방침\n\n- 수집 항목: 아이디, 이름, 메일, 소속 부서, 접속 기록(시각 · IP)\n- 목적: 계정 관리, 데스크톱 배정, 보안 감사\n- 보관 기간: 계정 삭제 후 1년(접속 기록), 그 밖에는 계정 삭제 때 파기\n- 문의: 전산실 (helpdesk@univ.ac.kr)',
};
const consents: Consent[] = ['admin', 'alice', 'bob', 'carol'].map((u, i) => ({
  id: `tc_${i}`, username: u, version: '2026-09', via: 'login', client_ip: `10.20.1.${10 + i}`, agreed_at: `2026-09-0${i + 1}T10:0${i}:00` }));
let settings: AccountSettings = { notice_days: 7, delete_after_days: 0, reclaim: true, public_url: '' };

const mockAccountsApi: AccountsApi = {
  passwordPolicy: () => delay({ ...policy }),
  requestReset: (login) => {
    const name = login.trim().toLowerCase();
    if ([...mockUsers, ...mockDisabledUsers].some((u) => u.username === name || u.email === name)) resets.set('mock-reset', { username: name.includes('@') ? 'alice' : name, used: false });
    return delay(undefined);
  },
  checkReset: (token) => {
    const r = resets.get(token) ?? (token === 'mock-reset' ? { username: 'carol', used: false } : undefined);
    return delay(r && !r.used ? { valid: true, username: r.username, expires_at: now(), policy } : { valid: false, policy });
  },
  confirmReset: (token, password) => {
    const r = resets.get(token) ?? (token === 'mock-reset' ? { username: 'carol', used: false } : undefined);
    if (!r || r.used) return fail(400, 'This link has expired or was used already - ask for a new one', 'LINK_INVALID');
    const w = weak(password); if (w) return fail(400, w);
    resets.set(token, { ...r, used: true });
    return delay({ username: r.username });
  },

  verifySignup: (id, b) => {
    const s = mockSignupState.signups.find((x) => x.id === id);
    if (!s) return fail(404, 'Request not found');
    if (b.code !== undefined && b.code !== '123456') return fail(400, 'The code is not right', 'WRONG');
    s.email_verified = true;
    const auto = mockSignupState.settings.auto_domains.some((d) => s.email.toLowerCase().endsWith('@' + d) || s.email.toLowerCase().endsWith('.' + d));
    if (auto && s.status === 'pending' && mockSignupState.settings.enabled) {
      Object.assign(s, { status: 'approved', reviewed_by: 'auto', reviewed_at: now() });
      mockUsers.push({ username: s.username, display_name: s.display_name || s.username, role: mockSignupState.settings.auto_role, auth_source: 'local', email: s.email });
      const dep = mockSignupState.settings.auto_department_id || s.department_id;
      if (dep) mockMemberOf[s.username] = dep;
      if (mockSignupState.settings.auto_expires_at) mockExpiry[s.username] = mockSignupState.settings.auto_expires_at;
    }
    return delay({ verified: true, approved: s.status === 'approved' });
  },
  resendSignup: () => delay({ sent: true }),

  publicTerms: () => delay(terms.enabled ? { ...terms } : { ...terms, enabled: false }),
  myTerms: () => {
    if (!terms.enabled) return delay({ required: false, enabled: false });
    const me = mockWhoAmI();
    const mine = consents.filter((c) => c.username === me);
    return delay({ required: !mine.some((c) => c.version === terms.version), enabled: true, version: terms.version, terms: terms.terms,
      privacy: terms.privacy, updated_at: terms.updated_at, agreed_version: mine[0]?.version ?? null });
  },
  agreeTerms: (version) => {
    if (version !== terms.version) return fail(409, 'The terms changed meanwhile - read them again', 'TERMS_CHANGED');
    consents.unshift({ id: `tc_${Date.now()}`, username: mockWhoAmI(), version, via: 'login', client_ip: '127.0.0.1', agreed_at: now() });
    return delay(undefined);
  },
  terms: () => delay({ terms: { ...terms }, agreed: new Set(consents.filter((c) => c.version === terms.version).map((c) => c.username)).size }),
  saveTerms: (b) => {
    const next = { ...terms, ...b };
    if (next.version && !/^[\w.-]{1,40}$/.test(next.version)) return fail(400, 'version: up to 40 letters, digits, ".", "_" or "-" (e.g. 2026-10 or v2)');
    if (next.enabled && !next.version) return fail(400, 'Give the terms a version before turning them on');
    terms = { ...next, updated_at: now(), updated_by: 'admin' };
    return delay({ ...terms });
  },
  consents: (version) => {
    const all = [...mockUsers.map((u) => u.username), 'admin'];
    return delay({ consents: consents.filter((c) => !version || c.version === version).map((c) => ({ ...c })), version: terms.version,
      not_yet: terms.enabled ? all.filter((u) => !consents.some((c) => c.username === u && c.version === terms.version)).sort() : [] });
  },
  consentsCsv: (version) => delay('username,display_name,version,via,agreed_at,client_ip\r\n' + consents.filter((c) => !version || c.version === version)
    .map((c) => [c.username, '', c.version, c.via, c.agreed_at, c.client_ip].join(',')).join('\r\n') + '\r\n'),

  accountSettings: () => delay({ ...settings }),
  saveAccountSettings: (b) => {
    if (b.notice_days !== undefined && (b.notice_days < 0 || b.notice_days > 60)) return fail(400, 'notice_days must be 0 to 60');
    if (b.delete_after_days !== undefined && (b.delete_after_days < 0 || b.delete_after_days > 3650)) return fail(400, 'delete_after_days must be 0 to 3650');
    if (b.public_url && !/^https?:\/\/[^\s/]+/.test(b.public_url)) return fail(400, 'public_url: the address users open, like https://desk.univ.ac.kr');
    settings = { ...settings, ...b };
    return delay({ ...settings });
  },
  setExpiry: (username, day) => {
    if (day) mockExpiry[username] = day; else delete mockExpiry[username];
    return delay(undefined);
  },

  importPreview: (csv) => {
    try { return delay(mockPlan(csv)); } catch (e) { return fail(400, (e as Error).message); }
  },
  importAccounts: (csv, deliver, must) => {
    let plan;
    try { plan = mockPlan(csv); } catch (e) { return fail(400, (e as Error).message); }
    const out: ImportResult = { created: [], skipped: [], csv: '', mailed: 0 };
    const lines = ['username,display_name,email,department,role,expires_at,password,mailed'];
    for (const r of plan.rows) {
      if (r.errors.length) { out.skipped.push({ line: r.line, username: r.username, errors: r.errors }); continue; }
      const mailed = deliver === 'mail' && !!r.email;
      const pw = mockPassword();
      mockUsers.push({ username: r.username, display_name: r.display_name, role: r.role, auth_source: 'local', email: r.email });
      if (r.department_id) mockMemberOf[r.username] = r.department_id;
      if (r.expires_at) mockExpiry[r.username] = r.expires_at;
      void must;
      out.created.push({ username: r.username, display_name: r.display_name, email: r.email, mailed });
      if (mailed) out.mailed++;
      lines.push([r.username, r.display_name, r.email, r.department, r.role, r.expires_at ?? '', mailed ? '' : pw, mailed ? 'yes' : 'no'].join(','));
    }
    out.csv = '﻿' + lines.join('\r\n') + '\r\n';
    return delay(out);
  },
};

const HEAD: Record<string, string> = {
  username: 'username', 아이디: 'username', id: 'username', 계정: 'username', name: 'display_name', display_name: 'display_name', 이름: 'display_name',
  email: 'email', mail: 'email', 메일: 'email', 이메일: 'email', department: 'department', 부서: 'department', role: 'role', 역할: 'role',
  expires_at: 'expires_at', '사용 기한': 'expires_at', 사용기한: 'expires_at', 만료일: 'expires_at',
};
function mockPlan(csv: string) {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('csv: no accounts under the header row');
  const cols = lines[0].split(',').map((h) => HEAD[h.trim().toLowerCase()] ?? '');
  if (!cols.includes('username')) throw new Error('csv: the first row must name the columns (아이디/username, 이름, 메일, 부서, 역할, 사용 기한)');
  const taken = new Set([...mockUsers, ...mockDisabledUsers].map((u) => u.username).concat('admin'));
  const seen = new Map<string, number>();
  const rows: ImportRow[] = lines.slice(1).map((l, i) => {
    const cells = l.split(',');
    const v: Record<string, string> = {};
    cols.forEach((c, j) => { if (c && !(c in v)) v[c] = (cells[j] ?? '').trim(); });
    const line = i + 2;
    const errors: string[] = [];
    const username = (v.username ?? '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) errors.push('username: 3-32 lower-case letters, digits, ".", "_" or "-"');
    else if (taken.has(username)) errors.push('exists');
    else if (seen.has(username)) errors.push(`duplicate of line ${seen.get(username)}`);
    if (!seen.has(username)) seen.set(username, line);
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) errors.push('email is not valid');
    let dep: string | null = null;
    if (v.department) {
      const d = mockNextDeps().find((x) => x.id === v.department || x.name === v.department);
      if (d) dep = d.id; else errors.push(`department: no department named "${v.department}"`);
    }
    const role = v.role || 'user';
    if (role === 'admin') errors.push('role: admin accounts are made one by one');
    else if (!['user', 'viewer', 'ta'].includes(role)) errors.push(`role: no such role "${role}"`);
    let exp: string | null = null;
    if (v.expires_at) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.expires_at)) errors.push('expires_at: a date as YYYY-MM-DD');
      else if (v.expires_at < new Date().toISOString().slice(0, 10)) errors.push('expires_at: the day has passed');
      else exp = v.expires_at;
    }
    return { line, username, display_name: v.display_name || username, email: v.email ?? '', department_id: dep, department: v.department ?? '',
      role, expires_at: exp, errors, duplicate: errors.some((e) => e === 'exists' || e.startsWith('duplicate')) };
  });
  const bad = rows.filter((r) => r.errors.length).length;
  return { rows, ok: rows.length - bad, errors: bad };
}
function mockPassword() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  while (!(/[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s))) s = Array.from({ length: 12 }, () => a[Math.floor(Math.random() * a.length)]).join('');
  return s;
}

export const accountsApi: AccountsApi = isMock ? mockAccountsApi : realAccountsApi;
