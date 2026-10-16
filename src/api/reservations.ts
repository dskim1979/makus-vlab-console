// LAB 예약: a whole LAB, N seats of a LAB or N desktops of a pool, once or weekly (makus-vlab
// pegaprox/vlab/reservations.py, pegaprox/api/vlab_reserve.py). Times are the engine's local
// wall clock 'YYYY-MM-DDTHH:MM', like the LAB schedules. An approved booking runs like a
// schedule: desktops started before, reset / off after; only its participants get a desktop.
import { ApiError, isMock, request } from './client';
import { mockAdminApi } from './mockAdmin';

export type ReserveKind = 'lab' | 'seats' | 'desktops';
export type ReserveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type Participant = { subject_type: 'user' | 'department' | 'group'; subject_id: string };
export type Reservation = {
  id: string; series_id: string; kind: ReserveKind; lab_id: string | null; lab: string | null; pool_id: string; pool: string | null;
  quantity: number; start_at: string; end_at: string; purpose: string; requester: string; status: ReserveStatus;
  note?: string; participants?: Participant[]; reason?: string; reviewed_by?: string; reviewed_at?: string | null;
  prepare_min?: number; after?: string; prepared?: boolean; finished?: boolean; running?: boolean; desktops?: number; handed?: number;
  series_count?: number; created_at?: string; mine?: boolean; waiting?: number;
};
export type ReserveSettings = {
  enabled: boolean; approval: boolean; open_from: string; open_to: string; weekdays: number[]; max_minutes: number;
  max_days_ahead: number; roles: string[]; pool_ids: string[]; prepare_min: number; after: 'reset' | 'off' | 'none'; banner: boolean;
};
export type GlobalSettings = { mail: boolean; channels: string[]; remind_min: number };
export type PoolOption = { id: string; name: string; type: string; desktops: number };
export type LabOption = { id: string; name: string; location: string; seats: number; settings: ReserveSettings; may_book: boolean; pools: PoolOption[] };
export type ReserveOptions = { labs: LabOption[]; pools: PoolOption[]; pool_settings: ReserveSettings; pool_may_book: boolean;
  approver: boolean; max_weeks: number; now: string };
export type Block = {
  type: 'schedule' | 'reservation'; id: string; lab_id: string | null; lab: string | null; pool_id: string; pool: string | null;
  title?: string; start_at: string; end_at: string; status?: ReserveStatus; purpose?: string; requester?: string; kind?: ReserveKind;
  quantity?: number; mine?: boolean;
};
export type Conflict = { type: 'schedule' | 'reservation' | 'limit'; id: string; title: string; start: string; end: string;
  why: 'lab_schedule' | 'pool_schedule' | 'lab_booked' | 'seats' | 'pool_full' | 'pool_size'; limit?: number; requester?: string; status?: string };
export type Occurrence = { start: string; end: string; rules: string[]; conflicts: Conflict[] };
export type CheckResult = { ok: boolean; occurrences: Occurrence[]; approval: boolean };
export type ReserveInput = {
  kind: ReserveKind; lab_id?: string | null; pool_id: string; quantity?: number; start_at: string; end_at: string;
  repeat?: { weekdays: number[]; weeks: number } | null; purpose?: string; note?: string; participants?: Participant[];
  skip_conflicts?: boolean; requester?: string; banner?: boolean;
};
export type CreateResult = { reservations: Reservation[]; skipped: Occurrence[]; approval: boolean };
export type ReserveSummary = { today: number; today_pending: number; pending: number; running: number };
export type SettingsAnswer = { labs: Record<string, ReserveSettings & { default_pools: string[] }>; pool: ReserveSettings; global: GlobalSettings;
  channels: { id: string; name: string; type: string }[]; defaults: ReserveSettings };
export type ReportRow = { id: string; lab: string; pool: string; kind: ReserveKind; quantity: number; start_at: string; end_at: string;
  purpose: string; requester: string; booked_hours: number; used_hours: number; users: number; no_show: boolean; running: boolean };
export type ReserveReport = { days: number; from: string; to: string;
  totals: { reservations: number; booked_hours: number; used_hours: number; no_shows: number; no_show_rate: number; use_rate: number };
  by_lab: { lab_id: string; lab: string; reservations: number; booked_hours: number; used_hours: number; no_shows: number; users: number }[];
  reservations: ReportRow[] };

/** The 409 of a create / change: what each occurrence collides with. */
export class ConflictError extends ApiError {
  constructor(public occurrences: Occurrence[], message: string) { super(409, message, { occurrences }); }
}

const enc = encodeURIComponent;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string; code?: string; occurrences?: Occurrence[] }>(method, path, body);
  if (status < 200 || status >= 300) {
    const d = data as { error?: string; code?: string; occurrences?: Occurrence[] } | null;
    if (status === 409 && d?.code === 'CONFLICT' && d.occurrences) throw new ConflictError(d.occurrences, d.error || 'CONFLICT');
    throw new ApiError(status, d && typeof d.error === 'string' ? d.error : `HTTP ${status}`, d);
  }
  return data;
}

const real = {
  options: () => call<ReserveOptions>('GET', '/api/vlab/reservations/options'),
  calendar: async (from: string, to: string, labId?: string, poolId?: string) => {
    const q = new URLSearchParams({ from, to, ...(labId ? { lab_id: labId } : {}), ...(poolId ? { pool_id: poolId } : {}) });
    return (await call<{ blocks: Block[] }>('GET', `/api/vlab/reservations/calendar?${q}`)).blocks;
  },
  mine: async () => (await call<{ reservations: Reservation[] }>('GET', '/api/vlab/me/reservations')).reservations,
  now: async () => (await call<{ reservations: (Reservation & { running: boolean })[] }>('GET', '/api/vlab/me/reservations/now')).reservations,
  check: (b: ReserveInput, admin = false) => call<CheckResult>('POST', admin ? '/api/vlab/admin/reservations/check' : '/api/vlab/me/reservations/check', b),
  create: (b: ReserveInput, admin = false) => call<CreateResult>('POST', admin ? '/api/vlab/admin/reservations' : '/api/vlab/me/reservations', b),
  change: async (id: string, b: Partial<ReserveInput>, admin = false) =>
    (await call<{ reservation: Reservation }>('PUT', `/api/vlab/${admin ? 'admin' : 'me'}/reservations/${enc(id)}`, b)).reservation,
  cancel: async (id: string, scope: 'one' | 'series', reason = '', admin = false) =>
    (await call<{ reservations: Reservation[] }>('POST', `/api/vlab/${admin ? 'admin' : 'me'}/reservations/${enc(id)}/cancel`, { scope, reason })).reservations,
  desktop: async (id: string) => (await call<{ desktop: { id: string; name: string } }>('POST', `/api/vlab/me/reservations/${enc(id)}/desktop`)).desktop,
  // 관리 콘솔
  list: async (from: string, to: string, labId?: string, status?: ReserveStatus) => {
    const q = new URLSearchParams({ from, to, ...(labId ? { lab_id: labId } : {}), ...(status ? { status } : {}) });
    return call<{ reservations: Reservation[]; schedules: Block[] }>('GET', `/api/vlab/admin/reservations?${q}`);
  },
  pending: async () => (await call<{ pending: Reservation[] }>('GET', '/api/vlab/admin/reservations/pending')).pending,
  summary: () => call<ReserveSummary>('GET', '/api/vlab/admin/reservations/summary'),
  approve: async (id: string, scope: 'one' | 'series', banner = false) =>
    (await call<{ reservations: Reservation[] }>('POST', `/api/vlab/admin/reservations/${enc(id)}/approve`, { scope, banner })).reservations,
  reject: async (id: string, scope: 'one' | 'series', reason: string) =>
    (await call<{ reservations: Reservation[] }>('POST', `/api/vlab/admin/reservations/${enc(id)}/reject`, { scope, reason })).reservations,
  settings: () => call<SettingsAnswer>('GET', '/api/vlab/admin/reservation-settings'),
  saveSettings: async (key: string, s: Partial<ReserveSettings> | GlobalSettings) =>
    (await call<{ settings: ReserveSettings }>('PUT', `/api/vlab/admin/reservation-settings/${enc(key)}`, s)).settings,
  report: (days: number, labId?: string) =>
    call<ReserveReport>('GET', `/api/vlab/admin/reports/reservations?days=${days}${labId ? `&lab_id=${enc(labId)}` : ''}`),
  reportCsvUrl: (days: number, labId?: string) => `/api/vlab/admin/reports/reservations?days=${days}&format=csv${labId ? `&lab_id=${enc(labId)}` : ''}`,
};

// --- local time text -----------------------------------------------------------------------

const p2 = (n: number) => String(n).padStart(2, '0');
export const localText = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const dayText = (d: Date) => localText(d).slice(0, 10);
export const parseLocal = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)), Number(s.slice(11, 13) || 0), Number(s.slice(14, 16) || 0));
export const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** What a rule code or a conflict's reason means. */
export function reserveWhy(code: string, L: (ko: string, en: string) => string): string {
  const m: Record<string, [string, string]> = {
    lab_schedule: ['LAB 정규 수업(사용 일정)', 'A class of the LAB (schedule)'],
    pool_schedule: ['같은 풀을 쓰는 다른 LAB의 수업', 'A class of another LAB on the same pool'],
    lab_booked: ['LAB 전체 예약과 겹침', 'Collides with a whole-LAB booking'],
    seats: ['좌석 수 초과', 'More seats than the LAB has'],
    pool_full: ['풀의 데스크톱이 모자람', 'Not enough desktops left in the pool'],
    pool_size: ['풀의 데스크톱 수보다 많음', 'More than the pool has'],
    CLOSED: ['예약을 받지 않는 LAB', 'The LAB takes no bookings'],
    PAST: ['지난 시각', 'In the past'],
    TOO_LONG: ['최대 예약 길이 초과', 'Longer than the longest booking'],
    TOO_FAR: ['미리 예약 가능 기간을 넘음', 'Too far ahead'],
    WEEKDAY: ['예약 가능한 요일이 아님', 'Not a bookable weekday'],
    HOURS: ['예약 가능 시간대 밖', 'Outside the bookable hours'],
  };
  const v = m[code];
  return v ? L(v[0], v[1]) : code;
}

export function statusText(s: ReserveStatus, L: (ko: string, en: string) => string): string {
  return s === 'pending' ? L('승인 대기', 'Waiting') : s === 'approved' ? L('확정', 'Approved') : s === 'rejected' ? L('거절', 'Rejected') : L('취소', 'Cancelled');
}

export function kindText(k: ReserveKind, L: (ko: string, en: string) => string): string {
  return k === 'lab' ? L('LAB 전체', 'Whole LAB') : k === 'seats' ? L('좌석', 'Seats') : L('데스크톱', 'Desktops');
}

// --- mock: two LABs, their classes from the mock schedules, a few bookings this week ----------

const DEFAULTS: ReserveSettings = { enabled: true, approval: false, open_from: '08:00', open_to: '22:00', weekdays: [0, 1, 2, 3, 4, 5, 6],
  max_minutes: 240, max_days_ahead: 60, roles: [], pool_ids: [], prepare_min: 10, after: 'reset', banner: false };
const mockSettings: Record<string, ReserveSettings> = { lab_a: { ...DEFAULTS, approval: true, open_from: '09:00', open_to: '21:00', weekdays: [0, 1, 2, 3, 4] } };
let mockGlobal: GlobalSettings = { mail: true, channels: [], remind_min: 30 };
const mockRows: Reservation[] = [];
let seq = 1;
const me = () => { try { return JSON.parse(localStorage.getItem('vlab.mock.user') || 'null')?.username || 'alice'; } catch { return 'alice'; } };
const settingsOf = (key: string | null) => mockSettings[key || '_pool'] ?? DEFAULTS;

async function mockLabs() { return mockAdminApi.labs(); }
async function mockPools() { return (await mockAdminApi.pools()).filter((p) => ['classroom', 'reset', 'shared'].includes(p.type)); }
async function mockScheds() { return mockAdminApi.labSchedules(); }

function seed(labs: { id: string; name: string }[], pools: { id: string; name: string }[]) {
  if (mockRows.length || !labs.length || !pools.length) return;
  const mon = mondayOf(new Date());
  const at = (d: number, h: number, m = 0) => { const x = addDays(mon, d); x.setHours(h, m, 0, 0); return localText(x); };
  const add = (r: Partial<Reservation>) => mockRows.push({ id: `rsv_${seq++}`, series_id: '', kind: 'seats', lab_id: labs[0].id, lab: labs[0].name,
    pool_id: pools[0].id, pool: pools[0].name, quantity: 8, start_at: at(2, 14), end_at: at(2, 16), purpose: '', requester: 'alice', status: 'approved',
    note: '', participants: [], reason: '', prepare_min: 10, after: 'reset', prepared: false, finished: false, desktops: 0, handed: 0, series_count: 1, ...r });
  add({ purpose: 'FPGA 캡스톤 팀 실습', start_at: at(2, 18), end_at: at(2, 20), participants: [{ subject_type: 'group', subject_id: 'EE-Capstone' }] });
  add({ kind: 'lab', quantity: 0, purpose: '학과 세미나', requester: 'prof.kim', start_at: at(4, 17), end_at: at(4, 19), lab_id: labs[1]?.id ?? labs[0].id, lab: labs[1]?.name ?? labs[0].name });
  add({ purpose: '조교 보충 실습', requester: 'bob', status: 'pending', start_at: at(3, 18), end_at: at(3, 20), quantity: 6 });
  add({ kind: 'desktops', lab_id: null, lab: null, purpose: '논문 실험 (GPU 데스크톱)', quantity: 2, start_at: at(1, 9), end_at: at(1, 12), status: 'pending', requester: 'carol' });
  const now = new Date();
  const h = now.getHours();
  add({ purpose: '지금 진행 중인 예약 (모의)', start_at: localText(new Date(now.getFullYear(), now.getMonth(), now.getDate(), h)),
    end_at: localText(new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.min(23, h + 2))), quantity: 4,
    participants: [{ subject_type: 'user', subject_id: me() }] });
}

async function ensureSeed() {
  const [labs, pools] = await Promise.all([mockLabs(), mockPools()]);
  seed(labs, pools);
  return { labs, pools };
}

const overlap = (a0: string, a1: string, b0: string, b1: string) => a0 < b1 && b0 < a1;

async function mockCheck(b: ReserveInput, exclude: string[] = [], privileged = false): Promise<CheckResult> {
  const { labs, pools } = await ensureSeed();
  const scheds = await mockScheds();
  const lab = labs.find((l) => l.id === b.lab_id);
  const pool = pools.find((p) => p.id === b.pool_id);
  if (!pool) throw new ApiError(404, 'Pool not found');
  const s = settingsOf(b.kind === 'desktops' ? null : b.lab_id ?? null);
  const start = parseLocal(b.start_at), end = parseLocal(b.end_at);
  const len = end.getTime() - start.getTime();
  const occ: Date[] = [];
  if (b.repeat) {
    const mon = mondayOf(start);
    for (let w = 0; w < b.repeat.weeks; w++) for (const d of b.repeat.weekdays) {
      const x = addDays(mon, w * 7 + d); x.setHours(start.getHours(), start.getMinutes(), 0, 0);
      if (dayText(x) >= dayText(start)) occ.push(x);
    }
  } else occ.push(start);
  const live = mockRows.filter((r) => (r.status === 'pending' || r.status === 'approved') && !exclude.includes(r.id));
  const out: Occurrence[] = occ.sort((x, y) => x.getTime() - y.getTime()).map((a) => {
    const a0 = localText(a), a1 = localText(new Date(a.getTime() + len));
    const rules: string[] = [];
    if (!s.enabled) rules.push('CLOSED');
    if (a < new Date()) rules.push('PAST');
    if (!privileged) {
      if (len / 60000 > s.max_minutes) rules.push('TOO_LONG');
      if (!s.weekdays.includes((a.getDay() + 6) % 7)) rules.push('WEEKDAY');
      if (a0.slice(11) < s.open_from || a1.slice(11) > s.open_to) rules.push('HOURS');
    }
    const conflicts: Conflict[] = [];
    for (const x of scheds) {
      if (!x.enabled || !x.weekdays.includes((a.getDay() + 6) % 7)) continue;
      const s0 = `${a0.slice(0, 10)}T${x.start_time}`, s1 = `${a0.slice(0, 10)}T${x.end_time}`;
      if (!overlap(a0, a1, s0, s1)) continue;
      if (b.kind !== 'desktops' && x.lab_id === b.lab_id) conflicts.push({ type: 'schedule', id: x.id, title: x.title, start: s0, end: s1, why: 'lab_schedule' });
      else if (x.pool_id === b.pool_id) conflicts.push({ type: 'schedule', id: x.id, title: x.title, start: s0, end: s1, why: 'pool_schedule' });
    }
    const near = live.filter((r) => overlap(a0, a1, r.start_at, r.end_at));
    const row = (r: Reservation, why: Conflict['why']): Conflict => ({ type: 'reservation', id: r.id, title: r.purpose, start: r.start_at, end: r.end_at, why, requester: r.requester, status: r.status });
    if (b.kind !== 'desktops' && lab) {
      const same = near.filter((r) => r.lab_id === lab.id);
      if (b.kind === 'lab') conflicts.push(...same.map((r) => row(r, 'lab_booked')));
      else {
        conflicts.push(...same.filter((r) => r.kind === 'lab').map((r) => row(r, 'lab_booked')));
        const used = same.filter((r) => r.kind === 'seats').reduce((n, r) => n + r.quantity, 0);
        if (lab.seats && used + (b.quantity ?? 0) > lab.seats) conflicts.push(...same.filter((r) => r.kind === 'seats').map((r) => row(r, 'seats')));
      }
    }
    const size = pool.desktops;
    const want = b.kind === 'lab' ? Math.min(lab?.seats || size, size) : b.quantity ?? 0;
    if (want > size) conflicts.push({ type: 'limit', id: '', title: '', start: a0, end: a1, why: 'pool_size', limit: size });
    else {
      const inPool = near.filter((r) => r.pool_id === pool.id && !conflicts.some((c) => c.id === r.id));
      const used = inPool.reduce((n, r) => n + (r.kind === 'lab' ? size : r.quantity), 0);
      if (inPool.length && used + want > size) conflicts.push(...inPool.map((r) => row(r, 'pool_full')));
    }
    return { start: a0, end: a1, rules, conflicts };
  });
  return { ok: out.every((o) => !o.rules.length && !o.conflicts.length), occurrences: out, approval: !privileged && s.approval };
}

const mock: typeof real = {
  options: async () => {
    const { labs, pools } = await ensureSeed();
    const pv = (p: { id: string; name: string; type: string; desktops: number }) => ({ id: p.id, name: p.name, type: p.type, desktops: p.desktops });
    return {
      labs: labs.map((l) => ({ id: l.id, name: l.name, location: l.location, seats: l.seats, settings: settingsOf(l.id), may_book: settingsOf(l.id).enabled,
        pools: pools.filter((p) => !settingsOf(l.id).pool_ids.length || settingsOf(l.id).pool_ids.includes(p.id)).map(pv) })),
      pools: pools.map(pv), pool_settings: settingsOf(null), pool_may_book: true, approver: me() === 'admin', max_weeks: 26, now: localText(new Date()),
    };
  },
  calendar: async (from, to, labId, poolId) => {
    const { labs } = await ensureSeed();
    const scheds = await mockScheds();
    const blocks: Block[] = [];
    for (let d = parseLocal(`${from}T00:00`); dayText(d) <= to; d = addDays(d, 1)) {
      for (const x of scheds) {
        if (!x.enabled || !x.weekdays.includes((d.getDay() + 6) % 7)) continue;
        if ((labId && x.lab_id !== labId) || (poolId && x.pool_id !== poolId)) continue;
        blocks.push({ type: 'schedule', id: x.id, lab_id: x.lab_id, lab: labs.find((l) => l.id === x.lab_id)?.name ?? null, pool_id: x.pool_id,
          pool: x.pool, title: x.title, start_at: `${dayText(d)}T${x.start_time}`, end_at: `${dayText(d)}T${x.end_time}` });
      }
    }
    for (const r of mockRows) {
      if (r.status !== 'pending' && r.status !== 'approved') continue;
      if (r.start_at.slice(0, 10) < from || r.start_at.slice(0, 10) > to) continue;
      if ((labId && r.lab_id !== labId) || (poolId && r.pool_id !== poolId)) continue;
      blocks.push({ ...r, type: 'reservation', mine: r.requester === me() });
    }
    return blocks.sort((a, b) => a.start_at.localeCompare(b.start_at));
  },
  mine: async () => { await ensureSeed(); return mockRows.filter((r) => r.requester === me()).sort((a, b) => a.start_at.localeCompare(b.start_at)); },
  now: async () => {
    await ensureSeed();
    const n = localText(new Date()), soon = localText(new Date(Date.now() + 3600e3));
    return mockRows.filter((r) => r.status === 'approved' && r.start_at < soon && r.end_at > n
      && (r.requester === me() || (r.participants ?? []).some((p) => p.subject_type !== 'user' || p.subject_id === me())))
      .map((r) => ({ ...r, running: r.start_at <= n }));
  },
  check: (b, admin = false) => mockCheck(b, [], admin),
  create: async (b, admin = false) => {
    const c = await mockCheck(b, [], admin);
    const keep = c.occurrences.filter((o) => !o.rules.length && !o.conflicts.length);
    const bad = c.occurrences.filter((o) => o.rules.length || o.conflicts.length);
    if (bad.length && (!b.skip_conflicts || !keep.length)) throw new ConflictError(c.occurrences, 'CONFLICT');
    const { labs, pools } = await ensureSeed();
    const sid = keep.length > 1 ? `ser_${seq}` : '';
    const lab = b.kind === 'desktops' ? undefined : labs.find((l) => l.id === b.lab_id);
    const made = keep.map((o) => {
      const r: Reservation = { id: `rsv_${seq++}`, series_id: sid, kind: b.kind, lab_id: lab?.id ?? null, lab: lab?.name ?? null, pool_id: b.pool_id,
        pool: pools.find((p) => p.id === b.pool_id)?.name ?? null, quantity: b.kind === 'lab' ? 0 : b.quantity ?? 0, start_at: o.start, end_at: o.end,
        purpose: b.purpose ?? '', note: b.note ?? '', participants: b.participants ?? [], requester: (admin && b.requester) || me(),
        status: c.approval ? 'pending' : 'approved', reason: '', prepare_min: 10, after: 'reset', prepared: false, finished: false,
        desktops: 0, handed: 0, series_count: keep.length, created_at: new Date().toISOString() };
      mockRows.push(r);
      return r;
    });
    return { reservations: made, skipped: bad, approval: c.approval };
  },
  change: async (id, b, admin = false) => {
    const r = mockRows.find((x) => x.id === id);
    if (!r) throw new ApiError(404, 'Booking not found');
    const merged = { ...r, ...b } as Reservation & ReserveInput;
    const c = await mockCheck({ ...merged, repeat: null }, [id], admin);
    if (!c.ok) throw new ConflictError(c.occurrences, 'CONFLICT');
    Object.assign(r, b, { status: !admin && c.approval ? 'pending' : r.status });
    return r;
  },
  cancel: async (id, scope, reason = '') => {
    const r = mockRows.find((x) => x.id === id);
    if (!r) throw new ApiError(404, 'Booking not found');
    const rows = scope === 'series' && r.series_id ? mockRows.filter((x) => x.series_id === r.series_id && (x.status === 'pending' || x.status === 'approved')) : [r];
    rows.forEach((x) => { x.status = 'cancelled'; x.reason = reason; });
    return rows;
  },
  desktop: async () => ({ id: 'd1', name: 'lab-win11-01' }),
  list: async (from, to, labId, status) => {
    await ensureSeed();
    const blocks = (await mock.calendar(from, to, labId)).filter((b) => b.type === 'schedule');
    return { reservations: mockRows.filter((r) => r.start_at.slice(0, 10) >= from && r.start_at.slice(0, 10) <= to
      && (!labId || r.lab_id === labId) && (!status || r.status === status)), schedules: blocks };
  },
  pending: async () => { await ensureSeed(); return mockRows.filter((r) => r.status === 'pending').map((r) => ({ ...r, waiting: 1 })); },
  summary: async () => {
    await ensureSeed();
    const t = localText(new Date()).slice(0, 10), n = localText(new Date());
    const today = mockRows.filter((r) => r.start_at.slice(0, 10) === t);
    return { today: today.filter((r) => r.status === 'approved').length, today_pending: today.filter((r) => r.status === 'pending').length,
      pending: mockRows.filter((r) => r.status === 'pending').length, running: today.filter((r) => r.status === 'approved' && r.start_at <= n && r.end_at > n).length };
  },
  approve: async (id, scope) => {
    const r = mockRows.find((x) => x.id === id)!;
    const rows = scope === 'series' && r.series_id ? mockRows.filter((x) => x.series_id === r.series_id && x.status === 'pending') : [r];
    rows.forEach((x) => { x.status = 'approved'; x.reviewed_by = me(); });
    return rows;
  },
  reject: async (id, scope, reason) => {
    if (!reason.trim()) throw new ApiError(400, 'A reason is required to reject');
    const r = mockRows.find((x) => x.id === id)!;
    const rows = scope === 'series' && r.series_id ? mockRows.filter((x) => x.series_id === r.series_id && x.status === 'pending') : [r];
    rows.forEach((x) => { x.status = 'rejected'; x.reason = reason; x.reviewed_by = me(); });
    return rows;
  },
  settings: async () => {
    const labs = await mockLabs();
    return { labs: Object.fromEntries(labs.map((l) => [l.id, { ...settingsOf(l.id), default_pools: [] }])), pool: settingsOf(null), global: mockGlobal,
      channels: [{ id: 'ch1', name: '운영팀 Slack', type: 'slack' }, { id: 'ch2', name: 'Teams 실습실 채널', type: 'teams' }], defaults: DEFAULTS };
  },
  saveSettings: async (key, s) => {
    if (key === '_global') { mockGlobal = { ...mockGlobal, ...(s as GlobalSettings) }; return DEFAULTS; }
    mockSettings[key] = { ...settingsOf(key), ...(s as Partial<ReserveSettings>) };
    return mockSettings[key];
  },
  report: async (days) => {
    await ensureSeed();
    const n = localText(new Date());
    const rows: ReportRow[] = mockRows.filter((r) => r.status === 'approved').map((r, i) => {
      const booked = (parseLocal(r.end_at).getTime() - parseLocal(r.start_at).getTime()) / 3600e3;
      const ended = r.end_at <= n;
      const used = i % 3 === 1 ? 0 : Math.round(booked * (0.5 + (i % 3) * 0.2) * 100) / 100;
      return { id: r.id, lab: r.lab ?? '', pool: r.pool ?? '', kind: r.kind, quantity: r.quantity, start_at: r.start_at, end_at: r.end_at, purpose: r.purpose,
        requester: r.requester, booked_hours: booked, used_hours: ended ? used : 0, users: used ? 3 + i : 0, no_show: ended && !used, running: !ended };
    });
    const past = [
      { lab: '교육장 A', d: 3, h: 2, used: 1.6, users: 18 }, { lab: '교육장 A', d: 5, h: 3, used: 0, users: 0 },
      { lab: '공용 연구실 B', d: 6, h: 2, used: 1.9, users: 7 }, { lab: '교육장 A', d: 9, h: 4, used: 3.1, users: 21 },
    ].filter((x) => x.d <= days).map((x, i): ReportRow => {
      const s = addDays(new Date(), -x.d); s.setHours(14, 0, 0, 0);
      return { id: `old_${i}`, lab: x.lab, pool: '교육장 A 수업용', kind: 'seats', quantity: 20, start_at: localText(s),
        end_at: localText(new Date(s.getTime() + x.h * 3600e3)), purpose: ['캡스톤 중간 발표 준비', '보충 실습', '연구실 세미나', 'FPGA 실습'][i],
        requester: ['prof.kim', 'bob', 'carol', 'alice'][i], booked_hours: x.h, used_hours: x.used, users: x.users, no_show: x.used === 0, running: false };
    });
    const all = [...past, ...rows];
    const by: Record<string, ReserveReport['by_lab'][number]> = {};
    for (const r of all) {
      const g = by[r.lab] ??= { lab_id: r.lab, lab: r.lab || '(풀 예약)', reservations: 0, booked_hours: 0, used_hours: 0, no_shows: 0, users: 0 };
      g.reservations++; g.booked_hours += r.booked_hours; g.used_hours += r.used_hours; g.no_shows += r.no_show ? 1 : 0; g.users += r.users;
    }
    const booked = all.reduce((a, r) => a + r.booked_hours, 0), used = all.reduce((a, r) => a + r.used_hours, 0);
    const ended = all.filter((r) => !r.running);
    return { days, from: dayText(addDays(new Date(), -days + 1)), to: dayText(new Date()), reservations: all, by_lab: Object.values(by),
      totals: { reservations: all.length, booked_hours: booked, used_hours: used, no_shows: all.filter((r) => r.no_show).length,
        no_show_rate: ended.length ? ended.filter((r) => r.no_show).length / ended.length : 0, use_rate: booked ? used / booked : 0 } };
  },
  reportCsvUrl: () => 'data:text/csv;charset=utf-8,lab%2Cpool%2Ckind%0A',
};

export const reservationsApi = isMock ? mock : real;
