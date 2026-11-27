import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { desktplApi, type DeskBuild } from '../../api/desktpl';
import { nextApi, type GoldenImage, type RolloutResult } from '../../api/next';
import { opsApi } from '../../api/ops';
import type { Cluster, Pool, Template } from '../../api/types';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { OsLogo, osLogoKey } from '../../components/OsLogo';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { AddGoldenDialog, DeployDialog, RolloutDialog, VersionDialog } from './NextPages';
import { CloneDialog } from './PoolDetailPage';
import { Caret, Drop, Pager } from './TableKit';
import { osName } from './VmDetail';

// 가상머신 > 이미지 > 템플릿: the images desktops are made from, as ordinary VDI sees them - golden images
// (a VM kept for editing, published as versions, rolled out to pools) and Proxmox templates (cloned linked or
// full). One table, a page per template; the ready-made starters live under 기본 제공.

type Kind = 'golden' | 'pve';
type Row = {
  key: string; kind: Kind; name: string; clusterId: string; cluster: string; vmid: number; node: string; os: string;
  versions: number; version: string; updated: number | null; spec: string; seal: '' | 'sysprep' | 'cloud-init';
  pools: string[]; desktops: number | null; outdated: number; linked: boolean | null | undefined;
  golden?: GoldenImage; tpl?: Template;
};
type Inv = { rows: Row[]; pools: Pool[]; clusters: Cluster[] };
type Notice = { kind: 'info' | 'error'; text: string };

const verLabel = (g: GoldenImage, name: string) => {
  const list = g.versions ?? [];
  const i = list.findIndex((v) => v.name === name);
  return i < 0 ? name : `v${list.length - i}`;
};

async function load(): Promise<Inv> {
  const [clusters, golden, pools, builds] = await Promise.all([
    adminApi.clusters(), nextApi.goldenImages(), adminApi.pools(),
    desktplApi.list().then((r) => r.builds).catch(() => [] as DeskBuild[]),
  ]);
  const sealOf = (match: (b: DeskBuild) => boolean): Row['seal'] => {
    const b = builds.find((x) => x.status === 'completed' && match(x));
    return !b ? '' : b.preset === 'office' ? 'sysprep' : 'cloud-init';
  };
  const cname = (id: string) => clusters.find((c) => c.id === id)?.name ?? id;
  const rows: Row[] = golden.map((g) => {
    const latest = g.versions?.[0];
    return {
      key: `g:${g.id}`, kind: 'golden', name: g.name, clusterId: g.cluster_id, cluster: cname(g.cluster_id), vmid: g.vmid, node: g.node,
      os: g.ostype ?? '', versions: g.versions?.length ?? 0, version: g.current_version ? verLabel(g, g.current_version) : '',
      updated: latest?.time ?? null, spec: '', seal: sealOf((b) => b.result.golden_id === g.id),
      pools: g.pools, desktops: g.rollout ? g.rollout.reduce((n, r) => n + r.total, 0) : null,
      outdated: g.rollout ? g.rollout.reduce((n, r) => n + r.outdated, 0) : 0, linked: false, golden: g,
    };
  });
  await Promise.all(clusters.filter((c) => c.connected).map(async (c) => {
    const list = await adminApi.templates(c.id, true).catch(() => [] as Template[]);
    for (const t of list) {
      const using = pools.filter((p) => p.cluster_id === c.id && p.settings?.templates?.includes(t.vmid));
      rows.push({
        key: `t:${c.id}:${t.vmid}`, kind: 'pve', name: t.name, clusterId: c.id, cluster: c.name, vmid: t.vmid, node: t.node,
        os: t.ostype ?? '', versions: 0, version: '', updated: null,
        spec: [t.spec.cpu && `${t.spec.cpu} vCPU`, t.spec.memory_gb && `${t.spec.memory_gb} GB`, t.spec.disk_gb && `${t.spec.disk_gb} GB`].filter(Boolean).join(' · '),
        seal: sealOf((b) => b.result.template_vmid === t.vmid || (b.result.vmid === t.vmid && b.cluster_id === c.id)),
        pools: using.map((p) => p.name), desktops: using.length ? using.reduce((n, p) => n + p.desktops, 0) : (t.pools ? null : 0),
        outdated: 0, linked: t.linked_clone, tpl: t,
      });
    }
  }));
  return { rows: rows.sort((a, b) => a.name.localeCompare(b.name)), pools, clusters };
}

function when(sec: number | null, lang: string) {
  return sec ? new Date(sec * 1000).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US') : '-';
}

export function TemplateHubPage() {
  const [params, setParams] = useSearchParams();
  const open = params.get('tpl');
  const inv = useLoad(load);
  const go = (key: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (key) n.set('tpl', key); else n.delete('tpl'); return n; });
  return (
    <LoadState value={inv} retry={inv.reload}>
      {(d) => {
        const row = open ? d.rows.find((r) => r.key === open) : undefined;
        return open && row ? <TemplateDetail row={row} inv={d} onBack={() => go(null)} reload={inv.reload} />
          : <TemplateList inv={d} reload={inv.reload} onOpen={go} />;
      }}
    </LoadState>
  );
}

// the dialogs a row or the detail page opens, in one place
function useActions(inv: Inv, reload: () => void, setNotice: (n: Notice | null) => void) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [dlg, setDlg] = useState<null | { t: 'add' } | { t: 'version' | 'deploy'; g: GoldenImage } | { t: 'clone'; r: Row }
    | { t: 'roll'; g: GoldenImage; pool_id: string; pool: string; outdated: number }>(null);
  const close = () => setDlg(null);
  const rolled = (r: RolloutResult) => {
    close(); reload();
    setNotice({ kind: r.failed ? 'error' : 'info', text: L(`${r.replaced.length}대를 새 버전으로 바꿨습니다.`, `Replaced ${r.replaced.length}.`)
      + (r.skipped.length ? L(` 사용 중이라 건너뜀 ${r.skipped.length}대: ${r.skipped.join(', ')}`, ` Skipped ${r.skipped.length} in use: ${r.skipped.join(', ')}`) : '')
      + (r.failed ? L(` 실패: ${r.failed.name} (${r.failed.error})`, ` Failed: ${r.failed.name} (${r.failed.error})`) : '') });
  };
  const view = !dlg ? null
    : dlg.t === 'add' ? <AddGoldenDialog onClose={close} onDone={() => { close(); reload(); setNotice({ kind: 'info', text: L('템플릿으로 등록했습니다. 고친 뒤 버전을 발행하세요.', 'Registered. Edit it, then publish a version.') }); }} />
    : dlg.t === 'version' ? <VersionDialog image={dlg.g} onClose={close} onDone={(v) => { close(); reload(); setNotice({ kind: 'info', text: L(`새 버전을 발행했습니다 (${v}).`, `Published ${v}.`) }); }} />
    : dlg.t === 'deploy' ? <DeployDialog image={dlg.g} onClose={close} onDone={(n) => { close(); reload(); setNotice({ kind: 'info', text: L(`데스크톱 ${n}대를 만들고 있습니다.`, `Making ${n} desktops.`) }); }} />
    : dlg.t === 'roll' ? <RolloutDialog target={{ image: dlg.g, pool_id: dlg.pool_id, pool: dlg.pool, outdated: dlg.outdated }} onClose={close} onDone={rolled} />
    : dlg.t === 'clone' ? <CloneDialog pools={inv.pools.filter((p) => p.cluster_id === dlg.r.clusterId)} templateVmid={dlg.r.vmid} defaultFull={dlg.r.linked === false}
      onClose={close} onDone={(n) => { close(); reload(); setNotice(n); }} /> : null;
  return { open: setDlg, view };
}

function TemplateList({ inv, reload, onOpen }: { inv: Inv; reload: () => void; onOpen: (key: string) => void }) {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'' | Kind>('');
  const [cluster, setCluster] = useState('');
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const act = useActions(inv, reload, setNotice);
  const size = 20;

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return inv.rows.filter((r) => (!kind || r.kind === kind) && (!cluster || r.clusterId === cluster)
      && (!n || r.name.toLowerCase().includes(n) || String(r.vmid).startsWith(n) || r.pools.some((p) => p.toLowerCase().includes(n))));
  }, [inv, q, kind, cluster]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * size, cur * size + size);
  const golden = inv.rows.filter((r) => r.kind === 'golden');
  const behind = golden.reduce((n, r) => n + r.outdated, 0);

  return (
    <>
      <ol className="th-flow" aria-label={L('템플릿 흐름', 'Template flow')}>
        <li><span className="th-step th-t1">1</span><div><b>{L('소스 VM 준비', 'Prepare a source VM')}</b>
          <span>{L('VM 만들기 · 기본 제공에서 빌드', 'Make a VM or build a starter')}</span></div></li>
        <li><span className="th-step th-t2">2</span><div><b>{L('봉인', 'Seal')}</b><span>{L('Windows sysprep · Linux cloud-init', 'Windows sysprep · Linux cloud-init')}</span></div></li>
        <li><span className="th-step th-t3">3</span><div><b>{L('버전 발행', 'Publish a version')}</b><span>{L('예전 버전은 남고 되돌릴 수 있음', 'Earlier versions stay')}</span></div></li>
        <li><span className="th-step th-t4">4</span><div><b>{L('풀에 적용', 'Apply to pools')}</b>
          <span>{behind ? L(`예전 버전 데스크톱 ${behind}대`, `${behind} desktops behind`) : L('데스크톱 만들기 · 새 버전 적용', 'Make desktops · roll out')}</span></div></li>
      </ol>

      <div className="vt-bar">
        <div className="vt-row">
          <input className="vt-name" type="search" placeholder={L('이름 · VMID · 풀', 'Name · VMID · pool')} aria-label={L('검색', 'Search')} value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          <select value={kind} onChange={(e) => { setKind(e.target.value as '' | Kind); setPage(0); }} aria-label={L('종류', 'Kind')}>
            <option value="">{L('종류 전체', 'All kinds')}</option>
            <option value="golden">{L('골든 이미지', 'Golden image')}</option>
            <option value="pve">{L('PVE 템플릿', 'PVE template')}</option>
          </select>
          {inv.clusters.length > 1 && (
            <select value={cluster} onChange={(e) => { setCluster(e.target.value); setPage(0); }} aria-label={L('클러스터', 'Cluster')}>
              <option value="">{L('클러스터 전체', 'All clusters')}</option>
              {inv.clusters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button type="button" className="btn" onClick={reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
          <button type="button" className="btn primary vt-create" onClick={() => act.open({ t: 'add' })}><Icon name="plus" size={16} />{L('VM에서 템플릿 등록', 'Register from a VM')}</button>
        </div>
        <div className="vt-row">
          <span className="vt-count">{L(`골든 이미지 ${golden.length} · PVE 템플릿 ${inv.rows.length - golden.length}`, `${golden.length} golden · ${inv.rows.length - golden.length} PVE`)}</span>
          <HowTo>
            <ul>
              <li>{L('골든 이미지는 평소처럼 켜서 고치고, 버전 발행으로 스냅샷을 남깁니다. 데스크톱은 그 버전의 전체 복제입니다.',
                'Edit a golden image as a normal VM; publishing a version snapshots it. Desktops are full clones of that version.')}</li>
              <li>{L('PVE 템플릿은 버전이 없고, 공유 · 스냅샷 스토리지면 연결 복제가 됩니다.', 'PVE templates have no versions; on shared snapshot storage they allow linked clones.')}</li>
              <li>{L('봉인은 VM 안에서 합니다(sysprep /generalize, cloud-init clean). 봉인 열은 기본 제공 빌드로 만든 것만 압니다.',
                'Sealing happens inside the VM (sysprep /generalize, cloud-init clean). The seal column only knows images built from a starter.')}</li>
              <li>{L('새 버전 적용은 접속 중이 아닌 데스크톱만, 한 번에 20대씩 바꿉니다.', 'Roll-out replaces desktops not in use, 20 per run.')}</li>
            </ul>
          </HowTo>
        </div>
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}

      {rows.length === 0 ? <div className="empty"><p>{inv.rows.length ? L('조건에 맞는 템플릿이 없습니다.', 'Nothing matches.') : L('템플릿이 없습니다. VM에서 등록하거나 기본 제공에서 빌드하세요.', 'No templates yet. Register a VM or build a starter.')}</p></div> : (
        <>
          <div className="table-scroll">
            <table className="table vt-table">
              <thead>
                <tr>
                  <th>{L('이름', 'Name')}</th><th>OS</th><th>{L('버전', 'Version')}</th><th>{L('사양', 'Spec')}</th><th>{L('봉인', 'Sealed')}</th>
                  <th>{L('사용 중인 풀', 'Pools')}</th><th className="num">{L('데스크톱', 'Desktops')}</th><th>{L('최근 갱신', 'Updated')}</th>
                  <th className="vt-actions-h">{L('작업', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key}>
                    <td className="th-name">
                      <OsLogo os={osLogoKey(r.os === 'l26' ? 'linux' : r.os, r.name)} size={26} />
                      <span>
                        <button type="button" className="vt-name-link strong" onClick={() => onOpen(r.key)}>{r.name}</button>
                        <span className="th-sub">
                          <span className={`th-kind th-kind-${r.kind}`}>{r.kind === 'golden' ? L('골든 이미지', 'Golden') : L('PVE 템플릿', 'PVE template')}</span>
                          <span className="muted small">VMID {r.vmid}{inv.clusters.length > 1 ? ` · ${r.cluster}` : ''}</span>
                        </span>
                      </span>
                    </td>
                    <td className="nowrap">{r.os ? osName(r.os) : <span className="muted">-</span>}</td>
                    <td className="nowrap">{r.kind === 'golden'
                      ? (r.version ? <><span className="th-ver">{r.version}</span><span className="muted small"> / {r.versions}</span></> : <span className="vt-st vt-st-offline">{L('발행 전', 'None yet')}</span>)
                      : <span className="muted small">{r.linked ? L('연결 복제 가능', 'Linked clones') : r.linked === false ? L('전체 복제만', 'Full only') : '-'}</span>}</td>
                    <td className="nowrap small">{r.spec || <span className="muted">-</span>}</td>
                    <td className="nowrap">{r.seal ? <span className="vt-st vt-st-running">{r.seal}</span> : <span className="muted small">{L('확인 안 됨', 'Unknown')}</span>}</td>
                    <td className="th-pools">{r.pools.length ? r.pools.join(', ') : <span className="muted">-</span>}</td>
                    <td className="num nowrap">{r.desktops ?? '-'}{r.outdated > 0 && <span className="vt-st vt-st-offline th-behind" title={L('예전 버전', 'On an older version')}>{L(`${r.outdated} 예전`, `${r.outdated} old`)}</span>}</td>
                    <td className="nowrap muted small">{when(r.updated, lang)}</td>
                    <td className="vt-actions">
                      <button type="button" className="vt-link" disabled={r.kind === 'golden' && !r.golden?.current_version}
                        onClick={() => (r.golden ? act.open({ t: 'deploy', g: r.golden }) : act.open({ t: 'clone', r }))}>{L('데스크톱 만들기', 'Make desktops')}</button>
                      <button type="button" className="vt-link" onClick={() => onOpen(r.key)}>{L('상세', 'Details')}</button>
                      <Drop className="vt-more" label={<>{L('더보기', 'More')}<Caret /></>}>
                        {(close) => r.golden ? (
                          <>
                            <button type="button" role="menuitem" onClick={() => { close(); act.open({ t: 'version', g: r.golden! }); }}>{L('새 버전 발행', 'Publish version')}</button>
                            {(r.golden.rollout ?? []).filter((x) => x.outdated > 0).map((x) => (
                              <button key={x.pool_id} type="button" role="menuitem" onClick={() => { close(); act.open({ t: 'roll', g: r.golden!, ...x }); }}>
                                {L(`'${x.pool}'에 새 버전 적용 (${x.outdated})`, `Roll out to '${x.pool}' (${x.outdated})`)}</button>
                            ))}
                            <hr className="vt-sep" />
                            <button type="button" role="menuitem" className="danger" onClick={() => {
                              close();
                              if (!window.confirm(L(`'${r.name}'을(를) 템플릿에서 뺄까요? VM과 버전(스냅샷)은 남습니다.`, `Unregister '${r.name}'? The VM and its versions stay.`))) return;
                              nextApi.deleteGolden(r.golden!.id).then(() => { reload(); setNotice({ kind: 'info', text: L('등록을 해제했습니다.', 'Unregistered.') }); },
                                (e) => setNotice({ kind: 'error', text: (e as Error).message }));
                            }}>{L('등록 해제', 'Unregister')}</button>
                          </>
                        ) : (
                          <p className="vt-menu-note">{L('PVE 템플릿은 버전 · 적용이 없습니다. 버전으로 관리하려면 템플릿이 아닌 VM을 골든 이미지로 등록하세요.',
                            'PVE templates have no versions. Register a normal VM as a golden image to version it.')}</p>
                        )}
                      </Drop>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="vt-pager">
            <span className="muted small">{L(`총 ${rows.length}개`, `${rows.length} total`)}</span>
            <span className="vt-size" />
            <Pager page={cur} pages={pages} onPage={setPage} />
          </div>
        </>
      )}
      {act.view}
    </>
  );
}

type DTab = 'overview' | 'versions' | 'pools' | 'tasks';

function TemplateDetail({ row: r, inv, onBack, reload }: { row: Row; inv: Inv; onBack: () => void; reload: () => void }) {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const [tab, setTab] = useState<DTab>('overview');
  const [notice, setNotice] = useState<Notice | null>(null);
  const act = useActions(inv, reload, setNotice);
  const g = r.golden;
  const usedPools = inv.pools.filter((p) => p.cluster_id === r.clusterId && (g ? (p.settings as { golden_id?: string } | undefined)?.golden_id === g.id || r.pools.includes(p.name) : p.settings?.templates?.includes(r.vmid)));
  const tabs: [DTab, string][] = [['overview', L('개요', 'Overview')], ['versions', L('버전', 'Versions')], ['pools', L('사용 중인 풀', 'Pools')], ['tasks', L('작업', 'Tasks')]];

  async function useVersion(name: string) {
    if (!g) return;
    if (!window.confirm(L(`배포 버전을 ${verLabel(g, name)}(으)로 바꿀까요? 이후 만드는 데스크톱과 새 버전 적용이 이 버전을 씁니다.`,
      `Deploy ${verLabel(g, name)} from now on? New desktops and roll-outs use it.`))) return;
    try { await nextApi.setCurrentVersion(g.id, name); reload(); setNotice({ kind: 'info', text: L(`${verLabel(g, name)}을(를) 배포 버전으로 정했습니다.`, `${verLabel(g, name)} is now deployed.`) }); }
    catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); }
  }

  return (
    <div className="vd">
      <button type="button" className="vd-back" onClick={onBack}><Icon name="chevron" size={14} />{L('템플릿 목록', 'Templates')}</button>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}
      <section className="vd-head">
        <div className="vd-title">
          <OsLogo os={osLogoKey(r.os === 'l26' ? 'linux' : r.os, r.name)} size={38} />
          <h2 className="vd-name">{r.name}</h2>
          <span className={`th-kind th-kind-${r.kind}`}>{r.kind === 'golden' ? L('골든 이미지', 'Golden image') : L('PVE 템플릿', 'PVE template')}</span>
          {g && <span className={`vt-st ${g.status === 'running' ? 'vt-st-in_use' : ''}`}>{g.status === 'running' ? L('켜짐 · 수정 중', 'On · editing') : L('꺼짐', 'Off')}</span>}
          <div className="vd-actions">
            <button type="button" className="btn primary" disabled={!!g && !g.current_version}
              onClick={() => (g ? act.open({ t: 'deploy', g }) : act.open({ t: 'clone', r }))}><Icon name="plus" size={15} />{L('데스크톱 만들기', 'Make desktops')}</button>
            {g && <button type="button" className="btn" onClick={() => act.open({ t: 'version', g })}>{L('새 버전 발행', 'Publish version')}</button>}
          </div>
        </div>
        <dl className="vd-strip">
          <div><dt>VMID</dt><dd className="vd-num">{r.vmid}</dd></div>
          <div><dt>{L('노드', 'Node')}</dt><dd>{r.node || '-'}{inv.clusters.length > 1 ? <span className="muted small"> · {r.cluster}</span> : null}</dd></div>
          <div><dt>OS</dt><dd>{r.os ? osName(r.os) : '-'}</dd></div>
          <div><dt>{L('배포 버전', 'Deployed')}</dt><dd>{g ? (r.version || L('발행 전', 'none')) : L('없음 (PVE 템플릿)', 'n/a')}</dd></div>
          <div><dt>{L('봉인', 'Sealed')}</dt><dd>{r.seal || L('확인 안 됨', 'Unknown')}</dd></div>
          <div><dt>{L('데스크톱', 'Desktops')}</dt><dd className="vd-num">{r.desktops ?? '-'}{r.outdated > 0 && <span className="muted small"> · {L(`${r.outdated}대 예전 버전`, `${r.outdated} behind`)}</span>}</dd></div>
          <div><dt>{L('최근 갱신', 'Updated')}</dt><dd>{when(r.updated, lang)}</dd></div>
        </dl>
      </section>

      <nav className="page-tabs vd-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <a key={id} href="#" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={(e) => { e.preventDefault(); setTab(id); }}>{label}</a>
        ))}
      </nav>

      <div className="vd-body">
        {tab === 'overview' && (
          <div className="vd-grid">
            <section className="vd-card"><header><h3>{L('이미지', 'Image')}</h3></header>
              <dl className="vd-kv">
                <dt>{L('종류', 'Kind')}</dt><dd>{g ? L('골든 이미지 (버전 관리, 전체 복제)', 'Golden image (versions, full clones)') : L('PVE 템플릿', 'PVE template')}</dd>
                <dt>{L('사양', 'Spec')}</dt><dd>{r.spec || '-'}</dd>
                <dt>{L('복제', 'Clones')}</dt><dd>{g ? L('전체 복제', 'Full') : r.linked ? L('연결 · 전체', 'Linked or full') : r.linked === false ? L('전체만', 'Full only') : '-'}</dd>
                {g?.notes && <><dt>{L('메모', 'Notes')}</dt><dd>{g.notes}</dd></>}
              </dl>
            </section>
            <section className="vd-card"><header><h3>{L('다음 할 일', 'Next')}</h3></header>
              <ul className="th-next">
                {g && !g.current_version && <li>{L('VM을 고친 뒤 봉인하고 첫 버전을 발행하세요.', 'Edit and seal the VM, then publish the first version.')}</li>}
                {g && g.status === 'running' && <li>{L('켜져 있습니다. 봉인 뒤 끄고 버전을 발행하세요.', 'It is on. Seal and shut it down before publishing.')}</li>}
                {r.outdated > 0 && <li>{L(`예전 버전 데스크톱 ${r.outdated}대 — 사용 중인 풀 탭에서 새 버전 적용`, `${r.outdated} desktops behind — roll out from the Pools tab`)}</li>}
                {!r.pools.length && <li>{L('아직 쓰는 풀이 없습니다. 데스크톱 만들기로 풀에 넣으세요.', 'No pool uses it yet. Make desktops into a pool.')}</li>}
                {g && g.current_version && r.outdated === 0 && r.pools.length > 0 && g.status !== 'running' && <li>{L('모든 데스크톱이 최신입니다.', 'All desktops are current.')}</li>}
                {!g && <li>{L('버전 관리가 필요하면 원본 VM을 골든 이미지로 등록하세요.', 'For versions, register the source VM as a golden image.')}</li>}
              </ul>
            </section>
          </div>
        )}

        {tab === 'versions' && (
          <section className="vd-card">
            <header><h3>{L('버전', 'Versions')}</h3>{g && <button type="button" className="btn primary small-btn" onClick={() => act.open({ t: 'version', g })}><Icon name="plus" size={14} />{L('새 버전 발행', 'Publish version')}</button>}</header>
            {!g ? <p className="muted small">{L('PVE 템플릿에는 버전이 없습니다.', 'PVE templates have no versions.')}</p>
              : !g.versions?.length ? <p className="muted small">{L('아직 발행한 버전이 없습니다.', 'No version published yet.')}</p> : (
              <table className="table vt-table">
                <thead><tr><th>{L('버전', 'Version')}</th><th>{L('발행', 'Published')}</th><th>{L('설명', 'Description')}</th><th /><th className="vt-actions-h">{L('작업', 'Actions')}</th></tr></thead>
                <tbody>
                  {g.versions.map((v) => (
                    <tr key={v.name}>
                      <td className="nowrap"><span className="th-ver">{verLabel(g, v.name)}</span> <code className="code small">{v.name}</code></td>
                      <td className="nowrap muted small">{v.time ? new Date(v.time * 1000).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
                      <td className="small">{v.description || <span className="muted">-</span>}</td>
                      <td>{v.name === g.current_version && <span className="vt-st vt-st-running">◉ {L('배포 중', 'Deployed')}</span>}</td>
                      <td className="vt-actions">{v.name !== g.current_version && <button type="button" className="vt-link" onClick={() => useVersion(v.name)}>{L('이 버전으로 되돌리기', 'Roll back to this')}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {tab === 'pools' && (
          <section className="vd-card">
            <header><h3>{L('사용 중인 풀', 'Pools')}</h3></header>
            {usedPools.length === 0 && !(g?.rollout?.length) ? <p className="muted small">{L('쓰는 풀이 없습니다.', 'No pool uses it.')}</p> : (
              <table className="table vt-table">
                <thead><tr><th>{L('풀', 'Pool')}</th><th className="num">{L('데스크톱', 'Desktops')}</th>{g && <th>{L('버전 상태', 'Version')}</th>}<th className="vt-actions-h">{L('작업', 'Actions')}</th></tr></thead>
                <tbody>
                  {(g?.rollout?.length ? g.rollout.map((x) => ({ id: x.pool_id, name: x.pool, total: x.total, outdated: x.outdated }))
                    : usedPools.map((p) => ({ id: p.id, name: p.name, total: p.desktops, outdated: 0 }))).map((p) => (
                    <tr key={p.id}>
                      <td><Link to={`/admin/pools/list/${p.id}`}>{p.name}</Link></td>
                      <td className="num">{p.total}</td>
                      {g && <td>{p.outdated ? <span className="vt-st vt-st-offline">{L(`${p.outdated}대 예전 버전`, `${p.outdated} behind`)}</span> : <span className="vt-st vt-st-running">{L('최신', 'Current')}</span>}</td>}
                      <td className="vt-actions">
                        {g && p.outdated > 0 && <button type="button" className="btn primary small-btn" onClick={() => act.open({ t: 'roll', g, pool_id: p.id, pool: p.name, outdated: p.outdated })}>{L('새 버전 적용', 'Roll out')}</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {tab === 'tasks' && <TplTasks vmid={r.vmid} clusterId={r.clusterId} />}
      </div>
      {act.view}
    </div>
  );
}

function TplTasks({ vmid, clusterId }: { vmid: number; clusterId: string }) {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const tasks = useLoad(useCallback(() => opsApi.tasks(200), []));
  return (
    <section className="vd-card">
      <header><h3>{L('최근 작업', 'Recent tasks')}</h3><button type="button" className="vt-link" onClick={tasks.reload}>{L('새로 고침', 'Refresh')}</button></header>
      <LoadState value={tasks} retry={tasks.reload}>
        {(list) => {
          const rows = list.tasks.filter((t) => t.vmid === vmid && t.cluster_id === clusterId).slice(0, 20);
          return rows.length === 0 ? <p className="muted small">{L('이 이미지의 최근 작업이 없습니다. 복제 작업은 새 VM 번호로 남습니다.', 'No recent tasks. Clones are listed under the new VM.')}</p> : (
            <table className="table vt-table">
              <thead><tr><th>{L('시작', 'Started')}</th><th>{L('작업', 'Task')}</th><th>{L('노드', 'Node')}</th><th>{L('사용자', 'User')}</th><th>{L('결과', 'Result')}</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.upid}>
                    <td className="nowrap muted small">{t.starttime ? new Date(t.starttime * 1000).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
                    <td><code className="code">{t.type}</code></td><td>{t.node}</td><td className="small">{t.user}</td>
                    <td>{t.running ? <span className="vt-st vt-st-in_use">{L('진행 중', 'Running')}</span> : <span className={`vt-st ${t.ok ? 'vt-st-running' : 'vt-st-error'}`}>{t.ok ? 'OK' : L('실패', 'Failed')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }}
      </LoadState>
    </section>
  );
}
