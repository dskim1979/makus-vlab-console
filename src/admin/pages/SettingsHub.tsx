import { NavLink, Navigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { AccountSettingsPage } from './AccountSettingsPage';
import { BrandingPage } from './BrandingPage';
import { DirectoryPage } from './DirectoryPage';
import { NoticesPage } from './NoticesPage';
import { ServerPairPage } from './OpsPages';
import { SettingsPage } from './SettingsPage';
import { ClientSettingsPage } from './NextPages';
import { SupportPage } from './SupportPage';
import { FeaturesPage } from './FeaturesPage';
import { WarpgatePage } from './WarpgatePage';
import { McpPage } from './McpPage';
import { useFeatures } from '../../features';

// 운영 > 플랫폼 설정: everything that sets how the platform behaves, in one place -
// 일반 (sign-in, passwords, audit, mail), 도메인 (AD/LDAP sign-in), 화이트라벨 (the look) and
// 클라이언트 (the Windows client's version and download), 공지 (the bars on top of every screen) and
// 서버 이중화 (MOAVI Desk's own active and standby servers) and 지원 (the support bundle for a period),
// 계정 · 약관 (account expiry, the address in mails, terms of use and privacy with the consents),
// MCP 연동 (AI clients that manage VMs: tokens and client setup).
const TABS: { id: string; key: MessageKey }[] = [
  { id: 'general', key: 'hub.general' }, { id: 'features', key: 'hub.features' }, { id: 'accounts', key: 'hub.accounts' }, { id: 'directory', key: 'hub.directory' }, { id: 'branding', key: 'hub.branding' }, { id: 'client', key: 'hub.client' },
  { id: 'warpgate', key: 'hub.warpgate' }, { id: 'mcp', key: 'hub.mcp' },
  { id: 'notices', key: 'hub.notices' }, { id: 'pair', key: 'hub.pair' }, { id: 'support', key: 'hub.support' },
];

export function SettingsHub({ tab }: { tab?: string }) {
  const { t } = useI18n();
  const { on } = useFeatures();
  const tabs = TABS.filter((x) => x.id !== 'pair' || on('ha'));
  const current = tabs.find((x) => x.id === tab)?.id;
  if (tab && !current) return <Navigate to="/admin/ops/settings" replace />;
  const id = current ?? 'general';
  return (
    <>
      <nav className="page-tabs" aria-label={t('hub.tabs')}>
        {tabs.map((x) => (
          <NavLink key={x.id} to={x.id === 'general' ? '/admin/ops/settings' : `/admin/ops/settings/${x.id}`} end
            className={({ isActive }) => (isActive || (x.id === 'general' && !tab) ? 'on' : '')}>
            {t(x.key)}
          </NavLink>
        ))}
      </nav>
      {id === 'general' && <SettingsPage />}
      {id === 'features' && <FeaturesPage />}
      {id === 'accounts' && <AccountSettingsPage />}
      {id === 'directory' && <DirectoryPage />}
      {id === 'branding' && <BrandingPage />}
      {id === 'client' && <ClientSettingsPage />}
      {id === 'warpgate' && <WarpgatePage />}
      {id === 'mcp' && <McpPage />}
      {id === 'notices' && <NoticesPage />}
      {id === 'pair' && <ServerPairPage />}
      {id === 'support' && <SupportPage />}
    </>
  );
}
