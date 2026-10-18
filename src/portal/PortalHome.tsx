import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { PortalInstallButtons } from '../admin/pages/TerminalEnroll';
import { api } from '../api/client';
import { storageCodeText } from '../api/storage';
import { warpgateApi } from '../api/warpgate';
import type { ClientConfig, Clipboard, Desktop, PowerAction } from '../api/types';
import { BRAND } from '../brand';
import { Icon } from '../components/Icon';
import { LoadState } from '../components/LoadState';
import { StateBadge } from '../components/StateBadge';
import { useLoad } from '../components/useLoad';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { DesktopCard, relativeTime } from './DesktopCard';
import { ExternalDesktops } from './ExternalDesktops';
import { certDone, GatewayCertDialog, loadGatewayCert, type GatewayCert } from './GatewayCert';
import { MyPools } from './MyPools';
import { WebIdePanel } from './WebIde';
import { useFeatures } from '../features';

// noVNC is only loaded when a console is opened
const ConsoleWindow = lazy(() => import('./ConsoleWindow'));

const VIEW_KEY = 'vlab.portal.view';
function savedView(): 'grid' | 'list' {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
}

// User portal home: quick actions, greeting, the user's desktops as cards or a list.
export function PortalHome() {
  const { on } = useFeatures();
  const { t, lang, pick } = useI18n();
  const { user } = useAuth();
  const desktops = useLoad(api.myDesktops);
  const [view, setView] = useState<'grid' | 'list'>(savedView);
  const [help, setHelp] = useState(false);
  const [client, setClient] = useState<ClientConfig | null>(null);
  useEffect(() => { let live = true; api.clientConfig().then((c) => { if (live) setClient(c); }); return () => { live = false; }; }, []);
  const [wgOn, setWgOn] = useState(false);
  useEffect(() => { let live = true; warpgateApi.myStatus().then((s) => { if (live) setWgOn(s.enabled); }).catch(() => {}); return () => { live = false; }; }, []);
  const [open, setOpen] = useState<{ title: string; wsPath: string; password: string; sessionId: string; clipboard: Clipboard } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [hint, setHint] = useState<{ id: string; text: string; link?: { href: string; label: string } } | null>(null);
  // the devices route on a PC that has not trusted the gateway yet: ask first, then get the .rdp
  const [certAsk, setCertAsk] = useState<{ d: Desktop; cert: GatewayCert | null } | null>(null);

  function pickView(v: 'grid' | 'list') {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* per-browser convenience only */ }
  }

  async function connect(d: Desktop, protocol: 'vnc' | 'spice' | 'rdp' | 'wg-rdp' | 'wg-ssh') {
    setBusy(d.id); setError(null); setHint(null);
    if (protocol === 'wg-rdp' || protocol === 'wg-ssh') {
      try {
        const conn = await warpgateApi.connect(d.id, protocol === 'wg-ssh' ? 'ssh' : 'rdp');
        window.open(conn.browser_url, '_blank', 'noopener');
        setHint({ id: d.id, text: t('portal.warpgateHint') });
      } catch (e) {
        const code = (e as { code?: string }).code;
        setError({ id: d.id, text: code && (code.startsWith('NO_') || code === 'WG_DOWN') ? t(`portal.err.${code}` as MessageKey) : (e as Error).message });
      } finally { setBusy(null); }
      return;
    }
    try {
      const c = await api.connect(d.id, protocol);
      // 공유 저장소: the build folder could not be prepared - say so, the session still opens
      if (c.storage && c.storage.ok === false) {
        setError({ id: d.id, text: `${pick({ ko: '내 빌드 폴더를 준비하지 못했습니다', en: 'Your build folder is not ready' })}: ${storageCodeText(c.storage.code, (ko, en) => pick({ ko, en }))}` });
      }
      if (c.type === 'vnc') {
        setOpen({ title: d.name, wsPath: c.ws_path, password: c.password, sessionId: c.session_id, clipboard: c.clipboard ?? 'both' });
      } else if (c.type === 'rdp') {
        if (c.via === 'rdpgw') {
          const cert = await loadGatewayCert(c.cert_url);
          if (!certDone(cert)) { setCertAsk({ d, cert }); return; }
        }
        const url = URL.createObjectURL(new Blob([c.rdp], { type: 'application/x-rdp' }));
        const a = document.createElement('a');
        a.href = url; a.download = c.filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        if (c.via === 'rdpgw') setHint({ id: d.id, text: t('portal.rdpHintDevices'), link: c.cert_url ? { href: c.cert_url, label: t('portal.certLink') } : undefined });
        else setHint({ id: d.id, text: t(c.via === 'warpgate' ? 'portal.rdpHintWarpgate' : 'portal.rdpHint') });
      } else {
        // the .vv carries a one-time ticket: hand it straight to the browser as a download
        const url = URL.createObjectURL(new Blob([c.vv], { type: 'application/x-virt-viewer' }));
        const a = document.createElement('a');
        a.href = url; a.download = c.filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setHint({ id: d.id, text: t('portal.spiceHint') });
        api.endSession(c.session_id);
      }
    } catch (e) {
      const code = (e as Error).message;
      if (code === 'STARTING') {
        setHint({ id: d.id, text: t('portal.starting') });
        [4000, 10000, 20000].forEach((ms) => setTimeout(() => desktops.reload(), ms));
        return;
      }
      if (code === 'NO_IP' || code === 'NO_GATEWAY' || code === 'WG_DOWN' || code === 'RDPGW_OFF') { setError({ id: d.id, text: t(`portal.err.${code}` as MessageKey) }); return; }
      const known = code === 'VM_STOPPED' || code === 'NO_SPICE';
      setError({ id: d.id, text: known ? t(`portal.err.${code}` as MessageKey) : `${t('portal.err.generic')}: ${code}` });
    } finally {
      setBusy(null);
    }
  }

  async function power(d: Desktop, action: PowerAction) {
    setBusy(d.id); setError(null); setHint(null);
    try {
      await api.power(d.id, action);
      setHint({ id: d.id, text: t('power.sent') });
      // the guest takes a moment; look again a few times
      [3000, 8000, 15000].forEach((ms) => setTimeout(() => desktops.reload(), ms));
    } catch (e) {
      const msg = (e as { body?: { code?: string } }).body?.code === 'POWER_OFF' ? t('power.off') : `${t('power.failed')}: ${(e as Error).message}`;
      setError({ id: d.id, text: msg });
    } finally {
      setBusy(null);
      desktops.reload();
    }
  }

  const close = useCallback(() => {
    setOpen((o) => { if (o) api.endSession(o.sessionId); return null; });
    desktops.reload();   // last-connected moved
  }, [desktops.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = user?.display_name || user?.username || '';
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | 'fav' | 'on'>('all');
  const favKey = `vlab.fav.${user?.username ?? ''}`;
  const [favs, setFavs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(favKey) || '[]'); } catch { return []; } });
  function toggleFav(id: string) {
    setFavs((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      try { localStorage.setItem(favKey, JSON.stringify(next)); } catch { /* per-browser convenience only */ }
      return next;
    });
  }
  const hour = new Date().getHours();
  const greet = t(hour < 12 ? 'portal.morning' : hour < 18 ? 'portal.afternoon' : 'portal.evening');
  const today = new Date().toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const all = desktops.state === 'ok' ? desktops.data : [];
  const isOn = (d: Desktop) => d.state === 'ready' || d.state === 'in_use';
  const counts = { all: all.length, fav: all.filter((d) => favs.includes(d.id)).length, on: all.filter(isOn).length };

  return (
    <main className="ws">
      <section className="ws-hero">
        <div className="ws-hero-in">
          <div className="ws-greet">
            <p className="ws-date">{today}</p>
            <h1>{greet}, {name}{lang === 'ko' ? '님' : ''}</h1>
            <p className="ws-sub">{t('portal.welcomeSub')}</p>
          </div>
          <label className="ws-search">
            <Icon name="search" size={18} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('portal.search')} aria-label={t('portal.search')} />
          </label>
        </div>
      </section>

      <div className="ws-body">
        <div className="ws-bar">
          <div className="ws-tabs" role="tablist">
            {(['all', 'fav', 'on'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {t(k === 'all' ? 'portal.tabAll' : k === 'fav' ? 'portal.tabFav' : 'portal.tabOn')}<span className="count">{counts[k]}</span>
              </button>
            ))}
          </div>
          <div className="ws-tools">
            <button type="button" className={`btn-ghost${help ? ' on' : ''}`} aria-expanded={help} onClick={() => setHelp((h) => !h)}>
              <Icon name="book" size={16} />{t('quick.help')}
            </button>
            <PortalInstallButtons fallbackHref={client?.download_url || BRAND.clientDownload} version={client?.latest_version ?? undefined}
              label={t('quick.client')} title={t('quick.clientDesc')} />
            <div className="seg" role="group" aria-label={t('portal.viewGrid')}>
              <button type="button" className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'}
                title={t('portal.viewGrid')} aria-label={t('portal.viewGrid')} onClick={() => pickView('grid')}><Icon name="grid" size={16} /></button>
              <button type="button" className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'}
                title={t('portal.viewList')} aria-label={t('portal.viewList')} onClick={() => pickView('list')}><Icon name="list" size={16} /></button>
            </div>
            <button type="button" className="icon-btn" title={t('common.refresh')} aria-label={t('common.refresh')} onClick={desktops.reload}><Icon name="refresh" size={17} /></button>
          </div>
        </div>
        {help && (
          <div className="help-box">
            <p><Icon name="globe" size={16} /> {t('help.browser')}</p>
            <p><Icon name="download" size={16} /> {t('help.spice')}</p>
          </div>
        )}

        {desktops.state === 'error' && desktops.status === 404 ? (
          <div className="alert">{t('portal.notReady')}</div>
        ) : (
          <LoadState value={desktops} retry={desktops.reload}>
            {(source) => {
              const needle = q.trim().toLowerCase();
              const list = source
                .filter((d) => (tab === 'all' || (tab === 'fav' ? favs.includes(d.id) : isOn(d)))
                  && (!needle || [d.name, d.pool, d.os ?? ''].some((x) => x.toLowerCase().includes(needle))))
                .sort((a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id)));
              return source.length === 0 ? (
              <div className="empty">
                <p>{t('portal.empty')}</p>
                <p className="muted small">{t('portal.emptyHint')}</p>
              </div>
            ) : list.length === 0 ? (
              <div className="empty"><p>{t('portal.noMatch')}</p></div>
            ) : view === 'grid' ? (
              <div className="dtiles">
                {list.map((d) => (
                  <DesktopCard key={d.id} d={d} busy={busy === d.id} fav={favs.includes(d.id)} onFav={() => toggleFav(d.id)}
                    onConnect={(p) => connect(d, p)} onPower={(a) => power(d, a)} onChanged={desktops.reload} warpgate={wgOn}
                    error={error?.id === d.id ? error.text : undefined} hint={hint?.id === d.id ? hint.text : undefined}
                    hintLink={hint?.id === d.id ? hint.link : undefined} />
                ))}
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('desk.name')}</th><th>{t('desk.pool')}</th><th>{t('desk.state')}</th>
                    <th>{t('portal.lastConnected')}</th><th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((d) => {
                    const running = d.state === 'ready' || d.state === 'in_use';
                    return (
                      <tr key={d.id}>
                        <td className="strong">{d.name}</td>
                        <td>{d.pool}</td>
                        <td><StateBadge state={d.state} /></td>
                        <td>{relativeTime(d.last_connected, lang) ?? <span className="muted">{t('portal.never')}</span>}</td>
                        <td className="actions">
                          {d.state === 'stopped' && (
                            <button type="button" className="btn connect" disabled={busy === d.id}
                              onClick={() => power(d, 'start')}><Icon name="play" size={16} />{t('power.start')}</button>
                          )}
                          {d.protocols.includes('spice') && running && (
                            <button type="button" className="btn-ghost" disabled={busy === d.id}
                              onClick={() => connect(d, 'spice')}>{t('portal.connectSpice')}</button>
                          )}
                          {d.protocols.includes('vnc') && running && (
                            <button type="button" className="btn connect" disabled={busy === d.id}
                              onClick={() => connect(d, 'vnc')}><Icon name="vm" size={16} />{t('portal.connect')}</button>
                          )}
                          {error?.id === d.id && <div className="alert error small">{error.text}</div>}
                          {hint?.id === d.id && <div className="alert info small">{hint.text}{hint.link && <> <a href={hint.link.href} download>{hint.link.label}</a></>}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
            }}
          </LoadState>
        )}
        {on('gpuai') && <WebIdePanel />}
        <MyPools onOpen={(id) => { desktops.reload(); setTimeout(() => document.getElementById(`dtile-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 600); }} />
        <ExternalDesktops />
      </div>

      {open && (
        <Suspense fallback={<div className="console-backdrop"><p className="muted">{t('console.connecting')}</p></div>}>
          <ConsoleWindow title={open.title} wsPath={open.wsPath} password={open.password} clipboard={open.clipboard} onClose={close} />
        </Suspense>
      )}
      {certAsk && <GatewayCertDialog cert={certAsk.cert} onClose={() => setCertAsk(null)}
        onRdp={() => { const d = certAsk.d; setCertAsk(null); void connect(d, 'rdp'); }} />}
    </main>
  );
}
