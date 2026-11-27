// 내 데스크톱 파일: files into / out of the user's own desktop (its MOAVI folder) through the guest
// agent, without 보안 게이트웨이 (makus-vlab pegaprox/api/vlab_desk_files.py). Uploads go in parts
// (POST to start, PATCH with Upload-Offset, POST finish); a download is a plain link.
import { ApiError, isMock, request } from './client';

export type DeskEntry = { name: string; kind: 'dir' | 'file' | 'link'; size: number; mtime: number };
export type DeskListing = { path: string; entries: DeskEntry[]; root: string; policy: { desktop_files: DeskFilesMode; max_mb: number } };
export type DeskFilesMode = 'off' | 'up' | 'down' | 'both';

const enc = encodeURIComponent;
const base = (id: string) => `/api/vlab/me/desktops/${enc(id)}/files`;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string; code?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const d = data as { error?: string; code?: string } | null;
    throw new ApiError(status, d?.error || d?.code || `HTTP ${status}`, d);
  }
  return data;
}

async function patchPart(id: string, uid: string, offset: number, blob: Blob, signal?: AbortSignal) {
  const res = await fetch(`${base(id)}/uploads/${enc(uid)}`, {
    method: 'PATCH', credentials: 'same-origin', signal, body: blob,
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) },
  });
  const data = await res.json().catch(() => ({})) as { received?: number; error?: string; code?: string };
  if (!res.ok) throw new ApiError(res.status, data.error || data.code || `HTTP ${res.status}`, data);
  return data;
}

type Api = {
  list: (id: string, path: string) => Promise<DeskListing>;
  downloadUrl: (id: string, path: string) => string;
  mkdir: (id: string, path: string) => Promise<void>;
  remove: (id: string, path: string) => Promise<void>;
  upload: (id: string, folder: string, file: File, onProgress: (sent: number) => void, signal?: AbortSignal) => Promise<void>;
};

const real: Api = {
  list: (id, path) => call<DeskListing>('GET', `${base(id)}?path=${enc(path)}`),
  downloadUrl: (id, path) => `${base(id)}/download?path=${enc(path)}`,
  mkdir: async (id, path) => { await call('POST', `${base(id)}/mkdir`, { path }); },
  remove: async (id, path) => { await call('DELETE', `${base(id)}?path=${enc(path)}`); },
  upload: async (id, folder, file, onProgress, signal) => {
    const start = await call<{ upload_id: string; part_max: number }>('POST', `${base(id)}/uploads`, { path: folder, name: file.name, size: file.size });
    try {
      let off = 0;
      while (off < file.size) {
        const end = Math.min(file.size, off + start.part_max);
        await patchPart(id, start.upload_id, off, file.slice(off, end), signal);
        off = end;
        onProgress(off);
      }
      await call('POST', `${base(id)}/uploads/${enc(start.upload_id)}/finish`);
    } catch (e) {
      await request('DELETE', `${base(id)}/uploads/${enc(start.upload_id)}`).catch(() => undefined);
      throw e;
    }
  },
};

// mock: an in-memory MOAVI folder
const tree: Record<string, DeskEntry[]> = {
  '': [{ name: '실험 결과', kind: 'dir', size: 0, mtime: 1760000000 }, { name: '보고서 초안.docx', kind: 'file', size: 284_112, mtime: 1760500000 }],
  '실험 결과': [{ name: 'run-01.csv', kind: 'file', size: 1_204_331, mtime: 1760400000 }],
};
const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 250));
const mock: Api = {
  list: (_id, path) => wait({ path, root: 'MOAVI', entries: [...(tree[path] ?? [])], policy: { desktop_files: 'both' as const, max_mb: 500 } }),
  downloadUrl: () => 'data:text/plain,mock',
  mkdir: async (_id, path) => {
    const [dir, name] = path.includes('/') ? [path.slice(0, path.lastIndexOf('/')), path.slice(path.lastIndexOf('/') + 1)] : ['', path];
    if ((tree[dir] ?? []).some((e) => e.name === name)) throw new ApiError(409, '같은 이름이 이미 있습니다.');
    (tree[dir] ??= []).push({ name, kind: 'dir', size: 0, mtime: Date.now() / 1000 }); tree[path] = [];
    await wait(undefined);
  },
  remove: async (_id, path) => {
    const [dir, name] = path.includes('/') ? [path.slice(0, path.lastIndexOf('/')), path.slice(path.lastIndexOf('/') + 1)] : ['', path];
    tree[dir] = (tree[dir] ?? []).filter((e) => e.name !== name); await wait(undefined);
  },
  upload: async (_id, folder, file, onProgress) => {
    for (let s = 0; s < 4; s++) { await wait(undefined); onProgress(Math.round((file.size * (s + 1)) / 4)); }
    (tree[folder] ??= []).push({ name: file.name, kind: 'file', size: file.size, mtime: Date.now() / 1000 });
  },
};

export const deskFilesApi: Api = isMock ? mock : real;
