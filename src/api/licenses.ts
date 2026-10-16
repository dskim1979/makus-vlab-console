// 라이선스 좌석: who holds the seats of a FlexLM / FlexNet licence server, per feature, read every
// 5 minutes by the engine's lmutil or by the guest agent of the licence server VM (makus-vlab
// pegaprox/vlab/license_usage.py, pegaprox/api/vlab_license.py). Times are epoch seconds.
import { ApiError, isMock, request } from './client';
import { mockLicenses } from './next';

export type LicenseMode = 'off' | 'engine' | 'agent';
export type SeatSettings = {
  mode: LicenseMode; lm_ports: number[]; lmutil_path: string; debug_log: string; seat_threshold: number;
  feature_thresholds: Record<string, number>; alert_channels: string[] | null;
  last_at: string | null; last_ok: number | null; last_error: string;
};
export type SeatSettingsInput = Omit<SeatSettings, 'last_at' | 'last_ok' | 'last_error'>;
export type SeatHolder = {
  user: string; host: string; display: string; version: string; count: number; since: number; minutes: number;
  desktop: { id: string; name: string; pool: string; match: 'host' | 'user' } | null;
};
export type SeatFeature = {
  feature: string; vendor: string; total: number; in_use: number; queued: number; pct: number; threshold: number;
  alerted: '' | 'high' | 'full'; current: boolean; holders: SeatHolder[];
  peak: number; avg: number; shortage_count: number; shortage_minutes: number; denied: number;
};
export type SeatPoint = { t: number; max: number; avg: number; total: number };
export type SeatDenial = { at: number; feature: string; user: string; host: string; kind: 'denied' | 'unsupported'; reason: string };
export type SeatUsage = {
  server: { id: string; name: string; host: string }; settings: SeatSettings; at: number | null; hours: number; bucket: number;
  features: SeatFeature[]; series: Record<string, SeatPoint[]>; denials: SeatDenial[]; denied_total: number; lmutil?: string;
};
export type SeatAdvice = { action: 'add' | 'reduce' | 'keep'; seats: number };
export type SeatReportFeature = {
  server_id: string; server: string; feature: string; vendor: string; total: number; peak: number; peak_pct: number; avg: number; avg_pct: number;
  samples: number; full_samples: number; shortage_minutes: number; shortage_count: number; denied: number; advice: SeatAdvice;
};
export type SeatReportUser = { user: string; feature: string; server_id: string; server: string; hours: number; checkouts: number; hosts: string[] };
export type SeatReport = { days: number; interval: number; features: SeatReportFeature[]; users: SeatReportUser[]; servers: { id: string; name: string; mode: LicenseMode }[] };
export type CollectResult = { ok: boolean; error: string; features: { feature: string; vendor: string; total: number; in_use: number; queued: number }[]; settings: SeatSettings };

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

const realLicenseApi = {
  usage: (id: string, hours: number) => call<SeatUsage>('GET', `${A}/license-servers/${enc(id)}/usage?hours=${hours}`),
  saveSettings: async (id: string, b: SeatSettingsInput) =>
    call<{ settings: SeatSettings; lmutil: string }>('PUT', `${A}/license-servers/${enc(id)}/usage-settings`, b),
  collect: (id: string) => call<CollectResult>('POST', `${A}/license-servers/${enc(id)}/usage/collect`),
  report: (days: number, serverId?: string) =>
    call<SeatReport>('GET', `${A}/reports/licenses?days=${days}${serverId ? `&server_id=${enc(serverId)}` : ''}`),
};
export type LicenseApi = typeof realLicenseApi;

// --- mock mode -------------------------------------------------------------------------------

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));
const fail = (status: number, msg: string) => Promise.reject(new ApiError(status, msg));
const INTERVAL = 300;

type MockFeature = { feature: string; vendor: string; total: number; base: number; swing: number };
const FEATURES: Record<string, MockFeature[]> = {
  lic_1: [
    { feature: 'Vivado_System_Edition', vendor: 'xilinxd', total: 10, base: 4, swing: 4.5 },
    { feature: 'Vitis', vendor: 'xilinxd', total: 4, base: 2.4, swing: 2.2 },
    { feature: 'Vivado_HLS', vendor: 'xilinxd', total: 5, base: 1, swing: 1.6 },
    { feature: 'quartus_pro', vendor: 'alterad', total: 6, base: 2, swing: 2.4 },
  ],
  lic_3: [
    { feature: 'Xcelium_Single_Core', vendor: 'cdslmd', total: 8, base: 1.5, swing: 1.2 },
    { feature: 'Virtuoso_Schematic_Editor_L', vendor: 'cdslmd', total: 12, base: 3, swing: 2.5 },
    { feature: 'Genus_Synthesis', vendor: 'cdslmd', total: 4, base: 1.5, swing: 1.5 },
  ],
};
const USERS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'kim', 'lee'];
const HOSTS: Record<string, { host: string; desk: string | null; pool: string }> = {
  alice: { host: 'lab-a-01', desk: 'lab-a-01', pool: '공용 LAB A' }, bob: { host: 'lab-a-02', desk: 'lab-a-02', pool: '공용 LAB A' },
  carol: { host: 'vivado-build-03', desk: 'vivado-build-03', pool: 'FPGA 빌드 팜' }, dave: { host: 'vivado-build-02', desk: 'vivado-build-02', pool: 'FPGA 빌드 팜' },
  erin: { host: 'res-win11-07', desk: 'res-win11-07', pool: '연구원 전용 VM' }, frank: { host: 'DESKTOP-K3J9', desk: null, pool: '' },
  grace: { host: 'lab-a-05', desk: 'lab-a-05', pool: '공용 LAB A' }, heidi: { host: 'eda-term-01', desk: 'eda-term-01', pool: '공용 리눅스 서버' },
  ivan: { host: 'eda-term-01', desk: 'eda-term-01', pool: '공용 리눅스 서버' }, judy: { host: 'lab-b-11', desk: 'lab-b-11', pool: '교육장 A 수업용' },
  kim: { host: 'notebook-kim', desk: 'res-win11-02', pool: '연구원 전용 VM' }, lee: { host: 'eda-term-02', desk: 'eda-term-02', pool: '공용 리눅스 서버' },
};
const settings: Record<string, SeatSettings> = {
  lic_1: { mode: 'agent', lm_ports: [2100], lmutil_path: '/opt/Xilinx/lmutil', debug_log: '/var/log/flexlm/lmgrd.log', seat_threshold: 90,
    feature_thresholds: { Vitis: 100 }, alert_channels: null, last_at: null, last_ok: 1, last_error: '' },
  lic_3: { mode: 'engine', lm_ports: [5280], lmutil_path: '', debug_log: '', seat_threshold: 85, feature_thresholds: {}, alert_channels: null,
    last_at: null, last_ok: 1, last_error: '' },
};

function settingsOf(id: string): SeatSettings {
  const row = mockLicenses.find((l) => l.id === id);
  const s = settings[id] ?? (settings[id] = { mode: 'off', lm_ports: row ? row.ports.slice(0, 1) : [], lmutil_path: '', debug_log: '', seat_threshold: 90,
    feature_thresholds: {}, alert_channels: null, last_at: null, last_ok: null, last_error: '' });
  return { ...s, last_at: row?.usage_at ?? null, last_ok: row?.usage_ok ?? null, last_error: row?.usage_error ?? '' };
}

// in use at time t: a working-day curve (9-18 h busier, weekends quiet) with a little noise
function used(f: MockFeature, t: number) {
  const d = new Date(t * 1000);
  const h = d.getHours() + d.getMinutes() / 60;
  const work = d.getDay() === 0 || d.getDay() === 6 ? 0.25 : Math.max(0, Math.sin(((h - 7) / 13) * Math.PI));
  const noise = Math.sin(t / 1700 + f.total) * 0.8 + Math.sin(t / 5300) * 0.5;
  return Math.max(0, Math.min(f.total, Math.round(f.base * 0.9 + f.swing * work * 1.4 + noise)));
}

function mockUsage(id: string, hours: number): SeatUsage {
  const row = mockLicenses.find((l) => l.id === id)!;
  const st = settingsOf(id);
  const feats = st.mode === 'off' ? [] : FEATURES[id] ?? [];
  const now = Math.floor(Date.now() / 1000);
  const at = now - (now % INTERVAL);
  const bucket = hours <= 72 ? 3600 : 86400;
  const series: Record<string, SeatPoint[]> = {};
  const out: SeatFeature[] = [];
  let u = 0;
  for (const f of feats) {
    const pts: Record<number, SeatPoint & { n: number; sum: number }> = {};
    let peak = 0, sum = 0, n = 0, fullRuns = 0, fullSamples = 0, wasFull = false;
    for (let t = at - hours * 3600; t <= at; t += INTERVAL) {
      const v = used(f, t);
      peak = Math.max(peak, v); sum += v; n += 1;
      const full = v >= f.total; if (full) { fullSamples += 1; if (!wasFull) fullRuns += 1; } wasFull = full;
      const b = t - (t % bucket);
      const p = pts[b] ?? (pts[b] = { t: b, max: 0, avg: 0, total: f.total, n: 0, sum: 0 });
      p.max = Math.max(p.max, v); p.sum += v; p.n += 1;
    }
    series[f.feature] = Object.values(pts).map((p) => ({ t: p.t, max: p.max, avg: Math.round((p.sum / p.n) * 100) / 100, total: p.total }));
    const inUse = used(f, at);
    const holders: SeatHolder[] = Array.from({ length: inUse }, (_x, i) => {
      const user = USERS[(u + i * 5) % USERS.length]; const h = HOSTS[user];
      const minutes = 20 + ((i * 47 + f.total * 13) % 260);
      return { user, host: h.host, display: `${h.host}:0`, version: f.vendor === 'xilinxd' ? '2024.1' : '2025.1', count: 1, since: at - minutes * 60, minutes,
        desktop: h.desk ? { id: `d_${h.desk}`, name: h.desk, pool: h.pool, match: h.host === h.desk ? 'host' : 'user' } : null };
    });
    u += 3;
    const limit = st.feature_thresholds[f.feature] ?? st.seat_threshold;
    const pct = Math.round((100 * inUse) / f.total);
    out.push({ feature: f.feature, vendor: f.vendor, total: f.total, in_use: inUse, queued: inUse >= f.total ? 1 : 0, pct, threshold: limit,
      alerted: inUse >= f.total && limit > 0 ? 'full' : limit > 0 && pct >= limit ? 'high' : '', current: true, holders,
      peak, avg: Math.round((sum / n) * 100) / 100, shortage_count: fullRuns, shortage_minutes: (fullSamples * INTERVAL) / 60,
      denied: f.feature === 'Vitis' ? Math.min(14, fullRuns * 2) : f.feature === 'Vivado_System_Edition' ? Math.min(3, fullRuns) : 0 });
  }
  row.seat_alerted = Object.fromEntries(out.filter((f) => f.alerted).map((f) => [f.feature, f.alerted]));
  const denials: SeatDenial[] = st.debug_log ? out.filter((f) => f.denied).flatMap((f) => Array.from({ length: f.denied }, (_x, i) => {
    const user = USERS[(i * 7 + 3) % USERS.length];
    return { at: at - (i * 9 + 2) * 3600 - 1260, feature: f.feature, user, host: HOSTS[user].host, kind: 'denied' as const,
      reason: 'Licensed number of users already reached. (-4,342:10054 "")' };
  })).filter((d) => d.at >= at - hours * 3600).sort((a, b) => b.at - a.at) : [];
  return { server: { id, name: row.name, host: row.host }, settings: st, at: feats.length ? at : null, hours, bucket, features: out, series,
    denials: denials.slice(0, 50), denied_total: denials.length, ...(st.mode === 'engine' ? { lmutil: '/opt/moavi/lmutil/lmutil' } : {}) };
}

const mockLicenseApi: LicenseApi = {
  usage: (id, hours) => (mockLicenses.some((l) => l.id === id) ? delay(mockUsage(id, hours)) : fail(404, 'Licence server not found')),
  saveSettings: (id, b) => {
    const row = mockLicenses.find((l) => l.id === id); if (!row) return fail(404, 'Licence server not found');
    if (b.mode === 'agent' && !(row.cluster_id && row.vmid)) return fail(400, 'agent mode needs the licence server VM: set its cluster and VMID first');
    if (b.lmutil_path && !/^(\/|[A-Za-z]:[\\/]).*(lmutil|lmstat)(\.exe)?$/i.test(b.lmutil_path)) return fail(400, 'lmutil_path must name lmutil or lmstat');
    if (b.debug_log && !/^(\/|[A-Za-z]:[\\/])/.test(b.debug_log)) return fail(400, 'debug_log must be an absolute path without quotes or shell characters');
    if (!(b.seat_threshold >= 0 && b.seat_threshold <= 100)) return fail(400, 'seat_threshold must be 0 to 100');
    settings[id] = { ...settingsOf(id), ...b };
    row.usage_mode = b.mode;
    if (b.mode !== 'off' && !FEATURES[id]) { row.usage_ok = 0; row.usage_error = b.mode === 'engine' ? 'lmutil not found on the engine: put it at /opt/moavi/lmutil/lmutil or name its path' : 'the guest agent of the licence server VM does not answer'; }
    return delay({ settings: settingsOf(id), lmutil: b.mode === 'engine' && FEATURES[id] ? '/opt/moavi/lmutil/lmutil' : '' });
  },
  collect: (id) => {
    const row = mockLicenses.find((l) => l.id === id); if (!row) return fail(404, 'Licence server not found');
    const st = settingsOf(id); if (st.mode === 'off') return fail(409, 'Seat reading is off for this licence server');
    if (!FEATURES[id]) return delay({ ok: false, error: row.usage_error || 'lmstat returned no counted features', features: [], settings: settingsOf(id) });
    row.usage_at = new Date().toISOString().slice(0, 19); row.usage_ok = 1; row.usage_error = '';
    const u = mockUsage(id, 1);
    return delay({ ok: true, error: '', features: u.features.map(({ feature, vendor, total, in_use, queued }) => ({ feature, vendor, total, in_use, queued })), settings: settingsOf(id) });
  },
  report: (days, serverId) => {
    const ids = mockLicenses.filter((l) => !serverId || l.id === serverId).map((l) => l.id);
    const features: SeatReportFeature[] = []; const users: SeatReportUser[] = [];
    for (const id of ids) {
      const u = mockUsage(id, days * 24); const name = u.server.name;
      for (const f of u.features) {
        const samples = days * 288;
        const action: SeatAdvice = f.shortage_minutes || f.denied ? { action: 'add', seats: Math.max(1, Math.ceil(f.total / 10)) }
          : f.total >= 3 && days >= 7 && f.peak <= (f.total * 2) / 3 ? { action: 'reduce', seats: f.total - (f.peak + 1) } : { action: 'keep', seats: 0 };
        features.push({ server_id: id, server: name, feature: f.feature, vendor: f.vendor, total: f.total, peak: f.peak, peak_pct: Math.round((100 * f.peak) / f.total),
          avg: f.avg, avg_pct: Math.round((100 * f.avg) / f.total), samples, full_samples: f.shortage_minutes / 5, shortage_minutes: f.shortage_minutes,
          shortage_count: f.shortage_count, denied: f.denied, advice: action });
        USERS.forEach((user, i) => {
          const hours = Math.round(((f.avg / USERS.length) * days * 24 * (1.6 - (i % 5) * 0.25)) * 10) / 10;
          if (hours > 0.5 && (i + f.total) % 3 !== 0) users.push({ user, feature: f.feature, server_id: id, server: name, hours, checkouts: Math.max(1, Math.round(hours / 3.5)), hosts: [HOSTS[user].host] });
        });
      }
    }
    users.sort((a, b) => b.hours - a.hours || a.user.localeCompare(b.user));
    return delay({ days, interval: INTERVAL, features, users,
      servers: mockLicenses.map((l) => ({ id: l.id, name: l.name, mode: settingsOf(l.id).mode })) });
  },
};

export const licenseApi: LicenseApi = isMock ? mockLicenseApi : realLicenseApi;
