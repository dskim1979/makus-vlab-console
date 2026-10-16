import { Link } from 'react-router-dom';
import type { RightSizing, RightSizingRow } from '../api/types';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/messages';

// Which desktops need more and which can give some back: the engine's right-sizing
// (mean / p95 CPU, mean / max memory per VM over 7 or 30 days) with the desktop behind it.

type Action = 'grow' | 'reclaim' | 'idle';
const ORDER: Action[] = ['grow', 'reclaim', 'idle'];

export function RightSizingSummary({ r }: { r: RightSizing }) {
  const { t } = useI18n();
  return (
    <div className="rs-counts">
      {ORDER.map((a) => (
        <div key={a} className={`rs-count rs-${a}`}>
          <span className="rs-n">{r.counts[a]}</span>
          <span className="rs-l">{t(`rs.${a}` as MessageKey)}</span>
        </div>
      ))}
      <div className="rs-count rs-ok"><span className="rs-n">{r.counts.ok}</span><span className="rs-l">{t('rs.ok')}</span></div>
    </div>
  );
}

export function RightSizingTable({ r, limit, links = true, compact = false }: { r: RightSizing; limit?: number; links?: boolean; compact?: boolean }) {
  const { t } = useI18n();
  const rows = [...r.recommendations].sort((a, b) => rank(a) - rank(b));
  const shown = limit ? rows.slice(0, limit) : rows;
  if (!rows.length) {
    return <p className="muted small">{r.snapshots < r.min_samples ? t('rs.notEnough') : t('rs.none')}</p>;
  }
  if (compact) {
    // the dashboard: one line per VM - who, the proposal, and the change it means
    return (
      <div className="rs-lines">
        {shown.map((x) => (
          <div key={x.vmid} className="rs-line" title={`CPU ${t('rs.cpuUse').replace('{avg}', String(x.cpu_avg)).replace('{p95}', String(x.cpu_p95))} · ${t('inf.mem')} ${t('rs.memUse').replace('{avg}', String(x.mem_avg)).replace('{max}', String(x.mem_max))}`}>
            <span className="rs-who"><span className="strong">{x.desktop ?? x.name ?? x.vmid}</span>
              <span className="muted small">{x.pool ? `${x.pool}${x.assigned_to ? ` · ${x.assigned_to}` : ''}` : t('rs.notDesktop')}</span></span>
            <span className="rs-chips">{x.actions.filter((a): a is Action => ORDER.includes(a as Action)).map((a) => <span key={a} className={`rs-chip rs-${a}`}>{t(`rs.${a}` as MessageKey)}</span>)}</span>
            <span className="rs-change small">{changeText(x, t)}</span>
          </div>
        ))}
        {limit && rows.length > limit && links && (
          <Link to="/admin/ops/report" className="small">{t('rs.more').replace('{n}', String(rows.length - limit))}</Link>
        )}
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <table className="table compact-head rs-table">
        <thead><tr><th>{t('rs.vm')}</th><th>{t('rs.suggest')}</th><th>CPU</th><th>{t('inf.mem')}</th></tr></thead>
        <tbody>
          {shown.map((x) => (
            <tr key={x.vmid}>
              <td>
                <span className="strong">{x.desktop ?? x.name ?? x.vmid}</span>
                <span className="muted small"> · {x.vmid}</span><br />
                <span className="muted small">{x.pool ? `${x.pool}${x.assigned_to ? ` · ${x.assigned_to}` : ''}` : t('rs.notDesktop')}</span>
              </td>
              <td>{x.actions.filter((a): a is Action => ORDER.includes(a as Action)).map((a) => <span key={a} className={`rs-chip rs-${a}`}>{t(`rs.${a}` as MessageKey)}</span>)}</td>
              <td className="small">{cpuText(x, t)}</td>
              <td className="small">{memText(x, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {limit && rows.length > limit && links && (
        <Link to="/admin/ops/report" className="small">{t('rs.more').replace('{n}', String(rows.length - limit))}</Link>
      )}
    </div>
  );
}

function changeText(x: RightSizingRow, t: (k: MessageKey) => string) {
  const cpu = x.flags.find((g) => g.kind.endsWith('_cpu') && g.current != null);
  const mem = x.flags.find((g) => g.kind.endsWith('_mem') && g.current_gb != null);
  const parts = [
    cpu && <b key="c" className={cpu.kind.startsWith('under') ? 'rs-up' : 'rs-down'}>{t('rs.cores').replace('{a}', String(cpu.current)).replace('{b}', String(cpu.recommended))}</b>,
    mem && <b key="m" className={mem.kind.startsWith('under') ? 'rs-up' : 'rs-down'}>{t('rs.gb').replace('{a}', String(mem.current_gb)).replace('{b}', String(mem.recommended_gb))}</b>,
  ].filter(Boolean);
  return parts.length ? parts : <span className="muted">{t('rs.cpuUse').replace('{avg}', String(x.cpu_avg)).replace('{p95}', String(x.cpu_p95))}</span>;
}

function rank(x: RightSizingRow) {
  return x.actions.includes('grow') ? 0 : x.actions.includes('idle') ? 2 : 1;
}

function cpuText(x: RightSizingRow, t: (k: MessageKey) => string) {
  const f = x.flags.find((g) => g.kind.endsWith('_cpu'));
  const use = t('rs.cpuUse').replace('{avg}', String(x.cpu_avg)).replace('{p95}', String(x.cpu_p95));
  if (!f || f.current == null) return use;
  return <>{use}<br /><b className={f.kind.startsWith('under') ? 'rs-up' : 'rs-down'}>{t('rs.cores').replace('{a}', String(f.current)).replace('{b}', String(f.recommended))}</b></>;
}

function memText(x: RightSizingRow, t: (k: MessageKey) => string) {
  const f = x.flags.find((g) => g.kind.endsWith('_mem'));
  const use = t('rs.memUse').replace('{avg}', String(x.mem_avg)).replace('{max}', String(x.mem_max));
  if (!f || f.current_gb == null) return use;
  return <>{use}<br /><b className={f.kind.startsWith('under') ? 'rs-up' : 'rs-down'}>{t('rs.gb').replace('{a}', String(f.current_gb)).replace('{b}', String(f.recommended_gb))}</b></>;
}
