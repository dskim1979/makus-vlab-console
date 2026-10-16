// 가속 자원 > 카드 · 패스스루 점검 (makus-vlab pegaprox/vlab/accel_checks.py,
// /api/vlab/admin/accel/checks): what is likely to go wrong with the cards on desktop VMs.
import { ApiError, isMock, request } from './client';

export type CheckSeverity = 'error' | 'warn' | 'info';
export type AccelFinding = {
  code: string; severity: CheckSeverity; ko: string; en: string; cluster_id?: string; vmid?: number;
  desktop_id?: string | null; name?: string; slot?: string; board_id?: string; license_id?: string;
};
export type AccelCheckResult = { findings: AccelFinding[]; checked_vms: number; counts: Record<CheckSeverity, number> };

const MOCK: AccelFinding[] = [
  { code: 'MIG_TIMESLICED', severity: 'warn', name: 'lab-win11-05', vmid: 304, desktop_id: 'x5', slot: 'hostpci15',
    ko: 'NVIDIA A100 80GB PCIe (GPU 1)가 MIG 모드입니다. MIG 카드에는 시분할 vGPU 프로필(A100-4C 같은)이 나오지 않으니, 이 vGPU가 MIG-backed 프로필(A100-3-20C 같은)이 아니면 VM이 켜지지 않습니다. 풀 GPU 정책에서 MIG-backed 프로필을 고르세요.',
    en: 'NVIDIA A100 80GB PCIe (GPU 1) is in MIG mode. Time-sliced vGPU profiles (like A100-4C) are not offered on a MIG card, so unless this vGPU is a MIG-backed profile (like A100-3-20C) the VM does not start. Pick a MIG-backed profile in the pool GPU policy.' },
  { code: 'MIG_PENDING', severity: 'warn', name: 'pve2 GPU 1',
    ko: 'pve2의 NVIDIA A100 80GB PCIe(GPU 1) MIG 모드 변경(disabled → enabled)이 GPU 리셋이나 노드 재부팅을 기다립니다. 그 전까지는 이전 모드로 동작합니다.',
    en: 'The MIG mode change of NVIDIA A100 80GB PCIe (GPU 1) on pve2 (disabled -> enabled) waits for a GPU reset or a node reboot; until then the old mode holds.' },
  { code: 'SAME_MAPPING', severity: 'error', name: 'ai-ws-03', vmid: 312, desktop_id: 'd4', slot: 'hostpci14',
    ko: "같은 매핑 'gpu-a16'이 hostpci15와 hostpci14에 두 번 붙어 있습니다(풀 GPU 정책과 카드 대여가 겹침). VM이 켜지지 않거나 카드 두 장을 차지합니다.",
    en: "Mapping 'gpu-a16' sits in hostpci15 and hostpci14 (the pool GPU policy and a loan overlap): the VM may not start or takes two cards." },
  { code: 'SEABIOS_BAR', severity: 'warn', name: 'vivado-build-01', vmid: 401, desktop_id: 'b1',
    ko: 'SeaBIOS VM입니다. GPU · FPGA 카드의 큰 64비트 BAR가 매핑되지 않아 VM 안에서 카드가 안 보일 수 있습니다. OVMF(UEFI) VM을 쓰고, 노드 BIOS의 Above 4G Decoding을 켜세요.',
    en: 'A SeaBIOS VM: the large 64-bit BARs of GPU and FPGA cards may not map and the card may not show in the guest. Use an OVMF (UEFI) VM and enable Above 4G Decoding in the node BIOS.' },
  { code: 'ONBOOT', severity: 'warn', name: 'vivado-build-01', vmid: 401, desktop_id: 'b1',
    ko: '노드가 켜질 때 자동 시작으로 되어 있습니다. 리셋이 깨끗하지 않은 카드는 노드 부팅을 멈추게 할 수 있으니, 패스스루 VM은 자동 시작을 끄고 수동 · 시간표로 켜세요.',
    en: 'Start at boot is on. A card that does not reset cleanly can hang the node at boot; turn it off for passthrough VMs and start them by hand or by schedule.' },
  { code: 'VGPU_LICENSE', severity: 'warn', name: 'lab-win11-04', vmid: 303, desktop_id: 'x4',
    ko: 'vGPU를 쓰는데 자동 감시하는 라이선스 서버가 없습니다. 라이선스를 못 받은 vGPU는 20분 뒤 15fps로 제한되고 CUDA가 느려지며, 24시간 뒤에는 3fps · CUDA 중지가 됩니다.',
    en: 'vGPU without a watched licence server. An unlicensed vGPU is cut to 15 fps with slower CUDA after 20 minutes, and to 3 fps with CUDA off after 24 hours.' },
  { code: 'AMD_GPU_RESET', severity: 'warn', name: 'render-ws-02', vmid: 322, desktop_id: 'x5',
    ko: 'AMD GPU를 통째로 넘겼습니다. VM을 끄고 켜거나 Proxmox에서 재시작하면 카드가 다시 안 잡히거나 노드가 멈추는 리셋 문제가 알려져 있습니다. 노드에 vendor-reset을 설치하고, 재시작은 게스트 안에서 하세요.',
    en: 'A whole AMD GPU is passed through: after a stop/start or a restart from Proxmox the card may not come back or the node may hang. Install vendor-reset on the node and restart from inside the guest.' },
  { code: 'JTAG_PID', severity: 'warn', name: 'ZCU102 #1', board_id: 'b1',
    ko: "보드 'ZCU102 #1'이 03fd:0013으로 등록되어 있습니다. Platform Cable USB II는 펌웨어를 올린 뒤 03fd:0008로 다시 잡혀 연결이 끊깁니다. 03fd:0008이나 포트 경로(예: 1-4.2)로 등록하세요.",
    en: "Board 'ZCU102 #1' is registered as 03fd:0013; the Platform Cable USB II re-enumerates as 03fd:0008 once its firmware loads. Register 03fd:0008 or the port path." },
  { code: 'LICENSE_MAC', severity: 'warn', name: '설계 툴 라이선스 (FlexLM)', license_id: 'lic_1',
    ko: "라이선스 서버 '설계 툴 라이선스 (FlexLM)' VM에 고정 MAC이 적혀 있지 않습니다. FlexLM 라이선스는 MAC(호스트 ID)에 묶여, VM을 복제 · 복원하면 MAC이 바뀌어 라이선스가 멈춥니다.",
    en: "Licence server '설계 툴 라이선스 (FlexLM)' has no fixed MAC noted; a clone or restore changes the MAC the FlexLM licence is bound to." },
  { code: 'XILINX_FUNCTION', severity: 'info', name: 'vivado-build-01', vmid: 401, desktop_id: 'b1', slot: 'hostpci14',
    ko: "Alveo 매핑 'fpga-u250'이 PCI 기능 하나만 넘깁니다. Alveo는 관리(PF0) · 사용자(PF1) 두 기능이라, 한쪽만 넘기면 VM 안에서 xbmgmt(플래시 · 리셋)나 xbutil 일부가 안 됩니다.",
    en: "Alveo mapping 'fpga-u250' passes one PCI function; with one of PF0 / PF1 the guest lacks xbmgmt (flash, reset) or parts of xbutil." },
  { code: 'XILINX_RESET', severity: 'info', name: 'vivado-build-01', vmid: 401, desktop_id: 'b1',
    ko: 'FPGA 카드: VM을 끄거나 다시 시작하면 카드가 리셋되어 올려 둔 xclbin · 비트스트림이 지워집니다. 시작한 뒤 다시 프로그램하세요(xbutil program). 카드 플래시(shell) 갱신은 노드를 완전히 껐다 켜야 반영됩니다.',
    en: 'FPGA card: stopping or restarting the VM resets the card and the loaded xclbin / bitstream is gone; program it again after the start. A flash (shell) update needs a cold reboot of the node.' },
];

export const accelChecksApi = {
  all: async (): Promise<AccelCheckResult> => {
    if (isMock) {
      await new Promise((r) => setTimeout(r, 300));
      const counts = { error: 0, warn: 0, info: 0 } as Record<CheckSeverity, number>;
      MOCK.forEach((f) => { counts[f.severity] += 1; });
      return { findings: MOCK, checked_vms: 9, counts };
    }
    const { status, data } = await request<AccelCheckResult & { error?: string }>('GET', '/api/vlab/admin/accel/checks');
    if (status !== 200) throw new ApiError(status, data?.error || `HTTP ${status}`, data);
    return data;
  },
};
