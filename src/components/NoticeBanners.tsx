import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ActiveNotice } from '../api/types';
import { useI18n } from '../i18n';

// Notices (플랫폼 설정 > 공지) as bars under the top bar, portal and admin console alike.
// A closed notice stays closed in this browser until its text changes (a new rev).
const KEY = 'vlab.notices.closed';
const REFRESH_MS = 5 * 60_000;
// 플랫폼 설정 > 공지 sends this after a change, so the bars show it at once
export const NOTICES_CHANGED = 'vlab:notices-changed';

function loadClosed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function saveClosed(list: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-50))); } catch { /* private window: closed for this visit only */ }
}

export function NoticeBanners() {
  const { t } = useI18n();
  const [notices, setNotices] = useState<ActiveNotice[]>([]);
  const [closed, setClosed] = useState<string[]>(loadClosed);

  useEffect(() => {
    let live = true;
    const load = () => { api.notices().then((n) => { if (live) setNotices(n); }); };
    load();
    const id = setInterval(load, REFRESH_MS);
    window.addEventListener(NOTICES_CHANGED, load);
    return () => { live = false; clearInterval(id); window.removeEventListener(NOTICES_CHANGED, load); };
  }, []);

  const shown = notices.filter((n) => !closed.includes(`${n.id}:${n.rev}`));
  if (shown.length === 0) return null;

  function close(n: ActiveNotice) {
    const next = [...closed.filter((x) => !x.startsWith(`${n.id}:`)), `${n.id}:${n.rev}`];
    setClosed(next);
    saveClosed(next);
  }

  return (
    <div className="notice-bars" role="region" aria-label={t('notice.region')}>
      {shown.map((n) => (
        <div key={n.id} className={`notice-bar notice-${n.severity}`} role={n.severity === 'info' ? 'status' : 'alert'}>
          <span className="notice-kind">{t(`notice.kind.${n.severity}`)}</span>
          <span className="notice-text">{n.text}</span>
          <button type="button" className="notice-close" aria-label={t('notice.dismiss')} title={t('notice.dismiss')}
            onClick={() => close(n)}>×</button>
        </div>
      ))}
    </div>
  );
}
