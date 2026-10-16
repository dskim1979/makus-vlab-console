// LAB > 단말 관리: room PCs come in through the MOAVI Desk Agent with an enrolment code
// (makus-vlab pegaprox/api/vlab_enroll.py). Codes are made here by an admin, or by anyone allowed through
// the portal's "실습실 PC로 설치" (a token for them, 24 h); the engine turns either into a one-file
// installer (install.cmd) that fetches the MSI from the server and installs it silently. Each PC's agent
// enrols, sends heartbeats and picks its kiosk key up once an admin approves it.
import { ApiError, isMock, request } from './client';
import { mockTerminals } from './mockAdmin';
import type { Terminal } from './types';

export type EnrollCodeStatus = 'active' | 'disabled' | 'expired' | 'used_up';
export type EnrollCode = {
  id: string; name: string; hint: string; lab_id: string | null; lab_name: string | null; auto_approve: boolean;
  max_uses: number; uses: number; expires_at: string | null; enabled: boolean; status: EnrollCodeStatus;
  created_by: string; created_at: string; last_used_at: string | null; kind?: 'admin' | 'user';
};
export type EnrollCodeInput = { name: string; lab_id?: string | null; auto_approve?: boolean; max_uses?: number; days?: number };
export type ClientMsi = { name: string; version: string; sha256: string; size: number; uploaded_at: string; uploaded_by: string };
// 플랫폼 설정 > 클라이언트 > 실습실 PC 설치
export type InstallSettings = {
  lab_install_enabled: boolean; lab_install_roles: string[]; auto_approve_roles: string[]; token_hours: number; max_uses: number;
  user_active_tokens: number; pending_warn: number; kiosk: boolean; server_url: string; server_cert_sha256: string;
  msi: ClientMsi | null; msi_ready?: boolean; pending?: number;
};
// what the portal may offer the signed-in user
export type LabInstallInfo = { enabled: boolean; allowed: boolean; msi_ready: boolean; personal_installer: boolean;
  labs: { id: string; name: string; location: string }[]; max_uses: number; hours: number; auto_approve: boolean };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) throw new ApiError(status, data?.error || `HTTP ${status}`, data);
  return data;
}

/** Saves what the engine answers as a file (the install.cmd files). */
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function fetchFile(method: string, path: string, body?: unknown): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw new ApiError(0, 'network'); }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = ((await res.json()) as { error?: string }).error || msg; } catch { /* not JSON */ }
    throw new ApiError(res.status, msg);
  }
  return res.blob();
}

const realEnrollApi = {
  codes: async () => (await call<{ codes: EnrollCode[] }>('GET', '/api/vlab/admin/enroll-codes')).codes,
  create: (body: EnrollCodeInput) => call<{ code: string; enroll_code: EnrollCode }>('POST', '/api/vlab/admin/enroll-codes', body),
  update: async (id: string, body: Partial<Pick<EnrollCode, 'name' | 'enabled' | 'lab_id' | 'auto_approve'>>) =>
    (await call<{ enroll_code: EnrollCode }>('PUT', `/api/vlab/admin/enroll-codes/${encodeURIComponent(id)}`, body)).enroll_code,
  remove: async (id: string) => { await call('DELETE', `/api/vlab/admin/enroll-codes/${encodeURIComponent(id)}`); },
  approve: (ids: string[], lab_id?: string | null) =>
    call<{ terminals: Terminal[]; missing: string[] }>('POST', '/api/vlab/admin/terminals/approve', { ids, lab_id: lab_id || null }),
  reject: (ids: string[]) => call<{ terminals: Terminal[]; missing: string[] }>('POST', '/api/vlab/admin/terminals/reject', { ids }),
  resendKey: async (id: string) => { await call('POST', `/api/vlab/admin/terminals/${encodeURIComponent(id)}/resend-key`); },
  installer: (code: string, kiosk: boolean) => fetchFile('POST', '/api/vlab/admin/installer', { code, kiosk }),
  settings: async () => (await call<{ settings: InstallSettings }>('GET', '/api/vlab/admin/terminal-install')).settings,
  saveSettings: async (s: Partial<InstallSettings>) => (await call<{ settings: InstallSettings }>('PUT', '/api/vlab/admin/terminal-install', s)).settings,
  uploadMsi: async (file: File): Promise<ClientMsi> => {
    const form = new FormData();
    form.append('file', file);
    let res: Response;
    try {
      res = await fetch('/api/vlab/admin/terminal-install/msi/upload', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: form });
    } catch { throw new ApiError(0, 'network'); }
    const data = await res.json().catch(() => ({})) as { msi?: ClientMsi; error?: string };
    if (!res.ok || !data.msi) throw new ApiError(res.status, data.error || `HTTP ${res.status}`);
    return data.msi;
  },
  deleteMsi: async () => { await call('DELETE', '/api/vlab/admin/terminal-install/msi'); },
  labInstallInfo: () => call<LabInstallInfo>('GET', '/api/vlab/lab-install'),
  labInstallFile: (lab_id: string | null, uses: number) => fetchFile('POST', '/api/vlab/lab-install', { lab_id, uses }),
  personalInstaller: () => fetchFile('GET', '/api/vlab/client/installer'),
};

// --- mock ------------------------------------------------------------------------------------

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));
const fail = (status: number, msg: string) => Promise.reject(new ApiError(status, msg));
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LABS: Record<string, string> = { lab_a: '교육장 A', lab_b: '공용 연구실 B' };
let mockSeq = 2;
const randomCode = () => {
  const r = Array.from({ length: 12 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  return { code: `MDE-${r.slice(0, 4)}-${r.slice(4, 8)}-${r.slice(8)}`, hint: r.slice(8) };
};
const mockCodes: EnrollCode[] = [
  { id: 'enc_1', name: '301호 일괄 설치', hint: 'Q7MZ', lab_id: 'lab_a', lab_name: '교육장 A', auto_approve: false, max_uses: 40, uses: 6,
    expires_at: new Date(Date.now() + 5 * 86400e3).toISOString(), enabled: true, status: 'active', created_by: 'admin', kind: 'admin',
    created_at: '2026-10-14T08:40:00Z', last_used_at: new Date(Date.now() - 3 * 60e3).toISOString() },
  { id: 'enc_u1', name: 'kim_ta 포털 설치', hint: 'R4WX', lab_id: null, lab_name: null, auto_approve: false, max_uses: 20, uses: 2,
    expires_at: new Date(Date.now() + 20 * 3600e3).toISOString(), enabled: true, status: 'active', created_by: 'kim_ta', kind: 'user',
    created_at: new Date(Date.now() - 4 * 3600e3).toISOString(), last_used_at: new Date(Date.now() - 60e3).toISOString() },
  { id: 'enc_0', name: '9월 시범 설치', hint: 'H2KD', lab_id: 'lab_b', lab_name: '공용 연구실 B', auto_approve: true, max_uses: 5, uses: 5,
    expires_at: '2026-09-30T00:00:00Z', enabled: false, status: 'disabled', created_by: 'admin', kind: 'admin',
    created_at: '2026-09-02T09:00:00Z', last_used_at: '2026-09-02T09:20:00Z' },
];
const mockSettings: InstallSettings = {
  lab_install_enabled: true, lab_install_roles: ['admin', 'operator'], auto_approve_roles: [], token_hours: 24, max_uses: 40,
  user_active_tokens: 5, pending_warn: 100, kiosk: true, server_url: '', server_cert_sha256: '',
  msi: { name: 'MOAVI-Desk-0.9.1-x64.msi', version: '0.9.1', sha256: '497CF5166B3275C043C3AC937C83DE31D4D95E3B9E488D655AB1759F3A0EAB42',
    size: 47_085_568, uploaded_at: '2026-10-14T08:30:00Z', uploaded_by: 'admin' },
};

function statusOf(c: EnrollCode): EnrollCodeStatus {
  if (!c.enabled) return 'disabled';
  if (c.expires_at && new Date(c.expires_at).getTime() <= Date.now()) return 'expired';
  if (c.max_uses && c.uses >= c.max_uses) return 'used_up';
  return 'active';
}

function mockCmd(code: string | null, kiosk: boolean) {
  const host = window.location.hostname;
  return new Blob([[
    '@echo off', 'chcp 65001 >nul', `rem MOAVI Desk ${code ? '실습실 PC 설치 (단말 등록)' : '클라이언트 설치'} (모의 모드)`,
    `rem msiexec /i ... /qn SERVER=${host} PORT=443 HTTPS=1${kiosk ? ' KIOSK=1' : ''}${code ? ` ENROLL_TOKEN=${code}` : ''}`,
  ].join('\r\n') + '\r\n'], { type: 'application/octet-stream' });
}

const mockEnrollApi: typeof realEnrollApi = {
  codes: () => delay(mockCodes.map((c) => ({ ...c, status: statusOf(c) }))),
  create: (body) => {
    if (!body.name?.trim()) return fail(400, 'A name of 1-80 characters is required');
    const { code, hint } = randomCode();
    const c: EnrollCode = { id: `enc_${mockSeq++}`, name: body.name.trim(), hint, lab_id: body.lab_id || null,
      lab_name: body.lab_id ? LABS[body.lab_id] ?? body.lab_id : null, auto_approve: !!body.auto_approve, max_uses: body.max_uses ?? 0,
      uses: 0, expires_at: body.days ? new Date(Date.now() + body.days * 86400e3).toISOString() : null, enabled: true, status: 'active',
      created_by: 'admin', kind: 'admin', created_at: new Date().toISOString(), last_used_at: null };
    mockCodes.unshift(c);
    return delay({ code, enroll_code: { ...c } });
  },
  update: (id, body) => {
    const c = mockCodes.find((x) => x.id === id);
    if (!c) return fail(404, 'Enrolment code not found');
    Object.assign(c, body);
    if ('lab_id' in body) c.lab_name = c.lab_id ? LABS[c.lab_id] ?? c.lab_id : null;
    return delay({ ...c, status: statusOf(c) });
  },
  remove: (id) => {
    const i = mockCodes.findIndex((x) => x.id === id);
    if (i < 0) return fail(404, 'Enrolment code not found');
    mockCodes.splice(i, 1);
    return delay(undefined);
  },
  approve: (ids, lab_id) => {
    const done: Terminal[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const t = mockTerminals.find((x) => x.id === id);
      if (!t) { missing.push(id); continue; }
      t.state = 'approved';
      if (lab_id) t.lab_id = lab_id;
      // the agent picks its key up with the next heartbeat: in the mock it already did
      if (t.enrollment?.state === 'waiting') {
        t.enrollment = { ...t.enrollment, state: 'delivered', delivered_at: new Date().toISOString(), last_poll_at: new Date().toISOString() };
        t.has_key = true;
      }
      done.push({ ...t });
    }
    return delay({ terminals: done, missing });
  },
  reject: (ids) => {
    const done: Terminal[] = [];
    for (const id of ids) {
      const t = mockTerminals.find((x) => x.id === id);
      if (!t) continue;
      t.state = 'rejected'; t.has_key = false;
      if (t.enrollment) t.enrollment = { ...t.enrollment, state: 'rejected', online: false };
      done.push({ ...t });
    }
    return delay({ terminals: done, missing: [] });
  },
  resendKey: (id) => {
    const t = mockTerminals.find((x) => x.id === id);
    if (!t?.enrollment) return fail(409, 'This terminal has no agent to send a key to');
    t.enrollment = { ...t.enrollment, state: 'waiting' };
    return delay(undefined);
  },
  installer: (code, kiosk) => (mockSettings.msi ? delay(mockCmd(code, kiosk)) : fail(409, 'Put the client MSI on the server first')),
  settings: () => delay({ ...mockSettings, msi_ready: !!mockSettings.msi, pending: mockTerminals.filter((t) => t.state === 'pending').length }),
  saveSettings: (s) => { Object.assign(mockSettings, s); return delay({ ...mockSettings, msi_ready: !!mockSettings.msi }); },
  uploadMsi: (file) => {
    if (!file.name.toLowerCase().endsWith('.msi')) return fail(400, 'file: the MOAVI Desk client .msi');
    mockSettings.msi = { name: file.name, version: file.name.match(/\d+\.\d+\.\d+/)?.[0] ?? '', sha256: 'C0FFEE'.padEnd(64, '0'),
      size: file.size, uploaded_at: new Date().toISOString(), uploaded_by: 'admin' };
    return delay(mockSettings.msi);
  },
  deleteMsi: () => { mockSettings.msi = null; return delay(undefined); },
  labInstallInfo: () => delay({ enabled: mockSettings.lab_install_enabled, allowed: mockSettings.lab_install_enabled, msi_ready: !!mockSettings.msi,
    personal_installer: !!mockSettings.msi, labs: [{ id: 'lab_a', name: '교육장 A', location: '본관 3층 301호' }, { id: 'lab_b', name: '공용 연구실 B', location: '연구동 2층' }],
    max_uses: mockSettings.max_uses, hours: mockSettings.token_hours, auto_approve: false }),
  labInstallFile: (lab_id, uses) => {
    const { code, hint } = randomCode();
    mockCodes.unshift({ id: `enc_${mockSeq++}`, name: 'admin 포털 설치', hint, lab_id, lab_name: lab_id ? LABS[lab_id] : null, auto_approve: false,
      max_uses: uses, uses: 0, expires_at: new Date(Date.now() + mockSettings.token_hours * 3600e3).toISOString(), enabled: true, status: 'active',
      created_by: 'admin', kind: 'user', created_at: new Date().toISOString(), last_used_at: null });
    return delay(mockCmd(code, mockSettings.kiosk));
  },
  personalInstaller: () => delay(mockCmd(null, false)),
};

export const enrollApi = isMock ? mockEnrollApi : realEnrollApi;

/** The kiosk admin password as MOAVI Desk Client keeps it (Services/PasswordHasher.cs): PBKDF2-SHA256, 100 000 rounds,
 *  16-byte salt, 32-byte hash, "iterations.salt.hash" in base64. Made in the browser; the password never leaves it. */
export async function kioskPasswordHash(password: string): Promise<string> {
  const iterations = 100_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  return `${iterations}.${b64(salt)}.${b64(new Uint8Array(bits))}`;
}

/** The engine as the PCs reach it: this console's own address (the same origin serves the API). */
export function serverOfConsole(): { host: string; port: number; https: boolean } {
  const u = new URL(window.location.origin);
  const https = u.protocol === 'https:';
  return { host: u.hostname, port: Number(u.port) || (https ? 443 : 80), https };
}

/** The unattended install line for a deployment tool (GPO, SCCM, Intune, PDQ …). */
export function msiexecLine(o: { host: string; port: number; https: boolean; code: string; kiosk: boolean; passwordHash?: string; certSha256?: string; msi?: string }): string {
  const parts = [`msiexec /i ${o.msi || 'MOAVI-Desk-x64.msi'} /qn`, `SERVER=${o.host}`, `PORT=${o.port}`, `HTTPS=${o.https ? 1 : 0}`];
  if (o.kiosk) parts.push('KIOSK=1');
  if (o.passwordHash) parts.push(`KIOSK_PASSWORD_HASH="${o.passwordHash}"`);
  if (o.certSha256) parts.push(`SERVER_CERT_SHA256=${o.certSha256}`);
  parts.push(`ENROLL_CODE=${o.code}`);
  return parts.join(' ');
}
