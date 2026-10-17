// Admin console menu: modules (home tiles) and their pages (left menu). Related screens are
// tabs of one page; a page or tab tagged with feature groups shows only when the site uses one
// of them (플랫폼 설정 > 기능, src/features.tsx). Each tab names the screen it shows by its old
// "module/page" key (`render`); an old address redirects to its tab (AdminModule.tsx).
import type { FeatureGroup } from '../api/features';
import type { IconName } from '../components/Icon';
import type { Localized } from '../i18n';

export type { IconName };

export type AdminTab = { id: string; label: Localized; render: string; feature?: FeatureGroup[] };

export type AdminPage = {
  id: string;
  label: Localized;
  phase: number; // implementation phase, docs/vlab-design.md 12
  feature?: FeatureGroup[];
  tabs?: AdminTab[];
  render?: string;  // a page without tabs: the screen it shows (default: module/page)
  hidden?: boolean; // reachable by address (a drill-down), not in the menu
};

export type Tone = 'blue' | 'violet' | 'teal' | 'orange' | 'green' | 'navy' | 'slate' | 'pink';

export type AdminModule = {
  id: string;
  icon: IconName;
  tone: Tone; // the module's colour: home tile, sidebar icon, page header
  label: Localized;
  summary: Localized;
  pages: AdminPage[];
  vlabOnly?: boolean;
};

const T = (id: string, ko: string, en: string, render: string, feature?: FeatureGroup[]): AdminTab => ({ id, label: { ko, en }, render, feature });

export const MODULES: AdminModule[] = [
  {
    id: 'vms', icon: 'vm', tone: 'blue',
    label: { ko: '가상머신', en: 'Virtual machines' },
    summary: { ko: '데스크톱 VM(만들기 · ISO · 상태), 이미지(템플릿 · 골든 이미지 · 환경 카탈로그)', en: 'Desktop VMs (make, ISO, status), images (templates, golden images, environments)' },
    pages: [
      { id: 'desktops', label: { ko: '데스크톱(VM)', en: 'Desktop VMs' }, phase: 1, tabs: [
        T('list', '목록', 'List', 'vms/desktops'), T('create', 'VM 만들기', 'Make a VM', 'vms/create'),
        T('isos', 'ISO · 이미지', 'ISO library', 'vms/isos'), T('status', '풀별 상태', 'By pool', 'pools/status')] },
      { id: 'images', label: { ko: '이미지', en: 'Images' }, phase: 1, tabs: [
        T('templates', '템플릿', 'Templates', 'vms/templates'), T('golden', '골든 이미지', 'Golden images', 'vms/golden'),
        T('environments', '환경 카탈로그', 'Environments', 'vms/environments', ['gpuai', 'fpga'])] },
    ],
  },
  {
    id: 'pools', icon: 'pool', tone: 'violet',
    label: { ko: '데스크톱 풀', en: 'Desktop pools' },
    summary: { ko: '풀(정책 · 권한 · 공유 저장소), 접속 설정(게이트웨이 · USB · 외부 데스크톱)', en: 'Pools (policy, access, shared storage), access settings (gateways, USB, external desktops)' },
    pages: [
      { id: 'list', label: { ko: '풀', en: 'Pools' }, phase: 1, render: 'pools/list' },
      { id: 'access', label: { ko: '접속 설정', en: 'Access settings' }, phase: 1, feature: ['external'], tabs: [
        T('gateways', '게이트웨이', 'Gateways', 'pools/gateways'), T('usb', 'USB 장치', 'USB devices', 'pools/usb'),
        T('external', '외부 데스크톱', 'External desktops', 'pools/external')] },
    ],
  },
  {
    id: 'users', icon: 'users', tone: 'teal',
    label: { ko: '사용자', en: 'Users' },
    summary: { ko: '사용자(가입 심사 · 부서), 권한(역할 · 유효 권한)', en: 'Users (sign-up review, departments), access (roles, effective access)' },
    pages: [
      { id: 'list', label: { ko: '사용자', en: 'Users' }, phase: 1, tabs: [
        T('list', '사용자 목록', 'Users', 'users/list'), T('signups', '가입 심사', 'Sign-up review', 'users/signups', ['signup']),
        T('departments', '부서', 'Departments', 'users/departments', ['org', 'signup'])] },
      { id: 'perm', label: { ko: '권한', en: 'Access rights' }, phase: 1, feature: ['org'], tabs: [
        T('roles', '역할', 'Roles', 'users/roles'), T('access', '유효 권한 조회', 'Effective access', 'users/access')] },
      { id: 'access', label: { ko: '유효 권한 조회', en: 'Effective access' }, phase: 1, hidden: true, render: 'users/access' },
    ],
  },
  {
    id: 'labs', icon: 'lab', tone: 'orange',
    label: { ko: 'LAB', en: 'Labs' },
    summary: { ko: 'LAB(실습실 · 단말 에이전트), 일정 · 예약(예약 · 시간표 · 일정형 풀)', en: 'Labs (rooms, terminal agents), schedules and bookings' },
    pages: [
      { id: 'list', label: { ko: 'LAB', en: 'Labs' }, phase: 1, feature: ['lab'], tabs: [
        T('list', 'LAB 관리', 'Labs', 'labs/list'), T('terminals', '단말', 'Terminals', 'labs/terminals')] },
      { id: 'schedule', label: { ko: '일정 · 예약', en: 'Schedules and bookings' }, phase: 1, feature: ['lab'], tabs: [
        T('reservations', '예약', 'Bookings', 'labs/reservations'), T('schedules', '사용 일정', 'Schedules', 'labs/schedules'),
        T('pools', '일정형 풀', 'Scheduled pools', 'labs/pools')] },
    ],
  },
  {
    id: 'accel', icon: 'gpu', tone: 'green', vlabOnly: true,
    label: { ko: '가속 자원', en: 'Accelerators' },
    summary: { ko: '카드(재고 · vGPU · MIG · 매핑 · 점검), 대여, GPU 작업(큐 · 할당량 · 웹 IDE), 보드 LAB · 빌드 팜 · 라이선스', en: 'Cards (inventory, vGPU, MIG, mappings, checks), loans, GPU jobs (queue, quotas, web IDE), board lab, build farm, licences' },
    pages: [
      { id: 'cards', label: { ko: '카드', en: 'Cards' }, phase: 1, feature: ['gpuai', 'fpga'], tabs: [
        T('inventory', '재고', 'Inventory', 'accel/inventory'), T('vgpu', 'vGPU 프로필', 'vGPU profiles', 'accel/vgpu', ['gpuai']),
        T('mappings', '리소스 매핑', 'Resource mappings', 'accel/mappings'), T('checks', '패스스루 점검', 'Passthrough checks', 'accel/checks')] },
      { id: 'loans', label: { ko: '카드 대여', en: 'Card loans' }, phase: 1, feature: ['gpuai', 'fpga'], tabs: [
        T('leases', '대여 현황', 'Loans', 'accel/leases'), T('bookings', '예약', 'Bookings', 'accel/bookings'),
        T('usage', '사용 보고서', 'Usage report', 'accel/usage')] },
      { id: 'gpujobs', label: { ko: 'GPU 작업', en: 'GPU jobs' }, phase: 1, feature: ['gpuai'], tabs: [
        T('queue', '작업 큐', 'Job queue', 'accel/gpuqueue'), T('quotas', '할당량', 'Quotas', 'accel/quotas'),
        T('usage', 'GPU-시간', 'GPU-hours', 'accel/gpuusage'), T('ide', '웹 IDE', 'Web IDE', 'accel/ide')] },
      { id: 'boards', label: { ko: '보드 LAB(JTAG)', en: 'Board lab (JTAG)' }, phase: 1, feature: ['fpga'], tabs: [
        T('boards', '보드', 'Boards', 'accel/boards'), T('gateways', 'JTAG 게이트웨이', 'JTAG gateways', 'accel/jtag-gateways')] },
      { id: 'buildfarm', label: { ko: '빌드 팜', en: 'Build farm' }, phase: 1, feature: ['fpga'], tabs: [
        T('farm', '작업 큐', 'Job queue', 'accel/buildfarm'), T('ci', 'CI 연동', 'CI', 'accel/ci'), T('results', '결과물 보관', 'Results kept', 'accel/artifacts')] },
      { id: 'licenses', label: { ko: '라이선스 서버', en: 'License servers' }, phase: 1, feature: ['fpga'], render: 'accel/licenses' },
    ],
  },
  {
    id: 'data', icon: 'layers', tone: 'pink',
    label: { ko: '연구 데이터', en: 'Research data' },
    summary: { ko: '데이터셋(반출 승인 · 규칙), 용량 · 반출 보고서', en: 'Datasets (export approvals, rules), capacity and export report' },
    pages: [
      { id: 'datasets', label: { ko: '데이터셋', en: 'Datasets' }, phase: 1, feature: ['data'], tabs: [
        T('datasets', '데이터셋', 'Datasets', 'data/datasets'), T('requests', '반출 승인', 'Export approvals', 'data/requests'),
        T('policies', '반출 · 업로드 규칙', 'Rules', 'data/policies')] },
      { id: 'usage', label: { ko: '용량 · 보고서', en: 'Capacity and report' }, phase: 1, feature: ['data'], tabs: [
        T('usage', '용량', 'Capacity', 'data/usage'), T('report', '반출 보고서', 'Export report', 'data/report')] },
    ],
  },
  {
    id: 'cluster', icon: 'cluster', tone: 'navy',
    label: { ko: '클러스터', en: 'Cluster' },
    summary: { ko: '클러스터(개요 · 노드 · 스토리지 · 고가용성), 클러스터 연결', en: 'Cluster (overview, nodes, storage, HA), connections' },
    pages: [
      { id: 'overview', label: { ko: '클러스터', en: 'Cluster' }, phase: 1, tabs: [
        T('overview', '개요', 'Overview', 'cluster/overview'), T('nodes', '노드', 'Nodes', 'cluster/nodes'),
        T('storage', '스토리지', 'Storage', 'cluster/storage'), T('ha', '고가용성(HA)', 'High availability', 'cluster/ha', ['ha'])] },
      { id: 'connections', label: { ko: '클러스터 연결', en: 'Cluster connections' }, phase: 1, render: 'cluster/connections' },
    ],
  },
  {
    id: 'ops', icon: 'ops', tone: 'slate',
    label: { ko: '운영', en: 'Operations' },
    summary: { ko: '요약(작업 진행), 기록(접속 · 감사), 보고서, 경보, 백업, 플랫폼 설정', en: 'Summary (tasks), logs (sessions, audit), reports, alerts, backup, platform settings' },
    pages: [
      { id: 'summary', label: { ko: '요약', en: 'Summary' }, phase: 1, tabs: [
        T('summary', '시스템 요약', 'System summary', 'ops/summary'), T('tasks', '작업 진행', 'Tasks', 'ops/tasks')] },
      { id: 'logs', label: { ko: '기록', en: 'Logs' }, phase: 1, tabs: [
        T('sessions', '접속 기록', 'Sessions', 'ops/sessions'), T('audit', '작업 기록(감사)', 'Audit log', 'ops/audit')] },
      { id: 'reports', label: { ko: '보고서', en: 'Reports' }, phase: 1, tabs: [
        T('usage', '사용률', 'Usage', 'ops/reports'), T('pdf', '운영 보고서 (PDF)', 'Operations report (PDF)', 'ops/report')] },
      { id: 'alerts', label: { ko: '경보', en: 'Alerts' }, phase: 1, render: 'ops/alerts' },
      { id: 'backup', label: { ko: '백업 (PBS)', en: 'Backup (PBS)' }, phase: 1, render: 'ops/backup' },
      { id: 'settings', label: { ko: '플랫폼 설정', en: 'Platform settings' }, phase: 1, render: 'ops/settings' },
    ],
  },
];

export type FeatureCheck = (g?: FeatureGroup[]) => boolean;

export function visibleTabs(p: AdminPage, on: FeatureCheck): AdminTab[] {
  return (p.tabs ?? []).filter((t) => on(t.feature));
}

export function pageVisible(p: AdminPage, on: FeatureCheck): boolean {
  return !p.hidden && on(p.feature) && (!p.tabs || visibleTabs(p, on).length > 0);
}

export function visibleModules(on: FeatureCheck): (AdminModule & { visiblePages: AdminPage[] })[] {
  return MODULES.map((m) => ({ ...m, visiblePages: m.pages.filter((p) => pageVisible(p, on)) })).filter((m) => m.visiblePages.length > 0);
}

/** Where an old "module/page" address lives now: [module, page, tab]. */
export function findRender(key: string): [string, string, string | undefined] | null {
  for (const m of MODULES) {
    for (const p of m.pages) {
      if (p.tabs) {
        const t = p.tabs.find((x) => x.render === key);
        if (t) return [m.id, p.id, t.id];
      } else if ((p.render ?? `${m.id}/${p.id}`) === key) {
        return [m.id, p.id, undefined];
      }
    }
  }
  return null;
}

export function findModule(id?: string) {
  return MODULES.find((m) => m.id === id);
}
