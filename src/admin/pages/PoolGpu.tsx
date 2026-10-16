import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { GpuPolicy, Pool } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

type Notice = { kind: 'info' | 'error'; text: string };

// 데스크톱 풀 > (풀) > GPU: none, a whole GPU or a vGPU profile, through a PCI resource
// mapping; saved on the pool, written to the desktops with "apply". docs/vlab-design.md 10-0.
export function PoolGpuPanel({ pool, onChanged }: { pool: Pool; onChanged: () => void }) {
  const { t, pick } = useI18n();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const g = pool.settings?.gpu;
  const on = g && g.mode !== 'none';

  async function apply() {
    setBusy(true); setNotice(null);
    try {
      const r = await adminApi.applyPoolGpu(pool.id);
      const parts = [t('gpu.applied').replace('{n}', String(r.applied.length))];
      if (r.needs_restart.length) parts.push(t('gpu.restart').replace('{n}', String(r.needs_restart.length)));
      if (r.failed.length) parts.push(t('gpu.failed').replace('{n}', String(r.failed.length)).replace('{error}', r.failed.map((f) => `${f.name}: ${f.error}`).join('; ')));
      setNotice({ kind: r.failed.length ? 'error' : 'info', text: parts.join(' ') });
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`panel gpu-panel${on ? ' gpu-on' : ''}`}>
      <div className="panel-head">
        <span className="stat-icon tone-green"><Icon name="gpu" size={18} /></span>
        <div>
          <h2 className="section-title">{t('gpu.title')}</h2>
          <div className="gpu-now">
            {!on ? <span className="muted">{t('gpu.none')}</span> : (
              <>
                <span className="chip chip-accent">{t(g!.mode === 'vgpu' ? 'gpu.vgpu' : 'gpu.passthrough')}</span>
                <span className="strong">{g!.label || g!.mdev_type || g!.mapping}</span>
                <span className="muted small">· {g!.mapping}{g!.mdev_type ? ` · ${g!.mdev_type}` : ''}</span>
                {g!.mig && <span className="chip chip-accent" title={pick({ ko: 'MIG-backed vGPU: 카드의 MIG 모드가 켜져 있고 GPU 인스턴스가 있어야 합니다', en: 'MIG-backed vGPU: the card needs MIG mode on with GPU instances' })}>MIG</span>}
              </>
            )}
          </div>
        </div>
        <div className="panel-actions">
          <button type="button" className="btn" onClick={() => setEditing(true)}>{t('gpu.change')}</button>
          <button type="button" className="btn primary" disabled={busy || pool.desktops === 0} onClick={apply}>{t('gpu.apply')}</button>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      {editing && (
        <GpuDialog pool={pool} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setNotice({ kind: 'info', text: t('gpu.saved') }); onChanged(); }} />
      )}
    </section>
  );
}

function GpuDialog({ pool, onClose, onSaved }: { pool: Pool; onClose: () => void; onSaved: () => void }) {
  const { t, pick } = useI18n();
  const inv = useLoad(useCallback(() => adminApi.accelerators(pool.cluster_id), [pool.cluster_id]), [pool.cluster_id]);
  const cur = pool.settings?.gpu;
  const [mode, setMode] = useState<GpuPolicy['mode']>(cur?.mode ?? 'none');
  const [mapping, setMapping] = useState(cur?.mapping ?? '');
  const [mdev, setMdev] = useState(cur?.mdev_type ?? '');
  const [label, setLabel] = useState(cur?.label ?? '');
  const [xvga, setXvga] = useState(!!cur?.x_vga);
  const [mig, setMig] = useState(!!cur?.mig);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = inv.state === 'ok' ? inv.data.mappings : [];
  const usable = all.filter((m) => (mode === 'vgpu' ? m.mdev : true));
  useEffect(() => {
    if (mode !== 'none' && usable.length && !usable.some((m) => m.id === mapping)) setMapping(usable[0].id);
  }, [mode, usable, mapping]);

  // a mapping's profiles are those of its first card (the cards of one mapping are one model)
  const first = all.find((m) => m.id === mapping)?.devices[0];
  const profiles = useLoad(useCallback(() => (mode === 'vgpu' && first
    ? adminApi.profiles(pool.cluster_id, first.node, first.path) : Promise.resolve([])),
  [mode, first?.node, first?.path, pool.cluster_id]), [mode, first?.node, first?.path, pool.cluster_id]);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await adminApi.setPoolGpu(pool.id, mode === 'none' ? { mode } : mode === 'vgpu'
        ? { mode, mapping, mdev_type: mdev, label: label || undefined, mig: mig || undefined }
        : { mode, mapping, x_vga: xvga, label: label || undefined });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = mode === 'none' || (mapping && (mode !== 'vgpu' || mdev));
  return (
    <Dialog open title={`${t('gpu.change')} · ${pool.name}`} onClose={onClose} onSubmit={submit} submitLabel={t('common.save')}
      busy={busy || !ready} error={error}>
      <div className="mode-cards" role="radiogroup" aria-label={t('gpu.title')}>
        {(['none', 'vgpu', 'passthrough'] as const).map((m) => (
          <label key={m} className={`mode-card${mode === m ? ' on' : ''}`}>
            <input type="radio" name="gpu-mode" checked={mode === m} onChange={() => setMode(m)} aria-label={t(`gpu.${m}`)} />
            <span className="strong">{t(`gpu.${m}`)}</span>
            <span className="muted small">{t(m === 'none' ? 'gpu.noneHint' : m === 'vgpu' ? 'gpu.vgpuHint' : 'gpu.passHint')}</span>
          </label>
        ))}
      </div>
      {mode !== 'none' && (
        <LoadState value={inv} retry={inv.reload}>
          {() => usable.length === 0 ? <div className="alert small">{t('gpu.noMappings')}</div> : (
            <>
              <label>
                <span>{t('gpu.pickMapping')}</span>
                <select value={mapping} onChange={(e) => { setMapping(e.target.value); setMdev(''); }}>
                  {usable.map((m) => <option key={m.id} value={m.id}>{m.id}{m.description ? ` — ${m.description}` : ''}</option>)}
                </select>
              </label>
              {mode === 'vgpu' && (
                <LoadState value={profiles} retry={profiles.reload}>
                  {(ps) => (
                    <>
                    {ps.some((p) => p.mig_slices) && <small className="muted">{pick({ ko: 'MIG 표시 프로필은 MIG-backed vGPU입니다: 카드를 MIG 모드로 두고 가속 자원 > GPU · 가속 카드 재고에서 GPU 인스턴스를 만들어야 켜집니다. 남은 수는 노드에 만든 GPU 인스턴스만큼입니다.', en: 'Profiles marked MIG are MIG-backed vGPU: the card has to be in MIG mode with GPU instances made under Accelerators > GPU and card inventory. What is available follows the GPU instances on the node.' })}</small>}
                    <div className="pick-list" role="radiogroup" aria-label={t('gpu.pickProfile')}>
                      {ps.map((p) => (
                        <label key={p.type} className={`pick${mdev === p.type ? ' on' : ''}${p.available === 0 && mdev !== p.type ? ' off' : ''}`}>
                          <input type="radio" name="mdev" checked={mdev === p.type} disabled={p.available === 0 && mdev !== p.type}
                            aria-label={p.name} onChange={() => { setMdev(p.type); setMig(!!p.mig_slices); setLabel(p.name.replace(/^NVIDIA\s+/, '')); }} />
                          <span className="strong">{p.name}{p.mig_slices ? <span className="chip chip-accent chip-gap">MIG {p.mig_slices}/7</span> : null}</span>
                          <span className="muted small">
                            {p.framebuffer_mb ? `${p.framebuffer_mb / 1024} GB` : ''}{p.max_resolution ? ` · ${p.max_resolution}` : ''} · {t('ac.available')} {p.available}
                          </span>
                        </label>
                      ))}
                    </div>
                    </>
                  )}
                </LoadState>
              )}
              {mode === 'passthrough' && (
                <label className="check"><input type="checkbox" checked={xvga} onChange={(e) => setXvga(e.target.checked)} /><span>{t('gpu.xvga')}</span></label>
              )}
              <small className="muted">{t('gpu.slotNote')}</small>
            </>
          )}
        </LoadState>
      )}
    </Dialog>
  );
}
