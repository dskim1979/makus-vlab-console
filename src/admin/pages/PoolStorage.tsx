import { useCallback, useState } from 'react';
import { FOLDER_KEYS, folderName, sizeText, STORAGE_DEFAULTS, storageApi, storageCodeText } from '../../api/storage';
import type { FolderTemplate, PoolStorage, PoolStorageInput, StorageRow } from '../../api/storage';
import type { FolderKey, Pool } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { useLoad } from '../../components/useLoad';
import { useL } from './OpsPages';

// 데스크톱 풀 > (풀) > 공유 저장소: the NAS share the pool's desktops and build VMs reach, with
// folders by purpose - home, project, scratch. Linux through autofs (the map belongs in the template
// image), Windows through a sign-in script in the user's own session. The engine checks it through
// the guest agent on connect, on routing into a shared pool and before a build job starts, and
// fixes only what is missing (makus-vlab pegaprox/vlab/nas.py).

export type StorageDraft = PoolStorageInput;

export const draftOf = (s: PoolStorage): StorageDraft => {
  const { has_password: _drop, ...rest } = s;
  void _drop;
  return { ...rest, folders: { home: { ...s.folders.home }, project: { ...s.folders.project }, scratch: { ...s.folders.scratch } }, smb_password: '' };
};

export function storageSummary(s: PoolStorage, L: (ko: string, en: string) => string): string {
  if (!s.enabled) return L('사용 안 함', 'Off');
  const where = s.kind === 'smb' ? `\\\\${s.server}\\${s.share.replace(/\//g, '\\')}` : `${s.server}:${s.share}`;
  const on = FOLDER_KEYS.filter((k) => s.folders[k].enabled).map((k) => folderName(k, L)).join(' · ');
  return `${s.kind === 'nfs' ? `NFS${s.nfs_version === 'krb5' ? ' (Kerberos)' : `v${s.nfs_version}`}` : 'SMB'} ${where} → ${s.linux_path} · ${on}`;
}

const HINT: Record<FolderKey, [string, string]> = {
  home: ['작은 개인 폴더 · NAS에서 스냅숏과 매일 백업', 'Small, personal - NAS snapshots and a daily backup'],
  project: ['팀 공유 폴더 · 관리자가 팀 그룹으로 만들어 둠 · 장기 백업', "The team's - the admin makes it with the team group; long-term backup"],
  scratch: ['크고 빠른 빌드 공간 · 백업 안 함 · 빌드 작업 폴더는 보관 기간 뒤 정리', 'Big and fast for builds - no backup; job folders removed after the retention'],
};

// the wizard step (also the panel's own dialog)
export function StorageStep({ s, set, hasPassword }: {
  s: StorageDraft; set: <K extends keyof StorageDraft>(k: K, v: StorageDraft[K]) => void; hasPassword: boolean;
}) {
  const { L } = useL();
  const setF = (k: FolderKey, patch: Partial<FolderTemplate>) => set('folders', { ...s.folders, [k]: { ...s.folders[k], ...patch } });
  const num = (v: string) => Math.max(0, Math.min(1000000, Math.floor(Number(v) || 0)));
  return (
    <div className="wiz-body">
      <label className="check"><input type="checkbox" checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        <span className="strong">{L('공유 NAS에 사용자별 폴더(홈 · 프로젝트 · 스크래치)를 둡니다', 'Folders per user on a shared NAS (home, project, scratch)')}</span></label>
      <small className="muted hint-indent">{L('Linux는 autofs로 필요할 때 마운트되고, Windows는 로그인할 때 사용자 권한으로 드라이브가 연결됩니다. 엔진은 접속 · 공유 풀 배정 · 빌드 시작 때 맵과 폴더가 있는지만 확인하고 없을 때만 고칩니다. 실패해도 접속은 막지 않고 경고만 합니다.',
        'Linux mounts with autofs when used; Windows maps drives at sign-in, as the user. On connect, routing and build start the engine only checks the map and the folders and fixes what is missing. A failure warns and never stops the connect.')}</small>
      <fieldset className="plain" disabled={!s.enabled}>
        <div className="mode-cards mode-cards-2" role="radiogroup" aria-label={L('종류', 'Kind')}>
          {(['nfs', 'smb'] as const).map((k) => (
            <label key={k} className={`mode-card${s.kind === k ? ' on' : ''}`}>
              <input type="radio" name="nas-kind" checked={s.kind === k}
                onChange={() => { set('kind', k); if (k === 'smb') set('create_by', 'user'); }} aria-label={k.toUpperCase()} />
              <span className="strong">{k === 'nfs' ? 'NFS' : 'SMB (CIFS)'}</span>
              <span className="muted small">{k === 'nfs' ? L('Linux 데스크톱 · 빌드 VM (EDA 표준)', 'Linux desktops and build VMs (the EDA norm)')
                : L('Windows 드라이브 · Linux는 Kerberos multiuser', 'Windows drives; Linux with Kerberos multiuser')}</span>
            </label>
          ))}
        </div>
        <div className="form-row form-row-wide">
          <label><span>{L('NAS 서버', 'NAS server')}</span>
            <input id="nas-server" value={s.server} placeholder="nas01.lab.local" onChange={(e) => set('server', e.target.value.trim())} /></label>
          <label><span>{s.kind === 'nfs' ? L('export 경로', 'Export path') : L('공유 이름', 'Share')}</span>
            <input id="nas-share" value={s.share} placeholder={s.kind === 'nfs' ? '/export/eda' : 'eda'} onChange={(e) => set('share', e.target.value.trim())} /></label>
        </div>
        <div className="form-row form-row-wide">
          {s.kind === 'nfs' && (
            <label><span>{L('NFS 버전', 'NFS version')}</span>
              <select id="nas-ver" value={s.nfs_version} onChange={(e) => set('nfs_version', e.target.value as StorageDraft['nfs_version'])}>
                <option value="3">{L('NFSv3 — 메타데이터가 많은 EDA에서 빠름', 'NFSv3 - fast on metadata-heavy EDA')}</option>
                <option value="4.1">NFSv4.1</option>
                <option value="krb5">{L('NFSv4.1 + Kerberos (krb5p) — 보안 우선', 'NFSv4.1 + Kerberos (krb5p) - security first')}</option>
              </select></label>
          )}
          <label><span>{L('Linux 마운트 위치 (autofs 루트)', 'Linux mount point (autofs root)')}</span>
            <input id="nas-path" value={s.linux_path} placeholder="/nas" onChange={(e) => set('linux_path', e.target.value.trim())} /></label>
        </div>

        <span className="field-label">{L('폴더', 'Folders')}</span>
        <div className="table-scroll"><table className="table compact-head nas-folders">
          <thead><tr><th>{L('용도', 'Purpose')}</th><th>{L('규칙 (공유 아래 경로)', 'Rule (path under the share)')}</th>
            {s.kind === 'smb' && <th>{L('드라이브', 'Drive')}</th>}<th>{L('할당량 GB', 'Quota GB')}</th><th>{L('보관 일수', 'Keep days')}</th></tr></thead>
          <tbody>{FOLDER_KEYS.map((k) => {
            const f = s.folders[k];
            return (
              <tr key={k}>
                <td><label className="check"><input type="checkbox" checked={f.enabled} onChange={(e) => setF(k, { enabled: e.target.checked })} />
                  <span className="strong">{folderName(k, L)}</span></label><div className="muted small">{L(...HINT[k])}</div></td>
                <td><input aria-label={`${folderName(k, L)} rule`} value={f.rule} disabled={!f.enabled} onChange={(e) => setF(k, { rule: e.target.value.trim() })} />
                  <div className="muted small"><code className="code">{s.linux_path}/{f.rule}</code></div></td>
                {s.kind === 'smb' && <td><select aria-label={`${folderName(k, L)} drive`} value={f.drive} disabled={!f.enabled} onChange={(e) => setF(k, { drive: e.target.value })}>
                  {'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => <option key={c} value={c}>{c}:</option>)}</select></td>}
                <td><input type="number" min={0} className="num-input" aria-label={`${folderName(k, L)} quota`} value={f.quota_gb} disabled={!f.enabled}
                  onChange={(e) => setF(k, { quota_gb: num(e.target.value) })} /></td>
                <td>{k === 'scratch' ? <input type="number" min={0} className="num-input" aria-label="retention" value={f.retention_days ?? 0} disabled={!f.enabled}
                  onChange={(e) => setF(k, { retention_days: num(e.target.value) })} /> : <span className="muted small">-</span>}</td>
              </tr>);
          })}</tbody>
        </table></div>
        <small className="muted">{L('홈 · 스크래치 규칙에는 {username}이, 프로젝트 규칙에는 {department} 또는 {pool}이 들어갑니다. 할당량은 NAS 쪽 quota로 걸고, 여기 값은 사용량 경고 기준입니다(0 = 없음). 스크래치 보관 일수가 지난 빌드 작업 폴더(job_*)는 사용자 권한으로 지웁니다.',
          'Home and scratch rules hold {username}; the project rule {department} or {pool}. Set quotas on the NAS; the value here is the warning line (0 = none). Build job folders (job_*) older than the scratch retention are removed as the user.')}</small>

        {s.kind === 'nfs' && (
          <>
            <span className="field-label">{L('사용자 폴더를 만드는 주체', 'Who makes a user folder')}</span>
            <div className="mode-cards mode-cards-2" role="radiogroup" aria-label={L('사용자 폴더를 만드는 주체', 'Who makes a user folder')}>
              <label className={`mode-card${s.create_by === 'user' ? ' on' : ''}`}>
                <input type="radio" name="nas-create" checked={s.create_by === 'user'} onChange={() => set('create_by', 'user')} aria-label={L('사용자 본인', 'The user')} />
                <span className="strong">{L('사용자 본인', 'The user')}</span>
                <span className="muted small">{L('로그인 스크립트 · runuser 로 사용자 권한에서 만듦. NAS의 home/ · scratch/ 는 1777(스티키).', 'Made as the user (sign-in script, runuser). home/ and scratch/ on the NAS are 1777 (sticky).')}</span>
              </label>
              <label className={`mode-card${s.create_by === 'engine' ? ' on' : ''}`}>
                <input type="radio" name="nas-create" checked={s.create_by === 'engine'} onChange={() => set('create_by', 'engine')} aria-label={L('엔진', 'The engine')} />
                <span className="strong">{L('엔진 (권장)', 'The engine (recommended)')}</span>
                <span className="muted small">{L('엔진 호스트에 마운트한 관리용 export(엔진 IP만 no_root_squash)에 만들고 소유자를 맞춤. 첫 접속 · 풀 권한 부여 때.', 'Made on an admin mount of the export on the engine host (no_root_squash for the engine only), given to the user. At first connect and on a grant.')}</span>
              </label>
            </div>
            {s.create_by === 'engine' && (
              <label><span>{L('엔진 호스트의 관리용 마운트 경로', 'Admin mount on the engine host')}</span>
                <input id="nas-admin" value={s.admin_path} placeholder="/srv/moavi-nas/eda" onChange={(e) => set('admin_path', e.target.value.trim())} /></label>
            )}
            <label><span>{L('추가 마운트 옵션 (선택)', 'Extra mount options (optional)')}</span>
              <input id="nas-opts" value={s.options} placeholder="nconnect=4,rsize=1048576" onChange={(e) => set('options', e.target.value.trim())} /></label>
          </>
        )}
        <label className="check"><input type="checkbox" checked={s.private} onChange={(e) => set('private', e.target.checked)} />
          <span>{L('홈 · 스크래치는 본인만 읽고 쓰기 (700) — 모든 VM과 NAS의 사용자 ID가 같을 때(AD/LDAP + SSSD)만 보장', 'Home and scratch owner only (700) - guaranteed only when every VM and the NAS share user ids (AD/LDAP + SSSD)')}</span></label>
        <label className="check"><input type="checkbox" checked={s.build_workdir} disabled={!s.folders.scratch.enabled} onChange={(e) => set('build_workdir', e.target.checked)} />
          <span>{L('빌드 작업은 스크래치/{username}/{작업 ID} 에서, 사용자 권한으로 실행', 'Build jobs run in scratch/{username}/{job id}, as the user')}</span></label>
        {s.kind === 'smb' && (
          <>
            <span className="field-label">{L('SMB 인증', 'SMB sign-in')}</span>
            <div className="mode-cards mode-cards-2" role="radiogroup" aria-label={L('SMB 인증', 'SMB sign-in')}>
              <label className={`mode-card${s.smb_auth === 'kerberos' ? ' on' : ''}`}>
                <input type="radio" name="nas-auth" checked={s.smb_auth === 'kerberos'} onChange={() => set('smb_auth', 'kerberos')} aria-label="Kerberos" />
                <span className="strong">{L('사용자 본인 (AD Kerberos, 권장)', "The user's own (AD Kerberos, recommended)")}</span>
                <span className="muted small">{L('FSLogix 권한 모델: 사용자가 자기 폴더를 만듦. 비밀번호를 저장하지 않습니다.', 'FSLogix rights: users make their own folder. No password is stored.')}</span>
              </label>
              <label className={`mode-card${s.smb_auth === 'service' ? ' on' : ''}`}>
                <input type="radio" name="nas-auth" checked={s.smb_auth === 'service'} onChange={() => set('smb_auth', 'service')} aria-label={L('서비스 계정', 'Service account')} />
                <span className="strong">{L('서비스 계정 (AD 없는 Linux)', 'Service account (Linux without AD)')}</span>
                <span className="muted small">{L('사용자 폴더를 사용자 uid로 하나씩 마운트. 엔진 DB에 암호화, 다시 보여주지 않음.', "Each user's folders mounted with their uid. Sealed in the engine DB, never shown again.")}</span>
              </label>
            </div>
            <div className="form-row form-row-wide">
              <label><span>{L('도메인 (선택)', 'Domain (optional)')}</span>
                <input id="nas-domain" value={s.smb_domain} placeholder="CORP" onChange={(e) => set('smb_domain', e.target.value.trim())} /></label>
              {s.smb_auth === 'service' && (
                <label><span>{L('계정', 'Account')}</span>
                  <input id="nas-user" value={s.smb_user} placeholder="svc-moavi-nas" onChange={(e) => set('smb_user', e.target.value.trim())} /></label>
              )}
            </div>
            {s.smb_auth === 'service' && (
              <label><span>{L('비밀번호', 'Password')}</span>
                <input id="nas-pw" type="password" autoComplete="new-password" value={s.smb_password ?? ''}
                  placeholder={hasPassword ? L('저장됨 · 바꿀 때만 입력', 'Stored - type only to change it') : ''}
                  onChange={(e) => set('smb_password', e.target.value)} /></label>
            )}
            <span className="field-label">{L('Windows 데스크톱 저장 위치', 'Where Windows desktops save')}</span>
            <label className="check"><input type="checkbox" checked={!!s.win_redirect} disabled={!s.folders.home.enabled}
              onChange={(e) => { set('win_redirect', e.target.checked); if (!e.target.checked) set('win_block_local', false); }} />
              <span>{L(`바탕 화면 · 문서 · 다운로드 · 사진을 홈 드라이브(${s.folders.home.drive}:)로 — 파일이 NAS에 저장되고 백업됩니다`,
                `Desktop, Documents, Downloads and Pictures on the home drive (${s.folders.home.drive}:) - files are kept and backed up on the NAS`)}</span></label>
            <label className="check"><input type="checkbox" checked={!!s.win_block_local} disabled={!s.win_redirect}
              onChange={(e) => set('win_block_local', e.target.checked)} />
              <span>{L('C 드라이브 숨기고 막기 — 탐색기 · 열기/저장 창에서 C:가 보이지 않습니다(프로그램은 그대로 실행)',
                'Hide and refuse the C: drive - not shown in Explorer or the open / save dialogs (programs still run)')}</span></label>
            {s.win_redirect && <small className="muted hint-indent">{L('다음 로그인부터 적용됩니다. C 드라이브 막기는 이 VM의 모든 계정(관리자 포함)에 적용되니, 관리 작업은 관리 콘솔 · 원격 지원으로 하세요. AD가 있으면 GPO 폴더 리디렉션을 써도 됩니다.',
              'Takes effect at the next sign-in. Hiding C: applies to every account on the VM (administrators too) - do admin work from the console or remote support. With AD a GPO folder redirection works too.')}</small>}
          </>
        )}
        <div className="callout"><Icon name="info" size={18} />
          <p>{s.kind === 'nfs'
            ? L('VM의 root로는 사용자 폴더를 만들지 않습니다(NFS root_squash). NAS는 데스크톱과 같은 데이터센터에 두고, 사용자당 활성 위치는 하나만(다중 마스터 복제 없음) 두세요.',
              'User folders are never made as root on the VM (NFS root_squash). Keep the NAS in the desktops\' datacenter, one active location per user (no multi-master replication).')
            : L('Windows 드라이브는 사용자 로그온 세션에서 연결됩니다(게스트 에이전트는 SYSTEM이라 연결해도 사용자에게 안 보임). AD가 있으면 GPO 드라이브 매핑(\\\\서버\\공유\\home\\%USERNAME%)을 써도 됩니다. 2026년 4월 Windows 업데이트부터 Kerberos 기본 암호화가 AES입니다 — NAS 컴퓨터 계정의 AES 지원을 확인하세요.',
              'Windows drives are mapped in the user\'s sign-in session (the agent runs as SYSTEM). With AD a GPO drive map (\\\\server\\share\\home\\%USERNAME%) works too. Since the April 2026 Windows update Kerberos defaults to AES - check the NAS computer account supports it.')}</p>
        </div>
      </fieldset>
    </div>
  );
}

function ResultChip({ r }: { r: { ok: boolean | null; code: string; warnings?: string[] } }) {
  const { L } = useL();
  const warn = r.ok === true && (r.warnings ?? []).length > 0;
  const tone = r.ok === false ? 'chip chip-warn' : warn ? 'chip chip-accent' : r.ok === true ? 'chip chip-on' : 'chip';
  return <span className={tone} title={storageCodeText(r.code, L)}>{r.ok === false ? L('실패', 'Failed') : warn ? L('경고', 'Warning') : r.ok === true ? L('정상', 'OK') : L('대기', 'Pending')}</span>;
}

export function PoolStoragePanel({ pool }: { pool: Pool }) {
  const { L, when } = useL();
  const data = useLoad(useCallback(() => storageApi.pool(pool.id), [pool.id]), [pool.id]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const a = data.state === 'ok' ? data.data : null;
  const s = a?.storage ?? STORAGE_DEFAULTS;

  async function check() {
    setBusy(true); setNotice(null);
    try {
      const r = await storageApi.check(pool.id);
      const bad = (r.checked ?? []).filter((c) => c.ok === false);
      setNotice({ kind: bad.length ? 'error' : 'info', text: L(`${r.checked?.length ?? 0}대를 확인했습니다.${bad.length ? ` 실패 ${bad.length}대 — 아래 표를 보세요.` : ''}`,
        `Checked ${r.checked?.length ?? 0} VMs.${bad.length ? ` ${bad.length} failed - see the table below.` : ''}`) });
      data.reload();
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <section className="panel storage-panel">
      <div className="panel-head">
        <span className="stat-icon tone-blue"><Icon name="layers" size={18} /></span>
        <div>
          <h2 className="section-title">{L('공유 저장소', 'Shared storage')}</h2>
          <div className="policy-chips">
            <span className={s.enabled ? 'chip chip-accent' : 'chip'}>{storageSummary(s, L)}</span>
            {s.enabled && <span className="chip">{s.kind === 'smb' || s.create_by === 'user' ? L('폴더: 사용자 본인이 만듦', 'Folders: made by the user') : L('폴더: 엔진이 만듦', 'Folders: made by the engine')}</span>}
            {s.enabled && s.kind === 'smb' && <span className="chip">{s.smb_auth === 'kerberos' ? 'Kerberos' : `${L('서비스 계정', 'Service account')} ${s.smb_user}`}</span>}
          </div>
        </div>
        <div className="panel-actions">
          <button type="button" className="btn" disabled={!a} onClick={() => setEditing(true)}>{L('설정', 'Set up')}</button>
          <button type="button" className="btn primary" disabled={busy || !s.enabled} onClick={check}>{busy ? L('확인 중…', 'Checking…') : L('지금 확인', 'Check now')}</button>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      {a && s.enabled && a.data_on_nas_only && <div className="alert info small">{L('이 풀의 데스크톱은 로그아웃 · 일정에 따라 처음 상태로 돌아갑니다. 남는 데이터는 NAS 폴더뿐이라고 포털에 표시됩니다.',
        'Desktops of this pool go back to their base; only the NAS folders keep data - the portal says so.')}</div>}
      {a && s.enabled && a.autofs && (
        <div className="small" style={{ margin: '4px 0 8px' }}>
          <button type="button" className="btn-ghost small-btn" onClick={() => setShowMap((v) => !v)}>
            <Icon name="chevron" size={14} />{L('템플릿 · 골든 이미지에 넣을 autofs 파일', 'autofs files for the template / golden image')}</button>
          {showMap && Object.entries(a.autofs).map(([path, text]) => (
            <div key={path}><div className="muted small">{path}</div><pre className="job-output">{text}</pre></div>))}
        </div>
      )}
      {a && s.enabled && (
        a.results.length === 0 ? <p className="muted small">{L('아직 확인한 기록이 없습니다. 사용자가 접속하거나 "지금 확인"을 누르면 결과가 여기에 남습니다.',
          'Nothing checked yet. Results show here once someone connects or after "Check now".')}</p> : (
          <>
            <p className="small" style={{ margin: '4px 0 8px' }}>
              <span className="muted">{L('마지막 결과', 'Last result')}: </span>
              {a.status.last && <><ResultChip r={a.status.last} /> <span className="muted">{a.status.last.desktop ?? '-'} · {a.status.last.username || L('(공유만)', '(share only)')} · {when(a.status.last.at)}</span></>}
              <span className="muted"> · {L(`정상 ${a.status.ok} · 경고 ${a.status.warnings} · 실패 ${a.status.failed} · 대기 ${a.status.pending}`,
                `ok ${a.status.ok} · warnings ${a.status.warnings} · failed ${a.status.failed} · pending ${a.status.pending}`)}</span>
            </p>
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('데스크톱', 'Desktop')}</th><th>{L('사용자', 'User')}</th><th>{L('결과', 'Result')}</th>
                <th>{L('사용량', 'Usage')}</th><th>{L('시각', 'At')}</th></tr></thead>
              <tbody>{a.results.slice(0, 30).map((r: StorageRow) => (
                <tr key={`${r.desktop_id}-${r.username}`}>
                  <td>{r.desktop ?? r.desktop_id}<div className="muted small"><code className="code">{r.path || '-'}</code></div></td>
                  <td>{r.username || <span className="muted small">{L('(공유만)', '(share only)')}</span>}</td>
                  <td className="storage-result"><ResultChip r={r} />
                    {r.ok === false && <div className="muted small">{storageCodeText(r.code, L)}{r.detail ? ` — ${r.detail}` : ''}</div>}
                    {r.warnings.map((w) => <div key={w} className="muted small">⚠ {storageCodeText(w, L)}</div>)}</td>
                  <td className="small">{FOLDER_KEYS.filter((k) => r.usage[k] !== undefined).map((k) => {
                    const q = s.folders[k].quota_gb;
                    return <div key={k}>{folderName(k, L)} {sizeText(r.usage[k])}{q ? ` / ${q} GB` : ''}</div>;
                  })}{Object.keys(r.usage).length === 0 && <span className="muted">-</span>}</td>
                  <td className="muted small">{when(r.at)}</td>
                </tr>))}</tbody>
            </table></div>
          </>
        )
      )}
      {editing && a && <StorageDialog pool={pool} initial={a.storage} onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); setNotice({ kind: 'info', text: L('저장했습니다. 다음 접속부터 적용됩니다.', 'Saved; it applies from the next connect.') }); data.reload(); }} />}
    </section>
  );
}

export function storageStepError(st: StorageDraft, hasPassword: boolean, L: (ko: string, en: string) => string): string | null {
  if (!st.enabled) return null;
  if (!st.server || !st.share) return L('NAS 서버와 공유 경로를 넣으세요.', 'Enter the NAS server and the share.');
  if (!FOLDER_KEYS.some((k) => st.folders[k].enabled)) return L('폴더를 하나 이상 켜세요.', 'Turn on at least one folder.');
  for (const k of ['home', 'scratch'] as const) {
    if (st.folders[k].enabled && !st.folders[k].rule.includes('{username}')) return L(`${folderName(k, L)} 규칙에 {username} 이 들어가야 합니다.`, `The ${k} rule must contain {username}.`);
  }
  if (st.folders.project.enabled && st.folders.project.rule.includes('{username}')) return L('프로젝트 규칙에는 {username} 대신 {department} 나 {pool} 을 쓰세요.', 'The project rule takes {department} or {pool}, not {username}.');
  if (st.kind === 'nfs' && st.create_by === 'engine' && !st.admin_path) return L('엔진 호스트의 관리용 마운트 경로를 넣으세요.', 'Enter the admin mount on the engine host.');
  if (st.kind === 'smb' && st.smb_auth === 'service' && (!st.smb_user || !(st.smb_password || hasPassword))) return L('서비스 계정의 이름과 비밀번호를 넣으세요.', 'Enter the service account and its password.');
  return null;
}

// what the engine is sent: SMB folders are always made by the user
export const storageBody = (s: StorageDraft): StorageDraft => (s.kind === 'smb' ? { ...s, create_by: 'user' } : s);

function StorageDialog({ pool, initial, onClose, onSaved }: { pool: Pool; initial: PoolStorage; onClose: () => void; onSaved: () => void }) {
  const { L } = useL();
  const [s, setS] = useState<StorageDraft>(draftOf(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof StorageDraft>(k: K, v: StorageDraft[K]) => setS((o) => ({ ...o, [k]: v }));
  async function save() {
    const why = storageStepError(s, initial.has_password, L);
    if (why) { setError(why); return; }
    setBusy(true); setError(null);
    try { await storageApi.save(pool.id, storageBody(s)); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open wide title={`${L('공유 저장소', 'Shared storage')} · ${pool.name}`} onClose={onClose} onSubmit={save} submitLabel={L('저장', 'Save')} busy={busy} error={error}>
      <StorageStep s={s} set={set} hasPassword={initial.has_password} />
    </Dialog>
  );
}
