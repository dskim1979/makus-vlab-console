import { NavLink, useLocation } from 'react-router-dom';
import { visibleModules } from '../admin/modules';
import { useFeatures } from '../features';
import { useI18n } from '../i18n';
import { CompanyNotice } from './CompanyNotice';
import { Icon } from './Icon';

// Admin console navigation (light, under the dark top bar): dashboard, then the modules
// in the pxvdi menu order; the open module unfolds its pages.
export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { t, pick } = useI18n();
  const { pathname } = useLocation();
  const activeModule = pathname.startsWith('/admin/') ? pathname.split('/')[2] : '';
  const { on } = useFeatures();
  const mods = visibleModules(on);

  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label={t('nav.menu')}>
      <nav className="sidebar-nav" onClick={onNavigate}>
        <NavLink to="/admin" end className="nav-item"><Icon name="home" size={18} /><span>{t('nav.dashboard')}</span></NavLink>
        <div className="sidebar-section">{t('nav.manage')}</div>
        {mods.map((m) => (
          <div key={m.id} className="sidebar-group">
            <NavLink to={`/admin/${m.id}/${m.visiblePages[0].id}`}
              className={({ isActive }) => `nav-item${isActive || activeModule === m.id ? ' active' : ''}`}>
              <Icon name={m.icon} size={18} /><span>{pick(m.label)}</span>
              <span className={`sidebar-caret${activeModule === m.id ? ' down' : ''}`}><Icon name="chevron" size={14} /></span>
            </NavLink>
            {activeModule === m.id && (
              <div className="sidebar-sub">
                {m.visiblePages.map((p) => (
                  <NavLink key={p.id} to={`/admin/${m.id}/${p.id}`}>
                    {pick(p.label)}
                    {p.phase > 1 && <span className="nav-soon" title={`phase ${p.phase}`}>{p.phase}</span>}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot"><CompanyNotice /></div>
    </aside>
  );
}
