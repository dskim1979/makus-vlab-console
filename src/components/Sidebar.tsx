import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV_GROUPS, visibleModules } from '../admin/modules';
import { useFeatures } from '../features';
import { useI18n } from '../i18n';
import { CompanyNotice } from './CompanyNotice';
import { Icon } from './Icon';

const KEY = 'vlab.sidebar.narrow';
function loadNarrow() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }

// Admin console navigation (light, under the dark top bar): dashboard, then the modules under
// group headings (Horizon / Citrix style); the open module unfolds its pages. It folds to an
// icon rail (remembered in this browser).
export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { t, pick } = useI18n();
  const { pathname } = useLocation();
  const activeModule = pathname.startsWith('/admin/') ? pathname.split('/')[2] : '';
  const { on } = useFeatures();
  const mods = visibleModules(on);
  const [narrow, setNarrow] = useState(loadNarrow);
  const fold = () => {
    const next = !narrow;
    setNarrow(next);
    try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* private window */ }
  };
  const foldLabel = narrow ? pick({ ko: '메뉴 펼치기', en: 'Expand menu' }) : pick({ ko: '메뉴 접기', en: 'Collapse menu' });

  return (
    <aside className={`sidebar${open ? ' open' : ''}${narrow ? ' narrow' : ''}`} aria-label={t('nav.menu')}>
      <nav className="sidebar-nav" onClick={onNavigate}>
        <NavLink to="/admin" end className="nav-item" title={t('nav.dashboard')}>
          <Icon name="home" size={18} /><span className="nav-text">{t('nav.dashboard')}</span>
        </NavLink>
        {NAV_GROUPS.map((g) => {
          const list = mods.filter((m) => m.group === g.id);
          if (list.length === 0) return null;
          return (
            <div key={g.id} className="sidebar-block">
              <div className="sidebar-section">{pick(g.label)}</div>
              {list.map((m) => (
                <div key={m.id} className="sidebar-group">
                  <NavLink to={`/admin/${m.id}/${m.visiblePages[0].id}`} title={pick(m.label)}
                    className={({ isActive }) => `nav-item${isActive || activeModule === m.id ? ' active' : ''}`}>
                    <Icon name={m.icon} size={18} /><span className="nav-text">{pick(m.label)}</span>
                    {m.visiblePages.length > 1 && (
                      <span className={`sidebar-caret${activeModule === m.id ? ' down' : ''}`}><Icon name="chevron" size={14} /></span>
                    )}
                  </NavLink>
                  {activeModule === m.id && m.visiblePages.length > 1 && (
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
            </div>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <CompanyNotice />
        <button type="button" className="sidebar-fold" onClick={fold} title={foldLabel} aria-label={foldLabel}>
          <Icon name="chevron" size={16} />
        </button>
      </div>
    </aside>
  );
}
