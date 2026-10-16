// VM build: the ISO library and new VMs from an ISO (가상머신 > ISO · 이미지 관리, VM 만들기).
// The engine's /api/vlab/admin/... VM-build routes (makus-vlab pegaprox/api/vlab_next.py) are
// thin wrappers over its core upload, download-url, ISO list and create routes.
import { ApiError, isMock, request } from './client';

export type Iso = { volid: string; name: string; storage: string; size: number; ctime: number };
export type BuildTask = { type: string; running: boolean; ok: boolean; exitstatus: string | null; percent: number | null; last: string };
export type Network = { iface: string; type: string; comments: string; vlan_aware: boolean; cidr: string };
export type ChecksumAlgo = 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
export type DownloadInput = { url: string; filename: string; checksum?: string };
export type OsKind = 'win11' | 'win10' | 'l26' | 'other';
export type NewVm = {
  vmid?: number; name: string; ostype: OsKind; iso: string; virtio_iso?: string;
  sockets?: number; cores: number; cpu?: string; memory: number;
  storage: string; disk_size: number; disk_type?: 'scsi' | 'virtio' | 'sata'; scsihw?: string;
  disk_discard?: boolean; disk_ssd?: boolean; disk_iothread?: boolean;
  net_bridge: string; net_tag?: number; net_model?: string; net_firewall?: boolean;
  vga?: 'qxl' | 'qxl2' | 'std' | 'virtio'; agent?: boolean;
  bios?: 'seabios' | 'ovmf'; machine?: 'q35' | 'pc'; efi_storage?: string; efi_pre_enroll?: boolean;
  tpm_storage?: string; tpm_version?: 'v2.0'; onboot?: boolean;
};
export type Created = { success: boolean; vmid: number; task?: string };
export type ConsoleAnswer = { type: 'vnc'; ws_path: string; password: string; node: string; name: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}
const enc = encodeURIComponent;
const C = (cid: string) => `/api/vlab/admin/clusters/${enc(cid)}`;
const N = (cid: string, node: string) => `${C(cid)}/nodes/${enc(node)}`;

// An upload goes through XMLHttpRequest: fetch has no upload progress. The engine keeps the
// request open until the node has the file, so 100% sent is followed by a wait.
function upload(path: string, form: FormData, onProgress: (sent: number, total: number) => void, signal?: AbortSignal) {
  return new Promise<{ upid?: string }>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', path);
    x.withCredentials = true;
    x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    x.onload = () => {
      let data: { error?: string; upid?: string } = {};
      try { data = JSON.parse(x.responseText || '{}'); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(data);
      else reject(new ApiError(x.status, data.error || `HTTP ${x.status}`, data));
    };
    x.onerror = () => reject(new ApiError(0, 'network'));
    x.onabort = () => reject(new ApiError(0, 'aborted'));
    signal?.addEventListener('abort', () => x.abort());
    x.send(form);
  });
}

const realBuildApi = {
  isos: async (cid: string, node: string, storage?: string) =>
    (await call<{ isos: Iso[] }>('GET', `${N(cid, node)}/isos${storage ? `?storage=${enc(storage)}` : ''}`)).isos,
  uploadIso: (cid: string, node: string, storage: string, file: File, name: string,
    onProgress: (sent: number, total: number) => void, signal?: AbortSignal) => {
    const form = new FormData();
    form.append('node', node);       // the core reads content and node before the file
    form.append('content', 'iso');
    form.append('file', file, name);
    return upload(`${N(cid, node)}/storage/${enc(storage)}/upload`, form, onProgress, signal);
  },
  downloadIso: async (cid: string, node: string, storage: string, b: DownloadInput) =>
    call<{ upid: string }>('POST', `${N(cid, node)}/storage/${enc(storage)}/download-url`, { ...b, content: 'iso' }),
  deleteIso: async (cid: string, node: string, storage: string, volid: string) => {
    await call('DELETE', `${N(cid, node)}/storage/${enc(storage)}/isos/${volid.split('/').map(enc).join('/')}?node=${enc(node)}`);
  },
  task: async (cid: string, node: string, upid: string) => call<BuildTask>('GET', `${N(cid, node)}/tasks/${enc(upid)}`),
  networks: async (cid: string, node: string) => (await call<{ networks: Network[] }>('GET', `${N(cid, node)}/networks`)).networks,
  nextId: async (cid: string) => (await call<{ vmid: number }>('GET', `${C(cid)}/nextid`)).vmid,
  createVm: async (cid: string, node: string, vm: NewVm) => call<Created>('POST', `${N(cid, node)}/vms`, vm),
  console: async (cid: string, vmid: number) => call<ConsoleAnswer>('POST', `${C(cid)}/vms/${vmid}/console`),
  makeTemplate: async (cid: string, vmid: number) => call<{ success: boolean; task?: string }>('POST', `${C(cid)}/vms/${vmid}/template`),
};

export type BuildApi = typeof realBuildApi;

// --- mock (npm run dev:mock) ------------------------------------------------------------

const delay = <T,>(v: T, ms = 120) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const fail = (status: number, msg: string) => Promise.reject(new ApiError(status, msg));
const GB = 1024 ** 3;
const ago = (days: number) => Math.round(Date.now() / 1000 - days * 86400);
const isoName = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,190}\.iso$/i;

// ISOs by storage; nfs-iso is shared, local is per node
const mockIsos: Record<string, Iso[]> = {
  'nfs-iso': [
    { volid: 'nfs-iso:iso/Win11_24H2_Korean_x64.iso', name: 'Win11_24H2_Korean_x64.iso', storage: 'nfs-iso', size: 5.8 * GB, ctime: ago(20) },
    { volid: 'nfs-iso:iso/virtio-win-0.1.262.iso', name: 'virtio-win-0.1.262.iso', storage: 'nfs-iso', size: 0.71 * GB, ctime: ago(18) },
    { volid: 'nfs-iso:iso/ubuntu-24.04.1-desktop-amd64.iso', name: 'ubuntu-24.04.1-desktop-amd64.iso', storage: 'nfs-iso', size: 6.1 * GB, ctime: ago(40) },
    { volid: 'nfs-iso:iso/Rocky-9.4-x86_64-dvd.iso', name: 'Rocky-9.4-x86_64-dvd.iso', storage: 'nfs-iso', size: 10.2 * GB, ctime: ago(65) },
  ],
  'local@pve1': [
    { volid: 'local:iso/Win10_22H2_Korean_x64v1.iso', name: 'Win10_22H2_Korean_x64v1.iso', storage: 'local', size: 5.7 * GB, ctime: ago(120) },
  ],
  'local@pve2': [],
};
const key = (node: string, storage: string) => (storage === 'local' ? `local@${node}` : storage);
// tasks the mock runs: a download climbs a few percent a second
const mockTasks = new Map<string, { started: number; seconds: number; type: string; then?: () => void; failWith?: string }>();
let seq = 0;
const nextVmid = { v: 1000 };
const mockVms = new Map<number, { name: string; node: string; status: 'stopped' | 'running'; template: boolean }>();
const takenVmids = new Set([200, 201, 202, 300, 301, 302, 400, 401, 500, 900, 901]);
const inDrive = new Set<string>();   // ISOs a mock VM has in a CD drive: the core refuses to delete those

function mockTask(node: string, type: string, seconds: number, then?: () => void, failWith?: string) {
  const upid = `UPID:${node}:0000${++seq}:00:${Math.floor(Date.now() / 1000).toString(16)}:${type}:mock:root@pam:`;
  mockTasks.set(upid, { started: Date.now(), seconds, type, then, failWith });
  return upid;
}

const mockBuildApi: BuildApi = {
  isos: (_cid, node, storage) => {
    const stores = storage ? [storage] : ['nfs-iso', 'local'];
    return delay(stores.flatMap((s) => mockIsos[key(node, s)] ?? []).sort((a, b) => b.ctime - a.ctime).map((i) => ({ ...i })));
  },
  uploadIso: (_cid, node, storage, file, name, onProgress, signal) => {
    if (!isoName.test(name)) return fail(400, 'file: an .iso with letters, digits, dot, dash, underscore or plus in its name');
    const list = (mockIsos[key(node, storage)] ??= []);
    if (list.some((i) => i.name === name)) return fail(400, `${name}: a file of that name is already on the storage`);
    // pretend the browser sends the file at ~200 MB/s, at least two seconds
    const total = file.size || 1;
    const steps = 20;
    return new Promise((resolve, reject) => {
      let i = 0;
      const tick = window.setInterval(() => {
        i++;
        onProgress(Math.min(total, Math.round((total * i) / steps)), total);
        if (i >= steps) {
          window.clearInterval(tick);
          window.setTimeout(() => {
            list.push({ volid: `${storage}:iso/${name}`, name, storage, size: file.size, ctime: ago(0) });
            resolve({ upid: mockTask(node, 'imgcopy', 1) });
          }, 600);
        }
      }, Math.max(100, Math.min(1000, total / (200 * 1024 ** 2) * 1000 / steps)));
      signal?.addEventListener('abort', () => { window.clearInterval(tick); reject(new ApiError(0, 'aborted')); });
    });
  },
  downloadIso: (_cid, node, storage, b) => {
    if (!/^https?:\/\/\S{3,}$/.test(b.url)) return fail(400, 'url: an http or https address');
    if (!isoName.test(b.filename)) return fail(400, 'filename: an .iso with letters, digits, dot, dash, underscore or plus in its name');
    if (b.checksum && !/^(md5|sha1|sha224|sha256|sha384|sha512):[0-9a-fA-F]{32,128}$/.test(b.checksum)) {
      return fail(400, 'checksum: <algorithm>:<hex>, algorithm one of md5, sha1, sha224, sha256, sha384, sha512');
    }
    const list = (mockIsos[key(node, storage)] ??= []);
    if (list.some((i) => i.name === b.filename)) return fail(400, `refusing to override existing file '${b.filename}'`);
    // a checksum of all zeros plays the node finding the file does not match
    const wrongSum = !!b.checksum && /^[a-z0-9]+:0+$/i.test(b.checksum);
    return delay({ upid: mockTask(node, 'download', 12, wrongSum ? undefined : () => {
      list.push({ volid: `${storage}:iso/${b.filename}`, name: b.filename, storage, size: 4.7 * GB, ctime: ago(0) });
    }, wrongSum ? 'checksum mismatch: got a different sha256' : undefined) });
  },
  deleteIso: (_cid, node, storage, volid) => {
    const list = mockIsos[key(node, storage)] ?? [];
    const i = list.findIndex((x) => x.volid === volid);
    if (i < 0) return fail(404, 'Volume not found');
    if (inDrive.has(volid)) return fail(400, 'Volume is still in use');
    list.splice(i, 1);
    return delay(undefined);
  },
  task: (_cid, _node, upid) => {
    const t = mockTasks.get(upid);
    if (!t) return fail(404, 'Task not found');
    const pct = Math.min(100, ((Date.now() - t.started) / 1000 / t.seconds) * 100);
    if (pct < 100) {
      return delay({ type: t.type, running: true, ok: false, exitstatus: null, percent: Math.round(pct * 10) / 10,
        last: t.type === 'download' ? `${(pct * 0.047).toFixed(2)} GiB of 4.70 GiB (${pct.toFixed(1)}%)` : 'running' });
    }
    if (t.then) { t.then(); t.then = undefined; }
    return delay(t.failWith
      ? { type: t.type, running: false, ok: false, exitstatus: t.failWith, percent: null, last: `TASK ERROR: ${t.failWith}` }
      : { type: t.type, running: false, ok: true, exitstatus: 'OK', percent: 100, last: 'TASK OK' });
  },
  networks: (_cid, node) => delay([
    { iface: 'vmbr0', type: 'bridge', comments: '관리망', vlan_aware: false, cidr: node === 'pve1' ? '10.10.0.11/24' : '10.10.0.12/24' },
    { iface: 'vmbr1', type: 'bridge', comments: '실습망 (VLAN)', vlan_aware: true, cidr: '' },
    { iface: 'labnet', type: 'sdn_vnet', comments: 'SDN', vlan_aware: false, cidr: '' },
  ]),
  nextId: () => {
    while (takenVmids.has(nextVmid.v) || mockVms.has(nextVmid.v)) nextVmid.v++;
    return delay(nextVmid.v);
  },
  createVm: (_cid, node, vm) => {
    if (!/^[A-Za-z0-9]([A-Za-z0-9.-]{0,61}[A-Za-z0-9])?$/.test(vm.name)) return fail(400, 'Invalid name');
    if (vm.ostype === 'win11' && !(vm.bios === 'ovmf' && vm.machine === 'q35' && vm.tpm_storage)) {
      return fail(400, 'Windows 11 needs UEFI (bios ovmf, machine q35) and a TPM 2.0 state (tpm_storage)');
    }
    const vmid = vm.vmid ?? nextVmid.v;
    if (takenVmids.has(vmid) || mockVms.has(vmid)) return fail(409, `VMID ${vmid} is taken`);
    mockVms.set(vmid, { name: vm.name, node, status: 'stopped', template: false });
    inDrive.add(vm.iso);
    if (vm.virtio_iso) inDrive.add(vm.virtio_iso);
    nextVmid.v = Math.max(nextVmid.v, vmid + 1);
    return delay({ success: true, vmid, task: mockTask(node, 'qmcreate', 2) }, 400);
  },
  console: (_cid, vmid) => {
    const v = mockVms.get(vmid);
    if (!v) return fail(404, `VM ${vmid} not found on this cluster`);
    if (v.template) return fail(409, 'This VM is a template');
    if (v.status !== 'running') {
      v.status = 'running';
      return Promise.reject(new ApiError(409, 'The VM is starting - connect again in a moment', { code: 'STARTING' }));
    }
    // nothing answers this websocket in mock mode: the console shows "disconnected"
    return delay({ type: 'vnc' as const, ws_path: `/api/mock/vnc/${vmid}`, password: 'mock', node: v.node, name: v.name });
  },
  makeTemplate: (_cid, vmid) => {
    const v = mockVms.get(vmid);
    if (!v) return fail(404, `VM ${vmid} not found on this cluster`);
    // no guest runs here to shut itself down after sysprep: take it as done
    v.status = 'stopped';
    v.template = true;
    return delay({ success: true, task: mockTask(v.node, 'qmtemplate', 1) });
  },
};

export const buildApi: BuildApi = isMock ? mockBuildApi : realBuildApi;
