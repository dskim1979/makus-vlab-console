// 데스크톱 템플릿 (가상머신 > 이미지): ready-made desktops - a use (일반 업무, 연구원, GPU · AI, NPU, FPGA) on the OS
// of your choice (Ubuntu, Debian, Rocky, AlmaLinux, Windows 11 / 10 / Server) - built on the cluster
// (makus-vlab pegaprox/api/vlab_desktpl.py, the catalog and texts in pegaprox/vlab/desktpl.py).
import { ApiError, isMock, request } from './client';

export type DeskPresetId = 'office' | 'research' | 'gpu' | 'npu' | 'fpga';
export type DeskDesktop = 'xfce' | 'gnome';
export type DeskOs = {
  id: string; name: string; platform: 'windows' | 'linux'; family?: 'debian' | 'rhel'; distro?: string; release?: string;
  edition?: string; iso_hint?: string; server?: boolean; download_page?: string;
};
export type DeskPreset = {
  id: DeskPresetId; name: string; name_en: string; platform: 'windows' | 'linux'; kind: string; summary: string;
  cores: number; memory_mb: number; disk_gb: number; output: 'template' | 'golden';
  features?: string[]; needs?: string[]; optional?: string[];
  os_choices: string[]; os_options: DeskOs[]; os_default: string;
};
export type DeskBuildStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type DeskBuild = {
  id: string; cluster_id: string; node: string; preset: string; name: string; vmid: number; status: DeskBuildStatus;
  step: string; progress: number; error: string; created_by: string; created_at: string; updated_at: string; finished_at: string | null;
  result: { golden_id?: string; vmid?: number; template_vmid?: number }; options: Record<string, unknown>; log?: string;
};
export type DeskBuildInput = {
  node: string; storage: string; bridge: string; name?: string; cores?: number; memory_mb?: number; disk_gb?: number;
  os?: string; desktop?: DeskDesktop;
  windows_iso?: string; windows_url?: string; virtio_iso?: string; edition?: string; language?: 'ko-KR' | 'en-US'; product_key?: string;
  vendor_dir?: string; accept_eula?: boolean; iso_storage?: string;   // iso_storage: where the cloud-init CD of a Linux build goes
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

// --- mock: the same catalog as the engine, and a build that walks through its stages ------------
const L = (id: string, name: string, family: 'debian' | 'rhel'): DeskOs => ({ id, name, platform: 'linux', family });
const OS: Record<string, DeskOs> = {
  'ubuntu-2404': L('ubuntu-2404', 'Ubuntu 24.04 LTS', 'debian'), 'ubuntu-2204': L('ubuntu-2204', 'Ubuntu 22.04 LTS', 'debian'),
  'ubuntu-2604': L('ubuntu-2604', 'Ubuntu 26.04 LTS', 'debian'), 'debian-13': L('debian-13', 'Debian 13', 'debian'), 'debian-12': L('debian-12', 'Debian 12', 'debian'),
  'rocky-9': L('rocky-9', 'Rocky Linux 9', 'rhel'), 'rocky-10': L('rocky-10', 'Rocky Linux 10', 'rhel'),
  'almalinux-9': L('almalinux-9', 'AlmaLinux 9', 'rhel'), 'almalinux-10': L('almalinux-10', 'AlmaLinux 10', 'rhel'),
  win11: { id: 'win11', name: 'Windows 11', platform: 'windows', edition: 'Windows 11 Pro', iso_hint: 'win(dows)?[ _-]?11', download_page: 'https://www.microsoft.com/ko-kr/software-download/windows11' },
  win10: { id: 'win10', name: 'Windows 10', platform: 'windows', edition: 'Windows 10 Pro', iso_hint: 'win(dows)?[ _-]?10' },
  ws2025: { id: 'ws2025', name: 'Windows Server 2025', platform: 'windows', server: true, edition: 'Windows Server 2025 SERVERDATACENTER', iso_hint: 'server[ _-]?2025|2k25' },
  ws2022: { id: 'ws2022', name: 'Windows Server 2022', platform: 'windows', server: true, edition: 'Windows Server 2022 SERVERDATACENTER', iso_hint: 'server[ _-]?2022|2k22' },
};
const ALL_LINUX = ['ubuntu-2404', 'ubuntu-2204', 'ubuntu-2604', 'debian-13', 'debian-12', 'rocky-9', 'rocky-10', 'almalinux-9', 'almalinux-10'];
const P = (p: Omit<DeskPreset, 'os_options' | 'os_default'>): DeskPreset => ({ ...p, os_options: p.os_choices.map((o) => OS[o]), os_default: p.os_choices[0] });
const PRESETS: DeskPreset[] = [
  P({ id: 'office', name: '일반 업무', name_en: 'Office', platform: 'windows', kind: 'general', cores: 4, memory_mb: 8192, disk_gb: 80, output: 'template',
    summary: 'Windows 무인 설치 · 게스트 도구 · RDP · 한국어 · Chrome · 7-Zip · sysprep', needs: ['windows_iso', 'virtio_iso'], os_choices: ['win11', 'win10', 'ws2025', 'ws2022'] }),
  P({ id: 'research', name: '연구원 · Linux', name_en: 'Research · Linux', platform: 'linux', kind: 'general', cores: 4, memory_mb: 8192, disk_gb: 64, output: 'golden',
    summary: '데스크톱(Xfce · GNOME) · 원격 데스크톱 · 한글 입력 · 개발 도구 · Python · JupyterLab · code-server', features: ['desktop', 'dev', 'ide'], os_choices: ALL_LINUX }),
  P({ id: 'gpu', name: 'GPU · AI', name_en: 'GPU · AI', platform: 'linux', kind: 'ai', cores: 8, memory_mb: 16384, disk_gb: 120, output: 'golden',
    summary: '연구원 템플릿 + NVIDIA 드라이버(open) · CUDA 12.8 · PyTorch', features: ['desktop', 'dev', 'ide', 'nvidia'], os_choices: ['ubuntu-2404', 'ubuntu-2204', 'rocky-9', 'almalinux-9'] }),
  P({ id: 'npu', name: 'NPU', name_en: 'NPU', platform: 'linux', kind: 'npu', cores: 8, memory_mb: 16384, disk_gb: 100, output: 'golden',
    summary: '연구원 템플릿 + NPU SDK(FuriosaAI · Rebellions 등, 관리자 패키지 폴더에서)', features: ['desktop', 'dev', 'ide', 'npu'], optional: ['vendor_dir'], os_choices: ['ubuntu-2204', 'ubuntu-2404'] }),
  P({ id: 'fpga', name: 'FPGA', name_en: 'FPGA', platform: 'linux', kind: 'fpga', cores: 8, memory_mb: 16384, disk_gb: 250, output: 'golden',
    summary: '연구원 템플릿 + Vivado/Vitis 필수 라이브러리 · JTAG udev · Vivado(설치 파일이 있으면 자동)', features: ['desktop', 'dev', 'ide', 'fpga'], optional: ['vendor_dir'],
    os_choices: ['ubuntu-2204', 'ubuntu-2404', 'rocky-9', 'almalinux-9'] }),
];
const STAGES = ['download', 'create', 'start', 'update', 'desktop', 'dev', 'ide', 'versions', 'seal', 'register', 'done'];
const builds: DeskBuild[] = [{
  id: 'dtb_demo1', cluster_id: 'lab-cluster', node: 'pve1', preset: 'research', name: 'moavi-research-ubuntu2404', vmid: 9100, status: 'completed', step: 'done', progress: 100,
  error: '', created_by: 'root', created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date().toISOString(), finished_at: new Date().toISOString(),
  result: { golden_id: 'gold_demo', vmid: 9100 }, options: { os: 'ubuntu-2404', desktop: 'xfce' }, log: '[09:00:01] build research\n[09:41:12] golden image ready\n',
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
    b.result = b.preset === 'office' ? { template_vmid: b.vmid } : { golden_id: 'gold_mock', vmid: b.vmid };
  }
  return b;
}

const mockApi: DeskApi = {
  list: async () => ({ presets: PRESETS, builds: builds.map(tick).map((b) => ({ ...b })) }),
  build: async (cid, preset, b) => {
    if (!b.node || !b.storage) throw new ApiError(400, 'node · storage 를 고르세요');
    const p = PRESETS.find((x) => x.id === preset)!;
    const os = b.os || p.os_default;
    const id = `dtb_${Math.random().toString(16).slice(2, 14)}`;
    const now = new Date().toISOString();
    const row: DeskBuild = { id, cluster_id: cid, node: b.node, preset, name: b.name || `moavi-${preset}-${os.replace(/-/g, '')}`, vmid: 9100 + builds.length, status: 'running',
      step: 'prepare', progress: 2, error: '', created_by: 'root', created_at: now, updated_at: now, finished_at: null, result: {}, options: { ...b, os } };
    builds.unshift(row); started.set(id, Date.now());
    return { build: { ...row }, ...(p.platform === 'windows' ? { admin_password: 'Mock-Pw-7Hq2Lx9-Kz', admin_user: 'moavi-admin' } : {}) };
  },
  get: async (id) => ({ ...tick(builds.find((b) => b.id === id)!) }),
  cancel: async (id) => { const b = builds.find((x) => x.id === id)!; b.status = 'cancelled'; b.finished_at = new Date().toISOString(); return { ...b }; },
};

export const desktplApi: DeskApi = isMock ? mockApi : realApi;
