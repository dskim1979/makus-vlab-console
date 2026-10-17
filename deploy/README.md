# vLAB 설치 (docker compose)

Linux 서버 한 대에 `docker compose up` 한 번으로 설치한다. 시험용·파일럿용 기준이며, 이중화와 오프라인 설치 묶음은 다음 단계.

| 컨테이너 | 하는 일 | 원본 |
|---|---|---|
| `vlab-proxy` | 콘솔 화면, HTTPS(443), `/api` 를 엔진으로 전달 (VNC 웹소켓 포함) | 이 저장소 |
| `vlab-engine` | vLAB 엔진 (화면 없이 API 만, `WEB_UI=0`) | `makus-vlab` |
| `warpgate`, `warpgate-setup` | 접근 게이트웨이(bastion) — 데스크톱 RDP/SSH/VNC를 한 곳으로 중계, 웹 RDP/SSH·1회용 티켓·세션 녹화·비밀번호 비저장 (켜기: `VLAB_WARPGATE=1`) | 공식 이미지 |

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
docker compose ps                                  # vlab-proxy·vlab-engine (+ VLAB_WARPGATE=1 이면 warpgate) running
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

## 브라우저 RDP · SSH
번들 Guacamole 는 이 제거 커밋에서 걷어냈다. 브라우저 RDP·브라우저 SSH 는 Warpgate 가 맡는다(아래).
Warpgate 를 켜지 않으면 브라우저 RDP 가 없다 — 이 커밋은 Warpgate 웹 RDP 를 실클러스터에서 검증하고
`web_rdp_provider=warpgate` 로 바꾼 **뒤에만** 적용한다. 되돌리기: 이 커밋을 `git revert`.

## Warpgate 접근 게이트웨이(bastion)
모든 데스크톱 RDP/SSH/VNC 를 Warpgate(Apache-2.0) 한 곳으로 중계한다. 대상 IP 가 사용자에게 숨고,
세션이 녹화되며, 접속할 때 **사용자·데스크톱 비밀번호를 저장·전달하지 않는다**(그 사용자+그 대상에만
쓸 수 있는 1회용·단시간 티켓). 번들 Guacamole 를 걷어낸 뒤에는 브라우저 RDP/SSH 도 Warpgate 가 맡으므로 `VLAB_WARPGATE=1` 이 필요하다.

1. `.env` 에 다음을 넣고 `docker compose up -d`:
   ```
   VLAB_WARPGATE=1
   VLAB_WARPGATE_ADMIN_PASSWORD=<Warpgate 관리자 UI 로그인 비밀번호>
   # VLAB_WARPGATE_HOST=warpgate.lab.example   # 비우면 VLAB_HOSTNAME 을 쓴다
   ```
   `warpgate-setup` 가 첫 기동 때 `warpgate-data` 볼륨에 설정을 만든다(HTTP 8888, SSH 2222,
   RDP 3389, VNC 5900, 세션 녹화 켜짐; 이미 있으면 건너뜀). 열리는 포트: 8888(관리자 UI·브라우저
   RDP/SSH·관리자 API), 2222/3389/5900(native SSH/RDP/VNC).
2. **연결은 자동**: 엔진이 첫 기동 때 위 비밀번호로 Warpgate 에 로그인해 API 토큰을 만들고, 코어 DB 키로
   봉인해 저장한다(base URL `https://<VLAB_WARPGATE_HOST>:8888`, 포트는 `.env` 값).
   콘솔 > 플랫폼 설정 > **보안 게이트웨이**에서 '연결됨'만 확인한다. 이미 설정이 있으면 건드리지 않는다.
   RDP 를 3389 가 아닌 포트로 게시했다면 `VLAB_WARPGATE_RDP_PORT` 도 `.env` 에 넣는다.
3. **수동 연결(자동이 실패했을 때)**: Warpgate UI(`https://<호스트>:8888/@warpgate`)에 admin 으로 로그인 →
   Profile > API tokens 에서 토큰을 만들어 콘솔 > 플랫폼 설정 > **보안 게이트웨이**에 넣고 **연결 테스트** 후 저장.
4. **직접 접속 차단**: `proxmox-firewall/` 의 `moavi-relay` 에 Warpgate 주소를 넣어 데스크톱의
   RDP/SSH/VNC 를 Warpgate 에서만 받게 한다.
5. **Warpgate 로그인을 MOAVI Desk 로그인으로**: `.env` 에 `VLAB_WARPGATE_OIDC_SECRET=<openssl rand -hex 32 값>`.
   `warpgate-setup` 이 `warpgate.yaml` 에 `MOAVI Desk` 로그인(sso_providers `moavi-desk`)을 한 번 넣고, 엔진이
   그 로그인을 포털 세션으로 받아 준다(비밀번호 없음). 포털의 보안 게이트웨이 링크 → Warpgate 로그인 화면에서
   **MOAVI Desk** 한 번 → 데스크톱. Warpgate 세션이 남아 있는 동안은 바로 열린다. 이미 설치된 곳은
   `docker compose up -d && docker compose restart warpgate`. 다른 sso_providers 가 이미 있으면 setup 은 손대지 않으니
   엔진 `docs/warpgate-gateway.md` 4-6 의 항목을 직접 넣는다.

인증은 비밀번호를 저장하지 않는다: VNC 는 인증 없음, SSH 는 Warpgate 공개키, RDP 는 자동 로그인하지
않는 모드(`interactive_logon`; NLA 가 필요하면 콘솔의 Warpgate 설정에 **서비스 계정**만 넣는다 —
사용자 비밀번호가 아니다). 외부 OIDC/LDAP 로그인과 디렉터리 연동은 Warpgate `config.yaml` 에서 설정한다.

### 연구자 네이티브 SSH (자기 도구로 접속)
풀 정책에서 **"연구자 네이티브 SSH"** 를 켜면(브라우저 SSH와 별개), 연구자가 PuTTY·scp·WinSCP·
VS Code Remote-SSH 로 데스크톱에 평소처럼 붙되 Warpgate를 거친다(대상 IP 숨김, 세션 녹화).
- 포털 **내 자원 > SSH 키 · 접속** 에서 **공개키**를 등록한다(개인키는 올리지 않는다). MOAVI Desk
  클라이언트는 공개키를 자동으로 올리고, `~/.ssh/config` 의 관리 블록(BEGIN/END MOAVI)에 데스크톱별
  `Host moavi-<이름>` 항목을 써 준다. 그 뒤:
  - **VS Code Remote-SSH**: 호스트 목록에서 `moavi-<이름>` 선택.
  - **PuTTY/WinSCP**: 호스트에 Warpgate 주소·포트(기본 2222), 사용자 이름에 `moavi-내아이디:대상이름`(포털의
    "User" 값 복사), 인증은 개인키.
  - 터미널: `ssh moavi-<이름>`, 파일 전송 `scp 파일 moavi-<이름>:` (SFTP 정책·기록 적용).
  - Warpgate는 점프 호스트가 아니라 사용자 이름으로 대상을 고른다(ProxyJump 아님). 엄격한 풀은 셸/
    scp를 막고 브라우저 터미널만 허용하는 편이 안전하다(셸은 유출을 완전히 막지 못함).

**끄기**: `.env` 에서 `VLAB_WARPGATE=0` (또는 줄 삭제) 후 `docker compose up -d --remove-orphans`.
`warpgate-data` 볼륨(설정·세션 녹화)은 남는다.

### 전환(cutover) — 이 제거 커밋의 전제와 롤백
이 커밋은 **전환이 끝난 뒤의 상태**다. 적용 전에 다음이 모두 끝나 있어야 한다:
1. 실클러스터 검증(엔진 `docs/warpgate-gateway.md` 4-3): 브라우저 RDP·네이티브 RDP·네이티브 SSH·
   브라우저 SSH·VNC·세션 녹화 재생·직접 접속 차단·1회용 티켓·비밀번호 비저장·디렉터리 로그인.
2. 엔진의 `/ssh` 제거 커밋(별도)도 같이 적용한다. 엔진은 시작할 때 게이트웨이 카탈로그(Guacamole · RD 게이트웨이)를
   지운다 — 브라우저 RDP 는 보안 게이트웨이뿐이다.
- **롤백**: 이 커밋을 `git revert` 하고 `docker compose up -d` 하면 번들 Guacamole(guacd·guacamole·
  vlab-guac-key·`/guacamole/`)가 돌아온다. 엔진도 게이트웨이 카탈로그가 있던 커밋으로 되돌려야 한다.

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
