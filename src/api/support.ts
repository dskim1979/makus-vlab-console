// 플랫폼 설정 > 지원: the support bundle for one period (makus-vlab pegaprox/api/vlab_support.py,
// /api/vlab/admin/support-bundle). The ZIP comes back as a blob the page saves.
import { ApiError, isMock, request } from './client';

export type BundleOptions = {
  logs: boolean; audit: boolean; sessions: boolean; tasks: boolean; config: boolean; mask_ips: boolean; mask_users: boolean;
};
export type BundlePreview = { from: string; to: string; max_days: number; counts: Record<string, number> };

const A = '/api/vlab/admin/support-bundle';
const query = (from: string, to: string, o: BundleOptions) =>
  new URLSearchParams({ from, to, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ? '1' : '0'])) }).toString();

function fail(status: number, data: unknown): never {
  const msg = (data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : '') || `HTTP ${status}`;
  throw new ApiError(status, msg, data);
}

const real = {
  preview: async (from: string, to: string, o: BundleOptions): Promise<BundlePreview> => {
    const { status, data } = await request<BundlePreview>('GET', `${A}/preview?${query(from, to, o)}`);
    if (status !== 200) fail(status, data);
    return data;
  },
  download: async (from: string, to: string, o: BundleOptions): Promise<{ blob: Blob; filename: string }> => {
    let res: Response;
    try {
      res = await fetch(`${A}?${query(from, to, o)}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    } catch {
      throw new ApiError(0, 'network');
    }
    if (!res.ok) {
      let data: unknown = null;
      try { data = await res.json(); } catch { /* not json */ }
      fail(res.status, data);
    }
    const cd = res.headers.get('Content-Disposition') ?? '';
    const filename = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? 'moavi-desk-support.zip';
    return { blob: await res.blob(), filename };
  },
};

const days = (from: string, to: string) => (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
const check = (from: string, to: string) => {
  if (!(new Date(from) < new Date(to))) throw new ApiError(400, 'from must be before to');
  if (days(from, to) > 31) throw new ApiError(400, 'The period can be at most 31 days');
};

const mock = {
  preview: async (from: string, to: string, o: BundleOptions): Promise<BundlePreview> => {
    await new Promise((r) => setTimeout(r, 250));
    check(from, to);
    const d = Math.max(days(from, to), 1 / 24);
    const n = (per: number) => Math.round(per * d);
    const counts: Record<string, number> = {};
    if (o.sessions) Object.assign(counts, { sessions: n(64), card_loans: n(2), build_jobs: n(9), alerts: n(3) });
    if (o.audit) counts.audit = n(240);
    if (o.tasks) counts.tasks = n(38);
    if (o.logs) counts.log_files = 4;
    return { from, to, max_days: 31, counts };
  },
  download: async (from: string, to: string, o: BundleOptions) => {
    const p = await mock.preview(from, to, o);
    const manifest = { product: 'MOAVI Desk', mock: true, period: { from, to }, options: o, contents: p.counts };
    return { blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
      filename: `moavi-desk-support_${from.replace(/[-:]/g, '')}_${to.replace(/[-:]/g, '')}_mock.json` };
  },
};

export const supportApi = isMock ? mock : real;
