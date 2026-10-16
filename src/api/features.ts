// The site profile and its feature groups (makus-vlab pegaprox/vlab/features.py):
// GET /api/vlab/features, PUT /api/vlab/admin/features.
import { ApiError, isMock, request } from './client';

export type FeatureGroup = 'lab' | 'signup' | 'org' | 'external' | 'data' | 'ha' | 'fpga' | 'gpuai';
export type SiteProfile = 'general' | 'small_lab' | 'university' | 'research';
export type Features = { profile: SiteProfile | null; groups: FeatureGroup[]; chosen: boolean };

export const ALL_GROUPS: FeatureGroup[] = ['lab', 'signup', 'org', 'external', 'data', 'ha', 'fpga', 'gpuai'];
export const BUNDLES: FeatureGroup[] = ['fpga', 'gpuai'];
export const PROFILE_GROUPS: Record<SiteProfile, FeatureGroup[]> = {
  general: ['org', 'external'],
  small_lab: [],
  university: ['lab', 'signup', 'org'],
  research: ['org', 'external', 'data', 'ha'],
};
export const PROFILES: SiteProfile[] = ['general', 'small_lab', 'university', 'research'];

export function groupsFor(profile: SiteProfile, bundles: FeatureGroup[]): FeatureGroup[] {
  return [...new Set([...PROFILE_GROUPS[profile], ...bundles.filter((b) => BUNDLES.includes(b))])].sort();
}

// --- mock: kept in the browser; ?profile=university&bundles=gpuai,fpga or ?setup=1 set it
const MOCK_KEY = 'vlab.mock.features';
function mockRead(): Features {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('setup') === '1') {
      const f: Features = { profile: null, groups: [...ALL_GROUPS], chosen: false };
      localStorage.setItem(MOCK_KEY, JSON.stringify(f));
      return f;
    }
    const p = q.get('profile') as SiteProfile | null;
    if (p && PROFILES.includes(p)) {
      const f: Features = { profile: p, groups: groupsFor(p, (q.get('bundles') ?? '').split(',') as FeatureGroup[]), chosen: true };
      localStorage.setItem(MOCK_KEY, JSON.stringify(f));
      return f;
    }
    const raw = localStorage.getItem(MOCK_KEY);
    if (raw) return JSON.parse(raw) as Features;
  } catch { /* private window */ }
  return { profile: null, groups: [...ALL_GROUPS], chosen: true };   // the demo shows everything
}

export const featuresApi = {
  get: async (): Promise<Features> => {
    if (isMock) return mockRead();
    const { status, data } = await request<Features & { error?: string }>('GET', '/api/vlab/features');
    if (status !== 200) throw new ApiError(status, data?.error || `HTTP ${status}`, data);
    return { profile: data.profile, groups: data.groups, chosen: data.chosen };
  },
  save: async (profile: SiteProfile, groups: FeatureGroup[]): Promise<Features> => {
    if (isMock) {
      const f: Features = { profile, groups: [...new Set(groups)].sort(), chosen: true };
      try { localStorage.setItem(MOCK_KEY, JSON.stringify(f)); } catch { /* ignore */ }
      return f;
    }
    const { status, data } = await request<Features & { error?: string }>('PUT', '/api/vlab/admin/features', { profile, groups });
    if (status !== 200) throw new ApiError(status, data?.error || `HTTP ${status}`, data);
    return { profile: data.profile, groups: data.groups, chosen: data.chosen };
  },
};
