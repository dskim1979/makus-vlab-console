# vLAB 설치 (docker compose)

Linux 서버 한 대에 `docker compose up` 한 번으로 설치한다. 시험용·파일럿용 기준이며, 이중화와 오프라인 설치 묶음은 다음 단계.

| 컨테이너 | 하는 일 | 원본 |
|---|---|---|
| `vlab-proxy` | 콘솔 화면, HTTPS(443), `/api` 를 엔진으로 전달 (VNC 웹소켓 포함) | 이 저장소 |
| `vlab-engine` | vLAB 엔진 (화면 없이 API 만, `WEB_UI=0`) | `makus-vlab` |
| `guacd`, `guacamole` | 브라우저 RDP — Apache Guacamole 1.6 + guacamole-auth-json, 같은 443 의 `/guacamole/` (끄기: `VLAB_GUACAMOLE=0`) | 공식 이미지 |
| `vlab-guac-key` | 시작할 때 한 번 돌고 끝남 — Guacamole 공유 키를 `vlab-guac` 볼륨에 둔다 | `alpine` |

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
2. 자동으로 로그인되어 **클러스터 > 클러스터 연결** 로 간다 → Proxmox 클러스터 연결 (노드 주소, `root@pam`, 비밀번호)
3. **사용자 > 도메인(AD/LDAP)** — 기관의 AD 를 쓰면 설정. 사용자가 데스크톱을 쓰려면 **기본 역할을 "사용자"** 로 (조회 전용은 포털을 못 쓴다)
4. **데스크톱 풀 > 풀 관리** — 풀 만들기 → 템플릿에서 만들기 (또는 VM 넣기) → 사용자 할당
5. 사용자는 같은 주소로 로그인해 **내 데스크톱** 에서 접속

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
- 풀에서 켜기: 데스크톱 풀 > 풀 > 정책 > 접속 > **웹 IDE**(JupyterLab / VS Code, 유휴 시간). 빌드 팜 풀은 가속 자원 > GPU 작업 큐 >
  풀별 GPU 작업 설정에서 VM 당 GPU 장 수 · 종류 · 최대 실행 시간 · 컨테이너 런타임을 정한다.

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
| 웹 IDE 가 포털로 돌아옴(`?ide=expired`) | 링크는 1분 · 한 번만. 포털에서 다시 "열기". IDE 가 유휴 시간으로 꺼졌으면 다시 시작 |
| 웹 IDE 가 502 | vlab-proxy → VM 8890-8989/tcp 가 막혀 있거나 IDE 가 아직 뜨는 중. 가속 자원 > 웹 IDE 세션의 상태 · 오류, VM 의 `~/.moavi/ide-<세션>.log` |
| 웹 IDE "설치돼 있지 않음" | 템플릿에 jupyter(VS Code 는 code-server 도)가 없음 — 위 "템플릿 준비" |
| 클러스터 연결 실패 | 엔진 컨테이너에서 노드 8006 접속, 사용자/비밀번호, 인증서 확인 옵션 |

```bash
docker compose logs -f vlab-engine
docker compose logs -f vlab-proxy
```

## 라이선스
엔진은 PegaProx(AGPL-3.0) 기반이다. 엔진 수정본 소스는 https://github.com/dskim1979/makus-vlab 에 공개한다. 콘솔에 고지("Powered by PegaProx")를 유지한다.
