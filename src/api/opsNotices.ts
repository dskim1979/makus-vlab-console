// The administrators' operations notices (makus-vlab pegaprox/vlab/ops_notices.py):
// GET / PUT /api/vlab/admin/ops-notices. They go out on the alert channels and the alert mail.
import { ApiError, isMock, request } from './client';

export type OpsNoticeSettings = {
  terminal_pending: boolean;
  terminal_every_min: number;
  license_denied: boolean;
  pair: boolean;
  pair_down_min: number;
  task_failed: boolean;
  task_types: string[];
  channels: string[];
};
export type OpsNotices = { settings: OpsNoticeSettings; task_types: Record<string, string> };

const TASK_TYPES: Record<string, string> = {
  qmclone: '복제', vzdump: '백업', qmrestore: '복원', qmigrate: '이동',
  qmcreate: 'VM 만들기', qmtemplate: '템플릿 변환', qmmove: '디스크 이동', qmdestroy: 'VM 삭제',
};
let mock: OpsNoticeSettings = {
  terminal_pending: true, terminal_every_min: 30, license_denied: true, pair: true, pair_down_min: 10,
  task_failed: true, task_types: ['qmclone', 'qmigrate', 'qmrestore', 'vzdump'], channels: [],
};

async function call(method: 'GET' | 'PUT', body?: Partial<OpsNoticeSettings>): Promise<OpsNotices> {
  const { status, data } = await request<OpsNotices & { error?: string }>(method, '/api/vlab/admin/ops-notices', body);
  if (status !== 200) throw new ApiError(status, data?.error || `HTTP ${status}`, data);
  return { settings: data.settings, task_types: data.task_types };
}

export const opsNoticesApi = {
  get: async (): Promise<OpsNotices> =>
    (isMock ? new Promise((r) => setTimeout(() => r({ settings: { ...mock }, task_types: TASK_TYPES }), 120)) : call('GET')),
  save: async (s: Partial<OpsNoticeSettings>): Promise<OpsNotices> => {
    if (!isMock) return call('PUT', s);
    mock = { ...mock, ...s, task_types: [...new Set(s.task_types ?? mock.task_types)].sort() };
    return { settings: { ...mock }, task_types: TASK_TYPES };
  },
};
