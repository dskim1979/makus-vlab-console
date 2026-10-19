import { useCallback, useState } from 'react';
import { ApiError } from '../../api/client';
import { envApi } from '../../api/envmig';
import type { MigCard, MigGpu, MigNode } from '../../api/envmig';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// 가속 자원 > GPU · 가속 카드 재고: NVIDIA MIG of the A100 / A30 / H100 / H200 cards, read from
// the nodes' nvidia-smi over SSH (makus-vlab pegaprox/vlab/mig.py). Mode on/off and the GPU
// instance layout are written only while no running VM on the node holds an NVIDIA card.

function useL() {
  const { pick } = useI18n();
  return (ko: string, en: string) => pick({ ko, en });
}

const SLICE_TONE = ['mig-a', 'mig-b', 'mig-c', 'mig-d', 'mig-e', 'mig-f', 'mig-g'];

// the 7 compute slices (8 memory slices) of the card, with its GPU instances placed on them
function SliceBar({ g }: { g: MigGpu }) {
  const L = useL();
  const total = 8;
  return (
    <div className="mig-bar" role="img" aria-label={L(`GPU 인스턴스 ${g.gpu_instances.length}개`, `${g.gpu_instances.length} GPU instances`)}>
      {g.gpu_instances.map((gi, i) => (
        <span key={gi.id} className={`mig-gi ${SLICE_TONE[i % SLICE_TONE.length]}`} title={`GI ${gi.id} · ${gi.profile}`}
          style={{ left: `${(gi.start / total) * 100}%`, width: `${(gi.size / total) * 100}%` }}>{gi.profile}</span>
      ))}
      {g.gpu_instances.length === 0 && <span className="mig-empty muted small">{L('GPU 인스턴스 없음', 'no GPU instances')}</span>}
    </div>
  );
}

export function MigPanel({ clusterId }: { clusterId: string }) {
  const L = useL();
  const [refresh, setRefresh] = useState(0);
  const state = useLoad(useCallback(() => envApi.mig(clusterId, refresh > 0), [clusterId, refresh]), [clusterId, refresh]);
  const [edit, setEdit] = useState<{ node: MigNode; card: MigCard } | null>(null);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  if (state.state === 'ok' && state.data.summary.mig_capable === 0 && !state.data.nodes.some((n) => !n.readable)) return null;
  return (
    <section className="panel mig-panel">
      <div className="panel-head">
        <span className="stat-icon tone-green"><Icon name="layers" size={18} /></span>
        <div>
          <h2 className="section-title">{L('NVIDIA MIG 분할', 'NVIDIA MIG')}</h2>
          <span className="muted small">{L('카드 한 장을 최대 7개로 나눠 데스크톱에 줍니다.', 'Split a card into up to seven parts for desktops.')}</span>
        </div>
        <div className="panel-actions">
          <button type="button" className="btn" onClick={() => setRefresh((n) => n + 1)}><Icon name="refresh" size={16} />{L('노드에서 다시 읽기', 'Read the nodes again')}</button>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      <LoadState value={state} retry={state.reload}>
        {(r) => (
          <>
            {r.nodes.filter((n) => !n.readable).map((n) => (
              <div key={n.node} className="alert small">{L(`${n.node}: nvidia-smi를 읽지 못했습니다 (${n.error}). 노드 SSH 자격 증명을 확인하세요.`, `${n.node}: nvidia-smi could not be read (${n.error}). Check the node SSH credentials.`)}</div>
            ))}
            <div className="mig-grid">
              {r.nodes.flatMap((n) => n.cards.filter((c) => c.mig_capable).map((c) => {
                const g = c.state;
                const on = g?.mig_current === 'enabled';
                const pending = g && g.mig_pending && g.mig_pending !== g.mig_current;
                return (
                  <article key={`${n.node}/${c.pciid}`} className="mig-card">
                    <header>
                      <div><div className="hw-vendor">{n.node} · <code className="code">{c.pciid}</code>{g ? ` · GPU ${g.index}` : ''}</div>
                        <h3 className="hw-model">{g?.name ?? c.model}</h3></div>
                      {g ? <span className={`chip ${on ? 'chip-on' : 'chip-free'}`}>{on ? L('MIG 켜짐', 'MIG on') : L('MIG 꺼짐', 'MIG off')}</span>
                        : <span className="chip chip-warn">{L('상태 모름', 'unknown')}</span>}
                      {pending && <span className="chip chip-warn" title={L('GPU 리셋이나 노드 재부팅 뒤 반영', 'Takes effect after a GPU reset or a node reboot')}>{L(`대기: ${g!.mig_pending}`, `pending: ${g!.mig_pending}`)}</span>}
                    </header>
                    {g && on && <SliceBar g={g} />}
                    {g && on && (
                      <div className="small">
                        {g.gpu_instances.length ? L(`GPU 인스턴스 ${g.gpu_instances.length}개 · 컴퓨트 인스턴스 ${g.compute_instances.length}개 · 슬라이스 ${g.slices_used}/8 사용`,
                          `${g.gpu_instances.length} GPU instances · ${g.compute_instances.length} compute instances · ${g.slices_used}/8 slices`) : L('MIG 모드지만 인스턴스가 없어 이 카드에 vGPU가 올라가지 않습니다.', 'MIG mode without instances: no vGPU can sit on this card.')}
                        <div className="chip-row mig-free">{g.profiles.map((p) => <span key={p.id} className={`chip ${p.free ? '' : 'chip-free'}`} title={`ID ${p.id} · ${p.memory_gb} GiB · SM ${p.sm}`}>{p.name} {p.free}/{p.total}</span>)}</div>
                      </div>
                    )}
                    {g && !on && <p className="muted small">{L('MIG가 꺼져 있어 카드 한 장 그대로(패스스루나 시분할 vGPU)로 씁니다.', 'MIG is off: the card is used whole (passthrough or time-sliced vGPU).')}</p>}
                    <div className="hw-row"><span className="hw-label"><Icon name="vm" size={14} />{L('쓰는 VM', 'Used by')}</span>
                      {c.used_by.length ? c.used_by.map((u) => <span key={`${u.vmid}${u.slot}`} className={`chip ${u.status === 'running' ? 'chip-on' : ''}`}>{u.name}{u.mdev ? ` · ${u.mdev}` : ''}</span>)
                        : <span className="chip chip-free">{L('없음', 'none')}</span>}
                    </div>
                    <footer>
                      <span className="muted small">{n.vgpu_manager ? L(`vGPU 매니저 ${n.driver}`, `vGPU manager ${n.driver}`) : n.driver ? L(`드라이버 ${n.driver} (vGPU 매니저 아님)`, `driver ${n.driver} (no vGPU manager)`) : ''}</span>
                      <span className="spacer" />
                      <button type="button" className="btn small-btn" disabled={!g} onClick={() => setEdit({ node: n, card: c })}>{L('분할 바꾸기', 'Change')}</button>
                    </footer>
                  </article>
                );
              }))}
            </div>
            {r.summary.mig_capable === 0 && <p className="muted small">{L('MIG를 지원하는 카드가 없습니다.', 'No MIG-capable card.')}</p>}
            <details className="small">
              <summary>{L('Proxmox에서 MIG를 데스크톱에 주는 방법', 'How MIG reaches a desktop on Proxmox')}</summary>
              <ul className="muted">
                <li>{L('노드에 NVIDIA vGPU 매니저(AI Enterprise · C-series 라이선스)를 설치합니다.', 'Install the NVIDIA vGPU manager (AI Enterprise / C-series licence) on the node.')}</li>
                <li>{L('MIG 모드를 켜고 여기서 GPU 인스턴스를 만듭니다.', 'Turn MIG mode on and make GPU instances here.')}</li>
                <li>{L('풀 GPU 정책에서 MIG-backed vGPU 프로필(A100D-3-40C 등)을 고릅니다.', 'Pick a MIG-backed vGPU profile (like A100D-3-40C) in the pool GPU policy.')}</li>
                <li>{L('MIG 인스턴스는 PCI 장치가 아니라 패스스루할 수 없습니다.', 'A MIG instance is not a PCI device and cannot be passed through.')}</li>
              </ul>
              <table className="table compact-head"><tbody>
                {Object.entries(r.reference).map(([card, ps]) => <tr key={card}><td className="nowrap">{card}</td><td className="small">{ps.join(' · ')}</td></tr>)}
              </tbody></table>
            </details>
          </>
        )}
      </LoadState>
      {edit && <MigDialog clusterId={clusterId} node={edit.node} card={edit.card} onClose={() => setEdit(null)}
        onDone={(text, err) => { setEdit(null); setNotice({ kind: err ? 'error' : 'info', text }); setRefresh((n) => n + 1); }} />}
    </section>
  );
}

function MigDialog({ clusterId, node, card, onClose, onDone }: { clusterId: string; node: MigNode; card: MigCard; onClose: () => void; onDone: (text: string, err?: boolean) => void }) {
  const L = useL();
  const g = card.state!;
  const on = g.mig_current === 'enabled';
  const [action, setAction] = useState<'layout' | 'mode'>(on ? 'layout' : 'mode');
  const [layout, setLayout] = useState<string[]>(g.gpu_instances.map((gi) => gi.profile));
  const [compute, setCompute] = useState(false);
  const [reset, setReset] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyVms, setBusyVms] = useState<{ vmid: number; name: string }[]>([]);
  const slices = layout.reduce((n, p) => n + (Number(/^(\d)g/.exec(p)?.[1]) || 0), 0);

  async function submit() {
    setBusy(true); setError(null); setBusyVms([]);
    try {
      const r = await envApi.setMig(clusterId, node.node, g.index, action === 'mode' ? { action, enable: !on, reset, confirm } : { action, layout, compute, confirm });
      onDone(action === 'mode'
        ? (r.pending ? L(`MIG 모드를 ${on ? '껐' : '켰'}습니다. GPU 리셋이나 노드 재부팅 뒤 반영됩니다.`, `MIG mode ${on ? 'off' : 'on'}; it takes effect after a GPU reset or a node reboot.`)
          : L(`MIG 모드를 ${on ? '껐' : '켰'}습니다.`, `MIG mode is ${on ? 'off' : 'on'}.`))
        : L(`GPU 인스턴스를 ${layout.length}개로 다시 만들었습니다.`, `Made ${layout.length} GPU instances.`));
    } catch (e) {
      const data = e instanceof ApiError ? (e.body as { code?: string; vms?: { vmid: number; name: string }[]; output?: string } | undefined) : undefined;
      if (data?.code === 'BUSY') setBusyVms(data.vms ?? []);
      setError((e as Error).message + (data?.output ? `\n${data.output}` : ''));
    } finally { setBusy(false); }
  }

  return (
    <Dialog open wide title={L(`${node.node} · ${g.name} (GPU ${g.index}) 분할`, `${node.node} · ${g.name} (GPU ${g.index})`)} onClose={onClose} onSubmit={submit}
      submitLabel={L('적용', 'Apply')} busy={busy || confirm !== node.node || (action === 'layout' && slices > 7)} error={error}>
      <div className="alert small">{L('기존 인스턴스는 모두 지워지며, 카드를 쓰는 VM이 켜져 있으면 거절합니다.',
        'Every instance of the card is removed; refused while a running VM uses an NVIDIA card.')}</div>
      <div className="segmented" role="group">
        <button type="button" className={action === 'layout' ? 'on' : ''} disabled={!on} onClick={() => setAction('layout')}>{L('GPU 인스턴스 분할', 'GPU instance layout')}</button>
        <button type="button" className={action === 'mode' ? 'on' : ''} onClick={() => setAction('mode')}>{on ? L('MIG 모드 끄기', 'Turn MIG off') : L('MIG 모드 켜기', 'Turn MIG on')}</button>
      </div>
      {action === 'layout' ? (
        <>
          <div className="chip-row">
            {g.profiles.map((p) => (
              <button key={p.id} type="button" className="btn small-btn" onClick={() => setLayout([...layout, p.name])} title={`${p.memory_gb} GiB · SM ${p.sm}`}>+ {p.name}</button>
            ))}
          </div>
          <div className="chip-row mig-layout">
            {layout.length === 0 && <span className="muted small">{L('비어 있음 (인스턴스를 모두 지움)', 'empty (removes every instance)')}</span>}
            {layout.map((p, i) => <span key={i} className={`chip ${SLICE_TONE[i % SLICE_TONE.length]}`}>{p}<button type="button" className="chip-x" aria-label={L('빼기', 'Remove')} onClick={() => setLayout(layout.filter((_, j) => j !== i))}>×</button></span>)}
          </div>
          <p className={`small ${slices > 7 ? 'text-danger' : 'muted'}`}>{L(`컴퓨트 슬라이스 ${slices}/7`, `${slices}/7 compute slices`)}</p>
          <label className="check"><input type="checkbox" checked={compute} onChange={(e) => setCompute(e.target.checked)} />
            <span>{L('기본 컴퓨트 인스턴스도 만들기 (-C, 노드에서 CUDA를 쓸 때만)', 'Also make the default compute instance (-C, only for CUDA on the node)')}</span></label>
        </>
      ) : (
        <>
          <p className="muted small">{on ? L('MIG를 끄면 MIG-backed vGPU를 쓰는 풀은 켜지지 않습니다.', 'With MIG off the card is whole again (passthrough or time-sliced vGPU); pools on MIG-backed vGPU no longer start.')
            : L('MIG를 켜면 MIG-backed 프로필만 남습니다. 켠 뒤 GPU 인스턴스를 만드세요.', 'With MIG on only MIG-backed vGPU profiles remain; make GPU instances afterwards.')}</p>
          <label className="check"><input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
            <span>{L('바로 GPU 리셋 (nvidia-smi -r, 안 되면 노드 재부팅)', 'Reset the GPU right away (nvidia-smi -r, else reboot the node)')}</span></label>
        </>
      )}
      {busyVms.length > 0 && <div className="alert small error">{L('먼저 끌 VM: ', 'Stop first: ')}{busyVms.map((v) => `${v.name} (${v.vmid})`).join(', ')}</div>}
      <label><span>{L(`확인을 위해 노드 이름 '${node.node}'을(를) 입력하세요`, `Type the node name '${node.node}' to confirm`)}</span>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value.trim())} autoComplete="off" /></label>
    </Dialog>
  );
}
