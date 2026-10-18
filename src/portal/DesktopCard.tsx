import { useEffect, useRef, useState } from 'react';
import type { Desktop, PowerAction } from '../api/types';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { storageCodeText } from '../api/storage';
import { WorkStrip } from '../components/WorkParts';
import { OsLogo, osLogoKey, osLogoName } from '../components/OsLogo';
import { DesktopFiles } from './DesktopFiles';

export type OsFamily = 'windows' | 'linux' | 'other';

// Best guess from what the engine knows (OS text, VM name) - only picks the tile artwork.
export function osFamily(d: Desktop): OsFamily {
  const s = `${d.os ?? ''} ${d.name}`.toLowerCase();
  if (/win/.test(s)) return 'windows';
  if (/(linux|ubuntu|rocky|rhel|centos|debian|alma|vivado|petalinux|fedora)/.test(s)) return 'linux';
  return 'other';
}

const OS_LABEL: Record<OsFamily, string> = { windows: 'Windows', linux: 'Linux', other: '' };

export function relativeTime(iso: string | null | undefined, lang: string): string | null {
  if (!iso) return null;
  const sec = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang === 'ko' ? 'ko' : 'en', { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of steps) if (Math.abs(sec) >= size) return rtf.format(Math.round(sec / size), unit);
  return rtf.format(0, 'minute');
}

export function OsGlyph({ family, size = 22 }: { family: OsFamily; size?: number }) {
  if (family === 'windows') {
    return <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true"><path fill="currentColor" d="M6 9l15-2v15H6zm17-2.3L42 4v18H23zM6 25h15v15L6 38zm17 0h19v19l-19-2.7z" /></svg>;
  }
  if (family === 'linux') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 17l6-6-6-6" /><path d="M12 19h8" />
      </svg>
    );
  }
  return <Icon name="vm" size={size} />;
}

// The "screen" of a tile: a small drawing of the desktop (our own artwork, no vendor imagery).
function Screen({ d, family }: { d: Desktop; family: OsFamily }) {
  const { t } = useI18n();
  const on = d.state === 'ready' || d.state === 'in_use';
  return (
    <div className={`td-screen os-${family}${on ? ' on' : ''}`} aria-hidden="true">
      {on ? (
        <>
          <span className="scr-wall" />
          {family === 'linux' ? <span className="scr-panel" /> : <span className="scr-taskbar"><i /><i /><i /><i /></span>}
          <span className="scr-win" />
          {d.state === 'in_use' && <span className="scr-live"><span className="dot" />{t('portal.state.in_use')}</span>}
        </>
      ) : (
        <span className="scr-off"><Icon name={d.state === 'provisioning' ? 'refresh' : 'play'} size={22} /></span>
      )}
    </div>
  );
}

export function DesktopCard({ d, busy, fav, onFav, onConnect, onPower, error, hint, onChanged, warpgate }: {
  d: Desktop; busy: boolean; fav: boolean; onFav: () => void; onChanged?: () => void; warpgate?: boolean;
  onConnect: (p: 'vnc' | 'spice' | 'rdp' | 'wg-rdp' | 'wg-ssh') => void; onPower: (a: PowerAction) => void; error?: string; hint?: string;
}) {
  const { t, lang, pick } = useI18n();
  const family = osFamily(d);
  const logo = osLogoKey(d.os, d.name);
  const [menu, setMenu] = useState(false);
  const [files, setFiles] = useState(false);
  const filesOn = (d.policy?.desktop_files ?? 'off') !== 'off';
  const menuRef = useRef<HTMLDivElement>(null);
  const running = d.state === 'ready' || d.state === 'in_use';
  const last = relativeTime(d.last_connected, lang);
  const canPower = d.policy?.allow_power !== false;
  const hasCard = (d.resources ?? []).some((r) => r.kind === 'card');
  const cardOk = () => !hasCard || confirm(t('power.cardReset'));
  const autoStart = d.policy?.start_on_connect !== false;
  const folder = d.storage ? d.storage.folders.home ?? d.storage.folders.scratch ?? d.storage.folders.project : undefined;

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  return (
    <article className="dtile" id={`dtile-${d.id}`}>
      <header className="dtile-head">
        <span className="os-badge-logo"><OsLogo os={logo} size={36} /></span>
        <div className="dtile-title">
          <div className="dtile-name" title={d.name}>{d.name}</div>
          <div className="dtile-sub">{[d.os || osLogoName(logo) || OS_LABEL[family], d.pool].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" className={`icon-btn star${fav ? ' on' : ''}`} aria-pressed={fav}
          aria-label={t(fav ? 'portal.unfav' : 'portal.fav')} title={t(fav ? 'portal.unfav' : 'portal.fav')} onClick={onFav}>
          <Icon name="star" size={17} />
        </button>
        <div className="menu-wrap" ref={menuRef}>
          <button type="button" className="icon-btn" aria-label={t('portal.more')} aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}><Icon name="more" size={18} /></button>
          {menu && (
            <div className="menu" role="menu">
              {d.protocols.includes('spice') && (
                <button type="button" role="menuitem" disabled={busy || !running}
                  onClick={() => { setMenu(false); onConnect('spice'); }}>
                  <Icon name="download" size={16} />{t('portal.connectSpice')}
                </button>
              )}
              {d.protocols.includes('rdp') && (
                <button type="button" role="menuitem" disabled={busy || !running}
                  onClick={() => { setMenu(false); onConnect('rdp'); }}>
                  <Icon name="download" size={16} />{t('portal.connectRdp')}
                </button>
              )}
              {warpgate && (
                <button type="button" role="menuitem" disabled={busy || !running}
                  onClick={() => { setMenu(false); onConnect('wg-rdp'); }}>
                  <Icon name="globe" size={16} />{t('portal.connectWarpgate')}
                </button>
              )}
              {warpgate && family === 'linux' && (
                <button type="button" role="menuitem" disabled={busy || !running}
                  onClick={() => { setMenu(false); onConnect('wg-ssh'); }}>
                  <Icon name="globe" size={16} />{t('portal.connectWarpgateSsh')}
                </button>
              )}
              {filesOn && (
                <button type="button" role="menuitem" disabled={busy || !running} onClick={() => { setMenu(false); setFiles(true); }}>
                  <Icon name="box" size={16} />{pick({ ko: '파일', en: 'Files' })}
                </button>
              )}
              {!canPower ? null : running ? (
                <>
                  <button type="button" role="menuitem" disabled={busy}
                    onClick={() => { setMenu(false); if (confirm(t('power.shutdownConfirm')) && cardOk()) onPower('shutdown'); }}>
                    <Icon name="logout" size={16} />{t('power.shutdown')}
                  </button>
                  <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenu(false); if (cardOk()) onPower('reboot'); }}>
                    <Icon name="refresh" size={16} />{t('power.reboot')}
                  </button>
                  <button type="button" role="menuitem" className="danger" disabled={busy}
                    onClick={() => { setMenu(false); if (confirm(t('power.stopConfirm')) && cardOk()) onPower('stop'); }}>
                    <Icon name="info" size={16} />{t('power.stop')}
                  </button>
                </>
              ) : (
                <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenu(false); onPower('start'); }}>
                  <Icon name="play" size={16} />{t('power.start')}
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      <Screen d={d} family={family} />

      <div className="dtile-specs">
        {d.spec?.cpu ? <span><Icon name="cpu" size={14} />{d.spec.cpu} vCPU</span> : null}
        {d.spec?.memory_gb ? <span><Icon name="memory" size={14} />{d.spec.memory_gb} GB</span> : null}
        {d.gpu ? <span className="spec-accel"><Icon name="gpu" size={14} />{d.gpu.mode === 'vgpu' ? 'vGPU ' : ''}{d.gpu.label}</span> : null}
        {(d.resources ?? []).map((r) => (
          <span key={r.name} className="spec-accel"><Icon name={r.kind === 'card' ? 'fpga' : 'usb'} size={14} />{r.name}</span>
        ))}
      </div>

      {folder && d.storage && (
        <div className="dtile-folder" title={`${folder.nas}${d.storage.ok === false ? ` · ${storageCodeText(d.storage.code, (ko, en) => pick({ ko, en }))}` : ''}`}>
          <Icon name="layers" size={14} />
          <span className="muted">{pick({ ko: '내 폴더', en: 'My folder' })}</span>
          <code className="code">{family === 'windows' && folder.windows ? folder.windows : folder.linux}</code>
          {d.storage.ok === false && <span className="chip chip-warn">{pick({ ko: '확인 필요', en: 'Check' })}</span>}
        </div>
      )}
      {d.storage?.data_on_nas_only && (
        <div className="muted small dtile-note">{pick({ ko: '이 데스크톱은 처음 상태로 돌아갑니다 — 남길 파일은 내 폴더(NAS)에 저장하세요.',
          en: 'This desktop goes back to its base - keep files in your NAS folder.' })}</div>
      )}

      {d.work && (running || d.work.hold || d.work.deferrals.length > 0) && <WorkStrip deskId={d.id} work={d.work} onChanged={onChanged} />}

      {error && <div className="alert error small" role="alert">{error}</div>}
      {hint && <div className="alert info small">{hint}</div>}

      <footer className="dtile-foot">
        <div className="dtile-state">
          <span className={`pill st-${d.state}`}><span className="dot" />{t(`portal.state.${d.state}` as MessageKey)}</span>
          <span className="muted small">{last ? `${t('portal.lastConnected')} ${last}` : t('portal.never')}</span>
        </div>
        {d.state === 'stopped' && canPower && !autoStart ? (
          <button type="button" className="btn" disabled={busy} onClick={() => onPower('start')}>
            <Icon name="play" size={15} />{t('power.start')}
          </button>
        ) : d.protocols.includes('vnc') ? (
          <button type="button" className="btn primary" disabled={busy || !(running || (d.state === 'stopped' && autoStart))} onClick={() => onConnect('vnc')}>
            {t('portal.connect')}
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={busy || !running} onClick={() => onConnect('spice')}>
            {t('portal.connectSpice')}
          </button>
        )}
      </footer>
      {files && <DesktopFiles desktopId={d.id} name={d.name} onClose={() => setFiles(false)} />}
    </article>
  );
}
