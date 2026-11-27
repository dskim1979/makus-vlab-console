import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { AdminLease } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { SettingsStatus } from '../../components/SettingsShell';
import { useI18n } from '../../i18n';
import { workApi } from '../../api/work';
import type { Reclaim } from '../../api/work';
import type { WorkSettings } from '../../api/types';
import { UseChip, UseLine, useLx } from '../../components/WorkParts';

type Notice = { kind: 'info' | 'error'; text: string };
const DAY = 864e5;

// <input type=datetime-local> value for a Date, in local time
function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function defaultEnd(days = 7) {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(18, 0, 0, 0);
  return localInput(d);
}

// 가속 자원 > 카드 대여 현황: GPU and FPGA cards lent to users' desktops for a period.
export function LeasesPage() {
  const { t, lang } = useI18n();
  const [all, setAll] = useState(false);
  const leases = useLoad(useCallback(() => adminApi.leases(all), [all]), [all]);
  const { L } = useLx();
  const [rules, setRules] = useState(false);
  const [trend, setTrend] = useState<AdminLease | null>(null);
  const [lending, setLending] = useState(false);
  const [extending, setExtending] = useState<AdminLease | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
  const left = (iso: string | null) => {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return <span className="chip chip-warn">{t('ln.overdue')}</span>;
    const txt = ms >= DAY ? t('ln.days').replace('{n}', String(Math.floor(ms / DAY))) : t('ln.hours').replace('{n}', String(Math.max(1, Math.floor(ms / 36e5))));
    return <span className={`chip ${ms < DAY ? 'chip-warn' : 'chip-on'}`}>{t('ln.left').replace('{n}', txt)}</span>;
  };

  async function giveBack(l: AdminLease) {
    if (!confirm(t('ln.returnConfirm').replace('{name}', l.resource_name))) return;
    try { await adminApi.returnLease(l.id); setNotice(null); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    leases.reload();
  }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => setLending(true)}><Icon name="fpga" size={16} />{t('ln.lend')}</button>
        <label className="check-inline"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>{t('ln.showReturned')}</span></label>
        <button type="button" className="btn" onClick={leases.reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
        <button type="button" className="btn" onClick={() => setRules(true)}><Icon name="gear" size={16} />{L('유휴 카드 회수 설정', 'Idle card rules')}</button>
      </div>
      <ReclaimPanel onChanged={leases.reload} />
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}

      <LoadState value={leases} retry={leases.reload}>
        {(list) => {
          const active = list.filter((l) => l.state === 'active');
          const remain = (l: AdminLease) => (l.ends_at ? new Date(l.ends_at).getTime() - Date.now() : Infinity);
          const soon = active.filter((l) => remain(l) > 0 && remain(l) < DAY);
          const week = active.filter((l) => remain(l) > 0 && remain(l) < 7 * DAY);
          const overdue = active.filter((l) => remain(l) <= 0);
          const kinds = (['gpu', 'fpga', 'npu'] as const).map((k) => [k, active.filter((l) => l.resource_type === k).length] as const).filter(([, n]) => n);
          return (
            <>
              <SettingsStatus items={[
                { label: t('ln.active'), value: String(active.length), tone: active.length ? 'ok' : 'off' },
                { label: t('ln.dueSoon'), value: String(soon.length), tone: soon.length ? 'warn' : undefined },
                { label: t('ln.dueWeek'), value: String(week.length) },
                { label: t('ln.overdueN'), value: String(overdue.length), tone: overdue.length ? 'warn' : undefined },
                { label: t('ln.borrowers'), value: String(new Set(active.map((l) => l.username)).size) },
                { label: t('ln.kinds'), value: kinds.length ? kinds.map(([k, n]) => `${k.toUpperCase()} ${n}`).join(' · ') : '-' },
              ]} />
              {list.length === 0 ? <div className="empty"><p>{t('ln.empty')}</p></div> : (
                <div className="table-scroll">
                  <table className="table compact-head">
                    <thead><tr><th>{t('ln.card')}</th><th>{t('ln.user')}</th><th>{t('ln.desktop')}</th><th>{L('최근 사용률', 'Recent use')}</th><th>{t('ln.from')}</th>
                      <th>{t('ln.until')}</th><th /></tr></thead>
                    <tbody>
                      {list.map((l) => (
                        <tr key={l.id} className={l.state !== 'active' ? 'row-off' : ''}>
                          <td className="nowrap">
                            <span className={`lease-kind tone-${l.resource_type === 'gpu' ? 'green' : 'pink'}`}>
                              <Icon name={l.resource_type === 'gpu' ? 'gpu' : l.resource_type === 'npu' ? 'npu' : 'fpga'} size={16} />
                            </span>
                            <span className="strong">{l.resource_name}</span><br />
                            <code className="code">{l.resource_id}</code>
                          </td>
                          <td className="strong">{l.username}</td>
                          <td className="nowrap">{l.desktop ?? `VMID ${l.vmid}`}{' '}
                            {l.vm_running && <span className="status st-ready small"> <span className="dot" /></span>}</td>
                          <td className="nowrap">{l.state === 'active' ? (
                            <button type="button" className="link-btn" onClick={() => setTrend(l)} title={L('사용률 추이 보기', 'Show use over time')}>
                              {l.use ? <UseChip use={l.use} /> : <span className="muted small">{L('측정 전', 'no data')}</span>}
                            </button>) : null}
                            {l.reclaim?.state === 'suggested' && <span className="chip chip-warn">{L('회수 제안', 'Reclaim?')}</span>}</td>
                          <td className="nowrap small">{fmt(l.starts_at)}</td>
                          <td className="nowrap">{fmt(l.ends_at)} {l.state === 'active' ? left(l.ends_at)
                            : <span className="chip chip-free">{t('ln.returned')} {fmt(l.returned_at)}</span>}</td>
                          <td className="actions">
                            {l.state === 'active' && (
                              <>
                                <button type="button" className="btn-ghost" onClick={() => setExtending(l)}>{t('ln.extend')}</button>
                                <button type="button" className="btn-ghost danger" onClick={() => giveBack(l)}>{t('ln.return')}</button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="muted small">{t('ln.note')}</p>
              {lending && <LendDialog active={active} onClose={() => setLending(false)}
                onDone={(n) => { setLending(false); setNotice(n); leases.reload(); }} />}
              {rules && <ReclaimRulesDialog onClose={() => setRules(false)} />}
              {trend && <UseTrendDialog lease={trend} onClose={() => setTrend(null)} />}
              {extending && <ExtendDialog lease={extending} onClose={() => setExtending(null)}
                onDone={() => { setExtending(null); leases.reload(); }} />}
            </>
          );
        }}
      </LoadState>
    </>
  );
}

function LendDialog({ active, onClose, onDone }: { active: AdminLease[]; onClose: () => void; onDone: (n: Notice) => void }) {
  const { t, pick } = useI18n();
  const desktops = useLoad(adminApi.desktops);
  const assigned = desktops.state === 'ok' ? desktops.data.filter((d) => d.assigned_user && !active.some((l) => l.desktop_id === d.id)) : [];
  const [deskId, setDeskId] = useState('');
  const desk = assigned.find((d) => d.id === deskId) ?? assigned[0];
  useEffect(() => { if (desk && desk.id !== deskId) setDeskId(desk.id); }, [desk, deskId]);
  const inv = useLoad(useCallback(() => (desk?.cluster_id ? adminApi.accelerators(desk.cluster_id)
    : new Promise<never>(() => {})), [desk?.cluster_id]), [desk?.cluster_id]);
  const [mapping, setMapping] = useState('');
  const [ends, setEnds] = useState(defaultEnd());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // whole-card mappings only (a vGPU mapping is shared through a pool policy)
  const options = inv.state === 'ok' ? inv.data.mappings.filter((m) => !m.mdev || m.devices.some((d) => d.id.startsWith('10ee'))).map((m) => ({
    ...m, free: Math.max(0, m.devices.length - active.filter((l) => l.resource_id === m.id && l.cluster_id === desk?.cluster_id).length),
  })) : [];
  useEffect(() => {
    if (options.length && !options.some((m) => m.id === mapping)) setMapping((options.find((m) => m.free > 0) ?? options[0]).id);
  }, [options, mapping]);

  async function submit() {
    if (!desk) return;
    setBusy(true); setError(null);
    try {
      const r = await adminApi.lend({ desktop_id: desk.id, mapping, ends_at: new Date(ends).toISOString(), name: name.trim() || undefined });
      const warns = (r.warnings ?? []).filter((w) => w.severity !== 'info');
      onDone({ kind: warns.length ? 'error' : 'info', text: t('ln.lent').replace('{name}', r.lease.resource_name) + (r.needs_restart ? ` ${t('ln.restart')}` : '')
        + (warns.length ? ` ${t('ln.checks').replace('{n}', String(warns.length))} ${pick({ ko: warns[0].ko, en: warns[0].en })}` : '') });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chosen = options.find((m) => m.id === mapping);
  return (
    <Dialog open title={t('ln.lend')} onClose={onClose} onSubmit={submit} submitLabel={t('ln.lend')}
      busy={busy || !desk || !chosen || chosen.free === 0} error={error}>
      <LoadState value={desktops} retry={desktops.reload}>
        {() => assigned.length === 0 ? <div className="alert small">{t('ln.noDesktop')}</div> : (
          <>
            <label>
              <span>{t('ln.pickDesktop')}</span>
              <select value={deskId} onChange={(e) => setDeskId(e.target.value)}>
                {assigned.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.assigned_user} · {d.pool}</option>)}
              </select>
            </label>
            <LoadState value={inv} retry={inv.reload}>
              {() => (
                <div className="pick-list" role="radiogroup" aria-label={t('ln.pickMapping')}>
                  {options.map((m) => (
                    <label key={m.id} className={`pick${mapping === m.id ? ' on' : ''}${m.free === 0 ? ' off' : ''}`}>
                      <input type="radio" name="mapping" checked={mapping === m.id} disabled={m.free === 0} aria-label={m.id}
                        onChange={() => setMapping(m.id)} />
                      <span className="strong">{m.description || m.id}</span>
                      <span className={`chip ${m.free ? 'chip-accent' : 'chip-free'}`}>{t('ln.free').replace('{n}', String(m.free))}</span>
                      <span className="muted small"><code className="code">{m.id}</code> · {m.devices.map((d) => d.node).join(', ')}</span>
                    </label>
                  ))}
                </div>
              )}
            </LoadState>
            <div className="form-row form-row-even">
              <label><span>{t('ln.endsAt')}</span>
                <input type="datetime-local" required value={ends} min={localInput(new Date())} onChange={(e) => setEnds(e.target.value)} /></label>
              <label><span>{t('ln.name')}</span>
                <input value={name} maxLength={80} placeholder={chosen?.description} onChange={(e) => setName(e.target.value)} /></label>
            </div>
          </>
        )}
      </LoadState>
    </Dialog>
  );
}

function ExtendDialog({ lease, onClose, onDone }: { lease: AdminLease; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const base = lease.ends_at ? new Date(lease.ends_at) : new Date();
  const [ends, setEnds] = useState(localInput(new Date(base.getTime() + 7 * DAY)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await adminApi.extendLease(lease.id, new Date(ends).toISOString()); onDone(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open title={`${t('ln.extend')} · ${lease.resource_name}`} onClose={onClose} onSubmit={submit} submitLabel={t('ln.extend')}
      busy={busy} error={error}>
      <label><span>{t('ln.endsAt')}</span>
        <input type="datetime-local" required value={ends} min={localInput(base)} onChange={(e) => setEnds(e.target.value)} /></label>
    </Dialog>
  );
}

// 유휴 카드 회수: loans whose card sat under the threshold for N hours (pegaprox/api/vlab_work.py reclaim_tick)
function ReclaimPanel({ onChanged }: { onChanged: () => void }) {
  const { L, when } = useLx();
  const list = useLoad(workApi.reclaims);
  const [err, setErr] = useState<string | null>(null);
  if (list.state !== 'ok' || list.data.reclaims.length === 0) return null;
  const { rules } = list.data;
  async function act(r: Reclaim, what: 'dismiss' | 'return') {
    setErr(null);
    try {
      if (what === 'dismiss') await workApi.dismiss(r.lease_id);
      else if (confirm(L(`${r.card} 을(를) 지금 회수할까요? 실행 중인 데스크톱은 다음 재시작 때 카드가 빠집니다.`, `Take ${r.card} back now? A running desktop loses it at its next restart.`))) await adminApi.returnLease(r.lease_id);
      else return;
      list.reload(); onChanged();
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="stat-icon tone-orange"><Icon name="fpga" size={18} /></span>
        <div>
          <h2 className="section-title">{L('회수 제안', 'Reclaim suggestions')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{L(`${rules.idle_hours}시간 동안 사용률 ${rules.threshold_pct}% 미만인 대여 카드입니다.`,
            `Loaned cards under ${rules.threshold_pct}% for ${rules.idle_hours} h.`)}
            {rules.auto_return ? ' ' + L(`제안 ${rules.auto_return_hours}시간 뒤 자동 반납됩니다.`, `They go back by themselves ${rules.auto_return_hours} h after the suggestion.`) : ''}</p>
        </div>
      </div>
      {err && <div className="alert error small" role="alert">{err}</div>}
      <div className="table-scroll"><table className="table compact-head">
        <thead><tr><th>{L('카드', 'Card')}</th><th>{L('사용자', 'User')}</th><th>{L('데스크톱', 'Desktop')}</th><th>{L('평균 사용률', 'Average use')}</th>
          <th>{L('제안 시각', 'Suggested')}</th><th /></tr></thead>
        <tbody>{list.data.reclaims.map((r) => {
          const avg = r.summary?.util_avg ?? r.avg_util;
          return (
            <tr key={r.lease_id} className={r.state === 'dismissed' ? 'row-off' : ''}>
              <td className="strong">{r.card}</td><td>{r.username}</td><td>{r.desktop ?? '-'}</td>
              <td>{avg === null ? '-' : `${avg}%`}
                {r.summary && r.summary.off_hours > 0 && <span className="muted small"> · {L(`꺼짐 ${r.summary.off_hours}시간`, `off ${r.summary.off_hours} h`)}</span>}</td>
              <td className="nowrap small">{when(r.suggested_at)}</td>
              <td className="actions">
                {r.state === 'dismissed' ? <span className="chip chip-free">{L('유지하기로 함', 'kept')}</span> : (
                  <>
                    <button type="button" className="btn-ghost" onClick={() => act(r, 'dismiss')}>{L('유지', 'Keep')}</button>
                    <button type="button" className="btn-ghost danger" onClick={() => act(r, 'return')}>{L('회수', 'Take back')}</button>
                  </>
                )}
              </td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}

function ReclaimRulesDialog({ onClose }: { onClose: () => void }) {
  const { L } = useLx();
  const cur = useLoad(workApi.settings);
  const [s, setS] = useState<WorkSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (cur.state === 'ok' && !s) setS(cur.data); }, [cur, s]);
  const rc = s?.reclaim;
  const setR = <K extends keyof WorkSettings['reclaim']>(k: K, v: WorkSettings['reclaim'][K]) => setS((o) => (o ? { ...o, reclaim: { ...o.reclaim, [k]: v } } : o));
  const whole = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || lo)));
  async function submit() {
    if (!s) return;
    setBusy(true); setError(null);
    try { await workApi.saveSettings(s); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('유휴 카드 회수 · 사용률 측정', 'Idle cards and use sampling')} onClose={onClose} onSubmit={submit}
      submitLabel={L('저장', 'Save')} busy={busy || !s} error={error}>
      {!s || !rc ? <p className="muted">…</p> : (
        <>
          <label className="check"><input type="checkbox" checked={rc.enabled} onChange={(e) => setR('enabled', e.target.checked)} />
            <span className="strong">{L('쓰이지 않는 대여 카드를 사용자에게 알리고 회수 제안', 'Tell the user and suggest a reclaim for idle loaned cards')}</span></label>
          <div className="form-row form-row-even">
            <label><span>{L('기간 (N시간)', 'For (N hours)')}</span>
              <input type="number" min={1} max={720} value={rc.idle_hours} disabled={!rc.enabled} onChange={(e) => setR('idle_hours', whole(e.target.value, 1, 720))} /></label>
            <label><span>{L('사용률 미만 (X%)', 'Under (X %)')}</span>
              <input type="number" min={0} max={100} value={rc.threshold_pct} disabled={!rc.enabled} onChange={(e) => setR('threshold_pct', whole(e.target.value, 0, 100))} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={rc.auto_return} disabled={!rc.enabled} onChange={(e) => setR('auto_return', e.target.checked)} />
            <span>{L('제안 뒤에도 계속 쓰이지 않으면 자동 반납', 'Give the card back by itself if it stays idle')}</span></label>
          <label><span>{L('자동 반납까지 (M시간)', 'Return after (M hours)')}</span>
            <input type="number" min={1} max={720} value={rc.auto_return_hours} disabled={!rc.enabled || !rc.auto_return}
              onChange={(e) => setR('auto_return_hours', whole(e.target.value, 1, 720))} /></label>
          <div className="form-row form-row-even">
            <label><span>{L('측정 주기 (분)', 'Sample every (min)')}</span>
              <input type="number" min={1} max={60} value={s.sample_minutes} onChange={(e) => setS({ ...s, sample_minutes: whole(e.target.value, 1, 60) })} /></label>
            <label><span>{L('보관 (일)', 'Keep (days)')}</span>
              <input type="number" min={7} max={400} value={s.retention_days} onChange={(e) => setS({ ...s, retention_days: whole(e.target.value, 7, 400) })} /></label>
            <label><span>{L('"작업 중" 최대 (시간)', '"Working" at most (h)')}</span>
              <input type="number" min={1} max={720} value={s.hold_max_hours} onChange={(e) => setS({ ...s, hold_max_hours: whole(e.target.value, 1, 720) })} /></label>
          </div>
          <small className="muted">{L('사용률은 게스트 에이전트로 읽으며, 측정 불가인 카드는 제안하지 않습니다.',
            'Use is read through the guest agent; cards not measured are never suggested.')}</small>
        </>
      )}
    </Dialog>
  );
}

function UseTrendDialog({ lease, onClose }: { lease: AdminLease; onClose: () => void }) {
  const { L } = useLx();
  const [hours, setHours] = useState(24);
  const data = useLoad(useCallback(() => workApi.usage({ lease_id: lease.id, hours }), [lease.id, hours]), [lease.id, hours]);
  return (
    <Dialog open wide title={`${L('사용률 추이', 'Use over time')} · ${lease.resource_name}`} onClose={onClose}>
      <div className="seg" role="group">
        {[24, 72, 168].map((h) => <button key={h} type="button" className={`seg-btn${hours === h ? ' on' : ''}`} onClick={() => setHours(h)}>{h < 48 ? L(`${h}시간`, `${h} h`) : L(`${h / 24}일`, `${h / 24} d`)}</button>)}
      </div>
      <LoadState value={data} retry={data.reload}>
        {(u) => (
          <>
            <UseLine points={u.series} threshold={u.threshold_pct} />
            <SettingsStatus items={[
              { label: L('평균', 'Average'), value: u.summary.util_avg === null ? L('측정 불가', 'not measured') : `${u.summary.util_avg}%` },
              { label: L('최대', 'Peak'), value: u.summary.util_max === null ? '-' : `${u.summary.util_max}%` },
              { label: L('측정 시간', 'Measured'), value: `${u.summary.measured_hours} h` },
              { label: L(`유휴 (${u.threshold_pct}% 미만 · 꺼짐)`, `Idle (under ${u.threshold_pct}% · off)`), value: `${u.summary.idle_hours} h`,
                tone: u.summary.idle_hours > u.summary.measured_hours / 2 ? 'warn' : undefined },
            ]} />
          </>
        )}
      </LoadState>
    </Dialog>
  );
}
