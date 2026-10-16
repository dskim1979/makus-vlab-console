import { api } from '../api/client';
import { nextApi } from '../api/next';
import { FOLDER_KEYS, folderName, sizeText, storageApi, storageCodeText } from '../api/storage';
import { BuildJobsPanel } from '../admin/pages/NextPages';
import { Icon } from '../components/Icon';
import { LoadState } from '../components/LoadState';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';
import { UseChip } from '../components/WorkParts';

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
                  {l.use && <UseChip use={l.use} />}
                  {l.reclaim?.state === 'suggested' && (
                    <span className="chip chip-warn" title={L('오랫동안 사용률이 낮았습니다. 필요 없으면 반납해 주세요. 계속 쓰려면 데스크톱에서 "작업 중"을 켜 두세요.',
                      'Barely used for a long time. Give it back if you do not need it, or turn on "Working" on its desktop.')}>{L('회수 예정 안내', 'Reclaim suggested')}</span>
                  )}
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
              <h2 className="section-title">{L('내 폴더 (공유 NAS)', 'My folders (shared NAS)')}</h2>
              <p className="muted small" style={{ margin: 0 }}>{L('데스크톱 · 빌드 VM 어디서 접속해도 같은 폴더입니다. 홈은 매일 백업되고, 스크래치는 백업되지 않으며 빌드 작업 폴더는 보관 기간 뒤 지워집니다.',
                'The same folders from every desktop and build VM. Home is backed up daily; scratch is not, and build job folders go after the retention.')}</p>
            </div>
          </div>
          {folders.data.map((f) => (
            <div key={f.pool_id} className="folder-list">
              <div className="strong">{f.pool}
                {f.last && f.last.ok === false && <span className="chip chip-warn" style={{ marginLeft: 8 }}>{storageCodeText(f.last.code, L)}</span>}
                {f.last?.warnings.includes('LOCAL_ACCOUNT') && <span className="chip chip-accent" style={{ marginLeft: 8 }}>{storageCodeText('LOCAL_ACCOUNT', L)}</span>}
              </div>
              {f.data_on_nas_only && <div className="alert info small">{L('이 풀의 데스크톱은 처음 상태로 돌아갑니다. 데이터는 아래 NAS 폴더에만 남습니다.', "This pool's desktops go back to their base; data stays only in the NAS folders below.")}</div>}
              {FOLDER_KEYS.filter((k) => f.folders[k]).map((k) => {
                const x = f.folders[k]!;
                const used = f.usage[k];
                return (
                  <div key={k} className="folder-item">
                    <span className="strong">{folderName(k, L)}</span>
                    <span className="folder-paths">
                      <span><span className="muted small">Linux </span><code className="code">{x.linux}</code></span>
                      {x.windows && <span><span className="muted small">Windows </span><code className="code">{x.windows}</code></span>}
                      <span><span className="muted small">NAS </span><code className="code">{x.nas}</code></span>
                      {k === 'scratch' && x.retention_days ? <span className="muted small">{L(`빌드 작업 폴더 ${x.retention_days}일 보관`, `job folders kept ${x.retention_days} days`)}</span> : null}
                    </span>
                    <span className={x.quota_gb && used !== undefined && used > x.quota_gb * 1048576 ? 'chip chip-warn' : 'chip'}>
                      {used !== undefined ? sizeText(used) : L('사용량 미측정', 'not measured')}{x.quota_gb ? ` / ${x.quota_gb} GB` : ''}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      )}
      {jobs.state === 'ok' && jobs.data.pools.length > 0 && <BuildJobsPanel pools={jobs.data.pools} />}
    </main>
  );
}
