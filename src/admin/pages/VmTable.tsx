import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import type { AdminDesktop, AssignableUser, ClusterNode, Guest, Pool, PowerAction } from '../../api/types';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { PageActions } from '../../components/PageHead';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { bytes } from './ClusterPages';
import { Caret, Drop, Modal, Pager, Usage } from './TableKit';
import { VmDetail } from './VmDetail';
import { useAdminConsole, VmManageDialog, type ManagedDesktop, type VmManageTab } from './VmManage';

// 가상머신 > 데스크톱(VM) 관리: every VM of the connected clusters in one dense table - the pools'
// desktops with what they use right now, and the cluster's VMs no pool holds yet (they can be put
// into one from here). Power, assignment and the VM manage dialog work per row or for the checked rows.

type Notice = { kind: 'info' | 'error'; text: string };
type Phase = 'running' | 'in_use' | 'stopped' | 'offline' | 'missing' | 'provisioning' | 'error' | 'unknown';
type Row = {
  key: string; desk: AdminDesktop | null; clusterId: string; vmid: number; name: string; type: string; node: string;
  phase: Phase; poolId: string; pool: string; user: string | null;
  cpus: number | null; cpuPct: number | null; maxmem: number | null; memPct: number | null;
};
type Loose = Guest & { cluster_id: string };
type Inventory = { desktops: AdminDesktop[]; pools: Pool[]; loose: Loose[]; offline: Set<string> };
type SortKey = 'cpu' | 'mem';

const PAGE_SIZES = [20, 50, 100];
const isOn = (p: Phase) => p === 'running' || p === 'in_use';

async function loadInventory(): Promise<Inventory> {
  const [desktops, pools, clusters] = await Promise.all([adminApi.desktops(), adminApi.pools(), adminApi.clusters()]);
  const loose: Loose[] = [];
  const offline = new Set<string>();
  await Promise.all(clusters.filter((c) => c.connected).map(async (c) => {
    const [guests, nodes] = await Promise.all([
      adminApi.guests(c.id).catch(() => [] as Guest[]),
      adminApi.nodes(c.id).catch(() => [] as ClusterNode[]),
    ]);
    guests.forEach((g) => { if (!g.desktop_id) loose.push({ ...g, cluster_id: c.id }); });
    nodes.forEach((n) => { if (!n.online) offline.add(`${c.id}|${n.node}`); });
  }));
  return { desktops, pools, loose, offline };
}

function toRows(inv: Inventory): Row[] {
  const rows: Row[] = inv.desktops.map((d) => {
    const cid = d.cluster_id ?? '';
    const u = d.usage;
    const phase: Phase = d.state === 'missing' ? 'missing'
      : inv.offline.has(`${cid}|${d.node}`) ? 'offline'
      : d.state === 'ready' ? 'running' : d.state;
    const on = isOn(phase);
    return {
      key: `d:${d.id}`, desk: d, clusterId: cid, vmid: d.vmid, name: d.name, type: '', node: d.node, phase,
      poolId: d.pool_id ?? '', pool: d.pool, user: d.assigned_user,
      cpus: u?.cpus ?? d.spec?.cpu ?? null, cpuPct: u && on ? u.cpu_percent : null,
      maxmem: u?.maxmem ?? (d.spec?.memory_gb ? d.spec.memory_gb * 1024 ** 3 : null),
      memPct: u && on && u.maxmem ? (u.mem / u.maxmem) * 100 : null,
    };
  });
  for (const g of inv.loose) {
    const phase: Phase = inv.offline.has(`${g.cluster_id}|${g.node}`) || g.status === 'unknown' ? 'offline'
      : g.status === 'running' ? 'running' : g.status === 'stopped' ? 'stopped' : 'unknown';
    rows.push({ key: `g:${g.cluster_id}:${g.vmid}`, desk: null, clusterId: g.cluster_id, vmid: g.vmid, name: g.name, type: g.type,
      node: g.node, phase, poolId: '', pool: '', user: null, cpus: null, cpuPct: null, maxmem: null, memPct: null });
  }
  return rows.sort((a, b) => a.vmid - b.vmid);
}

export function VmTablePage() {
  const [params, setParams] = useSearchParams();
  const open = params.get('vm');
  const go = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('vm', id); else n.delete('vm'); return n; });
  if (open) return <VmDetail deskId={open} onBack={() => go(null)} />;
  return <VmList onOpen={(id) => go(id)} />;
}

function VmList({ onOpen }: { onOpen: (id: string) => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const navigate = useNavigate();
  const inv = useLoad(loadInventory);
  const users = useLoad(adminApi.users);
  const [nameDraft, setNameDraft] = useState('');
  const [query, setQuery] = useState({ vmid: '', name: '' });
  const [node, setNode] = useState('');
  const [pool, setPool] = useState('');      // '' all, '-' in no pool
  const [user, setUser] = useState('');      // '' all, '-' nobody
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(PAGE_SIZES[0]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [managing, setManaging] = useState<{ desk: ManagedDesktop; tab: VmManageTab } | null>(null);
  const [dialog, setDialog] = useState<null | 'assign' | 'pool'>(null);
  const adminConsole = useAdminConsole(useCallback((text: string) => setNotice({ kind: 'error', text }), []));

  const all = useMemo(() => (inv.state === 'ok' ? toRows(inv.data) : []), [inv]);
  const pools = inv.state === 'ok' ? [...inv.data.pools].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const nodes = useMemo(() => [...new Set(all.map((r) => r.node).filter(Boolean))].sort(), [all]);
  const holders = useMemo(() => [...new Set(all.map((r) => r.user).filter((u): u is string => !!u))].sort(), [all]);

  const rows = useMemo(() => {
    const name = query.name.trim().toLowerCase();
    const vmid = query.vmid.trim();
    const out = all.filter((r) => (!vmid || String(r.vmid).startsWith(vmid))
      && (!name || r.name.toLowerCase().includes(name) || (/^\d+$/.test(name) && String(r.vmid).startsWith(name)))
      && (!node || r.node === node)
      && (!pool || (pool === '-' ? !r.desk : r.poolId === pool))
      && (!user || (user === '-' ? !r.user : r.user === user)));
    if (sort) {
      const val = (r: Row) => (sort.key === 'cpu' ? [r.cpuPct, r.cpus] : [r.memPct, r.maxmem]);
      out.sort((a, b) => {
        const [ap, as] = val(a); const [bp, bs] = val(b);
        if ((ap ?? -1) !== (bp ?? -1)) return ((ap ?? -1) - (bp ?? -1)) * sort.dir;
        return ((as ?? -1) - (bs ?? -1)) * sort.dir;
      });
    }
    return out;
  }, [all, query, node, pool, user, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * size, cur * size + size);
  const chosen = rows.filter((r) => picked.has(r.key));
  const chosenDesks = chosen.filter((r) => r.desk);
  const pageAll = shown.length > 0 && shown.every((r) => picked.has(r.key));

  useEffect(() => { setPage(0); }, [query, node, pool, user, size]);

  const reload = () => { inv.reload(); users.reload(); };
  const toggle = (key: string) => setPicked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const sortBy = (key: SortKey) => setSort((s) => (!s || s.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : null));

  const powerLabel: Record<PowerAction, string> = {
    start: L('시작', 'Start'), shutdown: L('종료', 'Shut down'), reboot: L('다시 시작', 'Reboot'), stop: L('강제 끄기', 'Power off'),
  };

  // runs fn for each row, one after another, and says how it went
  async function each(list: Row[], what: string, fn: (r: Row) => Promise<unknown>, keepPicked = false, finished = false) {
    setBusy(true); setNotice(null);
    const failed: string[] = [];
    for (const r of list) {
      try { await fn(r); } catch (e) { failed.push(`${r.name}: ${(e as Error).message}`); }
    }
    setBusy(false);
    const ok = list.length - failed.length;
    setNotice(failed.length
      ? { kind: 'error', text: L(`${what}: ${ok}대 완료, ${failed.length}대 실패 - ${failed.join('; ')}`, `${what}: ${ok} done, ${failed.length} failed - ${failed.join('; ')}`) }
      : { kind: 'info', text: (list.length === 1 ? `${list[0].name}: ` : L(`${ok}대 `, `${ok} VMs: `)) + what
        + (finished ? L(' 완료했습니다.', ' done.') : L(' 요청했습니다.', ' requested.')) });
    if (!keepPicked) setPicked(new Set());
    inv.reload();
    window.setTimeout(inv.reload, 2500);   // the cluster's guest list catches up within seconds
  }

  function power(list: Row[], action: PowerAction) {
    const desks = list.filter((r) => r.desk && r.phase !== 'missing');
    if (!desks.length) return;
    if (action !== 'start') {
      const names = desks.length === 1 ? `'${desks[0].name}'` : L(`${desks.length}대`, `${desks.length} VMs`);
      const warn = desks.some((r) => r.phase === 'in_use') ? L(' 접속 중인 사용자는 연결이 끊깁니다.', ' Connected users are cut off.') : '';
      if (!window.confirm(L(`${names}을(를) ${powerLabel[action]}할까요?${warn}`, `${powerLabel[action]} ${names}?${warn}`))) return;
    }
    void each(desks, powerLabel[action], (r) => adminApi.powerDesktop(r.desk!.id, action));
  }

  function removeFromPool(list: Row[]) {
    const desks = list.filter((r) => r.desk);
    if (!desks.length) return;
    const names = desks.length === 1 ? `'${desks[0].name}'` : L(`${desks.length}대`, `${desks.length} VMs`);
    if (!window.confirm(L(`${names}을(를) 풀에서 뺄까요? VM은 그대로 두고, 배정은 풀립니다.`,
      `Take ${names} out of the pool? The VM stays; its assignment ends.`))) return;
    void each(desks, L('풀에서 빼기', 'Remove from pool'), (r) => adminApi.removeDesktop(r.desk!.id), false, true);
  }

  function reset(r: Row) {
    if (!window.confirm(L(`'${r.name}'을(를) 기준 스냅샷으로 되돌릴까요? 그 뒤의 변경은 사라집니다.`,
      `Reset '${r.name}' to its base snapshot? Changes since then are lost.`))) return;
    void each([r], L('초기화', 'Reset'), (x) => adminApi.resetDesktop(x.desk!.id));
  }

  const manage = (r: Row, tab: VmManageTab = 'settings') => r.desk && setManaging({ desk: { id: r.desk.id, name: r.name }, tab });

  const phaseLabel: Record<Phase, string> = {
    running: L('실행 중', 'Running'), in_use: L('사용 중', 'In use'), stopped: L('꺼짐', 'Stopped'),
    offline: L('노드 오프라인', 'Node offline'), missing: L('삭제됨', 'Deleted'), provisioning: L('준비 중', 'Preparing'),
    error: L('오류', 'Error'), unknown: L('알 수 없음', 'Unknown'),
  };

  const sortMark = (k: SortKey) => (
    <span className={`vt-sort${sort?.key === k ? ' on' : ''}`} aria-hidden="true">{sort?.key === k ? (sort.dir === -1 ? '▼' : '▲') : '↕'}</span>
  );

  return (
    <>
      <PageActions>
        <button type="button" className="btn primary" onClick={() => navigate('/admin/vms/create')}><Icon name="plus" size={16} />{L('VM 만들기', 'Create VM')}</button>
      </PageActions>
      <div className="vt-bar">
        <div className="vt-row">
          <input className="vt-name vt-search" type="search" placeholder={L('VMID · VM 이름 검색', 'Search VMID · name')} aria-label={L('VMID · VM 이름', 'VMID · VM name')} value={nameDraft}
            onChange={(e) => { setNameDraft(e.target.value); setQuery({ vmid: '', name: e.target.value }); }} />
          <select value={node} onChange={(e) => setNode(e.target.value)} aria-label={L('노드', 'Node')}>
            <option value="">{L('노드 전체', 'All nodes')}</option>
            {nodes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={pool} onChange={(e) => setPool(e.target.value)} aria-label={L('데스크톱 풀', 'Desktop pool')}>
            <option value="">{L('풀 전체', 'All pools')}</option>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="-">{L('풀 없음', 'No pool')}</option>
          </select>
          <select value={user} onChange={(e) => setUser(e.target.value)} aria-label={L('배정 사용자', 'Assigned user')}>
            <option value="">{L('사용자 전체', 'All users')}</option>
            {holders.map((u) => <option key={u} value={u}>{u}</option>)}
            <option value="-">{L('배정 안 됨', 'Unassigned')}</option>
          </select>
          <button type="button" className="btn vt-icon-btn" onClick={reload} title={L('새로 고침', 'Refresh')} aria-label={L('새로 고침', 'Refresh')}><Icon name="refresh" size={16} /></button>
          <HowTo>
            <ul>
              <li>{L('풀에 없는 클러스터 VM도 함께 보입니다. 일괄 작업 › 풀에 추가로 데스크톱으로 만듭니다.',
                'Cluster VMs no pool holds are listed too. Bulk actions › Add to pool makes them desktops.')}</li>
              <li>{L('전원 · 배정 · 상세는 풀에 든 VM만 됩니다.', 'Power, assignment and details work for VMs in a pool.')}</li>
              <li>{L('VMID는 앞자리로, 이름은 일부로 찾습니다. 입력하는 대로 걸러집니다.', 'VMID matches from the start, name anywhere. Filters as you type.')}</li>
              <li>{L('접속 › 콘솔은 관리자 지원용 브라우저 화면이며 감사 기록에 남습니다. RDP · SPICE는 사용자 포털에서 씁니다.',
                'Connect › Console opens the screen in the browser for support; it is audited. RDP and SPICE are in the user portal.')}</li>
            </ul>
          </HowTo>
        </div>
        {chosen.length > 0 && <div className="vt-row vt-selbar" role="region" aria-label={L('선택한 VM', 'Selected VMs')}>
          <span className="vt-count on">{L(`${chosen.length}대 선택`, `${chosen.length} selected`)}</span>
          <button type="button" className="btn small-btn" disabled={busy || !chosenDesks.length} onClick={() => setDialog('assign')}>
            <Icon name="users" size={15} />{L('사용자 일괄 배정', 'Assign users')}</button>
          <Drop disabled={busy || !chosen.length} className="btn small-btn" label={<>{L('일괄 작업', 'Bulk actions')}<Caret /></>} align="left">
            {(close) => (
              <>
                {(['start', 'shutdown', 'reboot'] as PowerAction[]).map((a) => (
                  <button key={a} type="button" role="menuitem" disabled={!chosenDesks.length} onClick={() => { close(); power(chosen, a); }}>{powerLabel[a]}</button>
                ))}
                <button type="button" role="menuitem" className="danger" disabled={!chosenDesks.length}
                  onClick={() => { close(); power(chosen, 'stop'); }}>{powerLabel.stop}</button>
                <hr className="vt-sep" />
                <button type="button" role="menuitem" disabled={!chosen.some((r) => !r.desk)}
                  onClick={() => { close(); setDialog('pool'); }}>{L('풀에 추가', 'Add to pool')}</button>
                <button type="button" role="menuitem" disabled={!chosenDesks.length}
                  onClick={() => { close(); removeFromPool(chosen); }}>{L('풀에서 빼기', 'Remove from pool')}</button>
              </>
            )}
          </Drop>
          <button type="button" className="btn-ghost small-btn" onClick={() => setPicked(new Set())}>{L('선택 해제', 'Clear')}</button>
        </div>}
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}

      <LoadState value={inv} retry={inv.reload}>
        {() => rows.length === 0 ? (
          <div className="empty"><p>{all.length ? L('조건에 맞는 VM이 없습니다.', 'No VM matches.') : L('VM이 없습니다.', 'No VMs yet.')}</p></div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="table vt-table">
                <thead>
                  <tr>
                    <th className="vt-check"><input type="checkbox" aria-label={L('이 페이지 전체', 'This page')} checked={pageAll}
                      onChange={() => setPicked((s) => { const n = new Set(s); shown.forEach((r) => (pageAll ? n.delete(r.key) : n.add(r.key))); return n; })} /></th>
                    <th>VM</th>
                    <th aria-sort={sort?.key === 'cpu' ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" className="vt-th-btn" onClick={() => sortBy('cpu')}>CPU{sortMark('cpu')}</button></th>
                    <th aria-sort={sort?.key === 'mem' ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" className="vt-th-btn" onClick={() => sortBy('mem')}>{L('메모리', 'Memory')}{sortMark('mem')}</button></th>
                    <th>{L('노드', 'Node')}</th>
                    <th>{L('데스크톱 풀', 'Pool')}</th>
                    <th>{L('배정 사용자', 'User')}</th>
                    <th className="vt-center">{L('전원', 'Power')}</th>
                    <th>{L('접속', 'Connect')}</th>
                    <th className="vt-actions-h">{L('작업', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const on = isOn(r.phase);
                    const live = !!r.desk && r.phase !== 'missing' && r.phase !== 'offline' && r.phase !== 'provisioning';
                    return (
                      <tr key={r.key} className={picked.has(r.key) ? 'vt-picked' : undefined}>
                        <td className="vt-check"><input type="checkbox" aria-label={r.name} checked={picked.has(r.key)} onChange={() => toggle(r.key)} /></td>
                        <td className="vt-vm">
                          <span className="vt-vm-id">{r.vmid}</span>
                          {r.desk && r.phase !== 'missing' ? <button type="button" className="vt-vm-name vt-name-link" title={r.name} onClick={() => onOpen(r.desk!.id)}>{r.name}</button>
                            : <span className="vt-vm-name" title={r.name}>{r.name}</span>}
                          <span className={`vt-st vt-st-${r.phase}`}>{phaseLabel[r.phase]}</span>
                        </td>
                        <td className="vt-use">{r.cpus == null ? <span className="muted">-</span> : (
                          <Usage main={`${r.cpus}${L('코어', ' vCPU')}`} pct={r.cpuPct} />)}</td>
                        <td className="vt-use">{r.maxmem == null ? <span className="muted">-</span> : (
                          <Usage main={bytes(r.maxmem)} pct={r.memPct} />)}</td>
                        <td className="nowrap">{r.node || '-'}</td>
                        <td className="nowrap">{r.desk ? (r.poolId ? <Link to={`/admin/pools/list/${r.poolId}`}>{r.pool}</Link> : r.pool)
                          : <span className="muted">{L('없음', 'None')}</span>}</td>
                        <td className="nowrap">{r.user ?? <span className="muted">-</span>}</td>
                        <td className="vt-center">
                          <button type="button" className={`vt-power${on ? ' on' : ''}`} disabled={busy || !live || !(on || r.phase === 'stopped')}
                            aria-label={on ? L(`${r.name} 종료`, `Shut down ${r.name}`) : L(`${r.name} 시작`, `Start ${r.name}`)}
                            title={!r.desk ? L('풀에 넣으면 여기서 켜고 끕니다', 'Put it in a pool to switch it here')
                              : on ? L('켜짐 · 눌러서 종료', 'On · click to shut down') : r.phase === 'stopped' ? L('꺼짐 · 눌러서 시작', 'Off · click to start') : phaseLabel[r.phase]}
                            onClick={() => power([r], on ? 'shutdown' : 'start')}><Icon name="power" size={17} /></button>
                        </td>
                        <td>
                          <Drop disabled={!r.desk} className="vt-pill" label={<>{L('콘솔', 'Console')}<Caret /></>}>
                            {(close) => (
                              <>
                                <button type="button" role="menuitem" disabled={!on}
                                  onClick={() => { close(); adminConsole.start({ id: r.desk!.id, name: r.name }); }}>
                                  <Icon name="vm" size={16} />{L('브라우저 콘솔', 'Browser console')}</button>
                                {!on && <p className="vt-menu-note">{L('켜져 있을 때 열립니다.', 'Opens while it runs.')}</p>}
                              </>
                            )}
                          </Drop>
                        </td>
                        <td className="vt-actions">
                          <Drop disabled={busy || !r.desk || r.phase === 'missing'} className="vt-link" label={<>{L('배정', 'Assign')}<Caret /></>}>
                            {(close) => <AssignPop row={r} users={users.state === 'ok' ? users.data : null} onDone={(u) => {
                              close();
                              void each([r], u ? L(`${u}에게 배정`, `assigned to ${u}`) : L('배정 해제', 'unassigned'), (x) => adminApi.assign(x.desk!.id, u), true, true);
                            }} />}
                          </Drop>
                          <button type="button" className="vt-link" disabled={!r.desk || r.phase === 'missing'} onClick={() => onOpen(r.desk!.id)}>{L('상세', 'Details')}</button>
                          <Drop disabled={busy} className="vt-more" label={<>{L('더보기', 'More')}<Caret /></>}>
                            {(close) => r.desk ? (
                              <>
                                <button type="button" role="menuitem" disabled={!live} onClick={() => { close(); manage(r, 'snapshots'); }}>{L('스냅샷', 'Snapshots')}</button>
                                <button type="button" role="menuitem" disabled={!live} onClick={() => { close(); manage(r, 'move'); }}>{L('노드 이동', 'Move to node')}</button>
                                <button type="button" role="menuitem" disabled={!live || !on} onClick={() => { close(); power([r], 'reboot'); }}>{powerLabel.reboot}</button>
                                {r.desk.has_base && <button type="button" role="menuitem" disabled={!live} onClick={() => { close(); reset(r); }}>{L('기준으로 초기화', 'Reset to base')}</button>}
                                <button type="button" role="menuitem" onClick={() => { close(); removeFromPool([r]); }}>{L('풀에서 빼기', 'Remove from pool')}</button>
                                <hr className="vt-sep" />
                                <button type="button" role="menuitem" disabled={!live} onClick={() => { close(); manage(r, 'manage'); }}>{L('템플릿으로 변환', 'Make template')}</button>
                                <button type="button" role="menuitem" className="danger" disabled={!live || !on} onClick={() => { close(); power([r], 'stop'); }}>{powerLabel.stop}</button>
                                <button type="button" role="menuitem" className="danger" disabled={!live} onClick={() => { close(); manage(r, 'manage'); }}>{L('VM 삭제', 'Delete VM')}</button>
                              </>
                            ) : (
                              <button type="button" role="menuitem" onClick={() => { close(); setPicked(new Set([r.key])); setDialog('pool'); }}>{L('풀에 추가', 'Add to pool')}</button>
                            )}
                          </Drop>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="vt-pager">
              <span className="muted small">{L(`총 ${rows.length}대`, `${rows.length} total`)}{rows.length !== all.length ? L(` (전체 ${all.length}대)`, ` (of ${all.length})`) : ''}</span>
              <select className="vt-size" value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label={L('페이지당', 'Per page')}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{L(`${n}개씩`, `${n} / page`)}</option>)}
              </select>
              <Pager page={cur} pages={pages} onPage={setPage} />
            </div>
          </>
        )}
      </LoadState>

      {dialog === 'assign' && <BulkAssignDialog rows={chosenDesks} users={users.state === 'ok' ? users.data : []} holders={holders}
        onClose={() => setDialog(null)}
        onSave={(plan) => { setDialog(null); void each(plan.map((p) => p.row), L('사용자 배정', 'users assigned'),
          (r) => adminApi.assign(r.desk!.id, plan.find((p) => p.row === r)!.user), false, true); }} />}
      {dialog === 'pool' && <AddToPoolDialog rows={chosen.filter((r) => !r.desk)} pools={pools}
        onClose={() => setDialog(null)}
        onSave={(p) => { setDialog(null); void each(chosen.filter((r) => !r.desk && r.clusterId === p.cluster_id), L(`'${p.name}' 풀에 추가`, `added to '${p.name}'`),
          (r) => adminApi.addDesktop(p.id, { vmid: r.vmid, node: r.node, type: r.type, name: r.name }), false, true); }} />}
      {managing && <VmManageDialog desk={managing.desk} tab={managing.tab} onClose={() => setManaging(null)} onChanged={inv.reload}
        onGone={(text) => { setNotice({ kind: 'info', text }); inv.reload(); }} onConsole={adminConsole.start} />}
      {adminConsole.view}
    </>
  );
}

function AssignPop({ row, users, onDone }: { row: Row; users: AssignableUser[] | null; onDone: (user: string | null) => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [u, setU] = useState(row.user ?? '');
  return (
    <div className="vt-assign">
      <label className="vt-menu-note">{L(`${row.name} 사용자`, `User of ${row.name}`)}</label>
      <select value={u} onChange={(e) => setU(e.target.value)} disabled={!users} autoFocus>
        <option value="">{users ? L('선택', 'Pick') : L('불러오는 중…', 'Loading…')}</option>
        {(users ?? []).map((x) => <option key={x.username} value={x.username}>
          {x.display_name && x.display_name !== x.username ? `${x.display_name} (${x.username})` : x.username}</option>)}
      </select>
      <div className="vt-assign-btns">
        {row.user && <button type="button" className="btn-ghost small-btn danger" onClick={() => onDone(null)}>{L('배정 해제', 'Unassign')}</button>}
        <button type="button" className="btn primary small-btn" disabled={!u || u === row.user} onClick={() => onDone(u)}>{L('배정', 'Assign')}</button>
      </div>
    </div>
  );
}

function BulkAssignDialog({ rows, users, holders, onClose, onSave }: {
  rows: Row[]; users: AssignableUser[]; holders: string[]; onClose: () => void; onSave: (plan: { row: Row; user: string | null }[]) => void;
}) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [plan, setPlan] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.key, r.user ?? ''])));
  const free = users.map((u) => u.username).filter((u) => !holders.includes(u));
  const fill = () => {
    const taken = new Set(Object.values(plan).filter(Boolean));
    const queue = free.filter((u) => !taken.has(u));
    setPlan((p) => Object.fromEntries(rows.map((r) => [r.key, p[r.key] || queue.shift() || ''])));
  };
  const changes = rows.filter((r) => (plan[r.key] || null) !== r.user);
  return (
    <Modal title={L(`사용자 일괄 배정 · ${rows.length}대`, `Assign users · ${rows.length}`)} onClose={onClose} actions={(
      <>
        <button type="button" className="btn-ghost" onClick={fill} disabled={!free.length}>{L('빈 칸에 미배정 사용자 채우기', 'Fill blanks with users who have none')}</button>
        <button type="button" className="btn" onClick={onClose}>{L('취소', 'Cancel')}</button>
        <button type="button" className="btn primary" disabled={!changes.length}
          onClick={() => onSave(changes.map((r) => ({ row: r, user: plan[r.key] || null })))}>{L(`${changes.length}대 저장`, `Save ${changes.length}`)}</button>
      </>
    )}>
      <div className="vt-plan">
        {rows.map((r) => (
          <label key={r.key} className="vt-plan-row">
            <span><span className="vt-vm-id">{r.vmid}</span> {r.name}<span className="muted small"> · {r.pool}</span></span>
            <select value={plan[r.key]} onChange={(e) => setPlan((p) => ({ ...p, [r.key]: e.target.value }))}>
              <option value="">{L('배정 안 함', 'Nobody')}</option>
              {users.map((u) => <option key={u.username} value={u.username}>{u.username}</option>)}
            </select>
          </label>
        ))}
      </div>
    </Modal>
  );
}

function AddToPoolDialog({ rows, pools, onClose, onSave }: { rows: Row[]; pools: Pool[]; onClose: () => void; onSave: (p: Pool) => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const clusters = new Set(rows.map((r) => r.clusterId));
  const fits = pools.filter((p) => clusters.has(p.cluster_id));
  const [id, setId] = useState(fits[0]?.id ?? '');
  const p = fits.find((x) => x.id === id);
  const n = p ? rows.filter((r) => r.clusterId === p.cluster_id).length : 0;
  return (
    <Modal title={L(`풀에 추가 · ${rows.length}대`, `Add to pool · ${rows.length}`)} onClose={onClose} actions={(
      <>
        <button type="button" className="btn" onClick={onClose}>{L('취소', 'Cancel')}</button>
        <button type="button" className="btn primary" disabled={!p || !n} onClick={() => p && onSave(p)}>{L(`${n}대 추가`, `Add ${n}`)}</button>
      </>
    )}>
      {fits.length === 0 ? <p className="muted">{L('이 VM의 클러스터에 풀이 없습니다. 먼저 풀을 만드세요.', 'This cluster has no pool yet. Create one first.')}</p> : (
        <label className="vt-field">{L('데스크톱 풀', 'Desktop pool')}
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {fits.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      )}
      {p && n < rows.length && <p className="muted small">{L(`다른 클러스터 VM ${rows.length - n}대는 빠집니다.`, `${rows.length - n} VMs on another cluster are skipped.`)}</p>}
    </Modal>
  );
}
