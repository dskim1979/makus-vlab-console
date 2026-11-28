import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { Pool, PoolPolicy } from '../../api/types';
import { netisoApi } from '../../api/netiso';
import type { ClusterNetIso, NetRule } from '../../api/netiso';
import { netsegApi } from '../../api/netseg';
import type { PoolNetSeg, Reach, Restart, SegState } from '../../api/netseg';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { useLoad } from '../../components/useLoad';
import { useL } from './OpsPages';

// 데스크톱 풀 > 정책 > 네트워크 격리: the wizard step and the pool page's state panel. The engine puts it
// in the Proxmox firewall (pegaprox/api/vlab_netiso.py): a security group per pool, NIC firewall=1,
// inbound DROP - so the desktop itself cannot take it back.

type SetP = <K extends keyof PoolPolicy>(k: K, v: PoolPolicy[K]) => void;
const PROTOS: NetRule['proto'][] = ['any', 'tcp', 'udp', 'icmp'];

type PeerPool = { id: string; name: string };
const EMPTY_RULE: NetRule = { cidr: '', proto: 'tcp', port: '', note: '', action: 'accept' };

// a pool's rules: each names an address or another pool (마이크로 세그먼트), and allows or drops (차단)
export function RuleList({ list, onChange, placeholder, pools = [] }: {
  list: NetRule[]; onChange: (l: NetRule[]) => void; placeholder: string; pools?: PeerPool[];
}) {
  const { L } = useL();
  const [d, setD] = useState<NetRule>(EMPTY_RULE);
  const [byPool, setByPool] = useState(false);
  const ready = byPool ? !!d.pool : !!d.cidr.trim();
  const add = () => {
    if (!ready) return;
    const port = d.proto === 'tcp' || d.proto === 'udp' ? d.port.trim() : '';
    const r: NetRule = { cidr: byPool ? '' : d.cidr.trim(), proto: d.proto, port, note: d.note };
    if (byPool && d.pool) r.pool = d.pool;
    if (d.action === 'drop') r.action = 'drop';
    onChange([...list, r]);
    setD(EMPTY_RULE);
  };
  const poolName = (id: string) => pools.find((p) => p.id === id)?.name ?? id;
  return (
    <div className="ni-rules">
      {list.length > 0 && (
        <table className="table compact">
          <thead><tr><th>{L('동작', 'Action')}</th><th>{L('상대', 'Peer')}</th><th>{L('프로토콜', 'Protocol')}</th><th>{L('포트', 'Port')}</th><th>{L('메모', 'Note')}</th><th /></tr></thead>
          <tbody>{list.map((r, i) => (
            <tr key={`${r.pool ?? r.cidr}-${r.proto}-${r.port}-${i}`}>
              <td>{r.action === 'drop' ? <span className="vt-st vt-st-error">{L('차단', 'Drop')}</span> : <span className="vt-st vt-st-running">{L('허용', 'Allow')}</span>}</td>
              <td className={r.pool ? 'strong' : 'mono'}>{r.pool ? <><Icon name="pool" size={13} /> {poolName(r.pool)}</> : r.cidr}</td>
              <td>{r.proto === 'any' ? L('전체', 'Any') : r.proto.toUpperCase()}</td>
              <td className="mono">{r.port || '-'}</td><td>{r.note || '-'}</td>
              <td><button type="button" className="btn-ghost small" onClick={() => onChange(list.filter((_, k) => k !== i))}>{L('삭제', 'Remove')}</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div className="ni-add">
        <select aria-label={L('동작', 'Action')} value={d.action ?? 'accept'} onChange={(e) => setD({ ...d, action: e.target.value as 'accept' | 'drop' })}>
          <option value="accept">{L('허용', 'Allow')}</option><option value="drop">{L('차단', 'Drop')}</option>
        </select>
        {pools.length > 0 && (
          <select aria-label={L('상대 종류', 'Peer kind')} value={byPool ? 'pool' : 'cidr'} onChange={(e) => { setByPool(e.target.value === 'pool'); setD({ ...d, pool: undefined, cidr: '' }); }}>
            <option value="cidr">{L('주소', 'Address')}</option><option value="pool">{L('다른 풀', 'Another pool')}</option>
          </select>
        )}
        {byPool ? (
          <select aria-label={L('풀', 'Pool')} value={d.pool ?? ''} onChange={(e) => setD({ ...d, pool: e.target.value || undefined })}>
            <option value="">{L('풀 고르기', 'Pick a pool')}</option>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : <input aria-label={L('주소', 'Address')} placeholder={placeholder} value={d.cidr} onChange={(e) => setD({ ...d, cidr: e.target.value })} />}
        <select aria-label={L('프로토콜', 'Protocol')} value={d.proto} onChange={(e) => setD({ ...d, proto: e.target.value as NetRule['proto'] })}>
          {PROTOS.map((p) => <option key={p} value={p}>{p === 'any' ? L('전체', 'Any') : p.toUpperCase()}</option>)}
        </select>
        <input aria-label={L('포트', 'Port')} placeholder="22, 80,443" value={d.port} disabled={d.proto !== 'tcp' && d.proto !== 'udp'}
          onChange={(e) => setD({ ...d, port: e.target.value })} />
        <input aria-label={L('메모', 'Note')} placeholder={L('메모', 'Note')} value={d.note} maxLength={40} onChange={(e) => setD({ ...d, note: e.target.value })} />
        <button type="button" className="btn" onClick={add} disabled={!ready}>{L('추가', 'Add')}</button>
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
          : L('꺼진 데스크톱과 새로 만든 데스크톱은 켜기 전에 이 망으로 옮깁니다.', 'Stopped and new desktops go onto it before they start.')}</small>
      {cur && <SegmentMoveFields pool={pool} p={p} set={set} />}
    </fieldset>
  );
}

// which NIC goes onto the segment (a VM with a management NIC and a desktop NIC), and when running desktops move
function SegmentMoveFields({ pool, p, set }: { pool: Pool; p: PoolPolicy; set: SetP }) {
  const { L } = useL();
  const b = useLoad(useCallback(() => netsegApi.bridges(pool.cluster_id), [pool.cluster_id]), [pool.cluster_id]);
  const list = b.state === 'ok' ? b.data.bridges : [];
  const from = p.net_segment_from ?? '';
  const move = p.net_segment_move ?? 'off';
  return (
    <>
      <label><span>{L('옮길 네트워크 카드', 'Network card to move')}</span>
        <select value={from} onChange={(e) => set('net_segment_from', e.target.value)}>
          <option value="">{L('첫 번째 카드 (net0)', 'The first card (net0)')}</option>
          {list.map((x) => <option key={x.name} value={x.name}>{L(`${x.name}에 붙은 카드`, `The card on ${x.name}`)}{x.comments ? ` · ${x.comments}` : ''}{x.addressed.length ? L(' · 관리망 추정', ' · likely management') : ''}</option>)}
          {from && !list.some((x) => x.name === from) && <option value={from}>{from}</option>}
        </select>
        <small className="muted">{L('관리용 카드와 업무용 카드가 따로 있으면 업무용 카드가 붙은 브리지를 고르세요. 나머지 카드는 그대로 둡니다.', 'With a management card and a desktop card, pick the desktop card\'s bridge; the other cards stay.')}</small>
      </label>
      <span className="field-label">{L('켜져 있는 데스크톱', 'Running desktops')}</span>
      <div className="mode-cards mode-cards-3" role="radiogroup" aria-label={L('켜져 있는 데스크톱', 'Running desktops')}>
        {([['off', L('끌 때 옮김', 'When next off'), L('재시작하지 않습니다.', 'Never restarted.')],
          ['idle', L('빈 데스크톱 재시작', 'Restart idle ones'), L('접속한 사람이 없으면 재시작해서 옮깁니다.', 'Restarted when nobody is connected.')],
          ['window', L('정한 시간에만', 'In a time window'), L('그 시간에 빈 데스크톱만 재시작합니다.', 'Idle ones restart only in the window.')]] as const).map(([v, t, h]) => (
          <label key={v} className={`mode-card${move === v ? ' on' : ''}`}>
            <input type="radio" name="net-seg-move" checked={move === v} onChange={() => set('net_segment_move', v)} />
            <span className="strong">{t}</span><span className="muted small">{h}</span>
          </label>
        ))}
      </div>
      {move === 'window' && (
        <label><span>{L('시간 (HH:MM-HH:MM)', 'Window (HH:MM-HH:MM)')}</span>
          <input value={p.net_segment_window ?? ''} placeholder="22:00-06:00" onChange={(e) => set('net_segment_window', e.target.value.trim())} /></label>
      )}
    </>
  );
}

// the cluster's other pools, for rules that name a pool
export function usePeerPools(pool: Pool): PeerPool[] {
  const r = useLoad(useCallback(() => adminApi.pools(), []), []);
  return r.state === 'ok' ? r.data.filter((x) => x.cluster_id === pool.cluster_id && x.id !== pool.id).map((x) => ({ id: x.id, name: x.name })) : [];
}

export function NetIsoStep({ pool, p, set }: { pool: Pool; p: PoolPolicy; set: SetP }) {
  const peerPools = usePeerPools(pool);
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
          <RuleList list={p.net_allow_in ?? []} onChange={(l) => set('net_allow_in', l)} placeholder="10.10.0.0/24" pools={peerPools} />
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
          <small className="muted">{p.net_egress === 'list'
            ? L('DNS · AD(도메인 컨트롤러) · 파일 서버 · 프록시를 빠뜨리면 로그인과 인터넷이 안 됩니다.',
              'Leave out DNS, AD (domain controllers), file servers or the proxy and sign-in and the web stop working.')
            : L('모두 허용일 때는 차단 규칙만 쓸모가 있습니다(예: TCP 25 차단).', 'With allow all only drop rules matter (e.g. drop TCP 25).')}</small>
          <RuleList list={p.net_allow_out ?? []} onChange={(l) => set('net_allow_out', l)} placeholder="10.0.0.53" pools={peerPools} />
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
  waiting: ['vt-st-provisioning', '끄면 옮김', 'Moves when off'], waiting_sdn: ['vt-st-provisioning', '망 준비 대기', 'Waiting for the network'],
  waiting_busy: ['vt-st-in_use', '사용 중 — 나중에', 'In use - later'], waiting_lock: ['vt-st-provisioning', '준비 중(잠김)', 'Being prepared (locked)'],
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
  const idle = v.desktops.filter((d) => d.state === 'waiting' || d.state === 'waiting_back').length;
  const inUse = v.desktops.filter((d) => d.state === 'waiting_busy').length;
  const apply = async (restart: Restart) => {
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
          {idle > 0 && <button type="button" className="btn" disabled={busy} onClick={() => apply('idle')}
            title={L('접속한 사람이 없는 데스크톱만 재시작합니다.', 'Restarts only the desktops nobody is connected to.')}>
            {L(`빈 데스크톱 ${idle}대 재시작`, `Restart ${idle} idle`)}</button>}
          {inUse > 0 && <button type="button" className={`btn${confirm ? ' primary danger' : ''}`} disabled={busy}
            onClick={confirm ? () => apply(true) : () => setConfirm(true)}>
            {confirm ? L(`사용 중 ${inUse}대까지 재시작 — 확인`, `Restart ${inUse} in use too - confirm`) : L('사용 중도 재시작', 'Restart in-use too')}</button>}
        </div>
      </div>
      {confirm && <div className="alert small info">{L('접속 중인 사용자의 데스크톱도 다시 시작합니다. 그 사용자들의 접속이 끊깁니다.', 'Desktops with users on them restart too: those users are disconnected.')}</div>}
      {v.problem && <div className="alert error small" role="status">{v.problem.startsWith('the segment is not applied')
        ? L('세그먼트가 아직 Proxmox에 적용되지 않았습니다. 클러스터 › 네트워크 분리에서 SDN 적용을 누르세요.', 'The segment is not applied in Proxmox yet: press Apply SDN under Cluster › Network segments.')
        : v.problem.startsWith('the zone is not built')
          ? L('일부 노드에 망이 만들어지지 않아 그 노드의 데스크톱은 옮기지 않습니다. 클러스터 › 네트워크 분리에서 노드 상태를 확인하세요.', 'Some nodes did not build the network, so their desktops are not moved. See node states under Cluster › Network segments.')
          : v.problem.includes('fixed address')
            ? L(`망은 옮겼지만 예전 주소를 그대로 쓰는 데스크톱이 있습니다(${v.desktops.filter((d) => d.old_ips?.length).map((d) => `${d.name} ${d.old_ips!.join(', ')}`).join(' · ')}). Windows 네트워크 설정에서 IP를 자동(DHCP)으로 바꾸거나 이 망의 주소로 바꾸세요.`,
              `Moved, but still on the old address (${v.desktops.filter((d) => d.old_ips?.length).map((d) => `${d.name} ${d.old_ips!.join(', ')}`).join(' · ')}). Set the guest's IP to automatic (DHCP) or to an address of this network.`)
            : v.problem}</div>}
      {error && <div className="alert error small" role="alert">{error}</div>}
      <table className="table compact">
        <thead><tr><th>{L('데스크톱', 'Desktop')}</th><th>VMID</th><th>{L('카드', 'Card')}</th><th>{L('브리지', 'Bridge')}</th>
          <th>{L('주소', 'Address')}</th><th title={L('MOAVI 서버(게이트웨이)에서 원격 데스크톱 포트(3389)로 닿는지', 'Whether the MOAVI server (gateway) reaches its RDP port (3389)')}>{L('게이트웨이에서', 'From gateway')}</th><th>{L('상태', 'State')}</th></tr></thead>
        <tbody>{v.desktops.map((d) => {
          const [cls, ko, en] = SEG_STATE[d.state] ?? SEG_STATE.off;
          return (
            <tr key={d.id}>
              <td>{d.name}</td><td className="mono">{d.vmid}</td><td className="mono">{d.nic || '-'}</td>
              <td className="mono">{d.bridge || '-'}{d.orig_bridge && d.state === 'on' ? <span className="muted small"> ({L('원래', 'was')} {d.orig_bridge})</span> : null}</td>
              <td className="mono">{d.ips?.join(', ') || '-'}</td>
              <td><ReachBadge r={d.reach ?? ''} /></td>
              <td>{d.old_ips?.length
                ? <span className="vt-st vt-st-offline" title={d.old_ips.join(', ')}>{L('예전 주소 사용', 'Old address')}</span>
                : <span className={`vt-st ${cls}`} title={d.error || undefined}>{L(ko, en)}</span>}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </section>
  );
}

// as the MOAVI server (where rdpgw and Warpgate run) sees an address
export function ReachBadge({ r }: { r: Reach }) {
  const { L } = useL();
  if (!r) return <span className="muted">-</span>;
  if (r === 'open' || r === 'reachable') return <span className="vt-st vt-st-running">{L('닿음', 'Reached')}</span>;
  if (r === 'unreachable') return <span className="vt-st vt-st-error" title={L('MOAVI 서버에서 이 망으로 가는 경로가 없습니다. 라우터에 경로를 넣으세요.', 'No route from the MOAVI server: add one on the router.')}>{L('경로 없음', 'No route')}</span>;
  return <span className="vt-st vt-st-offline" title={L('응답이 없습니다. 방화벽이나 꺼진 장비일 수 있습니다.', 'No answer: a firewall, or it is down.')}>{L('응답 없음', 'No answer')}</span>;
}

// the policy review: the segment's name (a lookup of the cluster's segments)
export function NetSegName({ pool, id }: { pool: Pool; id: string }) {
  const { L } = useL();
  const c = useLoad(useCallback(() => (id ? netsegApi.cluster(pool.cluster_id) : Promise.resolve(null)), [pool.cluster_id, id]), [pool.cluster_id, id]);
  if (!id) return <>{L('VM 원래 브리지', "The VM's own bridge")}</>;
  const s = c.state === 'ok' && c.data ? c.data.segments.find((x) => x.id === id) : undefined;
  return <>{s ? `${s.name} · ${s.subnet}${s.tag ? ` · VLAN ${s.tag}` : ''}` : id}</>;
}
