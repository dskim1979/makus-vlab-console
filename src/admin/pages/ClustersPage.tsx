import { useState } from 'react';
import { adminApi } from '../../api/admin';
import type { Cluster } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// 클러스터 > 클러스터 연결: the Proxmox VE clusters the engine manages for vLAB.
export function ClustersPage() {
  const { t } = useI18n();
  const clusters = useLoad(adminApi.clusters);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function disconnect(c: Cluster) {
    if ((c.pools ?? 0) > 0) { alert(t('cluster.hasPools')); return; }
    if (!confirm(t('cluster.disconnectConfirm'))) return;
    try { await adminApi.disconnectCluster(c.id); } catch (e) { alert((e as Error).message); }
    clusters.reload();
  }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => setAdding(true)}>{t('cluster.add')}</button>
        <button type="button" className="btn" onClick={clusters.reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
      </div>
      {notice && <div className="alert info" role="status">{notice}</div>}

      <LoadState value={clusters} retry={clusters.reload}>
        {(list) => list.length === 0 ? <div className="empty"><p>{t('cluster.empty')}</p></div> : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('cluster.name')}</th><th>{t('cluster.host')}</th><th>{t('desk.state')}</th>
                <th className="num">{t('cluster.pools')}</th><th />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td className="strong">{c.name}</td>
                  <td className="muted">{c.host}</td>
                  <td>
                    {c.connected
                      ? <span className="status st-ready"><span className="dot" />{t('cluster.connected')}</span>
                      : <span className="status st-error" title={c.connection_error ?? ''}><span className="dot" />{t('cluster.offline')}</span>}
                    {!c.connected && c.connection_error && <div className="muted small">{c.connection_error}</div>}
                  </td>
                  <td className="num">{c.pools ?? 0}</td>
                  <td className="actions">
                    <button type="button" className="btn-ghost danger" onClick={() => disconnect(c)}>{t('cluster.disconnect')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LoadState>

      {adding && (
        <ConnectDialog onClose={() => setAdding(false)}
          onDone={(tokenCreated) => {
            setAdding(false);
            setNotice(tokenCreated ? `${t('cluster.added')} ${t('cluster.tokenCreated')}` : t('cluster.added'));
            clusters.reload();
          }} />
      )}
    </>
  );
}

function ConnectDialog({ onClose, onDone }: { onClose: () => void; onDone: (tokenCreated: boolean) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [user, setUser] = useState('root@pam');
  const [pass, setPass] = useState('');
  const [ssl, setSsl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await adminApi.connectCluster({ name: name.trim(), host: host.trim(), user: user.trim(), pass, ssl_verification: ssl });
      setPass('');
      onDone(!!r.api_token_created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={t('cluster.add')} onClose={onClose} onSubmit={submit} submitLabel={t('cluster.add')} busy={busy} error={error}>
      <label>
        <span>{t('cluster.name')}</span>
        <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        <span>{t('cluster.host')}</span>
        <input required value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.11" />
        <small className="muted">{t('cluster.hostHint')}</small>
      </label>
      <div className="form-row form-row-even">
        <label>
          <span>{t('cluster.user')}</span>
          <input required autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} />
        </label>
        <label>
          <span>{t('cluster.pass')}</span>
          <input required type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
      </div>
      <small className="muted">{t('cluster.passHint')}</small>
      <label className="check">
        <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} />
        <span>{t('cluster.ssl')}</span>
      </label>
    </Dialog>
  );
}
