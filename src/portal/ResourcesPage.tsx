import { api } from '../api/client';
import { nextApi } from '../api/next';
import { storageApi, storageCodeText } from '../api/storage';
import { BuildJobsPanel } from '../admin/pages/NextPages';
import { Icon } from '../components/Icon';
import { LoadState } from '../components/LoadState';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';

// 내 자원: accelerator cards, boards and desktops on loan to the user.
export function ResourcesPage() {
  const { t, lang, pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const leases = useLoad(api.myLeases);
  const jobs = useLoad(nextApi.myJobs);
  const folders = useLoad(storageApi.mine);
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
      {folders.state === 'ok' && folders.data.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <span className="stat-icon tone-blue"><Icon name="layers" size={18} /></span>
            <div>
              <h2 className="section-title">{L('내 빌드 폴더', 'My build folders')}</h2>
              <p className="muted small" style={{ margin: 0 }}>{L('공유 NAS에 있는 내 폴더입니다. 데스크톱 · 빌드 VM 어디서 접속해도 같은 폴더가 보이니 빌드 데이터는 여기에 두세요. 나만 읽고 쓸 수 있습니다.',
                'Your folder on the shared NAS. Every desktop and build VM sees the same folder, so keep build data here. Only you can read and write it.')}</p>
            </div>
          </div>
          <div className="folder-list">
            {folders.data.map((f) => (
              <div key={f.pool_id} className="folder-item">
                <span className="strong">{f.pool}</span>
                <span className="folder-paths">
                  <span><span className="muted small">Linux </span><code className="code">{f.paths.linux}</code></span>
                  {f.paths.windows && <span><span className="muted small">Windows </span><code className="code">{f.paths.windows}</code></span>}
                  <span><span className="muted small">NAS </span><code className="code">{f.paths.nas}</code></span>
                </span>
                {f.last ? <span className={f.last.ok ? 'chip chip-on' : f.last.ok === false ? 'chip chip-warn' : 'chip'}
                  title={storageCodeText(f.last.code, L)}>{f.last.ok ? L('준비됨', 'Ready') : f.last.ok === false ? storageCodeText(f.last.code, L) : L('대기', 'Pending')}</span>
                  : <span className="chip">{L('첫 접속 때 만들어짐', 'Made on first connect')}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
      {jobs.state === 'ok' && jobs.data.pools.length > 0 && <BuildJobsPanel pools={jobs.data.pools} />}
    </main>
  );
}
