# vLAB 설치 (docker compose)

Linux 서버 한 대에 `docker compose up` 한 번으로 설치한다. 시험용·파일럿용 기준이며, 이중화와 오프라인 설치 묶음은 다음 단계.

| 컨테이너 | 하는 일 | 원본 |
|---|---|---|
| `vlab-proxy` | 콘솔 화면, HTTPS(443), `/api` 를 엔진으로 전달 (VNC 웹소켓 포함) | 이 저장소 |
| `vlab-engine` | vLAB 엔진 (화면 없이 API 만, `WEB_UI=0`) | `makus-vlab` |
| `guacd`, `guacamole` | 브라우저 RDP — Apache Guacamole 1.6 + guacamole-auth-json, 같은 443 의 `/guacamole/` (끄기: `VLAB_GUACAMOLE=0`) | 공식 이미지 |
| `vlab-guac-key` | 시작할 때 한 번 돌고 끝남 — Guacamole 공유 키를 `vlab-guac` 볼륨에 둔다 | `alpine` |
| `warpgate`, `warpgate-setup` | 접근 게이트웨이(bastion) — 데스크톱 RDP/SSH/VNC를 한 곳으로 중계, 1회용 티켓·세션 녹화·비밀번호 비저장 (켜기: `VLAB_WARPGATE=1`, 기본 꺼짐) | 공식 이미지 |

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

## Warpgate 접근 게이트웨이(bastion) — 선택
모든 데스크톱 RDP/SSH/VNC 를 Warpgate(Apache-2.0) 한 곳으로 중계한다. 대상 IP 가 사용자에게 숨고,
세션이 녹화되며, 접속할 때 **사용자·데스크톱 비밀번호를 저장·전달하지 않는다**(그 사용자+그 대상에만
쓸 수 있는 1회용·단시간 티켓). Guacamole/MS RD 게이트웨이와 함께 켤 수 있다(전환식). 기본은 꺼짐.

1. `.env` 에 다음을 넣고 `docker compose up -d`:
   ```
   VLAB_WARPGATE=1
   VLAB_WARPGATE_ADMIN_PASSWORD=<Warpgate 관리자 UI 로그인 비밀번호>
   # VLAB_WARPGATE_HOST=warpgate.lab.example   # 비우면 VLAB_HOSTNAME 을 쓴다
   ```
   `warpgate-setup` 가 첫 기동 때 `warpgate-data` 볼륨에 설정을 만든다(HTTP 8888, SSH 2222,
   RDP 3389, VNC 5900, 세션 녹화 켜짐; 이미 있으면 건너뜀). 열리는 포트: 8888(관리자 UI·브라우저
   RDP/SSH·관리자 API), 2222/3389/5900(native SSH/RDP/VNC).
2. **관리자 API 토큰 만들기**: `https://<호스트>:8888` 의 Warpgate 관리자 UI 에 위 비밀번호로 로그인 →
   토큰을 발급한다(관리자 역할).
3. **콘솔에 연결**: MOAVI Desk 콘솔 > 플랫폼 설정 > **Warpgate** 에서 base URL(`https://<호스트>:8888`)과
   그 API 토큰을 넣고 **연결 테스트** 후 저장·사용함. 토큰은 코어 DB 키로 봉인되어 저장된다(읽히지 않음).
4. **직접 접속 차단**: `proxmox-firewall/` 의 `moavi-relay` 에 Warpgate 주소를 넣어 데스크톱의
   RDP/SSH/VNC 를 Warpgate 에서만 받게 한다.

인증은 비밀번호를 저장하지 않는다: VNC 는 인증 없음, SSH 는 Warpgate 공개키, RDP 는 자동 로그인하지
않는 모드(`interactive_logon`; NLA 가 필요하면 콘솔의 Warpgate 설정에 **서비스 계정**만 넣는다 —
사용자 비밀번호가 아니다). 외부 OIDC/LDAP 로그인과 디렉터리 연동은 Warpgate `config.yaml` 에서 설정한다.

**끄기**: `.env` 에서 `VLAB_WARPGATE=0` (또는 줄 삭제) 후 `docker compose up -d --remove-orphans`.
`warpgate-data` 볼륨(설정·세션 녹화)은 남는다.

## 데스크톱 직접 접속 차단 (Proxmox 보안 그룹)
사용자가 데스크톱 안에서 IP 를 알아내 원격 데스크톱·SSH 로 직접 붙는 길을 막아, 모든 접속이 MOAVI Desk
서버·게이트웨이를 거치게 한다(접속 기록·시간 제한·정책이 항상 적용). VM 밖(하이퍼바이저)에서 걸리므로
VM 안에서 root·관리자여도 끌 수 없다. 설정 예시와 점검법: [proxmox-firewall/README.md](proxmox-firewall/README.md).

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
`vlab-config` 볼륨이 전부다 (DB 와 그 암호화 키가 같이 있어야 복원된다).

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
| Warpgate 연결 테스트 실패 | base URL(`https://<호스트>:8888`)·API 토큰이 맞는지, `VLAB_WARPGATE=1` 로 떠 있는지. `docker compose logs warpgate warpgate-setup` (`VLAB_WARPGATE_ADMIN_PASSWORD` 가 없으면 setup 이 멈춘다) |
| Warpgate 연결 뒤 "연결 오류" | Warpgate → 데스크톱 3389/22/VNC 가 닿는지(같은 `vlab` 네트워크·방화벽 relay), RDP 는 데스크톱의 NLA 설정 확인 |
| 웹 IDE 가 포털로 돌아옴(`?ide=expired`) | 링크는 1분 · 한 번만. 포털에서 다시 "열기". IDE 가 유휴 시간으로 꺼졌으면 다시 시작 |
| 웹 IDE 가 502 | vlab-proxy → VM 8890-8989/tcp 가 막혀 있거나 IDE 가 아직 뜨는 중. 가속 자원 > GPU 작업 › 웹 IDE 의 상태 · 오류, VM 의 `~/.moavi/ide-<세션>.log` |
| 웹 IDE "설치돼 있지 않음" | 템플릿에 jupyter(VS Code 는 code-server 도)가 없음 — 위 "템플릿 준비" |
| 클러스터 연결 실패 | 엔진 컨테이너에서 노드 8006 접속, 사용자/비밀번호, 인증서 확인 옵션 |

```bash
docker compose logs -f vlab-engine
docker compose logs -f vlab-proxy
```

## 라이선스
엔진은 PegaProx(AGPL-3.0) 기반이다. 엔진 수정본 소스는 https://github.com/dskim1979/makus-vlab 에 공개한다. 콘솔에 고지("Powered by PegaProx")를 유지한다.
