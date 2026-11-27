import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/admin';
import { buildApi } from '../../api/build';
import type { Iso, Network } from '../../api/build';
import { desktplApi } from '../../api/desktpl';
import type { DeskBuild, DeskBuildInput, DeskBuildStarted, DeskDesktop, DeskPreset } from '../../api/desktpl';
import type { Cluster, ClusterStorage } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { OsLogo } from '../../components/OsLogo';
import { useLoad } from '../../components/useLoad';
import { useFeatures } from '../../features';
import { useI18n } from '../../i18n';
import { bytes, ClusterFrame, Meter } from './ClusterPages';

// 가상머신 > 이미지 > 템플릿 만들기: ready-made desktops built on the cluster - 일반 업무 (Windows 11 from the
// admin's ISO, unattended), 연구원, GPU · AI, NPU, FPGA (Ubuntu cloud images + first-boot setup). Linux ones end
// as golden images with their environment card, Windows as a Proxmox template (makus-vlab pegaprox/api/vlab_desktpl.py).

function useL() {
  const { pick } = useI18n();
  return (ko: string, en: string) => pick({ ko, en });
}

const FEATURE_OF: Record<string, 'gpuai' | 'fpga' | undefined> = { gpu: 'gpuai', npu: 'gpuai', fpga: 'fpga' };
// ISOs whose name says someone other than Microsoft repackaged them (pegaprox/vlab/desktpl.py REPACK_RE)
const REPACK = /(\d+in1|remiz|adguard|_by_|ghost|lite|tiny11|tiny10|modified|repack)/i;

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
            <p className="muted small page-intro">{L('용도별 데스크톱을 클러스터에서 만듭니다. Linux는 골든 이미지, Windows는 템플릿이 됩니다.',
              'Build a desktop for the job right on the cluster. Linux ends as a golden image, Windows as a template.')}</p>
            <div className="profile-grid desktpl-grid">
              {presets.map((p) => (
                <div key={p.id} className="profile-card desktpl-card">
                  <span className="os-pick"><OsLogo os={p.platform === 'windows' ? 'windows' : 'linux'} size={28} /><span className="strong">{L(p.name, p.name_en)}</span></span>
                  <span className="muted small">{p.summary}</span>
                  <span className="desktpl-oses small">{p.os_options.map((o) => <span key={o.id} className="chip">{o.name.replace(' LTS', '')}</span>)}</span>
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
                      <td>{L(d.presets.find((p) => p.id === b.preset)?.name ?? b.preset, d.presets.find((p) => p.id === b.preset)?.name_en ?? b.preset)}
                        {typeof b.options.os === 'string' && <span className="muted small"> · {d.presets.flatMap((p) => p.os_options).find((o) => o.id === b.options.os)?.name ?? String(b.options.os)}</span>}</td>
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
  const win = preset.platform === 'windows';
  const nodes = useLoad(useCallback(() => adminApi.nodes(cid), [cid]), [cid]);
  const storage = useLoad(useCallback(() => adminApi.storage(cid), [cid]), [cid]);
  const [f, setF] = useState<DeskBuildInput & { source?: 'net' | 'local'; virtio_source?: 'net' | 'local' }>({ node: '', storage: '', bridge: '', name: '', cores: preset.cores, memory_mb: preset.memory_mb, disk_gb: preset.disk_gb,
    os: preset.os_default, desktop: 'xfce', edition: '', language: 'ko-KR', windows_iso: '', windows_url: '', virtio_iso: '', product_key: '', source: undefined, virtio_source: undefined, vendor_dir: '', accept_eula: false, iso_storage: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  type Form = DeskBuildInput & { source?: 'net' | 'local'; virtio_source?: 'net' | 'local' };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const osd = preset.os_options.find((o) => o.id === f.os) ?? preset.os_options[0];
  const name = f.name || `moavi-${preset.id}-${osd.id.replace(/-/g, '')}`;
  const edition = f.edition || osd.edition || '';
  const nodeList = nodes.state === 'ok' ? nodes.data.filter((n) => n.online) : [];
  const node = f.node || nodeList[0]?.node || '';
  const isos = useLoad(useCallback(() => (node && win ? buildApi.isos(cid, node) : Promise.resolve([] as Iso[])), [cid, node, win]), [cid, node, win]);
  const nets = useLoad(useCallback(() => (node ? buildApi.networks(cid, node) : Promise.resolve([] as Network[])), [cid, node]), [cid, node]);
  const on = (list: ClusterStorage[], content: string) => list.filter((s) => s.content.includes(content) && s.nodes.includes(node) && s.status !== 'unknown')
    .filter((s, i, all) => all.findIndex((x) => x.storage === s.storage) === i);
  const disks = storage.state === 'ok' ? on(storage.data, 'images') : [];
  const isoStores = storage.state === 'ok' ? on(storage.data, 'iso') : [];
  // the setup CDs a build puts there for a while are not ISOs to pick
  const isoList = (isos.state === 'ok' ? isos.data : []).filter((i) => !/^moavi-(unattend|cidata)-/i.test(i.name));
  const netList = nets.state === 'ok' ? nets.data : [];
  const disk = disks.some((s) => s.storage === f.storage) ? f.storage : disks[0]?.storage ?? '';
  // default: a plain Linux bridge (vmbr*), not an SDN vnet that sorts first
  const bridge = netList.some((n) => n.iface === f.bridge) ? f.bridge
    : (netList.find((n) => n.type === 'bridge' && /^vmbr/.test(n.iface)) ?? netList.find((n) => n.type !== 'sdn_vnet') ?? netList[0])?.iface ?? '';
  const virtioGuess = isoList.find((i) => /virtio-win/i.test(i.name))?.volid ?? '';
  const hint = osd.iso_hint ? new RegExp(osd.iso_hint, 'i') : null;
  const repack = (n: string) => REPACK.test(n);
  const winIsos = isoList.filter((i) => !/virtio/i.test(i.name));
  const goodLocal = hint ? winIsos.find((i) => hint.test(i.name) && !repack(i.name))?.volid ?? '' : '';
  // where Windows comes from: the Internet (Microsoft) or an ISO already on the server; by default the server's
  // own ISO of this Windows when there is one that does not look repackaged, else the Internet
  const source = f.source ?? (goodLocal ? 'local' : 'net');
  const fromNet = source === 'net';
  const winIso = fromNet ? '' : f.windows_iso || goodLocal || winIsos.find((i) => hint?.test(i.name))?.volid || '';
  const virtioSource = f.virtio_source ?? (virtioGuess ? 'local' : 'net');
  const virtio = virtioSource === 'net' ? 'auto' : f.virtio_iso || virtioGuess;
  const pickedIso = fromNet ? undefined : isoList.find((i) => i.volid === winIso);
  const url = (f.windows_url ?? '').trim();
  const vendor = (f.vendor_dir ?? '').trim();
  const needsEula = preset.id === 'fpga' && !!vendor;

  async function submit() {
    setError(null);
    if (win && !fromNet && !winIso) { setError(L(`서버에 있는 ${osd.name} ISO를 고르세요.`, `Pick the ${osd.name} ISO on the server.`)); return; }
    if (win && virtioSource === 'local' && !virtio) { setError(L('서버에 있는 virtio-win ISO를 고르세요.', 'Pick the virtio-win ISO on the server.')); return; }
    if (win && fromNet && !/^https:\/\/([a-z0-9-]+\.)*microsoft\.com\//i.test(url)) {
      setError(L('Microsoft 다운로드 페이지에서 복사한 링크(https://…microsoft.com/…)를 붙여 넣으세요.', 'Paste the link copied from the Microsoft download page (https://…microsoft.com/…).')); return;
    }
    if (needsEula && !f.accept_eula) { setError(L('Vivado를 설치하려면 AMD 라이선스 동의에 체크하세요.', 'Tick the AMD licence agreement to install Vivado.')); return; }
    setBusy(true);
    try {
      const key = (f.product_key ?? '').trim();
      const body: DeskBuildInput = { node, storage: disk, bridge, name, cores: f.cores, memory_mb: f.memory_mb, disk_gb: f.disk_gb, os: osd.id,
        ...(win ? { ...(fromNet ? { windows_url: url } : { windows_iso: winIso }), virtio_iso: virtio, edition, language: f.language, ...(key ? { product_key: key } : {}) }
          : { desktop: f.desktop }),
        ...(f.iso_storage ? { iso_storage: f.iso_storage } : {}),
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
      <div className="form-row form-row-even">
        <label><span>{L('운영체제', 'Operating system')}</span>
          <select value={osd.id} onChange={(e) => setF((x) => ({ ...x, os: e.target.value, edition: '', windows_iso: '' }))}>
            {preset.os_options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></label>
        <label><span>{L('이름', 'Name')}</span><input value={name} maxLength={63} onChange={(e) => set('name', e.target.value.trim())} /></label>
      </div>
      {!win && (
        <>
          <span className="field-label">{L('데스크톱 환경', 'Desktop')}</span>
          <div className="mode-cards mode-cards-2" role="radiogroup" aria-label={L('데스크톱 환경', 'Desktop')}>
            {([['xfce', 'Xfce', L('가볍고 원격 접속에 가장 잘 맞습니다 (기본)', 'Light, the best fit for remote sessions (default)')],
              ['gnome', 'GNOME', L('익숙한 화면, 메모리와 대역폭을 더 씁니다', 'The familiar look; more memory and bandwidth')]] as [DeskDesktop, string, string][]).map(([v, t, h]) => (
              <label key={v} className={`mode-card${f.desktop === v ? ' on' : ''}`}>
                <input type="radio" name="desktpl-desktop" checked={f.desktop === v} onChange={() => set('desktop', v)} />
                <span className="strong">{t}</span><span className="muted small">{h}</span>
              </label>))}
          </div>
        </>
      )}
      {win && (
        <>
          <span className="field-label">{L(`${osd.name} 설치 파일`, `${osd.name} setup files`)}</span>
          <div className="mode-cards mode-cards-2" role="radiogroup" aria-label={L('설치 파일', 'Setup files')}>
            {([['net', L('인터넷에서 받기', 'From the Internet'), L('Microsoft 공식 다운로드 링크로 노드가 직접 받습니다', 'The node downloads it from a Microsoft link')],
              ['local', L('로컬 ISO', 'Local ISO'), L('서버 스토리지에 올려 둔 ISO로 설치합니다', 'An ISO already on a storage of the cluster')]] as ['net' | 'local', string, string][]).map(([v, t, h]) => (
              <label key={v} className={`mode-card${source === v ? ' on' : ''}`}>
                <input type="radio" name="desktpl-source" checked={source === v} onChange={() => set('source', v)} />
                <span className="strong">{t}</span><span className="muted small">{h}</span>
              </label>))}
          </div>
          {fromNet ? (
            <label><span>{L('Microsoft 다운로드 링크', 'Microsoft download link')}</span>
              <span className="desktpl-url">
                <input value={f.windows_url} placeholder="https://software.download.prss.microsoft.com/…/Win11_…_Korean_x64.iso?…" spellCheck={false}
                  onChange={(e) => set('windows_url', e.target.value)} />
                {osd.download_page && <a className="btn small-btn" href={osd.download_page} target="_blank" rel="noopener noreferrer">{L('다운로드 페이지 열기 ↗', 'Open the download page ↗')}</a>}
              </span>
              <small className="muted">{osd.server
                ? L('한국어 64비트 ISO 링크를 붙여 넣으세요. 받은 ISO는 다음부터 로컬 ISO로 고릅니다.',
                  'Paste the Korean 64-bit ISO link. Next time pick the downloaded ISO as a local ISO.')
                : L('한국어 64비트 다운로드 링크를 붙여 넣으세요(24시간 유효). 받은 ISO는 다음부터 로컬 ISO로 고릅니다.',
                  'Paste the Korean 64-bit download link (valid 24 h). Next time pick the downloaded ISO as a local ISO.')}</small></label>
          ) : (
            <label><span>{L(`${osd.name} ISO (서버)`, `${osd.name} ISO (server)`)}</span>
              <select value={winIso} onChange={(e) => set('windows_iso', e.target.value)}>
                {winIsos.length === 0 && <option value="">{L('서버에 ISO가 없습니다 — ISO · 이미지에서 올리세요', 'No ISO on the server - upload one under ISO library')}</option>}
                {winIsos.map((i) => <option key={i.volid} value={i.volid}>{repack(i.name) ? '⚠ ' : ''}{i.name} · {i.storage}</option>)}
              </select></label>
          )}
          <div className="form-row form-row-even">
            <label><span>{L('virtio-win 드라이버', 'virtio-win drivers')}</span>
              <select value={virtioSource === 'net' ? 'auto' : virtio} onChange={(e) => setF((x) => (e.target.value === 'auto'
                ? { ...x, virtio_source: 'net' } : { ...x, virtio_source: 'local', virtio_iso: e.target.value }))}>
                <option value="auto">{L('인터넷에서 자동으로 받기 (최신 안정판)', 'Download automatically (latest stable)')}</option>
                {isoList.filter((i) => /virtio/i.test(i.name)).map((i) => <option key={i.volid} value={i.volid}>{L('로컬', 'Local')}: {i.name} · {i.storage}</option>)}
              </select></label>
            <span />
          </div>
          {pickedIso && repack(pickedIso.name) && (
            <div className="alert small error">{L('Microsoft 공식 ISO가 아닌 것 같습니다. 배포용에는 공식 ISO를 쓰세요.',
              'This does not look like an official Microsoft ISO. Use an official one for templates you deploy.')}</div>
          )}
          <div className="form-row form-row-even">
            <label><span>{L('에디션 (ISO 안의 이미지 이름)', 'Edition (image name in the ISO)')}</span><input value={edition} onChange={(e) => set('edition', e.target.value)} /></label>
            <label><span>{L('ISO 언어', 'ISO language')}</span>
              <select value={f.language} onChange={(e) => set('language', e.target.value as 'ko-KR' | 'en-US')}><option value="ko-KR">한국어 (ko-KR)</option><option value="en-US">English (en-US)</option></select></label>
          </div>
          <label><span>{L('제품 키 (선택)', 'Product key (optional)')}</span>
            <input value={f.product_key} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" spellCheck={false} onChange={(e) => set('product_key', e.target.value.toUpperCase())} />
            <small className="muted">{osd.server
              ? L('볼륨 라이선스 ISO는 KMS 키가 필요할 수 있습니다. 여러 명이 함께 쓰려면 RDS · CAL이 필요합니다.',
                'A volume-licence ISO may need its KMS key. Several users at once need RDS and CALs.')
              : L('비우면 설치 뒤 활성화합니다.', 'Empty: activate after setup.')}</small></label>
          <small className="muted">{L('moavi-admin 비밀번호는 시작할 때 한 번만 보여 드립니다.', 'The moavi-admin password is shown once, at the start.')}</small>
        </>
      )}
      {(!win || fromNet || virtio === 'auto') && (
        <label><span>{win ? L('받은 ISO를 둘 스토리지', 'ISO storage for the downloads') : L('설치용 CD를 둘 ISO 스토리지', 'ISO storage for the setup CD')}</span>
          <select value={f.iso_storage} onChange={(e) => set('iso_storage', e.target.value)}>
            <option value="">{L('자동 (local 우선)', 'Automatic (local first)')}</option>
            {isoStores.map((s) => <option key={s.storage} value={s.storage}>{s.storage}</option>)}
          </select>
          <small className="muted">{win ? L('공유 스토리지에 두면 다른 노드는 다시 받지 않습니다.', 'On a shared storage other nodes reuse it.')
            : L('첫 부팅 설정 CD를 잠시 두고, 끝나면 지웁니다.', 'The first-boot CD stays there during the build.')}</small>
        </label>
      )}
      {(preset.id === 'npu' || preset.id === 'fpga') && (
        <label><span>{preset.id === 'fpga' ? L('Vivado 설치 파일 폴더 (NFS, 선택)', 'Vivado installer folder (NFS, optional)') : L('NPU 벤더 패키지 폴더 (NFS, 선택)', 'NPU vendor package folder (NFS, optional)')}</span>
          <input value={f.vendor_dir} placeholder="nas.lab.example:/export/vendor/vivado-2024.2" onChange={(e) => set('vendor_dir', e.target.value)} />
          <small className="muted">{preset.id === 'fpga'
            ? L('xsetup과 install_config.txt가 있는 폴더입니다. 비우면 Vivado는 빼고 만듭니다.',
              'Holds xsetup and install_config.txt. Empty: no Vivado.')
            : L('벤더 SDK 파일(.deb · .whl · install.sh)이 있는 폴더입니다. 비우면 SDK는 빼고 만듭니다.',
              'Holds the vendor SDK files (.deb, .whl, install.sh). Empty: no SDK.')}</small></label>
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
      <small className="muted">{(win ? L('30분~1시간', '30 min to 1 h') : preset.id === 'gpu' ? L('40분~1시간 30분', '40 min to 1.5 h')
        : preset.id === 'fpga' ? L('20분~1시간(Vivado는 몇 시간 더)', '20 min to 1 h (Vivado adds hours)') : L('20분~1시간', '20 min to 1 h'))}
        {L(' 걸립니다. 노드와 VM이 인터넷에 닿아야 합니다.', '. The node and the VM need the Internet.')}</small>
    </Dialog>
  );
}

function PasswordDialog({ started, onClose }: { started: DeskBuildStarted; onClose: () => void }) {
  const L = useL();
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open title={L('관리자 비밀번호 (한 번만 표시)', 'Administrator password (shown once)')} onClose={onClose}>
      <p className="small">{L(`로컬 관리자 ${started.admin_user} 비밀번호입니다. 다시 볼 수 없으니 지금 적어 두세요.`,
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
