import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { AdminLease } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

type Notice = { kind: 'info' | 'error'; text: string };
const DAY = 864e5;

// <input type=datetime-local> value for a Date, in local time
function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function defaultEnd(days = 7) {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(18, 0, 0, 0);
  return localInput(d);
}

// 가속 자원 > 카드 대여 현황: GPU and FPGA cards lent to users' desktops for a period.
export function LeasesPage() {
  const { t, lang } = useI18n();
  const [all, setAll] = useState(false);
  const leases = useLoad(useCallback(() => adminApi.leases(all), [all]), [all]);
  const [lending, setLending] = useState(false);
  const [extending, setExtending] = useState<AdminLease | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
  const left = (iso: string | null) => {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return <span className="chip chip-warn">{t('ln.overdue')}</span>;
    const txt = ms >= DAY ? t('ln.days').replace('{n}', String(Math.floor(ms / DAY))) : t('ln.hours').replace('{n}', String(Math.max(1, Math.floor(ms / 36e5))));
    return <span className={`chip ${ms < DAY ? 'chip-warn' : 'chip-on'}`}>{t('ln.left').replace('{n}', txt)}</span>;
  };

  async function giveBack(l: AdminLease) {
    if (!confirm(t('ln.returnConfirm').replace('{name}', l.resource_name))) return;
    try { await adminApi.returnLease(l.id); setNotice(null); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    leases.reload();
  }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => setLending(true)}><Icon name="fpga" size={16} />{t('ln.lend')}</button>
        <label className="check-inline"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>{t('ln.showReturned')}</span></label>
        <button type="button" className="btn" onClick={leases.reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}

      <LoadState value={leases} retry={leases.reload}>
        {(list) => {
          const active = list.filter((l) => l.state === 'active');
          const soon = active.filter((l) => l.ends_at && new Date(l.ends_at).getTime() - Date.now() < DAY);
          return (
            <>
              <div className="stats">
                <div className="stat static tone-green"><span className="stat-icon"><Icon name="spark" size={18} /></span>
                  <span className="stat-label">{t('ln.active')}</span><span className="stat-value">{active.length}</span></div>
                <div className="stat static tone-orange"><span className="stat-icon"><Icon name="info" size={18} /></span>
                  <span className="stat-label">{t('ln.dueSoon')}</span><span className="stat-value">{soon.length}</span></div>
              </div>
              {list.length === 0 ? <div className="empty"><p>{t('ln.empty')}</p></div> : (
                <div className="table-scroll">
                  <table className="table compact-head">
                    <thead><tr><th>{t('ln.card')}</th><th>{t('ln.user')}</th><th>{t('ln.desktop')}</th><th>{t('ln.from')}</th>
                      <th>{t('ln.until')}</th><th /></tr></thead>
                    <tbody>
                      {list.map((l) => (
                        <tr key={l.id} className={l.state !== 'active' ? 'row-off' : ''}>
                          <td className="nowrap">
                            <span className={`lease-kind tone-${l.resource_type === 'gpu' ? 'green' : 'pink'}`}>
                              <Icon name={l.resource_type === 'gpu' ? 'gpu' : l.resource_type === 'npu' ? 'npu' : 'fpga'} size={16} />
                            </span>
                            <span className="strong">{l.resource_name}</span><br />
                            <code className="code">{l.resource_id}</code>
                          </td>
                          <td className="strong">{l.username}</td>
                          <td className="nowrap">{l.desktop ?? `VMID ${l.vmid}`}{' '}
                            {l.vm_running && <span className="status st-ready small"> <span className="dot" /></span>}</td>
                          <td className="nowrap small">{fmt(l.starts_at)}</td>
                          <td className="nowrap">{fmt(l.ends_at)} {l.state === 'active' ? left(l.ends_at)
                            : <span className="chip chip-free">{t('ln.returned')} {fmt(l.returned_at)}</span>}</td>
                          <td className="actions">
                            {l.state === 'active' && (
                              <>
                                <button type="button" className="btn-ghost" onClick={() => setExtending(l)}>{t('ln.extend')}</button>
                                <button type="button" className="btn-ghost danger" onClick={() => giveBack(l)}>{t('ln.return')}</button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="muted small">{t('ln.note')}</p>
              {lending && <LendDialog active={active} onClose={() => setLending(false)}
                onDone={(n) => { setLending(false); setNotice(n); leases.reload(); }} />}
              {extending && <ExtendDialog lease={extending} onClose={() => setExtending(null)}
                onDone={() => { setExtending(null); leases.reload(); }} />}
            </>
          );
        }}
      </LoadState>
    </>
  );
}

function LendDialog({ active, onClose, onDone }: { active: AdminLease[]; onClose: () => void; onDone: (n: Notice) => void }) {
  const { t } = useI18n();
  const desktops = useLoad(adminApi.desktops);
  const assigned = desktops.state === 'ok' ? desktops.data.filter((d) => d.assigned_user && !active.some((l) => l.desktop_id === d.id)) : [];
  const [deskId, setDeskId] = useState('');
  const desk = assigned.find((d) => d.id === deskId) ?? assigned[0];
  useEffect(() => { if (desk && desk.id !== deskId) setDeskId(desk.id); }, [desk, deskId]);
  const inv = useLoad(useCallback(() => (desk?.cluster_id ? adminApi.accelerators(desk.cluster_id)
    : new Promise<never>(() => {})), [desk?.cluster_id]), [desk?.cluster_id]);
  const [mapping, setMapping] = useState('');
  const [ends, setEnds] = useState(defaultEnd());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // whole-card mappings only (a vGPU mapping is shared through a pool policy)
  const options = inv.state === 'ok' ? inv.data.mappings.filter((m) => !m.mdev || m.devices.some((d) => d.id.startsWith('10ee'))).map((m) => ({
    ...m, free: Math.max(0, m.devices.length - active.filter((l) => l.resource_id === m.id && l.cluster_id === desk?.cluster_id).length),
  })) : [];
  useEffect(() => {
    if (options.length && !options.some((m) => m.id === mapping)) setMapping((options.find((m) => m.free > 0) ?? options[0]).id);
  }, [options, mapping]);

  async function submit() {
    if (!desk) return;
    setBusy(true); setError(null);
    try {
      const r = await adminApi.lend({ desktop_id: desk.id, mapping, ends_at: new Date(ends).toISOString(), name: name.trim() || undefined });
      onDone({ kind: 'info', text: t('ln.lent').replace('{name}', r.lease.resource_name) + (r.needs_restart ? ` ${t('ln.restart')}` : '') });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chosen = options.find((m) => m.id === mapping);
  return (
    <Dialog open title={t('ln.lend')} onClose={onClose} onSubmit={submit} submitLabel={t('ln.lend')}
      busy={busy || !desk || !chosen || chosen.free === 0} error={error}>
      <LoadState value={desktops} retry={desktops.reload}>
        {() => assigned.length === 0 ? <div className="alert small">{t('ln.noDesktop')}</div> : (
          <>
            <label>
              <span>{t('ln.pickDesktop')}</span>
              <select value={deskId} onChange={(e) => setDeskId(e.target.value)}>
                {assigned.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.assigned_user} · {d.pool}</option>)}
              </select>
            </label>
            <LoadState value={inv} retry={inv.reload}>
              {() => (
                <div className="pick-list" role="radiogroup" aria-label={t('ln.pickMapping')}>
                  {options.map((m) => (
                    <label key={m.id} className={`pick${mapping === m.id ? ' on' : ''}${m.free === 0 ? ' off' : ''}`}>
                      <input type="radio" name="mapping" checked={mapping === m.id} disabled={m.free === 0} aria-label={m.id}
                        onChange={() => setMapping(m.id)} />
                      <span className="strong">{m.description || m.id}</span>
                      <span className={`chip ${m.free ? 'chip-accent' : 'chip-free'}`}>{t('ln.free').replace('{n}', String(m.free))}</span>
                      <span className="muted small"><code className="code">{m.id}</code> · {m.devices.map((d) => d.node).join(', ')}</span>
                    </label>
                  ))}
                </div>
              )}
            </LoadState>
            <div className="form-row form-row-even">
              <label><span>{t('ln.endsAt')}</span>
                <input type="datetime-local" required value={ends} min={localInput(new Date())} onChange={(e) => setEnds(e.target.value)} /></label>
              <label><span>{t('ln.name')}</span>
                <input value={name} maxLength={80} placeholder={chosen?.description} onChange={(e) => setName(e.target.value)} /></label>
            </div>
          </>
        )}
      </LoadState>
    </Dialog>
  );
}

function ExtendDialog({ lease, onClose, onDone }: { lease: AdminLease; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const base = lease.ends_at ? new Date(lease.ends_at) : new Date();
  const [ends, setEnds] = useState(localInput(new Date(base.getTime() + 7 * DAY)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await adminApi.extendLease(lease.id, new Date(ends).toISOString()); onDone(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open title={`${t('ln.extend')} · ${lease.resource_name}`} onClose={onClose} onSubmit={submit} submitLabel={t('ln.extend')}
      busy={busy} error={error}>
      <label><span>{t('ln.endsAt')}</span>
        <input type="datetime-local" required value={ends} min={localInput(base)} onChange={(e) => setEnds(e.target.value)} /></label>
    </Dialog>
  );
}
