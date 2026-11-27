import { useState } from 'react';
import { adminApi } from '../../api/admin';
import type { Pool, PoolUpdate } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';

// 데스크톱 풀 > 풀 > [풀 편집]: name, description, on/off and the connection settings.
// The cluster and the type stay (the engine refuses them): a new pool is made for that.
export function PoolEditDialog({ pool, onClose, onSaved }: { pool: Pool; onClose: () => void; onSaved: (p: Pool) => void }) {
  const { t } = useI18n();
  const s = pool.settings ?? {};
  const [name, setName] = useState(pool.name);
  const [description, setDescription] = useState(pool.description ?? '');
  const [enabled, setEnabled] = useState(pool.enabled);
  const [maxSessions, setMaxSessions] = useState(String(s.shared?.max_sessions ?? 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shared = pool.type === 'shared';

  async function submit() {
    const body: PoolUpdate = { name: name.trim(), description: description.trim(), enabled,
      settings: shared ? { max_sessions: Number(maxSessions) } : {} };
    setBusy(true); setError(null);
    try {
      const r = await adminApi.updatePool(pool.id, body);
      onSaved(r.pool);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={t('pool.edit')} onClose={onClose} onSubmit={submit} submitLabel={t('common.save')} busy={busy} error={error}>
      <label>
        <span>{t('pool.name')}</span>
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        <span>{t('pool.description')}</span>
        <textarea rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="form-row form-row-even">
        <label>
          <span>{t('pool.type')}</span>
          <input value={t(`pooltype.${pool.type}` as MessageKey)} disabled />
        </label>
        <label>
          <span>{t('pool.cluster')}</span>
          <input value={pool.cluster_id} disabled />
        </label>
      </div>
      <small className="muted">{t('pool.fixed')}</small>
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>{t('pool.enabled')}</span>
      </label>
      <small className="muted">{t('pool.enabledHint')}</small>

      {shared && (
        <>
          <h3 className="dialog-sub">{t('pool.connection')}</h3>
          <label>
            <span>{t('pool.maxSessions')}</span>
            <input type="number" min={1} max={500} required value={maxSessions} onChange={(e) => setMaxSessions(e.target.value)} />
          </label>
        </>
      )}
    </Dialog>
  );
}
