# 🚀 Discord In-App Activity Viewer (HTML & Documents)

외부 웹 호스팅이나 24시간 가동 서버 없이, **디스코드 CDN (`cdn.discordapp.com`)**과 **디스코드 액티비티(In-App Activity)** 및 **Cloudflare Workers**를 결합하여 채팅방에 업로드된 `.html` 파일 및 문서들을 디스코드 내부 팝업 및 브라우저에서 즉시 실행하고 조회하는 100% 서버리스 프로젝트입니다.

---

## 🔗 공식 봇 초대 및 설치 링크 (Invite & Install)

아래 링크를 통해 봇을 원하는 서버에 초대하거나, **내 계정에 추가(User Install)**하여 어디서든 사용할 수 있습니다:

👉 **[HTML Runner 추가하기 (공식 링크)](https://discord.com/oauth2/authorize?client_id=1564602208753029191)**

* **내 계정에 추가 (User Install - 강력 추천 ⭐):** 봇이 서버에 없어도 모든 서버, 개인 DM, 단체방에서 마우스 우클릭으로 즉시 사용 가능
* **서버에 추가 (Guild Install):** 관리자 권한이 있는 서버에 봇을 추가하여 모든 멤버가 함께 사용

---

## ✨ 핵심 기능 및 특징

* **⚡ 디스코드 내부 즉시 실행 (Native In-App Activity)**
  * 복잡한 중첩 iframe 없이 디스코드 액티비티 창에 1:1 직결 렌더링되어 **마우스 클릭, 폼 입력, 탭 전환, 애니메이션, JS 상호작용이 100% 네이티브**로 동작합니다.
* **🛡️ CSP 완전 무결 인라인 이벤트 컴파일 (Zero-Eval Engine)**
  * 기존 HTML에 작성된 `onclick`, `oninput`, `onsubmit` 등 인라인 이벤트 속성을 `eval()`이나 `new Function()` 없이 순수 `addEventListener` 코드로 자동 컴파일하여, 디스코드의 엄격한 보안 정책(CSP `unsafe-eval`, `unsafe-inline`) 하에서도 모든 버튼과 폼이 완벽히 작동합니다.
* **🌐 경로 보존형 에셋 프록시 & CSS 재귀 변환 (Cloudflare Error 1102 원천 차단)**
  * Cloudflare의 스트리밍 `HTMLRewriter`를 활용하여 외부 CDN(Tailwind, FontAwesome, 외부 JS/CSS/이미지)을 실시간 경로 보존형 스트리밍 프록시(`/api/proxy/...`)로 변환합니다.
  * CSS 내부의 상대경로 `@import` 및 폰트/이미지 `url(...)`까지 재귀 추적 변환하여 아이콘 깨짐이나 스타일 유실을 방지합니다.
* **🔗 내장 Discord Activity RPC 브릿지 (Zero-Dependency)**
  * 외부 SDK CDN 로딩 실패나 의존성 없이, 순수 postMessage RPC(`Opcode 0` 핸드셰이크 & `Opcode 1` `OPEN_EXTERNAL_LINK`)를 내장하여 액티비티 내 외부 링크 클릭 시 디스코드 공식 외부 이동 모달을 안전하게 호출합니다.
* **🧩 런타임 가상화 심 (Runtime Shim)**
  * `window.fetch`, `XMLHttpRequest`를 자동으로 프록시 라우팅하여 런타임 동적 API 호출 차단을 방지합니다.
  * 샌드박스 iframe 환경에서 발생하는 `localStorage` 접근 차단(`SecurityError`)을 인메모리 스토리지로 투명하게 자동 폴백합니다.
* **🔒 엔터프라이즈급 보안 (SSRF 차단 & 스트림 보호)**
  * 로컬호스트, 사설망 IP, 클라우드 메타데이터 주소로의 프록시 접근을 원천 차단(403)합니다.
  * 실행 파일(`.exe`, `.sh`, `.bat` 등) 차단(415) 및 15MB 초과 스트림 차단(413)으로 서버리스 워커를 보호합니다.
* **☁️ 100% 무(無)서버 아키텍처 (Cloudflare Workers)**
  * 상시 켜두어야 하는 컴퓨터나 유료 서버가 전혀 필요 없습니다.
  * 전 세계 300개 이상의 글로벌 에지 데이터센터에서 365일 24시간 상시 가동됩니다 (유지비 0원).
* **🔒 채널 & 세션 실시간 격리 및 다인 참여 동기화 (Workers KV)**
  * Cloudflare KV(`SESSIONS`)와 실시간 타임스탬프(`updatedAt`)를 통해 채널별로 가장 최근에 선택된 파일을 정확히 추적하여 이전 파일이 열리는 캐시 꼬임을 원천 차단합니다.
  * 동일한 액티비티 방(`instance_id`)에 접속한 다른 참여자들에게도 실시간으로 최신 파일 화면이 동기화됩니다.
* **🌐 인터넷 새 창 열기 & 헬퍼 바 지원**
  * 디스코드 팝업 외에도 상단 플로팅 헬퍼 바의 `[🌐 새 창]` 버튼 및 메시지의 `[🌐 인터넷 새 창으로 열기]` 버튼을 통해 PC/모바일 브라우저 전체화면으로도 즉시 실행할 수 있습니다.

---

## 📖 봇 사용 방법 (Commands & Usage)

### 1️⃣ 마우스 우클릭으로 실행 (가장 추천 ⭐)
1. 채팅방에 업로드된 `.html` 파일 메시지를 **마우스 우클릭**
2. **앱(Apps)** → **`HTML 파일 실행`** 클릭
3. 나에게만 보이는 비공개 메시지에서 **`[⚡ 디스코드 내부 팝업으로 즉시 실행]`** 또는 **`[🌐 인터넷 새 창으로 열기]`** 클릭!

### 2️⃣ 명령어 실행: `/html` (채팅방 최근 HTML 자동 감지)
* 채팅창에 `/html` 을 입력하고 엔터를 누르면, 현재 채널의 최근 메시지에서 `.html` 파일을 자동으로 찾아 실행 버튼을 비공개(Ephemeral)로 띄워줍니다.
* 최근 업로드된 파일이 여러 개라면 드롭다운 메뉴로 원하는 파일을 즉시 선택할 수 있습니다.

### 3️⃣ 특정 메시지 지정: `/html message: [메시지 링크]`
* 과거에 올라왔던 특정 HTML 메시지를 실행하고 싶을 때:
  1. 원하는 메시지 우측 `...` (더보기) → **[메시지 링크 복사]** 클릭
  2. `/html message: [복사한 링크 붙여넣기]` 입력 후 엔터

---

## 📁 프로젝트 구조

```text
discord-viewer/
├── public/
│   └── activity_shell.html   # 액티비티 쉘 & 외부 브라우저 렌더러 (Iframe 메모리 잔상 자동 초기화)
├── src/
│   ├── worker.js             # [서버리스 모드] Cloudflare Workers 메인 엔드포인트
│   │                         #  - Ed25519 요청 서명 검증 및 Interactions 웹훅 수신
│   │                         #  - 스트리밍 HTMLRewriter 기반 에셋 프록시 및 Zero-Eval 이벤트 컴파일
│   │                         #  - Cloudflare KV(SESSIONS) 기반 채널/인스턴스 세션 관리
│   ├── server.js             # [로컬 모드] Express 웹 서버 (실시간 렌더링 & 에셋 프록시)
│   ├── bot.js                # [로컬 모드] discord.js 봇 (채팅방 자동 감지, /html 커맨드, 우클릭 메뉴)
│   └── index.js              # [로컬 모드] 로컬 웹 서버(server.js)와 봇(bot.js) 동시 구동 엔트리포인트
├── .env.example              # 로컬 구동용 환경변수 설정 템플릿
├── wrangler.toml.example     # Cloudflare Workers 배포 설정 템플릿
├── package.json              # 패키지 의존성 및 실행 스크립트 정의
└── README.md                 # 프로젝트 문서 및 사용 가이드
```

---

## 🛠️ 자체 배포 가이드 (Self-Hosting with Cloudflare Workers)

직접 본인의 디스코드 봇으로 서버리스 환경을 구축하고 배포하는 방법입니다.

### 1. 사전 준비
* [Node.js](https://nodejs.org/) (v18 이상 권장)
* [Cloudflare 계정](https://dash.cloudflare.com/) (무료 플랜)
* [Discord Developer Portal](https://discord.com/developers/applications) 애플리케이션

### 2. 디스코드 개발자 포털 설정
1. **애플리케이션 생성:** `New Application` 생성 후 **General Information**에서 `Application ID` 및 `Public Key` 확인
2. **봇 생성 (`Bot` 탭):**
   * `Reset Token`을 눌러 **Bot Token** 복사
   * `Public Bot` 스위치를 **ON**으로 활성화
3. **액티비티 설정 (`Activities` 탭):**
   * `Enable Activities` 활성화

### 3. 프로젝트 설정 및 배포

```bash
# 1) 의존성 설치
npm install

# 2) Cloudflare 로그인
npx wrangler login

# 3) 글로벌 세션용 KV 네임스페이스 생성
npx wrangler kv namespace create SESSIONS
```

생성된 KV ID와 디스코드 토큰 정보를 `wrangler.toml` 파일에 입력합니다:

```toml
name = "discord-html-activity-bot"
main = "src/worker.js"
compatibility_date = "2024-10-01"
compatibility_flags = ["nodejs_compat"]

[vars]
DISCORD_CLIENT_ID = "본인의_디스코드_클라이언트_ID"
DISCORD_PUBLIC_KEY = "본인의_디스코드_퍼블릭_키"
DISCORD_BOT_TOKEN = "본인의_디스코드_봇_토큰"

[[kv_namespaces]]
binding = "SESSIONS"
id = "위에서_발급받은_KV_네임스페이스_ID"
```

워커를 전 세계 Cloudflare 에지 서버에 배포합니다:

```bash
npx wrangler deploy
```

배포 완료 시 터미널에 출력되는 주소(예: `https://your-worker.workers.dev`)를 확인합니다.

### 4. 디스코드 개발자 포털 최종 연동
1. **General Information 탭:**
   * **Interactions Endpoint URL**에 배포된 워커 주소 입력 (예: `https://your-worker.workers.dev`) → `Save Changes` 클릭 (자동으로 Ed25519 서명 검증 수행)
2. **Activities 탭:**
   * **URL Mappings** 타깃 주소 또는 액티비티 URL에 동일한 워커 주소 등록
3. **디스코드 명령어 등록:**
   * 로컬에서 `.env` 파일에 봇 토큰과 클라이언트 ID를 설정한 후 로컬 봇을 1회 실행하면 `/html` 슬래시 명령어와 우클릭 컨텍스트 메뉴가 전역에 자동 등록됩니다:
   ```bash
   npm run dev
   ```

---

## 💻 로컬 개발 환경 실행 (Node.js 모드)

Cloudflare Workers 없이 내 컴퓨터에서 Express 서버와 디스코드 봇을 로컬로 구동하고 테스트할 수 있습니다.

1. `.env.example`을 복사하여 `.env` 파일을 생성하고 디스코드 정보를 입력합니다:
   ```env
   DISCORD_BOT_TOKEN=본인의_디스코드_봇_토큰
   DISCORD_CLIENT_ID=본인의_디스코드_클라이언트_ID
   DISCORD_PUBLIC_KEY=본인의_디스코드_퍼블릭_키
   PORT=3000
   ```
2. 로컬 서버 및 봇 구동:
   ```bash
   npm run dev
   ```
3. 액티비티 화면 로컬 미리보기: `http://localhost:3000/activity_shell.html?sample=true`

---

이제 24시간 컴퓨터를 켜둘 필요 없이 언제 어디서나 디스코드에서 HTML 파일이 즉시 실행됩니다!
