# 🚀 Discord HTML/CSS In-App Activity Bot

외부 웹 호스팅이나 24시간 가동 서버 없이, **디스코드 CDN (`cdn.discordapp.com`)**과 **디스코드 액티비티(In-App Activity)** 및 **Cloudflare Workers**를 결합하여 채팅방에 업로드된 `.html` 파일을 디스코드 내부 팝업 및 브라우저에서 즉시 실행하는 100% 서버리스 프로젝트입니다.

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
* **🎨 외부 에셋 & 웹폰트 완전 인라인화 (CSP 차단 0%)**
  * 디스코드의 엄격한 보안 정책(CSP)으로 인해 차단되는 외부 CDN(Tailwind CSS, FontAwesome, Chart.js 등)을 워커가 실시간 다운로드 후 문서 내부에 자동 주입합니다.
  * 웹폰트(`.woff2`, `.woff`, `.ttf`)를 **Base64 Data URI**로 변환하여 임베딩하므로 폰트/아이콘 깨짐(`▯`)이 전혀 발생하지 않습니다.
* **☁️ 100% 무(無)서버 아키텍처 (Cloudflare Workers)**
  * 상시 켜두어야 하는 컴퓨터나 유료 서버가 전혀 필요 없습니다.
  * 전 세계 300개 이상의 글로벌 에지 데이터센터에서 365일 24시간 상시 가동됩니다 (유지비 0원).
* **🔒 채널 & 파일별 완벽한 프라이버시 격리 (Workers KV)**
  * Cloudflare KV(`SESSIONS`)를 통해 채널별 / 첨부파일 ID별로 세션을 엄격하게 분리하여, 다른 채널이나 다른 사용자의 HTML 파일이 서로 노출되지 않습니다.
* **🌐 인터넷 새 창 열기 지원**
  * 디스코드 팝업 외에도 `[🌐 인터넷 새 창으로 열기]` 버튼을 통해 PC/모바일 브라우저 전체화면으로도 즉시 실행할 수 있습니다.

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
discord-html-activity-bot/
├── src/
│   ├── worker.js             # Cloudflare Workers 서버리스 메인 엔드포인트
│   │                         # (Ed25519 서명 검증, Interactions 웹훅, 실시간 HTML/에셋 인라인화)
│   ├── bot.js                # 로컬 개발/명령어 등록 헬퍼
│   └── register_commands.js  # 디스코드 슬래시 명령어 등록 스크립트
├── wrangler.toml.example     # Cloudflare Workers 설정 템플릿
├── package.json              # 패키지 설정 및 명령어 스크립트
└── README.md                 # 프로젝트 문서
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
3. **명령어 등록:**
   ```bash
   node src/register_commands.js
   ```

이제 24시간 컴퓨터를 켜둘 필요 없이 언제 어디서나 디스코드에서 HTML 파일이 즉시 실행됩니다!
