import { useEffect, useRef, useState } from 'react';
import { FOLDER_KEYS, folderName } from '../api/storage';
import {
  bytesText, dataApi, dataCodeText, errCode, ruleText, statusText,
  type DataRequest, type Dataset, type Entry, type MyData, type Target,
} from '../api/data';
import type { FolderKey } from '../api/types';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { LoadState } from '../components/LoadState';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';

type Tab = 'files' | 'datasets' | 'requests';
type Ask = { target?: Target; datasetId?: string; label: string; path: string };

const useL = () => {
  const { pick, lang } = useI18n();
  return { L: (ko: string, en: string) => pick({ ko, en }), lang };
};

function when(iso: string | null | undefined, lang: string) {
  return iso ? new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
}

/** Ask first, then let the browser fetch the link (it resumes a broken download itself with Range). */
async function startDownload(url: string) {
  await dataApi.checkDownload(url);
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 데이터: my folders on the NAS (browse, upload, download), the dataset catalog, and export requests.
export function DataPage() {
  const { L } = useL();
  const [tab, setTab] = useState<Tab>('files');
  const mine = useLoad(dataApi.mine);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const approved = mine.state === 'ok' ? mine.data.requests.filter((r) => r.status === 'approved' && !r.started_at).length : 0;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{L('데이터', 'Data')}</h1>
          <p className="muted">{L('내 NAS 폴더로 큰 파일을 올리고 받으며, 연구실 데이터셋을 찾습니다. 반출이 통제된 파일은 승인을 받아 한 번 받을 수 있습니다.',
            'Move large files to and from your NAS folders, find the lab\'s datasets. Controlled files leave once, after approval.')}</p>
        </div>
        <div className="page-tools">
          <button type="button" className="btn" onClick={mine.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
        </div>
      </div>
      <div className="toolbar">
        <div className="segmented" role="tablist">
          {([['files', L('내 폴더', 'My folders')], ['datasets', L('데이터셋', 'Datasets')], ['requests', L('반출 요청', 'Export requests')]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" className={tab === k ? 'on' : ''} aria-selected={tab === k} onClick={() => { setTab(k); setNote(null); }}>
              {label}{k === 'requests' && approved > 0 && <span className="chip chip-ok chip-gap">{approved}</span>}
            </button>
          ))}
        </div>
      </div>
      {note && <div className="alert small info" role="status">{note}</div>}
      {mine.state === 'error' && mine.status === 404 ? <div className="alert">{L('엔진이 아직 이 기능을 지원하지 않습니다.', 'The engine does not have this yet.')}</div> : (
        <LoadState value={mine} retry={mine.reload}>
          {(d) => (
            <>
              {tab === 'files' && <FilesTab data={d} onAsk={setAsk} onChanged={mine.reload} />}
              {tab === 'datasets' && <DatasetsTab onAsk={setAsk} />}
              {tab === 'requests' && <RequestsTab list={d.requests} onChanged={(m) => { setNote(m); mine.reload(); }} />}
            </>
          )}
        </LoadState>
      )}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)}
        onDone={() => { setAsk(null); setNote(L('반출 요청을 보냈습니다. 승인되면 반출 요청 탭에서 한 번 받을 수 있습니다.', 'Request sent. Once approved, download it once from Export requests.')); mine.reload(); }} />}
    </main>
  );
}

// --- my folders --------------------------------------------------------------------------

type Progress = { id: string; name: string; size: number; sent: number; error?: string; done?: string; ctrl: AbortController };

function FilesTab({ data, onAsk, onChanged }: { data: MyData; onAsk: (a: Ask) => void; onChanged: () => void }) {
  const { L, lang } = useL();
  const [poolId, setPoolId] = useState(data.spaces[0]?.pool_id ?? '');
  const space = data.spaces.find((s) => s.pool_id === poolId) ?? data.spaces[0];
  const keys = space ? FOLDER_KEYS.filter((k) => space.folders[k]) : [];
  const [folder, setFolder] = useState<FolderKey>(keys[0] ?? 'home');
  const [path, setPath] = useState('');
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Progress[]>([]);
  const [mkdir, setMkdir] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (space && !space.folders[folder]) setFolder(keys[0] ?? 'home'); setPath(''); }, [poolId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!space) {
    return <div className="empty"><p>{L('공유 저장소가 있는 풀이 없습니다. 관리자가 풀의 공유 저장소를 켜면 여기서 파일을 올리고 받습니다.',
      'No pool with shared storage. Once the admin turns it on for a pool, files move here.')}</p></div>;
  }
  const target: Target = { pool_id: space.pool_id, folder, path };
  const f = space.folders[folder];
  const pol = space.policy;

  async function upload(files: FileList | null) {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files)) {
      const p: Progress = { id: `${Date.now()}-${file.name}`, name: file.name, size: file.size, sent: 0, ctrl: new AbortController() };
      setUploads((u) => [...u, p]);
      const set = (patch: Partial<Progress>) => setUploads((u) => u.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
      try {
        let res;
        try {
          res = await dataApi.upload(file, target, { signal: p.ctrl.signal, onProgress: (sent) => set({ sent }) });
        } catch (e) {
          if (errCode(e) !== 'EXISTS' || !window.confirm(L(`${file.name} 이(가) 이미 있습니다. 덮어쓸까요?`, `${file.name} exists. Replace it?`))) throw e;
          res = await dataApi.upload(file, target, { overwrite: true, signal: p.ctrl.signal, onProgress: (sent) => set({ sent }) });
        }
        set({ sent: file.size, done: res.sha256 });
        setTick((n) => n + 1);
      } catch (e) {
        set({ error: (e as Error).name === 'AbortError' ? L('멈춤 — 같은 파일을 다시 고르면 이어서 올립니다', 'Paused - pick the same file again to go on') : dataCodeText(errCode(e), L) });
      }
    }
    onChanged();
  }

  async function download(name: string) {
    const rel = [path, name].filter(Boolean).join('/');
    setError(null);
    try { await startDownload(dataApi.downloadUrl(target, rel)); } catch (e) {
      const c = errCode(e);
      if (c === 'APPROVAL_REQUIRED') onAsk({ target, path: rel, label: `${space.pool} · ${folderName(folder, L)} / ${rel}` });
      else setError(dataCodeText(c, L));
    }
  }

  const unfinished = data.uploads.filter((u) => u.pool_id === space.pool_id && !uploads.some((x) => x.name === u.name && !x.done && !x.error));
  return (
    <>
      <div className="toolbar">
        {data.spaces.length > 1 && (
          <select aria-label={L('풀', 'Pool')} value={space.pool_id} onChange={(e) => setPoolId(e.target.value)}>
            {data.spaces.map((s) => <option key={s.pool_id} value={s.pool_id}>{s.pool}</option>)}
          </select>
        )}
        <div className="segmented" role="tablist">
          {keys.map((k) => {
            const x = space.folders[k]!;
            return (
              <button key={k} type="button" role="tab" className={folder === k ? 'on' : ''} aria-selected={folder === k} onClick={() => { setFolder(k); setPath(''); }}>
                {folderName(k, L)}
                {x.quota_state && <span className={`chip chip-gap ${x.quota_state === 'over' ? 'chip-off' : 'chip-warn'}`}>{x.quota_state === 'over' ? L('초과', 'over') : '90%'}</span>}
              </button>
            );
          })}
        </div>
        <span className="spacer" />
        <span className={`chip ${pol.export === 'allow' ? 'chip-ok' : pol.export === 'approval' ? 'chip-warn' : 'chip-off'}`}>{ruleText(pol.export, L)}</span>
      </div>
      {f && (
        <section className="panel data-where">
          <div className="folder-item">
            <span className="strong">{folderName(folder, L)}</span>
            <span className="folder-paths">
              <span><span className="muted small">Linux </span><code className="code">{f.linux}</code></span>
              {f.windows && <span><span className="muted small">Windows </span><code className="code">{f.windows}</code></span>}
              <span><span className="muted small">NAS </span><code className="code">{f.nas}</code></span>
            </span>
            <span className={f.quota_state === 'over' ? 'chip chip-off' : f.quota_state === 'near' ? 'chip chip-warn' : 'chip'}>
              {f.usage_kb !== null ? bytesText(f.usage_kb * 1024) : L('사용량 미측정', 'not measured')}{f.quota_gb ? ` / ${f.quota_gb} GB` : ''}
            </span>
          </div>
          {f.quota_state && <div className={`alert small ${f.quota_state === 'over' ? 'error' : ''}`}>{f.quota_state === 'over'
            ? L('할당량을 넘었습니다. 필요 없는 파일을 지우세요.' + (pol.quota_block ? ' 이 풀은 할당량을 넘는 업로드를 막습니다.' : ''), 'Over quota - remove files you do not need.' + (pol.quota_block ? ' Uploads over the quota are refused here.' : ''))
            : L('할당량의 90%를 넘었습니다.', 'Over 90% of the quota.')}</div>}
          <p className="muted small" style={{ margin: 0 }}>
            {space.mode === 'engine' && L(`엔진이 NAS로 바로 전송합니다. ${pol.max_file_gb ? `파일당 최대 ${pol.max_file_gb} GB, ` : ''}끊기면 같은 파일을 다시 골라 이어서 올립니다.`,
              `The engine writes to the NAS directly. ${pol.max_file_gb ? `Up to ${pol.max_file_gb} GB a file; ` : ''}pick the same file again to resume.`)}
            {space.mode === 'agent' && L(`실행 중인 내 데스크톱을 거쳐 전송합니다 (파일당 ${bytesText(data.agent_max)}까지). 큰 파일은 SFTP나 데스크톱에서 옮기세요.`,
              `Files go through your running desktop (up to ${bytesText(data.agent_max)} each). Move larger ones with SFTP or on the desktop.`)}
            {space.mode === 'none' && L('지금은 파일을 옮길 경로가 없습니다. 이 풀의 Linux 데스크톱을 켜면 작은 파일을 옮길 수 있습니다.', 'No way to move files now; start a Linux desktop of the pool for small files.')}
          </p>
        </section>
      )}
      <div className="toolbar data-crumbs">
        <button type="button" className="btn-ghost small-btn" onClick={() => setPath('')}><Icon name="home" size={14} />{folderName(folder, L)}</button>
        {path.split('/').filter(Boolean).map((part, i, all) => (
          <span key={i} className="data-crumb"><Icon name="chevron" size={12} />
            <button type="button" className="btn-ghost small-btn" onClick={() => setPath(all.slice(0, i + 1).join('/'))}>{part}</button></span>
        ))}
        <span className="spacer" />
        <button type="button" className="btn small-btn" disabled={space.mode === 'none'} onClick={() => setMkdir('')}><Icon name="plus" size={14} />{L('새 폴더', 'New folder')}</button>
        <button type="button" className="btn small-btn primary" disabled={space.mode === 'none' || !pol.upload} title={pol.upload ? '' : L('업로드가 꺼져 있습니다', 'Uploads are off')}
          onClick={() => fileRef.current?.click()}><Icon name="plus" size={14} />{L('파일 올리기', 'Upload files')}</button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      </div>
      {error && <div className="alert small error" role="alert">{error}</div>}
      {(uploads.length > 0 || unfinished.length > 0) && (
        <section className="panel">
          {uploads.map((u) => (
            <div key={u.id} className="up-row">
              <span className="strong up-name">{u.name}</span>
              <span className="bar-track"><span className="bar-fill" style={{ width: `${u.size ? Math.round((u.sent / u.size) * 100) : 100}%`, background: u.error ? 'var(--danger)' : undefined }} /></span>
              <span className="muted small nowrap">{u.done ? L('완료', 'Done') : u.error ? u.error : `${bytesText(u.sent)} / ${bytesText(u.size)}`}</span>
              {!u.done && !u.error ? <button type="button" className="btn-ghost small-btn" onClick={() => u.ctrl.abort()}>{L('멈춤', 'Pause')}</button>
                : <button type="button" className="btn-ghost small-btn" onClick={() => setUploads((l) => l.filter((x) => x.id !== u.id))}>×</button>}
              {u.done && <span className="muted small up-hash" title="SHA-256">SHA-256 {u.done.slice(0, 16)}…</span>}
            </div>
          ))}
          {unfinished.map((u) => (
            <div key={u.id} className="up-row">
              <span className="strong up-name">{u.name}</span>
              <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.round((u.received / Math.max(u.size, 1)) * 100)}%`, background: 'var(--warn)' }} /></span>
              <span className="muted small">{L('이어 올리기 대기 — 같은 파일을 다시 고르세요', 'Unfinished - pick the same file to go on')} ({bytesText(u.received)} / {bytesText(u.size)})</span>
              <button type="button" className="btn-ghost small-btn" onClick={async () => { await dataApi.cancelUpload(u.id); onChanged(); }}>{L('버리기', 'Discard')}</button>
            </div>
          ))}
        </section>
      )}
      <Listing key={`${space.pool_id}/${folder}/${path}/${tick}`} load={() => dataApi.files(target, path)} lang={lang}
        onOpen={(name) => setPath([path, name].filter(Boolean).join('/'))} onDownload={download}
        rule={pol.export} canMove={space.mode !== 'none'} />
      {pol.sftp.host && (
        <section className="panel">
          <h2 className="section-title">SFTP</h2>
          <p className="muted small" style={{ margin: 0 }}>{L('아주 큰 파일이나 폴더 통째는 NAS의 SFTP로 옮길 수 있습니다.', 'Very large files or whole folders can move through the NAS\'s SFTP.')}</p>
          <div className="folder-paths">
            <span><span className="muted small">{L('호스트', 'Host')} </span><code className="code">{pol.sftp.host}</code></span>
            <span><span className="muted small">{L('포트', 'Port')} </span><code className="code">{pol.sftp.port}</code></span>
            <span><span className="muted small">{L('예', 'e.g.')} </span><code className="code">sftp -P {pol.sftp.port} {'<'}{L('아이디', 'username')}{'>'}@{pol.sftp.host}</code></span>
          </div>
          {pol.sftp.note && <p className="small" style={{ margin: 0 }}>{pol.sftp.note}</p>}
        </section>
      )}
      {mkdir !== null && (
        <Dialog open title={L('새 폴더', 'New folder')} onClose={() => setMkdir(null)} submitLabel={L('만들기', 'Make')}
          onSubmit={async () => {
            try { await dataApi.mkdir(target, path, mkdir.trim()); setMkdir(null); setTick((n) => n + 1); } catch (e) { setError(dataCodeText(errCode(e), L)); setMkdir(null); }
          }}>
          <label><span>{L('이름', 'Name')}</span><input autoFocus value={mkdir} onChange={(e) => setMkdir(e.target.value)} maxLength={255} /></label>
        </Dialog>
      )}
    </>
  );
}

function Listing({ load, lang, onOpen, onDownload, rule, canMove }: {
  load: () => Promise<{ entries: Entry[] }>; lang: string; onOpen: (name: string) => void; onDownload: (name: string) => void;
  rule: 'allow' | 'approval' | 'deny'; canMove: boolean;
}) {
  const { L } = useL();
  const list = useLoad(load);
  if (list.state === 'error') return <div className="alert small error">{dataCodeText(list.message, L)}</div>;
  return (
    <LoadState value={list} retry={list.reload}>
      {(d) => d.entries.length === 0 ? <div className="empty"><p>{L('빈 폴더입니다.', 'Empty folder.')}</p></div> : (
        <div className="table-scroll">
          <table className="table compact-head">
            <thead><tr><th>{L('이름', 'Name')}</th><th className="num">{L('크기', 'Size')}</th><th>{L('바뀐 때', 'Modified')}</th><th className="actions" /></tr></thead>
            <tbody>
              {d.entries.map((x) => (
                <tr key={x.name}>
                  <td>{x.type === 'dir'
                    ? <button type="button" className="btn-ghost small-btn" onClick={() => onOpen(x.name)}><Icon name="layers" size={14} />{x.name}</button>
                    : <span className="data-file">{x.name}{x.type === 'link' && <span className="chip chip-gap">link</span>}</span>}</td>
                  <td className="num nowrap">{x.type === 'file' ? bytesText(x.size) : ''}</td>
                  <td className="nowrap muted small">{when(x.mtime, lang)}</td>
                  <td className="actions">{x.type === 'file' && canMove && rule !== 'deny' && (
                    <button type="button" className="btn small-btn" onClick={() => onDownload(x.name)}>
                      <Icon name="download" size={14} />{rule === 'approval' ? L('반출 요청', 'Request') : L('받기', 'Download')}</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </LoadState>
  );
}

// --- datasets ----------------------------------------------------------------------------

function DatasetsTab({ onAsk }: { onAsk: (a: Ask) => void }) {
  const { L } = useL();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const list = useLoad(() => dataApi.datasets(search), [search]);
  const [open, setOpen] = useState<Dataset | null>(null);
  useEffect(() => { const t = setTimeout(() => setSearch(q), 300); return () => clearTimeout(t); }, [q]);
  return (
    <>
      <div className="toolbar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('이름 · 설명 · 태그 · 라이선스로 찾기', 'Search name, description, tags, licence')} aria-label={L('찾기', 'Search')} />
      </div>
      <LoadState value={list} retry={list.reload}>
        {(d) => d.datasets.length === 0 ? <div className="empty"><p>{L('쓸 수 있는 데이터셋이 없습니다.', 'No datasets for you.')}</p></div> : (
          <div className="ds-grid">
            {d.datasets.map((ds) => (
              <article key={ds.id} className="card ds-card">
                <div className="ds-head">
                  <h3 className="card-title">{ds.title || ds.name}</h3>
                  <span className={`chip ${ds.export === 'allow' ? 'chip-ok' : ds.export === 'approval' ? 'chip-warn' : 'chip-off'}`}>{ruleText(ds.export, L)}</span>
                </div>
                <div className="chip-row">
                  <span className="chip"><code>{ds.name}</code></span>
                  {ds.version && <span className="chip">{L('버전', 'version')} {ds.version}</span>}
                  {ds.tags.map((t) => <span key={t} className="chip chip-free">{t}</span>)}
                </div>
                {ds.description && <p className="small ds-desc">{ds.description}</p>}
                <dl className="ds-meta small">
                  <dt>{L('크기', 'Size')}</dt><dd>{bytesText(ds.size_bytes)}{ds.files !== null ? ` · ${ds.files.toLocaleString()} ${L('개 파일', 'files')}` : ''}</dd>
                  {ds.license && <><dt>{L('라이선스', 'Licence')}</dt><dd>{ds.license}</dd></>}
                  {ds.source && <><dt>{L('출처', 'Source')}</dt><dd>{ds.source}</dd></>}
                </dl>
                <div className="ds-paths">
                  {ds.paths.length === 0 ? <span className="muted small">{L('내 데스크톱 풀에는 연결되어 있지 않습니다.', 'Not on any of your desktop pools.')}</span>
                    : ds.paths.map((p) => (
                      <div key={p.pool_id} className="small">
                        <span className="muted">{p.pool} </span>
                        <code className="code">{p.linux}</code>{p.windows && <> <code className="code">{p.windows}</code></>}
                        <span className="muted"> {L('(읽기 전용)', '(read-only)')}</span>
                      </div>
                    ))}
                </div>
                {ds.browsable && <div><button type="button" className="btn small-btn" onClick={() => setOpen(ds)}><Icon name="list" size={14} />{L('파일 보기', 'Browse')}</button></div>}
              </article>
            ))}
          </div>
        )}
      </LoadState>
      {open && <DatasetBrowser ds={open} onClose={() => setOpen(null)} onAsk={(path) => { setOpen(null); onAsk({ datasetId: open.id, path, label: `${open.name}/${path}` }); }} />}
    </>
  );
}

function DatasetBrowser({ ds, onClose, onAsk }: { ds: Dataset; onClose: () => void; onAsk: (path: string) => void }) {
  const { L, lang } = useL();
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function download(name: string) {
    const rel = [path, name].filter(Boolean).join('/');
    setError(null);
    try { await startDownload(dataApi.datasetUrl(ds.id, rel)); } catch (e) {
      if (errCode(e) === 'APPROVAL_REQUIRED') onAsk(rel); else setError(dataCodeText(errCode(e), L));
    }
  }
  return (
    <Dialog open wide title={`${ds.title || ds.name}`} onClose={onClose}>
      <div className="toolbar data-crumbs">
        <button type="button" className="btn-ghost small-btn" onClick={() => setPath('')}><Icon name="home" size={14} />{ds.name}</button>
        {path.split('/').filter(Boolean).map((part, i, all) => (
          <span key={i} className="data-crumb"><Icon name="chevron" size={12} />
            <button type="button" className="btn-ghost small-btn" onClick={() => setPath(all.slice(0, i + 1).join('/'))}>{part}</button></span>
        ))}
      </div>
      {error && <div className="alert small error">{error}</div>}
      <Listing key={path} load={() => dataApi.datasetFiles(ds.id, path)} lang={lang} onOpen={(n) => setPath([path, n].filter(Boolean).join('/'))}
        onDownload={download} rule={ds.export} canMove />
    </Dialog>
  );
}

// --- export requests ---------------------------------------------------------------------

function RequestsTab({ list, onChanged }: { list: DataRequest[]; onChanged: (msg: string) => void }) {
  const { L, lang } = useL();
  const [error, setError] = useState<string | null>(null);
  async function take(r: DataRequest) {
    setError(null);
    try {
      const { url } = await dataApi.link(r.id);
      if (url.startsWith('#')) throw new Error('MOCK');
      window.location.assign(url);
      setTimeout(() => onChanged(L('받기를 시작했습니다. 이 링크는 다시 처음부터 받을 수 없습니다.', 'Started. The link does not start over again.')), 1500);
    } catch (e) { setError(dataCodeText(errCode(e), L)); }
  }
  if (list.length === 0) return <div className="empty"><p>{L('반출 요청이 없습니다. 승인이 필요한 파일의 "반출 요청"을 누르면 여기에 남습니다.', 'No requests yet. Files that need approval show "Request".')}</p></div>;
  return (
    <>
      {error && <div className="alert small error">{error}</div>}
      <div className="table-scroll">
        <table className="table compact-head">
          <thead><tr><th>{L('요청', 'Asked')}</th><th>{L('파일', 'File')}</th><th className="num">{L('크기', 'Size')}</th><th>{L('사유', 'Reason')}</th><th>{L('상태', 'Status')}</th><th className="actions" /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td className="nowrap small">{when(r.created_at, lang)}</td>
                <td>{r.dataset ? <><span className="chip">{L('데이터셋', 'Dataset')}</span> {r.dataset}/</> : <span className="muted small">{r.pool} · {r.folder} / </span>}{r.path}</td>
                <td className="num nowrap">{r.size ? bytesText(r.size) : '-'}</td>
                <td className="small">{r.reason}{r.note && <><br /><span className="muted">{L('답', 'Reply')}: {r.note}</span></>}</td>
                <td className="nowrap">
                  <span className={`chip ${r.status === 'approved' ? 'chip-ok' : r.status === 'pending' ? 'chip-warn' : r.status === 'rejected' ? 'chip-off' : 'chip-free'}`}>{statusText(r.status, L)}</span>
                  {r.status === 'approved' && r.expires_at && <div className="muted small">{L('만료', 'until')} {when(r.expires_at, lang)}</div>}
                  {r.started_at && <div className="muted small">{L('받음', 'taken')} {when(r.started_at, lang)}</div>}
                </td>
                <td className="actions">
                  {r.status === 'approved' && !r.started_at && <button type="button" className="btn small-btn primary" onClick={() => take(r)}><Icon name="download" size={14} />{L('한 번 받기', 'Download once')}</button>}
                  {r.status === 'pending' && <button type="button" className="btn-ghost small-btn" onClick={async () => { await dataApi.cancelRequest(r.id); onChanged(L('요청을 취소했습니다.', 'Request cancelled.')); }}>{L('취소', 'Cancel')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AskDialog({ ask, onClose, onDone }: { ask: Ask; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true); setError(null);
    try {
      await dataApi.ask(ask.datasetId ? { dataset_id: ask.datasetId, path: ask.path, reason }
        : { pool_id: ask.target!.pool_id, folder: ask.target!.folder, path: ask.path, reason });
      onDone();
    } catch (e) { setError(dataCodeText(errCode(e), L)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('반출 요청', 'Export request')} onClose={onClose} onSubmit={send} busy={busy} error={error} submitLabel={L('요청 보내기', 'Send request')}>
      <p className="small" style={{ margin: 0 }}><code className="code">{ask.label}</code></p>
      <p className="muted small" style={{ margin: 0 }}>{L('데이터 담당자가 승인하면 정해진 시간 안에 한 번 받을 수 있는 링크가 생깁니다. 요청 · 승인 · 다운로드는 모두 기록됩니다.',
        'Once a data steward approves, a link that works once is yours for a set time. Requests, approvals and downloads are all recorded.')}</p>
      <label><span>{L('사유', 'Reason')}</span>
        <textarea rows={3} required minLength={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={L('예: 학회 발표 자료로 외부 공동 연구자와 공유', 'e.g. to share with an outside co-author for a conference paper')} /></label>
    </Dialog>
  );
}

