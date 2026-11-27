import { useCallback, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { Pool, Template } from '../../api/types';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { ClusterFrame, useCluster } from './ClusterPages';
import { CloneDialog } from './PoolDetailPage';

type Notice = { kind: 'info' | 'error'; text: string };

export { VmTablePage as VmDesktopsPage } from './VmTable';

// 가상머신 > 템플릿 관리: the cluster's templates, whether linked clones work from each,
// how many pools were cloned from it, and "clone into a pool" from here.
export function TemplatesPage() {
  const { current } = useCluster();
  const templates = useLoad(useCallback(() => (current ? adminApi.templates(current.id, true) : Promise.resolve([])), [current?.id]),
    [current?.id]);
  const pools = useLoad(adminApi.pools);
  return (
    <ClusterFrame reload={templates.reload}>
      {(c) => (
        <LoadState value={templates} retry={templates.reload}>
          {(list) => <TemplateTable list={list} pools={pools.state === 'ok' ? pools.data.filter((p) => p.cluster_id === c.id) : []}
            onCloned={templates.reload} />}
        </LoadState>
      )}
    </ClusterFrame>
  );
}

function TemplateTable({ list, pools, onCloned }: { list: Template[]; pools: Pool[]; onCloned: () => void }) {
  const { t } = useI18n();
  const [cloning, setCloning] = useState<Template | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const linked = (v: boolean | null | undefined) => v === true
    ? <span className="status st-ready"><span className="dot" />{t('tpl.linkedYes')}</span>
    : v === false ? <span className="muted small">{t('tpl.linkedNo')}</span>
      : <span className="muted small">{t('tpl.linkedUnknown')}</span>;

  if (list.length === 0) return <div className="empty"><p>{t('tpl.empty')}</p></div>;
  return (
    <>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      {pools.length === 0 && <div className="alert small">{t('tpl.noPools')}</div>}
      <div className="table-scroll">
        <table className="table compact-head">
          <thead>
            <tr><th>{t('tpl.name')}</th><th>{t('desk.node')}</th><th>{t('tpl.spec')}</th><th>{t('tpl.disks')}</th>
              <th>{t('tpl.linked')}</th><th className="num">{t('tpl.pools')}</th><th /></tr>
          </thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.vmid}>
                <td className="nowrap"><span className="strong">{x.name}</span><br /><span className="muted small">VMID {x.vmid} · {x.type.toUpperCase()}</span></td>
                <td>{x.node}</td>
                <td className="small nowrap">
                  {[x.spec.cpu && `${x.spec.cpu} vCPU`, x.spec.memory_gb && `${x.spec.memory_gb} GB`, x.spec.disk_gb && `${x.spec.disk_gb} GB disk`]
                    .filter(Boolean).join(' · ') || '-'}
                </td>
                <td className="small">
                  {x.disks === null ? <span className="muted">-</span> : (x.disks ?? []).map((d) => (
                    <div key={d.key} className="nowrap"><code className="code">{d.key}</code> {d.storage}{d.plugin && <span className="muted"> ({d.plugin})</span>}</div>
                  ))}
                </td>
                <td className="nowrap">{linked(x.linked_clone)}</td>
                <td className="num">{x.pools ?? 0}</td>
                <td className="nowrap">
                  <button type="button" className="btn small-btn" disabled={pools.length === 0} onClick={() => setCloning(x)}>{t('tpl.clone')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t('tpl.note')}</p>
      {cloning && (
        <CloneDialog pools={pools} templateVmid={cloning.vmid} defaultFull={cloning.linked_clone === false} onClose={() => setCloning(null)}
          onDone={(n) => { setCloning(null); setNotice(n); onCloned(); }} />
      )}
    </>
  );
}
