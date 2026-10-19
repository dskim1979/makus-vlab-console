import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { buildApi } from '../../api/build';
import type { Iso, Network } from '../../api/build';
import { desktplApi } from '../../api/desktpl';
import type { DeskBuild, DeskBuildInput, DeskBuildStarted, DeskPreset } from '../../api/desktpl';
import type { Cluster, ClusterStorage } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { OsLogo } from '../../components/OsLogo';
import { useLoad } from '../../components/useLoad';
import { useFeatures } from '../../features';
import { useI18n } from '../../i18n';
import { bytes, ClusterFrame, Meter } from './ClusterPages';

// 가상머신 > 이미지 > 데스크톱 템플릿: ready-made desktops built on the cluster - 일반 업무 (Windows 11 from the
// admin's ISO, unattended), 연구원, GPU · AI, NPU, FPGA (Ubuntu cloud images + first-boot setup). Linux ones end
// as golden images with their environment card, Windows as a Proxmox template (makus-vlab pegaprox/api/vlab_desktpl.py).

function useL() {
  const { pick } = useI18n();
  return (ko: string, en: string) => pick({ ko, en });
}

const FEATURE_OF: Record<string, 'gpuai' | 'fpga' | undefined> = { gpu: 'gpuai', npu: 'gpuai', fpga: 'fpga' };

export function DesktopTemplatesPage() {
  return <ClusterFrame>{(c) => <DesktopTemplates key={c.id} cluster={c} />}</ClusterFrame>;
}

function DesktopTemplates({ cluster }: { cluster: Cluster }) {
  const L = useL();
  const features = useFeatures();
  const data = useLoad(desktplApi.list);
  const [making, setMaking] = useState<DeskPreset | null>(null);
  const [started, setStarted] = useState<DeskBuildStarted | null>(null);
  const [logOf, setLogOf] = useState<string | null>(null);
  const running = data.state === 'ok' && data.data.builds.some((b) => b.status === 'running' || b.status === 'queued');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => data.reload(), 5000);
    return () => clearInterval(t);
  }, [running, data]);

  return (
    <LoadState value={data} retry={data.reload}>
      {(d) => {
        const presets = d.presets.filter((p) => !FEATURE_OF[p.id] || features.on(FEATURE_OF[p.id]));
        const builds = d.builds.filter((b) => b.cluster_id === cluster.id);
        return (
          <>
            <p className="muted small page-intro">{L('용도에 맞는 데스크톱을 클러스터에서 바로 만듭니다. Linux는 골든 이미지로, Windows는 템플릿으로 등록됩니다.',
              'Build a desktop for the job right on the cluster. Linux ends as a golden image, Windows as a template.')}</p>
            <div className="profile-grid desktpl-grid">
              {presets.map((p) => (
                <div key={p.id} className="profile-card desktpl-card">
                  <span className="os-pick"><OsLogo os={p.os === 'windows' ? 'windows' : 'linux'} size={28} /><span className="strong">{L(p.name, p.name_en)}</span></span>
                  <span className="muted small">{p.summary}</span>
                  <span className="desktpl-meta muted small">
                    {p.cores} vCPU · {p.memory_mb / 1024} GB · {p.disk_gb} GB · {p.output === 'golden' ? L('골든 이미지', 'Golden image') : L('템플릿', 'Template')}
                  </span>
                  <span><button type="button" className="btn primary small-btn" onClick={() => setMaking(p)}><Icon name="plus" size={14} />{L('만들기', 'Build')}</button></span>
                </div>
              ))}
            </div>
            <section className="panel">
              <div className="panel-head"><h3 className="panel-title">{L('만든 기록', 'Builds')}</h3>
                <span className="panel-actions"><button type="button" className="btn-ghost small-btn" onClick={data.reload}><Icon name="refresh" size={14} />{L('새로 고침', 'Refresh')}</button></span></div>
              {builds.length === 0 ? <p className="muted small">{L('아직 없습니다. 위에서 템플릿을 고르세요.', 'None yet. Pick a template above.')}</p> : (
                <div className="table-scroll"><table className="table compact-head">
                  <thead><tr><th>{L('이름', 'Name')}</th><th>{L('템플릿', 'Template')}</th><th>{L('노드 · VMID', 'Node · VMID')}</th><th>{L('상태', 'State')}</th><th>{L('진행', 'Progress')}</th><th /></tr></thead>
                  <tbody>{builds.map((b) => (
                    <tr key={b.id}>
                      <td className="strong">{b.name}</td>
                      <td>{L(d.presets.find((p) => p.id === b.preset)?.name ?? b.preset, d.presets.find((p) => p.id === b.preset)?.name_en ?? b.preset)}</td>
                      <td className="nowrap">{b.node} · {b.vmid || '-'}</td>
                      <td><BuildState b={b} /></td>
                      <td className="desktpl-progress">{b.status === 'running' ? <Meter value={b.progress} label={`${b.progress}%`} /> : <span className="muted small">{b.status === 'completed' ? '100%' : `${b.progress}%`}</span>}</td>
                      <td className="actions nowrap">
                        {b.result.golden_id && <Link className="btn-ghost small-btn" to="/admin/vms/golden">{L('골든 이미지 →', 'Golden image →')}</Link>}
                        {b.result.template_vmid && <Link className="btn-ghost small-btn" to="/admin/vms/templates">{L('템플릿 →', 'Template →')}</Link>}
                        <button type="button" className="btn-ghost small-btn" onClick={() => setLogOf(b.id)}>{L('기록', 'Log')}</button>
                        {(b.status === 'running' || b.status === 'queued') && (
                          <button type="button" className="btn-ghost small-btn danger" onClick={async () => {
                            if (!confirm(L(`'${b.name}' 만들기를 멈출까요? 지금 단계가 끝나면 멈추고, VM은 확인할 수 있게 남겨 둡니다.`, `Stop building '${b.name}'? It stops after the current step; the VM is kept.`))) return;
                            await desktplApi.cancel(b.id); data.reload();
                          }}>{L('멈추기', 'Stop')}</button>)}
                      </td>
                    </tr>))}</tbody>
                </table></div>)}
            </section>
            {making && <BuildDialog cluster={cluster} preset={making} onClose={() => setMaking(null)}
              onStarted={(s) => { setMaking(null); data.reload(); if (s.admin_password) setStarted(s); }} />}
            {started && <PasswordDialog started={started} onClose={() => setStarted(null)} />}
            {logOf && <LogDialog id={logOf} onClose={() => setLogOf(null)} />}
          </>
        );
      }}
    </LoadState>
  );
}

function BuildState({ b }: { b: DeskBuild }) {
  const L = useL();
  const map: Record<DeskBuild['status'], [string, string, string]> = {
    queued: ['st-pending', '대기', 'Queued'], running: ['st-busy', '만드는 중', 'Building'], completed: ['st-ready', '완료', 'Done'],
    failed: ['st-error', '실패', 'Failed'], cancelled: ['st-off', '멈춤', 'Stopped'], interrupted: ['st-error', '중단됨', 'Interrupted'],
  };
  const [cls, ko, en] = map[b.status];
  return (
    <span className="desktpl-state">
      <span className={`status ${cls}`}><span className="dot" />{L(ko, en)}</span>
      {b.status === 'running' && b.step && <span className="muted small">{b.step}</span>}
      {(b.status === 'failed' || b.status === 'interrupted') && <span className="muted small" title={b.error}>{b.error || L('엔진이 다시 시작되어 끊겼습니다', 'The engine restarted')}</span>}
    </span>
  );
}

function BuildDialog({ cluster, preset, onClose, onStarted }: { cluster: Cluster; preset: DeskPreset; onClose: () => void; onStarted: (s: DeskBuildStarted) => void }) {
  const L = useL();
  const cid = cluster.id;
  const win = preset.os === 'windows';
  const nodes = useLoad(useCallback(() => adminApi.nodes(cid), [cid]), [cid]);
  const storage = useLoad(useCallback(() => adminApi.storage(cid), [cid]), [cid]);
  const [f, setF] = useState<DeskBuildInput>({ node: '', storage: '', bridge: '', name: `moavi-${preset.id}`, cores: preset.cores, memory_mb: preset.memory_mb, disk_gb: preset.disk_gb,
    edition: 'Windows 11 Pro', language: 'ko-KR', windows_iso: '', virtio_iso: '', vendor_dir: '', accept_eula: false, iso_storage: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof DeskBuildInput>(k: K, v: DeskBuildInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const nodeList = nodes.state === 'ok' ? nodes.data.filter((n) => n.online) : [];
  const node = f.node || nodeList[0]?.node || '';
  const isos = useLoad(useCallback(() => (node && win ? buildApi.isos(cid, node) : Promise.resolve([] as Iso[])), [cid, node, win]), [cid, node, win]);
  const nets = useLoad(useCallback(() => (node ? buildApi.networks(cid, node) : Promise.resolve([] as Network[])), [cid, node]), [cid, node]);
  const on = (list: ClusterStorage[], content: string) => list.filter((s) => s.content.includes(content) && s.nodes.includes(node) && s.status !== 'unknown')
    .filter((s, i, all) => all.findIndex((x) => x.storage === s.storage) === i);
  const disks = storage.state === 'ok' ? on(storage.data, 'images') : [];
  const isoStores = storage.state === 'ok' ? on(storage.data, 'iso') : [];
  const isoList = isos.state === 'ok' ? isos.data : [];
  const netList = nets.state === 'ok' ? nets.data : [];
  const disk = disks.some((s) => s.storage === f.storage) ? f.storage : disks[0]?.storage ?? '';
  // default: a plain Linux bridge (vmbr*), not an SDN vnet that sorts first
  const bridge = netList.some((n) => n.iface === f.bridge) ? f.bridge
    : (netList.find((n) => n.type === 'bridge' && /^vmbr/.test(n.iface)) ?? netList.find((n) => n.type !== 'sdn_vnet') ?? netList[0])?.iface ?? '';
  const virtioGuess = isoList.find((i) => /virtio-win/i.test(i.name))?.volid ?? '';
  const winIso = f.windows_iso || isoList.find((i) => /win(dows)?[ _-]?11/i.test(i.name))?.volid || '';
  const virtio = f.virtio_iso || virtioGuess;
  const vendor = (f.vendor_dir ?? '').trim();
  const needsEula = preset.id === 'fpga' && !!vendor;

  async function submit() {
    setError(null);
    if (win && (!winIso || !virtio)) { setError(L('Windows 11 ISO와 virtio-win ISO를 고르세요.', 'Pick the Windows 11 ISO and the virtio-win ISO.')); return; }
    if (needsEula && !f.accept_eula) { setError(L('Vivado를 설치하려면 AMD 라이선스 동의에 체크하세요.', 'Tick the AMD licence agreement to install Vivado.')); return; }
    setBusy(true);
    try {
      const body: DeskBuildInput = { node, storage: disk, bridge, name: f.name, cores: f.cores, memory_mb: f.memory_mb, disk_gb: f.disk_gb,
        ...(win ? { windows_iso: winIso, virtio_iso: virtio, edition: f.edition, language: f.language } : {}),
        ...(!win && f.iso_storage ? { iso_storage: f.iso_storage } : {}),
        ...(vendor ? { vendor_dir: vendor } : {}), ...(needsEula ? { accept_eula: true } : {}) };
      onStarted(await desktplApi.build(cid, preset.id, body));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog open wide title={L(`${preset.name} 만들기`, `Build ${preset.name_en}`)} onClose={onClose} onSubmit={submit}
      submitLabel={L('만들기 시작', 'Start building')} busy={busy || !node || !disk} error={error}>
      <p className="muted small">{preset.summary}</p>
      <div className="form-row form-row-three">
        <label><span>{L('노드', 'Node')}</span>
          <select value={node} onChange={(e) => set('node', e.target.value)}>{nodeList.map((n) => <option key={n.node} value={n.node}>{n.node}</option>)}</select></label>
        <label><span>{L('디스크 스토리지', 'Disk storage')}</span>
          <select value={disk} onChange={(e) => set('storage', e.target.value)}>
            {disks.map((s) => <option key={s.storage} value={s.storage}>{s.storage} · {bytes(Math.max(0, s.total - s.used))} {L('남음', 'free')}</option>)}
          </select></label>
        <label><span>{L('네트워크', 'Network')}</span>
          <select value={bridge} onChange={(e) => set('bridge', e.target.value)}>{netList.map((n) => <option key={n.iface} value={n.iface}>{n.iface}</option>)}</select></label>
      </div>
      <label><span>{L('이름', 'Name')}</span><input value={f.name} maxLength={63} onChange={(e) => set('name', e.target.value.trim())} /></label>
      {win && (
        <>
          <div className="form-row form-row-even">
            <label><span>Windows 11 ISO</span>
              <select value={winIso} onChange={(e) => set('windows_iso', e.target.value)}>
                <option value="">{L('고르세요', 'Pick one')}</option>
                {isoList.filter((i) => !/virtio-win/i.test(i.name)).map((i) => <option key={i.volid} value={i.volid}>{i.name} · {i.storage}</option>)}
              </select></label>
            <label><span>{L('virtio-win 드라이버 ISO', 'virtio-win driver ISO')}</span>
              <select value={virtio} onChange={(e) => set('virtio_iso', e.target.value)}>
                <option value="">{L('고르세요', 'Pick one')}</option>
                {isoList.map((i) => <option key={i.volid} value={i.volid}>{i.name} · {i.storage}</option>)}
              </select></label>
          </div>
          <div className="form-row form-row-even">
            <label><span>{L('에디션 (ISO 안의 이미지 이름)', 'Edition (image name in the ISO)')}</span><input value={f.edition} onChange={(e) => set('edition', e.target.value)} /></label>
            <label><span>{L('ISO 언어', 'ISO language')}</span>
              <select value={f.language} onChange={(e) => set('language', e.target.value as 'ko-KR' | 'en-US')}><option value="ko-KR">한국어 (ko-KR)</option><option value="en-US">English (en-US)</option></select></label>
          </div>
          {isos.state === 'ok' && !virtioGuess && <div className="alert small">{L('virtio-win ISO가 없습니다. ISO · 이미지에서 URL로 받으세요.', 'No virtio-win ISO: get it under ISO library by URL.')} <Link to="/admin/vms/isos">{L('ISO · 이미지 →', 'ISO library →')}</Link></div>}
          <small className="muted">{L('관리자 계정 moavi-admin 의 비밀번호는 시작할 때 한 번만 보여 드립니다. 저장하지 않습니다.', 'The moavi-admin password is shown once when the build starts. It is not stored.')}</small>
        </>
      )}
      {!win && (
        <label><span>{L('설치용 CD를 둘 ISO 스토리지', 'ISO storage for the setup CD')}</span>
          <select value={f.iso_storage} onChange={(e) => set('iso_storage', e.target.value)}>
            <option value="">{L('자동 (local 우선)', 'Automatic (local first)')}</option>
            {isoStores.map((s) => <option key={s.storage} value={s.storage}>{s.storage}</option>)}
          </select>
          <small className="muted">{L('첫 부팅 설정을 담은 작은 CD를 잠시 두었다가, 다 만든 뒤 지웁니다.', 'A small first-boot CD is kept there during the build and deleted after.')}</small>
        </label>
      )}
      {(preset.id === 'npu' || preset.id === 'fpga') && (
        <label><span>{preset.id === 'fpga' ? L('Vivado 설치 파일 폴더 (NFS, 선택)', 'Vivado installer folder (NFS, optional)') : L('NPU 벤더 패키지 폴더 (NFS, 선택)', 'NPU vendor package folder (NFS, optional)')}</span>
          <input value={f.vendor_dir} placeholder="nas.lab.example:/export/vendor/vivado-2024.2" onChange={(e) => set('vendor_dir', e.target.value)} />
          <small className="muted">{preset.id === 'fpga'
            ? L('압축을 푼 통합 설치 파일(xsetup)과 install_config.txt(xsetup -b ConfigGen 으로 한 번 만듦)를 둡니다. 비우면 Vivado 없이 라이브러리 · JTAG 설정까지 합니다.',
              'The unpacked unified installer (xsetup) and install_config.txt (made once with xsetup -b ConfigGen). Empty: libraries and JTAG only.')
            : L('벤더에서 받은 드라이버 · 런타임 · SDK 파일(.deb, .whl, install.sh)을 둡니다. 비우면 OS · 개발 환경까지만 합니다.',
              'The vendor driver, runtime and SDK files (.deb, .whl, install.sh). Empty: the OS and dev tools only.')}</small></label>
      )}
      {needsEula && (
        <label className="check"><input type="checkbox" checked={!!f.accept_eula} onChange={(e) => set('accept_eula', e.target.checked)} />
          <span>{L('AMD(Xilinx) 최종 사용자 라이선스와 제3자 라이선스에 동의합니다 (설치에 필요)', 'I accept the AMD (Xilinx) end user and third-party licence agreements (needed to install)')}</span></label>
      )}
      <details className="small"><summary>{L('하드웨어', 'Hardware')}</summary>
        <div className="form-row form-row-three">
          <label><span>vCPU</span><input type="number" min={1} max={128} value={f.cores} onChange={(e) => set('cores', Number(e.target.value) || 1)} /></label>
          <label><span>{L('메모리 (MB)', 'Memory (MB)')}</span><input type="number" min={1024} step={1024} value={f.memory_mb} onChange={(e) => set('memory_mb', Number(e.target.value) || 1024)} /></label>
          <label><span>{L('디스크 (GB)', 'Disk (GB)')}</span><input type="number" min={16} value={f.disk_gb} onChange={(e) => set('disk_gb', Number(e.target.value) || 16)} /></label>
        </div>
      </details>
      <small className="muted">{win ? L('설치 · 업데이트 · 앱 설치까지 30분~1시간 걸립니다.', 'Setup, updates and apps take 30 min to an hour.')
        : preset.id === 'gpu' ? L('패키지를 받아 설치하므로 40분~1시간 30분 걸립니다.', 'Packages are downloaded and installed: 40 min to 1.5 h.')
          : L('패키지를 받아 설치하므로 20분~1시간 걸립니다. Vivado를 넣으면 몇 시간 더 걸립니다.', 'Packages are downloaded and installed: 20 min to an hour; Vivado adds hours.')}</small>
      <small className="muted">{win ? L('Chrome · 7-Zip은 인터넷에서 받습니다. 노드와 VM이 인터넷에 닿아야 합니다.', 'Chrome and 7-Zip come from the Internet: the node and the VM need to reach it.')
        : L('OS 이미지 · 패키지는 인터넷(Ubuntu · NVIDIA · PyTorch · GitHub)에서 받습니다. 노드와 VM이 인터넷에 닿아야 합니다.', 'The OS image and packages come from the Internet (Ubuntu, NVIDIA, PyTorch, GitHub): the node and the VM need to reach it.')}</small>
    </Dialog>
  );
}

function PasswordDialog({ started, onClose }: { started: DeskBuildStarted; onClose: () => void }) {
  const L = useL();
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open title={L('관리자 비밀번호 (한 번만 표시)', 'Administrator password (shown once)')} onClose={onClose}>
      <p className="small">{L(`템플릿의 로컬 관리자 ${started.admin_user} 비밀번호입니다. 지금 안전한 곳에 적어 두세요. 다시 볼 수 없습니다.`,
        `The template's local administrator ${started.admin_user}. Note it somewhere safe now: it cannot be shown again.`)}</p>
      <div className="toolbar"><code className="code token-box">{started.admin_password}</code>
        <button type="button" className="btn small-btn" onClick={() => { void navigator.clipboard?.writeText(started.admin_password ?? '').then(() => setCopied(true)).catch(() => {}); }}>
          {copied ? L('복사됨', 'Copied') : L('복사', 'Copy')}</button></div>
    </Dialog>
  );
}

function LogDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const L = useL();
  const b = useLoad(useCallback(() => desktplApi.get(id), [id]), [id]);
  useEffect(() => {
    if (b.state !== 'ok' || b.data.status !== 'running') return;
    const t = setInterval(() => b.reload(), 5000);
    return () => clearInterval(t);
  }, [b]);
  return (
    <Dialog open wide title={L('만들기 기록', 'Build log')} onClose={onClose}>
      <LoadState value={b} retry={b.reload}>{(x) => (
        <>
          <p className="small"><span className="strong">{x.name}</span> · {x.node} · VMID {x.vmid || '-'} · <BuildState b={x} /></p>
          <pre className="snippet desktpl-log">{x.log || L('아직 기록이 없습니다.', 'Nothing yet.')}</pre>
        </>
      )}</LoadState>
    </Dialog>
  );
}
