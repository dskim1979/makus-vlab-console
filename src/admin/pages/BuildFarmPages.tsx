import { useState } from 'react';
import { AB_WHY_KO, accelBookingsApi, type ABSettings, type AccelBooking } from '../../api/accelBookings';
import { buildsApi, ciSnippet, type ArtifactSettings, type CiKind, type CiLink, type CiLinkInput, type CiLinks } from '../../api/builds';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { SettingsStatus } from '../../components/SettingsShell';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { ciKindText } from './NextPages';

// 가속 자원 > 빌드 팜 › CI 연동 · 결과물 보관, 가속 자원 > 카드 대여 › 예약.

function useL() {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
  return { L, when };
}

const local = (s: string) => s.replace('T', ' ');

// --- CI 연동 --------------------------------------------------------------------------------

export function CiLinksPage() {
  const { L, when } = useL();
  const data = useLoad(buildsApi.ciLinks);
  const [editing, setEditing] = useState<CiLink | 'new' | null>(null);
  const [shown, setShown] = useState<{ link: CiLink; token: string } | null>(null);
  const [snip, setSnip] = useState<CiLink | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function renew(l: CiLink) {
    if (!confirm(L(`'${l.name}'의 토큰을 새로 만들까요? 지금 토큰은 바로 쓸 수 없게 되므로 CI 쪽 변수도 바꿔야 합니다.`, `Make a new token for '${l.name}'? The current one stops at once.`))) return;
    try { setShown(await buildsApi.newCiToken(l.id)); data.reload(); } catch (e) { setErr((e as Error).message); }
  }
  async function toggle(l: CiLink) {
    try { await buildsApi.updateCiLink(l.id, { enabled: !l.enabled }); data.reload(); } catch (e) { setErr((e as Error).message); }
  }
  async function remove(l: CiLink) {
    if (!confirm(L(`'${l.name}' 연결을 지울까요? 그 토큰으로는 더 빌드를 넣을 수 없습니다.`, `Delete '${l.name}'? Its token stops working.`))) return;
    try { await buildsApi.deleteCiLink(l.id); data.reload(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <LoadState value={data} retry={data.reload}>
      {(d) => (
        <>
          <p className="muted small page-intro">{L('GitLab CI · Jenkins 같은 CI가 커밋마다 빌드를 빌드 팜 큐에 넣고 결과(성공 · 실패, 출력, 결과물)를 받아 갑니다. 연결마다 풀 하나와 실행할 사용자(그 사람의 스크래치 · 할당량 · 알림)가 정해지고, 토큰은 그 연결의 빌드만 넣고 읽을 수 있습니다.',
            'A CI (GitLab CI, Jenkins) puts a build in the build farm queue per commit and reads its result. Each connection has one pool and one user it runs as; its token can only send and read that connection\'s builds.')}</p>
          <div className="toolbar">
            <button type="button" className="btn primary" disabled={d.pools.length === 0} onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('연결 만들기', 'New connection')}</button>
            <button type="button" className="btn" onClick={data.reload}><Icon name="refresh" size={16} /></button>
          </div>
          {err && <div className="alert small error" role="alert">{err}</div>}
          {d.links.length === 0 ? <div className="empty"><p>{d.pools.length === 0 ? L('빌드 팜 풀이 없습니다. 먼저 풀을 만드세요.', 'No build farm pool yet.') : L('CI 연결이 없습니다.', 'No CI connections.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('연결', 'Connection')}</th><th>{L('풀 · 실행 사용자', 'Pool · runs as')}</th><th>{L('명령', 'Command')}</th><th>{L('토큰', 'Token')}</th><th>{L('최근 사용', 'Last used')}</th><th className="actions" /></tr></thead>
              <tbody>{d.links.map((l) => (
                <tr key={l.id} className={l.enabled ? '' : 'row-off'}>
                  <td><span className="strong">{l.name}</span><br /><span className="chip chip-accent">{ciKindText(l.kind)}</span>{!l.enabled && <span className="chip chip-gap">{L('꺼짐', 'off')}</span>}</td>
                  <td>{l.pool ?? l.pool_id}<br /><span className="muted small">{l.owner}</span></td>
                  <td><code className="code">{l.command}</code>{l.allow_command && <div className="muted small">{L('CI가 명령을 바꿀 수 있음', 'the CI may send its own command')}</div>}</td>
                  <td className="nowrap"><code className="code">mci_…{l.token_hint}</code>{l.expires_at && <div className="muted small">{L('만료', 'expires')} {when(l.expires_at)}</div>}</td>
                  <td className="muted small">{when(l.last_used_at)}<br />{L(`${l.uses}회`, `${l.uses} builds`)}</td>
                  <td className="actions nowrap">
                    <button type="button" className="btn-ghost small-btn" onClick={() => setSnip(l)}>{L('설정 예시', 'Example')}</button>
                    <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(l)}>{L('편집', 'Edit')}</button>
                    <button type="button" className="btn-ghost small-btn" onClick={() => renew(l)}>{L('새 토큰', 'New token')}</button>
                    <button type="button" className="btn-ghost small-btn" onClick={() => toggle(l)}>{l.enabled ? L('끄기', 'Off') : L('켜기', 'On')}</button>
                    <button type="button" className="btn-ghost small-btn danger" onClick={() => remove(l)}>{L('삭제', 'Delete')}</button>
                  </td>
                </tr>))}</tbody>
            </table></div>
          )}
          <p className="muted small">{L('명령에는 MOAVI_CI_REPO · MOAVI_CI_REF · MOAVI_CI_COMMIT · MOAVI_CI_URL · MOAVI_CI_PIPELINE 환경 변수가 들어갑니다. 빌드 VM에서 저장소를 받아(git fetch · checkout) 그 커밋으로 빌드하게 쓰세요. 작업 결과물은 빌드 팜 › 결과물 보관의 규칙대로 남고, CI가 내려받아 갈 수 있습니다.',
            'The command gets MOAVI_CI_REPO, _REF, _COMMIT, _URL and _PIPELINE: fetch and check out that commit on the build VM. Results are kept by the Results kept rules and the CI can download them.')}</p>
          {editing && <CiLinkDialog d={d} link={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
            onDone={(r) => { setEditing(null); data.reload(); if (r) setShown(r); }} />}
          {shown && <TokenDialog shown={shown} onClose={() => setShown(null)} onSnippet={() => { setSnip(shown.link); setShown(null); }} />}
          {snip && <SnippetDialog link={snip} onClose={() => setSnip(null)} />}
        </>
      )}
    </LoadState>
  );
}

function CiLinkDialog({ d, link, onClose, onDone }: { d: CiLinks; link: CiLink | null; onClose: () => void; onDone: (r: { link: CiLink; token: string } | null) => void }) {
  const { L } = useL();
  const [f, setF] = useState<CiLinkInput>(link ? { name: link.name, kind: link.kind, pool_id: link.pool_id, owner: link.owner, command: link.command, workdir: link.workdir,
    allow_command: link.allow_command, expires_at: link.expires_at ? link.expires_at.slice(0, 10) : '' }
    : { name: '', kind: 'gitlab', pool_id: d.pools[0]?.id ?? '', owner: '', command: 'git -C ~/src/<프로젝트> fetch -q && git -C ~/src/<프로젝트> checkout -q "$MOAVI_CI_COMMIT" && make -C ~/src/<프로젝트> bit',
      workdir: '', allow_command: false, expires_at: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: CiLinkInput) => setF({ ...f, ...p });
  async function submit() {
    setBusy(true); setErr(null);
    const body = { ...f, expires_at: f.expires_at ? `${f.expires_at}T23:59:00` : null };
    try {
      if (link) { await buildsApi.updateCiLink(link.id, body); onDone(null); } else onDone(await buildsApi.createCiLink(body));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open wide title={link ? L('CI 연결 편집', 'Edit CI connection') : L('CI 연결 만들기', 'New CI connection')} onClose={onClose} onSubmit={submit}
      submitLabel={link ? L('저장', 'Save') : L('만들고 토큰 받기', 'Make and get the token')} busy={busy} error={err}>
      <div className="form-row form-row-even">
        <label><span>{L('이름', 'Name')}</span><input required value={f.name ?? ''} placeholder={L('예: FPGA팀 GitLab', 'e.g. FPGA team GitLab')} onChange={(e) => set({ name: e.target.value })} /></label>
        <label><span>{L('종류', 'Kind')}</span><select value={f.kind} onChange={(e) => set({ kind: e.target.value as CiKind })}>
          {d.kinds.map((k) => <option key={k} value={k}>{ciKindText(k) === 'CI' ? L('일반 (curl)', 'Generic (curl)') : ciKindText(k)}</option>)}</select></label>
      </div>
      <div className="form-row form-row-even">
        <label><span>{L('빌드 팜 풀', 'Build farm pool')}</span><select value={f.pool_id} onChange={(e) => set({ pool_id: e.target.value })}>
          {d.pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label><span>{L('실행 사용자', 'Runs as')}</span><input required value={f.owner ?? ''} placeholder="alice" onChange={(e) => set({ owner: e.target.value.trim() })} />
          <small className="muted">{L('이 풀의 이용 권한이 있는 사용자. 그 사람의 스크래치 폴더 · 할당량 · 알림을 씁니다. 팀 공용 계정을 만들어 두면 편합니다.', 'Someone granted the pool; their scratch, quota and notices are used. A team account works well.')}</small></label>
      </div>
      <label><span>{L('빌드 명령', 'Build command')}</span><textarea rows={3} required value={f.command ?? ''} onChange={(e) => set({ command: e.target.value })} /></label>
      <div className="form-row form-row-even">
        <label><span>{L('작업 폴더 (비우면 스크래치/작업 ID)', 'Work folder (empty: scratch/<job>)')}</span><input value={f.workdir ?? ''} placeholder="/nas/projects/fpga" onChange={(e) => set({ workdir: e.target.value })} /></label>
        <label><span>{L('토큰 만료일 (선택)', 'Token expires (optional)')}</span><input type="date" value={f.expires_at ?? ''} onChange={(e) => set({ expires_at: e.target.value })} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={!!f.allow_command} onChange={(e) => set({ allow_command: e.target.checked })} />
        <span>{L('CI가 명령을 직접 보내게 허용 (토큰을 가진 사람이 실행 사용자 권한으로 아무 명령이나 돌릴 수 있습니다)', 'Let the CI send its own command (anyone with the token runs any command as that user)')}</span></label>
    </Dialog>
  );
}

function TokenDialog({ shown, onClose, onSnippet }: { shown: { link: CiLink; token: string }; onClose: () => void; onSnippet: () => void }) {
  const { L } = useL();
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open title={L('CI 토큰 — 지금 한 번만 보입니다', 'CI token - shown once')} onClose={onClose}
      extra={<button type="button" className="btn" onClick={onSnippet}>{L('설정 예시 보기', 'Show the example')}</button>}>
      <p className="muted small">{L(`'${shown.link.name}'의 토큰입니다. CI의 비밀 변수(GitLab: 설정 › CI/CD › 변수, Masked · Protected / Jenkins: Credentials의 Secret text)에 MOAVI_CI_TOKEN 으로 넣으세요. 창을 닫으면 다시 볼 수 없습니다.`,
        `The token of '${shown.link.name}'. Put it in the CI's secret variables as MOAVI_CI_TOKEN. It cannot be shown again.`)}</p>
      <pre className="job-output token-box">{shown.token}</pre>
      <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(shown.token).then(() => setCopied(true)); }}>
        <Icon name="code" size={14} />{copied ? L('복사했습니다', 'Copied') : L('복사', 'Copy')}</button>
    </Dialog>
  );
}

function SnippetDialog({ link, onClose }: { link: CiLink; onClose: () => void }) {
  const { L } = useL();
  const [kind, setKind] = useState<CiKind>(link.kind);
  const server = window.location.origin;
  return (
    <Dialog open wide title={L(`${link.name} 설정 예시`, `${link.name}: CI example`)} onClose={onClose}>
      <div className="segmented" role="tablist">
        {(['gitlab', 'jenkins', 'generic'] as CiKind[]).map((k) => (
          <button key={k} type="button" role="tab" className={kind === k ? 'on' : ''} aria-selected={kind === k} onClick={() => setKind(k)}>{k === 'generic' ? 'curl' : ciKindText(k)}</button>))}
      </div>
      <p className="muted small">{L('빌드를 넣고, 끝날 때까지 30초마다 상태를 보고, 출력과 결과물을 받아 옵니다. 빌드가 실패하면 CI 단계도 실패합니다. (curl · jq 필요, X-Requested-With 헤더는 꼭 넣으세요)',
        'Sends the build, checks every 30 s until it ends, then takes the output and result files. A failed build fails the CI step. (needs curl and jq; keep the X-Requested-With header)')}</p>
      <pre className="job-output snippet">{ciSnippet(kind, server)}</pre>
    </Dialog>
  );
}

// --- 결과물 보관 ----------------------------------------------------------------------------

export function ArtifactSettingsPage() {
  const { L } = useL();
  const data = useLoad(buildsApi.artifacts);
  const [editing, setEditing] = useState<{ scope: string; name: string; s: ArtifactSettings; own: boolean } | null>(null);
  return (
    <LoadState value={data} retry={data.reload}>
      {(d) => (
        <>
          <p className="muted small page-intro">{L('빌드 · GPU 작업이 끝나면 작업 폴더에서 아래 패턴에 맞는 파일(비트스트림 · 리포트 · 로그 · 모델)을 찾아 NAS의 결과물 보관함 artifacts/사용자/작업 ID 로 복사하고, 작업 목록의 [결과물]과 CI에서 내려받게 합니다. 공유 저장소가 없거나 artifacts 폴더가 없으면 작업 폴더에 있는 그대로 목록만 남깁니다.',
            'When a build or GPU job ends, the files matching these patterns are copied to artifacts/<user>/<job> on the NAS and can be downloaded from the job list and by the CI. Without shared storage (or the artifacts folder) they are only listed where they are.')}</p>
          <ArtifactRow L={L} title={L('기본 (모든 빌드 팜 풀)', 'Default (every build farm pool)')} s={d.default} badge={null} onEdit={() => setEditing({ scope: '_default', name: L('기본', 'Default'), s: d.default, own: true })} />
          {d.pools.map((p) => (
            <ArtifactRow key={p.id} L={L} title={p.name} s={p.settings} badge={p.own ? L('풀 설정', 'own') : L('기본 따름', 'default')}
              warn={!p.storage ? L('공유 저장소가 없어 작업 폴더에 남은 파일만 목록으로 보입니다.', 'No shared storage: files are only listed in the work folder.') : null}
              onEdit={() => setEditing({ scope: p.id, name: p.name, s: p.settings, own: p.own })} />
          ))}
          <p className="muted small">{L('NAS 준비: 공유 저장소 루트에 artifacts 폴더를 만들고 scratch 와 같이 1777 권한을 주세요(mkdir artifacts && chmod 1777 artifacts). 큰 파일은 엔진 서버에 NAS 관리용 마운트가 있으면 그대로, 없으면 빌드 VM의 게스트 에이전트로 10 MB까지 받습니다.',
            'On the NAS: make an artifacts folder at the share root, mode 1777 like scratch. Large files need the engine\'s NAS admin mount; through the guest agent up to 10 MB.')}</p>
          {editing && <ArtifactDialog e={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); data.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

function ArtifactRow({ L, title, s, badge, warn, onEdit }: { L: (ko: string, en: string) => string; title: string; s: ArtifactSettings; badge: string | null; warn?: string | null; onEdit: () => void }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div><h3 className="panel-title">{title}{badge && <span className="chip chip-gap">{badge}</span>}</h3>
          {warn && <p className="muted small" style={{ margin: 0 }}>{warn}</p>}</div>
        <div className="panel-actions"><button type="button" className="btn" onClick={onEdit}><Icon name="gear" size={16} />{L('설정', 'Settings')}</button></div>
      </div>
      <SettingsStatus items={[
        { label: L('보관', 'Keep'), value: s.enabled ? L('켬', 'on') : L('끔', 'off'), tone: s.enabled ? 'ok' : 'off' },
        { label: L('파일 수 (작업당)', 'Files (per job)'), value: String(s.max_files) },
        { label: L('파일 하나 최대', 'Largest file'), value: `${s.max_mb >= 1024 ? `${Math.round(s.max_mb / 102.4) / 10} GB` : `${s.max_mb} MB`}` },
        { label: L('보관 기간', 'Kept for'), value: L(`${s.keep_days}일`, `${s.keep_days} d`) },
      ]} />
      <div className="chip-picks">{s.patterns.map((p) => <code key={p} className="code chip">{p}</code>)}</div>
    </section>
  );
}

function ArtifactDialog({ e, onClose, onDone }: { e: { scope: string; name: string; s: ArtifactSettings; own: boolean }; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [f, setF] = useState({ ...e.s, patterns: e.s.patterns.join(', ') });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setErr(null);
    try {
      await buildsApi.saveArtifacts(e.scope, { enabled: f.enabled, max_files: Number(f.max_files), max_mb: Number(f.max_mb), keep_days: Number(f.keep_days),
        patterns: f.patterns.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) });
      onDone();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function reset() {
    setBusy(true);
    try { await buildsApi.saveArtifacts(e.scope, null); onDone(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L(`결과물 보관 — ${e.name}`, `Results kept - ${e.name}`)} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy} error={err}
      extra={e.scope !== '_default' && e.own ? <button type="button" className="btn" onClick={reset}>{L('기본으로 되돌리기', 'Use the default')}</button> : undefined}>
      <label className="check"><input type="checkbox" checked={f.enabled} onChange={(x) => setF({ ...f, enabled: x.target.checked })} /><span>{L('작업이 끝나면 결과물을 찾아 보관', 'Keep results when a job ends')}</span></label>
      <label><span>{L('파일 패턴 (쉼표로)', 'File patterns (comma separated)')}</span>
        <textarea rows={2} value={f.patterns} onChange={(x) => setF({ ...f, patterns: x.target.value })} />
        <small className="muted">{L('FPGA: *.bit *.bin *.xclbin *.xsa *.ltx *.sof *.rpt *.log · AI: *.pt *.onnx *.safetensors metrics.json · 하위 폴더: reports/*.rpt', 'FPGA: *.bit *.xclbin *.rpt · AI: *.pt *.onnx · sub-folder: reports/*.rpt')}</small></label>
      <div className="form-row form-row-even">
        <label><span>{L('작업당 파일 수', 'Files per job')}</span><input type="number" min={1} max={500} value={f.max_files} onChange={(x) => setF({ ...f, max_files: Number(x.target.value) })} /></label>
        <label><span>{L('파일 하나 최대 (MB)', 'Largest file (MB)')}</span><input type="number" min={1} max={100000} value={f.max_mb} onChange={(x) => setF({ ...f, max_mb: Number(x.target.value) })} /></label>
        <label><span>{L('보관 기간 (일)', 'Keep (days)')}</span><input type="number" min={1} max={3650} value={f.keep_days} onChange={(x) => setF({ ...f, keep_days: Number(x.target.value) })} /></label>
      </div>
    </Dialog>
  );
}

// --- 카드 대여 › 예약 ------------------------------------------------------------------------

const KIND_TEXT: Record<string, [string, string]> = { gpu: ['GPU', 'GPU'], npu: ['NPU', 'NPU'], fpga: ['FPGA', 'FPGA'], board: ['보드', 'Board'] };

export function bookingStatus(r: AccelBooking, L: (ko: string, en: string) => string) {
  if (r.status === 'approved' && r.finished_at) return <span className="chip">{r.error ? L('시작 못 함', 'failed') : L('끝남', 'ended')}</span>;
  if (r.status === 'approved' && r.started_at) return <span className="chip chip-on">{L('사용 중', 'in use')}</span>;
  return <span className={`chip ${r.status === 'approved' ? 'chip-accent' : r.status === 'pending' ? 'chip-warn' : ''}`}>
    {{ pending: L('승인 대기', 'pending'), approved: L('예약됨', 'booked'), rejected: L('거절', 'rejected'), cancelled: L('취소', 'cancelled') }[r.status]}</span>;
}

export function AccelBookingsAdmin() {
  const { L } = useL();
  const data = useLoad(accelBookingsApi.admin);
  const [err, setErr] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  async function act(r: AccelBooking, action: 'approve' | 'reject' | 'cancel') {
    const reason = action === 'approve' ? '' : (prompt(L('사유 (선택)', 'Reason (optional)')) ?? '');
    setErr(null);
    try { await accelBookingsApi.act(r.id, action, reason); data.reload(); } catch (e) {
      const c = (e as Error).message;
      setErr(c === 'CONFLICT' ? L('그 시간에는 이미 다른 예약 · 대여가 있습니다.', 'That time is taken now.') : AB_WHY_KO[c] ?? c);
    }
  }
  return (
    <LoadState value={data} retry={data.reload}>
      {(d) => {
        const upcoming = d.bookings.filter((r) => r.status === 'approved' && !r.finished_at).sort((a, b) => a.start_at.localeCompare(b.start_at));
        return (
          <>
            <p className="muted small page-intro">{L('사용자가 포털 [예약] › 카드 · 보드에서 GPU · NPU · FPGA 카드나 보드(JTAG)를 자기 데스크톱에 쓸 시간을 예약합니다. 시작 5분 전에 자동으로 대여(보드는 연결)하고, 끝나면 반납합니다. 카드는 데스크톱을 다시 시작해야 보입니다.',
              'Users book a GPU, NPU or FPGA card or a board for their desktop in the portal. It is lent 5 minutes before the start and given back at the end; a card shows after the desktop restarts.')}</p>
            <div className="toolbar">
              <button type="button" className="btn" onClick={data.reload}><Icon name="refresh" size={16} /></button>
              <button type="button" className="btn" onClick={() => setSettings(true)}><Icon name="gear" size={16} />{L('예약 규칙', 'Booking rules')}</button>
            </div>
            <SettingsStatus items={[
              { label: L('예약 받기', 'Bookings'), value: d.settings.enabled ? L('켬', 'on') : L('끔', 'off'), tone: d.settings.enabled ? 'ok' : 'off' },
              { label: L('승인', 'Approval'), value: d.settings.approval ? L('필요', 'needed') : L('바로 확정', 'none') },
              { label: L('최대 길이', 'Longest'), value: L(`${d.settings.max_hours}시간`, `${d.settings.max_hours} h`) },
              { label: L('미리 예약', 'Ahead'), value: L(`${d.settings.max_days_ahead}일`, `${d.settings.max_days_ahead} d`) },
              { label: L('승인 대기', 'Pending'), value: String(d.pending.length), tone: d.pending.length ? 'warn' : undefined },
            ]} />
            {err && <div className="alert small error" role="alert">{err}</div>}
            <section className="panel">
              <h3 className="panel-title">{L('승인 대기', 'Waiting for approval')}</h3>
              {d.pending.length === 0 ? <p className="muted small">{L('기다리는 예약이 없습니다.', 'Nothing waits.')}</p> : <BookingTable rows={d.pending} L={L} actions={(r) => (<>
                <button type="button" className="btn-ghost small-btn" onClick={() => act(r, 'approve')}>{L('승인', 'Approve')}</button>
                <button type="button" className="btn-ghost small-btn danger" onClick={() => act(r, 'reject')}>{L('거절', 'Reject')}</button></>)} />}
            </section>
            <section className="panel">
              <h3 className="panel-title">{L('다가오는 · 사용 중인 예약', 'Upcoming and running')}</h3>
              {upcoming.length === 0 ? <p className="muted small">{L('예약이 없습니다.', 'No bookings.')}</p> : <BookingTable rows={upcoming} L={L}
                actions={(r) => <button type="button" className="btn-ghost small-btn danger" onClick={() => act(r, 'cancel')}>{r.started_at ? L('지금 반납', 'Return now') : L('취소', 'Cancel')}</button>} />}
            </section>
            {settings && <BookingRulesDialog s={d.settings} onClose={() => setSettings(false)} onDone={() => { setSettings(false); data.reload(); }} />}
          </>
        );
      }}
    </LoadState>
  );
}

function BookingTable({ rows, L, actions }: { rows: AccelBooking[]; L: (ko: string, en: string) => string; actions: (r: AccelBooking) => React.ReactNode }) {
  return (
    <div className="table-scroll"><table className="table compact-head">
      <thead><tr><th>{L('일시', 'When')}</th><th>{L('카드 · 보드', 'Card / board')}</th><th>{L('사용자 · 데스크톱', 'User · desktop')}</th><th>{L('목적', 'Purpose')}</th><th>{L('상태', 'State')}</th><th className="actions" /></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id}>
          <td className="nowrap">{local(r.start_at)} ~ {r.end_at.slice(11)}</td>
          <td><span className="chip chip-accent">{L(...(KIND_TEXT[r.card_kind] ?? ['카드', 'Card']))}</span> {r.resource_name}</td>
          <td>{r.username}<br /><span className="muted small">{r.desktop ?? '-'}</span></td>
          <td className="small">{r.purpose || '-'}{r.error && <div className="muted small">{r.error}</div>}</td>
          <td>{bookingStatus(r, L)}</td>
          <td className="actions nowrap">{actions(r)}</td>
        </tr>))}</tbody>
    </table></div>
  );
}

function BookingRulesDialog({ s, onClose, onDone }: { s: ABSettings; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [f, setF] = useState({ ...s, roles: s.roles.join(', ') });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setErr(null);
    try {
      await accelBookingsApi.saveSettings({ enabled: f.enabled, approval: f.approval, max_hours: Number(f.max_hours), max_days_ahead: Number(f.max_days_ahead),
        remind_min: Number(f.remind_min), roles: f.roles.split(',').map((x) => x.trim()).filter(Boolean) });
      onDone();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('카드 · 보드 예약 규칙', 'Card and board booking rules')} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy} error={err}>
      <label className="check"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /><span>{L('포털에서 예약 받기', 'Take bookings in the portal')}</span></label>
      <label className="check"><input type="checkbox" checked={f.approval} onChange={(e) => setF({ ...f, approval: e.target.checked })} /><span>{L('승인 필요 (카드 대여 관리 권한이 있는 사람이 승인)', 'Needs approval (by someone who manages card loans)')}</span></label>
      <div className="form-row form-row-even">
        <label><span>{L('최대 길이 (시간)', 'Longest (hours)')}</span><input type="number" min={1} max={744} value={f.max_hours} onChange={(e) => setF({ ...f, max_hours: Number(e.target.value) })} /></label>
        <label><span>{L('미리 예약 (일)', 'Ahead (days)')}</span><input type="number" min={1} max={366} value={f.max_days_ahead} onChange={(e) => setF({ ...f, max_days_ahead: Number(e.target.value) })} /></label>
        <label><span>{L('시작 전 알림 (분, 0=없음)', 'Reminder (min, 0 none)')}</span><input type="number" min={0} max={1440} value={f.remind_min} onChange={(e) => setF({ ...f, remind_min: Number(e.target.value) })} /></label>
      </div>
      <label><span>{L('예약할 수 있는 역할 (쉼표, 비우면 포털 사용자 모두)', 'Roles that may book (comma, empty: everyone)')}</span>
        <input value={f.roles} placeholder="researcher, ta" onChange={(e) => setF({ ...f, roles: e.target.value })} /></label>
    </Dialog>
  );
}
