import { useEffect, useMemo, useState } from 'react';
import { nextApi } from '../api/next';
import {
  ConflictError, addDays, dayText, kindText, localText, mondayOf, parseLocal, reserveWhy, reservationsApi, statusText,
  type Block, type CheckResult, type Occurrence, type Participant, type ReserveInput, type ReserveKind, type ReserveOptions, type Reservation,
} from '../api/reservations';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

// LAB 예약, shared by the portal (포털 > 예약) and the console (LAB > 예약): the week and month
// calendars, the booking form with its check, and the list of what an occurrence collides with.

export const useL = () => {
  const { pick, lang } = useI18n();
  return { L: (ko: string, en: string) => pick({ ko, en }), lang };
};
const DAYS_KO = ['월', '화', '수', '목', '금', '토', '일'];
const DAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hm = (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));

function blockTone(b: Block) {
  if (b.type === 'schedule') return 'var(--subtle)';
  if (b.status === 'pending') return 'var(--warn)';
  return b.mine ? 'var(--ok)' : 'var(--accent)';
}

export function blockTitle(b: Block, L: (ko: string, en: string) => string) {
  if (b.type === 'schedule') return b.title || L('정규 수업', 'Class');
  return b.purpose || kindText(b.kind ?? 'seats', L);
}

/** A week as a timetable: one column a day, classes in grey, bookings in colour. */
export function WeekCalendar({ monday, blocks, onPick, showLab = true }: {
  monday: Date; blocks: Block[]; onPick?: (b: Block) => void; showLab?: boolean;
}) {
  const { L, lang } = useL();
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const from = Math.min(8 * 60, ...blocks.map((b) => Math.floor(hm(b.start_at) / 60) * 60));
  const to = Math.max(20 * 60, ...blocks.map((b) => Math.min(24 * 60, Math.ceil((b.end_at.slice(11) === '00:00' ? 1440 : hm(b.end_at)) / 60) * 60)));
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);
  const span = to - from;
  const pct = (m: number) => `${((m - from) / span) * 100}%`;
  const today = dayText(new Date());
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  return (
    <section className="tt rsv-week" aria-label={L('주간 달력', 'Week')}>
      <div className="tt-grid">
        <div className="tt-axis">{hours.map((h) => <span key={h} style={{ top: pct(h) }}>{String(h / 60).padStart(2, '0')}:00</span>)}</div>
        {days.map((d, i) => {
          const key = dayText(d);
          const mine = blocks.filter((b) => b.start_at.slice(0, 10) === key).sort((a, b) => a.start_at.localeCompare(b.start_at));
          // blocks that overlap sit side by side: in each run of overlapping blocks, each takes the
          // first lane free at its start, and the run's blocks share its width
          const lane: number[] = [], width: number[] = [];
          let laneEnds: string[] = [], run: number[] = [], runEnd = '';
          const close = () => { run.forEach((j) => { width[j] = Math.max(1, laneEnds.length); }); laneEnds = []; run = []; };
          mine.forEach((b, j) => {
            if (run.length && b.start_at >= runEnd) close();
            let i = laneEnds.findIndex((e) => e <= b.start_at);
            if (i < 0) { i = laneEnds.length; laneEnds.push(''); }
            laneEnds[i] = b.end_at;
            lane[j] = i; run.push(j);
            runEnd = run.length === 1 ? b.end_at : (b.end_at > runEnd ? b.end_at : runEnd);
          });
          close();
          return (
            <div key={key} className={`tt-day${key === today ? ' today' : ''}`}>
              <div className="tt-head">{(lang === 'ko' ? DAYS_KO : DAYS_EN)[i]} {d.getMonth() + 1}/{d.getDate()}</div>
              <div className="tt-col">
                {hours.map((h) => <span key={h} className="tt-line" style={{ top: pct(h) }} />)}
                {key === today && nowMin >= from && nowMin <= to && <span className="tt-now" style={{ top: pct(nowMin) }} />}
                {mine.map((b, j) => {
                  const end = b.end_at.slice(11) === '00:00' ? 1440 : hm(b.end_at);
                  return (
                    <button key={`${b.type}${b.id}${b.start_at}`} type="button" className={`tt-block rsv-${b.type}${b.status === 'pending' ? ' rsv-pending' : ''}`}
                      onClick={() => onPick?.(b)} disabled={!onPick}
                      style={{ top: pct(hm(b.start_at)), height: `calc(${((end - hm(b.start_at)) / span) * 100}% - 2px)`, borderLeftColor: blockTone(b), ['--blk' as string]: blockTone(b),
                        left: `calc(${(lane[j] / width[j]) * 100}% + 2px)`, right: 'auto', width: `calc(${100 / width[j]}% - 4px)` }}
                      title={`${blockTitle(b, L)} · ${b.lab ?? b.pool ?? ''} · ${b.start_at.slice(11)}–${b.end_at.slice(11)}`}>
                      <span className="tt-time">{b.start_at.slice(11)}–{b.end_at.slice(11)}</span>
                      <span className="tt-title">{blockTitle(b, L)}</span>
                      <span className="tt-sub">{b.type === 'schedule' ? L('정규 수업', 'Class') : b.status === 'pending' ? L('승인 대기', 'Waiting') : b.requester}
                        {showLab ? ` · ${b.lab ?? b.pool ?? ''}` : ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted small tt-legend rsv-legend">
        <span className="rsv-key" style={{ background: 'var(--subtle)' }} />{L('정규 수업 (사용 일정)', 'Class (schedule)')}
        <span className="rsv-key" style={{ background: 'var(--accent)' }} />{L('확정 예약', 'Approved booking')}
        <span className="rsv-key" style={{ background: 'var(--ok)' }} />{L('내 예약', 'Mine')}
        <span className="rsv-key" style={{ background: 'var(--warn)' }} />{L('승인 대기', 'Waiting')}
      </p>
    </section>
  );
}

/** A month: one cell a day with its bookings and classes counted. */
export function MonthCalendar({ month, blocks, onDay }: { month: Date; blocks: Block[]; onDay?: (d: Date) => void }) {
  const { L, lang } = useL();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = mondayOf(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = dayText(new Date());
  return (
    <section className="rsv-month" aria-label={L('월간 달력', 'Month')}>
      {(lang === 'ko' ? DAYS_KO : DAYS_EN).map((d) => <div key={d} className="rsv-mhead">{d}</div>)}
      {cells.map((d) => {
        const key = dayText(d);
        const mine = blocks.filter((b) => b.start_at.slice(0, 10) === key);
        const rsv = mine.filter((b) => b.type === 'reservation');
        const wait = rsv.filter((b) => b.status === 'pending').length;
        return (
          <button key={key} type="button" className={`rsv-mcell${d.getMonth() !== month.getMonth() ? ' out' : ''}${key === today ? ' today' : ''}`}
            onClick={() => onDay?.(d)}>
            <span className="rsv-mday">{d.getDate()}</span>
            {rsv.slice(0, 3).map((b) => (
              <span key={b.id} className="rsv-mitem" style={{ borderLeftColor: blockTone(b) }}>{b.start_at.slice(11)} {blockTitle(b, L)}</span>
            ))}
            {rsv.length > 3 && <span className="muted small">+{rsv.length - 3}</span>}
            <span className="rsv-mfoot">
              {mine.length - rsv.length > 0 && <span className="muted">{L(`수업 ${mine.length - rsv.length}`, `${mine.length - rsv.length} class`)}</span>}
              {wait > 0 && <span className="chip chip-warn">{L(`대기 ${wait}`, `${wait} waiting`)}</span>}
            </span>
          </button>
        );
      })}
    </section>
  );
}

/** What each occurrence of a request collides with, or that it is free. */
export function OccurrenceList({ list }: { list: Occurrence[] }) {
  const { L } = useL();
  const bad = list.filter((o) => o.rules.length || o.conflicts.length);
  return (
    <div className="rsv-occ">
      <p className={`alert small ${bad.length ? 'error' : 'info'}`}>
        {bad.length ? L(`${list.length}회 중 ${bad.length}회가 겹치거나 규칙에 맞지 않습니다.`, `${bad.length} of ${list.length} collide or break the rules.`)
          : L(`${list.length}회 모두 예약할 수 있습니다.`, `All ${list.length} are free.`)}
      </p>
      <ul className="rsv-occ-list">
        {list.map((o) => (
          <li key={o.start} className={o.rules.length || o.conflicts.length ? 'bad' : 'ok'}>
            <span className="strong nowrap">{o.start.replace('T', ' ')}–{o.end.slice(11)}</span>
            {!o.rules.length && !o.conflicts.length && <span className="chip chip-ok">{L('가능', 'Free')}</span>}
            {o.rules.map((r) => <span key={r} className="chip chip-warn">{reserveWhy(r, L)}</span>)}
            {o.conflicts.map((c, i) => (
              <span key={`${c.id}${i}`} className="rsv-conflict">
                <span className="chip chip-off">{reserveWhy(c.why, L)}{c.limit ? ` (${c.limit})` : ''}</span>
                {c.type !== 'limit' && <span className="small">{c.title || (c.type === 'schedule' ? L('정규 수업', 'Class') : L('예약', 'Booking'))}
                  {c.requester ? ` · ${c.requester}` : ''} · {c.start.slice(11)}–{c.end.slice(11)}</span>}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Participants: users, departments and directory groups. Only they get a desktop of the booking. */
export function ParticipantsEditor({ value, onChange }: { value: Participant[]; onChange: (v: Participant[]) => void }) {
  const { L } = useL();
  const [type, setType] = useState<Participant['subject_type']>('user');
  const [subject, setSubject] = useState('');
  const [deps, setDeps] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { nextApi.signupConfig().then((c) => setDeps(c.departments)).catch(() => setDeps([])); }, []);
  const name = (p: Participant) => p.subject_type === 'department' ? deps.find((d) => d.id === p.subject_id)?.name ?? p.subject_id : p.subject_id;
  function add() {
    const id = subject.trim();
    if (!id || value.some((p) => p.subject_type === type && p.subject_id === id)) return;
    onChange([...value, { subject_type: type, subject_id: id }]);
    setSubject('');
  }
  return (
    <div className="rsv-people">
      <div className="form-row form-row-wide">
        <label><span>{L('참가자', 'Participants')}</span>
          <span className="rsv-people-add">
            <select aria-label={L('종류', 'Kind')} value={type} onChange={(e) => { setType(e.target.value as Participant['subject_type']); setSubject(''); }}>
              <option value="user">{L('사용자', 'User')}</option>
              {deps.length > 0 && <option value="department">{L('부서', 'Department')}</option>}
              <option value="group">{L('AD/LDAP 그룹', 'AD/LDAP group')}</option>
            </select>
            {type === 'department' ? (
              <select aria-label={L('부서', 'Department')} value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">{L('고르세요', 'Pick one')}</option>
                {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            ) : <input aria-label={L('이름', 'Name')} value={subject} placeholder={type === 'user' ? L('아이디', 'username') : 'CN=EE-301,OU=Groups,DC=univ,DC=ac,DC=kr'}
              onChange={(e) => setSubject(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />}
          </span></label>
        <span className="check-bottom"><button type="button" className="btn small-btn" disabled={!subject.trim()} onClick={add}><Icon name="plus" size={14} />{L('추가', 'Add')}</button></span>
      </div>
      <div className="chip-row">
        {value.length === 0 && <span className="muted small">{L('비우면 신청자 본인만 데스크톱을 받습니다.', 'Left empty, only you get a desktop.')}</span>}
        {value.map((p, i) => (
          <span key={p.subject_type + p.subject_id} className="chip">
            <span className="muted">{p.subject_type === 'user' ? L('사용자', 'User') : p.subject_type === 'department' ? L('부서', 'Dept') : L('그룹', 'Group')}</span>
            {name(p)}
            <button type="button" className="chip-x" aria-label={L('빼기', 'Remove')} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function nextSlot(): { date: string; start: string; end: string } {
  const d = new Date(Date.now() + 24 * 3600e3);
  return { date: dayText(d), start: '10:00', end: '12:00' };
}

/** A new booking (or a change of one occurrence): what, when, who; checked before it is sent. */
export function ReserveForm({ options, admin = false, initial, presetLab, onDone, onCancel }: {
  options: ReserveOptions; admin?: boolean; initial?: Reservation | null; presetLab?: string;
  onDone: (r: Reservation[], note: string) => void; onCancel?: () => void;
}) {
  const { L } = useL();
  const bookable = options.labs.filter((l) => l.may_book || admin);
  const slot = nextSlot();
  const [kind, setKind] = useState<ReserveKind>(initial?.kind ?? (bookable.length ? 'seats' : 'desktops'));
  const [labId, setLabId] = useState(initial?.lab_id ?? presetLab ?? bookable[0]?.id ?? '');
  const lab = options.labs.find((l) => l.id === labId);
  const poolChoices = kind === 'desktops' ? options.pools : lab?.pools ?? [];
  const [poolId, setPoolId] = useState(initial?.pool_id ?? '');
  const [quantity, setQuantity] = useState(initial?.quantity || 1);
  const [date, setDate] = useState(initial?.start_at.slice(0, 10) ?? slot.date);
  const [start, setStart] = useState(initial?.start_at.slice(11) ?? slot.start);
  const [end, setEnd] = useState(initial?.end_at.slice(11) ?? slot.end);
  const [repeat, setRepeat] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [weeks, setWeeks] = useState(8);
  const [purpose, setPurpose] = useState(initial?.purpose ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [people, setPeople] = useState<Participant[]>(initial?.participants ?? []);
  const [requester, setRequester] = useState('');
  const [banner, setBanner] = useState(false);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!poolChoices.some((p) => p.id === poolId)) setPoolId(poolChoices[0]?.id ?? '');
  }, [kind, labId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCheck(null); }, [kind, labId, poolId, quantity, date, start, end, repeat, weekdays, weeks]);

  const settings = kind === 'desktops' ? options.pool_settings : lab?.settings;
  const dow = (parseLocal(`${date}T00:00`).getDay() + 6) % 7;
  const body = useMemo((): ReserveInput => ({
    kind, lab_id: kind === 'desktops' ? null : labId, pool_id: poolId, quantity: kind === 'lab' ? 0 : quantity,
    start_at: `${date}T${start}`, end_at: end === '24:00' || end === '00:00' ? `${dayText(addDays(parseLocal(`${date}T00:00`), 1))}T00:00` : `${date}T${end}`,
    repeat: repeat && !initial ? { weekdays: weekdays.length ? weekdays : [dow], weeks } : null,
    purpose, note, participants: people, ...(admin && requester.trim() ? { requester: requester.trim() } : {}), ...(admin ? { banner } : {}),
  }), [kind, labId, poolId, quantity, date, start, end, repeat, weekdays, weeks, purpose, note, people, admin, requester, banner, dow, initial]);
  const pool = poolChoices.find((p) => p.id === poolId);
  const max = kind === 'seats' ? (lab?.seats || pool?.desktops || 1) : (pool?.desktops || 1);
  const badTime = end !== '00:00' && end <= start;

  async function runCheck() {
    setBusy(true); setError(null);
    try { setCheck(await reservationsApi.check(body, admin)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function submit(skip = false) {
    setBusy(true); setError(null);
    try {
      if (initial) {
        const r = await reservationsApi.change(initial.id, { ...body, repeat: undefined }, admin);
        onDone([r], r.status === 'pending' ? L('변경했습니다. 다시 승인을 기다립니다.', 'Changed; it waits for approval again.') : L('변경했습니다.', 'Changed.'));
      } else {
        const r = await reservationsApi.create({ ...body, skip_conflicts: skip }, admin);
        const n = r.reservations.length;
        onDone(r.reservations, r.approval
          ? L(`${n}건을 신청했습니다. 승인되면 알림을 보냅니다.`, `${n} requested; you will hear when it is approved.`)
          : L(`${n}건을 예약했습니다.`, `${n} booked.`) + (r.skipped.length ? L(` (겹친 ${r.skipped.length}회는 뺐습니다)`, ` (${r.skipped.length} that collided left out)`) : ''));
      }
    } catch (e) {
      if (e instanceof ConflictError) { setCheck({ ok: false, occurrences: e.occurrences, approval: false }); setError(L('겹치는 항목이 있습니다.', 'It collides with something.')); }
      else setError((e as Error).message);
    } finally { setBusy(false); }
  }

  const some = check && check.occurrences.some((o) => !o.rules.length && !o.conflicts.length);
  return (
    <div className="rsv-form form">
      {!initial && (
        <fieldset className="choices rsv-kinds">
          <legend>{L('무엇을 예약하나요', 'What to book')}</legend>
          <div className="rsv-kind-row">
            {(['lab', 'seats', 'desktops'] as ReserveKind[]).filter((k) => k === 'desktops' ? (options.pool_may_book || admin) && options.pools.length > 0 : bookable.length > 0).map((k) => (
              <label key={k} className={`choice${kind === k ? ' on' : ''}`}>
                <input type="radio" name="rsv-kind" checked={kind === k} onChange={() => setKind(k)} />
                <span><span className="strong">{kindText(k, L)}</span><br /><span className="muted small">{k === 'lab' ? L('수업 · 세미나 — 실습실을 통째로', 'A class or seminar - the whole room')
                  : k === 'seats' ? L('실습실의 좌석 N개', 'N seats of a room') : L('풀의 데스크톱 N대 (실습실 없이)', 'N desktops of a pool (no room)')}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="form-row form-row-even">
        {kind !== 'desktops' && (
          <label><span>LAB</span>
            <select id="rsv-lab" value={labId} onChange={(e) => setLabId(e.target.value)}>
              {bookable.map((l) => <option key={l.id} value={l.id}>{l.name}{l.seats ? L(` · ${l.seats}석`, ` · ${l.seats} seats`) : ''}</option>)}
            </select></label>
        )}
        <label><span>{L('데스크톱 풀', 'Desktop pool')}</span>
          <select id="rsv-pool" value={poolId} onChange={(e) => setPoolId(e.target.value)}>
            {poolChoices.map((p) => <option key={p.id} value={p.id}>{p.name} · {L(`${p.desktops}대`, `${p.desktops} desktops`)}</option>)}
          </select></label>
        {kind !== 'lab' && (
          <label><span>{kind === 'seats' ? L('좌석 수', 'Seats') : L('데스크톱 수', 'Desktops')}</span>
            <input id="rsv-qty" type="number" min={1} max={max} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(max, Number(e.target.value) || 1)))} /></label>
        )}
      </div>
      <div className="form-row form-row-three">
        <label><span>{L('날짜', 'Date')}</span><input id="rsv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label><span>{L('시작', 'Start')}</span><input id="rsv-start" type="time" step={600} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label><span>{L('끝', 'End')}</span><input id="rsv-end" type="time" step={600} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      {settings && (
        <p className="muted small">{L(`예약 가능: ${settings.open_from}–${settings.open_to}, 최대 ${settings.max_minutes / 60}시간, ${settings.max_days_ahead}일 앞까지`,
          `Bookable ${settings.open_from}–${settings.open_to}, at most ${settings.max_minutes / 60} h, up to ${settings.max_days_ahead} days ahead`)}
          {settings.approval ? L(' · 관리자 승인 후 확정', ' · confirmed once approved') : ''}</p>
      )}
      {badTime && <div className="alert small error">{L('끝 시각이 시작보다 늦어야 합니다.', 'The end must be after the start.')}</div>}
      {!initial && (
        <>
          <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /><span>{L('매주 반복', 'Repeat weekly')}</span></label>
          {repeat && (
            <div className="rsv-repeat">
              <div className="day-picks" role="group" aria-label={L('요일', 'Weekdays')}>
                {DAYS_KO.map((d, i) => {
                  const on = weekdays.length ? weekdays.includes(i) : i === dow;
                  return <button key={d} type="button" className={on ? 'on' : ''} aria-pressed={on}
                    onClick={() => setWeekdays((w) => { const cur = w.length ? w : [dow]; return cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort(); })}>{L(d, DAYS_EN[i])}</button>;
                })}
              </div>
              <label className="with-unit"><input id="rsv-weeks" type="number" min={1} max={options.max_weeks} value={weeks}
                onChange={(e) => setWeeks(Math.max(1, Math.min(options.max_weeks, Number(e.target.value) || 1)))} /><span className="muted small">{L('주 동안', 'weeks')}</span></label>
            </div>
          )}
        </>
      )}
      <label><span>{L('목적', 'Purpose')}</span><input id="rsv-purpose" value={purpose} maxLength={120} placeholder={L('예: 디지털회로 실습 3분반, 캡스톤 팀 회의', 'e.g. Digital circuits lab section 3')} onChange={(e) => setPurpose(e.target.value)} /></label>
      <ParticipantsEditor value={people} onChange={setPeople} />
      <label><span>{L('메모', 'Note')}</span><textarea id="rsv-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {admin && !initial && (
        <div className="form-row form-row-even">
          <label><span>{L('신청자 (대신 예약)', 'Requester (on behalf of)')}</span><input id="rsv-req" value={requester} placeholder={L('비우면 나', 'Me when empty')} onChange={(e) => setRequester(e.target.value)} /></label>
          {kind !== 'desktops' && <label className="check check-bottom"><input type="checkbox" checked={banner} onChange={(e) => setBanner(e.target.checked)} /><span>{L('예약 시간에 공지 배너로 알리기', 'Show a notice while it runs')}</span></label>}
        </div>
      )}
      {check && <OccurrenceList list={check.occurrences} />}
      {error && <div className="alert small error" role="alert">{error}</div>}
      <div className="rsv-actions">
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>{L('닫기', 'Close')}</button>}
        <span className="spacer" />
        {!initial && <button type="button" className="btn" disabled={busy || badTime || !poolId} onClick={runCheck}><Icon name="search" size={16} />{L('겹침 확인', 'Check')}</button>}
        {check && !check.ok && some && <button type="button" className="btn" disabled={busy} onClick={() => submit(true)}>{L('겹치는 회차 빼고 예약', 'Book the free ones')}</button>}
        <button type="button" className="btn primary" disabled={busy || badTime || !poolId || (check !== null && !check.ok)} onClick={() => submit(false)}>
          {initial ? L('변경', 'Change') : settings?.approval && !admin ? L('예약 신청', 'Request') : L('예약', 'Book')}</button>
      </div>
    </div>
  );
}

export function StatusChip({ r }: { r: Pick<Reservation, 'status' | 'running'> }) {
  const { L } = useL();
  if (r.running) return <span className="chip chip-ok">{L('진행 중', 'Running')}</span>;
  const cls = r.status === 'approved' ? 'chip-accent' : r.status === 'pending' ? 'chip-warn' : r.status === 'rejected' ? 'chip-off' : 'chip-free';
  return <span className={`chip ${cls}`}>{statusText(r.status, L)}</span>;
}

export const whenText = (r: Pick<Reservation, 'start_at' | 'end_at'>) => `${r.start_at.slice(0, 10)} ${r.start_at.slice(11)}–${r.end_at.slice(11)}`;
export const weekRange = (monday: Date) => [dayText(monday), dayText(addDays(monday, 6))] as const;
export const monthRange = (month: Date) => {
  const s = mondayOf(new Date(month.getFullYear(), month.getMonth(), 1));
  return [dayText(s), dayText(addDays(s, 41))] as const;
};
export { localText };
