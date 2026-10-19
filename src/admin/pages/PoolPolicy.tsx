import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { Clipboard, Pool, PoolPolicy } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { storageApi } from '../../api/storage';
import type { PoolStorage } from '../../api/storage';
import { draftOf, StorageStep, storageBody, storageStepError, storageSummary } from './PoolStorage';
import type { StorageDraft } from './PoolStorage';
import { useL } from './OpsPages';
import { useFeatures } from '../../features';

// 데스크톱 풀 > (풀) > 정책: how the pool's desktops are reached and kept - a summary on the
// pool page and a wizard in six steps plus review. The engine applies it (pegaprox/vlab/policy.py; the
// shared storage step has a setting of its own, pegaprox/vlab/nas.py, saved with the policy).

const STEPS = ['conn', 'clip', 'usb', 'power', 'account', 'storage', 'review'] as const;
type Step = typeof STEPS[number];
const CLIPS: Clipboard[] = ['both', 'to_desktop', 'from_desktop', 'off'];

export function PoolPolicyPanel({ pool, onChanged }: { pool: Pool; onChanged: () => void }) {
  const { t } = useI18n();
  const policy = useLoad(useCallback(() => adminApi.poolPolicy(pool.id), [pool.id]), [pool.id]);
  const storage = useLoad(useCallback(() => storageApi.pool(pool.id).then((r) => r.storage), [pool.id]), [pool.id]);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <section className="panel policy-panel">
      <div className="panel-head">
        <span className="stat-icon"><Icon name="shield" size={18} /></span>
        <div>
          <h2 className="section-title">{t('pol.title')}</h2>
          {policy.state === 'ok' && <Summary p={policy.data.policy} storage={storage.state === 'ok' ? storage.data : null} />}
        </div>
        <div className="panel-actions">
          <button type="button" className="btn" disabled={policy.state !== 'ok' || storage.state !== 'ok'} onClick={() => setEditing(true)}>{t('pol.edit')}</button>
        </div>
      </div>
      {saved && <div className="alert info small" role="status">{t('pol.saved')}</div>}
      {editing && policy.state === 'ok' && storage.state === 'ok' && (
        <PolicyWizard pool={pool} initial={policy.data.policy} resetAllowed={policy.data.reset_allowed} storage={storage.data}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setSaved(true); policy.reload(); storage.reload(); onChanged(); }} />
      )}
    </section>
  );
}

function Summary({ p, storage }: { p: PoolPolicy; storage: PoolStorage | null }) {
  const { t } = useI18n();
  const { L } = useL();
  const chips: string[] = [
    p.protocols.map((x) => (x === 'vnc' ? 'noVNC' : 'SPICE')).join(' · '),
    `${t('pol.s.clip')}: ${t(`pol.clip.${p.clipboard}` as MessageKey)}`,
    `USB: ${p.usb_redirect ? t('pol.on') : t('pol.offShort')}`,
  ];
  if (p.client_drives) chips.push(L('내 PC 드라이브 연결', 'PC drives'));
  if (p.start_on_connect) chips.push(t('pol.startOnConnect'));
  if (p.idle_shutdown_min) chips.push(`${t('pol.idle')} ${p.idle_shutdown_min}${t('pol.min')}`);
  if (p.reset_on_logout) chips.push(t('pol.resetOnLogout'));
  if (!p.allow_power) chips.push(`${t('pol.s.power')}: ${t('pol.offShort')}`);
  if (p.max_session_hours) chips.push(`${t('pol.maxSession')} ${p.max_session_hours}${t('pol.hours')}`);
  if (p.defer_when_busy) chips.push(L(`작업 중이면 미루기 (최대 ${p.defer_max_hours}시간)`, `Wait while working (up to ${p.defer_max_hours} h)`));
  if (p.web_ide?.length) chips.push(`${L('웹 IDE', 'Web IDE')}: ${p.web_ide.map((k) => (k === 'jupyter' ? 'JupyterLab' : 'VS Code')).join(' · ')}`);
  if (storage?.enabled) chips.push(`${L('공유 저장소', 'Shared storage')}: ${storage.kind.toUpperCase()} ${storage.server}`);
  return <div className="policy-chips">{chips.map((c) => <span key={c} className="chip">{c}</span>)}</div>;
}

function PolicyWizard({ pool, initial, resetAllowed, storage, onClose, onSaved }: {
  pool: Pool; initial: PoolPolicy; resetAllowed: boolean; storage: PoolStorage; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const { L } = useL();
  const { on } = useFeatures();
  const [p, setP] = useState<PoolPolicy>(initial);
  const [st, setSt] = useState<StorageDraft>(draftOf(storage));
  const setStorage = <K extends keyof StorageDraft>(k: K, v: StorageDraft[K]) => setSt((o) => ({ ...o, [k]: v }));
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
    const why = step === 'storage' ? storageStepError(st, storage.has_password, L) : null;
    if (why) { setError(why); return; }
    if (!last) { setStep(STEPS[i + 1]); return; }
    setBusy(true);
    // the storage first: its checks are the stricter ones, so a refusal leaves both as they were
    try { await storageApi.save(pool.id, storageBody(st)); await adminApi.savePoolPolicy(pool.id, p); onSaved(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const toggleProto = (x: 'vnc' | 'spice' | 'rdp' | 'guac') =>
    set('protocols', p.protocols.includes(x) ? p.protocols.filter((y) => y !== x) : (['vnc', 'spice', 'rdp', 'guac'] as const).filter((y) => y === x || p.protocols.includes(y)));

  return (
    <Dialog open wide title={`${t('pol.title')} · ${pool.name}`} onClose={onClose} onSubmit={next}
      submitLabel={last ? t('common.save') : t('pol.next')} busy={busy} error={error}
      extra={i > 0 ? <button type="button" className="btn-ghost" onClick={() => setStep(STEPS[i - 1])}>← {t('pol.back')}</button> : null}>
      <ol className="stepper" aria-label={t('pol.step').replace('{n}', String(i + 1)).replace('{total}', String(STEPS.length))}>
        {STEPS.map((s, k) => (
          <li key={s} className={k < i ? 'done' : k === i ? 'on' : ''}>
            <button type="button" onClick={() => setStep(s)} aria-current={k === i ? 'step' : undefined}>
              <span className="stepper-n">{k < i ? '✓' : k + 1}</span>{s === 'storage' ? L('공유 저장소', 'Shared storage') : t(`pol.s.${s}` as MessageKey)}
            </button>
          </li>
        ))}
      </ol>

      {step === 'conn' && (
        <div className="wiz-body">
          <span className="field-label">{t('pol.protocols')}</span>
          <div className="mode-cards mode-cards-2">
            {(['rdp', 'spice', 'vnc', 'guac'] as const).map((x) => (
              <label key={x} className={`mode-card${p.protocols.includes(x) ? ' on' : ''}`}>
                <input type="checkbox" checked={p.protocols.includes(x)} onChange={() => toggleProto(x)} aria-label={t(`pol.${x}` as MessageKey)} />
                <span className="strong">{t(`pol.${x}` as MessageKey)}</span>
                <span className="muted small">{t(`pol.${x}Hint` as MessageKey)}</span>
              </label>
            ))}
          </div>
          <label className="check"><input type="checkbox" checked={p.rdp_tune ?? true} disabled={!p.protocols.includes('rdp') && !p.protocols.includes('guac')}
            onChange={(e) => set('rdp_tune', e.target.checked)} />
            <span>{L('Windows 데스크톱 RDP 자동 준비 (첫 접속 때 원격 데스크톱 · 방화벽 · H.264 설정)',
              'Prepare Windows desktops for RDP (Remote Desktop, firewall, H.264 at the first connect)')}</span></label>
          <HowTo><ul>
            <li>{L('Linux 데스크톱은 xrdp(또는 gnome-remote-desktop)가 있을 때만 RDP로 열고, 없으면 SPICE · VNC로 엽니다.', 'A Linux desktop opens with RDP only when it runs xrdp (or gnome-remote-desktop); otherwise SPICE or VNC.')}</li>
            <li>{L('AD가 있으면 도메인 사용자를 GPO로 원격 데스크톱 사용자 그룹에 넣으세요.', 'With AD put the domain users in Remote Desktop Users by GPO.')}</li>
          </ul></HowTo>
          <label className="check"><input type="checkbox" checked={p.spice_fullscreen} disabled={!p.protocols.includes('spice')}
            onChange={(e) => set('spice_fullscreen', e.target.checked)} /><span>{t('pol.fullscreen')}</span></label>
          <span className="field-label">{L('웹 IDE (브라우저)', 'Web IDE (browser)')}</span>
          <div className="mode-cards mode-cards-2">
            {(['jupyter', 'vscode'] as const).map((k) => {
              const on = (p.web_ide ?? []).includes(k);
              return (
                <label key={k} className={`mode-card${on ? ' on' : ''}`}>
                  <input type="checkbox" checked={on} aria-label={k === 'jupyter' ? 'JupyterLab' : 'VS Code'}
                    onChange={() => set('web_ide', (['jupyter', 'vscode'] as const).filter((x) => (x === k ? !on : (p.web_ide ?? []).includes(x))))} />
                  <span className="strong">{k === 'jupyter' ? 'JupyterLab' : 'VS Code (code-server)'}</span>
                  <span className="muted small">{k === 'jupyter' ? L('노트북 · 터미널. 사용자 계정으로, 홈 또는 스크래치 폴더에서', 'Notebooks and a terminal, as the user, in home or scratch')
                    : L('브라우저 VS Code. Jupyter 인증 뒤에서 열림 (jupyter-vscode-proxy)', 'VS Code in the browser, behind the Jupyter sign-in (jupyter-vscode-proxy)')}</span>
                </label>
              );
            })}
          </div>
          {(p.web_ide ?? []).length > 0 && (
            <label>
              <span>{L('쓰지 않으면 끄기', 'End when unused for')}</span>
              <span className="with-unit">
                <input type="number" min={10} max={10080} value={p.web_ide_idle_min ?? 240}
                  onChange={(e) => set('web_ide_idle_min', Math.max(10, Math.min(10080, Number(e.target.value) || 240)))} />
                <span className="muted small">{t('pol.min')}</span>
              </span>
              <small className="muted">{L('템플릿에 JupyterLab(과 code-server)이 있어야 합니다.',
                'The template needs JupyterLab (and code-server).')}</small>
            </label>
          )}
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
          {on('fpga') && <div className="callout"><Icon name="info" size={18} /><p>{t('pol.usbNote')}</p></div>}
          <span className="field-label">{L('RDP 접속 (Windows 앱 · 브라우저 RDP)', 'RDP connections (Windows app, browser RDP)')}</span>
          <label className="check"><input type="checkbox" checked={!!p.client_drives} onChange={(e) => set('client_drives', e.target.checked)} />
            <span className="strong">{L('내 PC 드라이브 연결 허용', 'Allow the PC\'s drives')}</span></label>
          <small className="muted hint-indent">{L('켜면 PC의 드라이브 · USB 메모리로 파일을 옮길 수 있습니다.',
            'On, files can move through PC drives and USB sticks.')}</small>
          <label className="check"><input type="checkbox" checked={p.client_printers ?? true} onChange={(e) => set('client_printers', e.target.checked)} />
            <span className="strong">{L('내 PC 프린터로 인쇄', 'Print to the PC\'s printers')}</span></label>
          <small className="muted hint-indent">{L('브라우저 RDP는 PDF로 내려받아 인쇄합니다.', 'Browser RDP prints to a PDF the browser downloads.')}</small>
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
          <BusyFields p={p} set={set} />
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

      {step === 'storage' && <StorageStep s={st} set={setStorage} hasPassword={storage.has_password} />}

      {step === 'review' && (
        <div className="wiz-body">
          <dl className="review-list">
            <dt>{t('pol.s.conn')}</dt><dd>{p.protocols.map((x) => t(`pol.${x}` as MessageKey)).join(', ')}{p.spice_fullscreen ? ` · ${t('pol.fullscreen')}` : ''}</dd>
            <dt>{L('웹 IDE', 'Web IDE')}</dt><dd>{(p.web_ide ?? []).length ? `${p.web_ide.map((k) => (k === 'jupyter' ? 'JupyterLab' : 'VS Code')).join(', ')} · ${L(`유휴 ${p.web_ide_idle_min}분 뒤 끔`, `ends after ${p.web_ide_idle_min} min unused`)}` : t('pol.offShort')}</dd>
            <dt>{t('pol.s.clip')}</dt><dd>{t(`pol.clip.${p.clipboard}` as MessageKey)}</dd>
            <dt>{t('pol.s.usb')}</dt><dd>{p.usb_redirect ? `${t('pol.on')}${p.usb_autoshare ? ` · ${t('pol.usbAuto')}` : ''}` : t('pol.offShort')}</dd>
            <dt>{L('RDP 드라이브 · 프린터', 'RDP drives, printers')}</dt><dd>{`${L('내 PC 드라이브', 'PC drives')} ${p.client_drives ? t('pol.on') : t('pol.offShort')} · ${L('프린터', 'printers')} ${(p.client_printers ?? true) ? t('pol.on') : t('pol.offShort')}`}</dd>
            <dt>{t('pol.s.power')}</dt><dd>{[p.start_on_connect && t('pol.startOnConnect'),
              p.idle_shutdown_min ? `${t('pol.idle')} ${p.idle_shutdown_min}${t('pol.min')}` : '',
              p.reset_on_logout && t('pol.resetOnLogout')].filter(Boolean).join(' · ') || t('pol.none')}</dd>
            <dt>{L('장시간 작업 보호', 'Long jobs')}</dt><dd>{p.defer_when_busy
              ? L(`작업 중이면 미루기 · GPU/NPU ${p.busy_gpu_pct}% 이상${p.busy_cpu_pct ? ` 또는 CPU ${p.busy_cpu_pct}% 이상` : ''} · 최대 ${p.defer_max_hours}시간`,
                `Wait while working · GPU/NPU ${p.busy_gpu_pct}%+${p.busy_cpu_pct ? ` or CPU ${p.busy_cpu_pct}%+` : ''} · up to ${p.defer_max_hours} h`)
              : L('끔 — 정해진 때 바로 끄거나 초기화', 'Off - shut down or reset on time')}</dd>
            <dt>{t('pol.s.account')}</dt><dd>{p.allow_power ? t('pol.allowPower') : `${t('pol.s.power')}: ${t('pol.offShort')}`}
              {p.max_session_hours ? ` · ${t('pol.maxSession')} ${p.max_session_hours}${t('pol.hours')}` : ''}</dd>
            <dt>{L('공유 저장소', 'Shared storage')}</dt><dd>{storageSummary({ ...st, has_password: storage.has_password }, L)}
              {st.enabled ? ` · ${st.kind === 'smb' || st.create_by === 'user' ? L('폴더는 사용자 본인이 만듦', 'folders made by the user') : L('폴더는 엔진이 만듦', 'folders made by the engine')}` : ''}</dd>
          </dl>
        </div>
      )}
    </Dialog>
  );
}

// 장시간 작업 보호: before the idle shutdown, the session limit, a LAB / booking clean-up or a scheduled stop, the
// engine asks whether the desktop is working (pegaprox/api/vlab_work.py) and puts the step off while it is
function BusyFields({ p, set }: { p: PoolPolicy; set: <K extends keyof PoolPolicy>(k: K, v: PoolPolicy[K]) => void }) {
  const { L } = useL();
  const num = (k: 'busy_gpu_pct' | 'busy_cpu_pct' | 'defer_max_hours', lo: number, hi: number) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, Math.max(lo, Math.min(hi, Math.round(Number(e.target.value) || lo))));
  return (
    <fieldset className="plain busy-fields">
      <legend>{L('장시간 작업 보호', 'Long jobs')}</legend>
      <label className="check"><input type="checkbox" checked={p.defer_when_busy} onChange={(e) => set('defer_when_busy', e.target.checked)} />
        <span className="strong">{L('작업 중이면 미루기', 'Wait while the desktop is working')}</span></label>
      <small className="muted hint-indent">{L('작업 중인 데스크톱은 자동으로 끄거나 초기화하지 않고 미룹니다.',
        'A working desktop is not stopped or reset automatically; the step waits.')}</small>
      <HowTo><ul>
        <li>{L('대상: 미사용 자동 종료 · 최대 접속 시간 · LAB 수업/예약 정리 · 예약 작업', 'Applies to idle shutdown, session limit, LAB class / booking clean-up and scheduled actions.')}</li>
        <li>{L('GPU/NPU 사용률 · CPU 부하 · 빌드 작업 · 사용자의 "작업 중"을 봅니다.', 'Checks GPU/NPU use, CPU load, build jobs and the user’s "Working" switch.')}</li>
        <li>{L('미루면 사용자와 관리자에게 알립니다.', 'The user and admins are told.')}</li>
      </ul></HowTo>
      <div className="form-row form-row-even">
        <label><span>{L('GPU/NPU 사용률 기준', 'GPU/NPU use from')}</span>
          <span className="with-unit"><input type="number" min={1} max={100} value={p.busy_gpu_pct} disabled={!p.defer_when_busy} onChange={num('busy_gpu_pct', 1, 100)} /><span className="muted small">%</span></span></label>
        <label><span>{L('CPU 부하 기준 (0 = 안 봄)', 'CPU load from (0 = ignore)')}</span>
          <span className="with-unit"><input type="number" min={0} max={100} value={p.busy_cpu_pct} disabled={!p.defer_when_busy} onChange={num('busy_cpu_pct', 0, 100)} /><span className="muted small">%</span></span></label>
        <label><span>{L('최대 연장', 'Longest wait')}</span>
          <span className="with-unit"><input type="number" min={1} max={168} value={p.defer_max_hours} disabled={!p.defer_when_busy} onChange={num('defer_max_hours', 1, 168)} /><span className="muted small">{L('시간', 'h')}</span></span></label>
      </div>
    </fieldset>
  );
}
