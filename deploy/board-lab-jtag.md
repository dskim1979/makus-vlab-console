# 보드 LAB — JTAG 게이트웨이 VM 구축 (FPGA JTAG는 네트워크로, 일반 USB는 SPICE로)

| 무엇을 | 어떻게 | 화면 프로토콜 |
|---|---|---|
| **FPGA JTAG** (Xilinx · Intel 보드) | 케이블을 **JTAG 게이트웨이 VM**에 모으고 `hw_server` · XVC · Quartus `jtagd`로 네트워크 공유. 보드 = 게이트웨이 + 케이블 시리얼 | 무엇이든 (RDP · Warpgate · SPICE), Windows · Linux 모두 |
| 일반 USB 장치 (보안 키, 시리얼, 카메라, 저장 장치 등) | 사용자 자리 PC에 꽂고 SPICE USB 리디렉션 (풀 정책 › USB) | SPICE |
| (기존) JTAG USB 패스스루 | 보드가 꽂힌 노드에서 데스크톱 VM으로 직접 넘김. 데스크톱이 그 노드에서 돌아야 함 | 무엇이든 |

네트워크 JTAG 보드는 대여해도 **연구자 VM 설정을 바꾸지 않습니다.** 포털 › 내 자원 › 내 보드(JTAG)에
`게이트웨이:3121`, 케이블 시리얼, Tcl 명령, UART 주소가 복사 버튼과 함께 나옵니다.

## 1. 게이트웨이 VM이 하는 일 — 그리고 하지 않는 일

- 게이트웨이는 **hw_server · XVC · jtagd만 돌립니다.** 프로그래밍 · 디버그 트래픽을 중계할 뿐 **빌드하지 않습니다.**
  합성 · 구현은 연구자 VM이나 빌드 팜(작업 큐)에서 합니다.
- **Vivado Lab Edition만** 설치합니다(무료, hw_server · Hardware Manager 포함, 합성 없음). 전체 Vivado는 설치하지 않습니다.
- 크기: **2–4 vCPU, 4–8 GB 메모리, 작은 디스크(32 GB 안팎).** 병목은 CPU가 아니라 **JTAG 클럭과 USB 대역폭**입니다.
  CPU를 늘리지 말고 케이블을 여러 PCIe USB 컨트롤러나 여러 게이트웨이 VM(대당 10–20개)으로 나눕니다.

## 2. 게이트웨이 VM 템플릿 만들기

1. Linux VM(Ubuntu 22.04/24.04 LTS 또는 RHEL 계열), q35 머신, 2–4 vCPU, 4–8 GB, 디스크 32 GB. NIC는 데스크톱 또는
   인프라 VLAN. **고정 IP(또는 DHCP 예약) + DNS 이름**(예 `jtag-gw-01.lab.local`) — 보드 접속 주소가 됩니다.
2. `qemu-guest-agent` 설치 · 사용(Proxmox VM 옵션 › QEMU Guest Agent 켜기). 콘솔의 **케이블 찾기**에 필요합니다.
3. Xilinx: **Vivado Lab Edition**(또는 Hardware Server 단독) 설치 후 케이블 드라이버 설치
   (`<설치경로>/data/xicom/cable_drivers/lin64/install_script/install_drivers/install_drivers`, Digilent 포함).
   hw_server를 서비스로 띄웁니다. 예 `/etc/systemd/system/hw_server.service`:

   ```ini
   [Unit]
   Description=Xilinx hw_server (JTAG gateway)
   After=network-online.target
   [Service]
   ExecStart=/opt/Xilinx/Vivado_Lab/2024.2/bin/hw_server -s tcp::3121
   Restart=always
   User=root
   [Install]
   WantedBy=multi-user.target
   ```

4. Intel(필요할 때): Quartus Programmer 설치, `jtagd`를 서비스로 띄우고 `jtagconfig --enableremote <암호>`.
   USB-Blaster udev 규칙(`/etc/udev/rules.d/51-usbblaster.rules`)을 넣습니다.
5. XVC(필요할 때): 보드마다 XVC 서버 하나를 고유 포트(2542, 2543, …)로 띄웁니다. 콘솔에서 보드마다 그 포트를 적습니다.
6. UART(선택): `ser2net` 설치, 보드 UART마다 TCP 포트 하나(7001, 7002, …), 장치는 `/dev/serial/by-id/...`로 지정
   (엔진 저장소 `docs/board-lab-network-jtag.md` 예시). 한 포트에 한 연결(`max-connections: 1`).
7. 이 VM을 템플릿으로 만들고, 노드(또는 보드 묶음)마다 복제해 이름 · IP만 바꿉니다.

## 3. 케이블 연결 — 전원 허브, PCIe USB 카드

- **전원 공급형(셀프 파워) USB 허브**를 쓰십시오. 버스 전원 허브에 케이블을 여럿 달면 전류가 모자라 케이블이
  끊기거나 펌웨어 로드가 실패합니다. USB 2.0 고속 허브면 충분하고, 허브 하나에 7–10개 이하를 권장합니다.
- **PCIe USB 카드 통째 패스스루(케이블이 많을 때 권장)**: 콘솔 › 보드 LAB › JTAG 게이트웨이 › 넘기기 › PCIe USB 컨트롤러.
  - 카드가 **자기 IOMMU 그룹**에 있어야 합니다(`pvesh get /nodes/<노드>/hardware/pci --pci-class-blacklist ""`로 확인).
    노드에 IOMMU(intel_iommu=on / amd_iommu=on)가 켜져 있어야 합니다.
  - 컨트롤러에 꽂힌 모든 케이블이 게이트웨이 안에서 바로 보이고, Platform Cable USB II처럼 펌웨어를 올리며
    ID가 바뀌는(재열거) 케이블도 끊기지 않습니다. 게이트웨이 VM을 다시 시작해야 붙습니다.
  - 칩셋이 독립된 컨트롤러를 여러 개 가진 카드(포트 그룹마다 컨트롤러)면 대역폭이 나뉘어 좋습니다.
- **USB 장치 하나씩 패스스루**: `vid:pid` 또는 포트 경로(`1-4.2`)를 빈 `usbN`(usb0–usb13)에 넘깁니다. 같은 케이블이
  여러 개거나 Platform Cable USB II면 **포트 경로**로 지정합니다. 케이블이 서너 개를 넘으면 PCIe 카드가 낫습니다.

## 4. 케이블 ↔ 보드 라벨링

- 케이블마다 **시리얼 번호 라벨**을 붙이고(Digilent 예 `210251A08870`), 보드와 케이블을 같은 번호로 묶어 둡니다.
  Vivado Hardware Manager의 대상 이름 끝(`localhost:3121/xilinx_tcf/Digilent/210251A08870`)과 같은 값입니다.
- 콘솔 › JTAG 게이트웨이 › **케이블 찾기**로 게이트웨이가 보는 케이블(시리얼 · 포트)을 읽고, 보드 탭에서
  **게이트웨이 + 케이블 시리얼**로 보드를 등록합니다. 한 케이블은 보드 하나에만 등록되고, 한 번에 한 사람에게만 빌려줍니다.
- 랙 · 허브 포트 위치를 보드 **표시 이름**(예 `랙 B-2 · 허브1 포트3`)에 적어 두면 현장 작업이 쉽습니다.
- 보드 전원을 원격으로 켜고 끄려면 스마트 PDU · 릴레이 드라이버를 붙이는 확장 지점이 있습니다(엔진 문서 참고, 기본 드라이버 없음).

## 5. 규모를 키울 때 — 게이트웨이 여러 대로 나누기

- 게이트웨이 VM 하나에 케이블 **10–20개**까지. 넘으면 게이트웨이를 하나 더 만들고 케이블을 나눕니다.
- 노드마다 게이트웨이 하나(그 노드에 꽂힌 허브 · PCIe 카드)를 두면 VM 이동 없이 정리됩니다. 게이트웨이 VM은
  USB/PCIe 패스스루 때문에 다른 노드로 옮길 수 없으니 **HA로 묶지 마십시오.**
- 같은 게이트웨이에서 동시에 프로그래밍하는 사람이 많으면 USB 대역폭이 나뉩니다. 바쁜 보드는 다른 컨트롤러 ·
  다른 게이트웨이로 옮깁니다.
- 콘솔이 2분마다 게이트웨이 VM과 hw_server · jtagd · XVC 포트를 점검합니다. 응답이 없으면 그 게이트웨이의 보드는
  대여할 수 없음으로 바뀌고 알림 채널로 알립니다.

## 6. 방화벽 — 데스크톱 → 게이트웨이만 열기 (추가형)

데스크톱 직접 접속 차단([proxmox-firewall](proxmox-firewall/README.md))은 **데스크톱으로 들어오는** 접속을 막는 것이라
그대로 둡니다. 네트워크 JTAG는 **데스크톱에서 게이트웨이로 나가는** 연결이므로 아래만 더합니다.

- 데스크톱 VLAN → 게이트웨이 `TCP 3121`(hw_server) · `1309`(jtagd) · XVC 포트 · UART 포트 허용 — 상위 방화벽/L3 ACL.
- 데스크톱 VM 방화벽의 나가는 정책(policy_out)을 DROP으로 둔 곳이면 보안 그룹에 한 줄 더합니다:

  ```
  [group moavi-desktop-jtag] # 보드 LAB 데스크톱: JTAG 게이트웨이로만 나감
  OUT ACCEPT -dest +moavi-jtag -p tcp -dport 3121,1309,2542:2600,7001:7100 -log nolog

  [ipset moavi-jtag] # JTAG 게이트웨이 VM (환경에 맞게 고칠 것)
  10.20.5.7  # jtag-gw-01
  ```

- 게이트웨이 VM 쪽 방화벽(Proxmox VM 방화벽 또는 nftables)에서 위 포트의 **출발지를 보드 LAB 데스크톱 대역으로** 좁히십시오.
  **hw_server · XVC · ser2net에는 인증이 없습니다** — 포트에 닿는 누구나 보드를 조작할 수 있습니다.
- 연구자 개인 PC를 케이블 호스트로 쓰지 마십시오. 데스크톱 VLAN → 사용자 VLAN을 열어야 해서
  "데스크톱은 MOAVI Desk 서버 · 게이트웨이를 통해서만 닿는다"는 접근 차단 설계와 어긋납니다.

엔진은 대여 기간에 맞춰 방화벽 규칙을 자동으로 열고 닫지 않습니다. 대여는 "누가 어느 케이블을 쓰는가"를 기록하고
안내하는 것이고, 경로는 위 방화벽이 정합니다.

## 7. 연구자 사용법 (포털 › 내 자원 › 내 보드)

- **hw_server**: Vivado › Hardware Manager › Open Target › Open New Target › *Remote server* › 게이트웨이 호스트 · 3121 ›
  목록에서 **내 케이블 시리얼**로 끝나는 대상 선택. Tcl:
  `connect_hw_server -url jtag-gw-01:3121` → `open_hw_target [lindex [get_hw_targets */210251A08870] 0]`
- **XVC**: 로컬 hw_server를 연 뒤 localhost 오른쪽 클릭 › *Add Xilinx Virtual Cable (XVC)* › 게이트웨이 · 보드 포트
- **Quartus**: Programmer › Hardware Setup › JTAG Settings › *Add Server* › 게이트웨이 이름과 암호
- **UART**: `telnet jtag-gw-01 7001` 또는 PuTTY(Raw)

## 실제 장비에서 확인할 것

- 실제 게이트웨이 VM · 케이블로 위 연결, 케이블 시리얼로 대상 고르기, 동시 사용(한 케이블에 한 사람)
- PCIe USB 카드 IOMMU 그룹 · 재시작 뒤 케이블 재열거, usbN 슬롯 상한(머신 타입에 따라 usb4까지일 수 있음)
- 게스트 에이전트 케이블 찾기, ser2net UART, 상태 감시 알림
- 데스크톱 VLAN → 게이트웨이 방화벽 허용과 출발지 제한
