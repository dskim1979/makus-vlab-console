// AI · GPU 연구: GPU 작업 큐 (빌드 작업이 GPU를 요구), 사용자 · 부서 할당량과 공정 분배, GPU-시간
// 보고서, 웹 IDE (JupyterLab / VS Code) - makus-vlab pegaprox/vlab/research.py, pegaprox/api/vlab_research.py.
// A GPU job is sent through /api/vlab/me/build-jobs (next.ts) with gpus and the rest; the queue picks
// a build VM with free GPUs. A web IDE is reached only through vlab-proxy /ide/<id>/ with a one-time link.
import { ApiError, isMock, request } from './client';

export type GpuEnv = { kind: 'conda'; name: string } | { kind: 'container'; image: string };
export type Notify = { mail?: boolean; webhook?: boolean; start?: boolean };
export type GpuJobFields = { gpus?: number; gpu_kind?: string; memory_gb?: number; max_minutes?: number; env?: GpuEnv | null; notify?: Notify };
export type WaitReason = '' | 'quota_gpus' | 'quota_gpus_department' | 'quota_hours' | 'held_for_older' | 'no_free_gpu' | 'no_free_vm' | 'no_gpu_pool';
export type Runtime = 'docker' | 'podman' | 'apptainer';
export type GpuPoolConf = { gpus_per_vm: number; kind: string; max_minutes: number; runtime: Runtime };
export type MyGpuPool = GpuPoolConf & { id: string; name: string; workdir: string };
export type Quota = {
  subject_type: 'user' | 'department' | 'default'; subject_id: string; max_gpus: number; monthly_gpu_hours: number; hard: boolean; note: string;
  updated_at?: string; name?: string; gpus_now?: number | null; hours_month?: number | null;
};
export type MyQuota = Quota & { applies_as: 'user' | 'department'; applies_to: string; gpus_now: number; hours_month: number };
export type MyGpu = { gpus_now: number; hours_month: number; quotas: MyQuota[]; pools: MyGpuPool[]; mail: boolean; webhook: boolean; default_max_minutes: number };
export type QueueJob = {
  id: string; pool_id: string; pool: string | null; username: string; name: string; command: string; gpus: number; gpu_kind: string;
  memory_gb: number; max_minutes: number; env: GpuEnv | null; created_at: string; started_at: string | null; desktop: string | null;
  gpu_index: number[]; position?: number | null; wait_reason?: WaitReason; waited_min?: number; status: string;
};
export type QueuePool = { id: string; name: string; kind: string; gpus_per_vm: number; vms: number; gpus: number; gpus_used: number; max_minutes: number; runtime: Runtime };
export type GpuSettings = {
  mail: boolean; channels: string[]; starve_minutes: number; default_max_minutes: number; max_queued_per_user: number;
  // per-user notices (engine pegaprox/api/vlab_notices.py); each user turns kinds off in 내 계정 > 알림
  quota_notice: boolean; quota_warn_pct: number; loan_remind_hours: number; loan_notice: boolean; ide_notice: boolean;
  notice_webhook: boolean; queue_alert_hours: number;
};
export type GpuQueue = { queued: QueueJob[]; running: QueueJob[]; pools: QueuePool[]; settings: GpuSettings };
export type QuotaList = { quotas: Quota[]; users: { username: string; gpus_now: number; hours_month: number }[]; month_start: string };
export type QuotaInput = { subject_type: Quota['subject_type']; subject_id?: string; max_gpus: number; monthly_gpu_hours: number; hard: boolean; note: string };
export type UsageUserRow = { username: string; display_name: string; department_id: string; department: string; job_gpu_hours: number;
  loan_gpu_hours: number; total_gpu_hours: number; jobs: number; loans: number; share_pct: number };
export type UsageDeptRow = { department_id: string; department: string; users: number; job_gpu_hours: number; loan_gpu_hours: number; total_gpu_hours: number; share_pct: number };
export type UsageReport<R> = { since: string; until: string; group: 'user' | 'department'; rows: R[]; total_gpu_hours: number };
export type UsageWindow = { days?: number; month?: string; rollup?: boolean };

export type IdeKind = 'jupyter' | 'vscode';
export type IdeFolder = 'home' | 'scratch';
export type IdeState = 'starting' | 'running' | 'stopped' | 'failed';
export type IdeSession = {
  id: string; username: string; desktop_id: string; desktop: string | null; pool_id: string; kind: IdeKind; folder: IdeFolder; workdir: string;
  state: IdeState; error: string; created_at: string; started_at: string | null; last_seen: string | null; stopped_at: string | null; path: string;
};
export type IdeTarget = { id: string; name: string; pool?: string; kinds: IdeKind[]; folders: Record<IdeFolder, boolean>; gpu?: boolean };
export type MyIde = { sessions: IdeSession[]; desktops: IdeTarget[]; pools: IdeTarget[] };
export type IdeStart = { desktop_id?: string; pool_id?: string; kind: IdeKind; folder: IdeFolder };

const enc = encodeURIComponent;
const A = '/api/vlab/admin';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const d = data as { error?: string } | null;
    throw new ApiError(status, d && typeof d.error === 'string' ? d.error : `HTTP ${status}`, d);
  }
  return data;
}

const usageQuery = (w: UsageWindow, group: string) =>
  `group=${group}${w.month ? `&month=${enc(w.month)}` : `&days=${w.days ?? 30}`}${w.rollup ? '&rollup=1' : ''}`;

const real = {
  myGpu: () => call<MyGpu>('GET', '/api/vlab/me/gpu'),
  stopMyJob: async (id: string) => { await call('POST', `/api/vlab/me/build-jobs/${enc(id)}/stop`); },
  stopJob: async (id: string) => { await call('POST', `${A}/build-jobs/${enc(id)}/stop`); },
  queue: () => call<GpuQueue>('GET', `${A}/gpu-queue`),
  quotas: () => call<QuotaList>('GET', `${A}/gpu-quotas`),
  saveQuota: async (q: QuotaInput) => (await call<{ quota: Quota }>('PUT', `${A}/gpu-quotas`, q)).quota,
  deleteQuota: async (type: string, id: string) => { await call('DELETE', `${A}/gpu-quotas?subject_type=${enc(type)}&subject_id=${enc(id)}`); },
  settings: async () => (await call<{ settings: GpuSettings }>('GET', `${A}/gpu-settings`)).settings,
  saveSettings: async (s: Partial<GpuSettings>) => (await call<{ settings: GpuSettings }>('PUT', `${A}/gpu-settings`, s)).settings,
  poolConf: (poolId: string) => call<{ gpu_jobs: GpuPoolConf; saved: boolean }>('GET', `${A}/pools/${enc(poolId)}/gpu-jobs`),
  savePoolConf: async (poolId: string, c: GpuPoolConf) => (await call<{ gpu_jobs: GpuPoolConf }>('PUT', `${A}/pools/${enc(poolId)}/gpu-jobs`, c)).gpu_jobs,
  usageByUser: (w: UsageWindow) => call<UsageReport<UsageUserRow>>('GET', `${A}/reports/gpu-usage?${usageQuery(w, 'user')}`),
  usageByDept: (w: UsageWindow) => call<UsageReport<UsageDeptRow>>('GET', `${A}/reports/gpu-usage?${usageQuery(w, 'department')}`),

  myIde: () => call<MyIde>('GET', '/api/vlab/me/ide'),
  startIde: (b: IdeStart) => call<{ session: IdeSession; reused: boolean }>('POST', '/api/vlab/me/ide', b),
  ideStatus: async (id: string) => (await call<{ session: IdeSession }>('GET', `/api/vlab/me/ide/${enc(id)}`)).session,
  openIde: (id: string) => call<{ url: string; expires_in: number }>('POST', `/api/vlab/me/ide/${enc(id)}/open`),
  stopIde: async (id: string) => { await call('DELETE', `/api/vlab/me/ide/${enc(id)}`); },
  ideSessions: async () => (await call<{ sessions: IdeSession[] }>('GET', `${A}/ide-sessions`)).sessions,
  adminStopIde: async (id: string) => { await call('DELETE', `${A}/ide-sessions/${enc(id)}`); },
};

// --- mock ---------------------------------------------------------------------------------------

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));
const fail = (status: number, msg: string, body?: unknown) => Promise.reject(new ApiError(status, msg, body));
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
let seq = 100;
const nid = (p: string) => `${p}_${(seq++).toString(16).padStart(12, '0')}`;

const mockPools: (QueuePool & { users: string[] })[] = [
  { id: 'p_gpu', name: 'A100 학습 팜', kind: 'A100', gpus_per_vm: 4, vms: 3, gpus: 12, gpus_used: 0, max_minutes: 2880, runtime: 'docker', users: ['alice', 'bob', 'carol', 'dave'] },
  { id: 'p_l40', name: 'L40S 추론 팜', kind: 'L40S', gpus_per_vm: 2, vms: 2, gpus: 4, gpus_used: 0, max_minutes: 720, runtime: 'apptainer', users: ['alice', 'carol'] },
];
const mockJobs: QueueJob[] = [
  { id: 'job_g1', pool_id: 'p_gpu', pool: 'A100 학습 팜', username: 'alice', name: 'llama-7b LoRA', command: 'torchrun --nproc_per_node 4 train.py', gpus: 4, gpu_kind: 'A100',
    memory_gb: 200, max_minutes: 1440, env: { kind: 'container', image: 'nvcr.io/nvidia/pytorch:24.08-py3' }, created_at: ago(190), started_at: ago(185), desktop: 'gpu-build-01', gpu_index: [0, 1, 2, 3], status: 'running' },
  { id: 'job_g2', pool_id: 'p_gpu', pool: 'A100 학습 팜', username: 'bob', name: 'ViT 미세조정', command: 'python finetune.py --epochs 30', gpus: 2, gpu_kind: '',
    memory_gb: 64, max_minutes: 600, env: { kind: 'conda', name: 'torch24' }, created_at: ago(95), started_at: ago(90), desktop: 'gpu-build-02', gpu_index: [0, 1], status: 'running' },
  { id: 'job_g3', pool_id: 'p_gpu', pool: 'A100 학습 팜', username: 'carol', name: 'diffusion 학습', command: 'accelerate launch train_sd.py', gpus: 2, gpu_kind: 'A100',
    memory_gb: 96, max_minutes: 1440, env: null, created_at: ago(80), started_at: ago(70), desktop: 'gpu-build-02', gpu_index: [2, 3], status: 'running' },
  { id: 'job_g4', pool_id: 'p_gpu', pool: 'A100 학습 팜', username: 'dave', name: '8-GPU 사전학습', command: 'deepspeed pretrain.py', gpus: 4, gpu_kind: 'A100',
    memory_gb: 240, max_minutes: 2880, env: null, created_at: ago(75), started_at: null, desktop: null, gpu_index: [], status: 'queued' },
  { id: 'job_g5', pool_id: '', pool: null, username: 'alice', name: 'ablation #2', command: 'python train.py --abl 2', gpus: 1, gpu_kind: '',
    memory_gb: 32, max_minutes: 240, env: { kind: 'conda', name: 'torch24' }, created_at: ago(40), started_at: null, desktop: null, gpu_index: [], status: 'queued' },
  { id: 'job_g6', pool_id: '', pool: null, username: 'bob', name: '평가 스윕', command: 'python eval.py --all', gpus: 1, gpu_kind: '',
    memory_gb: 16, max_minutes: 120, env: null, created_at: ago(12), started_at: null, desktop: null, gpu_index: [], status: 'queued' },
];
let mockSettings: GpuSettings = { mail: true, channels: ['ch_slack'], starve_minutes: 60, default_max_minutes: 1440, max_queued_per_user: 50,
  quota_notice: true, quota_warn_pct: 80, loan_remind_hours: 24, loan_notice: true, ide_notice: true, notice_webhook: false, queue_alert_hours: 6 };
const mockQuotas: Quota[] = [
  { subject_type: 'default', subject_id: '', max_gpus: 4, monthly_gpu_hours: 500, hard: false, note: '기본', updated_at: ago(9000) },
  { subject_type: 'department', subject_id: 'dep_ai', name: '공과대학 > AI 연구실', max_gpus: 8, monthly_gpu_hours: 3000, hard: false, note: '연구실 전체', updated_at: ago(8000) },
  { subject_type: 'user', subject_id: 'alice', max_gpus: 4, monthly_gpu_hours: 800, hard: false, note: '박사과정 · 졸업 실험', updated_at: ago(3000) },
  { subject_type: 'user', subject_id: 'dave', max_gpus: 2, monthly_gpu_hours: 200, hard: true, note: '학부 연구생', updated_at: ago(2000) },
];
const mockHours: Record<string, number> = { alice: 612.4, bob: 288.0, carol: 410.7, dave: 214.5 };
const mockDept: Record<string, string> = { alice: 'dep_ai', bob: 'dep_ai', carol: 'dep_vision', dave: 'dep_ai' };
const deptName: Record<string, string> = { dep_ai: '공과대학 > AI 연구실', dep_vision: '공과대학 > 비전 연구실' };

function used(user: string) {
  return mockJobs.filter((j) => j.status === 'running' && j.username === user).reduce((a, j) => a + j.gpus, 0);
}
function quotaOf(user: string) {
  return mockQuotas.find((q) => q.subject_type === 'user' && q.subject_id === user) ?? mockQuotas.find((q) => q.subject_type === 'default');
}
function mockQueue(): GpuQueue {
  const pools = mockPools.map(({ users: _u, ...p }) => ({ ...p, gpus_used: mockJobs.filter((j) => j.status === 'running' && j.pool_id === p.id).reduce((a, j) => a + j.gpus, 0) }));
  const queued = mockJobs.filter((j) => j.status === 'queued').sort((a, b) => a.created_at.localeCompare(b.created_at)).map((j, i) => {
    const q = quotaOf(j.username);
    let wait: WaitReason = 'no_free_gpu';
    if (q?.hard && (mockHours[j.username] ?? 0) >= q.monthly_gpu_hours) wait = 'quota_hours';
    else if (q?.max_gpus && used(j.username) + j.gpus > q.max_gpus) wait = 'quota_gpus';
    else if (i > 0 && (Date.now() - new Date(mockJobs.find((x) => x.id === 'job_g4')!.created_at).getTime()) / 60000 > mockSettings.starve_minutes) wait = 'held_for_older';
    return { ...j, position: i + 1, wait_reason: wait, waited_min: Math.round((Date.now() - new Date(j.created_at).getTime()) / 60000) };
  });
  return { queued, running: mockJobs.filter((j) => j.status === 'running').map((j) => ({ ...j })), pools, settings: { ...mockSettings } };
}

const mockIde: IdeSession[] = [
  { id: 'ide_00000000a001', username: 'alice', desktop_id: 'd_ws', desktop: 'gpu-ws-alice', pool_id: 'p_ws', kind: 'jupyter', folder: 'home', workdir: '/nas/home/alice',
    state: 'running', error: '', created_at: ago(55), started_at: ago(55), last_seen: ago(2), stopped_at: null, path: '/ide/ide_00000000a001/lab' },
  { id: 'ide_00000000b002', username: 'bob', desktop_id: 'gb1', desktop: 'gpu-build-01', pool_id: 'p_gpu', kind: 'vscode', folder: 'scratch', workdir: '/nas/scratch/bob',
    state: 'running', error: '', created_at: ago(30), started_at: ago(30), last_seen: ago(1), stopped_at: null, path: '/ide/ide_00000000b002/vscode/' },
];

const mock: typeof real = {
  myGpu: () => delay({
    gpus_now: used('alice'), hours_month: mockHours.alice,
    quotas: [{ ...quotaOf('alice')!, applies_as: 'user', applies_to: 'alice', gpus_now: used('alice'), hours_month: mockHours.alice },
      { ...mockQuotas[1], applies_as: 'department', applies_to: 'dep_ai', gpus_now: used('alice') + used('bob') + used('dave'), hours_month: 1114.9 }],
    pools: mockPools.filter((p) => p.users.includes('alice')).map((p) => ({ id: p.id, name: p.name, gpus_per_vm: p.gpus_per_vm, kind: p.kind, max_minutes: p.max_minutes,
      runtime: p.runtime, workdir: '/nas/scratch/alice' })),
    mail: mockSettings.mail, webhook: mockSettings.channels.length > 0, default_max_minutes: mockSettings.default_max_minutes,
  }),
  stopMyJob: (id) => {
    const j = mockJobs.find((x) => x.id === id);
    if (!j || j.username !== 'alice') return fail(404, 'Job not found');
    if (j.status !== 'running') return fail(409, 'Only a running job can be stopped');
    j.status = 'cancelled'; return delay(undefined);
  },
  stopJob: (id) => {
    const j = mockJobs.find((x) => x.id === id);
    if (!j) return fail(404, 'Job not found');
    if (j.status !== 'running') return fail(409, 'Only a running job can be stopped');
    j.status = 'cancelled'; return delay(undefined);
  },
  queue: () => delay(mockQueue()),
  quotas: () => delay({
    quotas: mockQuotas.map((q) => ({ ...q, name: q.subject_type === 'department' ? deptName[q.subject_id] ?? q.subject_id : q.subject_id,
      gpus_now: q.subject_type === 'default' ? null : q.subject_type === 'user' ? used(q.subject_id) : Object.keys(mockDept).filter((u) => mockDept[u] === q.subject_id).reduce((a, u) => a + used(u), 0),
      hours_month: q.subject_type === 'default' ? null : q.subject_type === 'user' ? mockHours[q.subject_id] ?? 0 : Object.keys(mockDept).filter((u) => mockDept[u] === q.subject_id).reduce((a, u) => a + (mockHours[u] ?? 0), 0) })),
    users: Object.keys(mockHours).map((u) => ({ username: u, gpus_now: used(u), hours_month: mockHours[u] })).sort((a, b) => b.hours_month - a.hours_month),
    month_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
  }),
  saveQuota: (q) => {
    if (q.subject_type !== 'default' && !q.subject_id) return fail(400, 'subject_id: the user name or the department id');
    if (q.max_gpus < 0 || q.monthly_gpu_hours < 0) return fail(400, 'max_gpus must be a whole number from 0 to 1024');
    const id = q.subject_type === 'default' ? '' : q.subject_id!;
    const i = mockQuotas.findIndex((x) => x.subject_type === q.subject_type && x.subject_id === id);
    const row: Quota = { subject_type: q.subject_type, subject_id: id, max_gpus: q.max_gpus, monthly_gpu_hours: q.monthly_gpu_hours, hard: q.hard, note: q.note, updated_at: ago(0) };
    if (i >= 0) mockQuotas[i] = row; else mockQuotas.push(row);
    return delay(row);
  },
  deleteQuota: (type, id) => {
    const i = mockQuotas.findIndex((x) => x.subject_type === type && x.subject_id === (type === 'default' ? '' : id));
    if (i < 0) return fail(404, 'Quota not found');
    mockQuotas.splice(i, 1); return delay(undefined);
  },
  settings: () => delay({ ...mockSettings }),
  saveSettings: (s) => {
    if (s.quota_warn_pct !== undefined && (s.quota_warn_pct < 0 || s.quota_warn_pct > 99)) return Promise.reject(new ApiError(400, 'quota_warn_pct must be a whole number from 0 to 99'));
    if (s.loan_remind_hours !== undefined && (s.loan_remind_hours < 0 || s.loan_remind_hours > 168)) return Promise.reject(new ApiError(400, 'loan_remind_hours must be a whole number from 0 to 168'));
    if (s.queue_alert_hours !== undefined && (s.queue_alert_hours < 0 || s.queue_alert_hours > 168)) return Promise.reject(new ApiError(400, 'queue_alert_hours must be a whole number from 0 to 168'));
    mockSettings = { ...mockSettings, ...s }; return delay({ ...mockSettings });
  },
  poolConf: (poolId) => {
    const p = mockPools.find((x) => x.id === poolId);
    return delay({ gpu_jobs: p ? { gpus_per_vm: p.gpus_per_vm, kind: p.kind, max_minutes: p.max_minutes, runtime: p.runtime } : { gpus_per_vm: 0, kind: '', max_minutes: 0, runtime: 'docker' }, saved: !!p });
  },
  savePoolConf: (poolId, c) => {
    if (c.gpus_per_vm < 0 || c.gpus_per_vm > 16) return fail(400, 'gpus_per_vm must be a whole number from 0 to 16');
    const p = mockPools.find((x) => x.id === poolId);
    if (p) Object.assign(p, c, { gpus: p.vms * c.gpus_per_vm });
    else if (c.gpus_per_vm) mockPools.push({ id: poolId, name: poolId, vms: 2, gpus: 2 * c.gpus_per_vm, gpus_used: 0, users: ['alice'], ...c });
    return delay({ ...c });
  },
  usageByUser: (w) => {
    const f = w.month ? 1 : (w.days ?? 30) / 30;
    const rows = Object.keys(mockHours).map((u) => {
      const job = Math.round(mockHours[u] * 0.72 * f * 10) / 10; const loan = Math.round(mockHours[u] * 0.28 * f * 10) / 10;
      return { username: u, display_name: { alice: '김연구', bob: '이학생', carol: '박비전', dave: '최학부' }[u] ?? '', department_id: mockDept[u], department: deptName[mockDept[u]],
        job_gpu_hours: job, loan_gpu_hours: loan, total_gpu_hours: Math.round((job + loan) * 10) / 10, jobs: Math.round(12 * f) + u.length, loans: u === 'bob' ? 0 : 2, share_pct: 0 };
    });
    const total = rows.reduce((a, r) => a + r.total_gpu_hours, 0);
    rows.forEach((r) => { r.share_pct = Math.round(1000 * r.total_gpu_hours / total) / 10; });
    rows.sort((a, b) => b.total_gpu_hours - a.total_gpu_hours);
    return delay({ since: ago((w.days ?? 30) * 1440), until: ago(0), group: 'user', rows, total_gpu_hours: Math.round(total * 10) / 10 });
  },
  usageByDept: async (w) => {
    const byUser = await mock.usageByUser(w);
    const agg: Record<string, UsageDeptRow> = {};
    for (const r of byUser.rows) {
      const key = w.rollup ? 'dep_eng' : r.department_id;
      const a = agg[key] ??= { department_id: key, department: w.rollup ? '공과대학' : r.department, users: 0, job_gpu_hours: 0, loan_gpu_hours: 0, total_gpu_hours: 0, share_pct: 0 };
      a.users += 1; a.job_gpu_hours += r.job_gpu_hours; a.loan_gpu_hours += r.loan_gpu_hours; a.total_gpu_hours += r.total_gpu_hours;
    }
    const rows = Object.values(agg).map((a) => ({ ...a, job_gpu_hours: Math.round(a.job_gpu_hours * 10) / 10, loan_gpu_hours: Math.round(a.loan_gpu_hours * 10) / 10,
      total_gpu_hours: Math.round(a.total_gpu_hours * 10) / 10, share_pct: Math.round(1000 * a.total_gpu_hours / byUser.total_gpu_hours) / 10 }));
    return { ...byUser, group: 'department', rows: rows.sort((a, b) => b.total_gpu_hours - a.total_gpu_hours) };
  },

  myIde: () => delay({
    sessions: mockIde.filter((s) => s.username === 'alice').map((s) => ({ ...s })),
    desktops: [{ id: 'd_ws', name: 'gpu-ws-alice', pool: 'GPU 워크스테이션', kinds: ['jupyter', 'vscode'], folders: { home: true, scratch: true }, gpu: true }],
    pools: [{ id: 'p_gpu', name: 'A100 학습 팜', kinds: ['jupyter', 'vscode'], folders: { home: true, scratch: true } }],
  }),
  startIde: (b) => {
    const old = mockIde.find((s) => s.username === 'alice' && s.kind === b.kind && (b.desktop_id ? s.desktop_id === b.desktop_id : s.pool_id === b.pool_id) && (s.state === 'running' || s.state === 'starting'));
    if (old) return delay({ session: { ...old }, reused: true });
    const id = nid('ide');
    const s: IdeSession = { id, username: 'alice', desktop_id: b.desktop_id ?? 'gb2', desktop: b.desktop_id ? 'gpu-ws-alice' : 'gpu-build-02', pool_id: b.pool_id ?? 'p_ws',
      kind: b.kind, folder: b.folder, workdir: b.folder === 'home' ? '/nas/home/alice' : '/nas/scratch/alice', state: 'starting', error: '', created_at: ago(0), started_at: ago(0),
      last_seen: null, stopped_at: null, path: `/ide/${id}/${b.kind === 'jupyter' ? 'lab' : 'vscode/'}` };
    mockIde.unshift(s);
    setTimeout(() => { s.state = 'running'; }, 2500);
    return delay({ session: { ...s }, reused: false });
  },
  ideStatus: (id) => { const s = mockIde.find((x) => x.id === id); return s ? delay({ ...s }) : fail(404, 'IDE session not found'); },
  openIde: (id) => {
    const s = mockIde.find((x) => x.id === id);
    if (!s) return fail(404, 'IDE session not found');
    if (s.state !== 'running') return fail(409, 'The IDE is not ready yet', { code: 'NOT_READY' });
    return delay({ url: `${s.path}?moavi_ide=mock-${Math.random().toString(36).slice(2)}`, expires_in: 60 });
  },
  stopIde: (id) => { const s = mockIde.find((x) => x.id === id); if (s) Object.assign(s, { state: 'stopped', stopped_at: ago(0) }); return delay(undefined); },
  ideSessions: () => delay(mockIde.map((s) => ({ ...s }))),
  adminStopIde: (id) => { const s = mockIde.find((x) => x.id === id); if (!s) return fail(404, 'IDE session not found'); Object.assign(s, { state: 'stopped', stopped_at: ago(0), error: 'stopped by admin' }); return delay(undefined); },
};

export const researchApi = isMock ? mock : real;

/** The words for why a job waits (GPU 작업 큐). */
export function waitText(r: WaitReason | undefined, L: (ko: string, en: string) => string) {
  switch (r) {
    case 'quota_gpus': return L('동시 GPU 할당량 사용 중', 'GPUs-at-once quota in use');
    case 'quota_gpus_department': return L('부서 동시 GPU 할당량 사용 중', "department's GPUs-at-once quota in use");
    case 'quota_hours': return L('이번 달 GPU-시간 소진 (엄격)', "this month's GPU-hours used up (hard)");
    case 'held_for_older': return L('먼저 기다린 작업에 GPU 양보', 'GPUs kept for an older job');
    case 'no_free_gpu': return L('빈 GPU 없음', 'no free GPUs');
    case 'no_free_vm': return L('빈 빌드 VM 없음', 'no free build VM');
    case 'no_gpu_pool': return L('맞는 GPU 풀 없음', 'no matching GPU pool');
    default: return L('곧 시작', 'starting soon');
  }
}

export const hoursText = (h: number | null | undefined) => (h === null || h === undefined ? '-' : h >= 100 ? h.toFixed(0) : h.toFixed(1));
