// LAB > 단말 관리: enrolment codes for installing MOAVI Desk Client on a room's PCs at once
// (makus-vlab pegaprox/api/vlab_enroll.py). The code goes into the MSI (ENROLL_CODE=...); each PC
// enrols on its first start and picks its kiosk key up once an admin approves it.
import { ApiError, isMock, request } from './client';
import { mockTerminals } from './mockAdmin';
import type { Terminal } from './types';

export type EnrollCodeStatus = 'active' | 'disabled' | 'expired' | 'used_up';
export type EnrollCode = {
  id: string; name: string; hint: string; lab_id: string | null; lab_name: string | null; auto_approve: boolean;
  max_uses: number; uses: number; expires_at: string | null; enabled: boolean; status: EnrollCodeStatus;
  created_by: string; created_at: string; last_used_at: string | null;
};
export type EnrollCodeInput = { name: string; lab_id?: string | null; auto_approve?: boolean; max_uses?: number; days?: number };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) throw new ApiError(status, data?.error || `HTTP ${status}`, data);
  return data;
}

const realEnrollApi = {
  codes: async () => (await call<{ codes: EnrollCode[] }>('GET', '/api/vlab/admin/enroll-codes')).codes,
  create: (body: EnrollCodeInput) => call<{ code: string; enroll_code: EnrollCode }>('POST', '/api/vlab/admin/enroll-codes', body),
  update: async (id: string, body: Partial<Pick<EnrollCode, 'name' | 'enabled' | 'lab_id' | 'auto_approve'>>) =>
    (await call<{ enroll_code: EnrollCode }>('PUT', `/api/vlab/admin/enroll-codes/${encodeURIComponent(id)}`, body)).enroll_code,
  remove: async (id: string) => { await call('DELETE', `/api/vlab/admin/enroll-codes/${encodeURIComponent(id)}`); },
  approve: (ids: string[], lab_id?: string | null) =>
    call<{ terminals: Terminal[]; missing: string[] }>('POST', '/api/vlab/admin/terminals/approve', { ids, lab_id: lab_id || null }),
};

// --- mock ------------------------------------------------------------------------------------

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));
const fail = (status: number, msg: string) => Promise.reject(new ApiError(status, msg));
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LABS: Record<string, string> = { lab_a: '교육장 A', lab_b: '공용 연구실 B' };
let mockSeq = 2;
const mockCodes: EnrollCode[] = [
  { id: 'enc_1', name: '301호 일괄 설치', hint: 'Q7MZ', lab_id: 'lab_a', lab_name: '교육장 A', auto_approve: false, max_uses: 40, uses: 6,
    expires_at: new Date(Date.now() + 5 * 86400e3).toISOString(), enabled: true, status: 'active', created_by: 'admin',
    created_at: '2026-10-14T08:40:00Z', last_used_at: new Date(Date.now() - 3 * 60e3).toISOString() },
  { id: 'enc_0', name: '9월 시범 설치', hint: 'H2KD', lab_id: 'lab_b', lab_name: '공용 연구실 B', auto_approve: true, max_uses: 5, uses: 5,
    expires_at: '2026-09-30T00:00:00Z', enabled: false, status: 'disabled', created_by: 'admin',
    created_at: '2026-09-02T09:00:00Z', last_used_at: '2026-09-02T09:20:00Z' },
];

function statusOf(c: EnrollCode): EnrollCodeStatus {
  if (!c.enabled) return 'disabled';
  if (c.expires_at && new Date(c.expires_at).getTime() <= Date.now()) return 'expired';
  if (c.max_uses && c.uses >= c.max_uses) return 'used_up';
  return 'active';
}

const mockEnrollApi: typeof realEnrollApi = {
  codes: () => delay(mockCodes.map((c) => ({ ...c, status: statusOf(c) }))),
  create: (body) => {
    if (!body.name?.trim()) return fail(400, 'A name of 1-80 characters is required');
    const r = Array.from({ length: 12 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
    const code = `MDE-${r.slice(0, 4)}-${r.slice(4, 8)}-${r.slice(8)}`;
    const c: EnrollCode = { id: `enc_${mockSeq++}`, name: body.name.trim(), hint: r.slice(8), lab_id: body.lab_id || null,
      lab_name: body.lab_id ? LABS[body.lab_id] ?? body.lab_id : null, auto_approve: !!body.auto_approve, max_uses: body.max_uses ?? 0,
      uses: 0, expires_at: body.days ? new Date(Date.now() + body.days * 86400e3).toISOString() : null, enabled: true, status: 'active',
      created_by: 'admin', created_at: new Date().toISOString(), last_used_at: null };
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
      // a waiting client picks its key up on its next poll: in the mock it already did
      if (t.enrollment?.state === 'waiting') {
        t.enrollment = { ...t.enrollment, state: 'delivered', delivered_at: new Date().toISOString(), last_poll_at: new Date().toISOString() };
        t.has_key = true;
      }
      done.push({ ...t });
    }
    return delay({ terminals: done, missing });
  },
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

/** The unattended install line for a room's PCs. */
export function msiexecLine(o: { host: string; port: number; https: boolean; code: string; kiosk: boolean; passwordHash?: string; msi?: string }): string {
  const parts = [`msiexec /i ${o.msi || 'MOAVI-Desk-x64.msi'} /qn`, `SERVER=${o.host}`, `PORT=${o.port}`, `HTTPS=${o.https ? 1 : 0}`];
  if (o.kiosk) parts.push('KIOSK=1');
  if (o.passwordHash) parts.push(`KIOSK_PASSWORD_HASH="${o.passwordHash}"`);
  parts.push(`ENROLL_CODE=${o.code}`);
  return parts.join(' ');
}
