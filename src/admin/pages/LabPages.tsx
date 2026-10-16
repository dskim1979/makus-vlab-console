import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import type { Lab, LabAfter, LabRun, LabSchedule, LabScheduleInput, Pool, Terminal } from '../../api/types';
import { SERIES } from '../../components/Charts';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { SettingsStatus } from '../../components/SettingsShell';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';

// LAB: rooms of shared PCs (training rooms, labs, shift offices), their terminals, and the
// weekly schedules that start a pool's desktops before a session and put them back after it
// (engine: pegaprox/vlab/labs.py, lab_tick once a minute).

const DAYS: MessageKey[] = ['lab.d0', 'lab.d1', 'lab.d2', 'lab.d3', 'lab.d4', 'lab.d5', 'lab.d6'];
const LAB_POOL_TYPES = ['classroom', 'reset', 'shared'];
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const todayIdx = () => (new Date().getDay() + 6) % 7;
type Notice = { kind: 'info' | 'error'; text: string } | null;

function useWhen() {
  const { t, lang } = useI18n();
  const loc = lang === 'ko' ? 'ko-KR' : 'en-US';
  const slot = (iso: string) => {
    const d = new Date(iso);
    const same = d.toDateString() === new Date().toDateString();
    const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: false });
    return same ? `${t('lab.today')} ${time}` : `${t(DAYS[(d.getDay() + 6) % 7])} ${time}`;
  };
  const ago = (iso: string | null) => {
    if (!iso) return '-';
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return m < 1 ? t('lab.justNow') : m < 60 ? t('lab.minAgo').replace('{n}', String(m))
      : m < 1440 ? t('lab.hourAgo').replace('{n}', String(Math.floor(m / 60))) : new Date(iso).toLocaleDateString(loc);
  };
  return { slot, ago };
}

// --- LAB 관리 --------------------------------------------------------------------

export function LabsPage() {
  const { t } = useI18n();
  const labs = useLoad(adminApi.labs);
  const [editing, setEditing] = useState<Lab | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const { slot } = useWhen();

  async function remove(l: Lab) {
    if (!confirm(t('lab.deleteConfirm').replace('{name}', l.name))) return;
    try { await adminApi.deleteLab(l.id); labs.reload(); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
  }

  return (
    <LoadState value={labs} retry={labs.reload}>
      {(list) => {
        return (
          <>
            <div className="toolbar">
              <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('lab.add')}</button>
              <button type="button" className="btn" onClick={labs.reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
            </div>
            <SettingsStatus items={[
              { label: t('lab.rooms'), value: String(list.length) },
              { label: t('lab.terminals'), value: String(list.reduce((a, l) => a + l.terminals, 0)) },
              { label: t('lab.inSession'), value: String(list.filter((l) => l.current && !l.current.preparing).length), tone: list.some((l) => l.current) ? 'ok' : undefined },
              { label: t('lab.preparing'), value: String(list.filter((l) => l.current?.preparing).length) },
              { label: t('lab.schedules'), value: String(list.reduce((a, l) => a + l.schedules, 0)) },
            ]} />
            <PendingBanner />
            {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`}>{notice.text}</div>}
            {list.length === 0 ? <div className="empty"><p>{t('lab.empty')}</p></div> : (
              <div className="lab-grid">
                {list.map((l) => (
                  <article key={l.id} className="lab-card">
                    <header>
                      <span className="lab-icon"><Icon name="lab" size={20} /></span>
                      <div className="lab-title"><h3>{l.name}</h3><span className="muted small">{l.location || t('lab.noPlace')}</span></div>
                      <span className={`lab-state ${l.current ? (l.current.preparing ? 'prep' : 'on') : 'idle'}`}>
                        {l.current ? t(l.current.preparing ? 'lab.preparingNow' : 'lab.inSessionNow') : t('lab.idle')}
                      </span>
                    </header>
                    <dl className="lab-facts">
                      <div><dt>{t('lab.seats')}</dt><dd>{l.seats || '-'}</dd></div>
                      <div><dt>{t('lab.terminals')}</dt><dd>{l.terminals}{l.pending ? <span className="chip chip-warn">{t('lab.nPending').replace('{n}', String(l.pending))}</span> : null}</dd></div>
                      <div><dt>{t('lab.schedules')}</dt><dd>{l.schedules}</dd></div>
                    </dl>
                    <div className="lab-slot">
                      {l.current ? (
                        <><span className="field-label">{t('lab.now')}</span>
                          <span className="strong">{l.current.title || t('lab.untitled')}</span>
                          <span className="muted small">{slot(l.current.start)} – {l.current.end.slice(11)}</span></>
                      ) : l.next ? (
                        <><span className="field-label">{t('lab.next')}</span>
                          <span className="strong">{l.next.title || t('lab.untitled')}</span>
                          <span className="muted small">{slot(l.next.start)} – {l.next.end.slice(11)}</span></>
                      ) : <span className="muted small">{t('lab.noSchedule')}</span>}
                    </div>
                    {l.description && <p className="muted small lab-desc">{l.description}</p>}
                    <footer>
                      <Link className="btn small-btn" to={`/admin/labs/schedules?lab=${encodeURIComponent(l.id)}`}>{t('lab.viewSchedule')}</Link>
                      <Link className="btn-ghost small-btn" to={`/admin/labs/terminals?lab=${encodeURIComponent(l.id)}`}>{t('lab.viewTerminals')}</Link>
                      <span className="spacer" />
                      <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(l)}>{t('common.edit')}</button>
                      <button type="button" className="btn-ghost small-btn danger" onClick={() => remove(l)}>{t('common.delete')}</button>
                    </footer>
                  </article>
                ))}
              </div>
            )}
            {editing && <LabDialog lab={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); labs.reload(); }} />}
          </>
        );
      }}
    </LoadState>
  );
}

function PendingBanner() {
  const { t } = useI18n();
  const terms = useLoad(adminApi.terminals);
  const n = terms.state === 'ok' ? terms.data.filter((x) => x.state === 'pending').length : 0;
  if (!n) return null;
  return (
    <div className="callout lab-pending"><Icon name="info" size={18} />
      <p>{t('lab.pendingBanner').replace('{n}', String(n))} <Link to="/admin/labs/terminals?state=pending">{t('lab.review')}</Link></p>
    </div>
  );
}

function LabDialog({ lab, onClose, onDone }: { lab: Lab | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(lab?.name ?? '');
  const [location, setLocation] = useState(lab?.location ?? '');
  const [seats, setSeats] = useState(lab?.seats ?? 0);
  const [description, setDescription] = useState(lab?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await adminApi.saveLab(lab?.id ?? null, { name, location, seats, description }); onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={lab ? t('lab.edit') : t('lab.add')} onClose={onClose} onSubmit={submit} submitLabel={t('common.save')} busy={busy || !name.trim()} error={error}>
      <label><span>{t('lab.name')}</span><input id="lab-name" value={name} maxLength={80} placeholder={t('lab.namePh')} onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-row form-row-wide">
        <label><span>{t('lab.place')}</span><input id="lab-place" value={location} maxLength={120} placeholder={t('lab.placePh')} onChange={(e) => setLocation(e.target.value)} /></label>
        <label><span>{t('lab.seats')}</span><input id="lab-seats" type="number" min={0} max={10000} value={seats} onChange={(e) => setSeats(Math.max(0, Number(e.target.value) || 0))} /></label>
      </div>
      <label><span>{t('lab.desc')}</span><input id="lab-desc" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></label>
    </Dialog>
  );
}

// --- 단말 관리 --------------------------------------------------------------------

export function TerminalsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const terms = useLoad(adminApi.terminals);
  const labs = useLoad(adminApi.labs);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const { ago } = useWhen();
  const labFilter = params.get('lab') ?? '';
  const stateFilter = params.get('state') ?? '';
  const labList = labs.state === 'ok' ? labs.data : [];
  const setFilter = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  async function update(x: Terminal, body: Parameters<typeof adminApi.updateTerminal>[1]) {
    try { await adminApi.updateTerminal(x.id, body); terms.reload(); labs.reload(); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
  }
  async function remove(x: Terminal) {
    if (!confirm(t('term.deleteConfirm').replace('{name}', x.name || x.mac))) return;
    try { await adminApi.deleteTerminal(x.id); terms.reload(); labs.reload(); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
  }

  return (
    <LoadState value={terms} retry={terms.reload}>
      {(all) => {
        const list = all.filter((x) => (!labFilter || x.lab_id === labFilter) && (!stateFilter || x.state === stateFilter));
        return (
          <>
            <SettingsStatus items={[
              { label: t('term.all'), value: String(all.length) },
              { label: t('term.approved'), value: String(all.filter((x) => x.state === 'approved').length), tone: 'ok' },
              { label: t('term.pending'), value: String(all.filter((x) => x.state === 'pending').length), tone: all.some((x) => x.state === 'pending') ? 'warn' : undefined },
              { label: t('term.noLab'), value: String(all.filter((x) => !x.lab_id).length) },
              { label: t('term.seenToday'), value: String(all.filter((x) => x.last_seen && Date.now() - new Date(x.last_seen).getTime() < 86400e3).length) },
            ]} />
            <div className="toolbar">
              <select aria-label={t('term.filterLab')} value={labFilter} onChange={(e) => setFilter('lab', e.target.value)}>
                <option value="">{t('term.allLabs')}</option>
                {labList.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <div className="seg" role="group" aria-label={t('term.filterState')}>
                {(['', 'pending', 'approved'] as const).map((s) => (
                  <button key={s} type="button" className={stateFilter === s ? 'on' : ''} aria-pressed={stateFilter === s} onClick={() => setFilter('state', s)}>
                    {t(s === '' ? 'term.all' : s === 'pending' ? 'term.pending' : 'term.approved')}</button>
                ))}
              </div>
              <span className="spacer" />
              <button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t('term.add')}</button>
            </div>
            {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`}>{notice.text}</div>}
            {list.length === 0 ? <div className="empty"><p>{t('term.empty')}</p></div> : (
              <div className="table-scroll">
                <table className="table compact-head">
                  <thead><tr><th>{t('term.name')}</th><th>MAC</th><th>IP</th><th>LAB</th><th>{t('term.state')}</th><th>{t('term.lastSeen')}</th><th>{t('term.by')}</th><th className="actions" /></tr></thead>
                  <tbody>
                    {list.map((x) => (
                      <tr key={x.id} className={x.state === 'pending' ? 'row-pending' : ''}>
                        <td className="strong">{x.name || <span className="muted">{t('term.unnamed')}</span>}</td>
                        <td><code className="code">{x.mac}</code></td>
                        <td className="small">{x.ip || '-'}</td>
                        <td>
                          <select aria-label={`${x.name || x.mac} LAB`} value={x.lab_id ?? ''} onChange={(e) => update(x, { lab_id: e.target.value || null })}>
                            <option value="">{t('term.noLabOpt')}</option>
                            {labList.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                        </td>
                        <td>{x.state === 'pending' ? <span className="chip chip-warn">{t('term.pending')}</span> : <span className="chip chip-ok">{t('term.approved')}</span>}</td>
                        <td className="small nowrap">{ago(x.last_seen)}</td>
                        <td className="small">{x.registered_by || '-'}</td>
                        <td className="actions">
                          {x.state === 'pending' && <button type="button" className="btn small-btn primary" disabled={!x.lab_id && !labList.length}
                            title={!x.lab_id ? t('term.approveHint') : ''} onClick={() => update(x, { state: 'approved' })}>{t('term.approve')}</button>}
                          <button type="button" className="btn-ghost small-btn danger" onClick={() => remove(x)}>{t('common.delete')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">{t('term.note')}</p>
            {adding && <TerminalDialog labs={labList} defaultLab={labFilter} onClose={() => setAdding(false)} onDone={() => { setAdding(false); terms.reload(); labs.reload(); }} />}
          </>
        );
      }}
    </LoadState>
  );
}

function TerminalDialog({ labs, defaultLab, onClose, onDone }: { labs: Lab[]; defaultLab: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [mac, setMac] = useState('');
  const [name, setName] = useState('');
  const [lab, setLab] = useState(defaultLab || labs[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await adminApi.addTerminal({ mac, name, lab_id: lab || null }); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={t('term.add')} onClose={onClose} onSubmit={submit} submitLabel={t('common.save')} busy={busy || !mac.trim()} error={error}>
      <div className="form-row form-row-even">
        <label><span>MAC</span><input id="term-mac" value={mac} placeholder="00:11:22:33:44:55" onChange={(e) => setMac(e.target.value)} /></label>
        <label><span>{t('term.name')}</span><input id="term-name" value={name} maxLength={80} placeholder="A-PC-01" onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <label><span>LAB</span>
        <select id="term-lab" value={lab} onChange={(e) => setLab(e.target.value)}>
          <option value="">{t('term.noLabOpt')}</option>
          {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select></label>
      <small className="muted">{t('term.addHint')}</small>
    </Dialog>
  );
}

// --- 사용 일정 --------------------------------------------------------------------

export function LabSchedulesPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const scheds = useLoad(adminApi.labSchedules);
  const labs = useLoad(adminApi.labs);
  const pools = useLoad(adminApi.pools);
  const [editing, setEditing] = useState<LabSchedule | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const labId = params.get('lab') ?? '';
  const labList = labs.state === 'ok' ? labs.data : [];
  const poolList = pools.state === 'ok' ? pools.data.filter((p) => LAB_POOL_TYPES.includes(p.type)) : [];
  const colorOf = useMemo(() => {
    const ids = poolList.map((p) => p.id);
    return (poolId: string) => SERIES[Math.max(0, ids.indexOf(poolId)) % SERIES.length];
  }, [poolList]);

  async function run(x: LabSchedule, phase: 'prepare' | 'finish') {
    setBusy(true); setNotice(null);
    try {
      const r: LabRun = await adminApi.runLabSchedule(x.id, phase);
      setNotice({ kind: r.failed.length ? 'error' : 'info', text: t(phase === 'prepare' ? 'sch.prepared' : 'sch.finished')
        .replace('{done}', String(r.done.length)).replace('{skipped}', String(r.skipped.length)).replace('{failed}', String(r.failed.length)) });
    } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  }
  async function remove(x: LabSchedule) {
    if (!confirm(t('sch.deleteConfirm').replace('{name}', x.title || `${x.start_time}–${x.end_time}`))) return;
    try { await adminApi.deleteLabSchedule(x.id); scheds.reload(); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
  }

  return (
    <LoadState value={scheds} retry={scheds.reload}>
      {(all) => {
        const list = all.filter((x) => !labId || x.lab_id === labId);
        return (
          <>
            <div className="toolbar">
              <select aria-label={t('term.filterLab')} value={labId} onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set('lab', e.target.value); else p.delete('lab'); setParams(p, { replace: true }); }}>
                <option value="">{t('term.allLabs')}</option>
                {labList.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <span className="spacer" />
              <button type="button" className="btn primary" disabled={!labList.length || !poolList.length} onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('sch.add')}</button>
            </div>
            {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
            <Timetable list={list} colorOf={colorOf} showLab={!labId} onPick={(x) => setEditing(x)} />
            {list.length === 0 ? <div className="empty"><p>{t('sch.empty')}</p></div> : (
              <div className="table-scroll">
                <table className="table compact-head">
                  <thead><tr><th>{t('sch.title')}</th><th>LAB</th><th>{t('sch.pool')}</th><th>{t('sch.days')}</th><th>{t('sch.time')}</th><th>{t('sch.prepare')}</th><th>{t('sch.after')}</th><th className="actions" /></tr></thead>
                  <tbody>
                    {list.map((x) => (
                      <tr key={x.id} className={x.enabled ? '' : 'row-off'}>
                        <td><span className="sch-key" style={{ background: colorOf(x.pool_id) }} /><span className="strong">{x.title || t('lab.untitled')}</span>{!x.enabled && <span className="chip">{t('sch.off')}</span>}</td>
                        <td>{x.lab}</td>
                        <td>{x.pool}<br /><span className="muted small">{x.pool_type ? t(`pooltype.${x.pool_type}` as MessageKey) : ''}</span></td>
                        <td className="nowrap">{x.weekdays.map((d) => t(DAYS[d])).join(' ')}</td>
                        <td className="nowrap">{x.start_time}–{x.end_time}</td>
                        <td className="nowrap">{t('sch.minBefore').replace('{n}', String(x.prepare_min))}</td>
                        <td className="nowrap">{t(`sch.after.${x.after}` as MessageKey)}</td>
                        <td className="actions">
                          <button type="button" className="btn-ghost small-btn" disabled={busy} onClick={() => run(x, 'prepare')}>{t('sch.runPrepare')}</button>
                          <button type="button" className="btn-ghost small-btn" disabled={busy || x.after === 'none'} onClick={() => run(x, 'finish')}>{t('sch.runFinish')}</button>
                          <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(x)}>{t('common.edit')}</button>
                          <button type="button" className="btn-ghost small-btn danger" onClick={() => remove(x)}>{t('common.delete')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">{t('sch.note')}</p>
            {editing && <ScheduleDialog item={editing === 'new' ? null : editing} labs={labList} pools={poolList} defaultLab={labId}
              onClose={() => setEditing(null)} onDone={() => { setEditing(null); scheds.reload(); labs.reload(); }} />}
          </>
        );
      }}
    </LoadState>
  );
}

// A week as a timetable: one column a weekday, the sessions as blocks to scale.
function Timetable({ list, colorOf, showLab, onPick }: { list: LabSchedule[]; colorOf: (id: string) => string; showLab: boolean; onPick: (x: LabSchedule) => void }) {
  const { t } = useI18n();
  const on = list.filter((x) => x.enabled);
  const from = Math.min(8 * 60, ...on.map((x) => Math.floor(hm(x.start_time) / 60) * 60 - (x.prepare_min ? 60 : 0)));
  const to = Math.max(18 * 60, ...on.map((x) => Math.ceil(hm(x.end_time) / 60) * 60));
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);
  const span = to - from;
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const pct = (m: number) => `${((m - from) / span) * 100}%`;
  return (
    <section className="tt" aria-label={t('sch.week')}>
      <div className="tt-grid">
        <div className="tt-axis">{hours.map((h) => <span key={h} style={{ top: pct(h) }}>{String(h / 60).padStart(2, '0')}:00</span>)}</div>
        {DAYS.map((d, i) => (
          <div key={d} className={`tt-day${i === todayIdx() ? ' today' : ''}`}>
            <div className="tt-head">{t(d)}</div>
            <div className="tt-col">
              {hours.map((h) => <span key={h} className="tt-line" style={{ top: pct(h) }} />)}
              {i === todayIdx() && nowMin >= from && nowMin <= to && <span className="tt-now" style={{ top: pct(nowMin) }} />}
              {on.filter((x) => x.weekdays.includes(i)).map((x) => (
                <button key={x.id} type="button" className="tt-block" onClick={() => onPick(x)}
                  style={{ top: pct(hm(x.start_time)), height: `calc(${((hm(x.end_time) - hm(x.start_time)) / span) * 100}% - 2px)`, borderLeftColor: colorOf(x.pool_id), ['--blk' as string]: colorOf(x.pool_id) }}
                  title={`${x.title} · ${x.pool} · ${x.start_time}–${x.end_time}`}>
                  {x.prepare_min > 0 && <span className="tt-prep" style={{ height: `${(x.prepare_min / (hm(x.end_time) - hm(x.start_time))) * 100}%` }} />}
                  <span className="tt-time">{x.start_time}–{x.end_time}</span>
                  <span className="tt-title">{x.title || x.pool}</span>
                  <span className="tt-sub">{showLab ? x.lab : x.pool}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="muted small tt-legend"><span className="tt-prep-key" /> {t('sch.prepLegend')}</p>
    </section>
  );
}

function ScheduleDialog({ item, labs, pools, defaultLab, onClose, onDone }: {
  item: LabSchedule | null; labs: Lab[]; pools: Pool[]; defaultLab: string; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [v, setV] = useState<LabScheduleInput>(() => item ? {
    lab_id: item.lab_id, pool_id: item.pool_id, title: item.title, weekdays: item.weekdays, start_time: item.start_time,
    end_time: item.end_time, prepare_min: item.prepare_min, after: item.after, enabled: item.enabled,
  } : { lab_id: defaultLab || labs[0]?.id || '', pool_id: pools.find((p) => p.type === 'classroom')?.id ?? pools[0]?.id ?? '', title: '',
    weekdays: [0, 2], start_time: '09:00', end_time: '12:00', prepare_min: 15, after: 'reset', enabled: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof LabScheduleInput>(k: K, x: LabScheduleInput[K]) => setV((o) => ({ ...o, [k]: x }));
  const toggleDay = (d: number) => setV((o) => ({ ...o, weekdays: o.weekdays.includes(d) ? o.weekdays.filter((x) => x !== d) : [...o.weekdays, d].sort() }));
  const save = useCallback(async () => {
    setBusy(true); setError(null);
    try { await adminApi.saveLabSchedule(item?.id ?? null, v); onDone(); }
    catch (e) {
      const code = (e as { body?: { code?: string } }).body?.code;
      setError(code === 'OVERLAP' ? t('sch.overlap') : (e as Error).message);
    } finally { setBusy(false); }
  }, [item, v, onDone, t]);
  const bad = !v.weekdays.length || hm(v.end_time) <= hm(v.start_time);
  return (
    <Dialog open wide title={item ? t('sch.edit') : t('sch.add')} onClose={onClose} onSubmit={save} submitLabel={t('common.save')} busy={busy || bad} error={error}>
      <div className="form-row form-row-even">
        <label><span>LAB</span>
          <select id="sch-lab" value={v.lab_id} onChange={(e) => set('lab_id', e.target.value)}>{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label><span>{t('sch.pool')}</span>
          <select id="sch-pool" value={v.pool_id} onChange={(e) => set('pool_id', e.target.value)}>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name} · {t(`pooltype.${p.type}` as MessageKey)}</option>)}
          </select></label>
      </div>
      <label><span>{t('sch.title')}</span><input id="sch-title" value={v.title} maxLength={80} placeholder={t('sch.titlePh')} onChange={(e) => set('title', e.target.value)} /></label>
      <span className="field-label">{t('sch.days')}</span>
      <div className="day-picks" role="group" aria-label={t('sch.days')}>
        {DAYS.map((d, i) => <button key={d} type="button" className={v.weekdays.includes(i) ? 'on' : ''} aria-pressed={v.weekdays.includes(i)} onClick={() => toggleDay(i)}>{t(d)}</button>)}
        <button type="button" className="btn-ghost small-btn" onClick={() => set('weekdays', [0, 1, 2, 3, 4])}>{t('sch.weekdaysOnly')}</button>
      </div>
      <div className="form-row form-row-three">
        <label><span>{t('sch.start')}</span><input id="sch-start" type="time" value={v.start_time} onChange={(e) => set('start_time', e.target.value)} /></label>
        <label><span>{t('sch.end')}</span><input id="sch-end" type="time" value={v.end_time} onChange={(e) => set('end_time', e.target.value)} /></label>
        <label><span>{t('sch.prepare')}</span>
          <span className="with-unit"><input id="sch-prep" type="number" min={0} max={180} value={v.prepare_min} onChange={(e) => set('prepare_min', Math.max(0, Math.min(180, Number(e.target.value) || 0)))} />
            <span className="muted small">{t('sch.minBeforeUnit')}</span></span></label>
      </div>
      {hm(v.end_time) <= hm(v.start_time) && <div className="alert small error">{t('sch.badTime')}</div>}
      <label><span>{t('sch.after')}</span>
        <select id="sch-after" value={v.after} onChange={(e) => set('after', e.target.value as LabAfter)}>
          {(['reset', 'off', 'none'] as const).map((a) => <option key={a} value={a}>{t(`sch.after.${a}` as MessageKey)}</option>)}
        </select>
        <small className="muted">{t(`sch.afterHint.${v.after}` as MessageKey)}</small></label>
      <label className="check"><input type="checkbox" checked={v.enabled !== false} onChange={(e) => set('enabled', e.target.checked)} /><span>{t('sch.enabled')}</span></label>
    </Dialog>
  );
}

// --- 일정형 풀 --------------------------------------------------------------------

export function ScheduledPoolsPage() {
  const { t } = useI18n();
  const pools = useLoad(adminApi.pools);
  const scheds = useLoad(adminApi.labSchedules);
  return (
    <LoadState value={pools} retry={pools.reload}>
      {(all) => {
        const list = all.filter((p) => LAB_POOL_TYPES.includes(p.type));
        const sch = scheds.state === 'ok' ? scheds.data : [];
        const hours = (p: Pool) => sch.filter((x) => x.pool_id === p.id && x.enabled)
          .reduce((a, x) => a + ((hm(x.end_time) - hm(x.start_time)) / 60) * x.weekdays.length, 0);
        return (
          <>
            <div className="toolbar">
              <Link className="btn primary" to="/admin/pools/list"><Icon name="plus" size={16} />{t('spool.create')}</Link>
              <Link className="btn" to="/admin/labs/schedules">{t('spool.toSchedules')}</Link>
            </div>
            <p className="muted small">{t('spool.intro')}</p>
            {list.length === 0 ? <div className="empty"><p>{t('spool.empty')}</p></div> : (
              <div className="table-scroll">
                <table className="table compact-head">
                  <thead><tr><th>{t('sch.pool')}</th><th>{t('spool.type')}</th><th className="num">{t('spool.desktops')}</th><th>{t('spool.labs')}</th><th className="num">{t('spool.slots')}</th><th className="num">{t('spool.hours')}</th><th className="actions" /></tr></thead>
                  <tbody>
                    {list.map((p) => {
                      const mine = sch.filter((x) => x.pool_id === p.id);
                      const rooms = [...new Set(mine.map((x) => x.lab).filter(Boolean))];
                      return (
                        <tr key={p.id}>
                          <td className="strong">{p.name}</td>
                          <td><span className={`chip${p.type === 'classroom' ? ' chip-accent' : ''}`}>{t(`pooltype.${p.type}` as MessageKey)}</span></td>
                          <td className="num">{p.desktops}</td>
                          <td>{rooms.length ? rooms.join(', ') : <span className="muted small">{t('spool.noLab')}</span>}</td>
                          <td className="num">{mine.length}</td>
                          <td className="num">{hours(p) ? t('spool.perWeek').replace('{n}', hours(p).toFixed(0)) : '-'}</td>
                          <td className="actions"><Link className="btn-ghost small-btn" to={`/admin/pools/list/${encodeURIComponent(p.id)}`}>{t('spool.open')}</Link></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        );
      }}
    </LoadState>
  );
}
