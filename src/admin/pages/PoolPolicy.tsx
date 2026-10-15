import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { Clipboard, Pool, PoolPolicy } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';

// 데스크톱 풀 > (풀) > 정책: how the pool's desktops are reached and kept - a summary on the
// pool page and a wizard in five steps plus review. The engine applies it (pegaprox/vlab/policy.py).

const STEPS = ['conn', 'clip', 'usb', 'power', 'account', 'review'] as const;
type Step = typeof STEPS[number];
const CLIPS: Clipboard[] = ['both', 'to_desktop', 'from_desktop', 'off'];

export function PoolPolicyPanel({ pool, onChanged }: { pool: Pool; onChanged: () => void }) {
  const { t } = useI18n();
  const policy = useLoad(useCallback(() => adminApi.poolPolicy(pool.id), [pool.id]), [pool.id]);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <section className="panel policy-panel">
      <div className="panel-head">
        <span className="stat-icon"><Icon name="shield" size={18} /></span>
        <div>
          <h2 className="section-title">{t('pol.title')}</h2>
          {policy.state === 'ok' && <Summary p={policy.data.policy} />}
        </div>
        <div className="panel-actions">
          <button type="button" className="btn" disabled={policy.state !== 'ok'} onClick={() => setEditing(true)}>{t('pol.edit')}</button>
        </div>
      </div>
      {saved && <div className="alert info small" role="status">{t('pol.saved')}</div>}
      {editing && policy.state === 'ok' && (
        <PolicyWizard pool={pool} initial={policy.data.policy} resetAllowed={policy.data.reset_allowed}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setSaved(true); policy.reload(); onChanged(); }} />
      )}
    </section>
  );
}

function Summary({ p }: { p: PoolPolicy }) {
  const { t } = useI18n();
  const chips: string[] = [
    p.protocols.map((x) => (x === 'vnc' ? 'noVNC' : 'SPICE')).join(' · '),
    `${t('pol.s.clip')}: ${t(`pol.clip.${p.clipboard}` as MessageKey)}`,
    `USB: ${p.usb_redirect ? t('pol.on') : t('pol.offShort')}`,
  ];
  if (p.start_on_connect) chips.push(t('pol.startOnConnect'));
  if (p.idle_shutdown_min) chips.push(`${t('pol.idle')} ${p.idle_shutdown_min}${t('pol.min')}`);
  if (p.reset_on_logout) chips.push(t('pol.resetOnLogout'));
  if (!p.allow_power) chips.push(`${t('pol.s.power')}: ${t('pol.offShort')}`);
  if (p.max_session_hours) chips.push(`${t('pol.maxSession')} ${p.max_session_hours}${t('pol.hours')}`);
  return <div className="policy-chips">{chips.map((c) => <span key={c} className="chip">{c}</span>)}</div>;
}

function PolicyWizard({ pool, initial, resetAllowed, onClose, onSaved }: {
  pool: Pool; initial: PoolPolicy; resetAllowed: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [p, setP] = useState<PoolPolicy>(initial);
  const [step, setStep] = useState<Step>('conn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setP(initial); }, [initial]);
  const set = <K extends keyof PoolPolicy>(k: K, v: PoolPolicy[K]) => setP((o) => ({ ...o, [k]: v }));
  const i = STEPS.indexOf(step);
  const last = i === STEPS.length - 1;

  async function next() {
    setError(null);
    if (step === 'conn' && p.protocols.length === 0) { setError(t('pol.protocols')); return; }
    if (!last) { setStep(STEPS[i + 1]); return; }
    setBusy(true);
    try { await adminApi.savePoolPolicy(pool.id, p); onSaved(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const toggleProto = (x: 'vnc' | 'spice') =>
    set('protocols', p.protocols.includes(x) ? p.protocols.filter((y) => y !== x) : (['vnc', 'spice'] as const).filter((y) => y === x || p.protocols.includes(y)));

  return (
    <Dialog open wide title={`${t('pol.title')} · ${pool.name}`} onClose={onClose} onSubmit={next}
      submitLabel={last ? t('common.save') : t('pol.next')} busy={busy} error={error}
      extra={i > 0 ? <button type="button" className="btn-ghost" onClick={() => setStep(STEPS[i - 1])}>← {t('pol.back')}</button> : null}>
      <ol className="stepper" aria-label={t('pol.step').replace('{n}', String(i + 1)).replace('{total}', String(STEPS.length))}>
        {STEPS.map((s, k) => (
          <li key={s} className={k < i ? 'done' : k === i ? 'on' : ''}>
            <button type="button" onClick={() => setStep(s)} aria-current={k === i ? 'step' : undefined}>
              <span className="stepper-n">{k < i ? '✓' : k + 1}</span>{t(`pol.s.${s}` as MessageKey)}
            </button>
          </li>
        ))}
      </ol>

      {step === 'conn' && (
        <div className="wiz-body">
          <span className="field-label">{t('pol.protocols')}</span>
          <div className="mode-cards mode-cards-2">
            {(['vnc', 'spice'] as const).map((x) => (
              <label key={x} className={`mode-card${p.protocols.includes(x) ? ' on' : ''}`}>
                <input type="checkbox" checked={p.protocols.includes(x)} onChange={() => toggleProto(x)} aria-label={t(`pol.${x}` as MessageKey)} />
                <span className="strong">{t(`pol.${x}` as MessageKey)}</span>
                <span className="muted small">{t(`pol.${x}Hint` as MessageKey)}</span>
              </label>
            ))}
          </div>
          <label className="check"><input type="checkbox" checked={p.spice_fullscreen} disabled={!p.protocols.includes('spice')}
            onChange={(e) => set('spice_fullscreen', e.target.checked)} /><span>{t('pol.fullscreen')}</span></label>
        </div>
      )}

      {step === 'clip' && (
        <div className="wiz-body">
          <span className="field-label">{t('pol.clipboard')}</span>
          <div className="mode-cards mode-cards-2" role="radiogroup" aria-label={t('pol.clipboard')}>
            {CLIPS.map((c) => (
              <label key={c} className={`mode-card${p.clipboard === c ? ' on' : ''}`}>
                <input type="radio" name="clip" checked={p.clipboard === c} onChange={() => set('clipboard', c)} aria-label={t(`pol.clip.${c}` as MessageKey)} />
                <span className="strong">{t(`pol.clip.${c}` as MessageKey)}</span>
                <span className="muted small">{t(`pol.clip.${c}Hint` as MessageKey)}</span>
              </label>
            ))}
          </div>
          <small className="muted">{t('pol.clipNote')}</small>
        </div>
      )}

      {step === 'usb' && (
        <div className="wiz-body">
          <label className="check"><input type="checkbox" checked={p.usb_redirect} onChange={(e) => set('usb_redirect', e.target.checked)} />
            <span className="strong">{t('pol.usbRedirect')}</span></label>
          <small className="muted hint-indent">{t('pol.usbRedirectHint')}</small>
          <label className="check"><input type="checkbox" checked={p.usb_autoshare} disabled={!p.usb_redirect}
            onChange={(e) => set('usb_autoshare', e.target.checked)} /><span>{t('pol.usbAuto')}</span></label>
          <div className="callout"><Icon name="info" size={18} /><p>{t('pol.usbNote')}</p></div>
        </div>
      )}

      {step === 'power' && (
        <div className="wiz-body">
          <label className="check"><input type="checkbox" checked={p.start_on_connect} onChange={(e) => set('start_on_connect', e.target.checked)} />
            <span>{t('pol.startOnConnect')}</span></label>
          <label>
            <span>{t('pol.idle')}</span>
            <span className="with-unit">
              <input type="number" min={0} max={10080} value={p.idle_shutdown_min}
                onChange={(e) => set('idle_shutdown_min', Math.max(0, Math.min(10080, Number(e.target.value) || 0)))} />
              <span className="muted small">{t('pol.min')}</span>
            </span>
            <small className="muted">{t('pol.idleHint')}</small>
          </label>
          <label className="check"><input type="checkbox" checked={p.reset_on_logout} disabled={!resetAllowed}
            onChange={(e) => set('reset_on_logout', e.target.checked)} /><span>{t('pol.resetOnLogout')}</span></label>
          {!resetAllowed && <small className="muted hint-indent">{t('pol.resetOnlyFor')}</small>}
        </div>
      )}

      {step === 'account' && (
        <div className="wiz-body">
          <label className="check"><input type="checkbox" checked={p.allow_power} onChange={(e) => set('allow_power', e.target.checked)} />
            <span>{t('pol.allowPower')}</span></label>
          <label>
            <span>{t('pol.maxSession')}</span>
            <span className="with-unit">
              <input type="number" min={0} max={720} value={p.max_session_hours}
                onChange={(e) => set('max_session_hours', Math.max(0, Math.min(720, Number(e.target.value) || 0)))} />
              <span className="muted small">{t('pol.hours')}</span>
            </span>
            <small className="muted">{t('pol.maxSessionHint')}</small>
          </label>
        </div>
      )}

      {step === 'review' && (
        <div className="wiz-body">
          <dl className="review-list">
            <dt>{t('pol.s.conn')}</dt><dd>{p.protocols.map((x) => t(`pol.${x}` as MessageKey)).join(', ')}{p.spice_fullscreen ? ` · ${t('pol.fullscreen')}` : ''}</dd>
            <dt>{t('pol.s.clip')}</dt><dd>{t(`pol.clip.${p.clipboard}` as MessageKey)}</dd>
            <dt>{t('pol.s.usb')}</dt><dd>{p.usb_redirect ? `${t('pol.on')}${p.usb_autoshare ? ` · ${t('pol.usbAuto')}` : ''}` : t('pol.offShort')}</dd>
            <dt>{t('pol.s.power')}</dt><dd>{[p.start_on_connect && t('pol.startOnConnect'),
              p.idle_shutdown_min ? `${t('pol.idle')} ${p.idle_shutdown_min}${t('pol.min')}` : '',
              p.reset_on_logout && t('pol.resetOnLogout')].filter(Boolean).join(' · ') || t('pol.none')}</dd>
            <dt>{t('pol.s.account')}</dt><dd>{p.allow_power ? t('pol.allowPower') : `${t('pol.s.power')}: ${t('pol.offShort')}`}
              {p.max_session_hours ? ` · ${t('pol.maxSession')} ${p.max_session_hours}${t('pol.hours')}` : ''}</dd>
          </dl>
        </div>
      )}
    </Dialog>
  );
}
