import { AccelBookingsAdmin, ArtifactSettingsPage, CiLinksPage } from './pages/BuildFarmPages';
import { Link, NavLink, Navigate, useParams } from 'react-router-dom';
import { useFeatures } from '../features';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n';
import { findModule, findRender, pageVisible, visibleModules, visibleTabs } from './modules';
import { AccelInventoryPage, MappingsPage, VgpuProfilesPage } from './pages/AccelPages';
import { LeasesPage } from './pages/LeasesPage';
import { LabSchedulesPage, LabsPage, ScheduledPoolsPage, TerminalsPage } from './pages/LabPages';
import { ReservationsPage } from './pages/ReservationsPage';
import { DataPoliciesPage, DataReportPage, DataRequestsPage, DataUsagePage, DatasetsPage } from './pages/DataPages';
import { AccessPage } from './pages/AccessPage';
import { AlertsPage } from './pages/AlertsPage';
import { AuditPage } from './pages/AuditPage';
import { BackupPage } from './pages/BackupPage';
import { ClusterNodesPage, ClusterOverviewPage, ClusterStoragePage } from './pages/ClusterPages';
import { ClustersPage } from './pages/ClustersPage';
import { DesktopStatusPage } from './pages/DesktopStatusPage';
import { TemplatesPage, VmDesktopsPage } from './pages/VmPages';
import { IsoLibraryPage, VmCreatePage } from './pages/BuildPages';
import { ClusterHaPage, TasksPage } from './pages/OpsPages';
import { PoolDetailPage } from './pages/PoolDetailPage';
import { PoolsPage } from './pages/PoolsPage';
import { SessionsPage } from './pages/SessionsPage';
import { SettingsHub } from './pages/SettingsHub';
import { SummaryPage } from './pages/SummaryPage';
import { ReportPage } from './pages/ReportPage';
import { UsagePage } from './pages/UsagePage';
import { RolesPage } from './pages/RolesPage';
import { UsersPage } from './pages/UsersPage';
import { AccelChecksPage } from './pages/AccelChecksPage';
import { EnvCatalogPage } from './pages/EnvCatalogPage';
import { GpuQueuePage, GpuQuotasPage, GpuUsagePage, IdeSessionsPage } from './pages/ResearchPages';
import { JtagGatewaysPage } from './pages/JtagGatewayPages';
import { BoardsPage, BuildFarmPage, CardUsagePage, DepartmentsPage, ExternalDesktopsPage, GatewaysPage, GoldenImagesPage, LicenseServersPage, SignupsPage, UsbLibraryPage } from './pages/NextPages';

// Pages that exist so far; every other menu entry shows its planned phase.
function pageBody(key: string, subId?: string) {
  if (key === 'pools/list') return subId ? <PoolDetailPage poolId={subId} /> : <PoolsPage />;
  if (key === 'pools/status') return <DesktopStatusPage />;
  if (key === 'ops/sessions') return <SessionsPage />;
  if (key === 'ops/summary') return <SummaryPage />;
  if (key === 'ops/audit') return <AuditPage />;
  if (key === 'ops/tasks') return <TasksPage />;
  if (key === 'cluster/ha') return <ClusterHaPage />;
  if (key === 'ops/alerts') return <AlertsPage />;
  if (key === 'ops/backup') return <BackupPage />;
  if (key === 'ops/reports') return <UsagePage />;
  if (key === 'ops/report') return <ReportPage />;
  if (key === 'ops/settings') return <SettingsHub tab={subId} />;
  if (key === 'cluster/connections') return <ClustersPage />;
  if (key === 'accel/inventory') return <AccelInventoryPage />;
  if (key === 'accel/vgpu') return <VgpuProfilesPage />;
  if (key === 'accel/mappings') return <MappingsPage />;
  if (key === 'accel/leases') return <LeasesPage />;
  if (key === 'vms/desktops') return <VmDesktopsPage />;
  if (key === 'vms/templates') return <TemplatesPage />;
  if (key === 'vms/create') return <VmCreatePage />;
  if (key === 'vms/isos') return <IsoLibraryPage />;
  if (key === 'cluster/overview') return <ClusterOverviewPage />;
  if (key === 'cluster/nodes') return <ClusterNodesPage />;
  if (key === 'cluster/storage') return <ClusterStoragePage />;
  if (key === 'labs/list') return <LabsPage />;
  if (key === 'labs/terminals') return <TerminalsPage />;
  if (key === 'labs/schedules') return <LabSchedulesPage />;
  if (key === 'labs/reservations') return <ReservationsPage />;
  if (key === 'labs/pools') return <ScheduledPoolsPage />;
  if (key === 'users/list') return <UsersPage />;
  if (key === 'users/roles') return <RolesPage />;
  if (key === 'users/access') return <AccessPage username={subId} />;
  if (key === 'vms/golden') return <GoldenImagesPage />;
  if (key === 'vms/environments') return <EnvCatalogPage />;
  if (key === 'pools/gateways') return <GatewaysPage />;
  if (key === 'pools/usb') return <UsbLibraryPage />;
  if (key === 'pools/external') return <ExternalDesktopsPage />;
  if (key === 'users/signups') return <SignupsPage />;
  if (key === 'users/departments') return <DepartmentsPage />;
  if (key === 'accel/boards') return <BoardsPage />;
  if (key === 'accel/jtag-gateways') return <JtagGatewaysPage />;
  if (key === 'accel/buildfarm') return <BuildFarmPage />;
  if (key === 'accel/ci') return <CiLinksPage />;
  if (key === 'accel/artifacts') return <ArtifactSettingsPage />;
  if (key === 'accel/bookings') return <AccelBookingsAdmin />;
  if (key === 'accel/gpuqueue') return <GpuQueuePage />;
  if (key === 'accel/quotas') return <GpuQuotasPage />;
  if (key === 'accel/gpuusage') return <GpuUsagePage />;
  if (key === 'accel/ide') return <IdeSessionsPage />;
  if (key === 'accel/licenses') return <LicenseServersPage />;
  if (key === 'accel/usage') return <CardUsagePage />;
  if (key === 'accel/checks') return <AccelChecksPage />;
  if (key === 'data/datasets') return <DatasetsPage />;
  if (key === 'data/requests') return <DataRequestsPage />;
  if (key === 'data/policies') return <DataPoliciesPage />;
  if (key === 'data/usage') return <DataUsagePage />;
  if (key === 'data/report') return <DataReportPage />;
  return null;
}

// One admin page: its tabs (related screens), or the one screen it shows. Old addresses of
// screens that are tabs now redirect there; a page of a feature that is off says so.
export function AdminModule() {
  const { moduleId, pageId, subId } = useParams();
  const { t, pick, lang } = useI18n();
  const features = useFeatures();
  const on = (g?: Parameters<typeof features.on>[0]) => features.on(g);
  const mod = findModule(moduleId);

  // 도메인 and 화이트라벨 moved into 플랫폼 설정
  if (moduleId === 'users' && pageId === 'directory') return <Navigate to="/admin/ops/settings/directory" replace />;
  if (moduleId === 'ops' && pageId === 'branding') return <Navigate to="/admin/ops/settings/branding" replace />;
  const page = mod?.pages.find((p) => p.id === pageId);
  if (!mod || !page) {
    const moved = findRender(`${moduleId}/${pageId}`);
    if (moved) return <Navigate to={`/admin/${moved[0]}/${moved[1]}${moved[2] ? `/${moved[2]}` : subId ? `/${subId}` : ''}`} replace />;
    const first = visibleModules(on).find((m) => m.id === moduleId) ?? null;
    if (first) return <Navigate to={`/admin/${first.id}/${first.visiblePages[0].id}`} replace />;
    return <Navigate to="/admin" replace />;
  }

  const off = !page.hidden && !pageVisible(page, on);
  const tabs = page.tabs ? visibleTabs(page, on) : [];
  const tab = page.tabs ? (tabs.find((x) => x.id === subId) ?? tabs[0]) : undefined;
  if (page.tabs && subId && tab && tab.id !== subId) return <Navigate to={`/admin/${mod.id}/${page.id}/${tab.id}`} replace />;
  const key = tab ? tab.render : (page.render ?? `${mod.id}/${page.id}`);
  const body = off ? null : pageBody(key, tab ? undefined : subId);

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <nav className="crumbs" aria-label="breadcrumb">
            <span>{pick(mod.label)}</span><Icon name="chevron" size={12} /><span>{pick(page.label)}</span>
            {tab && <><Icon name="chevron" size={12} /><span>{pick(tab.label)}</span></>}
          </nav>
          <h1>{pick(page.label)}</h1>
        </div>
      </header>
      {tabs.length > 1 && (
        <nav className="page-tabs" aria-label={pick(page.label)}>
          {tabs.map((x) => (
            <NavLink key={x.id} to={`/admin/${mod.id}/${page.id}/${x.id}`} className={() => (x.id === tab?.id ? 'on' : '')}>{pick(x.label)}</NavLink>
          ))}
        </nav>
      )}
      {off ? (
        <div className="empty">
          <p>{pick({ ko: '이 기능은 이 사이트에서 꺼져 있습니다.', en: 'This feature is off for this site.' })}</p>
          <p><Link to="/admin/ops/settings/features" className="btn">{pick({ ko: '플랫폼 설정 › 기능에서 켜기', en: 'Turn it on in Platform settings › Features' })}</Link></p>
        </div>
      ) : body ?? (
        <div className="placeholder">
          <p>{t('admin.placeholder')}</p>
          <p className="muted small">
            {lang === 'ko' ? `${page.phase}단계에서 구현` : `${t('admin.plannedIn')} phase ${page.phase}`}
          </p>
        </div>
      )}
    </main>
  );
}
