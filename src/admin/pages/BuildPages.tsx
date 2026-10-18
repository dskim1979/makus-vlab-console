import { OsLogo } from '../../components/OsLogo';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { buildApi } from '../../api/build';
import type { Created, Iso, NewVm, OsKind } from '../../api/build';
import { ApiError, isMock } from '../../api/client';
import { nextApi } from '../../api/next';
import type { Cluster, ClusterStorage } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { bytes, ClusterFrame, Meter } from './ClusterPages';

const ConsoleWindow = lazy(() => import('../../portal/ConsoleWindow'));

// 가상머신 > ISO · 이미지 관리 and VM 만들기: an ISO onto a storage (upload, or the node
// downloads it), then a new VM booting from it, its console to install the OS, and what to do
// once it is installed (engine: the VM-build routes of pegaprox/api/vlab_next.py).
// Texts are inline ko/en pairs, as on the other next-phase pages.

type Notice = { kind: 'info' | 'error'; text: string } | null;

function useL() {
  const { pick, lang } = useI18n();
  return { L: (ko: string, en: string) => pick({ ko, en }), lang };
}

const errText = (e: unknown) => (e as Error).message;
const errCode = (e: unknown) => ((e as ApiError).body as { code?: string } | undefined)?.code;

function NoticeBar({ notice }: { notice: Notice }) {
  return notice ? <div className={`alert small ${notice.kind === 'error' ? 'error' : 'info'}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div> : null;
}

// Proxmox takes letters, digits and . _ - + in a file name; the rest becomes _
export function isoFileName(raw: string) {
  const base = raw.split(/[\\/]/).pop() ?? '';
  let n = base.replace(/[^A-Za-z0-9._+-]+/g, '_').replace(/^[^A-Za-z0-9]+/, '');
  if (!/\.iso$/i.test(n)) n = `${n.replace(/\.+$/, '')}.iso`;
  return n.length > 4 ? n.slice(-195) : '';
}

// the nodes of a cluster and the storages each sees, with which content
function useNodesAndStorage(cid: string) {
  const nodes = useLoad(useCallback(() => adminApi.nodes(cid), [cid]), [cid]);
  const storage = useLoad(useCallback(() => adminApi.storage(cid), [cid]), [cid]);
  return { nodes, storage };
}

const onNode = (list: ClusterStorage[], node: string, content: string) =>
  list.filter((s) => s.content.includes(content) && s.nodes.includes(node) && s.status !== 'unknown')
    // a node-local storage of the same name is listed once per node
    .filter((s, i, all) => all.findIndex((x) => x.storage === s.storage) === i);

function day(ts: number, lang: string) {
  return ts ? new Date(ts * 1000).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US') : '-';
}

// --- 가상머신 > ISO · 이미지 관리 ----------------------------------------------------

type Transfer = {
  id: number; kind: 'upload' | 'download'; name: string; node: string; storage: string;
  percent: number | null; phase: 'sending' | 'node' | 'running' | 'done' | 'failed'; detail: string; abort?: AbortController;
};

export function IsoLibraryPage() {
  return <ClusterFrame>{(c) => <IsoLibrary key={c.id} cluster={c} />}</ClusterFrame>;
}

function IsoLibrary({ cluster }: { cluster: Cluster }) {
  const { L, lang } = useL();
  const { nodes, storage } = useNodesAndStorage(cluster.id);
  const [node, setNode] = useState('');
  const [store, setStore] = useState('');
  const nodeList = nodes.state === 'ok' ? nodes.data.filter((n) => n.online) : [];
  const n = node || nodeList[0]?.node || '';
  const isoStores = storage.state === 'ok' ? onNode(storage.data, n, 'iso') : [];
  const s = isoStores.some((x) => x.storage === store) ? store : isoStores[0]?.storage ?? '';
  const isos = useLoad(useCallback(() => (n && s ? buildApi.isos(cluster.id, n, s) : Promise.resolve([] as Iso[])), [cluster.id, n, s]), [cluster.id, n, s]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [fetching, setFetching] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const patch = (id: number, p: Partial<Transfer>) => mounted.current && setTransfers((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));

  // a download (or an upload's copy on the node) is a Proxmox task; follow it every 2 seconds
  async function follow(id: number, upid: string, nodeName: string) {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!mounted.current) return;
      try {
        const t = await buildApi.task(cluster.id, nodeName, upid);
        if (t.running) { patch(id, { percent: t.percent, detail: t.last }); continue; }
        patch(id, t.ok ? { phase: 'done', percent: 100, detail: '' } : { phase: 'failed', detail: t.exitstatus || t.last });
        if (t.ok) isos.reload();
        return;
      } catch (e) {
        patch(id, { phase: 'failed', detail: errText(e) });
        return;
      }
    }
  }

  async function startUpload(file: File) {
    const name = isoFileName(file.name);
    if (!name) { setNotice({ kind: 'error', text: L('ISO 파일 이름을 읽지 못했습니다.', 'Could not read the file name.') }); return; }
    if (isos.state === 'ok' && isos.data.some((i) => i.name === name)
        && !confirm(L(`${name}이(가) 이미 있습니다. 그래도 올릴까요? (Proxmox가 거절할 수 있습니다)`, `${name} is already there. Upload anyway? (Proxmox may refuse it)`))) return;
    const id = ++seq.current;
    const abort = new AbortController();
    setTransfers((ts) => [{ id, kind: 'upload', name, node: n, storage: s, percent: 0, phase: 'sending', detail: bytes(file.size), abort }, ...ts]);
    try {
      const r = await buildApi.uploadIso(cluster.id, n, s, file, name, (sent, total) => {
        const pct = (sent / total) * 100;
        patch(id, pct >= 100 ? { percent: 100, phase: 'node', detail: '' } : { percent: pct, detail: `${bytes(sent)} / ${bytes(total)}` });
      }, abort.signal);
      patch(id, { phase: 'done', percent: 100, detail: '', abort: undefined });
      isos.reload();
      if (r.upid) void follow(id, r.upid, n);
    } catch (e) {
      patch(id, { phase: 'failed', detail: errText(e) === 'aborted' ? L('취소했습니다', 'Cancelled') : errText(e), abort: undefined });
    }
  }

  async function remove(i: Iso) {
    if (!confirm(L(`${i.name}을(를) ${i.storage}에서 지울까요? 되돌릴 수 없습니다.`, `Delete ${i.name} from ${i.storage}? This cannot be undone.`))) return;
    try { await buildApi.deleteIso(cluster.id, n, i.storage, i.volid); setNotice({ kind: 'info', text: L(`${i.name}을(를) 지웠습니다.`, `Deleted ${i.name}.`) }); isos.reload(); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); }
  }

  const busy = transfers.some((t) => t.phase === 'sending' || t.phase === 'node');
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  return (
    <LoadState value={nodes} retry={nodes.reload}>
      {() => (
        <>
          <p className="muted small page-intro">{L(
            'OS 설치용 ISO를 스토리지에 올리거나, 노드가 URL에서 직접 받게 합니다. 공유 스토리지(NFS 등)에 두면 모든 노드에서 VM 만들기에 쓸 수 있습니다. 큰 파일은 엔진이 잠시 받아 두었다가 노드로 보내므로, 엔진 디스크에 파일 크기만큼 빈 공간이 필요합니다. 큰 ISO는 "URL로 받기"가 빠릅니다.',
            'Upload an install ISO to a storage, or let the node download it from a URL. On a shared storage (NFS, ...) every node can use it to make VMs. An upload is buffered on the engine before it goes to the node, so the engine needs that much free disk; for a large ISO "Download from URL" is faster.')}</p>
          <div className="toolbar">
            <select aria-label={L('노드', 'Node')} value={n} onChange={(e) => setNode(e.target.value)}>
              {nodeList.map((x) => <option key={x.node} value={x.node}>{x.node}</option>)}
            </select>
            <select aria-label={L('스토리지', 'Storage')} value={s} onChange={(e) => setStore(e.target.value)} disabled={!isoStores.length}>
              {isoStores.length === 0 && <option value="">{L('ISO를 둘 스토리지 없음', 'No ISO storage')}</option>}
              {isoStores.map((x) => <option key={x.storage} value={x.storage}>{x.storage} ({x.type}{x.shared ? L(', 공유', ', shared') : ''}) · {bytes(Math.max(0, x.total - x.used))} {L('남음', 'free')}</option>)}
            </select>
            <button type="button" className="btn primary" disabled={!s} onClick={() => fileInput.current?.click()}><Icon name="plus" size={16} />{L('파일 올리기', 'Upload file')}</button>
            <input ref={fileInput} type="file" accept=".iso" hidden onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (f) void startUpload(f);
            }} />
            <button type="button" className="btn" disabled={!s} onClick={() => setFetching(true)}><Icon name="download" size={16} />{L('URL로 받기', 'Download from URL')}</button>
            <button type="button" className="btn" onClick={() => { storage.reload(); isos.reload(); }}><Icon name="refresh" size={16} />{L('새로 고침', 'Refresh')}</button>
            <Link className="btn-ghost" to={`/admin/vms/create?c=${encodeURIComponent(cluster.id)}`}>{L('VM 만들기 →', 'Make a VM →')}</Link>
          </div>
          <NoticeBar notice={notice} />
          {transfers.length > 0 && (
            <section className="panel iso-transfers" aria-label={L('전송', 'Transfers')}>
              <div className="panel-head"><h2 className="section-title">{L('전송', 'Transfers')}</h2>
                {transfers.some((t) => t.phase === 'done' || t.phase === 'failed') && (
                  <span className="panel-actions"><button type="button" className="btn-ghost small-btn" onClick={() =>
                    setTransfers((ts) => ts.filter((t) => t.phase !== 'done' && t.phase !== 'failed'))}>{L('끝난 것 지우기', 'Clear finished')}</button></span>
                )}</div>
              <ul className="iso-transfer-list">
                {transfers.map((t) => (
                  <li key={t.id}>
                    <span className="nowrap"><span className="chip chip-free">{t.kind === 'upload' ? L('올리기', 'Upload') : L('URL', 'URL')}</span> <span className="strong">{t.name}</span>
                      <span className="muted small"> → {t.storage} ({t.node})</span></span>
                    <span className="iso-transfer-state">
                      {t.phase === 'done' ? <span className="status st-ready"><span className="dot" />{L('완료', 'Done')}</span>
                        : t.phase === 'failed' ? <span className="status st-error"><span className="dot" />{L('실패', 'Failed')}</span>
                          : t.phase === 'node' ? <span className="muted small">{L('다 보냈습니다. 엔진이 노드로 옮기는 중…', 'Sent. The engine is passing it to the node…')}</span>
                            : <Meter value={t.percent ?? 0} label={t.percent === null ? '…' : `${Math.floor(t.percent)}%`} />}
                      {t.detail && <span className="muted small">{t.detail}</span>}
                      {t.abort && t.phase === 'sending' && <button type="button" className="btn-ghost small-btn danger" onClick={() => t.abort?.abort()}>{L('취소', 'Cancel')}</button>}
                    </span>
                  </li>
                ))}
              </ul>
              {busy && <p className="muted small">{L('올리는 동안 이 탭을 닫거나 다른 사이트로 가면 전송이 끊깁니다. 콘솔의 다른 메뉴는 써도 됩니다.', 'Closing this tab stops the upload. Other pages of the console are fine.')}</p>}
            </section>
          )}
          {!s ? <div className="empty"><p>{L('이 노드에는 ISO를 둘 수 있는 스토리지가 없습니다. 스토리지의 콘텐츠에 "ISO image"를 켜 주세요.', 'No storage on this node takes ISO images. Enable "ISO image" content on one.')}</p></div> : (
            <LoadState value={isos} retry={isos.reload}>
              {(list) => list.length === 0 ? <div className="empty"><p>{L(`${s}에 ISO가 없습니다.`, `No ISOs on ${s}.`)}</p></div> : (
                <div className="table-scroll">
                  <table className="table compact-head">
                    <thead><tr><th>{L('이름', 'Name')}</th><th className="num">{L('크기', 'Size')}</th><th>{L('올린 날', 'Added')}</th><th /></tr></thead>
                    <tbody>
                      {list.map((i) => (
                        <tr key={i.volid}>
                          <td title={i.volid}><span className="strong">{i.name}</span></td>
                          <td className="num nowrap">{bytes(i.size)}</td>
                          <td className="nowrap">{day(i.ctime, lang)}</td>
                          <td className="nowrap"><button type="button" className="btn-ghost small-btn danger" onClick={() => remove(i)}>{L('삭제', 'Delete')}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </LoadState>
          )}
          {fetching && <DownloadDialog clusterId={cluster.id} node={n} storage={s} onClose={() => setFetching(false)} onStarted={(name, upid) => {
            setFetching(false);
            const id = ++seq.current;
            setTransfers((ts) => [{ id, kind: 'download', name, node: n, storage: s, percent: null, phase: 'running', detail: L('노드가 받는 중', 'The node is downloading') }, ...ts]);
            void follow(id, upid, n);
          }} />}
        </>
      )}
    </LoadState>
  );
}

const ALGOS = ['sha256', 'sha512', 'sha1', 'md5', 'sha224', 'sha384'] as const;

function DownloadDialog({ clusterId, node, storage, onClose, onStarted }: {
  clusterId: string; node: string; storage: string; onClose: () => void; onStarted: (name: string, upid: string) => void;
}) {
  const { L } = useL();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [named, setNamed] = useState(false);
  const [algo, setAlgo] = useState<string>('');
  const [sum, setSum] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fromUrl(u: string) {
    setUrl(u);
    if (named) return;
    try { setName(isoFileName(decodeURIComponent(new URL(u).pathname))); } catch { setName(''); }
  }
  async function submit() {
    setError(null);
    if (!/^https?:\/\/\S+$/.test(url.trim())) { setError(L('http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.', 'Enter an http:// or https:// address.')); return; }
    const filename = isoFileName(name);
    if (!filename) { setError(L('저장할 파일 이름(.iso)을 넣어 주세요.', 'Enter a file name (.iso).')); return; }
    const clean = sum.trim().replace(/\s+/g, '');
    if (algo && !/^[0-9a-fA-F]{32,128}$/.test(clean)) { setError(L('체크섬은 16진수 문자열입니다.', 'The checksum is a hex string.')); return; }
    setBusy(true);
    try {
      const r = await buildApi.downloadIso(clusterId, node, storage, { url: url.trim(), filename, ...(algo ? { checksum: `${algo}:${clean}` } : {}) });
      onStarted(filename, r.upid);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open wide title={L('URL로 ISO 받기', 'Download an ISO from a URL')} onClose={onClose} onSubmit={submit} submitLabel={L('받기 시작', 'Start download')} busy={busy || !url} error={error}>
      <p className="muted small">{L(`노드 ${node}이(가) 주소에서 직접 받아 ${storage}에 둡니다. 엔진을 거치지 않으니 큰 파일도 빠릅니다. 사내 주소(사설 IP)는 보안상 받지 않습니다.`,
        `Node ${node} downloads it straight into ${storage}, not through the engine. Addresses on private networks are refused.`)}</p>
      <label><span>URL</span><input id="iso-url" type="url" required placeholder="https://releases.ubuntu.com/24.04/ubuntu-24.04.1-desktop-amd64.iso" value={url} onChange={(e) => fromUrl(e.target.value)} /></label>
      <label><span>{L('파일 이름', 'File name')}</span><input id="iso-name" value={name} onChange={(e) => { setNamed(true); setName(e.target.value); }} onBlur={() => name && setName(isoFileName(name))} /></label>
      <div className="form-row">
        <label><span>{L('체크섬 확인', 'Verify checksum')}</span>
          <select id="iso-algo" value={algo} onChange={(e) => setAlgo(e.target.value)}>
            <option value="">{L('하지 않음', 'No')}</option>
            {ALGOS.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
          </select></label>
        <label><span>{L('체크섬 값 (배포처가 밝힌 값)', 'Checksum (as published)')}</span>
          <input id="iso-sum" value={sum} disabled={!algo} spellCheck={false} placeholder={algo ? 'e3b0c442…' : ''} onChange={(e) => setSum(e.target.value)} /></label>
      </div>
      {algo && <p className="muted small">{L('받은 파일이 이 값과 다르면 노드가 지우고 실패로 끝냅니다.', 'If the file does not match, the node deletes it and the task fails.')}</p>}
    </Dialog>
  );
}

// --- 가상머신 > VM 만들기 ------------------------------------------------------------

type Step = 'base' | 'media' | 'hw' | 'review';
const STEPS: Step[] = ['base', 'media', 'hw', 'review'];
type Form = {
  node: string; name: string; vmid: string; ostype: OsKind; iso: string; virtio_iso: string;
  cores: number; sockets: number; memory_gb: number; cpu: string;
  storage: string; disk_gb: number; bridge: string; vlan: string; vga: 'qxl' | 'std' | 'virtio'; agent: boolean;
};
const OS_DEFAULTS: Record<OsKind, Pick<Form, 'cores' | 'memory_gb' | 'disk_gb' | 'name'>> = {
  win11: { cores: 4, memory_gb: 8, disk_gb: 80, name: 'win11-base' },
  win10: { cores: 4, memory_gb: 8, disk_gb: 64, name: 'win10-base' },
  l26: { cores: 2, memory_gb: 4, disk_gb: 32, name: 'linux-base' },
  other: { cores: 2, memory_gb: 4, disk_gb: 32, name: 'vm-base' },
};
const isWin = (o: OsKind) => o === 'win11' || o === 'win10';

// what goes to the engine for this form: Windows 11 gets UEFI with an EFI disk and TPM 2.0;
// Windows without the virtio driver ISO gets a SATA disk and an e1000e card it has drivers for
export function vmBody(f: Form): NewVm {
  const win = isWin(f.ostype);
  const virtio = !win || !!f.virtio_iso;
  const b: NewVm = {
    name: f.name.trim(), ostype: f.ostype, iso: f.iso, cores: f.cores, sockets: f.sockets, cpu: f.cpu,
    memory: Math.round(f.memory_gb * 1024), storage: f.storage, disk_size: f.disk_gb,
    disk_type: virtio ? 'scsi' : 'sata', disk_discard: true,
    net_bridge: f.bridge, net_model: virtio ? 'virtio' : 'e1000e', vga: f.vga, agent: f.agent,
    machine: 'q35', bios: f.ostype === 'win11' ? 'ovmf' : 'seabios',
  };
  if (virtio) { b.scsihw = 'virtio-scsi-single'; b.disk_iothread = true; }
  if (f.vmid) b.vmid = Number(f.vmid);
  if (win && f.virtio_iso) b.virtio_iso = f.virtio_iso;
  if (f.vlan) b.net_tag = Number(f.vlan);
  if (f.ostype === 'win11') Object.assign(b, { efi_storage: f.storage, efi_pre_enroll: true, tpm_storage: f.storage, tpm_version: 'v2.0' });
  return b;
}

export function VmCreatePage() {
  return <ClusterFrame>{(c) => <VmWizard key={c.id} cluster={c} />}</ClusterFrame>;
}

function VmWizard({ cluster }: { cluster: Cluster }) {
  const { L } = useL();
  const cid = cluster.id;
  const { nodes, storage } = useNodesAndStorage(cid);
  const [step, setStep] = useState<Step>('base');
  const [f, setF] = useState<Form>({ node: '', name: OS_DEFAULTS.win11.name, vmid: '', ostype: 'win11', iso: '', virtio_iso: '',
    cores: 4, sockets: 1, memory_gb: 8, cpu: 'host', storage: '', disk_gb: 80, bridge: '', vlan: '', vga: 'qxl', agent: true });
  const [touchedName, setTouchedName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<(Created & { node: string; name: string }) | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const nodeList = nodes.state === 'ok' ? nodes.data.filter((n) => n.online) : [];
  const node = f.node || nodeList[0]?.node || '';
  const isos = useLoad(useCallback(() => (node ? buildApi.isos(cid, node) : Promise.resolve([] as Iso[])), [cid, node]), [cid, node]);
  const nets = useLoad(useCallback(() => (node ? buildApi.networks(cid, node) : Promise.resolve([])), [cid, node]), [cid, node]);
  const vmid = useLoad(useCallback(() => buildApi.nextId(cid), [cid]), [cid]);
  const diskStores = storage.state === 'ok' ? onNode(storage.data, node, 'images') : [];
  const isoList = isos.state === 'ok' ? isos.data : [];
  const netList = nets.state === 'ok' ? nets.data : [];

  // fill in what depends on the node once its lists are in
  const form: Form = useMemo(() => {
    const virtioGuess = isoList.find((i) => /virtio-win/i.test(i.name))?.volid ?? '';
    return {
      ...f, node,
      storage: diskStores.some((s) => s.storage === f.storage) ? f.storage : diskStores[0]?.storage ?? '',
      bridge: netList.some((n) => n.iface === f.bridge) ? f.bridge : netList[0]?.iface ?? '',
      iso: isoList.some((i) => i.volid === f.iso) ? f.iso : '',
      virtio_iso: f.virtio_iso === 'none' ? '' : isoList.some((i) => i.volid === f.virtio_iso) ? f.virtio_iso : virtioGuess,
    };
  }, [f, node, diskStores, netList, isoList]);
  const win = isWin(form.ostype);
  const pickedStore = diskStores.find((s) => s.storage === form.storage);
  const bridge = netList.find((n) => n.iface === form.bridge);

  function pickOs(o: OsKind) {
    const d = OS_DEFAULTS[o];
    setF((x) => ({ ...x, ostype: o, cores: d.cores, memory_gb: d.memory_gb, disk_gb: d.disk_gb, ...(touchedName ? {} : { name: d.name }) }));
  }

  const problems: Partial<Record<Step, string>> = {};
  if (!node) problems.base = L('켜진 노드가 없습니다.', 'No node is online.');
  else if (!/^[A-Za-z0-9]([A-Za-z0-9.-]{0,61}[A-Za-z0-9])?$/.test(form.name.trim())) problems.base = L('이름은 영문·숫자·하이픈(-)·점(.)으로, 63자까지입니다.', 'Name: letters, digits, "-" and ".", up to 63.');
  else if (form.vmid && !/^\d{3,9}$/.test(form.vmid)) problems.base = L('VMID는 100 이상의 숫자입니다.', 'VMID is a number from 100.');
  if (!form.iso) problems.media = L('설치할 ISO를 고르세요.', 'Pick the install ISO.');
  if (!form.storage) problems.hw = L('디스크를 둘 스토리지가 없습니다.', 'No storage for the disk.');
  else if (!form.bridge) problems.hw = L('네트워크(브리지)가 없습니다.', 'No network bridge.');
  else if (form.vlan && !(Number(form.vlan) >= 1 && Number(form.vlan) <= 4094)) problems.hw = L('VLAN은 1~4094입니다.', 'VLAN is 1 to 4094.');
  const firstProblem = STEPS.find((s) => problems[s]);
  const idx = STEPS.indexOf(step);

  async function create() {
    setBusy(true); setError(null);
    try {
      const body = vmBody({ ...form, vmid: form.vmid || (vmid.state === 'ok' ? String(vmid.data) : '') });
      const r = await buildApi.createVm(cid, node, body);
      setCreated({ ...r, node, name: body.name });
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  if (created) return <AfterCreate cluster={cluster} vm={created} onAnother={() => { setCreated(null); setStep('base'); vmid.reload(); set('vmid', ''); }} />;

  const label: Record<Step, string> = {
    base: L('기본', 'Basics'), media: L('설치 미디어', 'Install media'), hw: L('하드웨어', 'Hardware'), review: L('확인', 'Review'),
  };
  const osCards: { id: OsKind; title: string; hint: string }[] = [
    { id: 'win11', title: 'Windows 11', hint: L('UEFI(OVMF)·TPM 2.0·보안 부팅 자동', 'UEFI (OVMF), TPM 2.0 and Secure Boot set for you') },
    { id: 'win10', title: 'Windows 10', hint: L('BIOS(SeaBIOS)', 'BIOS (SeaBIOS)') },
    { id: 'l26', title: 'Linux', hint: L('커널 2.6 이상 (Ubuntu, Rocky 등)', 'Kernel 2.6+ (Ubuntu, Rocky, ...)') },
  ];

  return (
    <LoadState value={nodes} retry={nodes.reload}>
      {() => (
        <>
          <p className="muted small page-intro">{L(
            'ISO로 새 VM을 만들고 바로 콘솔에서 OS를 설치합니다. 설치가 끝나면 게스트 에이전트를 넣은 뒤 템플릿으로 바꾸거나 골든 이미지로 등록해 풀에 씁니다.',
            'Make a VM from an ISO and install the OS from its console right away. Once installed, add the guest agent, then turn it into a template or register it as a golden image for pools.')}</p>
          <div className="vm-wizard">
          <ol className="stepper">
            {STEPS.map((s, i) => (
              <li key={s} className={`${s === step ? 'on' : ''}${i < idx ? ' done' : ''}`}>
                <button type="button" onClick={() => setStep(s)} aria-current={s === step ? 'step' : undefined}><span className="stepper-n">{i + 1}</span>{label[s]}</button>
              </li>
            ))}
          </ol>
          <form className="form" onSubmit={(e) => { e.preventDefault(); if (step === 'review') void create(); else setStep(STEPS[idx + 1]); }}>
            {step === 'base' && (
              <div className="wiz-body">
                <span className="field-label">{L('OS 종류', 'Operating system')}</span>
                <div className="mode-cards" role="radiogroup" aria-label={L('OS 종류', 'Operating system')}>
                  {osCards.map((o) => (
                    <label key={o.id} className={`mode-card${form.ostype === o.id ? ' on' : ''}`}>
                      <input type="radio" name="ostype" checked={form.ostype === o.id} onChange={() => pickOs(o.id)} />
                      <span className="os-pick"><OsLogo os={o.id === 'win11' || o.id === 'win10' ? 'windows' : o.id === 'l26' ? 'linux' : 'other'} size={28} />
                        <span className="strong">{o.title}</span></span><span className="muted small">{o.hint}</span>
                    </label>
                  ))}
                </div>
                <div className="form-row-three form-row">
                  <label><span>{L('노드', 'Node')}</span>
                    <select id="vm-node" value={node} onChange={(e) => set('node', e.target.value)}>
                      {nodeList.map((x) => <option key={x.node} value={x.node}>{x.node} · {x.cpus} CPU · {bytes(x.mem_total - x.mem_used)} {L('여유', 'free')}</option>)}
                    </select></label>
                  <label><span>{L('VM 이름', 'VM name')}</span>
                    <input id="vm-name" value={form.name} maxLength={63} onChange={(e) => { setTouchedName(true); set('name', e.target.value); }} /></label>
                  <label><span>VMID <small className="muted">{L('(비우면 자동)', '(auto if empty)')}</small></span>
                    <input id="vm-vmid" inputMode="numeric" value={form.vmid} placeholder={vmid.state === 'ok' ? String(vmid.data) : ''}
                      onChange={(e) => set('vmid', e.target.value.replace(/\D/g, ''))} /></label>
                </div>
              </div>
            )}

            {step === 'media' && (
              <div className="wiz-body">
                <label><span>{L('설치 ISO', 'Install ISO')}</span>
                  <select id="vm-iso" value={form.iso} onChange={(e) => set('iso', e.target.value)}>
                    <option value="">{L('고르세요', 'Pick one')}</option>
                    {isoList.filter((i) => !/virtio-win/i.test(i.name)).map((i) => <option key={i.volid} value={i.volid}>{i.name} · {i.storage} · {bytes(i.size)}</option>)}
                  </select></label>
                {win && (
                  <label><span>{L('VirtIO 드라이버 ISO (두 번째 CD)', 'VirtIO driver ISO (second CD)')}</span>
                    <select id="vm-virtio" value={form.virtio_iso || (f.virtio_iso === 'none' ? 'none' : '')} onChange={(e) => set('virtio_iso', e.target.value || 'none')}>
                      <option value="none">{L('쓰지 않음 (SATA 디스크·e1000e 네트워크로 만듦)', 'None (SATA disk and e1000e network instead)')}</option>
                      {isoList.map((i) => <option key={i.volid} value={i.volid}>{i.name} · {i.storage}</option>)}
                    </select></label>
                )}
                {win && form.virtio_iso && (
                  <div className="callout"><Icon name="info" size={16} /><p>{L(
                    'Windows 설치 화면에서 디스크가 보이지 않으면 "드라이버 로드" → 두 번째 CD의 vioscsi\\w11(또는 w10)\\amd64 를 고르세요. 네트워크는 NetKVM 폴더입니다.',
                    'If Windows Setup shows no disk, choose "Load driver" → vioscsi\\w11 (or w10)\\amd64 on the second CD. The network driver is in NetKVM.')}</p></div>
                )}
                {win && !form.virtio_iso && (
                  <p className="muted small">{L('드라이버 ISO 없이는 느린 SATA 디스크와 e1000e 네트워크를 씁니다. virtio-win ISO는 "ISO · 이미지 관리"에서 URL로 받을 수 있습니다.',
                    'Without the driver ISO the VM uses a slower SATA disk and an e1000e card. Get virtio-win from "ISO library" by URL.')}</p>
                )}
                {isoList.length === 0 && isos.state === 'ok' && (
                  <div className="alert small">{L(`노드 ${node}에서 쓸 수 있는 ISO가 없습니다.`, `Node ${node} sees no ISOs.`)} <Link to={`/admin/vms/isos?c=${encodeURIComponent(cid)}`}>{L('ISO 올리기 →', 'Upload one →')}</Link></div>
                )}
              </div>
            )}

            {step === 'hw' && (
              <div className="wiz-body">
                <div className="form-row-three form-row">
                  <label><span>{L('CPU 코어', 'CPU cores')}</span><input id="vm-cores" type="number" min={1} max={128} value={form.cores} onChange={(e) => set('cores', Math.max(1, Number(e.target.value) || 1))} /></label>
                  <label><span>{L('메모리 (GB)', 'Memory (GB)')}</span><input id="vm-mem" type="number" min={1} max={4096} step={1} value={form.memory_gb} onChange={(e) => set('memory_gb', Math.max(1, Number(e.target.value) || 1))} /></label>
                  <label><span>{L('CPU 형식', 'CPU type')}</span>
                    <select id="vm-cpu" value={form.cpu} onChange={(e) => set('cpu', e.target.value)}>
                      <option value="host">host {L('(가장 빠름, 같은 CPU 노드끼리 이동)', '(fastest; migrate between like CPUs)')}</option>
                      <option value="x86-64-v2-AES">x86-64-v2-AES {L('(노드 CPU가 섞였을 때)', '(mixed node CPUs)')}</option>
                      <option value="x86-64-v3">x86-64-v3</option>
                    </select></label>
                </div>
                <div className="form-row">
                  <label><span>{L('디스크 스토리지', 'Disk storage')}</span>
                    <select id="vm-storage" value={form.storage} onChange={(e) => set('storage', e.target.value)}>
                      {diskStores.map((s) => <option key={s.storage} value={s.storage}>{s.storage} ({s.type}{s.shared ? L(', 공유', ', shared') : ''}) · {bytes(Math.max(0, s.total - s.used))} {L('남음', 'free')}</option>)}
                    </select></label>
                  <label><span>{L('디스크 크기 (GB)', 'Disk size (GB)')}</span><input id="vm-disk" type="number" min={8} max={65536} value={form.disk_gb} onChange={(e) => set('disk_gb', Math.max(1, Number(e.target.value) || 1))} /></label>
                </div>
                {pickedStore && !pickedStore.shared && <p className="muted small">{L('노드 로컬 스토리지라 이 VM과 여기서 만든 템플릿은 다른 노드로 연결 복제할 수 없습니다.', 'A node-local storage: this VM and templates made from it stay on this node.')}</p>}
                <div className="form-row">
                  <label><span>{L('네트워크 (브리지)', 'Network (bridge)')}</span>
                    <select id="vm-bridge" value={form.bridge} onChange={(e) => set('bridge', e.target.value)}>
                      {netList.map((n) => <option key={n.iface} value={n.iface}>{n.iface}{n.comments ? ` · ${n.comments}` : ''}{n.type === 'sdn_vnet' ? ' (SDN)' : ''}</option>)}
                    </select></label>
                  <label><span>VLAN <small className="muted">{L('(비우면 없음)', '(none if empty)')}</small></span>
                    <input id="vm-vlan" inputMode="numeric" value={form.vlan} placeholder={bridge?.vlan_aware ? '1-4094' : ''}
                      onChange={(e) => set('vlan', e.target.value.replace(/\D/g, ''))} /></label>
                </div>
                {form.vlan && bridge && !bridge.vlan_aware && bridge.type !== 'sdn_vnet' && <p className="muted small">{L(`${bridge.iface}는 VLAN 인식(VLAN aware)이 꺼져 있습니다. 태그가 통하지 않을 수 있습니다.`, `${bridge.iface} is not VLAN aware; the tag may not pass.`)}</p>}
                <span className="field-label">{L('디스플레이', 'Display')}</span>
                <div className="mode-cards" role="radiogroup" aria-label={L('디스플레이', 'Display')}>
                  {([['qxl', 'SPICE (qxl)', L('기본. SPICE·VNC 모두 접속', 'Default. SPICE and VNC both work')],
                    ['virtio', 'VirtIO-GPU', L('Linux에서 해상도 자동 맞춤', 'Auto resize on Linux')],
                    ['std', L('표준 VGA', 'Standard VGA'), L('드라이버가 없을 때', 'When nothing else works')]] as const).map(([v, title, hint]) => (
                    <label key={v} className={`mode-card${form.vga === v ? ' on' : ''}`}>
                      <input type="radio" name="vga" checked={form.vga === v} onChange={() => set('vga', v)} />
                      <span className="strong">{title}</span><span className="muted small">{hint}</span>
                    </label>
                  ))}
                </div>
                <label className="check"><input id="vm-agent" type="checkbox" checked={form.agent} onChange={(e) => set('agent', e.target.checked)} />
                  <span>{L('QEMU 게스트 에이전트 사용 (설치 뒤 게스트 안에 에이전트를 넣어야 동작)', 'Use the QEMU guest agent (works once the agent is installed in the guest)')}</span></label>
              </div>
            )}

            {step === 'review' && (
              <div className="wiz-body">
                <dl className="review-list">
                  <dt>{L('이름', 'Name')}</dt><dd>{form.name} · VMID {form.vmid || (vmid.state === 'ok' ? vmid.data : '-')} · {node}</dd>
                  <dt>OS</dt><dd>{osCards.find((o) => o.id === form.ostype)?.title}{form.ostype === 'win11' && <span className="muted small"> · UEFI (OVMF) · EFI {L('디스크', 'disk')} · TPM 2.0 · q35</span>}</dd>
                  <dt>ISO</dt><dd>{isoList.find((i) => i.volid === form.iso)?.name ?? '-'}{win && form.virtio_iso && <><br /><span className="muted small">+ {isoList.find((i) => i.volid === form.virtio_iso)?.name}</span></>}</dd>
                  <dt>CPU · {L('메모리', 'Memory')}</dt><dd>{form.cores} {L('코어', 'cores')} ({form.cpu}) · {form.memory_gb} GB</dd>
                  <dt>{L('디스크', 'Disk')}</dt><dd>{form.storage} · {form.disk_gb} GB · {win && !form.virtio_iso ? 'SATA' : 'VirtIO SCSI'}</dd>
                  <dt>{L('네트워크', 'Network')}</dt><dd>{form.bridge}{form.vlan ? ` · VLAN ${form.vlan}` : ''} · {win && !form.virtio_iso ? 'e1000e' : 'VirtIO'}</dd>
                  <dt>{L('디스플레이', 'Display')}</dt><dd>{form.vga === 'qxl' ? 'SPICE (qxl)' : form.vga === 'virtio' ? 'VirtIO-GPU' : 'VGA'}{form.agent ? L(' · 게스트 에이전트 사용', ' · guest agent on') : ''}</dd>
                </dl>
                {firstProblem && <div className="alert small">{problems[firstProblem]}</div>}
              </div>
            )}

            {step !== 'review' && problems[step] && <div className="alert small">{problems[step]}</div>}
            {error && <div className="alert error" role="alert">{error}</div>}
            <div className="form-actions">
              {idx > 0 && <button type="button" className="btn" onClick={() => setStep(STEPS[idx - 1])}>{L('이전', 'Back')}</button>}
              {step === 'review'
                ? <button type="submit" className="btn primary" disabled={busy || !!firstProblem}>{busy ? L('만드는 중…', 'Creating…') : L('VM 만들기', 'Create VM')}</button>
                : <button type="submit" className="btn primary" disabled={!!problems[step]}>{L('다음', 'Next')}</button>}
            </div>
          </form>
          </div>
        </>
      )}
    </LoadState>
  );
}

// after the create: the console to install from, then agent → template or golden image
function AfterCreate({ cluster, vm, onAnother }: { cluster: Cluster; vm: Created & { node: string; name: string }; onAnother: () => void }) {
  const { L } = useL();
  const [task, setTask] = useState<{ running: boolean; ok: boolean; detail: string }>({ running: !!vm.task, ok: !vm.task, detail: '' });
  const [opening, setOpening] = useState(false);
  const [open, setOpen] = useState<{ wsPath: string; password: string } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [golden, setGolden] = useState<{ id: string } | null>(null);
  const [templated, setTemplated] = useState(false);
  const [busy, setBusy] = useState(false);

  // the create runs as a task: wait for it before the console
  useEffect(() => {
    if (!vm.task) return;
    let live = true;
    (async () => {
      for (let i = 0; i < 150 && live; i++) {
        try {
          const t = await buildApi.task(cluster.id, vm.node, vm.task!);
          if (!live) return;
          if (!t.running) { setTask({ running: false, ok: t.ok, detail: t.ok ? '' : t.exitstatus || t.last }); return; }
        } catch { setTask({ running: false, ok: true, detail: '' }); return; }   // unreadable: let the console try
        await new Promise((r) => setTimeout(r, 1500));
      }
    })();
    return () => { live = false; };
  }, [cluster.id, vm.node, vm.task]);

  // the engine starts a stopped VM and answers STARTING (or BUSY while the create still
  // holds its lock): ask again for up to half a minute
  async function openConsole() {
    setOpening(true); setNotice(null);
    try {
      for (let i = 0; i < 15; i++) {
        try {
          const r = await buildApi.console(cluster.id, vm.vmid);
          setOpen({ wsPath: r.ws_path, password: r.password });
          return;
        } catch (e) {
          const code = errCode(e);
          if (code !== 'STARTING' && code !== 'BUSY') throw e;
          setNotice({ kind: 'info', text: L('VM을 켜는 중입니다…', 'Starting the VM…') });
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      throw new Error(L('VM이 켜지지 않았습니다. 잠시 뒤 다시 눌러 주세요.', 'The VM did not come up. Try again in a moment.'));
    } catch (e) { setNotice({ kind: 'error', text: errText(e) }); } finally { setOpening(false); }
  }

  async function toTemplate() {
    if (!confirm(L(`${vm.name}을(를) 템플릿으로 바꿀까요? 템플릿은 켤 수 없고 복제의 원본으로만 씁니다.`, `Turn ${vm.name} into a template? A template cannot be started; it is only cloned from.`))) return;
    setBusy(true); setNotice(null);
    try { await buildApi.makeTemplate(cluster.id, vm.vmid); setTemplated(true); setNotice({ kind: 'info', text: L('템플릿으로 바꿨습니다.', 'It is a template now.') }); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); } finally { setBusy(false); }
  }

  async function toGolden() {
    setBusy(true); setNotice(null);
    try { const g = await nextApi.addGolden({ cluster_id: cluster.id, vmid: vm.vmid, notes: L('VM 만들기로 설치', 'Installed with Make a VM') }); setGolden({ id: g.id }); }
    catch (e) { setNotice({ kind: 'error', text: errText(e) }); } finally { setBusy(false); }
  }

  const done = templated || !!golden;
  return (
    <div className="vm-after">
      <div className="panel-head">
        <span className="stat-icon"><Icon name="vm" size={20} /></span>
        <div><h2 className="section-title">{L(`${vm.name} (VMID ${vm.vmid})를 만들었습니다`, `Created ${vm.name} (VMID ${vm.vmid})`)}</h2>
          <span className="muted small">{cluster.name} · {vm.node}</span></div>
      </div>
      {task.running && <p className="muted small">{L('Proxmox가 디스크를 만드는 중입니다…', 'Proxmox is creating the disks…')}</p>}
      {!task.running && !task.ok && <div className="alert error">{L('만들기 작업이 실패했습니다: ', 'The create task failed: ')}{task.detail}</div>}
      <NoticeBar notice={notice} />
      <ol className="build-steps">
        <li>
          <span className="strong">{L('OS 설치', 'Install the OS')}</span>
          <span className="muted small">{L('콘솔을 열면 VM을 켜고 ISO로 부팅합니다. "Press any key to boot from CD" 가 보이면 바로 아무 키나 누르세요.',
            'Opening the console starts the VM and boots the ISO. Press a key when it says "Press any key to boot from CD".')}</span>
          <span><button type="button" className="btn primary small-btn" disabled={opening || task.running || templated} onClick={openConsole}>
            <Icon name="play" size={14} />{opening ? L('여는 중…', 'Opening…') : L('설치 콘솔 열기', 'Open install console')}</button></span>
        </li>
        <li>
          <span className="strong">{L('게스트 에이전트 설치', 'Install the guest agent')}</span>
          <span className="muted small">{L(
            'Windows: 두 번째 CD(virtio-win)의 virtio-win-guest-tools.exe 를 실행하면 드라이버·QEMU 게스트 에이전트·SPICE 도구가 함께 들어갑니다. Linux: qemu-guest-agent 패키지를 설치하고 켭니다(apt/dnf install qemu-guest-agent, systemctl enable --now qemu-guest-agent). 필요한 프로그램과 업데이트를 넣은 뒤 Windows는 sysprep으로 일반화하고 VM을 끕니다.',
            'Windows: run virtio-win-guest-tools.exe from the second CD (virtio-win); it installs the drivers, the QEMU guest agent and the SPICE tools. Linux: install and enable qemu-guest-agent. Add your software and updates, generalise Windows with sysprep, then shut the VM down.')}</span>
        </li>
        <li>
          <span className="strong">{L('풀에 쓸 준비', 'Make it ready for pools')}</span>
          <span className="muted small">{L('템플릿: 연결 복제로 많은 데스크톱을 빨리 만듭니다(VM을 끈 뒤). 골든 이미지: VM으로 두고 고칠 때마다 버전을 만들어 배포합니다.',
            'Template: fast linked clones for many desktops (shut the VM down first). Golden image: stays a VM; make a version after each change and deploy it.')}</span>
          <span className="build-actions">
            {templated ? <Link className="btn small-btn" to={`/admin/vms/templates?c=${encodeURIComponent(cluster.id)}`}>{L('템플릿 관리로 →', 'Go to Templates →')}</Link>
              : <button type="button" className="btn small-btn" disabled={busy || done} onClick={toTemplate}>{L('템플릿으로 변환', 'Convert to template')}</button>}
            {golden ? <Link className="btn small-btn" to="/admin/vms/golden">{L('골든 이미지 관리로 →', 'Go to Golden images →')}</Link>
              : <button type="button" className="btn small-btn" disabled={busy || done} onClick={toGolden}>{L('골든 이미지로 등록', 'Register as golden image')}</button>}
          </span>
        </li>
      </ol>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onAnother}><Icon name="plus" size={14} />{L('VM 하나 더 만들기', 'Make another VM')}</button>
      </div>
      {isMock && open && <p className="muted small">{L('모의 모드: 콘솔 연결은 "끊김"으로 보입니다.', 'Mock mode: the console shows as disconnected.')}</p>}
      {open && (
        <Suspense fallback={null}>
          <ConsoleWindow title={`${vm.name} · VMID ${vm.vmid}`} wsPath={open.wsPath} password={open.password} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </div>
  );
}
