import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { Clipboard, KioskInfo } from '../api/types';
import { useSupportUrl } from '../branding';
import { BrandLockup } from '../components/Brand';
import { CompanyNotice } from '../components/CompanyNotice';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/messages';

const ConsoleWindow = lazy(() => import('../portal/ConsoleWindow'));

// /kiosk: a LAB's PC in full screen. Set up once with the terminal key an admin made in
// 단말 관리; then it shows the room, the clock and the session, and whoever signs in gets a
// desktop of that session in full screen. Closing it signs them out for the next person.

const KEY = 'moavi-terminal-key';
const readKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const writeKey = (k: string | null) => { try { if (k) localStorage.setItem(KEY, k); else localStorage.removeItem(KEY); } catch { /* this visit only */ } };

type Open = { title: string; wsPath: string; password: string; sessionId: string; clipboard: Clipboard };

export function KioskPage() {
  const { t } = useI18n();
  const [key, setKey] = useState(readKey);
  const [info, setInfo] = useState<KioskInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [bye, setBye] = useState(false);

  const load = useCallback(async () => {
    if (!key) return;
    try { setInfo(await api.kiosk(key)); setProblem(null); }
    catch (e) {
      const code = (e as ApiError).message;
      setProblem(code === 'BAD_KEY' ? t('kiosk.badKey') : code === 'NO_LAB' ? t('kiosk.noLab') : t('kiosk.offline'));
    }
  }, [key, t]);
  useEffect(() => { load(); const h = setInterval(load, 30_000); return () => clearInterval(h); }, [load]);
  useEffect(() => { if (!bye) return; const h = setTimeout(() => setBye(false), 6000); return () => clearTimeout(h); }, [bye]);

  async function finish() {
    if (open) await api.endSession(open.sessionId);
    setOpen(null);
    await api.logout();
    setBye(true);
    load();
  }

  if (!key) return <KioskSetup onDone={(k) => { writeKey(k); setKey(k); }} />;

  return (
    <div className="kiosk">
      <KioskHead info={info} />
      <main className="kiosk-main">
        <Session info={info} problem={problem} />
        <KioskSignIn kioskKey={key} disabled={!info?.current} onOpen={setOpen} />
      </main>
      <KioskFoot onReset={() => { if (confirm(t('kiosk.resetConfirm'))) { writeKey(null); setKey(''); setInfo(null); } }} />
      {bye && <div className="kiosk-toast" role="status">{t('kiosk.bye')}</div>}
      {open && (
        <Suspense fallback={<div className="console-backdrop"><p className="muted">{t('console.connecting')}</p></div>}>
          <ConsoleWindow title={open.title} wsPath={open.wsPath} password={open.password} clipboard={open.clipboard} onClose={finish} />
        </Suspense>
      )}
    </div>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const h = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(h); }, []);
  return now;
}

function KioskHead({ info }: { info: KioskInfo | null }) {
  const { lang } = useI18n();
  const now = useClock();
  const loc = lang === 'ko' ? 'ko-KR' : 'en-US';
  return (
    <header className="kiosk-head">
      <div className="kiosk-brand"><BrandLockup markSize={30} /></div>
      <div className="kiosk-room">
        <span className="kiosk-room-name">{info?.lab.name ?? ''}</span>
        <span className="kiosk-room-sub">{[info?.lab.location, info?.terminal.name].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="kiosk-clock">
        <span className="kiosk-time">{now.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
        <span className="kiosk-date">{now.toLocaleDateString(loc, { month: 'long', day: 'numeric', weekday: 'long' })}</span>
      </div>
    </header>
  );
}

function Session({ info, problem }: { info: KioskInfo | null; problem: string | null }) {
  const { t } = useI18n();
  const hhmm = (iso: string) => iso.slice(11, 16);
  if (problem) return <section className="kiosk-session"><div className="kiosk-state warn">{problem}</div></section>;
  if (!info) return <section className="kiosk-session"><p className="muted">{t('kiosk.loading')}</p></section>;
  const c = info.current, n = info.next;
  return (
    <section className="kiosk-session" aria-live="polite">
      {c ? (
        <>
          <span className={`kiosk-state ${c.preparing ? 'prep' : 'on'}`}>{t(c.preparing ? 'kiosk.preparing' : 'kiosk.inSession')}</span>
          <h1 className="kiosk-title">{c.title || t('lab.untitled')}</h1>
          <p className="kiosk-when">{hhmm(c.start)} – {hhmm(c.end)}{c.pool ? ` · ${c.pool}` : ''}</p>
          <p className="kiosk-hint">{t('kiosk.signInHint')}</p>
        </>
      ) : (
        <>
          <span className="kiosk-state idle">{t('kiosk.noSession')}</span>
          <h1 className="kiosk-title">{t('kiosk.free')}</h1>
          <p className="kiosk-hint">{t('kiosk.noSessionHint')}</p>
        </>
      )}
      {n && (
        <div className="kiosk-next">
          <span className="field-label">{t('lab.next')}</span>
          <span className="strong">{n.title || t('lab.untitled')}</span>
          <span className="muted">{new Date(n.start).toDateString() === new Date().toDateString() ? t('lab.today') : n.start.slice(5, 10).replace('-', '/')} {hhmm(n.start)} – {hhmm(n.end)}</span>
        </div>
      )}
    </section>
  );
}

function KioskSignIn({ kioskKey, disabled, onOpen }: { kioskKey: string; disabled: boolean; onOpen: (o: Open) => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api.login(username.trim(), password, needTotp ? { totp } : {});
      if (r.kind === 'second_factor') { setNeedTotp(true); return; }
      if (r.kind === 'error') { setError(t(r.reason === 'locked' ? 'login.errLocked' : r.reason === 'network' ? 'login.errNetwork' : 'login.errInvalid')); return; }
      const s = await api.kioskStart(kioskKey);
      const c = await api.connect(s.desktop.id, 'vnc');
      if (c.type !== 'vnc') throw new ApiError(500, 'vnc');
      setPassword(''); setTotp(''); setNeedTotp(false); setUsername('');
      onOpen({ title: `${s.desktop.name} · ${s.lab.name}`, wsPath: c.ws_path, password: c.password, sessionId: c.session_id, clipboard: c.clipboard ?? 'both' });
    } catch (err) {
      const code = (err as ApiError).message;
      const known: Record<string, MessageKey> = { FULL: 'kiosk.full', NO_SESSION: 'kiosk.noSession', BAD_KEY: 'kiosk.badKey', STARTING: 'kiosk.starting' };
      setError(known[code] ? t(known[code]) : code || t('kiosk.offline'));
      await api.logout();
    } finally { setBusy(false); }
  }

  return (
    <form className="kiosk-signin" onSubmit={submit}>
      <h2>{t('kiosk.signIn')}</h2>
      <label><span>{t('login.username' as MessageKey)}</span>
        <input id="kiosk-user" autoComplete="off" value={username} disabled={disabled} onChange={(e) => setUsername(e.target.value)} /></label>
      <label><span>{t('login.password' as MessageKey)}</span>
        <input id="kiosk-pass" type="password" autoComplete="off" value={password} disabled={disabled} onChange={(e) => setPassword(e.target.value)} /></label>
      {needTotp && <label><span>{t('kiosk.totp')}</span><input id="kiosk-totp" inputMode="numeric" value={totp} onChange={(e) => setTotp(e.target.value)} /></label>}
      {error && <div className="alert error small" role="alert">{error}</div>}
      <button type="submit" className="btn primary kiosk-go" disabled={disabled || busy || !username.trim() || !password}>
        <Icon name="play" size={18} />{t(busy ? 'kiosk.starting' : 'kiosk.start')}</button>
      <p className="muted small">{t('kiosk.privacy')}</p>
    </form>
  );
}

function KioskFoot({ onReset }: { onReset: () => void }) {
  const { t } = useI18n();
  const support = useSupportUrl();
  return (
    <footer className="kiosk-foot">
      <CompanyNotice />
      <a href={support} target="_blank" rel="noopener noreferrer"><Icon name="support" size={15} />{t('sup.remote')}</a>
      <button type="button" className="btn-ghost small-btn" onClick={onReset}>{t('kiosk.reset')}</button>
    </footer>
  );
}

function KioskSetup({ onDone }: { onDone: (key: string) => void }) {
  const { t } = useI18n();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.kiosk(key.trim()); onDone(key.trim()); }
    catch (err) { const c = (err as ApiError).message; setError(c === 'BAD_KEY' ? t('kiosk.badKey') : c === 'NO_LAB' ? t('kiosk.noLab') : t('kiosk.offline')); }
    finally { setBusy(false); }
  }
  return (
    <div className="kiosk kiosk-setup">
      <form className="kiosk-signin" onSubmit={submit}>
        <BrandLockup markSize={30} />
        <h2>{t('kiosk.setupTitle')}</h2>
        <p className="muted">{t('kiosk.setupHint')}</p>
        <label><span>{t('kiosk.key')}</span><input id="kiosk-key" autoComplete="off" spellCheck={false} placeholder="mdt_…" value={key} onChange={(e) => setKey(e.target.value)} /></label>
        {error && <div className="alert error small" role="alert">{error}</div>}
        <button type="submit" className="btn primary kiosk-go" disabled={busy || !key.trim()}>{t('kiosk.setupSave')}</button>
      </form>
    </div>
  );
}
