import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { nextApi, type Grant } from '../../api/next';
import type { AdminDesktop, Cluster, Pool, PoolPolicy, PoolType } from '../../api/types';
import { HowTo } from '../../components/HowTo';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { PageActions } from '../../components/PageHead';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import { PoolEditDialog } from './PoolEdit';
import { CreatePoolDialog, POOL_TYPES } from './PoolsPage';
import { Caret, Drop, Pager } from './TableKit';

// 데스크톱 풀 > 풀: every pool as one table - how users get in (route, protocols), how many desktops it has,
// who it is granted to - with its desktops unfolding inline; the name opens the pool page.

type Notice = { kind: 'info' | 'error'; text: string };
type Extra = { policy: Record<string, PoolPolicy | null>; grants: Record<string, Grant[] | null> };
type Inv = { pools: Pool[]; desks: AdminDesktop[]; clusters: Cluster[] } & Extra;

async function load(): Promise<Inv> {
  const [pools, desks, clusters] = await Promise.all([adminApi.pools(), adminApi.desktops().catch(() => [] as AdminDesktop[]), adminApi.clusters()]);
  const policy: Extra['policy'] = {};
  const grants: Extra['grants'] = {};
  await Promise.all(pools.map(async (p) => {
    const [pol, gr] = await Promise.all([
      adminApi.poolPolicy(p.id).then((r) => r.policy).catch(() => p.settings?.policy ?? null),
      nextApi.poolGrants(p.id).then((r) => r.grants).catch(() => null),
    ]);
    policy[p.id] = pol; grants[p.id] = gr;
  }));
  return { pools, desks, clusters, policy, grants };
}

const on = (d: AdminDesktop) => d.state === 'ready' || d.state === 'in_use';

export function PoolTablePage() {
  const { t, pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const inv = useLoad(load);
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | PoolType>('');
  const [state, setState] = useState<'' | 'on' | 'off'>('');
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Pool | null>(null);
  const size = 20;

  const all = inv.state === 'ok' ? inv.data.pools : [];
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return all.filter((p) => (!type || p.type === type) && (!state || (state === 'on' ? p.enabled : !p.enabled))
      && (!n || p.name.toLowerCase().includes(n) || p.description.toLowerCase().includes(n)));
  }, [all, q, type, state]);
  useEffect(() => { setPage(0); }, [q, type, state]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * size, cur * size + size);
  const chosen = rows.filter((p) => picked.has(p.id));
  const pageAll = shown.length > 0 && shown.every((p) => picked.has(p.id));
  const flip = (set: (f: (s: Set<string>) => Set<string>) => void, id: string) =>
    set((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function each(list: Pool[], what: string, fn: (p: Pool) => Promise<unknown>) {
    setBusy(true); setNotice(null);
    const failed: string[] = [];
    for (const p of list) { try { await fn(p); } catch (e) { failed.push(`${p.name}: ${(e as Error).message}`); } }
    setBusy(false);
    setNotice(failed.length ? { kind: 'error', text: L(`${what}: ${failed.length}개 실패 - ${failed.join('; ')}`, `${what}: ${failed.length} failed - ${failed.join('; ')}`) }
      : { kind: 'info', text: (list.length === 1 ? `${list[0].name}: ` : L(`풀 ${list.length}개 `, `${list.length} pools: `)) + what + L(' 완료했습니다.', ' done.') });
    setPicked(new Set());
    inv.reload();
  }
  function setEnabled(list: Pool[], enabled: boolean) {
    const go = list.filter((p) => p.enabled !== enabled);
    if (!go.length) return;
    const who = go.length === 1 ? `'${go[0].name}'` : L(`풀 ${go.length}개`, `${go.length} pools`);
    if (!window.confirm(enabled ? L(`${who}을(를) 사용하도록 바꿀까요?`, `Enable ${who}?`)
      : L(`${who}을(를) 중지할까요? 사용자 포털에서 안 보이고 새 접속이 막힙니다.`, `Disable ${who}? It leaves the portal and takes no new connections.`))) return;
    void each(go, enabled ? L('사용', 'Enable') : L('중지', 'Disable'), (p) => adminApi.updatePool(p.id, { enabled }));
  }
  function remove(list: Pool[]) {
    const full = list.filter((p) => p.desktops > 0);
    if (full.length) {
      window.alert(L(`데스크톱이 남은 풀은 지울 수 없습니다: ${full.map((p) => `${p.name} (${p.desktops}대)`).join(', ')}\n먼저 데스크톱을 풀에서 빼거나 VM을 지우세요.`,
        `Pools with desktops cannot be deleted: ${full.map((p) => `${p.name} (${p.desktops})`).join(', ')}\nTake the desktops out or delete the VMs first.`));
      return;
    }
    const who = list.length === 1 ? `'${list[0].name}'` : L(`풀 ${list.length}개`, `${list.length} pools`);
    if (!window.confirm(L(`${who}을(를) 지울까요? 정책과 권한 설정도 함께 지워집니다.`, `Delete ${who}? Its policy and grants go too.`))) return;
    void each(list, L('삭제', 'Delete'), (p) => adminApi.deletePool(p.id));
  }

  const routeLabel = (pol: PoolPolicy | null | undefined) => (!pol ? '-' : (pol.rdp_route ?? 'record') === 'devices' ? L('장치 연결', 'Devices') : L('게이트웨이', 'Gateway'));
  const protoLabel = (x: string) => (x === 'vnc' ? L('브라우저', 'Browser') : x.toUpperCase());
  const grantText = (g: Grant[] | null | undefined) => {
    if (!g) return '-';
    if (!g.length) return L('없음', 'Nobody');
    const n = (k: Grant['subject_type']) => g.filter((x) => x.subject_type === k).length;
    return [n('user') && L(`사용자 ${n('user')}`, `${n('user')} users`), n('department') && L(`부서 ${n('department')}`, `${n('department')} depts`),
      n('group') && L(`그룹 ${n('group')}`, `${n('group')} groups`)].filter(Boolean).join(' · ');
  };

  return (
    <>
      <PageActions>
        <button type="button" className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />{L('풀 만들기', 'New pool')}</button>
      </PageActions>
      <div className="vt-bar">
        <div className="vt-row">
          <input className="vt-name vt-search" type="search" placeholder={L('풀 이름 · 설명 검색', 'Search name · description')} aria-label={L('풀 검색', 'Search pools')} value={draft}
            onChange={(e) => { setDraft(e.target.value); setQ(e.target.value); }} />
          <select value={type} onChange={(e) => setType(e.target.value as '' | PoolType)} aria-label={L('풀 종류', 'Pool type')}>
            <option value="">{L('종류 전체', 'All types')}</option>
            {POOL_TYPES.map((x) => <option key={x} value={x}>{t(`pooltype.${x}` as MessageKey)}</option>)}
          </select>
          <select value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label={L('상태', 'Status')}>
            <option value="">{L('상태 전체', 'All states')}</option>
            <option value="on">{L('사용', 'Enabled')}</option>
            <option value="off">{L('중지', 'Disabled')}</option>
          </select>
          <button type="button" className="btn vt-icon-btn" onClick={inv.reload} title={L('새로 고침', 'Refresh')} aria-label={L('새로 고침', 'Refresh')}><Icon name="refresh" size={16} /></button>
          <HowTo>
            <ul>
              <li>{L('▸를 누르면 풀의 데스크톱이 펼쳐집니다. 이름을 누르면 풀 페이지로 갑니다.', '▸ unfolds the desktops; the name opens the pool page.')}</li>
              <li>{L('접속 경로: 게이트웨이는 보안 게이트웨이를 거쳐 녹화, 장치 연결은 USB · 드라이브를 넘기고 녹화하지 않습니다.',
                'Route: Gateway goes through the security gateway and is recorded; Devices passes USB and drives, unrecorded.')}</li>
              <li>{L('사용 · 중지 · 삭제는 행의 더보기나, 여러 개를 골라 위에 나오는 막대에서 합니다.', 'Enable, disable and delete: the More menu on a row, or pick several and use the bar that appears.')}</li>
              <li>{L('데스크톱이 남은 풀은 지울 수 없습니다.', 'A pool with desktops cannot be deleted.')}</li>
            </ul>
          </HowTo>
        </div>
        {chosen.length > 0 && (
          <div className="vt-row vt-selbar" role="region" aria-label={L('선택한 풀', 'Selected pools')}>
            <span className="vt-count on">{L(`${chosen.length}개 선택`, `${chosen.length} selected`)}</span>
            <button type="button" className="btn small-btn" disabled={busy} onClick={() => setEnabled(chosen, true)}>{L('사용', 'Enable')}</button>
            <button type="button" className="btn small-btn" disabled={busy} onClick={() => setEnabled(chosen, false)}>{L('중지', 'Disable')}</button>
            <button type="button" className="btn small-btn danger" disabled={busy} onClick={() => remove(chosen)}>{L('삭제', 'Delete')}</button>
            <button type="button" className="btn-ghost small-btn" onClick={() => setPicked(new Set())}>{L('선택 해제', 'Clear')}</button>
          </div>
        )}
      </div>
      {notice && <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role="status">{notice.text}</div>}

      <LoadState value={inv} retry={inv.reload}>
        {(d) => rows.length === 0 ? <div className="empty"><p>{all.length ? L('조건에 맞는 풀이 없습니다.', 'No pool matches.') : t('pool.empty')}</p></div> : (
          <>
            <div className="table-scroll">
              <table className="table vt-table pt-table">
                <thead>
                  <tr>
                    <th className="vt-check"><input type="checkbox" aria-label={L('이 페이지 전체', 'This page')} checked={pageAll}
                      onChange={() => setPicked((s) => { const n = new Set(s); shown.forEach((p) => (pageAll ? n.delete(p.id) : n.add(p.id))); return n; })} /></th>
                    <th className="pt-exp" aria-label={L('펼치기', 'Expand')} />
                    <th>{L('풀', 'Pool')}</th><th>{L('종류', 'Type')}</th><th>{L('접속 경로', 'Route')}</th><th>{L('접속 방식', 'Protocols')}</th>
                    <th>{L('데스크톱', 'Desktops')}</th><th>{L('대상', 'Granted to')}</th><th className="vt-center">{L('상태', 'Status')}</th>
                    <th>{L('설명', 'Description')}</th><th className="vt-actions-h">{L('작업', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const desks = d.desks.filter((x) => x.pool_id === p.id);
                    const running = desks.filter(on).length;
                    const pol = d.policy[p.id];
                    const isOpen = open.has(p.id);
                    return (
                      <Fragment key={p.id}>
                        <tr className={`${picked.has(p.id) ? 'vt-picked' : ''}${p.enabled ? '' : ' vt-off'}`}>
                          <td className="vt-check"><input type="checkbox" aria-label={p.name} checked={picked.has(p.id)} onChange={() => flip(setPicked, p.id)} /></td>
                          <td className="pt-exp"><button type="button" className={`pt-chev${isOpen ? ' open' : ''}`} aria-expanded={isOpen}
                            aria-label={isOpen ? L('접기', 'Collapse') : L('데스크톱 펼치기', 'Show desktops')} onClick={() => flip(setOpen, p.id)}><Icon name="chevron" size={14} /></button></td>
                          <td className="nowrap"><span className={`pt-dot pt-${p.type}`} aria-hidden="true" /><Link className="strong" to={`/admin/pools/list/${p.id}`}>{p.name}</Link>
                            {d.clusters.length > 1 && <span className="muted small"> · {d.clusters.find((c) => c.id === p.cluster_id)?.name ?? p.cluster_id}</span>}</td>
                          <td className="nowrap"><span className={`pt-type pt-${p.type}`}>{t(`pooltype.${p.type}` as MessageKey)}</span></td>
                          <td className="nowrap small">{routeLabel(pol)}</td>
                          <td className="nowrap">{pol?.protocols?.length ? pol.protocols.map((x) => <span key={x} className="pt-proto">{protoLabel(x)}</span>) : <span className="muted">-</span>}</td>
                          <td className="nowrap pt-counts">
                            <span title={L('전체', 'Total')}><b>{p.desktops}</b></span>
                            <span className="muted small"> / {L('배정', 'assigned')} {p.assigned} / {L('실행', 'running')} {running}</span>
                          </td>
                          <td className="nowrap small">{grantText(d.grants[p.id])}</td>
                          <td className="vt-center">
                            <span className={`st-badge ${p.enabled ? 'st-ok' : 'st-neutral'}`}>{p.enabled ? L('사용', 'Enabled') : L('중지', 'Disabled')}</span>
                          </td>
                          <td className="pt-desc small" title={p.description}>{p.description || <span className="muted">-</span>}</td>
                          <td className="vt-actions">
                            <button type="button" className="vt-link" onClick={() => setEditing(p)}>{L('편집', 'Edit')}</button>
                            <Drop className="vt-more" label={<>{L('더보기', 'More')}<Caret /></>}>
                              {(close) => (
                                <>
                                  <Link role="menuitem" to={`/admin/pools/list/${p.id}`} onClick={close}>{L('풀 페이지 열기', 'Open the pool')}</Link>
                                  <button type="button" role="menuitem" onClick={() => { close(); setEnabled([p], !p.enabled); }}>{p.enabled ? L('중지', 'Disable') : L('사용', 'Enable')}</button>
                                  <hr className="vt-sep" />
                                  <button type="button" role="menuitem" className="danger" onClick={() => { close(); remove([p]); }}>{L('삭제', 'Delete')}</button>
                                </>
                              )}
                            </Drop>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="pt-sub-row">
                            <td colSpan={11}>
                              {desks.length === 0 ? <p className="muted small pt-sub-empty">{L('데스크톱이 없습니다.', 'No desktops.')}</p> : (
                                <table className="pt-sub">
                                  <thead><tr><th>{L('데스크톱', 'Desktop')}</th><th>{L('상태', 'State')}</th><th>{L('노드', 'Node')}</th><th>{L('사용자', 'User')}</th><th /></tr></thead>
                                  <tbody>
                                    {desks.map((x) => (
                                      <tr key={x.id}>
                                        <td className="nowrap"><span className="vt-vm-id">{x.vmid}</span> {x.name}</td>
                                        <td><DeskChip d={x} /></td>
                                        <td>{x.node}</td>
                                        <td>{x.assigned_user ?? <span className="muted">-</span>}</td>
                                        <td className="vt-actions">{x.state !== 'missing'
                                          ? <Link className="vt-link" to={`/admin/vms/desktops/list?vm=${encodeURIComponent(x.id)}`}>{L('관리', 'Manage')}</Link>
                                          : <Link className="vt-link" to={`/admin/pools/list/${p.id}`}>{L('정리하러 가기', 'Clean up')}</Link>}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="vt-pager">
              <span className="muted small">{L(`총 ${rows.length}개`, `${rows.length} total`)}{rows.length !== all.length ? L(` (전체 ${all.length}개)`, ` (of ${all.length})`) : ''}</span>
              <span className="vt-size" />
              <Pager page={cur} pages={pages} onPage={setPage} />
            </div>
          </>
        )}
      </LoadState>

      {creating && <CreatePoolDialog clusters={inv.state === 'ok' ? inv.data.clusters : []} onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); inv.reload(); setNotice({ kind: 'info', text: L('풀을 만들었습니다.', 'Pool created.') }); }} />}
      {editing && <PoolEditDialog pool={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); inv.reload(); }} />}
    </>
  );
}

export function DeskChip({ d }: { d: AdminDesktop }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const map: Record<string, [string, string]> = {
    ready: ['running', L('실행 중', 'Running')], in_use: ['in_use', L('사용 중', 'In use')], stopped: ['stopped', L('꺼짐', 'Stopped')],
    provisioning: ['provisioning', L('준비 중', 'Preparing')], error: ['error', L('오류', 'Error')], missing: ['missing', L('삭제됨', 'Deleted')],
  };
  const [cls, label] = map[d.state] ?? ['unknown', d.state];
  return <span className={`vt-st vt-st-${cls}`}>{label}</span>;
}
