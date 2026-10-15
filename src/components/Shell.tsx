import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { CompanyNotice } from './CompanyNotice';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

// Two frames, as commercial VDI products have them (docs/vlab-design.md 4-4):
// - the user's workspace (portal): top bar with tabs over a scene, no sidebar;
// - the admin console (/admin): dark top bar, light navigation on the left.
export function Shell({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  const consoleMode = pathname.startsWith('/admin');
  return (
    <div className={`app ${consoleMode ? 'app-console' : 'app-workspace'}`}>
      <TopBar mode={consoleMode ? 'console' : 'workspace'} onMenu={() => setMenu((m) => !m)} />
      <div className="app-body">
        {consoleMode && <Sidebar open={menu} onNavigate={() => setMenu(false)} />}
        {consoleMode && menu && <div className="sidebar-scrim" onClick={() => setMenu(false)} />}
        <div className="app-content">
          {children}
          {!consoleMode && <footer className="ws-foot"><CompanyNotice /></footer>}
        </div>
      </div>
    </div>
  );
}
