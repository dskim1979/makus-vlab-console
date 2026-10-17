import { useMemo, useState } from 'react';
import { AB_WHY_KO, accelBookingsApi, type ABInput, type ABKind, type ABOptions, type AccelBooking } from '../api/accelBookings';
import { bookingStatus } from '../admin/pages/BuildFarmPages';
import { Icon } from '../components/Icon';
import { LoadState } from '../components/LoadState';
import { useLoad } from '../components/useLoad';
import { useI18n } from '../i18n';

// 포털 > 예약 › 카드 · 보드: book a GPU · NPU · FPGA card or a JTAG board for one of my desktops,
// see when the one I want is taken, and my bookings. It is put on 5 minutes before the start.

const pad = (n: number) => String(n).padStart(2, '0');
const dayText = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const KIND: Record<string, [string, string]> = { gpu: ['GPU', 'GPU'], npu: ['NPU', 'NPU'], fpga: ['FPGA', 'FPGA'], board: ['보드', 'Board'] };

export function AccelBookingsTab() {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const options = useLoad(accelBookingsApi.options);
  const mine = useLoad(accelBookingsApi.mine);
  const cal = useLoad(() => accelBookingsApi.calendar());
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function cancel(r: AccelBooking) {
    if (!confirm(r.started_at ? L(`${r.resource_name}를 지금 반납할까요?`, `Give ${r.resource_name} back now?`) : L(`${r.resource_name} 예약을 취소할까요?`, `Cancel the booking of ${r.resource_name}?`))) return;
    try { await accelBookingsApi.cancel(r.id); mine.reload(); cal.reload(); setNote(L('취소했습니다.', 'Cancelled.')); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <LoadState value={options} retry={options.reload}>
      {(o) => (
        <>
          {note && <div className="alert small info" role="status">{note}</div>}
          {err && <div className="alert small error" role="alert">{err}</div>}
          {!o.allowed ? <div className="empty"><p>{L('카드 · 보드 예약을 쓸 수 없습니다. 관리자에게 문의하세요.', 'You cannot book cards or boards here.')}</p></div>
            : o.desktops.length === 0 ? <div className="empty"><p>{L('카드를 붙일 내 데스크톱(가상머신)이 없습니다. 받을 수 있는 데스크톱에서 먼저 받으세요.', 'You have no desktop (VM) to put a card on yet.')}</p></div>
              : <section className="panel"><BookForm o={o} taken={cal.state === 'ok' ? cal.data : []} onDone={(msg) => { setNote(msg); setErr(null); mine.reload(); cal.reload(); }} /></section>}
          <section className="panel">
            <h2 className="section-title">{L('내 카드 · 보드 예약', 'My card and board bookings')}</h2>
            <LoadState value={mine} retry={mine.reload}>
              {(list) => list.length === 0 ? <p className="muted small">{L('예약이 없습니다.', 'No bookings.')}</p> : (
                <div className="table-scroll"><table className="table compact-head">
                  <thead><tr><th>{L('일시', 'When')}</th><th>{L('카드 · 보드', 'Card / board')}</th><th>{L('데스크톱', 'Desktop')}</th><th>{L('목적', 'Purpose')}</th><th>{L('상태', 'State')}</th><th className="actions" /></tr></thead>
                  <tbody>{list.map((r) => (
                    <tr key={r.id} className={r.status === 'cancelled' || r.status === 'rejected' ? 'row-off' : ''}>
                      <td className="nowrap">{r.start_at.replace('T', ' ')} ~ {r.end_at.slice(11)}</td>
                      <td><span className="chip chip-accent">{L(...(KIND[r.card_kind] ?? ['카드', 'Card']))}</span> {r.resource_name}</td>
                      <td>{r.desktop ?? '-'}</td>
                      <td className="small">{r.purpose || '-'}{r.reason && <div className="muted small">{L('사유', 'Reason')}: {r.reason}</div>}{r.error && <div className="muted small">{r.error}</div>}</td>
                      <td>{bookingStatus(r, L)}</td>
                      <td className="actions">{(r.status === 'pending' || r.status === 'approved') && !r.finished_at &&
                        <button type="button" className="btn-ghost small-btn danger" onClick={() => cancel(r)}>{r.started_at ? L('반납', 'Give back') : L('취소', 'Cancel')}</button>}</td>
                    </tr>))}</tbody>
                </table></div>
              )}
            </LoadState>
          </section>
        </>
      )}
    </LoadState>
  );
}

function BookForm({ o, taken, onDone }: { o: ABOptions; taken: AccelBooking[]; onDone: (msg: string) => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const [kind, setKind] = useState<ABKind>(o.cards.length ? 'card' : 'board');
  const [resource, setResource] = useState(o.cards[0]?.id ?? o.boards[0]?.id ?? '');
  const [desk, setDesk] = useState(o.desktops[0]?.id ?? '');
  const [day, setDay] = useState(dayText(tomorrow));
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('18:00');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = kind === 'card' ? o.cards : o.boards;
  const res = list.find((x) => x.id === resource);
  const busyThatDay = useMemo(() => taken.filter((b) => b.resource === resource && b.kind === kind && b.start_at.slice(0, 10) <= day && b.end_at.slice(0, 10) >= day)
    .sort((a, b) => a.start_at.localeCompare(b.start_at)), [taken, resource, kind, day]);
  const count = kind === 'card' ? (res as ABOptions['cards'][number] | undefined)?.count ?? 1 : 1;
  function switchKind(k: ABKind) {
    setKind(k);
    setResource((k === 'card' ? o.cards : o.boards)[0]?.id ?? '');
  }
  async function submit() {
    const d = o.desktops.find((x) => x.id === desk);
    if (!res || !d) return;
    setBusy(true); setErr(null);
    const body: ABInput = { kind, cluster_id: res.cluster_id, resource, desktop_id: desk, start_at: `${day}T${from}`, end_at: `${day}T${to}`, purpose };
    try {
      const r = await accelBookingsApi.book(body);
      onDone(r.booking.status === 'pending' ? L('예약을 신청했습니다. 승인되면 메일로 알려 드립니다.', 'Requested; you hear when it is approved.')
        : L(`예약했습니다. ${from} 5분 전에 ${d.name}에 붙입니다.`, `Booked; it goes on ${d.name} 5 minutes before ${from}.`));
    } catch (e) {
      const c = (e as Error).message;
      setErr(c === 'CONFLICT' ? L('그 시간에는 남은 것이 없습니다. 아래 예약된 시간을 보고 다른 시간을 고르세요.', 'That time is taken - see the bookings below.') : AB_WHY_KO[c] ?? c);
    } finally { setBusy(false); }
  }
  return (
    <form className="ab-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h2 className="section-title">{L('새 카드 · 보드 예약', 'Book a card or board')}</h2>
      <div className="segmented" role="tablist">
        <button type="button" role="tab" disabled={!o.cards.length} className={kind === 'card' ? 'on' : ''} aria-selected={kind === 'card'} onClick={() => switchKind('card')}><Icon name="gpu" size={14} />{L('가속 카드 (GPU · NPU · FPGA)', 'Card (GPU · NPU · FPGA)')}</button>
        <button type="button" role="tab" disabled={!o.boards.length} className={kind === 'board' ? 'on' : ''} aria-selected={kind === 'board'} onClick={() => switchKind('board')}><Icon name="fpga" size={14} />{L('보드 (JTAG)', 'Board (JTAG)')}</button>
      </div>
      <div className="form-row form-row-even">
        <label><span>{kind === 'card' ? L('카드', 'Card') : L('보드', 'Board')}</span>
          <select value={resource} onChange={(e) => setResource(e.target.value)}>
            {list.map((x) => <option key={x.id} value={x.id}>{x.name}{'count' in x ? ` · ${KIND[x.kind]?.[0] ?? ''} ${x.count}${L('장', '')}` : ` · ${x.node}`}</option>)}
          </select></label>
        <label><span>{L('붙일 내 데스크톱', 'My desktop')}</span>
          <select value={desk} onChange={(e) => setDesk(e.target.value)}>{o.desktops.map((d) => <option key={d.id} value={d.id}>{d.name}{d.pool ? ` (${d.pool})` : ''}</option>)}</select></label>
      </div>
      <div className="form-row form-row-even">
        <label><span>{L('날짜', 'Date')}</span><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <label><span>{L('시작', 'From')}</span><input type="time" value={from} step={900} onChange={(e) => setFrom(e.target.value)} /></label>
        <label><span>{L('끝', 'To')}</span><input type="time" value={to} step={900} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <label><span>{L('목적 (선택)', 'Purpose (optional)')}</span><input value={purpose} maxLength={120} placeholder={L('예: LLaMA 미세조정 · HLS 커널 측정', 'e.g. fine-tuning, HLS kernel timing')} onChange={(e) => setPurpose(e.target.value)} /></label>
      <div className="ab-taken">
        <span className="field-label">{L(`그날 예약된 시간 — ${res?.name ?? ''} (${count}${kind === 'card' ? L('장', ' cards') : ''})`, `Booked that day - ${res?.name ?? ''}`)}</span>
        {busyThatDay.length === 0 ? <span className="muted small">{L('예약이 없습니다.', 'Nothing booked.')}</span> : (
          <ul className="ab-slots">{busyThatDay.map((b) => (
            <li key={b.id}><span className="nowrap">{b.start_at.slice(11)} ~ {b.end_at.slice(11)}</span> {b.username ? <span className="chip chip-gap">{L('내 예약', 'mine')}</span> : null}
              {b.status === 'pending' && <span className="chip chip-warn chip-gap">{L('승인 대기', 'pending')}</span>}</li>))}</ul>)}
      </div>
      <p className="muted small">{kind === 'card'
        ? L(`시작 5분 전에 카드를 붙입니다. 카드는 데스크톱을 다시 시작해야 보이니, 시작 시간에 작업을 저장하고 다시 시작하세요. 최대 ${o.settings.max_hours}시간, ${o.settings.max_days_ahead}일 앞까지.`,
          `It goes on 5 minutes before; restart the desktop to see the card. Up to ${o.settings.max_hours} h, ${o.settings.max_days_ahead} days ahead.`)
        : res && 'target' in res && res.target === 'network'
          ? L('네트워크 보드(JTAG 서버 공유)는 VM을 바꾸지 않습니다. 시작하면 내 자원 › 내 보드에 접속 주소와 사용법이 나옵니다.', 'A network board leaves the VM alone; once it starts, My resources › My boards shows the address and how to connect.')
          : L('보드는 데스크톱이 보드가 꽂힌 서버에서 돌고 있을 때 붙습니다.', 'A board goes on while the desktop runs on the board\'s server.')}
        {o.settings.approval ? L(' 승인 뒤에 확정됩니다.', ' It needs approval.') : ''}</p>
      {err && <div className="alert small error" role="alert">{err}</div>}
      <div><button type="submit" className="btn primary" disabled={busy || !res || !desk || to <= from}>{L('예약', 'Book')}</button></div>
    </form>
  );
}
