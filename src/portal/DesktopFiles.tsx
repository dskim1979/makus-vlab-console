import { useCallback, useEffect, useRef, useState } from 'react';
import { deskFilesApi, type DeskEntry, type DeskListing } from '../api/deskFiles';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n';

// 내 데스크톱 파일: the desktop's MOAVI folder (Windows: 바탕 화면\MOAVI, Linux: ~/MOAVI) through the
// guest agent - list, upload (drag and drop too), download, new folder, delete.
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

function size(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function DesktopFiles({ desktopId, name, onClose }: { desktopId: string; name: string; onClose: () => void }) {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [path, setPath] = useState('');
  const [list, setList] = useState<DeskListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ name: string; sent: number; size: number } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async (p: string) => {
    setBusy(true); setError(null);
    try { setList(await deskFilesApi.list(desktopId, p)); setPath(p); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [desktopId]);

  useEffect(() => { void load(''); return () => abort.current?.abort(); }, [load]);

  const mode = list?.policy.desktop_files ?? 'off';
  const canUp = mode === 'up' || mode === 'both';
  const canDown = mode === 'down' || mode === 'both';

  async function send(files: FileList | File[]) {
    if (!canUp) return;
    for (const f of Array.from(files)) {
      if (list && f.size > list.policy.max_mb * 1024 * 1024) { setError(L(`'${f.name}'이(가) 너무 큽니다 (최대 ${list.policy.max_mb} MB).`, `'${f.name}' is too large (max ${list.policy.max_mb} MB).`)); continue; }
      abort.current = new AbortController();
      setUpload({ name: f.name, sent: 0, size: f.size }); setError(null);
      try { await deskFilesApi.upload(desktopId, path, f, (sent) => setUpload({ name: f.name, sent, size: f.size }), abort.current.signal); }
      catch (e) { if ((e as Error).name !== 'AbortError') setError(`${f.name}: ${(e as Error).message}`); }
    }
    setUpload(null);
    await load(path);
  }

  async function mkdir() {
    const n = (newFolder ?? '').trim();
    if (!n) return;
    try { await deskFilesApi.mkdir(desktopId, join(path, n)); setNewFolder(null); await load(path); }
    catch (e) { setError((e as Error).message); }
  }

  async function remove(e: DeskEntry) {
    try { await deskFilesApi.remove(desktopId, join(path, e.name)); setConfirmDel(null); await load(path); }
    catch (err) { setError((err as Error).message); }
  }

  const crumbs = path ? path.split('/') : [];
  const when = (t: number) => new Date(t * 1000).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <Dialog open wide title={`${L('파일', 'Files')} · ${name}`} onClose={onClose} error={error}>
      <p className="muted small">{L('이 데스크톱의 바탕 화면 MOAVI 폴더(Linux는 ~/MOAVI)입니다.', "This desktop's MOAVI folder on the desktop (Linux: ~/MOAVI).")}</p>
      <div className="toolbar">
        <nav className="crumbs" aria-label={L('경로', 'Path')}>
          <button type="button" className="btn-ghost small-btn" onClick={() => load('')}>MOAVI</button>
          {crumbs.map((c, i) => (
            <span key={i}> / <button type="button" className="btn-ghost small-btn" onClick={() => load(crumbs.slice(0, i + 1).join('/'))}>{c}</button></span>
          ))}
        </nav>
        <span style={{ flex: 1 }} />
        {canUp && <button type="button" className="btn small-btn" disabled={!!upload} onClick={() => setNewFolder('')}><Icon name="plus" size={14} />{L('새 폴더', 'New folder')}</button>}
        {canUp && <button type="button" className="btn primary small-btn" disabled={!!upload} onClick={() => fileInput.current?.click()}>{L('올리기', 'Upload')}</button>}
        <button type="button" className="btn small-btn" disabled={busy} onClick={() => load(path)} aria-label={L('새로 고침', 'Refresh')}><Icon name="refresh" size={14} /></button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) void send(e.target.files); e.target.value = ''; }} />
      </div>

      {newFolder !== null && (
        <div className="toolbar">
          <input autoFocus value={newFolder} maxLength={120} placeholder={L('폴더 이름', 'Folder name')} onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') void mkdir(); if (e.key === 'Escape') setNewFolder(null); }} />
          <button type="button" className="btn primary small-btn" onClick={() => void mkdir()}>{L('만들기', 'Create')}</button>
          <button type="button" className="btn-ghost small-btn" onClick={() => setNewFolder(null)}>{L('취소', 'Cancel')}</button>
        </div>
      )}

      {upload && (
        <div className="bar-row" role="status" aria-live="polite">
          <span className="small" title={upload.name}>{upload.name}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${upload.size ? Math.round((upload.sent / upload.size) * 100) : 100}%` }} /></span>
          <button type="button" className="btn-ghost small-btn" onClick={() => abort.current?.abort()}>{L('취소', 'Cancel')}</button>
        </div>
      )}

      <div className={`table-scroll${drag ? ' drop-on' : ''}`} style={drag ? { outline: '2px dashed var(--accent)' } : undefined}
        onDragOver={(e) => { if (canUp) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (canUp && e.dataTransfer.files.length) void send(e.dataTransfer.files); }}>
        <table className="table compact-head">
          <thead><tr><th>{L('이름', 'Name')}</th><th className="num">{L('크기', 'Size')}</th><th>{L('수정', 'Modified')}</th><th className="actions" /></tr></thead>
          <tbody>
            {path && (
              <tr><td colSpan={4}><button type="button" className="btn-ghost small-btn" onClick={() => load(crumbs.slice(0, -1).join('/'))}>.. {L('위로', 'Up')}</button></td></tr>
            )}
            {(list?.entries ?? []).map((e) => (
              <tr key={e.name}>
                <td className="strong">
                  {e.kind === 'dir'
                    ? <button type="button" className="btn-ghost small-btn" onClick={() => load(join(path, e.name))}>{e.name}/</button>
                    : e.name}
                </td>
                <td className="num muted small">{e.kind === 'dir' ? '' : size(e.size)}</td>
                <td className="muted small">{when(e.mtime)}</td>
                <td className="actions">
                  {e.kind === 'file' && canDown && (
                    <a className="btn-ghost small-btn" href={deskFilesApi.downloadUrl(desktopId, join(path, e.name))} download={e.name}>
                      <Icon name="download" size={14} />{L('받기', 'Download')}</a>
                  )}
                  {canUp && (confirmDel === e.name
                    ? <><button type="button" className="btn-ghost small-btn danger" onClick={() => void remove(e)}>{L('정말 삭제', 'Delete')}</button>
                      <button type="button" className="btn-ghost small-btn" onClick={() => setConfirmDel(null)}>{L('취소', 'Cancel')}</button></>
                    : <button type="button" className="btn-ghost small-btn danger" onClick={() => setConfirmDel(e.name)}>{L('삭제', 'Delete')}</button>)}
                </td>
              </tr>
            ))}
            {list && list.entries.length === 0 && (
              <tr><td colSpan={4} className="muted small">{canUp ? L('비어 있습니다. 파일을 여기로 끌어 놓아도 됩니다.', 'Empty. You can drop files here.') : L('비어 있습니다.', 'Empty.')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
