import { Link } from 'react-router-dom';
import type { DesktopState, PoolType, Summary } from '../api/types';
import { Icon, type IconName } from '../components/Icon';
import { StateBadge } from '../components/StateBadge';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/messages';

const fill = (s: string, n: number) => s.replace('{n}', String(n));

// Headline numbers: a stat tile each (no chart - one number is the whole message).
export function StatTiles({ s }: { s: Summary }) {
  const { t } = useI18n();
  const tiles: { icon: IconName; label: string; value: number; sub: string; to: string }[] = [
    { icon: 'cluster', label: t('sum.clusters'), value: s.clusters.total, sub: fill(t('sum.connectedOf'), s.clusters.connected), to: '/admin/cluster/connections' },
    { icon: 'pool', label: t('sum.pools'), value: s.pools.total, sub: '', to: '/admin/pools/list' },
    { icon: 'vm', label: t('sum.desktops'), value: s.desktops.total, sub: fill(t('sum.assignedOf'), s.desktops.assigned), to: '/admin/pools/status' },
    { icon: 'globe', label: t('sum.inSession'), value: s.desktops.in_session, sub: fill(t('sum.sessionsToday'), s.sessions_today), to: '/admin/ops/sessions' },
    { icon: 'users', label: t('sum.users'), value: s.users.total, sub: fill(t('sum.enabledOf'), s.users.enabled), to: '/admin/users/list' },
  ];
  return (
    <div className="kpis">
      {tiles.map((x) => (
        <Link key={x.label} to={x.to} className="kpi">
          <span className="kpi-label"><Icon name={x.icon} size={15} />{x.label}</span>
          <span className="kpi-value">{x.value.toLocaleString()}</span>
          {x.sub && <span className="kpi-sub">{x.sub}</span>}
        </Link>
      ))}
    </div>
  );
}

// Counts per category as thin bars of one hue (magnitude only); the label carries identity.
function CountBars({ rows }: { rows: { key: string; label: React.ReactNode; n: number }[] }) {
  const { t } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (rows.length === 0) return <p className="muted small">{t('sum.empty')}</p>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.key} className="bar-row" title={`${r.n}`}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.n / max) * 100}%` }} /></span>
          <span className="bar-n">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

const STATES: DesktopState[] = ['ready', 'in_use', 'stopped', 'provisioning', 'error'];
const TYPES: PoolType[] = ['dedicated', 'reset', 'shared', 'classroom', 'buildfarm'];

export function Breakdown({ s }: { s: Summary }) {
  const { t } = useI18n();
  return (
    <div className="breakdown">
      <section className="panel">
        <h2 className="section-title">{t('sum.byState')}</h2>
        <CountBars rows={STATES.filter((k) => s.desktops.by_state[k]).map((k) => ({
          key: k, label: <StateBadge state={k} />, n: s.desktops.by_state[k] ?? 0 }))} />
      </section>
      <section className="panel">
        <h2 className="section-title">{t('sum.byType')}</h2>
        <CountBars rows={TYPES.filter((k) => s.pools.by_type[k]).map((k) => ({
          key: k, label: t(`pooltype.${k}` as MessageKey), n: s.pools.by_type[k] ?? 0 }))} />
      </section>
    </div>
  );
}
