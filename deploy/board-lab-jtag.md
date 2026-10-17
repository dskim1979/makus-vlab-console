# 보드 LAB — FPGA JTAG는 네트워크로, 일반 USB는 SPICE로

| 무엇을 | 어떻게 | 화면 프로토콜 |
|---|---|---|
| **FPGA JTAG** (Xilinx · Intel 보드) | 케이블을 **랩 서버**에 꽂고 `hw_server` · XVC · Quartus `jtagd`로 네트워크 공유. 콘솔 › 가속 자원 › 보드 LAB에서 **네트워크 JTAG**로 등록하고 데스크톱에 대여 | 무엇이든 (RDP · Warpgate · SPICE), Windows · Linux 모두 |
| 일반 USB 장치 (보안 키, 시리얼, 카메라, 저장 장치 등) | 사용자 자리 PC에 꽂고 SPICE USB 리디렉션 (풀 정책 › USB) | SPICE |
| (기존) JTAG USB 패스스루 | 보드가 꽂힌 Proxmox 노드에서 VM으로 넘김. 데스크톱이 그 노드에서 돌아야 함 | 무엇이든 |

네트워크 JTAG는 대여해도 **VM 설정을 바꾸지 않습니다.** 대여 기록과 함께 사용자 포털 › 내 자원 › 내 보드(JTAG)에
접속 주소(`host:port`)와 Tcl 명령, 사용법이 복사 버튼과 함께 나옵니다. 대여 기간이 끝나면 기록만 지워집니다.

## 1. 케이블 호스트(랩 서버) 준비

- **연구자 자리 PC가 아니라 공용 랩 서버**에 꽂으십시오(작은 Linux 서버 1대, 랩/인프라 존 VLAN).
  자리 PC를 쓰면 데스크톱 VLAN → 사용자 VLAN 통신을 열어야 해서 "데스크톱은 MOAVI Desk 서버 · 게이트웨이를
  통해서만 닿는다"는 접근 차단 설계와 어긋납니다.
- Xilinx: Vivado Lab Edition(또는 Hardware Server 단독 설치)을 깔고 `hw_server`를 서비스로 띄웁니다(기본 TCP 3121).
  보드마다 따로 쓰게 하려면 케이블별로 포트를 달리해 여러 개 띄우거나(`hw_server -s tcp::3122` 등),
  보드의 XVC 서버(기본 2542)를 씁니다.
- Intel: Quartus Programmer를 깔고 `jtagconfig --enableremote <암호>`로 `jtagd`(TCP 1309) 원격 접속을 켭니다.
  암호는 사용자에게 따로 알려 줍니다.

## 2. 방화벽 — 데스크톱 → 랩 서버만 열기 (추가형)

데스크톱 직접 접속 차단([proxmox-firewall](proxmox-firewall/README.md))은 **데스크톱으로 들어오는** 접속을 막는 것이라
그대로 둡니다. 네트워크 JTAG는 **데스크톱에서 랩 서버로 나가는** 연결이므로 아래만 더합니다.

- 데스크톱 VLAN → 랩 서버 `TCP 3121`(hw_server) · `2542`(XVC) · `1309`(jtagd) 허용 — 상위 방화벽/L3 스위치 ACL.
- 데스크톱 VM 방화벽의 나가는 정책(policy_out)을 DROP으로 둔 곳이면 보안 그룹에 한 줄 더합니다:

  ```
  [group moavi-desktop-jtag] # 보드 LAB 데스크톱: 랩 서버의 JTAG 서버로만 나감
  OUT ACCEPT -dest +moavi-jtag -p tcp -dport 3121,2542,1309 -log nolog

  [ipset moavi-jtag] # JTAG 케이블 호스트 (환경에 맞게 고칠 것)
  10.20.5.7  # 랩 서버 jtag01
  ```

- 랩 서버 쪽에서는 허용 출발지를 **보드 LAB 데스크톱 풀의 대역**으로 좁히십시오.
  **hw_server · XVC에는 인증이 없습니다** — 포트에 닿는 누구나 보드를 조작할 수 있습니다.

엔진은 대여 기간에 맞춰 방화벽 규칙을 자동으로 열고 닫지 않습니다. 대여는 "누가 쓰는가"를 기록하고 안내하는 것이고,
경로는 위 방화벽이 정합니다.

## 3. 연구자 사용법 (포털 › 내 자원 › 내 보드)

- **hw_server**: Vivado › Hardware Manager › Open Target › Open New Target › *Remote server* › 호스트·포트 입력
  (Tcl: `connect_hw_server -url jtag01:3121`)
- **XVC**: Hardware Manager에서 로컬 서버를 연 뒤 localhost 오른쪽 클릭 › *Add Xilinx Virtual Cable (XVC)*
  (Tcl: `open_hw_target -xvc_url jtag01:2542`)
- **Quartus**: Programmer › Hardware Setup › JTAG Settings › *Add Server* › 서버 이름과 암호
  (`jtagconfig --addserver jtag01 <암호>`)

## 실제 장비에서 확인할 것

- 실제 케이블 · 보드로 위 세 가지 연결, 동시 접속 시 동작(한 케이블에 한 사람)
- 데스크톱 VLAN → 랩 VLAN 방화벽 허용, 랩 서버의 출발지 제한
- 현장 Vivado 버전에서 hw_server 외 추가 포트가 필요한지(예: Versal 디버그)
