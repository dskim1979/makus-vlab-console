import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc/lib/rfb';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/messages';

type Status = 'connecting' | 'connected' | 'disconnected' | 'authFailed';

// In-browser console (noVNC) over the engine's VNC websocket. The websocket path comes
// from /api/vlab/desktops/<id>/connect; vlab-proxy (or the Vite dev proxy) routes it to
// the engine's VNC port on this same origin.
export default function ConsoleWindow({ title, wsPath, password, onClose }: {
  title: string; wsPath: string; password: string; onClose: () => void;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [status, setStatus] = useState<Status>('connecting');

  useEffect(() => {
    if (!box.current) return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    let r: RFB;
    try {
      r = new RFB(box.current, `${scheme}://${location.host}${wsPath}`, { credentials: { password } });
    } catch {
      setStatus('disconnected');
      return;
    }
    r.scaleViewport = true;
    r.resizeSession = true;
    r.addEventListener('connect', () => { setStatus('connected'); r.focus(); });
    r.addEventListener('disconnect', () => setStatus((s) => (s === 'authFailed' ? s : 'disconnected')));
    r.addEventListener('securityfailure', () => setStatus('authFailed'));
    rfb.current = r;
    return () => { try { r.disconnect(); } catch { /* already closed */ } rfb.current = null; };
  }, [wsPath, password]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.fullscreenElement && status !== 'connected') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, onClose]);

  const label: Record<Status, MessageKey> = {
    connecting: 'console.connecting', connected: 'console.connected',
    disconnected: 'console.disconnected', authFailed: 'console.authFailed',
  };

  return (
    <div className="console-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="console-frame" ref={frame}>
        <div className="console-bar">
          <span className="strong">{title}</span>
          <span className={`console-status st-${status}`}>{t(label[status])}</span>
          <span className="console-actions">
            <button type="button" className="btn-ghost" disabled={status !== 'connected'}
              onClick={() => rfb.current?.sendCtrlAltDel()}>{t('console.cad')}</button>
            <button type="button" className="btn-ghost"
              onClick={() => frame.current?.requestFullscreen?.().catch(() => undefined)}>{t('console.fullscreen')}</button>
            <button type="button" className="btn" onClick={onClose}>{t('console.close')}</button>
          </span>
        </div>
        <div className="console-screen" ref={box} />
      </div>
    </div>
  );
}
