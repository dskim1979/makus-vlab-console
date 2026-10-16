import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useFeatures } from '../features';
import { useAuth } from '../auth/AuthContext';
import { useFeedbackUrl, useSupportUrl } from '../branding';
import { useI18n } from '../i18n';
import { useTheme, type ThemePref } from '../theme';
import { AboutDialog } from './AboutDialog';
import { BrandLockup } from './Brand';
import { Icon } from './Icon';
import { MyAccountDialog } from './MyAccountDialog';
import { TaskIndicator } from './TaskIndicator';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return s.toUpperCase();
}

// Dark top bar across the whole app: brand, where you are (workspace tabs or "admin
// console"), language, about and the user menu.
export function TopBar({ mode, onMenu }: { mode: 'workspace' | 'console'; onMenu: () => void }) {
  const { t, lang, setLang } = useI18n();
  const { on } = useFeatures();
  const { user, logout, isAdmin } = useAuth();
  const [about, setAbout] = useState(false);
  const [account, setAccount] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = user?.display_name || user?.username || '';
  const support = useSupportUrl();
  const feedback = useFeedbackUrl();
  const { pref, mode: theme, setPref } = useTheme();

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
          {(on('lab') || on('gpuai') || on('fpga')) && <NavLink to="/reserve">{t('nav.reserve')}</NavLink>}
          {on('data') && <NavLink to="/data">{t('nav.data')}</NavLink>}
        </nav>
      )}

      <div className="tb-right">
        {mode === 'workspace' && isAdmin && (
          <Link to="/admin" className="tb-link"><Icon name="gear" size={16} />{t('nav.admin')}</Link>
        )}
        {mode === 'console' && (
          <Link to="/" className="tb-link"><Icon name="vm" size={16} />{t('nav.workspace')}</Link>
        )}
        {user && <TaskIndicator console={mode === 'console'} admin={isAdmin} />}
        {mode === 'workspace' && (
          <a href={feedback} target="_blank" rel="noopener noreferrer" className="tb-link tb-support tb-feedback" title={t('sup.feedbackHint')}>
            <Icon name="info" size={16} /><span>{t('sup.feedback')}</span>
          </a>
        )}
        <a href={support} target="_blank" rel="noopener noreferrer" className="tb-link tb-support" title={t('sup.hint')}>
          <Icon name="support" size={16} /><span>{t('sup.remote')}</span>
        </a>
        <button type="button" className="tb-icon" title={t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark')}
          aria-label={t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark')} onClick={() => setPref(theme === 'dark' ? 'light' : 'dark')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
        </button>
        <button type="button" className="tb-icon" title={t('app.lang')} aria-label={t('app.lang')}
          onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}>
          <span className="tb-lang">{lang === 'ko' ? 'EN' : '한'}</span>
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
              <button type="button" role="menuitem" onClick={() => { setOpen(false); setAccount(true); }}>
                <Icon name="shield" size={16} />{t('nav.account')}
              </button>
              <div className="menu-label">{t('theme.title')}</div>
              <div className="theme-row" role="group" aria-label={t('theme.title')}>
                {(['system', 'light', 'dark'] as ThemePref[]).map((p) => (
                  <button key={p} type="button" className={pref === p ? 'on' : ''} aria-pressed={pref === p} onClick={() => setPref(p)}>
                    {t(`theme.${p}` as 'theme.system')}
                  </button>
                ))}
              </div>
              <a role="menuitem" href={support} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                <Icon name="support" size={16} />{t('sup.remote')}
              </a>
              <a role="menuitem" href={feedback} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                <Icon name="info" size={16} />{t('sup.feedback')}
              </a>
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
      <MyAccountDialog open={account} onClose={() => setAccount(false)} />
    </header>
  );
}
