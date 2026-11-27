import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { buildApi } from '../../api/build';
import { opsApi } from '../../api/ops';
import type { Cluster, ClusterNode, ClusterStorage } from '../../api/types';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { bytes, ClusterFrame } from './ClusterPages';
import { MaintenanceDialog, PowerDialog } from './OpsPages';
import { Caret, Drop, Usage } from './TableKit';

// 클러스터 > 개요 · 노드: what the cluster has and gives out (use and allocation rings), how CPU and memory
// went over time (Proxmox rrddata), and the nodes as the same table as the other admin lists.

type Notice = { kind: 'info' | 'error'; text: string };
const NODES_PATH = '/admin/cluster/overview/nodes';
const STORAGE_PATH = '/admin/cluster/overview/storage';
const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const GB = 1024 ** 3;

// the CPU architecture as the model name says it (the engine does not report it)
export function archOf(model: string) {
  if (/kunpeng|ampere|neoverse|arm|cortex|graviton|altra|phytium|ft-?2000/i.test(model)) return 'aarch64';
  if (/loongson|3a5000|3c5000|3a6000/i.test(model)) return 'loongarch64';
  if (/power\d|ppc/i.test(model)) return 'ppc64le';
  return model ? 'x86_64' : '';
}

function uptime(s: number, L: (ko: string, en: string) => string) {
  if (!s) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return d ? L(`${d}일 ${h}시간`, `${d}d ${h}h`) : L(`${h}시간`, `${h}h`);
}

// ---------------------------------------------------------------------------------- 개요

export function ClusterOverviewView() {
  return <ClusterFrame>{(c) => <Overview key={c.id} cluster={c} />}</ClusterFrame>;
}

const RANGES: [string, string, string][] = [['hour', '시간', 'Hour'], ['day', '일', 'Day'], ['week', '주', 'Week'], ['month', '월', 'Month'], ['year', '년', 'Year']];

function Overview({ cluster }: { cluster: Cluster }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const nodes = useLoad(useCallback(() => adminApi.nodes(cluster.id), [cluster.id]), [cluster.id]);
  const storage = useLoad(useCallback(() => adminApi.storage(cluster.id).catch(() => [] as ClusterStorage[]), [cluster.id]), [cluster.id]);
  const [tf, setTf] = useState('day');
  const rrd = useLoad(useCallback(() => adminApi.clusterRrd(cluster.id, tf), [cluster.id, tf]), [cluster.id, tf]);
  const navigate = useNavigate();

  return (
    <LoadState value={nodes} retry={nodes.reload}>
      {(ns) => {
        const on = ns.filter((n) => n.online);
        const cores = on.reduce((a, n) => a + n.cpus, 0);
        const cpuUse = cores ? on.reduce((a, n) => a + n.cpu_percent * n.cpus, 0) / cores : 0;
        const vcpus = ns.reduce((a, n) => a + (n.vcpus_given ?? 0), 0);
        const memUsed = on.reduce((a, n) => a + n.mem_used, 0);
        const memTotal = on.reduce((a, n) => a + n.mem_total, 0);
        const memGiven = ns.reduce((a, n) => a + (n.mem_given ?? 0), 0);
        const guests = ns.reduce((a, n) => a + n.guests, 0);
        const running = ns.reduce((a, n) => a + n.running, 0);
        const arches = [...new Set(ns.map((n) => archOf(n.cpu_model)).filter(Boolean))];
        const st = (storage.state === 'ok' ? storage.data : []).filter((s) => s.status === 'available' && s.total > 0);
        const stUsed = st.reduce((a, s) => a + s.used, 0);
        const stTotal = st.reduce((a, s) => a + s.total, 0);
        const given = ns.some((n) => n.vcpus_given !== undefined);
        return (
          <div className="cv">
            <div className="cv-cards">
              <section className="vd-card cv-info">
                <header><span className="cv-tile cv-t-blue"><Icon name="cluster" size={18} /></span><h3>{L('기본 정보', 'Basics')}</h3></header>
                <dl className="vd-kv">
                  <dt>{L('클러스터', 'Cluster')}</dt><dd className="strong">{cluster.name}</dd>
                  <dt>{L('노드', 'Nodes')}</dt><dd><b>{on.length}</b> / {ns.length} {L('온라인', 'online')}</dd>
                  <dt>VM</dt><dd><b>{running}</b> / {guests} {L('실행 중', 'running')}</dd>
                  <dt>{L('아키텍처', 'Architecture')}</dt><dd>{arches.length ? arches.join(' · ') : '-'}</dd>
                </dl>
              </section>
              <section className="vd-card">
                <header><span className="cv-tile cv-t-teal"><Icon name="cpu" size={18} /></span><h3>CPU</h3></header>
                <div className="cv-rings">
                  <Ring value={cpuUse} label={L('사용률', 'Use')} center={`${cores}`} sub={L('코어', 'cores')} />
                  <Ring value={given ? pct(vcpus, cores) : null} label={L('할당률', 'Allocated')} center={given && cores ? `${(vcpus / cores).toFixed(1)}:1` : '-'}
                    sub={given ? `${vcpus} vCPU` : L('엔진 갱신 필요', 'needs engine update')} over />
                </div>
              </section>
              <section className="vd-card">
                <header><span className="cv-tile cv-t-violet"><Icon name="memory" size={18} /></span><h3>{L('메모리', 'Memory')}</h3></header>
                <div className="cv-rings">
                  <Ring value={pct(memUsed, memTotal)} label={L('사용률', 'Use')} center={`${Math.round(memUsed / GB)}`} sub={`/ ${Math.round(memTotal / GB)} GB`} />
                  <Ring value={given ? pct(memGiven, memTotal) : null} label={L('할당률', 'Allocated')} center={given ? `${Math.round(memGiven / GB)}` : '-'}
                    sub={given ? 'GB' : L('엔진 갱신 필요', 'needs engine update')} over />
                </div>
              </section>
              <section className="vd-card">
                <header><span className="cv-tile cv-t-amber"><Icon name="layers" size={18} /></span><h3>{L('스토리지', 'Storage')}</h3></header>
                <div className="cv-store">
                  <Ring value={stTotal ? pct(stUsed, stTotal) : null} label={L('사용', 'Used')} center={stTotal ? `${Math.round(pct(stUsed, stTotal))}%` : '-'} sub={stTotal ? `${bytes(stUsed)} / ${bytes(stTotal)}` : ''} />
                  <ul className="cv-store-list">
                    {st.slice(0, 5).map((s) => (
                      <li key={`${s.storage}/${s.nodes.join(',')}`}>
                        <span className="cv-store-name" title={s.shared ? L('공유', 'shared') : s.nodes.join(', ')}>{s.storage}</span>
                        <Usage main="" pct={pct(s.used, s.total)} />
                      </li>
                    ))}
                    {st.length > 5 && <li className="muted small"><Link to={STORAGE_PATH}>{L(`외 ${st.length - 5}개`, `${st.length - 5} more`)}</Link></li>}
                  </ul>
                </div>
              </section>
            </div>

            <section className="vd-card">
              <header>
                <h3>{L('사용 추이', 'History')}</h3>
                <div className="cv-range" role="tablist" aria-label={L('기간', 'Range')}>
                  {RANGES.map(([id, ko, en]) => (
                    <button key={id} type="button" role="tab" aria-selected={tf === id} className={tf === id ? 'on' : ''} onClick={() => setTf(id)}>{L(ko, en)}</button>
                  ))}
                </div>
              </header>
              <LoadState value={rrd} retry={rrd.reload}>
                {(r) => r.points.length < 2 ? <p className="muted small">{L('아직 기록이 없습니다.', 'No history yet.')}</p> : (
                  <div className="cv-charts">
                    <LineChart title={L('CPU 사용률', 'CPU use')} points={r.points.map((p) => [p.t, p.cpu])} tf={tf} hue="var(--tile-teal)" />
                    <LineChart title={L('메모리 사용률', 'Memory use')} points={r.points.map((p) => [p.t, p.mem])} tf={tf} hue="var(--tile-violet)" />
                    {r.nodes_missing.length > 0 && <p className="muted small">{L(`응답 없는 노드는 빠짐: ${r.nodes_missing.join(', ')}`, `Left out (no answer): ${r.nodes_missing.join(', ')}`)}</p>}
                  </div>
                )}
              </LoadState>
            </section>

            <section className="vd-card">
              <header><h3>{L('노드', 'Nodes')}</h3><Link className="vt-link" to={`${NODES_PATH}?c=${encodeURIComponent(cluster.id)}`}>{L('노드 화면', 'Nodes page')}</Link></header>
              <NodeTable cluster={cluster} nodes={ns} reload={nodes.reload} onOpen={(n) => navigate(`${NODES_PATH}?c=${encodeURIComponent(cluster.id)}&node=${encodeURIComponent(n)}`)} compact />
            </section>
          </div>
        );
      }}
    </LoadState>
  );
}

// a 270° gauge; `over` lets an allocation pass 100 % (shown with a second lap colour and the true number)
function Ring({ value, label, center, sub, over }: { value: number | null; label: string; center: string; sub: string; over?: boolean }) {
  const r = 34, c = 2 * Math.PI * r, arc = c * 0.75;
  const v = value == null ? 0 : Math.max(0, value);
  const shown = Math.min(100, v);
  const tone = value == null ? '' : over ? (v > 100 ? ' warm' : '') : v >= 90 ? ' hot' : v >= 75 ? ' warm' : '';
  return (
    <figure className="cv-ring" aria-label={`${label} ${value == null ? '-' : `${Math.round(v)}%`}`}>
      <svg viewBox="0 0 84 84" width="96" height="96" aria-hidden="true">
        <circle cx="42" cy="42" r={r} className="cv-ring-track" strokeDasharray={`${arc} ${c}`} transform="rotate(135 42 42)" />
        {value != null && <circle cx="42" cy="42" r={r} className={`cv-ring-fill${tone}`} strokeDasharray={`${(arc * shown) / 100} ${c}`} transform="rotate(135 42 42)" />}
        <text x="42" y="41" className="cv-ring-num">{center}</text>
        <text x="42" y="54" className="cv-ring-sub">{sub.length > 14 ? `${sub.slice(0, 13)}…` : sub}</text>
      </svg>
      <figcaption><span>{label}</span><b>{value == null ? '-' : `${Math.round(v)}%`}</b></figcaption>
    </figure>
  );
}

// one series, one hue, 0-100 %; a crosshair and tooltip on hover
function LineChart({ title, points, tf, hue }: { title: string; points: [number, number][]; tf: string; hue: string }) {
  const { lang } = useI18n();
  const W = 640, H = 170, P = { l: 34, r: 10, t: 10, b: 22 };
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const t0 = points[0][0], t1 = points[points.length - 1][0];
  const x = (t: number) => P.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - P.t - P.b);
  const path = points.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${path}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;
  const fmt = (t: number) => new Date(t * 1000).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    tf === 'hour' || tf === 'day' ? { hour: '2-digit', minute: '2-digit' } : tf === 'year' ? { year: '2-digit', month: 'short' } : { month: 'short', day: 'numeric' });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + (t1 - t0) * f);
  const avg = points.reduce((a, p) => a + p[1], 0) / points.length;
  const peak = Math.max(...points.map((p) => p[1]));
  const move = (e: React.MouseEvent) => {
    const rect = box.current?.getBoundingClientRect(); if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p[0]) - px) < Math.abs(x(points[best][0]) - px)) best = i; });
    setHover(best);
  };
  const h = hover == null ? null : points[hover];
  return (
    <figure className="cv-chart">
      <figcaption><span className="strong">{title}</span><span className="muted small">avg {avg.toFixed(1)}% · peak {peak.toFixed(1)}%</span></figcaption>
      <div className="cv-chart-box">
        <svg ref={box} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${title}, avg ${avg.toFixed(1)}%`}
          onMouseMove={move} onMouseLeave={() => setHover(null)} style={{ ['--hue' as string]: hue }}>
          {[0, 50, 100].map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="cv-grid" />
            <text x={P.l - 6} y={y(v) + 3} className="cv-axis" textAnchor="end">{v}%</text></g>)}
          {ticks.map((t, i) => <text key={i} x={x(t)} y={H - 6} className="cv-axis" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{fmt(t)}</text>)}
          <path d={area} className="cv-area" />
          <path d={path} className="cv-line" vectorEffect="non-scaling-stroke" />
          {h && <><line x1={x(h[0])} x2={x(h[0])} y1={P.t} y2={H - P.b} className="cv-cross" vectorEffect="non-scaling-stroke" />
            <circle cx={x(h[0])} cy={y(h[1])} r="4" className="cv-dot" vectorEffect="non-scaling-stroke" /></>}
        </svg>
        {h && <div className="cv-tip" style={{ left: `${(x(h[0]) / W) * 100}%` }}><b>{h[1].toFixed(1)}%</b><span>{fmt(h[0])}</span></div>}
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------------- 노드

export function ClusterNodesView() {
  return <ClusterFrame>{(c) => <Nodes key={c.id} cluster={c} />}</ClusterFrame>;
}

function Nodes({ cluster }: { cluster: Cluster }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const nodes = useLoad(useCallback(() => adminApi.nodes(cluster.id), [cluster.id]), [cluster.id]);
  const [params, setParams] = useSearchParams();
  const open = params.get('node');
  const [q, setQ] = useState('');
  const go = (n: string | null) => setParams((p) => { const x = new URLSearchParams(p); if (n) x.set('node', n); else x.delete('node'); return x; });
  return (
    <LoadState value={nodes} retry={nodes.reload}>
      {(ns) => {
        const n = open ? ns.find((x) => x.node === open) : undefined;
        if (n) return <NodeDetail cluster={cluster} node={n} reload={nodes.reload} onBack={() => go(null)} />;
        const rows = ns.filter((x) => !q.trim() || x.node.toLowerCase().includes(q.trim().toLowerCase()) || (x.ip ?? '').includes(q.trim()));
        return (
          <>
            <div className="vt-bar">
              <div className="vt-row">
                <input className="vt-name" type="search" placeholder={L('노드 이름 · IP', 'Node name · IP')} aria-label={L('노드 검색', 'Search nodes')} value={q} onChange={(e) => setQ(e.target.value)} />
                <button type="button" className="btn" onClick={nodes.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
                <span className="vt-count">{L(`온라인 ${ns.filter((x) => x.online).length} / ${ns.length}`, `${ns.filter((x) => x.online).length} / ${ns.length} online`)}</span>
                <HowTo>
                  <ul>
                    <li>{L('유지보수 · 재시작 · 종료는 노드 이름을 입력해야 실행됩니다.', 'Maintenance, restart and shut-down ask you to type the node name.')}</li>
                    <li>{L('노드 추가(클러스터 가입)는 Proxmox에서 합니다.', 'Joining a node to the cluster is done in Proxmox.')}</li>
                  </ul>
                </HowTo>
              </div>
            </div>
            <NodeTable cluster={cluster} nodes={rows} reload={nodes.reload} onOpen={(x) => go(x)} />
          </>
        );
      }}
    </LoadState>
  );
}

function NodeTable({ cluster, nodes, reload, onOpen, compact }: { cluster: Cluster; nodes: ClusterNode[]; reload: () => void; onOpen: (node: string) => void; compact?: boolean }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [dlg, setDlg] = useState<null | { node: string; kind: 'maint' | 'reboot' | 'shutdown' }>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  async function leave(n: ClusterNode) {
    if (!window.confirm(L(`${n.node}의 유지보수를 끝낼까요? 다시 VM을 받습니다.`, `End maintenance on ${n.node}? It takes VMs again.`))) return;
    try { await opsApi.setMaintenance(cluster.id, n.node, false); setNotice({ kind: 'info', text: L('유지보수를 끝냈습니다.', 'Maintenance ended.') }); reload(); }
    catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
  }
  return (
    <>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      <div className="table-scroll">
        <table className="table vt-table">
          <thead>
            <tr>
              <th>{L('노드', 'Node')}</th><th>IP</th><th>CPU</th><th>{L('메모리', 'Memory')}</th>
              {!compact && <th>{L('시스템 디스크 여유', 'System disk free')}</th>}
              <th className="num">VM</th><th>{L('가동 시간', 'Uptime')}</th><th className="vt-actions-h">{L('작업', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.node} className={n.online ? '' : 'vt-off cv-offline'}>
                <td className="nowrap">
                  <button type="button" className="vt-name-link strong" onClick={() => onOpen(n.node)}>{n.node}</button>
                  <span className={`vt-st vd-tag ${n.online ? 'vt-st-running' : 'vt-st-error'}`}>{n.online ? L('온라인', 'Online') : L('오프라인', 'Offline')}</span>
                  {n.maintenance && <span className="vt-st vt-st-offline vd-tag">{L('유지보수', 'Maintenance')}</span>}
                </td>
                <td className="nowrap vd-num">{n.ip || '—'}</td>
                <td className="vt-use">{n.online ? <Usage main={`${n.cpus}${L('코어', 'c')}`} pct={n.cpu_percent} /> : <span className="muted">— <span className="small">({n.cpus}{L('코어', 'c')})</span></span>}</td>
                <td className="vt-use">{n.online ? <Usage main={bytes(n.mem_total)} pct={n.mem_percent} /> : <span className="muted">—</span>}</td>
                {!compact && <td className="nowrap">{n.online && n.disk_total ? <>{bytes(n.disk_total - n.disk_used)}<span className="muted small"> / {bytes(n.disk_total)}</span></> : <span className="muted">—</span>}</td>}
                <td className="num nowrap">{n.online ? n.running : '—'}<span className="muted"> / {n.guests}</span></td>
                <td className="nowrap small">{n.online ? uptime(n.uptime, L) : '—'}</td>
                <td className="vt-actions">
                  <button type="button" className="vt-link" onClick={() => onOpen(n.node)}>{L('상세', 'Details')}</button>
                  <Drop className="vt-more" label={<>{L('더보기', 'More')}<Caret /></>}>
                    {(close) => (
                      <>
                        {n.maintenance
                          ? <button type="button" role="menuitem" onClick={() => { close(); void leave(n); }}>{L('유지보수 끝내기', 'End maintenance')}</button>
                          : <button type="button" role="menuitem" disabled={!n.online} onClick={() => { close(); setDlg({ node: n.node, kind: 'maint' }); }}>{L('유지보수 모드', 'Maintenance mode')}</button>}
                        <hr className="vt-sep" />
                        <button type="button" role="menuitem" disabled={!n.online} onClick={() => { close(); setDlg({ node: n.node, kind: 'reboot' }); }}>{L('재시작', 'Restart')}</button>
                        <button type="button" role="menuitem" className="danger" disabled={!n.online} onClick={() => { close(); setDlg({ node: n.node, kind: 'shutdown' }); }}>{L('종료', 'Shut down')}</button>
                      </>
                    )}
                  </Drop>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dlg?.kind === 'maint' && <MaintenanceDialog cluster={cluster} node={dlg.node} onClose={() => setDlg(null)} onDone={() => { setDlg(null); reload(); }} />}
      {(dlg?.kind === 'reboot' || dlg?.kind === 'shutdown') && <PowerDialog cluster={cluster} node={dlg.node} action={dlg.kind} onClose={() => setDlg(null)}
        onDone={(text) => { setDlg(null); setNotice({ kind: 'info', text }); reload(); }} />}
    </>
  );
}

type NTab = 'overview' | 'vms' | 'storage' | 'network' | 'tasks';

function NodeDetail({ cluster, node: n, reload, onBack }: { cluster: Cluster; node: ClusterNode; reload: () => void; onBack: () => void }) {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [tab, setTab] = useState<NTab>('overview');
  const guests = useLoad(useCallback(() => adminApi.guests(cluster.id), [cluster.id]), [cluster.id]);
  const storage = useLoad(useCallback(() => adminApi.storage(cluster.id), [cluster.id]), [cluster.id]);
  const nets = useLoad(useCallback(() => buildApi.networks(cluster.id, n.node), [cluster.id, n.node]), [cluster.id, n.node]);
  const tasks = useLoad(useCallback(() => opsApi.nodeTasks(cluster.id, n.node), [cluster.id, n.node]), [cluster.id, n.node]);
  const mine = useMemo(() => (guests.state === 'ok' ? guests.data.filter((g) => g.node === n.node) : []), [guests, n.node]);
  const tabs: [NTab, string][] = [['overview', L('개요', 'Overview')], ['vms', 'VM'], ['storage', L('스토리지', 'Storage')], ['network', L('네트워크', 'Network')], ['tasks', L('작업', 'Tasks')]];
  const time = (s: number | null) => (s ? new Date(s * 1000).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '-');
  return (
    <div className="vd">
      <button type="button" className="vd-back" onClick={onBack}><Icon name="chevron" size={14} />{L('노드 목록', 'Nodes')}</button>
      <section className="vd-head">
        <div className="vd-title">
          <span className="vd-icon" aria-hidden="true"><Icon name="cluster" size={20} /></span>
          <h2 className="vd-name">{n.node}</h2>
          <span className={`vt-st ${n.online ? 'vt-st-running' : 'vt-st-error'}`}>{n.online ? L('온라인', 'Online') : L('오프라인', 'Offline')}</span>
          {n.maintenance && <span className="vt-st vt-st-offline">{L('유지보수', 'Maintenance')}</span>}
        </div>
        <dl className="vd-strip">
          <div><dt>IP</dt><dd className="vd-num">{n.ip || '—'}</dd></div>
          <div><dt>{L('아키텍처', 'Architecture')}</dt><dd>{archOf(n.cpu_model) || '—'}</dd></div>
          <div><dt>{L('가동 시간', 'Uptime')}</dt><dd>{n.online ? uptime(n.uptime, L) : '—'}</dd></div>
          <div><dt>VM</dt><dd className="vd-num">{n.online ? n.running : '—'} / {n.guests}</dd></div>
          <div className="vd-wide"><dt>CPU</dt><dd>{n.online ? <Usage main={`${n.cpus}${L('코어', 'c')}`} pct={n.cpu_percent} /> : '—'}</dd></div>
          <div className="vd-wide"><dt>{L('메모리', 'Memory')}</dt><dd>{n.online ? <Usage main={bytes(n.mem_total)} pct={n.mem_percent} /> : '—'}</dd></div>
        </dl>
      </section>
      <nav className="page-tabs vd-tabs" role="tablist">
        {tabs.map(([id, label]) => <a key={id} href="#" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={(e) => { e.preventDefault(); setTab(id); }}>{label}</a>)}
      </nav>
      <div className="vd-body">
        {tab === 'overview' && (
          <section className="vd-card">
            <header><h3>{L('개요', 'Overview')}</h3></header>
            <dl className="vd-kv">
              <dt>CPU</dt><dd>{n.cpu_model || '-'}</dd>
              <dt>{L('버전', 'Version')}</dt><dd>{n.version.replace('pve-manager/', 'PVE ') || '-'}</dd>
              <dt>{L('부하', 'Load')}</dt><dd>{n.loadavg.length ? n.loadavg.join(' · ') : '—'}</dd>
              <dt>{L('시스템 디스크', 'System disk')}</dt><dd>{n.disk_total ? `${bytes(n.disk_used)} / ${bytes(n.disk_total)}` : '—'}</dd>
              <dt>{L('할당', 'Given to guests')}</dt><dd>{n.vcpus_given !== undefined ? `${n.vcpus_given} vCPU · ${bytes(n.mem_given ?? 0)}` : '-'}</dd>
              <dt>{L('데스크톱', 'Desktops')}</dt><dd>{n.desktops}</dd>
            </dl>
          </section>
        )}
        {tab === 'vms' && (
          <section className="vd-card">
            <LoadState value={guests} retry={guests.reload}>
              {() => mine.length === 0 ? <p className="muted small">{L('VM이 없습니다.', 'No VMs.')}</p> : (
                <table className="table vt-table">
                  <thead><tr><th>VMID</th><th>{L('이름', 'Name')}</th><th>{L('종류', 'Type')}</th><th>{L('상태', 'State')}</th><th /></tr></thead>
                  <tbody>{mine.map((g) => (
                    <tr key={g.vmid}>
                      <td className="vd-num">{g.vmid}</td><td>{g.name}</td><td className="small">{g.type === 'qemu' ? 'VM' : 'LXC'}</td>
                      <td><span className={`vt-st ${g.status === 'running' ? 'vt-st-running' : ''}`}>{g.status === 'running' ? L('실행 중', 'Running') : g.status === 'stopped' ? L('꺼짐', 'Stopped') : g.status}</span></td>
                      <td className="vt-actions">{g.desktop_id && <Link className="vt-link" to={`/admin/vms/desktops/list?vm=${encodeURIComponent(g.desktop_id)}`}>{L('관리', 'Manage')}</Link>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </LoadState>
          </section>
        )}
        {tab === 'storage' && (
          <section className="vd-card">
            <LoadState value={storage} retry={storage.reload}>
              {(list) => {
                const rows = list.filter((s) => s.shared || s.nodes.includes(n.node));
                return rows.length === 0 ? <p className="muted small">-</p> : (
                  <table className="table vt-table">
                    <thead><tr><th>{L('스토리지', 'Storage')}</th><th>{L('종류', 'Type')}</th><th>{L('내용', 'Content')}</th><th>{L('사용', 'Used')}</th></tr></thead>
                    <tbody>{rows.map((s) => (
                      <tr key={s.storage}>
                        <td className="nowrap strong">{s.storage}{s.shared && <span className="vt-st vd-tag">{L('공유', 'Shared')}</span>}</td>
                        <td className="small">{s.type}</td><td className="small">{s.content.join(', ')}</td>
                        <td className="vt-use">{s.total ? <Usage main={bytes(s.total)} pct={pct(s.used, s.total)} /> : '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                );
              }}
            </LoadState>
          </section>
        )}
        {tab === 'network' && (
          <section className="vd-card">
            <LoadState value={nets} retry={nets.reload}>
              {(list) => list.length === 0 ? <p className="muted small">-</p> : (
                <table className="table vt-table">
                  <thead><tr><th>{L('인터페이스', 'Interface')}</th><th>{L('종류', 'Type')}</th><th>CIDR</th><th>VLAN</th><th>{L('설명', 'Comment')}</th></tr></thead>
                  <tbody>{list.map((x) => (
                    <tr key={x.iface}><td className="strong">{x.iface}</td><td className="small">{x.type}</td><td className="vd-num">{x.cidr || '—'}</td>
                      <td className="small">{x.vlan_aware ? L('VLAN 인식', 'VLAN aware') : '-'}</td><td className="small">{x.comments || '-'}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </LoadState>
          </section>
        )}
        {tab === 'tasks' && (
          <section className="vd-card">
            <LoadState value={tasks} retry={tasks.reload}>
              {(list) => list.length === 0 ? <p className="muted small">{L('최근 작업이 없습니다.', 'No recent tasks.')}</p> : (
                <table className="table vt-table">
                  <thead><tr><th>{L('시작', 'Started')}</th><th>{L('작업', 'Task')}</th><th>VMID</th><th>{L('사용자', 'User')}</th><th>{L('결과', 'Result')}</th></tr></thead>
                  <tbody>{list.slice(0, 30).map((t) => (
                    <tr key={t.upid}>
                      <td className="nowrap muted small">{time(t.starttime)}</td><td><code className="code">{t.type}</code></td><td>{t.vmid ?? '-'}</td><td className="small">{t.user}</td>
                      <td>{t.running ? <span className="vt-st vt-st-in_use">{L('진행 중', 'Running')}</span> : <span className={`vt-st ${t.ok ? 'vt-st-running' : 'vt-st-error'}`} title={t.status}>{t.ok ? 'OK' : L('실패', 'Failed')}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </LoadState>
          </section>
        )}
      </div>
      <NodeTableActionsHint onReload={reload} />
    </div>
  );
}

function NodeTableActionsHint({ onReload }: { onReload: () => void }) {
  const { pick } = useI18n();
  return <p className="muted small"><button type="button" className="vt-link" onClick={onReload}>{pick({ ko: '새로 고침', en: 'Refresh' })}</button>
    {pick({ ko: ' · 유지보수 · 재시작 · 종료는 노드 목록의 더보기에서 합니다.', en: ' · Maintenance, restart and shut-down are under More in the node list.' })}</p>;
}
