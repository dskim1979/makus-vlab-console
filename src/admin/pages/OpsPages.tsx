import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { adminApi } from '../../api/admin';
import { ApiError } from '../../api/client';
import { opsApi } from '../../api/ops';
import type { ClusterHa, HaGroup, HaResource, MaintPreview, MaintStatus, OpsTask, PairMember, PairStatus } from '../../api/ops';
import type { Cluster, ClusterNode } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { SettingsStatus } from '../../components/SettingsShell';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { ClusterFrame, useCluster } from './ClusterPages';

// 운영 기본: 운영 > 작업 진행 (the long Proxmox tasks), the node actions of 클러스터 > 노드
// (maintenance, restart, shut down, the node's log, sensors and tasks), 클러스터 > 고가용성
// (Proxmox HA) and 플랫폼 설정 > 서버 이중화 (MOAVI Desk's own active and standby servers).
// Texts are inline ko/en pairs, as in NextPages.tsx.

type Notice = { kind: 'info' | 'error'; text: string } | null;
const errText = (e: unknown) => (e as Error).message;
const codeOf = (e: unknown) => ((e as ApiError).body as { code?: string } | undefined)?.code;

export function useL() {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const loc = lang === 'ko' ? 'ko-KR' : 'en-US';
  const at = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toLocaleString(loc,
    { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(loc,
    { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '-');
  const dur = (s: number) => (s < 60 ? L(`${s}초`, `${s}s`) : s < 3600 ? L(`${Math.floor(s / 60)}분 ${s % 60}초`, `${Math.floor(s / 60)}m ${s % 60}s`)
    : L(`${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`, `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`));
  return { L, at, when, dur, lang };
}

function NoticeBar({ notice }: { notice: Notice }) {
  return notice ? <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div> : null;
}

// re-run `fn` every `ms` while `on`, and only while the page is shown
function useEvery(fn: () => void, ms: number, on = true) {
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') f.current(); }, ms);
    return () => clearInterval(id);
  }, [ms, on]);
}

// --- 작업 진행 ------------------------------------------------------------------------

const KINDS: Record<string, [string, string]> = {
  qmclone: ['복제', 'Clone'], vzclone: ['복제', 'Clone'], qmigrate: ['마이그레이션', 'Migration'], vzmigrate: ['마이그레이션', 'Migration'],
  hamigrate: ['HA 이동', 'HA move'], hastart: ['HA 시작', 'HA start'], hastop: ['HA 중지', 'HA stop'],
  vzdump: ['백업', 'Backup'], qmrestore: ['복원', 'Restore'], vzrestore: ['복원', 'Restore'],
  qmsnapshot: ['스냅샷', 'Snapshot'], vzsnapshot: ['스냅샷', 'Snapshot'], qmrollback: ['스냅샷 되돌리기', 'Rollback'], vzrollback: ['스냅샷 되돌리기', 'Rollback'],
  qmdelsnapshot: ['스냅샷 삭제', 'Delete snapshot'], qmcreate: ['VM 만들기', 'Create VM'], vzcreate: ['컨테이너 만들기', 'Create container'],
  qmdestroy: ['VM 삭제', 'Delete VM'], vzdestroy: ['컨테이너 삭제', 'Delete container'], qmtemplate: ['템플릿 만들기', 'Make template'],
  qmstart: ['시작', 'Start'], vzstart: ['시작', 'Start'], qmstop: ['강제 끄기', 'Stop'], vzstop: ['강제 끄기', 'Stop'], qmshutdown: ['종료', 'Shut down'],
  vzshutdown: ['종료', 'Shut down'], qmreboot: ['재시작', 'Reboot'], qmmove: ['디스크 이동', 'Move disk'], move_volume: ['디스크 이동', 'Move disk'],
  resize: ['디스크 늘리기', 'Grow disk'], download: ['ISO 내려받기', 'ISO download'], imgcopy: ['ISO 올리기', 'ISO upload'],
  startall: ['모두 시작', 'Start all'], stopall: ['모두 끄기', 'Stop all'], migrateall: ['모두 이동', 'Migrate all'],
  vncproxy: ['콘솔', 'Console'], vncshell: ['노드 셸', 'Node shell'], spiceproxy: ['SPICE 콘솔', 'SPICE console'], aptupdate: ['업데이트 확인', 'Update check'],
};
// what the page shows by default: the work that takes a while
const LONG = new Set(['qmclone', 'vzclone', 'qmigrate', 'vzmigrate', 'hamigrate', 'vzdump', 'qmrestore', 'vzrestore', 'qmmove', 'move_volume',
  'download', 'imgcopy', 'qmcreate', 'vzcreate', 'qmtemplate', 'qmdestroy', 'startall', 'stopall', 'migrateall', 'qmsnapshot', 'qmrollback']);

export function useKind() {
  const { pick } = useI18n();
  return (type: string) => (KINDS[type] ? pick({ ko: KINDS[type][0], en: KINDS[type][1] }) : type);
}

function target(t: OpsTask) {
  if (t.desktop) return t.desktop.name;
  return t.vmid !== null ? `VM ${t.vmid}` : '-';
}

function TaskState({ t }: { t: OpsTask }) {
  const { L } = useL();
  if (t.running) {
    return t.percent !== null ? (
      <span className="util" title={`${t.percent}%`}>
        <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, t.percent)}%` }} /></span>
        <span className="bar-n">{Math.round(t.percent)}%</span>
      </span>
    ) : <span className="status st-in_use"><span className="vmm-spin" />{L('진행 중', 'Running')}</span>;
  }
  return t.ok
    ? <span className="status st-ready"><span className="dot" />{t.status.startsWith('WARNINGS') ? L('완료 (경고)', 'Done (warnings)') : L('완료', 'Done')}</span>
    : <span className="status st-error" title={t.status}><span className="dot" />{L('실패', 'Failed')}</span>;
}

type TaskFilter = 'running' | 'all' | 'failed';

export function TasksPage() {
  const { L, at, dur } = useL();
  const kind = useKind();
  const tasks = useLoad(() => opsApi.tasks(300));
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [longOnly, setLongOnly] = useState(true);
  const [log, setLog] = useState<OpsTask | null>(null);
  const running = tasks.state === 'ok' ? tasks.data.running : 0;
  useEvery(tasks.reload, running ? 4000 : 20000);
  const now = Math.floor(Date.now() / 1000);

  return (
    <LoadState value={tasks} retry={tasks.reload}>
      {(d) => {
        const clusters = new Set(d.tasks.map((t) => t.cluster_id));
        const shown = d.tasks.filter((t) => (!longOnly || LONG.has(t.type) || t.running || !t.ok)
          && (filter === 'all' || (filter === 'running' ? t.running : !t.running && !t.ok)));
        const failed = d.tasks.filter((t) => !t.running && !t.ok).length;
        return (
          <>
            <p className="muted small page-intro">{d.scope === 'all'
              ? L('복제 · 골든 이미지 배포 · 롤아웃 · 마이그레이션 · 백업처럼 시간이 걸리는 Proxmox 작업입니다. 진행 중인 작업이 위에, 끝난 작업이 최근 순으로 나옵니다. 실패한 작업은 로그에서 이유를 볼 수 있습니다.',
                'The Proxmox work that takes a while: clones, golden-image deploys and rollouts, migrations, backups. Running tasks come first, then the latest that ended. A failed task\'s log says why.')
              : L('내 데스크톱의 작업과 내가 시작한 작업만 보입니다.', 'Only the tasks of your desktops and the ones you started.')}</p>
            <div className="toolbar">
              <div className="segmented" role="group" aria-label={L('보기', 'Show')}>
                {([['all', L('전체', 'All')], ['running', L(`진행 중 ${d.running}`, `Running ${d.running}`)], ['failed', L(`실패 ${failed}`, `Failed ${failed}`)]] as [TaskFilter, string][]).map(([id, label]) => (
                  <button key={id} type="button" className={filter === id ? 'on' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
                ))}
              </div>
              <label className="check small"><input type="checkbox" checked={longOnly} onChange={(e) => setLongOnly(e.target.checked)} />
                <span>{L('긴 작업만 (시작 · 종료 · 콘솔 숨김)', 'Long work only (hide start, stop, console)')}</span></label>
              <button type="button" className="btn" onClick={tasks.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
            </div>
            {shown.length === 0 ? <div className="empty"><p>{filter === 'running' ? L('진행 중인 작업이 없습니다.', 'Nothing is running.') : L('작업이 없습니다.', 'No tasks.')}</p></div> : (
              <div className="table-scroll"><table className="table compact-head">
                <thead><tr><th>{L('작업', 'Task')}</th><th>{L('대상', 'Target')}</th><th>{L('노드', 'Node')}</th><th>{L('시작', 'Started')}</th>
                  <th>{L('걸린 시간', 'Duration')}</th><th>{L('상태', 'State')}</th><th>{L('요청', 'By')}</th><th className="actions" /></tr></thead>
                <tbody>{shown.map((t) => (
                  <tr key={`${t.cluster_id}/${t.upid}`}>
                    <td className="strong nowrap">{kind(t.type)}</td>
                    <td>{target(t)}{t.desktop && t.vmid !== null && <span className="muted small"> · {t.vmid}</span>}
                      {clusters.size > 1 && <div className="muted small">{t.cluster}</div>}</td>
                    <td className="nowrap">{t.node}</td>
                    <td className="nowrap muted small">{at(t.starttime)}</td>
                    <td className="nowrap">{t.starttime ? dur(Math.max(0, (t.endtime ?? now) - t.starttime)) : '-'}</td>
                    <td><TaskState t={t} />{!t.running && !t.ok && <div className="muted small task-why">{t.status}</div>}</td>
                    <td className="muted small">{t.user || '-'}</td>
                    <td className="actions"><button type="button" className="btn-ghost small-btn" onClick={() => setLog(t)}>{L('로그', 'Log')}</button></td>
                  </tr>))}</tbody>
              </table></div>
            )}
            {log && <TaskLogDialog task={log} onClose={() => setLog(null)} />}
          </>
        );
      }}
    </LoadState>
  );
}

export function TaskLogDialog({ task, onClose }: { task: OpsTask; onClose: () => void }) {
  const { L } = useL();
  const kind = useKind();
  const log = useLoad(useCallback(() => opsApi.taskLog(task.cluster_id, task.upid), [task.cluster_id, task.upid]), [task.upid]);
  useEvery(log.reload, 3000, log.state === 'ok' && log.data.running);
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => { if (pre.current) pre.current.scrollTop = pre.current.scrollHeight; }, [log]);
  return (
    <Dialog open wide title={`${kind(task.type)} · ${target(task)}`} onClose={onClose}>
      <LoadState value={log} retry={log.reload}>
        {(l) => (
          <>
            <p className="muted small">{task.node} · <code className="code">{task.upid}</code></p>
            {l.running ? <div className="alert small info" role="status">{L('진행 중입니다. 로그가 저절로 이어집니다.', 'Running; the log follows by itself.')}</div>
              : l.ok ? <div className="alert small info" role="status">{L('끝났습니다.', 'Done.')} {l.status !== 'OK' && l.status}</div>
              : <div className="alert small error" role="alert">{L('실패했습니다: ', 'Failed: ')}{l.status}</div>}
            <pre ref={pre} className="job-output task-log">{l.lines.length ? l.lines.map((ln, i) => (
              <span key={i} className={/^(TASK )?ERROR|error:|failed/i.test(ln) ? 'log-bad' : /^WARN/i.test(ln) ? 'log-warn' : undefined}>{ln}{'\n'}</span>
            )) : L('(로그 없음)', '(no log)')}</pre>
          </>
        )}
      </LoadState>
    </Dialog>
  );
}

// --- 클러스터 > 노드: maintenance, restart, shut down, details ---------------------------------

const EVACUATING = new Set(['starting', 'evacuating', 'migrating', 'in_progress']);

export function NodeRowActions({ cluster, node, onChanged }: { cluster: Cluster; node: ClusterNode; onChanged: () => void }) {
  const { L } = useL();
  const [dialog, setDialog] = useState<'enter' | 'detail' | 'reboot' | 'shutdown' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const status = useLoad(useCallback(() => (node.maintenance ? opsApi.maintenance(cluster.id, node.node) : Promise.resolve<MaintStatus>({ maintenance_mode: false })),
    [cluster.id, node.node, node.maintenance]), [cluster.id, node.node, node.maintenance]);
  const st = status.state === 'ok' ? status.data : null;
  const moving = !!st?.status && EVACUATING.has(st.status);
  useEvery(status.reload, 3000, moving);
  const wasMoving = useRef(false);
  useEffect(() => {   // the guests have moved: the row's counts changed
    if (wasMoving.current && !moving) onChanged();
    wasMoving.current = moving;
  }, [moving]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ready = !!st?.status && !moving && node.online;   // in maintenance, guests moved off

  async function leave() {
    if (!confirm(L(`${node.node}의 유지보수를 끝낼까요? 다시 VM을 받을 수 있게 됩니다.`, `End maintenance on ${node.node}? It takes VMs again.`))) return;
    try { await opsApi.setMaintenance(cluster.id, node.node, false); setNotice(null); onChanged(); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }

  return (
    <>
      {st?.status && (
        <div className="muted small nowrap">
          {moving ? <><span className="vmm-spin" />{L(`VM 옮기는 중 ${st.migrated_vms ?? 0}/${st.total_vms ?? 0}`, `Moving VMs ${st.migrated_vms ?? 0}/${st.total_vms ?? 0}`)}</>
            : (st.failed_vms?.length ? <span className="status st-error">{L(`옮기지 못한 VM ${st.failed_vms.length}대`, `${st.failed_vms.length} VM(s) not moved`)}</span>
              : L('VM을 모두 옮김', 'VMs moved off'))}
        </div>
      )}
      <div className="node-actions">
        <button type="button" className="btn-ghost small-btn" onClick={() => setDialog('detail')}>{L('자세히', 'Details')}</button>
        {node.maintenance
          ? <button type="button" className="btn-ghost small-btn" onClick={leave} disabled={moving}>{L('유지보수 끝내기', 'End maintenance')}</button>
          : <button type="button" className="btn-ghost small-btn" onClick={() => setDialog('enter')} disabled={!node.online}>{L('유지보수', 'Maintenance')}</button>}
        {ready && <>
          <button type="button" className="btn-ghost small-btn" onClick={() => setDialog('reboot')}>{L('재시작', 'Restart')}</button>
          <button type="button" className="btn-ghost small-btn danger" onClick={() => setDialog('shutdown')}>{L('종료', 'Shut down')}</button>
        </>}
      </div>
      <NoticeBar notice={notice} />
      {dialog === 'enter' && <MaintenanceDialog cluster={cluster} node={node.node} onClose={() => setDialog(null)}
        onDone={() => { setDialog(null); onChanged(); }} />}
      {dialog === 'detail' && <NodeDetailDialog cluster={cluster} node={node} maint={st} onClose={() => setDialog(null)} />}
      {(dialog === 'reboot' || dialog === 'shutdown') && <PowerDialog cluster={cluster} node={node.node} action={dialog}
        onClose={() => setDialog(null)} onDone={(text) => { setDialog(null); setNotice({ kind: 'info', text }); onChanged(); }} />}
    </>
  );
}

function MaintenanceDialog({ cluster, node, onClose, onDone }: { cluster: Cluster; node: string; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const pv = useLoad(useCallback(() => opsApi.maintenancePreview(cluster.id, node), [cluster.id, node]), [node]);
  const [skip, setSkip] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [relax, setRelax] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      await opsApi.setMaintenance(cluster.id, node, true, skip ? { skip_evacuation: true }
        : { ...(templates ? { migrate_templates: true } : {}), ...(relax ? { relax_anti_affinity: true } : {}) });
      onDone();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open wide title={L(`${node} 유지보수 시작`, `Start maintenance on ${node}`)} onClose={onClose} onSubmit={submit} busy={busy || pv.state !== 'ok'} error={error}
      submitLabel={L('유지보수 시작', 'Start maintenance')}>
      <p className="muted small">{L('유지보수에 들어가면 이 노드는 새 VM을 받지 않고, 켜져 있는 VM은 다른 노드로 라이브 마이그레이션합니다. 다 옮긴 뒤 노드를 재시작하거나 끌 수 있습니다.',
        'In maintenance the node takes no new VMs and its running VMs live-migrate to the other nodes. Once they are off you can restart or shut the node down.')}</p>
      <LoadState value={pv} retry={pv.reload}>{(p) => <PreviewBody p={p} skip={skip} templates={templates} relax={relax}
        setSkip={setSkip} setTemplates={setTemplates} setRelax={setRelax} />}</LoadState>
    </Dialog>
  );
}

function PreviewBody({ p, skip, templates, relax, setSkip, setTemplates, setRelax }: {
  p: MaintPreview; skip: boolean; templates: boolean; relax: boolean;
  setSkip: (v: boolean) => void; setTemplates: (v: boolean) => void; setRelax: (v: boolean) => void;
}) {
  const { L } = useL();
  const inUse = p.desktops.filter((d) => d.in_use);
  const cap = p.capacity;
  return (
    <>
      <h3 className="dialog-sub">{L(`이 노드의 데스크톱 ${p.desktops.length}대`, `${p.desktops.length} desktop(s) on this node`)}
        {p.guests.length > 0 && <span className="muted small"> · {L(`그 밖의 VM ${p.guests.length}대`, `${p.guests.length} other VM(s)`)}</span>}</h3>
      {p.desktops.length === 0 ? <p className="muted small">{L('풀 데스크톱이 없습니다.', 'No pool desktops.')}</p> : (
        <div className="table-scroll maint-list"><table className="table compact-head">
          <thead><tr><th>{L('데스크톱', 'Desktop')}</th><th>{L('풀', 'Pool')}</th><th>{L('사용자', 'User')}</th><th>{L('상태', 'State')}</th></tr></thead>
          <tbody>{p.desktops.map((d) => (
            <tr key={d.id}><td className="strong">{d.name} <span className="muted small">{d.vmid}</span></td><td className="small">{d.pool}</td>
              <td className="small">{d.assigned_user || '-'}{d.in_use && <span className="chip chip-warn vmm-chip">{L('접속 중', 'connected')}</span>}</td>
              <td className="small">{d.status === 'running' ? L('켜짐', 'Running') : d.status === 'stopped' ? L('꺼짐', 'Stopped') : d.status}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {inUse.length > 0 && !skip && <div className="alert small warn" role="status">{L(
        `접속 중인 사용자가 ${inUse.length}명 있습니다. 라이브 마이그레이션이라 화면은 대개 이어지지만 몇 초 멈출 수 있으니 미리 알리세요 (플랫폼 설정 > 공지).`,
        `${inUse.length} user(s) are connected. Live migration usually keeps their session, but it can freeze for a few seconds: tell them first (Platform settings > Notices).`)}</div>}
      {cap && !skip && (cap.reason === 'no_target_nodes'
        ? <div className="alert small warn" role="status">{L('옮겨 갈 노드가 없습니다. VM은 이 노드에 그대로 남습니다.', 'There is no node to move to: the VMs stay on this node.')}</div>
        : !cap.ok
          ? <div className="alert small warn" role="status">{L(`다른 노드의 메모리가 ${cap.threshold ?? 90}%를 넘습니다: ${cap.over_threshold.join(', ') || L('전체 여유 부족', 'not enough room in all')}`,
            `The other nodes go past ${cap.threshold ?? 90}% memory: ${cap.over_threshold.join(', ') || 'not enough room in all'}`)}</div>
          : <p className="muted small">{L(`켜진 VM ${cap.guest_count}대를 옮겨도 다른 노드에 여유가 있습니다`, `The other nodes have room for the ${cap.guest_count} running VM(s)`)}
            {cap.nodes.length > 0 && ` (${cap.nodes.map((n) => `${n.node} ${Math.round(n.current_pct)}→${Math.round(n.projected_pct)}%`).join(', ')})`}</p>)}
      <div className="vmm-sec">
        {p.plan && p.plan.templates > 0 && (
          <label className="check"><input type="checkbox" checked={templates} disabled={skip} onChange={(e) => setTemplates(e.target.checked)} />
            <span>{L(`이 노드의 템플릿 ${p.plan.templates}개도 옮기기`, `Also move this node's ${p.plan.templates} template(s)`)}</span></label>
        )}
        {p.plan && p.plan.blocking_rules.length > 0 && (
          <label className="check"><input type="checkbox" checked={relax} disabled={skip} onChange={(e) => setRelax(e.target.checked)} />
            <span>{L(`떨어뜨려 두기 규칙(${p.plan.blocking_rules.join(', ')})을 유지보수 동안 끄기 — 끄지 않으면 그 VM은 옮길 자리가 없습니다`,
              `Hold the anti-affinity rules (${p.plan.blocking_rules.join(', ')}) off during maintenance; otherwise their VMs have nowhere to go`)}</span></label>
        )}
        <label className="check"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          <span>{L('VM을 옮기지 않고 표시만 하기 (재부팅이 없는 업데이트용 — 노드가 멈추면 VM도 멈춥니다)',
            'Only mark it, move no VMs (for updates without a reboot; if the node stops, so do its VMs)')}</span></label>
      </div>
    </>
  );
}

function PowerDialog({ cluster, node, action, onClose, onDone }: {
  cluster: Cluster; node: string; action: 'reboot' | 'shutdown'; onClose: () => void; onDone: (text: string) => void;
}) {
  const { L } = useL();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (typed !== node) { setError(L('노드 이름을 그대로 입력하세요.', "Type the node's name exactly.")); return; }
    setBusy(true); setError(null);
    try {
      await opsApi.nodePower(cluster.id, node, action);
      onDone(action === 'reboot' ? L(`${node}을(를) 재시작합니다. 돌아오면 유지보수를 끝내세요.`, `${node} is restarting. End its maintenance once it is back.`)
        : L(`${node}을(를) 끕니다. 다시 켜려면 서버 앞에서나 BMC(IPMI)로 켜야 합니다.`, `${node} is shutting down. Power it on at the machine or through its BMC.`));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={action === 'reboot' ? L(`${node} 재시작`, `Restart ${node}`) : L(`${node} 종료`, `Shut down ${node}`)} onClose={onClose} onSubmit={submit}
      busy={busy || typed !== node} error={error} submitLabel={action === 'reboot' ? L('재시작', 'Restart') : L('종료', 'Shut down')}>
      <p className="small">{action === 'reboot'
        ? L('노드를 SSH로 재시작합니다. 남아 있는 VM이 있으면 함께 꺼집니다.', 'The node restarts over SSH. Any VM still on it goes down with it.')
        : L('노드를 끕니다. MOAVI Desk로는 다시 켤 수 없습니다.', 'The node powers off. MOAVI Desk cannot power it back on.')}</p>
      <label><span>{L(`확인을 위해 노드 이름 '${node}'을(를) 입력하세요`, `Type the node name '${node}' to confirm`)}</span>
        <input autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
    </Dialog>
  );
}

type NodeTab = 'log' | 'sensors' | 'tasks' | 'maint';

function NodeDetailDialog({ cluster, node, maint, onClose }: { cluster: Cluster; node: ClusterNode; maint: MaintStatus | null; onClose: () => void }) {
  const { L } = useL();
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<NodeTab>(maint?.status ? 'maint' : 'log');
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  const tabs: [NodeTab, string][] = [['log', L('시스템 로그', 'System log')], ['sensors', L('센서', 'Sensors')], ['tasks', L('작업', 'Tasks')],
    ...(maint?.status ? [['maint', L('유지보수', 'Maintenance')] as [NodeTab, string]] : [])];
  return (
    <dialog ref={ref} className="dialog dialog-wide vmm" onClose={onClose} aria-label={node.node}>
      <div className="vmm-head">
        <h2>{node.node}</h2>
        <span className="muted small">{node.cpu_model} · {node.version.replace('pve-manager/', 'PVE ')}</span>
        <span className="vmm-head-actions"><button type="button" className="btn small-btn" onClick={() => ref.current?.close()}>{L('닫기', 'Close')}</button></span>
      </div>
      <nav className="page-tabs vmm-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <a key={id} href="#" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''}
            onClick={(e) => { e.preventDefault(); setTab(id); }}>{label}</a>
        ))}
      </nav>
      <div className="vmm-body">
        {tab === 'log' && <NodeLog cluster={cluster} node={node.node} />}
        {tab === 'sensors' && <NodeSensors cluster={cluster} node={node.node} />}
        {tab === 'tasks' && <NodeTasks cluster={cluster} node={node.node} />}
        {tab === 'maint' && maint && <MaintView m={maint} />}
      </div>
    </dialog>
  );
}

function NodeLog({ cluster, node }: { cluster: Cluster; node: string }) {
  const { L } = useL();
  const lines = useLoad(useCallback(() => opsApi.syslog(cluster.id, node), [cluster.id, node]), [node]);
  const [q, setQ] = useState('');
  return (
    <div className="vmm-sec">
      <div className="toolbar">
        <input type="search" placeholder={L('찾기 (예: error, corosync)', 'Find (e.g. error, corosync)')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn" onClick={lines.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
      </div>
      <LoadState value={lines} retry={lines.reload}>{(ls) => {
        const shown = q ? ls.filter((l) => l.toLowerCase().includes(q.toLowerCase())) : ls;
        return <pre className="job-output task-log">{shown.length ? shown.map((ln, i) => (
          <span key={i} className={/error|fail|crit/i.test(ln) ? 'log-bad' : /warn/i.test(ln) ? 'log-warn' : undefined}>{ln}{'\n'}</span>
        )) : L('(로그 없음)', '(no log lines)')}</pre>;
      }}</LoadState>
      <p className="muted small">{L('가장 최근 300줄, 최신이 위입니다.', 'The latest 300 lines, newest first.')}</p>
    </div>
  );
}

function NodeSensors({ cluster, node }: { cluster: Cluster; node: string }) {
  const { L } = useL();
  const s = useLoad(useCallback(() => opsApi.sensors(cluster.id, node), [cluster.id, node]), [node]);
  const unit = (k: string) => (k === 'temp' ? '°C' : k === 'fan' ? ' RPM' : k === 'volt' ? ' V' : '');
  const kindL = (k: string) => (k === 'temp' ? L('온도', 'Temperature') : k === 'fan' ? L('팬', 'Fan') : k === 'volt' ? L('전압', 'Voltage') : k);
  return (
    <LoadState value={s} retry={s.reload}>{(r) => r.error ? (
      <div className="alert small info" role="status">{L('센서 값을 읽을 수 없습니다: ', 'No sensor readings: ')}{r.error}</div>
    ) : r.sensors.length === 0 ? <p className="muted small">{L('센서가 없습니다.', 'No sensors.')}</p> : (
      <div className="table-scroll"><table className="table compact-head">
        <thead><tr><th>{L('종류', 'Kind')}</th><th>{L('칩', 'Chip')}</th><th>{L('이름', 'Label')}</th><th className="num">{L('값', 'Value')}</th><th className="num">{L('한계', 'Limit')}</th></tr></thead>
        <tbody>{r.sensors.map((x, i) => {
          const hot = x.alarm || (x.crit !== null && x.value !== null && x.value >= x.crit * 0.9);
          return (
            <tr key={i}><td>{kindL(x.kind)}</td><td className="muted small">{x.chip}</td><td>{x.label}</td>
              <td className={`num strong${hot ? ' t-bad' : ''}`}>{x.value ?? '-'}{x.value !== null ? unit(x.kind) : ''}</td>
              <td className="num muted small">{x.crit !== null ? `${x.crit}${unit(x.kind)}` : x.max !== null ? `${x.max}${unit(x.kind)}` : '-'}</td></tr>
          );
        })}</tbody>
      </table></div>
    )}</LoadState>
  );
}

function NodeTasks({ cluster, node }: { cluster: Cluster; node: string }) {
  const { L, at } = useL();
  const kind = useKind();
  const tasks = useLoad(useCallback(() => opsApi.nodeTasks(cluster.id, node), [cluster.id, node]), [node]);
  const [log, setLog] = useState<OpsTask | null>(null);
  return (
    <LoadState value={tasks} retry={tasks.reload}>{(ts) => ts.length === 0 ? <p className="muted small">{L('작업이 없습니다.', 'No tasks.')}</p> : (
      <>
        <div className="table-scroll"><table className="table compact-head">
          <thead><tr><th>{L('작업', 'Task')}</th><th>{L('대상', 'Target')}</th><th>{L('시작', 'Started')}</th><th>{L('상태', 'State')}</th><th className="actions" /></tr></thead>
          <tbody>{ts.map((t) => (
            <tr key={t.upid}><td className="strong">{kind(t.type)}</td><td>{target(t)}</td><td className="muted small nowrap">{at(t.starttime)}</td>
              <td><TaskState t={t} /></td>
              <td className="actions"><button type="button" className="btn-ghost small-btn" onClick={() => setLog(t)}>{L('로그', 'Log')}</button></td></tr>
          ))}</tbody>
        </table></div>
        {log && <TaskLogDialog task={log} onClose={() => setLog(null)} />}
      </>
    )}</LoadState>
  );
}

function MaintView({ m }: { m: MaintStatus }) {
  const { L } = useL();
  return (
    <div className="vmm-sec">
      <SettingsStatus items={[
        { label: L('상태', 'State'), value: m.status ?? '-' },
        { label: L('옮긴 VM', 'Moved'), value: `${m.migrated_vms ?? 0} / ${m.total_vms ?? 0}` },
        { label: L('실패', 'Failed'), value: String(m.failed_vms?.length ?? 0), tone: m.failed_vms?.length ? 'warn' : undefined },
      ]} />
      {m.note && <p className="muted small">{m.note}</p>}
      {m.error && <div className="alert small error" role="alert">{m.error}</div>}
      {!!m.failed_vms?.length && (
        <ul className="vmm-list">{m.failed_vms.map((f) => <li key={f.vmid}><span className="strong">{f.name || f.vmid}</span> — {f.error}</li>)}</ul>
      )}
      {!!m.pending_vms?.length && <p className="muted small">{L('남은 VM: ', 'Still to move: ')}{m.pending_vms.map((p) => p.name || p.vmid).join(', ')}</p>}
    </div>
  );
}

// --- 클러스터 > 고가용성 (Proxmox HA) ---------------------------------------------------

export function ClusterHaPage() {
  const { current } = useCluster();
  const ha = useLoad(useCallback(() => (current ? opsApi.ha(current.id) : Promise.resolve<ClusterHa | null>(null)), [current]), [current?.id]);
  return (
    <ClusterFrame reload={ha.reload}>
      {(c) => <LoadState value={ha} retry={ha.reload}>{(h) => h && <HaBody cluster={c} ha={h} reload={ha.reload} />}</LoadState>}
    </ClusterFrame>
  );
}

const HA_STATE: Record<string, [string, string]> = {
  started: ['켜 둠', 'Keep running'], stopped: ['꺼 둠', 'Keep stopped'], ignored: ['관여 안 함', 'Ignored'], disabled: ['사용 안 함', 'Disabled'],
};

function HaBody({ cluster, ha, reload }: { cluster: Cluster; ha: ClusterHa; reload: () => void }) {
  const { L, lang } = useL();
  const [adding, setAdding] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const stateL = (s: string) => (HA_STATE[s] ? (lang === 'ko' ? HA_STATE[s][0] : HA_STATE[s][1]) : s);
  async function remove(r: HaResource) {
    if (!confirm(L(`${r.name || r.sid}을(를) HA에서 뺄까요? VM은 지금 자리에서 계속 돕니다.`, `Take ${r.name || r.sid} out of HA? It keeps running where it is.`))) return;
    try { await opsApi.haRemove(cluster.id, r.vmid); setNotice({ kind: 'info', text: L(`${r.sid}를 HA에서 뺐습니다.`, `${r.sid} is out of HA.`) }); reload(); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  async function removeGroup(g: HaGroup) {
    if (!confirm(L(`HA 그룹 '${g.group}'을(를) 지울까요?`, `Delete HA group '${g.group}'?`))) return;
    try { await opsApi.haGroupRemove(cluster.id, g.group); reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  return (
    <>
      <p className="muted small page-intro">{L('Proxmox HA는 노드가 멈추면 등록된 VM을 다른 노드에서 다시 켭니다. 라이선스 서버 · 게이트웨이처럼 늘 살아 있어야 하는 VM을 올리세요. 데스크톱 풀의 VM은 보통 올리지 않습니다 — 노드가 멈추면 사용자는 다른 데스크톱을 받습니다.',
        'Proxmox HA starts the listed VMs on another node when theirs stops. Put the VMs that must always run on it - licence servers, gateways. Pool desktops usually stay off it: when a node stops, users get another desktop.')}</p>
      <SettingsStatus items={[
        { label: L('HA 쿼럼', 'HA quorum'), value: ha.quorate === null ? '-' : ha.quorate ? L('정상', 'OK') : L('없음', 'None'), tone: ha.quorate === false ? 'warn' : ha.quorate ? 'ok' : undefined },
        { label: L('관리 노드', 'Manager node'), value: ha.master || '-' },
        { label: L('등록된 VM', 'VMs under HA'), value: String(ha.resources.length) },
        { label: L('그룹', 'Groups'), value: String(ha.groups.length) },
      ]} />
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{L('VM을 HA에 등록', 'Add a VM to HA')}</button>
        <button type="button" className="btn" onClick={() => setGrouping(true)}>{L('HA 그룹 만들기', 'New HA group')}</button>
      </div>
      <NoticeBar notice={notice} />
      {ha.resources.length === 0 ? <div className="empty"><p>{L('HA에 등록된 VM이 없습니다.', 'No VM is under HA.')}</p></div> : (
        <div className="table-scroll"><table className="table compact-head">
          <thead><tr><th>VM</th><th>{L('노드', 'Node')}</th><th>{L('요청', 'Requested')}</th><th>{L('현재', 'Now')}</th><th>{L('그룹', 'Group')}</th>
            <th className="num">{L('재시작 · 이동', 'Restarts · moves')}</th><th className="actions" /></tr></thead>
          <tbody>{ha.resources.map((r) => (
            <tr key={r.sid}>
              <td><span className="strong">{r.name || r.sid}</span> <span className="muted small">{r.vmid}</span>
                {r.desktop && <span className="chip chip-free vmm-chip">{L('데스크톱', 'desktop')}</span>}
                {r.comment && <div className="muted small">{r.comment}</div>}</td>
              <td className="nowrap">{r.node || '-'}</td>
              <td className="nowrap">{stateL(r.state)}</td>
              <td className="nowrap"><span className={`status ${r.status === 'started' ? 'st-ready' : r.status === 'error' || r.status === 'fence' ? 'st-error' : 'st-in_use'}`}>
                <span className="dot" />{r.status || '-'}</span></td>
              <td className="small">{r.group || '-'}</td>
              <td className="num">{r.max_restart} · {r.max_relocate}</td>
              <td className="actions"><button type="button" className="btn-ghost small-btn danger" onClick={() => remove(r)}>{L('해제', 'Remove')}</button></td>
            </tr>))}</tbody>
        </table></div>
      )}
      <h2 className="section-title">{L('HA 그룹', 'HA groups')}</h2>
      <p className="muted small">{L('그룹은 VM이 어느 노드에서 돌지(우선순위)를 정합니다. PVE 9.1부터는 노드 선호 규칙(node-affinity rule)으로 바뀌어 대상 VM을 함께 지정합니다.',
        'A group says which nodes its VMs prefer. From PVE 9.1 groups are node-affinity rules, which name their VMs.')}</p>
      {ha.groups.length === 0 ? <p className="muted small">{L('그룹이 없습니다.', 'No groups.')}</p> : (
        <div className="table-scroll"><table className="table compact-head">
          <thead><tr><th>{L('이름', 'Name')}</th><th>{L('노드 (우선순위)', 'Nodes (priority)')}</th><th>{L('대상', 'VMs')}</th><th>{L('설정', 'Options')}</th><th className="actions" /></tr></thead>
          <tbody>{ha.groups.map((g) => (
            <tr key={g.group}><td className="strong">{g.group}{g.comment && <div className="muted small">{g.comment}</div>}</td>
              <td><code className="code">{g.nodes}</code></td><td className="small">{g.resources || '-'}</td>
              <td className="small">{[g.restricted && L('이 노드만', 'restricted'), g.nofailback && L('돌아가지 않음', 'no failback'), g.rule && L('규칙', 'rule')].filter(Boolean).join(', ') || '-'}</td>
              <td className="actions"><button type="button" className="btn-ghost small-btn danger" onClick={() => removeGroup(g)}>{L('삭제', 'Delete')}</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {adding && <HaAddDialog cluster={cluster} ha={ha} onClose={() => setAdding(false)}
        onDone={(text) => { setAdding(false); setNotice({ kind: 'info', text }); reload(); }} />}
      {grouping && <HaGroupDialog cluster={cluster} ha={ha} onClose={() => setGrouping(false)} onDone={() => { setGrouping(false); reload(); }} />}
    </>
  );
}

function HaAddDialog({ cluster, ha, onClose, onDone }: { cluster: Cluster; ha: ClusterHa; onClose: () => void; onDone: (text: string) => void }) {
  const { L, lang } = useL();
  const guests = useLoad(useCallback(() => adminApi.guests(cluster.id), [cluster.id]), [cluster.id]);
  const [vmid, setVmid] = useState('');
  const [state, setState] = useState('started');
  const [group, setGroup] = useState('');
  const [restarts, setRestarts] = useState(1);
  const [relocates, setRelocates] = useState(1);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taken = new Set(ha.resources.map((r) => r.vmid));
  async function submit() {
    if (!vmid) { setError(L('VM을 고르세요.', 'Pick a VM.')); return; }
    setBusy(true); setError(null);
    try {
      await opsApi.haAdd(cluster.id, { vmid: Number(vmid), state, ...(group ? { group } : {}), max_restart: restarts, max_relocate: relocates, ...(comment ? { comment } : {}) });
      onDone(L(`VM ${vmid}을(를) HA에 등록했습니다.`, `VM ${vmid} is under HA.`));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('VM을 HA에 등록', 'Add a VM to HA')} onClose={onClose} onSubmit={submit} busy={busy} error={error} submitLabel={L('등록', 'Add')}>
      <label><span>VM</span>
        <LoadState value={guests} retry={guests.reload}>{(gs) => (
          <select required value={vmid} onChange={(e) => setVmid(e.target.value)}>
            <option value="">{L('고르세요', 'Choose')}</option>
            {gs.filter((g) => !taken.has(g.vmid)).map((g) => <option key={g.vmid} value={g.vmid}>{g.vmid} · {g.name} ({g.node}){g.desktop_id ? L(' · 데스크톱', ' · desktop') : ''}</option>)}
          </select>
        )}</LoadState>
      </label>
      <div className="form-row form-row-even">
        <label><span>{L('요청 상태', 'Requested state')}</span>
          <select value={state} onChange={(e) => setState(e.target.value)}>
            {Object.entries(HA_STATE).map(([k, v]) => <option key={k} value={k}>{lang === 'ko' ? v[0] : v[1]}</option>)}
          </select></label>
        <label><span>{L('그룹 (PVE 9.1 이전)', 'Group (before PVE 9.1)')}</span>
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">{L('없음', 'None')}</option>
            {ha.groups.filter((g) => !g.rule).map((g) => <option key={g.group} value={g.group}>{g.group}</option>)}
          </select></label>
      </div>
      <div className="form-row form-row-even">
        <label><span>{L('같은 노드에서 다시 켜기 (번)', 'Restarts on its node')}</span>
          <input type="number" min={0} max={10} value={restarts} onChange={(e) => setRestarts(Number(e.target.value))} /></label>
        <label><span>{L('다른 노드로 옮기기 (번)', 'Moves to another node')}</span>
          <input type="number" min={0} max={10} value={relocates} onChange={(e) => setRelocates(Number(e.target.value))} /></label>
      </div>
      <label><span>{L('메모', 'Comment')}</span><input maxLength={200} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
    </Dialog>
  );
}

function HaGroupDialog({ cluster, ha, onClose, onDone }: { cluster: Cluster; ha: ClusterHa; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const nodes = useLoad(useCallback(() => adminApi.nodes(cluster.id), [cluster.id]), [cluster.id]);
  const [name, setName] = useState('');
  const [prio, setPrio] = useState<Record<string, number | ''>>({});
  const [vms, setVms] = useState<Set<string>>(new Set());
  const [restricted, setRestricted] = useState(false);
  const [nofailback, setNofailback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    const picked = Object.entries(prio).filter(([, p]) => p !== '');
    if (!picked.length) { setError(L('노드를 하나 이상 고르세요.', 'Pick at least one node.')); return; }
    setBusy(true); setError(null);
    try {
      await opsApi.haGroupAdd(cluster.id, { group: name.trim(), nodes: picked.map(([n, p]) => (p ? `${n}:${p}` : n)).join(','),
        ...(restricted ? { restricted } : {}), ...(nofailback ? { nofailback } : {}), ...(vms.size ? { resources: [...vms].join(',') } : {}) });
      onDone();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('HA 그룹 만들기', 'New HA group')} onClose={onClose} onSubmit={submit} busy={busy} error={error} submitLabel={L('만들기', 'Create')}>
      <label><span>{L('이름', 'Name')}</span><input required autoFocus pattern="[A-Za-z][A-Za-z0-9_\-]{0,39}" value={name} onChange={(e) => setName(e.target.value)} placeholder="lab-nodes" />
        <small className="muted">{L('영문자로 시작, 영문 · 숫자 · - · _', 'Starts with a letter; letters, digits, - and _')}</small></label>
      <fieldset className="ha-nodes"><legend>{L('노드와 우선순위 (클수록 먼저)', 'Nodes and priority (higher first)')}</legend>
        <LoadState value={nodes} retry={nodes.reload}>{(ns) => <>{ns.map((n) => (
          <div key={n.node} className="ha-node-row">
            <label className="check"><input type="checkbox" checked={n.node in prio} onChange={(e) => setPrio((p) => {
              const x = { ...p }; if (e.target.checked) x[n.node] = ''; else delete x[n.node]; return x;
            })} /><span>{n.node}</span></label>
            {n.node in prio && <input type="number" min={0} max={1000} placeholder={L('우선순위', 'priority')} aria-label={`${n.node} priority`}
              value={prio[n.node]} onChange={(e) => setPrio((p) => ({ ...p, [n.node]: e.target.value === '' ? '' : Number(e.target.value) }))} />}
          </div>))}</>}</LoadState>
      </fieldset>
      {ha.resources.length > 0 && (
        <fieldset className="ha-nodes"><legend>{L('대상 VM (PVE 9.1 이상은 필요)', 'VMs (needed on PVE 9.1 and later)')}</legend>
          {ha.resources.map((r) => (
            <label key={r.sid} className="check"><input type="checkbox" checked={vms.has(r.sid)} onChange={(e) => setVms((s) => {
              const x = new Set(s); if (e.target.checked) x.add(r.sid); else x.delete(r.sid); return x;
            })} /><span>{r.sid} {r.name}</span></label>))}
        </fieldset>
      )}
      <label className="check"><input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} />
        <span>{L('이 노드에서만 돌기 (다 멈추면 VM도 멈춤)', 'Only these nodes (if they all stop, so does the VM)')}</span></label>
      <label className="check"><input type="checkbox" checked={nofailback} onChange={(e) => setNofailback(e.target.checked)} />
        <span>{L('우선 노드가 돌아와도 되돌아가지 않기 (PVE 9.1 이전)', 'Do not move back when a preferred node returns (before PVE 9.1)')}</span></label>
    </Dialog>
  );
}

// licence servers: put the server's VM under HA from its row
export function useHaRegister(onDone: (text: string, ok: boolean) => void) {
  const { L } = useL();
  const [busy, setBusy] = useState<string | null>(null);
  async function register(key: string, clusterId: string, vmid: number, comment: string) {
    if (!confirm(L(`VM ${vmid}을(를) Proxmox HA에 등록할까요? 노드가 멈추면 다른 노드에서 다시 켜집니다.`, `Put VM ${vmid} under Proxmox HA? It restarts on another node when its node stops.`))) return;
    setBusy(key);
    try { await opsApi.haAdd(clusterId, { vmid, comment: comment.slice(0, 200) }); onDone(L(`VM ${vmid}을(를) HA에 등록했습니다.`, `VM ${vmid} is under HA.`), true); }
    catch (e) { onDone(errText(e), false); } finally { setBusy(null); }
  }
  return { register, busy };
}

// --- 플랫폼 설정 > 서버 이중화 -------------------------------------------------------------

type PairDialog = 'code' | 'join' | 'promote' | 'unpair' | { remove: PairMember } | null;

export function ServerPairPage() {
  const { L, when } = useL();
  const st = useLoad(opsApi.pair);
  const [dialog, setDialog] = useState<PairDialog>(null);
  const [notice, setNotice] = useState<Notice>(null);
  useEvery(st.reload, 15000);
  const roleL = (r: string | null) => (r === 'active' ? L('활성', 'Active') : r === 'standby' ? L('대기', 'Standby') : r === 'standalone' ? L('단독', 'Standalone') : r ?? '-');

  return (
    <LoadState value={st} retry={st.reload}>
      {(s) => (
        <>
          <p className="muted small page-intro">{L('MOAVI Desk 서버를 두 대 이상(활성 1 · 대기 최대 3)으로 묶어 둡니다. 대기 서버는 활성 서버의 설정을 계속 받아 두었다가, 활성 서버가 멈추면 관리자가 대기 서버에서 승격해 넘겨받습니다.',
            'Groups MOAVI Desk servers: one active, up to three standbys. A standby keeps a copy of the active\'s configuration; when the active stops, an administrator promotes a standby there.')}</p>
          {s.auto === null && <div className="alert small warn" role="status">{L('이 릴리스에는 자동 전환(automatic failover)이 없습니다. 활성 서버가 멈추면 대기 서버의 이 화면에서 직접 [승격]해야 합니다. 그 사이 사용자는 접속할 수 없습니다.',
            'This release has no automatic failover. When the active server stops, promote a standby from this page on the standby. Users cannot connect until then.')}</div>}
          <SettingsStatus items={[
            { label: L('이 서버', 'This server'), value: roleL(s.role), tone: s.role === 'standalone' ? 'off' : 'ok' },
            { label: L('구성원', 'Members'), value: `${s.members.length + 1} / ${s.max_members}` },
            { label: L('세대(epoch)', 'Epoch'), value: String(s.epoch) },
            { label: L('마지막 동기화', 'Last sync'), value: s.role === 'standby' ? when(s.sync.last_ok_at) : '-', tone: s.sync.last_error ? 'warn' : undefined },
          ]} />
          {s.broken && <div className="alert small error" role="alert">{s.broken}</div>}
          {s.removed && <div className="alert small error" role="alert">{L('이 서버는 그룹에서 제거되었습니다. 그룹에서 나오기를 눌러 단독으로 돌리세요.', 'This server was removed from the group. Leave the group to make it standalone again.')}</div>}
          {s.sync.last_error && <div className="alert small warn" role="status">{L('동기화 오류: ', 'Sync error: ')}{s.sync.last_error}</div>}
          <NoticeBar notice={notice} />
          <div className="toolbar">
            {s.role !== 'standby' && <button type="button" className="btn primary" onClick={() => setDialog('code')}><Icon name="plus" size={16} />{L('대기 서버 추가', 'Add a standby')}</button>}
            {s.role === 'standalone' && <button type="button" className="btn" onClick={() => setDialog('join')}>{L('이 서버를 대기로 붙이기', 'Make this server a standby')}</button>}
            {s.role === 'standby' && <button type="button" className="btn primary" onClick={() => setDialog('promote')}>{L('이 서버 승격', 'Promote this server')}</button>}
            {s.role === 'standby' && <button type="button" className="btn" onClick={async () => {
              try { await opsApi.syncNow(); st.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
            }}>{L('지금 동기화', 'Sync now')}</button>}
            {s.role !== 'standalone' && <button type="button" className="btn danger" onClick={() => setDialog('unpair')}>{L('그룹에서 나오기', 'Leave the group')}</button>}
            <button type="button" className="btn" onClick={st.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
          </div>
          <h2 className="section-title">{L('그룹 구성원', 'Group members')}</h2>
          {s.members.length === 0 ? <div className="empty"><p>{L('묶인 서버가 없습니다. 이 서버 한 대로 돌고 있습니다.', 'No other server. This one runs alone.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('주소', 'Address')}</th><th>{L('역할', 'Role')}</th><th>{L('마지막 연락', 'Last contact')}</th><th>{L('상태', 'State')}</th><th className="actions" /></tr></thead>
              <tbody>{s.members.map((m) => (
                <tr key={m.instance_id}>
                  <td><span className="strong">{m.url}</span>{m.is_source && s.role === 'standby' && <span className="chip chip-on vmm-chip">{L('받는 곳', 'source')}</span>}
                    <div className="muted small"><code className="code">{m.instance_id.slice(0, 12)}</code>{m.site && ` · ${m.site}`}</div></td>
                  <td>{roleL(m.role_seen)}{m.serve && <span className="chip chip-free vmm-chip">{L('사용자 접속 받음', 'serves users')}</span>}</td>
                  <td className="muted small nowrap">{when(m.last_contact)}</td>
                  <td>{m.last_error ? <span className="status st-error" title={m.last_error}><span className="dot" />{L('연락 안 됨', 'Unreachable')}</span>
                    : m.role_seen === 'standby' && !m.confirmed_standby ? <span className="status st-in_use"><span className="dot" />{L('확인 중', 'Checking')}</span>
                    : <span className="status st-ready"><span className="dot" />{L('정상', 'OK')}</span>}
                    {m.last_error && <div className="muted small">{m.last_error}</div>}</td>
                  <td className="actions">{s.role === 'active' && m.role_seen !== 'active' && (
                    <button type="button" className="btn-ghost small-btn danger" onClick={() => setDialog({ remove: m })}>{L('제거', 'Remove')}</button>)}</td>
                </tr>))}</tbody>
            </table></div>
          )}
          <section className="panel witness-panel">
            <h2 className="section-title">{L('증인(witness)', 'Witness')}</h2>
            <p className="small">{L('자동 전환에는 표가 셋 이상 있어야 합니다. 서버 두 대면 표가 둘이라, 세 번째 표를 내는 작은 프로그램인 증인을 둡니다. 증인은 데이터 · 비밀번호를 갖지 않고 투표만 합니다.',
              'Automatic failover needs at least three votes; two servers have two. The witness is a small process that casts the third vote. It holds no data or passwords; it only votes.')}</p>
            <ul className="vmm-list small">
              <li>{L('제3의 장소에 둡니다. 서버 한 대와 같은 방에 두면 그 방이 멈출 때 표 두 개를 함께 잃습니다.', 'Put it at a third site: in the same room as one server, losing the room loses two votes.')}</li>
              <li>{L('MOAVI Desk가 없는 별도 호스트(라즈베리 파이, 작은 VM · LXC, VPS)면 충분합니다. 메모리 약 40 MB, TCP 5005 포트 하나.', 'A host of its own without MOAVI Desk (Raspberry Pi, small VM or LXC, VPS): about 40 MB of memory and TCP port 5005.')}</li>
              <li>{L('시계가 서버와 5초 이내여야 합니다(NTP).', 'Its clock within 5 seconds of the servers (NTP).')}</li>
            </ul>
            <p className="muted small">{s.auto === null
              ? L('이 릴리스는 자동 전환이 없어 증인을 추가할 수 없습니다. 자동 전환이 들어간 릴리스에서 활성 서버의 이 화면에 [증인 추가]가 나타나고, 거기서 설치 명령을 받습니다.',
                'This release has no automatic failover, so a witness cannot be added. In a release that has it, Add witness appears here on the active server and gives the install command.')
              : L('증인은 활성 서버의 엔진 HA 화면에서 추가합니다.', 'Add the witness on the active server\'s engine HA page.')}</p>
          </section>
          {dialog === 'code' && <CodeDialog s={s} onClose={() => setDialog(null)} onDone={st.reload} />}
          {dialog === 'join' && <JoinDialog s={s} onClose={() => setDialog(null)} onDone={(text) => { setDialog(null); setNotice({ kind: 'info', text }); }} />}
          {dialog === 'promote' && <PromoteDialog onClose={() => setDialog(null)} onDone={(text) => { setDialog(null); setNotice({ kind: 'info', text }); }} />}
          {dialog === 'unpair' && <PasswordDialog title={L('그룹에서 나오기', 'Leave the group')} submitLabel={L('나오기', 'Leave')}
            text={s.role === 'active' ? L('이 서버가 그룹에서 빠져 단독이 됩니다. 남은 대기 서버들은 서로 묶인 채 하나가 승격되기를 기다립니다.', 'This server leaves and becomes standalone. The standbys stay together and wait for one of them to be promoted.')
              : L('이 서버가 그룹에서 빠져 단독이 되고 다시 시작합니다. 그때부터 지금 가진 설정으로 직접 클러스터를 다룹니다.', 'This server leaves, becomes standalone and restarts; from then on it acts on the configuration it holds.')}
            onClose={() => setDialog(null)} run={async (pw) => {
              const r = await opsApi.unpair(pw);
              setDialog(null); setNotice({ kind: 'info', text: r.restarting ? L('그룹에서 나왔습니다. 서버가 다시 시작합니다.', 'Left the group. The server restarts.') : L('그룹에서 나왔습니다.', 'Left the group.') });
              st.reload();
            }} />}
          {dialog && typeof dialog === 'object' && <RemoveDialog m={dialog.remove} onClose={() => setDialog(null)}
            onDone={() => { setDialog(null); setNotice({ kind: 'info', text: L(`${dialog.remove.url}을(를) 그룹에서 뺐습니다.`, `${dialog.remove.url} is out of the group.`) }); st.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

function reauthText(e: unknown, L: (ko: string, en: string) => string) {
  return codeOf(e) === 'HA_REAUTH' ? L('비밀번호를 다시 확인하세요.', 'Check your password.') : errText(e);
}

function PasswordDialog({ title, text, submitLabel, onClose, run, children }: {
  title: string; text: string; submitLabel: string; onClose: () => void; run: (pw: string) => Promise<void>; children?: ReactNode;
}) {
  const { L } = useL();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await run(pw); } catch (e) { setError(reauthText(e, L)); } finally { setBusy(false); setPw(''); }
  }
  return (
    <Dialog open title={title} onClose={onClose} onSubmit={submit} busy={busy} error={error} submitLabel={submitLabel}>
      <p className="small">{text}</p>
      {children}
      <label><span>{L('내 비밀번호 (다시 확인)', 'Your password (to confirm)')}</span>
        <input type="password" required autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
    </Dialog>
  );
}

function CodeDialog({ s, onClose, onDone }: { s: PairStatus; onClose: () => void; onDone: () => void }) {
  const { L, at } = useL();
  const [url, setUrl] = useState(s.suggested_url);
  const [code, setCode] = useState<{ code: string; expires_at: number } | null>(null);
  if (code) {
    return (
      <Dialog open title={L('페어링 코드', 'Pairing code')} onClose={onClose}>
        <p className="small">{L(`대기로 쓸 서버(새로 설치한 MOAVI Desk)에 관리자로 로그인해 플랫폼 설정 > 서버 이중화 > [이 서버를 대기로 붙이기]에 이 코드를 붙여 넣으세요. ${at(code.expires_at)}까지, 한 번만 쓸 수 있습니다.`,
          `On the server to become the standby (a fresh MOAVI Desk), sign in as administrator, open Platform settings > Server pair > Make this server a standby, and paste this code. Valid until ${at(code.expires_at)}, once.`)}</p>
        <textarea readOnly className="code pair-code" rows={4} value={code.code} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(code.code)}>{L('복사', 'Copy')}</button>
      </Dialog>
    );
  }
  return (
    <PasswordDialog title={L('대기 서버 추가', 'Add a standby')} submitLabel={L('코드 만들기', 'Make a code')} onClose={onClose}
      text={L('대기 서버가 이 서버에 접속할 주소로 일회용 코드(15분)를 만듭니다. 코드를 쓴 대기 서버는 이 서버의 설정과 저장된 비밀번호를 모두 받으므로 비밀번호를 다시 확인합니다.',
        'Makes a one-time code (15 minutes) with the address the standby reaches this server at. The standby gets this server\'s configuration and stored credentials, so confirm with your password.')}
      run={async (pw) => { setCode(await opsApi.pairingCode(url.trim(), pw)); onDone(); }}>
      <label><span>{L('이 서버의 주소 (https://)', 'This server\'s address (https://)')}</span>
        <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://moavi-a.example.com:5000" /></label>
    </PasswordDialog>
  );
}

function JoinDialog({ s, onClose, onDone }: { s: PairStatus; onClose: () => void; onDone: (text: string) => void }) {
  const { L } = useL();
  const [code, setCode] = useState('');
  const [url, setUrl] = useState(s.suggested_url);
  const [ok, setOk] = useState(false);
  return (
    <PasswordDialog title={L('이 서버를 대기로 붙이기', 'Make this server a standby')} submitLabel={L('대기로 붙이기', 'Join as standby')} onClose={onClose}
      text={L('이 서버의 설정은 활성 서버의 것으로 바뀌고, 서버가 다시 시작합니다.', 'This server\'s configuration is replaced by the active server\'s, and it restarts.')}
      run={async (pw) => {
        if (!ok) throw new Error(L('설정이 바뀐다는 것을 확인하세요.', 'Confirm that the configuration is replaced.'));
        await opsApi.join(code.trim(), url.trim(), pw);
        onDone(L('대기 서버가 되었습니다. 서버가 다시 시작하니 잠시 뒤 다시 로그인하세요.', 'This is a standby now. The server restarts: sign in again in a moment.'));
      }}>
      <label><span>{L('활성 서버에서 받은 코드', 'Code from the active server')}</span>
        <textarea required className="code pair-code" rows={3} value={code} onChange={(e) => setCode(e.target.value)} /></label>
      <label><span>{L('이 서버의 주소 (https://, 활성 서버가 접속할 주소)', 'This server\'s address (https://, as the active reaches it)')}</span>
        <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>{L('이 서버의 지금 설정은 사라집니다', 'The configuration of this server is replaced')}</span></label>
    </PasswordDialog>
  );
}

function PromoteDialog({ onClose, onDone }: { onClose: () => void; onDone: (text: string) => void }) {
  const { L } = useL();
  const [force, setForce] = useState(false);
  const [needForce, setNeedForce] = useState(false);
  return (
    <PasswordDialog title={L('이 서버 승격', 'Promote this server')} submitLabel={L('승격', 'Promote')} onClose={onClose}
      text={L('이 대기 서버가 활성 서버가 되어 클러스터를 다룹니다. 예전 활성 서버가 아직 응답하면 먼저 마지막 설정을 받아 오고 물러나게 합니다. 승격 뒤 서버가 다시 시작합니다.',
        'This standby becomes the active server and acts on the clusters. If the old active still answers, its latest configuration comes over first and it steps down. The server restarts afterwards.')}
      run={async (pw) => {
        try {
          const r = await opsApi.promote(pw, force);
          onDone(L(`활성 서버가 되었습니다 (세대 ${r.epoch}). 서버가 다시 시작하니 잠시 뒤 다시 로그인하세요.`, `Active now (epoch ${r.epoch}). The server restarts: sign in again in a moment.`));
        } catch (e) {
          if (codeOf(e) === 'HA_PROMOTE_SYNC') setNeedForce(true);
          throw e;
        }
      }}>
      {needForce && (
        <label className="check"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          <span>{L('마지막 동기화 없이 승격 (예전 활성 서버의 최근 변경을 잃을 수 있음)', 'Promote without the last sync (recent changes on the old active may be lost)')}</span></label>
      )}
    </PasswordDialog>
  );
}

function RemoveDialog({ m, onClose, onDone }: { m: PairMember; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [shut, setShut] = useState(false);
  const [ask, setAsk] = useState(!m.confirmed_standby);
  return (
    <PasswordDialog title={L('구성원 제거', 'Remove member')} submitLabel={L('제거', 'Remove')} onClose={onClose}
      text={L(`${m.url}을(를) 그룹에서 뺍니다. 그 서버는 대기로 멈춰 있다가 거기서 그룹에서 나오기를 해야 단독이 됩니다.`,
        `${m.url} leaves the group. It stays a passive standby until someone leaves the group there.`)}
      run={async (pw) => {
        try { await opsApi.removeMember(m.instance_id, pw, shut); onDone(); }
        catch (e) { if (codeOf(e) === 'HA_REMOVE_UNCONFIRMED') setAsk(true); throw e; }
      }}>
      {ask && (
        <label className="check"><input type="checkbox" checked={shut} onChange={(e) => setShut(e.target.checked)} />
          <span>{L('이 서버는 영구히 꺼졌습니다 (대기로 응답하지 않는 서버를 뺄 때)', 'That server is shut down for good (to remove one that does not answer as a standby)')}</span></label>
      )}
    </PasswordDialog>
  );
}
