import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { AccelDevice, AccelInventory, AccelUser, AccelKind } from '../../api/types';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { ClusterFrame, Meter, useCluster } from './ClusterPages';

// 가속 자원 > GPU·가속 카드 재고 · vGPU 프로필 · 리소스 매핑 (docs/vlab-design.md 10-0)

function useInventory() {
  const { current } = useCluster();
  // stays loading until the cluster list has picked a cluster
  const inv = useLoad(useCallback(() => (current ? adminApi.accelerators(current.id)
    : new Promise<AccelInventory>(() => {})), [current?.id]), [current?.id]);
  return { current, inv };
}

// brand-ish colour per vendor for the card's stripe (identity, never status)
const VENDOR_TONE: Record<string, string> = { '10de': 'nvidia', '1002': 'amd', '8086': 'intel', '10ee': 'xilinx', '1172': 'intel',
  '1ed2': 'npu', '1eff': 'npu', '1f56': 'npu', '1ff4': 'npu', '209f': 'npu' };
const KIND_ICON = { gpu: 'gpu', fpga: 'fpga', npu: 'npu' } as const;

function Users({ list }: { list: AccelUser[] }) {
  const { t } = useI18n();
  if (list.length === 0) return <span className="chip chip-free">{t('ac.free')}</span>;
  return (
    <span className="users-inline">
      {list.map((u) => (
        <span key={`${u.vmid}-${u.slot}`} className={`chip ${u.status === 'running' ? 'chip-on' : ''}`}
          title={`${u.slot}${u.mdev ? ` · ${u.mdev}` : ''}`}>
          {u.name}{u.pool ? <span className="muted"> · {u.pool}</span> : null}
        </span>
      ))}
    </span>
  );
}

export function AccelInventoryPage() {
  const { t } = useI18n();
  const { inv } = useInventory();
  const [kind, setKind] = useState<'' | AccelKind>('');
  return (
    <ClusterFrame reload={inv.reload}>
      {() => (
        <LoadState value={inv} retry={inv.reload}>
          {(r) => {
            const list = r.devices.filter((d) => !kind || d.kind === kind);
            return (
              <>
                <div className="stats">
                  <Stat icon="gpu" tone="green" label={t('ac.gpus')} value={r.summary.gpus} />
                  <Stat icon="layers" tone="violet" label={t('ac.vgpuCapable')} value={r.summary.vgpu_capable} />
                  <Stat icon="fpga" tone="pink" label={t('ac.fpgas')} value={r.summary.fpgas} />
                  <Stat icon="npu" tone="teal" label={t('ac.npus')} value={r.summary.npus ?? 0} />
                  <Stat icon="spark" tone="blue" label={t('ac.inUse')} value={r.summary.in_use} />
                </div>
                {r.unreadable_nodes.length > 0 && <div className="alert small">{t('ac.unreadable').replace('{n}', r.unreadable_nodes.join(', '))}</div>}
                <div className="segmented" role="group">
                  {(['', 'gpu', 'fpga', 'npu'] as const).map((k) => (
                    <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
                      {t(k === '' ? 'ac.all' : k === 'gpu' ? 'ac.kindGpu' : k === 'fpga' ? 'ac.kindFpga' : 'ac.kindNpu')}
                    </button>
                  ))}
                </div>
                {list.length === 0 ? <div className="empty"><p>{t('ac.empty')}</p></div> : (
                  <div className="hw-grid">{list.map((d) => <DeviceCard key={`${d.node}/${d.pciid}`} d={d} />)}</div>
                )}
                <p className="muted small">{t('ac.note')}</p>
              </>
            );
          }}
        </LoadState>
      )}
    </ClusterFrame>
  );
}

function Stat({ icon, tone, label, value }: { icon: 'gpu' | 'layers' | 'fpga' | 'npu' | 'spark'; tone: string; label: string; value: number }) {
  return (
    <div className="stat static">
      <span className={`stat-icon tone-${tone}`}><Icon name={icon} size={18} /></span>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function DeviceCard({ d }: { d: AccelDevice }) {
  const { t } = useI18n();
  return (
    <article className={`hw-card vendor-${VENDOR_TONE[d.vendor_id] ?? 'other'}`}>
      <header>
        <span className="hw-icon"><Icon name={KIND_ICON[d.kind] ?? 'gpu'} size={22} /></span>
        <div>
          <div className="hw-vendor">{d.vendor}</div>
          <h3 className="hw-model">{d.model}</h3>
        </div>
        {d.vgpu_capable && <span className="chip chip-accent">vGPU</span>}
        {d.virtual_function && <span className="chip chip-accent" title={t('ac.vfHint')}>{t('ac.vf')}</span>}
      </header>
      <dl className="hw-facts">
        <dt>{t('desk.node')}</dt><dd>{d.node}</dd>
        <dt>PCI</dt><dd><code className="code">{d.pciid}</code></dd>
        {d.iommu_group !== null && <><dt>{t('ac.iommu')}</dt><dd>{d.iommu_group}</dd></>}
        {d.subsystem && <><dt>&nbsp;</dt><dd className="muted small">{d.subsystem}</dd></>}
      </dl>
      <div className="hw-row">
        <span className="hw-label"><Icon name="link" size={14} />{t('ac.mapping')}</span>
        {d.mappings.length ? d.mappings.map((m) => <span key={m} className="chip">{m}</span>)
          : <span className="muted small">{t('ac.noMapping')}</span>}
      </div>
      <div className="hw-row">
        <span className="hw-label"><Icon name="vm" size={14} />{t('ac.usedBy')}</span>
        <Users list={d.used_by} />
      </div>
    </article>
  );
}

// --- vGPU 프로필 -----------------------------------------------------------------

export function VgpuProfilesPage() {
  const { t } = useI18n();
  const { current, inv } = useInventory();
  const [pick, setPick] = useState('');
  const cards = inv.state === 'ok' ? inv.data.devices.filter((d) => d.kind === 'gpu' && d.vgpu_capable) : [];
  const card = cards.find((d) => `${d.node}/${d.pciid}` === pick) ?? cards[0];
  useEffect(() => { if (card && `${card.node}/${card.pciid}` !== pick) setPick(`${card.node}/${card.pciid}`); }, [card, pick]);
  const profiles = useLoad(useCallback(() => (current && card ? adminApi.profiles(current.id, card.node, card.pciid) : Promise.resolve([])),
    [current?.id, card?.node, card?.pciid]), [current?.id, card?.node, card?.pciid]);

  return (
    <ClusterFrame reload={() => { inv.reload(); profiles.reload(); }}>
      {() => (
        <LoadState value={inv} retry={inv.reload}>
          {() => cards.length === 0 ? <div className="empty"><p>{t('ac.noVgpu')}</p></div> : (
            <>
              <div className="toolbar">
                <label className="check-inline"><span>{t('ac.card')}</span>
                  <select value={pick} onChange={(e) => setPick(e.target.value)}>
                    {cards.map((d) => <option key={`${d.node}/${d.pciid}`} value={`${d.node}/${d.pciid}`}>{d.model} · {d.node} · {d.pciid}</option>)}
                  </select>
                </label>
              </div>
              <LoadState value={profiles} retry={profiles.reload}>
                {(ps) => (
                  <div className="table-scroll">
                    <table className="table compact-head">
                      <thead><tr><th>{t('ac.profile')}</th><th>{t('ac.framebuffer')}</th><th>{t('ac.heads')}</th>
                        <th>{t('ac.resolution')}</th><th className="num">{t('ac.maxInst')}</th><th>{t('ac.available')}</th></tr></thead>
                      <tbody>
                        {ps.map((p) => (
                          <tr key={p.type}>
                            <td><span className="strong">{p.name}</span><br /><code className="code">{p.type}</code></td>
                            <td className="nowrap">{p.framebuffer_mb ? `${p.framebuffer_mb >= 1024 ? `${p.framebuffer_mb / 1024} GB` : `${p.framebuffer_mb} MB`}` : '-'}</td>
                            <td className="num">{p.heads ?? '-'}</td>
                            <td className="nowrap small">{p.max_resolution || '-'}</td>
                            <td className="num">{p.max_instance ?? '-'}</td>
                            <td>{p.max_instance ? <Meter value={(p.available / p.max_instance) * 100} label={`${p.available}`} /> : p.available}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </LoadState>
              <p className="muted small">{t('ac.profileNote')}</p>
              <p className="muted small">{t('ac.licenseNote')}</p>
            </>
          )}
        </LoadState>
      )}
    </ClusterFrame>
  );
}

// --- 리소스 매핑 ------------------------------------------------------------------

export function MappingsPage() {
  const { t } = useI18n();
  const { inv } = useInventory();
  return (
    <ClusterFrame reload={inv.reload}>
      {() => (
        <LoadState value={inv} retry={inv.reload}>
          {(r) => (
            <>
              {!r.mappings_readable && <div className="alert small">{t('ac.mapUnreadable')}</div>}
              {r.mappings.length === 0 ? <div className="empty"><p>{t('ac.noMappings')}</p></div> : (
                <div className="table-scroll">
                  <table className="table compact-head">
                    <thead><tr><th>{t('ac.mapId')}</th><th>vGPU</th><th>{t('ac.devices')}</th><th>{t('ac.usedBy')}</th><th>{t('ac.pools')}</th></tr></thead>
                    <tbody>
                      {r.mappings.map((m) => (
                        <tr key={m.id}>
                          <td><span className="strong">{m.id}</span>{m.description && <><br /><span className="muted small">{m.description}</span></>}</td>
                          <td>{m.mdev ? <span className="chip chip-accent">vGPU</span> : <span className="muted small">-</span>}</td>
                          <td className="small">{m.devices.map((x) => {
                            const dev = r.devices.find((d) => d.node === x.node && d.pciid === x.path);
                            return <div key={`${x.node}${x.path}`} className="nowrap">{x.node} · <code className="code">{x.path}</code>{dev ? <span className="muted"> {dev.model}</span> : null}</div>;
                          })}</td>
                          <td><Users list={m.used_by} /></td>
                          <td className="small">{m.pools.length ? m.pools.join(', ') : <span className="muted">-</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="callout"><Icon name="info" size={18} /><p>{t('ac.mapHow')}</p></div>
            </>
          )}
        </LoadState>
      )}
    </ClusterFrame>
  );
}
