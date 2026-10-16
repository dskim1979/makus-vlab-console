import { useState } from 'react';
import { nextApi } from '../api/next';
import { Icon } from '../components/Icon';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';

// 외부 데스크톱: physical PCs an admin assigned to the user, opened with an .rdp file
// (through the RDP gateway when the admin set one).
export function ExternalDesktops() {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const list = useLoad(nextApi.myExternal);
  const [error, setError] = useState<string | null>(null);
  if (list.state !== 'ok' || list.data.length === 0) return null;

  async function rdp(id: string) {
    setError(null);
    try {
      const r = await nextApi.myExternalRdp(id);
      const url = URL.createObjectURL(new Blob([r.rdp], { type: 'application/x-rdp' }));
      const a = document.createElement('a');
      a.href = url; a.download = r.filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setError((e as Error).message); }
  }

  async function guac(id: string) {
    setError(null);
    try { window.open((await nextApi.myExternalGuac(id)).url, '_blank', 'noopener'); }
    catch (e) {
      const m = (e as Error).message;
      setError(/NO_GATEWAY/.test(m) ? L('브라우저 RDP 게이트웨이가 준비되지 않았습니다. 관리자에게 문의하세요.', 'No browser RDP gateway is set up. Ask your administrator.') : m);
    }
  }

  return (
    <section className="ext-section">
      <h2 className="section-title">{L('외부 데스크톱', 'External desktops')}</h2>
      <p className="muted small">{L('관리자가 배정한 실제 PC입니다. RDP 파일을 받아 열면 원격 데스크톱으로 접속합니다.', 'Physical PCs assigned to you. Open the .rdp file to connect with Remote Desktop.')}</p>
      {error && <div className="alert error small" role="alert">{error}</div>}
      <div className="ext-list">
        {list.data.map((e) => (
          <article key={e.id} className="ext-card">
            <span className="ext-icon"><Icon name="vm" size={20} /></span>
            <div className="ext-body"><h3>{e.name}</h3><span className="muted small">{e.notes || `${e.address}:${e.port}`}</span></div>
            <div className="ext-actions">
            <button type="button" className="btn connect" onClick={() => rdp(e.id)}><Icon name="download" size={16} />{L('RDP 파일 받기', 'Get RDP file')}</button>
            <button type="button" className="btn-ghost" onClick={() => guac(e.id)} title={L('설치 없이 브라우저에서 엽니다', 'Opens in the browser, nothing to install')}><Icon name="globe" size={16} />{L('브라우저', 'Browser')}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
