import { useState } from 'react';
import { ACTION_TEXT, reasonText, SOURCE_TEXT, workApi } from '../../api/work';
import type { Deferral } from '../../api/types';
import { Icon } from '../../components/Icon';
import { useLoad } from '../../components/useLoad';
import { useLx } from '../../components/WorkParts';

// 데스크톱 풀 > 데스크톱 상태 > 장시간 작업 보호: the clean-ups put off because a desktop was working, and the
// users' "작업 중" switches (pegaprox/api/vlab_work.py). An admin lets a waiting step run now or drops it.
const STATE_TEXT: Record<Deferral['state'], [string, string, string]> = {
  waiting: ['미루는 중', 'waiting', 'chip-warn'], done: ['작업 끝나 진행', 'ran after the work', 'chip-on'],
  forced: ['최대 연장 뒤 진행', 'ran at the longest wait', 'chip-accent'], dropped: ['취소됨 (상황 바뀜)', 'dropped', 'chip-free'],
  cancelled: ['관리자가 취소', 'cancelled', 'chip-free'], failed: ['실행 실패', 'failed', 'chip-warn'],
};

export function WorkPanel({ onChanged }: { onChanged?: () => void }) {
  const { L, when } = useLx();
  const work = useLoad(workApi.adminWork);
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (work.state !== 'ok') return null;
  const { deferrals, holds, waiting } = work.data;
  if (!deferrals.length && !holds.length) return null;
  async function act(fn: () => Promise<void>) {
    setErr(null);
    try { await fn(); work.reload(); onChanged?.(); } catch (e) { setErr((e as Error).message); }
  }
  const rows = all ? deferrals : deferrals.filter((d) => d.state === 'waiting');
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="stat-icon tone-green"><Icon name="shield" size={18} /></span>
        <div>
          <h2 className="section-title">{L('장시간 작업 보호', 'Long jobs kept running')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{L(`작업 중이라 미룬 정리 ${waiting}건 · 사용자가 켠 "작업 중" ${holds.length}건. 작업이 끝나거나 풀의 최대 연장 시간이 지나면 진행합니다.`,
            `${waiting} clean-ups waiting for work to finish · ${holds.length} "working" switches on. A step runs once the work ends or the pool's longest wait is over.`)}</p>
        </div>
        <div className="panel-actions">
          <label className="check-inline"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>{L('지난 7일 기록', 'Last 7 days')}</span></label>
        </div>
      </div>
      {err && <div className="alert error small" role="alert">{err}</div>}
      {rows.length > 0 && (
        <div className="table-scroll"><table className="table compact-head">
          <thead><tr><th>{L('데스크톱', 'Desktop')}</th><th>{L('미룬 단계', 'Step')}</th><th>{L('이유', 'Why')}</th><th>{L('사용자', 'User')}</th>
            <th>{L('시작 · 기한', 'Since · until')}</th><th>{L('상태', 'State')}</th><th /></tr></thead>
          <tbody>{rows.map((d) => {
            const st = STATE_TEXT[d.state];
            return (
              <tr key={d.id}>
                <td className="strong">{d.desktop ?? d.desktop_id}</td>
                <td className="nowrap">{L(SOURCE_TEXT[d.source]?.[0] ?? d.source, SOURCE_TEXT[d.source]?.[1] ?? d.source)}
                  <div className="muted small">{L(ACTION_TEXT[d.action]?.[0] ?? d.action, ACTION_TEXT[d.action]?.[1] ?? d.action)}</div></td>
                <td className="small">{reasonText(d.reason, L)}</td>
                <td>{d.username || '-'}</td>
                <td className="nowrap small">{when(d.first_at)}<div className="muted">~ {when(d.deadline)}</div></td>
                <td><span className={`chip ${st[2]}`} title={d.result}>{L(st[0], st[1])}</span></td>
                <td className="actions">{d.state === 'waiting' && (
                  <>
                    <button type="button" className="btn-ghost" title={L('작업과 상관없이 다음 1분 안에 진행', 'Run it within the next minute regardless')}
                      onClick={() => confirm(L('지금 진행할까요? 실행 중인 작업이 중단될 수 있습니다.', 'Run it now? A running job may be stopped.')) && act(() => workApi.release(d.id))}>{L('지금 진행', 'Run now')}</button>
                    <button type="button" className="btn-ghost" title={L('이 단계를 실행하지 않음', 'Do not run this step')}
                      onClick={() => act(() => workApi.cancel(d.id))}>{L('취소', 'Drop')}</button>
                  </>
                )}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {holds.length > 0 && (
        <div className="work-holds">
          <span className="field-label">{L('사용자가 켠 "작업 중"', '"Working" switches')}</span>
          {holds.map((h) => (
            <span key={h.id} className="chip chip-on">
              {h.desktop ?? h.desktop_id} · {h.username} · {L(`${when(h.until)}까지`, `until ${when(h.until)}`)}{h.note ? ` · ${h.note}` : ''}
              <button type="button" className="chip-x" aria-label={L('해제', 'Clear')} title={L('해제', 'Clear')}
                onClick={() => act(() => workApi.clearAnyHold(h.id))}>×</button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
