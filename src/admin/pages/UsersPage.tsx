import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { relativeTime } from '../../portal/DesktopCard';

export function roleLabel(t: (k: MessageKey) => string, role: string) {
  return ['admin', 'user', 'viewer'].includes(role) ? t(`role.${role}` as MessageKey) : role;
}

// 사용자 > 사용자 목록: accounts of the caller's tenant with their desktops and last connect.
export function UsersPage() {
  const { t, lang } = useI18n();
  const users = useLoad(adminApi.allUsers);
  const [q, setQ] = useState('');
  const [showDisabled, setShowDisabled] = useState(false);

  const rows = useMemo(() => {
    if (users.state !== 'ok') return [];
    const needle = q.trim().toLowerCase();
    return users.data.filter((u) => (showDisabled || u.enabled !== false) &&
      (!needle || [u.username, u.display_name, u.email ?? ''].some((s) => s.toLowerCase().includes(needle))));
  }, [users, q, showDisabled]);

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check-inline">
          <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} />
          <span>{t('users.showDisabled')}</span>
        </label>
        <button type="button" className="btn" onClick={users.reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
      </div>
      <p className="muted small">{t('users.note')}</p>
      <LoadState value={users} retry={users.reload}>
        {() => rows.length === 0 ? <div className="empty"><p>{t('users.empty')}</p></div> : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('users.username')}</th><th>{t('users.name')}</th><th>{t('users.role')}</th>
                <th>{t('users.source')}</th><th className="num">{t('users.desktops')}</th><th>{t('portal.lastConnected')}</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.username} className={u.enabled === false ? 'row-off' : ''}>
                  <td className="strong">
                    {u.username}
                    {u.enabled === false && <span className="chip chip-off">{t('users.disabled')}</span>}
                  </td>
                  <td>{u.display_name}{u.email && <div className="muted small">{u.email}</div>}</td>
                  <td>{roleLabel(t, u.role)}</td>
                  <td><span className="chip">{u.auth_source.toUpperCase()}</span></td>
                  <td className="num">{u.desktops ?? 0}</td>
                  <td>{relativeTime(u.last_connected, lang) ?? <span className="muted">{t('portal.never')}</span>}</td>
                  <td className="actions">
                    <Link className="btn-ghost" to={`/admin/users/access/${encodeURIComponent(u.username)}`}>{t('users.access')}</Link>
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
