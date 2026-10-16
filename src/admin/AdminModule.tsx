import { Navigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n';
import { findModule } from './modules';
import { AccelInventoryPage, MappingsPage, VgpuProfilesPage } from './pages/AccelPages';
import { LeasesPage } from './pages/LeasesPage';
import { LabSchedulesPage, LabsPage, ScheduledPoolsPage, TerminalsPage } from './pages/LabPages';
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
import { BoardsPage, BuildFarmPage, CardUsagePage, DepartmentsPage, ExternalDesktopsPage, GatewaysPage, GoldenImagesPage, LicenseServersPage, SignupsPage, UsbLibraryPage } from './pages/NextPages';

// Pages that exist so far; every other menu entry shows its planned phase.
function pageBody(moduleId: string, pageId: string, subId?: string) {
  const key = `${moduleId}/${pageId}`;
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
  if (key === 'labs/pools') return <ScheduledPoolsPage />;
  if (key === 'users/list') return <UsersPage />;
  if (key === 'users/roles') return <RolesPage />;
  if (key === 'users/access') return <AccessPage username={subId} />;
  if (key === 'vms/golden') return <GoldenImagesPage />;
  if (key === 'pools/gateways') return <GatewaysPage />;
  if (key === 'pools/usb') return <UsbLibraryPage />;
  if (key === 'pools/external') return <ExternalDesktopsPage />;
  if (key === 'users/signups') return <SignupsPage />;
  if (key === 'users/departments') return <DepartmentsPage />;
  if (key === 'accel/boards') return <BoardsPage />;
  if (key === 'accel/buildfarm') return <BuildFarmPage />;
  if (key === 'accel/licenses') return <LicenseServersPage />;
  if (key === 'accel/usage') return <CardUsagePage />;
  if (key === 'accel/checks') return <AccelChecksPage />;
  return null;
}

// One admin page. The module's pages are listed in the sidebar (Sidebar.tsx).
export function AdminModule() {
  const { moduleId, pageId, subId } = useParams();
  const { t, pick, lang } = useI18n();
  const mod = findModule(moduleId);

  // 도메인 and 화이트라벨 moved into 플랫폼 설정
  if (moduleId === 'users' && pageId === 'directory') return <Navigate to="/admin/ops/settings/directory" replace />;
  if (moduleId === 'ops' && pageId === 'branding') return <Navigate to="/admin/ops/settings/branding" replace />;
  if (!mod) return <Navigate to="/admin" replace />;
  const page = mod.pages.find((p) => p.id === pageId);
  if (!page) return <Navigate to={`/admin/${mod.id}/${mod.pages[0].id}`} replace />;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <nav className="crumbs" aria-label="breadcrumb">
            <span>{pick(mod.label)}</span><Icon name="chevron" size={12} /><span>{pick(page.label)}</span>
          </nav>
          <h1>{pick(page.label)}</h1>
        </div>
      </header>
      {pageBody(mod.id, page.id, subId) ?? (
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
