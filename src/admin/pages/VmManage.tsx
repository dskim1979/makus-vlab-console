import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import type { Clipboard } from '../../api/types';
import { vmApi, type VmInfo, type VmNic, type VmSnapshot } from '../../api/vmManage';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { bytes } from './ClusterPages';

const ConsoleWindow = lazy(() => import('../../portal/ConsoleWindow'));

export type ManagedDesktop = { id: string; name: string };
type Notice = { kind: 'info' | 'error'; text: string };
type Tab = 'settings' | 'snapshots' | 'move' | 'manage';

const codeOf = (e: unknown) => ((e as ApiError).body as { code?: string } | undefined)?.code;
const L2 = (pick: (x: { ko: string; en: string }) => string) => (ko: string, en: string) => pick({ ko, en });

// 관리자가 데스크톱 화면 열기 (사용자 지원): the engine answers like the portal's connect and
// writes the opening into the audit log.
export function useAdminConsole(onError: (text: string) => void) {
  const { pick } = useI18n();
  const L = L2(pick);
  const [open, setOpen] = useState<{ title: string; wsPath: string; password: string; clipboard: Clipboard } | null>(null);
  const start = useCallback(async (d: ManagedDesktop) => {
    try {
      const c = await vmApi.console(d.id);
      setOpen({ title: `${d.name} · ${L('관리자 지원', 'Support')}`, wsPath: c.ws_path, password: c.password, clipboard: c.clipboard });
    } catch (e) {
      onError(codeOf(e) === 'VM_STOPPED' ? L(`'${d.name}'이(가) 꺼져 있어 화면을 열 수 없습니다.`, `'${d.name}' is not running.`) : (e as Error).message);
    }
  }, [onError]);   // eslint-disable-line react-hooks/exhaustive-deps
  const view = open ? (
    <Suspense fallback={null}>
      <ConsoleWindow title={open.title} wsPath={open.wsPath} password={open.password} clipboard={open.clipboard} onClose={() => setOpen(null)} />
    </Suspense>
  ) : null;
  return { start, view };
}

// 가상머신 > 데스크톱(VM) 관리 > (데스크톱): the VM's settings, snapshots, moving it, and
// making it a template or deleting it. Changes say when they need a restart.
export function VmManageDialog({ desk, onClose, onChanged, onGone, onConsole }: {
  desk: ManagedDesktop; onClose: () => void; onChanged: () => void;
  onGone: (text: string) => void;   // deleted or made a template: no desktop any more
  onConsole: (d: ManagedDesktop) => void;
}) {
  const { pick } = useI18n();
  const L = L2(pick);
  const ref = useRef<HTMLDialogElement>(null);
  const vm = useLoad(useCallback(() => vmApi.vm(desk.id), [desk.id]), [desk.id]);
  const [tab, setTab] = useState<Tab>('settings');
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);

  const changed = (n: Notice) => { setNotice(n); vm.reload(); onChanged(); };
  const tabs: [Tab, string][] = [['settings', L('설정', 'Settings')], ['snapshots', L('스냅샷', 'Snapshots')],
    ['move', L('노드 이동', 'Move')], ['manage', L('템플릿 · 삭제', 'Template · delete')]];

  return (
    <dialog ref={ref} className="dialog dialog-wide vmm" onClose={onClose} aria-label={desk.name}>
      <div className="vmm-head">
        <h2>{desk.name}</h2>
        {vm.state === 'ok' && (
          <span className="muted small">VMID {vm.data.vmid} · {vm.data.node} · <span className={`status st-${vm.data.status === 'running' ? 'ready' : 'stopped'}`}>
            <span className="dot" />{vm.data.status === 'running' ? L('켜짐', 'Running') : L('꺼짐', 'Stopped')}</span></span>
        )}
        <span className="vmm-head-actions">
          <button type="button" className="btn small-btn" disabled={vm.state !== 'ok' || vm.data.status !== 'running'}
            title={L('사용자 지원용으로 화면을 엽니다. 감사 기록에 남습니다.', 'Opens the screen to help the user. It is written into the audit log.')}
            onClick={() => { ref.current?.close(); onConsole(desk); }}>{L('화면 열기', 'Open screen')}</button>
          <button type="button" className="btn small-btn" onClick={() => ref.current?.close()}>{L('닫기', 'Close')}</button>
        </span>
      </div>
      <nav className="page-tabs vmm-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <a key={id} href="#" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''}
            onClick={(e) => { e.preventDefault(); setTab(id); setNotice(null); }}>{label}</a>
        ))}
      </nav>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      <LoadState value={vm} retry={vm.reload}>
        {(v) => (
          <div className="vmm-body">
            {tab === 'settings' && <SettingsTab v={v} onNotice={setNotice} onChanged={changed} />}
            {tab === 'snapshots' && <SnapshotsTab v={v} onNotice={setNotice} onChanged={changed} />}
            {tab === 'move' && <MoveTab v={v} onNotice={setNotice} onChanged={changed} />}
            {tab === 'manage' && <ManageTab v={v} name={desk.name} onNotice={setNotice}
              onGone={(n) => { onGone(n); ref.current?.close(); }} />}
          </div>
        )}
      </LoadState>
    </dialog>
  );
}

type TabProps = { v: VmInfo; onNotice: (n: Notice | null) => void; onChanged: (n: Notice) => void };

function useRun(onNotice: (n: Notice | null) => void) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<Notice | null>) => {
    setBusy(true); onNotice(null);
    try { const n = await fn(); if (n) onNotice(n); } catch (e) { onNotice({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  return { busy, run };
}

function SettingsTab({ v, onNotice, onChanged }: TabProps) {
  const { pick } = useI18n();
  const L = L2(pick);
  const { busy, run } = useRun(onNotice);
  const [cores, setCores] = useState(v.cores);
  const [sockets, setSockets] = useState(v.sockets);
  const [memGb, setMemGb] = useState(v.memory_mb / 1024);
  const [grow, setGrow] = useState<Record<string, number>>({});
  const [newStorage, setNewStorage] = useState(v.storages[0]?.storage ?? '');
  const [newSize, setNewSize] = useState(32);
  const restart = (r: { needs_restart: boolean }, what: string) => ({
    kind: 'info' as const,
    text: r.needs_restart ? L(`${what} 저장했습니다. 켜져 있는 VM이라 다시 시작해야 적용됩니다.`, `${what} saved. The VM is running: it applies after a restart.`)
      : L(`${what} 저장했습니다.`, `${what} saved.`),
  });
  const hwDirty = cores !== v.cores || sockets !== v.sockets || Math.round(memGb * 1024) !== v.memory_mb;

  return (
    <>
      <section className="vmm-sec">
        <h3>{L('CPU · 메모리', 'CPU · memory')}</h3>
        <div className="vmm-row">
          <label>{L('코어', 'Cores')}<input type="number" min={1} max={256} value={cores} onChange={(e) => setCores(Number(e.target.value))} /></label>
          {v.type === 'qemu' && <label>{L('소켓', 'Sockets')}<input type="number" min={1} max={8} value={sockets} onChange={(e) => setSockets(Number(e.target.value))} /></label>}
          <label>{L('메모리 (GB)', 'Memory (GB)')}<input type="number" min={0.25} step={0.25} value={memGb} onChange={(e) => setMemGb(Number(e.target.value))} /></label>
          <button type="button" className="btn primary small-btn" disabled={busy || !hwDirty}
            onClick={() => run(async () => {
              const r = await vmApi.setHardware(v.desktop_id, { cores, ...(v.type === 'qemu' ? { sockets } : {}), memory_mb: Math.round(memGb * 1024) });
              onChanged(restart(r, L('CPU · 메모리를', 'CPU and memory')));
              return null;
            })}>{L('저장', 'Save')}</button>
        </div>
        <p className="muted small">{L(`지금 ${v.cores * v.sockets} vCPU · ${v.memory_mb / 1024} GB. CPU 종류 ${v.cpu || '-'}, OS ${v.ostype || '-'}.`,
          `Now ${v.cores * v.sockets} vCPU · ${v.memory_mb / 1024} GB. CPU type ${v.cpu || '-'}, OS ${v.ostype || '-'}.`)}</p>
      </section>

      <section className="vmm-sec">
        <h3>{L('디스크', 'Disks')}</h3>
        <table className="table compact-head">
          <thead><tr><th>{L('장치', 'Device')}</th><th>{L('스토리지', 'Storage')}</th><th className="num">{L('크기', 'Size')}</th><th>{L('늘리기', 'Grow')}</th></tr></thead>
          <tbody>
            {v.disks.map((d) => (
              <tr key={d.key}>
                <td><code className="code">{d.key}</code></td>
                <td className="small">{d.storage}</td>
                <td className="num nowrap">{d.size_gb} GB</td>
                <td className="nowrap">
                  <span className="with-unit">
                    <input type="number" min={1} aria-label={`${d.key} +GB`} placeholder="+GB" value={grow[d.key] ?? ''}
                      onChange={(e) => setGrow((g) => ({ ...g, [d.key]: Number(e.target.value) }))} />
                    <button type="button" className="btn small-btn" disabled={busy || !(grow[d.key] > 0)}
                      onClick={() => run(async () => {
                        if (!window.confirm(L(`${d.key}을(를) ${grow[d.key]} GB 늘립니다. 디스크는 줄일 수 없습니다. 계속할까요?`,
                          `Grow ${d.key} by ${grow[d.key]} GB? A disk cannot be shrunk.`))) return null;
                        await vmApi.growDisk(v.desktop_id, d.key, grow[d.key]);
                        setGrow((g) => ({ ...g, [d.key]: 0 }));
                        onChanged({ kind: 'info', text: L(`${d.key}을(를) 늘렸습니다. 게스트 OS 안에서 파티션도 늘려 주세요.`, `${d.key} grown. Extend the partition inside the guest too.`) });
                        return null;
                      })}>{L('늘리기', 'Grow')}</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {v.type === 'qemu' && (
          <div className="vmm-row">
            <label>{L('새 디스크 스토리지', 'New disk on')}
              <select value={newStorage} onChange={(e) => setNewStorage(e.target.value)}>
                {v.storages.map((s) => <option key={s.storage} value={s.storage}>{s.storage} ({s.type}{s.avail ? `, ${bytes(s.avail)} ${L('남음', 'free')}` : ''})</option>)}
              </select>
            </label>
            <label>{L('크기 (GB)', 'Size (GB)')}<input type="number" min={1} value={newSize} onChange={(e) => setNewSize(Number(e.target.value))} /></label>
            <button type="button" className="btn small-btn" disabled={busy || !newStorage || !(newSize > 0)}
              onClick={() => run(async () => {
                const r = await vmApi.addDisk(v.desktop_id, newStorage, newSize);
                onChanged({ kind: 'info', text: L(`${r.disk} (${newSize} GB)를 추가했습니다.`, `${r.disk} (${newSize} GB) added.`) });
                return null;
              })}>{L('디스크 추가', 'Add disk')}</button>
          </div>
        )}
      </section>

      <section className="vmm-sec">
        <h3>{L('네트워크', 'Network')}</h3>
        {v.networks.length === 0 ? <p className="muted small">{L('네트워크 장치가 없습니다.', 'No network devices.')}</p>
          : v.networks.map((n) => <NicRow key={n.key} v={v} n={n} busy={busy}
            save={(bridge, tag) => run(async () => {
              const r = await vmApi.setNetwork(v.desktop_id, n.key, bridge, tag);
              onChanged(restart(r, L(`${n.key} 네트워크를`, `${n.key} network`)));
              return null;
            })} />)}
        {v.status === 'running' && <p className="muted small">{L('켜져 있는 VM은 CPU · 메모리 · 네트워크 변경이 다음 시작부터 적용될 수 있습니다.',
          'On a running VM, CPU, memory and network changes may only apply from the next start.')}</p>}
      </section>
    </>
  );
}

function NicRow({ v, n, busy, save }: { v: VmInfo; n: VmNic; busy: boolean; save: (bridge: string, tag: number | null) => void }) {
  const { pick } = useI18n();
  const L = L2(pick);
  const [bridge, setBridge] = useState(n.bridge);
  const [tag, setTag] = useState(n.tag === null ? '' : String(n.tag));
  const bridges = v.bridges.includes(n.bridge) ? v.bridges : [n.bridge, ...v.bridges];
  const tagNum = tag.trim() ? Number(tag) : null;
  const bad = tagNum !== null && !(Number.isInteger(tagNum) && tagNum >= 1 && tagNum <= 4094);
  return (
    <div className="vmm-row">
      <span className="vmm-nic"><code className="code">{n.key}</code><br /><span className="muted small">{n.model} · {n.mac}</span></span>
      <label>{L('브리지', 'Bridge')}
        <select value={bridge} onChange={(e) => setBridge(e.target.value)}>{bridges.map((b) => <option key={b} value={b}>{b}</option>)}</select>
      </label>
      <label>{L('VLAN 태그', 'VLAN tag')}
        <input inputMode="numeric" placeholder={L('없음', 'none')} value={tag} aria-invalid={bad} onChange={(e) => setTag(e.target.value)} />
      </label>
      <button type="button" className="btn small-btn" disabled={busy || bad || (bridge === n.bridge && tagNum === n.tag)}
        onClick={() => save(bridge, tagNum)}>{L('저장', 'Save')}</button>
    </div>
  );
}

function SnapshotsTab({ v, onNotice, onChanged }: TabProps) {
  const { pick, lang } = useI18n();
  const L = L2(pick);
  const snaps = useLoad(useCallback(() => vmApi.snapshots(v.desktop_id), [v.desktop_id]), [v.desktop_id]);
  const { busy, run } = useRun(onNotice);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [ram, setRam] = useState(false);
  const running = v.status === 'running';
  const when = (s: number | null) => (s ? new Date(s * 1000).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US') : '-');
  const done = (text: string) => { snaps.reload(); onChanged({ kind: 'info', text }); return null; };

  async function rollback(s: VmSnapshot) {
    if (!window.confirm(L(`'${s.name}'(으)로 되돌립니다. 그 뒤에 한 작업은 모두 사라집니다. 계속할까요?`,
      `Roll back to '${s.name}'? Everything done since is lost.`))) return;
    await run(async () => {
      try { await vmApi.rollback(v.desktop_id, s.name); } catch (e) {
        if (codeOf(e) !== 'IN_USE' || !window.confirm(L('지금 접속 중인 사용자가 있습니다. 연결을 끊고 되돌릴까요?', 'Someone is connected. Disconnect them and roll back?'))) throw e;
        await vmApi.rollback(v.desktop_id, s.name, true);
      }
      return done(L(`'${s.name}'(으)로 되돌렸습니다.`, `Rolled back to '${s.name}'.`));
    });
  }

  return (
    <>
      <section className="vmm-sec">
        <h3>{L('스냅샷 만들기', 'Take a snapshot')}</h3>
        <div className="vmm-row">
          <label>{L('이름', 'Name')}<input value={name} maxLength={40} placeholder="before-update" onChange={(e) => setName(e.target.value)} /></label>
          <label className="vmm-grow">{L('설명 (선택)', 'Description (optional)')}<input value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} /></label>
        </div>
        <div className="vmm-row">
          <label className="check"><input type="checkbox" checked={ram && running && !v.passthrough.length} disabled={!running || v.type !== 'qemu' || v.passthrough.length > 0} onChange={(e) => setRam(e.target.checked)} />
            {L('메모리 포함 (켜진 상태 그대로 되돌림)', 'Include memory (roll back to the running state)')}</label>
          <button type="button" className="btn primary small-btn" disabled={busy || !/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/.test(name)}
            onClick={() => run(async () => {
              await vmApi.takeSnapshot(v.desktop_id, { name, description: desc, vmstate: ram && running && !v.passthrough.length });
              setName(''); setDesc('');
              return done(L(`스냅샷 '${name}'을(를) 만들었습니다.`, `Snapshot '${name}' taken.`));
            })}>{L('만들기', 'Take')}</button>
        </div>
        <p className="muted small">{L('이름은 영문자로 시작하고 영문자 · 숫자 · - _ . 만 씁니다. GPU 패스스루 VM은 메모리 포함 스냅샷이 안 될 수 있습니다.',
          'A name starts with a letter and uses letters, digits, - _ . only. VMs with a passed-through GPU may refuse a snapshot with memory.')}
          {v.passthrough.length > 0 && L(' 이 VM은 패스스루 장치가 있어 메모리 포함 스냅샷을 만들 수 없습니다(되돌리면 카드 상태가 맞지 않음).', ' This VM has a passthrough device, so a snapshot with memory is not possible (a rollback would not match the card).')}</p>
      </section>
      <LoadState value={snaps} retry={snaps.reload}>
        {({ snapshots }) => snapshots.length === 0 ? <div className="empty"><p>{L('스냅샷이 없습니다.', 'No snapshots.')}</p></div> : (
          <table className="table compact-head">
            <thead><tr><th>{L('이름', 'Name')}</th><th>{L('만든 때', 'Taken')}</th><th>{L('설명', 'Description')}</th><th /></tr></thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.name}>
                  <td className="nowrap"><span className="strong">{s.name}</span>
                    {s.base && <span className="chip chip-base" title={L('초기화가 돌아가는 기준', 'What a reset goes back to')}>{L('기준', 'Base')}</span>}
                    {s.vmstate && <span className="chip chip-accent vmm-chip">RAM</span>}</td>
                  <td className="small nowrap">{when(s.time)}</td>
                  <td className="small">{s.description || <span className="muted">-</span>}</td>
                  <td className="nowrap">
                    <button type="button" className="btn-ghost" disabled={busy} onClick={() => rollback(s)}>{L('되돌리기', 'Roll back')}</button>
                    <button type="button" className="btn-ghost danger" disabled={busy} onClick={() => {
                      const msg = s.base
                        ? L(`'${s.name}'은(는) 이 데스크톱의 초기화 기준입니다. 지우면 기준을 다시 잡을 때까지 초기화할 수 없습니다. 삭제할까요?`,
                          `'${s.name}' is the desktop's reset base. Without it the desktop cannot be reset until a new base is taken. Delete it?`)
                        : L(`스냅샷 '${s.name}'을(를) 삭제할까요?`, `Delete snapshot '${s.name}'?`);
                      if (window.confirm(msg)) run(async () => { await vmApi.deleteSnapshot(v.desktop_id, s.name); return done(L(`'${s.name}'을(를) 삭제했습니다.`, `'${s.name}' deleted.`)); });
                    }}>{L('삭제', 'Delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LoadState>
    </>
  );
}

function MoveTab({ v, onNotice, onChanged }: TabProps) {
  const { pick } = useI18n();
  const L = L2(pick);
  const online = v.targets.filter((x) => x.online && !x.maintenance);
  const [picked, setTarget] = useState(online[0]?.node ?? '');
  // after a move the VM's node changed: a pick that is no target any more falls back
  const target = online.some((x) => x.node === picked) ? picked : (online[0]?.node ?? '');
  const [live, setLive] = useState(true);
  const [job, setJob] = useState<{ upid: string; to: string; started: number; status: string; exit: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const { busy, run } = useRun(onNotice);
  const running = v.status === 'running';

  useEffect(() => {
    if (!job || job.status === 'stopped') return;
    const id = window.setInterval(async () => {
      setNow(Date.now());
      try {
        const s = await vmApi.task(v.desktop_id, job.upid);
        if (s.status === 'stopped') {
          setJob((j) => j && { ...j, status: 'stopped', exit: s.exitstatus });
          onChanged(s.exitstatus === 'OK'
            ? { kind: 'info', text: L(`${job.to}(으)로 옮겼습니다.`, `Moved to ${job.to}.`) }
            : { kind: 'error', text: L(`이동 실패: ${s.exitstatus || '알 수 없음'}`, `Move failed: ${s.exitstatus || 'unknown'}`) });
        }
      } catch { /* the next tick asks again */ }
    }, 1500);
    return () => window.clearInterval(id);
  }, [job?.upid, job?.status]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (v.passthrough.length) {
    return (
      <div className="alert">
        <p className="strong">{L('이 VM은 노드를 옮길 수 없습니다.', 'This VM cannot move to another node.')}</p>
        <p>{L(`이 노드의 장치를 직접 쓰고 있습니다 (GPU · PCI · USB 패스스루). 장치를 빼거나 대상 노드에 같은 장치가 있게 한 뒤에 옮기세요.`,
          'It uses devices of this node directly (GPU, PCI or USB passthrough). Take them off, or have the same device on the target, first.')}</p>
        <ul className="vmm-list">{v.passthrough.map((p) => <li key={p.key}><code className="code">{p.key}</code> <span className="small">{p.value}</span></li>)}</ul>
      </div>
    );
  }
  const elapsed = job ? Math.round(((job.status === 'stopped' ? now : Date.now()) - job.started) / 1000) : 0;
  return (
    <section className="vmm-sec">
      <p className="small">{L(`지금 노드: ${v.node}`, `Now on: ${v.node}`)}</p>
      {v.targets.length === 0 ? <p className="muted small">{L('옮길 다른 노드가 없습니다.', 'There is no other node.')}</p> : (
        <div className="vmm-row">
          <label>{L('대상 노드', 'Target node')}
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {v.targets.map((x) => <option key={x.node} value={x.node} disabled={!x.online || x.maintenance}>
                {x.node}{!x.online ? ` (${L('꺼짐', 'offline')})` : x.maintenance ? ` (${L('점검 중', 'maintenance')})` : ''}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={live && running} disabled={!running} onChange={(e) => setLive(e.target.checked)} />
            {L('온라인 이동 (끄지 않고)', 'Online (keep it running)')}</label>
          <button type="button" className="btn primary small-btn" disabled={busy || !target || (!!job && job.status !== 'stopped')}
            onClick={() => run(async () => {
              if (running && !live && !window.confirm(L('VM을 끄고 옮깁니다. 접속 중인 사용자는 연결이 끊깁니다. 계속할까요?', 'The VM is stopped to move it. Anyone connected is disconnected. Continue?'))) return null;
              const r = await vmApi.migrate(v.desktop_id, target, live && running);
              if (r.task) { setNow(Date.now()); setJob({ upid: r.task, to: r.to, started: Date.now(), status: 'running', exit: '' }); return null; }
              onChanged({ kind: 'info', text: L(`${r.to}(으)로 이동을 시작했습니다.`, `Moving to ${r.to}.`) });
              return null;
            }).catch(() => undefined)}>{L('이동', 'Move')}</button>
        </div>
      )}
      {job && (
        <div className={`alert small ${job.status === 'stopped' ? (job.exit === 'OK' ? 'info' : 'error') : 'info'}`} role="status">
          {job.status !== 'stopped'
            ? <><span className="vmm-spin" aria-hidden />{L(`${job.to}(으)로 옮기는 중… ${elapsed}초`, `Moving to ${job.to}… ${elapsed}s`)}</>
            : job.exit === 'OK' ? L(`이동 완료 (${elapsed}초)`, `Moved (${elapsed}s)`) : L(`이동 실패: ${job.exit}`, `Failed: ${job.exit}`)}
        </div>
      )}
      <p className="muted small">{L('공유 스토리지(Ceph 등)에 있는 디스크는 그대로 두고 메모리만 옮깁니다. 로컬 디스크 VM은 Proxmox가 거절할 수 있습니다.',
        'Disks on shared storage (Ceph and the like) stay where they are; only memory moves. Proxmox may refuse a VM on local disks.')}</p>
    </section>
  );
}

function ManageTab({ v, name, onNotice, onGone }: { v: VmInfo; name: string; onNotice: (n: Notice | null) => void; onGone: (text: string) => void }) {
  const { pick } = useI18n();
  const L = L2(pick);
  const { busy, run } = useRun(onNotice);
  const [typed, setTyped] = useState('');
  const [inUse, setInUse] = useState(false);
  const [force, setForce] = useState(false);
  const stopped = v.status === 'stopped';

  return (
    <>
      <section className="vmm-sec">
        <h3>{L('템플릿으로 변환', 'Make it a template')}</h3>
        <p className="small">{L('이 VM을 템플릿으로 바꿉니다. 템플릿 관리에서 이것으로 새 데스크톱을 복제할 수 있습니다. 템플릿은 데스크톱이 아니므로 풀에서 빠지고, 배정된 사용자는 더 쓸 수 없습니다. 되돌릴 수 없습니다.',
          'Turns the VM into a template that 템플릿 관리 clones new desktops from. A template is no desktop: it leaves the pool and its user loses it. This cannot be undone.')}</p>
        {!stopped && <p className="muted small">{L('먼저 VM을 종료하세요.', 'Shut the VM down first.')}</p>}
        <button type="button" className="btn small-btn" disabled={busy || !stopped || v.type !== 'qemu'}
          onClick={() => {
            if (!window.confirm(L(`'${name}'을(를) 템플릿으로 바꾸고 풀에서 뺍니다. 계속할까요?`, `Make '${name}' a template and take it out of its pool?`))) return;
            run(async () => { await vmApi.toTemplate(v.desktop_id); onGone(L(`'${name}'이(가) 템플릿이 되었습니다.`, `'${name}' is a template now.`)); return null; });
          }}>{L('템플릿으로 변환', 'Make template')}</button>
      </section>
      <section className="vmm-sec vmm-danger">
        <h3>{L('VM 삭제', 'Delete the VM')}</h3>
        <p className="small">{L('Proxmox에서 VM과 디스크를 지우고 풀에서도 뺍니다. 되돌릴 수 없습니다. 확인을 위해 데스크톱 이름을 그대로 입력하세요.',
          'Deletes the VM and its disks on Proxmox and takes it out of its pool. This cannot be undone. Type the desktop name to confirm.')}</p>
        <div className="vmm-row">
          <label className="vmm-grow">{L(`'${name}' 입력`, `Type '${name}'`)}
            <input value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} /></label>
          <button type="button" className="btn danger small-btn" disabled={busy || typed !== name}
            onClick={() => run(async () => {
              try { await vmApi.deleteVm(v.desktop_id, typed, force); } catch (e) {
                if (codeOf(e) !== 'IN_USE') throw e;
                setInUse(true);
                return { kind: 'error', text: L('지금 접속 중인 사용자가 있습니다. 그래도 지우려면 아래를 체크하고 다시 누르세요.', 'Someone is connected. Tick the box below and press again to delete anyway.') };
              }
              onGone(L(`'${name}'을(를) 삭제했습니다.`, `'${name}' deleted.`));
              return null;
            })}>{L('영구 삭제', 'Delete for good')}</button>
        </div>
        {inUse && <label className="check"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          {L('접속 중이어도 삭제', 'Delete even though someone is connected')}</label>}
      </section>
    </>
  );
}
