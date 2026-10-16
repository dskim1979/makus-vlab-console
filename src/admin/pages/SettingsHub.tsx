import { NavLink, Navigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { BrandingPage } from './BrandingPage';
import { DirectoryPage } from './DirectoryPage';
import { SettingsPage } from './SettingsPage';

// 운영 > 플랫폼 설정: everything that sets how the platform behaves, in one place -
// 일반 (sign-in, passwords, audit, mail), 도메인 (AD/LDAP sign-in) and 화이트라벨 (the look).
const TABS: { id: string; key: MessageKey }[] = [
  { id: 'general', key: 'hub.general' }, { id: 'directory', key: 'hub.directory' }, { id: 'branding', key: 'hub.branding' },
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
    </>
  );
}
