import { useCallback, useState, type FormEvent } from 'react';
import { adminApi } from '../../api/admin';
import type { AuditQuery } from '../../api/types';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

const PAGE = 50;

// 운영 > 작업 기록(감사): the engine's audit log, vLAB's own entries by default.
export function AuditPage() {
  const { t, lang } = useI18n();
  const [draft, setDraft] = useState<AuditQuery>({ vlab_only: true });
  const [query, setQuery] = useState<AuditQuery>({ vlab_only: true, offset: 0, limit: PAGE });
  const log = useLoad(useCallback(() => adminApi.audit(query), [query]), [query]);

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function submit(e: FormEvent) {
    e.preventDefault();
    setQuery({ ...draft, offset: 0, limit: PAGE });
  }

  return (
    <>
      <form className="toolbar" onSubmit={submit}>
        <input type="search" placeholder={t('common.search')} value={draft.q ?? ''} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        <input placeholder={t('audit.user')} value={draft.user ?? ''} onChange={(e) => setDraft({ ...draft, user: e.target.value })} />
        <label className="check-inline"><span>{t('audit.from')}</span>
          <input type="date" value={draft.date_from ?? ''} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} /></label>
        <label className="check-inline"><span>{t('audit.to')}</span>
          <input type="date" value={draft.date_to ?? ''} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} /></label>
        <label className="check-inline">
          <input type="checkbox" checked={!!draft.vlab_only}
            onChange={(e) => { const next = { ...draft, vlab_only: e.target.checked }; setDraft(next); setQuery({ ...next, offset: 0, limit: PAGE }); }} />
          <span>{t('audit.vlabOnly')}</span>
        </label>
        <button type="submit" className="btn">{t('common.search')}</button>
        <button type="button" className="btn" onClick={log.reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
      </form>
      <p className="muted small">{t('audit.note')}</p>

      <LoadState value={log} retry={log.reload}>
        {(page) => page.entries.length === 0 ? <div className="empty"><p>{t('audit.empty')}</p></div> : (
          <>
            <div className="table-scroll"><table className="table">
              <thead>
                <tr><th>{t('audit.time')}</th><th>{t('audit.user')}</th><th>{t('audit.action')}</th><th>{t('audit.details')}</th><th>{t('audit.ip')}</th></tr>
              </thead>
              <tbody>
                {page.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{fmt(e.timestamp)}</td>
                    <td className="strong">{e.user}</td>
                    <td><code className="code">{e.action}</code></td>
                    <td className="small audit-details">{e.details}</td>
                    <td className="muted small">{e.ip_address}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="pager">
              <span className="muted small">
                {t('audit.range').replace('{a}', String(page.offset + 1)).replace('{b}', String(page.offset + page.entries.length))
                  .replace('{n}', String(page.total))}
              </span>
              <button type="button" className="btn" disabled={page.offset === 0}
                onClick={() => setQuery({ ...query, offset: Math.max(0, page.offset - PAGE) })}>{t('audit.prev')}</button>
              <button type="button" className="btn" disabled={!page.has_more}
                onClick={() => setQuery({ ...query, offset: page.offset + PAGE })}>{t('audit.next')}</button>
            </div>
          </>
        )}
      </LoadState>
    </>
  );
}
