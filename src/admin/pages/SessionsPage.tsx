import { useCallback, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import type { EndedSession, SessionRow } from '../../api/types';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { duration as fmtDuration } from '../../format';
import { useI18n } from '../../i18n';

// 운영 > 접속 기록: who connected to which desktop, how, from where, how long.
// An open session can be ended here, one by one or every one of a user.
export function SessionsPage() {
  const { t, lang } = useI18n();
  const pools = useLoad(adminApi.pools);
  const [user, setUser] = useState('');
  const [filter, setFilter] = useState<{ username: string; pool_id: string }>({ username: '', pool_id: '' });
  const sessions = useLoad(useCallback(() => adminApi.sessions({ ...filter, limit: 500 }), [filter]), [filter]);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const duration = (a: string, b: string | null) => {
    if (!b) return null;
    const m = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
    return fmtDuration(m, lang);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setFilter((f) => ({ ...f, username: user.trim() }));
  }

  // what ending did, in words: VNC is hung up, SPICE and RDP only lose their record
  function told(done: string, ended: EndedSession[]) {
    return ended.some((x) => x.record_only) ? `${done} ${t('sessions.endRecordOnly')}` : done;
  }

  async function endOne(s: SessionRow) {
    if (!confirm(t('sessions.endConfirm').replace('{user}', s.username).replace('{protocol}', s.protocol.toUpperCase()))) return;
    setBusy(s.id); setNotice(null);
    try {
      const r = await adminApi.endSession(s.id);
      setNotice({ kind: 'info', text: told(t('sessions.endDone').replace('{user}', s.username), [r]) });
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
      sessions.reload();
    }
  }

  async function endUser(username: string) {
    if (!confirm(t('sessions.endUserConfirm').replace('{user}', username))) return;
    setBusy(`user:${username}`); setNotice(null);
    try {
      const ended = await adminApi.endUserSessions(username);
      setNotice({ kind: 'info', text: ended.length
        ? told(t('sessions.endUserDone').replace('{user}', username).replace('{n}', String(ended.length)), ended)
        : t('sessions.endUserNone').replace('{user}', username) });
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
      sessions.reload();
    }
  }

  const openOfFiltered = sessions.state === 'ok' && filter.username
    ? sessions.data.filter((s) => !s.ended_at && s.username === filter.username).length : 0;

  return (
    <>
      <form className="toolbar" onSubmit={submit}>
        <select value={filter.pool_id} onChange={(e) => setFilter((f) => ({ ...f, pool_id: e.target.value }))} aria-label={t('desk.pool')}>
          <option value="">{t('desk.pool')}: {t('common.all')}</option>
          {pools.state === 'ok' && pools.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="search" placeholder={t('sessions.userFilter')} value={user} onChange={(e) => setUser(e.target.value)} />
        <button type="submit" className="btn">{t('common.search')}</button>
        <button type="button" className="btn" onClick={sessions.reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
        {filter.username && openOfFiltered > 0 && (
          <button type="button" className="btn danger" disabled={busy !== null} onClick={() => endUser(filter.username)}>
            {t('sessions.endUser').replace('{user}', filter.username)}
          </button>
        )}
      </form>
      <p className="muted small">{t('sessions.note')} {t('sessions.endLimit')}</p>
      {notice && <div className={`alert ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}

      <LoadState value={sessions} retry={sessions.reload}>
        {(list) => list.length === 0 ? <div className="empty"><p>{t('sessions.empty')}</p></div> : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('sessions.started')}</th><th>{t('sessions.ended')}</th><th>{t('desk.user')}</th>
                <th>{t('desk.name')}</th><th>{t('desk.pool')}</th><th>{t('sessions.protocol')}</th><th>{t('sessions.ip')}</th><th />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>{fmt(s.started_at)}</td>
                  <td>
                    {s.ended_at
                      ? <>{fmt(s.ended_at)} <span className="muted small">({duration(s.started_at, s.ended_at)})</span>
                        {s.result === 'terminated' && <span className="chip chip-warn">{t('sessions.terminated')}</span>}</>
                      : <span className="badge state-in_use">{t('sessions.open')}</span>}
                  </td>
                  <td className="strong">{s.username}</td>
                  <td>{s.desktop}{s.vmid != null && <span className="muted small"> · {s.vmid}</span>}</td>
                  <td>{s.pool_id ? <Link to={`/admin/pools/list/${s.pool_id}`}>{s.pool}</Link> : s.pool}</td>
                  <td><span className="chip">{s.protocol.toUpperCase()}</span></td>
                  <td className="muted">{s.client_ip}</td>
                  <td className="actions">
                    {!s.ended_at && (
                      <button type="button" className="btn-ghost danger" disabled={busy !== null} onClick={() => endOne(s)}>
                        {t('sessions.end')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LoadState>
    </>
  );
}
