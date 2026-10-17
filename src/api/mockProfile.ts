// Mock mode only (screenshots, demos): the sample data follows the site profile. With GPU · AI
// and FPGA off the research desktops and pools read as an office's (Vivado build VMs become
// developer desktops, the cards and vGPUs are left out), so a general-VDI demo shows no FPGA.
const KEY = 'vlab.mock.features';

function groups(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    const f = raw ? JSON.parse(raw) as { groups?: string[]; chosen?: boolean } : null;
    return f && f.chosen && Array.isArray(f.groups) ? f.groups : null;
  } catch { return null; }
}

const NAMES: [RegExp, string][] = [
  [/vivado-build-0?(\d+)/g, 'dev-ubuntu-0$1'], [/gpu-build-0?(\d+)/g, 'dev-ubuntu-1$1'], [/gpu-ws-(\w+)/g, 'office-win11-$1'],
  [/board-lab-zcu102/g, 'office-win11-12'], [/ai-ws-03/g, 'office-win11-03'],
  [/FPGA 빌드 팜/g, '개발팀'], [/A100 학습 팜/g, '개발팀 2'], [/GPU 학습 팜/g, '개발팀 2'], [/보드 LAB/g, '인사팀'], [/AI 연구실/g, '영업팀'],
  [/Rocky Linux 9/g, 'Ubuntu 22.04'],
];
// without LAB the lab rooms read as shared office desktops
const LAB_NAMES: [RegExp, string][] = [[/공용 LAB A/g, '공용 데스크톱'], [/lab-win11-(\d+)/g, 'shared-win11-$1'], [/교육장 A 수업용/g, '교육용']];
// lists of cards become empty lists, a card or vGPU object goes (the screens read lists with .map)
const EMPTY = new Set(['resources', 'cards', 'leases']);
const DROP = new Set(['gpu', 'gpu_util', 'card', 'lease']);

/** The sample answer as the current profile would show it. */
export function forProfile<T>(v: T): T {
  const g = groups();
  if (!g || g.includes('gpuai') || g.includes('fpga') || v === undefined || v === null) return v;
  let s: string;
  try { s = JSON.stringify(v); } catch { return v; }
  if (s === undefined) return v;
  const lab = g.includes('lab');
  for (const [re, to] of [...NAMES, ...(lab ? [] : LAB_NAMES)]) s = s.replace(re, to);
  return JSON.parse(s, (k, val) => (EMPTY.has(k) && Array.isArray(val) ? [] : DROP.has(k) && val && typeof val === 'object' && !Array.isArray(val) ? undefined : val)) as T;
}
