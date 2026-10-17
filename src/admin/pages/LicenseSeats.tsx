import { Fragment, useCallback, useMemo, useState } from 'react';
import { adminApi } from '../../api/admin';
import { licenseApi } from '../../api/licenses';
import type { LicenseMode, SeatFeature, SeatReport, SeatSettings, SeatUsage } from '../../api/licenses';
import type { LicenseServer } from '../../api/next';
import { SERIES, Legend, TimeSeries } from '../../components/Charts';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// 가속 자원 › 라이선스 서버 › 사용 현황 (the panel under the server list) and 운영 > 사용률 보고서 >
// 라이선스 사용 현황 (the report): seats per feature from lmstat, who holds them on which MOAVI desktop,
// use over time, shortages and refusals (engine: pegaprox/api/vlab_license.py). Inline ko/en.

function useL() {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const loc = lang === 'ko' ? 'ko-KR' : 'en-US';
  const at = (sec: number | null | undefined, withDay = true) => (sec ? new Date(sec * 1000).toLocaleString(loc,
    withDay ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false } : { hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
  const dur = (min: number) => (min >= 60 ? L(`${Math.floor(min / 60)}시간 ${min % 60}분`, `${Math.floor(min / 60)} h ${min % 60} min`) : L(`${min}분`, `${min} min`));
  return { L, at, dur, lang };
}

const errText = (e: unknown) => (e as Error).message;
const PERIODS = [{ h: 24, ko: '24시간', en: '24 h' }, { h: 168, ko: '7일', en: '7 days' }, { h: 720, ko: '30일', en: '30 days' }, { h: 2160, ko: '90일', en: '90 days' }];

export function modeLabel(mode: LicenseMode | undefined, L: (ko: string, en: string) => string) {
  return mode === 'engine' ? L('엔진 lmstat', 'engine lmstat') : mode === 'agent' ? L('게스트 에이전트', 'guest agent') : L('끔', 'off');
}

function SeatBar({ f }: { f: Pick<SeatFeature, 'in_use' | 'total' | 'threshold'> }) {
  const pct = f.total ? Math.min(100, (100 * f.in_use) / f.total) : 0;
  const tone = f.total && f.in_use >= f.total ? 'var(--danger)' : f.threshold > 0 && pct >= f.threshold ? 'var(--warn)' : 'var(--accent)';
  return (
    <span className="seat-bar" title={`${f.in_use}/${f.total}`}>
      <span className="bar-track"><span className="bar-fill" style={{ width: `${pct}%`, background: tone }} /></span>
      {f.threshold > 0 && f.threshold < 100 && <span className="seat-mark" style={{ left: `${f.threshold}%` }} />}
    </span>
  );
}

// --- the panel ---------------------------------------------------------------------------------

export function LicenseSeatsPanel({ server, onChanged, onClose }: { server: LicenseServer; onChanged: () => void; onClose: () => void }) {
  const { L, at, dur } = useL();
  const [hours, setHours] = useState(24);
  const usage = useLoad(useCallback(() => licenseApi.usage(server.id, hours), [server.id, hours]), [server.id, hours]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [chartOf, setChartOf] = useState('');

  async function collect() {
    setBusy(true); setNotice(null);
    try {
      const r = await licenseApi.collect(server.id);
      setNotice(r.ok ? { kind: 'info', text: L(`읽었습니다: 기능 ${r.features.length}개.`, `Read: ${r.features.length} features.`) } : { kind: 'error', text: r.error });
      usage.reload(); onChanged();
    } catch (e) { setNotice({ kind: 'error', text: errText(e) }); } finally { setBusy(false); }
  }

  return (
    <section className="panel seat-panel" aria-label={L('라이선스 사용량', 'Seat use')}>
      <div className="panel-head">
        <div>
          <h2 className="section-title">{L(`라이선스 사용량 · ${server.name}`, `Seat use · ${server.name}`)}</h2>
          <p className="muted small" style={{ margin: 0 }}>{L('lmstat 으로 기능(feature)마다 전체 라이선스 · 사용 중 · 누가 쥐고 있는지를 5분마다 읽어 90일 보관합니다.',
            'lmstat is read every 5 minutes: seats, in use and who holds them per feature, kept 90 days.')}</p>
        </div>
        <div className="panel-actions">
          <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="gear" size={16} />{L('수집 설정', 'Collection')}</button>
          <button type="button" className="btn" disabled={busy || server.usage_mode === 'off' || !server.usage_mode} onClick={collect}><Icon name="refresh" size={16} />{L('지금 읽기', 'Read now')}</button>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label={L('닫기', 'Close')}>✕</button>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
      <LoadState value={usage} retry={usage.reload}>
        {(u) => (
          <>
            <SeatStatus u={u} />
            {u.settings.mode === 'off' ? (
              <div className="empty"><p>{L('이 서버는 라이선스 수집이 꺼져 있습니다. "수집 설정"에서 방식을 고르세요.', 'Seat reading is off for this server. Pick a way under "Collection".')}</p></div>
            ) : u.features.length === 0 ? (
              <div className="empty"><p>{L('아직 읽은 기록이 없습니다. "지금 읽기"로 확인해 보세요.', 'Nothing read yet. Try "Read now".')}</p></div>
            ) : (
              <>
                <div className="toolbar">
                  <div className="segmented" role="group" aria-label={L('기간', 'Period')}>
                    {PERIODS.map((p) => <button key={p.h} type="button" className={p.h === hours ? 'on' : ''} aria-pressed={p.h === hours} onClick={() => setHours(p.h)}>{L(p.ko, p.en)}</button>)}
                  </div>
                </div>
                <SeatStats u={u} />
                <div className="table-scroll"><table className="table compact-head seat-table">
                  <thead><tr><th>{L('기능', 'Feature')}</th><th>{L('사용 중 / 전체', 'In use / seats')}</th><th className="num">{L('기준', 'Alert at')}</th>
                    <th className="num">{L('최대 · 평균', 'Peak · avg')}</th><th className="num">{L('라이선스 부족', 'Shortages')}</th><th className="num">{L('거부', 'Refused')}</th><th className="actions" /></tr></thead>
                  <tbody>{u.features.map((f) => (
                    <Fragment key={f.feature}>
                      <tr>
                        <td className="strong">{f.feature}<div className="muted small">{f.vendor || '-'}{!f.current && ` · ${L('지금은 없음', 'not listed now')}`}</div></td>
                        <td className="seat-cell">
                          <span className="nowrap"><b>{f.in_use}</b> / {f.total} <span className="muted small">({f.pct}%)</span>
                            {f.queued > 0 && <span className="chip chip-warn" style={{ marginLeft: 6 }}>{L(`대기 ${f.queued}`, `${f.queued} queued`)}</span>}
                            {f.alerted === 'full' && <span className="chip chip-off">{L('라이선스 없음', 'full')}</span>}
                            {f.alerted === 'high' && <span className="chip chip-warn" style={{ marginLeft: 6 }}>{L('기준 초과', 'over')}</span>}</span>
                          <SeatBar f={f} />
                        </td>
                        <td className="num">{f.threshold ? `${f.threshold}%` : L('끔', 'off')}</td>
                        <td className="num">{f.peak} · {f.avg.toFixed(1)}</td>
                        <td className="num">{f.shortage_count ? <span className="chip chip-warn">{L(`${f.shortage_count}회 · ${dur(f.shortage_minutes)}`, `${f.shortage_count}× · ${dur(f.shortage_minutes)}`)}</span> : '0'}</td>
                        <td className="num">{f.denied || '-'}</td>
                        <td className="actions nowrap">
                          <button type="button" className="btn-ghost small-btn" onClick={() => setChartOf(f.feature)}>{L('그래프', 'Chart')}</button>
                          <button type="button" className="btn-ghost small-btn" aria-expanded={!!open[f.feature]} disabled={!f.holders.length}
                            onClick={() => setOpen({ ...open, [f.feature]: !open[f.feature] })}>{L(`사용자 ${f.holders.length}`, `${f.holders.length} users`)}</button>
                        </td>
                      </tr>
                      {open[f.feature] && f.holders.length > 0 && (
                        <tr className="seat-holders"><td colSpan={7}>
                          <table className="table compact-head">
                            <thead><tr><th>{L('사용자', 'User')}</th><th>{L('MOAVI 데스크톱', 'MOAVI desktop')}</th><th>{L('호스트 · 디스플레이', 'Host · display')}</th>
                              <th>{L('시작', 'Since')}</th><th className="num">{L('사용 시간', 'Held')}</th><th className="num">{L('라이선스 수', 'Seats')}</th><th>{L('버전', 'Version')}</th></tr></thead>
                            <tbody>{f.holders.map((h, i) => (
                              <tr key={`${h.user}-${h.host}-${i}`}>
                                <td className="strong">{h.user}</td>
                                <td>{h.desktop ? <>{h.desktop.name} <span className="muted small">{h.desktop.pool}</span>
                                  {h.desktop.match === 'user' && <span className="chip" style={{ marginLeft: 6 }} title={L('호스트 이름이 다르고, 이 사용자의 접속 세션이 하나뿐이라 그 데스크톱으로 봤습니다', 'The host name differs; the user has one open session, so that desktop')}>{L('세션으로 추정', 'by session')}</span>}</>
                                  : <span className="muted small">{L('MOAVI 밖 (개인 PC · 서버)', 'outside MOAVI')}</span>}</td>
                                <td><code className="code">{h.host}</code>{h.display && h.display !== h.host && <span className="muted small"> {h.display}</span>}</td>
                                <td className="nowrap">{at(h.since)}</td>
                                <td className="num">{dur(h.minutes)}</td>
                                <td className="num">{h.count}</td>
                                <td className="muted small">{h.version || '-'}</td>
                              </tr>))}</tbody>
                          </table>
                        </td></tr>
                      )}
                    </Fragment>))}</tbody>
                </table></div>
                <SeatChart u={u} feature={chartOf && u.series[chartOf] ? chartOf : u.features[0]?.feature ?? ''} onPick={setChartOf} />
                {u.settings.debug_log || u.denied_total ? <Denials u={u} /> : (
                  <p className="muted small">{L('거부 기록: 게스트 에이전트 방식에서 lmgrd 디버그 로그 경로를 넣으면 DENIED 줄을 모아 보여 줍니다.',
                    'Refusals: in guest agent mode, name the lmgrd debug log and its DENIED lines are counted here.')}</p>
                )}
              </>
            )}
          </>
        )}
      </LoadState>
      {editing && usage.state === 'ok' && <SeatSettingsDialog server={server} current={usage.data.settings} features={usage.data.features.map((f) => f.feature)}
        onClose={() => setEditing(false)} onDone={(msg) => { setEditing(false); setNotice({ kind: 'info', text: msg }); usage.reload(); onChanged(); }} />}
    </section>
  );
}

function SeatStatus({ u }: { u: SeatUsage }) {
  const { L, at } = useL();
  const s = u.settings;
  return (
    <p className="muted small" style={{ margin: 0 }}>
      {L('수집 방식', 'Collected by')}: <b>{modeLabel(s.mode, L)}</b>
      {s.mode !== 'off' && <> · {L('포트', 'port')} {(s.lm_ports.length ? s.lm_ports : ['-']).join(', ')} · {L('마지막 읽기', 'last read')} {at(u.at)}</>}
      {s.mode === 'engine' && <> · lmutil <code className="code">{u.lmutil || L('없음', 'not found')}</code></>}
      {s.last_ok === 0 && s.last_error && <span className="danger-text"> · {s.last_error}</span>}
    </p>
  );
}

function SeatStats({ u }: { u: SeatUsage }) {
  const { L, dur } = useL();
  const live = u.features.filter((f) => f.current);
  const inUse = live.reduce((a, f) => a + f.in_use, 0), total = live.reduce((a, f) => a + f.total, 0);
  const runs = u.features.reduce((a, f) => a + f.shortage_count, 0), mins = u.features.reduce((a, f) => a + f.shortage_minutes, 0);
  const holders = new Set(live.flatMap((f) => f.holders.map((h) => h.user)));
  return (
    <div className="stats">
      <div className="stat static"><span className="stat-label">{L('사용 중 라이선스', 'Seats in use')}</span><span className="stat-value">{inUse} / {total}</span>
        <span className="stat-sub">{L(`기능 ${live.length}개 · 사용자 ${holders.size}명`, `${live.length} features · ${holders.size} users`)}</span></div>
      <div className="stat static"><span className="stat-label">{L('기준 넘은 기능', 'Over the alert line')}</span><span className="stat-value">{live.filter((f) => f.alerted).length}</span>
        <span className="stat-sub">{L('알림 채널로 한 번 알림', 'alert channels told once')}</span></div>
      <div className="stat static"><span className="stat-label">{L('라이선스 부족 (사용 중 = 전체)', 'Shortages (all seats taken)')}</span><span className="stat-value">{L(`${runs}회`, `${runs}×`)}</span>
        <span className="stat-sub">{L(`합계 ${dur(mins)}`, `${dur(mins)} in all`)}</span></div>
      <div className="stat static"><span className="stat-label">{L('거부 (DENIED)', 'Refused (DENIED)')}</span><span className="stat-value">{u.denied_total}</span>
        <span className="stat-sub">{u.settings.debug_log ? L('lmgrd 디버그 로그', 'lmgrd debug log') : L('디버그 로그 미설정', 'no debug log set')}</span></div>
    </div>
  );
}

function SeatChart({ u, feature, onPick }: { u: SeatUsage; feature: string; onPick: (f: string) => void }) {
  const { L, at } = useL();
  const pts = u.series[feature] ?? [];
  const series = [
    { name: L('사용 중 (최대)', 'In use (peak)'), color: SERIES[0], points: pts.map((p) => ({ ts: p.t * 1000, v: p.max })) },
    { name: L('사용 중 (평균)', 'In use (avg)'), color: SERIES[1], points: pts.map((p) => ({ ts: p.t * 1000, v: p.avg })) },
    { name: L('전체 라이선스', 'Seats'), color: SERIES[2], points: pts.map((p) => ({ ts: p.t * 1000, v: p.total })) },
  ];
  const top = Math.max(1, ...pts.map((p) => p.total));
  return (
    <div className="seat-chart">
      <div className="panel-head">
        <h3 className="section-title">{L(u.bucket === 3600 ? '시간대별 사용' : '일별 사용', u.bucket === 3600 ? 'Use by hour' : 'Use by day')}</h3>
        <select aria-label={L('기능', 'Feature')} value={feature} onChange={(e) => onPick(e.target.value)}>
          {u.features.map((f) => <option key={f.feature} value={f.feature}>{f.feature}</option>)}
        </select>
      </div>
      <Legend series={series.map((s) => ({ name: s.name, color: s.color }))} />
      <TimeSeries series={series} height={200} max={top + Math.max(1, Math.round(top * 0.1))}
        fmtTime={(ts, short) => (short ? at(ts / 1000, false) : at(ts / 1000))} empty={L('이 기간에 기록이 없습니다.', 'Nothing in this period.')} />
    </div>
  );
}

function Denials({ u }: { u: SeatUsage }) {
  const { L, at } = useL();
  return (
    <details className="seat-denials" open={u.denied_total > 0 && u.denied_total <= 10}>
      <summary>{L(`거부 기록 ${u.denied_total}건`, `${u.denied_total} refusals`)}{u.denied_total > u.denials.length && L(` (최근 ${u.denials.length}건)`, ` (latest ${u.denials.length})`)}</summary>
      {u.denials.length === 0 ? <p className="muted small">{L('이 기간에 거부된 체크아웃이 없습니다.', 'No refused checkouts in this period.')}</p> : (
        <div className="table-scroll"><table className="table compact-head">
          <thead><tr><th>{L('시각', 'When')}</th><th>{L('기능', 'Feature')}</th><th>{L('사용자@호스트', 'User@host')}</th><th>{L('사유', 'Reason')}</th></tr></thead>
          <tbody>{u.denials.map((d, i) => (
            <tr key={`${d.at}-${d.user}-${i}`}><td className="nowrap">{at(d.at)}</td><td>{d.feature}{d.kind === 'unsupported' && <span className="chip" style={{ marginLeft: 6 }}>{L('없는 기능', 'unsupported')}</span>}</td>
              <td><code className="code">{d.user}@{d.host}</code></td><td className="muted small">{d.reason}</td></tr>))}</tbody>
        </table></div>
      )}
    </details>
  );
}

// --- collection settings -----------------------------------------------------------------------

function SeatSettingsDialog({ server, current, features, onClose, onDone }: {
  server: LicenseServer; current: SeatSettings; features: string[]; onClose: () => void; onDone: (msg: string) => void;
}) {
  const { L } = useL();
  const channels = useLoad(adminApi.alertChannels);
  const [mode, setMode] = useState<LicenseMode>(current.mode);
  const [ports, setPorts] = useState((current.lm_ports.length ? current.lm_ports : server.ports.slice(0, 1)).join(', '));
  const [path, setPath] = useState(current.lmutil_path);
  const [log, setLog] = useState(current.debug_log);
  const [limit, setLimit] = useState(String(current.seat_threshold));
  const [per, setPer] = useState(Object.entries(current.feature_thresholds).map(([k, v]) => `${k}=${v}`).join('\n'));
  const [chosen, setChosen] = useState<string[] | null>(current.alert_channels);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasVm = !!(server.cluster_id && server.vmid);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const feature_thresholds: Record<string, number> = {};
      for (const line of per.split('\n').map((x) => x.trim()).filter(Boolean)) {
        const [k, v] = line.split('=').map((x) => x.trim());
        if (!k || v === undefined || !/^\d+$/.test(v)) throw new Error(L(`기능별 기준 줄을 "기능=퍼센트"로 적어 주세요: ${line}`, `Write per-feature lines as "feature=percent": ${line}`));
        feature_thresholds[k] = Number(v);
      }
      const r = await licenseApi.saveSettings(server.id, { mode, lm_ports: ports.split(/[\s,]+/).filter(Boolean).map(Number), lmutil_path: path.trim(),
        debug_log: mode === 'agent' ? log.trim() : '', seat_threshold: Number(limit), feature_thresholds, alert_channels: chosen });
      onDone(r.settings.mode === 'engine' && !r.lmutil ? L('저장했습니다. 엔진에서 lmutil 을 찾지 못했습니다 — 경로를 확인하세요.', 'Saved. The engine did not find lmutil - check the path.')
        : L('저장했습니다. 다음 5분 주기부터 읽습니다.', 'Saved. Read from the next 5-minute round.'));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open wide title={L('라이선스 수집 설정', 'Seat collection')} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy} error={error}>
      <fieldset className="al-channels">
        <legend>{L('수집 방식', 'How')}</legend>
        <label className="check"><input type="radio" name="seat-mode" checked={mode === 'off'} onChange={() => setMode('off')} /><span>{L('끔 — 포트 감시만', 'Off - ports only')}</span></label>
        <label className="check"><input type="radio" name="seat-mode" checked={mode === 'engine'} onChange={() => setMode('engine')} />
          <span>{L('엔진에서 lmutil lmstat 실행', 'The engine runs lmutil lmstat')}<span className="muted small"> — {L('엔진이 라이선스 서버 포트에 닿아야 합니다', 'the engine must reach the licence ports')}</span></span></label>
        <label className="check"><input type="radio" name="seat-mode" checked={mode === 'agent'} disabled={!hasVm} onChange={() => setMode('agent')} />
          <span>{L('라이선스 서버 VM의 게스트 에이전트로 실행', 'The licence server VM runs it (guest agent)')}{!hasVm && <span className="muted small"> — {L('서버 편집에서 클러스터 · VMID를 먼저 넣으세요', 'set its cluster and VMID first')}</span>}</span></label>
      </fieldset>
      {mode !== 'off' && <>
        <div className="form-row form-row-even">
          <label><span>{L('lmgrd 포트 (lmstat -c 포트@주소)', 'lmgrd port(s) (lmstat -c port@host)')}</span><input id="seat-ports" value={ports} onChange={(e) => setPorts(e.target.value)} /></label>
          <label><span>{L('lmutil 경로 (비우면 기본)', 'lmutil path (blank = default)')}</span><input id="seat-path" value={path}
            placeholder={mode === 'engine' ? '/opt/moavi/lmutil/lmutil' : '/opt/Xilinx/Vivado/2024.1/bin/unwrapped/lnx64.o/lmutil'} onChange={(e) => setPath(e.target.value)} /></label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{mode === 'engine'
          ? L('lmutil 은 Flexera 프로그램이라 엔진 이미지에 넣지 않습니다. 설계 툴(Vivado bin/unwrapped/lnx64.o/lmutil, Quartus linux64/lmutil 등)에 들어 있는 lmutil 을 엔진의 /opt/moavi/lmutil/lmutil 로 복사하거나 마운트하세요.',
            'lmutil is Flexera\'s and is not in the engine image. Copy or mount the one from your tools (Vivado bin/unwrapped/lnx64.o/lmutil, Quartus linux64/lmutil, ...) to /opt/moavi/lmutil/lmutil on the engine.')
          : L('라이선스 서버 VM 에 QEMU 게스트 에이전트가 켜져 있어야 합니다. lmutil 이 PATH 에 없으면 전체 경로를 넣으세요 (lmutil · lmstat 만 실행).',
            'The licence server VM needs the QEMU guest agent. Give the full path when lmutil is not on PATH (only lmutil or lmstat runs).')}</p>
        {mode === 'agent' && <label><span>{L('lmgrd 디버그 로그 (거부 기록, 선택)', 'lmgrd debug log (refusals, optional)')}</span>
          <input id="seat-log" value={log} placeholder="/var/log/flexlm/lmgrd.log" onChange={(e) => setLog(e.target.value)} /></label>}
        <div className="form-row form-row-even">
          <label><span>{L('경고 기준 (사용률 %, 0 = 끔)', 'Alert at (% in use, 0 = off)')}</span><input id="seat-limit" type="number" min={0} max={100} value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
          <label><span>{L('기능별 기준 (한 줄에 기능=퍼센트)', 'Per feature (feature=percent per line)')}</span>
            <textarea id="seat-per" rows={3} value={per} placeholder={(features[0] ? `${features[0]}=100` : 'Vitis=100')} onChange={(e) => setPer(e.target.value)} /></label>
        </div>
        <fieldset className="al-channels">
          <legend>{L('알릴 채널', 'Alert channels')}</legend>
          <label className="check"><input type="checkbox" checked={chosen === null} onChange={(e) => setChosen(e.target.checked ? null : [])} /><span>{L('모든 채널 (+ 경보 메일 수신자)', 'Every channel (+ alert mail)')}</span></label>
          {chosen !== null && (channels.state === 'ok' ? (channels.data.length ? <div className="check-row">{channels.data.map((c) => (
            <label key={c.id} className="check-inline"><input type="checkbox" checked={chosen.includes(c.id)}
              onChange={(e) => setChosen(e.target.checked ? [...chosen, c.id] : chosen.filter((x) => x !== c.id))} />{c.name}</label>))}</div>
            : <p className="muted small">{L('알림 채널이 없습니다 (운영 > 경보).', 'No alert channels (Operations > Alerts).')}</p>) : <p className="muted small">…</p>)}
        </fieldset>
      </>}
    </Dialog>
  );
}

// --- 운영 > 사용률 보고서 > 라이선스 사용 현황 -------------------------------------------------------------

export function LicenseSeatReport({ days }: { days: number }) {
  const { L } = useL();
  const [serverId, setServerId] = useState('');
  const report = useLoad(useCallback(() => licenseApi.report(days, serverId || undefined), [days, serverId]), [days, serverId]);
  const [showAll, setShowAll] = useState(false);

  function csv(r: SeatReport, view: 'features' | 'users') {
    const cell = (v: unknown) => { const s = String(v ?? ''); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
    const rows = view === 'features'
      ? [['server', 'feature', 'vendor', 'seats', 'peak', 'peak_pct', 'average', 'average_pct', 'shortage_minutes', 'shortages', 'denied', 'advice', 'advice_seats'],
        ...r.features.map((f) => [f.server, f.feature, f.vendor, f.total, f.peak, f.peak_pct, f.avg, f.avg_pct, f.shortage_minutes, f.shortage_count, f.denied, f.advice.action, f.advice.seats])]
      : [['user', 'server', 'feature', 'hours', 'checkouts', 'hosts'], ...r.users.map((u) => [u.user, u.server, u.feature, u.hours, u.checkouts, u.hosts.join(' ')])];
    const text = '﻿' + rows.map((x) => x.map(cell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `license-${view}-${days}d.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <section className="panel rsv-report">
      <div className="panel-head">
        <div><h2 className="section-title">{L('라이선스 사용 현황', 'Licence seats')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{L('기능별 최대 동시 사용 · 평균 · 라이선스가 모두 쓰인 시간 · 거부 건수와 사용자별 사용 시간. 라이선스 추가 · 감축 판단 근거입니다.',
            'Per feature: peak, average, time with every seat taken and refusals; hours per user - the case for more or fewer seats.')}</p></div>
        <span className="spacer" />
        {report.state === 'ok' && <>
          <select aria-label={L('라이선스 서버', 'Licence server')} value={serverId} onChange={(e) => setServerId(e.target.value)}>
            <option value="">{L('모든 서버', 'Every server')}</option>
            {report.data.servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button type="button" className="btn" disabled={!report.data.features.length} onClick={() => csv(report.data, 'features')}><Icon name="download" size={16} />{L('기능별 CSV', 'Features CSV')}</button>
          <button type="button" className="btn" disabled={!report.data.users.length} onClick={() => csv(report.data, 'users')}><Icon name="download" size={16} />{L('사용자별 CSV', 'Users CSV')}</button>
        </>}
      </div>
      <LoadState value={report} retry={report.reload}>
        {(r) => r.features.length === 0 ? <div className="empty"><p>{L('라이선스 기록이 없습니다. 가속 자원 > 라이선스 서버에서 라이선스 수집을 켜세요.', 'No seat records. Turn seat reading on under Accelerators > Licence servers.')}</p></div> : (
          <>
            <SeatReportTable r={r} />
            <h3 className="section-title" style={{ marginTop: '.75rem' }}>{L('사용자별 사용 시간', 'Hours per user')}</h3>
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('사용자', 'User')}</th><th>{L('기능', 'Feature')}</th><th>{L('서버', 'Server')}</th><th className="num">{L('시간', 'Hours')}</th>
                <th className="num">{L('체크아웃', 'Checkouts')}</th><th>{L('호스트', 'Hosts')}</th></tr></thead>
              <tbody>{(showAll ? r.users : r.users.slice(0, 15)).map((u) => (
                <tr key={`${u.user}-${u.server_id}-${u.feature}`}><td className="strong">{u.user}</td><td>{u.feature}</td><td className="muted small">{u.server}</td>
                  <td className="num">{u.hours.toLocaleString()}</td><td className="num">{u.checkouts}</td><td className="muted small">{u.hosts.join(', ')}</td></tr>))}</tbody>
            </table></div>
            {r.users.length > 15 && <button type="button" className="btn-ghost small-btn" onClick={() => setShowAll(!showAll)}>{showAll ? L('접기', 'Less') : L(`모두 보기 (${r.users.length})`, `Show all (${r.users.length})`)}</button>}
          </>
        )}
      </LoadState>
    </section>
  );
}

function SeatReportTable({ r }: { r: SeatReport }) {
  const { L, dur } = useL();
  const add = useMemo(() => r.features.filter((f) => f.advice.action === 'add'), [r]);
  const cut = useMemo(() => r.features.filter((f) => f.advice.action === 'reduce'), [r]);
  return (
    <>
      <div className="stats">
        <div className="stat static"><span className="stat-label">{L('증설 검토', 'Consider adding')}</span><span className="stat-value">{add.length}</span>
          <span className="stat-sub">{L('라이선스가 다 쓰였거나 거부된 기능', 'ran out or refused')}</span></div>
        <div className="stat static"><span className="stat-label">{L('감축 검토', 'Consider dropping')}</span><span className="stat-value">{cut.length}</span>
          <span className="stat-sub">{L(`최대 사용이 2/3 이하 · 남는 라이선스 ${cut.reduce((a, f) => a + f.advice.seats, 0)}`, `peak at or under 2/3 · ${cut.reduce((a, f) => a + f.advice.seats, 0)} spare`)}</span></div>
        <div className="stat static"><span className="stat-label">{L('라이선스 부족 시간', 'Time at full')}</span><span className="stat-value">{dur(r.features.reduce((a, f) => a + f.shortage_minutes, 0))}</span></div>
        <div className="stat static"><span className="stat-label">{L('거부', 'Refused')}</span><span className="stat-value">{r.features.reduce((a, f) => a + f.denied, 0)}</span></div>
      </div>
      <div className="table-scroll"><table className="table compact-head">
        <thead><tr><th>{L('기능', 'Feature')}</th><th>{L('서버', 'Server')}</th><th className="num">{L('라이선스 수', 'Seats')}</th><th className="num">{L('최대 동시', 'Peak')}</th>
          <th className="num">{L('평균', 'Average')}</th><th className="num">{L('라이선스 부족', 'At full')}</th><th className="num">{L('거부', 'Refused')}</th><th>{L('판단', 'Suggests')}</th></tr></thead>
        <tbody>{r.features.map((f) => (
          <tr key={`${f.server_id}-${f.feature}`}>
            <td className="strong">{f.feature}<div className="muted small">{f.vendor}</div></td>
            <td className="muted small">{f.server}</td>
            <td className="num">{f.total}</td>
            <td className="num">{f.peak} <span className="muted small">({f.peak_pct}%)</span></td>
            <td className="num">{f.avg.toFixed(1)} <span className="muted small">({f.avg_pct}%)</span></td>
            <td className="num">{f.shortage_minutes ? L(`${f.shortage_count}회 · ${dur(f.shortage_minutes)}`, `${f.shortage_count}× · ${dur(f.shortage_minutes)}`) : '-'}</td>
            <td className="num">{f.denied || '-'}</td>
            <td>{f.advice.action === 'add' ? <span className="chip chip-warn">{L(`증설 +${f.advice.seats}`, `add ${f.advice.seats}`)}</span>
              : f.advice.action === 'reduce' ? <span className="chip chip-on">{L(`감축 −${f.advice.seats}`, `drop ${f.advice.seats}`)}</span>
              : <span className="muted small">{L('유지', 'keep')}</span>}</td>
          </tr>))}</tbody>
      </table></div>
      <p className="muted small">{L('판단 기준: 라이선스가 모두 쓰인 적이 있거나 거부가 있으면 증설(전체의 10%, 최소 1). 7일 이상 기록에서 최대 동시 사용이 전체의 2/3 이하이면 감축(최대 + 1 만 남김). 학기 · 마감 주기를 생각해 90일 기간으로도 확인하세요.',
        'Rule: any time at full or any refusal suggests adding (10 %, at least 1). Over a week or more with the peak at or under 2/3 of the seats suggests dropping to peak + 1. Check the 90-day view too, for term and tape-out peaks.')}</p>
    </>
  );
}
