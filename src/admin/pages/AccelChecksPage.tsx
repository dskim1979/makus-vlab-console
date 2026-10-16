import { useState } from 'react';
import { accelChecksApi, type AccelFinding, type CheckSeverity } from '../../api/accelChecks';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { SettingsStatus } from '../../components/SettingsShell';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';

// 가속 자원 > 카드 · 패스스루 점검: known pitfalls of GPU, AMD Xilinx Alveo and NPU passthrough,
// found in the desktop VMs that carry a card, the boards and the licence servers. Advice only.

const SEV: Record<CheckSeverity, { ko: string; en: string; chip: string }> = {
  error: { ko: '문제', en: 'Problem', chip: 'chip chip-warn' },
  warn: { ko: '주의', en: 'Warning', chip: 'chip chip-accent' },
  info: { ko: '알아 둘 것', en: 'Good to know', chip: 'chip' },
};

export function AccelChecksPage() {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const res = useLoad(accelChecksApi.all);
  const [only, setOnly] = useState<CheckSeverity | 'all'>('all');
  return (
    <LoadState value={res} retry={res.reload}>
      {(r) => {
        const list = r.findings.filter((f) => only === 'all' || f.severity === only);
        const groups = new Map<string, AccelFinding[]>();
        list.forEach((f) => { const k = f.name ?? '-'; groups.set(k, [...(groups.get(k) ?? []), f]); });
        return (
          <>
            <p className="muted small page-intro">{L('카드를 단 데스크톱 VM · 보드 · 라이선스 서버를 보고, GPU · AMD Xilinx Alveo · NPU 패스스루에서 알려진 문제(켜지지 않음, 카드 리셋, 비트스트림 지워짐, vGPU 성능 제한, 라이선스 멈춤 등)가 생길 만한 설정을 미리 알려 줍니다. 아무것도 바꾸지 않습니다.',
              'Looks at the desktop VMs with a card, the boards and the licence servers and flags settings known to cause trouble with GPU, AMD Xilinx Alveo and NPU passthrough (VM will not start, card reset, bitstream lost, vGPU throttled, licence stopped). Changes nothing.')}</p>
            <div className="toolbar">
              <div className="seg" role="group">
                {(['all', 'error', 'warn', 'info'] as const).map((k) => (
                  <button key={k} type="button" className={`seg-btn${only === k ? ' on' : ''}`} onClick={() => setOnly(k)}>
                    {k === 'all' ? L('전체', 'All') : L(SEV[k].ko, SEV[k].en)}{k !== 'all' ? ` ${r.counts[k]}` : ''}</button>
                ))}
              </div>
              <button type="button" className="btn" onClick={res.reload}><Icon name="refresh" size={16} />{L('다시 점검', 'Check again')}</button>
            </div>
            <SettingsStatus items={[
              { label: L('점검한 VM', 'VMs checked'), value: String(r.checked_vms) },
              { label: L('문제', 'Problems'), value: String(r.counts.error), tone: r.counts.error ? 'warn' : 'ok' },
              { label: L('주의', 'Warnings'), value: String(r.counts.warn), tone: r.counts.warn ? 'warn' : undefined },
              { label: L('알아 둘 것', 'Good to know'), value: String(r.counts.info) },
            ]} />
            {list.length === 0 ? <div className="empty"><p>{L('찾은 것이 없습니다.', 'Nothing found.')}</p></div> : (
              <div className="checks-list">
                {[...groups.entries()].map(([name, fs]) => (
                  <section key={name} className="panel">
                    <h3 className="panel-title">{name}{fs[0].vmid ? <span className="muted small"> · VM {fs[0].vmid}</span> : null}</h3>
                    <ul className="checks-items">
                      {fs.map((f, i) => (
                        <li key={f.code + i}>
                          <span className={SEV[f.severity].chip}>{L(SEV[f.severity].ko, SEV[f.severity].en)}</span>
                          <div><p>{L(f.ko, f.en)}</p><code className="code muted small">{f.code}{f.slot ? ` · ${f.slot}` : ''}</code></div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            <section className="panel">
              <h3 className="panel-title">{L('노드에서 한 번 확인할 것', 'Check once on each node')}</h3>
              <ul className="muted small checks-tips">
                <li>{L('BIOS: VT-d / AMD-Vi, Above 4G Decoding(큰 BAR), SR-IOV(NPU VF)를 켭니다.', 'BIOS: VT-d / AMD-Vi, Above 4G Decoding (large BARs), SR-IOV (NPU VFs).')}</li>
                <li>{L('카드는 노드에서 vfio-pci에 묶습니다. Alveo를 VM에 통째로 넘기면 노드에 xclmgmt · xocl을 올리지 않습니다(블랙리스트).', 'Bind the cards to vfio-pci on the node. When an Alveo goes to the VM whole, keep xclmgmt and xocl off the node (blacklist).')}</li>
                <li>{L('카드마다 IOMMU 그룹이 따로인지 확인합니다. 다른 장치와 같은 그룹이면 슬롯을 바꿉니다.', 'Each card should be in its own IOMMU group; move the slot if it shares one.')}</li>
                <li>{L('Alveo 플래시(shell) 갱신 뒤에는 노드를 완전히 껐다 켭니다. 팬이 계속 최고 속도면 카드 온도와 BMC 로그를 봅니다.', 'After an Alveo flash (shell) update, cold-reboot the node. If the fans stay at full speed, check the card temperature and the BMC log.')}</li>
                <li>{L('Vivado · Vitis 라이선스는 MAC에 묶인 노드 고정보다 플로팅(라이선스 서버)을 씁니다. 골든 이미지 · 복제 VM은 MAC이 바뀝니다.', 'Use floating (licence server) Vivado / Vitis licences rather than node-locked ones: golden images and clones get new MACs.')}</li>
              </ul>
            </section>
          </>
        );
      }}
    </LoadState>
  );
}
