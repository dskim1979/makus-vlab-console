import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import {
  addDays, kindText, mondayOf, reservationsApi, type Block, type GlobalSettings, type Reservation, type ReserveSettings, type SettingsAnswer,
} from '../../api/reservations';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { MonthCalendar, ReserveForm, StatusChip, WeekCalendar, monthRange, useL, weekRange, whenText } from '../../components/ReserveParts';
import { SettingsStatus } from '../../components/SettingsShell';
import { useLoad } from '../../components/useLoad';

// LAB > 예약: bookings by week or month beside the classes, the requests waiting for approval,
// and per LAB what may be booked (hours, longest, how far ahead, approval, roles, pools).
// Approving needs vlab.lab.manage - the administrator or a role made for the LAB staff.
export function ReservationsPage() {
  const { L } = useL();
  const [tab, setTab] = useState<'calendar' | 'pending' | 'settings'>('calendar');
  const summary = useLoad(reservationsApi.summary);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const options = useLoad(reservationsApi.options);
  const refresh = () => { setTick((n) => n + 1); summary.reload(); };

  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="tablist">
          {([['calendar', L('달력', 'Calendar')], ['pending', L('승인 대기', 'Waiting')], ['settings', L('LAB별 설정', 'Settings')]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" className={tab === k ? 'on' : ''} aria-selected={tab === k} onClick={() => { setTab(k); setNote(null); }}>
              {label}{k === 'pending' && summary.state === 'ok' && summary.data.pending > 0 && <span className="chip chip-warn chip-gap">{summary.data.pending}</span>}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button type="button" className="btn primary" disabled={options.state !== 'ok'} onClick={() => setCreating(true)}><Icon name="plus" size={16} />{L('새 예약', 'New booking')}</button>
      </div>
      {summary.state === 'ok' && (
        <SettingsStatus items={[
          { label: L('오늘 예약', 'Today'), value: String(summary.data.today) },
          { label: L('진행 중', 'Running'), value: String(summary.data.running), tone: summary.data.running ? 'ok' : undefined },
          { label: L('승인 대기', 'Waiting'), value: String(summary.data.pending), tone: summary.data.pending ? 'warn' : undefined },
        ]} />
      )}
      {note && <div className="alert small info" role="status">{note}</div>}
      {tab === 'calendar' && <AdminCalendar key={tick} onChanged={refresh} />}
      {tab === 'pending' && <PendingList key={tick} onChanged={(m) => { setNote(m); refresh(); }} />}
      {tab === 'settings' && <SettingsTab />}
      {creating && options.state === 'ok' && (
        <Dialog open wide title={L('새 예약', 'New booking')} onClose={() => setCreating(false)}>
          <ReserveForm options={options.data} admin
            onDone={(_, msg) => { setCreating(false); setNote(msg); refresh(); }} />
        </Dialog>
      )}
    </>
  );
}

function AdminCalendar({ onChanged }: { onChanged: () => void }) {
  const { L } = useL();
  const labs = useLoad(adminApi.labs);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [labId, setLabId] = useState('');
  const [picked, setPicked] = useState<Reservation | null>(null);
  const [from, to] = view === 'week' ? weekRange(mondayOf(anchor)) : monthRange(anchor);
  const data = useLoad(useCallback(() => reservationsApi.list(from, to, labId || undefined), [from, to, labId]), [from, to, labId]);
  const step = (n: number) => setAnchor(view === 'week' ? addDays(anchor, 7 * n) : new Date(anchor.getFullYear(), anchor.getMonth() + n, 1));
  const blocksOf = (d: { reservations: Reservation[]; schedules: Block[] }): Block[] => [
    ...d.schedules,
    ...d.reservations.filter((r) => r.status === 'pending' || r.status === 'approved').map((r): Block => ({ ...r, type: 'reservation' })),
  ];
  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="group">
          <button type="button" className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>{L('주간', 'Week')}</button>
          <button type="button" className={view === 'month' ? 'on' : ''} onClick={() => setView('month')}>{L('월간', 'Month')}</button>
        </div>
        <select aria-label="LAB" value={labId} onChange={(e) => setLabId(e.target.value)}>
          <option value="">{L('모든 LAB', 'Every LAB')}</option>
          {labs.state === 'ok' && labs.data.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button type="button" className="btn" onClick={() => step(-1)} aria-label={L('이전', 'Previous')}>‹</button>
        <button type="button" className="btn" onClick={() => setAnchor(new Date())}>{L('오늘', 'Today')}</button>
        <button type="button" className="btn" onClick={() => step(1)} aria-label={L('다음', 'Next')}>›</button>
        <span className="muted small">{view === 'week' ? `${from} – ${to}` : `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`}</span>
      </div>
      <LoadState value={data} retry={data.reload}>
        {(d) => (
          <>
            {view === 'week'
              ? <WeekCalendar monday={mondayOf(anchor)} blocks={blocksOf(d)} showLab={!labId}
                  onPick={(b) => { if (b.type === 'reservation') setPicked(d.reservations.find((r) => r.id === b.id) ?? null); }} />
              : <MonthCalendar month={anchor} blocks={blocksOf(d)} onDay={(day) => { setAnchor(day); setView('week'); }} />}
            <ReservationTable list={d.reservations} onPick={setPicked} />
          </>
        )}
      </LoadState>
      {picked && <ReservationDialog r={picked} onClose={() => setPicked(null)} onDone={() => { setPicked(null); data.reload(); onChanged(); }} />}
    </>
  );
}

function ReservationTable({ list, onPick }: { list: Reservation[]; onPick: (r: Reservation) => void }) {
  const { L } = useL();
  if (!list.length) return <div className="empty"><p>{L('이 기간에 예약이 없습니다.', 'No bookings in this period.')}</p></div>;
  return (
    <div className="table-scroll">
      <table className="table compact-head">
        <thead><tr><th>{L('일시', 'When')}</th><th>LAB · {L('풀', 'Pool')}</th><th>{L('대상', 'What')}</th><th>{L('목적', 'Purpose')}</th><th>{L('신청자', 'Requester')}</th><th>{L('상태', 'State')}</th><th className="actions" /></tr></thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className={r.status === 'cancelled' || r.status === 'rejected' ? 'row-off' : ''}>
              <td className="nowrap">{whenText(r)}{r.series_id && <span className="chip chip-gap">{L('반복', 'Weekly')}</span>}</td>
              <td>{r.lab ?? '-'}<br /><span className="muted small">{r.pool}</span></td>
              <td className="nowrap">{kindText(r.kind, L)}{r.kind !== 'lab' ? ` ${r.quantity}` : ''}</td>
              <td>{r.purpose || '-'}</td>
              <td>{r.requester}</td>
              <td><StatusChip r={r} /></td>
              <td className="actions"><button type="button" className="btn-ghost small-btn" onClick={() => onPick(r)}>{L('열기', 'Open')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReservationDialog({ r, onClose, onDone }: { r: Reservation; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const options = useLoad(reservationsApi.options);
  const [mode, setMode] = useState<'view' | 'edit' | 'reject' | 'cancel'>('view');
  const [reason, setReason] = useState('');
  const [series, setSeries] = useState(false);
  const [banner, setBanner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = r.status === 'pending' || r.status === 'approved';
  const scope = series && r.series_id ? 'series' : 'one';

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (mode === 'edit' && options.state === 'ok') {
    return (
      <Dialog open wide title={L('예약 변경', 'Change the booking')} onClose={onClose}>
        <p className="muted small">{L('변경하면 신청자에게 알림이 갑니다.', 'The requester hears of the change.')}</p>
        <ReserveForm options={options.data} admin initial={r} onCancel={() => setMode('view')} onDone={onDone} />
      </Dialog>
    );
  }
  return (
    <Dialog open title={r.purpose || kindText(r.kind, L)} onClose={onClose} busy={busy} error={error}
      onSubmit={mode === 'reject' ? () => act(() => reservationsApi.reject(r.id, scope, reason)) : mode === 'cancel' ? () => act(() => reservationsApi.cancel(r.id, scope, reason, true)) : undefined}
      submitLabel={mode === 'reject' ? L('거절', 'Reject') : mode === 'cancel' ? L('예약 취소', 'Cancel booking') : undefined}
      extra={mode === 'view' && live ? (
        <>
          {r.status === 'pending' && <button type="button" className="btn primary" disabled={busy} onClick={() => act(() => reservationsApi.approve(r.id, scope, banner))}>{L('승인', 'Approve')}</button>}
          {r.status === 'pending' && <button type="button" className="btn" onClick={() => setMode('reject')}>{L('거절', 'Reject')}</button>}
          {!r.prepared && <button type="button" className="btn" onClick={() => setMode('edit')}>{L('변경', 'Change')}</button>}
          <button type="button" className="btn danger" onClick={() => setMode('cancel')}>{L('취소', 'Cancel')}</button>
        </>
      ) : undefined}>
      <dl className="kv">
        <dt>{L('일시', 'When')}</dt><dd>{whenText(r)}{r.series_id ? L(` (반복 ${r.series_count ?? ''}회)`, ` (series of ${r.series_count ?? ''})`) : ''}</dd>
        <dt>{L('대상', 'What')}</dt><dd>{kindText(r.kind, L)}{r.kind !== 'lab' ? ` ${r.quantity}` : ''} · {r.lab ?? '-'} · {r.pool}</dd>
        <dt>{L('신청자', 'Requester')}</dt><dd>{r.requester}</dd>
        <dt>{L('상태', 'State')}</dt><dd><StatusChip r={r} />{r.reviewed_by ? <span className="muted small"> · {r.reviewed_by}</span> : null}</dd>
        {r.participants && r.participants.length > 0 && <><dt>{L('참가자', 'Participants')}</dt><dd>{r.participants.map((p) => p.subject_id).join(', ')}</dd></>}
        {r.note && <><dt>{L('메모', 'Note')}</dt><dd>{r.note}</dd></>}
        {r.reason && <><dt>{L('사유', 'Reason')}</dt><dd>{r.reason}</dd></>}
        {(r.prepared || r.running) && <><dt>{L('실행', 'Run')}</dt><dd>{L(`데스크톱 ${r.desktops ?? 0}대 준비 · ${r.handed ?? 0}명에게 배정`, `${r.desktops ?? 0} desktops ready · handed to ${r.handed ?? 0}`)}</dd></>}
      </dl>
      {r.series_id && live && <label className="check"><input type="checkbox" checked={series} onChange={(e) => setSeries(e.target.checked)} /><span>{L('반복 예약의 남은 회차 모두', 'The rest of the series too')}</span></label>}
      {mode === 'view' && r.status === 'pending' && r.lab_id && <label className="check"><input type="checkbox" checked={banner} onChange={(e) => setBanner(e.target.checked)} /><span>{L('승인하면 예약 시간에 공지 배너로 알리기', 'Show a notice while it runs')}</span></label>}
      {(mode === 'reject' || mode === 'cancel') && (
        <label><span>{L('사유 (신청자에게 전달)', 'Reason (sent to the requester)')}</span>
          <input id="rsv-reason" value={reason} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)} placeholder={L('예: 같은 시간 학과 행사', 'e.g. a department event then')} /></label>
      )}
    </Dialog>
  );
}

function PendingList({ onChanged }: { onChanged: (msg: string) => void }) {
  const { L } = useL();
  const list = useLoad(reservationsApi.pending);
  const [picked, setPicked] = useState<Reservation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function approve(r: Reservation) {
    setBusy(true); setError(null);
    try { const out = await reservationsApi.approve(r.id, r.series_id ? 'series' : 'one'); onChanged(L(`${out.length}건 승인했습니다. 신청자에게 알렸습니다.`, `${out.length} approved; the requester was told.`)); list.reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <LoadState value={list} retry={list.reload}>
      {(rows) => rows.length === 0 ? <div className="empty"><p>{L('승인을 기다리는 예약이 없습니다.', 'Nothing waits for approval.')}</p></div> : (
        <>
          {error && <div className="alert small error">{error}</div>}
          <div className="table-scroll">
            <table className="table compact-head">
              <thead><tr><th>{L('일시', 'When')}</th><th>LAB · {L('풀', 'Pool')}</th><th>{L('대상', 'What')}</th><th>{L('목적', 'Purpose')}</th><th>{L('신청자', 'Requester')}</th><th className="actions" /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{whenText(r)}{(r.waiting ?? 1) > 1 && <span className="chip chip-warn chip-gap">{L(`반복 ${r.waiting}회`, `${r.waiting} weeks`)}</span>}</td>
                    <td>{r.lab ?? '-'}<br /><span className="muted small">{r.pool}</span></td>
                    <td className="nowrap">{kindText(r.kind, L)}{r.kind !== 'lab' ? ` ${r.quantity}` : ''}</td>
                    <td>{r.purpose || '-'}{r.note && <><br /><span className="muted small">{r.note}</span></>}</td>
                    <td>{r.requester}</td>
                    <td className="actions">
                      <button type="button" className="btn small-btn primary" disabled={busy} onClick={() => approve(r)}>{L('승인', 'Approve')}</button>
                      <button type="button" className="btn-ghost small-btn" onClick={() => setPicked(r)}>{L('자세히 · 거절', 'Details')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {picked && <ReservationDialog r={picked} onClose={() => setPicked(null)} onDone={() => { setPicked(null); list.reload(); onChanged(L('처리했습니다.', 'Done.')); }} />}
        </>
      )}
    </LoadState>
  );
}

const DAYS = [['월', 'Mon'], ['화', 'Tue'], ['수', 'Wed'], ['목', 'Thu'], ['금', 'Fri'], ['토', 'Sat'], ['일', 'Sun']];

function SettingsTab() {
  const { L } = useL();
  const data = useLoad(reservationsApi.settings);
  const labs = useLoad(adminApi.labs);
  const pools = useLoad(adminApi.pools);
  return (
    <LoadState value={data} retry={data.reload}>
      {(s) => (
        <>
          <p className="muted small">{L('승인 · 예약 관리는 vlab.lab.manage 권한(관리자 또는 LAB 담당자 역할)이 합니다. 역할 관리에서 "LAB 담당자" 역할에 이 권한과 vlab.pool.view 를 주면 됩니다.',
            'Approving and managing bookings takes vlab.lab.manage (the administrator or a LAB staff role). Give a role this permission and vlab.pool.view in Roles.')}</p>
          <NotifyCard s={s} onSaved={data.reload} />
          {labs.state === 'ok' && labs.data.map((l) => (
            <LabSettingsCard key={l.id} keyId={l.id} title={l.name} sub={l.seats ? L(`${l.seats}석`, `${l.seats} seats`) : ''} value={s.labs[l.id] ?? s.defaults}
              pools={(pools.state === 'ok' ? pools.data : []).filter((p) => ['classroom', 'reset', 'shared'].includes(p.type))} onSaved={data.reload} />
          ))}
          <LabSettingsCard keyId="_pool" title={L('풀 예약 (LAB 없이 데스크톱 N대)', 'Pool bookings (desktops without a room)')} sub="" value={s.pool} pools={[]} onSaved={data.reload} />
        </>
      )}
    </LoadState>
  );
}

function NotifyCard({ s, onSaved }: { s: SettingsAnswer; onSaved: () => void }) {
  const { L } = useL();
  const [v, setV] = useState<GlobalSettings>(s.global);
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    try { await reservationsApi.saveSettings('_global', v); setMsg(L('저장했습니다.', 'Saved.')); onSaved(); } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <section className="panel rsv-set">
      <h2 className="section-title">{L('알림', 'Notifications')}</h2>
      <p className="muted small">{L('승인 · 거절 · 취소 · 변경 때 신청자에게 알립니다. 새 신청은 고른 웹훅 채널로 담당자에게 갑니다.',
        'The requester hears of approvals, rejections, cancellations and changes; new requests go to the chosen webhook channels.')}</p>
      <label className="check"><input type="checkbox" checked={v.mail} onChange={(e) => setV({ ...v, mail: e.target.checked })} /><span>{L('신청자에게 메일 (계정의 이메일, 플랫폼 설정의 메일 서버)', 'Mail the requester (their account email, the platform mail server)')}</span></label>
      <span className="field-label">{L('웹훅 채널 (알림 채널에서 만든 것)', 'Webhook channels (from the alert channels)')}</span>
      <div className="check-row">
        {s.channels.length === 0 && <span className="muted small">{L('알림 채널이 없습니다.', 'No alert channels yet.')}</span>}
        {s.channels.map((c) => (
          <label key={c.id} className="check-inline"><input type="checkbox" checked={v.channels.includes(c.id)}
            onChange={(e) => setV({ ...v, channels: e.target.checked ? [...v.channels, c.id] : v.channels.filter((x) => x !== c.id) })} />{c.name}</label>
        ))}
      </div>
      <div className="rsv-actions"><span className="spacer" />{msg && <span className="muted small">{msg}</span>}<button type="button" className="btn primary" onClick={save}>{L('저장', 'Save')}</button></div>
    </section>
  );
}

function LabSettingsCard({ keyId, title, sub, value, pools, onSaved }: {
  keyId: string; title: string; sub: string; value: ReserveSettings; pools: { id: string; name: string }[]; onSaved: () => void;
}) {
  const { L } = useL();
  const [v, setV] = useState<ReserveSettings>(value);
  const [roles, setRoles] = useState(value.roles.join(', '));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof ReserveSettings>(k: K, x: ReserveSettings[K]) => setV((o) => ({ ...o, [k]: x }));
  async function save() {
    try {
      await reservationsApi.saveSettings(keyId, { ...v, roles: roles.split(',').map((x) => x.trim()).filter(Boolean) });
      setMsg({ ok: true, text: L('저장했습니다.', 'Saved.') }); onSaved();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  return (
    <section className={`panel rsv-set${v.enabled ? '' : ' row-off'}`}>
      <div className="panel-head">
        <div><h2 className="section-title">{title}</h2>{sub && <span className="muted small">{sub}</span>}</div>
        <span className="spacer" />
        <label className="check-inline"><input type="checkbox" checked={v.enabled} onChange={(e) => set('enabled', e.target.checked)} />{L('예약 받기', 'Takes bookings')}</label>
        <label className="check-inline"><input type="checkbox" checked={v.approval} onChange={(e) => set('approval', e.target.checked)} />{L('예약 승인 필요', 'Needs approval')}</label>
      </div>
      <div className="form-row form-row-three">
        <label><span>{L('예약 가능 시작', 'Bookable from')}</span><input type="time" value={v.open_from} onChange={(e) => set('open_from', e.target.value)} /></label>
        <label><span>{L('예약 가능 끝', 'Bookable until')}</span><input type="time" value={v.open_to === '24:00' ? '23:59' : v.open_to} onChange={(e) => set('open_to', e.target.value)} /></label>
        <label><span>{L('최대 길이', 'Longest')}</span><span className="with-unit"><input type="number" min={0.5} max={24} step={0.5} value={v.max_minutes / 60}
          onChange={(e) => set('max_minutes', Math.round(Math.max(0.25, Math.min(24, Number(e.target.value) || 1)) * 60))} /><span className="muted small">{L('시간', 'hours')}</span></span></label>
      </div>
      <span className="field-label">{L('예약 가능 요일', 'Bookable weekdays')}</span>
      <div className="day-picks">
        {DAYS.map(([ko, en], i) => <button key={ko} type="button" className={v.weekdays.includes(i) ? 'on' : ''} aria-pressed={v.weekdays.includes(i)}
          onClick={() => set('weekdays', v.weekdays.includes(i) ? v.weekdays.filter((x) => x !== i) : [...v.weekdays, i].sort())}>{L(ko, en)}</button>)}
      </div>
      <div className="form-row form-row-three">
        <label><span>{L('미리 예약 기간', 'How far ahead')}</span><span className="with-unit"><input type="number" min={1} max={366} value={v.max_days_ahead}
          onChange={(e) => set('max_days_ahead', Math.max(1, Math.min(366, Number(e.target.value) || 1)))} /><span className="muted small">{L('일', 'days')}</span></span></label>
        <label><span>{L('미리 켜기', 'Start before')}</span><span className="with-unit"><input type="number" min={0} max={180} value={v.prepare_min}
          onChange={(e) => set('prepare_min', Math.max(0, Math.min(180, Number(e.target.value) || 0)))} /><span className="muted small">{L('분 전', 'min')}</span></span></label>
        <label><span>{L('끝난 뒤', 'After')}</span>
          <select value={v.after} onChange={(e) => set('after', e.target.value as ReserveSettings['after'])}>
            <option value="reset">{L('초기화(기준 스냅샷) 후 끄기', 'Reset to base and off')}</option>
            <option value="off">{L('끄기만', 'Shut down')}</option>
            <option value="none">{L('그대로 두기', 'Leave as is')}</option>
          </select></label>
      </div>
      <label><span>{L('예약 가능 역할 (쉼표로, 비우면 포털 사용자 누구나)', 'Roles that may book (comma separated; empty = anyone with the portal)')}</span>
        <input value={roles} placeholder="professor, assistant, researcher" onChange={(e) => setRoles(e.target.value)} /></label>
      {pools.length > 0 && (
        <>
          <span className="field-label">{L('이 LAB 예약에 쓸 풀 (고르지 않으면 사용 일정의 풀)', 'Pools for this LAB (none = the pools of its schedules)')}</span>
          <div className="check-row">
            {pools.map((p) => <label key={p.id} className="check-inline"><input type="checkbox" checked={v.pool_ids.includes(p.id)}
              onChange={(e) => set('pool_ids', e.target.checked ? [...v.pool_ids, p.id] : v.pool_ids.filter((x) => x !== p.id))} />{p.name}</label>)}
          </div>
        </>
      )}
      {keyId !== '_pool' && <label className="check"><input type="checkbox" checked={v.banner} onChange={(e) => set('banner', e.target.checked)} /><span>{L('확정된 예약을 예약 시간에 공지 배너로 알리기', 'Show approved bookings as a notice while they run')}</span></label>}
      <div className="rsv-actions"><span className="spacer" />{msg && <span className={`small ${msg.ok ? 'muted' : 'error-text'}`}>{msg.text}</span>}
        <button type="button" className="btn primary" onClick={save}>{L('저장', 'Save')}</button></div>
    </section>
  );
}

/** 대시보드: today's bookings and what waits for approval. */
export function ReservationsCard() {
  const { L } = useL();
  const s = useLoad(reservationsApi.summary);
  if (s.state !== 'ok') return null;
  return (
    <section className="card">
      <h2 className="card-title">{L('LAB 예약', 'LAB bookings')}</h2>
      <ul className="link-list">
        <li><Link to="/admin/labs/reservations"><span className="li-icon"><Icon name="clock" size={17} /></span>
          <span className="li-text">{L(`오늘 예약 ${s.data.today}건`, `${s.data.today} today`)}{s.data.running ? L(` · 진행 중 ${s.data.running}`, ` · ${s.data.running} running`) : ''}</span><Icon name="chevron" size={14} /></Link></li>
        <li><Link to="/admin/labs/reservations"><span className="li-icon"><Icon name="info" size={17} /></span>
          <span className="li-text">{L(`승인 대기 ${s.data.pending}건`, `${s.data.pending} waiting for approval`)}</span><Icon name="chevron" size={14} /></Link></li>
      </ul>
    </section>
  );
}
