// 가상머신 > 환경 카탈로그 and NVIDIA MIG on the nodes (makus-vlab pegaprox/api/vlab_env.py,
// pegaprox/vlab/envcat.py, pegaprox/vlab/mig.py). Real calls and the mock (npm run dev:mock).
import { ApiError, isMock, request } from './client';
import { nextApi } from './next';

export type EnvKind = 'ai' | 'fpga' | 'npu' | 'general';
export type EnvComponent = { key: string; name: string; version: string; source?: 'probe' | 'manual' };
export type EnvHistory = { at: string; by: string; note: string; version?: string; changes: { key: string; from: string | null; to: string | null }[];
  kind?: { from: string; to: string } };
export type EnvProbe = { components?: EnvComponent[]; driver_cuda?: string; pytorch_cuda?: string; complete?: boolean; os_type?: string };
export type Environment = {
  golden_id: string; name: string; cluster_id: string; node: string; vmid: number; current_version: string; notes: string;
  status: string; kind: EnvKind; components: EnvComponent[]; cards: { mappings: string[]; vendors: string[] }; description: string;
  history: EnvHistory[]; probe: EnvProbe; probed_at: string | null; updated_by: string; updated_at: string | null; highlights: string[];
  pools: { id: string; name: string; type: string; gpu: { mode?: string; label?: string; mig?: boolean } }[];
};
export type EnvCatalog = { environments: Environment[]; kinds: EnvKind[]; components: Record<string, string> };
export type EnvSave = { kind?: EnvKind; components?: EnvComponent[]; cards?: { mappings: string[]; vendors: string[] }; description?: string; note?: string };
export type ProbeResult = { found: EnvProbe; changes: { key: string; from: string | null; to: string | null }[]; environment: Environment };

export type CompatNote = { severity: 'error' | 'warn' | 'info'; code: string; ko: string; en: string };
export type CompatCell = { mode: 'vgpu' | 'passthrough'; status: 'ok' | 'warn' | 'error' | 'unknown'; host_driver: string; host_branch: string;
  host_vgpu_release: string; guest_driver: string; guest_branch: string; cuda: string; pytorch_cuda: string; notes: CompatNote[] };
export type CompatNode = { node: string; readable: boolean; error: string; driver: string; vgpu_manager: boolean; models: string[] };
export type Compat = { nodes: CompatNode[]; rows: { golden_id: string; name: string; kind: EnvKind; highlights: string[]; use_vgpu: boolean | null;
  cells: Record<string, CompatCell> }[]; unreadable_nodes: string[] };

export type MigProfile = { name: string; id: number; free: number; total: number; memory_gb: number; sm: number };
export type MigGpuInstance = { profile: string; profile_id: number; id: number; start: number; size: number };
export type MigGpu = { index: number; bus_id: string; name: string; driver: string; mig_capable: boolean; mig_current: 'enabled' | 'disabled' | null;
  mig_pending: 'enabled' | 'disabled' | null; memory_mb: number | null; profiles: MigProfile[]; gpu_instances: MigGpuInstance[];
  compute_instances: { gpu_instance: number; profile: string; profile_id: number; id: number }[]; slices_used: number };
export type MigCard = { pciid: string; model: string; vgpu_capable: boolean; mig_capable: boolean; state: MigGpu | null;
  used_by: { vmid: number; name: string; slot: string; status: string; mdev: string | null }[] };
export type MigNode = { node: string; readable: boolean; error: string; driver: string; vgpu_manager: boolean; nvidia_tools: boolean; cards: MigCard[] };
export type MigState = { nodes: MigNode[]; unreadable_nodes: string[]; reference: Record<string, string[]>;
  summary: { mig_capable: number; mig_enabled: number; gpu_instances: number } };
export type MigWrite = { action: 'mode'; enable: boolean; reset?: boolean; confirm: string } | { action: 'layout'; layout: string[]; compute?: boolean; confirm: string };
export type MigWriteResult = { success: boolean; output: string; gpu: MigGpu | null; pending?: boolean };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}
const enc = encodeURIComponent;
const A = '/api/vlab/admin';

const realApi = {
  environments: () => call<EnvCatalog>('GET', `${A}/environments`),
  saveEnvironment: async (goldenId: string, b: EnvSave) =>
    (await call<{ environment: Environment }>('PUT', `${A}/golden-images/${enc(goldenId)}/environment`, b)).environment,
  probe: (goldenId: string, apply: boolean) => call<ProbeResult>('POST', `${A}/golden-images/${enc(goldenId)}/environment/probe`, { apply }),
  compat: (clusterId: string, refresh = false) => call<Compat>('GET', `${A}/clusters/${enc(clusterId)}/environment-compat${refresh ? '?refresh=1' : ''}`),
  mig: (clusterId: string, refresh = false) => call<MigState>('GET', `${A}/clusters/${enc(clusterId)}/mig${refresh ? '?refresh=1' : ''}`),
  setMig: (clusterId: string, node: string, index: number, b: MigWrite) =>
    call<MigWriteResult>('PUT', `${A}/clusters/${enc(clusterId)}/nodes/${enc(node)}/mig/${index}`, b),
};

// --- the mock ---------------------------------------------------------------------------------

const delay = <T,>(v: T, ms = 160) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  Promise.reject(new ApiError(status, error, { error, ...extra }));
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();
const C = (key: string, name: string, version: string, source?: 'probe'): EnvComponent => ({ key, name, version, ...(source ? { source } : {}) });

export const COMPONENT_NAMES: Record<string, string> = {
  os: 'OS', nvidia_driver: 'NVIDIA driver', cuda: 'CUDA', cudnn: 'cuDNN', pytorch: 'PyTorch', tensorflow: 'TensorFlow', jax: 'JAX',
  python: 'Python', rocm: 'ROCm', vivado: 'Vivado', vitis: 'Vitis', quartus: 'Quartus', furiosa: 'FuriosaAI SDK', rbln: 'Rebellions RBLN SDK',
};
const HIGHLIGHT = ['cuda', 'pytorch', 'tensorflow', 'jax', 'rocm', 'vivado', 'vitis', 'quartus', 'furiosa', 'rbln', 'nvidia_driver', 'cudnn', 'os', 'python'];
export function highlightsOf(components: EnvComponent[], n = 4) {
  const by = new Map(components.map((c) => [c.key, c]));
  const keys = [...HIGHLIGHT.filter((k) => by.has(k)), ...components.map((c) => c.key).filter((k) => !HIGHLIGHT.includes(k))];
  return keys.slice(0, n).map((k) => (k === 'os' ? by.get(k)!.version : `${by.get(k)!.name} ${by.get(k)!.version}`));
}

type MockEnv = Omit<Environment, 'golden_id' | 'name' | 'cluster_id' | 'node' | 'vmid' | 'current_version' | 'notes' | 'status' | 'highlights' | 'pools'>;
const envs: Record<string, MockEnv> = {
  gold_1: { kind: 'general', components: [C('os', 'OS', 'Windows 11 Education 23H2'), C('nvidia_driver', 'NVIDIA driver', '538.33'), C('python', 'Python', '3.12.4'), C('office', 'Microsoft Office', 'LTSC 2024')],
    cards: { mappings: ['gpu-a16'], vendors: ['NVIDIA'] }, description: '교양 · 프로그래밍 실습용 Windows 11. A16 vGPU 2Q로 화면 가속.',
    history: [{ at: iso(8000), by: 'admin', note: '2학기 시작 버전', version: 'gold-20260901-090000', changes: [{ key: 'python', from: '3.11.9', to: '3.12.4' }] }],
    probe: {}, probed_at: null, updated_by: 'admin', updated_at: iso(8000) },
  gold_2: { kind: 'fpga', components: [C('os', 'OS', 'Ubuntu 22.04'), C('vivado', 'Vivado', '2024.2', 'probe'), C('vitis', 'Vitis', '2024.2', 'probe'), C('petalinux', 'PetaLinux', '2024.2')],
    cards: { mappings: ['fpga-u250', 'fpga-u55c'], vendors: ['AMD Xilinx'] }, description: 'FPGA 설계 · 빌드. Vivado/Vitis는 NFS /tools 마운트, Alveo U250 · U55C XRT 2.18.',
    history: [{ at: iso(20000), by: 'admin', note: 'PetaLinux 추가', version: 'gold-20261002-140000', changes: [{ key: 'petalinux', from: null, to: '2024.2' }] }],
    probe: { components: [C('vivado', 'Vivado', '2024.2', 'probe'), C('vitis', 'Vitis', '2024.2', 'probe')], complete: true, os_type: 'linux' },
    probed_at: iso(20000), updated_by: 'admin', updated_at: iso(20000) },
  gold_3: { kind: 'ai', components: [C('os', 'OS', 'Ubuntu 22.04'), C('nvidia_driver', 'NVIDIA driver', '550.127.05', 'probe'), C('cuda', 'CUDA', '12.4', 'probe'),
    C('cudnn', 'cuDNN', '9.1.0', 'probe'), C('pytorch', 'PyTorch', '2.4.1+cu124', 'probe'), C('python', 'Python', '3.10.12', 'probe')],
    cards: { mappings: ['gpu-a100', 'gpu-l40s'], vendors: ['NVIDIA'] }, description: 'LLM 미세조정 · 딥러닝 실습. A100 MIG(3g.40gb)나 L40S vGPU로 나눠 줍니다. Jupyter · VS Code 포함.',
    history: [
      { at: iso(2000), by: 'admin', note: '버전 읽기', version: 'gold-20261012-100000', changes: [{ key: 'pytorch', from: '2.3.1+cu121', to: '2.4.1+cu124' }, { key: 'cuda', from: '12.1', to: '12.4' }] },
      { at: iso(30000), by: 'admin', note: '첫 등록', version: 'gold-20260820-090000', changes: [{ key: 'cuda', from: null, to: '12.1' }] }],
    probe: { components: [], driver_cuda: '12.4', pytorch_cuda: '12.4', complete: true, os_type: 'linux' }, probed_at: iso(2000), updated_by: 'admin', updated_at: iso(2000) },
  gold_4: { kind: 'npu', components: [C('os', 'OS', 'Ubuntu 22.04'), C('rbln', 'Rebellions RBLN SDK', '0.5.2', 'probe'), C('furiosa', 'FuriosaAI SDK', '2025.1.0'), C('python', 'Python', '3.10.12', 'probe')],
    cards: { mappings: ['npu-atom-vf', 'npu-rngd'], vendors: ['Rebellions', 'FuriosaAI'] }, description: '국산 NPU 추론 실습. Rebellions ATOM VF 하나 또는 FuriosaAI RNGD.',
    history: [], probe: {}, probed_at: null, updated_by: 'admin', updated_at: iso(5000) },
};

async function mockEnvironments(): Promise<EnvCatalog> {
  const golden = await nextApi.goldenImages();
  const pools = [{ id: 'p1', name: '공용 LAB A', type: 'shared', gold: 'gold_1', gpu: { mode: 'vgpu', label: 'A16-2Q' } },
    { id: 'p_farm', name: 'FPGA 빌드 팜', type: 'buildfarm', gold: 'gold_2', gpu: { mode: 'passthrough', label: 'Alveo U250' } },
    { id: 'p_llm', name: 'LLM 실습 (A100 MIG)', type: 'dedicated', gold: 'gold_3', gpu: { mode: 'vgpu', label: 'A100D-3-40C', mig: true } }];
  return {
    kinds: ['ai', 'fpga', 'npu', 'general'], components: COMPONENT_NAMES,
    environments: golden.map((g) => {
      const e = envs[g.id] ?? { kind: 'general', components: [], cards: { mappings: [], vendors: [] }, description: '', history: [], probe: {}, probed_at: null, updated_by: '', updated_at: null };
      return { golden_id: g.id, name: g.name, cluster_id: g.cluster_id, node: g.node, vmid: g.vmid, current_version: g.current_version, notes: g.notes,
        status: g.status, ...JSON.parse(JSON.stringify(e)), highlights: highlightsOf(e.components),
        pools: pools.filter((p) => p.gold === g.id).map(({ gold: _g, ...p }) => p) };
    }),
  };
}

function diff(a: EnvComponent[], b: EnvComponent[]) {
  const A2 = new Map(a.map((c) => [c.key, c.version])), B2 = new Map(b.map((c) => [c.key, c.version]));
  const keys = [...A2.keys(), ...[...B2.keys()].filter((k) => !A2.has(k))];
  return keys.filter((k) => A2.get(k) !== B2.get(k)).map((k) => ({ key: k, from: A2.get(k) ?? null, to: B2.get(k) ?? null }));
}

const PROBED: Record<string, EnvComponent[]> = {
  gold_2: [C('os', 'OS', 'Ubuntu 22.04', 'probe'), C('vivado', 'Vivado', '2024.2', 'probe'), C('vitis', 'Vitis', '2024.2', 'probe')],
  gold_3: [C('os', 'OS', 'Ubuntu 22.04', 'probe'), C('nvidia_driver', 'NVIDIA driver', '550.127.05', 'probe'), C('cuda', 'CUDA', '12.4', 'probe'),
    C('cudnn', 'cuDNN', '9.1.0', 'probe'), C('pytorch', 'PyTorch', '2.5.1+cu124', 'probe'), C('python', 'Python', '3.10.12', 'probe')],
  gold_4: [C('os', 'OS', 'Ubuntu 22.04', 'probe'), C('rbln', 'Rebellions RBLN SDK', '0.5.3', 'probe'), C('python', 'Python', '3.10.12', 'probe')],
};

// node state for the mock: pve1 A16 ×2 (vGPU 17), pve2 L40S + A100 80GB in MIG mode (vGPU 17)
const A100_PROFILES: MigProfile[] = [
  { name: '1g.10gb', id: 19, free: 3, total: 7, memory_gb: 9.75, sm: 14 }, { name: '1g.20gb', id: 15, free: 1, total: 4, memory_gb: 19.62, sm: 14 },
  { name: '2g.20gb', id: 14, free: 1, total: 3, memory_gb: 19.62, sm: 28 }, { name: '3g.40gb', id: 9, free: 0, total: 2, memory_gb: 39.38, sm: 42 },
  { name: '4g.40gb', id: 5, free: 0, total: 1, memory_gb: 39.38, sm: 56 }, { name: '7g.80gb', id: 0, free: 0, total: 1, memory_gb: 79.12, sm: 98 },
];
let a100: MigGpu = { index: 1, bus_id: '0000:a1:00.0', name: 'NVIDIA A100 80GB PCIe', driver: '550.127.06', mig_capable: true, mig_current: 'enabled',
  mig_pending: 'enabled', memory_mb: 81920, profiles: A100_PROFILES,
  gpu_instances: [{ profile: '3g.40gb', profile_id: 9, id: 2, start: 0, size: 4 }, { profile: '2g.20gb', profile_id: 14, id: 3, start: 4, size: 2 },
    { profile: '1g.10gb', profile_id: 19, id: 9, start: 6, size: 1 }], compute_instances: [], slices_used: 7 };
const plain = (index: number, bus: string, name: string): MigGpu => ({ index, bus_id: bus, name, driver: '550.127.06', mig_capable: false, mig_current: null,
  mig_pending: null, memory_mb: 49152, profiles: [], gpu_instances: [], compute_instances: [], slices_used: 0 });
let a100Busy = true;

function mockMig(): MigState {
  const nodes: MigNode[] = [
    { node: 'pve1', readable: true, error: '', driver: '550.127.06', vgpu_manager: true, nvidia_tools: true, cards: [
      { pciid: '0000:41:00.0', model: 'A16 (GA107GL)', vgpu_capable: true, mig_capable: false, state: plain(0, '0000:41:00.0', 'NVIDIA A16'), used_by: [] },
      { pciid: '0000:42:00.0', model: 'A16 (GA107GL)', vgpu_capable: true, mig_capable: false, state: plain(1, '0000:42:00.0', 'NVIDIA A16'), used_by: [] }] },
    { node: 'pve2', readable: true, error: '', driver: '550.127.06', vgpu_manager: true, nvidia_tools: true, cards: [
      { pciid: '0000:61:00.0', model: 'L40S (AD102GL)', vgpu_capable: true, mig_capable: false, state: plain(0, '0000:61:00.0', 'NVIDIA L40S'), used_by: [] },
      { pciid: '0000:a1:00.0', model: 'GA100 [A100 PCIe 80GB]', vgpu_capable: true, mig_capable: true, state: JSON.parse(JSON.stringify(a100)),
        used_by: a100Busy ? [{ vmid: 304, name: 'lab-win11-05', slot: 'hostpci15', status: 'running', mdev: 'nvidia-700' }] : [] }] },
  ];
  return { nodes, unreadable_nodes: [], reference: {
    'A100 40GB': ['1g.5gb x7', '1g.10gb x4', '2g.10gb x3', '3g.20gb x2', '4g.20gb x1', '7g.40gb x1'],
    'A100 80GB': ['1g.10gb x7', '1g.20gb x4', '2g.20gb x3', '3g.40gb x2', '4g.40gb x1', '7g.80gb x1'],
    'A30 24GB': ['1g.6gb x4', '2g.12gb x2', '4g.24gb x1'],
    'H100 80GB': ['1g.10gb x7', '1g.20gb x4', '2g.20gb x3', '3g.40gb x2', '4g.40gb x1', '7g.80gb x1'],
    'H200 141GB': ['1g.18gb x7', '1g.35gb x4', '2g.35gb x3', '3g.71gb x2', '4g.71gb x1', '7g.141gb x1'] },
    summary: { mig_capable: 1, mig_enabled: a100.mig_current === 'enabled' ? 1 : 0, gpu_instances: a100.gpu_instances.length } };
}

const CUDA_MIN: [string, string][] = [['13.0', '580.65'], ['12.9', '575.51'], ['12.8', '570.26'], ['12.6', '560.28'], ['12.5', '555.42'], ['12.4', '550.54'],
  ['12.3', '545.23'], ['12.2', '535.54'], ['12.1', '530.30'], ['12.0', '525.60'], ['11.8', '520.61']];
const vt = (v: string) => (v.match(/\d+/g) ?? []).slice(0, 3).map(Number);
const ge = (a: string, b: string) => { const x = vt(a), y = vt(b); for (let i = 0; i < 3; i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); } return true; };
const VGPU: Record<string, string> = { '470': '13', '510': '14', '525': '15', '535': '16', '550': '17', '570': '18', '580': '19' };

function mockCell(env: MockEnv, node: CompatNode, useVgpu: boolean | null): CompatCell {
  const get = (k: string) => env.components.find((c) => c.key === k)?.version ?? '';
  const guest = get('nvidia_driver'), cuda = get('cuda');
  const vgpu = useVgpu ?? node.vgpu_manager;
  const hb = node.driver.split('.')[0], gb = guest.split('.')[0];
  const notes: CompatNote[] = [];
  if (vgpu && guest && hb !== gb) notes.push({ severity: Number(gb) > Number(hb) ? 'error' : 'warn', code: 'VGPU_BRANCH',
    ko: `NVIDIA vGPU는 호스트 vGPU 매니저와 게스트 드라이버의 릴리스 브랜치가 같아야 합니다. 호스트 ${node.driver}(vGPU ${VGPU[hb] ?? '?'}, R${hb}) · 게스트 ${guest}(vGPU ${VGPU[gb] ?? '?'}, R${gb}).`,
    en: `NVIDIA vGPU needs the host vGPU manager and the guest driver on the same release branch. Host ${node.driver} (vGPU ${VGPU[hb] ?? '?'}, R${hb}), guest ${guest} (vGPU ${VGPU[gb] ?? '?'}, R${gb}).` });
  const need = CUDA_MIN.find(([c]) => c === cuda)?.[1];
  if (guest && need && !ge(guest, need)) notes.push({ severity: 'error', code: 'CUDA_DRIVER_OLD', ko: `CUDA ${cuda}에는 드라이버 ${need} 이상이 필요합니다(지금 ${guest}).`, en: `CUDA ${cuda} needs driver ${need} or newer (this is ${guest}).` });
  if (!guest && !cuda) notes.push({ severity: 'info', code: 'NO_GUEST_DRIVER', ko: '게스트 NVIDIA 드라이버 버전이 적혀 있지 않습니다.', en: 'The guest NVIDIA driver is not noted.' });
  const status = notes.some((n) => n.severity === 'error') ? 'error' : notes.some((n) => n.severity === 'warn') ? 'warn' : (!guest && !cuda ? 'unknown' : 'ok');
  return { mode: vgpu ? 'vgpu' : 'passthrough', status, host_driver: node.driver, host_branch: hb, host_vgpu_release: vgpu ? VGPU[hb] ?? '' : '',
    guest_driver: guest, guest_branch: gb, cuda, pytorch_cuda: '', notes };
}

const mockApi: typeof realApi = {
  environments: () => mockEnvironments().then((r) => delay(r)),
  saveEnvironment: async (goldenId, b) => {
    const e = envs[goldenId] ?? (envs[goldenId] = { kind: 'general', components: [], cards: { mappings: [], vendors: [] }, description: '', history: [], probe: {}, probed_at: null, updated_by: '', updated_at: null });
    const keys = (b.components ?? []).map((c) => c.key);
    if (new Set(keys).size !== keys.length) return fail(400, 'A component is listed twice');
    if ((b.components ?? []).some((c) => !c.version.trim())) return fail(400, 'Each component needs a version');
    const changes = b.components ? diff(e.components, b.components) : [];
    const kindChanged = b.kind && b.kind !== e.kind;
    if (changes.length || b.note || kindChanged) e.history.unshift({ at: iso(0), by: 'admin', note: b.note ?? '', changes, ...(kindChanged ? { kind: { from: e.kind, to: b.kind! } } : {}) });
    Object.assign(e, { ...(b.kind ? { kind: b.kind } : {}), ...(b.components ? { components: b.components } : {}), ...(b.cards ? { cards: b.cards } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}), updated_by: 'admin', updated_at: iso(0) });
    return (await mockEnvironments()).environments.find((x) => x.golden_id === goldenId)!;
  },
  probe: async (goldenId, apply) => {
    const all = await mockEnvironments();
    const env = all.environments.find((x) => x.golden_id === goldenId)!;
    if (env.status !== 'running') return fail(409, 'Start the golden image VM first: the versions are read inside it', { code: 'NOT_RUNNING' });
    await delay(null, 1400);
    const found: EnvProbe = { components: PROBED[goldenId] ?? [C('os', 'OS', 'Ubuntu 22.04', 'probe')], complete: true, os_type: 'linux',
      driver_cuda: goldenId === 'gold_3' ? '12.4' : '', pytorch_cuda: goldenId === 'gold_3' ? '12.4' : '' };
    const e = envs[goldenId];
    e.probe = found; e.probed_at = iso(0);
    let changes: ProbeResult['changes'] = [];
    if (apply) {
      const merged = e.components.map((c) => ({ ...c }));
      for (const f of found.components ?? []) {
        const i = merged.findIndex((c) => c.key === f.key);
        if (i >= 0) merged[i] = { ...merged[i], version: f.version, source: 'probe' }; else merged.push({ ...f });
      }
      changes = diff(e.components, merged);
      if (changes.length) e.history.unshift({ at: iso(0), by: 'admin', note: '버전 읽기', changes });
      e.components = merged;
    }
    return { found, changes, environment: (await mockEnvironments()).environments.find((x) => x.golden_id === goldenId)! };
  },
  compat: async () => {
    const nodes: CompatNode[] = mockMig().nodes.map((n) => ({ node: n.node, readable: n.readable, error: n.error, driver: n.driver, vgpu_manager: n.vgpu_manager,
      models: [...new Set(n.cards.map((c) => c.state?.name ?? c.model))] }));
    const mapNodes: Record<string, string[]> = { 'gpu-a16': ['pve1'], 'gpu-l40s': ['pve2'], 'gpu-a100': ['pve2'] };
    const rows = Object.entries(envs).filter(([, e]) => e.components.some((c) => c.key === 'nvidia_driver' || c.key === 'cuda') || e.cards.vendors.includes('NVIDIA'))
      .map(([id, e]) => {
        const want = new Set(e.cards.mappings.flatMap((m) => mapNodes[m] ?? []));
        const useVgpu = id === 'gold_1' || id === 'gold_3' ? true : null;
        const cells: Record<string, CompatCell> = {};
        nodes.filter((n) => !want.size || want.has(n.node)).forEach((n) => { cells[n.node] = mockCell(e, n, useVgpu); });
        return { golden_id: id, name: id === 'gold_1' ? 'win11-실습-골든' : id === 'gold_3' ? 'ubuntu-ai-pytorch' : id, kind: e.kind, highlights: highlightsOf(e.components), use_vgpu: useVgpu, cells };
      });
    return delay({ nodes, rows, unreadable_nodes: [] }, 400);
  },
  mig: () => delay(mockMig(), 350),
  setMig: async (_cid, node, index, b) => {
    if (b.confirm !== node) return fail(400, 'Type the node name to confirm', { code: 'CONFIRM' });
    if (node !== 'pve2' || index !== 1) return fail(409, 'This card does not support MIG');
    if (a100Busy) {
      a100Busy = false;   // the demo: the first try is refused, the VM is "stopped" for the next one
      return fail(409, 'VMs on this node are using an NVIDIA card: stop them first', { code: 'BUSY', vms: [{ vmid: 304, name: 'lab-win11-05', slot: 'hostpci15' }] });
    }
    await delay(null, 900);
    if (b.action === 'mode') {
      a100 = { ...a100, mig_current: b.enable ? 'enabled' : 'disabled', mig_pending: b.enable ? 'enabled' : 'disabled', gpu_instances: b.enable ? a100.gpu_instances : [], slices_used: b.enable ? a100.slices_used : 0 };
      return { success: true, output: `${b.enable ? 'Enabled' : 'Disabled'} MIG Mode for GPU 00000000:A1:00.0\nAll done.`, gpu: a100, pending: false };
    }
    if (a100.mig_current !== 'enabled') return fail(409, 'Turn MIG mode on first', { code: 'MIG_OFF' });
    const sizes: Record<string, number> = { '1g.10gb': 1, '1g.20gb': 1, '2g.20gb': 2, '3g.40gb': 4, '4g.40gb': 4, '7g.80gb': 8 };
    const used = b.layout.reduce((n, p) => n + (sizes[p] ?? 99), 0);
    if (used > 8) return fail(400, `the layout needs more than the card has (${used} of 8 memory slices)`);
    let start = 0;
    const gis = b.layout.map((p, i) => { const g = { profile: p, profile_id: A100_PROFILES.find((x) => x.name === p)!.id, id: i + 1, start, size: sizes[p] }; start += sizes[p]; return g; });
    a100 = { ...a100, gpu_instances: gis, slices_used: gis.reduce((n, g) => n + g.size, 0),
      compute_instances: b.compute ? gis.map((g) => ({ gpu_instance: g.id, profile: g.profile, profile_id: 0, id: 0 })) : [],
      profiles: A100_PROFILES.map((p) => ({ ...p, free: Math.max(0, Math.floor((8 - start) / (sizes[p.name] || 8))) })) };
    return { success: true, output: gis.map((g) => `Successfully created GPU instance ID ${g.id} on GPU 1 using profile MIG ${g.profile} (ID ${g.profile_id})`).join('\n'), gpu: a100 };
  },
};

export const envApi = isMock ? mockApi : realApi;
