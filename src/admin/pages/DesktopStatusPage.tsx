import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import type { DesktopState } from '../../api/types';
import { LoadState } from '../../components/LoadState';
import { StateBadge } from '../../components/StateBadge';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { WorkPanel } from './WorkPanel';
import { UseChip, useLx } from '../../components/WorkParts';

const STATES: DesktopState[] = ['ready', 'in_use', 'stopped', 'provisioning', 'error'];

// 데스크톱 풀 > 데스크톱 상태: every desktop of every pool, filter by pool / state / text.
export function DesktopStatusPage() {
  const { t } = useI18n();
  const desktops = useLoad(adminApi.desktops);
  const { L } = useLx();
  const [pool, setPool] = useState('');
  const [state, setState] = useState('');
  const [q, setQ] = useState('');

  const pools = useMemo(() => {
    if (desktops.state !== 'ok') return [];
    const m = new Map<string, string>();
    desktops.data.forEach((d) => d.pool_id && m.set(d.pool_id, d.pool));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [desktops]);

  return (
    <>
      <div className="toolbar">
        <select value={pool} onChange={(e) => setPool(e.target.value)} aria-label={t('desk.pool')}>
          <option value="">{t('desk.pool')}: {t('common.all')}</option>
          {pools.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={t('desk.state')}>
          <option value="">{t('desk.state')}: {t('common.all')}</option>
          {STATES.map((s) => <option key={s} value={s}>{t(`portal.state.${s}` as MessageKey)}</option>)}
        </select>
        <input type="search" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn" onClick={desktops.reload}>{t('common.refresh')}</button>
      </div>

      <WorkPanel onChanged={desktops.reload} />

      <LoadState value={desktops} retry={desktops.reload}>
        {(list) => {
          const needle = q.trim().toLowerCase();
          const rows = list.filter((d) =>
            (!pool || d.pool_id === pool) && (!state || d.state === state) &&
            (!needle || [d.name, d.assigned_user ?? '', String(d.vmid), d.node].some((s) => s.toLowerCase().includes(needle))));
          const counts = STATES.map((s) => [s, list.filter((d) => d.state === s).length] as const).filter(([, n]) => n > 0);
          return (
            <>
              <div className="summary">
                <span className="strong">{list.length} {t('desk.count')}</span>
                {counts.map(([s, n]) => <span key={s}><StateBadge state={s} /> {n}</span>)}
              </div>
              {rows.length === 0 ? <div className="empty"><p>{t('desk.allEmpty')}</p></div> : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('desk.name')}</th><th>{t('desk.pool')}</th><th className="num">VMID</th>
                      <th>{t('desk.node')}</th><th>{t('desk.state')}</th><th>{t('desk.user')}</th><th>{L('GPU/NPU · 작업', 'GPU/NPU · work')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.id}>
                        <td className="strong">{d.name}</td>
                        <td>{d.pool_id ? <Link to={`/admin/pools/list/${d.pool_id}`}>{d.pool}</Link> : d.pool}</td>
                        <td className="num">{d.vmid}</td>
                        <td>{d.node}</td>
                        <td><StateBadge state={d.state} /></td>
                        <td>{d.assigned_user ?? <span className="muted">{t('desk.unassigned')}</span>}</td>
                        <td className="nowrap">{d.work?.use && <UseChip use={d.work.use} />}
                          {d.work?.hold && <span className="chip chip-on" title={d.work.hold.note}>{L('작업 중', 'working')}</span>}
                          {(d.work?.deferrals.length ?? 0) > 0 && <span className="chip chip-warn">{L('정리 미룸', 'clean-up waits')}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          );
        }}
      </LoadState>
    </>
  );
}
