// 가상머신 > 데스크톱(VM) 관리: one desktop's VM - settings, disks, network, snapshots, moving it
// to another node, making it a template, deleting it, and its screen for support
// (makus-vlab pegaprox/api/vlab_next.py, /api/vlab/admin/desktops/<id>/...).
import { ApiError, isMock, request } from './client';
import { mockVmStore } from './mockAdmin';
import type { Clipboard } from './types';

export type VmDisk = { key: string; storage: string; volume: string; size_gb: number };
export type VmNic = { key: string; model: string; mac: string; bridge: string; tag: number | null; firewall: boolean };
export type VmStorage = { storage: string; type: string; avail: number; shared: boolean };
export type VmTarget = { node: string; online: boolean; maintenance: boolean };
export type VmInfo = {
  vmid: number; type: 'qemu' | 'lxc'; node: string; name: string; status: string; lock: string;
  cores: number; sockets: number; memory_mb: number; cpu: string; ostype: string;
  disks: VmDisk[]; networks: VmNic[]; passthrough: { key: string; value: string }[];
  desktop_id: string; pool_id: string; base_snap: string;
  bridges: string[]; storages: VmStorage[]; targets: VmTarget[];
};
export type VmSnapshot = { name: string; description: string; time: number | null; vmstate: boolean; parent: string; base: boolean };
export type Changed = { needs_restart: boolean };
export type Migration = { task: string | null; from: string; to: string; online: boolean };
export type TaskState = { status: 'running' | 'stopped' | 'unknown' | string; exitstatus: string };
export type AdminConsole = { ws_path: string; password: string; clipboard: Clipboard };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}

const enc = encodeURIComponent;
const D = (id: string) => `/api/vlab/admin/desktops/${enc(id)}`;

const realVmApi = {
  vm: async (id: string) => (await call<{ vm: VmInfo }>('GET', `${D(id)}/vm`)).vm,
  setHardware: async (id: string, h: { cores?: number; sockets?: number; memory_mb?: number }) =>
    call<Changed>('PUT', `${D(id)}/vm/hardware`, h),
  growDisk: async (id: string, disk: string, grow_gb: number) =>
    call<Changed>('POST', `${D(id)}/vm/disks/${enc(disk)}/resize`, { grow_gb }),
  addDisk: async (id: string, storage: string, size_gb: number) =>
    call<Changed & { disk: string }>('POST', `${D(id)}/vm/disks`, { storage, size_gb }),
  setNetwork: async (id: string, net: string, bridge: string, tag: number | null) =>
    call<Changed>('PUT', `${D(id)}/vm/networks/${enc(net)}`, { bridge, tag }),
  snapshots: async (id: string) => call<{ snapshots: VmSnapshot[]; running: boolean }>('GET', `${D(id)}/snapshots`),
  takeSnapshot: async (id: string, s: { name: string; description: string; vmstate: boolean }) => {
    await call('POST', `${D(id)}/snapshots`, s);
  },
  rollback: async (id: string, name: string, force = false) => {
    await call('POST', `${D(id)}/snapshots/${enc(name)}/rollback`, force ? { force } : {});
  },
  deleteSnapshot: async (id: string, name: string) => { await call('DELETE', `${D(id)}/snapshots/${enc(name)}`); },
  migrate: async (id: string, target: string, online: boolean) => call<Migration>('POST', `${D(id)}/migrate`, { target, online }),
  task: async (id: string, upid: string) => call<TaskState>('GET', `${D(id)}/task?upid=${enc(upid)}`),
  toTemplate: async (id: string) => { await call('POST', `${D(id)}/template`); },
  deleteVm: async (id: string, confirm_name: string, force = false) => {
    await call('DELETE', `${D(id)}/vm`, { confirm_name, ...(force ? { force } : {}) });
  },
  console: async (id: string) => call<AdminConsole>('POST', `${D(id)}/console`),
};
export type VmApi = typeof realVmApi;

// --- mock: the sample desktops of mockAdmin.ts, each with a VM config of its own ---------------

const delay = <T,>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const fail = (status: number, msg: string, body?: unknown) => Promise.reject(new ApiError(status, msg, body ?? { error: msg }));
type MockVm = { cores: number; sockets: number; memory_mb: number; disks: VmDisk[]; networks: VmNic[];
  passthrough: { key: string; value: string }[]; snaps: VmSnapshot[] };
const vms = new Map<number, MockVm>();
const tasks = new Map<string, { done: number; desk: string; to: string }>();
const NODES = ['pve1', 'pve2', 'pve3'];

function vmOf(vmid: number): MockVm {
  let v = vms.get(vmid);
  if (!v) {
    const big = vmid >= 400;
    const mac = `BC:24:11:00:${String(Math.floor(vmid / 100)).padStart(2, '0')}:${String(vmid % 100).padStart(2, '0')}`;
    const now = Math.floor(Date.now() / 1000);
    v = { cores: big ? 16 : 4, sockets: 1, memory_mb: (big ? 64 : 8) * 1024,
      disks: [{ key: 'scsi0', storage: 'ceph-vm', volume: `ceph-vm:vm-${vmid}-disk-0`, size_gb: big ? 200 : 64 }],
      networks: [{ key: 'net0', model: 'virtio', mac, bridge: 'vmbr0', tag: big ? 30 : 20, firewall: true }],
      // the build farm's first desktop holds an Alveo card: it cannot move off pve3
      passthrough: vmid === 400 ? [{ key: 'hostpci0', value: 'mapping=alveo-u250,pcie=1' }] : [],
      snaps: [{ name: 'before-update', description: '10월 정기 패치 전', time: now - 6 * 86400, vmstate: false, parent: '', base: false }] };
    vms.set(vmid, v);
  }
  return v;
}

function deskOf(id: string) {
  const d = mockVmStore.desks.find((x) => x.id === id);
  const g = d && mockVmStore.guests.find((x) => x.vmid === d.vmid);
  return d && g ? { d, g } : null;
}
const notFound = () => fail(404, 'Desktop not found');
const running = (g: { status: string }) => g.status === 'running';

const mockVmApi: VmApi = {
  vm: (id) => {
    const x = deskOf(id); if (!x) return notFound();
    const v = vmOf(x.d.vmid);
    const base = mockVmStore.withBase.has(x.d.id) ? 'vlab-base' : '';
    return delay({
      vmid: x.d.vmid, type: 'qemu' as const, node: x.g.node, name: x.d.name, status: x.g.status, lock: '',
      cores: v.cores, sockets: v.sockets, memory_mb: v.memory_mb, cpu: 'host', ostype: x.d.vmid >= 400 ? 'l26' : 'win11',
      disks: v.disks.map((k) => ({ ...k })), networks: v.networks.map((n) => ({ ...n })), passthrough: v.passthrough,
      desktop_id: x.d.id, pool_id: x.d.pool_id, base_snap: base,
      bridges: ['vmbr0', 'vmbr1', 'vnet-lab'],
      storages: [{ storage: 'ceph-vm', type: 'rbd', avail: 23 * 1024 ** 4, shared: true },
        { storage: 'local-lvm', type: 'lvmthin', avail: 1.2 * 1024 ** 4, shared: false }],
      targets: NODES.filter((n) => n !== x.g.node).map((n) => ({ node: n, online: true, maintenance: false })),
    });
  },
  setHardware: (id, h) => {
    const x = deskOf(id); if (!x) return notFound();
    if (h.cores !== undefined && !(h.cores >= 1 && h.cores <= 256)) return fail(400, 'cores must be 1 to 256');
    if (h.memory_mb !== undefined && !(h.memory_mb >= 256)) return fail(400, 'memory_mb must be 256 to 4194304');
    const v = vmOf(x.d.vmid);
    Object.assign(v, Object.fromEntries(Object.entries(h).filter(([, n]) => n !== undefined)));
    return delay({ needs_restart: running(x.g) });
  },
  growDisk: (id, disk, gb) => {
    const x = deskOf(id); if (!x) return notFound();
    const k = vmOf(x.d.vmid).disks.find((d) => d.key === disk); if (!k) return fail(400, 'Unknown disk');
    if (!(gb >= 1)) return fail(400, 'grow_gb must be 1 to 16384');
    k.size_gb += gb; return delay({ needs_restart: false });
  },
  addDisk: (id, storage, gb) => {
    const x = deskOf(id); if (!x) return notFound();
    if (!storage) return fail(400, 'storage is required');
    if (!(gb >= 1)) return fail(400, 'size_gb must be 1 to 16384');
    const v = vmOf(x.d.vmid);
    let i = 0; while (v.disks.some((d) => d.key === `scsi${i}`)) i++;
    v.disks.push({ key: `scsi${i}`, storage, volume: `${storage}:vm-${x.d.vmid}-disk-${i}`, size_gb: gb });
    return delay({ needs_restart: false, disk: `scsi${i}` });
  },
  setNetwork: (id, net, bridge, tag) => {
    const x = deskOf(id); if (!x) return notFound();
    const n = vmOf(x.d.vmid).networks.find((k) => k.key === net); if (!n) return fail(404, 'Unknown network device');
    if (tag !== null && !(tag >= 1 && tag <= 4094)) return fail(400, 'tag must be 1 to 4094');
    Object.assign(n, { bridge, tag }); return delay({ needs_restart: running(x.g) });
  },
  snapshots: (id) => {
    const x = deskOf(id); if (!x) return notFound();
    const v = vmOf(x.d.vmid);
    const base = mockVmStore.withBase.has(x.d.id)
      ? [{ name: 'vlab-base', description: '', time: Math.floor(Date.now() / 1000) - 20 * 86400, vmstate: false, parent: '', base: true }] : [];
    return delay({ snapshots: [...v.snaps, ...base].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)), running: running(x.g) });
  },
  takeSnapshot: (id, s) => {
    const x = deskOf(id); if (!x) return notFound();
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/.test(s.name)) return fail(400, 'name: letters, digits, "-", "_" and ".", starting with a letter (at most 40)');
    if (s.name === 'vlab-base') return fail(400, "'vlab-base' is the base snapshot - take it from the pool's desktop list");
    const v = vmOf(x.d.vmid);
    if (v.snaps.some((k) => k.name === s.name)) return fail(502, `snapshot name '${s.name}' already used`);
    v.snaps.unshift({ name: s.name, description: s.description, time: Math.floor(Date.now() / 1000), vmstate: s.vmstate && running(x.g), parent: '', base: false });
    return delay(undefined, 700);
  },
  rollback: (id, name, force) => {
    const x = deskOf(id); if (!x) return notFound();
    if (!force && x.d.assigned_user === 'alice') return fail(409, 'Someone is connected to this desktop', { error: 'Someone is connected to this desktop', code: 'IN_USE' });
    const s = vmOf(x.d.vmid).snaps.find((k) => k.name === name);
    if (!s && name !== 'vlab-base') return fail(502, 'snapshot does not exist');
    if (!s?.vmstate) x.g.status = 'stopped';
    return delay(undefined, 700);
  },
  deleteSnapshot: (id, name) => {
    const x = deskOf(id); if (!x) return notFound();
    if (name === 'vlab-base') { mockVmStore.withBase.delete(x.d.id); return delay(undefined); }
    const v = vmOf(x.d.vmid); v.snaps = v.snaps.filter((k) => k.name !== name);
    return delay(undefined);
  },
  migrate: (id, target, online) => {
    const x = deskOf(id); if (!x) return notFound();
    if (target === x.g.node) return fail(400, 'The VM is already on that node');
    const v = vmOf(x.d.vmid);
    if (v.passthrough.length) {
      const msg = `The VM uses devices of its node: ${v.passthrough.map((p) => p.key).join(', ')}`;
      return fail(409, msg, { error: msg, code: 'PASSTHROUGH', devices: v.passthrough });
    }
    const upid = `UPID:${x.g.node}:0000${x.d.vmid}:mock:${Date.now().toString(16)}:qmigrate:${x.d.vmid}:root@pam:`;
    tasks.set(upid, { done: Date.now() + 6000, desk: x.d.id, to: target });
    return delay({ task: upid, from: x.g.node, to: target, online: online && running(x.g) });
  },
  task: (id, upid) => {
    const t = tasks.get(upid); if (!t || t.desk !== id) return fail(400, 'upid is not a task of this desktop');
    if (Date.now() < t.done) return delay({ status: 'running', exitstatus: '' }, 100);
    const x = deskOf(id);
    if (x) { x.g.node = t.to; x.d.node = t.to; }
    return delay({ status: 'stopped', exitstatus: 'OK' }, 100);
  },
  toTemplate: (id) => {
    const x = deskOf(id); if (!x) return notFound();
    if (running(x.g)) return fail(409, 'Shut the VM down first');
    const v = vmOf(x.d.vmid);
    mockVmStore.templates.push({ vmid: x.d.vmid, name: x.d.name, node: x.g.node, type: 'qemu',
      spec: { cpu: v.cores * v.sockets, memory_gb: Math.round(v.memory_mb / 1024) } });
    mockVmStore.desks.splice(mockVmStore.desks.indexOf(x.d), 1);
    mockVmStore.guests.splice(mockVmStore.guests.indexOf(x.g), 1);
    return delay(undefined, 600);
  },
  deleteVm: (id, confirm, force) => {
    const x = deskOf(id); if (!x) return notFound();
    if (confirm !== x.d.name) return fail(400, "confirm_name must be the desktop's name");
    if (!force && x.d.assigned_user === 'alice') return fail(409, 'Someone is connected to this desktop', { error: 'Someone is connected to this desktop', code: 'IN_USE' });
    mockVmStore.desks.splice(mockVmStore.desks.indexOf(x.d), 1);
    mockVmStore.guests.splice(mockVmStore.guests.indexOf(x.g), 1);
    vms.delete(x.d.vmid);
    return delay(undefined, 800);
  },
  console: (id) => {
    const x = deskOf(id); if (!x) return notFound();
    if (!running(x.g)) return fail(409, 'The desktop is not running', { error: 'The desktop is not running', code: 'VM_STOPPED' });
    return delay({ ws_path: '/api/mock/vncwebsocket', password: 'mock', clipboard: 'both' as const });
  },
};

export const vmApi: VmApi = isMock ? mockVmApi : realVmApi;
