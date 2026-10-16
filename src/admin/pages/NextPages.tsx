import { useMemo, useState } from 'react';
import { adminApi } from '../../api/admin';
import { nextApi } from '../../api/next';
import type { Board, BuildJob, CardRow, ClientSettings, Department, ExternalDesktop, Gateway, GatewayKind, GoldenImage, JobStatus, LicenseServer, RolloutResult, Signup, SignupSettings, SignupStatus, UsbCategory, UsbDevice, VerifyMode } from '../../api/next';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { SettingsStatus } from '../../components/SettingsShell';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { useHaRegister } from './OpsPages';
import { TerminalInstallPanel } from './TerminalEnroll';

// The next-phase pages: 골든 이미지, 게이트웨이, USB 장치 라이브러리, 외부 데스크톱, 가입 심사,
// 부서 관리, 보드 LAB, 빌드 팜, 라이선스 서버, and 플랫폼 설정 > 클라이언트
// (engine: pegaprox/api/vlab_next.py). Texts are inline ko/en pairs.

type Notice = { kind: 'info' | 'error'; text: string } | null;

function useL() {
  const { pick, lang } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const when = (iso: string | null | undefined) => (iso ? new Date(iso.length <= 19 ? `${iso}` : iso).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US',
    { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
  return { L, when, lang };
}

const GB = 1024 ** 3;
const errText = (e: unknown) => (e as Error).message;

function NoticeBar({ notice }: { notice: Notice }) {
  return notice ? <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div> : null;
}

function Intro({ children }: { children: React.ReactNode }) {
  return <p className="muted small page-intro">{children}</p>;
}

// --- 가상머신 > 골든 이미지 관리 --------------------------------------------------

export function GoldenImagesPage() {
  const { L } = useL();
  const images = useLoad(nextApi.goldenImages);
  const [adding, setAdding] = useState(false);
  const [versionOf, setVersionOf] = useState<GoldenImage | null>(null);
  const [deployOf, setDeployOf] = useState<GoldenImage | null>(null);
  const [rollOf, setRollOf] = useState<{ image: GoldenImage; pool_id: string; pool: string; outdated: number } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    try { await fn(); images.reload(); if (ok) setNotice({ kind: 'info', text: ok }); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }

  return (
    <LoadState value={images} retry={images.reload}>
      {(list) => (
        <>
          <Intro>{L('평소처럼 켜서 고친 VM을 골든 이미지로 두고, 고칠 때마다 "버전 만들기"(스냅샷)를 한 뒤 풀에 배포합니다. 배포는 전체 복제라 원본과 따로 돌아갑니다.',
            'Keep a VM you edit as a golden image, make a version (snapshot) after each change and deploy it to pools as full clones.')}</Intro>
          <div className="toolbar">
            <button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{L('골든 이미지 등록', 'Add golden image')}</button>
            <button type="button" className="btn" onClick={images.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
          </div>
          <SettingsStatus items={[
            { label: L('골든 이미지', 'Images'), value: String(list.length) },
            { label: L('버전', 'Versions'), value: String(list.reduce((a, g) => a + (g.versions?.length ?? 0), 0)) },
            { label: L('쓰는 풀', 'Pools using them'), value: String(new Set(list.flatMap((g) => g.pools)).size) },
            { label: L('버전 없음', 'No version yet'), value: String(list.filter((g) => !g.current_version).length), tone: list.some((g) => !g.current_version) ? 'warn' : undefined },
          ]} />
          <NoticeBar notice={notice} />
          {list.length === 0 ? <div className="empty"><p>{L('등록된 골든 이미지가 없습니다.', 'No golden images yet.')}</p></div> : (
            <div className="lab-grid">
              {list.map((g) => (
                <article key={g.id} className="lab-card">
                  <header>
                    <span className="lab-icon"><Icon name="vm" size={20} /></span>
                    <div className="lab-title"><h3>{g.name}</h3><span className="muted small">VM {g.vmid} · {g.node}</span></div>
                    <span className={`lab-state ${g.status === 'running' ? 'on' : 'idle'}`}>{g.status === 'running' ? L('켜짐 (수정 중)', 'On (editing)') : L('꺼짐', 'Off')}</span>
                  </header>
                  <dl className="lab-facts">
                    <div><dt>{L('배포 버전', 'Deploys')}</dt><dd>{g.current_version ? <code className="code">{g.current_version}</code> : <span className="chip chip-warn">{L('없음', 'none')}</span>}</dd></div>
                    <div><dt>{L('버전 수', 'Versions')}</dt><dd>{g.versions?.length ?? '-'}</dd></div>
                    <div><dt>{L('쓰는 풀', 'Pools')}</dt><dd>{g.pools.length ? g.pools.join(', ') : '-'}</dd></div>
                  </dl>
                  {g.notes && <p className="muted small lab-desc">{g.notes}</p>}
                  {g.rollout && g.rollout.length > 0 && (
                    <ul className="ver-list rollout-list">
                      {g.rollout.map((r) => (
                        <li key={r.pool_id}>
                          <span className="strong">{r.pool}</span>
                          <span className="muted small">{r.outdated
                            ? L(`${r.total}대 중 ${r.outdated}대가 예전 버전`, `${r.outdated} of ${r.total} on an older version`)
                            : L(`${r.total}대 모두 최신`, `all ${r.total} current`)}</span>
                          {r.outdated > 0 ? <button type="button" className="btn small-btn primary" onClick={() => setRollOf({ image: g, ...r })}>{L('새 버전으로 교체', 'Roll out')}</button>
                            : <span className="chip chip-on">{L('최신', 'current')}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {g.versions && g.versions.length > 0 && (
                    <ul className="ver-list">
                      {g.versions.slice(0, 4).map((v) => (
                        <li key={v.name}>
                          <code className="code">{v.name}</code>
                          <span className="muted small">{v.description || '-'}</span>
                          {v.name === g.current_version ? <span className="chip chip-on">{L('배포 중', 'deploying')}</span>
                            : <button type="button" className="btn-ghost small-btn" onClick={() => act(() => nextApi.setCurrentVersion(g.id, v.name))}>{L('이 버전 배포', 'Use this')}</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <footer>
                    <button type="button" className="btn small-btn" onClick={() => setVersionOf(g)}><Icon name="plus" size={14} />{L('버전 만들기', 'Make version')}</button>
                    <button type="button" className="btn small-btn primary" disabled={!g.current_version} onClick={() => setDeployOf(g)}>{L('풀에 배포', 'Deploy to pool')}</button>
                    <span className="spacer" />
                    <button type="button" className="btn-ghost small-btn danger" onClick={() => {
                      if (confirm(L(`'${g.name}'을(를) 골든 이미지에서 뺄까요? VM과 스냅샷은 남습니다.`, `Stop treating '${g.name}' as a golden image? The VM stays.`))) act(() => nextApi.deleteGolden(g.id));
                    }}>{L('등록 해제', 'Remove')}</button>
                  </footer>
                </article>
              ))}
            </div>
          )}
          {adding && <AddGoldenDialog onClose={() => setAdding(false)} onDone={() => { setAdding(false); images.reload(); }} />}
          {versionOf && <VersionDialog image={versionOf} onClose={() => setVersionOf(null)} onDone={(v) => { setVersionOf(null); images.reload(); setNotice({ kind: 'info', text: L(`새 버전 ${v}을(를) 만들었습니다.`, `Made version ${v}.`) }); }} />}
          {rollOf && <RolloutDialog target={rollOf} onClose={() => setRollOf(null)} onDone={(r) => {
            setRollOf(null); images.reload();
            setNotice({ kind: r.failed ? 'error' : 'info', text: L(`${r.replaced.length}대를 새 버전으로 바꿨습니다.`, `Replaced ${r.replaced.length} desktops.`)
              + (r.skipped.length ? L(` 접속 중이라 건너뜀: ${r.skipped.join(', ')}`, ` Skipped (in use): ${r.skipped.join(', ')}`) : '')
              + (r.failed ? L(` 실패: ${r.failed.name} (${r.failed.error})`, ` Failed: ${r.failed.name} (${r.failed.error})`) : '') });
          }} />}
          {deployOf && <DeployDialog image={deployOf} onClose={() => setDeployOf(null)} onDone={(n) => { setDeployOf(null); images.reload(); setNotice({ kind: 'info', text: L(`데스크톱 ${n}대를 만들고 있습니다.`, `Creating ${n} desktops.`) }); }} />}
        </>
      )}
    </LoadState>
  );
}

function AddGoldenDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const clusters = useLoad(adminApi.clusters);
  const [cluster, setCluster] = useState('');
  const cid = cluster || (clusters.state === 'ok' ? clusters.data[0]?.id ?? '' : '');
  const guests = useLoad(() => (cid ? adminApi.guests(cid) : Promise.resolve([])), [cid]);
  const [vmid, setVmid] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vms = guests.state === 'ok' ? guests.data.filter((g) => g.type === 'qemu' && !g.desktop_id) : [];
  async function submit() {
    setBusy(true); setError(null);
    try { await nextApi.addGolden({ cluster_id: cid, vmid: Number(vmid), name: name || undefined, notes }); onDone(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('골든 이미지 등록', 'Add golden image')} onClose={onClose} onSubmit={submit} submitLabel={L('등록', 'Add')} busy={busy || !vmid} error={error}>
      <label><span>{L('클러스터', 'Cluster')}</span>
        <select id="gold-cluster" value={cid} onChange={(e) => setCluster(e.target.value)}>
          {(clusters.state === 'ok' ? clusters.data : []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
      <label><span>{L('VM (템플릿이 아닌 가상머신)', 'VM (not a template)')}</span>
        <select id="gold-vm" value={vmid} onChange={(e) => setVmid(e.target.value)}>
          <option value="">{L('고르세요', 'Pick one')}</option>
          {vms.map((g) => <option key={g.vmid} value={g.vmid}>{g.vmid} · {g.name} · {g.node}</option>)}
        </select></label>
      <label><span>{L('이름 (비우면 VM 이름)', 'Name (VM name if empty)')}</span><input id="gold-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label><span>{L('메모', 'Notes')}</span><input id="gold-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>
    </Dialog>
  );
}

function VersionDialog({ image, onClose, onDone }: { image: GoldenImage; onClose: () => void; onDone: (v: string) => void }) {
  const { L } = useL();
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { const r = await nextApi.makeVersion(image.id, desc); onDone(r.version); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L(`${image.name}: 버전 만들기`, `${image.name}: make a version`)} onClose={onClose} onSubmit={submit} submitLabel={L('만들기', 'Make')} busy={busy} error={error}>
      <p className="muted small">{L('지금 VM 상태를 스냅샷(gold-날짜-시각)으로 남기고, 새 배포에 이 버전을 씁니다. 이미 배포된 데스크톱은 바뀌지 않습니다.',
        'Snapshots the VM as it is now (gold-date-time) and deploys that from now on. Desktops already made stay as they are.')}</p>
      <label><span>{L('설명', 'Description')}</span><input id="ver-desc" value={desc} maxLength={200} placeholder={L('예: 10월 보안 패치', 'e.g. October patches')} onChange={(e) => setDesc(e.target.value)} /></label>
    </Dialog>
  );
}

function DeployDialog({ image, onClose, onDone }: { image: GoldenImage; onClose: () => void; onDone: (n: number) => void }) {
  const { L } = useL();
  const pools = useLoad(adminApi.pools);
  const [pool, setPool] = useState('');
  const [count, setCount] = useState(1);
  const [prefix, setPrefix] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = pools.state === 'ok' ? pools.data.filter((p) => p.cluster_id === image.cluster_id || !image.cluster_id) : [];
  async function submit() {
    setBusy(true); setError(null);
    try { const r = await nextApi.deployGolden(image.id, { pool_id: pool, count, name_prefix: prefix }); onDone(r.created.length); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L(`${image.name} 배포`, `Deploy ${image.name}`)} onClose={onClose} onSubmit={submit} submitLabel={L('배포', 'Deploy')} busy={busy || !pool || !prefix} error={error}>
      <p className="muted small">{L(`버전 ${image.current_version}을(를) 전체 복제해 풀에 넣습니다.`, `Full clones of ${image.current_version} go into the pool.`)}</p>
      <label><span>{L('풀', 'Pool')}</span>
        <select id="dep-pool" value={pool} onChange={(e) => setPool(e.target.value)}>
          <option value="">{L('고르세요', 'Pick one')}</option>
          {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
      <div className="form-row form-row-wide">
        <label><span>{L('이름 앞부분', 'Name prefix')}</span><input id="dep-prefix" value={prefix} maxLength={40} placeholder="lab-b" onChange={(e) => setPrefix(e.target.value.trim())} /></label>
        <label><span>{L('대수', 'Count')}</span><input id="dep-count" type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /></label>
      </div>
      <p className="muted small">{L(`이름: ${prefix || 'lab-b'}-01, ${prefix || 'lab-b'}-02 …`, `Names: ${prefix || 'lab-b'}-01, ${prefix || 'lab-b'}-02 …`)}</p>
    </Dialog>
  );
}

function RolloutDialog({ target, onClose, onDone }: { target: { image: GoldenImage; pool_id: string; pool: string; outdated: number }; onClose: () => void; onDone: (r: RolloutResult) => void }) {
  const { L } = useL();
  const [deleteOld, setDeleteOld] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { onDone(await nextApi.rollout(target.image.id, { pool_id: target.pool_id, delete_old: deleteOld })); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L(`${target.pool}: 새 버전으로 교체`, `${target.pool}: roll out`)} onClose={onClose} onSubmit={submit} submitLabel={L('교체 시작', 'Start')} busy={busy} error={error}>
      <p>{L(`예전 버전 데스크톱 ${target.outdated}대를 ${target.image.current_version}에서 새로 복제한 데스크톱으로 바꿉니다. 사용자 배정과 권한은 그대로 옮겨집니다.`,
        `${target.outdated} desktops on an older version are replaced by fresh clones of ${target.image.current_version}; users and permissions move over.`)}</p>
      <ul className="muted small">
        <li>{L('지금 접속 중인 데스크톱은 건너뜁니다. 나중에 다시 실행하면 됩니다.', 'Desktops in use are skipped; run it again later.')}</li>
        <li>{L('한 번에 최대 20대씩 교체합니다.', 'At most 20 per run.')}</li>
        <li>{L('예전 데스크톱 안의 사용자 파일은 옮겨지지 않습니다. 필요하면 먼저 백업하세요.', 'Files inside the old desktops do not move; back them up first if needed.')}</li>
      </ul>
      <label className="check"><input id="ro-del" type="checkbox" checked={deleteOld} onChange={(e) => setDeleteOld(e.target.checked)} /><span>{L('교체 후 예전 VM 삭제', 'Delete the old VMs afterwards')}</span></label>
    </Dialog>
  );
}

// --- 데스크톱 풀 > 게이트웨이 ------------------------------------------------------

const GW_KINDS: { id: GatewayKind; ko: string; en: string; port: number }[] = [
  { id: 'rdpgw', ko: 'RDP 게이트웨이 (rdpgw)', en: 'RDP gateway (rdpgw)', port: 443 },
  { id: 'msrdgw', ko: 'Microsoft RD 게이트웨이', en: 'Microsoft RD Gateway', port: 443 },
  { id: 'guacamole', ko: '브라우저 RDP (Guacamole)', en: 'Browser RDP (Guacamole)', port: 8080 },
];

export function GatewaysPage() {
  const { L, when } = useL();
  const gws = useLoad(nextApi.gateways);
  const [editing, setEditing] = useState<Gateway | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [checking, setChecking] = useState<string | null>(null);
  async function check(g: Gateway) {
    setChecking(g.id);
    try { const r = await nextApi.checkGateway(g.id); setNotice({ kind: r.ok ? 'info' : 'error', text: r.ok ? L(`${g.name}: 응답 ${r.ms} ms`, `${g.name}: answered in ${r.ms} ms`) : L(`${g.name}: 응답 없음 (${r.error})`, `${g.name}: no answer (${r.error})`) }); gws.reload(); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); } finally { setChecking(null); }
  }
  return (
    <LoadState value={gws} retry={gws.reload}>
      {(list) => (
        <>
          <Intro>{L('외부망에서 데스크톱 · 외부 PC에 RDP로 들어올 때 거치는 게이트웨이를 등록합니다. RDP 게이트웨이는 외부 데스크톱의 .rdp 파일에 자동으로 들어갑니다.',
            'Gateways that RDP connections from outside go through. RDP gateways are written into the external desktops\' .rdp files.')}</Intro>
          <div className="toolbar">
            <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('게이트웨이 추가', 'Add gateway')}</button>
            <button type="button" className="btn" onClick={gws.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
          </div>
          <SettingsStatus items={[
            { label: L('게이트웨이', 'Gateways'), value: String(list.length) },
            { label: L('응답함', 'Answering'), value: String(list.filter((g) => g.last_ok === 1).length), tone: 'ok' },
            { label: L('응답 없음', 'Not answering'), value: String(list.filter((g) => g.last_ok === 0).length), tone: list.some((g) => g.last_ok === 0) ? 'warn' : undefined },
            { label: L('쓰는 외부 데스크톱', 'External desktops'), value: String(list.reduce((a, g) => a + g.external, 0)) },
          ]} />
          <NoticeBar notice={notice} />
          {list.length === 0 ? <div className="empty"><p>{L('등록된 게이트웨이가 없습니다.', 'No gateways yet.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('이름', 'Name')}</th><th>{L('종류', 'Kind')}</th><th>{L('주소', 'Address')}</th><th>{L('상태', 'State')}</th><th>{L('마지막 확인', 'Checked')}</th><th className="num">{L('외부 데스크톱', 'External')}</th><th className="actions" /></tr></thead>
              <tbody>{list.map((g) => (
                <tr key={g.id} className={g.enabled ? '' : 'row-off'}>
                  <td className="strong">{g.name}{g.notes && <div className="muted small">{g.notes}</div>}</td>
                  <td>{L(GW_KINDS.find((k) => k.id === g.kind)?.ko ?? g.kind, GW_KINDS.find((k) => k.id === g.kind)?.en ?? g.kind)}</td>
                  <td><code className="code">{g.address}:{g.port}</code></td>
                  <td>{g.last_ok === 1 ? <span className="chip chip-on">{L('응답', 'up')} · {g.last_detail}</span> : g.last_ok === 0 ? <span className="chip chip-warn">{L('응답 없음', 'down')}</span> : <span className="chip">{L('확인 전', 'unchecked')}</span>}</td>
                  <td className="muted small">{when(g.last_check)}</td>
                  <td className="num">{g.external}</td>
                  <td className="actions">
                    <button type="button" className="btn-ghost small-btn" disabled={checking === g.id} onClick={() => check(g)}>{L('접속 확인', 'Check')}</button>
                    <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(g)}>{L('편집', 'Edit')}</button>
                    <button type="button" className="btn-ghost small-btn danger" onClick={async () => {
                      if (!confirm(L(`'${g.name}'을(를) 지울까요? 이 게이트웨이를 쓰던 외부 데스크톱은 직접 연결로 바뀝니다.`, `Delete '${g.name}'?`))) return;
                      try { await nextApi.deleteGateway(g.id); gws.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
                    }}>{L('삭제', 'Delete')}</button>
                  </td>
                </tr>))}</tbody>
            </table></div>
          )}
          {editing && <GatewayDialog gw={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); gws.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

function GatewayDialog({ gw, onClose, onDone }: { gw: Gateway | null; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [name, setName] = useState(gw?.name ?? '');
  const [kind, setKind] = useState<GatewayKind>(gw?.kind ?? 'rdpgw');
  const [address, setAddress] = useState(gw?.address ?? '');
  const [port, setPort] = useState(gw?.port ?? 443);
  const [notes, setNotes] = useState(gw?.notes ?? '');
  const [enabled, setEnabled] = useState(gw ? !!gw.enabled : true);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newKey = () => setKey(Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
  async function submit() {
    setBusy(true); setError(null);
    try { await nextApi.saveGateway(gw?.id ?? null, { name, kind, address, port, notes, enabled, ...(kind === 'guacamole' && key ? { secret_key: key } : {}) }); onDone(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={gw ? L('게이트웨이 편집', 'Edit gateway') : L('게이트웨이 추가', 'Add gateway')} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy || !name || !address} error={error}>
      <label><span>{L('이름', 'Name')}</span><input id="gw-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label><span>{L('종류', 'Kind')}</span>
        <select id="gw-kind" value={kind} onChange={(e) => { const k = e.target.value as GatewayKind; setKind(k); setPort(GW_KINDS.find((x) => x.id === k)!.port); }}>
          {GW_KINDS.map((k) => <option key={k.id} value={k.id}>{L(k.ko, k.en)}</option>)}
        </select></label>
      <div className="form-row form-row-wide">
        <label><span>{L('주소 (도메인 또는 IP)', 'Address')}</span><input id="gw-addr" value={address} placeholder="rdgw.example.com" onChange={(e) => setAddress(e.target.value.trim())} /></label>
        <label><span>{L('포트', 'Port')}</span><input id="gw-port" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value) || 0)} /></label>
      </div>
      {kind === 'guacamole' && (
        <>
          <label><span>{L('공유 키 (guacamole-auth-json, 16진수 32자)', 'Shared key (guacamole-auth-json, 32 hex)')}</span>
            <div className="input-with-btn">
              <input id="gw-key" value={key} maxLength={32} placeholder={gw?.has_key ? L('저장됨 — 바꿀 때만 입력', 'Saved; type only to change') : '4c0b569e4c96df157eee1b65dd0e4d41'}
                onChange={(e) => setKey(e.target.value.trim().toLowerCase())} />
              <button type="button" className="btn small-btn" onClick={newKey}>{L('새로 만들기', 'Generate')}</button>
            </div></label>
          <p className="muted small">{L('같은 키를 Guacamole 서버의 guacamole.properties에 json-secret-key로 넣으세요. 이 키가 있어야 포털에서 브라우저 RDP 링크를 만듭니다.',
            'Put the same key in the Guacamole server\'s guacamole.properties as json-secret-key. The portal needs it to make browser RDP links.')}</p>
        </>
      )}
      <label><span>{L('메모', 'Notes')}</span><input id="gw-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>
      <label className="check"><input id="gw-on" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span>{L('사용', 'Enabled')}</span></label>
    </Dialog>
  );
}

// --- 데스크톱 풀 > USB 장치 라이브러리 ---------------------------------------------

const USB_CATS: { id: UsbCategory; ko: string; en: string }[] = [
  { id: 'jtag', ko: 'JTAG 케이블', en: 'JTAG cable' }, { id: 'security-key', ko: '보안키', en: 'Security key' },
  { id: 'storage', ko: '저장 장치', en: 'Storage' }, { id: 'serial', ko: '시리얼', en: 'Serial' },
  { id: 'camera', ko: '카메라', en: 'Camera' }, { id: 'other', ko: '기타', en: 'Other' },
];

export function UsbLibraryPage() {
  const { L } = useL();
  const devs = useLoad(nextApi.usbDevices);
  const [editing, setEditing] = useState<UsbDevice | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const cat = (c: UsbCategory) => { const x = USB_CATS.find((y) => y.id === c)!; return L(x.ko, x.en); };
  return (
    <LoadState value={devs} retry={devs.reload}>
      {(list) => (
        <>
          <Intro>{L('풀 정책의 USB 연결에서 고를 장치 목록입니다. VID(벤더)와 PID(제품)로 구분하고, PID를 비우면 그 벤더 장치 전체를 뜻합니다.',
            'The devices pool USB policies pick from, by vendor (VID) and product (PID). An empty PID means every device of the vendor.')}</Intro>
          <div className="toolbar">
            <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('장치 추가', 'Add device')}</button>
          </div>
          <SettingsStatus items={[
            { label: L('장치', 'Devices'), value: String(list.length) },
            { label: L('JTAG 케이블', 'JTAG cables'), value: String(list.filter((d) => d.category === 'jtag').length) },
            { label: L('기본 제공', 'Built in'), value: String(list.filter((d) => d.builtin).length) },
            { label: L('풀에서 사용 중', 'Used by pools'), value: String(list.filter((d) => d.pools > 0).length) },
          ]} />
          <NoticeBar notice={notice} />
          <div className="table-scroll"><table className="table compact-head">
            <thead><tr><th>{L('이름', 'Name')}</th><th>VID</th><th>PID</th><th>{L('분류', 'Category')}</th><th>{L('메모', 'Notes')}</th><th className="num">{L('쓰는 풀', 'Pools')}</th><th className="actions" /></tr></thead>
            <tbody>{list.map((d) => (
              <tr key={d.id}>
                <td className="strong">{d.name}{d.builtin ? <span className="chip chip-free" style={{ marginLeft: 6 }}>{L('기본', 'built in')}</span> : null}</td>
                <td><code className="code">{d.vid}</code></td>
                <td>{d.pid ? <code className="code">{d.pid}</code> : <span className="muted small">{L('전체', 'any')}</span>}</td>
                <td>{cat(d.category)}</td>
                <td className="muted small">{d.notes}</td>
                <td className="num">{d.pools}</td>
                <td className="actions">
                  <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(d)}>{L('편집', 'Edit')}</button>
                  <button type="button" className="btn-ghost small-btn danger" onClick={async () => {
                    if (!confirm(L(`'${d.name}'을(를) 지울까요?`, `Delete '${d.name}'?`))) return;
                    try { await nextApi.deleteUsbDevice(d.id); devs.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
                  }}>{L('삭제', 'Delete')}</button>
                </td>
              </tr>))}</tbody>
          </table></div>
          {editing && <UsbDialog dev={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); devs.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

function UsbDialog({ dev, onClose, onDone }: { dev: UsbDevice | null; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [name, setName] = useState(dev?.name ?? '');
  const [vid, setVid] = useState(dev?.vid ?? '');
  const [pid, setPid] = useState(dev?.pid ?? '');
  const [category, setCategory] = useState<UsbCategory>(dev?.category ?? 'jtag');
  const [notes, setNotes] = useState(dev?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await nextApi.saveUsbDevice(dev?.id ?? null, { name, vid: vid.toLowerCase(), pid: pid.toLowerCase(), category, notes }); onDone(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={dev ? L('USB 장치 편집', 'Edit USB device') : L('USB 장치 추가', 'Add USB device')} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy || !name || !vid} error={error}>
      <label><span>{L('이름', 'Name')}</span><input id="usb-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-row form-row-wide">
        <label><span>VID</span><input id="usb-vid" value={vid} maxLength={4} placeholder="03fd" onChange={(e) => setVid(e.target.value.trim())} /></label>
        <label><span>{L('PID (비우면 전체)', 'PID (empty = any)')}</span><input id="usb-pid" value={pid} maxLength={4} placeholder="0008" onChange={(e) => setPid(e.target.value.trim())} /></label>
      </div>
      <label><span>{L('분류', 'Category')}</span>
        <select id="usb-cat" value={category} onChange={(e) => setCategory(e.target.value as UsbCategory)}>{USB_CATS.map((c) => <option key={c.id} value={c.id}>{L(c.ko, c.en)}</option>)}</select></label>
      <label><span>{L('메모', 'Notes')}</span><input id="usb-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>
    </Dialog>
  );
}

// --- 데스크톱 풀 > 외부 데스크톱 ---------------------------------------------------

export function ExternalDesktopsPage() {
  const { L } = useL();
  const exts = useLoad(nextApi.externalDesktops);
  const gws = useLoad(nextApi.gateways);
  const [editing, setEditing] = useState<ExternalDesktop | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const gwName = (id: string | null) => (id && gws.state === 'ok' ? gws.data.find((g) => g.id === id)?.name : null);
  return (
    <LoadState value={exts} retry={exts.reload}>
      {(list) => (
        <>
          <Intro>{L('가상화가 아닌 실제 PC(측정 장비 PC, 설계실 워크스테이션)를 사용자에게 배정합니다. 사용자는 작업 공간에서 .rdp 파일을 받아 원격 데스크톱으로 접속합니다.',
            'Physical PCs (lab instrument PCs, workstations) assigned to users. Users get an .rdp file from their workspace.')}</Intro>
          <div className="toolbar">
            <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('외부 데스크톱 추가', 'Add external desktop')}</button>
          </div>
          <SettingsStatus items={[
            { label: L('외부 데스크톱', 'External desktops'), value: String(list.length) },
            { label: L('배정됨', 'Assigned'), value: String(list.filter((e) => e.assigned_user).length), tone: 'ok' },
            { label: L('배정 대기', 'Unassigned'), value: String(list.filter((e) => !e.assigned_user).length) },
            { label: L('게이트웨이 경유', 'Via gateway'), value: String(list.filter((e) => e.gateway_id).length) },
          ]} />
          <NoticeBar notice={notice} />
          {list.length === 0 ? <div className="empty"><p>{L('등록된 외부 데스크톱이 없습니다.', 'No external desktops yet.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('이름', 'Name')}</th><th>{L('주소', 'Address')}</th><th>{L('사용자', 'User')}</th><th>{L('게이트웨이', 'Gateway')}</th><th>{L('메모', 'Notes')}</th><th className="actions" /></tr></thead>
              <tbody>{list.map((e) => (
                <tr key={e.id}>
                  <td className="strong">{e.name}</td>
                  <td><code className="code">{e.address}:{e.port}</code></td>
                  <td>{e.assigned_user ?? <span className="chip chip-free">{L('배정 안 됨', 'unassigned')}</span>}</td>
                  <td>{gwName(e.gateway_id) ?? <span className="muted small">{L('직접 연결', 'direct')}</span>}</td>
                  <td className="muted small">{e.notes}</td>
                  <td className="actions">
                    <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(e)}>{L('편집', 'Edit')}</button>
                    <button type="button" className="btn-ghost small-btn danger" onClick={async () => {
                      if (!confirm(L(`'${e.name}'을(를) 지울까요?`, `Delete '${e.name}'?`))) return;
                      try { await nextApi.deleteExternal(e.id); exts.reload(); } catch (err) { setNotice({ kind: 'error', text: errText(err) }); }
                    }}>{L('삭제', 'Delete')}</button>
                  </td>
                </tr>))}</tbody>
            </table></div>
          )}
          {editing && <ExternalDialog ext={editing === 'new' ? null : editing} gateways={gws.state === 'ok' ? gws.data : []} onClose={() => setEditing(null)} onDone={() => { setEditing(null); exts.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

function ExternalDialog({ ext, gateways, onClose, onDone }: { ext: ExternalDesktop | null; gateways: Gateway[]; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const users = useLoad(adminApi.users);
  const [name, setName] = useState(ext?.name ?? '');
  const [address, setAddress] = useState(ext?.address ?? '');
  const [port, setPort] = useState(ext?.port ?? 3389);
  const [user, setUser] = useState(ext?.assigned_user ?? '');
  const [gw, setGw] = useState(ext?.gateway_id ?? '');
  const [notes, setNotes] = useState(ext?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await nextApi.saveExternal(ext?.id ?? null, { name, address, port, assigned_user: user || null, gateway_id: gw || null, notes }); onDone(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={ext ? L('외부 데스크톱 편집', 'Edit external desktop') : L('외부 데스크톱 추가', 'Add external desktop')} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy || !name || !address} error={error}>
      <label><span>{L('이름', 'Name')}</span><input id="ext-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-row form-row-wide">
        <label><span>{L('주소 (IP 또는 이름)', 'Address')}</span><input id="ext-addr" value={address} placeholder="10.30.5.21" onChange={(e) => setAddress(e.target.value.trim())} /></label>
        <label><span>{L('RDP 포트', 'RDP port')}</span><input id="ext-port" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value) || 0)} /></label>
      </div>
      <label><span>{L('사용자', 'User')}</span>
        <select id="ext-user" value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="">{L('배정 안 함', 'Nobody')}</option>
          {(users.state === 'ok' ? users.data : []).map((u) => <option key={u.username} value={u.username}>{u.display_name || u.username} ({u.username})</option>)}
        </select></label>
      <label><span>{L('게이트웨이', 'Gateway')}</span>
        <select id="ext-gw" value={gw} onChange={(e) => setGw(e.target.value)}>
          <option value="">{L('직접 연결', 'Direct')}</option>
          {gateways.filter((g) => g.kind !== 'guacamole').map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select></label>
      <label><span>{L('메모', 'Notes')}</span><input id="ext-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>
    </Dialog>
  );
}

// --- 사용자 > 가입 심사 ------------------------------------------------------------

export function SignupsPage() {
  const { L, when } = useL();
  const [tab, setTab] = useState<SignupStatus>('pending');
  const data = useLoad(() => nextApi.signups(tab), [tab]);
  const settings = useLoad(nextApi.signupSettings);
  const deps = useLoad(nextApi.departments);
  const [rejecting, setRejecting] = useState<Signup | null>(null);
  const [approving, setApproving] = useState<Signup | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const depName = (id: string | null) => (id && deps.state === 'ok' ? deps.data.find((d) => d.id === id)?.name : null) ?? '-';
  const s = settings.state === 'ok' ? settings.data : null;
  const open = s?.enabled ?? false;
  async function toggle() {
    try { await nextApi.saveSignupSettings({ enabled: !open }); settings.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  const verifyLabel = (m?: string) => m === 'required' ? L('필수', 'required') : m === 'optional' ? L('선택', 'optional') : L('끔', 'off');
  return (
    <>
      <Intro>{L('로그인 화면의 "가입 신청"으로 들어온 요청을 승인하거나 거절합니다. 승인하면 일반 사용자 계정(작업 공간만)이 생기고, 신청한 부서에 들어갑니다. 가입 설정에서 메일 인증과 기관 메일 자동 승인을 정합니다.',
        'Approve or reject requests made with 가입 신청 on the sign-in screen. Approving makes a portal-only user in the department asked for. 가입 설정 sets the mail check and the institution domains approved at once.')}</Intro>
      <div className="toolbar">
        <label className="check"><input id="signup-open" type="checkbox" checked={open} onChange={toggle} /><span>{L('로그인 화면에서 가입 신청 받기', 'Take sign-up requests on the sign-in screen')}</span></label>
        <button type="button" className="btn" disabled={!s} onClick={() => setEditing(true)}><Icon name="gear" size={16} />{L('가입 설정', 'Sign-up settings')}</button>
        <span className="spacer" />
        <nav className="seg" role="tablist">
          {(['pending', 'approved', 'rejected'] as SignupStatus[]).map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
              {x === 'pending' ? L('대기', 'Pending') : x === 'approved' ? L('승인', 'Approved') : L('거절', 'Rejected')}
            </button>))}
        </nav>
      </div>
      <NoticeBar notice={notice} />
      <LoadState value={data} retry={data.reload}>
        {({ signups, pending }) => (
          <>
            <SettingsStatus items={[
              { label: L('대기 중', 'Pending'), value: String(pending), tone: pending ? 'warn' : undefined },
              { label: L('가입 신청', 'Sign-up'), value: open ? L('받는 중', 'open') : L('닫힘', 'closed'), tone: open ? 'ok' : 'off' },
              { label: L('메일 인증', 'Mail check'), value: verifyLabel(s?.verify_email), tone: s?.verify_email === 'off' ? 'off' : 'ok' },
              { label: L('자동 승인 도메인', 'Auto-approved domains'), value: s?.auto_domains.length ? s.auto_domains.join(', ') : L('없음', 'none'), tone: s?.auto_domains.length ? 'ok' : 'off' },
            ]} />
            {signups.length === 0 ? <div className="empty"><p>{L('요청이 없습니다.', 'No requests.')}</p></div> : (
              <div className="table-scroll"><table className="table compact-head">
                <thead><tr><th>{L('아이디', 'Username')}</th><th>{L('이름', 'Name')}</th><th>{L('메일', 'Mail')}</th><th>{L('부서', 'Department')}</th><th>{L('메모', 'Note')}</th><th>{L('신청', 'Asked')}</th>{tab !== 'pending' && <th>{L('처리', 'Reviewed')}</th>}<th className="actions" /></tr></thead>
                <tbody>{signups.map((x) => (
                  <tr key={x.id}>
                    <td className="strong">{x.username}</td><td>{x.display_name}</td>
                    <td className="muted small">{x.email || '-'}
                      {x.email && x.email_verified && <span className="chip chip-on chip-gap">{L('인증됨', 'verified')}</span>}
                      {x.email && !x.email_verified && x.status === 'pending' && <span className="chip chip-warn chip-gap" title={x.verify_sent ? L('코드를 보냈지만 아직 인증하지 않았습니다', 'A code was sent, not confirmed yet') : ''}>{L('메일 미인증', 'mail not verified')}</span>}
                    </td>
                    <td>{depName(x.department_id)}</td><td className="muted small">{x.note || '-'}</td>
                    <td className="muted small">{when(x.created_at)}<div>{x.client_ip}</div></td>
                    {tab !== 'pending' && <td className="muted small">{x.reviewed_by === 'auto' ? L('자동 승인', 'auto') : x.reviewed_by} · {when(x.reviewed_at)}{x.reason && <div>{x.reason}</div>}</td>}
                    <td className="actions">{x.status === 'pending' && (<>
                      <button type="button" className="btn small-btn primary" onClick={() => setApproving(x)}>{L('승인', 'Approve')}</button>
                      <button type="button" className="btn-ghost small-btn danger" onClick={() => setRejecting(x)}>{L('거절', 'Reject')}</button>
                    </>)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </>
        )}
      </LoadState>
      {rejecting && <RejectDialog signup={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); data.reload(); }} />}
      {approving && <ApproveDialog signup={approving} verifyMode={s?.verify_email} onClose={() => setApproving(null)}
        onDone={(text) => { setApproving(null); data.reload(); setNotice({ kind: 'info', text }); }} />}
      {editing && s && <SignupSettingsDialog initial={s} deps={deps.state === 'ok' ? deps.data : []} onClose={() => setEditing(false)}
        onDone={() => { setEditing(false); settings.reload(); setNotice({ kind: 'info', text: L('가입 설정을 저장했습니다.', 'Sign-up settings saved.') }); }} />}
    </>
  );
}

function ApproveDialog({ signup, verifyMode, onClose, onDone }: { signup: Signup; verifyMode?: string; onClose: () => void; onDone: (text: string) => void }) {
  const { L } = useL();
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      await nextApi.approveSignup(signup.id, until || null);
      onDone(L(`${signup.username} 계정을 만들었습니다. 데스크톱은 풀 권한으로 따로 줍니다.`, `Created ${signup.username}. Give desktops through pool rights.`));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  const unverified = !!signup.email && !signup.email_verified;
  return (
    <Dialog open title={L(`${signup.username} 가입 승인`, `Approve ${signup.username}`)} onClose={onClose} onSubmit={submit} submitLabel={L('승인', 'Approve')} busy={busy} error={error}>
      {unverified && <div className={`alert small ${verifyMode === 'required' ? 'error' : 'info'}`}>{L('신청자가 아직 메일을 인증하지 않았습니다. 본인 확인을 따로 했을 때만 승인하세요.',
        'The applicant has not confirmed the mail yet. Approve only if you checked who they are some other way.')}</div>}
      <label><span>{L('사용 기한 (선택)', 'Last day of use (optional)')}</span>
        <input id="appr-until" type="date" value={until} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setUntil(e.target.value)} />
        <small className="muted">{L('이 날이 지나면 로그인이 막히고 배정된 데스크톱이 회수됩니다. 비우면 기한 없음.', 'After this day the account cannot sign in and its desktops are taken back. Empty: no limit.')}</small></label>
    </Dialog>
  );
}

function SignupSettingsDialog({ initial, deps, onClose, onDone }: { initial: SignupSettings; deps: Department[]; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const pools = useLoad(() => adminApi.pools().catch(() => []));
  const [f, setF] = useState({ ...initial, domains: initial.auto_domains.join(', ') });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      await nextApi.saveSignupSettings({ verify_email: f.verify_email, auto_domains: f.domains.split(/[\s,;]+/).map((d) => d.trim().replace(/^@/, '').toLowerCase()).filter(Boolean),
        auto_role: f.auto_role, auto_department_id: f.auto_department_id || null, auto_pool_ids: f.auto_pool_ids, auto_expires_at: f.auto_expires_at || null });
      onDone();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  const poolList = pools.state === 'ok' ? pools.data : [];
  const togglePool = (id: string) => setF({ ...f, auto_pool_ids: f.auto_pool_ids.includes(id) ? f.auto_pool_ids.filter((x) => x !== id) : [...f.auto_pool_ids, id] });
  return (
    <Dialog open wide title={L('가입 설정', 'Sign-up settings')} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy} error={error}>
      <label><span>{L('메일 인증', 'Mail check')}</span>
        <select id="su-verify" value={f.verify_email} onChange={(e) => setF({ ...f, verify_email: e.target.value as VerifyMode })}>
          <option value="off">{L('끔 — 메일을 확인하지 않음', 'Off — the address is not checked')}</option>
          <option value="optional">{L('선택 — 메일을 넣으면 코드로 확인', 'Optional — checked when given')}</option>
          <option value="required">{L('필수 — 메일을 꼭 넣고 확인', 'Required — every request confirms a mail')}</option>
        </select>
        <small className="muted">{L('신청자에게 6자리 코드와 링크를 보냅니다(30분). 플랫폼 설정 > 일반의 메일(SMTP)을 씁니다. 인증 전에는 대기 목록에 "메일 미인증"으로 보입니다.',
          'The applicant gets a 6-digit code and a link (30 minutes), sent with the SMTP of Platform settings > General. Until then the request shows "mail not verified".')}</small></label>
      <h3 className="panel-title">{L('기관 메일 자동 승인', 'Institution mail, approved at once')}</h3>
      <label><span>{L('허용 도메인', 'Domains')}</span>
        <input id="su-domains" value={f.domains} placeholder="univ.ac.kr, lab.re.kr" onChange={(e) => setF({ ...f, domains: e.target.value })} />
        <small className="muted">{L('이 도메인(하위 도메인 포함) 메일을 인증하면 관리자 승인 없이 계정이 생깁니다. 메일 인증이 꺼져 있어도 이 도메인은 인증합니다. 그 밖의 메일은 지금처럼 심사합니다.',
          'A confirmed mail of these domains (and sub-domains) makes the account without review; these addresses are checked even with the mail check off. Others wait for review.')}</small></label>
      <div className="form-row form-row-even">
        <label><span>{L('역할', 'Role')}</span>
          <select id="su-role" value={f.auto_role} onChange={(e) => setF({ ...f, auto_role: e.target.value })}>
            <option value="user">{L('사용자', 'User')}</option><option value="viewer">{L('조회자', 'Viewer')}</option>
            {!['user', 'viewer'].includes(f.auto_role) && <option value={f.auto_role}>{f.auto_role}</option>}
          </select></label>
        <label><span>{L('기본 부서', 'Department')}</span>
          <select id="su-dep" value={f.auto_department_id ?? ''} onChange={(e) => setF({ ...f, auto_department_id: e.target.value || null })}>
            <option value="">{L('신청자가 고른 부서', 'The one the applicant picked')}</option>
            {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
        <label><span>{L('사용 기한', 'Last day of use')}</span>
          <input id="su-until" type="date" value={f.auto_expires_at ?? ''} onChange={(e) => setF({ ...f, auto_expires_at: e.target.value || null })} /></label>
      </div>
      <fieldset className="check-list">
        <legend>{L('풀 권한 (선택)', 'Pool rights (optional)')}</legend>
        {poolList.length === 0 ? <p className="muted small">{L('풀이 없습니다.', 'No pools.')}</p> : poolList.map((p) => (
          <label key={p.id} className="check"><input type="checkbox" checked={f.auto_pool_ids.includes(p.id)} onChange={() => togglePool(p.id)} /><span>{p.name}</span></label>))}
      </fieldset>
    </Dialog>
  );
}

function RejectDialog({ signup, onClose, onDone }: { signup: Signup; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await nextApi.rejectSignup(signup.id, reason); onDone(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L(`${signup.username} 가입 거절`, `Reject ${signup.username}`)} onClose={onClose} onSubmit={submit} submitLabel={L('거절', 'Reject')} busy={busy} error={error}>
      <label><span>{L('이유 (선택)', 'Reason (optional)')}</span><input id="rej-reason" value={reason} maxLength={200} placeholder={L('예: 소속 확인 불가', 'e.g. could not confirm')} onChange={(e) => setReason(e.target.value)} /></label>
    </Dialog>
  );
}

// --- 사용자 > 부서 관리 ------------------------------------------------------------

export function DepartmentsPage() {
  const { L } = useL();
  const deps = useLoad(nextApi.departments);
  const users = useLoad(adminApi.users);
  const [sel, setSel] = useState<string>('');
  const [children, setChildren] = useState(true);
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const list = deps.state === 'ok' ? deps.data : [];
  const current = sel || list[0]?.id || '';
  const members = useLoad(() => (current ? nextApi.members(current, children) : Promise.resolve([])), [current, children]);
  const tree = useMemo(() => {
    const out: { d: Department; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => list.filter((d) => d.parent_id === parent).forEach((d) => { out.push({ d, depth }); walk(d.id, depth + 1); });
    walk(null, 0);
    return out;
  }, [list]);
  const [adding, setAdding] = useState('');
  const memberNames = members.state === 'ok' ? new Set(members.data.map((m) => m.username)) : new Set<string>();
  async function addMember() {
    if (!adding) return;
    try { await nextApi.setUserDepartment(adding, current); setAdding(''); members.reload(); deps.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  async function removeMember(u: string) {
    try { await nextApi.setUserDepartment(u, null); members.reload(); deps.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  const curDep = list.find((d) => d.id === current);
  return (
    <LoadState value={deps} retry={deps.reload}>
      {() => (
        <>
          <Intro>{L('기관 안의 조직(학과 · 연구실 · 팀)을 트리로 관리합니다. 사용자는 부서 하나에 속하고, 가입 신청 때 고른 부서로 자동으로 들어갑니다.',
            'The organisation (departments, labs, teams) as a tree. A user belongs to one department; sign-ups join the one they picked.')}</Intro>
          <div className="toolbar">
            <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('부서 추가', 'Add department')}</button>
          </div>
          <SettingsStatus items={[
            { label: L('부서', 'Departments'), value: String(list.length) },
            { label: L('최상위', 'Top level'), value: String(list.filter((d) => !d.parent_id).length) },
            { label: L('소속 사용자', 'Members'), value: String(list.reduce((a, d) => a + d.members, 0)) },
          ]} />
          <NoticeBar notice={notice} />
          <div className="split-2">
            <section className="panel">
              <h3 className="panel-title">{L('부서 트리', 'Tree')}</h3>
              {tree.length === 0 ? <p className="muted small">{L('부서가 없습니다.', 'No departments.')}</p> : (
                <ul className="dep-tree">
                  {tree.map(({ d, depth }) => (
                    <li key={d.id} style={{ paddingLeft: depth * 18 }}>
                      <button type="button" className={`dep-node${d.id === current ? ' on' : ''}`} onClick={() => setSel(d.id)}>
                        <Icon name={depth ? 'chevron' : 'users'} size={14} />{d.name}<span className="muted small">{d.members}</span>
                      </button>
                    </li>))}
                </ul>)}
            </section>
            <section className="panel">
              <div className="panel-head">
                <h3 className="panel-title">{curDep?.name ?? '-'}</h3>
                {curDep && <span className="spacer" />}
                {curDep && <>
                  <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(curDep)}>{L('편집', 'Edit')}</button>
                  <button type="button" className="btn-ghost small-btn danger" onClick={async () => {
                    if (!confirm(L(`'${curDep.name}' 부서를 지울까요? 소속 사용자는 부서 없음이 됩니다.`, `Delete '${curDep.name}'?`))) return;
                    try { await nextApi.deleteDepartment(curDep.id); setSel(''); deps.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
                  }}>{L('삭제', 'Delete')}</button></>}
              </div>
              <label className="check"><input id="dep-children" type="checkbox" checked={children} onChange={(e) => setChildren(e.target.checked)} /><span>{L('하위 부서 포함', 'Include sub-departments')}</span></label>
              <div className="toolbar">
                <select id="dep-add-user" value={adding} onChange={(e) => setAdding(e.target.value)}>
                  <option value="">{L('사용자 추가…', 'Add a user…')}</option>
                  {(users.state === 'ok' ? users.data : []).filter((u) => !memberNames.has(u.username)).map((u) => <option key={u.username} value={u.username}>{u.display_name || u.username} ({u.username})</option>)}
                </select>
                <button type="button" className="btn small-btn" disabled={!adding || !current} onClick={addMember}>{L('추가', 'Add')}</button>
              </div>
              <LoadState value={members} retry={members.reload}>
                {(ms) => ms.length === 0 ? <p className="muted small">{L('소속 사용자가 없습니다.', 'No members.')}</p> : (
                  <table className="table compact-head">
                    <thead><tr><th>{L('사용자', 'User')}</th><th>{L('부서', 'Department')}</th><th className="actions" /></tr></thead>
                    <tbody>{ms.map((m) => (
                      <tr key={m.username}><td className="strong">{m.username}</td><td>{list.find((d) => d.id === m.department_id)?.name}</td>
                        <td className="actions"><button type="button" className="btn-ghost small-btn" onClick={() => removeMember(m.username)}>{L('빼기', 'Remove')}</button></td></tr>))}</tbody>
                  </table>)}
              </LoadState>
            </section>
          </div>
          {editing && <DepartmentDialog dep={editing === 'new' ? null : editing} all={list} parent={editing === 'new' ? current : undefined}
            onClose={() => setEditing(null)} onDone={() => { setEditing(null); deps.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

function DepartmentDialog({ dep, all, parent, onClose, onDone }: { dep: Department | null; all: Department[]; parent?: string; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [name, setName] = useState(dep?.name ?? '');
  const [parentId, setParentId] = useState(dep ? dep.parent_id ?? '' : parent ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await nextApi.saveDepartment(dep?.id ?? null, { name, parent_id: parentId || null }); onDone(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={dep ? L('부서 편집', 'Edit department') : L('부서 추가', 'Add department')} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy || !name.trim()} error={error}>
      <label><span>{L('이름', 'Name')}</span><input id="dep-name" value={name} maxLength={80} placeholder={L('예: 전자공학과', 'e.g. Electronics')} onChange={(e) => setName(e.target.value)} /></label>
      <label><span>{L('상위 부서', 'Parent')}</span>
        <select id="dep-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">{L('없음 (최상위)', 'None (top level)')}</option>
          {all.filter((d) => d.id !== dep?.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></label>
    </Dialog>
  );
}

// --- 가속 자원 > 보드 LAB(JTAG) ----------------------------------------------------

export function BoardsPage() {
  const { L, when } = useL();
  const boards = useLoad(nextApi.boards);
  const [editing, setEditing] = useState<Board | 'new' | null>(null);
  const [attaching, setAttaching] = useState<Board | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  return (
    <LoadState value={boards} retry={boards.reload}>
      {(list) => (
        <>
          <Intro>{L('FPGA 보드의 JTAG 케이블(USB)을 데스크톱 VM에 연결해, 보드 앞에 가지 않고 자리에서 시험합니다. 데스크톱은 보드가 꽂힌 노드에서 돌아야 합니다. 케이블이 여러 개면 포트 경로(1-4.2)로 지정하세요.',
            'Pass a board\'s JTAG cable (USB) through to a desktop VM so people test from their seat. The desktop must run on the board\'s node; use a port path (1-4.2) when several cables are alike.')}</Intro>
          <div className="toolbar">
            <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('보드 추가', 'Add board')}</button>
            <button type="button" className="btn" onClick={boards.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
          </div>
          <SettingsStatus items={[
            { label: L('보드', 'Boards'), value: String(list.length) },
            { label: L('연결됨', 'Attached'), value: String(list.filter((b) => b.attached_desktop).length), tone: 'ok' },
            { label: L('빈 보드', 'Free'), value: String(list.filter((b) => !b.attached_desktop).length) },
            { label: L('기한 대여', 'On a loan'), value: String(list.filter((b) => b.lease_until).length) },
          ]} />
          <NoticeBar notice={notice} />
          {list.length === 0 ? <div className="empty"><p>{L('등록된 보드가 없습니다.', 'No boards yet.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('보드', 'Board')}</th><th>{L('노드', 'Node')}</th><th>USB</th><th>{L('연결된 데스크톱', 'Desktop')}</th><th>{L('사용자', 'User')}</th><th>{L('연결 시각', 'Since')}</th><th>{L('반납 예정', 'Returns')}</th><th className="actions" /></tr></thead>
              <tbody>{list.map((b) => (
                <tr key={b.id}>
                  <td className="strong">{b.name}{b.kind && <div className="muted small">{b.kind}{b.notes ? ` · ${b.notes}` : ''}</div>}</td>
                  <td>{b.node}</td>
                  <td><code className="code">{b.usb}</code></td>
                  <td>{b.desktop ? b.desktop.name : <span className="chip chip-free">{L('비어 있음', 'free')}</span>}</td>
                  <td>{b.lease_user || b.desktop?.assigned_user || '-'}</td>
                  <td className="muted small">{when(b.attached_at)}</td>
                  <td className="small">{b.lease_until ? <span className="chip chip-accent">{when(b.lease_until)}</span> : <span className="muted">{b.attached_desktop ? L('기한 없음', 'no end') : '-'}</span>}</td>
                  <td className="actions">
                    {b.attached_desktop
                      ? <button type="button" className="btn small-btn" onClick={async () => { try { await nextApi.detachBoard(b.id); boards.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); } }}>{L('분리', 'Detach')}</button>
                      : <button type="button" className="btn small-btn primary" onClick={() => setAttaching(b)}>{L('연결', 'Attach')}</button>}
                    <button type="button" className="btn-ghost small-btn" disabled={!!b.attached_desktop} onClick={() => setEditing(b)}>{L('편집', 'Edit')}</button>
                    <button type="button" className="btn-ghost small-btn danger" disabled={!!b.attached_desktop} onClick={async () => {
                      if (!confirm(L(`'${b.name}'을(를) 지울까요?`, `Delete '${b.name}'?`))) return;
                      try { await nextApi.deleteBoard(b.id); boards.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
                    }}>{L('삭제', 'Delete')}</button>
                  </td>
                </tr>))}</tbody>
            </table></div>
          )}
          <p className="muted small">{L('연결은 데스크톱 VM의 USB 슬롯 usb4를 씁니다. 보드 전원을 껐다 켜면 분리 후 다시 연결하세요. 케이블이 불안정하면 보드 쪽 hw_server에 원격으로 붙는 방법도 있습니다.',
            'Attaching uses the desktop VM\'s usb4 slot. Re-attach after power-cycling a board. For flaky cables, connect to the board\'s hw_server over the network instead.')}</p>
          {editing && <BoardDialog board={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); boards.reload(); }} />}
          {attaching && <AttachDialog board={attaching} onClose={() => setAttaching(null)} onDone={() => { setAttaching(null); boards.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

function BoardDialog({ board, onClose, onDone }: { board: Board | null; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const clusters = useLoad(adminApi.clusters);
  const [cluster, setCluster] = useState(board?.cluster_id ?? '');
  const cid = cluster || (clusters.state === 'ok' ? clusters.data[0]?.id ?? '' : '');
  const nodes = useLoad(() => (cid ? adminApi.nodes(cid) : Promise.resolve([])), [cid]);
  const [name, setName] = useState(board?.name ?? '');
  const [node, setNode] = useState(board?.node ?? '');
  const [usbId, setUsbId] = useState(board?.usb ?? '');
  const [kind, setKind] = useState(board?.kind ?? '');
  const [notes, setNotes] = useState(board?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await nextApi.saveBoard(board?.id ?? null, { name, cluster_id: cid, node, usb: usbId.toLowerCase(), kind, notes }); onDone(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={board ? L('보드 편집', 'Edit board') : L('보드 추가', 'Add board')} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy || !name || !node || !usbId} error={error}>
      <label><span>{L('이름', 'Name')}</span><input id="brd-name" value={name} maxLength={80} placeholder="ZCU102 #1" onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-row form-row-wide">
        <label><span>{L('클러스터', 'Cluster')}</span>
          <select id="brd-cluster" value={cid} onChange={(e) => setCluster(e.target.value)}>{(clusters.state === 'ok' ? clusters.data : []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span>{L('꽂힌 노드', 'Node')}</span>
          <select id="brd-node" value={node} onChange={(e) => setNode(e.target.value)}>
            <option value="">{L('고르세요', 'Pick one')}</option>
            {(nodes.state === 'ok' ? nodes.data : []).map((n) => <option key={n.node} value={n.node}>{n.node}</option>)}
          </select></label>
      </div>
      <label><span>{L('USB (VID:PID 또는 포트 경로)', 'USB (vid:pid or port path)')}</span><input id="brd-usb" value={usbId} placeholder="03fd:0008 · 1-4.2" onChange={(e) => setUsbId(e.target.value.trim())} /></label>
      <label><span>{L('보드 종류', 'Kind')}</span><input id="brd-kind" value={kind} maxLength={80} placeholder="ZCU102 · VCK190 · KV260" onChange={(e) => setKind(e.target.value)} /></label>
      <label><span>{L('메모', 'Notes')}</span><input id="brd-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>
    </Dialog>
  );
}

function AttachDialog({ board, onClose, onDone }: { board: Board; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const desks = useLoad(adminApi.desktops);
  const [desk, setDesk] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = desks.state === 'ok' ? desks.data.filter((d) => (!d.cluster_id || d.cluster_id === board.cluster_id) && d.node === board.node) : [];
  const chosen = list.find((d) => d.id === desk);
  const later = (days: number) => { const t = new Date(Date.now() + days * 86400000); t.setHours(18, 0, 0, 0);
    return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  async function submit() {
    setBusy(true); setError(null);
    try { await nextApi.attachBoardFor(board.id, { desktop_id: desk, lease_user: chosen?.assigned_user ?? '', ...(until ? { lease_until: until } : {}) }); onDone(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L(`${board.name} 연결`, `Attach ${board.name}`)} onClose={onClose} onSubmit={submit} submitLabel={L('연결', 'Attach')} busy={busy || !desk} error={error}>
      <p className="muted small">{L(`${board.node} 노드의 데스크톱만 보입니다.`, `Desktops on ${board.node} only.`)}</p>
      <label><span>{L('데스크톱', 'Desktop')}</span>
        <select id="att-desk" value={desk} onChange={(e) => setDesk(e.target.value)}>
          <option value="">{L('고르세요', 'Pick one')}</option>
          {list.map((d) => <option key={d.id} value={d.id}>{d.name}{d.assigned_user ? ` · ${d.assigned_user}` : ''}</option>)}
        </select></label>
      <label><span>{L('대여 기간 (이때 자동으로 분리)', 'Loan ends (detached automatically)')}</span>
        <input id="att-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
      <div className="chip-row">
        {[1, 3, 7, 14].map((n) => <button key={n} type="button" className="btn-ghost small-btn" onClick={() => setUntil(later(n))}>{L(`${n}일`, `${n} d`)}</button>)}
        <button type="button" className="btn-ghost small-btn" onClick={() => setUntil('')}>{L('기한 없음', 'No end')}</button>
      </div>
      <p className="muted small">{L('기간이 끝나면 보드를 데스크톱에서 떼어 다음 사람이 쓸 수 있게 합니다.', 'When the loan ends the board comes off the desktop for the next person.')}</p>
    </Dialog>
  );
}

// --- 가속 자원 > 빌드 팜 -----------------------------------------------------------

export function BuildFarmPage() {
  const { L } = useL();
  const farm = useLoad(nextApi.buildfarm);
  return (
    <LoadState value={farm} retry={farm.reload}>
      {(pools) => (
        <>
          <Intro>{L('빌드 팜 풀(FPGA 빌드 VM)의 대수 · 사용 중 · 부하를 한눈에 봅니다. 빌드 VM은 풀 관리에서 만들고, 카드 대여처럼 기간을 정해 빌려 줍니다.',
            'The build farm pools (FPGA build VMs): size, use and load. Build VMs are made under 풀 관리 and lent like cards.')}</Intro>
          <div className="toolbar"><button type="button" className="btn" onClick={farm.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button></div>
          {pools.length === 0 ? <div className="empty"><p>{L('빌드 팜 풀이 없습니다. 풀 관리에서 종류를 "빌드 팜"으로 만드세요.', 'No build farm pools. Make one under 풀 관리 with type build farm.')}</p></div> : pools.map((p) => (
            <section key={p.id} className="panel">
              <h3 className="panel-title">{p.name}</h3>
              <SettingsStatus items={[
                { label: L('빌드 VM', 'Build VMs'), value: String(p.total) },
                { label: L('켜짐', 'On'), value: String(p.running) },
                { label: L('사용 중', 'In use'), value: String(p.in_use), tone: p.free === 0 ? 'warn' : 'ok' },
                { label: L('빈 VM', 'Free'), value: String(p.free) },
                { label: 'CPU', value: `${p.cpu_pct}%`, tone: p.cpu_pct > 85 ? 'warn' : undefined },
                { label: L('메모리', 'Memory'), value: `${Math.round(p.mem_used / GB)} / ${Math.round(p.mem_total / GB)} GB` },
              ]} />
              <div className="table-scroll"><table className="table compact-head">
                <thead><tr><th>{L('빌드 VM', 'Build VM')}</th><th>{L('상태', 'State')}</th><th>{L('사용자', 'User')}</th><th>CPU</th><th>{L('메모리', 'Memory')}</th></tr></thead>
                <tbody>{p.desktops.map((d) => (
                  <tr key={d.id}>
                    <td className="strong">{d.name}</td>
                    <td>{d.status === 'running' ? <span className="chip chip-on">{L('실행 중', 'running')}</span> : <span className="chip">{L('꺼짐', 'off')}</span>}{d.in_session && <span className="chip chip-accent" style={{ marginLeft: 4 }}>{L('접속 중', 'connected')}</span>}</td>
                    <td>{d.assigned_user ?? <span className="muted small">{L('빈 VM', 'free')}</span>}</td>
                    <td className="farm-cpu"><span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, d.cpu)}%` }} /></span><span className="muted small">{d.cpu}% · {d.maxcpu ?? '-'} vCPU</span></td>
                    <td className="muted small">{d.maxmem ? `${Math.round(d.mem / GB)} / ${Math.round(d.maxmem / GB)} GB` : '-'}</td>
                  </tr>))}</tbody>
              </table></div>
            </section>
          ))}
          {pools.length > 0 && <BuildJobsPanel pools={pools.map((p) => ({ id: p.id, name: p.name }))} admin />}
        </>
      )}
    </LoadState>
  );
}

const JOB_TONE: Record<JobStatus, string> = { queued: 'chip', running: 'chip chip-accent', done: 'chip chip-on', failed: 'chip chip-warn', cancelled: 'chip' };

// 빌드 작업 큐: commands that run on a free build VM, one job per VM, oldest first.
// Shared by the build farm page (every job, submit for anyone) and the portal (one's own).
export function BuildJobsPanel({ pools, admin = false }: { pools: { id: string; name: string; workdir?: string }[]; admin?: boolean }) {
  const { L, when } = useL();
  const jobs = useLoad(() => admin ? nextApi.buildJobs().then((r) => r.jobs) : nextApi.myJobs().then((r) => r.jobs), [admin]);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<BuildJob | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const S: Record<JobStatus, string> = { queued: L('대기', 'queued'), running: L('실행 중', 'running'), done: L('완료', 'done'), failed: L('실패', 'failed'), cancelled: L('취소', 'cancelled') };
  async function cancel(j: BuildJob) {
    try { await (admin ? nextApi.cancelJob(j.id) : nextApi.myCancelJob(j.id)); jobs.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  const list = jobs.state === 'ok' ? jobs.data : [];
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="stat-icon tone-green"><Icon name="list" size={18} /></span>
        <div>
          <h2 className="section-title">{L('빌드 작업 큐', 'Build job queue')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{L('합성 · 구현 같은 긴 빌드를 큐에 넣으면 빈 빌드 VM에서 차례로 돌립니다. 결과와 마지막 출력이 여기에 남습니다.',
            'Queue long builds (synthesis, implementation); they run on free build VMs in turn and leave their result and last output here.')}</p>
        </div>
        <div className="panel-actions">
          <button type="button" className="btn" onClick={jobs.reload}><Icon name="refresh" size={16} /></button>
          <button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{L('작업 넣기', 'Queue a job')}</button>
        </div>
      </div>
      <SettingsStatus items={(['queued', 'running', 'done', 'failed'] as JobStatus[]).map((k) => ({ label: S[k], value: String(list.filter((j) => j.status === k).length),
        tone: k === 'failed' && list.some((j) => j.status === 'failed') ? 'warn' as const : k === 'running' ? 'ok' as const : undefined }))} />
      <NoticeBar notice={notice} />
      {list.length === 0 ? <div className="empty"><p>{L('작업이 없습니다.', 'No jobs.')}</p></div> : (
        <div className="table-scroll"><table className="table compact-head">
          <thead><tr><th>{L('작업', 'Job')}</th>{admin && <th>{L('사용자', 'User')}</th>}<th>{L('상태', 'State')}</th><th>{L('빌드 VM', 'Build VM')}</th><th>{L('넣은 시각', 'Queued')}</th><th>{L('끝난 시각', 'Finished')}</th><th className="actions" /></tr></thead>
          <tbody>{list.map((j) => (
            <tr key={j.id}>
              <td className="strong">{j.name}<div className="muted small"><code className="code">{j.command}</code></div></td>
              {admin && <td>{j.username}</td>}
              <td><span className={JOB_TONE[j.status]}>{S[j.status]}{j.exit_code !== null && j.status !== 'done' ? ` · ${j.exit_code}` : ''}</span></td>
              <td>{j.desktop ?? <span className="muted small">-</span>}</td>
              <td className="muted small">{when(j.created_at)}</td>
              <td className="muted small">{when(j.finished_at)}</td>
              <td className="actions">
                {(j.output || j.error) && <button type="button" className="btn-ghost small-btn" onClick={() => setOpen(j)}>{L('출력', 'Output')}</button>}
                {j.status === 'queued' && <button type="button" className="btn-ghost small-btn danger" onClick={() => cancel(j)}>{L('취소', 'Cancel')}</button>}
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
      {adding && <JobDialog pools={pools} admin={admin} onClose={() => setAdding(false)} onDone={() => { setAdding(false); jobs.reload(); setNotice({ kind: 'info', text: L('큐에 넣었습니다. 빈 빌드 VM이 생기면 시작합니다.', 'Queued; it starts on the next free build VM.') }); }} />}
      {open && (
        <Dialog open title={L(`${open.name} 출력`, `${open.name}: output`)} onClose={() => setOpen(null)}>
          <p className="muted small">{open.desktop} · {L('종료 코드', 'exit code')} {open.exit_code ?? '-'}</p>
          <pre className="job-output">{open.error || open.output}</pre>
        </Dialog>
      )}
    </section>
  );
}

function JobDialog({ pools, admin, onClose, onDone }: { pools: { id: string; name: string; workdir?: string }[]; admin: boolean; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const [pool, setPool] = useState(pools[0]?.id ?? '');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  // 공유 저장소: left empty, the engine starts the job in <the user's scratch>/<job id>, as the user
  const folderOf = (id: string) => pools.find((p) => p.id === id)?.workdir ?? '';
  const [workdir, setWorkdir] = useState('');
  const [user, setUser] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const b = { pool_id: pool, name, command, workdir, ...(admin && user ? { username: user } : {}) };
      await (admin ? nextApi.submitJob(b) : nextApi.mySubmitJob(b)); onDone();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={L('빌드 작업 넣기', 'Queue a build job')} onClose={onClose} onSubmit={submit} submitLabel={L('큐에 넣기', 'Queue')} busy={busy || !pool || !name || !command} error={error}>
      <label><span>{L('빌드 팜', 'Build farm')}</span>
        <select id="job-pool" value={pool} onChange={(e) => setPool(e.target.value)}>{pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label><span>{L('작업 이름', 'Name')}</span><input id="job-name" value={name} maxLength={80} placeholder={L('예: zcu102 비트스트림', 'e.g. zcu102 bitstream')} onChange={(e) => setName(e.target.value)} /></label>
      <label><span>{L('명령', 'Command')}</span><input id="job-cmd" value={command} maxLength={2000} placeholder="vivado -mode batch -source build.tcl" onChange={(e) => setCommand(e.target.value)} /></label>
      <div className="form-row form-row-wide">
        <label><span>{L('작업 폴더 (빌드 VM 안)', 'Folder (on the build VM)')}</span><input id="job-dir" value={workdir} placeholder={folderOf(pool) ? `${folderOf(pool)}/<${L('작업 ID', 'job id')}>` : '/proj/zcu102'} onChange={(e) => setWorkdir(e.target.value.trim())} />
          {folderOf(pool) && <small className="muted">{L(`비워 두면 내 스크래치 폴더 아래 작업마다 새 폴더(${folderOf(pool)}/작업 ID)에서 내 권한으로 실행합니다. 스크래치는 백업되지 않습니다.`,
            `Left empty, each job runs as you in a new folder under your scratch (${folderOf(pool)}/<job id>). Scratch is not backed up.`)}</small>}</label>
        {admin && <label><span>{L('사용자 (선택)', 'For user (optional)')}</span><input id="job-user" value={user} placeholder="alice" onChange={(e) => setUser(e.target.value.trim())} /></label>}
      </div>
      <p className="muted small">{L('빌드 VM에는 게스트 에이전트가 있어야 하고, 프로젝트 폴더는 공유 저장소에 두세요(풀 정책 > 공유 저장소를 켜면 시작 전에 마운트를 확인합니다). 출력은 마지막 8KB만 남습니다.',
        'Build VMs need the guest agent; keep projects on shared storage (pool policy > shared storage mounts it before the job starts). Only the last 8 KB of output is kept.')}</p>
    </Dialog>
  );
}

// --- 가속 자원 > 카드 사용 보고서 ---------------------------------------------------

export function CardUsagePage() {
  const { L } = useL();
  const [days, setDays] = useState(30);
  const report = useLoad(() => nextApi.cardReport(days), [days]);
  function csv(rows: CardRow[]) {
    const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const text = '\ufeff' + ['card,loans,hours,use_pct,users,lent_now', ...rows.map((r) => [q(r.card), r.loans, r.hours, r.use_pct, q(r.users.join(' ')), r.active].join(','))].join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `card-usage-${days}d.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return (
    <LoadState value={report} retry={report.reload}>
      {(r) => (
        <>
          <Intro>{L('가속 카드(FPGA · NPU · GPU)마다 누가 얼마나 빌려 썼는지 봅니다. 사용률은 기간 전체 시간 대비 대여된 시간입니다. 예산 · 증설 근거로 CSV를 받아 쓰세요.',
            'Who borrowed each accelerator card and for how long. Use % is loan hours over the whole period. Download the CSV for budgets and expansion plans.')}</Intro>
          <div className="toolbar">
            <div className="seg" role="group">
              {[7, 30, 90].map((d) => <button key={d} type="button" className={`seg-btn${days === d ? ' on' : ''}`} onClick={() => setDays(d)}>{L(`${d}일`, `${d} days`)}</button>)}
            </div>
            <button type="button" className="btn" onClick={() => csv(r.cards)} disabled={r.cards.length === 0}><Icon name="download" size={16} />CSV</button>
          </div>
          <SettingsStatus items={[
            { label: L('카드', 'Cards'), value: String(r.cards.length) },
            { label: L('대여 건수', 'Loans'), value: String(r.cards.reduce((a, c) => a + c.loans, 0)) },
            { label: L('총 대여 시간', 'Loan hours'), value: `${r.total_hours} h` },
            { label: L('지금 대여 중', 'Lent now'), value: String(r.cards.reduce((a, c) => a + c.active, 0)), tone: 'ok' },
          ]} />
          {r.cards.length === 0 ? <div className="empty"><p>{L('이 기간에 대여 기록이 없습니다.', 'No loans in this period.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('카드', 'Card')}</th><th className="num">{L('대여', 'Loans')}</th><th className="num">{L('시간', 'Hours')}</th><th>{L('사용률', 'Use')}</th><th>{L('사용자', 'Users')}</th><th>{L('지금', 'Now')}</th></tr></thead>
              <tbody>{r.cards.map((c) => (
                <tr key={c.card}>
                  <td className="strong">{c.card}<div className="muted small"><code className="code">{c.resource_id}</code></div></td>
                  <td className="num">{c.loans}</td>
                  <td className="num">{c.hours}</td>
                  <td className="farm-cpu"><span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, c.use_pct)}%` }} /></span><span className="muted small">{c.use_pct}%</span></td>
                  <td className="small">{c.users.join(', ')}</td>
                  <td>{c.active ? <span className="chip chip-accent">{L('대여 중', 'lent')}</span> : <span className="muted small">-</span>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </>
      )}
    </LoadState>
  );
}

// --- 가속 자원 > 라이선스 서버 -----------------------------------------------------

export function LicenseServersPage() {
  const { L, when } = useL();
  const servers = useLoad(nextApi.licenseServers);
  const [editing, setEditing] = useState<LicenseServer | 'new' | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const ha = useHaRegister((text, ok) => { setNotice({ kind: ok ? 'info' : 'error', text }); if (ok) servers.reload(); });
  async function check(s: LicenseServer) {
    setChecking(s.id);
    try { const r = await nextApi.checkLicense(s.id); servers.reload(); setNotice({ kind: r.ok ? 'info' : 'error', text: r.ok ? L(`${s.name}: 모든 포트가 응답합니다.`, `${s.name}: every port answers.`) : L(`${s.name}: 응답하지 않는 포트가 있습니다.`, `${s.name}: a port does not answer.`) }); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); } finally { setChecking(null); }
  }
  return (
    <LoadState value={servers} retry={servers.reload}>
      {(list) => (
        <>
          <Intro>{L('설계 툴(FlexLM · FlexNet)과 vGPU 라이선스 서버를 등록하고 포트가 응답하는지 확인합니다. 라이선스 서버 VM은 MAC을 고정하고 Proxmox HA에 올려 두세요. MOAVI Desk는 라이선스 파일 · 키를 다루지 않습니다.',
            'Register design-tool (FlexLM/FlexNet) and vGPU licence servers and check their ports. Keep the VM\'s MAC fixed and put it under Proxmox HA. MOAVI Desk never handles licence files or keys.')}</Intro>
          <div className="toolbar">
            <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('라이선스 서버 추가', 'Add licence server')}</button>
            <button type="button" className="btn" onClick={servers.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
          </div>
          <SettingsStatus items={[
            { label: L('라이선스 서버', 'Servers'), value: String(list.length) },
            { label: L('정상', 'OK'), value: String(list.filter((s) => s.last_ok === 1).length), tone: 'ok' },
            { label: L('문제', 'Problem'), value: String(list.filter((s) => s.last_ok === 0).length), tone: list.some((s) => s.last_ok === 0) ? 'warn' : undefined },
            { label: L('HA 등록', 'Under HA'), value: String(list.filter((s) => s.vm_ha).length) },
            { label: L('자동 감시', 'Watched'), value: String(list.filter((s) => s.watch).length) },
          ]} />
          <p className="muted small">{L('자동 감시를 켠 서버는 5분마다 포트를 확인하고, 응답이 없으면 알림 채널(웹훅 · 메일)로 한 번 알리고 다시 살아나면 또 알립니다.',
            'Watched servers are checked every 5 minutes; when one stops answering the alert channels (webhook, mail) hear once, and again when it is back.')}</p>
          <NoticeBar notice={notice} />
          {list.length === 0 ? <div className="empty"><p>{L('등록된 라이선스 서버가 없습니다.', 'No licence servers yet.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('이름', 'Name')}</th><th>{L('주소', 'Host')}</th><th>{L('포트', 'Ports')}</th><th>VM</th><th>{L('고정 MAC', 'Fixed MAC')}</th><th>{L('마지막 확인', 'Checked')}</th><th className="actions" /></tr></thead>
              <tbody>{list.map((s) => (
                <tr key={s.id}>
                  <td className="strong">{s.name}{s.watch ? <span className="chip chip-on" style={{ marginLeft: 6 }}>{L('감시', 'watched')}</span> : null}
                    {s.alerted_at && <span className="chip chip-warn" style={{ marginLeft: 4 }}>{L(`알림 보냄 ${when(s.alerted_at)}`, `alerted ${when(s.alerted_at)}`)}</span>}
                    {s.notes && <div className="muted small">{s.notes}</div>}</td>
                  <td><code className="code">{s.host}</code></td>
                  <td>{s.ports.map((p) => {
                    const d = s.last_detail.find((x) => x.port === p);
                    return <span key={p} className={`chip ${d ? (d.ok ? 'chip-on' : 'chip-warn') : ''}`} style={{ marginRight: 4 }}>{p}{d ? (d.ok ? ` · ${d.ms} ms` : ` · ${L('응답 없음', 'down')}`) : ''}</span>;
                  })}</td>
                  <td className="nowrap">{s.vmid ? <>{s.vmid} <span className="muted small">{s.vm_status}{s.vm_ha ? ' · HA' : ''}</span>
                    {s.cluster_id && !s.vm_ha && <button type="button" className="btn-ghost small-btn" disabled={ha.busy === s.id}
                      title={L('노드가 멈추면 다른 노드에서 이 VM을 다시 켭니다', 'Restarts this VM on another node when its node stops')}
                      onClick={() => ha.register(s.id, s.cluster_id, s.vmid!, s.name)}>{L('HA 등록', 'Add to HA')}</button>}</> : '-'}</td>
                  <td>{s.fixed_mac ? <code className="code">{s.fixed_mac}</code> : '-'}</td>
                  <td className="muted small">{when(s.last_check)}</td>
                  <td className="actions">
                    <button type="button" className="btn-ghost small-btn" disabled={checking === s.id} onClick={() => check(s)}>{L('포트 확인', 'Check')}</button>
                    <button type="button" className="btn-ghost small-btn" onClick={() => setEditing(s)}>{L('편집', 'Edit')}</button>
                    <button type="button" className="btn-ghost small-btn danger" onClick={async () => {
                      if (!confirm(L(`'${s.name}'을(를) 지울까요?`, `Delete '${s.name}'?`))) return;
                      try { await nextApi.deleteLicense(s.id); servers.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
                    }}>{L('삭제', 'Delete')}</button>
                  </td>
                </tr>))}</tbody>
            </table></div>
          )}
          {editing && <LicenseDialog server={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); servers.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

function LicenseDialog({ server, onClose, onDone }: { server: LicenseServer | null; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const clusters = useLoad(adminApi.clusters);
  const [name, setName] = useState(server?.name ?? '');
  const [host, setHost] = useState(server?.host ?? '');
  const [ports, setPorts] = useState(server ? server.ports.join(', ') : '2100, 27000');
  const [cluster, setCluster] = useState(server?.cluster_id ?? '');
  const [vmid, setVmid] = useState(server?.vmid ? String(server.vmid) : '');
  const [mac, setMac] = useState(server?.fixed_mac ?? '');
  const [notes, setNotes] = useState(server?.notes ?? '');
  const [watch, setWatch] = useState(server ? server.watch !== 0 : true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await nextApi.saveLicense(server?.id ?? null, { name, host, ports, cluster_id: vmid ? cluster : '', vmid: vmid ? Number(vmid) : null, fixed_mac: mac, notes, watch }); onDone(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={server ? L('라이선스 서버 편집', 'Edit licence server') : L('라이선스 서버 추가', 'Add licence server')} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy || !name || !host || !ports} error={error}>
      <label><span>{L('이름', 'Name')}</span><input id="lic-name" value={name} maxLength={80} placeholder={L('예: 설계 툴 라이선스 (FlexLM)', 'e.g. design tools (FlexLM)')} onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-row form-row-wide">
        <label><span>{L('주소 (도메인 또는 IP)', 'Host')}</span><input id="lic-host" value={host} placeholder="lic01.example.com" onChange={(e) => setHost(e.target.value.trim())} /></label>
        <label><span>{L('포트 (쉼표로)', 'Ports (comma separated)')}</span><input id="lic-ports" value={ports} onChange={(e) => setPorts(e.target.value)} /></label>
      </div>
      <div className="form-row form-row-wide">
        <label><span>{L('VM 클러스터 (선택)', 'VM cluster (optional)')}</span>
          <select id="lic-cluster" value={cluster} onChange={(e) => setCluster(e.target.value)}>
            <option value="">{L('없음', 'None')}</option>
            {(clusters.state === 'ok' ? clusters.data : []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label><span>VMID</span><input id="lic-vmid" type="number" min={100} value={vmid} disabled={!cluster} onChange={(e) => setVmid(e.target.value)} /></label>
      </div>
      <label><span>{L('고정 MAC (라이선스 호스트 ID)', 'Fixed MAC (licence host id)')}</span><input id="lic-mac" value={mac} placeholder="52:54:00:12:34:56" onChange={(e) => setMac(e.target.value.trim())} /></label>
      <label><span>{L('메모', 'Notes')}</span><input id="lic-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>
      <label className="check"><input id="lic-watch" type="checkbox" checked={watch} onChange={(e) => setWatch(e.target.checked)} /><span>{L('자동 감시 (5분마다 확인, 끊기면 알림)', 'Watch (check every 5 min, alert when down)')}</span></label>
    </Dialog>
  );
}

// --- 운영 > 플랫폼 설정 > 클라이언트 -------------------------------------------------

export function ClientSettingsPage() {
  const data = useLoad(nextApi.clientSettings);
  return (
    <>
      <LoadState value={data} retry={data.reload}>
        {(c) => <ClientForm initial={c} onSaved={data.reload} />}
      </LoadState>
      <TerminalInstallPanel />
    </>
  );
}

function ClientForm({ initial, onSaved }: { initial: ClientSettings; onSaved: () => void }) {
  const { L } = useL();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  async function save() {
    setBusy(true); setNotice(null);
    try { await nextApi.saveClientSettings(v); setNotice({ kind: 'info', text: L('저장했습니다. 클라이언트가 다음 로그인 때 읽습니다.', 'Saved. Clients read it at their next sign-in.') }); onSaved(); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); } finally { setBusy(false); }
  }
  return (
    <section className="panel settings-narrow">
      <h3 className="panel-title">{L('MOAVI Desk 클라이언트 (Windows)', 'MOAVI Desk Client (Windows)')}</h3>
      <p className="muted small">{L('설치형 클라이언트가 로그인할 때 읽는 값입니다. 최신 버전보다 낮으면 다운로드를 안내하고, 최소 버전보다 낮으면 로그인을 막습니다. 다운로드 주소를 비우면 작업 공간의 "MOAVI Desk Client 받기"는 GitHub 최신 릴리스를 엽니다.',
        'What the installed client reads at sign-in: below the latest it offers the download, below the minimum it refuses to sign in. With no download URL the workspace button opens the latest GitHub release.')}</p>
      <div className="form-row form-row-wide">
        <label><span>{L('최신 버전', 'Latest version')}</span><input id="cl-latest" value={v.latest_version} placeholder="0.9.0" onChange={(e) => setV({ ...v, latest_version: e.target.value.trim() })} /></label>
        <label><span>{L('최소 버전', 'Minimum version')}</span><input id="cl-min" value={v.min_version} placeholder="0.9.0" onChange={(e) => setV({ ...v, min_version: e.target.value.trim() })} /></label>
      </div>
      <label><span>{L('다운로드 주소 (MSI)', 'Download URL (MSI)')}</span><input id="cl-url" value={v.download_url} placeholder="https://github.com/dskim1979/moavi-desk/releases/latest" onChange={(e) => setV({ ...v, download_url: e.target.value.trim() })} /></label>
      <label><span>{L('기본 접속 방식', 'Default protocol')}</span>
        <select id="cl-proto" value={v.protocol} onChange={(e) => setV({ ...v, protocol: e.target.value as ClientSettings['protocol'] })}>
          <option value="auto">{L('자동 (SPICE → VNC)', 'Auto (SPICE then VNC)')}</option><option value="spice">SPICE</option><option value="vnc">VNC</option>
        </select></label>
      <NoticeBar notice={notice} />
      <div className="toolbar"><button type="button" className="btn primary" disabled={busy} onClick={save}>{L('저장', 'Save')}</button></div>
    </section>
  );
}
