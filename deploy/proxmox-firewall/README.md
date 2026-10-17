# 데스크톱 직접 접속 차단 (Proxmox 보안 그룹)

사용자가 데스크톱 안에서 IP(`ip a`·`ipconfig`)를 알아내 원격 데스크톱·SSH 로 직접 붙는 길을
막는다. 모든 접속은 MOAVI Desk 서버(와 등록한 게이트웨이)를 거치게 되고, 그래서 접속 기록·시간
제한·정책이 항상 적용된다.

## 왜 VM 밖에서 막나
VM 안 방화벽(Windows 방화벽·iptables)만으로는 부족하다. 사용자가 관리자·sudo 권한이 있으면 끌 수
있기 때문이다. **Proxmox VM 방화벽은 하이퍼바이저(노드)에서 동작**해서 VM 의 네트워크 밖에서
걸리므로, VM 안에서 root 여도 바꾸지 못한다.

## 겹겹이 막기 (권장)
1. **네트워크 분리** — 데스크톱은 전용 VLAN 에 두고, 사용자 PC 망에서 그 VLAN 으로 가는 길은
   라우터·방화벽에서 막는다. MOAVI Desk 서버만 양쪽에 닿게 한다.
2. **Proxmox 보안 그룹** — [cluster.fw.example](cluster.fw.example) 의 `moavi-desktop` 그룹으로
   데스크톱의 RDP·SSH·VNC 포트를 서버·게이트웨이에서만 받는다. IP·MAC 필터로 주소 위조도 막는다.
3. **VM 안 정책** — 데이터 보호(C 드라이브 숨기기·폴더 리디렉션)와 접속 정책(클립보드·드라이브·
   프린터)은 콘솔의 풀 정책에서.

## 접속은 어떻게 나가나
직접 접속을 막으면, 사용자는 반드시 서버·게이트웨이를 거친다.

| 접속 | 경로 | 비고 |
|---|---|---|
| Warpgate bastion (RDP·SSH·VNC) | Warpgate (VLAB_WARPGATE=1) | 1회용 티켓, 세션 녹화, 비밀번호 비저장 |
| 브라우저 RDP · 브라우저 SSH·SFTP | Warpgate (HTTP 8888) | 번들 Guacamole는 제거됨, 파일 전송은 풀 정책 |
| 전용 앱·RDP (외부망, UDP 유지) | MS RD 게이트웨이 | Windows Server·RDS CAL 필요(고객), UDP 3391 |
| SPICE·VNC | Proxmox 프록시·엔진 경유 | 지금 그대로 |

**Warpgate(bastion)** 를 거치므로 데스크톱의 RDP·SSH·VNC가 Warpgate 한 주소에서만 들어온다.
`moavi-relay` 를 Warpgate 주소(와 MOAVI Desk 서버)로 좁히면 데스크톱 노출이 가장 작아지고, 접속
기록·세션 녹화·1회용 티켓이 항상 적용된다. 설계는 엔진 저장소 `docs/warpgate-gateway.md`.

사내망(라우팅되는 망)에서만 쓰는 현장이면, 보안 그룹의 `moavi-relay` 에 사용자 PC 대역을 넣어
직접 RDP(UDP 포함)를 열어도 된다. 다만 그러면 그 대역에서는 포털을 거치지 않고도 붙을 수 있으니,
접속 기록·정책을 꼭 서버로 모으려면 게이트웨이 경유만 두는 것이 안전하다.

## 점검
- 사용자 PC 에서 데스크톱 IP 로 `mstsc`·`ssh` 직접 접속 → 막혀야 한다(연결 안 됨).
- 포털·전용 앱 → 접속되어야 한다.
- 데스크톱 A 에서 데스크톱 B 의 IP 로 RDP·SSH → 막혀야 한다.
- `pve-firewall compile` 로 규칙이 맞게 들어갔는지 노드에서 확인한다.
