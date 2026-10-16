import { Link } from 'react-router-dom';
import { adminApi } from '../api/admin';
import type { Summary } from '../api/types';
import { Icon, type IconName } from '../components/Icon';
import { LoadState } from '../components/LoadState';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';
import { InfraBoard } from './InfraBoard';
import { MODULES } from './modules';
import { Breakdown } from './SummaryTiles';

// Admin dashboard: the monitoring board on one screen (InfraBoard), then below it the
// system health, quick actions, desktops by state and the modules.
export function AdminHome() {
  const { t } = useI18n();
  const summary = useLoad(adminApi.summary);
  return (
    <main className="page page-wide dash">
      <LoadState value={summary} retry={summary.reload}>
        {(s) => (
          <>
            <InfraBoard s={s} onRefresh={summary.reload} />
            <div className="dash-grid dash-below">
              <Health s={s} />
              <section className="card">
                <h2 className="card-title">{t('dash.quick')}</h2>
                <ul className="link-list">
                  <Quick to="/admin/pools/list" icon="pool" label={t('dash.qPool')} />
                  <Quick to="/admin/vms/templates" icon="box" label={t('dash.qClone')} />
                  <Quick to="/admin/accel/leases" icon="gpu" label={t('dash.qGpu')} />
                  <Quick to="/admin/users/list" icon="users" label={t('dash.qUsers')} />
                  <Quick to="/admin/ops/reports" icon="ops" label={t('dash.qReport')} />
                </ul>
              </section>
            </div>
            <Breakdown s={s} />
          </>
        )}
      </LoadState>

      <ModuleList />
    </main>
  );
}

function Quick({ to, icon, label }: { to: string; icon: IconName; label: string }) {
  return (
    <li><Link to={to}><span className="li-icon"><Icon name={icon} size={17} /></span><span className="li-text">{label}</span><Icon name="chevron" size={14} /></Link></li>
  );
}

function Health({ s }: { s: Summary }) {
  const { t } = useI18n();
  const offline = s.clusters.total - s.clusters.connected;
  const errors = s.desktops.by_state.error ?? 0;
  const rows: { label: string; ok: boolean; text: string; to: string }[] = [
    { label: t('dash.clusters'), ok: offline === 0 && s.clusters.total > 0,
      text: offline ? t('dash.offline').replace('{n}', String(offline)) : t('sum.connectedOf').replace('{n}', String(s.clusters.connected)),
      to: '/admin/cluster/connections' },
    { label: t('dash.desktopsOk'), ok: errors === 0, text: errors ? t('dash.errors').replace('{n}', String(errors)) : t('dash.ok'),
      to: '/admin/pools/status' },
    { label: t('dash.engine'), ok: true, text: `${s.versions.engine} · API ${s.versions.vlab_api}`, to: '/admin/ops/summary' },
  ];
  return (
    <section className="card">
      <h2 className="card-title">{t('dash.health')}</h2>
      <ul className="health">
        {rows.map((r) => (
          <li key={r.label}>
            <span className={`hdot ${r.ok ? 'ok' : 'warn'}`} aria-hidden="true" />
            <Link to={r.to} className="health-label">{r.label}</Link>
            <span className={`health-val${r.ok ? '' : ' warn'}`}>{r.ok ? '' : `${t('dash.warn')} · `}{r.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ModuleList() {
  const { t, pick } = useI18n();
  return (
    <section className="modules">
      <h2 className="section-title">{t('dash.modules')}</h2>
      <div className="module-grid">
        {MODULES.map((m) => (
          <Link key={m.id} to={`/admin/${m.id}/${m.pages[0].id}`} className="module">
            <span className="module-icon"><Icon name={m.icon} size={20} /></span>
            <span className="module-text">
              <span className="module-name">{pick(m.label)}</span>
              <span className="module-sum">{pick(m.summary)}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
