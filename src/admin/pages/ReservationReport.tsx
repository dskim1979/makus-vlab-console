import { useCallback } from 'react';
import { reservationsApi, type ReserveReport } from '../../api/reservations';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useL, whenText } from '../../components/ReserveParts';
import { useLoad } from '../../components/useLoad';

const hrs = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
const pct = (n: number) => `${Math.round(n * 100)}%`;

// 운영 > 사용률 보고서 > LAB 예약: booked hours beside the hours someone of the booking was
// connected (the session log), and the no-shows - booked, and nobody connected.
export function ReservationReport({ days }: { days: number }) {
  const { L } = useL();
  const report = useLoad(useCallback(() => reservationsApi.report(days), [days]), [days]);

  function csv(r: ReserveReport) {
    const head = ['lab', 'pool', 'kind', 'quantity', 'start', 'end', 'purpose', 'requester', 'booked_hours', 'used_hours', 'users', 'no_show'];
    const cell = (v: unknown) => { const s = String(v ?? ''); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
    const text = '﻿' + [head.join(','), ...r.reservations.map((x) => [x.lab, x.pool, x.kind, x.quantity, x.start_at, x.end_at, x.purpose, x.requester,
      x.booked_hours, x.used_hours, x.users, x.no_show ? 'Y' : ''].map(cell).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `lab-reservations-${days}d.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <section className="panel rsv-report">
      <div className="panel-head">
        <div><h2 className="section-title">{L('LAB 예약 · 실제 사용', 'LAB bookings vs use')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{L('확정된 예약 시간과 그 시간에 예약 데스크톱 · 참가자의 접속 기록을 대조합니다. 노쇼 = 예약했지만 아무도 접속하지 않음.',
            'Approved booking hours beside the sessions on its desktops or of its participants. No-show = booked, nobody connected.')}</p></div>
        <span className="spacer" />
        {report.state === 'ok' && <button type="button" className="btn" disabled={!report.data.reservations.length} onClick={() => csv(report.data)}><Icon name="download" size={16} />CSV</button>}
      </div>
      <LoadState value={report} retry={report.reload}>
        {(r) => r.reservations.length === 0 ? <div className="empty"><p>{L('이 기간에 확정된 예약이 없습니다.', 'No approved bookings in this period.')}</p></div> : (
          <>
            <div className="stats">
              <div className="stat static"><span className="stat-label">{L('예약', 'Bookings')}</span><span className="stat-value">{r.totals.reservations}</span></div>
              <div className="stat static"><span className="stat-label">{L('예약 시간', 'Booked')}</span><span className="stat-value">{L(`${hrs(r.totals.booked_hours)}시간`, `${hrs(r.totals.booked_hours)} h`)}</span></div>
              <div className="stat static"><span className="stat-label">{L('실제 사용', 'Used')}</span><span className="stat-value">{L(`${hrs(r.totals.used_hours)}시간`, `${hrs(r.totals.used_hours)} h`)}</span>
                <span className="stat-sub">{L(`사용률 ${pct(r.totals.use_rate)}`, `${pct(r.totals.use_rate)} of booked`)}</span></div>
              <div className="stat static"><span className="stat-label">{L('노쇼', 'No-shows')}</span><span className="stat-value">{r.totals.no_shows}</span>
                <span className="stat-sub">{L(`끝난 예약의 ${pct(r.totals.no_show_rate)}`, `${pct(r.totals.no_show_rate)} of ended`)}</span></div>
            </div>
            <div className="table-scroll">
              <table className="table compact-head">
                <thead><tr><th>LAB</th><th className="num">{L('예약', 'Bookings')}</th><th className="num">{L('예약 시간', 'Booked h')}</th><th className="num">{L('실제 사용', 'Used h')}</th>
                  <th className="num">{L('사용률', 'Use')}</th><th className="num">{L('노쇼', 'No-shows')}</th></tr></thead>
                <tbody>
                  {r.by_lab.map((g) => (
                    <tr key={g.lab_id || g.lab}><td className="strong">{g.lab}</td><td className="num">{g.reservations}</td><td className="num">{hrs(g.booked_hours)}</td>
                      <td className="num">{hrs(g.used_hours)}</td><td className="num">{g.booked_hours ? pct(g.used_hours / g.booked_hours) : '-'}</td>
                      <td className="num">{g.no_shows ? <span className="chip chip-warn">{g.no_shows}</span> : 0}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="rsv-report-rows">
              <summary>{L(`예약별 (${r.reservations.length}건)`, `Per booking (${r.reservations.length})`)}</summary>
              <div className="table-scroll">
                <table className="table compact-head">
                  <thead><tr><th>{L('일시', 'When')}</th><th>LAB · {L('풀', 'Pool')}</th><th>{L('목적', 'Purpose')}</th><th>{L('신청자', 'Requester')}</th>
                    <th className="num">{L('예약', 'Booked')}</th><th className="num">{L('사용', 'Used')}</th><th className="num">{L('접속자', 'Users')}</th><th /></tr></thead>
                  <tbody>
                    {r.reservations.map((x) => (
                      <tr key={x.id}><td className="nowrap">{whenText(x)}</td><td>{x.lab || '-'}<br /><span className="muted small">{x.pool}</span></td>
                        <td>{x.purpose || '-'}</td><td>{x.requester}</td><td className="num">{hrs(x.booked_hours)}</td><td className="num">{hrs(x.used_hours)}</td>
                        <td className="num">{x.users}</td>
                        <td>{x.running ? <span className="chip chip-ok">{L('진행 중', 'Running')}</span> : x.no_show ? <span className="chip chip-off">{L('노쇼', 'No-show')}</span> : null}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </LoadState>
    </section>
  );
}
