import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { ApiError } from '../../api/client';
import { opsApi, type OpsTask } from '../../api/ops';
import type { AdminDesktop, PowerAction } from '../../api/types';
import { vmApi, type VmInfo, type VmSnapshot } from '../../api/vmManage';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { bytes } from './ClusterPages';
import { Caret, Drop, Modal, Usage } from './TableKit';
import { ManageTab, MoveTab, SettingsTab, useAdminConsole, type Notice } from './VmManage';

// 가상머신 > 데스크톱(VM) > (VM): one VM as a page - a summary strip with the ways in and the power and
// operations menus, then tabs for overview, compute, storage, network and snapshots · backups · tasks.

type Tab = 'overview' | 'compute' | 'storage' | 'network' | 'history';
const codeOf = (e: unknown) => ((e as ApiError).body as { code?: string } | undefined)?.code;

const OS: Record<string, string> = {
  win11: 'Windows 11', win10: 'Windows 10', win8: 'Windows 8', win7: 'Windows 7', w2k8: 'Windows 2008',
  wxp: 'Windows XP', l26: 'Linux', l24: 'Linux 2.4', solaris: 'Solaris', other: '기타',
};
export const osName = (t: string) => OS[t] ?? (t || '-');

function when(sec: number | null | undefined, lang: string) {
  if (!sec) return '-';
  return new Date(sec * 1000).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });
}

export function VmDetail({ deskId, onBack }: { deskId: string; onBack: () => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const vm = useLoad(useCallback(() => vmApi.vm(deskId), [deskId]), [deskId]);
  const desks = useLoad(adminApi.desktops);
  const [tab, setTab] = useState<Tab>('overview');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sub, setSub] = useState<null | 'move' | 'manage'>(null);
  const [busy, setBusy] = useState(false);
  const adminConsole = useAdminConsole(useCallback((text: string) => setNotice({ kind: 'error', text }), []));
  const desk: AdminDesktop | undefined = desks.state === 'ok' ? desks.data.find((d) => d.id === deskId) : undefined;
  const reload = () => { vm.reload(); desks.reload(); };
  const changed = (n: Notice) => { setNotice(n); reload(); };

  const powerLabel: Record<PowerAction, string> = {
    start: L('시작', 'Start'), shutdown: L('종료', 'Shut down'), reboot: L('다시 시작', 'Reboot'), stop: L('강제 끄기', 'Power off'),
  };
  async function power(name: string, action: PowerAction) {
    if (action !== 'start' && !window.confirm(L(`'${name}'을(를) ${powerLabel[action]}할까요?`, `${powerLabel[action]} '${name}'?`))) return;
    setBusy(true); setNotice(null);
    try {
      await adminApi.powerDesktop(deskId, action);
      setNotice({ kind: 'info', text: L(`${powerLabel[action]} 요청했습니다.`, `${powerLabel[action]} requested.`) });
    } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    setBusy(false);
    reload(); window.setTimeout(reload, 2500);
  }

  const tabs: [Tab, string][] = [['overview', L('개요', 'Overview')], ['compute', L('컴퓨트', 'Compute')], ['storage', L('스토리지', 'Storage')],
    ['network', L('네트워크', 'Network')], ['history', L('스냅샷 · 백업 · 작업', 'Snapshots · backups · tasks')]];

  return (
    <div className="vd">
      <button type="button" className="vd-back" onClick={onBack}><Icon name="chevron" size={14} />{L('데스크톱(VM) 목록', 'VM list')}</button>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      <LoadState value={vm} retry={vm.reload}>
        {(v) => {
          const on = v.status === 'running';
          const u = desk?.usage;
          const memPct = u && on && u.maxmem ? (u.mem / u.maxmem) * 100 : null;
          const phase = desk?.state === 'in_use' ? 'in_use' : on ? 'running' : 'stopped';
          return (
            <>
              <section className="vd-head">
                <div className="vd-title">
                  <span className="vd-icon" aria-hidden="true"><Icon name="vm" size={20} /></span>
                  <NameEdit v={v} onSaved={(name) => changed({ kind: 'info', text: L(`이름을 '${name}'(으)로 바꿨습니다.`, `Renamed to '${name}'.`) })}
                    onError={(text) => setNotice({ kind: 'error', text })} />
                  <span className={`vt-st vt-st-${phase}`}>{phase === 'in_use' ? L('사용 중', 'In use') : on ? L('실행 중', 'Running') : L('꺼짐', 'Stopped')}</span>
                  <div className="vd-actions">
                    <Drop className="btn primary" align="right" label={<><Icon name="play" size={15} />{L('원격 접속', 'Connect')}<Caret /></>}>
                      {(close) => (
                        <>
                          <button type="button" role="menuitem" disabled={!on} onClick={() => { close(); adminConsole.start({ id: deskId, name: v.name }); }}>
                            <Icon name="vm" size={16} />{L('브라우저 콘솔', 'Browser console')}</button>
                          <p className="vt-menu-note">{on ? L('관리자 지원용 · 감사 기록에 남음', 'For support · audited') : L('켜져 있을 때 열립니다.', 'Opens while it runs.')}</p>
                        </>
                      )}
                    </Drop>
                    <Drop className="btn" disabled={busy} label={<><Icon name="power" size={15} />{L('전원', 'Power')}<Caret /></>}>
                      {(close) => (
                        <>
                          <button type="button" role="menuitem" disabled={on} onClick={() => { close(); void power(v.name, 'start'); }}>{powerLabel.start}</button>
                          <button type="button" role="menuitem" disabled={!on} onClick={() => { close(); void power(v.name, 'shutdown'); }}>{powerLabel.shutdown}</button>
                          <button type="button" role="menuitem" disabled={!on} onClick={() => { close(); void power(v.name, 'reboot'); }}>{powerLabel.reboot}</button>
                          <button type="button" role="menuitem" className="danger" disabled={!on} onClick={() => { close(); void power(v.name, 'stop'); }}>{powerLabel.stop}</button>
                        </>
                      )}
                    </Drop>
                    <Drop className="btn" label={<><Icon name="gear" size={15} />{L('운영', 'Operate')}<Caret /></>}>
                      {(close) => (
                        <>
                          <button type="button" role="menuitem" onClick={() => { close(); setSub('move'); }}>{L('노드 이동', 'Move to node')}</button>
                          <button type="button" role="menuitem" onClick={() => { close(); setTab('history'); }}>{L('스냅샷 · 백업', 'Snapshots · backups')}</button>
                          <hr className="vt-sep" />
                          <button type="button" role="menuitem" onClick={() => { close(); setSub('manage'); }}>{L('템플릿으로 변환', 'Make template')}</button>
                          <button type="button" role="menuitem" className="danger" onClick={() => { close(); setSub('manage'); }}>{L('VM 삭제', 'Delete VM')}</button>
                        </>
                      )}
                    </Drop>
                  </div>
                </div>
                <dl className="vd-strip">
                  <div><dt>VMID</dt><dd className="vd-num">{v.vmid}</dd></div>
                  <div><dt>{L('노드', 'Node')}</dt><dd>{v.node}</dd></div>
                  <div><dt>OS</dt><dd>{osName(v.ostype)}<span className="muted small"> · {v.type === 'qemu' ? 'VM' : 'LXC'}</span></dd></div>
                  <div><dt>{L('풀 · 사용자', 'Pool · user')}</dt><dd>{desk?.pool_id ? <Link to={`/admin/pools/list/${desk.pool_id}`}>{desk.pool}</Link> : '-'}
                    <span className="muted"> · {desk?.assigned_user ?? L('미배정', 'none')}</span></dd></div>
                  <div><dt>IP</dt><dd className="vd-num">{v.ips?.length ? v.ips[0] : <span className="muted">{on ? L('에이전트 없음', 'No agent') : '-'}</span>}
                    {v.ips && v.ips.length > 1 && <span className="muted small" title={v.ips.join(', ')}> +{v.ips.length - 1}</span>}</dd></div>
                  <div className="vd-wide"><dt>CPU</dt><dd><Usage main={`${v.cores * v.sockets} vCPU`} pct={u && on ? u.cpu_percent : null} /></dd></div>
                  <div className="vd-wide"><dt>{L('메모리', 'Memory')}</dt><dd><Usage main={bytes(v.memory_mb * 1024 ** 2)} pct={memPct} /></dd></div>
                </dl>
              </section>

              <nav className="page-tabs vd-tabs" role="tablist">
                {tabs.map(([id, label]) => (
                  <a key={id} href="#" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''}
                    onClick={(e) => { e.preventDefault(); setTab(id); }}>{label}</a>
                ))}
              </nav>

              <div className="vd-body">
                {tab === 'overview' && <Overview v={v} desk={desk} onTab={setTab} />}
                {(tab === 'compute' || tab === 'storage' || tab === 'network') && (
                  <div className="vd-card">
                    <SettingsTab key={tab} v={v} part={tab} onNotice={setNotice} onChanged={changed} />
                    {tab === 'compute' && <Devices v={v} />}
                  </div>
                )}
                {tab === 'history' && (
                  <>
                    <Snapshots v={v} onNotice={setNotice} onChanged={changed} />
                    <Backups v={v} desk={desk} onNotice={setNotice} />
                    <Tasks v={v} clusterId={desk?.cluster_id} />
                  </>
                )}
              </div>

              {sub && <SubDialog title={sub === 'move' ? L('노드 이동', 'Move to node') : L('템플릿 · 삭제', 'Template · delete')} onClose={() => setSub(null)}>
                {sub === 'move' ? <MoveTab v={v} onNotice={setNotice} onChanged={(n) => { setSub(null); changed(n); }} />
                  : <ManageTab v={v} name={v.name} onNotice={setNotice} onGone={(text) => { setSub(null); setNotice({ kind: 'info', text }); onBack(); }} />}
              </SubDialog>}
            </>
          );
        }}
      </LoadState>
      {adminConsole.view}
    </div>
  );
}

function SubDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { pick } = useI18n();
  return (
    <Modal title={title} onClose={onClose} actions={<button type="button" className="btn" onClick={onClose}>{pick({ ko: '닫기', en: 'Close' })}</button>}>
      <div className="vmm-body vd-sub">{children}</div>
    </Modal>
  );
}

function NameEdit({ v, onSaved, onError }: { v: VmInfo; onSaved: (name: string) => void; onError: (t: string) => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(v.name);
  const [busy, setBusy] = useState(false);
  const ok = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/.test(name);
  useEffect(() => setName(v.name), [v.name]);
  if (!edit) return (
    <h2 className="vd-name">{v.name}
      <button type="button" className="vd-pen" aria-label={L('이름 바꾸기', 'Rename')} title={L('이름 바꾸기', 'Rename')} onClick={() => setEdit(true)}>✎</button>
    </h2>
  );
  const save = async () => {
    if (!ok || name === v.name) { setEdit(false); return; }
    setBusy(true);
    try { await vmApi.setHardware(v.desktop_id, { name }); setEdit(false); onSaved(name); } catch (e) { onError((e as Error).message); }
    setBusy(false);
  };
  return (
    <form className="vd-name-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <input autoFocus value={name} maxLength={63} aria-invalid={!ok} aria-label={L('VM 이름', 'VM name')}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setName(v.name); setEdit(false); } }} />
      <button type="submit" className="btn primary small-btn" disabled={busy || !ok}>{L('저장', 'Save')}</button>
      <button type="button" className="btn-ghost small-btn" onClick={() => { setName(v.name); setEdit(false); }}>{L('취소', 'Cancel')}</button>
      {!ok && <span className="small danger-text">{L('영문 · 숫자 · - . 만', 'Letters, digits, - . only')}</span>}
    </form>
  );
}

function Overview({ v, desk, onTab }: { v: VmInfo; desk?: AdminDesktop; onTab: (t: Tab) => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const disk = v.disks.reduce((n, d) => n + d.size_gb, 0);
  const Card = ({ title, tab, children }: { title: string; tab: Tab; children: ReactNode }) => (
    <section className="vd-card">
      <header><h3>{title}</h3><button type="button" className="vt-link" onClick={() => onTab(tab)}>{L('자세히', 'More')}</button></header>
      {children}
    </section>
  );
  return (
    <div className="vd-grid">
      <Card title={L('컴퓨트', 'Compute')} tab="compute">
        <dl className="vd-kv">
          <dt>vCPU</dt><dd>{v.cores * v.sockets} <span className="muted small">({v.sockets} × {v.cores}, {v.cpu || '-'})</span></dd>
          <dt>{L('메모리', 'Memory')}</dt><dd>{bytes(v.memory_mb * 1024 ** 2)}</dd>
          <dt>{L('장치', 'Devices')}</dt><dd>{v.passthrough.length ? v.passthrough.map((p) => p.key).join(', ') : L('없음', 'None')}</dd>
        </dl>
      </Card>
      <Card title={L('스토리지', 'Storage')} tab="storage">
        <dl className="vd-kv">
          <dt>{L('디스크', 'Disks')}</dt><dd>{v.disks.length}{L('개', '')} · {disk} GB</dd>
          {v.disks.slice(0, 3).map((d) => <Fragment key={d.key}><dt><code className="code">{d.key}</code></dt><dd>{d.storage} · {d.size_gb} GB</dd></Fragment>)}
        </dl>
      </Card>
      <Card title={L('네트워크', 'Network')} tab="network">
        <dl className="vd-kv">
          {v.networks.map((n) => <Fragment key={n.key}><dt><code className="code">{n.key}</code></dt>
            <dd>{n.bridge}{n.tag ? ` · VLAN ${n.tag}` : ''} <span className="muted small">{n.mac}</span></dd></Fragment>)}
          <dt>IP</dt><dd>{v.ips?.length ? v.ips.join(', ') : '-'}</dd>
        </dl>
      </Card>
      <Card title={L('데스크톱', 'Desktop')} tab="history">
        <dl className="vd-kv">
          <dt>{L('풀', 'Pool')}</dt><dd>{desk?.pool ?? '-'}</dd>
          <dt>{L('사용자', 'User')}</dt><dd>{desk?.assigned_user ?? L('미배정', 'none')}</dd>
          <dt>{L('기준 스냅샷', 'Base snapshot')}</dt><dd>{v.base_snap || L('없음', 'None')}</dd>
          <dt>{L('잠금', 'Lock')}</dt><dd>{v.lock || L('없음', 'None')}</dd>
        </dl>
      </Card>
    </div>
  );
}

function Devices({ v }: { v: VmInfo }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  return (
    <section className="vmm-sec">
      <h3>{L('GPU · 패스스루 장치', 'GPU · passthrough')}</h3>
      {v.passthrough.length === 0 ? <p className="muted small">{L('연결된 장치가 없습니다. GPU는 풀 설정 › GPU에서 정합니다.', 'None. GPUs are set in the pool settings › GPU.')}</p> : (
        <table className="table vt-table"><tbody>
          {v.passthrough.map((p) => <tr key={p.key}><td><code className="code">{p.key}</code></td><td className="small">{p.value}</td></tr>)}
        </tbody></table>
      )}
    </section>
  );
}

function Snapshots({ v, onNotice, onChanged }: { v: VmInfo; onNotice: (n: Notice | null) => void; onChanged: (n: Notice) => void }) {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const list = useLoad(useCallback(() => vmApi.snapshots(v.desktop_id), [v.desktop_id]), [v.desktop_id]);
  const [taking, setTaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = (text: string) => { list.reload(); onChanged({ kind: 'info', text }); };

  async function rollback(s: VmSnapshot) {
    if (!window.confirm(L(`'${s.name}'(으)로 되돌릴까요? 그 뒤의 변경은 사라집니다.`, `Roll back to '${s.name}'? Later changes are lost.`))) return;
    setBusy(true); onNotice(null);
    try {
      try { await vmApi.rollback(v.desktop_id, s.name); } catch (e) {
        if (codeOf(e) !== 'IN_USE' || !window.confirm(L('접속 중인 사용자가 있습니다. 연결을 끊고 되돌릴까요?', 'Someone is connected. Disconnect them and roll back?'))) throw e;
        await vmApi.rollback(v.desktop_id, s.name, true);
      }
      done(L(`'${s.name}'(으)로 되돌렸습니다.`, `Rolled back to '${s.name}'.`));
    } catch (e) { onNotice({ kind: 'error', text: (e as Error).message }); }
    setBusy(false);
  }
  async function remove(s: VmSnapshot) {
    const warn = s.base ? L(' 풀 초기화의 기준이라 지우면 초기화가 멈춥니다.', ' It is what pool resets go back to.') : '';
    if (!window.confirm(L(`스냅샷 '${s.name}'을(를) 지울까요?${warn}`, `Delete snapshot '${s.name}'?${warn}`))) return;
    setBusy(true); onNotice(null);
    try { await vmApi.deleteSnapshot(v.desktop_id, s.name); done(L(`'${s.name}'을(를) 지웠습니다.`, `'${s.name}' deleted.`)); }
    catch (e) { onNotice({ kind: 'error', text: (e as Error).message }); }
    setBusy(false);
  }

  return (
    <section className="vd-card">
      <header>
        <h3>{L('스냅샷', 'Snapshots')}</h3>
        <button type="button" className="btn primary small-btn" onClick={() => setTaking(true)}><Icon name="plus" size={14} />{L('스냅샷 만들기', 'Take snapshot')}</button>
      </header>
      <LoadState value={list} retry={list.reload}>
        {({ snapshots, current }) => snapshots.length === 0 ? <p className="muted small">{L('스냅샷이 없습니다.', 'No snapshots.')}</p> : (
          <div className="table-scroll">
            <table className="table vt-table">
              <thead><tr><th>{L('이름', 'Name')}</th><th>{L('만든 때', 'Taken')}</th><th>{L('설명', 'Description')}</th><th /><th className="vt-actions-h">{L('작업', 'Actions')}</th></tr></thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.name}>
                    <td className="nowrap"><span className="strong">{s.name}</span>
                      {s.base && <span className="vt-st vd-tag">{L('초기화 기준', 'Base')}</span>}
                      {s.vmstate && <span className="vt-st vd-tag">{L('메모리 포함', 'With memory')}</span>}</td>
                    <td className="nowrap muted small">{when(s.time, lang)}</td>
                    <td className="small">{s.description || <span className="muted">-</span>}</td>
                    <td className="nowrap">{current === s.name && <span className="vt-st vt-st-running">◉ {L('현재 위치', 'You are here')}</span>}</td>
                    <td className="vt-actions">
                      <button type="button" className="vt-link" disabled={busy} onClick={() => rollback(s)}>{L('되돌리기', 'Roll back')}</button>
                      <button type="button" className="vt-link danger-text" disabled={busy} onClick={() => remove(s)}>{L('삭제', 'Delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </LoadState>
      {taking && <TakeSnapshot v={v} onClose={() => setTaking(false)} onDone={(name) => { setTaking(false); done(L(`'${name}' 스냅샷을 만들었습니다.`, `Snapshot '${name}' taken.`)); }} />}
    </section>
  );
}

function TakeSnapshot({ v, onClose, onDone }: { v: VmInfo; onClose: () => void; onDone: (name: string) => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [mem, setMem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const on = v.status === 'running';
  const ok = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/.test(name) && name !== 'vlab-base';
  const take = async () => {
    setBusy(true); setErr('');
    try { await vmApi.takeSnapshot(v.desktop_id, { name, description: desc, vmstate: on && mem }); onDone(name); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title={L('스냅샷 만들기', 'Take a snapshot')} onClose={onClose} actions={(
      <>
        <button type="button" className="btn" onClick={onClose}>{L('취소', 'Cancel')}</button>
        <button type="submit" form="vd-snap-form" className="btn primary" disabled={busy || !ok}>{busy ? L('만드는 중…', 'Taking…') : L('만들기', 'Take')}</button>
      </>
    )}>
      <form id="vd-snap-form" className="form" onSubmit={(e) => { e.preventDefault(); if (ok) void take(); }}>
        <label>{L('이름', 'Name')} *
          <input autoFocus required value={name} maxLength={40} placeholder="before-update" aria-invalid={!!name && !ok} onChange={(e) => setName(e.target.value)} />
          <span className="muted small">{L('영문자로 시작, 영문 · 숫자 · - _ .', 'Starts with a letter; letters, digits, - _ .')}</span>
        </label>
        <label>{L('설명', 'Description')}<input value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} /></label>
        {on && (
          <label className="check"><input type="checkbox" checked={mem} disabled={v.passthrough.length > 0} onChange={(e) => setMem(e.target.checked)} />
            {L('메모리 포함 (켜진 상태 그대로 되돌림)', 'Include memory (roll back to the running state)')}</label>
        )}
        {err && <div className="alert small error" role="alert">{err}</div>}
      </form>
    </Modal>
  );
}

function Backups({ v, desk, onNotice }: { v: VmInfo; desk?: AdminDesktop; onNotice: (n: Notice | null) => void }) {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const list = useLoad(useCallback(() => adminApi.desktopBackups(v.desktop_id), [v.desktop_id]), [v.desktop_id]);
  const cid = desk?.cluster_id ?? '';
  const stores = useLoad(useCallback(() => (cid ? adminApi.backupStorages(cid) : Promise.resolve([])), [cid]), [cid]);
  const [storage, setStorage] = useState('');
  const [busy, setBusy] = useState(false);
  const opts = stores.state === 'ok' ? stores.data : [];
  const pickStore = storage || opts.find((s) => s.pbs)?.storage || opts[0]?.storage || '';

  async function run(fn: () => Promise<void>, text: string) {
    setBusy(true); onNotice(null);
    try { await fn(); onNotice({ kind: 'info', text }); list.reload(); } catch (e) { onNotice({ kind: 'error', text: (e as Error).message }); }
    setBusy(false);
  }
  return (
    <section className="vd-card">
      <header>
        <h3>{L('백업', 'Backups')}</h3>
        <span className="vd-head-tools">
          {opts.length > 0 && (
            <select value={pickStore} onChange={(e) => setStorage(e.target.value)} aria-label={L('백업 저장소', 'Backup storage')}>
              {opts.map((s) => <option key={s.storage} value={s.storage}>{s.storage}{s.pbs ? ' (PBS)' : ''}</option>)}
            </select>
          )}
          <button type="button" className="btn small-btn" disabled={busy || !pickStore}
            onClick={() => run(() => adminApi.backupNow(v.desktop_id, pickStore, 'snapshot'), L('백업을 시작했습니다. 작업 기록에서 진행을 봅니다.', 'Backup started. See the tasks below.'))}>
            {L('지금 백업', 'Back up now')}</button>
        </span>
      </header>
      <LoadState value={list} retry={list.reload}>
        {(rows) => rows.length === 0 ? <p className="muted small">{L('백업이 없습니다.', 'No backups.')}</p> : (
          <div className="table-scroll">
            <table className="table vt-table">
              <thead><tr><th>{L('만든 때', 'Taken')}</th><th>{L('저장소', 'Storage')}</th><th className="num">{L('크기', 'Size')}</th><th>{L('메모', 'Notes')}</th><th className="vt-actions-h">{L('작업', 'Actions')}</th></tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.volid}>
                    <td className="nowrap">{when(b.ctime, lang)}{b.protected ? <span className="vt-st vd-tag">{L('보호', 'Protected')}</span> : null}</td>
                    <td className="nowrap small">{b.storage ?? b.volid.split(':')[0]}</td>
                    <td className="num nowrap">{b.size ? bytes(b.size) : '-'}</td>
                    <td className="small">{b.notes || <span className="muted">-</span>}</td>
                    <td className="vt-actions">
                      <button type="button" className="vt-link" disabled={busy} onClick={() => {
                        if (!window.confirm(L('이 백업으로 VM을 덮어씁니다. 지금 디스크 내용은 사라집니다. 복원할까요?', 'Overwrite the VM with this backup? Its current disks are lost.'))) return;
                        void run(async () => {
                          try { await adminApi.restoreBackup(v.desktop_id, b.volid); } catch (e) {
                            if (codeOf(e) !== 'IN_USE' || !window.confirm(L('접속 중인 사용자가 있습니다. 끊고 복원할까요?', 'Someone is connected. Disconnect and restore?'))) throw e;
                            await adminApi.restoreBackup(v.desktop_id, b.volid, true);
                          }
                        }, L('복원을 시작했습니다.', 'Restore started.'));
                      }}>{L('복원', 'Restore')}</button>
                      <button type="button" className="vt-link danger-text" disabled={busy || !!b.protected} onClick={() => {
                        if (!window.confirm(L('이 백업을 지울까요? 되돌릴 수 없습니다.', 'Delete this backup? This cannot be undone.'))) return;
                        void run(() => adminApi.deleteBackup(v.desktop_id, b.volid), L('백업을 지웠습니다.', 'Backup deleted.'));
                      }}>{L('삭제', 'Delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </LoadState>
    </section>
  );
}

function Tasks({ v, clusterId }: { v: VmInfo; clusterId?: string }) {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const tasks = useLoad(useCallback(() => opsApi.tasks(200), []));
  const mine = (t: OpsTask) => t.vmid === v.vmid && (!clusterId || t.cluster_id === clusterId);
  return (
    <section className="vd-card">
      <header><h3>{L('최근 작업', 'Recent tasks')}</h3><button type="button" className="vt-link" onClick={tasks.reload}>{L('새로 고침', 'Refresh')}</button></header>
      <LoadState value={tasks} retry={tasks.reload}>
        {(list) => {
          const rows = list.tasks.filter(mine).slice(0, 15);
          return rows.length === 0 ? <p className="muted small">{L('최근 작업이 없습니다.', 'No recent tasks.')}</p> : (
            <div className="table-scroll">
              <table className="table vt-table">
                <thead><tr><th>{L('시작', 'Started')}</th><th>{L('작업', 'Task')}</th><th>{L('노드', 'Node')}</th><th>{L('사용자', 'User')}</th><th>{L('결과', 'Result')}</th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.upid}>
                      <td className="nowrap muted small">{when(t.starttime, lang)}</td>
                      <td className="nowrap"><code className="code">{t.type}</code></td>
                      <td>{t.node}</td>
                      <td className="small">{t.user}</td>
                      <td>{t.running ? <span className="vt-st vt-st-in_use">{t.percent != null ? `${Math.round(t.percent)}%` : L('진행 중', 'Running')}</span>
                        : <span className={`vt-st ${t.ok ? 'vt-st-running' : 'vt-st-error'}`} title={t.status}>{t.ok ? 'OK' : L('실패', 'Failed')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </LoadState>
      <HowTo><p>{L('이 VM의 Proxmox 작업 중 최근 것만 보입니다. 전체는 모니터링 › 작업 진행에서 봅니다.', "Only this VM's recent Proxmox tasks. All of them are in Monitoring › Tasks.")}</p></HowTo>
    </section>
  );
}
