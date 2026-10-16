// 공유 저장소: a pool's NAS share and each user's build folder on it (makus-vlab pegaprox/vlab/nas.py,
// /api/vlab/admin/pools/<id>/storage and /api/vlab/me/storage). The engine mounts it through the
// guest agent when someone connects, routes into a shared pool or starts a build job.
import { ApiError, isMock, request } from './client';
import { mockVmStore } from './mockAdmin';
import type { StoragePaths, StorageResult } from './types';

export type StorageKind = 'nfs' | 'smb';
export type SmbAuth = 'kerberos' | 'service';
export type PoolStorage = {
  enabled: boolean; kind: StorageKind; server: string; share: string; options: string;
  linux_path: string; windows_drive: string; folder_rule: string; private: boolean; build_workdir: boolean;
  smb_auth: SmbAuth; smb_domain: string; smb_user: string; has_password: boolean;
};
export type PoolStorageInput = Omit<PoolStorage, 'has_password'> & { smb_password?: string; clear_password?: boolean };
export type StorageRow = StorageResult & { desktop_id: string; desktop: string | null; username: string; pool_id: string };
export type PoolStorageAnswer = {
  storage: PoolStorage;
  status: { ok: number; failed: number; pending: number; last: StorageRow | null };
  results: StorageRow[];
  checked?: (StorageResult & { desktop: string; desktop_id: string; username: string })[];
};
export type MyFolder = { pool_id: string; pool: string; pool_type: string; paths: StoragePaths; last: StorageResult | null };

export const STORAGE_DEFAULTS: PoolStorage = {
  enabled: false, kind: 'nfs', server: '', share: '', options: '', linux_path: '/mnt/nas', windows_drive: 'Z',
  folder_rule: '{username}', private: true, build_workdir: true, smb_auth: 'kerberos', smb_domain: '', smb_user: '', has_password: false,
};

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
  pool: (poolId: string) => call<PoolStorageAnswer>('GET', `/api/vlab/admin/pools/${enc(poolId)}/storage`),
  save: async (poolId: string, s: PoolStorageInput) =>
    (await call<{ storage: PoolStorage }>('PUT', `/api/vlab/admin/pools/${enc(poolId)}/storage`, s)).storage,
  check: (poolId: string, desktopId?: string) =>
    call<PoolStorageAnswer>('POST', `/api/vlab/admin/pools/${enc(poolId)}/storage/check`, desktopId ? { desktop_id: desktopId } : {}),
  mine: async () => (await call<{ folders: MyFolder[] }>('GET', '/api/vlab/me/storage')).folders,
};

// --- mock: the build farm has an NFS share; every other pool starts without one -------------

const nowIso = () => new Date().toISOString();
const store: Record<string, PoolStorage> = {};
const rows: StorageRow[] = [];
const farmId = () => mockVmStore.desks.find((d) => d.pool === 'FPGA 빌드 팜')?.pool_id ?? '';

function seed() {
  const id = farmId();
  if (!id || store[id]) return;
  store[id] = { ...STORAGE_DEFAULTS, enabled: true, server: 'nas01.lab.local', share: '/export/fpga', options: 'vers=4.1', folder_rule: 'builds/{username}' };
  const desks = mockVmStore.desks.filter((d) => d.pool_id === id);
  desks.forEach((d, i) => {
    const user = d.assigned_user ?? '';
    rows.push({ desktop_id: d.id, desktop: d.name, username: user, pool_id: id, ok: i === 0, code: i === 0 ? 'OK' : 'FOLDER_DENIED',
      detail: i === 0 ? '' : `root_squash or share permissions: builds/${user} could not be made`,
      path: `/mnt/nas/builds/${user}`, os: 'linux', at: new Date(Date.now() - (i + 1) * 47 * 60e3).toISOString(), changed: i === 0 });
  });
}

function paths(s: PoolStorage, user: string, pool: string): StoragePaths {
  const folder = s.folder_rule.replace('{username}', user).replace('{department}', 'FPGA설계팀').replace('{pool}', pool.replace(/[^\w.-]+/g, '_'));
  return {
    linux: `${s.linux_path}/${folder}`, windows: s.kind === 'smb' ? `${s.windows_drive}:\\` : null, folder, kind: s.kind,
    nas: s.kind === 'smb' ? `\\\\${s.server}\\${s.share.replace(/\//g, '\\')}\\${folder.replace(/\//g, '\\')}` : `${s.server}:${s.share}/${folder}`,
  };
}

function answer(poolId: string): PoolStorageAnswer {
  seed();
  const list = rows.filter((r) => r.pool_id === poolId).sort((a, b) => b.at.localeCompare(a.at));
  return { storage: { ...(store[poolId] ?? STORAGE_DEFAULTS) },
    status: { ok: list.filter((r) => r.ok === true).length, failed: list.filter((r) => r.ok === false).length,
      pending: list.filter((r) => r.ok === null).length, last: list[0] ?? null },
    results: list.map((r) => ({ ...r })) };
}

const wait = <T,>(v: T, ms = 200) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const bad = (msg: string): never => { throw new ApiError(400, msg); };

const mock = {
  pool: (poolId: string) => wait(answer(poolId)),
  save: (poolId: string, s: PoolStorageInput) => {
    seed();
    const cur = store[poolId] ?? STORAGE_DEFAULTS;
    if (s.enabled) {
      if (!s.server || !s.share) bad('server and share are required');
      if (s.kind === 'nfs' && !/^\/[A-Za-z0-9._/-]*$/.test(s.share)) bad('share: an NFS export path like /export/fpga');
      if (!s.folder_rule.includes('{username}')) bad('folder_rule: letters, digits, . _ - and / with {username} in it (also {department}, {pool})');
      if (s.kind === 'smb' && s.smb_auth === 'service' && (!s.smb_user || !(s.smb_password || (cur.has_password && !s.clear_password))))
        bad('the SMB service account needs a user name and a password');
    }
    const { smb_password, clear_password, ...rest } = s;
    store[poolId] = { ...rest, windows_drive: rest.windows_drive.replace(':', '').toUpperCase(),
      has_password: smb_password ? true : clear_password ? false : cur.has_password };
    return wait({ ...store[poolId] });
  },
  check: (poolId: string) => {
    seed();
    const s = store[poolId];
    if (!s?.enabled) return Promise.reject(new ApiError(409, 'Shared storage is off for this pool'));
    const checked = mockVmStore.desks.filter((d) => d.pool_id === poolId).slice(0, 10).map((d) => {
      const user = d.assigned_user ?? '';
      const r: StorageRow = { desktop_id: d.id, desktop: d.name, username: user, pool_id: poolId, ok: true, code: 'OK', detail: '',
        path: user ? paths(s, user, d.pool).linux : s.linux_path, os: 'linux', at: nowIso(), changed: false };
      const i = rows.findIndex((x) => x.desktop_id === d.id && x.username === user);
      if (i >= 0) rows[i] = r; else rows.push(r);
      return { ...r };
    });
    return wait({ ...answer(poolId), checked }, 900);
  },
  mine: () => {
    seed();
    const id = farmId();
    const s = store[id];
    return wait(s?.enabled ? [{ pool_id: id, pool: 'FPGA 빌드 팜', pool_type: 'buildfarm', paths: paths(s, 'alice', 'FPGA 빌드 팜'),
      last: { ok: true, code: 'OK', detail: '', path: paths(s, 'alice', 'FPGA 빌드 팜').linux, os: 'linux',
        at: new Date(Date.now() - 3 * 864e5).toISOString(), changed: false } }] : []);
  },
};

export const storageApi = isMock ? mock : real;

// what a result code means, for the pool page and the portal
export function storageCodeText(code: string, L: (ko: string, en: string) => string): string {
  const m: Record<string, [string, string]> = {
    OK: ['정상', 'Ready'],
    PENDING: ['게스트에서 아직 진행 중', 'Still running on the guest'],
    NOT_RUNNING: ['VM이 꺼져 있음', 'The VM is off'],
    NO_AGENT: ['게스트 에이전트 응답 없음 (qemu-guest-agent 설치, VM 옵션 agent: 1)', 'No guest agent (install qemu-guest-agent, VM option agent: 1)'],
    AGENT_ERROR: ['게스트 에이전트가 명령을 거부함', 'The guest agent refused the command'],
    BAD_NAME: ['사용자 이름을 폴더 이름으로 쓸 수 없음', 'The user name cannot be a folder name'],
    MOUNT_FAILED: ['마운트 실패 (서버 · 공유 경로 · 방화벽 · export 허용 대상 확인)', 'Mount failed (check server, share, firewall, export clients)'],
    FOLDER_DENIED: ['사용자 폴더를 만들 권한 없음 (NFS root_squash 또는 공유 권한)', 'No right to make the folder (NFS root_squash or share permissions)'],
    NO_USER: ['VM 안에 그 사용자 계정이 없음 (AD · LDAP 로그인 연동 확인)', 'No such account on the VM (check AD/LDAP sign-in)'],
    NO_CLIENT: ['VM에 nfs-common / cifs-utils 가 없음', 'nfs-common / cifs-utils missing on the VM'],
    OWNER: ['폴더가 다른 사용자 소유', 'The folder belongs to someone else'],
    UNSUPPORTED: ['Windows 데스크톱은 SMB로만 연결', 'Windows desktops take SMB only'],
    NO_CREDENTIAL: ['서비스 계정 비밀번호가 없음', 'No service account password'],
  };
  const v = m[code];
  return v ? L(v[0], v[1]) : code || '-';
}
