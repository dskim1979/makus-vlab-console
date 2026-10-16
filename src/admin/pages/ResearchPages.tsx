import { useState } from 'react';
import { nextApi } from '../../api/next';
import type { FarmPool } from '../../api/next';
import { hoursText, researchApi, waitText } from '../../api/research';
import type { GpuPoolConf, GpuSettings, IdeSession, Quota, QuotaInput, Runtime, UsageDeptRow, UsageReport, UsageUserRow, UsageWindow } from '../../api/research';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { SettingsStatus } from '../../components/SettingsShell';
import { useLoad } from '../../components/useLoad';
import { useL } from './OpsPages';

// 가속 자원 > GPU 작업 큐 · 할당량 · GPU-시간 보고서 · 웹 IDE (makus-vlab pegaprox/api/vlab_research.py).

type Notice = { kind: 'info' | 'error'; text: string } | null;
const errText = (e: unknown) => (e as Error).message;

function NoticeBar({ notice }: { notice: Notice }) {
  return notice ? <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div> : null;
}

function Intro({ children }: { children: React.ReactNode }) {
  return <p className="muted small page-intro">{children}</p>;
}

const envText = (env: { kind: string; name?: string; image?: string } | null | undefined, L: (ko: string, en: string) => string) =>
  !env ? '' : env.kind === 'conda' ? `conda: ${env.name}` : `${L('컨테이너', 'container')}: ${env.image}`;

// --- GPU 작업 큐 ----------------------------------------------------------------------------

export function GpuQueuePage() {
  const { L, when } = useL();
  const q = useLoad(researchApi.queue);
  const farm = useLoad(nextApi.buildfarm);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<FarmPool | null>(null);
  const [settings, setSettings] = useState(false);
  async function stop(id: string, name: string) {
    if (!confirm(L(`'${name}'을(를) 멈출까요? 빌드 VM에서 작업 프로세스를 끝냅니다.`, `Stop '${name}' on its build VM?`))) return;
    try { await researchApi.stopJob(id); q.reload(); setNotice({ kind: 'info', text: L('멈췄습니다.', 'Stopped.') }); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  return (
    <>
      <Intro>{L('GPU를 요구하는 작업이 기다리는 순서와 이유, 실행 중인 작업, 풀마다 GPU가 얼마나 쓰이는지 봅니다. 순서는 할당량을 넘긴 사람 뒤로 → 사람마다 첫 작업 먼저(공정 분배) → 오래 기다린 순입니다. 오래 기다린 큰 작업은 자기 GPU가 빌 때까지 뒤 작업을 막아 둡니다.',
        'Where each GPU job waits and why, what runs, and how much of each pool is in use. Order: over-quota users last, each user\'s first job before anyone\'s second (fair share), then the longest wait. A big job that waited long keeps later ones off the GPUs it needs.')}</Intro>
      <div className="toolbar">
        <button type="button" className="btn" onClick={() => { q.reload(); farm.reload(); }}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
        <button type="button" className="btn" onClick={() => setSettings(true)}><Icon name="gear" size={16} />{L('큐 설정 · 알림', 'Queue settings and notices')}</button>
      </div>
      <NoticeBar notice={notice} />
      <LoadState value={q} retry={q.reload}>
        {(d) => (
          <>
            <SettingsStatus items={[
              { label: L('대기', 'Waiting'), value: String(d.queued.length), tone: d.queued.length ? 'warn' : undefined },
              { label: L('실행 중', 'Running'), value: String(d.running.length), tone: 'ok' },
              { label: L('GPU 사용', 'GPUs in use'), value: `${d.pools.reduce((a, p) => a + p.gpus_used, 0)} / ${d.pools.reduce((a, p) => a + p.gpus, 0)}` },
              { label: L('양보 대기 기준', 'Hold after'), value: d.settings.starve_minutes ? L(`${d.settings.starve_minutes}분`, `${d.settings.starve_minutes} min`) : L('끔', 'off') },
            ]} />
            <section className="panel">
              <h3 className="panel-title">{L('GPU 풀', 'GPU pools')}</h3>
              {d.pools.length === 0 ? <div className="empty"><p>{L('GPU 작업을 받는 빌드 팜 풀이 없습니다. 아래 "풀별 GPU 작업 설정"에서 VM당 GPU 장 수를 정하세요.', 'No build farm pool takes GPU jobs yet. Set GPUs per VM below.')}</p></div> : (
                <div className="gpu-pools">{d.pools.map((p) => {
                  const pct = p.gpus ? Math.round(100 * p.gpus_used / p.gpus) : 0;
                  return (
                    <div key={p.id} className="gpu-pool">
                      <div className="strong">{p.name} {p.kind && <span className="chip">{p.kind}</span>}</div>
                      <div className="muted small">{L(`VM ${p.vms}대 × GPU ${p.gpus_per_vm}장`, `${p.vms} VMs × ${p.gpus_per_vm} GPUs`)} · {p.runtime}{p.max_minutes ? ` · ${L(`최대 ${p.max_minutes}분`, `max ${p.max_minutes} min`)}` : ''}</div>
                      <span className="bar-track"><span className={`bar-fill${pct >= 90 ? ' warn' : ''}`} style={{ width: `${pct}%` }} /></span>
                      <div className="small">{p.gpus_used} / {p.gpus} GPU ({pct}%)</div>
                    </div>
                  );
                })}</div>
              )}
            </section>
            <section className="panel">
              <h3 className="panel-title">{L('대기 중 (실행 순서)', 'Waiting (in the order they run)')}</h3>
              {d.queued.length === 0 ? <div className="empty"><p>{L('기다리는 작업이 없습니다.', 'Nothing waits.')}</p></div> : (
                <div className="table-scroll"><table className="table compact-head">
                  <thead><tr><th>#</th><th>{L('작업', 'Job')}</th><th>{L('사용자', 'User')}</th><th>GPU</th><th>{L('풀', 'Pool')}</th><th>{L('기다린 시간', 'Waited')}</th><th>{L('기다리는 이유', 'Why it waits')}</th></tr></thead>
                  <tbody>{d.queued.map((j) => (
                    <tr key={j.id}>
                      <td className="strong">{j.position ?? '-'}</td>
                      <td className="strong">{j.name}<div className="muted small"><code className="code">{j.command}</code></div>{j.env && <div className="muted small">{envText(j.env, L)}</div>}</td>
                      <td>{j.username}</td>
                      <td>{j.gpus ? <span className="chip chip-accent gpu-chip"><Icon name="gpu" size={12} />{j.gpus}{j.gpu_kind ? ` · ${j.gpu_kind}` : ''}</span> : <span className="muted small">CPU</span>}
                        {j.memory_gb ? <div className="muted small">{j.memory_gb} GB</div> : null}</td>
                      <td>{j.pool ?? <span className="muted small">{L('자동', 'any')}</span>}</td>
                      <td className="muted small">{j.waited_min !== undefined ? (j.waited_min >= 60 ? L(`${Math.floor(j.waited_min / 60)}시간 ${j.waited_min % 60}분`, `${Math.floor(j.waited_min / 60)}h ${j.waited_min % 60}m`) : L(`${j.waited_min}분`, `${j.waited_min} min`)) : '-'}</td>
                      <td><span className={j.wait_reason?.startsWith('quota') ? 'chip chip-warn' : 'chip'}>{waitText(j.wait_reason, L)}</span></td>
                    </tr>))}</tbody>
                </table></div>
              )}
            </section>
            <section className="panel">
              <h3 className="panel-title">{L('실행 중인 GPU 작업', 'GPU jobs running')}</h3>
              {d.running.length === 0 ? <div className="empty"><p>{L('실행 중인 GPU 작업이 없습니다.', 'No GPU job runs.')}</p></div> : (
                <div className="table-scroll"><table className="table compact-head">
                  <thead><tr><th>{L('작업', 'Job')}</th><th>{L('사용자', 'User')}</th><th>GPU</th><th>{L('빌드 VM', 'Build VM')}</th><th>{L('시작', 'Started')}</th><th>{L('최대 실행', 'Limit')}</th><th className="actions" /></tr></thead>
                  <tbody>{d.running.map((j) => (
                    <tr key={j.id}>
                      <td className="strong">{j.name}{j.env && <div className="muted small">{envText(j.env, L)}</div>}</td>
                      <td>{j.username}</td>
                      <td><span className="chip chip-accent gpu-chip"><Icon name="gpu" size={12} />{j.gpus}{j.gpu_index.length ? ` (#${j.gpu_index.join(',')})` : ''}</span></td>
                      <td>{j.desktop}<div className="muted small">{j.pool}</div></td>
                      <td className="muted small">{when(j.started_at)}</td>
                      <td className="muted small">{j.max_minutes ? L(`${j.max_minutes}분`, `${j.max_minutes} min`) : '-'}</td>
                      <td className="actions"><button type="button" className="btn-ghost small-btn danger" onClick={() => stop(j.id, j.name)}>{L('멈추기', 'Stop')}</button></td>
                    </tr>))}</tbody>
                </table></div>
              )}
            </section>
            {settings && <QueueSettingsDialog initial={d.settings} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); q.reload(); setNotice({ kind: 'info', text: L('저장했습니다.', 'Saved.') }); }} />}
          </>
        )}
      </LoadState>
      <section className="panel">
        <h3 className="panel-title">{L('풀별 GPU 작업 설정', 'GPU jobs per pool')}</h3>
        <p className="muted small">{L('빌드 팜 풀의 VM 하나에 GPU가 몇 장 붙어 있는지, 종류 이름(작업이 고를 때 쓰는 이름), 최대 실행 시간, 컨테이너 런타임을 정합니다. GPU는 풀의 GPU 정책(PCI 매핑)이나 VM 하드웨어로 붙입니다.',
          'How many GPUs each VM of a build farm pool has, the kind name jobs ask for, the time limit and the container runtime. The GPUs come from the pool\'s GPU policy (PCI mapping) or the VM hardware.')}</p>
        <LoadState value={farm} retry={farm.reload}>
          {(pools) => pools.length === 0 ? <div className="empty"><p>{L('빌드 팜 풀이 없습니다.', 'No build farm pools.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('풀', 'Pool')}</th><th>{L('VM', 'VMs')}</th><th>{L('VM당 GPU', 'GPUs per VM')}</th><th>{L('종류', 'Kind')}</th><th>{L('최대 실행', 'Limit')}</th><th>{L('런타임', 'Runtime')}</th><th className="actions" /></tr></thead>
              <tbody>{pools.map((p) => (
                <tr key={p.id}>
                  <td className="strong">{p.name}</td><td>{p.total}</td>
                  <td>{p.gpus_per_vm ? p.gpus_per_vm : <span className="muted small">{L('GPU 작업 안 받음', 'no GPU jobs')}</span>}</td>
                  <td>{p.gpu_kind || '-'}</td>
                  <td className="muted small">{p.max_minutes ? L(`${p.max_minutes}분`, `${p.max_minutes} min`) : L('제한 없음', 'none')}</td>
                  <td className="muted small">{p.runtime ?? 'docker'}</td>
                  <td className="actions"><button type="button" className="btn-ghost small-btn" onClick={() => setEditing(p)}>{L('설정', 'Set')}</button></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </LoadState>
      </section>
      {editing && <PoolConfDialog pool={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); farm.reload(); q.reload(); setNotice({ kind: 'info', text: L('풀 설정을 저장했습니다.', 'Pool setting saved.') }); }} />}
    </>
  );
}

function PoolConfDialog({ pool, onClose, onSaved }: { pool: FarmPool; onClose: () => void; onSaved: () => void }) {
  const { L } = useL();
  const [c, setC] = useState<GpuPoolConf>({ gpus_per_vm: pool.gpus_per_vm ?? 0, kind: pool.gpu_kind ?? '', max_minutes: pool.max_minutes ?? 0, runtime: pool.runtime ?? 'docker' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    try { await researchApi.savePoolConf(pool.id, c); onSaved(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L(`GPU 작업 설정 · ${pool.name}`, `GPU jobs · ${pool.name}`)} onClose={onClose} onSubmit={save} submitLabel={L('저장', 'Save')} busy={busy} error={error}>
      <div className="form-row">
        <label><span>{L('VM당 GPU 장 수', 'GPUs per VM')}</span><input id="pc-gpus" type="number" min={0} max={16} value={c.gpus_per_vm} onChange={(e) => setC({ ...c, gpus_per_vm: Math.max(0, Math.min(16, Number(e.target.value) || 0)) })} />
          <small className="muted">{L('0이면 이 풀은 GPU 작업을 받지 않습니다.', '0: this pool takes no GPU jobs.')}</small></label>
        <label><span>{L('GPU 종류 이름', 'GPU kind')}</span><input id="pc-kind" value={c.kind} maxLength={60} placeholder="A100" onChange={(e) => setC({ ...c, kind: e.target.value })} /></label>
      </div>
      <div className="form-row">
        <label><span>{L('최대 실행 시간 (분)', 'Time limit (min)')}</span><input id="pc-min" type="number" min={0} max={43200} value={c.max_minutes} onChange={(e) => setC({ ...c, max_minutes: Math.max(0, Number(e.target.value) || 0) })} />
          <small className="muted">{L('0 = 이 풀은 제한 없음 (큐 기본값은 적용)', '0 = no cap here (the queue default still applies)')}</small></label>
        <label><span>{L('컨테이너 런타임', 'Container runtime')}</span>
          <select id="pc-rt" value={c.runtime} onChange={(e) => setC({ ...c, runtime: e.target.value as Runtime })}>
            <option value="docker">Docker (NVIDIA Container Toolkit)</option><option value="podman">Podman (CDI)</option><option value="apptainer">Apptainer (--nv)</option>
          </select></label>
      </div>
    </Dialog>
  );
}

function QueueSettingsDialog({ initial, onClose, onSaved }: { initial: GpuSettings; onClose: () => void; onSaved: () => void }) {
  const { L } = useL();
  const [s, setS] = useState<GpuSettings>(initial);
  const [channels, setChannels] = useState(initial.channels.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    try { await researchApi.saveSettings({ ...s, channels: channels.split(',').map((x) => x.trim()).filter(Boolean) }); onSaved(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  const num = (k: 'starve_minutes' | 'default_max_minutes' | 'max_queued_per_user' | 'quota_warn_pct' | 'loan_remind_hours' | 'queue_alert_hours', v: string) =>
    setS({ ...s, [k]: Math.max(0, Math.round(Number(v) || 0)) });
  const flag = (k: 'quota_notice' | 'loan_notice' | 'ide_notice' | 'notice_webhook') => (
    { checked: s[k], onChange: (e: { target: { checked: boolean } }) => setS({ ...s, [k]: e.target.checked }) });
  return (
    <Dialog open title={L('GPU 큐 설정 · 알림', 'GPU queue settings and notices')} onClose={onClose} onSubmit={save} submitLabel={L('저장', 'Save')} busy={busy} error={error}>
      <div className="form-row">
        <label><span>{L('양보 대기 기준 (분)', 'Hold GPUs after (min)')}</span><input id="qs-starve" type="number" min={0} max={10080} value={s.starve_minutes} onChange={(e) => num('starve_minutes', e.target.value)} />
          <small className="muted">{L('이만큼 기다린 작업은 필요한 GPU가 빌 때까지 뒤 작업이 그 풀에서 시작하지 못하게 합니다. 0 = 끔', 'A job that waited this long keeps later jobs off its pools until its GPUs are free. 0 = off')}</small></label>
        <label><span>{L('기본 최대 실행 시간 (분)', 'Default time limit (min)')}</span><input id="qs-max" type="number" min={0} max={43200} value={s.default_max_minutes} onChange={(e) => num('default_max_minutes', e.target.value)} /></label>
        <label><span>{L('사용자당 대기 작업 수', 'Waiting jobs per user')}</span><input id="qs-q" type="number" min={1} max={500} value={s.max_queued_per_user} onChange={(e) => num('max_queued_per_user', e.target.value)} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={s.mail} onChange={(e) => setS({ ...s, mail: e.target.checked })} /><span>{L('작업이 끝나면 요청한 사용자에게 메일 (계정의 메일 주소, 플랫폼 설정의 SMTP)', 'Mail the owner when a job ends, when they asked (account address, platform SMTP)')}</span></label>
      <label><span>{L('웹훅 채널 ID (쉼표로)', 'Webhook channel ids (comma separated)')}</span><input id="qs-ch" value={channels} placeholder="ch_slack, ch_teams" onChange={(e) => setChannels(e.target.value)} />
        <small className="muted">{L('운영 > 경보 > 알림 채널의 ID. 사용자가 "웹훅 알림"을 고른 작업만 보냅니다.', 'Ids from 운영 > 경보 > channels. Only jobs whose owner asked for it.')}</small></label>
      <h3>{L('사용자 개인 알림 (메일)', 'Notices to each user (mail)')}</h3>
      <p className="muted small">{L('계정의 메일 주소로 보냅니다. 사용자는 내 계정 > 알림에서 종류별로 끌 수 있습니다.', "Sent to the account's address. Each user can turn kinds off in 내 계정 > 알림.")}</p>
      <div className="form-row">
        <label className="check"><input id="qs-quota" type="checkbox" {...flag('quota_notice')} /><span>{L('GPU 할당량 경고 (월 GPU-시간, 달마다 한 번씩)', 'GPU quota warnings (monthly GPU-hours, once a month each)')}</span></label>
        <label><span>{L('미리 알릴 사용률 (%)', 'Early warning at (%)')}</span><input id="qs-quota-pct" type="number" min={0} max={99} value={s.quota_warn_pct} disabled={!s.quota_notice} onChange={(e) => num('quota_warn_pct', e.target.value)} />
          <small className="muted">{L('이 비율과 100%에서 알립니다. 0 = 100%에서만. 부서 할당량은 부서 책임자와 이번 달 쓴 사람에게 갑니다.', "At this share and at 100%. 0 = at 100% only. A department's goes to its manager and to those who used it this month.")}</small></label>
      </div>
      <div className="form-row">
        <label><span>{L('대여 종료 전 알림 (시간)', 'Loan reminder before the end (h)')}</span><input id="qs-loan-h" type="number" min={0} max={168} value={s.loan_remind_hours} onChange={(e) => num('loan_remind_hours', e.target.value)} />
          <small className="muted">{L('GPU·NPU·FPGA 카드와 보드 대여. 0 = 보내지 않음', 'Card and board loans. 0 = none')}</small></label>
        <label className="check"><input id="qs-loan" type="checkbox" {...flag('loan_notice')} /><span>{L('대여 기간이 끝나 자동 반납되면 알림', 'Tell when a loan ended and went back by itself')}</span></label>
      </div>
      <label className="check"><input id="qs-ide" type="checkbox" {...flag('ide_notice')} /><span>{L('웹 IDE가 유휴 시간으로 또는 관리자가 닫으면 알림', 'Tell when a web IDE closed for being idle or by an administrator')}</span></label>
      <label className="check"><input id="qs-hook" type="checkbox" {...flag('notice_webhook')} /><span>{L('위 알림을 웹훅 채널에도 보내기', 'Post these notices to the webhook channels too')}</span></label>
      <h3>{L('관리자 경보', 'Alerts to administrators')}</h3>
      <label><span>{L('GPU 작업이 이만큼 기다리면 경보 (시간)', 'Alert when a GPU job waits this long (h)')}</span><input id="qs-late" type="number" min={0} max={168} value={s.queue_alert_hours} onChange={(e) => num('queue_alert_hours', e.target.value)} />
        <small className="muted">{L('작업마다 한 번, 운영 > 경보의 채널과 경보 메일 수신자에게. 0 = 끔', 'Once per job, to the alert channels and alert mail recipients. 0 = off')}</small></label>
    </Dialog>
  );
}

// --- GPU 할당량 ------------------------------------------------------------------------------

export function GpuQuotasPage() {
  const { L, when } = useL();
  const list = useLoad(researchApi.quotas);
  const deps = useLoad(nextApi.departments);
  const [editing, setEditing] = useState<Quota | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  async function remove(q: Quota) {
    if (!confirm(L('이 할당량을 지울까요?', 'Delete this quota?'))) return;
    try { await researchApi.deleteQuota(q.subject_type, q.subject_id); list.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  const subj = (q: Quota) => q.subject_type === 'default' ? L('기본 (따로 정하지 않은 모든 사용자)', 'Default (everyone without one of their own)')
    : q.subject_type === 'department' ? `${L('부서', 'Department')} · ${q.name || q.subject_id}` : `${L('사용자', 'User')} · ${q.subject_id}`;
  return (
    <>
      <Intro>{L('사용자 · 부서(연구실)마다 동시에 쓸 수 있는 GPU 장 수와 한 달 GPU-시간을 정합니다. 동시 GPU를 다 쓰면 새 작업은 기다리고, 월 GPU-시간을 넘기면 작업이 큐 뒤로 갑니다("엄격"이면 다음 달까지 시작하지 않음). 부서 할당량은 그 부서와 하위 부서 전체에 걸립니다. GPU-시간은 GPU 작업과 카드 대여를 합한 값입니다.',
        'GPUs at once and GPU-hours a month per user and per department (lab). At the GPUs-at-once limit new jobs wait; past the month\'s hours jobs go to the back (with "hard", none starts until next month). A department\'s quota covers it and every department below. GPU-hours are GPU jobs plus card loans.')}</Intro>
      <div className="toolbar">
        <button type="button" className="btn" onClick={list.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
        <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('할당량 추가', 'Add a quota')}</button>
      </div>
      <NoticeBar notice={notice} />
      <LoadState value={list} retry={list.reload}>
        {(d) => (
          <>
            <section className="panel">
              {d.quotas.length === 0 ? <div className="empty"><p>{L('할당량이 없습니다. 제한 없이 큐 순서대로 돌아갑니다.', 'No quotas: jobs run in queue order without limits.')}</p></div> : (
                <div className="table-scroll"><table className="table compact-head">
                  <thead><tr><th>{L('대상', 'Applies to')}</th><th>{L('동시 GPU', 'GPUs at once')}</th><th>{L('월 GPU-시간', 'GPU-hours a month')}</th><th>{L('지금 · 이번 달', 'Now · this month')}</th><th>{L('메모', 'Note')}</th><th className="actions" /></tr></thead>
                  <tbody>{d.quotas.map((q) => {
                    const pct = q.monthly_gpu_hours && q.hours_month ? Math.min(100, Math.round(100 * q.hours_month / q.monthly_gpu_hours)) : 0;
                    return (
                      <tr key={`${q.subject_type}:${q.subject_id}`}>
                        <td className="strong">{subj(q)}</td>
                        <td>{q.max_gpus || L('제한 없음', 'no limit')}</td>
                        <td>{q.monthly_gpu_hours || L('제한 없음', 'no limit')}{q.hard && <span className="chip chip-warn" style={{ marginLeft: 6 }}>{L('엄격', 'hard')}</span>}</td>
                        <td>{q.gpus_now === null || q.gpus_now === undefined ? <span className="muted small">{L('사람마다', 'per person')}</span> : (
                          <span className="quota-use">{q.gpus_now} GPU · {hoursText(q.hours_month)} h
                            {q.monthly_gpu_hours > 0 && <span className="bar-track"><span className={`bar-fill${pct >= 100 ? ' warn' : ''}`} style={{ width: `${pct}%` }} /></span>}</span>)}</td>
                        <td className="muted small">{q.note}</td>
                        <td className="actions">
                          <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(q)}>{L('고치기', 'Edit')}</button>
                          <button type="button" className="btn-ghost small-btn danger" onClick={() => remove(q)}>{L('지우기', 'Delete')}</button>
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
              )}
            </section>
            <section className="panel">
              <h3 className="panel-title">{L(`이번 달 사용 (${when(d.month_start)}부터)`, `This month (since ${when(d.month_start)})`)}</h3>
              {d.users.length === 0 ? <div className="empty"><p>{L('이번 달 GPU 사용이 없습니다.', 'No GPU use this month.')}</p></div> : (
                <div className="table-scroll"><table className="table compact-head">
                  <thead><tr><th>{L('사용자', 'User')}</th><th>{L('지금 GPU', 'GPUs now')}</th><th>{L('GPU-시간', 'GPU-hours')}</th></tr></thead>
                  <tbody>{d.users.map((u) => <tr key={u.username}><td className="strong">{u.username}</td><td>{u.gpus_now}</td><td>{hoursText(u.hours_month)}</td></tr>)}</tbody>
                </table></div>
              )}
            </section>
          </>
        )}
      </LoadState>
      {editing && <QuotaDialog initial={editing === 'new' ? null : editing} departments={deps.state === 'ok' ? deps.data : []}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); setNotice({ kind: 'info', text: L('저장했습니다. 다음 큐 순서부터 적용됩니다.', 'Saved; the queue uses it from its next round.') }); }} />}
    </>
  );
}

function QuotaDialog({ initial, departments, onClose, onSaved }: { initial: Quota | null; departments: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { L } = useL();
  const [q, setQ] = useState<QuotaInput>(initial ? { subject_type: initial.subject_type, subject_id: initial.subject_id, max_gpus: initial.max_gpus,
    monthly_gpu_hours: initial.monthly_gpu_hours, hard: initial.hard, note: initial.note } : { subject_type: 'user', subject_id: '', max_gpus: 2, monthly_gpu_hours: 200, hard: false, note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    try { await researchApi.saveQuota(q); onSaved(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={initial ? L('할당량 고치기', 'Edit quota') : L('할당량 추가', 'Add a quota')} onClose={onClose} onSubmit={save} submitLabel={L('저장', 'Save')}
      busy={busy || (q.subject_type !== 'default' && !q.subject_id)} error={error}>
      <div className="form-row">
        <label><span>{L('대상', 'Applies to')}</span>
          <select id="qd-type" value={q.subject_type} disabled={!!initial} onChange={(e) => setQ({ ...q, subject_type: e.target.value as QuotaInput['subject_type'], subject_id: '' })}>
            <option value="user">{L('사용자', 'User')}</option><option value="department">{L('부서 (연구실)', 'Department (lab)')}</option><option value="default">{L('기본값', 'Default')}</option>
          </select></label>
        {q.subject_type === 'user' && <label><span>{L('사용자 아이디', 'Username')}</span><input id="qd-user" value={q.subject_id} disabled={!!initial} placeholder="alice" onChange={(e) => setQ({ ...q, subject_id: e.target.value.trim() })} /></label>}
        {q.subject_type === 'department' && <label><span>{L('부서', 'Department')}</span>
          <select id="qd-dep" value={q.subject_id} disabled={!!initial} onChange={(e) => setQ({ ...q, subject_id: e.target.value })}>
            <option value="">{L('고르세요', 'Choose')}</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>}
      </div>
      <div className="form-row">
        <label><span>{L('동시 GPU 장 수', 'GPUs at once')}</span><input id="qd-gpus" type="number" min={0} max={1024} value={q.max_gpus} onChange={(e) => setQ({ ...q, max_gpus: Math.max(0, Number(e.target.value) || 0) })} />
          <small className="muted">{L('0 = 제한 없음. 대여 중인 카드도 셉니다.', '0 = no limit. Cards on loan count too.')}</small></label>
        <label><span>{L('월 GPU-시간', 'GPU-hours a month')}</span><input id="qd-hours" type="number" min={0} step="0.5" value={q.monthly_gpu_hours} onChange={(e) => setQ({ ...q, monthly_gpu_hours: Math.max(0, Number(e.target.value) || 0) })} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={q.hard} onChange={(e) => setQ({ ...q, hard: e.target.checked })} />
        <span>{L('엄격: 월 GPU-시간을 넘기면 다음 달까지 새 GPU 작업을 시작하지 않음 (끄면 큐 뒤로만 감)', 'Hard: past the month\'s hours no new GPU job starts until next month (off: they only go to the back)')}</span></label>
      <label><span>{L('메모', 'Note')}</span><input id="qd-note" value={q.note} maxLength={200} onChange={(e) => setQ({ ...q, note: e.target.value })} /></label>
    </Dialog>
  );
}

// --- GPU-시간 보고서 (비용 배분) --------------------------------------------------------------

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function GpuUsagePage() {
  const { L, when } = useL();
  const [period, setPeriod] = useState<string>('30');
  const [month, setMonth] = useState(thisMonth());
  const [group, setGroup] = useState<'user' | 'department'>('user');
  const [rollup, setRollup] = useState(false);
  const w: UsageWindow = period === 'month' ? { month, rollup } : { days: Number(period), rollup };
  const cur = useLoad<UsageReport<UsageUserRow | UsageDeptRow>>(() => (group === 'user' ? researchApi.usageByUser(w) : researchApi.usageByDept(w)),
    [period, month, group, rollup]);
  function csv() {
    if (cur.state !== 'ok') return;
    const q = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const tag = period === 'month' ? month : `${period}d`;
    const rows = cur.data.rows;
    const lines = group === 'user'
      ? ['user,name,department,job_gpu_hours,loan_gpu_hours,total_gpu_hours,share_pct,jobs,loans',
        ...(rows as UsageUserRow[]).map((r) => [q(r.username), q(r.display_name), q(r.department), r.job_gpu_hours, r.loan_gpu_hours, r.total_gpu_hours, r.share_pct, r.jobs, r.loans].join(','))]
      : ['department,users,job_gpu_hours,loan_gpu_hours,total_gpu_hours,share_pct',
        ...(rows as UsageDeptRow[]).map((r) => [q(r.department), r.users, r.job_gpu_hours, r.loan_gpu_hours, r.total_gpu_hours, r.share_pct].join(','))];
    const url = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `gpu-usage-${group}-${tag}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return (
    <>
      <Intro>{L('사용자 · 부서별 GPU-시간입니다. GPU 작업은 받은 GPU 장 수 × 실행 시간, 카드 대여(GPU · NPU)는 대여 시간입니다. 연구실별 비용 배분의 근거로 CSV를 내려받으세요. 작업은 보낼 때의 부서로, 대여는 지금 부서로 셉니다.',
        'GPU-hours per user and department: GPU jobs as GPUs × run time, card loans (GPU, NPU) as loan time. Download the CSV as the basis of a cost split. A job counts to the department it was sent from, a loan to the user\'s department now.')}</Intro>
      <div className="toolbar">
        <div className="seg" role="group" aria-label={L('묶음', 'Group by')}>
          <button type="button" className={group === 'user' ? 'on' : ''} aria-pressed={group === 'user'} onClick={() => setGroup('user')}>{L('사용자별', 'By user')}</button>
          <button type="button" className={group === 'department' ? 'on' : ''} aria-pressed={group === 'department'} onClick={() => setGroup('department')}>{L('부서별', 'By department')}</button>
        </div>
        <select aria-label={L('기간', 'Period')} value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="7">{L('최근 7일', 'Last 7 days')}</option><option value="30">{L('최근 30일', 'Last 30 days')}</option><option value="90">{L('최근 90일', 'Last 90 days')}</option>
          <option value="month">{L('월 지정', 'A month')}</option>
        </select>
        {period === 'month' && <input type="month" aria-label={L('월', 'Month')} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />}
        {group === 'department' && <label className="check"><input type="checkbox" checked={rollup} onChange={(e) => setRollup(e.target.checked)} /><span>{L('최상위 부서로 합치기', 'Roll up to top departments')}</span></label>}
        <button type="button" className="btn" disabled={cur.state !== 'ok' || !cur.data.rows.length} onClick={csv}><Icon name="download" size={16} />CSV</button>
      </div>
      <LoadState value={cur} retry={cur.reload}>
        {(d) => (
          <>
            <SettingsStatus items={[
              { label: L('전체 GPU-시간', 'Total GPU-hours'), value: hoursText(d.total_gpu_hours) },
              { label: L('작업', 'Jobs'), value: hoursText(d.rows.reduce((a, r) => a + r.job_gpu_hours, 0)) },
              { label: L('대여', 'Loans'), value: hoursText(d.rows.reduce((a, r) => a + r.loan_gpu_hours, 0)) },
              { label: L('기간', 'Period'), value: `${when(d.since)} ~ ${when(d.until)}` },
            ]} />
            {d.rows.length === 0 ? <div className="empty"><p>{L('이 기간에 GPU 사용이 없습니다.', 'No GPU use in this period.')}</p></div> : (
              <div className="table-scroll"><table className="table compact-head">
                <thead><tr>{group === 'user' ? <><th>{L('사용자', 'User')}</th><th>{L('부서', 'Department')}</th></> : <><th>{L('부서', 'Department')}</th><th>{L('사용자 수', 'Users')}</th></>}
                  <th>{L('작업 GPU-시간', 'Job GPU-hours')}</th><th>{L('대여 시간', 'Loan hours')}</th><th>{L('합계', 'Total')}</th><th>{L('비율', 'Share')}</th></tr></thead>
                <tbody>{d.rows.map((r) => (
                  <tr key={'username' in r ? r.username : r.department_id || '-'}>
                    {'username' in r ? <><td className="strong">{r.username}{r.display_name && <span className="muted small"> {r.display_name}</span>}</td><td>{r.department || <span className="muted small">-</span>}</td></>
                      : <><td className="strong">{r.department}</td><td>{r.users}</td></>}
                    <td>{hoursText(r.job_gpu_hours)}</td><td>{hoursText(r.loan_gpu_hours)}</td><td className="strong">{hoursText(r.total_gpu_hours)}</td>
                    <td className="share-cell"><span className="bar-track"><span className="bar-fill" style={{ width: `${r.share_pct}%` }} /></span><span className="muted small">{r.share_pct}%</span></td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </>
        )}
      </LoadState>
    </>
  );
}

// --- 웹 IDE 세션 ---------------------------------------------------------------------------

const IDE_NAME = { jupyter: 'JupyterLab', vscode: 'VS Code' } as const;

export function IdeSessionsPage() {
  const { L, when } = useL();
  const list = useLoad(researchApi.ideSessions);
  const [notice, setNotice] = useState<Notice>(null);
  const [all, setAll] = useState(false);
  async function stop(s: IdeSession) {
    if (!confirm(L(`${s.username}의 ${IDE_NAME[s.kind]}을(를) 끌까요?`, `Stop ${s.username}'s ${IDE_NAME[s.kind]}?`))) return;
    try { await researchApi.adminStopIde(s.id); list.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  const S = { starting: L('시작 중', 'starting'), running: L('실행 중', 'running'), stopped: L('꺼짐', 'stopped'), failed: L('실패', 'failed') };
  return (
    <>
      <Intro>{L('사용자가 포털에서 연 JupyterLab · VS Code입니다. 풀 정책 > 접속에서 "웹 IDE"를 켠 풀의 Linux 데스크톱 · 빌드 VM에서 사용자 계정으로 돌고, vlab-proxy의 /ide/ 경로로만 들어갑니다(엔진이 1분짜리 일회용 링크 → 그 경로 전용 쿠키). 쓰지 않으면 풀 정책의 유휴 시간 뒤 스스로 꺼집니다.',
        'JupyterLab and VS Code opened from the portal. They run as the user on Linux desktops and build VMs of pools whose policy turns on the web IDE, reached only through vlab-proxy /ide/ (a one-minute one-time link from the engine, then a cookie for that path). Unused, they end after the pool\'s idle time.')}</Intro>
      <div className="toolbar">
        <button type="button" className="btn" onClick={list.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
        <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>{L('끝난 세션도 보기', 'Show ended sessions')}</span></label>
      </div>
      <NoticeBar notice={notice} />
      <LoadState value={list} retry={list.reload}>
        {(rows) => {
          const shown = rows.filter((s) => all || s.state === 'running' || s.state === 'starting');
          return shown.length === 0 ? <div className="empty"><p>{L('열려 있는 웹 IDE가 없습니다.', 'No web IDE is open.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('사용자', 'User')}</th><th>IDE</th><th>{L('데스크톱', 'Desktop')}</th><th>{L('폴더', 'Folder')}</th><th>{L('상태', 'State')}</th><th>{L('시작', 'Started')}</th><th>{L('마지막 사용', 'Last used')}</th><th className="actions" /></tr></thead>
              <tbody>{shown.map((s) => (
                <tr key={s.id}>
                  <td className="strong">{s.username}</td><td>{IDE_NAME[s.kind]}</td><td>{s.desktop ?? s.desktop_id}</td>
                  <td><code className="code">{s.workdir || '~'}</code></td>
                  <td><span className={s.state === 'running' ? 'chip chip-on' : s.state === 'failed' ? 'chip chip-warn' : 'chip'}>{S[s.state]}</span>{s.error && <div className="muted small">{s.error}</div>}</td>
                  <td className="muted small">{when(s.started_at)}</td><td className="muted small">{when(s.last_seen)}</td>
                  <td className="actions">{(s.state === 'running' || s.state === 'starting') && <button type="button" className="btn-ghost small-btn danger" onClick={() => stop(s)}>{L('끄기', 'Stop')}</button>}</td>
                </tr>))}</tbody>
            </table></div>
          );
        }}
      </LoadState>
      <section className="panel">
        <h3 className="panel-title">{L('템플릿 준비 (데스크톱 · 빌드 VM 이미지)', 'Preparing the template (desktop and build VM image)')}</h3>
        <ol className="small guide-list">
          <li>{L('QEMU 게스트 에이전트를 켭니다: ', 'Turn on the QEMU guest agent: ')}<code className="code">apt install qemu-guest-agent && systemctl enable --now qemu-guest-agent</code></li>
          <li>{L('사용자 계정이 VM 안에 있어야 합니다 (AD/LDAP 가입 SSSD — 공유 저장소와 같은 조건).', 'The user\'s account must exist in the VM (AD/LDAP via SSSD, as for shared storage).')}</li>
          <li>JupyterLab: <code className="code">python3 -m pip install 'jupyterlab&gt;=4' jupyter-server-proxy jupyter-vscode-proxy</code> {L('(모두가 쓰는 위치, 예: /opt/jupyter 가상환경 → PATH)', '(for everyone, e.g. a /opt/jupyter venv on the PATH)')}</li>
          <li>VS Code: <code className="code">curl -fsSL https://code-server.dev/install.sh | sh</code> {L('— code-server는 127.0.0.1에서만 듣고 Jupyter 인증 뒤로 들어갑니다.', '— code-server listens on 127.0.0.1 only, behind Jupyter\'s authentication.')}</li>
          <li>{L('GPU 작업용: NVIDIA 드라이버 · CUDA, 컨테이너를 쓰면 Docker + NVIDIA Container Toolkit (또는 Podman CDI · Apptainer), conda를 쓰면 /opt/conda 또는 각자 ~/miniconda3.', 'For GPU jobs: the NVIDIA driver and CUDA; for containers Docker with the NVIDIA Container Toolkit (or Podman CDI, Apptainer); for conda /opt/conda or each user\'s ~/miniconda3.')}</li>
          <li>{L('방화벽: vlab-proxy(콘솔 서버) → VM의 8890-8989/tcp만 엽니다. 사용자 PC에는 열지 않습니다.', 'Firewall: open 8890-8989/tcp from vlab-proxy (the console server) to the VMs only, never to user PCs.')}</li>
        </ol>
      </section>
    </>
  );
}
