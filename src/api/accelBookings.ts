// Card and board bookings on the reservation calendar (makus-vlab pegaprox/api/vlab_accel_book.py).
import { ApiError, isMock, request } from './client';

export type ABKind = 'card' | 'board';
export type ABStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type AccelBooking = {
  id: string; kind: ABKind; cluster_id: string; resource: string; resource_name: string; card_kind: string;
  start_at: string; end_at: string; status: ABStatus; started_at: string | null; finished_at: string | null; created_at: string;
  // the booker's own (and the approvers'): left out of others' rows
  username?: string; desktop_id?: string; desktop?: string | null; purpose?: string; reason?: string; error?: string; lease_id?: string; reviewed_by?: string;
};
export type ABSettings = { enabled: boolean; approval: boolean; max_hours: number; max_days_ahead: number; roles: string[]; remind_min: number };
export type ABCard = { cluster_id: string; id: string; name: string; count: number; kind: 'gpu' | 'npu' | 'fpga' };
export type ABBoard = { cluster_id: string; id: string; name: string; node: string; kind: string };
export type ABOptions = { settings: ABSettings; allowed: boolean; desktops: { id: string; name: string; cluster_id: string; node: string; pool?: string }[];
  cards: ABCard[]; boards: ABBoard[] };
export type ABInput = { kind: ABKind; cluster_id: string; resource: string; desktop_id: string; start_at: string; end_at: string; purpose?: string };
export type ABConflict = { why: 'TAKEN' | 'ON_LOAN' | 'DESKTOP_BUSY' | 'NO_DEVICES'; id?: string; start?: string; end?: string; limit?: number };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string; code?: string }>(method, path, body);
  if (status < 200 || status >= 300) throw new ApiError(status, data?.code || data?.error || `HTTP ${status}`, data);
  return data;
}
const enc = encodeURIComponent;
const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));

// --- mock -----------------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0');
const at = (days: number, h: number, m = 0) => {
  const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
let mockSettings: ABSettings = { enabled: true, approval: true, max_hours: 72, max_days_ahead: 30, roles: [], remind_min: 30 };
const CARDS: ABCard[] = [
  { cluster_id: 'lab-cluster', id: 'a100-80g', name: 'NVIDIA A100 80GB', count: 4, kind: 'gpu' },
  { cluster_id: 'lab-cluster', id: 'l40s', name: 'NVIDIA L40S', count: 2, kind: 'gpu' },
  { cluster_id: 'lab-cluster', id: 'alveo-u250', name: 'AMD Alveo U250', count: 2, kind: 'fpga' },
  { cluster_id: 'lab-cluster', id: 'rngd', name: 'FuriosaAI RNGD', count: 2, kind: 'npu' },
];
const BOARDS: ABBoard[] = [
  { cluster_id: 'lab-cluster', id: 'brd-zcu102', name: 'ZCU102 #1', node: 'pve1', kind: 'Zynq UltraScale+' },
  { cluster_id: 'lab-cluster', id: 'brd-vck190', name: 'VCK190 #1', node: 'pve2', kind: 'Versal' },
];
let seq = 10;
const mk = (id: string, kind: ABKind, resource: string, name: string, ck: string, d: number, h0: number, h1: number, status: ABStatus, user: string, extra: Partial<AccelBooking> = {}): AccelBooking => ({
  id, kind, cluster_id: 'lab-cluster', resource, resource_name: name, card_kind: ck, start_at: at(d, h0), end_at: at(d, h1), status,
  started_at: null, finished_at: null, created_at: at(-1, 10), username: user, desktop: user === 'alice' ? 'ai-ws-03' : `${user}-ws`,
  desktop_id: `d-${user}`, purpose: '', ...extra });
const mockRows: AccelBooking[] = [
  mk('abk-1', 'card', 'a100-80g', 'NVIDIA A100 80GB', 'gpu', 0, 9, 18, 'approved', 'alice', { purpose: 'LLaMA 미세조정', started_at: at(0, 8, 55) }),
  mk('abk-2', 'card', 'a100-80g', 'NVIDIA A100 80GB', 'gpu', 1, 13, 17, 'pending', 'alice', { purpose: '논문 실험 재현' }),
  mk('abk-3', 'board', 'brd-zcu102', 'ZCU102 #1', 'board', 1, 10, 12, 'approved', 'bob', { purpose: 'DMA 드라이버 시험' }),
  mk('abk-4', 'card', 'alveo-u250', 'AMD Alveo U250', 'fpga', 2, 9, 21, 'approved', 'carol', { purpose: 'HLS 커널 측정' }),
  mk('abk-5', 'card', 'a100-80g', 'NVIDIA A100 80GB', 'gpu', 2, 9, 12, 'approved', 'dave'),
  mk('abk-6', 'card', 'rngd', 'FuriosaAI RNGD', 'npu', 3, 14, 18, 'pending', 'erin', { purpose: '추론 서빙 시험' }),
];
const me = () => (new URLSearchParams(window.location.search).get('as') ?? localStorage.getItem('vlab.mock.as') ?? 'alice');
const strip = (r: AccelBooking): AccelBooking => {
  const { username: _u, desktop_id: _d, desktop: _k, purpose: _p, reason: _r, error: _e, lease_id: _l, reviewed_by: _b, ...rest } = r;
  void _u; void _d; void _k; void _p; void _r; void _e; void _l; void _b;
  return rest;
};

const mock = {
  options: () => delay<ABOptions>({ settings: { ...mockSettings }, allowed: mockSettings.enabled, cards: CARDS, boards: BOARDS,
    desktops: [{ id: 'd-alice', name: 'ai-ws-03', cluster_id: 'lab-cluster', node: 'pve1', pool: 'AI 연구실' }] }),
  mine: () => delay(mockRows.filter((r) => r.username === 'alice').map((r) => ({ ...r }))),
  calendar: () => delay(mockRows.filter((r) => r.status === 'pending' || r.status === 'approved').map((r) => (r.username === 'alice' ? { ...r } : strip(r)))),
  book: (b: ABInput) => {
    const res = b.kind === 'card' ? CARDS.find((c) => c.id === b.resource) : BOARDS.find((x) => x.id === b.resource);
    const r = mk(`abk-${seq++}`, b.kind, b.resource, res?.name ?? b.resource, b.kind === 'card' ? (res as ABCard)?.kind ?? 'gpu' : 'board', 0, 0, 0,
      mockSettings.approval ? 'pending' : 'approved', 'alice', { start_at: b.start_at, end_at: b.end_at, purpose: b.purpose ?? '' });
    mockRows.push(r);
    return delay({ booking: { ...r } });
  },
  cancel: (id: string) => { const r = mockRows.find((x) => x.id === id); if (r) r.status = 'cancelled'; return delay({ booking: { ...(r as AccelBooking) } }); },
  admin: () => delay({ bookings: mockRows.map((r) => ({ ...r })), pending: mockRows.filter((r) => r.status === 'pending').map((r) => ({ ...r })), settings: { ...mockSettings } }),
  act: (id: string, action: 'approve' | 'reject' | 'cancel', reason = '') => {
    const r = mockRows.find((x) => x.id === id);
    if (r) { r.status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'cancelled'; r.reason = reason; r.reviewed_by = 'admin'; }
    return delay({ booking: { ...(r as AccelBooking) } });
  },
  saveSettings: (s: Partial<ABSettings>) => { mockSettings = { ...mockSettings, ...s }; return delay({ settings: { ...mockSettings } }); },
};
void me;

const real = {
  options: () => call<ABOptions>('GET', '/api/vlab/me/accel-bookings/options'),
  mine: async () => (await call<{ bookings: AccelBooking[] }>('GET', '/api/vlab/me/accel-bookings')).bookings,
  calendar: async (from?: string, to?: string) => (await call<{ bookings: AccelBooking[] }>('GET',
    `/api/vlab/accel-bookings/calendar${from ? `?from=${enc(from)}&to=${enc(to ?? '')}` : ''}`)).bookings,
  book: (b: ABInput) => call<{ booking: AccelBooking }>('POST', '/api/vlab/me/accel-bookings', b),
  cancel: (id: string) => call<{ booking: AccelBooking }>('POST', `/api/vlab/me/accel-bookings/${enc(id)}/cancel`),
  admin: () => call<{ bookings: AccelBooking[]; pending: AccelBooking[]; settings: ABSettings }>('GET', '/api/vlab/admin/accel-bookings'),
  act: (id: string, action: 'approve' | 'reject' | 'cancel', reason = '') =>
    call<{ booking: AccelBooking }>('POST', `/api/vlab/admin/accel-bookings/${enc(id)}/${action}`, { reason }),
  saveSettings: (s: Partial<ABSettings>) => call<{ settings: ABSettings }>('PUT', '/api/vlab/admin/accel-booking-settings', s),
};

export const accelBookingsApi = isMock ? mock : real;

export const AB_WHY_KO: Record<string, string> = {
  TAKEN: '그 시간에는 남은 카드 · 보드가 없습니다', ON_LOAN: '지금 대여 중인 것이 그때까지 반납되지 않습니다', DESKTOP_BUSY: '그 데스크톱에는 그 시간에 다른 예약이 있습니다',
  NO_DEVICES: '이 매핑에 카드가 없습니다', BAD_TIME: '시작과 끝을 확인하세요', PAST: '지난 시간은 예약할 수 없습니다', TOO_LONG: '예약 최대 길이를 넘었습니다',
  TOO_FAR: '미리 예약할 수 있는 기간을 넘었습니다', NODE: '보드가 꽂힌 서버와 데스크톱이 도는 서버가 다릅니다', ROLE: '예약할 수 있는 역할이 아닙니다', OFF: '카드 · 보드 예약이 꺼져 있습니다',
};
