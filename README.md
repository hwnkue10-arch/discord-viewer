# 🚀 Discord HTML/CSS In-App Activity Bot

외부 도메인이나 웹 호스팅 없이 **디스코드 CDN (`cdn.discordapp.com`)**과 **디스코드 액티비티(In-App Activity)**를 결합하여, 채팅방에 업로드된 단일 `.html` 파일을 디스코드 내부 팝업 및 브라우저에서 즉시 실행하는 인터랙티브 봇 프로젝트입니다.

---

## 🔗 공식 봇 초대 및 설치 링크 (Invite & Install)

아래 링크를 통해 봇을 원하는 서버에 초대하거나, **내 계정에 추가(User Install)**하여 어디서든 사용할 수 있습니다:

👉 **[HTML Runner 추가하기 (공식 링크)](https://discord.com/oauth2/authorize?client_id=1564602208753029191)**

* **내 계정에 추가 (User Install - 강력 추천 ⭐):** 봇이 서버에 없어도 모든 서버, 개인 DM, 단체방에서 마우스 우클릭으로 즉시 사용 가능
* **서버에 추가 (Guild Install):** 관리자 권한이 있는 서버에 봇을 추가하여 모든 멤버가 함께 사용

---

## ✨ 핵심 기능 및 특징

* **⚡ 디스코드 내부 즉시 실행 (Native In-App Activity)**
  * 복잡한 중첩 iframe 없이 디스코드 액티비티 창 자체에 1:1 직결 렌더링되어 **마우스 클릭, 카운터, 폼 입력, 애니메이션, JS 상호작용이 100% 네이티브**로 동작합니다.
* **🎨 외부 에셋 서버사이드 완전 인라인화 (CSP 차단 0%)**
  * 디스코드의 엄격한 보안 정책(CSP)으로 인해 차단되는 외부 CDN(Tailwind CSS, FontAwesome, Chart.js, Google Fonts 등)을 서버가 백그라운드에서 실시간 다운로드 후 문서 내부에 자동 주입합니다.
  * 상대 경로 웹폰트(`fa-solid-900.woff2` 등)를 서버 프록시(`/api/asset-proxy`)로 연결하여 아이콘 깨짐(`▯`)을 완벽하게 방지합니다.
* **🔄 최신 파일 캐시 우회 갱신 & 헬퍼 바**
  * 액티비티 화면 우측 상단에 세련된 반투명 플로팅 캡슐(`[● 파일명] [🔄 새로고침] [✕]`)이 탑재되어, 새 파일을 올렸을 때 창을 닫지 않고도 즉시 최신 파일로 갱신할 수 있습니다.
* **🔒 CDN 만료 링크 자동 복구**
  * 디스코드 첨부파일의 임시 URL이 만료되더라도, 사용자가 버튼을 클릭하는 순간 원본 메시지에서 만료되지 않은 새 CDN 링크를 실시간 재발급받아 무결점 실행을 보장합니다.

---

## 📖 봇 사용 방법 (Commands & Usage)

### 1️⃣ 기본 실행: `/html` (채팅방 최근 HTML 자동 감지)
* 채팅창에 `/html` 을 입력하고 **엔터**를 누르면, 현재 채널의 최근 메시지에서 `.html` 파일을 자동으로 찾아 실행 버튼을 나한테만 비공개(Ephemeral)로 띄워줍니다.
* 최근 업로드된 파일이 여러 개라면 드롭다운 메뉴로 다른 파일을 바로 선택할 수 있습니다.

### 2️⃣ 특정 메시지 지정: `/html message: [메시지 링크/ID]`
* 과거에 올라왔던 특정 HTML 메시지를 실행하고 싶을 때:
  1. 원하는 메시지 우측 `...` (더보기) → **[메시지 링크 복사]** 클릭
  2. `/html message: [복사한 링크 붙여넣기]` 입력 후 엔터

### 3️⃣ 메시지 우클릭 실행: [우클릭 → 앱 → HTML 파일 실행]
* 채팅방에서 `.html` 파일이 첨부된 메시지를 **마우스 우클릭** → **앱(Apps)** → **`HTML 파일 실행`** 클릭!

---

## 📁 프로젝트 폴더 구조

```text
discord-html-activity-bot/
├── .env.example              # 환경변수 템플릿 (토큰, 클라이언트 ID, 터널 주소)
├── .gitignore                # Git 제외 파일 목록 (node_modules, .env 등)
├── package.json              # 패키지 의존성 및 실행 스크립트
├── README.md                 # 프로젝트 문서 및 설치/배포 가이드
├── src/
│   ├── index.js              # 메인 진입점 (봇 + 액티비티 웹 서버 동시 구동)
│   ├── bot.js                # 디스코드 봇 (HTML 첨부파일 감지, 버튼 생성, 세션 관리)
│   └── server.js             # 액티비티 직결 렌더링 엔진, 에셋 프록시, 인라인 변환기
├── public/
│   └── activity_shell.html   # 브라우저 직접 열기용 보조 쉘
└── examples/
    ├── sample_test.html      # 카운터 및 반응형 인터랙티브 테스트용 샘플
    └── ai_convergence_job_portfolio_strategy_dashboard.html # Tailwind + FontAwesome + Chart.js 복합 대시보드 샘플
```

---

## ⚡ 빠른 시작 가이드 (Quick Start)

### 1. 패키지 설치 및 환경변수 설정

```bash
# 1) 의존성 패키지 설치
npm install

# 2) 환경변수 파일 생성
cp .env.example .env
```

`.env` 파일을 열고 디스코드 개발자 포털에서 발급받은 값을 입력합니다:

```env
DISCORD_BOT_TOKEN=발급받은_디스코드_봇_토큰
DISCORD_CLIENT_ID=디스코드_애플리케이션_ID
PORT=3000
PUBLIC_ACTIVITY_URL=https://xxxx.trycloudflare.com
```

### 2. 로컬 서버 및 터널 실행

새 터미널 창을 2개 열어 각각 실행합니다:

```bash
# 터미널 1: 봇 및 웹 서버 실행
npm start
```

```bash
# 터미널 2: 외부 디스코드 액티비티 연결용 무료 터널 실행
npx -y cloudflared tunnel --url http://localhost:3000
```

> **터널 주소 등록:** 터미널 2에 출력된 `https://<무작위>.trycloudflare.com` 주소를 `.env`의 `PUBLIC_ACTIVITY_URL`에 넣고, 디스코드 개발자 포털의 URL Mappings에 등록합니다.

---

## 🛠️ 디스코드 개발자 포털 설정 방법

1. **[Discord Developer Portal](https://discord.com/developers/applications) 접속** → `New Application` 생성
2. **봇 생성 및 권한 설정 (`Bot` 탭)**:
   * `Reset Token`을 눌러 토큰 복사 후 `.env`의 `DISCORD_BOT_TOKEN`에 입력
   * 아래로 스크롤하여 **`Message Content Intent`** 토글을 반드시 **켜짐(ON)**으로 활성화 후 `Save Changes` 클릭
3. **서버에 봇 초대 (`OAuth2` → `URL Generator`)**:
   * **Scopes**: `bot` 체크
   * **Bot Permissions**: `View Channels`, `Send Messages`, `Read Message History` 체크
   * 하단에 생성된 초대 링크를 브라우저에 붙여넣어 본인의 디스코드 서버에 봇 초대
4. **디스코드 내부 액티비티 연동 (`Activities` 탭)**:
   * **Activities Settings**에서 **Enable Activities** 활성화
   * **URL Mappings** 섹션에서:
     * **Prefix:** `/`
     * **Target:** 위 Cloudflare 터널 주소 입력 (예: `https://xxxx.trycloudflare.com`)

---

## 🚀 GitHub 업로드 및 백업 가이드

코드를 안전하게 GitHub 원격 저장소에 백업하고 버전 관리하는 방법입니다.

### 1. 로컬 Git 저장소 초기화 및 커밋

```bash
# Git 초기화
git init

# 브랜치 이름을 main으로 설정
git branch -M main

# 모든 파일 스테이징 (.env와 node_modules는 .gitignore에 의해 자동 제외됨)
git add .

# 첫 커밋 작성
git commit -m "feat: Discord HTML In-App Activity Bot 초기 완성"
```

### 2. GitHub에 새 리포지토리 생성 및 푸시

1. [GitHub (github.com/new)](https://github.com/new)에 접속합니다.
2. **Repository name**에 `discord-html-activity-bot`을 입력합니다.
3. 토큰 보호를 위해 **Private(비공개)**를 선택하는 것을 권장합니다.
4. `Create repository` 버튼을 클릭합니다.
5. 화면에 나타난 명령어를 터미널에 입력하여 푸시합니다:

```bash
# 원격 저장소 연결 (본인 깃허브 아이디/저장소명으로 교체)
git remote add origin https://github.com/<본인-GitHub-아이디>/discord-html-activity-bot.git

# 코드 업로드
git push -u origin main
```

---

## ☁️ 24시간 100% 서버리스 배포 (Cloudflare Workers)

이 프로젝트는 별도의 상시 구동 서버(PaaS) 없이 **Cloudflare Workers**와 **Workers KV**를 통해 100% 무(無)서버 글로벌 에지 네트워크에서 24시간 가동됩니다.

* **상시 가동 비용:** 0원 (Cloudflare Workers 무료 플랜)
* **내 컴퓨터 의존도:** 0% (컴퓨터, 터미널 창을 완전히 닫아도 전 세계 어디서든 365일 상시 작동)
* **세션 격리 아키텍처:** Cloudflare KV (`SESSIONS`)를 통해 채널별 / 첨부파일 ID별로 엄격하게 세션을 격리하여 타 사용자 간의 프라이버시 침해를 원천 차단합니다.

```bash
# Cloudflare Workers 배포 명령어
npx wrangler deploy
```
