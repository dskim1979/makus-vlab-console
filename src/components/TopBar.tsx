import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import { AboutDialog } from './AboutDialog';
import { BrandLockup } from './Brand';
import { Icon } from './Icon';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return s.toUpperCase();
}

// Dark top bar across the whole app: brand, where you are (workspace tabs or "admin
// console"), language, about and the user menu.
export function TopBar({ mode, onMenu }: { mode: 'workspace' | 'console'; onMenu: () => void }) {
  const { t, lang, setLang } = useI18n();
  const { user, logout, isAdmin } = useAuth();
  const [about, setAbout] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = user?.display_name || user?.username || '';

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <header className="topbar">
      {mode === 'console' && (
        <button type="button" className="tb-icon menu-btn" onClick={onMenu} aria-label={t('nav.menu')}>
          <Icon name="list" size={20} />
        </button>
      )}
      <Link to={mode === 'console' ? '/admin' : '/'} className="tb-brand">
        <BrandLockup markSize={26} />
        {mode === 'console' && <span className="tb-context">{t('nav.admin')}</span>}
      </Link>

      {mode === 'workspace' && (
        <nav className="tb-tabs" aria-label={t('nav.menu')}>
          <NavLink to="/" end>{t('nav.home')}</NavLink>
          <NavLink to="/resources">{t('nav.resources')}</NavLink>
        </nav>
      )}

      <div className="tb-right">
        {mode === 'workspace' && isAdmin && (
          <Link to="/admin" className="tb-link"><Icon name="gear" size={16} />{t('nav.admin')}</Link>
        )}
        {mode === 'console' && (
          <Link to="/" className="tb-link"><Icon name="vm" size={16} />{t('nav.workspace')}</Link>
        )}
        <button type="button" className="tb-icon" title={t('app.lang')} aria-label={t('app.lang')}
          onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}>
          <span className="tb-lang">{lang === 'ko' ? 'EN' : '한'}</span>
        </button>
        <button type="button" className="tb-icon" title={t('nav.about')} aria-label={t('nav.about')} onClick={() => setAbout(true)}>
          <Icon name="info" size={19} />
        </button>
        <div className="tb-user" ref={ref}>
          <button type="button" className="tb-user-btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
            <span className="avatar" aria-hidden="true">{initials(name)}</span>
            <span className="tb-user-name">{name}</span>
            <Icon name="chevron" size={14} />
          </button>
          {open && (
            <div className="menu tb-menu" role="menu">
              <div className="tb-menu-head">
                <span className="strong">{name}</span>
                <span className="muted small">{user?.email || user?.username}</span>
              </div>
              <button type="button" role="menuitem" onClick={() => { setOpen(false); setAbout(true); }}>
                <Icon name="info" size={16} />{t('nav.about')}
              </button>
              <button type="button" role="menuitem" className="danger" onClick={() => logout()}>
                <Icon name="logout" size={16} />{t('nav.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
      <AboutDialog open={about} onClose={() => setAbout(false)} />
    </header>
  );
}
