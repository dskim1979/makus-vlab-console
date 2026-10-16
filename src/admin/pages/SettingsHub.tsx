import { NavLink, Navigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { BrandingPage } from './BrandingPage';
import { DirectoryPage } from './DirectoryPage';
import { NoticesPage } from './NoticesPage';
import { SettingsPage } from './SettingsPage';
import { ClientSettingsPage } from './NextPages';

// 운영 > 플랫폼 설정: everything that sets how the platform behaves, in one place -
// 일반 (sign-in, passwords, audit, mail), 도메인 (AD/LDAP sign-in), 화이트라벨 (the look) and
// 클라이언트 (the Windows client's version and download) and 공지 (the bars on top of every screen).
const TABS: { id: string; key: MessageKey }[] = [
  { id: 'general', key: 'hub.general' }, { id: 'directory', key: 'hub.directory' }, { id: 'branding', key: 'hub.branding' }, { id: 'client', key: 'hub.client' },
  { id: 'notices', key: 'hub.notices' },
];

export function SettingsHub({ tab }: { tab?: string }) {
  const { t } = useI18n();
  const current = TABS.find((x) => x.id === tab)?.id;
  if (tab && !current) return <Navigate to="/admin/ops/settings" replace />;
  const id = current ?? 'general';
  return (
    <>
      <nav className="page-tabs" aria-label={t('hub.tabs')}>
        {TABS.map((x) => (
          <NavLink key={x.id} to={x.id === 'general' ? '/admin/ops/settings' : `/admin/ops/settings/${x.id}`} end
            className={({ isActive }) => (isActive || (x.id === 'general' && !tab) ? 'on' : '')}>
            {t(x.key)}
          </NavLink>
        ))}
      </nav>
      {id === 'general' && <SettingsPage />}
      {id === 'directory' && <DirectoryPage />}
      {id === 'branding' && <BrandingPage />}
      {id === 'client' && <ClientSettingsPage />}
      {id === 'notices' && <NoticesPage />}
    </>
  );
}
