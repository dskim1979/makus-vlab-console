import { artifactUrl, downloadArtifact } from '../../api/builds';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { envApi } from '../../api/envmig';
import { nextApi } from '../../api/next';
import { BOARD_PORTS } from '../../api/next';
import { jtagApi } from '../../api/jtag';
import { GatewayStateChip } from './JtagGatewayPages';
import type { Board, BoardProtocol, BoardTarget, BuildJob, CardRow, ClientSettings, Department, ExternalDesktop, GoldenImage, JobPool, JobStatus, LicenseServer, RolloutResult, Signup, SignupSettings, SignupStatus, UsbCategory, UsbDevice, VerifyMode } from '../../api/next';
import { researchApi, waitText } from '../../api/research';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { SettingsStatus } from '../../components/SettingsShell';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { LicenseSeatsPanel, modeLabel } from './LicenseSeats';
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
  const envs = useLoad(envApi.environments);
  const envOf = (id: string) => (envs.state === 'ok' ? envs.data.environments.find((e) => e.golden_id === id) : undefined);
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
                  {(envOf(g.id)?.highlights.length ?? 0) > 0 && (
                    <Link className="chip-row env-highlights" to="/admin/vms/environments" title={L('환경 카탈로그에서 보기', 'Open in the environment catalogue')}>
                      {envOf(g.id)!.highlights.map((h) => <span key={h} className="chip chip-accent">{h}</span>)}
                    </Link>
                  )}
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
  const [editing, setEditing] = useState<ExternalDesktop | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  return (
    <LoadState value={exts} retry={exts.reload}>
      {(list) => (
        <>
          <Intro>{L('실제 PC(측정 장비 PC, 워크스테이션)를 사용자에게 배정합니다. 보안 게이트웨이가 켜져 있으면 그곳을 거칩니다.',
            'Physical PCs assigned to users. With the security gateway on, connections go through it.')}</Intro>
          <div className="toolbar">
            <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('외부 데스크톱 추가', 'Add external desktop')}</button>
          </div>
          <SettingsStatus items={[
            { label: L('외부 데스크톱', 'External desktops'), value: String(list.length) },
            { label: L('배정됨', 'Assigned'), value: String(list.filter((e) => e.assigned_user).length), tone: 'ok' },
            { label: L('배정 대기', 'Unassigned'), value: String(list.filter((e) => !e.assigned_user).length) },
          ]} />
          <NoticeBar notice={notice} />
          {list.length === 0 ? <div className="empty"><p>{L('등록된 외부 데스크톱이 없습니다.', 'No external desktops yet.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('이름', 'Name')}</th><th>{L('주소', 'Address')}</th><th>{L('사용자', 'User')}</th><th>{L('메모', 'Notes')}</th><th className="actions" /></tr></thead>
              <tbody>{list.map((e) => (
                <tr key={e.id}>
                  <td className="strong">{e.name}</td>
                  <td><code className="code">{e.address}:{e.port}</code></td>
                  <td>{e.assigned_user ?? <span className="chip chip-free">{L('배정 안 됨', 'unassigned')}</span>}</td>
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
          {editing && <ExternalDialog ext={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); exts.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

function ExternalDialog({ ext, onClose, onDone }: { ext: ExternalDesktop | null; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const users = useLoad(adminApi.users);
  const [name, setName] = useState(ext?.name ?? '');
  const [address, setAddress] = useState(ext?.address ?? '');
  const [port, setPort] = useState(ext?.port ?? 3389);
  const [user, setUser] = useState(ext?.assigned_user ?? '');
  const [notes, setNotes] = useState(ext?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await nextApi.saveExternal(ext?.id ?? null, { name, address, port, assigned_user: user || null, notes }); onDone(); }
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
  const users = useLoad(adminApi.users);
  const [manager, setManager] = useState(dep?.manager ?? '');
  const [name, setName] = useState(dep?.name ?? '');
  const [parentId, setParentId] = useState(dep ? dep.parent_id ?? '' : parent ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { await nextApi.saveDepartment(dep?.id ?? null, { name, parent_id: parentId || null, manager }); onDone(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open title={dep ? L('부서 편집', 'Edit department') : L('부서 추가', 'Add department')} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy || !name.trim()} error={error}>
      <label><span>{L('이름', 'Name')}</span><input id="dep-name" value={name} maxLength={80} placeholder={L('예: 전자공학과', 'e.g. Electronics')} onChange={(e) => setName(e.target.value)} /></label>
      <label><span>{L('상위 부서', 'Parent')}</span>
        <select id="dep-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">{L('없음 (최상위)', 'None (top level)')}</option>
          {all.filter((d) => d.id !== dep?.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></label>
      <label><span>{L('책임자', 'Manager')}</span>
        <select id="dep-manager" value={manager} onChange={(e) => setManager(e.target.value)}>
          <option value="">{L('없음 (상위 부서의 책임자)', 'None (the parent’s manager)')}</option>
          {manager && !(users.state === 'ok' && users.data.some((u) => u.username === manager)) && <option value={manager}>{manager}</option>}
          {(users.state === 'ok' ? users.data : []).map((u) => <option key={u.username} value={u.username}>{u.display_name || u.username} ({u.username})</option>)}
        </select>
        <small className="muted">{L('부서 GPU 할당량이 경고 비율이나 100%에 닿으면 메일을 받습니다.', "Gets a mail when the department's GPU quota reaches its warning share or 100%.")}</small></label>
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
          <Intro>{L('FPGA 보드의 JTAG를 데스크톱에 빌려줘, 보드 앞에 가지 않고 자리에서 시험합니다. 권장: 네트워크 — 케이블을 랩 서버에 꽂고 hw_server · XVC · Quartus jtagd로 공유하면 VM 설정을 바꾸지 않고 RDP · Warpgate · SPICE 어디서나 씁니다. USB 패스스루는 데스크톱이 보드가 꽂힌 노드에서 돌아야 하고, 케이블이 여러 개면 포트 경로(1-4.2)로 지정합니다.',
            'Lend a board\'s JTAG to a desktop so people test from their seat. Recommended: network - plug the cable into a lab server and share it with hw_server, XVC or Quartus jtagd; the VM is not changed and it works over RDP, Warpgate or SPICE. USB passthrough needs the desktop on the board\'s node; use a port path (1-4.2) when several cables are alike.')}</Intro>
          <div className="toolbar">
            <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{L('보드 추가', 'Add board')}</button>
            <button type="button" className="btn" onClick={boards.reload}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
          </div>
          <SettingsStatus items={[
            { label: L('보드', 'Boards'), value: String(list.length) },
            { label: L('연결됨', 'Attached'), value: String(list.filter((b) => b.attached_desktop).length), tone: 'ok' },
            { label: L('빈 보드', 'Free'), value: String(list.filter((b) => !b.attached_desktop).length) },
            { label: L('기한 대여', 'On a loan'), value: String(list.filter((b) => b.lease_until).length) },
            { label: L('네트워크', 'Network'), value: String(list.filter((b) => b.target === 'network').length) },
          ]} />
          <NoticeBar notice={notice} />
          {list.length === 0 ? <div className="empty"><p>{L('등록된 보드가 없습니다.', 'No boards yet.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('보드', 'Board')}</th><th>{L('방식', 'Kind')}</th><th>{L('노드 · 게이트웨이', 'Node / gateway')}</th><th>{L('USB · 주소', 'USB / address')}</th><th>{L('연결된 데스크톱', 'Desktop')}</th><th>{L('사용자', 'User')}</th><th>{L('연결 시각', 'Since')}</th><th>{L('반납 예정', 'Returns')}</th><th className="actions" /></tr></thead>
              <tbody>{list.map((b) => (
                <tr key={b.id}>
                  <td className="strong">{b.name}{b.kind && <div className="muted small">{b.kind}{b.notes ? ` · ${b.notes}` : ''}</div>}</td>
                  <td>{b.target === 'network'
                    ? <span className="chip chip-accent">{L('네트워크', 'Network')} · {PROTO_TEXT[(b.protocol || 'hw_server') as BoardProtocol]}</span>
                    : <span className="chip">USB</span>}</td>
                  <td>{b.target === 'network'
                    ? (b.gateway ? <>{b.gateway.name} <GatewayStateChip state={b.gateway.state} /></> : <span className="muted">-</span>)
                    : b.node}</td>
                  <td>{b.target === 'network'
                    ? <><code className="code">{b.connection?.endpoint ?? `${b.host}:${b.port ?? ''}`}</code>
                      {b.cable_serial && <div className="small">{L('케이블', 'cable')} <code className="code">{b.cable_serial}</code></div>}
                      {b.connection?.uart && <div className="muted small">UART {b.connection.uart}</div>}
                      {b.label && <div className="muted small">{b.label}</div>}</>
                    : <code className="code">{b.usb}</code>}</td>
                  <td>{b.desktop ? b.desktop.name : <span className="chip chip-free">{L('비어 있음', 'free')}</span>}</td>
                  <td>{b.lease_user || b.desktop?.assigned_user || '-'}</td>
                  <td className="muted small">{when(b.attached_at)}</td>
                  <td className="small">{b.lease_until ? <span className="chip chip-accent">{when(b.lease_until)}</span> : <span className="muted">{b.attached_desktop ? L('기한 없음', 'no end') : '-'}</span>}</td>
                  <td className="actions">
                    {b.attached_desktop
                      ? <button type="button" className="btn small-btn" onClick={async () => { try { await nextApi.detachBoard(b.id); boards.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); } }}>{L('분리', 'Detach')}</button>
                      : <button type="button" className="btn small-btn primary" disabled={b.available === false}
                          title={b.available === false ? L('JTAG 게이트웨이가 응답하지 않아 대여할 수 없습니다.', 'The JTAG gateway is down; the board cannot be lent.') : undefined}
                          onClick={() => setAttaching(b)}>{L('연결', 'Attach')}</button>}
                    <button type="button" className="btn-ghost small-btn" disabled={!!b.attached_desktop} onClick={() => setEditing(b)}>{L('편집', 'Edit')}</button>
                    <button type="button" className="btn-ghost small-btn danger" disabled={!!b.attached_desktop} onClick={async () => {
                      if (!confirm(L(`'${b.name}'을(를) 지울까요?`, `Delete '${b.name}'?`))) return;
                      try { await nextApi.deleteBoard(b.id); boards.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
                    }}>{L('삭제', 'Delete')}</button>
                  </td>
                </tr>))}</tbody>
            </table></div>
          )}
          <p className="muted small">{L('USB 보드는 데스크톱 VM의 USB 슬롯 usb4를 씁니다(보드 전원을 껐다 켜면 분리 후 다시 연결). 네트워크 보드는 VM을 바꾸지 않고 대여만 기록해 사용자 포털에 host:port와 사용법을 보여 줍니다. 데스크톱 VM이 케이블 호스트의 그 포트에 닿도록 방화벽 허용(데스크톱 → 랩 서버)을 더하고, 케이블 호스트는 연구자 자리 PC보다 인프라/랩 존의 공용 서버에 두세요. hw_server · XVC에는 인증이 없습니다.',
            'USB boards use the desktop VM\'s usb4 slot (re-attach after power-cycling a board). Network boards leave the VM alone: the loan is recorded and the user\'s portal shows host:port and how to connect. Allow desktop VMs to reach the cable host\'s port (desktop -> lab server) and keep the cable host on a shared lab server rather than a researcher\'s own PC. hw_server and XVC have no authentication.')}</p>
          {editing && <BoardDialog board={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); boards.reload(); }} />}
          {attaching && <AttachDialog board={attaching} onClose={() => setAttaching(null)} onDone={() => { setAttaching(null); boards.reload(); }} />}
        </>
      )}
    </LoadState>
  );
}

const PROTO_TEXT: Record<BoardProtocol, string> = { hw_server: 'hw_server', xvc: 'XVC', quartus: 'Quartus jtagd' };

function BoardDialog({ board, onClose, onDone }: { board: Board | null; onClose: () => void; onDone: () => void }) {
  const { L } = useL();
  const clusters = useLoad(adminApi.clusters);
  const [cluster, setCluster] = useState(board?.cluster_id ?? '');
  const cid = cluster || (clusters.state === 'ok' ? clusters.data[0]?.id ?? '' : '');
  const nodes = useLoad(() => (cid ? adminApi.nodes(cid) : Promise.resolve([])), [cid]);
  const [name, setName] = useState(board?.name ?? '');
  const [target, setTarget] = useState<BoardTarget>(board?.target ?? 'network');
  const [node, setNode] = useState(board?.node ?? '');
  const [usbId, setUsbId] = useState(board?.usb ?? '');
  const [host, setHost] = useState(board?.host ?? '');
  const [protocol, setProtocol] = useState<BoardProtocol>((board?.protocol || 'hw_server') as BoardProtocol);
  const [port, setPort] = useState(board?.port ? String(board.port) : '');
  const [label, setLabel] = useState(board?.label ?? '');
  const [kind, setKind] = useState(board?.kind ?? '');
  const [notes, setNotes] = useState(board?.notes ?? '');
  const gateways = useLoad(jtagApi.list);
  const gwList = gateways.state === 'ok' ? gateways.data.filter((g) => g.cluster_id === cid) : [];
  // '' = a cable host address of its own; otherwise the JTAG gateway VM the cable is on
  const [gatewayId, setGatewayId] = useState(board ? board.gateway_id ?? '' : 'auto');
  const gid = gatewayId === 'auto' ? gwList[0]?.id ?? '' : gatewayId;
  const gw = gwList.find((g) => g.id === gid);
  const [serial, setSerial] = useState(board?.cable_serial ?? '');
  const [uart, setUart] = useState(board?.uart_port ? String(board.uart_port) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    const net = { name, cluster_id: cid, node: '', usb: '', kind, notes, target, protocol, label, cable_serial: serial.trim(), uart_port: uart ? Number(uart) : null };
    const body = target === 'usb'
      ? { name, cluster_id: cid, node, usb: usbId.toLowerCase(), kind, notes, target }
      : gid
        ? { ...net, gateway_id: gid, port: protocol === 'xvc' ? (port ? Number(port) : BOARD_PORTS.xvc) : null }
        : { ...net, host: host.trim(), port: port ? Number(port) : BOARD_PORTS[protocol] };
    try { await nextApi.saveBoard(board?.id ?? null, body); onDone(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  const ready = !!name && (target === 'usb' ? !!node && !!usbId : gid ? (protocol !== 'hw_server' || !!serial.trim()) : !!host.trim());
  const freeCables = (gw?.cables ?? []).filter((c) => c.jtag && c.serial && (!c.board || c.serial === board?.cable_serial));
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 5);
  return (
    <Dialog open title={board ? L('보드 편집', 'Edit board') : L('보드 추가', 'Add board')} onClose={onClose} onSubmit={submit} submitLabel={L('저장', 'Save')} busy={busy || !ready} error={error}>
      <label><span>{L('이름', 'Name')}</span><input id="brd-name" value={name} maxLength={80} placeholder="ZCU102 #1" onChange={(e) => setName(e.target.value)} /></label>
      <div className="segmented" role="tablist">
        <button type="button" role="tab" id="brd-target-network" className={target === 'network' ? 'on' : ''} aria-selected={target === 'network'} onClick={() => setTarget('network')}>{L('네트워크 JTAG (권장)', 'Network JTAG (recommended)')}</button>
        <button type="button" role="tab" id="brd-target-usb" className={target === 'usb' ? 'on' : ''} aria-selected={target === 'usb'} onClick={() => setTarget('usb')}>{L('USB 패스스루', 'USB passthrough')}</button>
      </div>
      <div className="form-row form-row-wide">
        <label><span>{L('클러스터', 'Cluster')}</span>
          <select id="brd-cluster" value={cid} onChange={(e) => setCluster(e.target.value)}>{(clusters.state === 'ok' ? clusters.data : []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {target === 'usb' && <label><span>{L('꽂힌 노드', 'Node')}</span>
          <select id="brd-node" value={node} onChange={(e) => setNode(e.target.value)}>
            <option value="">{L('고르세요', 'Pick one')}</option>
            {(nodes.state === 'ok' ? nodes.data : []).map((n) => <option key={n.node} value={n.node}>{n.node}</option>)}
          </select></label>}
      </div>
      {target === 'usb'
        ? <label><span>{L('USB (VID:PID 또는 포트 경로)', 'USB (vid:pid or port path)')}</span><input id="brd-usb" value={usbId} placeholder="03fd:0008 · 1-4.2" onChange={(e) => setUsbId(e.target.value.trim())} /></label>
        : <>
          <div className="form-row form-row-wide">
            <label><span>{L('JTAG 게이트웨이', 'JTAG gateway')}</span>
              <select id="brd-gateway" value={gid} onChange={(e) => setGatewayId(e.target.value)}>
                {gwList.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.host}){g.state === 'down' ? L(' · 응답 없음', ' · down') : ''}</option>)}
                <option value="">{L('게이트웨이 없이 주소 직접 입력', 'No gateway - type an address')}</option>
              </select></label>
            <label><span>{L('프로토콜', 'Protocol')}</span>
              <select id="brd-protocol" value={protocol} onChange={(e) => setProtocol(e.target.value as BoardProtocol)}>
                {(Object.keys(BOARD_PORTS) as BoardProtocol[]).map((p) => <option key={p} value={p}>{PROTO_TEXT[p]} ({gw && p === 'hw_server' ? gw.hw_port : gw && p === 'quartus' ? gw.jtagd_port : BOARD_PORTS[p]})</option>)}
              </select></label>
          </div>
          {gid ? <>
            {protocol !== 'xvc' && <label><span>{protocol === 'hw_server' ? L('케이블 시리얼 (필수)', 'Cable serial (required)') : L('케이블 이름 · 시리얼 (선택)', 'Cable name / serial (optional)')}</span>
              <input id="brd-serial" list="brd-serials" value={serial} maxLength={64} placeholder="210251A08870" onChange={(e) => setSerial(e.target.value.trim())} />
              <datalist id="brd-serials">{freeCables.map((c) => <option key={c.serial} value={c.serial}>{[c.manufacturer, c.product, c.port].filter(Boolean).join(' · ')}</option>)}</datalist></label>}
            {protocol === 'hw_server' && <p className="muted small">{gw?.cables.length
              ? L(`게이트웨이에서 읽은 JTAG 케이블 ${freeCables.length}개가 목록에 있습니다(이미 보드가 된 케이블은 빠짐). 한 케이블은 보드 하나에만 등록됩니다.`, `${freeCables.length} JTAG cables read from the gateway are in the list (cables already a board are left out). A cable is one board only.`)
              : L('JTAG 게이트웨이 탭에서 "케이블 찾기"를 누르면 시리얼을 고를 수 있습니다. Vivado Hardware Manager 대상 이름 끝의 시리얼과 같습니다.', 'Press "Find cables" on the JTAG gateways tab to pick from a list. It is the serial at the end of the Vivado target name.')}</p>}
            {protocol === 'xvc' && <label><span>{L('이 보드의 XVC 서버 포트 (게이트웨이)', "This board's XVC server port (on the gateway)")}</span>
              <input id="brd-port" inputMode="numeric" value={port} placeholder={String(BOARD_PORTS.xvc)} onChange={(e) => setPort(digits(e.target.value))} /></label>}
          </> : <div className="form-row form-row-wide">
            <label><span>{L('케이블 호스트 (호스트 이름 또는 IP)', 'Cable host (name or IP)')}</span><input id="brd-host" value={host} maxLength={255} placeholder="jtag01.lab.local" onChange={(e) => setHost(e.target.value.trim())} /></label>
            <label><span>{L('포트', 'Port')}</span><input id="brd-port" inputMode="numeric" value={port} placeholder={String(BOARD_PORTS[protocol])} onChange={(e) => setPort(digits(e.target.value))} /></label>
          </div>}
          <div className="form-row form-row-wide">
            <label><span>{L('UART 포트 (ser2net, 선택)', 'UART port (ser2net, optional)')}</span><input id="brd-uart" inputMode="numeric" value={uart} placeholder="7001" onChange={(e) => setUart(digits(e.target.value))} /></label>
            <label><span>{L('표시 이름 (선택)', 'Label (optional)')}</span><input id="brd-label" value={label} maxLength={80} placeholder={L('랙 B-2 · 케이블 1', 'rack B-2 · cable 1')} onChange={(e) => setLabel(e.target.value)} /></label>
          </div>
          <p className="muted small">{L('데스크톱 VM이 게이트웨이(또는 케이블 호스트)의 포트에 닿아야 합니다(방화벽 허용: 데스크톱 → 게이트웨이). 연구자 자리 PC보다 인프라/랩 존의 게이트웨이 VM을 권장합니다.',
            'Desktop VMs must reach the gateway\'s (or cable host\'s) ports (allow desktop -> gateway). Prefer a gateway VM in the infra/lab zone over a researcher\'s own PC.')}</p>
        </>}
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
  const net = board.target === 'network';
  const list = desks.state === 'ok' ? desks.data.filter((d) => (!d.cluster_id || d.cluster_id === board.cluster_id) && (net || d.node === board.node)) : [];
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
      <p className="muted small">{net
        ? L(`네트워크 보드(${board.connection?.endpoint ?? ''}${board.cable_serial ? `, 케이블 ${board.cable_serial}` : ''})는 VM 설정을 바꾸지 않습니다. 사용자 포털에 접속 주소와 사용법이 표시됩니다.`,
          `A network board (${board.connection?.endpoint ?? ''}${board.cable_serial ? `, cable ${board.cable_serial}` : ''}) leaves the VM alone; the user's portal shows the address and how to connect.`)
        : L(`${board.node} 노드의 데스크톱만 보입니다.`, `Desktops on ${board.node} only.`)}</p>
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
          {pools.length > 0 && <BuildJobsPanel pools={pools.map((p) => ({ id: p.id, name: p.name, gpus_per_vm: p.gpus_per_vm, gpu_kind: p.gpu_kind, max_minutes: p.max_minutes, runtime: p.runtime }))} admin />}
        </>
      )}
    </LoadState>
  );
}

const JOB_TONE: Record<JobStatus, string> = { queued: 'chip', running: 'chip chip-accent', done: 'chip chip-on', failed: 'chip chip-warn', cancelled: 'chip' };

/** "GPU 2 · A100 (0,1)" for a GPU job, '' for a plain build. */
export function gpuText(j: BuildJob, L: (ko: string, en: string) => string) {
  if (!j.gpus) return '';
  const idx = j.gpu_index && j.gpu_index.length ? ` (#${j.gpu_index.join(',')})` : '';
  return `GPU ${j.gpus}${L('장', '')}${j.gpu_kind ? ` · ${j.gpu_kind}` : ''}${idx}`;
}

// 빌드 작업 큐: commands that run on a free build VM - a plain build takes a whole VM, a GPU job
// the GPUs it asks for (research.ts). Oldest first, each user's first job before anyone's second.
// Shared by the build farm page (every job, submit for anyone) and the portal (one's own).
export function BuildJobsPanel({ pools, admin = false }: { pools: JobPool[]; admin?: boolean }) {
  const { L, when } = useL();
  const jobs = useLoad(() => admin ? nextApi.buildJobs().then((r) => r.jobs) : nextApi.myJobs().then((r) => r.jobs), [admin]);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<BuildJob | null>(null);
  const [results, setResults] = useState<BuildJob | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const S: Record<JobStatus, string> = { queued: L('대기', 'queued'), running: L('실행 중', 'running'), done: L('완료', 'done'), failed: L('실패', 'failed'), cancelled: L('취소', 'cancelled') };
  async function cancel(j: BuildJob) {
    try { await (admin ? nextApi.cancelJob(j.id) : nextApi.myCancelJob(j.id)); jobs.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  async function stop(j: BuildJob) {
    if (!confirm(L(`'${j.name}'을(를) 멈출까요? 빌드 VM에서 작업 프로세스를 끝냅니다. 결과 폴더는 남습니다.`, `Stop '${j.name}'? Its processes on the build VM end; the result folder stays.`))) return;
    try { await (admin ? researchApi.stopJob(j.id) : researchApi.stopMyJob(j.id)); jobs.reload(); } catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }
  const list = jobs.state === 'ok' ? jobs.data : [];
  const gpuPools = pools.some((p) => (p.gpus_per_vm ?? 0) > 0);
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="stat-icon tone-green"><Icon name="list" size={18} /></span>
        <div>
          <h2 className="section-title">{gpuPools ? L('작업 큐 (빌드 · GPU)', 'Job queue (builds and GPU)') : L('빌드 작업 큐', 'Build job queue')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{gpuPools
            ? L('긴 빌드 · GPU 학습을 맡기면 차례로 돌립니다. 결과는 스크래치/<작업 ID>에.',
              'Queue long builds or GPU training; they run in turn. Results in scratch/<job id>.')
            : L('긴 빌드를 맡기면 빈 빌드 VM에서 차례로 돌립니다.',
              'Queue long builds; they run on free build VMs in turn.')}</p>
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
          <thead><tr><th>{L('작업', 'Job')}</th>{admin && <th>{L('사용자', 'User')}</th>}<th>{L('상태', 'State')}</th>{gpuPools && <th>GPU</th>}<th>{L('빌드 VM', 'Build VM')}</th><th>{L('넣은 시각', 'Queued')}</th><th>{L('끝난 시각', 'Finished')}</th><th className="actions" /></tr></thead>
          <tbody>{list.map((j) => (
            <tr key={j.id}>
              <td className="strong">{j.name}<div className="muted small"><code className="code">{j.command}</code></div>
                {j.source && <div className="muted small ci-src"><span className="chip chip-accent">{ciKindText(j.source.kind)}</span>
                  {j.source.repo ?? j.source.link_name}{j.source.ref ? ` · ${j.source.ref}` : ''}{j.source.commit ? ` · ${j.source.commit.slice(0, 8)}` : ''}
                  {j.source.url && <> · <a href={j.source.url} target="_blank" rel="noreferrer">{L('파이프라인', 'pipeline')}</a></>}</div>}
                {j.env && <div className="muted small">{j.env.kind === 'conda' ? `conda: ${j.env.name}` : `${L('컨테이너', 'container')}: ${j.env.image}`}</div>}</td>
              {admin && <td>{j.username}</td>}
              <td><span className={JOB_TONE[j.status]}>{S[j.status]}{j.exit_code !== null && j.status !== 'done' ? ` · ${j.exit_code}` : ''}</span>
                {j.status === 'queued' && j.gpus ? <div className="muted small">{waitText(j.wait_reason, L)}</div> : null}</td>
              {gpuPools && <td>{j.gpus ? <span className="chip chip-accent gpu-chip"><Icon name="gpu" size={12} />{gpuText(j, L)}</span> : <span className="muted small">-</span>}
                {j.max_minutes ? <div className="muted small">{L(`최대 ${j.max_minutes}분`, `up to ${j.max_minutes} min`)}</div> : null}</td>}
              <td>{j.desktop ?? <span className="muted small">{j.pool ?? (j.gpus ? L('자동 선택', 'auto') : '-')}</span>}</td>
              <td className="muted small">{when(j.created_at)}</td>
              <td className="muted small">{when(j.finished_at)}</td>
              <td className="actions">
                {(j.artifacts?.length ?? 0) > 0 && <button type="button" className="btn-ghost small-btn" onClick={() => setResults(j)}>{L(`결과물 ${j.artifacts!.length}`, `Results ${j.artifacts!.length}`)}</button>}
                {(j.output || j.error) && <button type="button" className="btn-ghost small-btn" onClick={() => setOpen(j)}>{L('출력', 'Output')}</button>}
                {j.status === 'queued' && <button type="button" className="btn-ghost small-btn danger" onClick={() => cancel(j)}>{L('취소', 'Cancel')}</button>}
                {j.status === 'running' && <button type="button" className="btn-ghost small-btn danger" onClick={() => stop(j)}>{L('멈추기', 'Stop')}</button>}
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
      {adding && <JobDialog pools={pools} admin={admin} onClose={() => setAdding(false)} onDone={(j) => { setAdding(false); jobs.reload();
        setNotice({ kind: 'info', text: j.status === 'running' ? L(`${j.desktop}에서 시작했습니다.`, `Started on ${j.desktop}.`)
          : j.gpus ? L('큐에 넣었습니다. 맞는 GPU가 비면 시작합니다.', 'Queued; it starts when matching GPUs are free.') : L('큐에 넣었습니다. 빈 빌드 VM이 생기면 시작합니다.', 'Queued; it starts on the next free build VM.') }); }} />}
      {results && <ResultsDialog job={results} admin={admin} onClose={() => setResults(null)} />}
      {open && (
        <Dialog open title={L(`${open.name} 출력`, `${open.name}: output`)} onClose={() => setOpen(null)}>
          <p className="muted small">{open.desktop} · {L('종료 코드', 'exit code')} {open.exit_code ?? '-'}{open.workdir ? ` · ${L('결과 폴더', 'results')} ${open.workdir}` : ''}</p>
          <pre className="job-output">{open.error || open.output}</pre>
        </Dialog>
      )}
    </section>
  );
}

export function ciKindText(k?: string) {
  return k === 'gitlab' ? 'GitLab CI' : k === 'jenkins' ? 'Jenkins' : 'CI';
}

const sizeText = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

// 결과물: the files the job left (kept on the NAS, or listed in its work folder while it lasts).
function ResultsDialog({ job, admin, onClose }: { job: BuildJob; admin: boolean; onClose: () => void }) {
  const { L } = useL();
  const [err, setErr] = useState<string | null>(null);
  const why = (e: unknown) => {
    const c = (e as { message?: string }).message ?? '';
    return c === 'APPROVAL_REQUIRED' ? L('반출 승인이 필요한 풀입니다. 포털 › 데이터 › 내 폴더에서 반출 요청을 보내세요.', 'This pool needs approval for downloads: send an export request from Data.')
      : c === 'EXPORT_DENIED' ? L('이 풀에서는 내려받기가 막혀 있습니다(반출 통제).', 'Downloads from this pool are not allowed (export control).')
        : c === 'TOO_BIG' ? L('파일이 커서 여기서는 받을 수 없습니다. 포털 › 데이터 › 내 폴더나 SFTP로 받으세요.', 'Too large here: use Data › my folders or SFTP.')
          : c === 'NO_ROUTE' ? L('파일이 있는 빌드 VM에 닿지 않습니다.', 'The build VM holding it is not reachable.') : c;
  };
  async function get(i: number) {
    setErr(null);
    try { await downloadArtifact(artifactUrl(job.id, i, admin)); } catch (e) { setErr(why(e)); }
  }
  return (
    <Dialog open wide title={L(`${job.name} 결과물`, `${job.name}: results`)} onClose={onClose}>
      <p className="muted small">{job.artifacts_kept === 'nas'
        ? L('작업이 끝날 때 NAS의 결과물 보관함(artifacts/사용자/작업 ID)에 복사해 두었습니다. 보관 기간이 지나면 지워집니다.', 'Copied to the NAS results store (artifacts/<user>/<job>) at the end; removed after the keep period.')
        : L('작업 폴더에 있는 파일입니다. 스크래치 보관 기간이 지나면 지워질 수 있으니 필요한 것은 받아 두세요.', 'In the work folder: take what you need before the scratch keep period ends.')}</p>
      {err && <div className="alert small error" role="alert">{err}</div>}
      <div className="table-scroll"><table className="table compact-head">
        <thead><tr><th>{L('파일', 'File')}</th><th className="num">{L('크기', 'Size')}</th><th className="actions" /></tr></thead>
        <tbody>{(job.artifacts ?? []).map((f, i) => (
          <tr key={f.path}><td><code className="code">{f.path}</code></td><td className="num muted small">{sizeText(f.size)}</td>
            <td className="actions"><button type="button" className="btn-ghost small-btn" onClick={() => get(i)}><Icon name="download" size={14} />{L('받기', 'Download')}</button></td></tr>))}</tbody>
      </table></div>
    </Dialog>
  );
}

const AUTO = '__auto__';

function JobDialog({ pools, admin, onClose, onDone }: { pools: JobPool[]; admin: boolean; onClose: () => void; onDone: (j: BuildJob) => void }) {
  const { L } = useL();
  const gpuPools = pools.filter((p) => (p.gpus_per_vm ?? 0) > 0);
  const [pool, setPool] = useState(gpuPools.length > 1 ? AUTO : pools[0]?.id ?? '');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  // 공유 저장소: left empty, the engine starts the job in <the user's scratch>/<job id>, as the user
  const sel = pools.find((p) => p.id === pool);
  const folderOf = (id: string) => (id === AUTO ? gpuPools[0]?.workdir : pools.find((p) => p.id === id)?.workdir) ?? '';
  const [workdir, setWorkdir] = useState('');
  const [user, setUser] = useState('');
  const gpuMode = pool === AUTO || (sel?.gpus_per_vm ?? 0) > 0;
  const maxGpus = pool === AUTO ? Math.max(1, ...gpuPools.map((p) => p.gpus_per_vm ?? 1)) : sel?.gpus_per_vm ?? 0;
  const cap = pool === AUTO ? 0 : sel?.max_minutes ?? 0;
  const kinds = [...new Set(gpuPools.map((p) => p.gpu_kind).filter(Boolean))] as string[];
  const [gpus, setGpus] = useState(1);
  const [kind, setKind] = useState('');
  const [mem, setMem] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [envKind, setEnvKind] = useState<'none' | 'conda' | 'container'>('none');
  const [envName, setEnvName] = useState('');
  const [image, setImage] = useState('');
  const [mail, setMail] = useState(true);
  const [hook, setHook] = useState(false);
  const [start, setStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const gpu = gpuMode ? {
        gpus, gpu_kind: kind, memory_gb: mem, ...(minutes ? { max_minutes: minutes } : {}),
        env: envKind === 'conda' ? { kind: 'conda' as const, name: envName } : envKind === 'container' ? { kind: 'container' as const, image } : null,
        notify: { mail, webhook: hook, ...(start && (mail || hook) ? { start } : {}) },
      } : {};
      const b = { pool_id: pool === AUTO ? '' : pool, name, command, workdir, ...(admin && user ? { username: user } : {}), ...gpu };
      onDone(await (admin ? nextApi.submitJob(b) : nextApi.mySubmitJob(b)));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  const envMissing = (envKind === 'conda' && !envName) || (envKind === 'container' && !image);
  return (
    <Dialog open wide={gpuMode} title={gpuMode ? L('작업 넣기 (GPU)', 'Queue a GPU job') : L('빌드 작업 넣기', 'Queue a build job')} onClose={onClose} onSubmit={submit}
      submitLabel={L('큐에 넣기', 'Queue')} busy={busy || !pool || !name || !command || envMissing} error={error}>
      <label><span>{L('풀', 'Pool')}</span>
        <select id="job-pool" value={pool} onChange={(e) => { setPool(e.target.value); setGpus(1); }}>
          {gpuPools.length > 1 && <option value={AUTO}>{L('아무 GPU 풀 (빈 곳 자동 선택)', 'Any GPU pool (first free)')}</option>}
          {pools.map((p) => <option key={p.id} value={p.id}>{p.name}{p.gpus_per_vm ? ` · GPU ${p.gpus_per_vm}${L('장/VM', '/VM')}${p.gpu_kind ? ` ${p.gpu_kind}` : ''}` : ''}</option>)}
        </select></label>
      <label><span>{L('작업 이름', 'Name')}</span><input id="job-name" value={name} maxLength={80} placeholder={gpuMode ? L('예: llama-7b LoRA', 'e.g. llama-7b LoRA') : L('예: zcu102 비트스트림', 'e.g. zcu102 bitstream')} onChange={(e) => setName(e.target.value)} /></label>
      <label><span>{L('명령', 'Command')}</span><input id="job-cmd" value={command} maxLength={2000} placeholder={gpuMode ? 'torchrun --nproc_per_node 2 train.py' : 'vivado -mode batch -source build.tcl'} onChange={(e) => setCommand(e.target.value)} /></label>
      {gpuMode && (
        <>
          <div className="form-row">
            <label><span>{L('GPU 장 수', 'GPUs')}</span><input id="job-gpus" type="number" min={1} max={maxGpus} value={gpus} onChange={(e) => setGpus(Math.max(1, Math.min(maxGpus, Number(e.target.value) || 1)))} />
              <small className="muted">{L(`VM 하나에 최대 ${maxGpus}장`, `up to ${maxGpus} per VM`)}</small></label>
            <label><span>{L('GPU 종류 (선택)', 'GPU kind (optional)')}</span>
              <input id="job-kind" list="job-kinds" value={kind} maxLength={60} placeholder={kinds[0] ?? 'A100'} onChange={(e) => setKind(e.target.value)} />
              <datalist id="job-kinds">{kinds.map((k) => <option key={k} value={k} />)}</datalist></label>
            <label><span>{L('메모리 (GB, 선택)', 'Memory (GB, optional)')}</span><input id="job-mem" type="number" min={0} max={4096} value={mem} onChange={(e) => setMem(Math.max(0, Number(e.target.value) || 0))} /></label>
            <label><span>{L('최대 실행 시간 (분)', 'Time limit (min)')}</span><input id="job-min" type="number" min={0} max={43200} value={minutes} onChange={(e) => setMinutes(Math.max(0, Number(e.target.value) || 0))} />
              <small className="muted">{cap ? L(`비우면 기본값 · 이 풀은 ${cap}분까지`, `empty: the default · this pool allows ${cap} min`) : L('0 = 기본값', '0 = the default')}</small></label>
          </div>
          <span className="field-label">{L('실행 환경', 'Environment')}</span>
          <div className="form-row">
            <label><span>{L('종류', 'Kind')}</span>
              <select id="job-env" value={envKind} onChange={(e) => setEnvKind(e.target.value as 'none' | 'conda' | 'container')}>
                <option value="none">{L('빌드 VM 그대로', 'The build VM as it is')}</option>
                <option value="conda">conda</option>
                <option value="container">{L('컨테이너 이미지', 'Container image')}</option>
              </select></label>
            {envKind === 'conda' && <label><span>{L('conda 환경 이름', 'conda environment')}</span><input id="job-conda" value={envName} placeholder="torch24" onChange={(e) => setEnvName(e.target.value.trim())} /></label>}
            {envKind === 'container' && <label className="grow"><span>{L('이미지', 'Image')}{sel?.runtime ? ` (${sel.runtime})` : ''}</span><input id="job-image" value={image} placeholder="nvcr.io/nvidia/pytorch:24.08-py3" onChange={(e) => setImage(e.target.value.trim())} /></label>}
          </div>
          <div className="check-row">
            <label className="check"><input type="checkbox" checked={mail} onChange={(e) => setMail(e.target.checked)} /><span>{L('끝나면 메일', 'Mail me when it ends')}</span></label>
            <label className="check"><input type="checkbox" checked={hook} onChange={(e) => setHook(e.target.checked)} /><span>{L('끝나면 웹훅(메신저) 알림', 'Webhook (messenger) when it ends')}</span></label>
            <label className="check"><input id="job-start" type="checkbox" checked={start} disabled={!mail && !hook} onChange={(e) => setStart(e.target.checked)} /><span>{L('대기열을 떠나 시작할 때도 알림', 'Tell me when it starts too')}</span></label>
          </div>
        </>
      )}
      <div className="form-row form-row-wide">
        <label><span>{L('작업 폴더 (빌드 VM 안)', 'Folder (on the build VM)')}</span><input id="job-dir" value={workdir} placeholder={folderOf(pool) ? `${folderOf(pool)}/<${L('작업 ID', 'job id')}>` : '/proj/zcu102'} onChange={(e) => setWorkdir(e.target.value.trim())} />
          {folderOf(pool) && <small className="muted">{L(`비워 두면 내 스크래치 폴더 아래 작업마다 새 폴더(${folderOf(pool)}/작업 ID)에서 내 권한으로 실행합니다. 결과도 거기 남고, 스크래치는 백업되지 않습니다.`,
            `Left empty, each job runs as you in a new folder under your scratch (${folderOf(pool)}/<job id>); results stay there. Scratch is not backed up.`)}</small>}</label>
        {admin && <label><span>{L('사용자 (선택)', 'For user (optional)')}</span><input id="job-user" value={user} placeholder="alice" onChange={(e) => setUser(e.target.value.trim())} /></label>}
      </div>
      <p className="muted small">{gpuMode
        ? L('GPU 작업은 받은 GPU만 보입니다(CUDA_VISIBLE_DEVICES). 출력 전체는 작업 폴더의 moavi-job.log에, 마지막 20KB는 여기 남습니다. 최대 실행 시간이 지나면 끝냅니다.',
          'A GPU job sees only the GPUs it got (CUDA_VISIBLE_DEVICES). The whole output goes to moavi-job.log in its folder, the last 20 KB stays here. It is ended at its time limit.')
        : L('빌드 VM에는 게스트 에이전트가 있어야 하고, 프로젝트 폴더는 공유 저장소에 두세요(풀 정책 > 공유 저장소를 켜면 시작 전에 마운트를 확인합니다). 출력은 마지막 8KB만 남습니다.',
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
    const text = '\ufeff' + ['card,loans,hours,use_pct,util_avg,idle_hours,measured_hours,users,lent_now', ...rows.map((r) => [q(r.card), r.loans, r.hours, r.use_pct,
      r.util_avg ?? '', r.idle_hours ?? 0, r.measured_hours ?? 0, q(r.users.join(' ')), r.active].join(','))].join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `card-usage-${days}d.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return (
    <LoadState value={report} retry={report.reload}>
      {(r) => (
        <>
          <Intro>{L(`가속 카드(FPGA · NPU · GPU)마다 누가 얼마나 빌려 썼는지 봅니다. 대여율은 기간 전체 시간 대비 대여된 시간, 실사용률은 대여 중 게스트 에이전트로 5분마다 읽은 GPU/NPU 사용률 평균, 유휴 시간은 사용률 ${r.idle_threshold_pct ?? 5}% 미만이거나 데스크톱이 꺼져 있던 시간입니다. 예산 · 증설 근거로 CSV를 받아 쓰세요.`,
            `Who borrowed each accelerator card and for how long. Loan % is loan hours over the whole period; real use is the average GPU/NPU use read every 5 minutes through the guest agent while lent; idle hours are under ${r.idle_threshold_pct ?? 5}% or with the desktop off. Download the CSV for budgets and expansion plans.`)}</Intro>
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
            { label: L('유휴 시간', 'Idle hours'), value: `${Math.round(r.cards.reduce((a, c) => a + (c.idle_hours ?? 0), 0) * 10) / 10} h`,
              tone: r.cards.reduce((a, c) => a + (c.idle_hours ?? 0), 0) > r.total_hours / 2 ? 'warn' : undefined },
          ]} />
          {r.cards.length === 0 ? <div className="empty"><p>{L('이 기간에 대여 기록이 없습니다.', 'No loans in this period.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('카드', 'Card')}</th><th className="num">{L('대여', 'Loans')}</th><th className="num">{L('시간', 'Hours')}</th><th>{L('대여율', 'Loan %')}</th><th>{L('실사용률', 'Real use')}</th><th className="num">{L('유휴 시간', 'Idle h')}</th><th>{L('사용자', 'Users')}</th><th>{L('지금', 'Now')}</th></tr></thead>
              <tbody>{r.cards.map((c) => (
                <tr key={c.card}>
                  <td className="strong">{c.card}<div className="muted small"><code className="code">{c.resource_id}</code></div></td>
                  <td className="num">{c.loans}</td>
                  <td className="num">{c.hours}</td>
                  <td className="farm-cpu"><span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, c.use_pct)}%` }} /></span><span className="muted small">{c.use_pct}%</span></td>
                  <td className="farm-cpu">{c.util_avg === null || c.util_avg === undefined
                    ? <span className="muted small" title={L('nvidia-smi · rocm-smi · furiosa-smi · rbln-stat 로 읽을 수 없는 카드(FPGA 등)이거나 측정 전', 'Not readable by nvidia-smi, rocm-smi, furiosa-smi or rbln-stat (an FPGA, say), or not sampled yet')}>{L('측정 불가', 'not measured')}</span>
                    : <><span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, c.util_avg)}%` }} /></span><span className="muted small">{c.util_avg}%</span></>}</td>
                  <td className="num">{c.idle_hours ?? 0}</td>
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
  const [seatsOf, setSeatsOf] = useState<string | null>(null);
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
            { label: L('라이선스 수집', 'Seats read'), value: String(list.filter((s) => s.usage_mode && s.usage_mode !== 'off').length) },
          ]} />
          <p className="muted small">{L('자동 감시를 켠 서버는 5분마다 포트를 확인하고, 응답이 없으면 알림 채널(웹훅 · 메일)로 한 번 알리고 다시 살아나면 또 알립니다.',
            'Watched servers are checked every 5 minutes; when one stops answering the alert channels (webhook, mail) hear once, and again when it is back.')}</p>
          <NoticeBar notice={notice} />
          {list.length === 0 ? <div className="empty"><p>{L('등록된 라이선스 서버가 없습니다.', 'No licence servers yet.')}</p></div> : (
            <div className="table-scroll"><table className="table compact-head">
              <thead><tr><th>{L('이름', 'Name')}</th><th>{L('주소', 'Host')}</th><th>{L('포트', 'Ports')}</th><th>VM</th><th>{L('고정 MAC', 'Fixed MAC')}</th><th>{L('라이선스 수집', 'Seats')}</th><th>{L('마지막 확인', 'Checked')}</th><th className="actions" /></tr></thead>
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
                  <td className="nowrap"><span className={`chip ${s.usage_mode && s.usage_mode !== 'off' ? (s.usage_ok === 0 ? 'chip-warn' : 'chip-on') : ''}`}
                    title={s.usage_ok === 0 ? s.usage_error : undefined}>{modeLabel(s.usage_mode, L)}{s.usage_ok === 0 ? ` · ${L('실패', 'failed')}` : ''}</span>
                    {Object.values(s.seat_alerted ?? {}).includes('full') && <span className="chip chip-off">{L('라이선스 없음', 'full')}</span>}</td>
                  <td className="muted small">{when(s.last_check)}</td>
                  <td className="actions">
                    <button type="button" className="btn-ghost small-btn" aria-pressed={seatsOf === s.id} onClick={() => setSeatsOf(seatsOf === s.id ? null : s.id)}>{L('사용 현황', 'Seats')}</button>
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
          {seatsOf && list.some((s) => s.id === seatsOf) && (
            <LicenseSeatsPanel key={seatsOf} server={list.find((s) => s.id === seatsOf)!} onChanged={servers.reload} onClose={() => setSeatsOf(null)} />
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
    <div className="panel-stack">
      <LoadState value={data} retry={data.reload}>
        {(c) => <ClientForm initial={c} onSaved={data.reload} />}
      </LoadState>
      <TerminalInstallPanel />
    </div>
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
    <section className="panel form">
      <h3 className="panel-title">{L('MOAVI Desk 클라이언트 (Windows)', 'MOAVI Desk Client (Windows)')}</h3>
      <p className="muted small">{L('설치형 클라이언트가 로그인할 때 읽는 값입니다. 최신 버전보다 낮으면 다운로드를 안내하고, 최소 버전보다 낮으면 로그인을 막습니다. 다운로드 주소를 비우면 작업 공간의 "MOAVI Desk Client 받기"는 GitHub 최신 릴리스를 엽니다.',
        'What the installed client reads at sign-in: below the latest it offers the download, below the minimum it refuses to sign in. With no download URL the workspace button opens the latest GitHub release.')}</p>
      <div className="form-row form-row-three">
        <label><span>{L('최신 버전', 'Latest version')}</span><input id="cl-latest" value={v.latest_version} placeholder="0.9.0" onChange={(e) => setV({ ...v, latest_version: e.target.value.trim() })} /></label>
        <label><span>{L('최소 버전', 'Minimum version')}</span><input id="cl-min" value={v.min_version} placeholder="0.9.0" onChange={(e) => setV({ ...v, min_version: e.target.value.trim() })} /></label>
        <label><span>{L('기본 접속 방식', 'Default protocol')}</span>
          <select id="cl-proto" value={v.protocol} onChange={(e) => setV({ ...v, protocol: e.target.value as ClientSettings['protocol'] })}>
            <option value="auto">{L('자동 (RDP → SPICE → VNC)', 'Auto (RDP, then SPICE, then VNC)')}</option><option value="rdp">RDP</option><option value="spice">SPICE</option><option value="vnc">VNC</option>
          </select></label>
      </div>
      <label><span>{L('다운로드 주소 (MSI)', 'Download URL (MSI)')}</span><input id="cl-url" value={v.download_url} placeholder="https://github.com/dskim1979/moavi-desk/releases/latest" onChange={(e) => setV({ ...v, download_url: e.target.value.trim() })} /></label>
      <small className="muted">{L('자동: Windows 데스크톱은 RDP(H.264 · UDP)로, RDP 서버(xrdp)가 없는 Linux 데스크톱은 SPICE로 엽니다. 실습실 키오스크는 SPICE를 씁니다(USB · 전체 화면).',
        'Auto: Windows desktops open with RDP (H.264, UDP); a Linux desktop without an RDP server (xrdp) opens with SPICE. Lab kiosks use SPICE (USB, full screen).')}</small>
      <NoticeBar notice={notice} />
      <div className="toolbar"><button type="button" className="btn primary" disabled={busy} onClick={save}>{L('저장', 'Save')}</button></div>
    </section>
  );
}
