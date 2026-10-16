import { useState } from 'react';
import { adminApi } from '../../api/admin';
import type { Notice, NoticeInput, NoticeSeverity } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { LoadState } from '../../components/LoadState';
import { NOTICES_CHANGED } from '../../components/NoticeBanners';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';

// 운영 > 플랫폼 설정 > 공지: the bars on top of the portal and the admin console
// (components/NoticeBanners.tsx). Kind, audience and a period; the engine keeps them.
export function NoticesPage() {
  const { t, lang } = useI18n();
  const notices = useLoad(adminApi.notices);
  const [editing, setEditing] = useState<Notice | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function remove(n: Notice) {
    if (!confirm(t('notice.deleteConfirm'))) return;
    setError(null);
    try { await adminApi.deleteNotice(n.id); } catch (e) { setError((e as Error).message); }
    notices.reload();
    window.dispatchEvent(new Event(NOTICES_CHANGED));
  }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>{t('notice.new')}</button>
        <button type="button" className="btn" onClick={notices.reload}>{t('common.refresh')}</button>
      </div>
      <p className="muted small">{t('notice.intro')}</p>
      {error && <div className="alert error" role="alert">{error}</div>}

      <LoadState value={notices} retry={notices.reload}>
        {(list) => list.length === 0 ? <div className="empty"><p>{t('notice.empty')}</p></div> : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('notice.text')}</th><th>{t('notice.kind')}</th><th>{t('notice.audience')}</th>
                <th>{t('notice.period')}</th><th>{t('notice.state')}</th><th />
              </tr>
            </thead>
            <tbody>
              {list.map((n) => (
                <tr key={n.id}>
                  <td className="notice-cell">{n.text}</td>
                  <td><span className={`chip ${n.severity === 'info' ? 'chip-accent' : n.severity === 'warning' ? 'chip-warn' : 'chip-off'}`}>
                    {t(`notice.kind.${n.severity}` as MessageKey)}</span></td>
                  <td className="nowrap">{t(`notice.audience.${n.audience}` as MessageKey)}</td>
                  <td className="small">
                    {n.starts_at ? fmt(n.starts_at) : t('notice.now')} ~ {n.expires_at ? fmt(n.expires_at) : t('notice.forever')}
                  </td>
                  <td><span className={`badge ${n.state === 'running' ? 'state-ready' : n.state === 'scheduled' ? 'state-provisioning' : 'state-stopped'}`}>
                    {t(`notice.state.${n.state}` as MessageKey)}</span></td>
                  <td className="actions">
                    <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(n)}>{t('common.edit')}</button>
                    <button type="button" className="btn-ghost small-btn danger" onClick={() => remove(n)}>{t('common.delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LoadState>

      {editing && (
        <NoticeDialog notice={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notices.reload(); window.dispatchEvent(new Event(NOTICES_CHANGED)); }} />
      )}
    </>
  );
}

// <input type="datetime-local"> works in local wall-clock time; the engine wants ISO with a zone
const pad = (n: number) => String(n).padStart(2, '0');
function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString().slice(0, 19) + 'Z' : null);

function NoticeDialog({ notice, onClose, onSaved }: { notice: Notice | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(notice?.text ?? '');
  const [severity, setSeverity] = useState<NoticeSeverity>(notice?.severity ?? 'info');
  const [audience, setAudience] = useState<Notice['audience']>(notice?.audience ?? 'all');
  const [starts, setStarts] = useState(toLocalInput(notice?.starts_at ?? null));
  const [ends, setEnds] = useState(toLocalInput(notice?.expires_at ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const body: Partial<NoticeInput> = { text: text.trim(), severity, starts_at: fromLocalInput(starts) };
    // an expiry left as it was is not sent again: one that has passed would be refused
    if (!notice || ends !== toLocalInput(notice.expires_at)) body.expires_at = fromLocalInput(ends);
    if (audience !== 'other') body.audience = audience;
    setBusy(true); setError(null);
    try {
      await adminApi.saveNotice(notice?.id ?? null, body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={t(notice ? 'notice.edit' : 'notice.new')} onClose={onClose} onSubmit={submit}
      submitLabel={t('common.save')} busy={busy} error={error}>
      <label>
        <span>{t('notice.text')}</span>
        <textarea rows={3} required maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <small className="muted">{t('notice.textHint')}</small>
      <div className="form-row form-row-even">
        <label>
          <span>{t('notice.kind')}</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as NoticeSeverity)}>
            <option value="info">{t('notice.kind.info')}</option>
            <option value="warning">{t('notice.kind.warning')}</option>
            {severity === 'critical' && <option value="critical">{t('notice.kind.critical')}</option>}
          </select>
        </label>
        <label>
          <span>{t('notice.audience')}</span>
          <select value={audience} onChange={(e) => setAudience(e.target.value as Notice['audience'])}>
            <option value="all">{t('notice.audience.all')}</option>
            <option value="admins">{t('notice.audience.admins')}</option>
            {audience === 'other' && <option value="other">{t('notice.audience.other')}</option>}
          </select>
        </label>
      </div>
      <div className="form-row form-row-even">
        <label>
          <span>{t('notice.starts')}</span>
          <input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
          <small className="muted">{t('notice.startsHint')}</small>
        </label>
        <label>
          <span>{t('notice.ends')}</span>
          <input type="datetime-local" value={ends} min={starts || undefined} onChange={(e) => setEnds(e.target.value)} />
          <small className="muted">{t('notice.endsHint')}</small>
        </label>
      </div>
    </Dialog>
  );
}
