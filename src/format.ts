// Durations in the reader's language: "2일 3시간", "4시간 5분", "30분" / "2d 3h", "4h 5m", "30m".
export function duration(minutes: number, lang: 'ko' | 'en') {
  const m = Math.max(0, Math.round(minutes));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), r = m % 60;
  const u = lang === 'ko' ? { d: '일', h: '시간', m: '분' } : { d: 'd', h: 'h', m: 'm' };
  const sep = lang === 'ko' ? ' ' : ' ';
  if (d) return `${d}${u.d}${sep}${h}${u.h}`;
  if (h) return `${h}${u.h}${sep}${r}${u.m}`;
  return `${r}${u.m}`;
}
