const { escapeHtml, safeJsonForScript } = require('./utils');

// 4. 한글 문서 (HWP / HWPX) 초고속 무경량 뷰어 (Pure JS 엔진 + A4 규격 레이아웃)
function renderHwpViewer(fileTitle, serverOrigin, targetUrl, discordClientId) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0">
  <title>${escapeHtml(fileTitle || '한글(HWP) 뷰어')} - Discord Viewer</title>
  <!-- 고품질 한글 웹폰트 (바탕, 명조, 고딕, 나눔 폰트 폴백 지원) -->
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@400;600;700&family=Nanum+Gothic:wght@400;700&family=Nanum+Myeongjo:wght@400;700&display=swap">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0f172a;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
      user-select: auto;
    }
    #hwp-toolbar {
      height: 48px;
      background: #111214;
      border-bottom: 1px solid #2b2d31;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 14px;
      padding-right: 360px;
      gap: 8px;
      flex-shrink: 0;
      z-index: 100;
      user-select: none;
      overflow-x: auto;
      scrollbar-width: none;
    }
    #hwp-toolbar::-webkit-scrollbar { display: none; }
    @media (max-width: 860px) {
      #hwp-toolbar { padding-right: 14px; }
    }
    .hwp-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow: hidden;
      font-size: 13px;
      font-weight: 600;
    }
    .hwp-badge {
      background: #0284c7;
      color: white;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }
    .hwp-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 200px;
    }
    .hwp-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      flex-shrink: 0;
    }
    .hwp-btn {
      background: #2b2d31;
      color: #f2f3f5;
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 5px 9px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .hwp-btn:hover { background: #35373c; border-color: rgba(255, 255, 255, 0.2); }
    .hwp-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .hwp-btn.active {
      color: #38bdf8;
      border-color: rgba(56, 189, 248, 0.45);
      background: rgba(56, 189, 248, 0.12);
    }
    .hwp-page-indicator {
      font-size: 12px;
      color: #94a3b8;
      min-width: 62px;
      text-align: center;
      font-weight: 500;
    }
    #hwp-zoom-pct {
      min-width: 58px;
      text-align: center;
      font-family: Consolas, monospace;
      font-weight: 700;
    }
    #hwp-fit-toggle {
      min-width: 84px;
      text-align: center;
      justify-content: center;
    }

    /* 메인 레이아웃 (사이드바 + 워크스페이스) */
    #hwp-main-container {
      flex: 1;
      display: flex;
      flex-direction: row;
      overflow: hidden;
      position: relative;
      width: 100%;
      height: calc(100vh - 48px);
    }

    /* 좌측 도킹 목차 사이드바 */
    .hwp-sidebar {
      width: 0px;
      min-width: 0px;
      background: #111214;
      border-right: 0px solid #2b2d31;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1), border-right-width 0.22s ease;
      height: 100%;
      z-index: 20;
    }
    .hwp-sidebar.open {
      width: 260px;
      min-width: 260px;
      border-right: 1px solid #2b2d31;
    }
    .hwp-sidebar-inner {
      width: 260px;
      min-width: 260px;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .hwp-sidebar-header {
      padding: 12px 14px;
      background: #18191c;
      border-bottom: 1px solid #2b2d31;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      font-weight: 700;
      color: #f2f3f5;
      user-select: none;
    }
    .hwp-sidebar-close-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 15px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }
    .hwp-sidebar-close-btn:hover {
      background: #2b2d31;
      color: #ffffff;
    }
    .hwp-sidebar-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .hwp-sidebar-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      background: #18191c;
      color: #cbd5e1;
      font-size: 12px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-left: 3px solid transparent;
      transition: all 0.15s ease;
      min-height: 38px;
      box-sizing: border-box;
      user-select: none;
    }
    .hwp-sidebar-item:hover {
      background: #232428;
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.12);
    }
    .hwp-sidebar-item.active {
      background: rgba(2, 132, 199, 0.15);
      border-color: rgba(2, 132, 199, 0.4);
      border-left: 3px solid #0284c7;
      color: #ffffff;
      font-weight: 600;
    }
    .hwp-sidebar-badge {
      background: #2b2d31;
      color: #94a3b8;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
      min-width: 28px;
      text-align: center;
      font-family: Consolas, monospace;
    }
    .hwp-sidebar-item.active .hwp-sidebar-badge {
      background: #0284c7;
      color: #ffffff;
    }
    .hwp-sidebar-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      font-size: 12px;
      line-height: 1.35;
    }

    /* 문서 워크스페이스 */
    #hwp-workspace {
      flex: 1;
      overflow-y: auto;
      overflow-x: auto;
      padding: 28px 16px 84px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      position: relative;
      scroll-behavior: smooth;
    }
    #hwp-pages {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      width: 100%;
    }

    /* A4 규격 용지 스타일 */
    .hwp-page-sheet {
      position: relative;
      background: #ffffff;
      color: #1e293b;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), 0 2px 10px rgba(0, 0, 0, 0.25);
      border-radius: 2px;
      transition: width 0.18s ease-out;
      width: 820px;
      min-height: 1120px;
      max-width: 100%;
      box-sizing: border-box;
      padding: 64px 72px 56px;
      font-family: 'Noto Serif KR', 'Nanum Myeongjo', 'Batang', serif;
      font-size: 14.5px;
      line-height: 1.8;
      word-break: keep-all;
      overflow-wrap: break-word;
    }
    .hwp-page-header {
      font-size: 12px;
      color: #64748b;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 8px;
      margin-bottom: 24px;
      font-family: 'Noto Sans KR', sans-serif;
    }
    .hwp-page-footer {
      font-size: 12px;
      color: #64748b;
      border-top: 1px solid #e2e8f0;
      padding-top: 8px;
      margin-top: 24px;
      font-family: 'Noto Sans KR', sans-serif;
    }
    .hwp-para {
      margin: 0 0 12px;
      white-space: pre-wrap;
    }
    .hwp-table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      background: #ffffff;
      font-family: 'Noto Sans KR', sans-serif;
    }
    .hwp-table td {
      border: 1px solid #94a3b8;
      padding: 7px 10px;
      vertical-align: middle;
      font-size: 13px;
      line-height: 1.5;
      color: #1e293b;
      word-break: keep-all;
    }
    .hwp-image {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 16px auto;
      border-radius: 4px;
    }
    .hwp-page-num-badge {
      position: absolute;
      bottom: 8px;
      right: 12px;
      font-size: 11px;
      color: #64748b;
      background: rgba(255, 255, 255, 0.9);
      padding: 2px 8px;
      border-radius: 12px;
      border: 1px solid rgba(0, 0, 0, 0.08);
      pointer-events: none;
      font-weight: 600;
      user-select: none;
      font-family: 'Noto Sans KR', sans-serif;
    }

    /* 로딩 인디케이터 */
    #hwp-loading-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(6px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 50;
      padding: 20px;
    }
    .hwp-spinner {
      width: 44px;
      height: 44px;
      border: 4px solid rgba(2, 132, 199, 0.2);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: hwp-spin 0.8s linear infinite;
      margin-bottom: 16px;
    }
    @keyframes hwp-spin {
      to { transform: rotate(360deg); }
    }
    .hwp-loading-title {
      font-size: 16px;
      font-weight: 700;
      color: #f8fafc;
      margin-bottom: 6px;
    }
    .hwp-loading-desc {
      font-size: 13px;
      color: #94a3b8;
    }

    /* 에러 카드 */
    #hwp-error-box {
      display: none;
      background: rgba(30, 41, 59, 0.95);
      border: 1px solid rgba(239, 68, 68, 0.35);
      border-radius: 12px;
      padding: 28px 24px;
      max-width: 440px;
      text-align: center;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5);
      margin-top: 60px;
    }
    .hwp-error-icon {
      font-size: 36px;
      margin-bottom: 12px;
    }
    .hwp-error-title {
      font-size: 16px;
      font-weight: 700;
      color: #fca5a5;
      margin-bottom: 8px;
    }
    .hwp-error-msg {
      font-size: 13px;
      color: #cbd5e1;
      line-height: 1.6;
      margin-bottom: 20px;
      word-break: keep-all;
      white-space: pre-wrap;
    }
    .hwp-btn-download-primary {
      background: #0284c7;
      color: #ffffff;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
      transition: background 0.15s, transform 0.1s;
    }
    .hwp-btn-download-primary:hover {
      background: #0369a1;
      transform: translateY(-1px);
    }
  </style>
</head>
<body>
  <!-- 상단 툴바 -->
  <div id="hwp-toolbar">
    <div class="hwp-meta">
      <button class="hwp-btn" id="hwp-sidebar-toggle" title="목차 열기/닫기">📑 목차</button>
      <span class="hwp-badge">HWP</span>
      <span class="hwp-title" title="${escapeHtml(fileTitle || '한글 문서')}">${escapeHtml(fileTitle || '한글 문서')}</span>
    </div>

    <div class="hwp-controls">
      <!-- 페이지 이동 -->
      <button class="hwp-btn" id="hwp-prev-page" title="이전 페이지 (PageUp / ←)" disabled>◀</button>
      <span class="hwp-page-indicator"><span id="hwp-current-page">1</span> / <span id="hwp-total-pages">-</span></span>
      <button class="hwp-btn" id="hwp-next-page" title="다음 페이지 (PageDown / →)" disabled>▶</button>

      <span style="color:#334155;margin:0 2px;">|</span>

      <!-- 줌 및 맞춤 컨트롤 (퍼센트 누르면 100% 복귀, 단일 맞춤 토글 버튼) -->
      <button class="hwp-btn" id="hwp-zoom-out" title="축소 (-)">➖</button>
      <button class="hwp-btn active" id="hwp-zoom-pct" title="클릭 시 100% 원본으로 복귀">100%</button>
      <button class="hwp-btn" id="hwp-zoom-in" title="확대 (+)">➕</button>
      <button class="hwp-btn" id="hwp-fit-toggle" title="클릭 시 폭 맞춤 ↔ 쪽 맞춤 전환">⇲ 폭 맞춤</button>
    </div>
  </div>

  <!-- 메인 컨테이너 (사이드바 + 워크스페이스) -->
  <div id="hwp-main-container">
    <!-- 좌측 도킹 목차 사이드바 -->
    <div id="hwp-sidebar" class="hwp-sidebar">
      <div class="hwp-sidebar-inner">
        <div class="hwp-sidebar-header">
          <span>📑 문서 목차 / 페이지</span>
          <button id="hwp-sidebar-close" class="hwp-sidebar-close-btn" title="목차 닫기">✕</button>
        </div>
        <div id="hwp-pages-list" class="hwp-sidebar-list">
          <div style="color:#94a3b8;text-align:center;padding:16px 0;font-size:12px;">목차를 불러오는 중...</div>
        </div>
      </div>
    </div>

    <!-- 문서 워크스페이스 -->
    <div id="hwp-workspace">
      <!-- 로딩 오버레이 -->
      <div id="hwp-loading-overlay">
        <div class="hwp-spinner"></div>
        <div class="hwp-loading-title">한글 문서 렌더링 중</div>
        <div class="hwp-loading-desc" id="hwp-loading-desc">문서를 준비하는 중...</div>
      </div>

      <!-- 에러 표시 박스 -->
      <div id="hwp-error-box">
        <div class="hwp-error-icon">⚠️</div>
        <div class="hwp-error-title">문서를 열 수 없습니다</div>
        <div class="hwp-error-msg" id="hwp-error-msg">암호화된 문서이거나 지원되지 않는 한글 서식일 수 있습니다. 원본 파일을 다운로드하여 한컴오피스에서 열람해 보세요.</div>
        <button class="hwp-btn-download-primary" id="hwp-fallback-download-btn">
          ⬇️ 원본 HWP 다운로드
        </button>
      </div>

      <!-- 렌더링된 A4 페이지 목록 -->
      <div id="hwp-pages"></div>
    </div>
  </div>

  <script type="module">
    var fileTitle = ${safeJsonForScript(fileTitle)};
    var targetUrl = ${safeJsonForScript(targetUrl)};
    var serverOrigin = ${safeJsonForScript(serverOrigin)};

    // 상태 관리 (기본값: 100%)
    var currentZoom = 100;
    var baseWidth = 820; // 100% 기본 A4 너비 (px)
    var fitMode = null;   // null | 'width' | 'page'
    var totalPages = 0;
    var currentPage = 1;
    var isSidebarOpen = false;

    // DOM 요소
    var loadingOverlay = document.getElementById('hwp-loading-overlay');
    var loadingDesc = document.getElementById('hwp-loading-desc');
    var errorBox = document.getElementById('hwp-error-box');
    var errorMsg = document.getElementById('hwp-error-msg');
    var fallbackDlBtn = document.getElementById('hwp-fallback-download-btn');
    var pagesContainer = document.getElementById('hwp-pages');
    var workspace = document.getElementById('hwp-workspace');

    var sidebar = document.getElementById('hwp-sidebar');
    var sidebarToggleBtn = document.getElementById('hwp-sidebar-toggle');
    var sidebarCloseBtn = document.getElementById('hwp-sidebar-close');
    var sidebarPagesList = document.getElementById('hwp-pages-list');

    var prevBtn = document.getElementById('hwp-prev-page');
    var nextBtn = document.getElementById('hwp-next-page');
    var curPageEl = document.getElementById('hwp-current-page');
    var totalPagesEl = document.getElementById('hwp-total-pages');

    var zoomOutBtn = document.getElementById('hwp-zoom-out');
    var zoomPctBtn = document.getElementById('hwp-zoom-pct');
    var zoomInBtn = document.getElementById('hwp-zoom-in');
    var fitToggleBtn = document.getElementById('hwp-fit-toggle');

    function toProxyUrlClient(u) {
      if (!u) return '';
      if (u.indexOf('/api/proxy/') === 0) return u;
      try {
        var parsed = new URL(u, window.location.origin);
        if (parsed.origin === window.location.origin) return parsed.pathname + parsed.search;
        var proto = parsed.protocol.replace(':', '').toLowerCase();
        return '/api/proxy/' + proto + '/' + parsed.host + parsed.pathname + parsed.search;
      } catch (e) {
        return u;
      }
    }

    function updateStatus(text) {
      if (loadingDesc) loadingDesc.textContent = text;
    }

    function showError(msg) {
      if (loadingOverlay) loadingOverlay.style.display = 'none';
      if (pagesContainer) pagesContainer.style.display = 'none';
      if (errorBox) {
        errorBox.style.display = 'block';
        if (msg) errorMsg.textContent = msg;
      }
    }

    // 다운로드 트리거
    function triggerDownload() {
      var dlUrl = serverOrigin + '/api/download?url=' + encodeURIComponent(targetUrl) + '&name=' + encodeURIComponent(fileTitle || '문서.hwp');
      if (typeof window.__discordOpenExternal === 'function') {
        window.__discordOpenExternal(dlUrl);
      } else {
        window.open(dlUrl, '_blank');
      }
    }
    if (fallbackDlBtn) fallbackDlBtn.addEventListener('click', triggerDownload);

    // -------------------------------------------------------------
    // 맞춤 & 줌 (퍼센트 누르면 100%, 단일 맞춤 토글 버튼으로 폭/쪽 교대 전환)
    // -------------------------------------------------------------
    function updateZoomUI() {
      zoomPctBtn.textContent = currentZoom + '%';

      // 100% 원본 상태 표시
      if (currentZoom === 100 && !fitMode) {
        zoomPctBtn.classList.add('active');
        zoomPctBtn.title = '현재 100% 원본 크기';
      } else {
        zoomPctBtn.classList.remove('active');
        zoomPctBtn.title = '클릭 시 100% 원본 크기로 복귀';
      }

      // 단일 맞춤 토글 버튼 상태
      if (fitMode === 'width') {
        fitToggleBtn.classList.add('active');
        fitToggleBtn.textContent = '⛶ 쪽 맞춤';
        fitToggleBtn.title = '현재 폭 맞춤 적용 중 • 클릭 시 쪽(전체) 맞춤으로 전환';
      } else if (fitMode === 'page') {
        fitToggleBtn.classList.add('active');
        fitToggleBtn.textContent = '⇲ 폭 맞춤';
        fitToggleBtn.title = '현재 쪽 맞춤 적용 중 • 클릭 시 폭 맞춤으로 전환';
      } else {
        fitToggleBtn.classList.remove('active');
        fitToggleBtn.textContent = '⇲ 폭 맞춤';
        fitToggleBtn.title = '클릭 시 폭 맞춤 ↔ 쪽 맞춤 전환';
      }
    }

    function applySheetWidth(targetWidth) {
      var sheets = document.querySelectorAll('.hwp-page-sheet');
      sheets.forEach(function(sheet) {
        sheet.style.width = targetWidth + 'px';
        sheet.style.maxWidth = '100%';
      });
      updateZoomUI();
    }

    // 1. 100% 원본 맞춤 (퍼센트 버튼 클릭 시)
    function setZoom100() {
      fitMode = null;
      currentZoom = 100;
      applySheetWidth(baseWidth);
    }

    // 2. 폭 맞춤 (Fit Width)
    function fitToWidth() {
      fitMode = 'width';
      var availWidth = workspace.clientWidth - 48;
      if (availWidth < 280) availWidth = 280;
      currentZoom = Math.round((availWidth / baseWidth) * 100);
      applySheetWidth(availWidth);
    }

    // 3. 쪽 맞춤 (Fit Page / Height)
    function fitToPage() {
      fitMode = 'page';
      var availHeight = workspace.clientHeight - 64;
      if (availHeight < 280) availHeight = 280;
      var targetWidth = Math.round(availHeight / 1.414);
      var maxAvailWidth = workspace.clientWidth - 48;
      if (targetWidth > maxAvailWidth) targetWidth = maxAvailWidth;
      currentZoom = Math.round((targetWidth / baseWidth) * 100);
      applySheetWidth(targetWidth);
    }

    // 단일 버튼 토글: 폭 맞춤 ↔ 쪽 맞춤 번갈아가며 적용
    function toggleFit() {
      if (fitMode === 'width') {
        fitToPage();
      } else {
        fitToWidth();
      }
    }

    // 일반 확대/축소
    function zoomIn() {
      fitMode = null;
      if (currentZoom < 250) {
        currentZoom = Math.min(250, currentZoom + 15);
        applySheetWidth(Math.round(baseWidth * (currentZoom / 100)));
      }
    }

    function zoomOut() {
      fitMode = null;
      if (currentZoom > 40) {
        currentZoom = Math.max(40, currentZoom - 15);
        applySheetWidth(Math.round(baseWidth * (currentZoom / 100)));
      }
    }

    zoomPctBtn.addEventListener('click', setZoom100);
    fitToggleBtn.addEventListener('click', toggleFit);
    zoomInBtn.addEventListener('click', zoomIn);
    zoomOutBtn.addEventListener('click', zoomOut);

    // 창 크기 조절 시 맞춤 상태 유지
    window.addEventListener('resize', function() {
      if (fitMode === 'width') {
        fitToWidth();
      } else if (fitMode === 'page') {
        fitToPage();
      }
    });

    // -------------------------------------------------------------
    // 목차 (사이드바) 제어
    // -------------------------------------------------------------
    function toggleSidebar(forceState) {
      if (typeof forceState === 'boolean') {
        isSidebarOpen = forceState;
      } else {
        isSidebarOpen = !isSidebarOpen;
      }

      if (isSidebarOpen) {
        sidebar.classList.add('open');
        sidebarToggleBtn.classList.add('active');
        updateSidebarActive(currentPage, true);
      } else {
        sidebar.classList.remove('open');
        sidebarToggleBtn.classList.remove('active');
      }

      setTimeout(function() {
        if (fitMode === 'width') fitToWidth();
        else if (fitMode === 'page') fitToPage();
      }, 240);
    }

    sidebarToggleBtn.addEventListener('click', function() { toggleSidebar(); });
    sidebarCloseBtn.addEventListener('click', function() { toggleSidebar(false); });

    function updateSidebarActive(pageIndex, scrollSidebar) {
      var items = sidebarPagesList.querySelectorAll('.hwp-sidebar-item');
      items.forEach(function(item) {
        var pNum = parseInt(item.getAttribute('data-page'), 10);
        if (pNum === pageIndex) {
          item.classList.add('active');
          if (scrollSidebar) {
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        } else {
          item.classList.remove('active');
        }
      });
    }

    // -------------------------------------------------------------
    // 페이지 점프 & 스크롤 추적
    // -------------------------------------------------------------
    function goToPage(num) {
      if (num < 1 || num > totalPages) return;
      var pageEl = document.getElementById('hwp-page-' + num);
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        currentPage = num;
        updateNavUI();
        updateSidebarActive(currentPage, true);
      }
    }

    function updateNavUI() {
      curPageEl.textContent = currentPage;
      prevBtn.disabled = (currentPage <= 1);
      nextBtn.disabled = (currentPage >= totalPages);
    }

    prevBtn.addEventListener('click', function() { goToPage(currentPage - 1); });
    nextBtn.addEventListener('click', function() { goToPage(currentPage + 1); });

    // 스크롤 시 현재 보고 있는 페이지 감지 (IntersectionObserver)
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var pNum = parseInt(entry.target.getAttribute('data-page'), 10);
          if (pNum && pNum !== currentPage) {
            currentPage = pNum;
            updateNavUI();
            updateSidebarActive(currentPage, false);
          }
        }
      });
    }, { root: workspace, threshold: 0.35 });

    // 단축키
    window.addEventListener('keydown', function(e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToPage(currentPage - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goToPage(currentPage + 1);
      } else if (e.key === '+' || e.key === '=') {
        zoomIn();
      } else if (e.key === '-') {
        zoomOut();
      } else if (e.key === '0') {
        setZoom100();
      } else if (e.key === 'w' || e.key === 'W' || e.key === 'p' || e.key === 'P') {
        toggleFit();
      }
    });

    // -------------------------------------------------------------
    // 메인 로딩 파이프라인 (초경량 Pure-JS 엔진)
    // -------------------------------------------------------------
    async function loadDocument() {
      // 무한 로딩 원천 차단 타이머 (10초 타임아웃)
      var watchdogTimer = setTimeout(function() {
        showError('문서 로딩 대기 시간이 초과되었습니다. 원본 파일을 다운로드해 주세요.');
      }, 10000);

      try {
        updateStatus('⚡ 한글 문서 디코더 준비 중...');
        var parseHangulDocument = null;

        // 경량(150KB) 순수 자바스크립트 파서 로드 (WASM 12MB 다운로드 및 무한 로딩 원천 제거)
        try {
          var mod = await import('https://cdn.jsdelivr.net/npm/@file-viewer/renderer-hangul@3.3.3/dist/hangul.parser.js');
          parseHangulDocument = mod.parseHangulDocument;
        } catch (cdnErr) {
          console.warn('jsdelivr 실패, unpkg 폴백 시도:', cdnErr);
          var mod2 = await import('https://unpkg.com/@file-viewer/renderer-hangul@3.3.3/dist/hangul.parser.js');
          parseHangulDocument = mod2.parseHangulDocument;
        }

        if (!parseHangulDocument) {
          throw new Error('한글 파서 모듈을 로드하지 못했습니다.');
        }

        updateStatus('📥 문서 파일 다운로드 중...');
        var proxyUrl = toProxyUrlClient(targetUrl);
        var res = await fetch(proxyUrl);
        if (!res.ok) throw new Error('파일 다운로드 실패 (상태 코드: ' + res.status + ')');

        var arrayBuf = await res.arrayBuffer();

        updateStatus('📄 문서 본문 및 표 분석 중...');
        var doc = await parseHangulDocument(arrayBuf, 'hwp');

        if (!doc || !doc.sections || doc.sections.length === 0) {
          throw new Error('문서에서 본문 섹션을 찾을 수 없습니다.');
        }

        // 미디어(이미지) 맵 구성
        var mediaMap = new Map();
        if (doc.media && doc.media.length > 0) {
          doc.media.forEach(function(m) {
            try {
              var blob = new Blob([m.bytes], { type: m.mimeType || 'image/png' });
              var blobUrl = URL.createObjectURL(blob);
              mediaMap.set(m.id.toLowerCase(), blobUrl);
              var filename = m.id.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
              mediaMap.set(filename, blobUrl);
            } catch (bErr) {}
          });
        }

        // 섹션 내용을 A4 페이지 단위로 정규화
        var PAGES = [];
        doc.sections.forEach(function(sec) {
          var paras = sec.paragraphs || [];
          var tables = sec.tables || [];

          if (sec.html) {
            PAGES.push({
              html: sec.html,
              headers: sec.headers,
              footers: sec.footers,
              tables: tables,
              placedMedia: sec.placedMedia
            });
          } else if (paras.length <= 16 && tables.length <= 1) {
            PAGES.push({
              paras: paras,
              tables: tables,
              headers: sec.headers,
              footers: sec.footers,
              placedMedia: sec.placedMedia
            });
          } else {
            // 장문 섹션은 A4 15문단 단위로 분할하여 깔끔한 페이지네이션 제공
            var chunkSize = 15;
            for (var p = 0; p < paras.length; p += chunkSize) {
              PAGES.push({
                paras: paras.slice(p, p + chunkSize),
                tables: (p === 0 ? tables : []),
                headers: (p === 0 ? sec.headers : []),
                footers: (p + chunkSize >= paras.length ? sec.footers : []),
                placedMedia: (p === 0 ? sec.placedMedia : [])
              });
            }
          }
        });

        if (PAGES.length === 0) {
          PAGES.push({ paras: ['(본문 내용이 없는 빈 문서입니다)'], tables: [] });
        }

        totalPages = PAGES.length;
        totalPagesEl.textContent = totalPages;
        updateNavUI();

        var frag = document.createDocumentFragment();
        var sidebarFrag = document.createDocumentFragment();

        PAGES.forEach(function(pageData, idx) {
          var pNum = idx + 1;
          var sheet = document.createElement('article');
          sheet.className = 'hwp-page-sheet';
          sheet.id = 'hwp-page-' + pNum;
          sheet.setAttribute('data-page', pNum);

          // 1. 머리말
          if (pageData.headers && pageData.headers.length > 0) {
            var headerEl = document.createElement('div');
            headerEl.className = 'hwp-page-header';
            headerEl.textContent = pageData.headers.join(' | ');
            sheet.appendChild(headerEl);
          }

          // 2. 본문 텍스트 또는 HTML
          var headlineText = '';
          if (pageData.html) {
            var htmlContainer = document.createElement('div');
            htmlContainer.innerHTML = pageData.html;
            htmlContainer.querySelectorAll('script,iframe,object,embed,link,style').forEach(function(n) { n.remove(); });
            sheet.appendChild(htmlContainer);
            headlineText = htmlContainer.textContent.trim().slice(0, 24);
          } else if (pageData.paras) {
            pageData.paras.forEach(function(pText, pIdx) {
              if (pIdx === 0 && !headlineText) headlineText = pText.trim().slice(0, 24);
              var pEl = document.createElement('p');
              pEl.className = 'hwp-para';
              pEl.textContent = pText;
              sheet.appendChild(pEl);
            });
          }

          // 3. 표(Table) 렌더링
          if (pageData.tables && pageData.tables.length > 0) {
            pageData.tables.forEach(function(tblData) {
              var tbl = document.createElement('table');
              tbl.className = 'hwp-table';
              var rows = tblData.cells || (tblData.rows || []).map(function(r) { return r.map(function(c) { return { text: c }; }); });
              rows.forEach(function(row) {
                var tr = document.createElement('tr');
                row.forEach(function(cell) {
                  var td = document.createElement('td');
                  td.textContent = cell.text || '';
                  if (cell.colSpan && cell.colSpan > 1) td.colSpan = cell.colSpan;
                  if (cell.rowSpan && cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
                  tr.appendChild(td);
                });
                tbl.appendChild(tr);
              });
              sheet.appendChild(tbl);
            });
          }

          // 4. 인라인 이미지
          if (pageData.placedMedia && pageData.placedMedia.length > 0) {
            pageData.placedMedia.forEach(function(pm) {
              var imgUrl = mediaMap.get(pm.mediaId.toLowerCase());
              if (imgUrl) {
                var img = document.createElement('img');
                img.className = 'hwp-image';
                img.src = imgUrl;
                img.alt = pm.alt || '문서 이미지';
                sheet.appendChild(img);
              }
            });
          }

          // 5. 꼬리말
          if (pageData.footers && pageData.footers.length > 0) {
            var footerEl = document.createElement('div');
            footerEl.className = 'hwp-page-footer';
            footerEl.textContent = pageData.footers.join(' | ');
            sheet.appendChild(footerEl);
          }

          // 6. 페이지 번호 배지
          var badge = document.createElement('div');
          badge.className = 'hwp-page-num-badge';
          badge.textContent = pNum + ' / ' + totalPages;
          sheet.appendChild(badge);

          frag.appendChild(sheet);

          // 7. 사이드바 목차 항목
          var displayHeadline = headlineText && headlineText.length >= 2 ? headlineText : (pNum + '페이지');
          var sidebarItem = document.createElement('div');
          sidebarItem.className = 'hwp-sidebar-item' + (pNum === 1 ? ' active' : '');
          sidebarItem.setAttribute('data-page', pNum);
          sidebarItem.setAttribute('title', pNum + '페이지: ' + displayHeadline);
          sidebarItem.innerHTML = '<span class="hwp-sidebar-badge">' + pNum + '</span><span class="hwp-sidebar-text">' + escapeHtml(displayHeadline) + '</span>';

          (function(pageTarget) {
            sidebarItem.addEventListener('click', function() {
              goToPage(pageTarget);
            });
          })(pNum);

          sidebarFrag.appendChild(sidebarItem);
        });

        pagesContainer.appendChild(frag);

        sidebarPagesList.innerHTML = '';
        sidebarPagesList.appendChild(sidebarFrag);

        // 스크롤 감시 등록
        document.querySelectorAll('.hwp-page-sheet').forEach(function(el) {
          observer.observe(el);
        });

        // 정상 렌더링 완료 -> 로딩창 닫기 및 타이머 해제
        clearTimeout(watchdogTimer);
        loadingOverlay.style.display = 'none';

        // 사용자 요청: 기본값은 정확히 100% 원본 맞춤으로 설정!
        setZoom100();
      } catch (err) {
        clearTimeout(watchdogTimer);
        console.error('HWP 로딩 오류:', err);
        showError('문서를 렌더링하는 중 오류가 발생했습니다: ' + (err.message || '알 수 없는 형식'));
      }
    }

    loadDocument();
  </script>
</body>
</html>`;
}

module.exports = {
  renderHwpViewer
};
