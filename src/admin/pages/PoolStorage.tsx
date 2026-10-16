import { useCallback, useState } from 'react';
import { STORAGE_DEFAULTS, storageApi, storageCodeText } from '../../api/storage';
import type { PoolStorage, PoolStorageInput, StorageRow } from '../../api/storage';
import type { Pool } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { useLoad } from '../../components/useLoad';
import { useL } from './OpsPages';

// 데스크톱 풀 > (풀) > 공유 저장소: the NAS share the pool's desktops and build VMs mount, and a
// folder per user on it. The engine applies it through the guest agent on connect, on a shared
// pool's routing and before a build job starts (makus-vlab pegaprox/vlab/nas.py).

export type StorageDraft = PoolStorageInput;

export const draftOf = (s: PoolStorage): StorageDraft => {
  const { has_password: _drop, ...rest } = s;
  void _drop;
  return { ...rest, smb_password: '' };
};

export function storageSummary(s: PoolStorage, L: (ko: string, en: string) => string): string {
  if (!s.enabled) return L('사용 안 함', 'Off');
  const where = s.kind === 'smb' ? `\\\\${s.server}\\${s.share.replace(/\//g, '\\')}` : `${s.server}:${s.share}`;
  return `${s.kind.toUpperCase()} ${where} → ${s.linux_path}/${s.folder_rule}${s.kind === 'smb' ? ` · ${s.windows_drive}:` : ''}`;
}

// the wizard step (also the panel's own dialog)
export function StorageStep({ s, set, hasPassword }: {
  s: StorageDraft; set: <K extends keyof StorageDraft>(k: K, v: StorageDraft[K]) => void; hasPassword: boolean;
}) {
  const { L } = useL();
  const example = s.folder_rule.replace('{username}', 'alice').replace('{department}', L('FPGA설계팀', 'fpga-design')).replace('{pool}', 'pool');
  return (
    <div className="wiz-body">
      <label className="check"><input type="checkbox" checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        <span className="strong">{L('로그인할 때 공유 NAS를 마운트하고 사용자 폴더를 만듭니다', 'Mount the shared NAS at sign-in and make a folder per user')}</span></label>
      <small className="muted hint-indent">{L('데스크톱에 접속할 때 · 공유 풀로 배정될 때 · 빌드 작업이 시작되기 전에 게스트 에이전트로 확인하고, 없으면 마운트합니다. 실패해도 접속은 막지 않고 경고만 합니다.',
        'Checked through the guest agent on connect, on routing into a shared pool and before a build job starts; mounted when missing. A failure warns and never stops the connect.')}</small>
      <fieldset className="plain" disabled={!s.enabled}>
        <span className="field-label">{L('종류', 'Kind')}</span>
        <div className="mode-cards mode-cards-2" role="radiogroup" aria-label={L('종류', 'Kind')}>
          {(['nfs', 'smb'] as const).map((k) => (
            <label key={k} className={`mode-card${s.kind === k ? ' on' : ''}`}>
              <input type="radio" name="nas-kind" checked={s.kind === k} onChange={() => set('kind', k)} aria-label={k.toUpperCase()} />
              <span className="strong">{k === 'nfs' ? 'NFS' : 'SMB (CIFS)'}</span>
              <span className="muted small">{k === 'nfs' ? L('Linux 데스크톱 · 빌드 VM', 'Linux desktops and build VMs')
                : L('Windows는 드라이브 문자로, Linux는 mount.cifs 로', 'Windows as a drive letter, Linux with mount.cifs')}</span>
            </label>
          ))}
        </div>
        <div className="form-row form-row-wide">
          <label><span>{L('NAS 서버', 'NAS server')}</span>
            <input id="nas-server" value={s.server} placeholder="nas01.lab.local" onChange={(e) => set('server', e.target.value.trim())} /></label>
          <label><span>{s.kind === 'nfs' ? L('export 경로', 'Export path') : L('공유 이름', 'Share')}</span>
            <input id="nas-share" value={s.share} placeholder={s.kind === 'nfs' ? '/export/fpga' : 'fpga'} onChange={(e) => set('share', e.target.value.trim())} /></label>
        </div>
        <div className="form-row form-row-wide">
          <label><span>{L('Linux 마운트 위치', 'Linux mount point')}</span>
            <input id="nas-path" value={s.linux_path} placeholder="/mnt/nas" onChange={(e) => set('linux_path', e.target.value.trim())} /></label>
          <label><span>{L('Windows 드라이브 문자', 'Windows drive letter')}</span>
            <select id="nas-drive" value={s.windows_drive} disabled={s.kind !== 'smb'} onChange={(e) => set('windows_drive', e.target.value)}>
              {'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => <option key={c} value={c}>{c}:</option>)}
            </select></label>
        </div>
        <label><span>{L('사용자 폴더 규칙', 'User folder rule')}</span>
          <input id="nas-rule" value={s.folder_rule} placeholder="{username}" onChange={(e) => set('folder_rule', e.target.value.trim())} />
          <small className="muted">{L(`{username} 은 꼭 들어가야 하고 {department}(부서) · {pool}(풀 이름)도 쓸 수 있습니다. 예: ${s.linux_path}/${example}`,
            `Must contain {username}; {department} and {pool} work too. E.g. ${s.linux_path}/${example}`)}</small></label>
        <label className="check"><input type="checkbox" checked={s.private} onChange={(e) => set('private', e.target.checked)} />
          <span>{L('본인만 읽고 쓰기 (폴더 권한 700 · 다른 사용자는 볼 수 없음)', 'Owner only (mode 700 - other users cannot see it)')}</span></label>
        <label className="check"><input type="checkbox" checked={s.build_workdir} onChange={(e) => set('build_workdir', e.target.checked)} />
          <span>{L('빌드 작업 큐의 기본 작업 폴더를 사용자 폴더로', 'Build jobs start in the user folder by default')}</span></label>
        {s.kind === 'nfs' && (
          <label><span>{L('추가 마운트 옵션 (선택)', 'Extra mount options (optional)')}</span>
            <input id="nas-opts" value={s.options} placeholder="vers=4.1,nconnect=4" onChange={(e) => set('options', e.target.value.trim())} /></label>
        )}
        {s.kind === 'smb' && (
          <>
            <span className="field-label">{L('SMB 인증', 'SMB sign-in')}</span>
            <div className="mode-cards mode-cards-2" role="radiogroup" aria-label={L('SMB 인증', 'SMB sign-in')}>
              <label className={`mode-card${s.smb_auth === 'kerberos' ? ' on' : ''}`}>
                <input type="radio" name="nas-auth" checked={s.smb_auth === 'kerberos'} onChange={() => set('smb_auth', 'kerberos')} aria-label="Kerberos" />
                <span className="strong">{L('사용자 본인 (AD Kerberos)', "The user's own (AD Kerberos)")}</span>
                <span className="muted small">{L('도메인에 가입된 VM. 비밀번호를 저장하지 않습니다.', 'Domain-joined VMs. No password is stored.')}</span>
              </label>
              <label className={`mode-card${s.smb_auth === 'service' ? ' on' : ''}`}>
                <input type="radio" name="nas-auth" checked={s.smb_auth === 'service'} onChange={() => set('smb_auth', 'service')} aria-label={L('서비스 계정', 'Service account')} />
                <span className="strong">{L('서비스 계정', 'Service account')}</span>
                <span className="muted small">{L('엔진 DB에 암호화해 저장하고 다시 보여주지 않습니다.', 'Sealed in the engine database and never shown again.')}</span>
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
          </>
        )}
        <div className="callout"><Icon name="info" size={18} />
          <p>{s.kind === 'nfs'
            ? L('NFS export 가 root_squash 이면 VM의 root 로는 폴더를 못 만듭니다. 이때는 사용자 본인 권한으로 다시 시도하고, 그래도 안 되면 경고합니다 — export 상위 폴더에 사용자 쓰기 권한(1777 등)을 주거나 NAS에서 폴더를 미리 만들어 두세요.',
              'With root_squash, root on the VM cannot make folders. The engine retries as the user and warns if that fails too - let users write in the export root (e.g. 1777) or make the folders on the NAS beforehand.')
            : L('Windows 데스크톱은 로그인 스크립트로 드라이브를 연결합니다(다음 로그인부터). 서비스 계정이면 엔진이 폴더와 권한을 먼저 만들고, Kerberos면 사용자가 로그인할 때 자기 폴더를 만듭니다.',
              'Windows desktops map the drive with a sign-in script (from the next sign-in). With a service account the engine makes the folder and its ACL first; with Kerberos the user makes their own folder at sign-in.')}</p>
        </div>
      </fieldset>
    </div>
  );
}

function ResultChip({ r }: { r: { ok: boolean | null; code: string } }) {
  const { L } = useL();
  const tone = r.ok === true ? 'chip chip-on' : r.ok === false ? 'chip chip-warn' : 'chip';
  return <span className={tone} title={storageCodeText(r.code, L)}>{r.ok === true ? L('정상', 'OK') : r.ok === false ? L('실패', 'Failed') : L('대기', 'Pending')}</span>;
}

export function PoolStoragePanel({ pool }: { pool: Pool }) {
  const { L, when } = useL();
  const data = useLoad(useCallback(() => storageApi.pool(pool.id), [pool.id]), [pool.id]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const a = data.state === 'ok' ? data.data : null;
  const s = a?.storage ?? STORAGE_DEFAULTS;

  async function check() {
    setBusy(true); setNotice(null);
    try {
      const r = await storageApi.check(pool.id);
      const bad = (r.checked ?? []).filter((c) => c.ok === false);
      setNotice({ kind: bad.length ? 'error' : 'info', text: L(`${r.checked?.length ?? 0}대에 적용했습니다.${bad.length ? ` 실패 ${bad.length}대 — 아래 표를 보세요.` : ''}`,
        `Applied on ${r.checked?.length ?? 0} VMs.${bad.length ? ` ${bad.length} failed - see the table below.` : ''}`) });
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
            {s.enabled && s.private && <span className="chip">{L('본인만 읽기 · 쓰기', 'Owner only')}</span>}
            {s.enabled && s.build_workdir && pool.type === 'buildfarm' && <span className="chip">{L('빌드 기본 폴더', 'Build default folder')}</span>}
            {s.enabled && s.kind === 'smb' && <span className="chip">{s.smb_auth === 'kerberos' ? 'Kerberos' : `${L('서비스 계정', 'Service account')} ${s.smb_user}`}</span>}
          </div>
        </div>
        <div className="panel-actions">
          <button type="button" className="btn" disabled={!a} onClick={() => setEditing(true)}>{L('설정', 'Set up')}</button>
          <button type="button" className="btn primary" disabled={busy || !s.enabled} onClick={check}>{busy ? L('적용 중…', 'Applying…') : L('지금 적용', 'Apply now')}</button>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      {a && s.enabled && (
        a.results.length === 0 ? <p className="muted small">{L('아직 마운트한 기록이 없습니다. 사용자가 접속하거나 "지금 적용"을 누르면 결과가 여기에 남습니다.',
          'Nothing mounted yet. Results show here once someone connects or after "Apply now".')}</p> : (
          <>
            <p className="small" style={{ margin: '4px 0 8px' }}>
              <span className="muted">{L('마지막 결과', 'Last result')}: </span>
              {a.status.last && <><ResultChip r={a.status.last} /> <span className="muted">{a.status.last.desktop ?? '-'} · {a.status.last.username || L('(마운트만)', '(mount only)')} · {when(a.status.last.at)}</span></>}
              <span className="muted"> · {L(`정상 ${a.status.ok} · 실패 ${a.status.failed} · 대기 ${a.status.pending}`, `ok ${a.status.ok} · failed ${a.status.failed} · pending ${a.status.pending}`)}</span>
            </p>
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('데스크톱', 'Desktop')}</th><th>{L('사용자', 'User')}</th><th>{L('결과', 'Result')}</th><th>{L('경로', 'Path')}</th><th>{L('시각', 'At')}</th></tr></thead>
              <tbody>{a.results.slice(0, 20).map((r: StorageRow) => (
                <tr key={`${r.desktop_id}-${r.username}`}>
                  <td>{r.desktop ?? r.desktop_id}</td>
                  <td>{r.username || <span className="muted small">{L('(마운트만)', '(mount only)')}</span>}</td>
                  <td className="storage-result"><ResultChip r={r} />{r.ok !== true && <div className="muted small">{storageCodeText(r.code, L)}{r.detail ? ` — ${r.detail}` : ''}</div>}</td>
                  <td><code className="code">{r.path || '-'}</code></td>
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

function StorageDialog({ pool, initial, onClose, onSaved }: { pool: Pool; initial: PoolStorage; onClose: () => void; onSaved: () => void }) {
  const { L } = useL();
  const [s, setS] = useState<StorageDraft>(draftOf(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof StorageDraft>(k: K, v: StorageDraft[K]) => setS((o) => ({ ...o, [k]: v }));
  async function save() {
    setBusy(true); setError(null);
    try { await storageApi.save(pool.id, s); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open wide title={`${L('공유 저장소', 'Shared storage')} · ${pool.name}`} onClose={onClose} onSubmit={save} submitLabel={L('저장', 'Save')} busy={busy} error={error}>
      <StorageStep s={s} set={set} hasPassword={initial.has_password} />
    </Dialog>
  );
}
