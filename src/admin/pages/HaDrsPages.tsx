import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin';
import { opsApi } from '../../api/ops';
import type { ClusterHa, HaGroup, HaResource } from '../../api/ops';
import { haDrsApi } from '../../api/hadrs';
import type { Balance, BalanceMode, BalanceMove, BalancePut, HaExtra, HaPool, SeparateRule } from '../../api/hadrs';
import type { Cluster } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { SettingsStatus } from '../../components/SettingsShell';
import { useLoad } from '../../components/useLoad';
import { ClusterFrame, useCluster } from './ClusterPages';
import { HA_STATE, HaAddDialog, HaGroupDialog, staysText, useL } from './OpsPages';
import { Usage } from './TableKit';
import './tables.css';

// 클러스터 > 고가용성 (HA): which VMs Proxmox HA restarts elsewhere, per VM or per pool, node priority and
// keep-apart rules, the prerequisites (quorum, shared disks). 클러스터 > 부하 분산: 끔 / 추천만 / 자동, the
// recommended moves with 적용, 지금 분산, what cannot live-migrate, the moves made. makus-vlab vlab_hadrs.py.

type Notice = { kind: 'info' | 'error'; text: string } | null;
const errText = (e: unknown) => (e as Error).message;
const GB = 1024 ** 3;

function NoticeBar({ notice }: { notice: Notice }) {
  return notice ? <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div> : null;
}

const POOL_TYPE: Record<string, [string, string]> = {
  dedicated: ['전용', 'Dedicated'], reset: ['초기화', 'Reset'], shared: ['공유', 'Shared'], classroom: ['수업용', 'Classroom'], buildfarm: ['빌드 팜', 'Build farm'],
};

// --- 고가용성 -----------------------------------------------------------------------------------

export function ClusterHaPage() {
  const { current } = useCluster();
  const ha = useLoad(useCallback(() => (current ? opsApi.ha(current.id) : Promise.resolve<ClusterHa | null>(null)), [current]), [current?.id]);
  const extra = useLoad(useCallback(() => (current ? haDrsApi.haExtra(current.id) : Promise.resolve<HaExtra | null>(null)), [current]), [current?.id]);
  const reload = () => { ha.reload(); extra.reload(); };
  return (
    <ClusterFrame reload={reload}>
      {(c) => <LoadState value={ha} retry={ha.reload}>{(h) => h && (
        <LoadState value={extra} retry={extra.reload}>{(x) => x && <HaBody cluster={c} ha={h} extra={x} reload={reload} />}</LoadState>
      )}</LoadState>}
    </ClusterFrame>
  );
}

function HaBody({ cluster, ha, extra, reload }: { cluster: Cluster; ha: ClusterHa; extra: HaExtra; reload: () => void }) {
  const { L, lang } = useL();
  const [dialog, setDialog] = useState<null | 'add' | 'group' | 'separate' | { pool: HaPool; action: 'add' | 'remove' }>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const stateL = (s: string) => (HA_STATE[s] ? (lang === 'ko' ? HA_STATE[s][0] : HA_STATE[s][1]) : s);
  const local = ha.resources.filter((r) => extra.storage[String(r.vmid)] === 'local');
  const pt = ha.resources.filter((r) => extra.passthrough[String(r.vmid)]);
  const fewNodes = extra.nodes_total < 3;
  async function remove(r: HaResource) {
    if (!confirm(L(`${r.name || r.sid}을(를) HA에서 뺄까요? VM은 지금 자리에서 계속 돕니다.`, `Take ${r.name || r.sid} out of HA? It keeps running where it is.`))) return;
    try { await opsApi.haRemove(cluster.id, r.vmid); setNotice({ kind: 'info', text: L(`${r.name || r.sid}을(를) HA에서 뺐습니다.`, `${r.sid} is out of HA.`) }); reload(); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  async function removeGroup(g: HaGroup) {
    if (!confirm(L(`노드 우선 규칙 '${g.group}'을(를) 지울까요?`, `Delete node rule '${g.group}'?`))) return;
    try { await opsApi.haGroupRemove(cluster.id, g.group); reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  async function removeSeparate(r: SeparateRule) {
    if (!confirm(L(`떨어뜨려 두기 규칙 '${r.name}'을(를) 지울까요?`, `Delete keep-apart rule '${r.name}'?`))) return;
    try { await haDrsApi.separateRemove(cluster.id, r.name); reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  const nameOf = (vmid: number) => ha.resources.find((r) => r.vmid === vmid)?.name || extra.names?.[String(vmid)] || String(vmid);
  return (
    <>
      <div className="vt-bar"><div className="vt-row">
        <p className="muted small page-intro">{L('노드가 멈추면 등록한 VM을 다른 노드에서 다시 켭니다.', 'When a node stops, the listed VMs start on another node.')}</p>
        <HowTo><ul>
          <li>{L('전용 데스크톱과 DC · 게이트웨이 · 빌드 서버처럼 늘 살아 있어야 하는 VM을 올리세요.', 'Put on it dedicated desktops and VMs that must always run: DCs, gateways, build servers.')}</li>
          <li>{L('초기화 · 수업용 · 공유 풀은 보통 올리지 않습니다. 노드가 멈추면 사용자는 다른 데스크톱을 받습니다.', 'Reset, classroom and shared pools usually stay off it: users simply get another desktop.')}</li>
          <li>{L('디스크가 공유 스토리지(Ceph 등)에 있어야 다른 노드에서 켤 수 있습니다.', 'The disks must be on shared storage (Ceph etc.) to start elsewhere.')}</li>
          <li>{L('GPU · FPGA · USB를 붙인 VM은 그 장치가 있는 노드에서만 켜집니다.', 'A VM with a GPU, FPGA or USB device only starts on a node that has it.')}</li>
          <li>{L('풀의 [HA 사용]을 켜면 새로 만들거나 복제한 데스크톱이 준비되는 대로 등록됩니다. 이미 있는 데스크톱은 아래 풀 표에서 [모두 등록]하세요.', 'With a pool\'s Use HA on, new and cloned desktops are added once ready. Add existing ones with Add all in the pool table below.')}</li>
          <li>{L('떨어뜨려 두기: DC 복제본처럼 한 노드에 같이 있으면 안 되는 VM. 장애 복구와 부하 분산이 모두 지킵니다.', 'Keep apart: VMs that must not share a node, such as DC replicas. Both failover and balancing honour it.')}</li>
        </ul></HowTo>
      </div></div>
      <SettingsStatus items={[
        { label: L('HA 쿼럼', 'HA quorum'), value: ha.quorate === null ? '-' : ha.quorate ? L('정상', 'OK') : L('없음', 'None'), tone: ha.quorate === false ? 'warn' : ha.quorate ? 'ok' : undefined },
        { label: L('노드', 'Nodes'), value: `${extra.nodes_online} / ${extra.nodes_total}`, tone: extra.nodes_online < extra.nodes_total ? 'warn' : 'ok' },
        { label: L('관리 노드', 'Manager node'), value: ha.master || '-' },
        { label: L('등록된 VM', 'VMs under HA'), value: String(ha.resources.length) },
      ]} />
      {ha.quorate === false && <div className="alert small error" role="alert">{L('쿼럼이 없습니다. HA가 VM을 다시 켜지 못합니다.', 'No quorum: HA cannot restart VMs.')}</div>}
      {fewNodes && <div className="alert small warn" role="status">{L('노드가 3대보다 적으면 한 대가 멈출 때 쿼럼을 잃을 수 있습니다.', 'With fewer than 3 nodes, one stopping can lose quorum.')}</div>}
      {local.length > 0 && <div className="alert small warn" role="status">{L(`로컬 디스크라 다른 노드에서 켤 수 없음: ${local.map((r) => r.name || r.vmid).join(', ')}`,
        `On local disks, cannot start elsewhere: ${local.map((r) => r.name || r.vmid).join(', ')}`)}</div>}
      {pt.length > 0 && <div className="alert small warn" role="status">{L(`장치가 붙어 있어 같은 장치가 있는 노드에서만 켜짐: ${pt.map((r) => r.name || r.vmid).join(', ')}`,
        `Holds a device, starts only where that device is: ${pt.map((r) => r.name || r.vmid).join(', ')}`)}</div>}
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => setDialog('add')}><Icon name="plus" size={16} />{L('VM 등록', 'Add a VM')}</button>
        <button type="button" className="btn" onClick={() => setDialog('separate')}>{L('떨어뜨려 두기', 'Keep apart')}</button>
        <button type="button" className="btn" onClick={() => setDialog('group')}>{L('노드 우선 규칙', 'Node rule')}</button>
      </div>
      <NoticeBar notice={notice} />

      {ha.resources.length === 0 ? <div className="empty"><p>{L('HA에 등록된 VM이 없습니다.', 'No VM is under HA.')}</p></div> : (
        <div className="table-scroll"><table className="table vt-table">
          <thead><tr><th>VM</th><th>{L('노드', 'Node')}</th><th>{L('상태', 'State')}</th><th>{L('요청', 'Requested')}</th><th>{L('디스크', 'Disks')}</th>
            <th className="num">{L('재시작 · 이동', 'Restarts · moves')}</th><th className="vt-actions-h">{L('작업', 'Actions')}</th></tr></thead>
          <tbody>{ha.resources.map((r) => {
            const st = extra.storage[String(r.vmid)];
            const dev = extra.passthrough[String(r.vmid)];
            return (
              <tr key={r.sid}>
                <td className="nowrap"><span className="strong">{r.name || r.sid}</span> <span className="muted small">{r.vmid}</span>
                  {r.desktop && <span className="vt-st vd-tag vt-st-provisioning">{L('데스크톱', 'desktop')}</span>}
                  {r.comment && <div className="muted small">{r.comment}</div>}</td>
                <td className="nowrap">{r.node || '-'}</td>
                <td className="nowrap"><span className={`vt-st ${r.status === 'started' ? 'vt-st-running' : r.status === 'error' || r.status === 'fence' ? 'vt-st-error' : 'vt-st-offline'}`}>{r.status || '-'}</span></td>
                <td className="nowrap">{stateL(r.state)}</td>
                <td className="nowrap small">{st === 'local' ? <span className="vt-st vt-st-error">{L('로컬', 'Local')}</span>
                  : st === 'shared' || st === 'nodisk' ? L('공유', 'Shared') : '-'}
                  {dev && <span className="vt-st vd-tag vt-st-offline">{dev === 'pci' ? 'PCI' : 'USB'}</span>}</td>
                <td className="num">{r.max_restart} · {r.max_relocate}</td>
                <td className="vt-actions"><button type="button" className="vt-link danger" onClick={() => remove(r)}>{L('해제', 'Remove')}</button></td>
              </tr>);
          })}</tbody>
        </table></div>
      )}

      <h2 className="section-title hd-sec">{L('풀', 'Pools')}</h2>
      <div className="table-scroll"><table className="table vt-table">
        <thead><tr><th>{L('풀', 'Pool')}</th><th>{L('종류', 'Type')}</th><th>{L('HA 사용', 'Use HA')}</th><th className="num">{L('HA 등록', 'Under HA')}</th><th className="vt-actions-h">{L('작업', 'Actions')}</th></tr></thead>
        <tbody>{extra.pools.length === 0 ? <tr><td colSpan={5} className="muted">{L('풀이 없습니다.', 'No pools.')}</td></tr> : extra.pools.map((p) => (
          <tr key={p.id}>
            <td className="strong nowrap">{p.name}</td>
            <td className="small">{POOL_TYPE[p.type] ? (lang === 'ko' ? POOL_TYPE[p.type][0] : POOL_TYPE[p.type][1]) : p.type}</td>
            <td className="small">{p.ha_enabled ? <span className="vt-st vt-st-running">{L('켬', 'On')}</span> : <span className="muted">{L('끔', 'Off')}</span>}</td>
            <td className="num">{p.in_ha}<span className="muted"> / {p.desktops}</span></td>
            <td className="vt-actions">
              <button type="button" className="vt-link" disabled={p.in_ha >= p.desktops} onClick={() => setDialog({ pool: p, action: 'add' })}>{L('모두 등록', 'Add all')}</button>
              <button type="button" className="vt-link danger" disabled={p.in_ha === 0} onClick={() => setDialog({ pool: p, action: 'remove' })}>{L('모두 해제', 'Remove all')}</button>
            </td>
          </tr>))}</tbody>
      </table></div>
      <p className="muted small">{L('[HA 사용]은 풀 > 설정 > 정책에서 바꿉니다.', 'Use HA is set in the pool\'s Settings > Policy.')}</p>

      <h2 className="section-title hd-sec">{L('배치 규칙', 'Placement rules')}</h2>
      {ha.groups.length === 0 && extra.separate.length === 0 ? <p className="muted small">{L('규칙이 없습니다.', 'No rules.')}</p> : (
        <div className="table-scroll"><table className="table vt-table">
          <thead><tr><th>{L('이름', 'Name')}</th><th>{L('종류', 'Kind')}</th><th>{L('대상', 'VMs')}</th><th>{L('노드 · 적용', 'Nodes · applies to')}</th><th className="vt-actions-h">{L('작업', 'Actions')}</th></tr></thead>
          <tbody>
            {extra.separate.map((r) => (
              <tr key={`s-${r.name}`}><td className="strong">{r.name}</td><td className="small">{L('떨어뜨려 두기', 'Keep apart')}</td>
                <td className="small">{r.vmids.map(nameOf).join(', ')}</td>
                <td className="small">{[r.ha_rule && L('장애 복구', 'failover'), r.balancer_rule && L('부하 분산', 'balancing')].filter(Boolean).join(' · ')}
                  {!r.ha_rule && <div className="muted small">{L('HA에 모두 등록하면 장애 복구에도 적용됩니다.', 'Applies to failover once all are under HA.')}</div>}</td>
                <td className="vt-actions"><button type="button" className="vt-link danger" onClick={() => removeSeparate(r)}>{L('삭제', 'Delete')}</button></td></tr>
            ))}
            {ha.groups.map((g) => (
              <tr key={`g-${g.group}`}><td className="strong">{g.group}{g.comment && <div className="muted small">{g.comment}</div>}</td>
                <td className="small">{L('노드 우선', 'Node priority')}{g.restricted ? L(' (이 노드만)', ' (only these)') : ''}</td>
                <td className="small">{g.resources ? g.resources.split(',').map((s) => nameOf(Number(s.split(':')[1]))).join(', ') : '-'}</td>
                <td><code className="code">{g.nodes}</code></td>
                <td className="vt-actions"><button type="button" className="vt-link danger" onClick={() => removeGroup(g)}>{L('삭제', 'Delete')}</button></td></tr>
            ))}
          </tbody>
        </table></div>
      )}

      {dialog === 'add' && <HaAddDialog cluster={cluster} ha={ha} onClose={() => setDialog(null)} onDone={(text) => { setDialog(null); setNotice({ kind: 'info', text }); reload(); }} />}
      {dialog === 'group' && <HaGroupDialog cluster={cluster} ha={ha} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />}
      {dialog === 'separate' && <SeparateDialog cluster={cluster} ha={ha} supported={extra.rules_supported} onClose={() => setDialog(null)}
        onDone={(text) => { setDialog(null); setNotice({ kind: 'info', text }); reload(); }} />}
      {dialog && typeof dialog === 'object' && <PoolHaDialog cluster={cluster} pool={dialog.pool} action={dialog.action} onClose={() => setDialog(null)}
        onDone={(n) => { setDialog(null); setNotice(n); reload(); }} />}
    </>
  );
}

function PoolHaDialog({ cluster, pool, action, onClose, onDone }: {
  cluster: Cluster; pool: HaPool; action: 'add' | 'remove'; onClose: () => void; onDone: (n: Notice) => void;
}) {
  const { L } = useL();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = action === 'add' ? pool.desktops - pool.in_ha : pool.in_ha;
  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await haDrsApi.poolHa(cluster.id, pool.id, action);
      const verb = action === 'add' ? L('등록', 'added') : L('해제', 'removed');
      onDone(r.failed.length
        ? { kind: 'error', text: L(`${r.done.length}대 ${verb}, ${r.failed.length}대 실패: ${r.failed.map((f) => `${f.name} (${f.error})`).join(', ')}`,
          `${r.done.length} ${verb}, ${r.failed.length} failed: ${r.failed.map((f) => `${f.name} (${f.error})`).join(', ')}`) }
        : { kind: 'info', text: L(`${pool.name}: ${r.done.length}대 ${verb}했습니다.`, `${pool.name}: ${r.done.length} ${verb}.`) });
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={action === 'add' ? L(`${pool.name} 모두 HA에 등록`, `Put all of ${pool.name} under HA`) : L(`${pool.name} 모두 HA에서 해제`, `Take all of ${pool.name} out of HA`)}
      onClose={onClose} onSubmit={submit} busy={busy} error={error} submitLabel={action === 'add' ? L('등록', 'Add') : L('해제', 'Remove')}>
      <p>{action === 'add'
        ? L(`데스크톱 ${n}대를 HA에 등록합니다. 켜진 것은 '켜 둠', 꺼진 것은 '꺼 둠'으로 등록됩니다.`, `${n} desktop(s) go under HA: running ones as Keep running, the rest as Keep stopped.`)
        : L(`데스크톱 ${n}대를 HA에서 뺍니다. VM은 지금 자리에서 계속 돕니다.`, `${n} desktop(s) leave HA. They keep running where they are.`)}</p>
      {action === 'add' && !pool.ha_enabled && <p className="muted small">{L('이 풀의 [HA 사용]은 꺼져 있어 새 데스크톱은 등록되지 않습니다.', "This pool's Use HA is off: new desktops are not added.")}</p>}
    </Dialog>
  );
}

function SeparateDialog({ cluster, ha, supported, onClose, onDone }: {
  cluster: Cluster; ha: ClusterHa; supported: boolean; onClose: () => void; onDone: (text: string) => void;
}) {
  const { L } = useL();
  const guests = useLoad(useCallback(() => adminApi.guests(cluster.id), [cluster.id]), [cluster.id]);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inHa = new Set(ha.resources.map((r) => r.vmid));
  async function submit() {
    if (picked.size < 2) { setError(L('VM을 2대 이상 고르세요.', 'Pick at least two VMs.')); return; }
    setBusy(true); setError(null);
    try {
      const r = await haDrsApi.separateAdd(cluster.id, name.trim(), [...picked]);
      onDone(r.ha_rule ? L(`'${name}': 장애 복구와 부하 분산에 적용됩니다.`, `'${name}': applies to failover and balancing.`)
        : L(`'${name}': 부하 분산에 적용됩니다. HA에 모두 등록하면 다시 만들어 장애 복구에도 적용하세요.`, `'${name}': applies to balancing. Recreate it once all are under HA to cover failover too.`));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('떨어뜨려 두기', 'Keep apart')} onClose={onClose} onSubmit={submit} busy={busy} error={error} submitLabel={L('만들기', 'Create')}>
      <p className="muted small">{L('고른 VM을 서로 다른 노드에 둡니다.', 'Keeps the chosen VMs on different nodes.')}</p>
      <label><span>{L('이름', 'Name')}</span><input required autoFocus pattern="[A-Za-z][A-Za-z0-9_\-]{0,39}" value={name} onChange={(e) => setName(e.target.value)} placeholder="dc-apart" />
        <small className="muted">{L('영문자로 시작, 영문 · 숫자 · - · _', 'Starts with a letter; letters, digits, - and _')}</small></label>
      <label><span>VM</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('이름 · VMID', 'Name · VMID')} /></label>
      <LoadState value={guests} retry={guests.reload}>{(gs) => (
        <div className="table-scroll maint-list"><table className="table compact-head">
          <tbody>{gs.filter((g) => !q.trim() || g.name.toLowerCase().includes(q.trim().toLowerCase()) || String(g.vmid).includes(q.trim())).map((g) => (
            <tr key={g.vmid}><td><label className="check"><input type="checkbox" checked={picked.has(g.vmid)} onChange={(e) => setPicked((s) => {
              const x = new Set(s); if (e.target.checked) x.add(g.vmid); else x.delete(g.vmid); return x;
            })} /><span>{g.name} <span className="muted small">{g.vmid} · {g.node}</span></span></label></td>
              <td className="small nowrap">{inHa.has(g.vmid) ? 'HA' : ''}</td></tr>
          ))}</tbody>
        </table></div>
      )}</LoadState>
      {picked.size >= 2 && [...picked].some((v) => !inHa.has(v)) && <p className="muted small">{supported
        ? L('HA에 없는 VM이 있어 부하 분산에만 적용됩니다.', 'Some are not under HA: it applies to balancing only.')
        : L('이 클러스터(PVE 9 이전)는 장애 복구 규칙이 없어 부하 분산에만 적용됩니다.', 'This cluster (before PVE 9) has no failover rules: it applies to balancing only.')}</p>}
    </Dialog>
  );
}

// --- 부하 분산 -----------------------------------------------------------------------------------

export function ClusterBalancePage() {
  const { current } = useCluster();
  const [refresh, setRefresh] = useState(0);
  const bal = useLoad(useCallback(() => (current ? haDrsApi.balance(current.id, refresh > 0) : Promise.resolve<Balance | null>(null)), [current, refresh]), [current?.id, refresh]);
  return (
    <ClusterFrame reload={bal.reload}>
      {(c) => <LoadState value={bal} retry={bal.reload}>{(b) => b && <BalanceBody cluster={c} b={b} reload={bal.reload} recompute={() => setRefresh((n) => n + 1)} />}</LoadState>}
    </ClusterFrame>
  );
}

const MODES: { id: BalanceMode; ko: string; en: string }[] = [
  { id: 'off', ko: '끔', en: 'Off' }, { id: 'recommend', ko: '추천만', en: 'Recommend' }, { id: 'auto', ko: '자동', en: 'Automatic' },
];

function BalanceBody({ cluster, b, reload, recompute }: { cluster: Cluster; b: Balance; reload: () => void; recompute: () => void }) {
  const { L, when } = useL();
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const scores = b.nodes.filter((n) => n.online && !n.maintenance && !n.excluded).map((n) => n.score);
  const spread = scores.length >= 2 ? Math.round((Math.max(...scores) - Math.min(...scores)) * 10) / 10 : 0;
  async function setMode(m: BalanceMode) {
    if (m === b.mode) return;
    const msg = m === 'auto' ? L('자동으로 바꿀까요? 점수 차가 기준을 넘으면 VM을 바로 옮깁니다.', 'Switch to automatic? VMs move by themselves when the spread passes the threshold.')
      : m === 'off' ? L('끌까요? 추천도 계산하지 않습니다.', 'Turn it off? No recommendations either.')
        : L('추천만으로 바꿀까요? 옮기기는 [적용]을 누를 때만 합니다.', 'Switch to recommend only? Moves happen only when you press Apply.');
    if (!confirm(msg)) return;
    setBusy('mode');
    try { await haDrsApi.balancePut(cluster.id, { mode: m }); setNotice(null); reload(); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); } finally { setBusy(null); }
  }
  async function apply(m: BalanceMove) {
    if (!confirm(L(`${m.name || m.vmid}을(를) ${m.from} → ${m.to}로 라이브 마이그레이션할까요?${m.pool ? ' 사용자 화면이 몇 초 멈출 수 있습니다.' : ''}`,
      `Live-migrate ${m.name || m.vmid} ${m.from} → ${m.to}?${m.pool ? ' The user\'s screen can freeze for a few seconds.' : ''}`))) return;
    setBusy(`m${m.vmid}`);
    try { await haDrsApi.balanceApply(cluster.id, m.vmid, m.to); setNotice({ kind: 'info', text: L(`${m.name || m.vmid} 이동을 시작했습니다.`, `Moving ${m.name || m.vmid}.`) }); recompute(); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); } finally { setBusy(null); }
  }
  async function runNow() {
    if (!confirm(L('지금 분산할까요? 모드와 관계없이 필요한 VM을 바로 옮깁니다.', 'Balance now? Whatever the mode, the VMs that need it move at once.'))) return;
    setBusy('run');
    try { await haDrsApi.balanceRun(cluster.id); setNotice({ kind: 'info', text: L('분산을 시작했습니다. 잠시 뒤 기록에 나타납니다.', 'Balancing started; the moves show in the history shortly.') }); setTimeout(recompute, 1500); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); } finally { setBusy(null); }
  }
  const s = b.settings;
  return (
    <>
      <div className="vt-bar"><div className="vt-row">
        <div className="seg" role="group" aria-label={L('모드', 'Mode')}>
          {MODES.map((m) => <button key={m.id} type="button" className={b.mode === m.id ? 'on' : ''} disabled={busy === 'mode'} aria-pressed={b.mode === m.id}
            onClick={() => setMode(m.id)}>{L(m.ko, m.en)}</button>)}
        </div>
        <button type="button" className="btn" disabled={b.mode === 'off'} onClick={recompute}><Icon name="refresh" size={16} />{L('다시 계산', 'Recompute')}</button>
        <button type="button" className="btn" disabled={busy === 'run'} onClick={runNow}>{L('지금 분산', 'Balance now')}</button>
        <button type="button" className="btn" onClick={() => setEditing(true)}>{L('설정', 'Settings')}</button>
        <HowTo><ul>
          <li>{L('추천만: 옮길 VM을 계산해 보여 주고, [적용]을 누를 때만 옮깁니다.', 'Recommend: the moves are worked out and shown; a VM moves only when you press Apply.')}</li>
          <li>{L(`자동: ${Math.round(s.check_interval / 60)}분마다 점수 차가 기준(${s.migration_threshold})을 넘으면 한 번에 몇 대씩 옮깁니다.`,
            `Automatic: every ${Math.round(s.check_interval / 60)} min, when the spread passes the threshold (${s.migration_threshold}), a few VMs move.`)}</li>
          <li>{L('점수 = CPU% × CPU 가중치 + 메모리% × 메모리 가중치 + 디스크% × 디스크 가중치.', 'Score = CPU% × CPU weight + memory% × memory weight + disk% × disk weight.')}</li>
          <li>{L('GPU · FPGA · USB가 붙은 VM은 옮기지 않습니다. 로컬 디스크 VM은 설정에서 켤 때만 옮깁니다(디스크 복사로 오래 걸림).',
            'VMs with a GPU, FPGA or USB device never move. Local-disk VMs move only when allowed in Settings (the disk is copied, which takes long).')}</li>
          <li>{L('떨어뜨려 두기 규칙(고가용성)과 유지보수 중인 노드는 지킵니다.', 'Keep-apart rules (High availability) and nodes in maintenance are respected.')}</li>
        </ul></HowTo>
      </div></div>
      <SettingsStatus items={[
        { label: L('모드', 'Mode'), value: L(MODES.find((m) => m.id === b.mode)!.ko, MODES.find((m) => m.id === b.mode)!.en), tone: b.mode === 'off' ? 'off' : 'ok' },
        { label: L('점수 차', 'Spread'), value: `${spread} / ${s.migration_threshold}`, tone: spread > s.migration_threshold ? 'warn' : 'ok' },
        { label: L('추천', 'Recommended'), value: b.mode === 'off' ? '-' : String(b.recommendations.length), tone: b.recommendations.length ? 'warn' : undefined },
        { label: L('제외된 VM', 'Left out'), value: String(b.excluded.length) },
      ]} />
      <NoticeBar notice={notice} />

      <div className="table-scroll"><table className="table vt-table">
        <thead><tr><th>{L('노드', 'Node')}</th><th>CPU</th><th>{L('메모리', 'Memory')}</th><th className="num">{L('점수', 'Score')}</th></tr></thead>
        <tbody>{b.nodes.map((n) => (
          <tr key={n.node} className={n.online ? '' : 'vt-off'}>
            <td className="nowrap"><span className="strong">{n.node}</span>
              {!n.online && <span className="vt-st vd-tag vt-st-error">{L('오프라인', 'Offline')}</span>}
              {n.maintenance && <span className="vt-st vd-tag vt-st-offline">{L('유지보수', 'Maintenance')}</span>}
              {n.excluded && <span className="vt-st vd-tag vt-st-offline">{L('제외', 'Excluded')}</span>}</td>
            <td className="vt-use"><Usage main="" pct={n.cpu} /></td>
            <td className="vt-use"><Usage main="" pct={n.mem} /></td>
            <td className="num strong">{n.score.toFixed(1)}</td>
          </tr>))}</tbody>
      </table></div>

      <h2 className="section-title hd-sec">{L('추천 이동', 'Recommended moves')}
        {b.computed_at && <span className="muted small"> · {when(new Date(b.computed_at * 1000).toISOString())}</span>}</h2>
      {b.mode === 'off' ? <p className="muted small">{L('꺼져 있습니다.', 'Off.')}</p>
        : b.recommendations.length === 0 ? <p className="muted small">{spread > s.migration_threshold
          ? L('점수 차가 기준을 넘지만 가장 바쁜 노드에 옮길 수 있는 VM이 없습니다. 아래 표를 보세요.', 'The spread is past the threshold, but the busiest node has no VM that can move: see the table below.')
          : L('옮길 VM이 없습니다. 고르게 나뉘어 있습니다.', 'Nothing to move: the load is even.')}</p> : (
          <div className="table-scroll"><table className="table vt-table">
            <thead><tr><th>VM</th><th>{L('이동', 'Move')}</th><th className="num">{L('메모리', 'Memory')}</th><th>{L('점수 차', 'Spread')}</th><th className="vt-actions-h">{L('작업', 'Actions')}</th></tr></thead>
            <tbody>{b.recommendations.map((m) => (
              <tr key={m.vmid}>
                <td className="nowrap"><span className="strong">{m.name || m.vmid}</span> <span className="muted small">{m.vmid}</span>
                  {m.pool && <div className="muted small">{m.pool}</div>}</td>
                <td className="nowrap">{m.from} → {m.to}{m.local_disks && <span className="vt-st vd-tag vt-st-offline">{L('디스크 복사', 'disk copy')}</span>}</td>
                <td className="num nowrap">{Math.round(m.mem / GB)} GB</td>
                <td className="nowrap small">{m.before} → {m.after}</td>
                <td className="vt-actions"><button type="button" className="btn primary small-btn" disabled={busy !== null} onClick={() => apply(m)}>{L('적용', 'Apply')}</button></td>
              </tr>))}</tbody>
          </table></div>
        )}

      <h2 className="section-title hd-sec">{L('옮기지 않는 VM', 'VMs left in place')}</h2>
      {b.excluded.length === 0 ? <p className="muted small">{L('없습니다.', 'None.')}</p> : (
        <div className="table-scroll"><table className="table vt-table">
          <thead><tr><th>VM</th><th>{L('노드', 'Node')}</th><th>{L('이유', 'Why')}</th></tr></thead>
          <tbody>{b.excluded.map((x) => (
            <tr key={x.vmid}><td className="nowrap"><span className="strong">{x.name || x.vmid}</span> <span className="muted small">{x.vmid}</span>
              {x.pool && <div className="muted small">{x.pool}</div>}</td>
              <td className="nowrap">{x.node}</td><td className="small">{staysText(x.reason, L)}</td></tr>))}</tbody>
        </table></div>
      )}

      <h2 className="section-title hd-sec">{L('이동 기록', 'Move history')}</h2>
      {b.history.length === 0 ? <p className="muted small">{L('기록이 없습니다.', 'No moves yet.')}</p> : (
        <div className="table-scroll"><table className="table vt-table">
          <thead><tr><th>{L('시각', 'When')}</th><th>VM</th><th>{L('이동', 'Move')}</th><th>{L('방법', 'How')}</th><th>{L('결과', 'Result')}</th></tr></thead>
          <tbody>{b.history.slice(0, 50).map((h, i) => (
            <tr key={`${h.at}-${h.vmid}-${i}`}>
              <td className="nowrap small">{when(h.at)}</td>
              <td className="nowrap"><span className="strong">{h.name || h.vmid}</span> <span className="muted small">{h.vmid}</span></td>
              <td className="nowrap">{h.from} → {h.to}</td>
              <td className="small nowrap">{h.how === 'auto' ? L('자동', 'Automatic') : h.how === 'run' ? L('지금 분산', 'Balance now') : L('적용', 'Apply')}
                {h.by && h.by !== 'system' && <span className="muted"> · {h.by}</span>}</td>
              <td className="small">{h.ok ? <span className="vt-st vt-st-running">{L('완료', 'Done')}</span>
                : <><span className="vt-st vt-st-error">{L('실패', 'Failed')}</span> <span className="muted">{h.error}</span></>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {editing && <BalanceSettingsDialog cluster={cluster} b={b} onClose={() => setEditing(false)} onDone={() => { setEditing(false); recompute(); }} />}
    </>
  );
}

function BalanceSettingsDialog({ cluster, b, onClose, onDone }: { cluster: Cluster; b: Balance; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [v, setV] = useState({ ...b.settings, interval_min: Math.round(b.settings.check_interval / 60) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [v]);
  const num = (k: keyof typeof v, lo: number, hi: number, step = 1) => (
    <input type="number" min={lo} max={hi} step={step} value={v[k] as number} onChange={(e) => setV((o) => ({ ...o, [k]: Number(e.target.value) }))} />
  );
  async function submit() {
    if (!v.balance_cpu_weight && !v.balance_mem_weight && !v.balance_io_weight) { setError(L('가중치를 하나 이상 0보다 크게 두세요.', 'Keep at least one weight above 0.')); return; }
    if (!confirm(L('부하 분산 설정을 바꿀까요?', 'Change the balancing settings?'))) return;
    setBusy(true);
    const body: BalancePut = { check_interval: Math.max(1, v.interval_min) * 60, migration_threshold: v.migration_threshold,
      balance_cpu_weight: v.balance_cpu_weight, balance_mem_weight: v.balance_mem_weight, balance_io_weight: v.balance_io_weight,
      balance_local_disks: v.balance_local_disks, balance_containers: v.balance_containers };
    try { await haDrsApi.balancePut(cluster.id, body); onDone(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('부하 분산 설정', 'Balancing settings')} onClose={onClose} onSubmit={submit} busy={busy} error={error} submitLabel={L('저장', 'Save')}>
      <div className="form-row form-row-even">
        <label><span>{L('검사 간격 (분)', 'Check every (min)')}</span>{num('interval_min', 1, 1440)}</label>
        <label><span>{L('기준 점수 차', 'Threshold')}</span>{num('migration_threshold', 5, 200)}<small className="muted">{L('클수록 덜 옮김', 'Higher moves less')}</small></label>
      </div>
      <div className="form-row form-row-even">
        <label><span>{L('CPU 가중치', 'CPU weight')}</span>{num('balance_cpu_weight', 0, 10, 0.1)}</label>
        <label><span>{L('메모리 가중치', 'Memory weight')}</span>{num('balance_mem_weight', 0, 10, 0.1)}</label>
        <label><span>{L('디스크 가중치', 'Disk weight')}</span>{num('balance_io_weight', 0, 10, 0.1)}</label>
      </div>
      <label className="check"><input type="checkbox" checked={v.balance_local_disks} onChange={(e) => setV((o) => ({ ...o, balance_local_disks: e.target.checked }))} />
        <span>{L('로컬 디스크 VM도 옮기기 (디스크를 복사해 오래 걸림)', 'Also move local-disk VMs (the disk is copied, which takes long)')}</span></label>
      <label className="check"><input type="checkbox" checked={v.balance_containers} onChange={(e) => setV((o) => ({ ...o, balance_containers: e.target.checked }))} />
        <span>{L('컨테이너도 옮기기 (옮길 때 재시작)', 'Also move containers (they restart)')}</span></label>
    </Dialog>
  );
}
