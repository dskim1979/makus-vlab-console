// 내 계정 > 알림: which mails I take. The engine's /api/vlab/me/notices (makus-vlab
// pegaprox/api/vlab_notices.py); every kind is on until the user turns it off. Security notices
// (a password or two-step sign-in reset by an administrator, an account disabled or expired)
// always go and are not listed.

import { ApiError, isMock, request } from './client';

export type NoticeKind = { id: string; label_ko: string; label_en: string; on: boolean };
export type MyNotices = { kinds: NoticeKind[]; email: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { status, data } = await request<T & { error?: string }>(method, path, body);
  if (status < 200 || status >= 300) {
    const d = data as { error?: string } | null;
    throw new ApiError(status, d && typeof d.error === 'string' ? d.error : `HTTP ${status}`, d);
  }
  return data;
}

const real = {
  get: () => call<MyNotices>('GET', '/api/vlab/me/notices'),
  save: (changes: Record<string, boolean>) => call<MyNotices>('PUT', '/api/vlab/me/notices', changes),
};

// --- mock -----------------------------------------------------------------------------------

const KINDS: [string, string, string][] = [
  ['gpu_job', 'GPU 작업 시작·종료 (작업을 보낼 때 고른 것)', 'GPU job started / ended (as chosen per job)'],
  ['gpu_quota', 'GPU 할당량 경고 (80%·100%)', 'GPU quota warnings (80% / 100%)'],
  ['loan', '카드·보드 대여 만료 알림과 자동 반납', 'Card / board loan reminders and automatic returns'],
  ['ide', '웹 IDE 종료 (유휴·관리자)', 'Web IDE closed (idle / by an administrator)'],
  ['work', '작업 보호 (정리 미룸·쓰이지 않는 카드)', 'Work protection (deferred clean-ups, idle cards)'],
  ['desktop', '데스크톱 배정·회수·교체·이동·접속 끊김', 'Desktop assigned, taken back, replaced, moved or disconnected'],
  ['booking', 'LAB 예약 시작 전 알림', 'LAB booking about to start'],
  ['storage', '내 폴더(NAS) 용량 90%·100%', 'My NAS folders at 90% / 100%'],
  ['request', '신청 결과 (가입·대여·반출·예약)', 'Answers to my requests (sign-up, loans, exports, bookings)'],
];
const off = new Set<string>(['work']);
const delay = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));
const view = (): MyNotices => ({ kinds: KINDS.map(([id, ko, en]) => ({ id, label_ko: ko, label_en: en, on: !off.has(id) })), email: 'alice@lab.example' });

const mock: typeof real = {
  get: () => delay(view()),
  save: (changes) => {
    for (const [k, v] of Object.entries(changes)) {
      if (!KINDS.some(([id]) => id === k)) return Promise.reject(new ApiError(400, `unknown kinds: ${k}`));
      if (typeof v !== 'boolean') return Promise.reject(new ApiError(400, 'each kind is true or false'));
      if (v) off.delete(k); else off.add(k);
    }
    return delay(view());
  },
};

export const noticesApi = isMock ? mock : real;
