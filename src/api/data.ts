// 연구 데이터: the dataset catalog, files between the portal and the user's NAS folders, and export
// control (makus-vlab pegaprox/vlab/datasets.py, pegaprox/api/vlab_data.py). Uploads go in parts that
// resume (POST to start, PATCH with Upload-Offset, GET for the offset); downloads are plain links the
// engine answers with Range, so the browser resumes them itself.
import { ApiError, isMock, request } from './client';
import { mockVmStore } from './mockAdmin';
import type { FolderKey, StorageFolder } from './types';

export type ExportRule = 'allow' | 'approval' | 'deny';
export type Subject = { subject_type: 'user' | 'department' | 'group'; subject_id: string };
export type DataPolicy = {
  export: ExportRule; upload: boolean; max_file_gb: number; link_hours: number; quota_block: boolean;
  sftp: { host: string; port: number; note: string };
};
export type SpaceFolder = StorageFolder & { usage_kb: number | null; quota_state: 'over' | 'near' | null };
export type Space = {
  pool_id: string; pool: string; pool_type: string; kind: 'nfs' | 'smb'; folders: Partial<Record<FolderKey, SpaceFolder>>;
  usage_at: string | null; mode: 'engine' | 'agent' | 'none'; policy: DataPolicy; data_on_nas_only: boolean;
};
export type Entry = { name: string; type: 'dir' | 'file' | 'link'; size: number; mtime: string };
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
export type DataRequest = {
  id: string; username: string; pool_id: string; dataset_id: string; folder: string; path: string; size: number; reason: string;
  status: RequestStatus; reviewed_by: string; reviewed_at: string | null; note: string; expires_at: string | null; started_at: string | null;
  created_at: string; dataset?: string | null; pool?: string | null;
};
export type Upload = {
  id: string; username: string; pool_id: string; folder: FolderKey; path: string; name: string; size: number; received: number;
  via: 'engine' | 'agent'; overwrite: boolean; created_at: string; updated_at: string;
};
export type MyData = { spaces: Space[]; requests: DataRequest[]; uploads: Upload[]; chunk: number; agent_max: number };
export type DatasetPath = { pool_id: string; pool: string; linux: string; windows: string | null };
export type Dataset = {
  id: string; name: string; title: string; description: string; version: string; license: string; source: string; tags: string[];
  size_bytes: number | null; files: number | null; measured_at: string | null; export: ExportRule; kind: 'nfs' | 'smb';
  paths: DatasetPath[]; browsable: boolean; nas: string;
};
export type DatasetInput = {
  name: string; title: string; description: string; version: string; license: string; source: string; kind: 'nfs' | 'smb';
  server: string; share: string; nfs_version: '3' | '4.1' | 'krb5'; admin_path: string; pool_ids: string[]; access: Subject[];
  export: ExportRule; tags: string[]; enabled: boolean;
};
export type AdminDataset = DatasetInput & {
  id: string; size_bytes: number | null; files: number | null; measured_at: string | null; measure_error: string; created_by: string;
  created_at: string; updated_at: string; nas: string; mounted: boolean; linux: string; windows: string | null;
};
export type PoolRef = { id: string; name: string; type: string; storage: boolean; linux_path: string | null; kind: string | null; admin_mount: boolean };
export type AdminDatasets = { datasets: AdminDataset[]; pools: PoolRef[]; pending: number; windows_root: string };
export type PoliciesAnswer = { policies: (PoolRef & { policy: DataPolicy })[]; defaults: DataPolicy; agent_max: number };
export type UsageFolder = { pool_id: string; pool: string; username: string; folder: FolderKey; usage_kb: number; quota_gb: number; state: 'over' | 'near' | null; at: string | null };
export type UsageAnswer = {
  datasets: { id: string; name: string; title: string; size_bytes: number | null; files: number | null; measured_at: string | null; measure_error: string }[];
  folders: UsageFolder[]; totals: { datasets_bytes: number; folders_kb: number; over: number; near: number };
};
export type Transfer = {
  id: string; at: string; username: string; direction: 'upload' | 'download'; pool_id: string; dataset_id: string; folder: string; path: string;
  size: number; sha256: string; ok: boolean; error: string; via: string; request_id: string; ip: string; dataset?: string | null; pool?: string | null;
};
export type TransferReport = {
  days: number; since: string;
  totals: { downloads: number; download_bytes: number; uploads: number; upload_bytes: number; failed: number; approved_links: number };
  by_user: { username: string; downloads: number; download_bytes: number; uploads: number; upload_bytes: number }[];
  by_source: { key: string; name: string; kind: 'dataset' | 'folder'; downloads: number; download_bytes: number; uploads: number; upload_bytes: number; users: number }[];
  recent: Transfer[];
};
export type UploadDone = { done: true; sha256: string; path: string; size: number };
export type Target = { pool_id: string; folder: FolderKey; path: string };

const enc = encodeURIComponent;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string; code?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const d = data as { error?: string; code?: string } | null;
    throw new ApiError(status, d?.code || d?.error || `HTTP ${status}`, d);
  }
  return data;
}

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const folderQ = (t: Target, path: string) => q({ pool_id: t.pool_id, folder: t.folder, path });

/** The code of an engine refusal (APPROVAL_REQUIRED, EXPORT_DENIED, NO_ROUTE, ...). */
export function errCode(e: unknown): string {
  const b = (e as ApiError)?.body as { code?: string } | undefined;
  return b?.code || (e as Error)?.message || 'error';
}

async function patchPart(id: string, offset: number, blob: Blob, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`/api/vlab/me/data/uploads/${enc(id)}`, {
      method: 'PATCH', credentials: 'same-origin', signal, body: blob,
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) },
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as { offset?: number; done?: boolean; sha256?: string; path?: string; size?: number; code?: string; error?: string } };
}

const real = {
  mine: () => call<MyData>('GET', '/api/vlab/me/data'),
  files: (t: Target, path: string) => call<{ path: string; entries: Entry[]; mode: string; export: ExportRule }>('GET', `/api/vlab/me/data/files?${folderQ(t, path)}`),
  downloadUrl: (t: Target, path: string) => `/api/vlab/me/data/download?${folderQ(t, path)}`,
  // asked first (?probe=1: every check, nothing sent): a refusal shows as a message, not a broken download
  checkDownload: async (url: string) => {
    const { status, data } = await request<{ code?: string; error?: string }>('GET', `${url}&probe=1`);
    if (status >= 400) throw new ApiError(status, data?.code || data?.error || `HTTP ${status}`, data);
  },
  mkdir: (t: Target, path: string, name: string) => call<{ ok: boolean }>('POST', '/api/vlab/me/data/mkdir', { pool_id: t.pool_id, folder: t.folder, path, name }),
  uploads: async () => (await call<{ uploads: Upload[] }>('GET', '/api/vlab/me/data/uploads')).uploads,
  cancelUpload: (id: string) => call<{ ok: boolean }>('DELETE', `/api/vlab/me/data/uploads/${enc(id)}`),
  /** Send a file in parts; picks up an unfinished upload of the same file to the same place. */
  upload: async (file: File, t: Target, opts: { overwrite?: boolean; onProgress?: (sent: number) => void; signal?: AbortSignal } = {}): Promise<UploadDone> => {
    const open = (await real.uploads()).find((u) => u.pool_id === t.pool_id && u.folder === t.folder && u.path === t.path && u.name === file.name && u.size === file.size);
    let id: string, offset: number, chunk: number;
    if (open) {
      const st = await call<{ offset: number; chunk: number }>('GET', `/api/vlab/me/data/uploads/${enc(open.id)}`);
      [id, offset, chunk] = [open.id, st.offset, st.chunk];
    } else {
      const st = await call<{ id: string; offset: number; chunk: number } & Partial<UploadDone>>('POST', '/api/vlab/me/data/uploads',
        { pool_id: t.pool_id, folder: t.folder, path: t.path, name: file.name, size: file.size, overwrite: !!opts.overwrite });
      if (st.done) return st as UploadDone;
      [id, offset, chunk] = [st.id, st.offset, st.chunk];
    }
    let tries = 0;
    for (;;) {
      opts.onProgress?.(offset);
      const r = await patchPart(id, offset, file.slice(offset, Math.min(file.size, offset + chunk)), opts.signal).catch((e) => {
        if ((e as Error).name === 'AbortError') throw e;
        return { status: 0, data: {} as { offset?: number; code?: string; error?: string } };
      });
      if (r.status === 201 && (r.data as { done?: boolean }).done) { opts.onProgress?.(file.size); return r.data as UploadDone; }
      if (r.status === 200 && typeof r.data.offset === 'number') { offset = r.data.offset; tries = 0; continue; }
      if (r.status === 409 && typeof r.data.offset === 'number') { offset = r.data.offset; continue; }
      if ((r.status === 0 || r.status >= 500 && r.status !== 501) && tries < 6) {
        tries += 1;
        await new Promise((ok) => setTimeout(ok, Math.min(30000, 1000 * 2 ** tries)));
        const st = await call<{ offset: number }>('GET', `/api/vlab/me/data/uploads/${enc(id)}`).catch(() => null);
        if (st) offset = st.offset;
        continue;
      }
      throw new ApiError(r.status, r.data.code || r.data.error || `HTTP ${r.status}`, r.data);
    }
  },
  requests: async () => (await call<{ requests: DataRequest[] }>('GET', '/api/vlab/me/data/requests')).requests,
  ask: async (b: { pool_id?: string; folder?: string; dataset_id?: string; path: string; reason: string }) =>
    (await call<{ request: DataRequest }>('POST', '/api/vlab/me/data/requests', b)).request,
  cancelRequest: (id: string) => call<{ request: DataRequest }>('POST', `/api/vlab/me/data/requests/${enc(id)}/cancel`),
  link: (id: string) => call<{ url: string; expires_at: string }>('POST', `/api/vlab/me/data/requests/${enc(id)}/link`),
  datasets: (search = '') => call<{ datasets: Dataset[]; manage: boolean; windows_root: string }>('GET', `/api/vlab/datasets${search ? `?${q({ q: search })}` : ''}`),
  datasetFiles: (id: string, path: string) => call<{ path: string; entries: Entry[]; export: ExportRule }>('GET', `/api/vlab/datasets/${enc(id)}/files?${q({ path })}`),
  datasetUrl: (id: string, path: string) => `/api/vlab/datasets/${enc(id)}/download?${q({ path })}`,
  // 관리 콘솔
  adminDatasets: () => call<AdminDatasets>('GET', '/api/vlab/admin/datasets'),
  saveDataset: async (id: string | null, b: Partial<DatasetInput>) =>
    (await call<{ dataset: AdminDataset }>(id ? 'PUT' : 'POST', id ? `/api/vlab/admin/datasets/${enc(id)}` : '/api/vlab/admin/datasets', b)).dataset,
  deleteDataset: (id: string) => call<{ ok: boolean }>('DELETE', `/api/vlab/admin/datasets/${enc(id)}`),
  measure: async (id: string) => (await call<{ dataset: AdminDataset }>('POST', `/api/vlab/admin/datasets/${enc(id)}/measure`)).dataset,
  policies: () => call<PoliciesAnswer>('GET', '/api/vlab/admin/data/policies'),
  savePolicy: async (poolId: string, p: Partial<DataPolicy>) => (await call<{ policy: DataPolicy }>('PUT', `/api/vlab/admin/data/policies/${enc(poolId)}`, p)).policy,
  adminRequests: async (status?: RequestStatus) =>
    (await call<{ requests: DataRequest[] }>('GET', `/api/vlab/admin/data/requests${status ? `?status=${status}` : ''}`)).requests,
  approve: async (id: string, hours?: number, note = '') =>
    (await call<{ request: DataRequest }>('POST', `/api/vlab/admin/data/requests/${enc(id)}/approve`, { ...(hours ? { hours } : {}), note })).request,
  reject: async (id: string, note: string) => (await call<{ request: DataRequest }>('POST', `/api/vlab/admin/data/requests/${enc(id)}/reject`, { note })).request,
  usage: () => call<UsageAnswer>('GET', '/api/vlab/admin/data/usage'),
  report: (days: number, username = '') => call<TransferReport>('GET', `/api/vlab/admin/reports/data-transfers?${q({ days: String(days), ...(username ? { username } : {}) })}`),
  reportCsvUrl: (days: number, username = '') => `/api/vlab/admin/reports/data-transfers?${q({ days: String(days), format: 'csv', ...(username ? { username } : {}) })}`,
};

// --- mock: the build farm has the NAS (see storage.ts); two datasets, one waiting request ------

const wait = <T,>(v: T, ms = 180) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const now = () => new Date().toISOString();
const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const farm = () => mockVmStore.desks.find((d) => d.pool === 'FPGA 빌드 팜');
const labA = () => mockVmStore.desks.find((d) => d.pool === '공용 LAB A');
const fail = (status: number, code: string, msg = code): never => { throw new ApiError(status, code, { code, error: msg }); };
let seq = 1;

const POLICY: DataPolicy = { export: 'allow', upload: true, max_file_gb: 100, link_hours: 24, quota_block: false, sftp: { host: '', port: 22, note: '' } };
const m = {
  seeded: false,
  datasets: [] as AdminDataset[],
  policies: {} as Record<string, DataPolicy>,
  requests: [] as DataRequest[],
  transfers: [] as Transfer[],
  uploads: [] as (Upload & { data: number })[],
  tree: {} as Record<string, Entry[]>,     // "<pool>/<folder>/<path>" -> entries
};

function seed() {
  if (m.seeded) return;
  m.seeded = true;
  const f = farm()?.pool_id ?? 'pool_farm';
  m.policies[f] = { ...POLICY, export: 'approval', sftp: { host: 'nas01.lab.local', port: 22, note: 'AD 계정으로 로그인, /export/eda 아래 내 폴더만 보입니다' } };
  const base = { kind: 'nfs' as const, nfs_version: '3' as const, enabled: true, created_by: 'admin', created_at: ago(400), updated_at: ago(30), measure_error: '' };
  m.datasets = [
    { ...base, id: 'ds_1', name: 'imagenet', title: 'ImageNet ILSVRC 2012', description: '1,000 클래스 이미지 분류 데이터셋 (train 128만 장, val 5만 장).',
      version: '2012', license: '연구 목적 한정 (ImageNet 이용 약관)', source: 'https://image-net.org', server: 'nas01.lab.local', share: '/export/datasets/imagenet',
      admin_path: '/srv/moavi-data/imagenet', pool_ids: [], access: [], export: 'approval', tags: ['vision', 'classification'],
      size_bytes: 154_000_000_000, files: 1_331_167, measured_at: ago(20), nas: 'nas01.lab.local:/export/datasets/imagenet', mounted: true,
      linux: '/nas/datasets/imagenet', windows: null },
    { ...base, id: 'ds_2', name: 'asic-bench', title: '반도체 설계 벤치마크 (사내)', description: 'RTL · 넷리스트 · 타이밍 리포트. 국책 과제 산출물, 반출 금지.',
      version: 'v3.1', license: '과제 협약서 제12조 (외부 반출 금지)', source: '사내 설계팀', server: 'nas01.lab.local', share: '/export/datasets/asic-bench',
      admin_path: '', pool_ids: [f], access: [{ subject_type: 'department', subject_id: 'dep_fpga' }, { subject_type: 'group', subject_id: 'ASIC-PRJ' }],
      export: 'deny', tags: ['eda', 'asic'], size_bytes: 820_000_000_000, files: 2_400_120, measured_at: ago(50),
      nas: 'nas01.lab.local:/export/datasets/asic-bench', mounted: false, linux: '/nas/datasets/asic-bench', windows: null },
  ];
  m.tree[`${f}/home/`] = [
    { name: 'projects', type: 'dir', size: 0, mtime: ago(5) }, { name: 'paper-draft.pdf', type: 'file', size: 2_400_000, mtime: ago(30) },
    { name: 'notes.md', type: 'file', size: 12_400, mtime: ago(2) },
  ];
  m.tree[`${f}/home/projects`] = [{ name: 'timing.rpt', type: 'file', size: 880_000, mtime: ago(8) }];
  m.tree[`${f}/scratch/`] = [{ name: 'job_20261014', type: 'dir', size: 0, mtime: ago(40) }, { name: 'bitstream.bit', type: 'file', size: 31_000_000, mtime: ago(3) }];
  m.tree[`${f}/project/`] = [{ name: 'shared', type: 'dir', size: 0, mtime: ago(100) }];
  m.tree['ds_1/'] = [{ name: 'train', type: 'dir', size: 0, mtime: ago(900) }, { name: 'val', type: 'dir', size: 0, mtime: ago(900) },
    { name: 'LICENSE.txt', type: 'file', size: 4_100, mtime: ago(900) }, { name: 'synsets.txt', type: 'file', size: 31_675, mtime: ago(900) }];
  m.tree['ds_1/train'] = [{ name: 'n01440764', type: 'dir', size: 0, mtime: ago(900) }];
  m.requests = [
    { id: 'dreq_1', username: 'alice', pool_id: f, dataset_id: '', folder: 'home', path: 'paper-draft.pdf', size: 2_400_000, reason: '학회 제출용 원고 (외부 공동 저자 검토)',
      status: 'pending', reviewed_by: '', reviewed_at: null, note: '', expires_at: null, started_at: null, created_at: ago(1), pool: 'FPGA 빌드 팜' },
    { id: 'dreq_2', username: 'bob', pool_id: '', dataset_id: 'ds_1', folder: '', path: 'LICENSE.txt', size: 4_100, reason: '라이선스 조건 확인',
      status: 'approved', reviewed_by: 'admin', reviewed_at: ago(3), note: '', expires_at: new Date(Date.now() + 20 * 3600e3).toISOString(), started_at: null,
      created_at: ago(5), dataset: 'imagenet' },
  ];
  const t = (h: number, username: string, direction: 'upload' | 'download', path: string, size: number, extra: Partial<Transfer> = {}): Transfer => ({
    id: `dx_${seq++}`, at: ago(h), username, direction, pool_id: f, dataset_id: '', folder: 'home', path, size, sha256: 'a3f1c9…', ok: true, error: '', via: 'engine',
    request_id: '', ip: '10.20.1.15', pool: 'FPGA 빌드 팜', ...extra });
  m.transfers = [
    t(2, 'alice', 'upload', 'scratch/alice/dataset-v2.tar', 48_000_000_000, { folder: 'scratch' }),
    t(6, 'bob', 'download', 'imagenet/LICENSE.txt', 4_100, { dataset_id: 'ds_1', dataset: 'imagenet', pool_id: '', pool: null, request_id: 'dreq_2' }),
    t(30, 'carol', 'download', 'home/carol/report.xlsx', 1_200_000),
    t(31, 'carol', 'download', 'home/carol/big.iso', 0, { ok: false, error: 'NO_ROUTE: no running desktop', via: 'agent' }),
  ];
}

function spaces(): Space[] {
  seed();
  const f = farm();
  if (!f) return [];
  const folder = (k: FolderKey, rel: string, quota: number, used: number | null): SpaceFolder => ({
    folder: rel, linux: `/nas/${rel}`, windows: null, nas: `nas01.lab.local:/export/eda/${rel}`, quota_gb: quota, usage_kb: used,
    quota_state: quota && used !== null ? (used > quota * 1048576 ? 'over' : used > quota * 1048576 * 0.9 ? 'near' : null) : null,
    ...(k === 'scratch' ? { retention_days: 14 } : {}) });
  return [{ pool_id: f.pool_id, pool: f.pool, pool_type: 'buildfarm', kind: 'nfs', mode: 'engine', usage_at: ago(2), data_on_nas_only: false,
    policy: m.policies[f.pool_id] ?? POLICY,
    folders: { home: folder('home', 'home/alice', 50, 3_400_000), project: folder('project', 'projects/FPGA설계팀', 0, null),
      scratch: folder('scratch', 'scratch/alice', 500, 470_000_000) } }];
}

const portalDs = (d: AdminDataset): Dataset => ({
  id: d.id, name: d.name, title: d.title, description: d.description, version: d.version, license: d.license, source: d.source, tags: d.tags,
  size_bytes: d.size_bytes, files: d.files, measured_at: d.measured_at, export: d.export, kind: d.kind, browsable: d.mounted, nas: d.nas,
  paths: spaces().filter((s) => !d.pool_ids.length || d.pool_ids.includes(s.pool_id))
    .map((s) => ({ pool_id: s.pool_id, pool: s.pool, linux: `/nas/datasets/${d.name}`, windows: s.kind === 'smb' && d.kind === 'smb' ? `D:\\datasets\\${d.name}` : null })),
});

function key(t: Target | string, path: string) { return typeof t === 'string' ? `${t}/${path}` : `${t.pool_id}/${t.folder}/${path}`; }
function checkPath(path: string) {
  if (path.split('/').includes('..') || path.startsWith('/') || path.includes('\\')) fail(400, 'BAD_PATH', 'path: .. is not allowed');
}
function rule(t: Target) { return (m.policies[t.pool_id] ?? POLICY).export; }
function poolRefs(): PoolRef[] {
  const out: PoolRef[] = [];
  for (const d of mockVmStore.desks) {
    if (out.some((p) => p.id === d.pool_id)) continue;
    const nasOn = d.pool === 'FPGA 빌드 팜';
    out.push({ id: d.pool_id, name: d.pool, type: d.pool === 'FPGA 빌드 팜' ? 'buildfarm' : 'dedicated', storage: nasOn, linux_path: nasOn ? '/nas' : null,
      kind: nasOn ? 'nfs' : null, admin_mount: nasOn });
  }
  return out;
}

const mock = {
  mine: () => wait<MyData>({ spaces: spaces(), requests: m.requests.filter((r) => r.username === 'alice' || r.username === 'bob').map((r) => ({ ...r })),
    uploads: m.uploads.map(({ data: _d, ...u }) => u), chunk: 8 * 1048576, agent_max: 10 * 1048576 }),
  files: (t: Target, path: string) => { seed(); checkPath(path); return wait({ path, entries: [...(m.tree[key(t, path)] ?? [])], mode: 'engine', export: rule(t) }); },
  downloadUrl: real.downloadUrl,
  checkDownload: async (url: string) => {
    seed();
    const p = new URLSearchParams(url.split('?')[1]);
    const ds = url.includes('/datasets/') ? m.datasets.find((d) => url.includes(`/datasets/${d.id}/`)) : null;
    const r = ds ? ds.export : (m.policies[p.get('pool_id') ?? ''] ?? POLICY).export;
    if (r === 'deny') fail(403, 'EXPORT_DENIED');
    if (r === 'approval') fail(403, 'APPROVAL_REQUIRED');
    return wait(undefined, 100).then(() => fail(501, 'MOCK', 'mock mode: nothing to download'));
  },
  mkdir: (t: Target, path: string, name: string) => {
    seed(); checkPath(path);
    if (!name || name.includes('/') || name === '..') fail(400, 'BAD_PATH');
    (m.tree[key(t, path)] ??= []).unshift({ name, type: 'dir', size: 0, mtime: now() });
    return wait({ ok: true });
  },
  uploads: () => wait(m.uploads.map(({ data: _d, ...u }) => u)),
  cancelUpload: (id: string) => { m.uploads = m.uploads.filter((u) => u.id !== id); return wait({ ok: true }); },
  upload: async (file: File, t: Target, opts: { overwrite?: boolean; onProgress?: (sent: number) => void; signal?: AbortSignal } = {}): Promise<UploadDone> => {
    seed(); checkPath(t.path);
    const list = (m.tree[key(t, t.path)] ??= []);
    if (list.some((e) => e.name === file.name) && !opts.overwrite) fail(409, 'EXISTS', `${file.name} exists`);
    const step = Math.max(file.size / 12, 1);
    for (let sent = 0; sent < file.size; sent += step) {
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      opts.onProgress?.(sent);
      await wait(null, 120);
    }
    opts.onProgress?.(file.size);
    const i = list.findIndex((e) => e.name === file.name);
    if (i >= 0) list.splice(i, 1);
    list.push({ name: file.name, type: 'file', size: file.size, mtime: now() });
    const path = [`${t.folder}/alice`, t.path, file.name].filter(Boolean).join('/');
    m.transfers.unshift({ id: `dx_${seq++}`, at: now(), username: 'alice', direction: 'upload', pool_id: t.pool_id, dataset_id: '', folder: t.folder,
      path, size: file.size, sha256: 'mock', ok: true, error: '', via: 'engine', request_id: '', ip: '127.0.0.1', pool: 'FPGA 빌드 팜' });
    return { done: true, sha256: '(mock) e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', path, size: file.size };
  },
  requests: () => { seed(); return wait(m.requests.map((r) => ({ ...r }))); },
  ask: (b: { pool_id?: string; folder?: string; dataset_id?: string; path: string; reason: string }) => {
    seed();
    if (!b.reason || b.reason.trim().length < 2) fail(400, 'BAD_REASON');
    const ds = m.datasets.find((d) => d.id === b.dataset_id);
    const r0 = ds ? ds.export : (m.policies[b.pool_id ?? ''] ?? POLICY).export;
    if (r0 === 'deny') fail(403, 'EXPORT_DENIED');
    if (r0 === 'allow') fail(409, 'NOT_NEEDED');
    const r: DataRequest = { id: `dreq_${seq++}`, username: 'alice', pool_id: b.pool_id ?? '', dataset_id: b.dataset_id ?? '', folder: b.folder ?? '', path: b.path,
      size: 1_000_000, reason: b.reason, status: 'pending', reviewed_by: '', reviewed_at: null, note: '', expires_at: null, started_at: null, created_at: now(),
      dataset: ds?.name ?? null, pool: ds ? null : 'FPGA 빌드 팜' };
    m.requests.unshift(r);
    return wait({ ...r });
  },
  cancelRequest: (id: string) => {
    const r = m.requests.find((x) => x.id === id);
    if (r && (r.status === 'pending' || r.status === 'approved')) r.status = 'cancelled';
    return wait({ request: { ...r! } });
  },
  link: (id: string) => {
    const r = m.requests.find((x) => x.id === id);
    if (!r || r.status !== 'approved') fail(409, 'NOT_APPROVED');
    return wait({ url: '#mock-link', expires_at: r!.expires_at ?? now() });
  },
  datasets: (search = '') => {
    seed();
    const s = search.trim().toLowerCase();
    const list = m.datasets.filter((d) => d.enabled && (!s || [d.name, d.title, d.description, d.license, d.source, ...d.tags].join(' ').toLowerCase().includes(s)));
    return wait({ datasets: list.map(portalDs), manage: true, windows_root: 'D:\\datasets' });
  },
  datasetFiles: (id: string, path: string) => {
    seed(); checkPath(path);
    const d = m.datasets.find((x) => x.id === id);
    if (!d?.mounted) fail(409, 'NO_ROUTE');
    return wait({ path, entries: [...(m.tree[key(id, path)] ?? [])], export: d!.export });
  },
  datasetUrl: real.datasetUrl,
  adminDatasets: () => { seed(); return wait<AdminDatasets>({ datasets: m.datasets.map((d) => ({ ...d })), pools: poolRefs(), pending: m.requests.filter((r) => r.status === 'pending').length, windows_root: 'D:\\datasets' }); },
  saveDataset: (id: string | null, b: Partial<DatasetInput>) => {
    seed();
    const name = (b.name ?? m.datasets.find((d) => d.id === id)?.name ?? '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) fail(400, 'name: lower-case letters, digits, . _ - (the folder name on the desktops)');
    if (m.datasets.some((d) => d.name === name && d.id !== id)) fail(409, `a dataset called ${name} exists`);
    if (b.share !== undefined && (b.share.includes('..') || (b.kind ?? 'nfs') === 'nfs' && !b.share.startsWith('/'))) fail(400, 'share: the dataset folder on the NAS, like /export/datasets/imagenet');
    if (b.server !== undefined && !/^[A-Za-z0-9.:-]+$/.test(b.server)) fail(400, 'server must be a host name or an IP address');
    const cur = m.datasets.find((d) => d.id === id);
    const merged = { ...(cur ?? { id: `ds_${seq++}`, size_bytes: null, files: null, measured_at: null, measure_error: '', created_by: 'admin', created_at: now(),
      title: '', description: '', version: '', license: '', source: '', kind: 'nfs', server: '', share: '', nfs_version: '3', admin_path: '', pool_ids: [], access: [],
      export: 'approval', tags: [], enabled: true }), ...b, name, updated_at: now() } as AdminDataset;
    merged.nas = merged.kind === 'smb' ? `\\\\${merged.server}\\${merged.share.replace(/\//g, '\\')}` : `${merged.server}:${merged.share}`;
    merged.mounted = !!merged.admin_path;
    merged.linux = `/nas/datasets/${name}`;
    merged.windows = merged.kind === 'smb' ? `D:\\datasets\\${name}` : null;
    if (cur) Object.assign(cur, merged); else m.datasets.push(merged);
    return wait({ ...merged });
  },
  deleteDataset: (id: string) => { m.datasets = m.datasets.filter((d) => d.id !== id); return wait({ ok: true }); },
  measure: (id: string) => {
    const d = m.datasets.find((x) => x.id === id)!;
    Object.assign(d, { size_bytes: (d.size_bytes ?? 0) + 1_000_000, files: (d.files ?? 0) + 3, measured_at: now(), measure_error: '' });
    return wait({ ...d }, 700);
  },
  policies: () => { seed(); return wait<PoliciesAnswer>({ policies: poolRefs().map((p) => ({ ...p, policy: { ...(m.policies[p.id] ?? POLICY) } })), defaults: POLICY, agent_max: 10 * 1048576 }); },
  savePolicy: (poolId: string, p: Partial<DataPolicy>) => {
    if (p.link_hours !== undefined && (p.link_hours < 1 || p.link_hours > 720)) fail(400, 'link_hours must be a whole number of hours, 1 to 720');
    m.policies[poolId] = { ...(m.policies[poolId] ?? POLICY), ...p, sftp: { ...(m.policies[poolId] ?? POLICY).sftp, ...(p.sftp ?? {}) } };
    return wait({ ...m.policies[poolId] });
  },
  adminRequests: (status?: RequestStatus) => { seed(); return wait(m.requests.filter((r) => !status || r.status === status).map((r) => ({ ...r }))); },
  approve: (id: string, hours?: number, note = '') => {
    const r = m.requests.find((x) => x.id === id)!;
    Object.assign(r, { status: 'approved', reviewed_by: 'admin', reviewed_at: now(), note, expires_at: new Date(Date.now() + (hours ?? 24) * 3600e3).toISOString() });
    return wait({ ...r });
  },
  reject: (id: string, note: string) => {
    if (!note.trim()) fail(400, 'note: why (at most 500 characters)');
    const r = m.requests.find((x) => x.id === id)!;
    Object.assign(r, { status: 'rejected', reviewed_by: 'admin', reviewed_at: now(), note });
    return wait({ ...r });
  },
  usage: () => {
    seed();
    const f = farm(), a = labA();
    const folders: UsageFolder[] = [
      { pool_id: f?.pool_id ?? '', pool: 'FPGA 빌드 팜', username: 'alice', folder: 'home', usage_kb: 3_400_000, quota_gb: 50, state: null, at: ago(2) },
      { pool_id: f?.pool_id ?? '', pool: 'FPGA 빌드 팜', username: 'alice', folder: 'scratch', usage_kb: 470_000_000, quota_gb: 500, state: 'near', at: ago(2) },
      { pool_id: f?.pool_id ?? '', pool: 'FPGA 빌드 팜', username: 'bob', folder: 'scratch', usage_kb: 540_000_000, quota_gb: 500, state: 'over', at: ago(5) },
      { pool_id: a?.pool_id ?? '', pool: '공용 LAB A', username: 'carol', folder: 'home', usage_kb: 800_000, quota_gb: 0, state: null, at: ago(26) },
    ];
    const sets = m.datasets.map((d) => ({ id: d.id, name: d.name, title: d.title, size_bytes: d.size_bytes, files: d.files, measured_at: d.measured_at, measure_error: d.measure_error }));
    return wait<UsageAnswer>({ datasets: sets, folders, totals: { datasets_bytes: sets.reduce((s, d) => s + (d.size_bytes ?? 0), 0),
      folders_kb: folders.reduce((s, x) => s + x.usage_kb, 0), over: 1, near: 1 } });
  },
  report: (days: number, username = '') => {
    seed();
    const rows = m.transfers.filter((t) => !username || t.username === username);
    const ok = rows.filter((t) => t.ok);
    const sum = (l: Transfer[], d: string) => l.filter((t) => t.direction === d).reduce((s, t) => s + t.size, 0);
    const users = [...new Set(ok.map((t) => t.username))].map((u) => {
      const l = ok.filter((t) => t.username === u);
      return { username: u, downloads: l.filter((t) => t.direction === 'download').length, download_bytes: sum(l, 'download'),
        uploads: l.filter((t) => t.direction === 'upload').length, upload_bytes: sum(l, 'upload') };
    });
    const keys = [...new Set(ok.map((t) => t.dataset_id || `${t.pool_id}/${t.folder}`))];
    const sources = keys.map((k) => {
      const l = ok.filter((t) => (t.dataset_id || `${t.pool_id}/${t.folder}`) === k);
      return { key: k, name: l[0].dataset ?? `${l[0].pool} · ${l[0].folder}`, kind: (l[0].dataset_id ? 'dataset' : 'folder') as 'dataset' | 'folder',
        downloads: l.filter((t) => t.direction === 'download').length, download_bytes: sum(l, 'download'), uploads: l.filter((t) => t.direction === 'upload').length,
        upload_bytes: sum(l, 'upload'), users: new Set(l.map((t) => t.username)).size };
    });
    return wait<TransferReport>({ days, since: ago(days * 24), recent: rows.map((t) => ({ ...t })), by_user: users, by_source: sources,
      totals: { downloads: ok.filter((t) => t.direction === 'download').length, download_bytes: sum(ok, 'download'), uploads: ok.filter((t) => t.direction === 'upload').length,
        upload_bytes: sum(ok, 'upload'), failed: rows.length - ok.length, approved_links: ok.filter((t) => t.request_id).length } });
  },
  reportCsvUrl: real.reportCsvUrl,
};

export const dataApi = isMock ? mock : real;

// --- text -------------------------------------------------------------------------------

export function bytesText(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export function ruleText(r: ExportRule, L: (ko: string, en: string) => string): string {
  return r === 'allow' ? L('다운로드 허용', 'Downloads allowed') : r === 'approval' ? L('승인 필요', 'Approval needed') : L('반출 금지', 'No export');
}

export function statusText(s: RequestStatus, L: (ko: string, en: string) => string): string {
  return ({ pending: L('승인 대기', 'Waiting'), approved: L('승인됨', 'Approved'), rejected: L('거절됨', 'Rejected'),
    cancelled: L('취소됨', 'Cancelled'), expired: L('만료됨', 'Expired') } as Record<RequestStatus, string>)[s];
}

/** What an engine refusal code means. */
export function dataCodeText(code: string, L: (ko: string, en: string) => string): string {
  const t: Record<string, [string, string]> = {
    APPROVAL_REQUIRED: ['이 파일은 반출 승인이 필요합니다. 사유를 적어 요청하세요.', 'This file needs approval to leave - send a request with a reason.'],
    EXPORT_DENIED: ['반출이 금지된 위치입니다 (반출 통제).', 'Export from here is not allowed.'],
    NO_ROUTE: ['파일을 옮길 경로가 없습니다. 이 풀의 Linux 데스크톱을 켜거나, 관리자에게 엔진 NAS 마운트를 요청하세요.', 'No way to move files: start a Linux desktop of the pool, or ask the admin for the engine NAS mount.'],
    NO_STORAGE: ['이 풀에는 공유 저장소가 없습니다.', 'This pool has no shared storage.'],
    FOLDER_MISSING: ['폴더가 아직 없습니다. 이 풀의 데스크톱에 한 번 접속하세요.', 'The folder is not there yet - connect to a desktop of the pool once.'],
    BAD_PATH: ['쓸 수 없는 경로나 이름입니다.', 'That path or name cannot be used.'],
    EXISTS: ['같은 이름이 이미 있습니다.', 'That name exists.'],
    TOO_BIG: ['파일이 허용 크기보다 큽니다.', 'The file is larger than allowed.'],
    QUOTA: ['할당량을 넘습니다.', 'That would go over your quota.'],
    UPLOAD_OFF: ['이 풀은 업로드가 꺼져 있습니다.', 'Uploads are off for this pool.'],
    NOT_NEEDED: ['승인 없이 받을 수 있습니다.', 'No approval needed.'],
    PENDING: ['이 파일의 요청이 이미 대기 중입니다.', 'A request for this file is waiting already.'],
    USED: ['이미 사용한 링크입니다. 끊긴 다운로드는 브라우저에서 이어받기만 됩니다.', 'The link was used; a broken download can only resume.'],
    EXPIRED: ['링크가 만료되었습니다.', 'The link expired.'],
    NOT_APPROVED: ['아직 승인되지 않았습니다.', 'Not approved yet.'],
    NO_AGENT: ['데스크톱의 게스트 에이전트가 응답하지 않습니다.', 'The desktop\'s guest agent does not answer.'],
    HASH_MISMATCH: ['데스크톱에 올라간 파일의 해시가 다릅니다. 다시 올리세요.', 'The file on the desktop differs - upload again.'],
    MOCK: ['모의 모드라 내려받을 파일이 없습니다.', 'Mock mode: nothing to download.'],
    network: ['네트워크 오류', 'Network error'],
  };
  const v = t[code];
  return v ? L(v[0], v[1]) : code;
}
