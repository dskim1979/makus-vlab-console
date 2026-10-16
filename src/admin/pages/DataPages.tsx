import { useEffect, useState } from 'react';
import {
  bytesText, dataApi, ruleText, statusText,
  type AdminDataset, type DataPolicy, type DataRequest, type DatasetInput, type ExportRule, type PoolRef, type RequestStatus, type Subject,
} from '../../api/data';
import { folderName } from '../../api/storage';
import { nextApi } from '../../api/next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { SettingsStatus } from '../../components/SettingsShell';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// 연구 데이터: the dataset catalog (registered NAS folders, mounted read-only on the desktops), export
// requests waiting for a data steward, the export rules per pool, capacity, and the transfer report.
// Every route needs vlab.data.manage (the report vlab.report.view): the admin, or a role made for
// the lab's data steward.

const useL = () => {
  const { pick, lang } = useI18n();
  return { L: (ko: string, en: string) => pick({ ko, en }), lang };
};
const when = (iso: string | null | undefined, lang: string) =>
  iso ? new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
const ruleChip = (r: ExportRule) => `chip ${r === 'allow' ? 'chip-ok' : r === 'approval' ? 'chip-warn' : 'chip-off'}`;

// --- datasets ----------------------------------------------------------------------------

const EMPTY: DatasetInput = {
  name: '', title: '', description: '', version: '', license: '', source: '', kind: 'nfs', server: '', share: '', nfs_version: '3',
  admin_path: '', pool_ids: [], access: [], export: 'approval', tags: [], enabled: true,
};

export function DatasetsPage() {
  const { L, lang } = useL();
  const list = useLoad(dataApi.adminDatasets);
  const [edit, setEdit] = useState<AdminDataset | 'new' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function measure(d: AdminDataset) {
    setBusy(d.id); setNote(null);
    try { const m = await dataApi.measure(d.id); setNote(L(`${m.name}: ${bytesText(m.size_bytes)}, 파일 ${m.files?.toLocaleString()}개`, `${m.name}: ${bytesText(m.size_bytes)}, ${m.files} files`)); list.reload(); }
    catch (e) { setNote((e as Error).message); } finally { setBusy(null); }
  }
  return (
    <LoadState value={list} retry={list.reload}>
      {(d) => (
        <>
          <SettingsStatus items={[
            { label: L('데이터셋', 'Datasets'), value: String(d.datasets.length) },
            { label: L('전체 크기', 'Total size'), value: bytesText(d.datasets.reduce((s, x) => s + (x.size_bytes ?? 0), 0)) },
            { label: L('반출 승인 대기', 'Export requests waiting'), value: String(d.pending), tone: d.pending ? 'warn' : undefined },
          ]} />
          <div className="toolbar">
            <p className="muted small" style={{ margin: 0 }}>{L(`NAS의 폴더를 데이터셋으로 등록하면 그 풀의 데스크톱에 읽기 전용으로 붙습니다: Linux /nas/datasets/<이름>, Windows ${d.windows_root}\\<이름> (SMB 데이터셋).`,
              `A NAS folder registered as a dataset is mounted read-only on its pools' desktops: Linux /nas/datasets/<name>, Windows ${d.windows_root}\\<name> (SMB datasets).`)}</p>
            <span className="spacer" />
            <button type="button" className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" size={16} />{L('데이터셋 등록', 'Register a dataset')}</button>
          </div>
          {note && <div className="alert small info" role="status">{note}</div>}
          {d.datasets.length === 0 ? <div className="empty"><p>{L('등록한 데이터셋이 없습니다.', 'No datasets yet.')}</p></div> : (
            <div className="table-scroll">
              <table className="table compact-head">
                <thead><tr><th>{L('데이터셋', 'Dataset')}</th><th>NAS</th><th>{L('풀 · 접근', 'Pools · access')}</th><th className="num">{L('크기', 'Size')}</th><th>{L('반출', 'Export')}</th><th className="actions" /></tr></thead>
                <tbody>
                  {d.datasets.map((x) => (
                    <tr key={x.id}>
                      <td><span className="strong">{x.title || x.name}</span>{!x.enabled && <span className="chip chip-free chip-gap">{L('꺼짐', 'off')}</span>}
                        <br /><code className="code small">{x.linux}</code>{x.version && <span className="muted small"> · {x.version}</span>}</td>
                      <td className="small"><code className="code">{x.nas}</code>{x.mounted ? <><br /><span className="muted">{L('엔진 마운트', 'engine mount')} {x.admin_path}</span></> : null}</td>
                      <td className="small">{x.pool_ids.length ? x.pool_ids.map((id) => d.pools.find((p) => p.id === id)?.name ?? id).join(', ') : L('공유 저장소가 있는 모든 풀', 'every pool with shared storage')}
                        <br /><span className="muted">{x.access.length ? x.access.map((s) => `${s.subject_type === 'user' ? '' : s.subject_type === 'group' ? L('그룹 ', 'group ') : L('부서 ', 'dept ')}${s.subject_id}`).join(', ') : L('풀의 모든 사용자', 'everyone in its pools')}</span></td>
                      <td className="num small nowrap">{bytesText(x.size_bytes)}{x.files !== null && <><br /><span className="muted">{x.files.toLocaleString()} {L('개', 'files')}</span></>}
                        {x.measured_at && <><br /><span className="muted">{when(x.measured_at, lang)}</span></>}{x.measure_error && <><br /><span className="chip chip-warn" title={x.measure_error}>!</span></>}</td>
                      <td><span className={ruleChip(x.export)}>{ruleText(x.export, L)}</span></td>
                      <td className="actions">
                        <button type="button" className="btn small-btn" disabled={busy === x.id} onClick={() => measure(x)}>{busy === x.id ? L('측정 중…', 'Measuring…') : L('크기 측정', 'Measure')}</button>
                        <button type="button" className="btn-ghost small-btn" onClick={() => setEdit(x)}>{L('편집', 'Edit')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {edit && <DatasetDialog ds={edit === 'new' ? null : edit} pools={d.pools} onClose={() => setEdit(null)}
            onDone={(m) => { setEdit(null); setNote(m); list.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

function DatasetDialog({ ds, pools, onClose, onDone }: { ds: AdminDataset | null; pools: PoolRef[]; onClose: () => void; onDone: (msg: string) => void }) {
  const { L } = useL();
  const [v, setV] = useState<DatasetInput>(() => (ds ? { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, ds[k as keyof DatasetInput]])) } as DatasetInput : { ...EMPTY }));
  const [tags, setTags] = useState((ds?.tags ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof DatasetInput>(k: K, x: DatasetInput[K]) => setV((o) => ({ ...o, [k]: x }));
  const withStorage = pools.filter((p) => p.storage);
  async function save() {
    setBusy(true); setError(null);
    try {
      const out = await dataApi.saveDataset(ds?.id ?? null, { ...v, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
      onDone(ds ? L(`${out.name}을(를) 고쳤습니다. 데스크톱에는 다음 접속(또는 풀의 "지금 확인") 때 반영됩니다.`, `${out.name} saved; desktops get it at their next connect (or the pool's Check now).`)
        : L(`${out.name}을(를) 등록했습니다. "크기 측정"으로 크기와 파일 수를 잽니다.`, `${out.name} registered; Measure gets its size and file count.`));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!ds || !window.confirm(L(`${ds.name} 등록을 지울까요? NAS의 데이터는 그대로 남습니다.`, `Remove ${ds.name}? The data on the NAS stays.`))) return;
    await dataApi.deleteDataset(ds.id);
    onDone(L('등록을 지웠습니다.', 'Removed.'));
  }
  return (
    <Dialog open wide title={ds ? L('데이터셋 편집', 'Edit dataset') : L('데이터셋 등록', 'Register a dataset')} onClose={onClose} onSubmit={save} busy={busy} error={error}
      submitLabel={L('저장', 'Save')} extra={ds ? <button type="button" className="btn-ghost danger" onClick={remove}>{L('등록 지우기', 'Remove')}</button> : undefined}>
      <div className="form-row form-row-even">
        <label><span>{L('이름 (폴더 이름)', 'Name (the folder name)')}</span>
          <input required value={v.name} pattern="[a-z0-9][a-z0-9._\-]{0,63}" placeholder="imagenet" onChange={(e) => set('name', e.target.value.toLowerCase())} /></label>
        <label><span>{L('제목', 'Title')}</span><input value={v.title} maxLength={120} onChange={(e) => set('title', e.target.value)} /></label>
      </div>
      <label><span>{L('설명', 'Description')}</span><textarea rows={2} maxLength={4000} value={v.description} onChange={(e) => set('description', e.target.value)} /></label>
      <div className="form-row form-row-three">
        <label><span>{L('버전', 'Version')}</span><input value={v.version} maxLength={40} onChange={(e) => set('version', e.target.value)} /></label>
        <label><span>{L('라이선스', 'Licence')}</span><input value={v.license} maxLength={200} onChange={(e) => set('license', e.target.value)} /></label>
        <label><span>{L('출처', 'Source')}</span><input value={v.source} maxLength={500} onChange={(e) => set('source', e.target.value)} /></label>
      </div>
      <label><span>{L('태그 (쉼표로 구분)', 'Tags (comma separated)')}</span><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vision, nlp" /></label>
      <h3 className="dialog-sub">{L('NAS 위치', 'Where on the NAS')}</h3>
      <div className="form-row form-row-three">
        <label><span>{L('종류', 'Kind')}</span>
          <select value={v.kind} onChange={(e) => set('kind', e.target.value as 'nfs' | 'smb')}><option value="nfs">NFS</option><option value="smb">SMB</option></select></label>
        <label><span>{L('NAS 서버', 'NAS server')}</span><input required value={v.server} placeholder="nas01.lab.local" onChange={(e) => set('server', e.target.value)} /></label>
        {v.kind === 'nfs' ? (
          <label><span>NFS</span><select value={v.nfs_version} onChange={(e) => set('nfs_version', e.target.value as DatasetInput['nfs_version'])}>
            <option value="3">NFSv3</option><option value="4.1">NFSv4.1</option><option value="krb5">NFSv4.1 + Kerberos</option></select></label>
        ) : <span />}
      </div>
      <label><span>{v.kind === 'nfs' ? L('export 경로', 'Export path') : L('공유 이름 / 폴더', 'Share / folder')}</span>
        <input required value={v.share} placeholder={v.kind === 'nfs' ? '/export/datasets/imagenet' : 'datasets/imagenet'} onChange={(e) => set('share', e.target.value)} /></label>
      <label><span>{L('엔진 호스트 마운트 경로 (선택)', 'Mount on the engine host (optional)')}</span>
        <input value={v.admin_path} placeholder="/srv/moavi-data/imagenet" onChange={(e) => set('admin_path', e.target.value)} />
        <span className="muted small">{L('있으면 엔진이 크기를 재고, 포털에서 파일 보기 · 다운로드(반출 규칙에 따라)를 합니다. 읽기 전용으로 마운트하세요.',
          'With it the engine measures the size and the portal can browse and download (by the export rule). Mount it read-only.')}</span></label>
      <h3 className="dialog-sub">{L('어디에 · 누구에게', 'Where and for whom')}</h3>
      <div className="check-row">
        {withStorage.length === 0 && <span className="muted small">{L('공유 저장소를 켠 풀이 없습니다. 데스크톱 풀 > 정책 > 공유 저장소에서 먼저 켜세요.', 'No pool has shared storage yet - turn it on under the pool\'s policy first.')}</span>}
        {withStorage.map((p) => (
          <label key={p.id} className="check-inline"><input type="checkbox" checked={v.pool_ids.includes(p.id)}
            onChange={(e) => set('pool_ids', e.target.checked ? [...v.pool_ids, p.id] : v.pool_ids.filter((x) => x !== p.id))} />{p.name}</label>
        ))}
      </div>
      <p className="muted small" style={{ margin: 0 }}>{L('아무 풀도 고르지 않으면 공유 저장소가 있는 모든 풀에 붙습니다.', 'None picked: every pool with shared storage.')}</p>
      <SubjectsEditor value={v.access} onChange={(x) => set('access', x)} />
      <label><span>{L('반출(브라우저 다운로드)', 'Export (browser download)')}</span>
        <select value={v.export} onChange={(e) => set('export', e.target.value as ExportRule)}>
          <option value="allow">{ruleText('allow', L)}</option><option value="approval">{ruleText('approval', L)}</option><option value="deny">{ruleText('deny', L)}</option>
        </select></label>
      <label className="check"><input type="checkbox" checked={v.enabled} onChange={(e) => set('enabled', e.target.checked)} />{L('사용 (끄면 데스크톱 맵과 포털 목록에서 빠짐)', 'On (off: out of the desktops\' map and the portal)')}</label>
    </Dialog>
  );
}

/** Who may use a dataset: users, departments (with their sub-departments) and directory groups. */
function SubjectsEditor({ value, onChange }: { value: Subject[]; onChange: (v: Subject[]) => void }) {
  const { L } = useL();
  const [type, setType] = useState<Subject['subject_type']>('group');
  const [subject, setSubject] = useState('');
  const [deps, setDeps] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { nextApi.signupConfig().then((c) => setDeps(c.departments)).catch(() => setDeps([])); }, []);
  const name = (s: Subject) => (s.subject_type === 'department' ? deps.find((d) => d.id === s.subject_id)?.name ?? s.subject_id : s.subject_id);
  function add() {
    const id = subject.trim();
    if (!id || value.some((s) => s.subject_type === type && s.subject_id === id)) return;
    onChange([...value, { subject_type: type, subject_id: id }]);
    setSubject('');
  }
  return (
    <div className="rsv-people">
      <div className="form-row form-row-wide">
        <label><span>{L('접근 권한', 'Access')}</span>
          <span className="rsv-people-add">
            <select aria-label={L('종류', 'Kind')} value={type} onChange={(e) => { setType(e.target.value as Subject['subject_type']); setSubject(''); }}>
              <option value="user">{L('사용자', 'User')}</option>
              {deps.length > 0 && <option value="department">{L('부서', 'Department')}</option>}
              <option value="group">{L('AD/LDAP 그룹', 'AD/LDAP group')}</option>
            </select>
            {type === 'department' ? (
              <select aria-label={L('부서', 'Department')} value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">{L('고르세요', 'Pick one')}</option>
                {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            ) : <input aria-label={L('이름', 'Name')} value={subject} placeholder={type === 'user' ? L('아이디', 'username') : 'AI-LAB-USERS'}
              onChange={(e) => setSubject(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />}
          </span></label>
        <span className="check-bottom"><button type="button" className="btn small-btn" disabled={!subject.trim()} onClick={add}><Icon name="plus" size={14} />{L('추가', 'Add')}</button></span>
      </div>
      <div className="chip-row">
        {value.length === 0 && <span className="muted small">{L('비우면 그 풀의 모든 사용자가 씁니다. 실제 경계는 NAS의 읽기 권한입니다.', 'Empty: everyone in its pools. The NAS\'s own read permission is the real boundary.')}</span>}
        {value.map((s, i) => (
          <span key={s.subject_type + s.subject_id} className="chip">
            <span className="muted">{s.subject_type === 'user' ? L('사용자', 'User') : s.subject_type === 'department' ? L('부서', 'Dept') : L('그룹', 'Group')}</span>
            {name(s)}
            <button type="button" className="chip-x" aria-label={L('빼기', 'Remove')} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
          </span>
        ))}
      </div>
    </div>
  );
}

// --- export requests ---------------------------------------------------------------------

export function DataRequestsPage() {
  const { L, lang } = useL();
  const [status, setStatus] = useState<RequestStatus | ''>('pending');
  const list = useLoad(() => dataApi.adminRequests(status || undefined), [status]);
  const [picked, setPicked] = useState<DataRequest | null>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="tablist">
          {([['pending', statusText('pending', L)], ['approved', statusText('approved', L)], ['rejected', statusText('rejected', L)], ['', L('전체', 'All')]] as const).map(([k, label]) => (
            <button key={k || 'all'} type="button" role="tab" className={status === k ? 'on' : ''} aria-selected={status === k} onClick={() => setStatus(k)}>{label}</button>
          ))}
        </div>
        <span className="spacer" />
        <span className="muted small">{L('승인하면 요청자가 포털에서 정해진 시간 안에 한 번 받습니다. 승인자에게는 링크가 보이지 않습니다.', 'Approved: the requester downloads once within the time. The approver never sees the link.')}</span>
      </div>
      {note && <div className="alert small info" role="status">{note}</div>}
      <LoadState value={list} retry={list.reload}>
        {(rows) => rows.length === 0 ? <div className="empty"><p>{L('해당하는 요청이 없습니다.', 'No requests.')}</p></div> : (
          <div className="table-scroll">
            <table className="table compact-head">
              <thead><tr><th>{L('요청', 'Asked')}</th><th>{L('요청자', 'Requester')}</th><th>{L('파일', 'File')}</th><th className="num">{L('크기', 'Size')}</th><th>{L('사유', 'Reason')}</th><th>{L('상태', 'Status')}</th><th className="actions" /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap small">{when(r.created_at, lang)}</td>
                    <td>{r.username}</td>
                    <td className="small">{r.dataset ? <><span className="chip">{L('데이터셋', 'Dataset')}</span> {r.dataset}/</> : <span className="muted">{r.pool} · {r.folder} / </span>}{r.path}</td>
                    <td className="num nowrap">{r.size ? bytesText(r.size) : '-'}</td>
                    <td className="small">{r.reason}</td>
                    <td className="nowrap"><span className={`chip ${r.status === 'approved' ? 'chip-ok' : r.status === 'pending' ? 'chip-warn' : r.status === 'rejected' ? 'chip-off' : 'chip-free'}`}>{statusText(r.status, L)}</span>
                      {r.reviewed_by && <div className="muted small">{r.reviewed_by} · {when(r.reviewed_at, lang)}</div>}
                      {r.started_at && <div className="muted small">{L('받음', 'taken')} {when(r.started_at, lang)}</div>}</td>
                    <td className="actions">{r.status === 'pending' && <button type="button" className="btn small-btn primary" onClick={() => setPicked(r)}>{L('검토', 'Review')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </LoadState>
      {picked && <ReviewDialog r={picked} onClose={() => setPicked(null)} onDone={(m) => { setPicked(null); setNote(m); list.reload(); }} />}
    </>
  );
}

function ReviewDialog({ r, onClose, onDone }: { r: DataRequest; onClose: () => void; onDone: (msg: string) => void }) {
  const { L } = useL();
  const [hours, setHours] = useState(24);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(approve: boolean) {
    setBusy(true); setError(null);
    try {
      if (approve) { await dataApi.approve(r.id, hours, note); onDone(L(`${r.username}의 요청을 승인했습니다 (${hours}시간).`, `Approved for ${hours} hours.`)); }
      else { await dataApi.reject(r.id, note); onDone(L('거절했습니다.', 'Rejected.')); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('반출 요청 검토', 'Review export request')} onClose={onClose} onSubmit={() => act(true)} busy={busy} error={error} submitLabel={L('승인', 'Approve')}
      extra={<button type="button" className="btn danger" disabled={busy || !note.trim()} title={L('거절 사유를 적으세요', 'Write why')} onClick={() => act(false)}>{L('거절', 'Reject')}</button>}>
      <dl className="ds-meta small">
        <dt>{L('요청자', 'Requester')}</dt><dd>{r.username}</dd>
        <dt>{L('파일', 'File')}</dt><dd><code className="code">{r.dataset ? `${r.dataset}/${r.path}` : `${r.pool} · ${r.folder} / ${r.path}`}</code></dd>
        <dt>{L('크기', 'Size')}</dt><dd>{r.size ? bytesText(r.size) : '-'}</dd>
        <dt>{L('사유', 'Reason')}</dt><dd>{r.reason}</dd>
      </dl>
      <div className="form-row form-row-even">
        <label><span>{L('링크 유효 시간 (시간)', 'Link valid (hours)')}</span><input type="number" min={1} max={720} value={hours} onChange={(e) => setHours(Number(e.target.value) || 1)} /></label>
        <span />
      </div>
      <label><span>{L('메모 (거절할 때는 필수)', 'Note (required to reject)')}</span><textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </Dialog>
  );
}

// --- export rules per pool ---------------------------------------------------------------

export function DataPoliciesPage() {
  const { L } = useL();
  const list = useLoad(dataApi.policies);
  const [edit, setEdit] = useState<(PoolRef & { policy: DataPolicy }) | null>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <LoadState value={list} retry={list.reload}>
      {(d) => (
        <>
          <p className="muted small">{L(`풀마다 내 폴더(홈 · 프로젝트 · 스크래치)의 업로드와 반출(브라우저 다운로드)을 정합니다. 엔진 호스트에 공유 저장소 관리용 마운트가 있으면 엔진이 직접 전송하고(수십 GB, 이어받기), 없으면 사용자의 실행 중인 Linux 데스크톱을 거쳐 ${bytesText(d.agent_max)}까지만 옮깁니다.`,
            `Per pool: uploads and exports (browser downloads) of the users' folders. With the shared storage admin mount on the engine host the engine moves files itself (tens of GB, resumable); without, files up to ${bytesText(d.agent_max)} go through the user's running Linux desktop.`)}</p>
          {note && <div className="alert small info" role="status">{note}</div>}
          <div className="table-scroll">
            <table className="table compact-head">
              <thead><tr><th>{L('풀', 'Pool')}</th><th>{L('전송', 'Transfer')}</th><th>{L('반출', 'Export')}</th><th>{L('업로드', 'Upload')}</th><th>{L('링크', 'Link')}</th><th>SFTP</th><th className="actions" /></tr></thead>
              <tbody>
                {d.policies.map((p) => (
                  <tr key={p.id}>
                    <td><span className="strong">{p.name}</span></td>
                    <td className="small">{!p.storage ? <span className="muted">{L('공유 저장소 없음', 'no shared storage')}</span> : p.admin_mount ? L('엔진 (NAS 마운트)', 'engine (NAS mount)') : L('데스크톱 경유 (작은 파일)', 'through the desktop (small)')}</td>
                    <td><span className={ruleChip(p.policy.export)}>{ruleText(p.policy.export, L)}</span></td>
                    <td className="small">{p.policy.upload ? `${L('허용', 'on')}${p.policy.max_file_gb ? ` · ${p.policy.max_file_gb} GB` : ''}${p.policy.quota_block ? L(' · 할당량 차단', ' · quota blocks') : ''}` : L('꺼짐', 'off')}</td>
                    <td className="small">{p.policy.link_hours}{L('시간', ' h')}</td>
                    <td className="small">{p.policy.sftp.host ? `${p.policy.sftp.host}:${p.policy.sftp.port}` : '-'}</td>
                    <td className="actions"><button type="button" className="btn-ghost small-btn" onClick={() => setEdit(p)}>{L('설정', 'Set')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {edit && <PolicyDialog p={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); setNote(L('저장했습니다.', 'Saved.')); list.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

function PolicyDialog({ p, onClose, onDone }: { p: PoolRef & { policy: DataPolicy }; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [v, setV] = useState<DataPolicy>({ ...p.policy, sftp: { ...p.policy.sftp } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    try { await dataApi.savePolicy(p.id, v); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={`${p.name} — ${L('데이터 반출 · 업로드', 'export and upload')}`} onClose={onClose} onSubmit={save} busy={busy} error={error} submitLabel={L('저장', 'Save')}>
      <label><span>{L('반출(내 폴더 → 브라우저)', 'Export (folders -> browser)')}</span>
        <select value={v.export} onChange={(e) => setV({ ...v, export: e.target.value as ExportRule })}>
          <option value="allow">{ruleText('allow', L)}</option><option value="approval">{ruleText('approval', L)}</option><option value="deny">{ruleText('deny', L)}</option>
        </select>
        <span className="muted small">{L('국책 · 반도체 과제처럼 반출을 통제하면 "승인 필요"나 "반출 금지". 데이터셋은 데이터셋마다 따로 정합니다.', 'For controlled projects: approval or no export. Datasets have their own rule.')}</span></label>
      <label className="check"><input type="checkbox" checked={v.upload} onChange={(e) => setV({ ...v, upload: e.target.checked })} />{L('업로드 허용', 'Allow uploads')}</label>
      <div className="form-row form-row-even">
        <label><span>{L('파일당 최대 (GB, 0은 제한 없음)', 'Largest file (GB, 0 = no limit)')}</span><input type="number" min={0} value={v.max_file_gb} onChange={(e) => setV({ ...v, max_file_gb: Number(e.target.value) || 0 })} /></label>
        <label><span>{L('승인 링크 유효 시간 (시간)', 'Approved link valid (hours)')}</span><input type="number" min={1} max={720} value={v.link_hours} onChange={(e) => setV({ ...v, link_hours: Number(e.target.value) || 1 })} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={v.quota_block} onChange={(e) => setV({ ...v, quota_block: e.target.checked })} />{L('폴더 할당량을 넘는 업로드 막기 (끄면 경고만)', 'Refuse uploads over the folder quota (off: warn)')}</label>
      <h3 className="dialog-sub">{L('SFTP 안내 (선택, 표시만)', 'SFTP (optional, shown only)')}</h3>
      <div className="form-row form-row-wide">
        <label><span>{L('호스트', 'Host')}</span><input value={v.sftp.host} placeholder="nas01.lab.local" onChange={(e) => setV({ ...v, sftp: { ...v.sftp, host: e.target.value } })} /></label>
        <label><span>{L('포트', 'Port')}</span><input type="number" min={1} max={65535} value={v.sftp.port} onChange={(e) => setV({ ...v, sftp: { ...v.sftp, port: Number(e.target.value) || 22 } })} /></label>
      </div>
      <label><span>{L('안내 문구', 'Note')}</span><input value={v.sftp.note} maxLength={500} onChange={(e) => setV({ ...v, sftp: { ...v.sftp, note: e.target.value } })} /></label>
    </Dialog>
  );
}

// --- capacity ----------------------------------------------------------------------------

export function DataUsagePage() {
  const { L, lang } = useL();
  const list = useLoad(dataApi.usage);
  const [only, setOnly] = useState(false);
  return (
    <LoadState value={list} retry={list.reload}>
      {(d) => (
        <>
          <SettingsStatus items={[
            { label: L('데이터셋', 'Datasets'), value: bytesText(d.totals.datasets_bytes) },
            { label: L('사용자 폴더', 'User folders'), value: bytesText(d.totals.folders_kb * 1024) },
            { label: L('할당량 초과', 'Over quota'), value: String(d.totals.over), tone: d.totals.over ? 'off' : undefined },
            { label: L('90% 이상', 'Over 90%'), value: String(d.totals.near), tone: d.totals.near ? 'warn' : undefined },
          ]} />
          <section className="panel">
            <h2 className="section-title">{L('데이터셋', 'Datasets')}</h2>
            {d.datasets.length === 0 ? <p className="muted small">{L('없음', 'None')}</p> : d.datasets.map((x) => {
              const max = Math.max(...d.datasets.map((y) => y.size_bytes ?? 0), 1);
              return (
                <div key={x.id} className="bar-row data-bar">
                  <span className="strong">{x.name}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${((x.size_bytes ?? 0) / max) * 100}%` }} /></span>
                  <span className="bar-n nowrap">{bytesText(x.size_bytes)}</span>
                </div>
              );
            })}
          </section>
          <div className="toolbar">
            <h2 className="section-title" style={{ margin: 0 }}>{L('사용자 폴더', 'User folders')}</h2>
            <span className="spacer" />
            <label className="check-inline"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />{L('경고만', 'Warnings only')}</label>
          </div>
          <p className="muted small">{L('사용량은 사용자가 접속할 때(6시간마다) 또는 풀의 공유 저장소 "지금 확인"에서 잽니다. 할당량은 공유 저장소 설정의 폴더별 값이며, 실제 제한은 NAS quota로 겁니다.',
            'Measured at a connect (every 6 hours) or by the pool\'s Check now. Quotas come from the shared storage setting; the NAS quota is the real limit.')}</p>
          <div className="table-scroll">
            <table className="table compact-head">
              <thead><tr><th>{L('풀', 'Pool')}</th><th>{L('사용자', 'User')}</th><th>{L('폴더', 'Folder')}</th><th className="num">{L('사용량', 'Used')}</th><th className="num">{L('할당량', 'Quota')}</th><th>{L('측정', 'Measured')}</th></tr></thead>
              <tbody>
                {d.folders.filter((f) => !only || f.state).map((f) => (
                  <tr key={`${f.pool_id}/${f.username}/${f.folder}`}>
                    <td>{f.pool}</td><td>{f.username}</td><td>{folderName(f.folder, L)}</td>
                    <td className="num nowrap">{bytesText(f.usage_kb * 1024)}{f.state && <span className={`chip chip-gap ${f.state === 'over' ? 'chip-off' : 'chip-warn'}`}>{f.state === 'over' ? L('초과', 'over') : '90%'}</span>}</td>
                    <td className="num nowrap">{f.quota_gb ? `${f.quota_gb} GB` : '-'}</td>
                    <td className="nowrap muted small">{when(f.at, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </LoadState>
  );
}

// --- the transfer report -----------------------------------------------------------------

export function DataReportPage() {
  const { L, lang } = useL();
  const [days, setDays] = useState(30);
  const [user, setUser] = useState('');
  const [applied, setApplied] = useState('');
  const list = useLoad(() => dataApi.report(days, applied), [days, applied]);
  return (
    <>
      <div className="toolbar">
        <select aria-label={L('기간', 'Period')} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map((n) => <option key={n} value={n}>{L(`최근 ${n}일`, `Last ${n} days`)}</option>)}
        </select>
        <input type="search" value={user} placeholder={L('사용자', 'User')} aria-label={L('사용자', 'User')} onChange={(e) => setUser(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setApplied(user.trim()); }} onBlur={() => setApplied(user.trim())} />
        <span className="spacer" />
        <a className="btn" href={dataApi.reportCsvUrl(days, applied)}><Icon name="download" size={16} />CSV</a>
      </div>
      <LoadState value={list} retry={list.reload}>
        {(d) => (
          <>
            <SettingsStatus items={[
              { label: L('반출(다운로드)', 'Exports (downloads)'), value: `${d.totals.downloads} · ${bytesText(d.totals.download_bytes)}` },
              { label: L('승인 링크로', 'By approved link'), value: String(d.totals.approved_links) },
              { label: L('업로드', 'Uploads'), value: `${d.totals.uploads} · ${bytesText(d.totals.upload_bytes)}` },
              { label: L('실패', 'Failed'), value: String(d.totals.failed), tone: d.totals.failed ? 'warn' : undefined },
            ]} />
            <div className="data-two">
              <section className="panel">
                <h2 className="section-title">{L('사용자별', 'By user')}</h2>
                <table className="table compact-head">
                  <thead><tr><th>{L('사용자', 'User')}</th><th className="num">{L('반출', 'Exported')}</th><th className="num">{L('업로드', 'Uploaded')}</th></tr></thead>
                  <tbody>{d.by_user.map((u) => <tr key={u.username}><td>{u.username}</td><td className="num">{bytesText(u.download_bytes)} <span className="muted small">({u.downloads})</span></td><td className="num">{bytesText(u.upload_bytes)} <span className="muted small">({u.uploads})</span></td></tr>)}</tbody>
                </table>
              </section>
              <section className="panel">
                <h2 className="section-title">{L('데이터셋 · 폴더별', 'By dataset or folder')}</h2>
                <table className="table compact-head">
                  <thead><tr><th>{L('대상', 'Source')}</th><th className="num">{L('반출', 'Exported')}</th><th className="num">{L('사용자', 'Users')}</th></tr></thead>
                  <tbody>{d.by_source.map((s) => <tr key={s.key}><td>{s.kind === 'dataset' && <span className="chip">{L('데이터셋', 'Dataset')}</span>} {s.name}</td><td className="num">{bytesText(s.download_bytes)} <span className="muted small">({s.downloads})</span></td><td className="num">{s.users}</td></tr>)}</tbody>
                </table>
              </section>
            </div>
            <h2 className="section-title">{L('최근 전송', 'Recent transfers')}</h2>
            <div className="table-scroll">
              <table className="table compact-head">
                <thead><tr><th>{L('시각', 'When')}</th><th>{L('사용자', 'User')}</th><th>{L('방향', 'Direction')}</th><th>{L('경로', 'Path')}</th><th className="num">{L('크기', 'Size')}</th><th>SHA-256</th><th>{L('결과', 'Result')}</th></tr></thead>
                <tbody>
                  {d.recent.map((t) => (
                    <tr key={t.id}>
                      <td className="nowrap small">{when(t.at, lang)}</td><td>{t.username}</td>
                      <td>{t.direction === 'download' ? L('반출', 'export') : L('업로드', 'upload')}{t.request_id && <span className="chip chip-gap">{L('승인', 'approved')}</span>}{t.via === 'agent' && <span className="chip chip-free chip-gap">{L('데스크톱', 'desktop')}</span>}</td>
                      <td className="small"><code className="code">{t.path}</code></td>
                      <td className="num nowrap">{bytesText(t.size)}</td>
                      <td className="small"><code title={t.sha256}>{t.sha256 ? `${t.sha256.slice(0, 12)}…` : '-'}</code></td>
                      <td>{t.ok ? <span className="chip chip-ok">OK</span> : <span className="chip chip-off" title={t.error}>{t.error.split(':')[0]}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </LoadState>
    </>
  );
}
