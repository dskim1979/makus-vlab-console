import { useState } from 'react';
import { adminApi } from '../../api/admin';
import { cableReadText, errorCode, jtagApi } from '../../api/jtag';
import type { GatewayCable, GatewayState, JtagGateway } from '../../api/jtag';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { SettingsStatus } from '../../components/SettingsShell';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// 가속 자원 › 보드 LAB › JTAG 게이트웨이 (engine: pegaprox/api/vlab_next.py, pegaprox/vlab/jtag_gw.py).
// A gateway VM holds many JTAG cables and runs hw_server / XVC / jtagd; boards are its cables by serial.

type Notice = { kind: 'info' | 'error'; text: string } | null;
const errText = (e: unknown) => (e as Error).message;

function useL() {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
  return { L, when };
}

export function GatewayStateChip({ state }: { state: GatewayState }) {
  const { L } = useL();
  if (state === 'up') return <span className="chip chip-free">{L('정상', 'up')}</span>;
  if (state === 'down') return <span className="chip chip-warn">{L('응답 없음', 'down')}</span>;
  return <span className="chip">{L('점검 전', 'not checked')}</span>;
}

export function JtagGatewaysPage() {
  const { L, when } = useL();
  const gws = useLoad(jtagApi.list);
  const [editing, setEditing] = useState<JtagGateway | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  // errText: how a failure reads (the cable read maps the engine's code); the list reloads either way,
  // so a failed cable read shows its reason on the gateway card as well
  const act = async (fn: () => Promise<unknown>, ok?: string, errorText: (e: unknown) => string = errText) => {
    setNotice(null);
    try { await fn(); if (ok) setNotice({ kind: 'info', text: ok }); } catch (e) { setNotice({ kind: 'error', text: errorText(e) }); }
    gws.reload();
  };
  return (
    <LoadState value={gws} retry={gws.reload}>
      {(list) => (
        <>
          <p className="muted small page-intro">{L('JTAG 케이블을 모아 hw_server · XVC · jtagd로 공유하는 VM입니다.', 'VMs that hold JTAG cables and share them over hw_server, XVC or jtagd.')}</p>
          <details className="small">
            <summary>{L('구성 안내', 'Setup notes')}</summary>
            <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
              <li>{L('빌드하지 않고 프로그래밍 · 디버그만 중계합니다. 합성은 연구자 VM이나 빌드 팜에서.', 'Relays programming and debug only; synthesis runs in the researcher\'s VM or the build farm.')}</li>
              <li>{L('Vivado Lab Edition만 설치. 2–4 vCPU, 4–8 GB.', 'Vivado Lab Edition only. 2-4 vCPU, 4-8 GB.')}</li>
              <li>{L('케이블이 많으면 PCIe USB 컨트롤러를 통째로 넘깁니다.', 'With many cables, pass a whole PCIe USB controller.')}</li>
              <li>{L('늘릴 때는 CPU 대신 컨트롤러 · 게이트웨이를 나눕니다. 게이트웨이당 10–20개.', 'Scale by splitting controllers and gateways, not CPU: 10-20 cables each.')}</li>
            </ul>
          </details>
          <div className="toolbar">
            <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('게이트웨이 추가', 'Add gateway')}</button>
            <button type="button" className="btn" onClick={gws.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
          </div>
          <SettingsStatus items={[
            { label: L('게이트웨이', 'Gateways'), value: String(list.length) },
            { label: L('정상', 'Up'), value: String(list.filter((g) => g.state === 'up').length), tone: 'ok' },
            { label: L('응답 없음', 'Down'), value: String(list.filter((g) => g.state === 'down').length), tone: list.some((g) => g.state === 'down') ? 'warn' : undefined },
            { label: L('보드', 'Boards'), value: String(list.reduce((n, g) => n + g.boards.length, 0)) },
          ]} />
          {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
          {list.length === 0 ? <div className="empty"><p>{L('등록된 JTAG 게이트웨이가 없습니다.', 'No JTAG gateways yet.')}</p></div>
            : list.map((g) => <GatewayCard key={g.id} g={g} when={when} act={act} onEdit={() => setEditing(g)} />)}
          {editing && <GatewayDialog gw={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); gws.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

function GatewayCard({ g, when, act, onEdit }: { g: JtagGateway; when: (s: string | null) => string;
  act: (fn: () => Promise<unknown>, ok?: string, errorText?: (e: unknown) => string) => Promise<void>; onEdit: () => void }) {
  const { L } = useL();
  const [adding, setAdding] = useState(false);
  // the last read failed after the list we have (or there is no list)
  const failed = !!g.cables_error_code && !!g.cables_error_at && (!g.cables_at || g.cables_error_at >= g.cables_at);
  const down = (g.last_detail.ports ?? []).filter((p) => !p.ok).map((p) => p.port);
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="stat-icon tone-blue"><Icon name="fpga" size={18} /></span>
        <div style={{ flex: 1 }}>
          <h2 className="section-title">{g.name} <GatewayStateChip state={g.state} /></h2>
          <p className="muted small" style={{ margin: 0 }}>
            <code className="code">{g.host}</code> · hw_server {g.hw_port} · jtagd {g.jtagd_port}
            {g.vmid ? ` · VM ${g.vmid}${g.vm ? ` (${g.vm.node}, ${g.vm.status})` : ''}` : ''}
            {g.notes ? ` · ${g.notes}` : ''}
          </p>
          <p className="muted small" style={{ margin: 0 }}>{L('마지막 점검', 'Last check')} {when(g.last_check)}
            {g.state === 'down' && <> — {g.last_detail.vm && g.last_detail.vm !== 'running' ? L(`VM ${g.last_detail.vm}`, `VM ${g.last_detail.vm}`) : ''}
              {down.length ? L(` 포트 ${down.join(', ')} 응답 없음`, ` ports ${down.join(', ')} not answering`) : ''} · {L('이 게이트웨이의 보드는 대여할 수 없습니다.', 'its boards cannot be lent.')}</>}</p>
        </div>
        <div className="page-tools">
          <button type="button" className="btn small-btn" onClick={() => act(() => jtagApi.check(g.id))}>{L('지금 점검', 'Check now')}</button>
          <button type="button" className="btn small-btn" disabled={!g.vmid} onClick={() => act(() => jtagApi.discover(g.id), L('케이블 목록을 읽었습니다.', 'Cables read.'),
            (e) => `${g.name}: ${cableReadText(errorCode(e), errText(e), L)}`)}>{L('케이블 찾기', 'Find cables')}</button>
          <button type="button" className="btn-ghost small-btn" onClick={onEdit}>{L('편집', 'Edit')}</button>
          <button type="button" className="btn-ghost small-btn danger" disabled={g.boards.length > 0} title={g.boards.length ? L('보드를 먼저 옮기거나 지우세요.', 'Move or delete its boards first.') : undefined}
            onClick={() => { if (confirm(L(`'${g.name}'을(를) 지울까요? VM과 패스스루는 그대로 둡니다.`, `Delete '${g.name}'? The VM and its passthrough stay as they are.`))) void act(() => jtagApi.remove(g.id)); }}>{L('삭제', 'Delete')}</button>
        </div>
      </div>

      <h3 className="small strong">{L('케이블 연결 (VM 패스스루)', 'Cables on the VM (passthrough)')}</h3>
      <div className="chip-row">
        {g.passthrough.length === 0 && <span className="muted small">{L('MOAVI Desk가 넘긴 장치가 없습니다.', 'Nothing passed through by MOAVI Desk.')}</span>}
        {g.passthrough.map((p) => (
          <span key={p.slot} className="chip">
            {p.kind === 'pci' ? L('PCIe USB 컨트롤러', 'PCIe USB controller') : 'USB'} <code className="code">{p.value}</code> · {p.slot}
            <button type="button" className="btn-ghost small-btn danger" aria-label={L('빼기', 'Remove')}
              onClick={() => { if (confirm(L(`${p.slot}(${p.value})를 게이트웨이 VM에서 뺄까요?`, `Take ${p.slot} (${p.value}) off the gateway VM?`))) void act(() => jtagApi.removePassthrough(g.id, p.slot)); }}>×</button>
          </span>))}
        <button type="button" className="btn-ghost small-btn" disabled={!g.vmid} onClick={() => setAdding(true)}><Icon name="plus" size={14} />{L('넘기기', 'Pass through')}</button>
      </div>

      <h3 className="small strong">{L('게이트웨이가 보는 케이블', 'Cables the gateway sees')} <span className="muted small">{g.cables_at
        ? (failed ? L(`${when(g.cables_at)} 기준 · 오래됨`, `as of ${when(g.cables_at)} · stale`) : when(g.cables_at))
        : failed ? L('아직 읽은 적 없음', 'never read') : L('케이블 찾기를 누르세요', 'Press Find cables')}</span></h3>
      {failed && <div className="alert small error" role="alert">
        {L(`${when(g.cables_error_at ?? null)} 케이블 찾기 실패: `, `Cable read failed ${when(g.cables_error_at ?? null)}: `)}{cableReadText(g.cables_error_code || undefined, g.cables_error ?? '', L)}
</div>}
      {g.cables.length > 0 && <div style={failed ? { opacity: 0.6 } : undefined}><CableTable cables={g.cables} /></div>}
      <p className="muted small">{L(`이 게이트웨이의 보드 ${g.boards.length}개`, `${g.boards.length} boards on this gateway`)}{g.boards.length ? `: ${g.boards.map((b) => `${b.name}${b.cable_serial ? ` (${b.cable_serial})` : ''}${b.lent ? L(' · 대여 중', ' · lent') : ''}`).join(', ')}` : ''}</p>
      {adding && <PassthroughDialog g={g} onClose={() => setAdding(false)} onDone={(restart) => {
        setAdding(false);
        void act(async () => undefined, restart ? L('PCIe 컨트롤러는 게이트웨이 VM을 다시 시작해야 붙습니다.', 'The PCIe controller goes on after the gateway VM restarts.') : L('케이블을 넘겼습니다.', 'Cable passed through.'));
      }} />}
    </section>
  );
}

function CableTable({ cables }: { cables: GatewayCable[] }) {
  const { L } = useL();
  return (
    <div className="table-scroll"><table className="table compact-head">
      <thead><tr><th>{L('시리얼', 'Serial')}</th><th>VID:PID</th><th>{L('제조사 · 제품', 'Maker · product')}</th><th>{L('포트', 'Port')}</th><th>{L('보드', 'Board')}</th></tr></thead>
      <tbody>{cables.map((c) => (
        <tr key={`${c.port}-${c.serial}`}>
          <td><code className="code">{c.serial || '-'}</code></td>
          <td><code className="code">{c.vidpid}</code>{c.jtag && <span className="chip chip-accent chip-gap">JTAG</span>}</td>
          <td className="small">{[c.manufacturer, c.product].filter(Boolean).join(' · ')}</td>
          <td><code className="code">{c.port}</code></td>
          <td>{c.board ?? <span className="muted small">{c.jtag ? L('보드 없음 — 보드 탭에서 등록', 'no board - register on the Boards tab') : '-'}</span>}</td>
        </tr>))}</tbody>
    </table></div>
  );
}

function PassthroughDialog({ g, onClose, onDone }: { g: JtagGateway; onClose: () => void; onDone: (restart: boolean) => void }) {
  const { L } = useL();
  const [kind, setKind] = useState<'usb' | 'pci'>('usb');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await jtagApi.addPassthrough(g.id, kind === 'usb' ? { kind, usb: value } : { kind, pci: value });
      onDone(r.needs_restart);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L(`${g.name}에 넘기기`, `Pass through to ${g.name}`)} onClose={onClose} onSubmit={submit} submitLabel={L('넘기기', 'Pass through')} busy={busy || !value} error={error}>
      <div className="segmented" role="tablist">
        <button type="button" role="tab" className={kind === 'usb' ? 'on' : ''} aria-selected={kind === 'usb'} onClick={() => setKind('usb')}>{L('USB 장치 (케이블 하나)', 'USB device (one cable)')}</button>
        <button type="button" role="tab" className={kind === 'pci' ? 'on' : ''} aria-selected={kind === 'pci'} onClick={() => setKind('pci')}>{L('PCIe USB 컨트롤러 (권장)', 'PCIe USB controller (recommended)')}</button>
      </div>
      {kind === 'usb'
        ? <label><span>{L('USB (VID:PID 또는 포트 경로)', 'USB (vid:pid or port path)')}</span><input id="gwpt-usb" value={value} placeholder="03fd:0008 · 1-4.2" onChange={(e) => setValue(e.target.value.trim())} /></label>
        : <label><span>{L('컨트롤러 주소', 'Controller address')}</span><input id="gwpt-pci" value={value} placeholder="0000:05:00.0" onChange={(e) => setValue(e.target.value.trim())} /></label>}
      <p className="muted small">{kind === 'usb'
        ? L('같은 케이블이 여러 개면 포트 경로로 지정합니다.', 'Use a port path when several cables are alike.')
        : L('게이트웨이 VM을 다시 시작해야 붙습니다.', 'Goes on after the gateway VM restarts.')}</p>
    </Dialog>
  );
}

function GatewayDialog({ gw, onClose, onDone }: { gw: JtagGateway | null; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const clusters = useLoad(adminApi.clusters);
  const [cluster, setCluster] = useState(gw?.cluster_id ?? '');
  const cid = cluster || (clusters.state === 'ok' ? clusters.data[0]?.id ?? '' : '');
  const [name, setName] = useState(gw?.name ?? '');
  const [vmid, setVmid] = useState(gw?.vmid ? String(gw.vmid) : '');
  const [host, setHost] = useState(gw?.host ?? '');
  const [hwPort, setHwPort] = useState(String(gw?.hw_port ?? 3121));
  const [jtagdPort, setJtagdPort] = useState(String(gw?.jtagd_port ?? 1309));
  const [notes, setNotes] = useState(gw?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      await jtagApi.save(gw?.id ?? null, { name, cluster_id: cid, vmid: vmid ? Number(vmid) : null, host: host.trim(),
        hw_port: Number(hwPort) || 3121, jtagd_port: Number(jtagdPort) || 1309, notes });
      onDone();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  const digits = (v: string, n: number) => v.replace(/\D/g, '').slice(0, n);
  return (
    <Dialog open title={gw ? L('JTAG 게이트웨이 편집', 'Edit JTAG gateway') : L('JTAG 게이트웨이 추가', 'Add JTAG gateway')} onClose={onClose} onSubmit={submit}
      submitLabel={L('저장', 'Save')} busy={busy || !name || !host} error={error}>
      <label><span>{L('이름', 'Name')}</span><input id="jgw-name" value={name} maxLength={80} placeholder="jtag-gw-01" onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-row form-row-wide">
        <label><span>{L('클러스터', 'Cluster')}</span>
          <select id="jgw-cluster" value={cid} onChange={(e) => setCluster(e.target.value)}>{(clusters.state === 'ok' ? clusters.data : []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span>{L('게이트웨이 VM ID', 'Gateway VM id')}</span><input id="jgw-vmid" inputMode="numeric" value={vmid} placeholder="950" onChange={(e) => setVmid(digits(e.target.value, 9))} /></label>
      </div>
      <label><span>{L('데스크톱이 접속할 주소 (호스트 이름 또는 IP)', 'Address desktops dial (name or IP)')}</span><input id="jgw-host" value={host} maxLength={255} placeholder="jtag-gw-01.lab.local" onChange={(e) => setHost(e.target.value.trim())} /></label>
      <div className="form-row form-row-wide">
        <label><span>hw_server {L('포트', 'port')}</span><input id="jgw-hw" inputMode="numeric" value={hwPort} onChange={(e) => setHwPort(digits(e.target.value, 5))} /></label>
        <label><span>Quartus jtagd {L('포트', 'port')}</span><input id="jgw-jtagd" inputMode="numeric" value={jtagdPort} onChange={(e) => setJtagdPort(digits(e.target.value, 5))} /></label>
      </div>
      <label><span>{L('메모', 'Notes')}</span><input id="jgw-notes" value={notes} maxLength={300} placeholder={L('랙 B · PCIe USB 카드 · 전원 허브 2개', 'rack B · PCIe USB card · 2 powered hubs')} onChange={(e) => setNotes(e.target.value)} /></label>
      <p className="muted small">{L('VM ID가 있어야 케이블 넘기기 · 찾기 · 상태 감시가 됩니다.', 'The VM id is needed to pass, read and watch cables.')}</p>
    </Dialog>
  );
}
