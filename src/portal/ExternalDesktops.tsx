import { useState } from 'react';
import { nextApi } from '../api/next';
import { warpgateApi } from '../api/warpgate';
import { Icon } from '../components/Icon';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';

// 외부 데스크톱: physical PCs an admin assigned to the user, opened with an .rdp file (through
// 보안 게이트웨이 when its RDP switch is on) or, with 보안 게이트웨이 on, in the browser.
export function ExternalDesktops() {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const list = useLoad(nextApi.myExternal);
  const wg = useLoad(warpgateApi.myStatus);
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

  async function web(id: string) {
    setError(null);
    try { window.open((await nextApi.myExternalWeb(id)).url, '_blank', 'noopener'); }
    catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === 'WG_DOWN' || code === 'WG_OFF' ? L('보안 게이트웨이에 연결할 수 없습니다.', 'The security gateway is not reachable.') : (e as Error).message);
    }
  }

  return (
    <section className="ext-section">
      <h2 className="section-title">{L('외부 데스크톱', 'External desktops')}</h2>
      <p className="muted small">{L('관리자가 배정한 실제 PC입니다.', 'Physical PCs assigned to you.')}</p>
      {error && <div className="alert error small" role="alert">{error}</div>}
      <div className="ext-list">
        {list.data.map((e) => (
          <article key={e.id} className="ext-card">
            <span className="ext-icon"><Icon name="vm" size={20} /></span>
            <div className="ext-body"><h3>{e.name}</h3><span className="muted small">{e.notes || `${e.address}:${e.port}`}</span></div>
            <div className="ext-actions">
            <button type="button" className="btn connect" onClick={() => rdp(e.id)}><Icon name="download" size={16} />{L('RDP 파일 받기', 'Get RDP file')}</button>
            {wg.state === 'ok' && wg.data.enabled && (
              <button type="button" className="btn-ghost" onClick={() => web(e.id)} title={L('보안 게이트웨이로 브라우저에서 엽니다', 'Opens in the browser through the security gateway')}><Icon name="globe" size={16} />{L('브라우저', 'Browser')}</button>
            )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
