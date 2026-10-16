// Admin console menu: modules (home tiles) and their pages (left menu), in the order of
// docs/vlab-design.md 4-1, which follows the pxvdi console structure.
import type { IconName } from '../components/Icon';
import type { Localized } from '../i18n';

export type { IconName };

export type AdminPage = {
  id: string;
  label: Localized;
  phase: number; // implementation phase, docs/vlab-design.md 12
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

export const MODULES: AdminModule[] = [
  {
    id: 'vms', icon: 'vm', tone: 'blue',
    label: { ko: '가상머신', en: 'Virtual machines' },
    summary: { ko: '데스크톱 VM, 템플릿, 골든 이미지(버전·배포)', en: 'Desktop VMs, templates, golden images' },
    pages: [
      { id: 'desktops', label: { ko: '데스크톱(VM) 관리', en: 'Desktop VMs' }, phase: 1 },
      { id: 'templates', label: { ko: '템플릿 관리', en: 'Templates' }, phase: 1 },
      { id: 'golden', label: { ko: '골든 이미지 관리', en: 'Golden images' }, phase: 1 },
    ],
  },
  {
    id: 'pools', icon: 'pool', tone: 'violet',
    label: { ko: '데스크톱 풀', en: 'Desktop pools' },
    summary: { ko: '풀 정책, 게이트웨이, USB 장치, 데스크톱 상태', en: 'Pool policies, gateways, USB devices, desktop status' },
    pages: [
      { id: 'list', label: { ko: '풀 관리', en: 'Pools' }, phase: 1 },
      { id: 'gateways', label: { ko: '게이트웨이', en: 'Gateways' }, phase: 1 },
      { id: 'usb', label: { ko: 'USB 장치 라이브러리', en: 'USB device library' }, phase: 1 },
      { id: 'external', label: { ko: '외부 데스크톱', en: 'External desktops' }, phase: 1 },
      { id: 'status', label: { ko: '데스크톱 상태', en: 'Desktop status' }, phase: 1 },
    ],
  },
  {
    id: 'users', icon: 'users', tone: 'teal',
    label: { ko: '사용자', en: 'Users' },
    summary: { ko: '사용자, 가입 심사, 부서, 유효 권한', en: 'Users, sign-up review, departments, effective access' },
    pages: [
      { id: 'list', label: { ko: '사용자 목록', en: 'Users' }, phase: 1 },
      { id: 'signups', label: { ko: '가입 심사', en: 'Sign-up review' }, phase: 1 },
      { id: 'departments', label: { ko: '부서 관리', en: 'Departments' }, phase: 1 },
      { id: 'access', label: { ko: '유효 권한 조회', en: 'Effective access' }, phase: 1 },
    ],
  },
  {
    id: 'labs', icon: 'lab', tone: 'orange',
    label: { ko: 'LAB', en: 'Labs' },
    summary: { ko: 'LAB(공용 공간), 단말, 사용 일정, 일정형 풀', en: 'Labs (shared spaces), terminals, schedules, scheduled pools' },
    pages: [
      { id: 'list', label: { ko: 'LAB 관리', en: 'Labs' }, phase: 1 },
      { id: 'terminals', label: { ko: '단말 관리', en: 'Terminals' }, phase: 1 },
      { id: 'schedules', label: { ko: '사용 일정', en: 'Schedules' }, phase: 1 },
      { id: 'pools', label: { ko: '일정형 풀', en: 'Scheduled pools' }, phase: 1 },
    ],
  },
  {
    id: 'accel', icon: 'gpu', tone: 'green', vlabOnly: true,
    label: { ko: '가속 자원', en: 'Accelerators' },
    summary: { ko: 'GPU·vGPU, FPGA·NPU 카드, 리소스 매핑, 대여, 보드 LAB, 빌드 팜, 라이선스', en: 'GPU and vGPU, FPGA cards, resource mappings, loans, board lab, build farm, licences' },
    pages: [
      { id: 'inventory', label: { ko: 'GPU·가속 카드 재고', en: 'GPU and card inventory' }, phase: 1 },
      { id: 'vgpu', label: { ko: 'vGPU 프로필', en: 'vGPU profiles' }, phase: 1 },
      { id: 'mappings', label: { ko: '리소스 매핑', en: 'Resource mappings' }, phase: 1 },
      { id: 'leases', label: { ko: '카드 대여 현황', en: 'Card loans' }, phase: 1 },
      { id: 'boards', label: { ko: '보드 LAB(JTAG)', en: 'Board lab (JTAG)' }, phase: 1 },
      { id: 'buildfarm', label: { ko: '빌드 팜', en: 'Build farm' }, phase: 1 },
      { id: 'licenses', label: { ko: '라이선스 서버', en: 'License servers' }, phase: 1 },
    ],
  },
  {
    id: 'cluster', icon: 'cluster', tone: 'navy',
    label: { ko: '클러스터', en: 'Cluster' },
    summary: { ko: '클러스터 연결, 개요, 노드, 스토리지', en: 'Cluster connection, overview, nodes, storage' },
    pages: [
      { id: 'overview', label: { ko: '개요', en: 'Overview' }, phase: 1 },
      { id: 'nodes', label: { ko: '노드', en: 'Nodes' }, phase: 1 },
      { id: 'storage', label: { ko: '스토리지', en: 'Storage' }, phase: 1 },
      { id: 'connections', label: { ko: '클러스터 연결', en: 'Cluster connections' }, phase: 1 },
    ],
  },
  {
    id: 'ops', icon: 'ops', tone: 'slate',
    label: { ko: '운영', en: 'Operations' },
    summary: { ko: '시스템 요약, 접속 기록, 사용률 보고서, 경보, 백업(PBS), 작업 기록, 플랫폼 설정(도메인·화이트라벨)', en: 'Summary, sessions, usage, alerts, backup (PBS), audit, platform settings (directory, white label)' },
    pages: [
      { id: 'summary', label: { ko: '시스템 요약', en: 'System summary' }, phase: 1 },
      { id: 'sessions', label: { ko: '접속 기록', en: 'Session log' }, phase: 1 },
      { id: 'reports', label: { ko: '사용률 보고서', en: 'Usage reports' }, phase: 1 },
      { id: 'report', label: { ko: '운영 보고서 (PDF)', en: 'Operations report (PDF)' }, phase: 1 },
      { id: 'alerts', label: { ko: '경보', en: 'Alerts' }, phase: 1 },
      { id: 'backup', label: { ko: '백업 (PBS)', en: 'Backup (PBS)' }, phase: 1 },
      { id: 'audit', label: { ko: '작업 기록(감사)', en: 'Audit log' }, phase: 1 },
      { id: 'settings', label: { ko: '플랫폼 설정', en: 'Platform settings' }, phase: 1 },
    ],
  },
];

export function findModule(id?: string) {
  return MODULES.find((m) => m.id === id);
}
