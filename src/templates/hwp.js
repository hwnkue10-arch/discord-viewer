const { escapeHtml, safeJsonForScript } = require('./utils');

// 4. 한글 문서 (HWP / HWPX) 초고화질 벡터 뷰어 (RHWP Rust + WebAssembly 고성능 벡터 렌더링 엔진)
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
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }

    /* 문서 워크스페이스 */
    #hwp-workspace {
      flex: 1;
      overflow-y: auto;
      overflow-x: auto;
      padding: 32px 16px 96px;
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

    /* A4 규격 시트 및 고품질 SVG 벡터 렌더링 */
    .hwp-page-sheet {
      position: relative;
      background: #ffffff;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), 0 2px 10px rgba(0, 0, 0, 0.25);
      border-radius: 2px;
      transition: width 0.18s ease-out;
      width: 820px;
      max-width: 100%;
      overflow: hidden;
      box-sizing: border-box;
    }
    .hwp-page-sheet svg {
      display: block;
      width: 100%;
      height: auto;
    }
    .hwp-page-num-badge {
      position: absolute;
      bottom: 12px;
      right: 16px;
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
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(8px);
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

    /* 에러 표시 박스 */
    #hwp-error-box {
      display: none;
      background: #1e293b;
      border: 1px solid #475569;
      border-radius: 10px;
      padding: 32px 24px;
      max-width: 460px;
      text-align: center;
      margin: 40px auto;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
    }
    .hwp-error-icon { font-size: 36px; margin-bottom: 12px; }
    .hwp-error-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; color: #f8fafc; }
    .hwp-error-msg {
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.6;
      margin-bottom: 20px;
      word-break: keep-all;
      white-space: pre-wrap;
    }
    .hwp-btn-download-primary {
      background: #0284c7;
      color: white;
      border: none;
      padding: 10px 18px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .hwp-btn-download-primary:hover { background: #0369a1; }
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

      <!-- 줌 및 맞춤 컨트롤 (퍼센트 누르면 100%, 단일 맞춤 토글 버튼으로 폭/쪽 교대 전환) -->
      <button class="hwp-btn" id="hwp-zoom-out" title="축소 (-)">➖</button>
      <button class="hwp-btn active" id="hwp-zoom-pct" title="현재 배율: 100% • 클릭 시 100% 원본으로 복귀">100%</button>
      <button class="hwp-btn" id="hwp-zoom-in" title="확대 (+)">➕</button>
      <button class="hwp-btn" id="hwp-fit-toggle" title="클릭 시 폭 맞춤 ↔ 쪽 맞춤 전환">⇲ 폭 맞춤</button>
    </div>
  </div>

  <!-- 메인 레이아웃 (사이드바 + 워크스페이스) -->
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
      <!-- 로딩 인디케이터 -->
      <div id="hwp-loading-overlay">
        <div class="hwp-spinner"></div>
        <div class="hwp-loading-title">한글 문서 렌더링 중</div>
        <div class="hwp-loading-desc" id="hwp-loading-desc">초기화 중...</div>
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
    import init, { HwpDocument } from 'https://cdn.jsdelivr.net/npm/@rhwp/core@0.8.7/rhwp.js';

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

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
    // 메인 로딩 파이프라인 (RHWP 고해상도 무손실 벡터 엔진)
    // -------------------------------------------------------------
    async function loadDocument() {
      try {
        updateStatus('⚡ 한글 벡터 렌더링 엔진 로드 중...');
        var wasmUrl = 'https://cdn.jsdelivr.net/npm/@rhwp/core@0.8.7/rhwp_bg.wasm';

        // 1. 고속 직렬 CDN 로드 시도 (1초 미만), 차단 환경 시 프록시 폴백
        try {
          await init({ module_or_path: wasmUrl });
        } catch (initErr) {
          console.warn('WASM 직렬 로드 실패, 프록시 경로로 폴백 시도:', initErr);
          await init({ module_or_path: toProxyUrlClient(wasmUrl) });
        }

        updateStatus('📥 문서 파일 다운로드 중...');
        var proxyUrl = toProxyUrlClient(targetUrl);
        var res = await fetch(proxyUrl);
        if (!res.ok) throw new Error('파일 다운로드 실패 (상태 코드: ' + res.status + ')');

        var arrayBuf = await res.arrayBuffer();
        var buffer = new Uint8Array(arrayBuf);

        updateStatus('📄 한글 문서 구조 분석 및 파싱 중...');
        var doc = new HwpDocument(buffer);
        totalPages = doc.pageCount();

        if (!totalPages || totalPages === 0) {
          throw new Error('문서에 표시할 수 있는 페이지가 없습니다.');
        }

        totalPagesEl.textContent = totalPages;
        updateNavUI();

        updateStatus('✨ 페이지 렌더링 준비 중 (총 ' + totalPages + '페이지)...');
        var frag = document.createDocumentFragment();
        var sidebarFrag = document.createDocumentFragment();

        for (var i = 0; i < totalPages; i++) {
          var pageIndex = i + 1;
          updateStatus('✨ 페이지 렌더링 중 (' + pageIndex + ' / ' + totalPages + ')...');

          // 메인 스레드 블로킹 해제 (스피너 및 텍스트 실시간 Repaint 보장)
          await new Promise(function(resolve) { setTimeout(resolve, 0); });

          var svgStr = doc.renderPageSvg(i);

          // 1. 페이지 시트 생성 (SVG 벡터 원본 렌더링)
          var sheet = document.createElement('div');
          sheet.className = 'hwp-page-sheet';
          sheet.id = 'hwp-page-' + pageIndex;
          sheet.setAttribute('data-page', pageIndex);
          sheet.innerHTML = svgStr + '<div class="hwp-page-num-badge">' + pageIndex + ' / ' + totalPages + '</div>';
          frag.appendChild(sheet);

          // 2. 목차 항목 텍스트 추출 (DOMParser 기반 안전 추출 - Regex 이스케이프 버그 원천 차단)
          var pageTitle = pageIndex + '페이지';
          try {
            var svgDoc = new DOMParser().parseFromString(svgStr, 'image/svg+xml');
            var textElements = svgDoc.querySelectorAll('text');
            for (var t = 0; t < textElements.length; t++) {
              var cleanTxt = (textElements[t].textContent || '').trim();
              if (cleanTxt.length >= 2 && !/^[\d\s.,\-:]+$/.test(cleanTxt) && cleanTxt.indexOf('/') === -1) {
                pageTitle = cleanTxt.slice(0, 24);
                break;
              }
            }
          } catch (tErr) {}

          // 3. 사이드바 아이템 DOM 생성 (안전한 textContent 바인딩으로 ReferenceError/XSS 100% 방지)
          var sidebarItem = document.createElement('div');
          sidebarItem.className = 'hwp-sidebar-item' + (pageIndex === 1 ? ' active' : '');
          sidebarItem.setAttribute('data-page', pageIndex);
          sidebarItem.setAttribute('title', pageIndex + '페이지: ' + pageTitle);

          var badgeSpan = document.createElement('span');
          badgeSpan.className = 'hwp-sidebar-badge';
          badgeSpan.textContent = pageIndex;

          var textSpan = document.createElement('span');
          textSpan.className = 'hwp-sidebar-text';
          textSpan.textContent = pageTitle;

          sidebarItem.appendChild(badgeSpan);
          sidebarItem.appendChild(textSpan);

          (function(pageTarget) {
            sidebarItem.addEventListener('click', function() {
              goToPage(pageTarget);
            });
          })(pageIndex);

          sidebarFrag.appendChild(sidebarItem);
        }

        pagesContainer.appendChild(frag);

        sidebarPagesList.innerHTML = '';
        sidebarPagesList.appendChild(sidebarFrag);

        // 스크롤 감시 등록
        document.querySelectorAll('.hwp-page-sheet').forEach(function(el) {
          observer.observe(el);
        });

        // 렌더링 완료 후 로딩창 닫기
        loadingOverlay.style.display = 'none';

        // 사용자 요청: 기본값은 정확히 100% 원본 크기!
        setZoom100();
      } catch (err) {
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
