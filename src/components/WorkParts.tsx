import { useState } from 'react';
import type { AccelUse, Deferral, DesktopWork } from '../api/types';
import { ACTION_TEXT, reasonText, SOURCE_TEXT, workApi } from '../api/work';
import type { UsePoint } from '../api/work';
import { useI18n } from '../i18n';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

// Shared pieces of 장시간 작업 보호 · GPU/NPU 사용률 (src/api/work.ts): the use chip of a card desktop, the
// portal's "작업 중 - 끄지 마세요" switch, what a clean-up put off says, and a small use-over-time line.

export function useLx() {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
  return { L, when };
}

const gb = (mb: number | null) => (mb === null ? '' : mb >= 1024 ? `${Math.round(mb / 102.4) / 10} GB` : `${Math.round(mb)} MB`);

// "GPU 78% · 18 / 24 GB", or why there is no figure
export function UseChip({ use, threshold }: { use: AccelUse | null | undefined; threshold?: number }) {
  const { L } = useLx();
  if (!use) return null;
  if (use.status === 'off') return <span className="chip chip-free" title={L('카드가 꽂힌 데스크톱이 꺼져 있음', 'The desktop holding the card is off')}>{L('꺼짐 (유휴)', 'off (idle)')}</span>;
  if (use.status !== 'ok' || use.util === null) {
    return <span className="chip chip-free" title={use.status === 'no_agent' ? L('게스트 에이전트가 응답하지 않음', 'Guest agent not answering')
      : L('nvidia-smi · rocm-smi · furiosa-smi · rbln-stat 중 읽을 수 있는 도구가 없음', 'No readable nvidia-smi, rocm-smi, furiosa-smi or rbln-stat')}>{L('측정 불가', 'not measured')}</span>;
  }
  const low = threshold !== undefined && use.util < threshold;
  const kind = use.vendor === 'furiosa' || use.vendor === 'rebellions' ? 'NPU' : 'GPU';
  return (
    <span className={`chip ${low ? 'chip-warn' : use.util >= 50 ? 'chip-on' : 'chip-accent'}`}
      title={use.cards.map((c) => `${c.name || c.vendor} #${c.idx}: ${c.util ?? '-'}%`).join('\n')}>
      {kind} {use.util}%{use.mem_total_mb ? ` · ${gb(use.mem_used_mb)} / ${gb(use.mem_total_mb)}` : ''}
    </span>
  );
}

export function deferralLine(d: Deferral, L: (ko: string, en: string) => string, when: (iso: string) => string) {
  const s = SOURCE_TEXT[d.source] ?? [d.source, d.source];
  const a = ACTION_TEXT[d.action] ?? [d.action, d.action];
  return L(`${s[0]}(${a[0]}) 미루는 중 · 늦어도 ${when(d.deadline)}`, `${s[1]} — ${a[1]} put off (until ${when(d.deadline)} at the latest)`);
}

// the portal tile: card use, the hold switch and what waits
export function WorkStrip({ deskId, work, onChanged }: { deskId: string; work: DesktopWork | undefined; onChanged?: () => void }) {
  const { L, when } = useLx();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hold = work?.hold ?? null;
  async function clear() {
    setBusy(true); setErr(null);
    try { await workApi.clearHold(deskId); onChanged?.(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="work-strip">
      <div className="work-row">
        {work?.use && <UseChip use={work.use} />}
        {hold ? (
          <>
            <span className="chip chip-on" title={hold.note}><Icon name="shield" size={13} />{L(`작업 중 · ${when(hold.until)}까지`, `Working · until ${when(hold.until)}`)}</span>
            <button type="button" className="btn-ghost small" disabled={busy} onClick={clear}>{L('해제', 'Clear')}</button>
          </>
        ) : (
          <button type="button" className="btn-ghost small" onClick={() => setOpen(true)} title={L('긴 학습 · 합성이 돌고 있으면 켜 두세요. 미사용 자동 종료 · 수업 정리가 이 데스크톱을 끄지 않습니다.',
            'Turn on while a long training or synthesis runs: idle shutdown and class clean-up leave this desktop alone.')}>
            <Icon name="shield" size={14} />{L('작업 중 — 끄지 마세요', 'Working — keep it on')}
          </button>
        )}
      </div>
      {(work?.deferrals ?? []).map((d) => (
        <div key={d.id} className="alert info small work-defer">{deferralLine(d, L, when)} · {reasonText(d.reason, L)}</div>
      ))}
      {err && <div className="alert error small" role="alert">{err}</div>}
      {open && <HoldDialog deskId={deskId} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onChanged?.(); }} />}
    </div>
  );
}

const HOURS = [1, 2, 4, 8, 12, 24, 48, 72];

export function HoldDialog({ deskId, max = 72, onClose, onDone }: { deskId: string; max?: number; onClose: () => void; onDone: () => void }) {
  const { L } = useLx();
  const [hours, setHours] = useState(8);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await workApi.setHold(deskId, hours, note.trim()); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('작업 중 — 끄지 마세요', 'Working — keep it on')} onClose={onClose} onSubmit={submit}
      submitLabel={L('켜기', 'Turn on')} busy={busy} error={error}>
      <p className="muted small">{L('이 시간 동안 미사용 자동 종료 · 최대 접속 시간 · LAB 수업/예약 정리 · 예약 작업이 이 데스크톱을 끄거나 초기화하지 않고 미룹니다. 풀의 최대 연장 시간이 지나면 진행될 수 있으니 결과는 수시로 저장하세요.',
        'Until then the idle shutdown, the session limit, LAB class or booking clean-up and scheduled actions put off shutting down or resetting this desktop. Past the pool\'s longest extension they may still run - save your results as you go.')}</p>
      <label><span>{L('기간', 'For')}</span>
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {HOURS.filter((h) => h <= max).map((h) => <option key={h} value={h}>{h < 24 ? L(`${h}시간`, `${h} h`) : L(`${h / 24}일`, `${h / 24} d`)}</option>)}
        </select>
      </label>
      <label><span>{L('메모 (선택)', 'Note (optional)')}</span>
        <input value={note} maxLength={200} placeholder={L('예: ResNet-50 학습 100 epoch', 'e.g. ResNet-50 training, 100 epochs')} onChange={(e) => setNote(e.target.value)} /></label>
    </Dialog>
  );
}

// use over time as a thin line (0-100 %), the idle threshold dashed; gaps where nothing was measured
export function UseLine({ points, threshold, height = 56 }: { points: UsePoint[]; threshold: number; height?: number }) {
  const { L } = useLx();
  if (!points.length) return <p className="muted small">{L('아직 측정값이 없습니다.', 'No samples yet.')}</p>;
  const w = 600;
  const x = (i: number) => (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (u: number) => height - (u / 100) * (height - 4) - 2;
  const segs: string[] = [];
  let cur = '';
  points.forEach((p, i) => {
    if (p.util === null) { if (cur) segs.push(cur); cur = ''; return; }
    cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.util).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  return (
    <svg className="use-line" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img"
      aria-label={L('사용률 추이', 'Use over time')}>
      <line x1={0} x2={w} y1={y(threshold)} y2={y(threshold)} className="use-line-th" />
      {segs.map((d, i) => <path key={i} d={d} className="use-line-path" />)}
    </svg>
  );
}
