# MAKUS vLAB 콘솔 (makus-vlab-console)

MAKUS vLAB 의 화면 — **사용자 포털**(`/`)과 **관리 콘솔**(`/admin`).
엔진: [makus-vlab](https://github.com/dskim1979/makus-vlab) · 설계서는 사내 문서(저장소 밖)이며, 코드 주석의 "docs/vlab-design.md n-n" 은 그 절 번호입니다.

- 엔진([makus-vlab](https://github.com/dskim1979/makus-vlab))과는 HTTP API 로만 통신하는 독립 프로그램이다.
  - 인증: 엔진 코어 `/api/auth/*` (세션 쿠키 `session_id`)
  - 그 밖: vLAB 모듈 `/api/vlab/*` 만 — 코어 API(`/api/clusters/...`)를 화면에서 직접 부르지 않는다.
- 관리 콘솔 구조는 pxvdi 와 같다: 홈 = 모듈 타일 → 모듈 = 좌측 메뉴 + 본문. 메뉴 정의는 `src/admin/modules.ts`.
- 화면 글자는 한국어·영어를 함께 둔다: `src/i18n/messages.ts` (키마다 `ko`·`en` 필수).
- 제품명·로고는 `src/brand.ts` 한 곳에서만 정한다.
- 로그인 화면과 모든 화면 하단, 정보 창에 **"Powered by PegaProx" 고지**를 둔다 (`src/components/EngineNotice.tsx`). AGPL-3.0 제7조(b) 저작자 표시라 지우거나 가리지 않는다.

## 실행

```bash
npm install
npm run dev:mock   # 엔진 없이 화면만 (모의 로그인: 아무 아이디, admin → 관리자, otp → 2단계 인증)
npm run dev        # 엔진에 연결 (VLAB_ENGINE_URL, 기본 https://localhost:5000)
npm run build      # dist/ — vlab-proxy(nginx)가 정적 파일로 제공
```

`npm run dev` 는 `/api`·`/ws` 를 엔진으로 넘긴다(vite.config.ts). 운영에서는 nginx 가 같은 역할을 한다.

**프록시는 Host 헤더를 바꾸면 안 된다.** 엔진의 CSRF 검사가 브라우저의 `Origin` 과 엔진이 받은 `Host` 를 비교하므로,
Vite 는 `changeOrigin: false`, nginx 는 `proxy_set_header Host $host;` 로 둔다. 바꾸면 쓰기 요청이 모두 `CSRF validation failed` 로 거부된다.

## 서버에 설치

[deploy/README.md](deploy/README.md) — docker compose 로 콘솔(nginx, HTTPS)과 엔진(API 전용)을 한 서버에 설치한다.

## 구조

| 경로 | 내용 |
|---|---|
| `src/brand.ts` | 제품명·회사·엔진 고지 정보 |
| `src/i18n/` | 한/영 문구, 언어 전환(브라우저 언어 기본, 선택은 localStorage) |
| `src/api/` | 엔진 API 호출(`client.ts`), 모의 엔진(`mock.ts`), 타입 |
| `src/auth/` | 세션 상태, 로그인 화면(비밀번호 → 필요 시 TOTP, OIDC 버튼, LDAP 안내) |
| `src/admin/` | 모듈·페이지 정의, 홈 타일, 모듈 화면(좌측 메뉴) |
| `src/portal/` | 내 데스크톱 카드, 내 자원(대여 중인 카드·보드) |
| `src/components/` | 상단 바, 화면 틀, 고지, 정보 창, 아이콘 |

## 아직 없는 것 (0단계 골격)
- 각 관리 페이지 본문 (메뉴에 구현 단계 표시)
- 접속 버튼 동작 (엔진 `/api/vlab/desktops/<id>/connect` 이후)
- 보안 키(WebAuthn) 로그인, 비밀번호 변경, 첫 설정 마법사

## 라이선스
`UNLICENSED` — 매커스 독자 라이선스 가능 여부를 법무 확인 중 (설계서 14장). 사용한 공개 라이브러리는 `NOTICE.md`.
