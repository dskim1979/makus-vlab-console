import { useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import type { UserAccess } from '../../api/types';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { roleLabel } from './UsersPage';

// 사용자 > 유효 권한 조회: what one user can reach, and where each grant comes from.
// Grants add up, so taking access away means finding every source - this screen lists them.
export function AccessPage({ username }: { username?: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const users = useLoad(adminApi.allUsers);

  return (
    <>
      <div className="toolbar">
        <select value={username ?? ''} aria-label={t('access.pick')}
          onChange={(e) => navigate(e.target.value ? `/admin/users/access/${encodeURIComponent(e.target.value)}` : '/admin/users/access')}>
          <option value="">{t('access.pick')}</option>
          {users.state === 'ok' && users.data.map((u) => (
            <option key={u.username} value={u.username}>
              {u.display_name !== u.username ? `${u.display_name} (${u.username})` : u.username}
            </option>
          ))}
        </select>
      </div>
      {username ? <AccessDetail key={username} username={username} /> : (
        <section className="panel access-pick">
          <p className="muted">{t('access.hint')}</p>
          {users.state === 'ok' && (
            <div className="access-users">
              {users.data.map((u) => (
                <Link key={u.username} to={`/admin/users/access/${encodeURIComponent(u.username)}`} className="access-user">
                  <span className="avatar" aria-hidden="true">{(u.display_name || u.username).slice(0, 2).toUpperCase()}</span>
                  <span className="access-user-text">
                    <span className="strong">{u.display_name || u.username}</span>
                    <span className="muted small">{u.username} · {roleLabel(t, u.role)}{u.enabled === false ? ` · ${t('users.disabled')}` : ''}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function AccessDetail({ username }: { username: string }) {
  const { t, lang } = useI18n();
  const access = useLoad(useCallback(() => adminApi.userAccess(username), [username]), [username]);
  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <LoadState value={access} retry={access.reload}>
      {(a: UserAccess) => (
        <div className="access">
          <section className="panel">
            <div className="panel-head">
              <span className="avatar" aria-hidden="true">{a.user.display_name.slice(0, 2).toUpperCase()}</span>
              <div>
                <div className="strong">{a.user.display_name} <span className="muted">({a.user.username})</span></div>
                <div className="muted small">
                  {roleLabel(t, a.user.role)} · {a.user.auth_source.toUpperCase()} · {a.user.tenant_id}
                  {!a.user.enabled && <> · <span className="chip chip-off">{t('users.disabled')}</span></>}
                </div>
              </div>
            </div>
            <div className={`alert small ${a.user.portal ? 'info' : ''}`}>
              {t('access.portal')}: {a.user.portal ? t('access.portalYes') : t('access.portalNo')}
            </div>
          </section>

          <section className="panel">
            <h2 className="section-title">{t('access.desktops')}</h2>
            {a.desktops.length === 0 ? <p className="muted">{t('access.noDesktops')}</p> : (
              <ul className="plain-list">
                {a.desktops.map((d) => (
                  <li key={d.id}>
                    <span className="strong">{d.name}</span>
                    <span className="muted small"> · {d.vmid} · </span>
                    <Link to={`/admin/pools/list/${d.pool_id}`}>{d.pool}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2 className="section-title">{t('access.acl')}</h2>
            <p className="muted small">{t('access.aclHint')}</p>
            {a.vm_acl_unavailable ? <div className="alert error small">{t('access.aclUnavailable')}</div>
              : a.vm_acl.length === 0 ? <p className="muted">{t('access.noAcl')}</p> : (
                <table className="table">
                  <thead>
                    <tr><th className="num">VMID</th><th>{t('desk.name')}</th><th>{t('access.source')}</th><th>{t('access.perms')}</th></tr>
                  </thead>
                  <tbody>
                    {a.vm_acl.map((g) => (
                      <tr key={`${g.cluster_id}/${g.vmid}`}>
                        <td className="num">{g.vmid}</td>
                        <td>{g.desktop ?? <span className="muted">-</span>}</td>
                        <td><span className={`chip ${g.source === 'direct' ? 'chip-warn' : 'chip-base'}`}>{t(`access.src.${g.source}` as MessageKey)}</span></td>
                        <td className="small">{g.inherit_role ? t('access.inherit') : g.permissions.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </section>

          <section className="panel">
            <h2 className="section-title">{t('access.recent')}</h2>
            {a.sessions.length === 0 ? <p className="muted">{t('sessions.empty')}</p> : (
              <ul className="plain-list">
                {a.sessions.map((s) => (
                  <li key={s.id}>
                    {fmt(s.started_at)} · <span className="strong">{s.desktop || s.desktop_id}</span>
                    <span className="muted small"> · {s.protocol.toUpperCase()} · {s.client_ip}</span>
                    {!s.ended_at && <span className="badge state-in_use"> {t('sessions.open')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </LoadState>
  );
}
