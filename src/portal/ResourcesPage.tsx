import { api } from '../api/client';
import { nextApi } from '../api/next';
import type { BoardConn, MyBoard } from '../api/next';
import { useState } from 'react';
import { FOLDER_KEYS, folderName, sizeText, storageApi, storageCodeText } from '../api/storage';
import { BuildJobsPanel } from '../admin/pages/NextPages';
import { useFeatures } from '../features';
import { Icon } from '../components/Icon';
import { LoadState } from '../components/LoadState';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';
import { UseChip } from '../components/WorkParts';
import { MyGpuCard } from './WebIde';

// 내 자원: accelerator cards, boards and desktops on loan to the user.
export function ResourcesPage() {
  const { on } = useFeatures();
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
      {on('fpga') && <MyBoardsPanel />}
      {on('gpuai') && <MyGpuCard />}
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
      {on('fpga') && jobs.state === 'ok' && jobs.data.pools.length > 0 && <BuildJobsPanel pools={jobs.data.pools} />}
    </main>
  );
}

// 내 보드 (JTAG): boards lent to me. A network board (hw_server / XVC / Quartus jtagd) is dialled from the
// tool inside the desktop, so it works over RDP, Warpgate or SPICE; a USB board is on the desktop already.
function MyBoardsPanel() {
  const { lang, pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const boards = useLoad(nextApi.myBoards);
  if (boards.state !== 'ok' || boards.data.length === 0) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="stat-icon tone-blue"><Icon name="fpga" size={18} /></span>
        <div>
          <h2 className="section-title">{L('내 보드 (JTAG)', 'My boards (JTAG)')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{L('네트워크 보드는 데스크톱 안의 Vivado · Quartus에서 아래 주소로 접속합니다. 화면 프로토콜(RDP · SPICE · Warpgate)과 상관없이 됩니다.',
            'Open Vivado or Quartus inside your desktop and connect to the address below; any display protocol (RDP, SPICE, Warpgate) works.')}</p>
        </div>
      </div>
      {boards.data.map((b: MyBoard) => (
        <div key={b.id} className="folder-list">
          <div className="strong">{b.name}
            {b.kind && <span className="muted small" style={{ marginLeft: 8 }}>{b.kind}</span>}
            {b.desktop && <span className="chip" style={{ marginLeft: 8 }}>{b.desktop.name}</span>}
            {b.lease_until && <span className="muted small" style={{ marginLeft: 8 }}>{L('반납', 'until')} {new Date(b.lease_until).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
          </div>
          {b.connection ? <BoardConnView c={b.connection} L={L} />
            : <p className="muted small">{L('USB로 데스크톱에 연결되어 있습니다. 데스크톱 안에서 그대로 쓰세요.', 'Attached to the desktop over USB; use it inside the desktop.')}</p>}
        </div>
      ))}
    </section>
  );
}

const PROTO: Record<BoardConn['protocol'], string> = { hw_server: 'Xilinx hw_server', xvc: 'Xilinx Virtual Cable (XVC)', quartus: 'Intel Quartus jtagd' };

function CopyText({ text, L }: { text: string; L: (ko: string, en: string) => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="folder-paths">
      <code className="code">{text}</code>
      <button type="button" className="btn-ghost small-btn" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => setCopied(false)); }}>
        {copied ? L('복사됨', 'Copied') : L('복사', 'Copy')}</button>
    </span>
  );
}

function BoardConnView({ c, L }: { c: BoardConn; L: (ko: string, en: string) => string }) {
  const tcl = c.protocol === 'hw_server' ? `connect_hw_server -url ${c.endpoint}`
    : c.protocol === 'xvc' ? `open_hw_target -xvc_url ${c.endpoint}` : `jtagconfig --addserver ${c.host} <password>`;
  const steps = c.protocol === 'hw_server'
    ? L(`Vivado › Hardware Manager › Open Target › Open New Target › Remote server 선택 › 호스트 ${c.host}, 포트 ${c.port ?? 3121}`,
      `Vivado › Hardware Manager › Open Target › Open New Target › Remote server › host ${c.host}, port ${c.port ?? 3121}`)
    : c.protocol === 'xvc'
      ? L(`Vivado › Hardware Manager › Open Target › Open New Target(Local server) 뒤, localhost를 오른쪽 클릭 › Add Xilinx Virtual Cable (XVC) › 호스트 ${c.host}, 포트 ${c.port ?? 2542}`,
        `Vivado › Hardware Manager › Open New Target (local server), then right-click localhost › Add Xilinx Virtual Cable (XVC) › host ${c.host}, port ${c.port ?? 2542}`)
      : L(`Quartus Programmer › Hardware Setup › JTAG Settings › Add Server › 서버 ${c.host}, 관리자에게 받은 암호 (jtagd 포트 ${c.port ?? 1309})`,
        `Quartus Programmer › Hardware Setup › JTAG Settings › Add Server › server ${c.host} and the password from your admin (jtagd port ${c.port ?? 1309})`);
  return (
    <div className="folder-item">
      <span className="strong">{PROTO[c.protocol]}{c.label ? ` · ${c.label}` : ''}</span>
      <span className="folder-paths">
        <span><span className="muted small">{L('주소 ', 'Address ')}</span><CopyText text={c.endpoint} L={L} /></span>
        <span><span className="muted small">Tcl </span><CopyText text={tcl} L={L} /></span>
        <span className="muted small">{steps}</span>
      </span>
    </div>
  );
}
