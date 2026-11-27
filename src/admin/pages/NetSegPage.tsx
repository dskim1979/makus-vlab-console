import { Fragment, useCallback, useState } from 'react';
import type { Cluster } from '../../api/types';
import { netsegApi } from '../../api/netseg';
import type { ClusterNetSeg, NetZone, Segment, SegmentInput, SegmentIpam, ZoneType } from '../../api/netseg';
import { Dialog } from '../../components/Dialog';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { ClusterFrame, Meter } from './ClusterPages';
import { useL } from './OpsPages';

// 클러스터 > 네트워크 분리: segments (a department's own network) as Proxmox SDN VNets with a subnet
// in the PVE IPAM (pegaprox/api/vlab_netseg.py). A pool picks its segment under 정책 > 네트워크 격리.

type Lx = (ko: string, en: string) => string;
const zoneName = (t: ZoneType, L: Lx) => (t === 'vlan' ? 'VLAN' : t === 'vxlan' ? 'VXLAN' : L('단일 노드(Simple)', 'Simple (one node)'));
const sdnBadge = (s: Segment['sdn'], L: Lx) => (s === 'applied'
  ? <span className="vt-st vt-st-running">{L('적용됨', 'Applied')}</span>
  : <span className={`vt-st ${s === 'deleted' ? 'vt-st-missing' : 'vt-st-provisioning'}`}>{s === 'missing' ? L('반영 전', 'Not yet') : s === 'deleted' ? L('삭제 대기', 'Removing') : L('변경 대기', 'Pending')}</span>);

function ZoneDialog({ cid, zone, locked, onClose, onSaved }: { cid: string; zone: NetZone | null; locked: boolean; onClose: () => void; onSaved: () => void }) {
  const { L } = useL();
  const [z, setZ] = useState<NetZone>(zone ?? { zone: 'moavi', type: 'vlan', bridge: 'vmbr0', peers: '', mtu: 0, existing: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await netsegApi.setZone(cid, { ...z, existing: !!z.existing }); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const types: [ZoneType, string, string][] = [
    ['vlan', 'VLAN', L('스위치에 VLAN(트렁크)이 있을 때. 가장 일반적입니다.', 'When the switch carries VLANs (trunk). The usual choice.')],
    ['vxlan', 'VXLAN', L('스위치 설정 없이 노드끼리 터널로 묶습니다.', 'Tunnels between the nodes, no switch change.')],
    ['simple', L('단일 노드', 'Simple'), L('노드 한 대 안에서만. 시험용, DHCP 내장.', 'Inside one node only. For trials, DHCP built in.')],
  ];
  return (
    <Dialog open title={L('SDN 영역 설정', 'SDN zone')} onClose={onClose} onSubmit={save} submitLabel={L('저장', 'Save')} busy={busy} error={error} wide>
      {locked && <div className="alert small info">{L('세그먼트가 있는 동안은 영역 이름과 종류를 바꿀 수 없습니다.', 'The zone name and type cannot change while it has segments.')}</div>}
      <label className="check"><input type="checkbox" checked={!!z.existing} disabled={locked} onChange={(e) => setZ({ ...z, existing: e.target.checked })} />
        <span>{L('Proxmox에 이미 있는 영역 사용', 'Use a zone already in Proxmox')}</span></label>
      <div className="mode-cards mode-cards-3" role="radiogroup" aria-label={L('영역 종류', 'Zone type')}>
        {types.map(([v, title, hint]) => (
          <label key={v} className={`mode-card${z.type === v ? ' on' : ''}`}>
            <input type="radio" name="zone-type" checked={z.type === v} disabled={locked} onChange={() => setZ({ ...z, type: v })} />
            <span className="strong">{title}</span><span className="muted small">{hint}</span>
          </label>
        ))}
      </div>
      <div className="form-row form-row-three">
        <label><span>{L('영역 이름', 'Zone id')}</span>
          <input value={z.zone} maxLength={8} disabled={locked} onChange={(e) => setZ({ ...z, zone: e.target.value.toLowerCase() })} />
          <small className="muted">{L('영문 소문자 · 숫자 8자 이내', 'Up to 8 lowercase letters or digits')}</small></label>
        {!z.existing && z.type === 'vlan' && (
          <label><span>{L('노드 브리지', 'Node bridge')}</span>
            <input value={z.bridge} placeholder="vmbr0" onChange={(e) => setZ({ ...z, bridge: e.target.value })} /></label>
        )}
        {!z.existing && z.type === 'vxlan' && (
          <label><span>{L('노드 주소', 'Node addresses')}</span>
            <input value={z.peers} placeholder="192.168.0.11, 192.168.0.12" onChange={(e) => setZ({ ...z, peers: e.target.value })} /></label>
        )}
        {!z.existing && (
          <label><span>MTU</span>
            <input type="number" min={0} max={9000} value={z.mtu || ''} placeholder={z.type === 'vxlan' ? '1450' : L('기본', 'Default')}
              onChange={(e) => setZ({ ...z, mtu: Number(e.target.value) || 0 })} /></label>
        )}
      </div>
    </Dialog>
  );
}

const EMPTY: SegmentInput = { name: '', department: '', tag: 0, subnet: '', gateway: '', dhcp_start: '', dhcp_end: '', snat: false };

function SegmentDialog({ cid, zone, seg, onClose, onSaved }: { cid: string; zone: NetZone; seg: Segment | null; onClose: () => void; onSaved: () => void }) {
  const { L } = useL();
  const [s, setS] = useState<SegmentInput>(seg ? { name: seg.name, department: seg.department, tag: seg.tag, subnet: seg.subnet, gateway: seg.gateway,
    dhcp_start: seg.dhcp_start, dhcp_end: seg.dhcp_end, snat: seg.snat } : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const simple = zone.type === 'simple';
  const fillGw = (subnet: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/\d+$/.exec(subnet.trim());
    return m && !s.gateway ? `${m[1]}.${m[2]}.${m[3]}.${Number(m[4]) + 1}` : s.gateway;
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (seg) await netsegApi.update(cid, seg.id, s); else await netsegApi.add(cid, s);
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open title={seg ? L('세그먼트 편집', 'Edit segment') : L('세그먼트 추가', 'Add segment')} onClose={onClose} onSubmit={save}
      submitLabel={L('저장', 'Save')} busy={busy || !s.name.trim() || !s.subnet.trim()} error={error} wide>
      <div className="form-row form-row-even">
        <label><span>{L('이름', 'Name')}</span><input value={s.name} maxLength={40} placeholder={L('설계팀 망', 'Design net')} onChange={(e) => setS({ ...s, name: e.target.value })} /></label>
        <label><span>{L('부서 (메모)', 'Department (note)')}</span><input value={s.department} maxLength={80} placeholder={L('설계', 'Design')} onChange={(e) => setS({ ...s, department: e.target.value })} /></label>
      </div>
      <div className="form-row form-row-three">
        {!simple && (
          <label><span>{zone.type === 'vxlan' ? 'VXLAN ID' : 'VLAN ID'}</span>
            <input type="number" min={1} max={zone.type === 'vxlan' ? 16777215 : 4094} value={s.tag || ''} placeholder="110"
              onChange={(e) => setS({ ...s, tag: Number(e.target.value) || 0 })} /></label>
        )}
        <label><span>{L('서브넷', 'Subnet')}</span>
          <input value={s.subnet} placeholder="10.20.1.0/24" onChange={(e) => setS({ ...s, subnet: e.target.value })}
            onBlur={(e) => setS((o) => ({ ...o, gateway: fillGw(e.target.value) }))} /></label>
        <label><span>{L('게이트웨이', 'Gateway')}</span>
          <input value={s.gateway} placeholder="10.20.1.1" onChange={(e) => setS({ ...s, gateway: e.target.value })} /></label>
      </div>
      {simple && (
        <div className="form-row form-row-even">
          <label><span>{L('DHCP 시작', 'DHCP from')}</span><input value={s.dhcp_start} placeholder="10.20.1.100" onChange={(e) => setS({ ...s, dhcp_start: e.target.value })} /></label>
          <label><span>{L('DHCP 끝', 'DHCP to')}</span><input value={s.dhcp_end} placeholder="10.20.1.199" onChange={(e) => setS({ ...s, dhcp_end: e.target.value })} /></label>
        </div>
      )}
      {simple && <label className="check"><input type="checkbox" checked={s.snat} onChange={(e) => setS({ ...s, snat: e.target.checked })} />
        <span>{L('SNAT — 노드 주소로 바꿔서 밖으로 나감 (라우터 없이 인터넷)', 'SNAT - out through the node\'s address (internet without a router)')}</span></label>}
      {!simple && <small className="muted">{L('게이트웨이 주소는 이 망의 라우터(또는 게이트웨이 VM)가 가집니다. DHCP도 그쪽에서 줍니다.',
        'The gateway address lives on this network\'s router (or a gateway VM), which also hands out DHCP.')}</small>}
      {seg && seg.desktops > 0 && <div className="callout warn"><Icon name="info" size={18} />
        <p>{L(`데스크톱 ${seg.desktops}대가 이 망에 있습니다. 서브넷이나 VLAN을 바꾸면 주소가 바뀝니다.`, `${seg.desktops} desktops are on it. Changing the subnet or VLAN changes their addresses.`)}</p></div>}
    </Dialog>
  );
}

function IpPanel({ cid, seg, ipam, reload }: { cid: string; seg: Segment; ipam: SegmentIpam | undefined; reload: () => void }) {
  const { L } = useL();
  const [ip, setIp] = useState('');
  const [mac, setMac] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>) => {
    setError(null);
    try { await f(); setIp(''); setMac(''); reload(); } catch (e) { setError((e as Error).message); }
  };
  if (!ipam) return <p className="muted small">{L('IP 정보를 불러오지 못했습니다.', 'Could not load the addresses.')}</p>;
  const src = (s: string) => (s === 'ipam' ? 'IPAM' : s === 'agent' ? L('게스트', 'guest') : L('세그먼트', 'segment'));
  return (
    <div className="ns-ips">
      {ipam.outside.length > 0 && <div className="callout warn"><Icon name="info" size={18} />
        <p>{L(`이 망으로 옮겼지만 아직 예전 주소를 쓰는 데스크톱: ${ipam.outside.map((o) => `${o.name} (${o.ip})`).join(', ')} — 재시작하면 새 주소를 받습니다.`,
          `Moved here but still on the old address: ${ipam.outside.map((o) => `${o.name} (${o.ip})`).join(', ')} - a restart gets a new one.`)}</p></div>}
      {ipam.duplicates > 0 && <div className="alert error small">{L(`같은 주소를 쓰는 장치가 ${ipam.duplicates}건 있습니다.`, `${ipam.duplicates} address(es) used twice.`)}</div>}
      <table className="table compact">
        <thead><tr><th>IP</th><th>MAC</th><th>{L('사용처', 'Used by')}</th><th>{L('출처', 'Source')}</th><th /></tr></thead>
        <tbody>{ipam.entries.map((e) => (
          <tr key={e.ip} className={e.problem ? 'row-warn' : undefined}>
            <td className="mono">{e.ip}</td><td className="mono">{e.mac || '-'}</td>
            <td>{e.name === 'gateway' ? L('게이트웨이', 'Gateway') : e.name || (e.vmid ? `VM ${e.vmid}` : L('예약', 'Reserved'))}
              {e.problem === 'duplicate' && <span className="vt-st vt-st-offline"> {L('중복', 'Duplicate')}</span>}</td>
            <td className="small">{e.sources.map(src).join(' · ')}</td>
            <td>{!e.vmid && e.name !== 'gateway' && e.sources.includes('ipam') && (
              <button type="button" className="btn-ghost small" onClick={() => run(() => netsegApi.unreserve(cid, seg.id, e.ip, e.mac))}>{L('예약 해제', 'Release')}</button>)}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="ns-reserve">
        <input aria-label="IP" placeholder={L('예약할 IP', 'IP to reserve')} value={ip} onChange={(e) => setIp(e.target.value)} />
        <input aria-label="MAC" placeholder={L('MAC (선택)', 'MAC (optional)')} value={mac} onChange={(e) => setMac(e.target.value)} />
        <button type="button" className="btn" disabled={!ip.trim()} onClick={() => run(() => netsegApi.reserve(cid, seg.id, ip.trim(), mac.trim()))}>{L('IP 예약', 'Reserve')}</button>
      </div>
      {error && <div className="alert error small" role="alert">{error}</div>}
      {ipam.dhcp && <p className="muted small">{L(`DHCP 범위 ${ipam.dhcp.start} – ${ipam.dhcp.end}`, `DHCP range ${ipam.dhcp.start} - ${ipam.dhcp.end}`)}</p>}
    </div>
  );
}

function SdnBar({ cid, v, reload }: { cid: string; v: ClusterNetSeg; reload: () => void }) {
  const { L } = useL();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pending = v.segments.filter((s) => s.sdn !== 'applied').length + (v.sdn.pending_ours.length && !v.segments.some((s) => s.sdn !== 'applied') ? 1 : 0);
  const apply = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await netsegApi.applySdn(cid);
      setMsg({ ok: true, text: r.applied ? L(`Proxmox에 반영했습니다: ${r.changed.join(', ') || '보류 중이던 변경'}`, `Applied in Proxmox: ${r.changed.join(', ') || 'pending changes'}`) : L('바꿀 것이 없습니다.', 'Nothing to change.') });
      setConfirm(false); reload();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <>
      {v.sdn.pending_other.length > 0 && <div className="callout warn"><Icon name="info" size={18} />
        <p>{L(`Proxmox에 MOAVI가 아닌 보류 중 SDN 변경이 있어 적용할 수 없습니다: ${v.sdn.pending_other.join(', ')}. Proxmox에서 먼저 적용하거나 되돌리세요.`,
          `Proxmox holds SDN changes that are not MOAVI's: ${v.sdn.pending_other.join(', ')}. Apply or revert them in Proxmox first.`)}</p></div>}
      {pending > 0 && (
        <div className={`ns-sdnbar${confirm ? ' confirm' : ''}`}>
          <Icon name="info" size={18} />
          <span className="strong">{confirm
            ? L('모든 노드가 네트워크 설정을 다시 읽습니다. 기존 VM 통신은 끊기지 않습니다. 적용할까요?', 'Every node reloads its network config; running VMs keep their traffic. Apply?')
            : L(`Proxmox에 아직 반영하지 않은 변경 ${pending}건`, `${pending} change(s) not in Proxmox yet`)}</span>
          <span className="ns-grow" />
          {confirm && <button type="button" className="btn" onClick={() => setConfirm(false)} disabled={busy}>{L('취소', 'Cancel')}</button>}
          <button type="button" className="btn primary" disabled={busy || v.sdn.pending_other.length > 0}
            onClick={confirm ? apply : () => setConfirm(true)}>{busy ? L('적용 중…', 'Applying…') : confirm ? L('적용', 'Apply') : L('SDN 적용', 'Apply SDN')}</button>
        </div>
      )}
      {msg && <div className={`alert small ${msg.ok ? 'info' : 'error'}`} role="status">{msg.text}</div>}
    </>
  );
}

function NetSegBody({ c }: { c: Cluster }) {
  const { L } = useL();
  const st = useLoad(useCallback(() => netsegApi.cluster(c.id), [c.id]), [c.id]);
  const ipam = useLoad(useCallback(() => netsegApi.ipam(c.id), [c.id]), [c.id]);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [edit, setEdit] = useState<Segment | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => { st.reload(); ipam.reload(); };
  return (
    <LoadState value={st} retry={st.reload}>
      {(v) => {
        const ip = (id: string) => (ipam.state === 'ok' ? ipam.data.segments.find((x) => x.segment_id === id) : undefined);
        const remove = async (s: Segment) => {
          setError(null);
          try { await netsegApi.remove(c.id, s.id); reload(); } catch (e) { setError((e as Error).message); }
        };
        return (
          <>
            <section className="panel">
              <div className="panel-head">
                <span className="stat-icon"><Icon name="link" size={18} /></span>
                <div>
                  <h2 className="section-title">{L('네트워크 분리', 'Network segments')}</h2>
                  <p className="muted small">{L('부서별로 망(VLAN)을 나누고 IP를 관리합니다. 풀은 정책 › 네트워크 격리에서 망을 고릅니다.',
                    'Give departments their own network (VLAN) and manage its addresses. A pool picks its network under Policy › Network isolation.')}</p>
                </div>
                <div className="panel-actions">
                  <button type="button" className="btn" onClick={() => setZoneOpen(true)}><Icon name="gear" size={16} />{L('SDN 영역', 'SDN zone')}</button>
                  <button type="button" className="btn primary" disabled={!v.zone} onClick={() => setEdit('new')}><Icon name="plus" size={16} />{L('세그먼트 추가', 'Add segment')}</button>
                </div>
              </div>
              <HowTo><ul>
                <li>{L('순서: SDN 영역 설정 → 세그먼트 추가 → SDN 적용 → 풀 정책에서 세그먼트 선택.', 'Order: SDN zone → add segments → Apply SDN → pick the segment in the pool policy.')}</li>
                <li>{L('VLAN 영역은 노드가 연결된 스위치 포트에 그 VLAN이 트렁크로 열려 있어야 합니다.', 'A VLAN zone needs the VLAN trunked on the switch ports of the nodes.')}</li>
                <li>{L('게이트웨이(MOAVI 서버)가 새 서브넷으로 갈 수 있어야 접속됩니다 — 라우터(L3 스위치)에 경로를 넣으세요.', 'The MOAVI gateway must reach the new subnet: add the route on the router (L3 switch).')}</li>
                <li>{L('꺼진 데스크톱은 1분 안에 옮겨지고, 켜진 것은 다음에 끌 때 옮겨집니다(풀 화면의 재시작해서 적용으로 바로 가능).', 'Stopped desktops move within a minute; running ones when next off (or now with Restart and apply on the pool page).')}</li>
                <li>{L('풀이 세그먼트를 빼거나 데스크톱을 등록 해제하면 원래 브리지 · VLAN으로 돌아갑니다.', 'Leaving the segment or unregistering puts the desktop back on its old bridge and VLAN.')}</li>
              </ul></HowTo>
              {!v.sdn.available && <div className="alert error small">{L(`Proxmox SDN을 쓸 수 없습니다: ${v.sdn.problem}`, `Proxmox SDN is not available: ${v.sdn.problem}`)}</div>}
              {v.zone
                ? <dl className="kv">
                    <dt>{L('영역', 'Zone')}</dt><dd><span className="mono">{v.zone.zone}</span> · {zoneName(v.zone.type, L)}
                      {v.zone.existing ? ` · ${L('기존 영역', 'existing zone')}` : ''}
                      {v.zone.type === 'vlan' && v.zone.bridge ? ` · ${L('브리지', 'bridge')} ${v.zone.bridge}` : ''}
                      {v.zone.type === 'vxlan' && v.zone.peers ? ` · ${v.zone.peers}` : ''}</dd>
                  </dl>
                : <div className="empty"><p>{L('먼저 SDN 영역을 정하세요. 세그먼트(망)는 이 영역 안에 만들어집니다.', 'Set the SDN zone first: segments are made inside it.')}</p>
                    <button type="button" className="btn primary" onClick={() => setZoneOpen(true)}>{L('SDN 영역 설정', 'Set the SDN zone')}</button></div>}
              <SdnBar cid={c.id} v={v} reload={reload} />
              {error && <div className="alert error small" role="alert">{error}</div>}
              {v.segments.length > 0 && (
                <div className="table-scroll">
                  <table className="table">
                    <thead><tr><th>{L('세그먼트', 'Segment')}</th><th>{v.zone?.type === 'vxlan' ? 'VXLAN' : 'VLAN'}</th><th>{L('서브넷', 'Subnet')}</th>
                      <th>{L('사용 풀', 'Pools')}</th><th>{L('IP 사용', 'Addresses')}</th><th>Proxmox</th><th /></tr></thead>
                    <tbody>{v.segments.map((s) => {
                      const g = ip(s.id);
                      return (
                        <Fragment key={s.id}>
                          <tr>
                            <td><span className="strong">{s.name}</span>{s.department && <><br /><span className="muted small">{s.department}</span></>}
                              <br /><span className="muted small mono">{s.vnet}</span></td>
                            <td className="mono">{s.tag || '-'}</td>
                            <td><span className="mono">{s.subnet}</span><br /><span className="muted small">{L('게이트웨이', 'gw')} <span className="mono">{s.gateway}</span>{s.snat ? ' · SNAT' : ''}</span></td>
                            <td>{s.pools.length ? s.pools.join(', ') : <span className="muted">-</span>}
                              {s.desktops > 0 && <><br /><span className="muted small">{L(`데스크톱 ${s.desktops}대`, `${s.desktops} desktops`)}</span></>}</td>
                            <td className="ns-use">{g ? <><Meter value={(g.used / Math.max(g.usable, 1)) * 100} label={`${g.used}/${g.usable}`} />
                              <span className="muted small">{L(`남은 ${g.free}`, `${g.free} free`)}{g.duplicates ? ` · ${L('중복', 'dup')} ${g.duplicates}` : ''}</span></> : <span className="muted small">{L(`${s.usable}개`, `${s.usable}`)}</span>}</td>
                            <td className="nowrap">{sdnBadge(s.sdn, L)}</td>
                            <td className="nowrap">
                              <button type="button" className="btn-ghost small" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>{L('IP 관리', 'Addresses')}</button>
                              <button type="button" className="btn-ghost small" onClick={() => setEdit(s)}>{L('편집', 'Edit')}</button>
                              <button type="button" className="btn-ghost small" disabled={s.pools.length > 0 || s.desktops > 0}
                                title={s.pools.length || s.desktops ? L('쓰는 풀 · 데스크톱이 있으면 지울 수 없습니다', 'In use') : undefined}
                                onClick={() => remove(s)}>{L('삭제', 'Delete')}</button>
                            </td>
                          </tr>
                          {open === s.id && <tr className="ns-detail"><td colSpan={7}><IpPanel cid={c.id} seg={s} ipam={g} reload={ipam.reload} /></td></tr>}
                        </Fragment>
                      );
                    })}</tbody>
                  </table>
                </div>
              )}
              {v.zone && !v.segments.length && <p className="muted small">{L('아직 세그먼트가 없습니다.', 'No segments yet.')}</p>}
            </section>
            {zoneOpen && <ZoneDialog cid={c.id} zone={v.zone} locked={v.segments.length > 0} onClose={() => setZoneOpen(false)} onSaved={() => { setZoneOpen(false); reload(); }} />}
            {edit && v.zone && <SegmentDialog cid={c.id} zone={v.zone} seg={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
          </>
        );
      }}
    </LoadState>
  );
}

export function ClusterNetSegPage() {
  return <ClusterFrame>{(c) => <NetSegBody c={c} />}</ClusterFrame>;
}
