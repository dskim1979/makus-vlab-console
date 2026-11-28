import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { Cluster, NetRule, PoolPolicy } from '../../api/types';
import { netisoApi } from '../../api/netiso';
import { netmapApi } from '../../api/netmap';
import type { Finding, FindingCode, FindingLevel, MapPool, MapRule, MapVm, NetMap } from '../../api/netmap';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { ClusterFrame } from './ClusterPages';
import { ReachBadge, RuleList } from './PoolNetIso';
import { useL } from './OpsPages';

// 클러스터 > 네트워크 구성도: how the cluster's desktops are networked at one look - the way in
// (users -> MOAVI gateway -> datacenter firewall), each segment with the pools on it, each pool's
// open ports and desktops, and what is set up wrong (pegaprox/api/vlab_netmap.py). The rules of every
// pool are edited here too (마이크로 세그먼트: addresses or other pools, allow or drop) - saved into
// the pool's policy and applied at once.

type Lx = (ko: string, en: string) => string;

const MSG: Record<FindingCode, [string, string]> = {
  dc_firewall_off: ['데이터센터 방화벽이 꺼져 있어 격리 규칙이 아무것도 막지 않습니다. Proxmox 데이터센터 › 방화벽 › 옵션에서 켜세요.',
    'The datacenter firewall is off, so no isolation rule filters anything. Turn it on under Datacenter › Firewall › Options.'],
  no_gateway: ['게이트웨이 주소가 없어 격리를 적용하지 못했습니다. 네트워크 격리 설정에 MOAVI 서버 주소를 넣으세요.',
    'No gateway address, so isolation was not applied. Enter the MOAVI server address in the isolation settings.'],
  rules_missing: ['풀의 방화벽 그룹이 Proxmox에 없습니다. 풀의 네트워크 격리에서 지금 적용하세요.', 'The pool\'s firewall group is missing in Proxmox. Apply it from the pool\'s isolation panel.'],
  rules_differ: ['Proxmox의 방화벽 그룹 규칙이 정책과 다릅니다(직접 고친 것일 수 있음). 지금 적용하면 정책대로 돌아갑니다.',
    'The firewall group in Proxmox differs from the policy (edited by hand?). Apply now to restore it.'],
  vm_firewall_off: ['방화벽이 꺼졌거나 들어오는 기본 정책이 DROP이 아닌 데스크톱이 있습니다.', 'Some desktops have their firewall off, or inbound policy not DROP.'],
  gateway_unreachable: ['MOAVI 서버에서 이 망의 게이트웨이로 닿지 않습니다. 사용자가 접속할 수 없습니다. 라우터에 경로를 넣으세요.',
    'The MOAVI server cannot reach this network\'s gateway, so users cannot connect. Add a route on the router.'],
  sdn_node_problem: ['일부 노드에 망이 만들어지지 않았습니다. 네트워크 분리 › 노드 점검을 보세요.', 'Some nodes did not build the network. See Network segments › Check nodes.'],
  dc_firewall_unknown: ['데이터센터 방화벽 상태를 읽지 못했습니다.', 'The datacenter firewall state could not be read.'],
  pool_not_isolated: ['격리가 꺼져 있어 같은 망의 어느 PC에서든 데스크톱에 바로 접속할 수 있습니다.', 'Isolation is off: any PC on the network can reach the desktops directly.'],
  pool_on_management: ['데스크톱이 노드 관리망 브리지에 붙어 있습니다. 관리망과 섞여 있습니다.', 'Desktops sit on the nodes\' management bridge, mixed with management traffic.'],
  segment_without_isolation: ['망은 나뉘었지만 격리가 꺼져 있어, 라우팅되는 다른 망에서 들어올 수 있습니다.', 'The network is separate but isolation is off: routed networks can still get in.'],
  allow_in_wide: ['너무 넓은 범위에서 들어오는 것을 허용합니다.', 'Inbound is allowed from a very wide range.'],
  segment_pending: ['아직 망으로 옮기지 않은 데스크톱이 있습니다.', 'Some desktops are not on the network yet.'],
  pool_problem: ['적용 중 문제가 있었습니다.', 'Applying ran into a problem.'],
  egress_open: ['나가는 통신은 모두 허용됩니다.', 'All outbound traffic is allowed.'],
  peers_open: ['같은 풀 데스크톱끼리 통신할 수 있습니다.', 'Desktops of the pool can reach each other.'],
  segment_shared: ['여러 풀이 같은 망을 씁니다. 풀 사이는 방화벽으로만 나뉩니다.', 'Several pools share this network; only the firewall separates them.'],
  segment_unused: ['쓰는 풀이 없는 망입니다.', 'No pool uses this network.'],
  peer_out_missing: ['상대 풀이 들여보내 주는데 이 풀의 나감 목록에 그 풀이 없어 실제로는 통신이 안 됩니다. 나감 규칙에 그 풀을 넣으세요.',
    'The other pool lets this one in, but this pool\'s outbound list does not include it, so the traffic never leaves. Add that pool to the outbound rules.'],
  rule_pool_missing: ['규칙이 가리키는 풀이 없습니다(삭제됨). 그 규칙은 적용되지 않습니다.', 'A rule names a pool that is gone; it is not applied.'],
};
const LEVEL: Record<FindingLevel, { ko: string; en: string; cls: string }> = {
  critical: { ko: '심각', en: 'Critical', cls: 'nm-crit' },
  warning: { ko: '주의', en: 'Warning', cls: 'nm-warn' },
  info: { ko: '참고', en: 'Info', cls: 'nm-info' },
};
const worst = (fs: Finding[]): FindingLevel | '' => (fs.some((f) => f.level === 'critical') ? 'critical' : fs.some((f) => f.level === 'warning') ? 'warning' : '');

// pool names for rules that name another pool, and the rule editor's opener
const MapCtx = createContext<{ names: Record<string, string>; edit: (poolId: string) => void }>({ names: {}, edit: () => {} });

function ruleText(r: MapRule, L: Lx, names: Record<string, string> = {}) {
  const peer = r.peer === 'gateway' ? L('MOAVI 게이트웨이', 'MOAVI gateway') : r.peer === 'pool' ? L('같은 풀', 'Same pool')
    : r.peer === 'pool_other' ? `${L('풀', 'Pool')} ${names[r.pool ?? ''] ?? r.pool}` : r.peer === 'any' ? L('어디든', 'Anywhere') : r.cidr;
  const port = r.proto === 'any' ? L('모든 포트', 'all ports') : `${r.proto.toUpperCase()}${r.port ? ` ${r.port}` : ''}`;
  return { peer, port };
}

function Rules({ p }: { p: MapPool }) {
  const { L } = useL();
  const { names } = useContext(MapCtx);
  if (!p.isolation) return <div className="nm-rules"><span className="nm-open">{L('들어옴·나감 모두 열림', 'Everything open')}</span></div>;
  const inR = p.rules.filter((r) => r.dir === 'in');
  const outR = p.rules.filter((r) => r.dir === 'out');
  const row = (r: MapRule, i: number) => {
    const t = ruleText(r, L, names);
    const cls = r.action === 'drop' ? 'nm-rule-drop' : r.peer === 'pool_other' ? 'nm-rule-pool' : r.peer === 'cidr' ? 'nm-rule-extra' : '';
    return <li key={i} className={cls} title={(r.peer === 'cidr' || r.peer === 'pool_other') && r.note ? r.note : undefined}>
      <span className="nm-peer">{r.action === 'drop' ? `${L('차단', 'Drop')} · ` : ''}{t.peer}</span><span className="mono">{t.port}</span></li>;
  };
  return (
    <div className="nm-rules">
      <div><span className="nm-dir">{L('들어옴', 'In')} ←</span><ul>{inR.map(row)}</ul><span className="muted small">{L('나머지 차단', 'Rest dropped')}</span></div>
      <div><span className="nm-dir">{L('나감', 'Out')} →</span><ul>{outR.map(row)}</ul>{p.egress === 'list' && <span className="muted small">{L('나머지 차단', 'Rest dropped')}</span>}</div>
    </div>
  );
}

const VM_SHOWN = 8;

function VmChip({ v, p }: { v: MapVm; p: MapPool }) {
  const { L } = useL();
  const on = v.status === 'running';
  const fwBad = p.isolation && v.read && (v.nic_fw === false || v.vm_fw === false || (v.vm_fw && v.policy_in !== 'DROP'));
  const tip = [`${v.name} (#${v.vmid}) · ${v.node}`, v.ips?.length ? v.ips.join(', ') : '', v.bridge ?? '',
    p.isolation ? (fwBad ? L('방화벽 꺼짐', 'Firewall off') : L('방화벽 켜짐', 'Firewall on')) : ''].filter(Boolean).join('\n');
  return (
    <span className={`nm-vm${on ? '' : ' nm-vm-off'}${fwBad ? ' nm-vm-bad' : ''}`} title={tip}>
      <span className={`nm-vm-dot${on ? ' on' : ''}`} aria-hidden />
      <span className="nm-vm-name">{v.name}</span>
      {v.ips?.[0] && <span className="mono nm-vm-ip">{v.ips[0]}</span>}
      {p.isolation && <Icon name="shield" size={11} />}
    </span>
  );
}

function PoolCard({ p, m, fs, hot, onPick }: { p: MapPool; m: NetMap; fs: Finding[]; hot: boolean; onPick: () => void }) {
  const { L } = useL();
  const { edit } = useContext(MapCtx);
  const [all, setAll] = useState(false);
  const w = worst(fs);
  const mgmt = p.bridges.filter((b) => m.bridges.find((x) => x.name === b)?.addressed.length);
  const d = p.desktops;
  const vms = p.vms ?? [];
  return (
    <div id={`nm-pool-${p.id}`} role="button" tabIndex={0} className={`nm-pool${w ? ` nm-b-${w}` : ''}${hot ? ' nm-hot' : ''}`}
      onClick={onPick} onKeyDown={(e) => { if (e.key === 'Enter') onPick(); }}>
      <div className="nm-pool-head">
        <span className="strong">{p.name}</span>
        {p.isolation
          ? <span className="nm-tag nm-tag-ok"><Icon name="shield" size={13} />{L('격리', 'Isolated')}</span>
          : <span className="nm-tag nm-tag-bad"><Icon name="shield" size={13} />{L('격리 꺼짐', 'Not isolated')}</span>}
        {w && <span className={`nm-dot ${LEVEL[w].cls}`} aria-label={L(LEVEL[w].ko, LEVEL[w].en)}>{fs.filter((f) => f.level === w).length}</span>}
        <button type="button" className="btn-ghost small nm-edit" onClick={(e) => { e.stopPropagation(); edit(p.id); }}>
          <Icon name="gear" size={13} />{L('규칙', 'Rules')}</button>
      </div>
      <Rules p={p} />
      {vms.length > 0 && (
        <div className="nm-vms" onClick={(e) => e.stopPropagation()}>
          {(all ? vms : vms.slice(0, VM_SHOWN)).map((v) => <VmChip key={v.id} v={v} p={p} />)}
          {vms.length > VM_SHOWN && <button type="button" className="btn-ghost small" onClick={() => setAll(!all)}>
            {all ? L('접기', 'Less') : L(`+${vms.length - VM_SHOWN}대`, `+${vms.length - VM_SHOWN}`)}</button>}
        </div>
      )}
      <div className="nm-pool-foot muted small">
        <span>{L(`데스크톱 ${d.total}대`, `${d.total} desktops`)}</span>
        {p.isolation && <span className={d.fw_off ? 'warn-text' : ''}>{L(`방화벽 ${d.read - d.fw_off}/${d.read}`, `Firewall ${d.read - d.fw_off}/${d.read}`)}</span>}
        {p.segment && <span className={d.on_segment < d.total ? 'warn-text' : ''}>{L(`망 ${d.on_segment}/${d.total}`, `On network ${d.on_segment}/${d.total}`)}</span>}
        {p.isolation && p.live !== 'match' && <span className="warn-text">{p.live === 'differ' ? L('규칙 다름', 'Rules differ') : p.live === 'missing' ? L('규칙 없음', 'No rules') : L('규칙 확인 불가', 'Rules unknown')}</span>}
        {mgmt.length > 0 && <span className="warn-text">{L(`관리망 ${mgmt.join(', ')}`, `Management ${mgmt.join(', ')}`)}</span>}
      </div>
    </div>
  );
}

function Diagram({ m, byPool, bySeg, hot, setHot }: {
  m: NetMap; byPool: Record<string, Finding[]>; bySeg: Record<string, Finding[]>; hot: string; setHot: (k: string) => void;
}) {
  const { L } = useL();
  const fw = m.cluster_firewall;
  const anyIso = m.pools.some((p) => p.isolation);
  const lanes = [
    ...m.segments.map((s) => ({ key: `seg:${s.id}`, seg: s, pools: m.pools.filter((p) => p.segment === s.id) })),
    { key: 'own', seg: null, pools: m.pools.filter((p) => !p.segment || !m.segments.some((s) => s.id === p.segment)) },
  ].filter((l) => l.seg || l.pools.length);
  const ownBridges = Array.from(new Set(lanes.find((l) => !l.seg)?.pools.flatMap((p) => p.bridges) ?? []));
  return (
    <div className="nm-diagram">
      <div className="nm-entry">
        <div className="nm-node nm-users"><Icon name="users" size={18} /><span className="strong">{L('사용자 PC', 'User PCs')}</span>
          <span className="muted small">{L('포털·클라이언트', 'Portal, client')}</span></div>
        <div className="nm-arrow" aria-hidden>↓</div>
        <div className={`nm-node${m.gateway.sources.length ? '' : ' nm-b-critical'}`}>
          <Icon name="globe" size={18} /><span className="strong">{L('MOAVI 게이트웨이', 'MOAVI gateway')}</span>
          <span className="muted small">rdpgw · Warpgate</span>
          {m.gateway.sources.length ? m.gateway.sources.map((s) => <span key={s} className="mono small">{s}</span>)
            : <span className="warn-text small">{L('주소 없음', 'No address')}</span>}
        </div>
        <div className="nm-arrow" aria-hidden>↓</div>
        <div className={`nm-node${anyIso && fw && !fw.enable ? ' nm-b-critical' : ''}`}>
          <Icon name="shield" size={18} /><span className="strong">{L('데이터센터 방화벽', 'Datacenter firewall')}</span>
          {fw ? (fw.enable ? <span className="vt-st vt-st-running">{L('켜짐', 'On')}</span> : <span className="vt-st vt-st-error">{L('꺼짐', 'Off')}</span>)
            : <span className="muted small">{L('알 수 없음', 'Unknown')}</span>}
        </div>
        {m.zone && <>
          <div className="nm-arrow" aria-hidden>↓</div>
          <div className={`nm-node${m.sdn.node_problem ? ' nm-b-critical' : ''}`}>
            <Icon name="link" size={18} /><span className="strong">{L('SDN 영역', 'SDN zone')} {m.zone.zone}</span>
            <span className="muted small">{m.zone.type.toUpperCase()}{m.zone.bridge ? ` · ${m.zone.bridge}` : ''}</span>
            <span className="nm-nodes">{Object.entries(m.sdn.nodes).map(([n, st]) => (
              <span key={n} className={`vt-st ${st === 'available' ? 'vt-st-running' : 'vt-st-error'}`}>{n}</span>))}</span>
          </div>
        </>}
      </div>
      <div className="nm-lanes">
        {lanes.map((l) => {
          const fs = l.seg ? bySeg[l.seg.id] ?? [] : [];
          const w = worst(fs);
          const s = l.seg;
          return (
            <div key={l.key} className="nm-lane">
              <button type="button" id={s ? `nm-seg-${s.id}` : undefined}
                className={`nm-seg${s ? '' : ' nm-seg-own'}${w ? ` nm-b-${w}` : ''}${hot === l.key ? ' nm-hot' : ''}`}
                onClick={() => setHot(l.key)}>
                {s ? <>
                  <span className="strong">{s.name}</span>
                  <span className="mono small">{s.tag ? `VLAN ${s.tag} · ` : ''}{s.subnet}</span>
                  <span className="small">{L('게이트웨이', 'Gateway')} <span className="mono">{s.gateway}</span></span>
                  <span className="small">{L('MOAVI에서', 'From MOAVI')} <ReachBadge r={s.gateway_reach ?? ''} /></span>
                </> : <>
                  <span className="strong">{L('분리 안 함', 'Not separated')}</span>
                  <span className="muted small">{L('VM 자체 브리지', 'The VM\'s own bridge')}</span>
                  {ownBridges.map((b) => {
                    const br = m.bridges.find((x) => x.name === b);
                    return <span key={b} className={`mono small${br?.addressed.length ? ' warn-text' : ''}`}>{b}{br?.addressed.length ? L(' (관리망)', ' (management)') : ''}</span>;
                  })}
                </>}
              </button>
              <div className={`nm-wire${w === 'critical' ? ' nm-wire-bad' : ''}`} aria-hidden />
              <div className="nm-pools">
                {l.pools.length ? l.pools.map((p) => (
                  <PoolCard key={p.id} p={p} m={m} fs={byPool[p.id] ?? []} hot={hot === `pool:${p.id}`} onPick={() => setHot(`pool:${p.id}`)} />
                )) : <span className="muted small nm-empty">{L('쓰는 풀 없음', 'No pool')}</span>}
              </div>
            </div>
          );
        })}
        {!lanes.length && <p className="muted">{L('이 클러스터에 풀이 없습니다.', 'No pools on this cluster.')}</p>}
      </div>
    </div>
  );
}

function RuleTable({ m }: { m: NetMap }) {
  const { L } = useL();
  const { names, edit } = useContext(MapCtx);
  const seg = (id: string) => m.segments.find((s) => s.id === id);
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead><tr><th>{L('풀', 'Pool')}</th><th>{L('망', 'Network')}</th><th>{L('방향', 'Direction')}</th><th>{L('동작', 'Action')}</th><th>{L('상대', 'Peer')}</th>
          <th>{L('포트', 'Ports')}</th><th>{L('메모', 'Note')}</th></tr></thead>
        <tbody>{m.pools.flatMap((p) => {
          const net = seg(p.segment);
          const netText = net ? `${net.name} · ${net.subnet}` : p.bridges.join(', ') || '-';
          if (!p.isolation) {
            return [<tr key={p.id}><td className="strong">{p.name} <button type="button" className="btn-ghost small" onClick={() => edit(p.id)}>{L('편집', 'Edit')}</button></td>
              <td className="mono">{netText}</td>
              <td colSpan={5}><span className="nm-open">{L('격리 꺼짐 — 들어옴·나감 모두 열림', 'Not isolated - everything open')}</span></td></tr>];
          }
          return p.rules.map((r, i) => {
            const t = ruleText(r, L, names);
            return (
              <tr key={`${p.id}-${i}`}>
                <td className="strong">{i === 0 ? <>{p.name} <button type="button" className="btn-ghost small" onClick={() => edit(p.id)}>{L('편집', 'Edit')}</button></> : ''}</td>
                <td className="mono">{i === 0 ? netText : ''}</td>
                <td className="nowrap">{r.dir === 'in' ? L('들어옴 ←', 'In ←') : L('나감 →', 'Out →')}</td>
                <td>{r.action === 'drop' ? <span className="vt-st vt-st-error">{L('차단', 'Drop')}</span> : <span className="vt-st vt-st-running">{L('허용', 'Allow')}</span>}</td>
                <td className={r.peer === 'cidr' || r.peer === 'any' ? 'mono' : r.peer === 'pool_other' ? 'strong' : ''}>{t.peer}</td><td className="mono">{t.port}</td>
                <td className="muted">{r.peer === 'cidr' || r.peer === 'pool_other' ? r.note : ''}</td>
              </tr>
            );
          });
        })}</tbody>
      </table>
      <p className="muted small">{L('격리된 풀은 표에 없는 들어오는 통신을 모두 막습니다. 차단 규칙은 허용 규칙보다 먼저 적용됩니다(게이트웨이 접속은 막지 않습니다).',
        'Isolated pools drop all inbound traffic not listed. Drop rules go before the allows (the gateway is never dropped).')}</p>
    </div>
  );
}

// 풀 간 통신: who may reach whom (from the rows' pool to the columns' pool), as the rules say
function PoolMatrix({ m }: { m: NetMap }) {
  const { L } = useL();
  const { names, edit } = useContext(MapCtx);
  const ports = (r: MapRule) => (r.proto === 'any' ? L('전체', 'all') : `${r.proto.toUpperCase()}${r.port ? ` ${r.port}` : ''}`);
  // from -> to: what `to` lets in from `from` (and whether `from` may send it)
  const cell = (from: MapPool, to: MapPool) => {
    if (!to.isolation) return { text: L('열림', 'Open'), cls: 'nm-mx-open' };
    if (from.id === to.id) {
      const peer = to.rules.some((r) => r.dir === 'in' && r.peer === 'pool');
      return peer ? { text: L('허용', 'Allowed'), cls: 'nm-mx-ok' } : { text: L('차단', 'Blocked'), cls: 'nm-mx-no' };
    }
    const ins = to.rules.filter((r) => r.dir === 'in' && r.peer === 'pool_other' && r.pool === from.id);
    const drop = ins.filter((r) => r.action === 'drop');
    const ok = ins.filter((r) => r.action !== 'drop');
    if (!ok.length) return { text: drop.length ? L('차단', 'Blocked') : '—', cls: 'nm-mx-no' };
    const out = !from.isolation || from.egress !== 'list' || from.rules.some((r) => r.dir === 'out' && r.action !== 'drop' && r.pool === to.id);
    return { text: ok.map(ports).join(', ') + (out ? '' : L(' (나감 막힘)', ' (out blocked)')), cls: out ? 'nm-mx-ok' : 'nm-mx-warn' };
  };
  if (!m.pools.length) return <p className="muted">{L('풀이 없습니다.', 'No pools.')}</p>;
  return (
    <div className="table-wrap">
      <table className="table compact nm-matrix">
        <thead><tr><th>{L('보내는 풀 ↓ · 받는 풀 →', 'From ↓ · to →')}</th>{m.pools.map((p) => <th key={p.id}>{p.name}</th>)}</tr></thead>
        <tbody>{m.pools.map((from) => (
          <tr key={from.id}>
            <th scope="row">{from.name}</th>
            {m.pools.map((to) => {
              const c = cell(from, to);
              return <td key={to.id} className={c.cls}><button type="button" className="nm-mx-btn" onClick={() => edit(to.id)}
                title={L(`${names[to.id]}의 들어오는 규칙 편집`, `Edit ${names[to.id]}'s inbound rules`)}>{c.text}</button></td>;
            })}
          </tr>
        ))}</tbody>
      </table>
      <p className="muted small">{L('칸을 누르면 받는 풀의 규칙을 고칩니다. "열림"은 격리가 꺼진 풀이라 누구나 들어올 수 있다는 뜻입니다.',
        'Click a cell to edit the receiving pool\'s rules. "Open" means that pool is not isolated: anyone gets in.')}</p>
    </div>
  );
}

type Draft = Pick<PoolPolicy, 'net_isolation' | 'net_peers' | 'net_allow_in' | 'net_egress' | 'net_allow_out'>;

// one pool's rules, saved into its policy and applied at once
function RuleEditor({ m, poolId, onClose, onSaved }: { m: NetMap; poolId: string; onClose: () => void; onSaved: () => void }) {
  const { L } = useL();
  const pool = m.pools.find((p) => p.id === poolId);
  const [full, setFull] = useState<PoolPolicy | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    adminApi.poolPolicy(poolId).then((a) => {
      if (!live) return;
      setFull(a.policy);
      setD({ net_isolation: a.policy.net_isolation, net_peers: a.policy.net_peers, net_allow_in: a.policy.net_allow_in ?? [],
        net_egress: a.policy.net_egress ?? 'any', net_allow_out: a.policy.net_allow_out ?? [] });
    }).catch((e) => setError((e as Error).message));
    return () => { live = false; };
  }, [poolId]);
  const others = m.pools.filter((p) => p.id !== poolId).map((p) => ({ id: p.id, name: p.name }));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((o) => (o ? { ...o, [k]: v } : o));
  const save = async () => {
    if (!full || !d) return;
    setBusy(true); setError(null);
    try {
      await adminApi.savePoolPolicy(poolId, { ...full, ...d });
      if (d.net_isolation || full.net_isolation) await netisoApi.apply(poolId);
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open title={L(`${pool?.name ?? ''} 규칙`, `${pool?.name ?? ''} rules`)} onClose={onClose} onSubmit={d ? save : undefined}
      submitLabel={L('저장하고 적용', 'Save and apply')} busy={busy} error={error} wide>
      {!d ? <p className="muted">{L('불러오는 중…', 'Loading…')}</p> : (
        <div className="nm-editor">
          <label className="check"><input type="checkbox" checked={!!d.net_isolation} onChange={(e) => set('net_isolation', e.target.checked)} />
            <span className="strong">{L('네트워크 격리', 'Network isolation')}</span></label>
          {!d.net_isolation && <div className="alert small">{L('격리를 켜야 아래 규칙이 적용됩니다. 꺼져 있으면 누구나 들어올 수 있습니다.',
            'Turn isolation on for these rules to apply; off, anyone gets in.')}</div>}
          <label className="check"><input type="checkbox" checked={!!d.net_peers} onChange={(e) => set('net_peers', e.target.checked)} />
            <span>{L('같은 풀 데스크톱끼리 통신 허용', 'Desktops of this pool may reach each other')}</span></label>
          <span className="field-label">{L('들어오는 규칙', 'Inbound rules')}</span>
          <small className="muted">{L('MOAVI 게이트웨이는 항상 허용되고, 여기 없는 들어오는 통신은 막힙니다.', 'The MOAVI gateway is always let in; anything else not listed is dropped.')}</small>
          <RuleList list={d.net_allow_in ?? []} onChange={(l: NetRule[]) => set('net_allow_in', l)} placeholder="10.10.0.0/24" pools={others} />
          <span className="field-label">{L('나가는 통신', 'Outbound')}</span>
          <div className="mode-cards mode-cards-2" role="radiogroup" aria-label={L('나가는 통신', 'Outbound')}>
            {([['any', L('모두 허용', 'Allow all')], ['list', L('목록만 허용', 'Only the list')]] as const).map(([v, t]) => (
              <label key={v} className={`mode-card${d.net_egress === v ? ' on' : ''}`}>
                <input type="radio" name="nm-egress" checked={d.net_egress === v} onChange={() => set('net_egress', v)} /><span className="strong">{t}</span>
              </label>
            ))}
          </div>
          <small className="muted">{d.net_egress === 'list'
            ? L('게이트웨이와 아래 목록으로만 나갑니다. 다른 풀과 통신하려면 그 풀도 여기 넣으세요.', 'Only to the gateway and the list. To reach another pool, list it here too.')
            : L('모두 허용일 때는 차단 규칙만 쓸모가 있습니다(예: TCP 25 차단).', 'With allow all only drop rules matter (e.g. drop TCP 25).')}</small>
          <RuleList list={d.net_allow_out ?? []} onChange={(l: NetRule[]) => set('net_allow_out', l)} placeholder="10.0.0.53" pools={others} />
        </div>
      )}
    </Dialog>
  );
}

function NetMapBody({ c }: { c: Cluster }) {
  const [checks, setChecks] = useState(0);         // 다시 점검 / a saved rule: read Proxmox again, not the minute's copy
  const st = useLoad(useCallback(() => netmapApi.map(c.id, checks > 0), [c.id, checks]), [c.id, checks]);
  const [view, setView] = useState<View>('map');
  const [hot, setHot] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  return (
    <LoadState value={st} retry={st.reload}>
      {(m) => <NetMapView m={m} reload={() => setChecks((x) => x + 1)} view={view} setView={setView} hot={hot} setHot={setHot} showInfo={showInfo} setShowInfo={setShowInfo} />}
    </LoadState>
  );
}

type View = 'map' | 'rules' | 'matrix';

function NetMapView({ m, reload, view, setView, hot, setHot, showInfo, setShowInfo }: {
  m: NetMap; reload: () => void; view: View; setView: (v: View) => void;
  hot: string; setHot: (k: string) => void; showInfo: boolean; setShowInfo: (v: boolean) => void;
}) {
  const { L } = useL();
  const { byPool, bySeg } = useMemo(() => {
    const p: Record<string, Finding[]> = {}, s: Record<string, Finding[]> = {};
    for (const f of m.findings) {
      if (f.pool) (p[f.pool] ??= []).push(f);
      if (f.segment && !f.pool) (s[f.segment] ??= []).push(f);
    }
    return { byPool: p, bySeg: s };
  }, [m.findings]);
  const n = (l: FindingLevel) => m.findings.filter((f) => f.level === l).length;
  const target = (f: Finding) => (f.pool ? m.pools.find((p) => p.id === f.pool)?.name : f.segment ? m.segments.find((s) => s.id === f.segment)?.name : '') || '';
  const shown = m.findings.filter((f) => showInfo || f.level !== 'info');
  const pick = (f: Finding) => {
    const key = f.pool ? `pool:${f.pool}` : f.segment ? `seg:${f.segment}` : '';
    setHot(key);
    setView('map');
    const el = document.getElementById(f.pool ? `nm-pool-${f.pool}` : `nm-seg-${f.segment}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const isolated = m.pools.filter((p) => p.isolation).length;
  const [editing, setEditing] = useState<string | null>(null);
  const ctx = useMemo(() => ({ names: Object.fromEntries(m.pools.map((p) => [p.id, p.name])), edit: setEditing }), [m.pools]);
  return (
    <MapCtx.Provider value={ctx}>
      <section className="panel">
        <div className="panel-head">
          <span className="stat-icon"><Icon name="link" size={18} /></span>
          <div>
            <h2 className="section-title">{L('네트워크 구성도', 'Network map')}</h2>
            <p className="muted small">{L('망 분리·열린 포트·잘못된 설정을 Proxmox 실제 상태로 확인합니다.', 'Separation, open ports and misconfiguration, as Proxmox has them now.')}</p>
          </div>
          <div className="panel-actions">
            <button type="button" className="btn" onClick={reload}><Icon name="refresh" size={16} />{L('다시 점검', 'Check again')}</button>
          </div>
        </div>
        <div className="nm-summary">
          <span className={`nm-count nm-crit${n('critical') ? '' : ' nm-zero'}`}><b>{n('critical')}</b>{L('심각', 'Critical')}</span>
          <span className={`nm-count nm-warn${n('warning') ? '' : ' nm-zero'}`}><b>{n('warning')}</b>{L('주의', 'Warning')}</span>
          <span className="nm-count nm-info"><b>{n('info')}</b>{L('참고', 'Info')}</span>
          <span className="nm-sep" />
          <span className="small">{L(`격리된 풀 ${isolated}/${m.pools.length}`, `Isolated pools ${isolated}/${m.pools.length}`)}</span>
          <span className="small">{L(`분리된 망 ${m.segments.length}`, `Networks ${m.segments.length}`)}</span>
        </div>
        {!m.connected && <div className="alert small error">{L('클러스터에 연결되지 않아 일부를 확인하지 못했습니다.', 'The cluster is not connected; some checks were skipped.')}</div>}
        {shown.length ? (
          <ul className="nm-findings">
            {shown.map((f, i) => (
              <li key={i}>
                <button type="button" onClick={() => pick(f)} disabled={!f.pool && !f.segment}>
                  <span className={`nm-lv ${LEVEL[f.level].cls}`}>{L(LEVEL[f.level].ko, LEVEL[f.level].en)}</span>
                  {target(f) && <span className="strong">{target(f)}</span>}
                  <span>{L(...MSG[f.code])}</span>
                  {f.detail && <span className="mono muted small">{f.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : <div className="nm-allgood"><Icon name="shield" size={16} />{L('문제 없음', 'No problems found')}</div>}
        {n('info') > 0 && <button type="button" className="btn-ghost small" onClick={() => setShowInfo(!showInfo)}>
          {showInfo ? L('참고 숨기기', 'Hide info') : L(`참고 ${n('info')}건 보기`, `Show ${n('info')} info`)}</button>}
      </section>
      <section className="panel">
        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'map'} className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>{L('구성도', 'Map')}</button>
          <button type="button" role="tab" aria-selected={view === 'rules'} className={view === 'rules' ? 'on' : ''} onClick={() => setView('rules')}>{L('포트 규칙 표', 'Port rules')}</button>
          <button type="button" role="tab" aria-selected={view === 'matrix'} className={view === 'matrix' ? 'on' : ''} onClick={() => setView('matrix')}>{L('풀 간 통신', 'Pool to pool')}</button>
        </div>
        {view === 'map' ? <Diagram m={m} byPool={byPool} bySeg={bySeg} hot={hot} setHot={setHot} /> : view === 'rules' ? <RuleTable m={m} /> : <PoolMatrix m={m} />}
      </section>
      {editing && <RuleEditor m={m} poolId={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </MapCtx.Provider>
  );
}

export function ClusterNetMapPage() {
  return <ClusterFrame>{(c) => <NetMapBody c={c} />}</ClusterFrame>;
}
