import { useCallback, useState } from 'react';
import { adminApi } from '../../api/admin';
import { opsNoticesApi, type OpsNoticeSettings, type OpsNotices } from '../../api/opsNotices';
import type { ActiveAlert, AlertChannel, AlertMute, AlertRule, AlertRuleInput, AlertSeverity, AlertTargetType, ChannelType, ClusterAlerts, ClusterNode } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad, type Loaded } from '../../components/useLoad';
import { useFeatures } from '../../features';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { ClusterFrame, useCluster } from './ClusterPages';

// 운영 > 경보: the engine's own alerting (PegaProx) - firing alerts with acknowledgement,
// alert rules, mutes and the notification channels - through /api/vlab/admin/clusters/<id>/alerts
// and /api/vlab/admin/alert-channels. Nothing is evaluated here: the engine checks the rules.

type Notice = { kind: 'info' | 'error'; text: string };

// threshold metrics compare a number; event metrics (alert_events.EVENT_METRICS) take a
// bounded whole number whose meaning the unit text gives
const METRICS: { id: string; event?: boolean; unit?: string; min?: number; max?: number; def: number; targets: AlertTargetType[] }[] = [
  { id: 'cpu', unit: '%', def: 90, targets: ['cluster', 'node', 'vm'] },
  { id: 'memory', unit: '%', def: 85, targets: ['cluster', 'node', 'vm'] },
  { id: 'disk', unit: '%', def: 85, targets: ['cluster', 'node', 'vm'] },
  { id: 'temperature', unit: '°C', def: 80, targets: ['node'] },
  { id: 'task_failed', event: true, def: 1, min: 1, max: 1, targets: ['cluster', 'node', 'vm'] },
  { id: 'backup_coverage', event: true, def: 1, min: 0, max: 720, targets: ['cluster', 'node', 'vm'] },
  { id: 'snapshot_age', event: true, def: 14, min: 1, max: 3650, targets: ['cluster', 'node', 'vm'] },
  { id: 'replication', event: true, def: 60, min: 1, max: 10080, targets: ['cluster', 'node', 'vm'] },
  { id: 'ceph_health', event: true, def: 0, min: 0, max: 1, targets: ['cluster'] },
  { id: 'zfs_health', event: true, def: 0, min: 0, max: 1, targets: ['cluster', 'node'] },
];
const SEVERITIES: AlertSeverity[] = ['auto', 'critical', 'warning', 'info'];
const CHANNEL_TYPES: ChannelType[] = ['slack', 'discord', 'teams', 'ntfy', 'generic'];
const MUTE_FOR: { key: MessageKey; minutes: number }[] = [
  { key: 'al.d.30m', minutes: 30 }, { key: 'al.d.1h', minutes: 60 }, { key: 'al.d.4h', minutes: 240 },
  { key: 'al.d.1d', minutes: 1440 }, { key: 'al.d.1w', minutes: 10080 },
];

function useWhen() {
  const { lang } = useI18n();
  // the engine writes local time without a zone (datetime.now().isoformat())
  return (s?: string | null) => (s ? new Date(s).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '-');
}

function useMetricLabel() {
  const { t } = useI18n();
  return (m: string) => (METRICS.some((x) => x.id === m) || m === 'hardware_health' ? t(`al.m.${m}` as MessageKey) : m);
}

function sevLabel(t: (k: MessageKey) => string, s: string) {
  return s === 'auto' ? t('al.sev.auto') : t(`inf.sev.${s}` as MessageKey) || s;
}

export function AlertsPage() {
  const { current } = useCluster();
  const cid = current?.id;
  const data = useLoad(useCallback(() => (cid ? adminApi.alerts(cid) : new Promise<ClusterAlerts>(() => {})), [cid]), [cid]);
  const channels = useLoad(adminApi.alertChannels);
  const nodes = useLoad(useCallback(() => (cid ? adminApi.nodes(cid) : Promise.resolve([])), [cid]), [cid]);
  const { t } = useI18n();
  return (
    <ClusterFrame reload={() => { data.reload(); channels.reload(); }}>
      {(c) => (
        <LoadState value={data} retry={data.reload}>
          {(d) => (
            <>
              <Firing clusterId={c.id} list={d.active} rules={d.rules} reload={data.reload} />
              <Rules clusterId={c.id} rules={d.rules} channels={channels.state === 'ok' ? channels.data : []}
                nodes={nodes.state === 'ok' ? nodes.data : []} reload={data.reload} />
              <Mutes clusterId={c.id} mutes={d.mutes} rules={d.rules} reload={data.reload} />
              <Channels channels={channels} />
              <OpsNoticesPanel channels={channels.state === 'ok' ? channels.data : []} />
              <p className="muted small">{t('al.note')}</p>
            </>
          )}
        </LoadState>
      )}
    </ClusterFrame>
  );
}

function Firing({ clusterId, list, rules, reload }: { clusterId: string; list: ActiveAlert[]; rules: AlertRule[]; reload: () => void }) {
  const { t } = useI18n();
  const when = useWhen();
  const metric = useMetricLabel();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [muting, setMuting] = useState<ActiveAlert | null>(null);
  const [busy, setBusy] = useState(false);
  async function ack(a: ActiveAlert) {
    setBusy(true); setNotice(null);
    try { await adminApi.ackAlert(clusterId, a.id); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    finally { setBusy(false); reload(); }
  }
  return (
    <section className="panel bk-section" id="firing">
      <div className="panel-head">
        <h2 className="section-title">{t('al.firing')}{list.length > 0 && <span className="pnl-count al-count">{list.length}</span>}</h2>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      {list.length === 0 ? <div className="all-clear"><span className="hdot ok" aria-hidden="true" />{t('al.noFiring')}</div> : (
        <div className="table-scroll">
          <table className="table compact-head">
            <thead><tr><th>{t('al.severity')}</th><th>{t('al.firing')}</th><th>{t('al.target')}</th><th className="num">{t('al.value')}</th>
              <th>{t('al.since')}</th><th>{t('al.state')}</th><th /></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className={a.muted_until ? 'row-off' : ''}>
                  <td><span className={`sev-chip sev-${a.severity}`}>{sevLabel(t, a.severity)}</span></td>
                  <td><span className="strong">{a.message}</span>
                    <br /><span className="muted small">{rules.find((r) => r.id === a.alert_id)?.name ?? a.alert_id} · {metric(a.metric)}</span></td>
                  <td className="small">{a.target_name || '-'}<br /><span className="muted">{a.target_type}</span></td>
                  <td className="num small">{a.current_value != null ? `${a.current_value}${a.operator && a.operator !== 'event' ? ` ${a.operator} ${a.threshold}` : ''}` : '-'}</td>
                  <td className="nowrap small">{when(a.triggered_at)}</td>
                  <td className="small">
                    {a.acked_at ? <span className="chip chip-base">{t('al.acked').replace('{who}', a.acked_by || '')}</span>
                      : <span className="chip chip-warn">{t('al.open')}</span>}
                    {a.muted_until && <><br /><span className="muted">{t('al.mutedUntil').replace('{when}', when(a.muted_until))}</span></>}
                    {!a.acked_at && (a.escalation_step ?? 0) > 0 && <><br /><span className="muted">{t('al.escalation').replace('{n}', String(a.escalation_step))}</span></>}
                  </td>
                  <td className="actions nowrap">
                    {!a.acked_at && <button type="button" className="btn-ghost" disabled={busy} onClick={() => ack(a)}>{t('al.ack')}</button>}
                    {!a.muted_until && <button type="button" className="btn-ghost" disabled={busy} onClick={() => setMuting(a)}>{t('al.mute')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {muting && <MuteDialog clusterId={clusterId} alert={muting} rules={rules} onClose={() => setMuting(null)}
        onDone={() => { setMuting(null); reload(); }} />}
    </section>
  );
}

function channelLabel(t: (k: MessageKey) => string, channels: AlertChannel[], id: string) {
  if (id === 'email') return t('al.emailShort');
  return channels.find((c) => c.id === id)?.name ?? id;
}

function Rules({ clusterId, rules, channels, nodes, reload }: {
  clusterId: string; rules: AlertRule[]; channels: AlertChannel[]; nodes: ClusterNode[]; reload: () => void;
}) {
  const { t } = useI18n();
  const metric = useMetricLabel();
  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setNotice(null);
    try { await fn(); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    reload();
  }
  const condition = (r: AlertRule) => {
    const m = METRICS.find((x) => x.id === r.metric);
    if (r.operator === 'event' || m?.event) {
      return m?.id === 'task_failed' ? t('al.event') : `${r.threshold} ${t(`al.u.${r.metric}` as MessageKey) || ''}`.trim();
    }
    return `${r.operator} ${r.threshold}${m?.unit ?? ''}`;
  };
  return (
    <section className="panel bk-section">
      <div className="panel-head">
        <h2 className="section-title">{t('al.rules')}</h2>
        <div className="panel-actions">
          <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('al.newRule')}</button>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      {rules.length === 0 ? <p className="muted small">{t('al.noRules')}</p> : (
        <div className="table-scroll">
          <table className="table compact-head">
            <thead><tr><th>{t('al.enabled')}</th><th>{t('al.name')}</th><th>{t('al.metric')}</th><th>{t('al.condition')}</th>
              <th>{t('al.target')}</th><th>{t('al.severity')}</th><th>{t('al.channels')}</th><th /></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className={r.enabled ? '' : 'row-off'}>
                  <td><input type="checkbox" aria-label={t('al.enabled')} checked={!!r.enabled}
                    onChange={(e) => run(() => adminApi.updateAlertRule(clusterId, r.id, { enabled: e.target.checked }))} /></td>
                  <td className="strong">{r.name}</td>
                  <td className="small">{metric(r.metric)}</td>
                  <td className="nowrap small">{condition(r)}</td>
                  <td className="small">{r.target_type === 'cluster' ? t('al.cluster') : `${t(`al.${r.target_type}` as MessageKey)} ${r.target_id ?? ''}`}</td>
                  <td>{r.severity === 'auto' ? <span className="sev-chip">{t('al.sev.auto')}</span>
                    : <span className={`sev-chip sev-${r.severity}`}>{sevLabel(t, r.severity)}</span>}</td>
                  <td className="small">{r.channels?.length ? r.channels.map((c) => channelLabel(t, channels, c)).join(', ')
                    : <span className="muted">{t('al.noChannelsPicked')}</span>}</td>
                  <td className="actions nowrap">
                    <button type="button" className="btn-ghost" onClick={() => setEditing(r)}>{t('al.edit')}</button>
                    <button type="button" className="btn-ghost danger" onClick={() => {
                      if (confirm(t('al.deleteRule').replace('{name}', r.name))) run(() => adminApi.deleteAlertRule(clusterId, r.id));
                    }}>{t('al.delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <RuleDialog clusterId={clusterId} rule={editing === 'new' ? null : editing} channels={channels} nodes={nodes}
        onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
    </section>
  );
}

function RuleDialog({ clusterId, rule, channels, nodes, onClose, onDone }: {
  clusterId: string; rule: AlertRule | null; channels: AlertChannel[]; nodes: ClusterNode[]; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const metricLabel = useMetricLabel();
  const [name, setName] = useState(rule?.name ?? '');
  const [metric, setMetric] = useState(rule?.metric ?? 'cpu');
  const [operator, setOperator] = useState(rule && rule.operator !== 'event' ? rule.operator : '>');
  const [threshold, setThreshold] = useState(rule?.threshold ?? 90);
  const [targetType, setTargetType] = useState<AlertTargetType>(rule?.target_type ?? 'cluster');
  const [targetId, setTargetId] = useState(rule?.target_id != null ? String(rule.target_id) : '');
  const [severity, setSeverity] = useState<AlertSeverity>(rule?.severity ?? 'auto');
  const [picked, setPicked] = useState<string[]>(rule?.channels ?? ['email']);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [notifyResolved, setNotifyResolved] = useState(rule?.notify_resolved ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = METRICS.find((x) => x.id === metric) ?? METRICS[0];
  const known = METRICS.some((x) => x.id === metric);

  function pickMetric(id: string) {
    const next = METRICS.find((x) => x.id === id)!;
    setMetric(id);
    setThreshold(next.def);
    if (!next.targets.includes(targetType)) setTargetType(next.targets[0]);
  }
  function pickTarget(tt: AlertTargetType) {
    setTargetType(tt);
    setTargetId(tt === 'node' ? nodes[0]?.node ?? '' : '');
  }
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function submit() {
    setBusy(true); setError(null);
    const body: AlertRuleInput = {
      name: name.trim() || metricLabel(metric), metric, operator: m.event ? 'event' : operator, threshold: Number(threshold),
      target_type: targetType, target_id: targetType === 'cluster' ? null : targetId.trim(),
      channels: picked, severity, enabled, ...(m.event ? { notify_resolved: notifyResolved } : {}),
    };
    try {
      if (rule) await adminApi.updateAlertRule(clusterId, rule.id, body);
      else await adminApi.createAlertRule(clusterId, body);
      onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open title={t(rule ? 'al.editRule' : 'al.newRule')} onClose={onClose} onSubmit={submit} submitLabel={t('common.save')}
      busy={busy || (targetType !== 'cluster' && !targetId.trim())} error={error} wide>
      <label><span>{t('al.name')}</span>
        <input value={name} placeholder={metricLabel(metric)} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-row form-row-three">
        <label><span>{t('al.metric')}</span>
          <select value={metric} onChange={(e) => pickMetric(e.target.value)}>
            {!known && <option value={metric}>{metric}</option>}
            {METRICS.map((x) => <option key={x.id} value={x.id}>{metricLabel(x.id)}</option>)}
          </select></label>
        {!m.event && (
          <label><span>{t('al.operator')}</span>
            <select value={operator} onChange={(e) => setOperator(e.target.value)}>
              {['>', '>=', '<', '<='].map((o) => <option key={o} value={o}>{o}</option>)}
            </select></label>
        )}
        {m.id !== 'task_failed' && (
          <label><span>{t('al.threshold')}{m.unit ? ` (${m.unit})` : ''}</span>
            <input type="number" min={m.min ?? 0} max={m.max ?? (m.unit === '%' ? 100 : undefined)} value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))} />
            {m.event && <small className="muted">{t(`al.u.${m.id}` as MessageKey)}</small>}</label>
        )}
      </div>
      <div className="form-row form-row-three">
        <label><span>{t('al.target')}</span>
          <select value={targetType} onChange={(e) => pickTarget(e.target.value as AlertTargetType)}>
            {m.targets.map((tt) => <option key={tt} value={tt}>{tt === 'cluster' ? t('al.cluster') : t(`al.${tt}` as MessageKey)}</option>)}
          </select></label>
        {targetType === 'node' && (
          <label><span>{t('al.node')}</span>
            {nodes.length ? (
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                {!nodes.some((n) => n.node === targetId) && <option value={targetId}>{targetId || '-'}</option>}
                {nodes.map((n) => <option key={n.node} value={n.node}>{n.node}</option>)}
              </select>
            ) : <input value={targetId} onChange={(e) => setTargetId(e.target.value)} />}</label>
        )}
        {targetType === 'vm' && (
          <label><span>{t('al.vmid')}</span>
            <input inputMode="numeric" value={targetId} placeholder="300" onChange={(e) => setTargetId(e.target.value.replace(/\D/g, ''))} /></label>
        )}
        <label><span>{t('al.severity')}</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{sevLabel(t, s)}</option>)}
          </select></label>
      </div>
      <fieldset className="al-channels check-row">
        <legend>{t('al.channels')}</legend>
        <label className="check"><input type="checkbox" checked={picked.includes('email')} onChange={() => toggle('email')} />{t('al.email')}</label>
        {channels.map((c) => (
          <label key={c.id} className="check"><input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.name} <span className="chip">{c.type}</span></label>
        ))}
      </fieldset>
      <div className="check-row">
        <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{t('al.enabled')}</label>
        {m.event && <label className="check"><input type="checkbox" checked={notifyResolved} onChange={(e) => setNotifyResolved(e.target.checked)} />{t('al.notifyResolved')}</label>}
      </div>
    </Dialog>
  );
}

function muteWhat(t: (k: MessageKey) => string, m: AlertMute, rules: AlertRule[]) {
  const rule = m.rule_id ? rules.find((r) => r.id === m.rule_id)?.name ?? m.rule_id : '';
  const obj = m.object_label || m.object_key;
  return [rule && `${t('al.rule')}: ${rule}`, obj].filter(Boolean).join(' · ');
}

function Mutes({ clusterId, mutes, rules, reload }: { clusterId: string; mutes: AlertMute[]; rules: AlertRule[]; reload: () => void }) {
  const { t } = useI18n();
  const when = useWhen();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  async function lift(id: string) {
    setNotice(null);
    try { await adminApi.unmuteAlert(clusterId, id); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    reload();
  }
  return (
    <section className="panel bk-section">
      <div className="panel-head">
        <h2 className="section-title">{t('al.mutes')}</h2>
        <div className="panel-actions">
          <button type="button" className="btn" disabled={!rules.length} onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t('al.newMute')}</button>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      {mutes.length === 0 ? <p className="muted small">{t('al.noMutes')}</p> : (
        <div className="table-scroll">
          <table className="table compact-head">
            <thead><tr><th>{t('al.what')}</th><th>{t('al.until')}</th><th>{t('al.reason')}</th><th>{t('al.by')}</th><th /></tr></thead>
            <tbody>
              {mutes.map((m) => (
                <tr key={m.id}>
                  <td className="small">{muteWhat(t, m, rules)}</td>
                  <td className="nowrap small">{when(m.until)}</td>
                  <td className="small">{m.reason || '-'}</td>
                  <td className="small">{m.created_by}</td>
                  <td className="actions"><button type="button" className="btn-ghost" onClick={() => lift(m.id)}>{t('al.unmute')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <MuteDialog clusterId={clusterId} rules={rules} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </section>
  );
}

// Mute a rule, or - from a firing alert - that rule on its object, or every rule on the object.
function MuteDialog({ clusterId, alert, rules, onClose, onDone }: {
  clusterId: string; alert?: ActiveAlert; rules: AlertRule[]; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [ruleId, setRuleId] = useState(rules[0]?.id ?? '');
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState('');
  const [whole, setWhole] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canWhole = !!alert && alert.target_type !== 'cluster';
  async function submit() {
    setBusy(true); setError(null);
    try {
      await adminApi.muteAlert(clusterId, alert
        ? { active_alert_id: alert.id, whole_object: whole, minutes, reason: reason.trim() || undefined }
        : { rule_id: ruleId, minutes, reason: reason.trim() || undefined });
      onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open title={t('al.mute')} onClose={onClose} onSubmit={submit} submitLabel={t('al.mute')} busy={busy || (!alert && !ruleId)} error={error}>
      {alert ? <p className="small"><span className={`sev-chip sev-${alert.severity}`}>{sevLabel(t, alert.severity)}</span> {alert.message}
        <br /><span className="muted">{alert.target_name}</span></p> : (
        <label><span>{t('al.rule')}</span>
          <select value={ruleId} onChange={(e) => setRuleId(e.target.value)}>{rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      )}
      {canWhole && <label className="check"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />{t('al.wholeObject')}</label>}
      <div className="form-row form-row-even">
        <label><span>{t('al.duration')}</span>
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {MUTE_FOR.map((d) => <option key={d.minutes} value={d.minutes}>{t(d.key)}</option>)}
          </select></label>
        <label><span>{t('al.reason')}</span><input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
    </Dialog>
  );
}

function Channels({ channels }: { channels: Loaded<AlertChannel[]> & { reload: () => void } }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<AlertChannel | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  async function test(c: AlertChannel) {
    setBusy(true); setNotice(null);
    try {
      const r = await adminApi.testAlertChannel(c.id);
      setNotice(r.ok ? { kind: 'info', text: t('al.testOk').replace('{name}', c.name) } : { kind: 'error', text: r.detail });
    } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    finally { setBusy(false); }
  }
  async function remove(c: AlertChannel) {
    if (!confirm(t('al.deleteChannel').replace('{name}', c.name))) return;
    setNotice(null);
    try { await adminApi.deleteAlertChannel(c.id); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    channels.reload();
  }
  async function toggle(c: AlertChannel, on: boolean) {
    try { await adminApi.updateAlertChannel(c.id, { enabled: on }); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
    channels.reload();
  }
  const denied = channels.state === 'error' && channels.status === 403;
  return (
    <section className="panel bk-section">
      <div className="panel-head">
        <h2 className="section-title">{t('al.channelsTitle')}</h2>
        <div className="panel-actions">
          <button type="button" className="btn" disabled={channels.state !== 'ok'} onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} />{t('al.newChannel')}</button>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      {denied ? <p className="muted small">{t('al.channelsAdmin')}</p> : (
        <LoadState value={channels} retry={channels.reload}>
          {(list) => list.length === 0 ? <p className="muted small">{t('al.noChannels')}</p> : (
            <div className="table-scroll">
              <table className="table compact-head">
                <thead><tr><th>{t('al.enabled')}</th><th>{t('al.name')}</th><th>{t('al.type')}</th><th>{t('al.url')}</th><th /></tr></thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id} className={c.enabled ? '' : 'row-off'}>
                      <td><input type="checkbox" aria-label={t('al.enabled')} checked={!!c.enabled} onChange={(e) => toggle(c, e.target.checked)} /></td>
                      <td className="strong">{c.name}</td>
                      <td><span className="chip">{c.type}</span></td>
                      <td><code className="code">{c.url}</code></td>
                      <td className="actions nowrap">
                        <button type="button" className="btn-ghost" disabled={busy} onClick={() => test(c)}>{t('al.test')}</button>
                        <button type="button" className="btn-ghost" onClick={() => setEditing(c)}>{t('al.edit')}</button>
                        <button type="button" className="btn-ghost danger" onClick={() => remove(c)}>{t('al.delete')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </LoadState>
      )}
      {editing && <ChannelDialog channel={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); channels.reload(); }} />}
    </section>
  );
}

function ChannelDialog({ channel, onClose, onDone }: { channel: AlertChannel | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(channel?.name ?? '');
  const [type, setType] = useState<ChannelType>(channel?.type ?? 'slack');
  // the engine hands secrets back masked; an untouched field is sent as it came and kept
  const [url, setUrl] = useState(channel?.url ?? '');
  const [token, setToken] = useState('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    const body = { name: name.trim() || type, type, url: url.trim(), ...(token ? { token } : {}), ...(type === 'ntfy' && topic ? { topic: topic.trim() } : {}) };
    try {
      if (channel) await adminApi.updateAlertChannel(channel.id, body);
      else await adminApi.createAlertChannel({ ...body, enabled: true });
      onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const placeholder = type === 'slack' ? 'https://hooks.slack.com/services/…' : type === 'discord' ? 'https://discord.com/api/webhooks/…'
    : type === 'teams' ? 'https://….webhook.office.com/…' : type === 'ntfy' ? 'https://ntfy.sh' : 'https://';
  return (
    <Dialog open title={t(channel ? 'al.editChannel' : 'al.newChannel')} onClose={onClose} onSubmit={submit} submitLabel={t('common.save')}
      busy={busy || !url.trim()} error={error}>
      <div className="form-row form-row-even">
        <label><span>{t('al.name')}</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        <label><span>{t('al.type')}</span>
          <select value={type} onChange={(e) => setType(e.target.value as ChannelType)}>
            {CHANNEL_TYPES.map((c) => <option key={c} value={c}>{c === 'generic' ? 'Webhook' : c[0].toUpperCase() + c.slice(1)}</option>)}
          </select></label>
      </div>
      <label><span>{t('al.url')}</span><input value={url} placeholder={placeholder} onChange={(e) => setUrl(e.target.value)} /></label>
      {type === 'ntfy' && (
        <label><span>{t('al.topic')}</span><input value={topic} placeholder={channel?.topic ? '********' : 'moavi-alerts'} onChange={(e) => setTopic(e.target.value)} />
          {channel?.topic && <small className="muted">{t('al.secretKept')}</small>}</label>
      )}
      <label><span>{t('al.token')}</span><input type="password" autoComplete="new-password" value={token}
        placeholder={channel?.token ? '********' : ''} onChange={(e) => setToken(e.target.value)} />
        {channel && <small className="muted">{t('al.secretKept')}</small>}</label>
    </Dialog>
  );
}

// MOAVI Desk 운영 알림: what the engine tells the administrators by itself (lab PCs waiting, the
// server pair, licence refusals, failed long tasks), on the channels above and the alert mail.
function OpsNoticesPanel({ channels }: { channels: AlertChannel[] }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const features = useFeatures();
  const data = useLoad(opsNoticesApi.get);
  return (
    <section className="panel bk-section" id="ops-notices">
      <div className="panel-head"><h2 className="section-title">{L('MOAVI Desk 운영 알림', 'MOAVI Desk operations notices')}</h2></div>
      <p className="muted small">{L('엔진이 알림 채널과 경보 메일로 보내는 운영 알림입니다.',
        'Notices the engine sends on the alert channels and alert mail.')}</p>
      {data.state === 'error' && data.status === 403
        ? <p className="muted small">{L('플랫폼 설정 권한이 있는 관리자만 바꿀 수 있습니다.', 'Only administrators with the platform settings right can change these.')}</p>
        : <LoadState value={data} retry={data.reload}>{(d) => <OpsNoticesForm initial={d} channels={channels} lab={features.on('lab')} fpga={features.on('fpga')} onSaved={data.reload} />}</LoadState>}
    </section>
  );
}

function OpsNoticesForm({ initial, channels, lab, fpga, onSaved }: { initial: OpsNotices; channels: AlertChannel[]; lab: boolean; fpga: boolean; onSaved: () => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [f, setF] = useState<OpsNoticeSettings>(initial.settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial.settings);
  const set = (p: Partial<OpsNoticeSettings>) => setF({ ...f, ...p });
  const flip = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  async function save() {
    setBusy(true); setMsg(null);
    try { await opsNoticesApi.save(f); setMsg({ ok: true, text: L('저장했습니다.', 'Saved.') }); onSaved(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  return (
    <div className="ops-notices">
      {lab && (
        <div className="ops-row">
          <label className="check"><input id="on-terminal" type="checkbox" checked={f.terminal_pending} onChange={(e) => set({ terminal_pending: e.target.checked })} />
            <span><span className="strong">{L('실습실 PC 승인 대기', 'Lab PCs waiting for approval')}</span>
              <span className="muted small"> — {L('새 PC가 승인을 기다리거나 경고 기준 대수에 닿을 때', 'new PCs wait for approval or reach the warning count')}</span></span></label>
          <label className="inline"><span>{L('다시 알리는 간격 (분)', 'Remind every (min)')}</span>
            <input type="number" min={5} max={1440} value={f.terminal_every_min} disabled={!f.terminal_pending} onChange={(e) => set({ terminal_every_min: Number(e.target.value) })} /></label>
        </div>
      )}
      <div className="ops-row">
        <label className="check"><input id="on-pair" type="checkbox" checked={f.pair} onChange={(e) => set({ pair: e.target.checked })} />
          <span><span className="strong">{L('서버 이중화', 'Server pair')}</span>
            <span className="muted small"> — {L('대기 서버 장애 · 복구, 이 서버의 활성 전환', 'a standby fails or is back; this server became active')}</span></span></label>
        <label className="inline"><span>{L('응답 없음 기준 (분)', 'Down after (min)')}</span>
          <input type="number" min={2} max={1440} value={f.pair_down_min} disabled={!f.pair} onChange={(e) => set({ pair_down_min: Number(e.target.value) })} /></label>
      </div>
      {fpga && (
        <div className="ops-row">
          <label className="check"><input id="on-license" type="checkbox" checked={f.license_denied} onChange={(e) => set({ license_denied: e.target.checked })} />
            <span><span className="strong">{L('라이선스 거부', 'Licence refusals')}</span>
              <span className="muted small"> — {L('라이선스 서버가 요청을 거부했을 때 (디버그 로그를 읽는 서버)', 'a licence server refused checkouts (servers with a debug log)')}</span></span></label>
        </div>
      )}
      <div className="ops-row">
        <label className="check"><input id="on-tasks" type="checkbox" checked={f.task_failed} onChange={(e) => set({ task_failed: e.target.checked })} />
          <span><span className="strong">{L('긴 작업 실패', 'Long tasks that failed')}</span>
            <span className="muted small"> — {L('고른 종류의 Proxmox 작업이 실패했을 때 (클러스터 경보 규칙이 우선)', 'a Proxmox task of a chosen kind failed (a cluster task-failed rule wins)')}</span></span></label>
        <div className="chip-picks" role="group" aria-label={L('작업 종류', 'Task kinds')}>
          {Object.entries(initial.task_types).map(([k, label]) => (
            <label key={k} className={`chip-pick${f.task_types.includes(k) ? ' on' : ''}`}>
              <input type="checkbox" disabled={!f.task_failed} checked={f.task_types.includes(k)} onChange={() => set({ task_types: flip(f.task_types, k) })} />{label}</label>
          ))}
        </div>
      </div>
      <div className="ops-row">
        <span className="strong">{L('보낼 채널', 'Channels')}</span>
        <div className="chip-picks" role="group" aria-label={L('보낼 채널', 'Channels')}>
          {channels.length === 0 ? <span className="muted small">{L('채널이 없으면 경보 메일로만 갑니다.', 'Without channels it goes by alert mail only.')}</span> : channels.map((c) => (
            <label key={c.id} className={`chip-pick${f.channels.includes(c.id) ? ' on' : ''}`}>
              <input type="checkbox" checked={f.channels.includes(c.id)} onChange={() => set({ channels: flip(f.channels, c.id) })} />{c.name}</label>
          ))}
        </div>
        <span className="muted small">{L('아무것도 고르지 않으면 켜진 채널 모두에 보냅니다.', 'None picked: every enabled channel.')}</span>
      </div>
      {msg && <div className={`alert small ${msg.ok ? 'info' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <div><button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>{pick({ ko: '저장', en: 'Save' })}</button></div>
    </div>
  );
}
