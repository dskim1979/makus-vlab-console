# vLAB 설치 (docker compose)

Linux 서버 한 대에 두 컨테이너로 설치한다. 시험용·파일럿용 기준이며, 이중화와 오프라인 설치 묶음은 다음 단계.

| 컨테이너 | 하는 일 | 원본 |
|---|---|---|
| `vlab-proxy` | 콘솔 화면, HTTPS(443), `/api` 를 엔진으로 전달 (VNC 웹소켓 포함) | 이 저장소 |
| `vlab-engine` | vLAB 엔진 (화면 없이 API 만, `WEB_UI=0`) | `makus-vlab` |
| `guacd`, `guacamole` | (선택) 브라우저 RDP — Apache Guacamole + guacamole-auth-json, `/guacamole/` | 공식 이미지, profile `guacamole` |

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
docker compose ps                                  # 둘 다 running / healthy
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

## 브라우저 RDP (Guacamole, 선택)
외부 데스크톱이나 RDP 풀을 사용자가 **브라우저만으로** 쓰게 하려면 Guacamole 을 함께 올린다.
같은 443 의 `/guacamole/` 경로로 나가므로 따로 열 포트는 없다. guacd 컨테이너 → 데스크톱 **3389** 만 열려 있으면 된다.

1. 키를 만든다 (16진수 32자, guacamole-auth-json 의 128비트 키)
   ```bash
   cd ~/vlab/makus-vlab-console/deploy
   echo "VLAB_GUAC_KEY=$(openssl rand -hex 16)" >> .env
   grep VLAB_GUAC_KEY .env          # 이 값을 2번에서 콘솔에 넣는다
   ```
2. 함께 올린다 (이후 `up`/업데이트 때도 `--profile guacamole` 을 붙인다)
   ```bash
   docker compose --profile guacamole up -d --build
   docker compose --profile guacamole ps
   ```
3. 콘솔 **게이트웨이** 에서 Guacamole 게이트웨이를 추가한다
   - 주소: 사용자가 콘솔에 접속하는 이름 그대로 (예: `vlab.lab.example`, 보통 `VLAB_HOSTNAME`)
   - 포트: **443** (`VLAB_HTTPS_PORT` 를 바꿨으면 그 값)
   - 공유 키: 1번의 `VLAB_GUAC_KEY` 값
   - 엔진은 `https://<주소>:<포트>/guacamole/?data=…` (5분짜리 서명 링크)를 만들어 준다 → 그대로 이 경로로 들어온다
4. 포털에서 외부 데스크톱의 **브라우저로 연결** 을 눌러 확인한다

키를 바꾸면 `.env` 와 콘솔 게이트웨이 두 곳을 같이 바꾸고 `docker compose --profile guacamole up -d` 로 guacamole 을 다시 만든다.
Guacamole 자체 로그인 화면(`/guacamole/`)은 쓰지 않는다 — 엔진이 서명한 링크로만 들어갈 수 있다.

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
| 브라우저 RDP 가 502 | Guacamole 이 안 떠 있다: `--profile guacamole` 로 올렸는지, `.env` 의 `VLAB_GUAC_KEY` 가 비어 있지 않은지. `docker compose logs guacamole` |
| 브라우저 RDP 링크가 로그인 화면/거부 | 콘솔 게이트웨이 키와 `VLAB_GUAC_KEY` 가 다르거나, 서버 시계가 틀리다(링크 5분 유효) |
| Guacamole 화면 뒤 "연결 오류" | guacd → 데스크톱 3389, 데스크톱의 RDP 허용·NLA 설정. `docker compose logs guacd` |
| 클러스터 연결 실패 | 엔진 컨테이너에서 노드 8006 접속, 사용자/비밀번호, 인증서 확인 옵션 |

```bash
docker compose logs -f vlab-engine
docker compose logs -f vlab-proxy
```

## 라이선스
엔진은 PegaProx(AGPL-3.0) 기반이다. 엔진 수정본 소스는 https://github.com/dskim1979/makus-vlab 에 공개한다. 콘솔에 고지("Powered by PegaProx")를 유지한다.
