import { useCallback, useEffect, useState } from 'react';
import type { Pool, PoolPolicy } from '../../api/types';
import { netisoApi } from '../../api/netiso';
import type { ClusterNetIso, NetRule } from '../../api/netiso';
import { netsegApi } from '../../api/netseg';
import type { PoolNetSeg, SegState } from '../../api/netseg';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { useLoad } from '../../components/useLoad';
import { useL } from './OpsPages';

// 데스크톱 풀 > 정책 > 네트워크 격리: the wizard step and the pool page's state panel. The engine puts it
// in the Proxmox firewall (pegaprox/api/vlab_netiso.py): a security group per pool, NIC firewall=1,
// inbound DROP - so the desktop itself cannot take it back.

type SetP = <K extends keyof PoolPolicy>(k: K, v: PoolPolicy[K]) => void;
const PROTOS: NetRule['proto'][] = ['any', 'tcp', 'udp', 'icmp'];

function RuleList({ list, onChange, placeholder }: { list: NetRule[]; onChange: (l: NetRule[]) => void; placeholder: string }) {
  const { L } = useL();
  const [d, setD] = useState<NetRule>({ cidr: '', proto: 'tcp', port: '', note: '' });
  const add = () => {
    if (!d.cidr.trim()) return;
    onChange([...list, { ...d, cidr: d.cidr.trim(), port: d.proto === 'tcp' || d.proto === 'udp' ? d.port.trim() : '' }]);
    setD({ cidr: '', proto: 'tcp', port: '', note: '' });
  };
  return (
    <div className="ni-rules">
      {list.length > 0 && (
        <table className="table compact">
          <thead><tr><th>{L('주소', 'Address')}</th><th>{L('프로토콜', 'Protocol')}</th><th>{L('포트', 'Port')}</th><th>{L('메모', 'Note')}</th><th /></tr></thead>
          <tbody>{list.map((r, i) => (
            <tr key={`${r.cidr}-${r.proto}-${r.port}-${i}`}>
              <td className="mono">{r.cidr}</td><td>{r.proto === 'any' ? L('전체', 'Any') : r.proto.toUpperCase()}</td>
              <td className="mono">{r.port || '-'}</td><td>{r.note || '-'}</td>
              <td><button type="button" className="btn-ghost small" onClick={() => onChange(list.filter((_, k) => k !== i))}>{L('삭제', 'Remove')}</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div className="ni-add">
        <input aria-label={L('주소', 'Address')} placeholder={placeholder} value={d.cidr} onChange={(e) => setD({ ...d, cidr: e.target.value })} />
        <select aria-label={L('프로토콜', 'Protocol')} value={d.proto} onChange={(e) => setD({ ...d, proto: e.target.value as NetRule['proto'] })}>
          {PROTOS.map((p) => <option key={p} value={p}>{p === 'any' ? L('전체', 'Any') : p.toUpperCase()}</option>)}
        </select>
        <input aria-label={L('포트', 'Port')} placeholder="22, 80,443" value={d.port} disabled={d.proto !== 'tcp' && d.proto !== 'udp'}
          onChange={(e) => setD({ ...d, port: e.target.value })} />
        <input aria-label={L('메모', 'Note')} placeholder={L('메모', 'Note')} value={d.note} maxLength={40} onChange={(e) => setD({ ...d, note: e.target.value })} />
        <button type="button" className="btn" onClick={add} disabled={!d.cidr.trim()}>{L('추가', 'Add')}</button>
      </div>
    </div>
  );
}

function GatewayField({ pool }: { pool: Pool }) {
  const { L } = useL();
  const [c, setC] = useState<ClusterNetIso | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    netisoApi.cluster(pool.cluster_id).then((r) => { setC(r); setText((r.gateway_sources.length ? r.gateway_sources : r.suggested).join(', ')); })
      .catch(() => setC(null));
  }, [pool.cluster_id]);
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await netisoApi.setGateway(pool.cluster_id, text.split(/[\s,]+/).filter(Boolean));
      setC((o) => (o ? { ...o, gateway_sources: r.gateway_sources } : o));
      setMsg({ ok: true, text: L('저장했습니다.', 'Saved.') });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  const saved = c?.gateway_sources ?? [];
  return (
    <fieldset className="plain">
      <legend>{L('게이트웨이 주소 (이 클러스터)', 'Gateway address (this cluster)')}</legend>
      <div className="ni-gw">
        <input aria-label={L('게이트웨이 주소', 'Gateway address')} value={text} onChange={(e) => setText(e.target.value)} placeholder="192.168.0.55" />
        <button type="button" className="btn" onClick={save} disabled={busy}>{L('저장', 'Save')}</button>
      </div>
      <small className="muted">{saved.length
        ? L(`저장됨: ${saved.join(', ')}`, `Saved: ${saved.join(', ')}`)
        : L('아직 없음 — 저장하기 전에는 격리를 적용하지 않습니다.', 'None yet - isolation is not applied until it is saved.')}</small>
      {msg && <div className={`alert small ${msg.ok ? 'info' : 'error'}`} role="status">{msg.text}</div>}
      {c?.cluster_firewall && !c.cluster_firewall.enable && (
        <div className="callout warn"><Icon name="info" size={18} />
          <p>{L('데이터센터 방화벽이 꺼져 있어 규칙을 넣어도 막지 않습니다. 클러스터 › 방화벽에서 먼저 켜세요.',
            'The datacenter firewall is off: the rules are written but block nothing. Turn it on under Cluster › Firewall first.')}</p></div>
      )}
    </fieldset>
  );
}

// 네트워크 분리 (2단계): the segment (a department's VNet, 클러스터 > 네트워크 분리) the desktops are moved onto
function SegmentField({ pool, p, set }: { pool: Pool; p: PoolPolicy; set: SetP }) {
  const { L } = useL();
  const c = useLoad(useCallback(() => netsegApi.cluster(pool.cluster_id), [pool.cluster_id]), [pool.cluster_id]);
  const list = c.state === 'ok' ? c.data.segments : [];
  const cur = p.net_segment ?? '';
  const picked = list.find((x) => x.id === cur);
  return (
    <fieldset className="plain">
      <legend>{L('네트워크 (망)', 'Network')}</legend>
      <select aria-label={L('세그먼트', 'Segment')} value={cur} onChange={(e) => set('net_segment', e.target.value)}>
        <option value="">{L('VM 원래 브리지 그대로', "The VM's own bridge")}</option>
        {list.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.subnet}{x.tag ? ` · VLAN ${x.tag}` : ''}</option>)}
        {cur && !picked && c.state === 'ok' && <option value={cur}>{L('(없는 세그먼트)', '(missing segment)')}</option>}
      </select>
      <small className="muted">{c.state === 'ok' && !list.length
        ? L('세그먼트가 없습니다. 클러스터 › 네트워크 분리에서 만듭니다.', 'No segments yet - make them under Cluster › Network segments.')
        : picked && picked.sdn !== 'applied'
          ? L('아직 Proxmox에 적용되지 않은 세그먼트입니다(클러스터 › 네트워크 분리 › SDN 적용). 적용 전에는 옮기지 않습니다.', 'Not applied in Proxmox yet (Cluster › Network segments › Apply SDN); nothing moves before.')
          : L('꺼진 데스크톱은 바로, 켜진 데스크톱은 다음에 끌 때 이 망으로 옮깁니다.', 'Stopped desktops move at once, running ones when next off.')}</small>
    </fieldset>
  );
}

export function NetIsoStep({ pool, p, set }: { pool: Pool; p: PoolPolicy; set: SetP }) {
  const { L } = useL();
  const on = !!p.net_isolation;
  return (
    <div className="wiz-body">
      <SegmentField pool={pool} p={p} set={set} />
      <label className="check"><input type="checkbox" checked={on} onChange={(e) => set('net_isolation', e.target.checked)} />
        <span className="strong">{L('네트워크 격리', 'Network isolation')}</span></label>
      <small className="muted hint-indent">{L('데스크톱은 MOAVI 게이트웨이로 오는 접속만 받습니다. 사용자 PC나 다른 데스크톱에서 바로 붙을 수 없습니다.',
        'Desktops take connections only through the MOAVI gateway - not straight from users\' PCs or other desktops.')}</small>
      <HowTo><ul>
        <li>{L('새 풀은 기본으로 켜져 있습니다. 풀에 등록하면 바로 적용되고, 등록을 해제하면 방화벽 설정도 되돌립니다.',
          'New pools start with it on. A desktop registered gets it at once; unregistered, its firewall goes back as before.')}</li>
        <li>{L('Proxmox 방화벽에 적용되므로 데스크톱 안에서 관리자 권한으로도 풀 수 없습니다.', 'It is in the Proxmox firewall, so not even an administrator inside the desktop can undo it.')}</li>
        <li>{L('포털 · 전용 클라이언트 · 브라우저 RDP는 게이트웨이를 거치므로 그대로 됩니다.', 'Portal, client and browser RDP go through the gateway and keep working.')}</li>
        <li>{L('켜거나 끄면 1분 안에 데스크톱에 반영됩니다. NIC 방화벽을 켤 때 네트워크가 잠깐 끊길 수 있습니다.', 'Turning it on or off reaches the desktops within a minute; the network may blink once when the NIC firewall goes on.')}</li>
      </ul></HowTo>
      {on && (
        <>
          <GatewayField pool={pool} />
          <label className="check"><input type="checkbox" checked={!!p.net_peers} onChange={(e) => set('net_peers', e.target.checked)} />
            <span>{L('같은 풀 데스크톱끼리는 통신 허용', 'Desktops of this pool may reach each other')}</span></label>
          <span className="field-label">{L('추가로 받을 접속', 'Also let in')}</span>
          <small className="muted">{L('관리망 SSH, 모니터링처럼 게이트웨이 말고 데스크톱으로 직접 와야 하는 것만 넣습니다.',
            'Only what must reach the desktops directly, like management SSH or monitoring.')}</small>
          <RuleList list={p.net_allow_in ?? []} onChange={(l) => set('net_allow_in', l)} placeholder="10.10.0.0/24" />
          <span className="field-label">{L('나가는 통신', 'Outbound')}</span>
          <div className="mode-cards mode-cards-2" role="radiogroup" aria-label={L('나가는 통신', 'Outbound')}>
            {([['any', L('모두 허용', 'Allow all'), L('지금처럼 어디로든 나갈 수 있습니다.', 'As now: anywhere.')],
              ['list', L('목록만 허용', 'Only the list'), L('게이트웨이와 아래 목록으로만 나갑니다.', 'Only to the gateway and the list below.')]] as const).map(([v, title, hint]) => (
              <label key={v} className={`mode-card${(p.net_egress ?? 'any') === v ? ' on' : ''}`}>
                <input type="radio" name="net-egress" checked={(p.net_egress ?? 'any') === v} onChange={() => set('net_egress', v)} />
                <span className="strong">{title}</span><span className="muted small">{hint}</span>
              </label>
            ))}
          </div>
          {p.net_egress === 'list' && (
            <>
              <small className="muted">{L('DNS · AD(도메인 컨트롤러) · 파일 서버 · 프록시를 빠뜨리면 로그인과 인터넷이 안 됩니다.',
                'Leave out DNS, AD (domain controllers), file servers or the proxy and sign-in and the web stop working.')}</small>
              <RuleList list={p.net_allow_out ?? []} onChange={(l) => set('net_allow_out', l)} placeholder="10.0.0.53" />
            </>
          )}
        </>
      )}
    </div>
  );
}

export function netIsoSummary(p: PoolPolicy, L: (ko: string, en: string) => string): string {
  if (!p.net_isolation) return L('끔', 'Off');
  const parts = [L('게이트웨이로만 접속', 'gateway only')];
  if (p.net_peers) parts.push(L('같은 풀끼리 허용', 'same pool allowed'));
  if (p.net_allow_in?.length) parts.push(L(`추가 허용 ${p.net_allow_in.length}`, `${p.net_allow_in.length} more in`));
  parts.push(p.net_egress === 'list' ? L(`나가는 통신 목록 ${p.net_allow_out?.length ?? 0}`, `outbound list ${p.net_allow_out?.length ?? 0}`) : L('나가는 통신 모두 허용', 'outbound open'));
  return parts.join(' · ');
}

// the pool page: where the isolation stands on each desktop, and 지금 적용
export function PoolNetIsoPanel({ pool }: { pool: Pool }) {
  const { L } = useL();
  // the pool object is fetched again after a policy save: the state follows it
  const st = useLoad(useCallback(() => netisoApi.pool(pool.id), [pool]), [pool]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (st.state !== 'ok' || (!st.data.enabled && !st.data.desktops.some((d) => d.applied))) return null;
  const v = st.data;
  const done = v.desktops.filter((d) => d.applied).length;
  const apply = async () => {
    setBusy(true); setError(null);
    try { await netisoApi.apply(pool.id); st.reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="stat-icon"><Icon name="shield" size={18} /></span>
        <div>
          <h2 className="section-title">{L('네트워크 격리', 'Network isolation')}</h2>
          <p className="muted small">{L(`${v.desktops.length}대 중 ${done}대 적용`, `${done} of ${v.desktops.length} desktops applied`)}
            {v.gateway_sources.length ? ` · ${L('게이트웨이', 'gateway')} ${v.gateway_sources.join(', ')}` : ''}</p>
        </div>
        <div className="panel-actions">
          <button type="button" className="btn" onClick={apply} disabled={busy}>{busy ? L('적용 중…', 'Applying…') : L('지금 적용', 'Apply now')}</button>
        </div>
      </div>
      {v.problem && <div className="alert error small" role="status">{v.problem.startsWith('no gateway')
        ? L('게이트웨이 주소가 없어 적용하지 않았습니다. 정책 › 네트워크 격리에서 주소를 저장하세요.', 'No gateway address, so nothing was applied. Save one under Policy › Network isolation.')
        : v.problem}</div>}
      {error && <div className="alert error small" role="alert">{error}</div>}
      <table className="table compact">
        <thead><tr><th>{L('데스크톱', 'Desktop')}</th><th>VMID</th><th>{L('주소', 'Address')}</th><th>{L('상태', 'State')}</th></tr></thead>
        <tbody>{v.desktops.map((d) => (
          <tr key={d.id}>
            <td>{d.name}</td><td className="mono">{d.vmid}</td><td className="mono">{d.ips.join(', ') || '-'}</td>
            <td>{d.error ? <span className="vt-st vt-st-offline" title={d.error}>{L('실패', 'Failed')}</span>
              : d.applied ? <span className="vt-st vt-st-running">{L('적용됨', 'Applied')}</span>
                : <span className="vt-st">{L('대기', 'Waiting')}</span>}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="muted small">{L(`Proxmox 보안 그룹 ${v.group} · IP 묶음 ${v.ipset}`, `Proxmox security group ${v.group} · ipset ${v.ipset}`)}</p>
    </section>
  );
}

// the pool page: which desktops are on the pool's segment, 지금 적용 / 재시작해서 적용
const SEG_STATE: Record<SegState, [string, string, string]> = {
  on: ['vt-st-running', '이 망에 있음', 'On it'], off: ['', '원래 브리지', 'Own bridge'],
  waiting: ['vt-st-provisioning', '끄면 옮김', 'Moves when off'], waiting_sdn: ['vt-st-provisioning', 'SDN 적용 대기', 'Waiting for SDN'],
  waiting_back: ['vt-st-provisioning', '끄면 되돌림', 'Back when off'], error: ['vt-st-error', '실패', 'Failed'],
};

export function PoolNetSegPanel({ pool }: { pool: Pool }) {
  const { L } = useL();
  const st = useLoad(useCallback(() => netsegApi.pool(pool.id), [pool]), [pool]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (st.state !== 'ok') return null;
  const v: PoolNetSeg = st.data;
  if (!v.segment && !v.desktops.some((d) => d.state !== 'off')) return null;
  const on = v.desktops.filter((d) => d.state === 'on').length;
  const waiting = v.desktops.filter((d) => d.state === 'waiting' || d.state === 'waiting_back').length;
  const apply = async (restart: boolean) => {
    setBusy(true); setError(null);
    try { await netsegApi.applyPool(pool.id, restart); setConfirm(false); st.reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const seg = v.segment;
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="stat-icon"><Icon name="link" size={18} /></span>
        <div>
          <h2 className="section-title">{L('네트워크 (망)', 'Network')}</h2>
          <p className="muted small">{seg
            ? `${seg.name} · ${seg.subnet}${seg.tag ? ` · VLAN ${seg.tag}` : ''} — ${L(`${v.desktops.length}대 중 ${on}대`, `${on} of ${v.desktops.length}`)}`
            : L('세그먼트를 뺐습니다. 원래 브리지로 되돌리는 중입니다.', 'Segment removed: desktops are going back to their own bridge.')}</p>
        </div>
        <div className="panel-actions">
          <button type="button" className="btn" onClick={() => apply(false)} disabled={busy}>{L('지금 적용', 'Apply now')}</button>
          {waiting > 0 && <button type="button" className={`btn${confirm ? ' primary' : ''}`} disabled={busy}
            onClick={confirm ? () => apply(true) : () => setConfirm(true)}>
            {confirm ? L(`${waiting}대 재시작 — 확인`, `Restart ${waiting} - confirm`) : L('재시작해서 적용', 'Restart and apply')}</button>}
        </div>
      </div>
      {confirm && <div className="alert small info">{L('켜져 있는 데스크톱을 다시 시작합니다. 사용 중인 사용자의 접속이 끊깁니다.', 'Running desktops restart: users on them are disconnected.')}</div>}
      {v.problem && <div className="alert error small" role="status">{v.problem.includes('SDN')
        ? L('세그먼트가 아직 Proxmox에 적용되지 않았습니다. 클러스터 › 네트워크 분리에서 SDN 적용을 누르세요.', 'The segment is not applied in Proxmox yet: press Apply SDN under Cluster › Network segments.')
        : v.problem}</div>}
      {error && <div className="alert error small" role="alert">{error}</div>}
      <table className="table compact">
        <thead><tr><th>{L('데스크톱', 'Desktop')}</th><th>VMID</th><th>{L('브리지', 'Bridge')}</th><th>{L('상태', 'State')}</th></tr></thead>
        <tbody>{v.desktops.map((d) => {
          const [cls, ko, en] = SEG_STATE[d.state] ?? SEG_STATE.off;
          return (
            <tr key={d.id}>
              <td>{d.name}</td><td className="mono">{d.vmid}</td>
              <td className="mono">{d.bridge || '-'}{d.orig_bridge && d.state === 'on' ? <span className="muted small"> ({L('원래', 'was')} {d.orig_bridge})</span> : null}</td>
              <td><span className={`vt-st ${cls}`} title={d.error || undefined}>{L(ko, en)}</span></td>
            </tr>
          );
        })}</tbody>
      </table>
    </section>
  );
}

// the policy review: the segment's name (a lookup of the cluster's segments)
export function NetSegName({ pool, id }: { pool: Pool; id: string }) {
  const { L } = useL();
  const c = useLoad(useCallback(() => (id ? netsegApi.cluster(pool.cluster_id) : Promise.resolve(null)), [pool.cluster_id, id]), [pool.cluster_id, id]);
  if (!id) return <>{L('VM 원래 브리지', "The VM's own bridge")}</>;
  const s = c.state === 'ok' && c.data ? c.data.segments.find((x) => x.id === id) : undefined;
  return <>{s ? `${s.name} · ${s.subnet}${s.tag ? ` · VLAN ${s.tag}` : ''}` : id}</>;
}
