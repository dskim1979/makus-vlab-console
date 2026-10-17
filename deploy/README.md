# vLAB 설치 (docker compose)

Linux 서버 한 대에 `docker compose up` 한 번으로 설치한다. 시험용·파일럿용 기준이며, 이중화와 오프라인 설치 묶음은 다음 단계.

| 컨테이너 | 하는 일 | 원본 |
|---|---|---|
| `vlab-proxy` | 콘솔 화면, HTTPS(443), `/api` 를 엔진으로 전달 (VNC 웹소켓 포함) | 이 저장소 |
| `vlab-engine` | vLAB 엔진 (화면 없이 API 만, `WEB_UI=0`) | `makus-vlab` |
| `guacd`, `guacamole` | 브라우저 RDP — Apache Guacamole 1.6 + guacamole-auth-json, 같은 443 의 `/guacamole/` (끄기: `VLAB_GUACAMOLE=0`) | 공식 이미지 |
| `vlab-guac-key` | 시작할 때 한 번 돌고 끝남 — Guacamole 공유 키를 `vlab-guac` 볼륨에 둔다 | `alpine` |
| `vlab-directory` | **선택**(`VLAB_DIRECTORY=1`) — 내장 디렉터리(Samba AD DC). AD 가 없는 곳에서 포털 계정 = 데스크톱 계정 | 이 저장소 `deploy/directory/` (Debian 12 · Samba 4.17) |

사용자 PC 에서 열어야 하는 포트는 **443 하나**다. SPICE 를 쓰면 사용자 PC → Proxmox 노드 **3128**(spiceproxy)도 열어야 한다.
엔진 → Proxmox 는 **8006**(API).

## 준비
- Linux (Ubuntu 22.04/24.04, Debian 12 등), Docker Engine 24 이상과 compose 플러그인
- 두 저장소를 같은 폴더에 나란히 받는다

```bash
mkdir -p ~/vlab && cd ~/vlab
git clone <makus-vlab 저장소> makus-vlab
git clone <makus-vlab-console 저장소> makus-vlab-console
```

## 설치

```bash
cd ~/vlab/makus-vlab-console/deploy
echo "VLAB_HOSTNAME=vlab.lab.example" > .env      # 사용자가 접속할 이름
docker compose up -d --build
docker compose ps                                  # vlab-proxy·vlab-engine·guacd·guacamole running (vlab-guac-key 는 exited 0)
```

브라우저로 `https://vlab.lab.example` 을 연다. 처음에는 자체 서명 인증서라 경고가 나온다 → 아래 "인증서 바꾸기".

## 첫 설정
> **첫 설정을 마칠 때까지 443 을 다른 사람에게 열지 않는다.** 관리자가 아직 없는 동안에는 먼저 접속한 사람이 관리자를 만든다.
> (방화벽으로 관리자 PC 만 허용하거나, 서버에서 `ssh -L 8443:localhost:443` 로 터널을 열어 `https://localhost:8443` 으로 설정)

1. 브라우저로 주소를 열면 **첫 설정** 화면이 나온다 → 관리자 아이디·비밀번호를 정한다 (비밀번호 규칙은 엔진의 비밀번호 정책을 따른다)
2. 자동으로 로그인되어 대시보드에 **어떤 곳에서 쓰시나요?** 가 뜬다 → 사이트 프로필(일반 업무 VDI · 소규모 연구실 · 대학교 실습실 ·
   연구소 · 기업 R&D)과 연구 분야(FPGA 개발 · GPU · AI 연구)를 고르고 **이대로 시작**. 고른 기능의 메뉴만 보이고, 나중에
   **운영 > 플랫폼 설정 > 기능** 에서 바꾸거나 묶음을 하나씩 켜고 끈다(꺼진 기능의 데이터는 지우지 않는다)
3. **클러스터 > 클러스터 연결** → Proxmox 클러스터 연결 (노드 주소, `root@pam`, 비밀번호)
4. **운영 > 플랫폼 설정 > 도메인(AD/LDAP)** — 기관의 AD 를 쓰면 설정. 사용자가 데스크톱을 쓰려면 **기본 역할을 "사용자"** 로 (조회 전용은 포털을 못 쓴다)
5. **데스크톱 풀 > 풀** — 풀 만들기 → 템플릿에서 만들기 (또는 VM 넣기) → 사용자 할당
6. 사용자는 같은 주소로 로그인해 **내 데스크톱** 에서 접속

**고급 — 무인 설치에서 프로필 미리 정하기**: `.env` 에 `VLAB_PROFILE=general|small_lab|university|research` 와
`VLAB_FEATURES=gpuai,fpga`(더할 묶음, 쉼표)를 넣으면 엔진이 처음 한 번 그 값으로 정하고 첫 설정의 프로필 화면을 건너뛴다.
이미 고른 뒤에는 `.env` 를 바꿔도 덮어쓰지 않는다(콘솔에서 바꾼다).

## 브라우저 RDP (Guacamole)
설치 묶음에 Guacamole 이 같이 들어 있어서, 위의 `docker compose up -d` 로 함께 올라간다. 따로 할 일은 없다.
같은 443 의 `/guacamole/` 경로로 나가므로 더 열 포트도 없다. guacd 컨테이너 → 데스크톱 **3389** 만 열려 있으면 된다.

- **공유 키**: 첫 시작 때 `vlab-guac-key` 가 16진수 32자 키를 만들어 `vlab-guac` 볼륨에 둔다. 엔진과 guacamole 이 같은 파일을 읽는다.
  정해진 키를 쓰려면 `.env` 에 `VLAB_GUAC_KEY=<16진수 32자>` (`openssl rand -hex 16`) 를 넣는다 — 볼륨의 키보다 앞선다.
- **게이트웨이 등록**: 엔진이 시작할 때 **게이트웨이** 화면에 "MOAVI Desk 내장 Guacamole" 을 스스로 등록하고 키를 넣는다
  (표시 주소 `VLAB_HOSTNAME`, 포트 `VLAB_HTTPS_PORT`/443). 사용자에게 주는 링크는 사용자가 콘솔에 들어온 주소 그대로
  `https://<그 주소>/guacamole/?data=…` (5분짜리 서명 링크)라서, IP 로 들어오든 이름으로 들어오든 맞는다.
  이 게이트웨이의 키는 콘솔에서 바꾸지 않는다 — 엔진이 다시 시작할 때 볼륨의 키로 되돌린다.
- 포털에서 외부 데스크톱의 **브라우저로 연결** 을 눌러 확인한다. Guacamole 자체 로그인 화면은 쓰지 않는다 — 엔진이 서명한 링크로만 들어간다.

키 바꾸기 (`.env` 의 `VLAB_GUAC_KEY` 를 새 값으로 한 뒤):
```bash
docker compose up -d --force-recreate vlab-guac-key vlab-engine guacamole
```

**끄기** (브라우저 RDP 를 쓰지 않는 현장): `.env` 에 `VLAB_GUACAMOLE=0` 을 넣고 `docker compose up -d --remove-orphans`.
guacd·guacamole 컨테이너가 만들어지지 않고(이미 있으면 내려간다), 내장 게이트웨이는 "사용 안 함" 이 된다. 다시 켜려면 줄을 지우고 `docker compose up -d`.
별도로 둔 Guacamole 을 쓰려면 끈 다음 **게이트웨이** 화면에서 그 서버(주소·포트·공유 키)를 추가한다.

## 내장 디렉터리 (AD 가 없는 곳)
기관 AD 가 없으면 설치 묶음의 **Samba AD DC** 를 켜서 포털 계정을 그대로 데스크톱(Windows · Linux) 계정으로 쓴다.
사용자는 포털과 데스크톱에 같은 아이디 · 비밀번호로 로그인하고, 부서는 디렉터리 그룹이 된다.
**기관 AD 가 있으면 켜지 않는다** — 그 AD 를 **운영 > 플랫폼 설정 > 도메인(AD/LDAP)** 에 넣는다(그 설정이 켜져 있으면 내장 DC 는 로그인에 쓰이지 않는다).

### 켜기
```bash
cat >> .env <<'ENV'
VLAB_DIRECTORY=1
VLAB_DIRECTORY_IP=10.20.0.5          # 이 서버의 데스크톱 망 주소 (데스크톱이 DNS · 로그인에 쓰는 주소)
VLAB_DIRECTORY_REALM=moavi.lan       # 도메인 DNS 이름 (바꾸려면 처음 켜기 전에)
VLAB_DIRECTORY_DOMAIN=MOAVI          # NetBIOS 이름 (MOAVI\alice), 15자 이내
VLAB_DIRECTORY_HOSTNAME=dc1          # DC 이름 (dc1.moavi.lan)
# VLAB_DIRECTORY_ADMIN_PASSWORD=...  # 비우면 처음에 만들어 볼륨에 둔다 (아래 "관리자 비밀번호")
# VLAB_DIRECTORY_DNS_FORWARDER=...   # 도메인 밖 이름을 물을 DNS (기본: 도커가 주는 호스트의 DNS)
ENV
docker compose up -d --build
docker compose logs -f vlab-directory     # "starting samba (primary)" 가 나오면 준비됨
```

첫 시작에 도메인을 만들고 `OU=MOAVI` 아래에 `Users` · `Groups` · `Desktops` · `Service` 를 둔다. 엔진 서비스 계정 `vlab-svc` 는
`OU=MOAVI` 만 관리할 수 있고(비밀번호는 `vlab-directory-out` 볼륨에, 엔진은 읽기만), 가입 계정 `vlab-join` 은 `OU=Desktops` 에 컴퓨터만 만들 수 있다.
엔진은 시작할 때 이를 알아채고 **포털 로그인을 내장 DC(LDAPS 636, DC 가 만든 CA 로 인증서 확인)로** 돌린다.
콘솔 **사용자 > 도메인(AD/LDAP)** 맨 위의 **내장 디렉터리** 에서 상태 · 연결 확인 · 지금 맞추기 · 계정 목록을 본다.

- **열 포트 (데스크톱 망 쪽만, `VLAB_DIRECTORY_IP` 에만 묶임)**: 53 tcp/udp(DNS), 88 tcp/udp(Kerberos), 389 tcp/udp(LDAP), 445 tcp(SMB · SYSVOL),
  464 tcp/udp(비밀번호 변경), 636 tcp(LDAPS), 3268 · 3269 tcp(글로벌 카탈로그). 인터넷 쪽에는 절대 열지 않는다.
  `VLAB_DIRECTORY_IP` 를 넣지 않으면 컨테이너가 시작하지 않는다(포트도 127.0.0.1 에만).
- **데스크톱 DNS**: 데스크톱이 DC 를 DNS 로 써야 한다. 데스크톱 망의 DHCP 가 `VLAB_DIRECTORY_IP` 를 DNS 로 주는 것이 가장 좋다.
  아니면 도메인 가입 때 엔진이 데스크톱의 DNS 를 DC 로 바꾼다(설정 "가입할 때 DNS 를 DC 로", 기본 켬).
- **계정**: 포털에서 만들거나(한 명씩 · CSV) 가입을 승인하면 같은 계정이 DC 에 생긴다. 사용 중지 · 삭제 · 부서 이동도 바로 간다.
  켜기 전부터 있던 포털 계정은 **다음 로그인 때** 그 비밀번호로 옮겨진다. 관리자 계정은 포털 계정으로 남는다(DC 가 멈춰도 콘솔에 들어오도록).
- **비밀번호**: 사용자가 정한 비밀번호(가입 · 비밀번호 찾기 · 내 계정)는 그 자리에서 DC 로만 간다. 엔진은 사용자 비밀번호를 저장하지 않는다.
  비밀번호 규칙은 포털의 비밀번호 정책과 DC 의 규칙을 합친 것이다. DC 는 AD 기본 복잡도(대문자 · 소문자 · 숫자 · 기호 중 셋, 아이디 · 이름 포함 금지)를
  켜 두고 만료 · 이력 · 잠금은 꺼 두었다(포털이 따로 한다). 포털 화면이 같은 규칙을 보여 주고 미리 검사하므로 포털이 받은 비밀번호는 DC 도 받는다.

### 데스크톱 도메인 가입
**데스크톱 풀 > 풀 > (풀) > 도메인 가입** 에서 한 대씩 또는 켜진 데스크톱을 한꺼번에 가입시킨다(QEMU 게스트 에이전트 필요).

- **Windows**: `Add-Computer` 로 `OU=Desktops` 에, 이름은 `MD-{vmid}`(설정에서 바꿈). 재시작해야 적용된다("가입 후 재시작" 을 켜면 15초 뒤 재시작).
  `moavi-users` 를 원격 데스크톱 사용자에 넣는다. **템플릿은 반드시 sysprep 으로 일반화**한다(`sysprep /generalize /oobe /shutdown`) —
  일반화하지 않은 설치본을 복제하면 SID · 이름이 같아 가입이 꼬인다. 가입한 데스크톱의 RDP 파일은 `MOAVI\아이디` 로 로그인한다.
- **Linux**: 템플릿에 `realmd sssd adcli` 와 홈 폴더 자동 생성(Ubuntu: `libpam-mkhomedir` / `pam-auth-update`, RHEL 계열: `oddjob-mkhomedir`)을 넣어 둔다.
  엔진이 `realm join` 하고 짧은 이름(`alice`)으로 로그인하게 sssd 를 맞추고 `moavi-users` 만 허용한다.
  uid/gid 는 SSSD id 매핑(계정의 SID 에서 계산, 범위는 sssd.conf 에 고정)이라 모든 데스크톱에서 같고, 공유 저장소(NFS)의 폴더 소유자도 VM 마다 같다.
  가입한 데스크톱에서는 공유 저장소 확인의 LOCAL_ACCOUNT 경고가 사라진다(사용자가 VM 의 `/etc/passwd` 가 아니라 디렉터리에 있으므로).
- 가입 계정 `vlab-join` 의 비밀번호는 엔진이 만들어 DC 에 넣고 엔진 DB 에 봉인한다. 게스트에는 에이전트의 표준 입력으로만 간다.
  **내장 디렉터리 > 디렉터리 구조 · 가입 계정 > 비밀번호 새로 정하기** 로 언제든 바꾼다.

### 관리자 비밀번호
도메인 `Administrator` 비밀번호는 `.env` 의 `VLAB_DIRECTORY_ADMIN_PASSWORD` 이거나(넣었으면), 처음 만들 때 볼륨에 둔 값이다:
```bash
docker compose exec vlab-directory cat /var/lib/samba/private/vlab-admin-password
```
GPO · DNS 를 관리할 때는 Windows 관리 PC 를 도메인에 가입시키고 RSAT 로 접속한다. `OU=MOAVI` 안의 계정 · 그룹은 엔진이 맞추므로 손으로 바꾸지 않는다
(엔진이 만들지 않은 계정은 건드리지 않는다).

### 이중화 (HA 상대 서버에 두 번째 DC)
MOAVI Desk 서버 이중화를 쓰면 상대 서버에도 DC 를 두어 DC 가 하나 멈춰도 로그인 · 데스크톱 로그인이 된다. 두 DC 는 서로 복제하고,
각 서버의 엔진은 자기 쪽 DC 를 쓴다(엔진의 봉인된 계정과 가입 상태는 HA 동기화로 넘어간다).

1. 두 DC 가 서로의 실제 주소로 닿아야 한다(복제는 RPC 135 + 49152-49200 도 쓴다). **macvlan 으로 DC 마다 데스크톱 망 주소를 주는 방식**을 권한다:
   `docker compose -f docker-compose.yml -f docker-compose.directory-macvlan.yml up -d` (`.env`: `VLAB_DIRECTORY_PARENT`, `VLAB_DIRECTORY_SUBNET`,
   `VLAB_DIRECTORY_GATEWAY`, compose 2.24 이상). macvlan 주소는 호스트 자신에서는 닿지 않는다(엔진은 내부 망으로 닿는다).
2. 상대 서버의 `.env`: 같은 `VLAB_DIRECTORY_REALM` · `VLAB_DIRECTORY_DOMAIN`, 다른 `VLAB_DIRECTORY_HOSTNAME`(예: `dc2`) · `VLAB_DIRECTORY_IP`,
   `VLAB_DIRECTORY_ROLE=replica`, `VLAB_DIRECTORY_PRIMARY_IP=<첫 DC 주소>`, `VLAB_DIRECTORY_ADMIN_PASSWORD=<첫 DC 의 관리자 비밀번호>`.
   첫 시작에 `samba-tool domain join ... DC` 로 합류한다. 상대 서버의 엔진은 `vlab-svc` 비밀번호를 HA 동기화로 받는다.
3. 데스크톱 망 DHCP 에 DNS 를 두 DC 주소로 준다(또는 설정의 "DNS 서버" 에 둘 다).
4. 확인: `docker compose exec vlab-directory samba-tool drs showrepl` — 양쪽 모두 오류 없이 "Last attempt ... was successful".

**한계**: Samba 는 SYSVOL(GPO 파일)을 복제하지 않는다. GPO 를 쓰면 첫 DC 에서 만들고 `/var/lib/samba/sysvol` 을 상대 쪽으로 복사한다(rsync, 바꿀 때마다).
FSMO 역할은 첫 DC 에 있다. 첫 DC 가 오래 멈추면 `samba-tool fsmo seize` 로 넘긴다.

### 백업
`vlab-directory` 볼륨이 도메인 DB 다. `vlab-config` 와 함께 백업한다(엔진 쪽에는 봉인된 가입 계정만 있다).
```bash
docker compose exec vlab-directory samba-tool domain backup offline --targetdir=/var/lib/samba/backup
```

## 웹 IDE (JupyterLab · VS Code)
같은 443 의 `/ide/<세션>/` 경로로 나간다. 더 열 포트는 없고, **vlab-proxy(이 서버) → 데스크톱 · 빌드 VM 의 8890-8989/tcp** 만 열려 있으면 된다
(사용자 PC 에는 열지 않는다).

- 동작: 포털에서 IDE 를 열면 엔진이 게스트 에이전트로 사용자 계정의 `jupyter lab`(VS Code 는 `jupyter server` + jupyter-vscode-proxy 로
  127.0.0.1 의 code-server)을 띄운다. 토큰은 표준입력으로만 넘기고 명령 줄에 남기지 않는다. 엔진은 1분짜리 일회용 링크
  `/ide/<세션>/lab?moavi_ide=…` 를 주고, nginx 는 `/ide/` 의 모든 요청을 엔진 `/api/vlab/ide/auth` 에 먼저 묻는다(auth_request).
  링크 → 그 경로 전용 쿠키(HttpOnly · Secure, 12시간) → 엔진이 VM 주소와 IDE 토큰을 헤더로 답하고, nginx 가 토큰을 붙여 VM 으로 넘긴다.
  링크가 만료되거나 IDE 가 끝났으면 포털(`/?ide=expired`)로 돌아간다.
- 설정은 `deploy/nginx/vlab.conf` 에 들어 있다: `location /ide/`, `location = /_moavi_ide_auth`(internal), 그리고 `/api/` 의
  `proxy_set_header X-Moavi-Ide-Subrequest ""`(사용자가 이 헤더로 엔진 확인 경로를 직접 부르지 못하게). 다른 프록시를 앞에 두면
  `X-Moavi-Ide-Subrequest` 헤더를 밖에서 받지 않게 같은 처리를 한다.
- 템플릿(데스크톱 · 빌드 VM 이미지) 준비 — Linux:
  ```bash
  apt install -y qemu-guest-agent && systemctl enable --now qemu-guest-agent
  python3 -m venv /opt/jupyter && /opt/jupyter/bin/pip install 'jupyterlab>=4' jupyter-server-proxy jupyter-vscode-proxy
  ln -s /opt/jupyter/bin/jupyter /usr/local/bin/jupyter
  curl -fsSL https://code-server.dev/install.sh | sh          # VS Code 를 쓸 때
  ```
  사용자 계정이 VM 안에 있어야 한다(AD/LDAP + SSSD, 공유 저장소와 같은 조건). GPU 작업용으로 NVIDIA 드라이버 · CUDA,
  컨테이너를 쓰면 Docker + NVIDIA Container Toolkit(또는 Podman CDI · Apptainer), conda 는 `/opt/conda` 나 각자의 `~/miniconda3`.
- 풀에서 켜기: 데스크톱 풀 > 풀 > 정책 > 접속 > **웹 IDE**(JupyterLab / VS Code, 유휴 시간). 빌드 팜 풀은 가속 자원 > GPU 작업 › 작업 큐 >
  풀별 GPU 작업 설정에서 VM 당 GPU 장 수 · 종류 · 최대 실행 시간 · 컨테이너 런타임을 정한다.

## 빌드 팜: 결과물 보관 · CI 연동
- **결과물 보관 폴더**: 공유 저장소 루트에 `artifacts` 를 scratch 와 같이 만든다 (`mkdir artifacts && chmod 1777 artifacts`). 엔진이 작업 사용자
  권한으로 `artifacts/<사용자>/<작업 ID>` 를 만들고, 보관 기간이 지난 작업 폴더는 그 사용자의 다음 수집 때 지운다. 큰 결과물(10 MB 넘는 비트스트림 등)을
  콘솔에서 받으려면 엔진 컨테이너에 NAS 관리용 마운트(공유 저장소 설정의 admin_path)가 있어야 한다.
- **CI 연동**: 가속 자원 > 빌드 팜 › CI 연동에서 연결을 만들고 토큰을 CI 비밀 변수 `MOAVI_CI_TOKEN` 에 넣는다. CI 러너 → MOAVI Desk 443 만 열리면 된다.
  호출에는 `X-Requested-With: XMLHttpRequest` 헤더가 꼭 있어야 한다(CSRF 검사). 실행 사용자는 그 빌드 팜 풀의 이용 권한이 있어야 하고, 팀 공용 계정을
  쓰면 편하다. 토큰이 새면 [새 토큰] 또는 [끄기].

## 인증서 바꾸기
정식 인증서(`tls.crt` — 중간 인증서까지 이어 붙인 것, `tls.key`)를 볼륨에 넣고 프록시를 다시 시작한다.

```bash
docker compose cp tls.crt vlab-proxy:/etc/vlab/tls/tls.crt
docker compose cp tls.key vlab-proxy:/etc/vlab/tls/tls.key
docker compose restart vlab-proxy
```

## 업데이트
```bash
cd ~/vlab/makus-vlab && git pull
cd ~/vlab/makus-vlab-console && git pull
cd deploy && docker compose up -d --build
```
설정·DB 는 `vlab-config` 볼륨에 남는다.

## 백업
`vlab-config` 볼륨이 전부다 (DB 와 그 암호화 키가 같이 있어야 복원된다). 내장 디렉터리를 켰으면 `vlab-directory` 볼륨도 (위 "내장 디렉터리 > 백업").

```bash
docker run --rm -v vlab_vlab-config:/data -v "$PWD":/backup alpine \
  tar czf /backup/vlab-config-$(date +%F).tgz -C /data .
```

## 문제 확인
| 증상 | 확인 |
|---|---|
| 로그인 후 저장할 때 `CSRF validation failed` | 프록시가 Host 를 바꾸고 있다. 앞에 다른 프록시(L4/L7)를 두면 원래 Host 를 그대로 넘겨야 한다 |
| 콘솔 화면이 "연결이 끊어졌습니다" | VM 이 켜져 있는지, 엔진 → 노드 8006 이 열려 있는지. `docker compose logs vlab-engine` |
| SPICE 파일이 열리지 않음 | virt-viewer 설치, 사용자 PC → 노드 3128 |
| 브라우저 RDP 가 502 | Guacamole 이 안 떠 있다: `.env` 에 `VLAB_GUACAMOLE=0` 이 있는지, `docker compose logs vlab-guac-key guacamole` (`VLAB_GUAC_KEY` 형식이 틀리면 키 단계에서 멈춘다) |
| 브라우저 RDP 링크가 로그인 화면/거부 | 엔진과 guacamole 의 키가 다르다(키를 바꾼 뒤 둘 다 다시 만들지 않음 — 위 "키 바꾸기"), 또는 서버 시계가 틀리다(링크 5분 유효) |
| Guacamole 화면 뒤 "연결 오류" | guacd → 데스크톱 3389, 데스크톱의 RDP 허용·NLA 설정. `docker compose logs guacd` |
| 웹 IDE 가 포털로 돌아옴(`?ide=expired`) | 링크는 1분 · 한 번만. 포털에서 다시 "열기". IDE 가 유휴 시간으로 꺼졌으면 다시 시작 |
| 웹 IDE 가 502 | vlab-proxy → VM 8890-8989/tcp 가 막혀 있거나 IDE 가 아직 뜨는 중. 가속 자원 > GPU 작업 › 웹 IDE 의 상태 · 오류, VM 의 `~/.moavi/ide-<세션>.log` |
| 웹 IDE "설치돼 있지 않음" | 템플릿에 jupyter(VS Code 는 code-server 도)가 없음 — 위 "템플릿 준비" |
| 내장 디렉터리 컨테이너가 계속 재시작 | `docker compose logs vlab-directory` — `VLAB_DIRECTORY_IP` 가 비었거나, 이름 형식(NetBIOS 15자) 이 틀림. 53 번을 이미 쓰는 서비스(dnsmasq 등)가 그 주소에 있는지 |
| 포털 로그인은 되는데 데스크톱 로그인이 안 됨 | 데스크톱이 도메인에 가입했는지(풀 > 도메인 가입), Windows 는 가입 뒤 재시작했는지, 데스크톱의 DNS 가 DC 인지 |
| 도메인 가입이 NO_DNS | 데스크톱이 DC 를 DNS 로 쓰지 않음 — DHCP 의 DNS 를 DC 로, 또는 내장 디렉터리 설정의 "가입할 때 DNS 를 DC 로" |
| 클러스터 연결 실패 | 엔진 컨테이너에서 노드 8006 접속, 사용자/비밀번호, 인증서 확인 옵션 |

```bash
docker compose logs -f vlab-engine
docker compose logs -f vlab-proxy
```

## 라이선스
엔진은 PegaProx(AGPL-3.0) 기반이다. 엔진 수정본 소스는 https://github.com/dskim1979/makus-vlab 에 공개한다. 콘솔에 고지("Powered by PegaProx")를 유지한다.
