// 가속 자원 › JTAG 게이트웨이: gateway VMs of the board lab (makus-vlab pegaprox/api/vlab_next.py,
// pegaprox/vlab/jtag_gw.py). A gateway VM holds many JTAG cables (USB devices or a whole PCIe USB
// controller passed through) and runs hw_server / XVC / jtagd; boards are its cables by serial number.
// It relays programming and debug traffic only - synthesis runs in the researcher's VM or the build farm.
import { ApiError, isMock, request } from './client';

export type GatewayState = 'up' | 'down' | 'unknown';
export type GatewayPassthrough = { slot: string; kind: 'usb' | 'pci'; value: string };
export type GatewayCable = { vidpid: string; serial: string; manufacturer: string; product: string; port: string; jtag: boolean; board?: string | null };
export type GatewayPortCheck = { port: number; ok: boolean; ms: number; error: string };
export type JtagGateway = {
  id: string; name: string; cluster_id: string; vmid: number | null; host: string; hw_port: number; jtagd_port: number; notes: string;
  passthrough: GatewayPassthrough[]; cables: GatewayCable[]; cables_at: string | null;
  // the last cable read that failed (the cables above are then from cables_at, stale)
  cables_error?: string; cables_error_code?: CableReadCode | ''; cables_error_at?: string | null;
  last_check: string | null; last_ok: number | null; last_detail: { vm?: string | null; ports?: GatewayPortCheck[] };
  state: GatewayState; vm: { status: string; node: string } | null;
  boards: { id: string; name: string; cable_serial: string; protocol: string; lent: boolean }[];
};
// why the engine could not read a gateway's cables (POST .../discover answers {error, code})
export type CableReadCode = 'VM_STOPPED' | 'AGENT' | 'READ_FAILED' | 'NO_VMID' | 'CLUSTER' | 'VM_MISSING' | 'NOT_QEMU' | 'CONFIG';
export function cableReadText(code: string | undefined, message: string, L: (ko: string, en: string) => string) {
  switch (code) {
    case 'VM_STOPPED': return L('게이트웨이 VM이 꺼져 있어 케이블을 찾을 수 없습니다. VM을 켜세요.', 'The gateway VM is off, so its cables cannot be read. Start the VM.');
    case 'AGENT': return L('게스트 에이전트가 응답하지 않습니다(게이트웨이에 qemu-guest-agent 설치 · VM 옵션 agent: 1).', 'The guest agent does not answer (install qemu-guest-agent in the gateway and set agent: 1).');
    case 'NO_VMID': return L('게이트웨이에 VM ID가 없습니다. 편집에서 VM ID를 적으세요.', 'The gateway has no VM id. Add it under Edit.');
    case 'VM_MISSING': return L('클러스터에서 게이트웨이 VM을 찾지 못했습니다. VM ID를 확인하세요.', 'The gateway VM is not on the cluster. Check the VM id.');
    case 'CLUSTER': return L('클러스터에 연결되어 있지 않습니다.', 'The cluster is not connected.');
    default: return L(`케이블을 읽지 못했습니다: ${message}`, `Could not read the cables: ${message}`);
  }
}
export const errorCode = (e: unknown) => ((e as { body?: { code?: string } })?.body?.code ?? undefined);
export type JtagGatewayInput = { name: string; cluster_id: string; vmid: number | null; host: string; hw_port: number; jtagd_port: number; notes: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string; code?: string }>(method, path, body);
  if (status < 200 || status >= 300) throw new ApiError(status, data?.error || data?.code || `HTTP ${status}`, data);
  return data;
}
const enc = encodeURIComponent;
const G = '/api/vlab/admin/jtag-gateways';

const realJtagApi = {
  list: async () => (await call<{ gateways: JtagGateway[]; every: number }>('GET', G)).gateways,
  save: async (id: string | null, b: JtagGatewayInput) =>
    (await call<{ gateway: JtagGateway }>(id ? 'PUT' : 'POST', id ? `${G}/${enc(id)}` : G, b)).gateway,
  remove: async (id: string) => { await call('DELETE', `${G}/${enc(id)}`); },
  addPassthrough: async (id: string, b: { kind: 'usb'; usb: string } | { kind: 'pci'; pci: string }) =>
    call<{ gateway: JtagGateway; slot: string; needs_restart: boolean }>('POST', `${G}/${enc(id)}/passthrough`, b),
  removePassthrough: async (id: string, slot: string) =>
    (await call<{ gateway: JtagGateway }>('DELETE', `${G}/${enc(id)}/passthrough/${enc(slot)}`)).gateway,
  discover: async (id: string) => (await call<{ gateway: JtagGateway }>('POST', `${G}/${enc(id)}/discover`)).gateway,
  check: async (id: string) => (await call<{ gateway: JtagGateway }>('POST', `${G}/${enc(id)}/check`)).gateway,
};
export type JtagApi = typeof realJtagApi;

// --- mock -----------------------------------------------------------------------------------
const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));
const fail = (status: number, msg: string, code?: string) => Promise.reject(new ApiError(status, msg, code ? { error: msg, code } : undefined));
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString().slice(0, 19);
let seq = 0;

// shared with the board mock (api/next.ts): a board's gateway, its address and state
export const mockGateways: JtagGateway[] = [
  { id: 'jgw_1', name: 'jtag-gw-01', cluster_id: 'lab-cluster', vmid: 950, host: 'jtag-gw-01.lab.local', hw_port: 3121, jtagd_port: 1309,
    notes: '랙 B · PCIe USB 카드 (16포트 전원 허브 2개)', passthrough: [{ slot: 'hostpci0', kind: 'pci', value: '0000:05:00.0' }],
    cables: [
      { vidpid: '0403:6010', serial: '210251A08870', manufacturer: 'Digilent', product: 'Digilent USB Device', port: '3-1.1', jtag: true },
      { vidpid: '0403:6010', serial: '210308AB12CD', manufacturer: 'Digilent', product: 'Digilent USB Device', port: '3-1.2', jtag: true },
      { vidpid: '03fd:0008', serial: '000013ca2b5a01', manufacturer: 'Xilinx', product: 'Platform Cable USB II', port: '3-1.3', jtag: true },
      { vidpid: '09fb:6810', serial: 'USB-BlasterII-1', manufacturer: 'Altera', product: 'USB-BlasterII', port: '3-2.1', jtag: true },
      { vidpid: '0403:6014', serial: 'FT4ABCDE', manufacturer: 'FTDI', product: 'Single RS232-HS', port: '3-2.4', jtag: true },
    ],
    cables_at: ago(40), last_check: ago(1), last_ok: 1,
    last_detail: { vm: 'running', ports: [{ port: 3121, ok: true, ms: 2, error: '' }, { port: 1309, ok: true, ms: 2, error: '' }] },
    state: 'up', vm: { status: 'running', node: 'pve1' }, boards: [] },
  { id: 'jgw_2', name: 'jtag-gw-02', cluster_id: 'lab-cluster', vmid: 951, host: 'jtag-gw-02.lab.local', hw_port: 3121, jtagd_port: 1309,
    notes: '랙 C · 케이블별 USB 패스스루', passthrough: [{ slot: 'usb0', kind: 'usb', value: '1-4.2' }, { slot: 'usb1', kind: 'usb', value: '1-4.3' }],
    // read two days ago, before the VM went down: shown as stale
    cables: [
      { vidpid: '0403:6010', serial: '210308FF0001', manufacturer: 'Digilent', product: 'Digilent USB Device', port: '1-4.2', jtag: true },
      { vidpid: '0403:6010', serial: '210308FF0002', manufacturer: 'Digilent', product: 'Digilent USB Device', port: '1-4.3', jtag: true },
    ],
    cables_at: ago(2 * 1440), last_check: ago(1), last_ok: 0,
    last_detail: { vm: 'stopped', ports: [{ port: 3121, ok: false, ms: 2000, error: 'timed out' }] },
    state: 'down', vm: { status: 'stopped', node: 'pve2' }, boards: [] },
];
let boardsOf: (gid: string) => JtagGateway['boards'] = () => [];
export function mockLinkBoards(fn: typeof boardsOf) { boardsOf = fn; }
const view = (g: JtagGateway): JtagGateway => {
  const boards = boardsOf(g.id);
  const mapped = new Map(boards.filter((b) => b.cable_serial).map((b) => [b.cable_serial, b.name]));
  return { ...g, boards, cables: g.cables.map((c) => ({ ...c, board: mapped.get(c.serial) ?? null })), passthrough: [...g.passthrough] };
};
const find = (id: string) => mockGateways.find((g) => g.id === id);

const mockJtagApi: JtagApi = {
  list: () => delay(mockGateways.map(view)),
  save: (id, b) => {
    if (!b.host || !/^[A-Za-z0-9._-]+$/.test(b.host)) return fail(400, 'host: the address desktops dial the gateway at (name or IP)');
    if (id) { const g = find(id)!; Object.assign(g, b); return delay(view(g)); }
    const g: JtagGateway = { id: `jgw_m${++seq}`, ...b, passthrough: [], cables: [], cables_at: null, last_check: null, last_ok: null,
      last_detail: {}, state: 'unknown', vm: b.vmid ? { status: 'running', node: 'pve1' } : null, boards: [] };
    mockGateways.push(g); return delay(view(g));
  },
  remove: (id) => {
    if (boardsOf(id).length) return fail(409, 'Boards use this gateway - move or delete them first');
    mockGateways.splice(mockGateways.findIndex((g) => g.id === id), 1); return delay(undefined);
  },
  addPassthrough: (id, b) => {
    const g = find(id)!;
    const kind = b.kind; const value = b.kind === 'usb' ? b.usb.toLowerCase() : b.pci.toLowerCase();
    if (kind === 'usb' && !/^([0-9a-f]{4}:[0-9a-f]{4}|\d+-\d+(\.\d+)*)$/.test(value)) return fail(400, 'usb: vendor:product (03fd:0008) or a port path (1-2.3)');
    if (kind === 'pci' && !/^([0-9a-f]{4}:)?[0-9a-f]{2}:[0-9a-f]{2}(\.[0-7])?$/.test(value)) return fail(400, 'pci: the USB controller address, e.g. 0000:05:00.0');
    if (g.passthrough.some((p) => p.kind === kind && p.value === value)) return fail(409, `${value} is passed through to this gateway already`);
    const used = new Set(g.passthrough.map((p) => p.slot));
    const slot = Array.from({ length: kind === 'usb' ? 14 : 16 }, (_, i) => `${kind === 'usb' ? 'usb' : 'hostpci'}${i}`).find((s) => !used.has(s));
    if (!slot) return fail(409, 'No free slot left on the VM');
    g.passthrough.push({ slot, kind, value });
    return delay({ gateway: view(g), slot, needs_restart: kind === 'pci' });
  },
  removePassthrough: (id, slot) => {
    const g = find(id)!; g.passthrough = g.passthrough.filter((p) => p.slot !== slot); return delay(view(g));
  },
  discover: (id) => {
    const g = find(id)!;
    if (g.vm && g.vm.status !== 'running') {
      const msg = `The gateway VM ${g.vmid} is ${g.vm.status} - start it to read its cables`;
      Object.assign(g, { cables_error: msg, cables_error_code: 'VM_STOPPED', cables_error_at: ago(0) });
      return fail(409, msg, 'VM_STOPPED');
    }
    Object.assign(g, { cables_at: ago(0), cables_error: '', cables_error_code: '', cables_error_at: null }); return delay(view(g));
  },
  check: (id) => { const g = find(id)!; g.last_check = ago(0); return delay(view(g)); },
};

export const jtagApi: JtagApi = isMock ? mockJtagApi : realJtagApi;
