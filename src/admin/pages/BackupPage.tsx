import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { AdminDesktop, BackupStorage, Pool } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { bytes, ClusterFrame, Meter, useCluster } from './ClusterPages';

// 운영 > 백업 (PBS): where backups go, PBS servers, scheduled pool backups and each
// desktop's backups (back up now, restore into the same VM, delete) - the engine's own
// Proxmox backup features (vzdump, PBS), reached through /api/vlab/admin/*.

type Notice = { kind: 'info' | 'error'; text: string };

export function BackupPage() {
  const { current } = useCluster();
  const cid = current?.id;
  const never = <T,>() => new Promise<T>(() => {});
  const storages = useLoad(useCallback(() => (cid ? adminApi.backupStorages(cid) : never<BackupStorage[]>()), [cid]), [cid]);
  const jobs = useLoad(useCallback(() => (cid ? adminApi.backupJobs(cid) : never<never[]>()), [cid]), [cid]);
  const pbs = useLoad(adminApi.pbsServers);
  const pools = useLoad(adminApi.pools);
  const desktops = useLoad(adminApi.desktops);
  return (
    <ClusterFrame reload={() => { storages.reload(); jobs.reload(); pbs.reload(); }}>
      {(c) => (
        <>
          <Storages storages={storages} pbs={pbs} />
          <Jobs jobs={jobs} storages={storages.state === 'ok' ? storages.data : []}
            pools={pools.state === 'ok' ? pools.data.filter((p) => p.cluster_id === c.id) : []}
            desktops={desktops.state === 'ok' ? desktops.data : []} clusterId={c.id} />
          <DesktopBackups storages={storages.state === 'ok' ? storages.data : []}
            desktops={desktops.state === 'ok' ? desktops.data.filter((d) => d.cluster_id === c.id) : []} />
        </>
      )}
    </ClusterFrame>
  );
}

function Storages({ storages, pbs }: { storages: ReturnType<typeof useLoad<BackupStorage[]>>; pbs: ReturnType<typeof useLoad<import('../../api/types').PbsServer[]>> }) {
  const { t } = useI18n();
  return (
    <div className="dash-grid bk-top">
      <section className="card">
        <h2 className="card-title">{t('bk.storages')}</h2>
        <LoadState value={storages} retry={storages.reload}>
          {(list) => list.length === 0 ? <p className="muted small">{t('bk.noStorages')}</p> : (
            <div className="meters">
              {list.map((s) => {
                const pct = s.total ? (s.used / s.total) * 100 : 0;
                return (
                  <div key={s.storage} className="meter-row meter-row-1">
                    <span>
                      <span className="strong">{s.storage}</span>{' '}
                      {s.pbs ? <span className="chip chip-accent">PBS</span> : <span className="chip">{s.type}</span>}
                      <br /><span className="muted small">{s.total ? `${bytes(s.used)} / ${bytes(s.total)}` : s.status}</span>
                    </span>
                    {s.total ? <Meter value={pct} label={`${Math.round(pct)}%`} /> : <span />}
                  </div>
                );
              })}
            </div>
          )}
        </LoadState>
      </section>
      <section className="card">
        <h2 className="card-title">{t('bk.pbsServers')}</h2>
        <LoadState value={pbs} retry={pbs.reload}>
          {(list) => list.length === 0 ? <p className="muted small">{t('bk.noPbs')}</p> : (
            <ul className="health">
              {list.map((s) => (
                <li key={s.id}>
                  <span className={`hdot ${s.connected ? 'ok' : 'warn'}`} aria-hidden="true" />
                  <span className="health-label">{s.name}</span>
                  <span className="muted small">{s.host}{s.port ? `:${s.port}` : ''}</span>
                  <span className={`health-val${s.connected ? '' : ' warn'}`}>{t(s.connected ? 'bk.connected' : 'bk.offline')}</span>
                </li>
              ))}
            </ul>
          )}
        </LoadState>
      </section>
    </div>
  );
}

const SCHEDULES: { key: MessageKey; value: string }[] = [
  { key: 'bk.daily', value: '02:00' }, { key: 'bk.weekly', value: 'sun 02:00' }, { key: 'bk.workdays', value: 'mon..fri 22:00' },
];

function Jobs({ jobs, storages, pools, desktops, clusterId }: {
  jobs: ReturnType<typeof useLoad<import('../../api/types').BackupJob[]>>; storages: BackupStorage[]; pools: Pool[];
  desktops: AdminDesktop[]; clusterId: string;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  async function remove(id: string, name: string) {
    if (!confirm(t('bk.deleteJob').replace('{name}', name))) return;
    try { await adminApi.deleteBackupJob(clusterId, id); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    jobs.reload();
  }
  return (
    <section className="panel bk-section">
      <div className="panel-head">
        <h2 className="section-title">{t('bk.jobs')}</h2>
        <div className="panel-actions">
          <button type="button" className="btn primary" disabled={!pools.length || !storages.length} onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />{t('bk.newJob')}</button>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`}>{notice.text}</div>}
      <LoadState value={jobs} retry={jobs.reload}>
        {(list) => list.length === 0 ? <p className="muted small">{t('bk.noJobs')}</p> : (
          <div className="table-scroll">
            <table className="table compact-head">
              <thead><tr><th>{t('bk.pool')}</th><th>{t('bk.schedule')}</th><th>{t('bk.storage')}</th><th>VMID</th><th>{t('bk.keep')}</th><th /></tr></thead>
              <tbody>
                {list.map((j) => (
                  <tr key={j.id} className={j.enabled === 0 || j.enabled === false ? 'row-off' : ''}>
                    <td>{j.vlab_pool ? <span className="strong">{j.vlab_pool}</span> : <span className="muted small">{t('bk.otherJob')}</span>}
                      <br /><code className="code">{j.id}</code></td>
                    <td className="nowrap">{j.schedule}</td>
                    <td>{j.storage}</td>
                    <td className="small">{j.vmid || '-'}</td>
                    <td className="small">{(j['prune-backups'] || '').replace('keep-last=', '') || '-'}</td>
                    <td className="actions">{j.vlab_pool_id && <button type="button" className="btn-ghost danger" onClick={() => remove(j.id, j.vlab_pool || j.id)}>{t('bk.delete')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </LoadState>
      {adding && <JobDialog pools={pools} storages={storages} desktops={desktops} onClose={() => setAdding(false)}
        onDone={() => { setAdding(false); jobs.reload(); }} />}
    </section>
  );
}

function JobDialog({ pools, storages, desktops, onClose, onDone }: {
  pools: Pool[]; storages: BackupStorage[]; desktops: AdminDesktop[]; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [poolId, setPoolId] = useState(pools[0]?.id ?? '');
  const [storage, setStorage] = useState(storages[0]?.storage ?? '');
  const [preset, setPreset] = useState('02:00');
  const [custom, setCustom] = useState('');
  const [keep, setKeep] = useState(7);
  const [mode, setMode] = useState('snapshot');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pool = pools.find((p) => p.id === poolId);
  const vmids = desktops.filter((d) => d.pool_id === poolId).map((d) => d.vmid);

  async function submit() {
    if (!pool) return;
    setBusy(true); setError(null);
    try {
      await adminApi.createPoolBackupJob(pool.id, {
        vmid: vmids.join(','), storage, schedule: preset === 'custom' ? custom.trim() : preset, mode,
        'prune-backups': `keep-last=${keep}`, enabled: 1, comment: `vlab-pool:${pool.id} ${pool.name}`,
      });
      onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open title={t('bk.newJob')} onClose={onClose} onSubmit={submit} submitLabel={t('common.save')}
      busy={busy || !vmids.length || !storage || (preset === 'custom' && !custom.trim())} error={error}>
      <div className="form-row form-row-even">
        <label><span>{t('bk.pool')}</span>
          <select value={poolId} onChange={(e) => setPoolId(e.target.value)}>{pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <small className="muted">{t('bk.desktops').replace('{n}', String(vmids.length))}</small></label>
        <label><span>{t('bk.storage')}</span>
          <select value={storage} onChange={(e) => setStorage(e.target.value)}>
            {storages.map((s) => <option key={s.storage} value={s.storage}>{s.storage}{s.pbs ? ' (PBS)' : ''}</option>)}
          </select></label>
      </div>
      <label><span>{t('bk.schedule')}</span>
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          {SCHEDULES.map((s) => <option key={s.value} value={s.value}>{t(s.key)}</option>)}
          <option value="custom">{t('bk.custom')}</option>
        </select></label>
      {preset === 'custom' && <input value={custom} placeholder="sat 03:30" aria-label={t('bk.custom')} onChange={(e) => setCustom(e.target.value)} />}
      <div className="form-row form-row-even">
        <label><span>{t('bk.mode')}</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {['snapshot', 'suspend', 'stop'].map((m) => <option key={m} value={m}>{t(`bk.mode.${m}` as MessageKey)}</option>)}
          </select></label>
        <label><span>{t('bk.keep')}</span>
          <input type="number" min={1} max={365} value={keep} onChange={(e) => setKeep(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} /></label>
      </div>
    </Dialog>
  );
}

function DesktopBackups({ storages, desktops }: { storages: BackupStorage[]; desktops: AdminDesktop[] }) {
  const { t, lang } = useI18n();
  const [deskId, setDeskId] = useState('');
  const desk = desktops.find((d) => d.id === deskId) ?? desktops[0];
  useEffect(() => { if (desk && desk.id !== deskId) setDeskId(desk.id); }, [desk, deskId]);
  const list = useLoad(useCallback(() => (desk ? adminApi.desktopBackups(desk.id) : Promise.resolve([])), [desk?.id]), [desk?.id]);
  const [storage, setStorage] = useState('');
  useEffect(() => { if (!storage && storages[0]) setStorage(storages[0].storage); }, [storages, storage]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const when = (s?: number) => (s ? new Date(s * 1000).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true); setNotice(null);
    try { await fn(); setNotice({ kind: 'info', text: ok }); }
    catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    finally { setBusy(false); list.reload(); }
  }

  async function restore(volid: string, ctime?: number) {
    if (!desk || !confirm(t('bk.restoreConfirm').replace('{name}', desk.name).replace('{when}', when(ctime)))) return;
    setBusy(true); setNotice(null);
    try {
      await adminApi.restoreBackup(desk.id, volid);
      setNotice({ kind: 'info', text: t('bk.restored') });
    } catch (e) {
      const code = (e as { body?: { code?: string } }).body?.code;
      if (code === 'IN_USE' && confirm(t('bk.inUse'))) {
        try { await adminApi.restoreBackup(desk.id, volid, true); setNotice({ kind: 'info', text: t('bk.restored') }); }
        catch (e2) { setNotice({ kind: 'error', text: (e2 as Error).message }); }
      } else if (code !== 'IN_USE') {
        setNotice({ kind: 'error', text: (e as Error).message });
      }
    } finally { setBusy(false); }
  }

  return (
    <section className="panel bk-section">
      <div className="panel-head">
        <h2 className="section-title">{t('bk.desktop')}</h2>
      </div>
      {desktops.length === 0 ? <p className="muted small">{t('desk.allEmpty')}</p> : (
        <>
          <div className="toolbar">
            <label className="check-inline"><span>{t('bk.pickDesktop')}</span>
              <select value={desk?.id ?? ''} onChange={(e) => setDeskId(e.target.value)}>
                {desktops.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.pool}</option>)}
              </select></label>
            <label className="check-inline"><span>{t('bk.storage')}</span>
              <select value={storage} onChange={(e) => setStorage(e.target.value)}>
                {storages.map((s) => <option key={s.storage} value={s.storage}>{s.storage}{s.pbs ? ' (PBS)' : ''}</option>)}
              </select></label>
            <button type="button" className="btn primary" disabled={busy || !desk || !storage}
              onClick={() => desk && run(() => adminApi.backupNow(desk.id, storage, 'snapshot'), t('bk.started'))}>{t('bk.now')}</button>
          </div>
          {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
          <LoadState value={list} retry={list.reload}>
            {(rows) => rows.length === 0 ? <p className="muted small">{t('bk.noBackups')}</p> : (
              <div className="table-scroll">
                <table className="table compact-head">
                  <thead><tr><th>{t('bk.when')}</th><th>{t('bk.storage')}</th><th className="num">{t('bk.size')}</th><th>{t('bk.notes')}</th><th /></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.volid}>
                        <td className="nowrap">{when(r.ctime)}</td>
                        <td><code className="code">{r.storage || r.volid.split(':')[0]}</code></td>
                        <td className="num">{r.size ? bytes(r.size) : '-'}</td>
                        <td className="small">{r.notes || ''}</td>
                        <td className="actions">
                          <button type="button" className="btn-ghost" disabled={busy} onClick={() => restore(r.volid, r.ctime)}>{t('bk.restore')}</button>
                          <button type="button" className="btn-ghost danger" disabled={busy}
                            onClick={() => { if (desk && confirm(t('bk.deleteConfirm'))) run(() => adminApi.deleteBackup(desk.id, r.volid), t('bk.delete')); }}>{t('bk.delete')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </LoadState>
        </>
      )}
      <p className="muted small">{t('bk.note')}</p>
    </section>
  );
}
