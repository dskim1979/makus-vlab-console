// 공유 저장소: a pool's NAS share with folders by purpose - home, project, scratch (makus-vlab
// pegaprox/vlab/nas.py, /api/vlab/admin/pools/<id>/storage and /api/vlab/me/storage). Linux guests
// reach it through autofs, Windows through a sign-in script in the user's own session; the engine
// checks through the guest agent on connect, on routing into a shared pool and before a build job.
import { ApiError, isMock, request } from './client';
import { mockVmStore } from './mockAdmin';
import type { FolderKey, StorageFolder, StorageResult } from './types';

export type StorageKind = 'nfs' | 'smb';
export type SmbAuth = 'kerberos' | 'service';
export type FolderTemplate = { enabled: boolean; rule: string; drive: string; quota_gb: number; retention_days?: number };
export type PoolStorage = {
  enabled: boolean; kind: StorageKind; server: string; share: string; nfs_version: '3' | '4.1' | 'krb5'; options: string;
  linux_path: string; create_by: 'user' | 'engine'; admin_path: string; private: boolean; build_workdir: boolean;
  smb_auth: SmbAuth; smb_domain: string; smb_user: string; has_password: boolean;
  // Windows office desktops: 바탕 화면 · 문서 · 다운로드 · 사진 on the home drive; C: hidden and refused
  win_redirect: boolean; win_block_local: boolean;
  folders: Record<FolderKey, FolderTemplate>;
};
export type PoolStorageInput = Omit<PoolStorage, 'has_password'> & { smb_password?: string; clear_password?: boolean };
export type StorageRow = StorageResult & { desktop_id: string; desktop: string | null; username: string; pool_id: string; usage_at: string | null };
export type PoolStorageAnswer = {
  storage: PoolStorage;
  status: { ok: number; failed: number; pending: number; warnings: number; last: StorageRow | null };
  results: StorageRow[];
  autofs: Record<string, string> | null;
  data_on_nas_only: boolean;
  checked?: (StorageResult & { desktop: string; desktop_id: string; username: string })[];
};
export type MyFolder = {
  pool_id: string; pool: string; pool_type: string; kind: StorageKind; folders: Partial<Record<FolderKey, StorageFolder>>;
  data_on_nas_only: boolean; usage: Partial<Record<FolderKey, number>>; usage_at: string | null; last: StorageResult | null;
};

export const FOLDER_KEYS: FolderKey[] = ['home', 'project', 'scratch'];
export const STORAGE_DEFAULTS: PoolStorage = {
  enabled: false, kind: 'nfs', server: '', share: '', nfs_version: '3', options: '', linux_path: '/nas', create_by: 'user', admin_path: '',
  private: true, build_workdir: true, smb_auth: 'kerberos', smb_domain: '', smb_user: '', has_password: false,
  win_redirect: false, win_block_local: false,
  folders: {
    home: { enabled: true, rule: 'home/{username}', drive: 'H', quota_gb: 0 },
    project: { enabled: false, rule: 'projects/{department}', drive: 'P', quota_gb: 0 },
    scratch: { enabled: true, rule: 'scratch/{username}', drive: 'S', quota_gb: 0, retention_days: 14 },
  },
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
const clone = (s: PoolStorage): PoolStorage => ({ ...s, folders: { home: { ...s.folders.home }, project: { ...s.folders.project }, scratch: { ...s.folders.scratch } } });
const store: Record<string, PoolStorage> = {};
const rows: StorageRow[] = [];
const farmId = () => mockVmStore.desks.find((d) => d.pool === 'FPGA 빌드 팜')?.pool_id ?? '';

function folderPaths(s: PoolStorage, user: string, pool: string): Partial<Record<FolderKey, StorageFolder>> {
  const out: Partial<Record<FolderKey, StorageFolder>> = {};
  for (const k of FOLDER_KEYS) {
    const f = s.folders[k];
    if (!f.enabled) continue;
    const folder = f.rule.replace('{username}', user).replace('{department}', 'FPGA설계팀').replace('{pool}', pool.replace(/[^\w.-]+/g, '_'));
    out[k] = {
      folder, linux: `${s.linux_path}/${folder}`, windows: s.kind === 'smb' ? `${f.drive}:\\` : null, quota_gb: f.quota_gb,
      ...(k === 'scratch' ? { retention_days: f.retention_days } : {}),
      nas: s.kind === 'smb' ? `\\\\${s.server}\\${s.share}\\${folder.replace(/\//g, '\\')}` : `${s.server}:${s.share}/${folder}`,
    };
  }
  return out;
}

function seed() {
  const id = farmId();
  if (!id || store[id]) return;
  const s = clone(STORAGE_DEFAULTS);
  Object.assign(s, { enabled: true, server: 'nas01.lab.local', share: '/export/eda', options: 'nconnect=4' });
  s.folders.project = { ...s.folders.project, enabled: true };
  s.folders.scratch.quota_gb = 500;
  store[id] = s;
  mockVmStore.desks.filter((d) => d.pool_id === id).forEach((d, i) => {
    const user = d.assigned_user ?? '';
    rows.push({ desktop_id: d.id, desktop: d.name, username: user, pool_id: id, ok: i === 0, code: i === 0 ? 'OK' : 'FOLDER_DENIED',
      detail: i === 0 ? '' : `home/${user}: ${user} may not make it (the top folder needs mode 1777 or write for the users group)`,
      path: `/nas/home/${user}`, os: 'linux', at: new Date(Date.now() - (i + 1) * 47 * 60e3).toISOString(), changed: i === 0,
      warnings: i === 0 ? ['PROJECT_MISSING'] : [], usage: i === 0 ? { home: 3_400_000, scratch: 182_000_000 } : {},
      usage_at: i === 0 ? new Date(Date.now() - 2 * 3600e3).toISOString() : null });
  });
}

function autofs(s: PoolStorage) {
  const ver = { '3': 'vers=3', '4.1': 'vers=4.1', krb5: 'vers=4.1,sec=krb5p' }[s.nfs_version];
  const line = s.kind === 'nfs'
    ? `* ${['-fstype=nfs', ver, 'hard', s.options].filter(Boolean).join(',')} ${s.server}:${s.share}/&`
    : `* ${['-fstype=cifs', 'sec=krb5', 'multiuser', 'cruid=0', s.options].filter(Boolean).join(',')} ://${s.server}/${s.share}/&`;
  const head = '# MOAVI Desk shared storage - written by the engine; put the same in the template image\n';
  return { '/etc/auto.master.d/moavi.autofs': `${head}${s.linux_path} /etc/auto.moavi --timeout=600\n`, '/etc/auto.moavi': `${head}${line}\n` };
}

function answer(poolId: string): PoolStorageAnswer {
  seed();
  const list = rows.filter((r) => r.pool_id === poolId).sort((a, b) => b.at.localeCompare(a.at));
  const s = clone(store[poolId] ?? STORAGE_DEFAULTS);
  const type = mockVmStore.desks.find((d) => d.pool_id === poolId)?.pool;
  return { storage: s,
    status: { ok: list.filter((r) => r.ok === true).length, failed: list.filter((r) => r.ok === false).length,
      pending: list.filter((r) => r.ok === null).length, warnings: list.filter((r) => r.ok && r.warnings.length).length, last: list[0] ?? null },
    results: list.map((r) => ({ ...r })),
    autofs: s.enabled && !(s.kind === 'smb' && s.smb_auth === 'service') ? autofs(s) : null,
    data_on_nas_only: type === '공용 LAB A' || type === '교육장 A 수업용' };
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
      if (s.kind === 'nfs' && !/^\/[A-Za-z0-9._/-]*$/.test(s.share)) bad('share: an NFS export path like /export/eda');
      if (!FOLDER_KEYS.some((k) => s.folders[k].enabled)) bad('turn on at least one folder (home, project or scratch)');
      for (const k of ['home', 'scratch'] as const) if (!s.folders[k].rule.includes('{username}')) bad(`folders.${k}.rule must contain {username}`);
      if (s.folders.project.rule.includes('{username}')) bad("folders.project.rule is the team's folder: {department} or {pool}, not {username}");
      if (s.create_by === 'engine' && s.kind !== 'nfs') bad('create_by engine is for NFS; SMB folders are made by the user (FSLogix rights)');
      if (s.create_by === 'engine' && !s.admin_path) bad('create_by engine needs admin_path (the export mounted on the engine host)');
      if (s.kind === 'smb' && s.smb_auth === 'service' && (!s.smb_user || !(s.smb_password || (cur.has_password && !s.clear_password))))
        bad('the SMB service account needs a user name and a password');
      if (s.win_redirect && !s.folders.home.enabled) bad('win_redirect needs the home folder (the drive the folders go to)');
      if (s.win_block_local && !s.win_redirect) bad('win_block_local needs win_redirect - the folders users save to must be on the NAS first');
    }
    const { smb_password, clear_password, ...rest } = s;
    store[poolId] = clone({ ...rest, has_password: smb_password ? true : clear_password ? false : cur.has_password });
    return wait(clone(store[poolId]));
  },
  check: (poolId: string) => {
    seed();
    const s = store[poolId];
    if (!s?.enabled) return Promise.reject(new ApiError(409, 'Shared storage is off for this pool'));
    const checked = mockVmStore.desks.filter((d) => d.pool_id === poolId).slice(0, 10).map((d) => {
      const user = d.assigned_user ?? '';
      const f = user ? folderPaths(s, user, d.pool) : {};
      const r: StorageRow = { desktop_id: d.id, desktop: d.name, username: user, pool_id: poolId, ok: true, code: 'OK', detail: '',
        path: (f.home ?? f.scratch)?.linux ?? s.linux_path, os: 'linux', at: nowIso(), changed: false,
        warnings: s.folders.project.enabled ? ['PROJECT_MISSING'] : [], usage: user ? { home: 3_500_000, scratch: 120_000_000 } : {}, usage_at: nowIso() };
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
    if (!s?.enabled) return wait([] as MyFolder[]);
    const folders = folderPaths(s, 'alice', 'FPGA 빌드 팜');
    return wait([{ pool_id: id, pool: 'FPGA 빌드 팜', pool_type: 'buildfarm', kind: s.kind, folders, data_on_nas_only: false,
      usage: { home: 3_400_000, scratch: 182_000_000 }, usage_at: new Date(Date.now() - 2 * 3600e3).toISOString(),
      last: { ok: true, code: 'OK', detail: '', path: folders.home?.linux ?? '', os: 'linux', at: new Date(Date.now() - 3 * 864e5).toISOString(),
        changed: false, warnings: [], usage: {} } }]);
  },
};

export const storageApi = isMock ? mock : real;

// a size in KB as the portal shows it
export function sizeText(kb: number | undefined): string {
  if (kb === undefined) return '-';
  const gb = kb / 1024 / 1024;
  return gb >= 100 ? `${Math.round(gb)} GB` : gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`;
}

export function folderName(k: FolderKey, L: (ko: string, en: string) => string): string {
  return k === 'home' ? L('홈', 'Home') : k === 'project' ? L('프로젝트', 'Project') : L('스크래치 · 빌드', 'Scratch / build');
}

// what a result or warning code means, for the pool page and the portal
export function storageCodeText(code: string, L: (ko: string, en: string) => string): string {
  const m: Record<string, [string, string]> = {
    OK: ['정상', 'Ready'],
    PENDING: ['게스트에서 아직 진행 중', 'Still running on the guest'],
    NOT_RUNNING: ['VM이 꺼져 있음', 'The VM is off'],
    NO_AGENT: ['게스트 에이전트 응답 없음 (qemu-guest-agent 설치, VM 옵션 agent: 1)', 'No guest agent (install qemu-guest-agent, VM option agent: 1)'],
    AGENT_ERROR: ['게스트 에이전트가 명령을 거부함', 'The guest agent refused the command'],
    BAD_NAME: ['사용자 이름을 폴더 이름으로 쓸 수 없음', 'The user name cannot be a folder name'],
    MOUNT_FAILED: ['마운트 실패 (서버 · 공유 경로 · 방화벽 · export 허용 대상 확인)', 'Mount failed (check server, share, firewall, export clients)'],
    FOLDER_DENIED: ['사용자가 자기 폴더를 만들 수 없음 (상위 폴더 권한 1777 또는 FSLogix 권한 필요)', 'The user may not make their folder (top folder needs 1777 or the FSLogix rights)'],
    ENGINE_FOLDER: ['엔진이 폴더를 만들지 못함 (엔진 호스트의 관리용 마운트 · no_root_squash 확인)', 'The engine could not make the folder (check its admin mount and no_root_squash)'],
    NO_USER: ['VM 안에 그 사용자 계정이 없음 (AD · LDAP 로그인 연동 확인)', 'No such account on the VM (check AD/LDAP sign-in)'],
    NO_CLIENT: ['VM에 nfs-common / cifs-utils 가 없음', 'nfs-common / cifs-utils missing on the VM'],
    OWNER: ['폴더가 다른 사용자 소유 (사용자 ID 불일치?)', 'The folder belongs to someone else (ids differ?)'],
    UNSUPPORTED: ['Windows 데스크톱은 SMB로만 연결', 'Windows desktops take SMB only'],
    NO_CREDENTIAL: ['서비스 계정 비밀번호가 없음', 'No service account password'],
    LOCAL_ACCOUNT: ['VM 로컬 계정 — NAS와 사용자 ID가 달라 "본인만" 보장 안 됨', 'Local VM account - its id is not the NAS\'s, "owner only" not guaranteed'],
    NO_AUTOFS: ['autofs 없음 — 직접 마운트함 (템플릿에 autofs 설치 권장)', 'No autofs - mounted directly (install autofs in the template)'],
    PROJECT_MISSING: ['프로젝트 폴더가 아직 없음 (관리자가 NAS에서 팀 그룹으로 만듦)', 'Project folder missing (the admin makes it on the NAS with the team group)'],
    AT_SIGN_IN: ['다음 로그인 때 사용자 권한으로 연결 · 생성', 'Mapped and made at the next sign-in, as the user'],
    OVER_QUOTA: ['할당량 초과', 'Over quota'],
  };
  const v = m[code];
  return v ? L(v[0], v[1]) : code || '-';
}
