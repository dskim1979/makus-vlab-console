import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { COMPONENT_NAMES, envApi, highlightsOf } from '../../api/envmig';
import type { CompatCell, EnvComponent, EnvKind, EnvProbe, Environment } from '../../api/envmig';
import { nextApi } from '../../api/next';
import type { PoolType } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { ClusterFrame, useCluster } from './ClusterPages';

// 가상머신 > 환경 카탈로그: the environment of each golden image (kind, components and versions,
// cards, description, history), 버전 읽기 through the guest agent, the compatibility table against the
// nodes' NVIDIA host driver / vGPU manager, and "이 환경으로 풀 만들기" (pool + golden deploy).
// Engine: makus-vlab pegaprox/api/vlab_env.py. Texts are inline ko/en pairs.

type Notice = { kind: 'info' | 'error'; text: string } | null;

function useL() {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
  return { L, when };
}

const KIND_LABEL: Record<EnvKind, { ko: string; en: string }> = {
  ai: { ko: 'AI 프레임워크', en: 'AI framework' }, fpga: { ko: 'FPGA 툴', en: 'FPGA tools' },
  npu: { ko: 'NPU SDK', en: 'NPU SDK' }, general: { ko: '일반', en: 'General' },
};
const KIND_ICON = { ai: 'gpu', fpga: 'fpga', npu: 'npu', general: 'vm' } as const;
const FRAMEWORKS = ['pytorch', 'tensorflow', 'jax', 'rocm', 'vivado', 'vitis', 'quartus', 'furiosa', 'rbln'];
const errText = (e: unknown) => (e as Error).message;
const ver = (env: Environment, key: string) => env.components.find((c) => c.key === key)?.version ?? '';

export function EnvCatalogPage() {
  const { L } = useL();
  const [tab, setTab] = useState<'catalog' | 'compat'>('catalog');
  return (
    <>
      <p className="muted small page-intro">{L('골든 이미지마다 무엇이 깔려 있는지(OS · 드라이버 · CUDA · 프레임워크 · FPGA 툴 · NPU SDK)와 어떤 카드용인지를 적어 둡니다. 연구 환경은 드라이버 · CUDA · 프레임워크 버전이 서로 맞아야 돌아가므로, 버전 읽기로 VM 안에서 직접 읽고 노드와의 호환을 확인한 뒤 풀을 만드세요.',
        'Note what each golden image carries (OS, driver, CUDA, frameworks, FPGA tools, NPU SDKs) and which cards it is for. Research stacks only run when driver, CUDA and framework versions match: read them inside the VM, check them against the nodes, then make the pool.')}</p>
      <div className="segmented" role="group">
        <button type="button" className={tab === 'catalog' ? 'on' : ''} aria-pressed={tab === 'catalog'} onClick={() => setTab('catalog')}>{L('카탈로그', 'Catalogue')}</button>
        <button type="button" className={tab === 'compat' ? 'on' : ''} aria-pressed={tab === 'compat'} onClick={() => setTab('compat')}>{L('호환표', 'Compatibility')}</button>
      </div>
      {tab === 'catalog' ? <Catalog /> : <CompatTable />}
    </>
  );
}

function Catalog() {
  const { L, when } = useL();
  const { pick } = useI18n();
  const cat = useLoad(envApi.environments);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'' | EnvKind>('');
  const [fw, setFw] = useState('');
  const [cuda, setCuda] = useState('');
  const [card, setCard] = useState('');
  const [editing, setEditing] = useState<Environment | null>(null);
  const [probing, setProbing] = useState<Environment | null>(null);
  const [making, setMaking] = useState<Environment | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  return (
    <LoadState value={cat} retry={cat.reload}>
      {({ environments: list }) => {
        const cudas = [...new Set(list.map((e) => ver(e, 'cuda')).filter(Boolean))].sort();
        const fws = FRAMEWORKS.filter((k) => list.some((e) => ver(e, k)));
        const cardsAll = [...new Set(list.flatMap((e) => [...e.cards.vendors, ...e.cards.mappings]))].sort();
        const needle = q.trim().toLowerCase();
        const shown = list.filter((e) => (!kind || e.kind === kind) && (!fw || ver(e, fw)) && (!cuda || ver(e, 'cuda') === cuda)
          && (!card || e.cards.vendors.includes(card) || e.cards.mappings.includes(card))
          && (!needle || [e.name, e.description, e.notes, ...e.components.map((c) => `${c.name} ${c.version}`)].join(' ').toLowerCase().includes(needle)));
        return (
          <>
            <div className="toolbar">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('이름 · 구성 요소 · 버전 검색', 'Search name, component, version')} aria-label={L('검색', 'Search')} />
              <select value={fw} onChange={(e) => setFw(e.target.value)} aria-label={L('프레임워크', 'Framework')}>
                <option value="">{L('프레임워크 전체', 'Any framework')}</option>
                {fws.map((k) => <option key={k} value={k}>{COMPONENT_NAMES[k] ?? k}</option>)}
              </select>
              <select value={cuda} onChange={(e) => setCuda(e.target.value)} aria-label="CUDA">
                <option value="">{L('CUDA 전체', 'Any CUDA')}</option>
                {cudas.map((c) => <option key={c} value={c}>CUDA {c}</option>)}
              </select>
              <select value={card} onChange={(e) => setCard(e.target.value)} aria-label={L('카드', 'Card')}>
                <option value="">{L('카드 전체', 'Any card')}</option>
                {cardsAll.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button type="button" className="btn" onClick={cat.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
            </div>
            <div className="segmented" role="group" aria-label={L('종류', 'Kind')}>
              {(['', 'ai', 'fpga', 'npu', 'general'] as const).map((k) => (
                <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {k ? pick(KIND_LABEL[k]) : L('전체', 'All')} <span className="muted small">{list.filter((e) => !k || e.kind === k).length}</span>
                </button>
              ))}
            </div>
            {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
            {list.length === 0 ? <div className="empty"><p>{L('골든 이미지가 없습니다. 가상머신 > 골든 이미지 관리에서 먼저 등록하세요.', 'No golden images yet: add one under Virtual machines > Golden images.')}</p></div>
              : shown.length === 0 ? <div className="empty"><p>{L('조건에 맞는 환경이 없습니다.', 'No environment matches.')}</p></div> : (
              <div className="lab-grid">
                {shown.map((e) => (
                  <article key={e.golden_id} className={`lab-card env-card env-${e.kind}`}>
                    <header>
                      <span className="lab-icon"><Icon name={KIND_ICON[e.kind]} size={20} /></span>
                      <div className="lab-title"><h3>{e.name}</h3><span className="muted small">{pick(KIND_LABEL[e.kind])} · VM {e.vmid} · {e.node}</span></div>
                      <span className={`lab-state ${e.status === 'running' ? 'on' : 'idle'}`}>{e.status === 'running' ? L('켜짐', 'On') : L('꺼짐', 'Off')}</span>
                    </header>
                    {e.highlights.length > 0 ? (
                      <div className="chip-row env-highlights">{e.highlights.map((h) => <span key={h} className="chip chip-accent">{h}</span>)}</div>
                    ) : <span className="chip chip-warn">{L('구성 요소가 적혀 있지 않음', 'No components noted')}</span>}
                    {e.description && <p className="muted small lab-desc">{e.description}</p>}
                    <details className="env-more">
                      <summary>{L(`구성 요소 ${e.components.length}개 · 카드 · 기록 ${e.history.length}건`, `${e.components.length} components · cards · ${e.history.length} changes`)}</summary>
                      <table className="table compact-head env-comp">
                        <tbody>
                          {e.components.map((c) => (
                            <tr key={c.key}><td>{c.name}</td><td><code className="code">{c.version}</code>{c.source === 'probe' && <span className="chip chip-free chip-gap" title={L('버전 읽기로 확인', 'Read from the VM')}>{L('읽음', 'read')}</span>}</td></tr>
                          ))}
                        </tbody>
                      </table>
                      <dl className="lab-facts">
                        <div><dt>{L('지원 카드', 'Cards')}</dt><dd>{[...e.cards.vendors, ...e.cards.mappings].join(', ') || '-'}</dd></div>
                        <div><dt>{L('배포 버전', 'Deploys')}</dt><dd>{e.current_version ? <code className="code">{e.current_version}</code> : '-'}</dd></div>
                        <div><dt>{L('버전 읽기', 'Read')}</dt><dd>{when(e.probed_at)}</dd></div>
                      </dl>
                      {e.history.length > 0 && (
                        <ul className="ver-list env-history">
                          {e.history.slice(0, 6).map((h, i) => (
                            <li key={i}>
                              <span className="nowrap small">{when(h.at)}</span>
                              <span className="muted small">{[h.note, ...h.changes.map((c) => `${COMPONENT_NAMES[c.key] ?? c.key} ${c.from ?? '∅'} → ${c.to ?? '∅'}`)].filter(Boolean).join(' · ') || '-'}</span>
                              <span className="small">{h.by}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                    {e.pools.length > 0 && (
                      <div className="hw-row"><span className="hw-label"><Icon name="pool" size={14} />{L('쓰는 풀', 'Pools')}</span>
                        {e.pools.map((p) => <Link key={p.id} to={`/admin/pools/list/${p.id}`} className="chip">{p.name}{p.gpu?.label ? ` · ${p.gpu.label}` : ''}{p.gpu?.mig ? ' (MIG)' : ''}</Link>)}
                      </div>
                    )}
                    <footer>
                      <button type="button" className="btn small-btn" onClick={() => setEditing(e)}>{L('편집', 'Edit')}</button>
                      <button type="button" className="btn small-btn" onClick={() => setProbing(e)} title={L('VM 안에서 nvidia-smi · nvcc · python 등으로 버전을 읽습니다', 'Reads versions inside the VM (nvidia-smi, nvcc, python, ...)')}>
                        <Icon name="search" size={14} />{L('버전 읽기', 'Read versions')}</button>
                      <span className="spacer" />
                      <button type="button" className="btn small-btn primary" disabled={!e.current_version} onClick={() => setMaking(e)}
                        title={e.current_version ? '' : L('골든 이미지 관리에서 버전을 먼저 만드세요', 'Make a version first under Golden images')}>{L('이 환경으로 풀 만들기', 'Make a pool')}</button>
                    </footer>
                  </article>
                ))}
              </div>
            )}
            {editing && <EditDialog env={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); cat.reload(); setNotice({ kind: 'info', text: L('환경을 저장했습니다.', 'Saved.') }); }} />}
            {probing && <ProbeDialog env={probing} onClose={() => setProbing(null)} onDone={(n) => { setProbing(null); cat.reload(); setNotice({ kind: 'info', text: n ? L(`버전 ${n}개를 반영했습니다.`, `${n} versions updated.`) : L('바뀐 버전이 없습니다.', 'No version changed.') }); }} />}
            {making && <MakePoolDialog env={making} onClose={() => setMaking(null)} onDone={(text) => { setMaking(null); cat.reload(); setNotice({ kind: 'info', text }); }} />}
          </>
        );
      }}
    </LoadState>
  );
}

function EditDialog({ env, onClose, onDone }: { env: Environment; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const { pick } = useI18n();
  const inv = useLoad(useCallback(() => adminApi.accelerators(env.cluster_id).catch(() => null), [env.cluster_id]), [env.cluster_id]);
  const [kind, setKind] = useState<EnvKind>(env.kind);
  const [rows, setRows] = useState<EnvComponent[]>(env.components.map((c) => ({ ...c })));
  const [maps, setMaps] = useState<string[]>(env.cards.mappings);
  const [vendors, setVendors] = useState(env.cards.vendors.join(', '));
  const [desc, setDesc] = useState(env.description);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = Object.keys(COMPONENT_NAMES).filter((k) => !rows.some((r) => r.key === k));
  const mappings = inv.state === 'ok' && inv.data ? inv.data.mappings : [];

  function setRow(i: number, patch: Partial<EnvComponent>) { setRows(rows.map((r, j) => (j === i ? { ...r, ...patch, source: 'manual' } : r))); }
  async function submit() {
    setBusy(true); setError(null);
    try {
      await envApi.saveEnvironment(env.golden_id, { kind, components: rows.filter((r) => r.key && r.version.trim()).map((r) => ({ ...r, version: r.version.trim() })),
        cards: { mappings: maps, vendors: vendors.split(',').map((v) => v.trim()).filter(Boolean) }, description: desc, note: note.trim() || undefined });
      onDone();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open wide title={L(`${env.name} 환경`, `${env.name} environment`)} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy} error={error}>
      <div className="form-row form-row-even">
        <label><span>{L('종류', 'Kind')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as EnvKind)}>
            {(['ai', 'fpga', 'npu', 'general'] as const).map((k) => <option key={k} value={k}>{pick(KIND_LABEL[k])}</option>)}
          </select></label>
        <label><span>{L('변경 메모 (기록에 남음)', 'Change note (kept in the history)')}</span>
          <input value={note} maxLength={300} placeholder={L('예: CUDA 12.4로 올림', 'e.g. moved to CUDA 12.4')} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <fieldset className="env-rows">
        <legend>{L('구성 요소와 버전', 'Components and versions')}</legend>
        {rows.map((r, i) => (
          <div key={i} className="env-row">
            {COMPONENT_NAMES[r.key] ? <span className="strong">{COMPONENT_NAMES[r.key]}</span>
              : <input aria-label={L('이름', 'Name')} value={r.name} maxLength={60} placeholder={L('이름', 'Name')}
                onChange={(e) => setRow(i, { name: e.target.value, key: r.key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'item' })} />}
            <input aria-label={L('버전', 'Version')} value={r.version} maxLength={60} placeholder={L('버전', 'Version')} onChange={(e) => setRow(i, { version: e.target.value })} />
            <button type="button" className="btn-ghost small-btn danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={L('빼기', 'Remove')}>✕</button>
          </div>
        ))}
        <div className="env-row">
          <select value="" aria-label={L('구성 요소 더하기', 'Add a component')} onChange={(e) => {
            const k = e.target.value; if (!k) return;
            setRows([...rows, k === '_custom' ? { key: '', name: '', version: '' } : { key: k, name: COMPONENT_NAMES[k], version: '' }]);
          }}>
            <option value="">{L('+ 구성 요소 더하기', '+ Add a component')}</option>
            {known.map((k) => <option key={k} value={k}>{COMPONENT_NAMES[k]}</option>)}
            <option value="_custom">{L('직접 입력…', 'Other…')}</option>
          </select>
        </div>
      </fieldset>
      <fieldset>
        <legend>{L('지원 카드', 'Cards it is for')}</legend>
        {mappings.length === 0 ? <p className="muted small">{L('이 클러스터의 PCI 리소스 매핑을 읽지 못했거나 없습니다.', 'No PCI resource mappings could be read on this cluster.')}</p> : (
          <div className="check-row">
            {mappings.map((m) => (
              <label key={m.id} className="check-inline"><input type="checkbox" checked={maps.includes(m.id)}
                onChange={(e) => setMaps(e.target.checked ? [...maps, m.id] : maps.filter((x) => x !== m.id))} /><span>{m.id}{m.description ? <span className="muted"> · {m.description}</span> : null}</span></label>
            ))}
          </div>
        )}
        <label><span>{L('벤더 (쉼표로 구분)', 'Vendors (comma separated)')}</span><input value={vendors} placeholder="NVIDIA, AMD Xilinx, Rebellions" onChange={(e) => setVendors(e.target.value)} /></label>
      </fieldset>
      <label><span>{L('설명', 'Description')}</span><textarea rows={3} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
      <p className="muted small">{L(`카드에 보일 주요 버전: ${highlightsOf(rows.filter((r) => r.version)).join(' · ') || '-'}`, `Shown on the card: ${highlightsOf(rows.filter((r) => r.version)).join(' · ') || '-'}`)}</p>
    </Dialog>
  );
}

function ProbeDialog({ env, onClose, onDone }: { env: Environment; onClose: () => void; onDone: (changed: number) => void }) {
  const { L } = useL();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [found, setFound] = useState<EnvProbe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const merged = useMemo(() => {
    const out = env.components.map((c) => ({ ...c }));
    for (const f of found?.components ?? []) {
      const i = out.findIndex((c) => c.key === f.key);
      if (i >= 0) out[i] = { ...out[i], version: f.version, source: 'probe' }; else out.push({ ...f });
    }
    return out;
  }, [env.components, found]);
  const changes = merged.filter((m) => env.components.find((c) => c.key === m.key)?.version !== m.version);

  async function read() {
    setState('busy'); setError(null);
    try { const r = await envApi.probe(env.golden_id, false); setFound(r.found); setState('done'); }
    catch (e) { setError(errText(e)); setState('idle'); }
  }
  async function apply() {
    if (!changes.length) { onDone(0); return; }
    setState('busy');
    try { await envApi.saveEnvironment(env.golden_id, { components: merged, note: '버전 읽기' }); onDone(changes.length); }
    catch (e) { setError(errText(e)); setState('done'); }
  }
  return (
    <Dialog open title={L(`${env.name} 버전 읽기`, `Read versions of ${env.name}`)} onClose={onClose}
      onSubmit={state === 'done' ? apply : read} submitLabel={state === 'done' ? (changes.length ? L(`${changes.length}개 반영`, `Apply ${changes.length}`) : L('닫기', 'Close')) : L('읽기', 'Read')}
      busy={state === 'busy'} error={error}>
      {!found ? (
        <>
          <p className="muted small">{L('골든 이미지 VM 안에서 게스트 에이전트로 있는 도구만 실행해 버전을 읽습니다: nvidia-smi, nvcc --version, cuDNN 헤더, python -c "import torch" · tensorflow · jax, /opt/rocm, vivado -version, v++, quartus_sh, furiosa-smi, rbln 도구. VM이 켜져 있고 qemu-guest-agent가 돌아야 합니다. Vivado가 있으면 1분쯤 걸립니다.',
            'Runs only the tools that are there, inside the golden image VM through the guest agent: nvidia-smi, nvcc --version, the cuDNN header, python -c "import torch" / tensorflow / jax, /opt/rocm, vivado -version, v++, quartus_sh, furiosa-smi, the rbln tools. The VM has to run with qemu-guest-agent; with Vivado it takes about a minute.')}</p>
          {env.status !== 'running' && <div className="alert small">{L('VM이 꺼져 있습니다. 골든 이미지 VM을 켠 뒤 읽으세요.', 'The VM is off: start the golden image VM first.')}</div>}
          {state === 'busy' && <p className="muted small" role="status">{L('읽는 중…', 'Reading…')}</p>}
        </>
      ) : (
        <>
          <table className="table compact-head">
            <thead><tr><th>{L('구성 요소', 'Component')}</th><th>{L('지금 적힌 값', 'Noted')}</th><th>{L('읽은 값', 'Read')}</th></tr></thead>
            <tbody>
              {(found.components ?? []).map((f) => {
                const now = env.components.find((c) => c.key === f.key)?.version;
                return <tr key={f.key}><td>{f.name}</td><td className="muted">{now ?? '-'}</td><td><code className="code">{f.version}</code>{now !== f.version && <span className="chip chip-warn chip-gap">{now ? L('바뀜', 'changed') : L('새로', 'new')}</span>}</td></tr>;
              })}
            </tbody>
          </table>
          {(found.components ?? []).length === 0 && <p className="muted small">{L('읽은 구성 요소가 없습니다.', 'Nothing found.')}</p>}
          {found.driver_cuda && <p className="muted small">{L(`드라이버가 지원하는 CUDA: ${found.driver_cuda}`, `CUDA the driver supports: ${found.driver_cuda}`)}{found.pytorch_cuda ? L(` · PyTorch 빌드 CUDA: ${found.pytorch_cuda}`, ` · PyTorch built for CUDA ${found.pytorch_cuda}`) : ''}</p>}
          {found.complete === false && <div className="alert small">{L('스크립트가 끝까지 돌지 않았습니다. 일부 버전이 빠졌을 수 있습니다.', 'The script did not run to the end; some versions may be missing.')}</div>}
          <p className="muted small">{L('직접 적은 다른 구성 요소는 그대로 둡니다.', 'Components you noted yourself stay as they are.')}</p>
        </>
      )}
    </Dialog>
  );
}

function MakePoolDialog({ env, onClose, onDone }: { env: Environment; onClose: () => void; onDone: (text: string) => void }) {
  const { L } = useL();
  const [name, setName] = useState(`${env.name} 풀`);
  const [type, setType] = useState<PoolType>(env.kind === 'fpga' ? 'buildfarm' : 'dedicated');
  const [count, setCount] = useState(2);
  const [prefix, setPrefix] = useState(env.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'desk');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const pool = await adminApi.createPool({ name: name.trim(), type, cluster_id: env.cluster_id, description: env.highlights.join(' · ') });
      const r = await nextApi.deployGolden(env.golden_id, { pool_id: pool.id, count, name_prefix: prefix });
      onDone(L(`풀 '${pool.name}'을(를) 만들고 데스크톱 ${r.created.length}대를 복제하고 있습니다. GPU · 카드는 풀 화면의 GPU에서 고르세요.`,
        `Made pool '${pool.name}' and cloning ${r.created.length} desktops. Pick its GPU / card on the pool's GPU panel.`));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('이 환경으로 풀 만들기', 'Make a pool from this environment')} onClose={onClose} onSubmit={submit} submitLabel={L('만들기', 'Make')}
      busy={busy || !name.trim() || !/^[a-z0-9][a-z0-9-]*$/i.test(prefix)} error={error}>
      <p className="muted small">{L(`골든 이미지 '${env.name}'의 버전 ${env.current_version}을(를) 전체 복제해 새 풀에 넣습니다(골든 배포와 같음).`,
        `Full clones of '${env.name}' ${env.current_version} go into a new pool (the golden deploy).`)}</p>
      <label><span>{L('풀 이름', 'Pool name')}</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-row form-row-even">
        <label><span>{L('풀 종류', 'Pool type')}</span>
          <select value={type} onChange={(e) => setType(e.target.value as PoolType)}>
            <option value="dedicated">{L('전용 (한 사람에 한 대)', 'Dedicated')}</option>
            <option value="shared">{L('공유', 'Shared')}</option>
            <option value="reset">{L('초기화형', 'Reset')}</option>
            <option value="buildfarm">{L('빌드 팜', 'Build farm')}</option>
          </select></label>
        <label><span>{L('대수', 'Count')}</span><input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /></label>
      </div>
      <label><span>{L('이름 앞부분', 'Name prefix')}</span><input value={prefix} maxLength={40} onChange={(e) => setPrefix(e.target.value.trim())} /></label>
      <p className="muted small">{L(`이름: ${prefix}-01, ${prefix}-02 … · 주요 버전: ${env.highlights.join(' · ') || '-'}`, `Names: ${prefix}-01, ${prefix}-02 … · ${env.highlights.join(' · ') || '-'}`)}</p>
    </Dialog>
  );
}

// --- 호환표 ---------------------------------------------------------------------------------

const STATUS_CHIP: Record<CompatCell['status'], string> = { ok: 'chip-ok', warn: 'chip-warn', error: 'chip-off', unknown: 'chip-free' };

function CompatTable() {
  const { L } = useL();
  const { pick } = useI18n();
  const { current } = useCluster();
  const [refresh, setRefresh] = useState(0);
  const data = useLoad(useCallback(() => (current ? envApi.compat(current.id, refresh > 0) : new Promise<never>(() => {})), [current?.id, refresh]), [current?.id, refresh]);
  const statusLabel = (s: CompatCell['status']) => ({ ok: L('맞음', 'OK'), warn: L('주의', 'Check'), error: L('안 맞음', 'Mismatch'), unknown: L('모름', 'Unknown') }[s]);
  return (
    <ClusterFrame reload={() => setRefresh((n) => n + 1)}>
      {() => (
        <LoadState value={data} retry={data.reload}>
          {(r) => r.nodes.length === 0 ? <div className="empty"><p>{L('NVIDIA GPU가 있는 노드가 없습니다.', 'No node with an NVIDIA GPU.')}</p></div> : (
            <>
              <div className="table-scroll">
                <table className="table compact-head compat-table">
                  <thead>
                    <tr>
                      <th>{L('환경', 'Environment')}</th>
                      {r.nodes.map((n) => (
                        <th key={n.node}>
                          <div className="strong">{n.node}</div>
                          <div className="muted small">{n.readable ? (n.driver ? `${n.vgpu_manager ? 'vGPU' : L('호스트 드라이버', 'host driver')} ${n.driver}` : L('패스스루 (호스트 드라이버 없음)', 'passthrough (no host driver)')) : L('읽지 못함', 'unreadable')}</div>
                          <div className="muted small">{n.models.join(', ')}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.length === 0 && <tr><td colSpan={r.nodes.length + 1} className="muted">{L('NVIDIA 드라이버 · CUDA가 적힌 환경이 없습니다. 카탈로그에서 버전 읽기를 하세요.', 'No environment notes an NVIDIA driver or CUDA: read the versions in the catalogue.')}</td></tr>}
                    {r.rows.map((row) => (
                      <tr key={row.golden_id}>
                        <td><span className="strong">{row.name}</span><div className="muted small">{pick(KIND_LABEL[row.kind])}{row.use_vgpu === true ? ' · vGPU' : row.use_vgpu === false ? L(' · 패스스루', ' · passthrough') : ''}</div>
                          <div className="chip-row">{row.highlights.slice(0, 3).map((h) => <span key={h} className="chip">{h}</span>)}</div></td>
                        {r.nodes.map((n) => {
                          const c = row.cells[n.node];
                          if (!c) return <td key={n.node} className="muted small">{L('대상 아님', 'not for this node')}</td>;
                          return (
                            <td key={n.node} className="compat-cell">
                              <span className={`chip ${STATUS_CHIP[c.status]}`}>{statusLabel(c.status)}</span>
                              <div className="small">{c.mode === 'vgpu' ? `vGPU ${c.host_vgpu_release || '?'} · R${c.host_branch || '?'} / R${c.guest_branch || '?'}` : L(`패스스루 · 게스트 R${c.guest_branch || '?'}`, `passthrough · guest R${c.guest_branch || '?'}`)}{c.cuda ? ` · CUDA ${c.cuda}` : ''}</div>
                              {c.notes.filter((x) => x.severity !== 'info').map((x, i) => <div key={i} className={`small ${x.severity === 'error' ? 'text-danger' : 'muted'}`}>{pick({ ko: x.ko, en: x.en })}</div>)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="callout"><Icon name="info" size={18} /><p>{L('NVIDIA vGPU는 노드의 vGPU 매니저와 게스트 드라이버가 같은 릴리스 브랜치(예: vGPU 17 = R550)여야 붙습니다. 게스트가 더 새것이면 vGPU가 올라오지 않고, 더 오래된 것은 NVIDIA가 지원하는 조합일 때만 됩니다. 패스스루는 호스트 드라이버와 상관없이 게스트 드라이버가 CUDA(PyTorch 빌드의 CUDA 포함)에 필요한 버전 이상이면 됩니다. 노드는 SSH로 nvidia-smi를 읽고 1분 동안 기억합니다.',
                'NVIDIA vGPU comes up only when the node\'s vGPU manager and the guest driver are on the same release branch (e.g. vGPU 17 = R550). A newer guest does not come up; an older one only in combinations NVIDIA supports. With passthrough the host driver does not matter: the guest driver has to be new enough for the CUDA (including the one PyTorch was built for). The nodes are read over SSH (nvidia-smi) and kept for a minute.')}</p></div>
            </>
          )}
        </LoadState>
      )}
    </ClusterFrame>
  );
}
