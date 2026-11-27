import { useCallback, useEffect, useState } from 'react';
import type { Pool, PoolPolicy } from '../../api/types';
import { netisoApi } from '../../api/netiso';
import type { ClusterNetIso, NetRule } from '../../api/netiso';
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

export function NetIsoStep({ pool, p, set }: { pool: Pool; p: PoolPolicy; set: SetP }) {
  const { L } = useL();
  const on = !!p.net_isolation;
  return (
    <div className="wiz-body">
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
