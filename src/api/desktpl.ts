// 데스크톱 템플릿 (가상머신 > 이미지): ready-made desktops - 일반 업무 (Windows 11), 연구원, GPU · AI, NPU, FPGA -
// built on the cluster (makus-vlab pegaprox/api/vlab_desktpl.py, the texts in pegaprox/vlab/desktpl.py).
import { ApiError, isMock, request } from './client';

export type DeskPresetId = 'office-win11' | 'research' | 'gpu' | 'npu' | 'fpga';
export type DeskPreset = {
  id: DeskPresetId; name: string; name_en: string; os: 'windows' | 'linux'; kind: string; summary: string;
  cores: number; memory_mb: number; disk_gb: number; output: 'template' | 'golden'; base?: string; release?: string;
  features?: string[]; needs?: string[]; optional?: string[];
};
export type DeskBuildStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type DeskBuild = {
  id: string; cluster_id: string; node: string; preset: DeskPresetId; name: string; vmid: number; status: DeskBuildStatus;
  step: string; progress: number; error: string; created_by: string; created_at: string; updated_at: string; finished_at: string | null;
  result: { golden_id?: string; vmid?: number; template_vmid?: number }; options: Record<string, unknown>; log?: string;
};
export type DeskBuildInput = {
  node: string; storage: string; bridge: string; name?: string; cores?: number; memory_mb?: number; disk_gb?: number;
  windows_iso?: string; virtio_iso?: string; edition?: string; language?: 'ko-KR' | 'en-US';
  vendor_dir?: string; accept_eula?: boolean; iso_storage?: string;   // where the cloud-init CD of a Linux build goes
};
export type DeskBuildStarted = { build: DeskBuild; admin_password?: string; admin_user?: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string; code?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : `HTTP ${status}`;
    throw new ApiError(status, msg, data);
  }
  return data;
}
const enc = encodeURIComponent;
const A = '/api/vlab/admin/desktop-templates';

type DeskApi = {
  list: () => Promise<{ presets: DeskPreset[]; builds: DeskBuild[] }>;
  build: (cid: string, preset: DeskPresetId, b: DeskBuildInput) => Promise<DeskBuildStarted>;
  get: (id: string) => Promise<DeskBuild>;
  cancel: (id: string) => Promise<DeskBuild>;
};

const realApi: DeskApi = {
  list: () => call('GET', A),
  build: (cid, preset, b) => call('POST', `/api/vlab/admin/clusters/${enc(cid)}/desktop-templates/${enc(preset)}/build`, b),
  get: async (id) => (await call<{ build: DeskBuild }>('GET', `${A}/builds/${enc(id)}`)).build,
  cancel: async (id) => (await call<{ build: DeskBuild }>('POST', `${A}/builds/${enc(id)}/cancel`)).build,
};

// --- mock: the five presets, and a build that walks through its stages -------------------------
const PRESETS: DeskPreset[] = [
  { id: 'office-win11', name: '일반 업무 · Windows 11', name_en: 'Office · Windows 11', os: 'windows', kind: 'general', cores: 4, memory_mb: 8192, disk_gb: 80, output: 'template',
    summary: 'Windows 11 무인 설치 · 게스트 도구 · RDP · 한국어 · Chrome · 7-Zip · sysprep', needs: ['windows_iso', 'virtio_iso'] },
  { id: 'research', name: '연구원 · Ubuntu 24.04', name_en: 'Research · Ubuntu 24.04', os: 'linux', base: 'ubuntu-2404', release: '24.04', kind: 'general', cores: 4, memory_mb: 8192, disk_gb: 64, output: 'golden',
    summary: 'Xfce 데스크톱 · xrdp · 한글 입력 · 개발 도구 · Python · JupyterLab · code-server', features: ['desktop', 'dev', 'ide'] },
  { id: 'gpu', name: 'GPU · AI · Ubuntu 24.04', name_en: 'GPU · AI · Ubuntu 24.04', os: 'linux', base: 'ubuntu-2404', release: '24.04', kind: 'ai', cores: 8, memory_mb: 16384, disk_gb: 120, output: 'golden',
    summary: '연구원 템플릿 + NVIDIA 드라이버(open) · CUDA 12.8 · PyTorch', features: ['desktop', 'dev', 'ide', 'nvidia'] },
  { id: 'npu', name: 'NPU · Ubuntu 22.04', name_en: 'NPU · Ubuntu 22.04', os: 'linux', base: 'ubuntu-2204', release: '22.04', kind: 'npu', cores: 8, memory_mb: 16384, disk_gb: 100, output: 'golden',
    summary: '연구원 템플릿 + NPU SDK(FuriosaAI · Rebellions 등, 관리자 패키지 폴더에서)', features: ['desktop', 'dev', 'ide', 'npu'], optional: ['vendor_dir'] },
  { id: 'fpga', name: 'FPGA · Ubuntu 22.04', name_en: 'FPGA · Ubuntu 22.04', os: 'linux', base: 'ubuntu-2204', release: '22.04', kind: 'fpga', cores: 8, memory_mb: 16384, disk_gb: 250, output: 'golden',
    summary: '연구원 템플릿 + Vivado/Vitis 필수 라이브러리 · JTAG udev · Vivado(설치 파일이 있으면 자동)', features: ['desktop', 'dev', 'ide', 'fpga'], optional: ['vendor_dir'] },
];
const STAGES = ['download', 'create', 'start', 'update', 'desktop', 'dev', 'ide', 'versions', 'seal', 'register', 'done'];
const builds: DeskBuild[] = [{
  id: 'dtb_demo1', cluster_id: 'lab-cluster', node: 'pve1', preset: 'research', name: 'moavi-research', vmid: 9100, status: 'completed', step: 'done', progress: 100,
  error: '', created_by: 'root', created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date().toISOString(), finished_at: new Date().toISOString(),
  result: { golden_id: 'gold_demo', vmid: 9100 }, options: {}, log: '[09:00:01] build research\n[09:41:12] golden image ready\n',
}];
const started = new Map<string, number>();

function tick(b: DeskBuild) {
  if (b.status !== 'running') return b;
  const t = (Date.now() - (started.get(b.id) ?? Date.now())) / 1000;
  const i = Math.min(STAGES.length - 1, Math.floor(t / 3));
  b.step = STAGES[i]; b.progress = Math.round((i / (STAGES.length - 1)) * 100);
  b.log = STAGES.slice(0, i + 1).map((s, k) => `[mock +${k * 3}s] ${s}`).join('\n') + '\n';
  if (i === STAGES.length - 1) {
    b.status = 'completed'; b.finished_at = new Date().toISOString();
    b.result = b.preset === 'office-win11' ? { template_vmid: b.vmid } : { golden_id: 'gold_mock', vmid: b.vmid };
  }
  return b;
}

const mockApi: DeskApi = {
  list: async () => ({ presets: PRESETS, builds: builds.map(tick).map((b) => ({ ...b })) }),
  build: async (cid, preset, b) => {
    if (!b.node || !b.storage) throw new ApiError(400, 'node · storage 를 고르세요');
    const p = PRESETS.find((x) => x.id === preset)!;
    const id = `dtb_${Math.random().toString(16).slice(2, 14)}`;
    const now = new Date().toISOString();
    const row: DeskBuild = { id, cluster_id: cid, node: b.node, preset, name: b.name || `moavi-${preset}`, vmid: 9100 + builds.length, status: 'running',
      step: 'prepare', progress: 2, error: '', created_by: 'root', created_at: now, updated_at: now, finished_at: null, result: {}, options: { ...b } };
    builds.unshift(row); started.set(id, Date.now());
    return { build: { ...row }, ...(p.os === 'windows' ? { admin_password: 'Mock-Pw-7Hq2Lx9-Kz', admin_user: 'moavi-admin' } : {}) };
  },
  get: async (id) => ({ ...tick(builds.find((b) => b.id === id)!) }),
  cancel: async (id) => { const b = builds.find((x) => x.id === id)!; b.status = 'cancelled'; b.finished_at = new Date().toISOString(); return { ...b }; },
};

export const desktplApi: DeskApi = isMock ? mockApi : realApi;
