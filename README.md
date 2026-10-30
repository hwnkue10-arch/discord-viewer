<p align="center">
  <img src="assets/bot_icon.jpg" width="96" height="96" style="border-radius: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.35);" alt="Doc Viewer Icon" />
</p>

<h1 align="center">Doc Viewer (Discord In-App Multi-Format Viewer)</h1>

<p align="center">
  <strong>채팅방에 올라온 문서를 다운로드 없이 디스코드 내부 팝업(Activity)으로 즉시 열람하는 100% 무서버 뷰어</strong><br>
  <code>HTML</code> • <code>PDF</code> • <code>Markdown (.md)</code> • <code>PowerPoint (.pptx)</code>
</p>

<p align="center">
  <a href="https://discord.com/oauth2/authorize?client_id=1564602208753029191&scope=bot%20applications.commands"><img src="https://img.shields.io/badge/Discord-Doc_Viewer_추가하기-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord Bot"></a>
  <a href="https://workers.cloudflare.com/"><img src="https://img.shields.io/badge/Cloudflare_Workers-100%25_Serverless-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Workers"></a>
  <img src="https://img.shields.io/badge/Server_Cost-유지비_0원-22c55e?style=for-the-badge" alt="Cost 0">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License MIT">
</p>

---

## 🔗 공식 봇 초대 및 설치 링크 (Invite & Install)

<p align="center">
  <img src="assets/bot_banner.jpg" width="560" style="max-width: 100%; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); margin: 8px 0 16px;" alt="Doc Viewer Banner" />
</p>

아래 링크를 통해 봇을 원하는 서버에 초대하거나, **내 계정에 추가(User Install)**하여 어디서든 사용할 수 있습니다:

👉 **[Doc Viewer 공식 추가하기 (클릭)](https://discord.com/oauth2/authorize?client_id=1564602208753029191&scope=bot%20applications.commands)**

* **⭐ 내 계정에 추가 (User Install - 강력 추천):** 봇이 서버에 없어도 모든 서버, 개인 DM, 단체방에서 마우스 우클릭으로 즉시 사용 가능
* **🏢 서버에 추가 (Guild Install):** 관리자 권한이 있는 서버에 봇을 추가하여 모든 멤버가 함께 사용

---

## 📑 지원 파일 포맷 및 전용 렌더러 엔진

| 포맷 | 대표 확장자 | 클라이언트 렌더러 엔진 | 주요 지원 기능 |
| :---: | :---: | :--- | :--- |
| **HTML** | `.html`, `.htm` | **Zero-Eval Native Engine** | CSP 완전 무결 이벤트 컴파일, CSS 재귀 프록시, Cloudflare Error 1102 원천 차단 |
| **PDF** | `.pdf` | **Mozilla PDF.js v3 + Heading Miner** | **도킹형 목차 사이드바**, **소제목 계층 트리(Outline)**, **페이지별 헤드라인 자동 추출(Text Mining)**, **페이지 번호 직접 입력 점프 (`[ 1 ] / 14`)**, 반응형 Canvas, 너비 맞춤, 줌(40%~300%), 방향키 탐색 |
| **Markdown** | `.md`, `.markdown` | **Marked + Highlight + Mermaid** | **☀️/🌙 원클릭 다크·라이트 모드 테마 전환**, GitHub 테마, GFM 표, 코드 블록 문법 강조 및 원클릭 복사, Mermaid 다이어그램 실시간 시각화 |
| **PowerPoint** | `.pptx` | **OOXML Native Engine + JSZip** | 16:9 슬라이드 1:1 벡터 렌더링(Container Query), **도킹형 슬라이드 카드 목차**, **슬라이드 제목 자동 추출**, **슬라이드 번호 직접 입력 점프 (`[ 1 ] / 14`)**, 선형 그라디언트(GradFill)·알약 배지·도형 완벽 복원, 전체화면 |

> 💡 **전 포맷 공통 퀵 컨트롤 바:** 액티비티 상단에 새로고침, 닫기, **채널 내 최근 50개 업로드 문서 원클릭 전환 드롭다운**이 기본 탑재되어 있습니다.

---

## 🛠️ 기술 스택 (Tech Stack)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Discord Client Ecosystem                        │
│   (Desktop App / Web / Mobile App - Activity Embedded Webview)         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
       ┌────────────────────────────┴────────────────────────────┐
       ▼                                                         ▼
[Interactions Webhook]                                  [Activity Session]
Ed25519 SubtleCrypto                                    Durable Objects + KV
Slash (/view) & Context Menu                            0ms Real-Time Sync
       │                                                         │
       └────────────────────────────┬────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    Cloudflare Workers Edge Platform                    │
│                                                                        │
│  ┌───────────────────────┐ ┌──────────────────────┐ ┌───────────────┐  │
│  │ HTML Stream Engine    │ │ Document Dispatcher  │ │ Security      │  │
│  │ • HTMLRewriter        │ │ • Mozilla PDF.js     │ │ • SSRF Guard  │  │
│  │ • Zero-Eval Compiler  │ │ • Marked + Mermaid   │ │ • 15MB Stream │  │
│  │ • CSS Recursive Proxy │ │ • PptxViewJS (ZIP)   │ │ • MIME Allow  │  │
│  └───────────────────────┘ └──────────────────────┘ └───────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### 1. Cloud & Serverless Infrastructure
* **Cloudflare Workers (V8 Isolates):** 상시 켜두는 서버 없이 전 세계 300개 이상의 글로벌 에지 데이터센터에서 24시간 무중단 가동 (비용 0원).
* **Cloudflare Durable Objects (`SessionStore`) + Workers KV (`SESSIONS`):** 글로벌 강결합(Strong Consistency) 인메모리·SQLite 상태 동기화를 통해 리전 간 에지 캐시 지연(쿨타임)을 **0ms**로 제거하고, 여러 실행 카드를 연속 클릭하거나 다인 참여자가 동시 열람할 때 즉시 최신 문서로 전환.
* **Streaming HTMLRewriter:** 메모리 버퍼링 없이 스트리밍 방식으로 외부 CDN 에셋과 인라인 스타일을 재귀 변환하여 Cloudflare CPU 50ms 제한(Error 1102) 원천 차단.

### 2. Security & Cryptography
* **Ed25519 Request Verification (`SubtleCrypto`):** 디스코드 인터랙션 웹훅 요청의 위변조를 Web Crypto API 기반 하드웨어 가속 서명 검증.
* **CSP Zero-Eval Engine:** 디스코드 액티비티의 엄격한 CSP 정책(`unsafe-eval`, `unsafe-inline` 차단)을 통과하기 위해 인라인 이벤트를 순수 `addEventListener` 코드로 자동 컴파일.
* **SSRF Guard & Payload Limit:** 로컬호스트, 사설망 IP, 클라우드 메타데이터 주소 접근 원천 차단(403) 및 15MB 스트리밍 제한(413).

### 3. Client-Side Rendering Engines (Zero Server Overhead)
* **Mozilla PDF.js & Smart Heading Miner:** 브라우저 Canvas 기반 고해상도(DPR 반영) 렌더링. 파일 내장 목차(Outline)의 대제목·소제목 계층 트리 표현뿐만 아니라, 목차가 없는 일반 문서도 `getTextContent()` 기반으로 각 페이지의 핵심 헤드라인을 실시간 자동 추출하여 도킹형 사이드바에 표기.
* **Marked.js & Highlight.js:** GitHub Dark 스타일 마크다운 파싱 및 프로그래밍 언어별 문법 강조.
* **Mermaid.js:** 마크다운 내 플로우차트, 시퀀스, 클래스 다이어그램 실시간 SVG 시각화.
* **OOXML Native Engine & JSZip:** 클라이언트 사이드에서 `.pptx` 압축 해제 후 슬라이드 XML과 미디어를 파싱하여 CSS Container Queries 기반 1:1 슬라이드 벡터 DOM 렌더링. 선형 그라디언트(GradFill) 정밀 복원, 슬라이드별 제목 자동 추출 및 카드형 슬라이드 내비게이터 제공.
* **Smart Docked Navigation:** 문서를 가리지 않고 메인 화면을 오른쪽으로 밀어내는 좌측 분할 사이드바, 원하는 페이지로 즉시 이동하는 `[ 1 ] / 14` 직접 번호 입력 점프 및 방향키 충돌 방지 가드 탑재.

### 4. Discord Bridge & Hybrid Development
* **Built-in Discord RPC Bridge:** 외부 SDK 번들 없이 순수 postMessage RPC(`Opcode 0` 핸드셰이크 & `Opcode 1` `OPEN_EXTERNAL_LINK`) 내장.
* **Discord.js v14 & Express (Local Mode):** 로컬 컴퓨터에서도 독립 구동 및 테스트할 수 있는 하이브리드 아키텍처 제공.

---

## 📖 봇 사용 방법 (Commands & Usage)

### 1️⃣ 마우스 우클릭으로 실행 (가장 추천 ⭐)
1. 채팅방에 업로드된 문서 파일(`HTML`, `PDF`, `MD`, `PPTX`) 메시지를 **마우스 우클릭**
2. **앱(Apps)** → **`파일 바로보기`** 클릭
3. 나에게만 보이는 비공개(Ephemeral) 메시지에서 **`[⚡ 디스코드 내부 팝업으로 즉시 실행]`** 또는 **`[🌐 인터넷 새 창으로 열기]`** 클릭!

### 2️⃣ 통합 슬래시 명령어: `/view` (채팅방 최근 문서 자동 감지)
* 채팅창에 `/view` 를 입력하고 엔터를 누르면, 현재 채널의 최근 메시지에서 지원 문서(`.html`, `.pdf`, `.md`, `.pptx`)를 자동으로 찾아 실행 카드를 띄워줍니다.
* 최근 업로드된 파일이 여러 개라면 드롭다운 메뉴로 원하는 파일을 즉시 변경할 수 있습니다.

### 3️⃣ 특정 메시지 지정: `/view message: [메시지 링크]`
* 과거에 올라왔던 특정 파일 메시지를 열고 싶을 때:
  1. 원하는 메시지 우측 `...` (더보기) → **[메시지 링크 복사]** 클릭
  2. `/view message: [복사한 링크 붙여넣기]` 입력 후 엔터

---

## 📁 프로젝트 구조

```text
discord-viewer/
├── assets/                   # 공식 봇 디자인 자산 (아이콘 및 배너)
│   ├── bot_icon.jpg          # 1:1 앱 아바타 아이콘
│   └── bot_banner.jpg        # 16:9 와이드 프로필 배너
├── public/
│   └── activity_shell.html   # 액티비티 쉘 & 로컬 렌더러
├── src/
│   ├── templates/            # 포맷별 독립 뷰어 렌더링 엔진 모듈
│   │   ├── pdf.js            #  - PDF 뷰어 (Mozilla PDF.js + 목차/헤드라인 추출)
│   │   ├── markdown.js       #  - Markdown 뷰어 (Marked + Highlight + Mermaid)
│   │   ├── pptx.js           #  - PPTX 뷰어 (PptxViewJS + JSZip OOXML 엔진)
│   │   ├── utils.js          #  - 포맷 감지 및 이스케이프 공통 유틸리티
│   │   └── index.js          #  - 템플릿 통합 Export 허브
│   ├── worker.js             # [서버리스 모드] Cloudflare Workers 메인 엔드포인트
│   │                         #  - Ed25519 웹훅 서명 검증 및 /view 인터랙션 라우팅
│   │                         #  - HTMLRewriter 에셋 프록시 및 멀티 포맷 에지 렌더러
│   ├── server.js             # [로컬 모드] Express 웹 서버 (실시간 렌더링 & 에셋 프록시)
│   ├── bot.js                # [로컬 모드] discord.js 봇 (/view 슬래시 커맨드, 우클릭 메뉴)
│   └── index.js              # [로컬 모드] 로컬 웹 서버(server.js)와 봇(bot.js) 동시 구동
├── scripts/
│   └── register_commands.js  # 디스코드 API 전역 슬래시 명령어 동기화 스크립트 (npm run register)
├── .env.example              # 로컬 개발 환경용 환경변수 템플릿
├── wrangler.toml.example     # Cloudflare Workers 배포 환경 설정 템플릿
├── .gitignore                # Git 추적 제외 설정 (.env, wrangler.toml 등)
├── TERMS.md                  # 공식 서비스 이용약관 (Terms of Service)
├── PRIVACY.md                # 공식 개인정보 처리방침 (Privacy Policy)
├── package.json              # 패키지 의존성 및 실행 스크립트 정의
└── README.md                 # 프로젝트 문서 및 사용 가이드
```

---

## 🛠️ 자체 설치 및 배포 가이드 (Step-by-Step Setup)

누구나 10분 안에 자신의 디스코드 계정과 Cloudflare에 100% 무료 무서버 뷰어를 구축할 수 있는 단계별 가이드입니다.

### 1단계: 사전 준비 (Prerequisites)
1. **[Node.js](https://nodejs.org/) 설치:** v18 이상 최신 LTS 버전
2. **[Discord 계정](https://discord.com/):** [Discord Developer Portal](https://discord.com/developers/applications)에 로그인할 수 있는 계정
3. **[Cloudflare 계정](https://dash.cloudflare.com/):** 무료 플랜 (가입 시 신용카드 등록 불필요)

---

### 2단계: 디스코드 개발자 포털 설정

1. [Discord Developer Portal](https://discord.com/developers/applications) 접속 후 우측 상단 **`New Application`** 클릭 → 이름 입력(예: `Doc Viewer`)
2. **`General Information` 탭:**
   * **`Application ID`** 복사 ➜ (`DISCORD_CLIENT_ID`로 사용)
   * **`Public Key`** 복사 ➜ (`DISCORD_PUBLIC_KEY`로 사용)
3. **`Bot` 탭:**
   * **`Reset Token`** 클릭하여 생성된 **Bot Token** 복사 ➜ (`DISCORD_BOT_TOKEN`으로 사용)
   * **`Public Bot`** 스위치: **ON**
   * **`Privileged Gateway Intents`** 항목: **`Message Content Intent`** 스위치를 **ON**으로 활성화
4. **`Installation` 탭 (어디서나 우클릭 실행 지원):**
   * **Installation Contexts:** **`User Install`**과 **`Guild Install`**을 **둘 다 체크**
   * **Install Link:** **`Discord Provided Link`** 선택
   * **Default Install Settings:**
     * Scopes: **`applications.commands`**, **`bot`** 선택
     * Permissions: `Send Messages`, `Read Message History`, `Attach Files` 체크 (또는 Administrator)
5. **`Activities` 탭 (인앱 팝업 뷰어 활성화):**
   * **`Enable Activities`** 스위치를 **ON**으로 활성화

---

### 3단계: 프로젝트 다운로드 및 공통 환경 설정

컴퓨터의 터미널(PowerShell 또는 bash)을 열고 순서대로 입력합니다:

```bash
# 1) 저장소 복제(Clone) 및 프로젝트 폴더 이동
git clone https://github.com/hwnkue10-arch/discord-viewer.git
cd discord-viewer

# 2) 의존성 패키지 설치
npm install

# 3) 환경변수 템플릿 복사 (.env 생성)
# Windows (PowerShell / CMD):
copy .env.example .env
# macOS / Linux:
cp .env.example .env
```

생성된 `.env` 파일을 메모장이나 VS Code로 열고, **2단계에서 복사한 값들을 입력하고 저장**합니다:
```env
DISCORD_BOT_TOKEN=여기에_봇_토큰_붙여넣기
DISCORD_CLIENT_ID=여기에_애플리케이션_ID_붙여넣기
DISCORD_PUBLIC_KEY=여기에_퍼블릭_키_붙여넣기
PORT=3000
```

환경변수 저장이 끝났다면, 디스코드 본사 서버에 명령어들을 한 번 등록합니다:
```bash
# 4) 전역 슬래시 명령어(/view, /도움말) 및 우클릭 메뉴 등록
npm run register
```
> 터미널에 `🎉 디스코드 전역 명령어 등록 성공!`이 출력되면 명령어 등록이 완료된 것입니다.

---

## 🚀 실행 및 배포 모드 선택 (택 1)

상시 24시간 가동되는 **클라우드 무료 배포(모드 1)** 또는 내 컴퓨터에서 코드를 수정하는 **로컬 개발 실행(모드 2)** 중 하나를 선택합니다:

### [모드 1] Cloudflare Workers 서버리스 배포 (운영 환경 ⭐ 추천)
서버를 24시간 켜둘 필요 없이 전 세계 300여 개 글로벌 엣지 데이터센터에서 100% 무료(유지비 0원)로 가동됩니다.

```bash
# 1) Cloudflare 로그인 (최초 1회, 브라우저가 열리면 '승인' 클릭)
npx wrangler login

# 2) wrangler.toml 환경 설정 파일 생성
# Windows:
copy wrangler.toml.example wrangler.toml
# macOS / Linux:
cp wrangler.toml.example wrangler.toml

# 3) wrangler.toml 파일을 열고 2단계에서 복사한 키 값들을 입력합니다:
# [vars]
# DISCORD_CLIENT_ID = "여기에_애플리케이션_ID"
# DISCORD_PUBLIC_KEY = "여기에_퍼블릭_키"
# DISCORD_BOT_TOKEN = "여기에_봇_토큰"

# 4) Cloudflare Workers 실서버 배포 실행
npm run deploy
```

배포 완료 시 터미널 맨 끝에 고유한 워커 URL이 출력됩니다:
```text
Deployed discord-viewer triggers
  https://discord-viewer.your-subdomain.workers.dev
```

**마지막 연동 2단계 (디스코드 개발자 포털):**
1. **`General Information` 탭:**
   * **`Interactions Endpoint URL`** 칸에 터미널에 출력된 워커 주소(예: `https://discord-viewer.your-subdomain.workers.dev`)를 붙여넣고 우측 하단 초록색 **`Save Changes`** 클릭  
   *(Cloudflare Worker가 자동으로 Ed25519 서명 핸드셰이크를 통과하여 정상 저장됩니다)*
2. **`Activities` 탭:**
   * **`URL Mappings`** 항목의 타깃 URL에 동일한 워커 주소를 등록하고 `Save Changes` 클릭
3. **봇 초대하기:**
   * `Installation` 탭의 **`Install Link`** 복사 버튼을 눌러 브라우저에서 열고, 내 서버나 내 계정에 봇을 추가하면 즉시 사용 가능합니다!

---

### [모드 2] 로컬 개발 환경 실행 (Node.js 디버깅 모드)
Cloudflare 배포 없이 개발자 PC 환경에서 Express 웹 서버와 `discord.js` 봇을 직접 구동하여 코드를 수정하고 실시간 디버깅할 때 사용합니다. (3단계 공통 환경 설정 완료 후 바로 진행)

#### 1. 로컬 서버 및 봇 동시 실행
```bash
npm run dev
```
* 코드 변경 시 자동으로 재시작되는 Node.js `--watch` 파일 감지 모드로 구동됩니다.
* 로컬 Express 웹 서버(포트 3000)와 discord.js 게이트웨이 봇이 동시에 켜지며, 채팅방 이벤트에 실시간 응답합니다.

#### 2. (선택) 로컬에서 인앱 액티비티(팝업 뷰어)까지 테스트할 때
디스코드 액티비티는 보안상 외부 HTTPS 주소만 허용하므로, 로컬 3000번 포트를 외부로 임시 터널링합니다:
```bash
# Cloudflare Tunnel 실행 (설치 불필요 npx 구동)
npx cloudflared tunnel --url http://localhost:3000
```
* 출력된 임시 HTTPS 주소(예: `https://xxxx.trycloudflare.com`)를 `.env`의 `PUBLIC_ACTIVITY_URL`에 입력하고, 개발자 포털 Activities의 URL Mappings에 등록하면 로컬 PC에서도 인앱 팝업 뷰어가 완벽히 구동됩니다.

---

## 📄 약관 및 라이선스 (Legal & License)

* **이용약관 (Terms of Service):** [TERMS.md](TERMS.md) (`https://discord-viewer.hwnkue10.workers.dev/terms`)
* **개인정보 처리방침 (Privacy Policy):** [PRIVACY.md](PRIVACY.md) (`https://discord-viewer.hwnkue10.workers.dev/privacy`)
* **라이선스:** This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
