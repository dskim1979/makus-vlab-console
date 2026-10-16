import { lazy, Suspense, useCallback, useState } from 'react';
import { api } from '../api/client';
import { addDays, kindText, localText, mondayOf, reservationsApi, type Block, type Reservation } from '../api/reservations';
import type { Clipboard } from '../api/types';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { LoadState } from '../components/LoadState';
import { ReserveForm, StatusChip, WeekCalendar, blockTitle, useL, weekRange, whenText } from '../components/ReserveParts';
import { useLoad } from '../components/useLoad';

const ConsoleWindow = lazy(() => import('./ConsoleWindow'));

// 포털 > 예약: my bookings, a new one, and the calendar of a LAB or pool with its busy times
// (classes and other bookings). An approved booking opens a desktop to its participants in its time.
export function ReservePage() {
  const { L } = useL();
  const [tab, setTab] = useState<'mine' | 'new' | 'calendar'>('mine');
  const options = useLoad(reservationsApi.options);
  const mine = useLoad(reservationsApi.mine);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nowText = localText(new Date());

  async function cancel(r: Reservation) {
    const series = !!r.series_id && (r.series_count ?? 1) > 1 && confirm(L('반복 예약의 남은 회차를 모두 취소할까요? (취소를 누르면 이 회차만)', 'Cancel the rest of the series too? (Cancel = this one only)'));
    if (!series && !confirm(L(`${whenText(r)} 예약을 취소할까요?`, `Cancel the booking of ${whenText(r)}?`))) return;
    try { await reservationsApi.cancel(r.id, series ? 'series' : 'one'); mine.reload(); setNote(L('취소했습니다.', 'Cancelled.')); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{L('예약', 'Bookings')}</h1>
          <p className="muted">{L('실습실 전체 · 좌석 · 데스크톱을 미리 잡아 둡니다. 예약 시간에는 참가자에게만 데스크톱이 열립니다.',
            'Book a room, seats or desktops ahead. In its time only the participants get a desktop.')}</p>
        </div>
        <div className="page-tools">
          <div className="segmented" role="tablist">
            {([['mine', L('내 예약', 'Mine')], ['new', L('새 예약', 'New')], ['calendar', L('달력 · 빈 시간', 'Calendar')]] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" className={tab === k ? 'on' : ''} aria-selected={tab === k} onClick={() => { setTab(k); setNote(null); }}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      {note && <div className="alert small info" role="status">{note}</div>}
      {error && <div className="alert small error" role="alert">{error}</div>}
      <ReservationsNow />
      {tab === 'mine' && (
        <LoadState value={mine} retry={mine.reload}>
          {(list) => list.length === 0 ? (
            <div className="empty"><p>{L('예약이 없습니다.', 'No bookings yet.')}</p>
              <button type="button" className="btn primary" onClick={() => setTab('new')}><Icon name="plus" size={16} />{L('새 예약', 'New booking')}</button></div>
          ) : (
            <div className="table-scroll">
              <table className="table compact-head">
                <thead><tr><th>{L('일시', 'When')}</th><th>{L('대상', 'What')}</th><th>{L('목적', 'Purpose')}</th><th>{L('상태', 'State')}</th><th className="actions" /></tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} className={r.status === 'cancelled' || r.status === 'rejected' ? 'row-off' : ''}>
                      <td className="nowrap">{whenText(r)}{r.series_id && <span className="chip chip-gap">{L('반복', 'Weekly')}</span>}</td>
                      <td>{r.lab ?? r.pool}<br /><span className="muted small">{kindText(r.kind, L)}{r.kind !== 'lab' ? ` ${r.quantity}` : ''} · {r.pool}</span></td>
                      <td>{r.purpose || '-'}{r.reason && <><br /><span className="muted small">{L('사유', 'Reason')}: {r.reason}</span></>}</td>
                      <td><StatusChip r={r} /></td>
                      <td className="actions">
                        {(r.status === 'pending' || r.status === 'approved') && !r.prepared && r.start_at > nowText && (
                          <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(r)}>{L('변경', 'Change')}</button>)}
                        {(r.status === 'pending' || r.status === 'approved') && !r.finished && r.end_at > nowText && (
                          <button type="button" className="btn-ghost small-btn danger" onClick={() => cancel(r)}>{L('취소', 'Cancel')}</button>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </LoadState>
      )}
      {tab === 'new' && (
        <LoadState value={options} retry={options.reload}>
          {(o) => (o.labs.some((l) => l.may_book) || (o.pool_may_book && o.pools.length)) ? (
            <section className="panel"><ReserveForm options={o} onDone={(_, msg) => { setNote(msg); setTab('mine'); mine.reload(); }} /></section>
          ) : <div className="empty"><p>{L('예약할 수 있는 실습실이나 풀이 없습니다.', 'There is nothing you may book.')}</p></div>}
        </LoadState>
      )}
      {tab === 'calendar' && <FreeTimes onNew={() => setTab('new')} />}
      {editing && options.state === 'ok' && (
        <Dialog open wide title={L('예약 변경', 'Change the booking')} onClose={() => setEditing(null)}>
          <ReserveForm options={options.data} initial={editing}
            onDone={(_, msg) => { setEditing(null); setNote(msg); mine.reload(); }} />
        </Dialog>
      )}
    </main>
  );
}

// The calendar of one LAB or pool: classes and bookings by week, so a free time is easy to see.
function FreeTimes({ onNew }: { onNew: () => void }) {
  const { L } = useL();
  const options = useLoad(reservationsApi.options);
  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const [target, setTarget] = useState('');
  const [picked, setPicked] = useState<Block | null>(null);
  const [from, to] = weekRange(monday);
  const labId = target.startsWith('lab:') ? target.slice(4) : undefined;
  const poolId = target.startsWith('pool:') ? target.slice(5) : undefined;
  const blocks = useLoad(useCallback(() => reservationsApi.calendar(from, to, labId, poolId), [from, to, labId, poolId]), [from, to, labId, poolId]);
  return (
    <>
      <div className="toolbar">
        <select aria-label={L('실습실 · 풀', 'Room or pool')} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{L('전체', 'Everything')}</option>
          {options.state === 'ok' && options.data.labs.map((l) => <option key={l.id} value={`lab:${l.id}`}>{l.name}</option>)}
          {options.state === 'ok' && options.data.pools.map((p) => <option key={p.id} value={`pool:${p.id}`}>{L('풀', 'Pool')}: {p.name}</option>)}
        </select>
        <button type="button" className="btn" onClick={() => setMonday(addDays(monday, -7))} aria-label={L('지난주', 'Previous week')}>‹</button>
        <button type="button" className="btn" onClick={() => setMonday(mondayOf(new Date()))}>{L('이번 주', 'This week')}</button>
        <button type="button" className="btn" onClick={() => setMonday(addDays(monday, 7))} aria-label={L('다음 주', 'Next week')}>›</button>
        <span className="muted small">{from} – {to}</span>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={onNew}><Icon name="plus" size={16} />{L('새 예약', 'New booking')}</button>
      </div>
      <LoadState value={blocks} retry={blocks.reload}>
        {(list) => <WeekCalendar monday={monday} blocks={list} showLab={!labId} onPick={setPicked} />}
      </LoadState>
      <p className="muted small">{L('빈 칸이 예약할 수 있는 시간입니다. 실습실의 예약 가능 시간대 · 최대 길이는 새 예약 화면에 나옵니다.',
        'Empty space is free. The room\'s bookable hours and longest booking show on the new-booking screen.')}</p>
      {picked && (
        <Dialog open title={blockTitle(picked, L)} onClose={() => setPicked(null)}>
          <dl className="kv">
            <dt>{L('일시', 'When')}</dt><dd>{whenText(picked)}</dd>
            <dt>{L('장소', 'Where')}</dt><dd>{picked.lab ?? '-'} · {picked.pool}</dd>
            {picked.type === 'reservation' && <><dt>{L('신청자', 'Booked by')}</dt><dd>{picked.requester}</dd>
              <dt>{L('상태', 'State')}</dt><dd><StatusChip r={{ status: picked.status ?? 'approved' }} /></dd></>}
          </dl>
        </Dialog>
      )}
    </>
  );
}

/** Bookings I take part in that run now or start within the hour, with their desktop. */
export function ReservationsNow() {
  const { L } = useL();
  const now = useLoad(reservationsApi.now);
  const [open, setOpen] = useState<{ title: string; wsPath: string; password: string; clipboard: Clipboard } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (now.state !== 'ok' || now.data.length === 0) return null;

  async function openDesktop(r: Reservation) {
    setBusy(r.id); setError(null);
    try {
      const d = await reservationsApi.desktop(r.id);
      const c = await api.connect(d.id, 'vnc');
      if (c.type === 'vnc') setOpen({ title: `${d.name} · ${r.purpose || r.lab || ''}`, wsPath: c.ws_path, password: c.password, clipboard: c.clipboard ?? 'both' });
    } catch (e) {
      const m = (e as Error).message;
      setError(m === 'STARTING' ? L('데스크톱을 켜는 중입니다. 잠시 뒤 다시 누르세요.', 'The desktop is starting - try again in a moment.') : m);
    } finally { setBusy(null); }
  }

  return (
    <section className="panel rsv-now">
      <div className="panel-head">
        <span className="stat-icon tone-orange"><Icon name="clock" size={18} /></span>
        <div><h2 className="section-title">{L('지금 예약', 'Bookings now')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{L('참가하는 예약의 데스크톱을 여기서 엽니다.', 'Open the desktop of a booking you take part in.')}</p></div>
      </div>
      {error && <div className="alert small error">{error}</div>}
      <ul className="rsv-now-list">
        {now.data.map((r) => (
          <li key={r.id}>
            <span className="strong">{r.purpose || kindText(r.kind, L)}</span>
            <span className="muted small">{r.lab ?? r.pool} · {r.start_at.slice(11)}–{r.end_at.slice(11)} · {r.requester}</span>
            <span className="spacer" />
            {r.running ? <button type="button" className="btn connect" disabled={busy !== null} onClick={() => openDesktop(r)}><Icon name="vm" size={16} />{L('데스크톱 열기', 'Open desktop')}</button>
              : <span className="chip">{L(`${r.start_at.slice(11)} 시작`, `Starts ${r.start_at.slice(11)}`)}</span>}
          </li>
        ))}
      </ul>
      {open && (
        <Suspense fallback={<div className="console-backdrop"><p className="muted">…</p></div>}>
          <ConsoleWindow title={open.title} wsPath={open.wsPath} password={open.password} clipboard={open.clipboard} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </section>
  );
}
