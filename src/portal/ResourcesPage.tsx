import { api } from '../api/client';
import { Icon } from '../components/Icon';
import { LoadState } from '../components/LoadState';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';

// 내 자원: accelerator cards, boards and desktops on loan to the user.
export function ResourcesPage() {
  const { t, lang } = useI18n();
  const leases = useLoad(api.myLeases);
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{t('portal.resourcesTitle')}</h1>
          <p className="muted">{t('portal.resourcesSub')}</p>
        </div>
        <div className="page-tools">
          <button type="button" className="btn" onClick={leases.reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
        </div>
      </div>
      {leases.state === 'error' && leases.status === 404 ? <div className="alert">{t('portal.notReady')}</div> : (
        <LoadState value={leases} retry={leases.reload}>
          {(list) => list.length === 0 ? <div className="empty"><p>{t('portal.noLeases')}</p></div> : (
            <div className="res-list">
              {list.map((l) => (
                <div key={l.id} className="res-item">
                  <span className="quick-icon"><Icon name={l.kind === 'gpu' ? 'gpu' : l.kind === 'card' || l.kind === 'fpga' ? 'fpga' : l.kind === 'usb' ? 'usb' : 'vm'} size={20} /></span>
                  <span className="strong">{l.name}</span>
                  {l.desktop && <span className="chip">{l.desktop}</span>}
                  {l.ends_at && (
                    <span className="muted small">
                      {t('portal.until')} {new Date(l.ends_at).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </LoadState>
      )}
    </main>
  );
}
