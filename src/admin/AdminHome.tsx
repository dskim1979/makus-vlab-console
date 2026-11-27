import { Link } from 'react-router-dom';
import { adminApi } from '../api/admin';
import type { Summary } from '../api/types';
import { Icon, type IconName } from '../components/Icon';
import { LoadState } from '../components/LoadState';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';
import { ForecastPanel } from './ForecastPanel';
import { GettingStarted } from './GettingStarted';
import { InfraBoard } from './InfraBoard';
import { visibleModules } from './modules';
import { useFeatures } from '../features';
import { FeaturesChooser } from './pages/FeaturesPage';
import { ReservationsCard } from './pages/ReservationsPage';
import { Breakdown } from './SummaryTiles';

// Admin dashboard: the monitoring board on one screen (InfraBoard), then below it the
// system health, quick actions, desktops by state and the modules.
export function AdminHome() {
  const { t, pick } = useI18n();
  const summary = useLoad(adminApi.summary);
  const features = useFeatures();
  if (features.loaded && !features.chosen) {
    return (
      <main className="page">
        <header className="page-head"><div><h1>{pick({ ko: '시작하기', en: 'Getting started' })}</h1></div></header>
        <FeaturesChooser firstRun />
      </main>
    );
  }
  return (
    <main className="page page-wide dash">
      <LoadState value={summary} retry={summary.reload}>
        {(s) => (
          <>
            <GettingStarted s={s} />
            <Attention s={s} />
            <InfraBoard s={s} onRefresh={summary.reload} />
            <ForecastPanel />
            <div className="dash-lower">
            <div className="dash-grid dash-below">
              <Health s={s} />
              <section className="card">
                <h2 className="card-title">{t('dash.quick')}</h2>
                <ul className="link-list">
                  <Quick to="/admin/pools/deploy" icon="pool" label={pick({ ko: '데스크톱 배포', en: 'Deploy desktops' })} />
                  <Quick to="/admin/images/templates/templates" icon="box" label={t('dash.qClone')} />
                  {features.on(['gpuai', 'fpga']) && <Quick to="/admin/accel/loans" icon="gpu" label={t('dash.qGpu')} />}
                  <Quick to="/admin/users/list" icon="users" label={t('dash.qUsers')} />
                  <Quick to="/admin/ops/reports" icon="ops" label={t('dash.qReport')} />
                </ul>
              </section>
              {features.on('lab') && <ReservationsCard />}
            </div>
            <Breakdown s={s} />
            </div>
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

// Needs attention (Prism / Horizon style): what is wrong now, on top; one quiet line when all is well.
function Attention({ s }: { s: Summary }) {
  const { t, pick } = useI18n();
  const offline = s.clusters.total - s.clusters.connected;
  const errors = s.desktops.by_state.error ?? 0;
  const items: { text: string; to: string }[] = [];
  if (s.clusters.total === 0) items.push({ text: pick({ ko: '연결된 클러스터가 없습니다', en: 'No cluster connected' }), to: '/admin/cluster/connections' });
  else if (offline) items.push({ text: `${t('dash.clusters')} · ${t('dash.offline').replace('{n}', String(offline))}`, to: '/admin/cluster/connections' });
  if (errors) items.push({ text: `${t('dash.desktopsOk')} · ${t('dash.errors').replace('{n}', String(errors))}`, to: '/admin/pools/vms/status' });
  if (!items.length) {
    return <div className="attn attn-ok" role="status"><span className="st-badge st-ok">{pick({ ko: '정상', en: 'Healthy' })}</span>
      <span>{pick({ ko: '클러스터와 데스크톱에 확인할 문제가 없습니다.', en: 'Nothing needs attention in clusters and desktops.' })}</span></div>;
  }
  return (
    <div className="attn" role="alert">
      <span className="st-badge st-warn">{pick({ ko: `확인 필요 ${items.length}`, en: `${items.length} to check` })}</span>
      {items.map((x) => <Link key={x.text} to={x.to} className="attn-item">{x.text}<Icon name="chevron" size={12} /></Link>)}
    </div>
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
      to: '/admin/pools/vms/status' },
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
  const { on } = useFeatures();
  return (
    <section className="modules">
      <h2 className="section-title">{t('dash.modules')}</h2>
      <div className="module-grid">
        {visibleModules(on).map((m) => (
          <Link key={m.id} to={`/admin/${m.id}/${m.visiblePages[0].id}`} className="module">
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
