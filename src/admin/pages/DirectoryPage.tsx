import { useEffect, useState, type FormEvent } from 'react';
import { adminApi } from '../../api/admin';
import type { Directory, DirectoryTest } from '../../api/types';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';

const ROLES = ['user', 'viewer', 'admin'];

// 사용자 > 도메인(AD/LDAP): sign-in against the school's or institute's directory.
// The engine already authenticates with AD/LDAP; this screen edits its settings.
export function DirectoryPage() {
  const dir = useLoad(adminApi.directory);
  return (
    <LoadState value={dir} retry={dir.reload}>
      {(d) => <DirectoryForm initial={d} onSaved={dir.reload} />}
    </LoadState>
  );
}

function DirectoryForm({ initial, onSaved }: { initial: Directory; onSaved: () => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<Directory>({ ...initial, ldap_bind_password: '' });
  const [testUser, setTestUser] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [test, setTest] = useState<DirectoryTest | null>(null);
  const pwStored = initial.ldap_bind_password === '********';

  useEffect(() => { setD({ ...initial, ldap_bind_password: '' }); }, [initial]);
  const set = <K extends keyof Directory>(k: K, v: Directory[K]) => setD((x) => ({ ...x, [k]: v }));

  // what is sent: an empty password field keeps the stored one (the engine reads the mask so)
  const body = (): Partial<Directory> => ({ ...d, ldap_bind_password: d.ldap_bind_password || (pwStored ? '********' : '') });

  function security(v: string) {
    setD((x) => ({ ...x, ldap_use_ssl: v === 'ssl', ldap_use_starttls: v === 'starttls',
      ldap_port: v === 'ssl' && x.ldap_port === 389 ? 636 : v !== 'ssl' && x.ldap_port === 636 ? 389 : x.ldap_port }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setNotice(null);
    try {
      await adminApi.saveDirectory(body());
      setNotice({ kind: 'info', text: t('dir.saved') });
      onSaved();
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true); setTest(null);
    try {
      setTest(await adminApi.testDirectory({ ...body(), ...(testUser.trim() ? { test_username: testUser.trim() } : {}) }));
    } catch (err) {
      setTest({ error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const sec = d.ldap_use_ssl ? 'ssl' : d.ldap_use_starttls ? 'starttls' : 'plain';
  const roleText = (r: string) => (ROLES.includes(r) ? t(`role.${r}` as MessageKey) : r);

  return (
    <form className="settings" onSubmit={save}>
      <label className="check toggle-row">
        <input type="checkbox" checked={d.ldap_enabled} onChange={(e) => set('ldap_enabled', e.target.checked)} />
        <span className="strong">{t('dir.enable')}</span>
      </label>

      <section className="panel form">
        <h2 className="section-title">{t('dir.connection')}</h2>
        <div className="form-row form-row-wide">
          <label><span>{t('dir.server')}</span>
            <input value={d.ldap_server} placeholder="dc1.lab.example" onChange={(e) => set('ldap_server', e.target.value)} /></label>
          <label><span>{t('dir.port')}</span>
            <input type="number" min={1} max={65535} value={d.ldap_port} onChange={(e) => set('ldap_port', Number(e.target.value) || 389)} /></label>
        </div>
        <div className="form-row form-row-even">
          <label><span>{t('dir.security')}</span>
            <select value={sec} onChange={(e) => security(e.target.value)}>
              <option value="plain">{t('dir.plain')}</option>
              <option value="ssl">{t('dir.ssl')}</option>
              <option value="starttls">{t('dir.starttls')}</option>
            </select></label>
          <label className="check check-bottom">
            <input type="checkbox" disabled={sec === 'plain'} checked={d.ldap_verify_tls} onChange={(e) => set('ldap_verify_tls', e.target.checked)} />
            <span>{t('dir.verifyTls')}</span></label>
        </div>
      </section>

      <section className="panel form">
        <h2 className="section-title">{t('dir.bind')}</h2>
        <label><span>{t('dir.bindDn')}</span>
          <input value={d.ldap_bind_dn} placeholder="CN=svc-vlab,OU=Service,DC=lab,DC=example" onChange={(e) => set('ldap_bind_dn', e.target.value)} /></label>
        <label><span>{t('dir.bindPw')}</span>
          <input type="password" autoComplete="new-password" value={d.ldap_bind_password} placeholder={pwStored ? '••••••••' : ''}
            onChange={(e) => set('ldap_bind_password', e.target.value)} />
          <small className="muted">{t('dir.bindPwHint')}</small></label>
      </section>

      <section className="panel form">
        <h2 className="section-title">{t('dir.search')}</h2>
        <label><span>{t('dir.baseDn')}</span>
          <input value={d.ldap_base_dn} placeholder="DC=lab,DC=example" onChange={(e) => set('ldap_base_dn', e.target.value)} /></label>
        <label><span>{t('dir.userFilter')}</span>
          <input value={d.ldap_user_filter} onChange={(e) => set('ldap_user_filter', e.target.value)} /></label>
        <span className="field-label">{t('dir.attrs')}</span>
        <div className="form-row form-row-three">
          <input aria-label="username attribute" value={d.ldap_username_attribute} onChange={(e) => set('ldap_username_attribute', e.target.value)} />
          <input aria-label="mail attribute" value={d.ldap_email_attribute} onChange={(e) => set('ldap_email_attribute', e.target.value)} />
          <input aria-label="display name attribute" value={d.ldap_display_name_attribute} onChange={(e) => set('ldap_display_name_attribute', e.target.value)} />
        </div>
      </section>

      <section className="panel form">
        <h2 className="section-title">{t('dir.groups')}</h2>
        <p className="muted small">{t('dir.groupsHint')}</p>
        {d.ldap_group_mappings.map((m, i) => (
          <div key={i} className="mapping">
            <input aria-label={t('dir.groupDn')} placeholder="CN=students,OU=Groups,DC=lab,DC=example" value={m.group_dn}
              onChange={(e) => set('ldap_group_mappings', d.ldap_group_mappings.map((x, j) => j === i ? { ...x, group_dn: e.target.value } : x))} />
            <select aria-label={t('users.role')} value={m.role}
              onChange={(e) => set('ldap_group_mappings', d.ldap_group_mappings.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}>
              {ROLES.map((r) => <option key={r} value={r}>{roleText(r)}</option>)}
            </select>
            <button type="button" className="btn-ghost danger"
              onClick={() => set('ldap_group_mappings', d.ldap_group_mappings.filter((_, j) => j !== i))}>{t('common.delete')}</button>
          </div>
        ))}
        <div><button type="button" className="btn" onClick={() => set('ldap_group_mappings', [...d.ldap_group_mappings, { group_dn: '', role: 'user' }])}>
          {t('dir.addMapping')}</button></div>
      </section>

      <section className="panel form">
        <h2 className="section-title">{t('dir.accounts')}</h2>
        <label className="check">
          <input type="checkbox" checked={d.ldap_auto_create_users} onChange={(e) => set('ldap_auto_create_users', e.target.checked)} />
          <span>{t('dir.autoCreate')}</span></label>
        <label><span>{t('dir.defaultRole')}</span>
          <select value={d.ldap_default_role} onChange={(e) => set('ldap_default_role', e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{roleText(r)}</option>)}
          </select></label>
        {d.ldap_default_role === 'viewer' && <div className="alert small">{t('dir.viewerWarn')}</div>}
      </section>

      <section className="panel form">
        <h2 className="section-title">{t('dir.test')}</h2>
        <div className="form-row form-row-wide">
          <label><span>{t('dir.testUser')}</span>
            <input value={testUser} onChange={(e) => setTestUser(e.target.value)} /></label>
          <div className="check-bottom"><button type="button" className="btn" disabled={busy} onClick={runTest}>{t('dir.test')}</button></div>
        </div>
        {test && (
          <div className="test-result">
            {(test.steps ?? []).map((s, i) => (
              <div key={i} className={`step st-${s.status === 'ok' ? 'ok' : 'bad'}`}>
                <span className="dot" /> <span className="strong">{s.step}</span>{s.detail && <span className="muted small"> · {s.detail}</span>}
              </div>
            ))}
            {test.error && <div className="alert error small">{test.error}</div>}
          </div>
        )}
      </section>

      {notice && <div className={`alert ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={busy}>{t('common.save')}</button>
      </div>
    </form>
  );
}
