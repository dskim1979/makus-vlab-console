import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { reclaimApi, RECLAIM_KINDS, type ApplyBody, type ReclaimAction, type ReclaimItem, type ReclaimKind, type ReclaimReport, type ReclaimSettings } from '../../api/reclaim';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { Caret, Drop, Modal, Pager } from './TableKit';

// 운영 > 자원 회수: what can be taken back - why, what it frees, the recommended step - one row
// each; 적용 runs that step (a delete asks for the name), 제외 keeps the item out of the list.

type Notice = { kind: 'info' | 'error'; text: string };
const DAYS = [7, 14, 30, 60, 90];
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

export function ReclaimPage() {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const KIND: Record<ReclaimKind, string> = {
    unused: L('안 쓰는 배정', 'Unused assignment'), oversized: L('큰 VM', 'Oversized'), stopped: L('오래 꺼짐', 'Long stopped'),
    orphan: L('풀 밖 VM', 'In no pool'), snapshot: L('오래된 스냅숏', 'Old snapshot'), loan: L('유휴 카드', 'Idle card'),
  };
  const [days, setDays] = useState(30);
  const [showExempt, setShowExempt] = useState(false);
  const rep = useLoad(() => reclaimApi.report(days, showExempt), [days, showExempt]);
  const [kind, setKind] = useState<'' | ReclaimKind>('');
  const [pool, setPool] = useState('');
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [doing, setDoing] = useState<{ it: ReclaimItem; a: ReclaimAction } | null>(null);
  const [weekly, setWeekly] = useState(false);
  const size = 20;

  const all = rep.state === 'ok' ? rep.data.items : [];
  const rows = useMemo(() => all.filter((i) => (!kind || i.kind === kind) && (!pool || (pool === '-' ? !i.pool_id : i.pool_id === pool))), [all, kind, pool]);
  useEffect(() => { setPage(0); }, [kind, pool, days, showExempt]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * size, cur * size + size);

  async function exempt(it: ReclaimItem, on: boolean) {
    setNotice(null);
    try {
      if (on) await reclaimApi.exempt(it.key, it.name);
      else await reclaimApi.unexempt(it.key);
      setNotice({ kind: 'info', text: on ? L(`${it.name}: 제외했습니다.`, `${it.name}: kept.`) : L(`${it.name}: 다시 목록에 넣었습니다.`, `${it.name}: listed again.`) });
      rep.reload();
    } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
  }

  const freeText = (i: ReclaimItem) => {
    const f = i.free; const out: string[] = [];
    if (f.vcpu) out.push(`${f.vcpu} vCPU`);
    if (f.ram_gb) out.push(`${f.ram_gb} GB`);
    if (f.disk_gb) out.push(L(`디스크 ${f.disk_gb} GB`, `disk ${f.disk_gb} GB`));
    if (f.cards) out.push(L(`카드 ${f.cards}`, `${f.cards} card`));
    if (f.seats) out.push(L('데스크톱 1대', '1 desktop'));
    return out;
  };

  return (
    <>
      <p className="muted small rc-lead">{L('쓰지 않는 자원을 찾아 돌려받습니다. 아무것도 저절로 바뀌지 않습니다.', 'Finds what sits unused. Nothing changes by itself.')}</p>
      <LoadState value={rep} retry={rep.reload}>
        {(d) => <Tiles d={d} L={L} />}
      </LoadState>

      <div className="vt-bar">
        <div className="vt-row">
          <select value={kind} onChange={(e) => setKind(e.target.value as '' | ReclaimKind)} aria-label={L('종류', 'Kind')}>
            <option value="">{L('종류 전체', 'All kinds')}</option>
            {RECLAIM_KINDS.map((k) => <option key={k} value={k}>{KIND[k]}{rep.state === 'ok' ? ` (${rep.data.counts[k]})` : ''}</option>)}
          </select>
          <select value={pool} onChange={(e) => setPool(e.target.value)} aria-label={L('풀', 'Pool')}>
            <option value="">{L('풀 전체', 'All pools')}</option>
            {(rep.state === 'ok' ? rep.data.pools : []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="-">{L('풀 밖', 'No pool')}</option>
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={L('기준 기간', 'Window')}>
            {DAYS.map((n) => <option key={n} value={n}>{L(`최근 ${n}일`, `Last ${n} days`)}</option>)}
          </select>
          <label className="rc-check"><input type="checkbox" checked={showExempt} onChange={(e) => setShowExempt(e.target.checked)} />
            {L('제외 항목도', 'Show kept')}{rep.state === 'ok' && rep.data.exempt_count ? ` (${rep.data.exempt_count})` : ''}</label>
          <button type="button" className="btn" onClick={rep.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
          <button type="button" className="btn vt-create" onClick={() => setWeekly(true)}>{L('주간 요약', 'Weekly summary')}</button>
        </div>
        <div className="vt-row">
          <HowTo>
            <ul>
              <li>{L('안 쓰는 배정: 배정된 사용자가 기준 기간 동안 접속하지 않은 데스크톱. 배정을 풀면 다른 사람이 씁니다.',
                'Unused assignment: the assigned user has not connected in the window. Unassign it so someone else can use it.')}</li>
              <li>{L('큰 VM: 크기 분석(평균 · p95 CPU, 평균 · 최대 메모리)이 줄여도 된다고 본 VM. 바꾼 크기는 다음 시작부터 적용됩니다.',
                'Oversized: right-sizing (mean / p95 CPU, mean / max memory) says it can be smaller. A new size applies from the next start.')}</li>
              <li>{L('오래 꺼짐: 기준 기간 동안 켜진 적 없이 디스크만 차지하는 VM. 측정 기록이 그만큼 쌓여야 셉니다.',
                'Long stopped: off for the whole window, still holding its disk. Counted once the metrics history is that long.')}</li>
              <li>{L('풀 밖 VM: 어느 풀에도 없고 골든 이미지 · JTAG 게이트웨이 · 라이선스 서버도 아닌 VM. 무엇인지 확인하고 지우거나 제외하세요.',
                'In no pool: not a desktop, golden image, JTAG gateway or licence server. Check what it is, then delete or keep it.')}</li>
              <li>{L('오래된 스냅숏: 기준 기간보다 오래된 스냅숏. 초기화 기준 스냅숏은 나오지 않습니다. PVE는 크기를 알려 주지 않습니다.',
                'Old snapshot: older than the window. Base snapshots are never listed. PVE does not report their size.')}</li>
              <li>{L('유휴 카드: 거의 안 쓰는 대여 카드(가속 자원 > 대여의 회수 규칙).', 'Idle card: a loaned card hardly used (the reclaim rule of card loans).')}</li>
              <li>{L('확인이 필요한 풀 밖 VM은 합계에 넣지 않습니다. 서비스 서버라면 제외하세요.', 'VMs in no pool to check are not in the totals. Keep (제외) service servers.')}</li>
              <li>{L('합계는 VM마다 한 번만 셉니다. "더 둘 수 있는 데스크톱"은 돌려받은 vCPU와 메모리에 데스크톱 표준 사양(중앙값)이 몇 대 들어가는지입니다.',
                'Totals count a VM once. "More desktops" is how many of the typical (median) desktop fit in the freed vCPU and memory.')}</li>
              <li>{L('적용은 항목 하나씩, 기존 기능으로 실행되고 작업 기록(감사)에 남습니다. 삭제는 이름을 다시 입력해야 합니다.',
                'Apply runs one item through the existing step and is in the audit log. A delete asks for the name.')}</li>
              <li>{L('제외하면 목록과 합계에서 빠집니다. "제외 항목도"를 켜고 제외 해제로 되돌립니다.',
                'Kept items leave the list and totals. Turn on "Show kept" to take one back.')}</li>
            </ul>
          </HowTo>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      {rep.state === 'ok' && rep.data.notes.length > 0 && <div className="alert small info">{rep.data.notes.join(' · ')}</div>}

      {rep.state === 'ok' && (rows.length === 0
        ? <div className="empty"><p>{all.length ? L('조건에 맞는 항목이 없습니다.', 'Nothing matches.') : L('지금은 회수할 자원이 없습니다.', 'Nothing to take back right now.')}</p></div>
        : (
          <>
            <div className="table-scroll">
              <table className="table vt-table rc-table">
                <thead>
                  <tr><th>{L('종류', 'Kind')}</th><th>{L('대상', 'Target')}</th><th>{L('이유', 'Why')}</th><th>{L('회수', 'Frees')}</th>
                    <th>{L('권고', 'Recommended')}</th><th className="vt-actions-h">{L('작업', 'Actions')}</th></tr>
                </thead>
                <tbody>
                  {shown.map((i) => {
                    const acts = [i.action, ...i.more].filter((a) => a.id !== 'review');
                    return (
                      <tr key={i.key} className={i.exempt ? 'vt-off' : ''}>
                        <td className="nowrap"><span className={`rc-kind rc-${i.kind}`}>{KIND[i.kind]}</span></td>
                        <td className="nowrap">
                          {i.vmid != null && i.kind !== 'loan' && <span className="vt-vm-id">{i.vmid}</span>} <span className="strong">{i.name}</span>
                          <div className="muted small">{[i.kind === 'loan' && i.desktop, i.pool ?? (i.kind === 'loan' ? null : L('풀 밖', 'no pool')), i.user].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="small rc-why">{i.reason}</td>
                        <td className="nowrap small">{freeText(i).length ? freeText(i).map((x) => <span key={x} className="rc-free">{x}</span>) : <span className="muted">-</span>}</td>
                        <td className="nowrap small">{i.action.id === 'review' ? <span className="muted">{L('확인 필요', 'Check it')}</span>
                          : <span className={i.action.destructive ? 'rc-danger' : ''}>{i.action.label}</span>}</td>
                        <td className="vt-actions">
                          {i.exempt ? <button type="button" className="vt-link" onClick={() => void exempt(i, false)}>{L('제외 해제', 'Take back')}</button> : (
                            <>
                              {i.action.id !== 'review' && <button type="button" className="btn small-btn primary" onClick={() => setDoing({ it: i, a: i.action })}>{L('적용', 'Apply')}</button>}
                              <button type="button" className="vt-link" onClick={() => void exempt(i, true)}>{L('제외', 'Keep')}</button>
                              {(acts.length > 1 || i.action.id === 'review') && acts.length > 0 && (
                                <Drop className="vt-more" label={<>{L('더보기', 'More')}<Caret /></>}>
                                  {(close) => acts.filter((a) => a !== i.action || i.action.id === 'review').map((a) => (
                                    <button key={a.id} type="button" role="menuitem" className={a.destructive ? 'danger' : ''}
                                      onClick={() => { close(); setDoing({ it: i, a }); }}>{a.label}</button>
                                  ))}
                                </Drop>
                              )}
                              {i.desktop_id && i.kind !== 'loan' && <Link className="vt-link" to={`/admin/vms/desktops/list?vm=${encodeURIComponent(i.desktop_id)}`}>{L('관리', 'Manage')}</Link>}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="vt-pager">
              <span className="muted small">{L(`총 ${rows.length}건`, `${rows.length} total`)}{rows.length !== all.length ? L(` (전체 ${all.length}건)`, ` (of ${all.length})`) : ''}</span>
              <span className="vt-size" />
              <Pager page={cur} pages={pages} onPage={setPage} />
            </div>
          </>
        ))}

      {doing && <ApplyDialog it={doing.it} a={doing.a} L={L} onClose={() => setDoing(null)}
        onDone={(text) => { setDoing(null); setNotice({ kind: 'info', text }); rep.reload(); }} />}
      {weekly && <WeeklyDialog L={L} onClose={() => setWeekly(false)} />}
    </>
  );
}

type Lx = (ko: string, en: string) => string;

function Tiles({ d, L }: { d: ReclaimReport; L: Lx }) {
  const t = d.totals;
  const tiles = [
    { label: 'vCPU', value: t.vcpu, sub: t.review ? L(`확인 필요 ${t.review}건은 뺌`, `${t.review} to check not counted`) : L(`${t.items}건 기준`, `from ${t.items} items`) },
    { label: L('메모리', 'Memory'), value: `${t.ram_gb} GB`, sub: '' },
    { label: L('디스크', 'Disk'), value: `${t.disk_gb} GB`, sub: t.snapshots ? L(`스냅숏 ${t.snapshots}개 별도`, `+ ${t.snapshots} snapshots`) : '' },
    { label: L('가속 카드', 'Cards'), value: t.cards, sub: t.seats ? L(`배정 데스크톱 ${t.seats}대`, `${t.seats} desktops to reassign`) : '' },
    { label: L('더 둘 수 있는 데스크톱', 'More desktops'), value: t.more_desktops, sub: L(`표준 ${d.spec.vcpu} vCPU · ${d.spec.ram_gb} GB`, `typical ${d.spec.vcpu} vCPU · ${d.spec.ram_gb} GB`) },
  ];
  return (
    <div className="kpis rc-kpis">
      {tiles.map((x) => (
        <div key={x.label} className="kpi">
          <span className="kpi-label">{x.label}</span>
          <span className="kpi-value">{typeof x.value === 'number' ? x.value.toLocaleString() : x.value}</span>
          {x.sub && <span className="kpi-sub">{x.sub}</span>}
        </div>
      ))}
    </div>
  );
}

function ApplyDialog({ it, a, L, onClose, onDone }: { it: ReclaimItem; a: ReclaimAction; L: Lx; onClose: () => void; onDone: (text: string) => void }) {
  const [typed, setTyped] = useState('');
  const [cores, setCores] = useState(a.params.cores ?? 0);
  const [mem, setMem] = useState(a.params.memory_mb ? a.params.memory_mb / 1024 : 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const confirm = a.params.confirm ?? (a.id === 'delete_vm' ? (it.desktop ?? it.vm_name ?? it.name) : a.id === 'delete_snapshot' ? it.snapshot ?? '' : '');
  const cur = (it.detail.current ?? null) as { vcpu: number; ram_gb: number } | null;

  async function go() {
    setBusy(true); setErr(null);
    const b: ApplyBody = { key: it.key, action: a.id, cluster_id: it.cluster_id, vmid: it.vmid, desktop_id: it.kind === 'loan' ? null : it.desktop_id,
      snapshot: it.snapshot, lease_id: it.lease_id };
    if (a.id === 'resize') {
      if (cores) b.cores = cores;
      if (mem) b.memory_mb = Math.round(mem * 1024);
    }
    if (a.destructive) b.confirm_name = typed;
    try {
      await reclaimApi.apply(b);
      onDone(L(`${it.name}: ${a.label} 완료${a.id === 'resize' ? ' (다음 시작부터 적용)' : ''}.`, `${it.name}: ${a.label} done${a.id === 'resize' ? ' (from the next start)' : ''}.`));
    } catch (e) {
      const code = e instanceof ApiError ? (e.body as { code?: string } | undefined)?.code : undefined;
      setErr(code === 'VM_RUNNING' ? L('켜져 있는 VM입니다. 먼저 끄세요.', 'The VM is running - shut it down first.')
        : code === 'IN_USE' ? L('누가 접속해 있습니다.', 'Someone is connected.') : (e as Error).message);
      setBusy(false);
    }
  }
  const ready = !busy && (!a.destructive || typed === confirm) && (a.id !== 'resize' || cores > 0 || mem > 0);
  return (
    <Modal title={`${a.label}: ${it.name}`} onClose={onClose} actions={<>
      <button type="button" className="btn" onClick={onClose}>{L('취소', 'Cancel')}</button>
      <button type="button" className={`btn ${a.destructive ? 'danger' : 'primary'}`} disabled={!ready} onClick={() => void go()}>{busy ? L('적용 중…', 'Applying…') : L('적용', 'Apply')}</button>
    </>}>
      <p className="small">{it.reason}</p>
      {a.id === 'unassign' && <p className="small muted">{L(`${it.user} 님의 배정을 풉니다. 데스크톱은 풀에 남습니다.`, `Takes the desktop from ${it.user}; it stays in the pool.`)}</p>}
      {a.id === 'shutdown' && <p className="small muted">{L('게스트에 종료를 요청합니다.', 'Asks the guest to shut down.')}</p>}
      {a.id === 'return_card' && <p className="small muted">{L(`${it.user} 님에게 알림이 갑니다.`, `${it.user} is told.`)}</p>}
      {a.id === 'resize' && (
        <div className="rc-resize">
          <label>vCPU<input type="number" min={1} max={256} value={cores || ''} onChange={(e) => setCores(Number(e.target.value))} />
            {cur && <span className="muted small">{L(`지금 ${cur.vcpu}`, `now ${cur.vcpu}`)}</span>}</label>
          <label>{L('메모리 (GB)', 'Memory (GB)')}<input type="number" min={1} step={1} value={mem || ''} onChange={(e) => setMem(Number(e.target.value))} />
            {cur && <span className="muted small">{L(`지금 ${cur.ram_gb}`, `now ${cur.ram_gb}`)}</span>}</label>
        </div>
      )}
      {a.destructive && (
        <label className="rc-confirm">
          <span className="small">{L(`되돌릴 수 없습니다. 확인하려면 `, 'This cannot be undone. Type ')}<b>{confirm}</b>{L(' 을(를) 입력하세요.', ' to confirm.')}</span>
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={L('이름 입력', 'Type the name')} />
        </label>
      )}
      {err && <div className="alert error small" role="alert">{err}</div>}
    </Modal>
  );
}

function WeeklyDialog({ L, onClose }: { L: Lx; onClose: () => void }) {
  const cur = useLoad(() => reclaimApi.settings(), []);
  const [s, setS] = useState<ReclaimSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (cur.state === 'ok' && !s) setS(cur.data.settings); }, [cur, s]);
  async function save() {
    if (!s) return;
    setBusy(true); setErr(null);
    try { await reclaimApi.saveSettings(s); onClose(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <Modal title={L('주간 요약', 'Weekly summary')} onClose={onClose} actions={<>
      <button type="button" className="btn" onClick={onClose}>{L('취소', 'Cancel')}</button>
      <button type="button" className="btn primary" disabled={busy || !s} onClick={() => void save()}>{L('저장', 'Save')}</button>
    </>}>
      <p className="small muted">{L('운영 알림과 같은 곳(웹훅 · 경보 메일)으로 보냅니다.', 'Sent where the operations notices go (webhooks, alert mail).')}</p>
      {s && (
        <div className="rc-weekly">
          <label className="rc-check"><input type="checkbox" checked={s.weekly} onChange={(e) => setS({ ...s, weekly: e.target.checked })} />{L('보내기', 'Send it')}</label>
          <label>{L('요일', 'Day')}<select value={s.weekday} onChange={(e) => setS({ ...s, weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((w, i) => <option key={w} value={i}>{L(w, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i])}</option>)}</select></label>
          <label>{L('시각', 'Hour')}<select value={s.hour} onChange={(e) => setS({ ...s, hour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${h}:00`}</option>)}</select></label>
          <label>{L('기준 기간', 'Window')}<select value={s.days} onChange={(e) => setS({ ...s, days: Number(e.target.value) })}>
            {DAYS.map((n) => <option key={n} value={n}>{L(`${n}일`, `${n} days`)}</option>)}</select></label>
        </div>
      )}
      {cur.state === 'ok' && cur.data.last_sent && <p className="small muted">{L('마지막 발송', 'Last sent')}: {cur.data.last_sent.slice(0, 16).replace('T', ' ')}</p>}
      {err && <div className="alert error small" role="alert">{err}</div>}
    </Modal>
  );
}
