<p align="center">
  <img src="docs/images/admin-dashboard.png" alt="MOAVI Desk 관리 콘솔 대시보드" width="900">
</p>

<h1 align="center">MOAVI Desk 콘솔</h1>

<p align="center">
  일반 업무 · 대학교 실습실 · 연구소 · FPGA/AI 연구실을 위한 가상 데스크톱(VDI) — 업무에 맞는 메뉴만 보이는 <b>사용자 작업 공간</b>과 <b>관리 콘솔</b>
</p>

<p align="center">
  <a href="https://github.com/dskim1979/makus-vlab">엔진(makus-vlab)</a> ·
  <a href="deploy/README.md">서버에 설치</a> ·
  <a href="NOTICE.md">고지</a>
</p>

---

## 사이트 프로필 — 필요한 메뉴만

처음 설치하고 관리자로 들어가면 **어떤 곳에서 쓰시나요?** 화면이 한 번 뜹니다. 고른 프로필에 맞는 메뉴만 보이고, 꺼진 기능은
데이터를 지우지 않으며 **운영 > 플랫폼 설정 > 기능**에서 언제든 바꿉니다(기능 하나씩 켜고 끄기도 여기서).

| 프로필 | 이런 곳 | 켜지는 기능 묶음 | 메뉴 |
|---|---|---|---|
| **일반 업무 VDI** | 사무실 · 지점 · 원격 근무, 데스크톱 100대 안팎 | 조직 · 권한, 외부 접속 | 5개 메뉴 · 14화면 |
| **소규모 연구실** | 연구실 5~30명 | (기본만) | 가장 단순한 메뉴 |
| **대학교 실습실** | 실습실 · 수업 | LAB(단말 · 시간표 · 예약 · 키오스크), 가입 · 대량 계정, 조직 · 권한 | |
| **연구소 · 기업 R&D** | 큰 조직 · 보안 요구 | 조직 · 권한, 외부 접속, 연구 데이터(반출 통제), 고가용성 | |
| + **FPGA 개발** | 어느 프로필에나 추가 | 보드 LAB(JTAG), 빌드 팜, 라이선스 서버 · 좌석, 카드 대여 · 점검 | |
| + **GPU · AI 연구** | 어느 프로필에나 추가 | 카드 · vGPU · MIG · 대여, 환경 카탈로그, GPU 작업 큐 · 할당량, 웹 IDE | |

데스크톱 · 풀 · 이미지 · 사용자 · 클러스터 · 경보 · 백업 · 보고서 · 감사 · 공지 · 클라이언트 · 서포트 번들은 항상 켜져 있습니다.
모든 기능을 켜면 메뉴 9개 · 화면 24개이고, 한 화면 안의 비슷한 일은 탭으로 묶었습니다(예전 주소는 새 위치로 넘어갑니다).
무인 설치에서는 `.env`의 `VLAB_PROFILE=university`, `VLAB_FEATURES=gpuai,fpga`로 처음 값을 정할 수 있습니다([서버에 설치](deploy/README.md)).

| | |
|---|---|
| **첫 설정 — 어떤 곳에서 쓰시나요?** — 프로필 4가지, 연구 분야(FPGA · GPU·AI) 추가, 바뀔 메뉴 미리 보기 | **플랫폼 설정 › 기능** — 프로필 바꾸기, 기능 묶음 하나씩 켜고 끄기, 메뉴 N개 · 화면 N개 미리 보기 |
| ![첫 설정](docs/images/setup-profile.png) | ![기능](docs/images/features.png) |

## 화면

### 사용자 작업 공간 (`/`)
배정된 데스크톱을 한 화면에서 보고 바로 접속합니다. 즐겨찾기, 켜져 있는 것만 보기, 검색을 지원합니다.
접속은 브라우저(noVNC), SPICE 파일, RDP 파일, 브라우저 RDP(Guacamole) 중 풀 정책이 허용한 방식으로 합니다.
상단 탭은 **데스크톱 · 내 자원 · 예약(LAB) · 데이터(연구 데이터)** 이고, 켜진 기능만 보입니다.

| | |
|---|---|
| **작업 공간** — 데스크톱 카드, 접속 방법 안내, MOAVI Desk Client 받기 | **접속 메뉴** — ··· 에서 SPICE 파일 받기, RDP 파일 받기, 브라우저 RDP로 열기, 전원 |
| ![작업 공간](docs/images/portal.png) | ![접속 메뉴](docs/images/portal-rdp.png) |
| **받을 수 있는 데스크톱 · 외부 데스크톱** — 권한이 있는 풀에서 직접 받기(전용) · 바로 연결(공유), 실제 PC에 RDP · 브라우저로 접속 | **공지 배너** — 점검 · 배포 안내가 작업 공간과 관리 콘솔 위에 뜸(닫기 가능) |
| ![받을 수 있는 데스크톱](docs/images/portal-pools.png) | ![공지 배너](docs/images/portal-notices.png) |
| **내 자원** — 빌린 카드 · 보드, 내 GPU · 할당량, 내 공유 폴더(NAS), 빌드 · GPU 작업 큐 | **데이터** — 내 NAS 폴더 탐색, 이어 올리기 · 이어 받기, 반출 신청(사유 · 일회용 링크), 데이터셋 목록, SFTP 안내 |
| ![내 자원](docs/images/portal-resources.png) | ![데이터](docs/images/portal-data.png) |
| **포털 예약** — 지금 예약 · 내 예약 · 달력 · 빈 시간, 예약 시간에 [데스크톱 열기] | **새 예약** — LAB 전체 · 좌석 N개 · 데스크톱 N대, 날짜 · 시간 · 매주 반복 · 참가자, 겹치는 회차 빼고 예약 |
| ![포털 예약](docs/images/portal-reserve.png) | ![새 예약](docs/images/reserve-new.png) |
| **포털 [실습실 PC로 설치]** — 실습실 PC에서 설치 파일을 받아 실행하면 단말 관리에 승인 대기로 올라옴 | **내 계정** — 비밀번호 변경, 2단계 인증(TOTP) 등록 · 해제 |
| ![실습실 PC로 설치](docs/images/portal-lab-install.png) | ![내 계정](docs/images/my-account.png) |
| **로그인** — 회사 표기, 가입 신청, 비밀번호 찾기, 원격 지원 요청 | **가입 신청** — 아이디 · 이름 · 메일 · 소속 부서 · 사유, 약관 동의, 메일 확인 뒤 관리자 승인 |
| ![로그인](docs/images/login.png) | ![가입 신청](docs/images/signup.png) |
| **비밀번호 찾기** — 아이디나 메일로 재설정 링크(1시간, 한 번), 있는 계정인지 알려 주지 않음 | **LAB 키오스크** (`/kiosk`) — 지금 수업 · 다음 수업, 로그인하면 수업 데스크톱으로 바로 |
| ![비밀번호 찾기](docs/images/forgot-password.png) | ![LAB 키오스크](docs/images/kiosk.png) |

### 관리 콘솔 (`/admin`)

메뉴 이름 뒤 `›` 는 그 화면의 탭입니다.

**대시보드**

| | |
|---|---|
| **대시보드** — 상태 점수, CPU · 메모리 · VM · 접속 추이(24시간 · 7일 · 30일), 노드별 CPU, 활성 경보, 자원 제안(증설 · 회수) | |
| ![대시보드](docs/images/admin-dashboard.png) | |

**가상머신** — 데스크톱(VM) › 목록 · VM 만들기 · ISO · 이미지 · 풀별 상태, 이미지 › 템플릿 · 골든 이미지 · 환경 카탈로그

| | |
|---|---|
| **데스크톱(VM) › 목록** — 사용량, 전원(한 대씩 · 여러 대 한 번에) | **VM 관리 창** — CPU · 메모리, 디스크 늘리기 · 추가, 네트워크(브리지 · VLAN), 노드 이동, 템플릿 변환 · 삭제, 화면 열기 |
| ![데스크톱 VM](docs/images/desktop-vms.png) | ![VM 관리](docs/images/vm-manage.png) |
| **VM 스냅샷** — 만들기(메모리 포함 선택) · 되돌리기 · 삭제, 초기화 기준 표시 | **데스크톱(VM) › VM 만들기** — OS 종류(Windows 11은 UEFI · TPM 자동) · 노드 · ISO · virtio · CPU · 메모리 · 디스크 · 네트워크 |
| ![VM 스냅샷](docs/images/vm-snapshots.png) | ![VM 만들기](docs/images/vm-create.png) |
| **데스크톱(VM) › ISO · 이미지** — 스토리지별 ISO 목록, 업로드(진행률), URL로 받기, 삭제 | **이미지 › 템플릿** — 디스크 · 링크 클론 가능 여부 · 사용 풀, 여기서 풀에 클론 |
| ![ISO 관리](docs/images/iso-library.png) | ![템플릿](docs/images/templates.png) |
| **이미지 › 골든 이미지** — 일반 VM을 골든 이미지로, 버전(스냅샷), 풀에 배포, 풀별 예전 버전 대수, 환경 표시 | **골든 롤아웃** — 예전 버전 데스크톱을 새 버전 복제본으로 일괄 교체(사용자 · 권한 이전, 접속 중은 건너뜀) |
| ![골든 이미지](docs/images/golden-images.png) | ![골든 롤아웃](docs/images/golden-rollout.png) |
| **이미지 › 환경 카탈로그** (GPU·AI · FPGA) — OS · 드라이버 · CUDA · 툴체인 버전 카드, 검색 · 필터, 게스트에서 버전 읽기, 호환표, 이 환경으로 풀 만들기 | |
| ![환경 카탈로그](docs/images/env-catalog.png) | |

**데스크톱 풀** — 풀, 접속 설정 › 게이트웨이 · USB 장치 · 외부 데스크톱(외부 접속)

| | |
|---|---|
| **풀 상세** — 정책 · 이용 권한 · GPU 정책 패널, 데스크톱 할당 · 초기화 | **이용 권한** — 사용자 · 부서(하위 포함) · AD/LDAP 그룹, 공유 풀의 데스크톱당 최대 접속 |
| ![풀 상세](docs/images/pool-detail.png) | ![이용 권한](docs/images/pool-grants.png) |
| **풀 편집** — 이름 · 설명 · 사용/중지, 공유 풀 최대 접속, RDP · 브라우저 RDP 게이트웨이 | **풀 정책** — 접속 방식(noVNC · SPICE · RDP · 브라우저 RDP · 웹 IDE), 클립보드 · USB, 전원 · 시간 · 초기화 |
| ![풀 편집](docs/images/pool-edit.png) | ![풀 정책](docs/images/pool-policy.png) |
| **풀 정책 › 공유 저장소** — NFS(autofs) · SMB, home · project · scratch 폴더 템플릿과 할당량 · 보관 기간 | **풀 상세 › 공유 저장소** — 마지막 확인 결과, 사용자별 사용량, 템플릿에 넣을 autofs 파일 |
| ![공유 저장소 설정](docs/images/pool-policy-storage.png) | ![공유 저장소 상태](docs/images/pool-storage.png) |
| **접속 설정 › 게이트웨이** — RDP 게이트웨이 · MS RD 게이트웨이 · Guacamole(내장 자동 등록), 포트 응답 확인 | **접속 설정 › USB 장치** — VID · PID 등록, FPGA JTAG 케이블 기본 제공 |
| ![게이트웨이](docs/images/gateways.png) | ![USB 장치](docs/images/usb-library.png) |
| **접속 설정 › 외부 데스크톱** — 가상화하지 않는 실제 PC를 사용자에게 배정(RDP · 게이트웨이) | |
| ![외부 데스크톱](docs/images/external-desktops.png) | |

**사용자** — 사용자 › 사용자 목록 · 가입 심사 · 부서, 권한 › 역할 · 유효 권한 조회(조직 · 권한)

| | |
|---|---|
| **사용자 목록** — 만들기 · 수정 · 삭제, 비밀번호 · 2단계 인증 초기화, 잠긴 계정 해제, 만료일, 역할 · 출처 필터 | **일괄 등록** — CSV(아이디 · 이름 · 메일 · 부서 · 역할 · 만료일)로 학기 · 과제 계정을 한 번에, 미리 보기 |
| ![사용자 목록](docs/images/users.png) | ![일괄 등록](docs/images/users-bulk.png) |
| **가입 심사** — 가입 신청 켜고 끄기, 메일 확인 · 약관, 대기 · 승인 · 거절 | **부서** — 학과 · 연구실 · 팀 트리, 하위 부서 포함 구성원 |
| ![가입 심사](docs/images/signups.png) | ![부서](docs/images/departments.png) |
| **권한 › 역할** — 역할 만들기 · 수정 · 삭제, 권한 묶음 | |
| ![역할](docs/images/roles.png) | |

**LAB** (대학교 실습실) — LAB › LAB 관리 · 단말, 일정 · 예약 › 예약 · 사용 일정 · 일정형 풀

| | |
|---|---|
| **LAB › 단말** — MOAVI Desk Agent의 온라인 · 끊김 · 버전 · 키 전달 상태, 여러 대 한꺼번에 승인 · 거절 · LAB 지정 | **등록 코드 · 설치 파일** — 기간 · 대수 · LAB · 승인 방식을 정한 코드, 코드가 들어간 설치 파일(install.cmd), 무인 설치 명령 |
| ![단말](docs/images/terminals.png) | ![등록 코드](docs/images/terminal-enroll.png) |
| **일정 · 예약 › 예약** — 주간 · 월간 달력, 승인 대기, 정규 수업 · 다른 예약 · 좌석 · 데스크톱 수 충돌 표시, 반복 예약 | **LAB별 예약 설정** — 예약 가능 시간대 · 요일 · 최대 길이 · 미리 예약 기간 · 승인 · 역할, 미리 켜기 · 끝난 뒤 동작, 알림 |
| ![LAB 예약](docs/images/reservations.png) | ![예약 설정](docs/images/reservation-settings.png) |
| **일정 · 예약 › 사용 일정** — LAB × 일정형 풀 × 요일 · 시간의 주간 시간표, 시작 전 준비(빗금)와 끝난 뒤 초기화 | **예약 사용 보고서** (운영 › 보고서) — 예약 시간 대비 실제 사용, 노쇼, CSV |
| ![LAB 사용 일정](docs/images/lab-schedules.png) | ![예약 보고서](docs/images/reservation-report.png) |

**가속 자원** (GPU·AI · FPGA) — 카드 › 재고 · vGPU 프로필 · 리소스 매핑 · 패스스루 점검, 카드 대여 › 대여 현황 · 사용 보고서, GPU 작업 › 작업 큐 · 할당량 · GPU-시간 · 웹 IDE, 보드 LAB(JTAG), 빌드 팜, 라이선스 서버

| | |
|---|---|
| **카드 › 재고** — NVIDIA · AMD · Intel GPU, vGPU, MIG(레이아웃 · 모드 변경), FPGA 카드, 국산 NPU(FuriosaAI · Rebellions · DEEPX 등) | **카드 › 패스스루 점검** — i440fx · SeaBIOS · 자동 시작 · HA · Alveo 기능 하나 · 비트스트림 리셋 · AMD GPU 리셋 · vGPU 라이선스 · JTAG 케이블 ID · 라이선스 MAC을 미리 알림 |
| ![카드 재고](docs/images/accel-inventory.png) | ![패스스루 점검](docs/images/accel-checks.png) |
| **카드 대여 › 대여 현황** — 기간 대여 · 연장 · 반납 · 자동 반납, 실사용률, 오래 놀면 회수, 빌려줄 때 주의 사항 | **카드 대여 › 사용 보고서** — 카드별 대여 건수 · 시간 · 사용률 · 사용자, 7 · 30 · 90일, CSV |
| ![카드 대여](docs/images/card-loans.png) | ![카드 사용 보고서](docs/images/card-usage.png) |
| **GPU 작업 › 작업 큐** — 순서 · 이유 · 풀별 사용량 · 풀 설정 · 멈추기, 공정 분배 | **GPU 작업 › 할당량** — 사용자 · 부서 · 기본, 동시 GPU · 월 GPU-시간 · 엄격 |
| ![GPU 작업 큐](docs/images/gpu-queue.png) | ![GPU 할당량](docs/images/gpu-quotas.png) |
| **GPU 작업 › GPU-시간** — 사용자 · 부서별 작업 GPU-시간과 카드 대여 시간, 월 지정, CSV(비용 배분) | **GPU 작업 › 웹 IDE** — 열린 JupyterLab · VS Code 세션, 닫기, 게스트 준비 안내 |
| ![GPU-시간](docs/images/gpu-hours.png) | ![웹 IDE](docs/images/web-ide.png) |
| **보드 LAB(JTAG)** — 보드의 JTAG 케이블을 데스크톱에 연결, 대여 기간 · 자동 반납 | **빌드 팜** — 빌드 VM 부하, 작업 넣기 · 대기 · 실행 · 결과 출력 |
| ![보드 LAB](docs/images/boards.png) | ![빌드 작업 큐](docs/images/build-jobs.png) |
| **라이선스 서버** — FlexLM · vGPU 라이선스 서버 포트 감시(5분), 끊기면 메일 · 웹훅, 고정 MAC · HA | **라이선스 좌석** — 기능별 쓰는 좌석 · 대기 · 거절, 누가 쓰는지, 좌석 추이 |
| ![라이선스 서버](docs/images/licenses.png) | ![라이선스 좌석](docs/images/license-seats.png) |

**연구 데이터** (연구소 · 기업 R&D) — 데이터셋 › 데이터셋 · 반출 승인 · 반출 · 업로드 규칙, 용량 · 보고서 › 용량 · 반출 보고서

| | |
|---|---|
| **데이터셋** — NAS 위치, 쓸 수 있는 풀 · 사용자 · 부서, 읽기 전용 여부, 크기 · 파일 수 | **반출 승인** — 사유와 함께 들어온 반출 신청을 승인 · 거절, 승인되면 일회용 다운로드 링크 |
| ![데이터셋](docs/images/datasets.png) | ![반출 승인](docs/images/data-requests.png) |
| **반출 보고서** — 기간별 반출 · 업로드 건수와 크기, 사용자 · 데이터셋별, 최근 기록, CSV | |
| ![반출 보고서](docs/images/data-report.png) | |

**클러스터** — 클러스터 › 개요 · 노드 · 스토리지 · 고가용성(HA), 클러스터 연결

| | |
|---|---|
| **노드** — 유지보수 모드(데스크톱 이동 미리 보기 · 계획), 재시작 · 종료, 로그 · 센서 · 작업 | **고가용성(HA)** — Proxmox HA 리소스 등록 · 해제, HA 그룹, 상태 |
| ![노드](docs/images/nodes.png) | ![HA](docs/images/cluster-ha.png) |

**운영** — 요약 › 시스템 요약 · 작업 진행, 기록 › 접속 기록 · 작업 기록(감사), 보고서 › 사용률 · 운영 보고서(PDF), 경보, 백업(PBS), 플랫폼 설정

| | |
|---|---|
| **요약 › 작업 진행** — 복제 · 배포 · 이동 · 백업 같은 긴 작업의 진행률과 실패 로그 | **기록 › 접속 기록** — 진행 중인 접속을 끊거나 사용자의 모든 접속 끊기 |
| ![작업 진행](docs/images/tasks.png) | ![접속 기록](docs/images/sessions.png) |
| **보고서 › 사용률** — 7 · 30 · 90일, 일별 접속 시간, 풀별 사용률, 많이 쓴 사용자, CSV | **보고서 › 운영 보고서 (PDF)** — 기간별 요약, 추이, 자원 제안, 풀별 사용, 스토리지, 경보를 A4 한 장으로 |
| ![사용률](docs/images/usage-report.png) | ![운영 보고서](docs/images/report.png) |
| **경보** — 발생 중인 경보 확인 · 음소거, 경보 규칙, 알림 채널(메일 · 웹훅 등) | **백업 (PBS)** — 백업 저장소 · PBS 서버, 풀 단위 예약 백업, 지금 백업 · 복원 · 삭제 |
| ![경보](docs/images/alerts.png) | ![백업](docs/images/backup.png) |
| **플랫폼 설정** — 일반(로그인 · 비밀번호 · 감사 · 메일), 기능, 도메인(AD/LDAP), 화이트라벨, 클라이언트, 공지, 서버 이중화, 지원 | **화이트라벨** — 제품 이름 · 문구 · 로고 · 파비콘 · 대표 색 · 링크, 미리 보기 |
| ![플랫폼 설정](docs/images/settings.png) | ![화이트라벨](docs/images/branding.png) |
| **클라이언트** — Windows 클라이언트 최신 · 최소 버전, 다운로드 주소(MSI), 기본 접속 방식, 실습실 PC 설치 | **공지** — 공지 만들기 · 기간 · 종류(정보/주의) · 대상(전체/관리자) |
| ![클라이언트](docs/images/client-settings.png) | ![공지](docs/images/notices.png) |
| **서버 이중화** (고가용성) — MOAVI Desk 활성 · 대기 서버 상태, 대기 추가 · 승격 · 제거 | **지원 (서포트 번들)** — 문제가 난 기간(최대 31일)의 로그 · 감사 · 접속 · 작업 · 구성을 ZIP으로, 비밀번호 · 키는 빼고 IP · 사용자 이름 가리기 |
| ![서버 이중화](docs/images/server-pair.png) | ![서포트 번들](docs/images/support-bundle.png) |

## 기능 한눈에

괄호 안은 그 기능을 켜는 기능 묶음입니다. 괄호가 없으면 항상 켜져 있습니다.

| 메뉴 | 화면 › 탭 |
|---|---|
| 대시보드 | 인프라 모니터링(상태 점수 · 추이 · 경보), 자원 제안(증설 · 회수 · 유휴) |
| 가상머신 | 데스크톱(VM) › 목록(설정 · 디스크 · 네트워크 · 스냅샷 · 노드 이동 · 템플릿 변환 · 삭제 · 화면 열기) · VM 만들기 · ISO · 이미지 · 풀별 상태 / 이미지 › 템플릿 · 골든 이미지(버전 · 배포 · 일괄 롤아웃) · 환경 카탈로그(GPU·AI · FPGA) |
| 데스크톱 풀 | 풀(전용 · 초기화 · 공유 · 일정형 · 빌드 팜, 템플릿 일괄 복제, 할당, 초기화, 정책, 이용 권한, 공유 풀 접속 라우팅, 공유 저장소, GPU 정책 · MIG vGPU) / 접속 설정 › 게이트웨이 · USB 장치 · 외부 데스크톱(외부 접속) |
| 사용자 | 사용자 › 사용자 목록(일괄 등록 · 만료일 · 비밀번호 · 2단계 인증 초기화 · 잠금 해제) · 가입 심사(가입) · 부서(가입 · 조직) / 권한 › 역할 · 유효 권한 조회(조직 · 권한) |
| LAB | LAB › LAB 관리 · 단말(에이전트 · 등록 코드 · 설치 파일 · 한꺼번에 승인) / 일정 · 예약 › 예약(달력 · 승인 · 충돌 · 반복 · 자동 준비) · 사용 일정 · 일정형 풀, **LAB 키오스크**(`/kiosk`) — 모두 (LAB) |
| 가속 자원 | 카드 › 재고(vGPU · MIG) · vGPU 프로필 · 리소스 매핑 · 패스스루 점검, 카드 대여 › 대여 현황(실사용률 · 유휴 회수) · 사용 보고서 (GPU·AI 또는 FPGA) / GPU 작업 › 작업 큐 · 할당량 · GPU-시간 · 웹 IDE (GPU·AI) / 보드 LAB(JTAG) · 빌드 팜 · 라이선스 서버(좌석) (FPGA) |
| 연구 데이터 | 데이터셋 › 데이터셋 · 반출 승인 · 반출 · 업로드 규칙 / 용량 · 보고서 › 용량 · 반출 보고서 (연구 데이터) |
| 클러스터 | 클러스터 › 개요 · 노드 · 스토리지 · 고가용성(HA는 고가용성) / 클러스터 연결 |
| 운영 | 요약 › 시스템 요약 · 작업 진행 / 기록 › 접속 기록 · 작업 기록(감사) / 보고서 › 사용률 · 운영 보고서(PDF) / 경보 / 백업(PBS) / 플랫폼 설정 › 일반 · 기능 · 도메인(AD/LDAP) · 화이트라벨 · 클라이언트(실습실 PC 설치) · 공지 · 서버 이중화(고가용성) · 지원 |
| 작업 공간 | 공지 배너, 내 계정, 내 데스크톱(4가지 접속 · 전원 · 긴 작업 중 끄지 않기), 받을 수 있는 데스크톱, 외부 데스크톱, **웹 IDE**(GPU·AI), 내 자원(빌린 카드 · 보드, 내 GPU · 할당량, 작업 큐), 예약(LAB), 데이터(연구 데이터), 가입 신청 · 비밀번호 찾기 · 약관 동의 |

### AI · GPU 연구 (웹 IDE · GPU 작업 큐 · 할당량 · GPU-시간)

- **웹 IDE**: 풀 정책 > 접속에서 JupyterLab / VS Code를 켜면, 사용자가 포털 **웹 IDE**에서 GPU 데스크톱이나 빌드 VM에 IDE를
  엽니다. 엔진이 게스트 에이전트로 사용자 계정의 프로세스를 띄우고(이미 떠 있으면 다시 씀), 작업 폴더는 공유 저장소의 홈 또는
  스크래치입니다. 접속은 vlab-proxy의 `/ide/<세션>/`으로만 — 엔진이 1분짜리 일회용 링크를 주고, nginx가 매 요청을 엔진에
  확인(auth_request)한 뒤 IDE 토큰을 붙여 VM으로 넘깁니다. VM 포트와 토큰은 사용자에게 가지 않습니다. 빌드 VM의 IDE에는 GPU가
  보이지 않습니다(GPU 실행은 작업 큐로).
- **GPU 작업 큐**: 작업 넣기에서 GPU 장 수 · 종류 · 메모리 · 최대 실행 시간 · conda 환경 또는 컨테이너 이미지 · 끝나면 메일/웹훅을
  고릅니다. 풀을 비우면 받을 수 있는 GPU 풀 중 빈 곳에 갑니다. 빈 GPU가 있는 빌드 VM에 GPU 단위로 채워 넣고(CUDA_VISIBLE_DEVICES),
  결과는 `scratch/<사용자>/<작업 ID>`에(전체 출력 `moavi-job.log`). 순서: 할당량 넘긴 사람 뒤로 → 사람마다 첫 작업 먼저 → 오래 기다린 순,
  오래 기다린 큰 작업은 자기 GPU가 빌 때까지 뒤 작업을 막습니다. 관리: 가속 자원 > GPU 작업 › **작업 큐**(순서 · 이유 · 풀별 사용량 · 풀 설정 ·
  멈추기), **할당량**(사용자 · 부서 · 기본, 동시 GPU · 월 GPU-시간 · 엄격).
- **GPU-시간 보고서**: 사용자 · 부서(최상위로 합치기)별 작업 GPU-시간과 카드 대여 시간, 기간 · 월 지정, CSV.

### 실습실 PC 등록 (LAB > LAB › 단말)

PC에 MOAVI Desk Client를 설치하면 함께 깔리는 **MOAVI Desk 에이전트**(Windows 서비스)가 등록 코드로 PC를 등록하고, 2분마다
하트비트를 보내며, 승인되면 키오스크 키를 스스로 받아 갑니다. 등록 코드 없이는 어떤 PC도 올라오지 않습니다.
방화벽은 단말 → 서버 443(HTTPS)만 열면 됩니다.

- **준비 (관리자, 한 번)**: 운영 > 플랫폼 설정 > 클라이언트 > **실습실 PC 설치**에서 클라이언트 MSI를 올리고(설치 파일이 이것을
  HTTPS로 받아 SHA-256 확인), 포털 링크를 켜고 볼 수 있는 역할(예: 조교)과 자동 승인할 역할(기본: 없음), 파일 유효 시간(기본 24시간),
  파일 하나의 PC 수 상한, 사용자당 파일 수, 승인 대기 경고 기준, 키오스크 모드, PC가 접속할 서버 주소, 사설 인증서 지문을 정합니다.
- **설치 방법 세 가지**
  1. 포털 상단 **[실습실 PC로 설치]**(허용된 역할 누구나): 실습실 PC에서 로그인 → LAB 고르기(모르면 비워 둠) → 받은
     `moavi-desk-lab-install.cmd` 실행 → 관리자 권한 확인 한 번 → 끝. 파일 안의 토큰은 받은 사람 것(만료 · 대수 제한, 해시로 저장).
  2. LAB › 단말 > **등록 코드 만들기**(기본 7일 · 40대 · 관리자 승인) → **이 코드로 설치 파일 받기** → 여러 PC에서 실행.
  3. 배포 도구(GPO · SCCM · Intune · PDQ)용 명령 줄 복사:
     `msiexec /i MOAVI-Desk-<버전>-x64.msi /qn SERVER=desk.example.com PORT=443 HTTPS=1 KIOSK=1 ENROLL_CODE=MDE-XXXX-XXXX-XXXX`
     (MSI 옆에 `moavi-desk-enroll.json`을 두는 방법도 됨).
- **승인**: 목록에서 단말을 골라(머리글 확인란 = 보이는 것 모두) LAB과 함께 **한꺼번에 승인**하거나 **거절**합니다. 거절하면 그 PC의
  에이전트 토큰과 키가 끊기고, 단말을 지우기 전에는 다시 등록할 수 없습니다. 단말 이름을 누르면 상세(컴퓨터 이름, MAC, IP, OS,
  클라이언트 · 에이전트 버전, Windows 로그인 유무, 요청자, 최근 하트비트)와 **에이전트로 새 키 보내기**가 있습니다.
- **상태**: 에이전트 열에 온라인 / 오프라인(하트비트 3번 놓침) / 오래 응답 없음(하루 이상), 키 전달 열에 승인 대기 / 전달됨 / 직접 입력.
  승인 대기가 많으면 경고가 뜹니다. 모든 코드 · 토큰 발급, 등록, 승인, 거절, 키 전달은 작업 기록(감사)에 남습니다.
- 포털의 **MOAVI Desk Client 받기**는 개인 PC용으로, 서버 주소만 들어간 설치 파일(MSI가 올라가 있을 때)이고 단말로 등록하지 않습니다.

화면은 한국어·영어, 다크·라이트 테마(사용자 메뉴에서 시스템·라이트·다크)를 지원하고, 1920×1080부터 휴대폰 폭까지 창 크기에 맞춰 배치가 바뀝니다.
버전과 라이선스는 오른쪽 위 사용자 메뉴의 **정보**에서, 비밀번호 변경과 2단계 인증(인증 앱 QR 등록 · 해제)은 같은 메뉴의 **내 계정**에서 합니다.

## 실행

```bash
npm install
npm run dev:mock   # 엔진 없이 화면만 (아무 아이디로 로그인, admin → 관리자)
npm run dev        # 엔진에 연결 (VLAB_ENGINE_URL, 기본 https://localhost:5000)
npm run build      # dist/ — nginx 가 정적 파일로 제공
```

`npm run dev:mock` 에서 주소에 `?as=admin` 을 붙이면 로그인 없이 바로 들어갑니다(시연·화면 캡처용, 모의 모드에서만).

`npm run dev` 는 `/api`·`/ws` 를 엔진으로 넘깁니다(vite.config.ts). 운영에서는 nginx 가 같은 역할을 합니다.
**프록시는 Host 헤더를 바꾸면 안 됩니다** — 엔진의 CSRF 검사가 `Origin` 과 `Host` 를 비교하므로 Vite 는 `changeOrigin: false`,
nginx 는 `proxy_set_header Host $http_host;` 로 둡니다.

## 서버에 설치

[deploy/README.md](deploy/README.md) — docker compose 로 콘솔(nginx, HTTPS)과 엔진(API 전용), 브라우저 RDP 용 Apache Guacamole(guacd · guacamole)을
한 서버에 함께 설치합니다. 사용자에게 열 포트는 443 하나이고(브라우저 RDP 도 같은 443 의 `/guacamole/`), Guacamole 공유 키는 첫 시작 때 자동으로 만들어
엔진이 게이트웨이로 스스로 등록합니다. 브라우저 RDP 를 쓰지 않으면 `.env` 에 `VLAB_GUACAMOLE=0`.

## 구조

| 경로 | 내용 |
|---|---|
| `src/brand.ts` | 제품명·회사·엔진 고지 정보 |
| `src/i18n/` | 한/영 문구 (키마다 `ko`·`en`) |
| `src/api/` | 엔진 API(`client.ts`, `admin.ts`, `next.ts`, ISO·VM 만들기 `build.ts`, 계정 · 역할 `users.ts`, 작업 · 노드 · HA · 서버 이중화 `ops.ts`, 단말 등록 코드 `enroll.ts`, GPU 작업 · 할당량 · GPU-시간 · 웹 IDE `research.ts`), 모의 엔진(`mock.ts`, `mockAdmin.ts`, `next.ts`·`build.ts`·`users.ts`·`ops.ts`·`enroll.ts`·`research.ts` 안의 모의), 타입 |
| `src/auth/` | 세션, 로그인(비밀번호 → 필요 시 TOTP, OIDC, LDAP 안내), 첫 설정 |
| `src/admin/` | 모듈·페이지 정의(`modules.ts`), 대시보드, 모듈 화면(골든 이미지 · 게이트웨이 · 보드 · 빌드 팜 · 라이선스 등은 `pages/NextPages.tsx`, 풀 권한은 `pages/PoolGrants.tsx`, ISO · 이미지 관리와 VM 만들기는 `pages/BuildPages.tsx`, 작업 진행 · 노드 유지보수 · 고가용성(HA) · 서버 이중화는 `pages/OpsPages.tsx`, 단말 등록 코드 · 설치 파일 · 승인 · 단말 상세 · 실습실 PC 설치 설정 · 포털 설치 버튼은 `pages/TerminalEnroll.tsx`, GPU 작업 큐 · 할당량 · GPU-시간 보고서 · 웹 IDE 세션은 `pages/ResearchPages.tsx`) |
| `src/portal/` | 작업 공간(데스크톱 타일·목록), 받을 수 있는 데스크톱(`MyPools.tsx`), 외부 데스크톱, 웹 IDE · 내 GPU(`WebIde.tsx`), 내 자원 · 빌드 · GPU 작업, 브라우저 콘솔 |
| `src/components/` | 상단 막대, 왼쪽 메뉴, 화면 틀, 고지, 대화 상자, 아이콘 |
| `deploy/` | Dockerfile·nginx·docker compose 설치 묶음 (vlab-proxy · vlab-engine · guacd · guacamole) |

엔진과는 HTTP API 로만 통신합니다 — 인증은 엔진의 `/api/auth/*`, 그 밖은 vLAB API `/api/vlab/*` 만 씁니다.
예외는 플랫폼 설정 > 서버 이중화의 엔진 `/api/ha/*` 하나입니다: 대기 서버는 `/api/ha/` 밖의 쓰기를 활성 서버로 넘기므로,
승격처럼 그 서버에서 일어나야 하는 일은 감싸지 않고 엔진 경로를 그대로 부릅니다.

## 고지·라이선스

- 모든 화면 하단·로그인·정보 창의 **"Powered by PegaProx"** 고지는 엔진의 AGPL-3.0 제7조(b) 저작자 표시라 지우거나 가리지 않습니다
  (`src/components/EngineNotice.tsx`, [NOTICE.md](NOTICE.md)).
- 이 콘솔의 라이선스는 (주)매커스시스템즈가 정합니다(`UNLICENSED`, 별도 허락 없이 사용·배포할 수 없음). 사용한 공개 라이브러리는 [NOTICE.md](NOTICE.md).
