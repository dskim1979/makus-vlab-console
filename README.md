<p align="center">
  <img src="docs/images/admin-dashboard.png" alt="MOAVI Desk 관리 콘솔 대시보드" width="900">
</p>

<h1 align="center">MOAVI Desk 콘솔</h1>

<p align="center">
  연구소·기업·교육 기관의 LAB과 FPGA 개발 조직을 위한 가상 데스크톱(VDI) — <b>사용자 작업 공간</b>과 <b>관리 콘솔</b>
</p>

<p align="center">
  <a href="https://github.com/dskim1979/makus-vlab">엔진(makus-vlab)</a> ·
  <a href="deploy/README.md">서버에 설치</a> ·
  <a href="NOTICE.md">고지</a>
</p>

---

## 화면

### 사용자 작업 공간 (`/`)
배정된 데스크톱을 한 화면에서 보고 바로 접속합니다. 즐겨찾기, 켜져 있는 것만 보기, 검색을 지원합니다.
접속은 브라우저(noVNC), SPICE 파일, RDP 파일, 브라우저 RDP(Guacamole) 중 풀 정책이 허용한 방식으로 합니다.
GPU·vGPU·FPGA·NPU 카드가 붙은 데스크톱은 카드에 표시되고, 상단의 **원격 지원 요청**으로 매커스시스템즈 지원 페이지를 엽니다.

| | |
|---|---|
| **작업 공간** — 데스크톱 카드, 접속 방법 안내, MOAVI Desk Client 받기 | **접속 메뉴** — ··· 에서 SPICE 파일 받기, RDP 파일 받기, 브라우저 RDP로 열기, 전원 |
| ![작업 공간](docs/images/portal.png) | ![접속 메뉴](docs/images/portal-rdp.png) |
| **받을 수 있는 데스크톱 · 외부 데스크톱** — 권한이 있는 풀에서 직접 받기(전용) · 바로 연결(공유), 실제 PC에 RDP · 브라우저로 접속 | **로그인** — 회사 표기, 가입 신청, 원격 지원 요청 링크 |
| ![받을 수 있는 데스크톱](docs/images/portal-pools.png) | ![로그인](docs/images/login.png) |
| **공지 배너** — 점검 · 배포 안내가 작업 공간과 관리 콘솔 위에 뜸(닫기 가능) | **내 계정** — 비밀번호 변경, 2단계 인증(TOTP) 등록 · 해제 |
| ![공지 배너](docs/images/portal-notices.png) | ![내 계정](docs/images/my-account.png) |

### 관리 콘솔 (`/admin`)

| | |
|---|---|
| **대시보드** — 상태 점수, CPU·메모리·VM·접속 추이(24시간·7일·30일), 노드별 CPU, 활성 경보, 자원 제안(증설·회수) | **데스크톱(VM) 관리** — 사용량, 전원(한 대씩·여러 대 한 번에) |
| ![대시보드](docs/images/admin-dashboard.png) | ![데스크톱 VM](docs/images/desktop-vms.png) |
| **VM 관리 창** — CPU · 메모리, 디스크 늘리기 · 추가, 네트워크(브리지 · VLAN), 노드 이동, 템플릿 변환 · 삭제, 화면 열기(지원) | **VM 스냅샷** — 만들기(메모리 포함 선택) · 되돌리기 · 삭제, 초기화 기준 표시 |
| ![VM 관리](docs/images/vm-manage.png) | ![VM 스냅샷](docs/images/vm-snapshots.png) |
| **VM 만들기** — OS 종류(Windows 11은 UEFI · TPM 자동) · 노드 · ISO · virtio · CPU · 메모리 · 디스크 · 네트워크, 만든 뒤 바로 콘솔로 설치 | **ISO · 이미지 관리** — 스토리지별 ISO 목록, 업로드(진행률), URL로 받기, 삭제 |
| ![VM 만들기](docs/images/vm-create.png) | ![ISO 관리](docs/images/iso-library.png) |
| **골든 이미지** — 일반 VM을 골든 이미지로, 버전(스냅샷) 만들기, 풀에 배포, 풀별 예전 버전 대수 | **골든 롤아웃** — 예전 버전 데스크톱을 새 버전 복제본으로 일괄 교체(사용자 · 권한 이전, 접속 중은 건너뜀) |
| ![골든 이미지](docs/images/golden-images.png) | ![골든 롤아웃](docs/images/golden-rollout.png) |
| **풀 상세** — 정책 · 이용 권한 · GPU 정책 패널, 데스크톱 할당 · 초기화 | **이용 권한** — 사용자 · 부서(하위 포함) · AD/LDAP 그룹, 공유 풀의 데스크톱당 최대 접속 |
| ![풀 상세](docs/images/pool-detail.png) | ![이용 권한](docs/images/pool-grants.png) |
| **풀 편집** — 이름 · 설명 · 사용/중지, 공유 풀 최대 접속, RDP · 브라우저 RDP 게이트웨이 | **접속 기록 · 끊기** — 진행 중인 접속을 끊거나 사용자의 모든 접속 끊기 |
| ![풀 편집](docs/images/pool-edit.png) | ![접속 기록](docs/images/sessions.png) |
| **풀 정책** — 접속 방식(noVNC · SPICE · RDP · 브라우저 RDP), 클립보드 · USB, 전원 · 시간 · 초기화 | **게이트웨이** — RDP 게이트웨이 · MS RD 게이트웨이 · Guacamole(내장 자동 등록), 포트 응답 확인 |
| ![풀 정책](docs/images/pool-policy.png) | ![게이트웨이](docs/images/gateways.png) |
| **외부 데스크톱** — 가상화하지 않는 실제 PC를 사용자에게 배정(RDP · 게이트웨이) | **USB 장치 라이브러리** — VID · PID 등록, FPGA JTAG 케이블 기본 제공 |
| ![외부 데스크톱](docs/images/external-desktops.png) | ![USB 장치](docs/images/usb-library.png) |
| **가입 심사** — 로그인 화면의 가입 신청을 켜고 끄기, 대기 · 승인 · 거절 | **부서 관리** — 학과 · 연구실 · 팀 트리, 하위 부서 포함 구성원 |
| ![가입 심사](docs/images/signups.png) | ![부서 관리](docs/images/departments.png) |
| **사용자 목록** — 만들기 · 수정 · 삭제, 비밀번호 · 2단계 인증 초기화, 잠긴 계정 해제, 역할 · 출처 필터 | **역할 관리** — 역할 만들기 · 수정 · 삭제, 권한 묶음 |
| ![사용자 목록](docs/images/users.png) | ![역할 관리](docs/images/roles.png) |
| **LAB 사용 일정** — LAB × 일정형 풀 × 요일·시간의 주간 시간표, 시작 전 준비(빗금)와 끝난 뒤 초기화 | **LAB 키오스크** (`/kiosk`) — 지금 수업·다음 수업, 로그인하면 수업 데스크톱으로 바로 |
| ![LAB 사용 일정](docs/images/lab-schedules.png) | ![LAB 키오스크](docs/images/kiosk.png) |
| **GPU·가속 카드 재고** — NVIDIA·AMD·Intel GPU, vGPU, FPGA 카드, 국산 NPU(FuriosaAI·Rebellions·DEEPX 등) | **카드 대여 현황** — 기간 대여 · 연장 · 반납 · 자동 반납 |
| ![가속 자원](docs/images/accel-inventory.png) | ![카드 대여](docs/images/card-loans.png) |
| **보드 LAB(JTAG)** — 보드의 JTAG 케이블을 데스크톱에 연결, 대여 기간 · 자동 반납 | **빌드 팜 · 작업 큐** — 빌드 VM 부하, 작업 넣기 · 대기 · 실행 · 결과 출력 |
| ![보드 LAB](docs/images/boards.png) | ![빌드 작업 큐](docs/images/build-jobs.png) |
| **라이선스 서버** — FlexLM · vGPU 라이선스 서버 포트 감시(5분), 끊기면 메일 · 웹훅 알림, 고정 MAC · HA | **카드 사용 보고서** — 카드별 대여 건수 · 시간 · 사용률 · 사용자, 7·30·90일, CSV |
| ![라이선스 서버](docs/images/licenses.png) | ![카드 사용 보고서](docs/images/card-usage.png) |
| **노드** — 유지보수 모드(데스크톱 이동 미리 보기 · 계획), 재시작 · 종료, 로그 · 센서 · 작업 | **고가용성(HA)** — Proxmox HA 리소스 등록 · 해제, HA 그룹, 상태 |
| ![노드](docs/images/nodes.png) | ![HA](docs/images/cluster-ha.png) |
| **카드 · 패스스루 점검** — GPU · Alveo · NPU 패스스루에서 알려진 문제(i440fx · SeaBIOS · 자동 시작 · HA · Alveo 기능 하나 · 비트스트림 리셋 · AMD GPU 리셋 · vGPU 라이선스 · JTAG 케이블 ID · 라이선스 MAC)를 미리 알림 | **카드 대여 경고 · 리셋 확인** — 카드를 빌려줄 때 그 VM의 주의 사항을 바로 보여 주고, 포털에서 카드가 붙은 데스크톱을 끄거나 다시 시작하면 비트스트림이 지워진다고 묻습니다 |
| ![카드 점검](docs/images/accel-checks.png) | ![카드 대여](docs/images/card-loans.png) |
| **작업 진행** — 복제 · 배포 · 이동 · 백업 같은 긴 작업의 진행률과 실패 로그, 상단 바에 진행 중 수 | **서버 이중화** — MOAVI Desk 활성 · 대기 서버 상태, 대기 추가 · 승격 · 제거 |
| ![작업 진행](docs/images/tasks.png) | ![서버 이중화](docs/images/server-pair.png) |
| **템플릿 관리** — 디스크·링크 클론 가능 여부·사용 풀, 여기서 풀에 클론 | **사용률 보고서** — 7·30·90일, 일별 접속 시간, 풀별 사용률, 많이 쓴 사용자, CSV |
| ![템플릿](docs/images/templates.png) | ![사용률 보고서](docs/images/usage-report.png) |
| **운영 보고서 (PDF)** — 기간별 요약, 추이, 자원 제안, 풀별 사용, 스토리지, 경보를 A4 한 장으로 | **경보** — 발생 중인 경보 확인·음소거, 경보 규칙, 알림 채널(메일·웹훅 등) |
| ![운영 보고서](docs/images/report.png) | ![경보](docs/images/alerts.png) |
| **백업 (PBS)** — 백업 저장소·PBS 서버, 풀 단위 예약 백업, 지금 백업·복원·삭제 | **플랫폼 설정** — 일반(로그인·비밀번호·감사·메일), 도메인(AD/LDAP), 화이트라벨, 클라이언트 |
| ![백업](docs/images/backup.png) | ![플랫폼 설정](docs/images/settings.png) |
| **화이트라벨** — 제품 이름·문구·로고·파비콘·대표 색·링크, 미리 보기 | **클라이언트 배포** — Windows 클라이언트 최신 · 최소 버전, 다운로드 주소(MSI), 기본 접속 방식 |
| ![화이트라벨](docs/images/branding.png) | ![클라이언트](docs/images/client-settings.png) |
| **공지** — 공지 만들기 · 기간 · 종류(정보/주의) · 대상(전체/관리자) | **지원 (서포트 번들)** — 문제가 난 기간(최대 31일)을 골라 로그 · 감사 · 접속 · 작업 · 구성을 ZIP으로, 비밀번호 · 키는 빼고 IP · 사용자 이름 가리기 |
| ![공지](docs/images/notices.png) | ![서포트 번들](docs/images/support-bundle.png) |

## 기능 한눈에

| 모듈 | 화면 |
|---|---|
| 대시보드 | 인프라 모니터링(상태 점수·추이·경보), 자원 제안(증설·회수·유휴) |
| 가상머신 | 데스크톱(VM) 관리(설정 · 디스크 · 네트워크 · 스냅샷 · 노드 이동 · 템플릿 변환 · 삭제 · 화면 열기), VM 만들기(ISO), ISO · 이미지 관리, 템플릿 관리, 골든 이미지(버전 · 배포 · 일괄 롤아웃) |
| 데스크톱 풀 | 풀 관리(전용·초기화·공유·일정형·빌드 팜, 풀 편집), 템플릿 일괄 복제, 할당, 초기화, 풀 정책(noVNC · SPICE · RDP · 브라우저 RDP), 이용 권한(사용자 · 부서 · AD 그룹), 공유 풀 접속 라우팅, 풀 GPU 정책, 데스크톱 상태, 게이트웨이, USB 장치 라이브러리, 외부 데스크톱 |
| 사용자 | 사용자 목록(만들기 · 수정 · 삭제, 비밀번호 · 2단계 인증 초기화, 잠긴 계정 해제, 다음 로그인 때 비밀번호 변경), 역할 관리(권한 묶음), 가입 심사, 부서 관리, 유효 권한 조회 |
| LAB | LAB 관리(공용 공간·좌석·지금/다음 일정), 단말 관리(에이전트 등록 · 하트비트 · 온라인 상태, 등록 코드 · 설치 파일 · 무인 설치 명령, 여러 대 한꺼번에 승인 · 거절 · LAB 지정, 키 자동 전달, 단말 상세), 사용 일정(주간 시간표, 시작 전 준비, 끝난 뒤 초기화·끄기), 일정형 풀, **LAB 키오스크**(`/kiosk`) |
| 가속 자원 | GPU·가속 카드 재고(GPU·FPGA·NPU), vGPU 프로필, 리소스 매핑, 카드 대여 현황, 보드 LAB(JTAG · 대여 기간 · 자동 반납), 빌드 팜(작업 큐), 라이선스 서버(자동 감시 · 알림), 카드 사용 보고서, 카드 · 패스스루 점검 |
| 클러스터 | 개요, 노드(유지보수 · 재시작 · 로그 · 센서), 스토리지, 고가용성(Proxmox HA), 클러스터 연결 |
| 운영 | 시스템 요약, 작업 진행, 접속 기록(접속 끊기), 사용률 보고서, 운영 보고서(PDF), 경보, 백업(PBS), 작업 기록(감사), 플랫폼 설정(일반·도메인·화이트라벨·클라이언트 · 실습실 PC 설치·공지·서버 이중화·지원) |
| 작업 공간 | 공지 배너, 내 계정(비밀번호 · 2단계 인증), 내 데스크톱(4가지 접속 방식 · 전원), 받을 수 있는 데스크톱(직접 받기 · 공유 풀 연결), 외부 데스크톱, 내 자원(빌린 카드 · 보드, 빌드 작업 큐) |

### 실습실 PC 등록 (LAB > 단말 관리)

PC에 MOAVI Desk Client를 설치하면 함께 깔리는 **MOAVI Desk 에이전트**(Windows 서비스)가 등록 코드로 PC를 등록하고, 2분마다
하트비트를 보내며, 승인되면 키오스크 키를 스스로 받아 갑니다. 등록 코드 없이는 어떤 PC도 올라오지 않습니다.
방화벽은 단말 → 서버 443(HTTPS)만 열면 됩니다.

- **준비 (관리자, 한 번)**: 운영 > 플랫폼 설정 > 클라이언트 > **실습실 PC 설치**에서 클라이언트 MSI를 올리고(설치 파일이 이것을
  HTTPS로 받아 SHA-256 확인), 포털 링크를 켜고 볼 수 있는 역할(예: 조교)과 자동 승인할 역할(기본: 없음), 파일 유효 시간(기본 24시간),
  파일 하나의 PC 수 상한, 사용자당 파일 수, 승인 대기 경고 기준, 키오스크 모드, PC가 접속할 서버 주소, 사설 인증서 지문을 정합니다.
- **설치 방법 세 가지**
  1. 포털 상단 **[실습실 PC로 설치]**(허용된 역할 누구나): 실습실 PC에서 로그인 → LAB 고르기(모르면 비워 둠) → 받은
     `moavi-desk-lab-install.cmd` 실행 → 관리자 권한 확인 한 번 → 끝. 파일 안의 토큰은 받은 사람 것(만료 · 대수 제한, 해시로 저장).
  2. 단말 관리 > **등록 코드 만들기**(기본 7일 · 40대 · 관리자 승인) → **이 코드로 설치 파일 받기** → 여러 PC에서 실행.
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
| `src/api/` | 엔진 API(`client.ts`, `admin.ts`, `next.ts`, ISO·VM 만들기 `build.ts`, 계정 · 역할 `users.ts`, 작업 · 노드 · HA · 서버 이중화 `ops.ts`, 단말 등록 코드 `enroll.ts`), 모의 엔진(`mock.ts`, `mockAdmin.ts`, `next.ts`·`build.ts`·`users.ts`·`ops.ts`·`enroll.ts` 안의 모의), 타입 |
| `src/auth/` | 세션, 로그인(비밀번호 → 필요 시 TOTP, OIDC, LDAP 안내), 첫 설정 |
| `src/admin/` | 모듈·페이지 정의(`modules.ts`), 대시보드, 모듈 화면(골든 이미지 · 게이트웨이 · 보드 · 빌드 팜 · 라이선스 등은 `pages/NextPages.tsx`, 풀 권한은 `pages/PoolGrants.tsx`, ISO · 이미지 관리와 VM 만들기는 `pages/BuildPages.tsx`, 작업 진행 · 노드 유지보수 · 고가용성(HA) · 서버 이중화는 `pages/OpsPages.tsx`, 단말 등록 코드 · 설치 파일 · 승인 · 단말 상세 · 실습실 PC 설치 설정 · 포털 설치 버튼은 `pages/TerminalEnroll.tsx`) |
| `src/portal/` | 작업 공간(데스크톱 타일·목록), 받을 수 있는 데스크톱(`MyPools.tsx`), 외부 데스크톱, 내 자원 · 빌드 작업, 브라우저 콘솔 |
| `src/components/` | 상단 막대, 왼쪽 메뉴, 화면 틀, 고지, 대화 상자, 아이콘 |
| `deploy/` | Dockerfile·nginx·docker compose 설치 묶음 (vlab-proxy · vlab-engine · guacd · guacamole) |

엔진과는 HTTP API 로만 통신합니다 — 인증은 엔진의 `/api/auth/*`, 그 밖은 vLAB API `/api/vlab/*` 만 씁니다.
예외는 플랫폼 설정 > 서버 이중화의 엔진 `/api/ha/*` 하나입니다: 대기 서버는 `/api/ha/` 밖의 쓰기를 활성 서버로 넘기므로,
승격처럼 그 서버에서 일어나야 하는 일은 감싸지 않고 엔진 경로를 그대로 부릅니다.

## 고지·라이선스

- 모든 화면 하단·로그인·정보 창의 **"Powered by PegaProx"** 고지는 엔진의 AGPL-3.0 제7조(b) 저작자 표시라 지우거나 가리지 않습니다
  (`src/components/EngineNotice.tsx`, [NOTICE.md](NOTICE.md)).
- 이 콘솔의 라이선스는 (주)매커스시스템즈가 정합니다(`UNLICENSED`, 별도 허락 없이 사용·배포할 수 없음). 사용한 공개 라이브러리는 [NOTICE.md](NOTICE.md).
