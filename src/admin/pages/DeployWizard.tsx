import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { nextApi, type Grant } from '../../api/next';
import type { Pool, PoolType, Template } from '../../api/types';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { PageActions, PageTitle } from '../../components/PageHead';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { POOL_TYPES } from './PoolsPage';

// 데스크톱 > 풀 > 데스크톱 배포 (Horizon "Add pool" / AVD "Create a host pool"): one wizard from an
// image to users on desktops - pool, image, how many VMs, who gets them, review. It calls what the
// separate screens call (create the pool, clone the template into it, save its grants), in that
// order; the pool's policy starts from its defaults and is changed on the pool page afterwards.

type Step = 'basics' | 'image' | 'vms' | 'access' | 'review';
const STEPS: Step[] = ['basics', 'image', 'vms', 'access', 'review'];
type Run = { label: string; state: 'wait' | 'run' | 'ok' | 'fail' | 'skip'; note?: string };

function slug(name: string) {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return s.length >= 3 && /^[a-z0-9]/.test(s) ? s : 'desk';
}

export function DeployWizardPage() {
  const { t, pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const navigate = useNavigate();
  const clusters = useLoad(adminApi.clusters);
  const users = useLoad(adminApi.allUsers);
  const deps = useLoad(nextApi.departments);

  const [step, setStep] = useState<Step>('basics');
  const [clusterId, setClusterId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<PoolType>('dedicated');
  const [description, setDescription] = useState('');
  const [tpl, setTpl] = useState<Template | null>(null);
  const [skipVms, setSkipVms] = useState(false);
  const [count, setCount] = useState(10);
  const [prefix, setPrefix] = useState('');
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [full, setFull] = useState(false);
  const [start, setStart] = useState('');
  const [pickUsers, setPickUsers] = useState<string[]>([]);
  const [pickDeps, setPickDeps] = useState<string[]>([]);
  const [children, setChildren] = useState(true);
  const [q, setQ] = useState('');
  const [run, setRun] = useState<Run[] | null>(null);
  const [made, setMade] = useState<Pool | null>(null);

  const live = clusters.state === 'ok' ? clusters.data.filter((c) => c.connected) : [];
  useEffect(() => { if (!clusterId && live[0]) setClusterId(live[0].id); }, [clusterId, live]);
  useEffect(() => { if (!prefixTouched) setPrefix(slug(name)); }, [name, prefixTouched]);
  const templates = useLoad(useCallback(() => (clusterId ? adminApi.templates(clusterId) : Promise.resolve([] as Template[])), [clusterId]), [clusterId]);

  const idx = STEPS.indexOf(step);
  const label: Record<Step, string> = {
    basics: L('풀', 'Pool'), image: L('이미지', 'Image'), vms: L('VM', 'VMs'), access: L('사용자 · 부서', 'Users and departments'), review: L('검토 후 배포', 'Review and deploy'),
  };
  const problems: Partial<Record<Step, string>> = {
    basics: !clusterId ? L('연결된 클러스터가 없습니다.', 'No cluster is connected.') : !name.trim() ? L('풀 이름을 넣으세요.', 'Give the pool a name.') : undefined,
    image: !skipVms && !tpl ? L('템플릿을 고르거나 "VM은 나중에"를 고르세요.', 'Pick a template, or "VMs later".') : undefined,
    vms: !skipVms && !/^[A-Za-z0-9][A-Za-z0-9-]{0,40}$/.test(prefix.trim()) ? L('이름 앞부분은 영문 · 숫자 · 하이픈입니다.', 'The name prefix takes letters, digits and hyphens.') : undefined,
  };
  const firstProblem = STEPS.map((s) => problems[s]).find(Boolean);

  async function deploy() {
    const steps: Run[] = [
      { label: L(`풀 '${name.trim()}' 만들기`, `Create pool '${name.trim()}'`), state: 'run' },
      { label: skipVms ? L('VM 만들기 (나중에)', 'Make VMs (later)') : L(`${tpl?.name}에서 VM ${count}대 복제`, `Clone ${count} VMs from ${tpl?.name}`), state: skipVms ? 'skip' : 'wait' },
      { label: L('사용자 · 부서 지정', 'Grant users and departments'), state: pickUsers.length + pickDeps.length ? 'wait' : 'skip' },
    ];
    const show = () => setRun(steps.map((x) => ({ ...x })));
    show();
    let pool: Pool;
    try {
      pool = await adminApi.createPool({ name: name.trim(), type, cluster_id: clusterId, description });
      steps[0].state = 'ok'; setMade(pool);
    } catch (e) { steps[0].state = 'fail'; steps[0].note = (e as Error).message; show(); return; }
    show();
    if (!skipVms && tpl) {
      steps[1].state = 'run'; show();
      try {
        const r = await adminApi.clone(pool.id, { template_vmid: tpl.vmid, count, name_prefix: prefix.trim(), full, ...(start.trim() ? { start_vmid: Number(start) } : {}) });
        steps[1].state = r.failed ? 'fail' : 'ok';
        steps[1].note = r.failed ? t('clone.partial').replace('{n}', String(r.created.length)).replace('{vmid}', String(r.failed.vmid)).replace('{error}', r.failed.error)
          : t('clone.started').replace('{n}', String(r.created.length));
      } catch (e) { steps[1].state = 'fail'; steps[1].note = (e as Error).message; }
      show();
    }
    if (pickUsers.length + pickDeps.length) {
      steps[2].state = 'run'; show();
      const grants: Grant[] = [
        ...pickUsers.map((id) => ({ subject_type: 'user' as const, subject_id: id, include_children: false })),
        ...pickDeps.map((id) => ({ subject_type: 'department' as const, subject_id: id, include_children: children })),
      ];
      try { await nextApi.savePoolGrants(pool.id, grants); steps[2].state = 'ok'; }
      catch (e) { steps[2].state = 'fail'; steps[2].note = (e as Error).message; }
      show();
    }
  }

  const n = q.trim().toLowerCase();
  const userOpts = (users.state === 'ok' ? users.data : []).filter((u) => u.enabled !== false)
    .filter((u) => !n || u.username.toLowerCase().includes(n) || (u.display_name ?? '').toLowerCase().includes(n)).slice(0, 200);
  const depOpts = (deps.state === 'ok' ? deps.data : []).filter((d) => !n || d.name.toLowerCase().includes(n));
  const flip = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const clusterName = live.find((c) => c.id === clusterId)?.name ?? clusterId;

  return (
    <>
      <PageTitle title={L('데스크톱 배포', 'Deploy desktops')} back={{ to: '/admin/pools/list', label: L('풀 목록', 'Pools') }} />
      {!run && <PageActions><Link className="btn" to="/admin/pools/list">{L('취소', 'Cancel')}</Link></PageActions>}
      <p className="muted small page-intro">{L('풀을 만들고, 템플릿에서 VM을 복제하고, 쓸 사람을 지정합니다. 세부 정책은 만든 뒤 풀 페이지에서 바꿉니다.',
        'Make a pool, clone VMs from a template into it and grant it. Change the policy on the pool page afterwards.')}</p>

      <LoadState value={clusters} retry={clusters.reload}>
        {() => run ? (
          <section className="vm-wizard dw-run">
            <h2 className="section-title">{L('배포 진행', 'Deploying')}</h2>
            <ol className="dw-steps">
              {run.map((r) => (
                <li key={r.label} className={`dw-${r.state}`}>
                  <span className={`st-badge ${r.state === 'ok' ? 'st-ok' : r.state === 'fail' ? 'st-danger' : r.state === 'run' ? 'st-info' : 'st-neutral'}`}>
                    {r.state === 'ok' ? L('완료', 'Done') : r.state === 'fail' ? L('실패', 'Failed') : r.state === 'run' ? L('진행 중', 'Running') : r.state === 'skip' ? L('건너뜀', 'Skipped') : L('대기', 'Waiting')}</span>
                  <span className="strong">{r.label}</span>
                  {r.note && <span className="muted small">{r.note}</span>}
                </li>
              ))}
            </ol>
            {made && run.every((r) => r.state !== 'run' && r.state !== 'wait') && (
              <div className="form-actions dw-done">
                <Link className="btn" to="/admin/pools/list">{L('풀 목록', 'Pools')}</Link>
                <button type="button" className="btn primary" onClick={() => navigate(`/admin/pools/list/${made.id}`)}>{L('풀 열기', 'Open the pool')}<Icon name="chevron" size={14} /></button>
              </div>
            )}
          </section>
        ) : (
          <div className="vm-wizard">
            <ol className="stepper">
              {STEPS.map((s, i) => (
                <li key={s} className={`${s === step ? 'on' : ''}${i < idx ? ' done' : ''}`}>
                  <button type="button" onClick={() => setStep(s)} aria-current={s === step ? 'step' : undefined}><span className="stepper-n">{i < idx ? '✓' : i + 1}</span>{label[s]}</button>
                </li>
              ))}
            </ol>
            <form className="form" onSubmit={(e) => { e.preventDefault(); if (step === 'review') void deploy(); else setStep(STEPS[idx + 1]); }}>
              {step === 'basics' && (
                <div className="wiz-body">
                  {live.length === 0 && <div className="alert">{t('pool.noCluster')} <Link to="/admin/cluster/connections">{L('클러스터 연결로', 'Cluster connections')}</Link></div>}
                  <div className="form-row form-row-even">
                    <label><span>{L('풀 이름', 'Pool name')}</span><input autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={L('예: 3층 실습실 A', 'e.g. Lab room A')} /></label>
                    {live.length > 1 ? (
                      <label><span>{t('pool.cluster')}</span>
                        <select value={clusterId} onChange={(e) => { setClusterId(e.target.value); setTpl(null); }}>
                          {live.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select></label>
                    ) : <label><span>{t('pool.cluster')}</span><input value={clusterName} disabled /></label>}
                  </div>
                  <span className="field-label">{L('풀 종류', 'Pool type')}</span>
                  <div className="mode-cards dw-types" role="radiogroup" aria-label={L('풀 종류', 'Pool type')}>
                    {POOL_TYPES.map((pt) => (
                      <label key={pt} className={`mode-card${type === pt ? ' on' : ''}`}>
                        <input type="radio" name="pooltype" checked={type === pt} onChange={() => setType(pt)} />
                        <strong>{t(`pooltype.${pt}` as MessageKey)}</strong>
                        <small className="muted">{t(`pooltype.${pt}.hint` as MessageKey)}</small>
                      </label>
                    ))}
                  </div>
                  <small className="muted">{t('pool.typeLocked')}</small>
                  <label><span>{L('설명 (선택)', 'Description (optional)')}</span><input maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
                </div>
              )}

              {step === 'image' && (
                <div className="wiz-body">
                  <span className="field-label">{L('템플릿', 'Template')}</span>
                  <LoadState value={templates} retry={templates.reload}>
                    {(list) => list.length === 0 ? (
                      <div className="empty"><p>{t('clone.noTemplates')}</p><p><Link to="/admin/images/templates/templates" className="btn">{L('이미지로', 'Images')}</Link></p></div>
                    ) : (
                      <div className="pick-list dw-tpls" role="radiogroup" aria-label={L('템플릿', 'Template')}>
                        {list.map((x) => (
                          <label key={x.vmid} className={`pick${!skipVms && tpl?.vmid === x.vmid ? ' on' : ''}`}>
                            <input type="radio" name="tpl" checked={!skipVms && tpl?.vmid === x.vmid} onChange={() => { setTpl(x); setSkipVms(false); if (x.type === 'lxc') setFull(true); }} />
                            <span className="strong">{x.name}</span>
                            <span className="muted small">{x.vmid} · {x.node}{x.spec.cpu ? ` · ${x.spec.cpu} vCPU` : ''}{x.spec.memory_gb ? ` · ${x.spec.memory_gb} GB` : ''}{x.spec.disk_gb ? ` · ${x.spec.disk_gb} GB disk` : ''}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </LoadState>
                  <label className="check"><input type="checkbox" checked={skipVms} onChange={(e) => { setSkipVms(e.target.checked); if (e.target.checked) setTpl(null); }} />
                    {L('VM은 나중에 (빈 풀만 만들고, 있는 VM을 풀 페이지에서 넣습니다)', 'VMs later (an empty pool; add existing VMs on the pool page)')}</label>
                </div>
              )}

              {step === 'vms' && (
                <div className="wiz-body">
                  {skipVms ? <p className="muted">{L('VM은 나중에 넣기로 했습니다. 다음으로 넘어가세요.', 'You chose to add VMs later. Go on.')}</p> : (
                    <>
                      <div className="form-row form-row-three">
                        <label><span>{t('clone.count')}</span>
                          <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /></label>
                        <label><span>{t('clone.prefix')}</span>
                          <input value={prefix} onChange={(e) => { setPrefix(e.target.value); setPrefixTouched(true); }} /></label>
                        <label><span>{t('clone.startVmid')}</span>
                          <input inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} /></label>
                      </div>
                      <small className="muted">{t('clone.prefixHint')}</small>
                      <label className="check"><input type="checkbox" checked={full} disabled={tpl?.type === 'lxc'} onChange={(e) => setFull(e.target.checked)} />{t('clone.full')}</label>
                      {!full && <small className="muted">{t('clone.linkedNote')}</small>}
                    </>
                  )}
                </div>
              )}

              {step === 'access' && (
                <div className="wiz-body">
                  <input type="search" className="vt-search" placeholder={L('사용자 · 부서 찾기', 'Find users or departments')} value={q} onChange={(e) => setQ(e.target.value)} />
                  <div className="dw-access">
                    <fieldset className="dw-col">
                      <legend>{L(`부서 (${pickDeps.length}개 선택)`, `Departments (${pickDeps.length} picked)`)}</legend>
                      <div className="pv-pick">
                        {depOpts.length === 0 ? <p className="muted small">{L('부서가 없습니다.', 'No departments.')}</p> : depOpts.map((d) => (
                          <label key={d.id} className="check"><input type="checkbox" checked={pickDeps.includes(d.id)} onChange={() => flip(pickDeps, setPickDeps, d.id)} />
                            <span><b>{d.name}</b> <span className="muted small">· {L(`${d.members}명`, `${d.members}`)}</span></span></label>
                        ))}
                      </div>
                      <label className="check"><input type="checkbox" checked={children} onChange={(e) => setChildren(e.target.checked)} />{L('하위 부서도 포함', 'Include sub-departments')}</label>
                    </fieldset>
                    <fieldset className="dw-col">
                      <legend>{L(`사용자 (${pickUsers.length}명 선택)`, `Users (${pickUsers.length} picked)`)}</legend>
                      <div className="pv-pick">
                        {userOpts.length === 0 ? <p className="muted small">{L('사용자가 없습니다.', 'No users.')}</p> : userOpts.map((u) => (
                          <label key={u.username} className="check"><input type="checkbox" checked={pickUsers.includes(u.username)} onChange={() => flip(pickUsers, setPickUsers, u.username)} />
                            <span><b>{u.username}</b>{u.display_name && u.display_name !== u.username && <span className="muted small"> · {u.display_name}</span>}</span></label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                  <small className="muted">{L('아무도 고르지 않으면 풀만 만들고, 풀 페이지에서 나중에 지정합니다. AD 그룹도 풀 페이지에서 넣습니다.',
                    'Pick nobody to grant later on the pool page (AD groups too).')}</small>
                </div>
              )}

              {step === 'review' && (
                <div className="wiz-body">
                  <dl className="review-list">
                    <dt>{L('풀', 'Pool')}</dt><dd><b>{name.trim() || '-'}</b> · {t(`pooltype.${type}` as MessageKey)} · {clusterName}</dd>
                    <dt>{L('이미지', 'Image')}</dt><dd>{skipVms ? L('나중에', 'Later') : tpl ? `${tpl.name} (${tpl.vmid})` : '-'}</dd>
                    <dt>{L('VM', 'VMs')}</dt><dd>{skipVms ? '-' : L(`${count}대 · ${prefix}-01 … · ${full ? '전체 복제' : '연결 복제'}`, `${count} · ${prefix}-01 … · ${full ? 'full clone' : 'linked clone'}`)}</dd>
                    <dt>{L('대상', 'Granted to')}</dt><dd>{pickDeps.length + pickUsers.length === 0 ? L('나중에 지정', 'Later')
                      : [pickDeps.length && L(`부서 ${pickDeps.length}개${children ? '(하위 포함)' : ''}`, `${pickDeps.length} departments`), pickUsers.length && L(`사용자 ${pickUsers.length}명`, `${pickUsers.length} users`)].filter(Boolean).join(' · ')}</dd>
                    <dt>{L('정책', 'Policy')}</dt><dd className="muted">{L('기본값 (만든 뒤 풀 페이지 › 정책에서 바꿈)', 'Defaults (change on the pool page › Policy)')}</dd>
                  </dl>
                  {firstProblem && <div className="alert small">{firstProblem}</div>}
                </div>
              )}

              {step !== 'review' && problems[step] && <div className="alert small">{problems[step]}</div>}
              <div className="form-actions">
                {idx > 0 && <button type="button" className="btn" onClick={() => setStep(STEPS[idx - 1])}>{L('이전', 'Back')}</button>}
                {step === 'review'
                  ? <button type="submit" className="btn primary" disabled={!!firstProblem}>{L('배포', 'Deploy')}</button>
                  : <button type="submit" className="btn primary" disabled={!!problems[step]}>{L('다음', 'Next')}</button>}
              </div>
            </form>
          </div>
        )}
      </LoadState>
    </>
  );
}
