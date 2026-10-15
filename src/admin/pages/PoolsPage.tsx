import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import type { Cluster, PoolType } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';

export const POOL_TYPES: PoolType[] = ['dedicated', 'reset', 'shared', 'classroom', 'buildfarm'];

// 데스크톱 풀 > 풀 관리: list, create, delete (docs/vlab-design.md 4-2).
export function PoolsPage() {
  const { t } = useI18n();
  const pools = useLoad(adminApi.pools);
  const clusters = useLoad(adminApi.clusters);
  const [creating, setCreating] = useState(false);

  const clusterName = (id: string) =>
    clusters.state === 'ok' ? clusters.data.find((c) => c.id === id)?.name ?? id : id;

  async function remove(id: string, desktops: number) {
    if (desktops > 0) { alert(t('pool.deleteHasDesktops')); return; }
    if (!confirm(t('pool.deleteConfirm'))) return;
    try { await adminApi.deletePool(id); } catch (e) { alert((e as Error).message); }
    pools.reload();
  }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>{t('pool.new')}</button>
        <button type="button" className="btn" onClick={pools.reload}>{t('common.refresh')}</button>
      </div>

      <LoadState value={pools} retry={pools.reload}>
        {(list) => list.length === 0 ? (
          <div className="empty"><p>{t('pool.empty')}</p></div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('pool.name')}</th><th>{t('pool.type')}</th><th>{t('pool.cluster')}</th>
                <th className="num">{t('pool.desktops')}</th><th className="num">{t('pool.assigned')}</th><th />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/admin/pools/list/${p.id}`} className="strong">{p.name}</Link>
                    {p.description && <div className="muted small">{p.description}</div>}
                  </td>
                  <td>{t(`pooltype.${p.type}` as MessageKey)}</td>
                  <td>{clusterName(p.cluster_id)}</td>
                  <td className="num">{p.desktops}</td>
                  <td className="num">{p.assigned}</td>
                  <td className="actions">
                    <button type="button" className="btn-ghost danger" onClick={() => remove(p.id, p.desktops)}>{t('common.delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LoadState>

      {creating && (
        <CreatePoolDialog
          clusters={clusters.state === 'ok' ? clusters.data : []}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); pools.reload(); }}
        />
      )}
    </>
  );
}

function CreatePoolDialog({ clusters, onClose, onCreated }: { clusters: Cluster[]; onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [type, setType] = useState<PoolType>('dedicated');
  const [clusterId, setClusterId] = useState(clusters[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await adminApi.createPool({ name: name.trim(), type, cluster_id: clusterId, description });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={t('pool.new')} onClose={onClose} onSubmit={submit} busy={busy || !clusterId} error={error}>
      {clusters.length === 0 && <div className="alert">{t('pool.noCluster')}</div>}
      <label>
        <span>{t('pool.name')}</span>
        <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <fieldset className="choices">
        <legend>{t('pool.type')}</legend>
        {POOL_TYPES.map((pt) => (
          <label key={pt} className={`choice${type === pt ? ' on' : ''}`}>
            <input type="radio" name="pooltype" aria-label={t(`pooltype.${pt}` as MessageKey)} checked={type === pt} onChange={() => setType(pt)} />
            <span>
              <strong>{t(`pooltype.${pt}` as MessageKey)}</strong>
              <small className="muted">{t(`pooltype.${pt}.hint` as MessageKey)}</small>
            </span>
          </label>
        ))}
        <small className="muted">{t('pool.typeLocked')}</small>
      </fieldset>
      <label>
        <span>{t('pool.cluster')}</span>
        <select required value={clusterId} onChange={(e) => setClusterId(e.target.value)}>
          {clusters.map((c) => <option key={c.id} value={c.id}>{c.name}{c.connected ? '' : ' (offline)'}</option>)}
        </select>
      </label>
      <label>
        <span>{t('pool.description')}</span>
        <input maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
    </Dialog>
  );
}
