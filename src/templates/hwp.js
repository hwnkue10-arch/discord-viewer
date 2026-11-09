const { escapeHtml, safeJsonForScript } = require('./utils');

// 4. 한글 문서 (HWP / HWPX) 뷰어 (RHWP Rust + WebAssembly 고성능 벡터 렌더링 엔진)
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
      gap: 10px;
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
      max-width: 220px;
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
      transition: background 0.15s, border-color 0.15s;
    }
    .hwp-btn:hover { background: #35373c; border-color: rgba(255, 255, 255, 0.2); }
    .hwp-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .hwp-page-indicator {
      font-size: 12px;
      color: #94a3b8;
      min-width: 68px;
      text-align: center;
      font-weight: 500;
    }
    .hwp-zoom-val {
      font-size: 11px;
      color: #cbd5e1;
      min-width: 44px;
      text-align: center;
      font-weight: 600;
    }
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
      <span class="hwp-badge">HWP</span>
      <span class="hwp-title" title="${escapeHtml(fileTitle || '한글 문서')}">${escapeHtml(fileTitle || '한글 문서')}</span>
    </div>

    <div class="hwp-controls">
      <!-- 페이지 이동 -->
      <button class="hwp-btn" id="hwp-prev-page" title="이전 페이지 (PageUp / ←)" disabled>◀</button>
      <span class="hwp-page-indicator"><span id="hwp-current-page">1</span> / <span id="hwp-total-pages">-</span></span>
      <button class="hwp-btn" id="hwp-next-page" title="다음 페이지 (PageDown / →)" disabled>▶</button>

      <span style="color:#334155;margin:0 2px;">|</span>

      <!-- 줌 컨트롤 -->
      <button class="hwp-btn" id="hwp-zoom-out" title="축소 (-)">➖</button>
      <span class="hwp-zoom-val" id="hwp-zoom-text">100%</span>
      <button class="hwp-btn" id="hwp-zoom-in" title="확대 (+)">➕</button>
      <button class="hwp-btn" id="hwp-zoom-fit" title="화면 너비에 맞춤">↔ 맞춤</button>
    </div>
  </div>

  <!-- 문서 워크스페이스 -->
  <div id="hwp-workspace">
    <!-- 로딩 오버레이 -->
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

  <script type="module">
    import init, { HwpDocument } from 'https://cdn.jsdelivr.net/npm/@rhwp/core@0.8.7/rhwp.js';

    var fileTitle = ${safeJsonForScript(fileTitle)};
    var targetUrl = ${safeJsonForScript(targetUrl)};
    var serverOrigin = ${safeJsonForScript(serverOrigin)};

    // 상태 관리
    var currentZoom = 100;
    var baseWidth = 820;
    var isFitWidth = false;
    var totalPages = 0;
    var currentPage = 1;

    // DOM 요소
    var loadingOverlay = document.getElementById('hwp-loading-overlay');
    var loadingDesc = document.getElementById('hwp-loading-desc');
    var errorBox = document.getElementById('hwp-error-box');
    var errorMsg = document.getElementById('hwp-error-msg');
    var fallbackDlBtn = document.getElementById('hwp-fallback-download-btn');
    var pagesContainer = document.getElementById('hwp-pages');
    var workspace = document.getElementById('hwp-workspace');

    var prevBtn = document.getElementById('hwp-prev-page');
    var nextBtn = document.getElementById('hwp-next-page');
    var curPageEl = document.getElementById('hwp-current-page');
    var totalPagesEl = document.getElementById('hwp-total-pages');

    var zoomOutBtn = document.getElementById('hwp-zoom-out');
    var zoomInBtn = document.getElementById('hwp-zoom-in');
    var zoomFitBtn = document.getElementById('hwp-zoom-fit');
    var zoomText = document.getElementById('hwp-zoom-text');

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

    // WASM 폰트 측정 콜백 (줄바꿈/너비 계산용)
    var textCanvas = null;
    var textCtx = null;
    var cachedFont = '';
    globalThis.measureTextWidth = function(font, text) {
      if (!textCtx) {
        textCanvas = document.createElement('canvas');
        textCtx = textCanvas.getContext('2d');
      }
      if (font !== cachedFont) {
        textCtx.font = font;
        cachedFont = font;
      }
      return textCtx.measureText(text).width;
    };

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

    // 줌 조절 함수
    function applyZoom() {
      isFitWidth = false;
      var targetWidth = Math.round(baseWidth * (currentZoom / 100));
      var sheets = document.querySelectorAll('.hwp-page-sheet');
      sheets.forEach(function(sheet) {
        sheet.style.width = targetWidth + 'px';
        sheet.style.maxWidth = '100%';
      });
      zoomText.textContent = currentZoom + '%';
    }

    function fitToWidth() {
      isFitWidth = true;
      var availWidth = workspace.clientWidth - 48;
      if (availWidth < 300) availWidth = 300;
      var sheets = document.querySelectorAll('.hwp-page-sheet');
      sheets.forEach(function(sheet) {
        sheet.style.width = availWidth + 'px';
        sheet.style.maxWidth = '100%';
      });
      var calculatedPercent = Math.round((availWidth / baseWidth) * 100);
      zoomText.textContent = calculatedPercent + '% (맞춤)';
    }

    zoomInBtn.addEventListener('click', function() {
      if (currentZoom < 250) {
        currentZoom = Math.min(250, currentZoom + 15);
        applyZoom();
      }
    });

    zoomOutBtn.addEventListener('click', function() {
      if (currentZoom > 40) {
        currentZoom = Math.max(40, currentZoom - 15);
        applyZoom();
      }
    });

    zoomFitBtn.addEventListener('click', fitToWidth);

    window.addEventListener('resize', function() {
      if (isFitWidth) fitToWidth();
    });

    // 페이지 점프
    function goToPage(num) {
      if (num < 1 || num > totalPages) return;
      var pageEl = document.getElementById('hwp-page-' + num);
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        currentPage = num;
        updateNavUI();
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
          if (pNum) {
            currentPage = pNum;
            updateNavUI();
          }
        }
      });
    }, { root: workspace, threshold: 0.4 });

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
        if (currentZoom < 250) {
          currentZoom = Math.min(250, currentZoom + 15);
          applyZoom();
        }
      } else if (e.key === '-') {
        if (currentZoom > 40) {
          currentZoom = Math.max(40, currentZoom - 15);
          applyZoom();
        }
      }
    });

    // 메인 로딩 파이프라인
    async function loadDocument() {
      try {
        updateStatus('⚡ 한글 벡터 렌더링 엔진 로드 중...');
        var wasmUrl = 'https://cdn.jsdelivr.net/npm/@rhwp/core@0.8.7/rhwp_bg.wasm';
        await init({ module_or_path: wasmUrl });

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

        updateStatus('✨ 페이지 렌더링 중 (0 / ' + totalPages + ')...');
        var frag = document.createDocumentFragment();

        for (var i = 0; i < totalPages; i++) {
          var pageIndex = i + 1;
          updateStatus('✨ 페이지 렌더링 중 (' + pageIndex + ' / ' + totalPages + ')...');

          var svgStr = doc.renderPageSvg(i);

          var sheet = document.createElement('div');
          sheet.className = 'hwp-page-sheet';
          sheet.id = 'hwp-page-' + pageIndex;
          sheet.setAttribute('data-page', pageIndex);
          sheet.innerHTML = svgStr + '<div class="hwp-page-num-badge">' + pageIndex + ' / ' + totalPages + '</div>';

          frag.appendChild(sheet);
        }

        pagesContainer.appendChild(frag);

        // 모든 페이지 관찰 등록
        document.querySelectorAll('.hwp-page-sheet').forEach(function(el) {
          observer.observe(el);
        });

        // 렌더링 완료 후 로딩창 닫기
        loadingOverlay.style.display = 'none';

        // 작은 화면에서는 너비 맞춤 기본 적용
        if (workspace.clientWidth < 880) {
          fitToWidth();
        } else {
          applyZoom();
        }
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
