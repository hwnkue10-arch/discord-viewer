/**
 * Discord In-App Activity 다중 문서 뷰어 템플릿 엔진
 * - PDF (Mozilla PDF.js - Main-thread Fake Worker + CMap 지원)
 * - Markdown (Marked.js + Highlight.js + 동적 Mermaid.js)
 * - PowerPoint (PptxViewJS 캔버스 엔진 + JSZip OOXML 폴백 렌더러)
 */

const SUPPORTED_FORMATS = {
  html: ['.html', '.htm'],
  pdf:  ['.pdf'],
  md:   ['.md', '.markdown'],
  pptx: ['.pptx']
};

function getFileFormat(filename) {
  if (!filename) return null;
  const clean = String(filename).toLowerCase().split('?')[0];
  for (const [format, exts] of Object.entries(SUPPORTED_FORMATS)) {
    if (exts.some((ext) => clean.endsWith(ext))) return format;
  }
  return null;
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

function safeJsonForScript(val) {
  return JSON.stringify(val)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// 1. PDF 뷰어 (Mozilla PDF.js 기반 - Worker 프리로드로 CSP/CORS 무한로딩 원천 차단)
function renderPdfViewer(fileTitle, serverOrigin, targetUrl, discordClientId) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0">
  <title>${escapeHtml(fileTitle || 'PDF 뷰어')} - Discord Viewer</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #18191c;
      color: #f2f3f5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #pdf-toolbar {
      height: 48px;
      background: #111214;
      border-bottom: 1px solid #2b2d31;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 14px;
      padding-right: 260px;
      gap: 10px;
      flex-shrink: 0;
      z-index: 100;
      user-select: none;
    }
    @media (max-width: 720px) {
      #pdf-toolbar { padding-right: 14px; }
    }
    .pdf-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow: hidden;
      font-size: 13px;
      font-weight: 600;
    }
    .pdf-badge {
      background: #e11d48;
      color: white;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .pdf-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 200px;
    }
    .pdf-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      flex-shrink: 0;
    }
    .pdf-btn {
      background: #2b2d31;
      color: #f2f3f5;
      border: 1px solid rgba(255,255,255,0.1);
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s;
    }
    .pdf-btn:hover { background: #35373c; }
    .pdf-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .page-input-wrapper {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #18191c;
      border: 1px solid #3f4248;
      border-radius: 6px;
      padding: 2px 6px;
    }
    .page-num-input {
      width: 42px;
      background: transparent;
      color: #f2f3f5;
      border: none;
      outline: none;
      text-align: center;
      font-size: 12px;
      font-weight: 700;
      -moz-appearance: textfield;
    }
    .page-num-input::-webkit-outer-spin-button,
    .page-num-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .page-total-label {
      color: #94a3b8;
      font-size: 12px;
      font-weight: 600;
      user-select: none;
    }
    #pdf-workspace {
      flex: 1;
      display: flex;
      flex-direction: row;
      overflow: hidden;
      position: relative;
      width: 100%;
      height: calc(100vh - 48px);
    }
    .viewer-sidebar {
      width: 0;
      min-width: 0;
      background: #111214;
      border-right: 0px solid #2b2d31;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1), border-right-width 0.22s ease;
      height: 100%;
      z-index: 10;
    }
    .viewer-sidebar.open {
      width: 280px;
      min-width: 280px;
      border-right: 1px solid #2b2d31;
    }
    .sidebar-inner {
      width: 280px;
      min-width: 280px;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sidebar-header {
      padding: 12px 14px;
      background: #18191c;
      border-bottom: 1px solid #2b2d31;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      font-weight: 700;
      color: #f2f3f5;
    }
    .sidebar-close-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 15px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }
    .sidebar-close-btn:hover {
      background: #2b2d31;
      color: #ffffff;
    }
    .sidebar-tabs {
      display: flex;
      background: #111214;
      border-bottom: 1px solid #2b2d31;
      flex-shrink: 0;
    }
    .sidebar-tab {
      flex: 1;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      color: #94a3b8;
      font-size: 11px;
      font-weight: 600;
      padding: 9px 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: color 0.15s, border-color 0.15s;
    }
    .sidebar-tab:hover {
      color: #f2f3f5;
    }
    .sidebar-tab.active {
      color: #f43f5e;
      border-bottom-color: #f43f5e;
      background: rgba(244, 63, 94, 0.05);
    }
    .sidebar-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .sidebar-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      background: #18191c;
      color: #cbd5e1;
      font-size: 12px;
      text-decoration: none;
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-left: 3px solid transparent;
      transition: all 0.15s ease;
      min-height: 38px;
      box-sizing: border-box;
    }
    .sidebar-item:hover {
      background: #232428;
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.1);
    }
    .sidebar-item.active {
      background: rgba(244, 63, 94, 0.12);
      border-color: rgba(244, 63, 94, 0.35);
      border-left: 3px solid #f43f5e;
      color: #ffffff;
      font-weight: 600;
    }
    .sidebar-badge {
      background: #2b2d31;
      color: #94a3b8;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
      min-width: 32px;
      text-align: center;
      font-family: Consolas, monospace;
    }
    .sidebar-item.active .sidebar-badge {
      background: #f43f5e;
      color: #ffffff;
    }
    .sidebar-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      font-size: 12px;
      line-height: 1.35;
    }
    .sidebar-page-pill {
      font-size: 10px;
      font-weight: 700;
      color: #94a3b8;
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 5px;
      border-radius: 3px;
      margin-left: auto;
      flex-shrink: 0;
      font-family: Consolas, monospace;
    }
    .sidebar-item.active .sidebar-page-pill {
      color: #fda4af;
      background: rgba(244, 63, 94, 0.2);
    }
    #pdf-container {
      flex: 1;
      min-width: 0;
      height: 100%;
      overflow: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px 12px 40px;
      background: #232428;
      gap: 16px;
    }
    .pdf-page-canvas {
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      border-radius: 4px;
      background: white;
      max-width: 100%;
    }
    #pdf-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      gap: 12px;
      color: #94a3b8;
      font-size: 14px;
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(255,255,255,0.15);
      border-top-color: #f43f5e;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="pdf-toolbar">
    <div class="pdf-meta">
      <button id="pdf-toc-btn" class="pdf-btn" style="background:#2b2d31;border-color:rgba(255,255,255,0.15);" title="목차 / 전체 페이지 목록 열기">📑 목차</button>
      <span class="pdf-badge">PDF</span>
      <span class="pdf-title">${escapeHtml(fileTitle || '문서')}</span>
    </div>
    <div class="pdf-controls">
      <button id="prev-page" class="pdf-btn" disabled>◀ 이전</button>
      <div class="page-input-wrapper">
        <input id="pdf-page-input" class="page-num-input" type="number" min="1" value="1" title="페이지 번호 입력 후 Enter">
        <span style="color:#64748b;">/</span>
        <span id="pdf-page-total" class="page-total-label">-</span>
      </div>
      <button id="next-page" class="pdf-btn" disabled>다음 ▶</button>
      <span style="color:#4b5563;margin:0 2px;">|</span>
      <button id="zoom-out" class="pdf-btn">🔍 -</button>
      <button id="zoom-fit" class="pdf-btn">맞춤</button>
      <button id="zoom-in" class="pdf-btn">🔍 +</button>
    </div>
  </div>

  <div id="pdf-workspace">
    <div id="pdf-sidebar" class="viewer-sidebar">
      <div class="sidebar-inner">
        <div class="sidebar-header">
          <span id="pdf-sidebar-title">📑 문서 탐색</span>
          <button id="pdf-sidebar-close" class="sidebar-close-btn" title="목차 닫기">✕</button>
        </div>
        <div id="pdf-sidebar-tabs" class="sidebar-tabs" style="display:none;">
          <button id="pdf-tab-outline-btn" class="sidebar-tab active">📑 목차 트리</button>
          <button id="pdf-tab-pages-btn" class="sidebar-tab">📄 전체 페이지</button>
        </div>
        <div id="pdf-outline-list" class="sidebar-list" style="display:none;"></div>
        <div id="pdf-pages-list" class="sidebar-list">
          <div style="color:#94a3b8;text-align:center;padding:16px 0;font-size:12px;">목록을 불러오는 중...</div>
        </div>
      </div>
    </div>

    <div id="pdf-container">
      <div id="pdf-loading">
        <div class="spinner"></div>
        <div id="pdf-loading-text">⚡ PDF 문서를 불러오는 중입니다...</div>
      </div>
      <canvas id="pdf-canvas" class="pdf-page-canvas" style="display:none;"></canvas>
    </div>
  </div>

  <script>
    (function() {
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

      var pdfDoc = null;
      var pageNum = 1;
      var pageRendering = false;
      var pageNumPending = null;
      var scale = 1.3;
      var fitMode = true;

      var canvas = document.getElementById('pdf-canvas');
      var ctx = canvas.getContext('2d');
      var loadingEl = document.getElementById('pdf-loading');
      var pageInput = document.getElementById('pdf-page-input');
      var pageTotal = document.getElementById('pdf-page-total');
      var prevBtn = document.getElementById('prev-page');
      var nextBtn = document.getElementById('next-page');

      var tocBtn = document.getElementById('pdf-toc-btn');
      var sidebar = document.getElementById('pdf-sidebar');
      var sidebarClose = document.getElementById('pdf-sidebar-close');
      var sidebarTitle = document.getElementById('pdf-sidebar-title');
      var sidebarTabs = document.getElementById('pdf-sidebar-tabs');
      var tabOutlineBtn = document.getElementById('pdf-tab-outline-btn');
      var tabPagesBtn = document.getElementById('pdf-tab-pages-btn');
      var outlineList = document.getElementById('pdf-outline-list');
      var pagesList = document.getElementById('pdf-pages-list');

      tabOutlineBtn.addEventListener('click', function() {
        tabOutlineBtn.classList.add('active');
        tabPagesBtn.classList.remove('active');
        outlineList.style.display = 'flex';
        pagesList.style.display = 'none';
      });

      tabPagesBtn.addEventListener('click', function() {
        tabPagesBtn.classList.add('active');
        tabOutlineBtn.classList.remove('active');
        outlineList.style.display = 'none';
        pagesList.style.display = 'flex';
      });

      function closeSidebar() {
        sidebar.classList.remove('open');
      }

      tocBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        sidebar.classList.toggle('open');
        if (pdfDoc && fitMode) {
          setTimeout(function() { queueRenderPage(pageNum); }, 240);
        }
      });

      sidebarClose.addEventListener('click', function(e) {
        e.stopPropagation();
        closeSidebar();
        if (pdfDoc && fitMode) {
          setTimeout(function() { queueRenderPage(pageNum); }, 240);
        }
      });

      function goToPage(num) {
        if (!pdfDoc) return;
        var target = Math.max(1, Math.min(num, pdfDoc.numPages));
        if (isNaN(target)) return;
        pageNum = target;
        queueRenderPage(pageNum);
      }

      pageInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          goToPage(parseInt(pageInput.value, 10));
          pageInput.blur();
        }
      });

      pageInput.addEventListener('change', function() {
        goToPage(parseInt(pageInput.value, 10));
      });

      async function resolveDestPage(dest) {
        if (!dest || !pdfDoc) return null;
        try {
          var targetDest = dest;
          if (typeof dest === 'string') {
            targetDest = await pdfDoc.getDestination(dest);
          }
          if (Array.isArray(targetDest) && targetDest[0]) {
            var pageIdx = await pdfDoc.getPageIndex(targetDest[0]);
            return pageIdx + 1;
          }
        } catch (e) {}
        return null;
      }

      function renderOutlineBranch(container, items, level) {
        items.forEach(function(item) {
          var div = document.createElement('div');
          div.className = 'sidebar-item';
          div.style.paddingLeft = (level * 14 + 10) + 'px';

          var icon = level === 0 ? '📑' : '↳';
          var textSpan = document.createElement('span');
          textSpan.className = 'sidebar-text';
          textSpan.innerHTML = '<span style="color:#94a3b8;margin-right:6px;font-size:11px;">' + icon + '</span>' + escapeHtml(item.title);
          textSpan.title = item.title;

          var pagePill = document.createElement('span');
          pagePill.className = 'sidebar-page-pill';
          pagePill.textContent = '...';

          div.appendChild(textSpan);
          div.appendChild(pagePill);

          if (item.dest) {
            resolveDestPage(item.dest).then(function(pNum) {
              if (pNum) {
                pagePill.textContent = 'p.' + pNum;
                div.id = 'pdf-outline-p-' + pNum;
                div.addEventListener('click', function() {
                  goToPage(pNum);
                });
              }
            });
          }

          container.appendChild(div);

          if (item.items && item.items.length > 0) {
            renderOutlineBranch(container, item.items, level + 1);
          }
        });
      }

      function extractPdfPageTitle(pNum, titleEl) {
        pdfDoc.getPage(pNum).then(function(page) {
          return page.getTextContent();
        }).then(function(tc) {
          if (!tc || !tc.items || !tc.items.length) {
            titleEl.textContent = pNum + ' 페이지';
            return;
          }
          var validItems = tc.items.filter(function(it) {
            return it.str && it.str.trim().length > 0;
          });
          if (!validItems.length) {
            titleEl.textContent = pNum + ' 페이지';
            return;
          }

          var maxSz = 0;
          for (var i = 0; i < Math.min(validItems.length, 25); i++) {
            var it = validItems[i];
            var sz = Math.abs(it.transform ? it.transform[3] : (it.height || 10));
            if (sz > maxSz) maxSz = sz;
          }

          var headingParts = [];
          for (var j = 0; j < Math.min(validItems.length, 12); j++) {
            var item = validItems[j];
            var sz = Math.abs(item.transform ? item.transform[3] : (item.height || 10));
            if (sz >= maxSz * 0.78) {
              headingParts.push(item.str.trim());
            } else if (headingParts.length > 0) {
              break;
            }
          }

          var title = headingParts.join(' ').trim();
          if (!title && validItems.length > 0) {
            title = validItems[0].str.trim();
          }

          title = title.replace(/\s+/g, ' ');
          if (title && !title.match(/^[0-9\/\s\.\-]+$/)) {
            titleEl.textContent = title;
            titleEl.title = title;
          } else if (validItems.length > 1) {
            var alt = validItems.slice(1, 4).map(function(v) { return v.str; }).join(' ').trim();
            if (alt && !alt.match(/^[0-9\/\s\.\-]+$/)) {
              titleEl.textContent = alt.slice(0, 50);
              titleEl.title = alt;
            } else {
              titleEl.textContent = pNum + ' 페이지';
            }
          } else {
            titleEl.textContent = pNum + ' 페이지';
          }
        }).catch(function() {
          titleEl.textContent = pNum + ' 페이지';
        });
      }

      function buildPdfToc() {
        if (!pdfDoc) return;
        outlineList.innerHTML = '';
        pagesList.innerHTML = '';

        for (var p = 1; p <= pdfDoc.numPages; p++) {
          (function(pNum) {
            var numStr = pNum < 10 ? ('p.0' + pNum) : ('p.' + pNum);
            var div = document.createElement('div');
            div.className = 'sidebar-item' + (pNum === pageNum ? ' active' : '');
            div.id = 'pdf-toc-p-' + pNum;

            var badge = document.createElement('span');
            badge.className = 'sidebar-badge';
            badge.textContent = numStr;

            var textSpan = document.createElement('span');
            textSpan.className = 'sidebar-text';
            textSpan.textContent = pNum + ' 페이지 불러오는 중...';

            div.appendChild(badge);
            div.appendChild(textSpan);

            div.addEventListener('click', function() {
              goToPage(pNum);
            });

            pagesList.appendChild(div);
            extractPdfPageTitle(pNum, textSpan);
          })(p);
        }

        pdfDoc.getOutline().then(function(outline) {
          if (outline && outline.length > 0) {
            sidebarTabs.style.display = 'flex';
            tabOutlineBtn.textContent = '📑 목차 트리';
            tabPagesBtn.textContent = '📄 페이지 (' + pdfDoc.numPages + ')';
            renderOutlineBranch(outlineList, outline, 0);

            tabOutlineBtn.classList.add('active');
            tabPagesBtn.classList.remove('active');
            outlineList.style.display = 'flex';
            pagesList.style.display = 'none';
            sidebarTitle.textContent = '📑 문서 목차';
          } else {
            sidebarTabs.style.display = 'none';
            outlineList.style.display = 'none';
            pagesList.style.display = 'flex';
            sidebarTitle.textContent = '📄 페이지 목록 (' + pdfDoc.numPages + 'p)';
          }
        }).catch(function() {
          sidebarTabs.style.display = 'none';
          outlineList.style.display = 'none';
          pagesList.style.display = 'flex';
          sidebarTitle.textContent = '📄 페이지 목록 (' + pdfDoc.numPages + 'p)';
        });
      }

      function renderPage(num) {
        pageRendering = true;
        pdfDoc.getPage(num).then(function(page) {
          var container = document.getElementById('pdf-container');
          var desiredScale = scale;
          if (fitMode) {
            var containerWidth = Math.min(container.clientWidth - 32, 980);
            if (containerWidth > 200) {
              var unscaledViewport = page.getViewport({ scale: 1 });
              desiredScale = containerWidth / unscaledViewport.width;
              scale = desiredScale;
            }
          }

          var dpr = window.devicePixelRatio || 1;
          var viewport = page.getViewport({ scale: desiredScale });

          canvas.height = Math.floor(viewport.height * dpr);
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.style.height = Math.floor(viewport.height) + 'px';
          canvas.style.width = Math.floor(viewport.width) + 'px';

          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

          var renderContext = {
            canvasContext: ctx,
            viewport: viewport
          };
          var renderTask = page.render(renderContext);

          renderTask.promise.then(function() {
            pageRendering = false;
            loadingEl.style.display = 'none';
            canvas.style.display = 'block';

            if (pageNumPending !== null) {
              renderPage(pageNumPending);
              pageNumPending = null;
            }
          }).catch(function(err) {
            pageRendering = false;
            console.error('페이지 렌더링 오류:', err);
          });
        });

        pageInput.value = num;
        pageTotal.textContent = pdfDoc.numPages;
        prevBtn.disabled = (num <= 1);
        nextBtn.disabled = (num >= pdfDoc.numPages);

        var prevActive = pagesList.querySelector('.sidebar-item.active');
        if (prevActive) prevActive.classList.remove('active');
        var curActive = document.getElementById('pdf-toc-p-' + num);
        if (curActive) {
          curActive.classList.add('active');
          if (sidebar.classList.contains('open') && pagesList.style.display !== 'none') {
            curActive.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }

        var prevOutlineActive = outlineList.querySelector('.sidebar-item.active');
        if (prevOutlineActive) prevOutlineActive.classList.remove('active');
        var curOutlineActive = document.getElementById('pdf-outline-p-' + num);
        if (curOutlineActive) {
          curOutlineActive.classList.add('active');
          if (sidebar.classList.contains('open') && outlineList.style.display !== 'none') {
            curOutlineActive.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }

      function queueRenderPage(num) {
        if (pageRendering) {
          pageNumPending = num;
        } else {
          renderPage(num);
        }
      }

      function onPrevPage() {
        if (!pdfDoc || pageNum <= 1) return;
        pageNum--;
        queueRenderPage(pageNum);
      }
      prevBtn.addEventListener('click', onPrevPage);

      function onNextPage() {
        if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
        pageNum++;
        queueRenderPage(pageNum);
      }
      nextBtn.addEventListener('click', onNextPage);

      document.getElementById('zoom-in').addEventListener('click', function() {
        if (!pdfDoc) return;
        fitMode = false;
        scale = Math.min(scale + 0.25, 3.0);
        queueRenderPage(pageNum);
      });

      document.getElementById('zoom-out').addEventListener('click', function() {
        if (!pdfDoc) return;
        fitMode = false;
        scale = Math.max(scale - 0.25, 0.4);
        queueRenderPage(pageNum);
      });

      document.getElementById('zoom-fit').addEventListener('click', function() {
        if (!pdfDoc) return;
        fitMode = true;
        queueRenderPage(pageNum);
      });

      window.addEventListener('keydown', function(e) {
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
        if (e.key === 'ArrowLeft') onPrevPage();
        else if (e.key === 'ArrowRight') onNextPage();
      });

      var targetPdfUrl = ${safeJsonForScript(targetUrl || '')};
      if (targetPdfUrl) {
        var proxyPdfUrl = toProxyUrlClient(targetPdfUrl);
        fetch(proxyPdfUrl)
          .then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.arrayBuffer();
          })
          .then(function(buf) {
            var loadingTask = pdfjsLib.getDocument({
              data: new Uint8Array(buf),
              isEvalSupported: false,
              cMapUrl: '/api/proxy/https/cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
              cMapPacked: true,
              standardFontDataUrl: '/api/proxy/https/cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/'
            });
            return loadingTask.promise;
          })
          .then(function(doc) {
            pdfDoc = doc;
            renderPage(pageNum);
            buildPdfToc();
          })
          .catch(function(err) {
            console.error('PDF 로드 실패:', err);
            loadingEl.innerHTML = '<div style="color:#f43f5e;font-weight:bold;">⚠️ PDF 문서를 불러올 수 없습니다.</div><div style="font-size:12px;margin-top:6px;color:#94a3b8;">' + String(err && err.message ? err.message : err) + '</div>';
          });
      } else {
        loadingEl.innerHTML = '<div>열람할 PDF 파일이 지정되지 않았습니다.</div>';
      }
    })();
  </script>
</body>
</html>`;
}

// 2. 마크다운 뷰어 (Marked.js + Highlight.js + 조건부 Mermaid.js 기반)
function renderMarkdownViewer(rawMarkdown, fileTitle, serverOrigin, targetUrl, discordClientId) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileTitle || 'Markdown 뷰어')} - Discord Viewer</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.5.1/github-markdown-dark.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css">
  <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      background: #0d1117;
      color: #c9d1d9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      min-height: 100vh;
    }
    #md-toolbar {
      position: sticky;
      top: 0;
      height: 48px;
      background: rgba(13, 17, 23, 0.95);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid #30363d;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      z-index: 100;
      user-select: none;
    }
    .md-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      font-weight: 600;
    }
    .md-badge {
      background: #238636;
      color: white;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
    }
    .content-wrapper {
      max-width: 920px;
      margin: 0 auto;
      padding: 36px 24px 80px;
    }
    .markdown-body {
      background: transparent !important;
      color: #c9d1d9 !important;
      font-size: 15px;
      line-height: 1.7;
    }
    .markdown-body img {
      max-width: 100%;
      border-radius: 6px;
    }
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
      opacity: 0.85;
      transition: opacity 0.2s;
    }
    .copy-btn:hover { opacity: 1; background: #30363d; }
    pre { position: relative; }
    .mermaid {
      background: rgba(22, 27, 34, 0.8);
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
      display: flex;
      justify-content: center;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <div id="md-toolbar">
    <div class="md-meta">
      <span class="md-badge">Markdown</span>
      <span>${escapeHtml(fileTitle || '문서')}</span>
    </div>
  </div>

  <div class="content-wrapper">
    <article id="markdown-container" class="markdown-body"></article>
  </div>

  <script>
    (function() {
      var rawText = ${safeJsonForScript(rawMarkdown || '')};
      var container = document.getElementById('markdown-container');

      function toProxyImgUrl(u) {
        if (!u) return u;
        if (u.indexOf('/api/proxy/') === 0 || u.indexOf('data:') === 0 || u.indexOf('blob:') === 0) return u;
        try {
          var parsed = new URL(u, window.location.origin);
          if (parsed.origin === window.location.origin) return u;
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            var proto = parsed.protocol.replace(':', '').toLowerCase();
            return '/api/proxy/' + proto + '/' + parsed.host + parsed.pathname + parsed.search;
          }
        } catch (e) {}
        return u;
      }

      try {
        if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
          marked.setOptions({
            gfm: true,
            breaks: true
          });
          container.innerHTML = marked.parse(rawText || '# 문서 내용이 비어있습니다.');
        } else {
          var preFallback = document.createElement('pre');
          preFallback.style.whiteSpace = 'pre-wrap';
          preFallback.textContent = rawText || '문서 내용이 비어있습니다.';
          container.appendChild(preFallback);
        }
      } catch (err) {
        console.error('Markdown 파싱 오류:', err);
        var preErr = document.createElement('pre');
        preErr.style.whiteSpace = 'pre-wrap';
        preErr.textContent = rawText;
        container.appendChild(preErr);
      }

      // 외부 이미지(배지, 아이콘 등)를 프록시 경로로 자동 변환하여 Discord CSP 차단 방지
      var imgs = container.querySelectorAll('img[src]');
      imgs.forEach(function(img) {
        var src = img.getAttribute('src');
        if (src && /^https?:\\/\\//i.test(src)) {
          img.setAttribute('src', toProxyImgUrl(src));
        }
      });

      // 코드 하이라이팅 적용
      if (typeof hljs !== 'undefined') {
        var codeEls = container.querySelectorAll('pre code:not(.language-mermaid)');
        codeEls.forEach(function(el) {
          try { hljs.highlightElement(el); } catch (e) {}
        });
      }

      // Mermaid 다이어그램 블록이 있을 때만 동적 로드 (초기 로딩 3.3MB 절감)
      var mermaidBlocks = container.querySelectorAll('code.language-mermaid');
      if (mermaidBlocks.length > 0) {
        mermaidBlocks.forEach(function(codeBlock) {
          var pre = codeBlock.parentNode;
          var mermaidDiv = document.createElement('div');
          mermaidDiv.className = 'mermaid';
          mermaidDiv.textContent = codeBlock.textContent;
          if (pre && pre.parentNode) {
            pre.parentNode.replaceChild(mermaidDiv, pre);
          }
        });
        var s = document.createElement('script');
        s.src = '/api/proxy/https/cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
        s.onload = function() {
          if (typeof mermaid !== 'undefined') {
            mermaid.initialize({ startOnLoad: false, theme: 'dark' });
            mermaid.run();
          }
        };
        document.head.appendChild(s);
      }

      // 코드 블록 복사 버튼 부착
      var allPres = container.querySelectorAll('pre');
      allPres.forEach(function(pre) {
        if (pre.querySelector('.mermaid')) return;
        var btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.textContent = '📋 복사';
        btn.addEventListener('click', function() {
          var text = pre.querySelector('code') ? pre.querySelector('code').innerText : pre.innerText;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
              btn.textContent = '✅ 복사됨!';
              setTimeout(function() { btn.textContent = '📋 복사'; }, 2000);
            });
          }
        });
        pre.appendChild(btn);
      });
    })();
  </script>
</body>
</html>`;
}

// 3. PowerPoint (PPTX) 뷰어 (PptxViewJS + JSZip OOXML 이중 렌더링 엔진)
function renderPptxViewer(fileTitle, serverOrigin, targetUrl, discordClientId) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileTitle || 'PPTX 뷰어')} - Discord Viewer</title>
  <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/pptxviewjs@1.1.5/dist/PptxViewJS.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0f172a;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #pptx-toolbar {
      height: 48px;
      background: #111214;
      border-bottom: 1px solid #2b2d31;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      padding-right: 260px;
      flex-shrink: 0;
      z-index: 100;
      user-select: none;
      gap: 8px;
    }
    @media (max-width: 720px) {
      #pptx-toolbar { padding-right: 14px; }
    }
    .pptx-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      overflow: hidden;
    }
    .pptx-badge {
      background: #ea580c;
      color: white;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .pptx-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 200px;
    }
    .pptx-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      flex-shrink: 0;
    }
    .pptx-btn {
      background: #2b2d31;
      color: #f2f3f5;
      border: 1px solid rgba(255,255,255,0.1);
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s;
    }
    .pptx-btn:hover { background: #35373c; }
    .pptx-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    #pptx-workspace {
      flex: 1;
      display: flex;
      flex-direction: row;
      overflow: hidden;
      position: relative;
      width: 100%;
      height: calc(100vh - 48px);
    }
    .viewer-sidebar {
      width: 0;
      min-width: 0;
      background: #0f172a;
      border-right: 0px solid #1e293b;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1), border-right-width 0.22s ease;
      height: 100%;
      z-index: 10;
    }
    .viewer-sidebar.open {
      width: 290px;
      min-width: 290px;
      border-right: 1px solid #1e293b;
    }
    .sidebar-inner {
      width: 290px;
      min-width: 290px;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sidebar-header {
      padding: 12px 14px;
      background: #111827;
      border-bottom: 1px solid #1e293b;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      font-weight: 700;
      color: #f1f5f9;
    }
    .sidebar-close-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 15px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }
    .sidebar-close-btn:hover {
      background: #1e293b;
      color: #ffffff;
    }
    .sidebar-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .sidebar-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border-radius: 6px;
      cursor: pointer;
      background: #1e293b;
      color: #cbd5e1;
      font-size: 12px;
      text-decoration: none;
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-left: 3px solid transparent;
      transition: all 0.15s ease;
      min-height: 40px;
      box-sizing: border-box;
    }
    .sidebar-item:hover {
      background: #273549;
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.12);
    }
    .sidebar-item.active {
      background: rgba(249, 115, 22, 0.14);
      border-color: rgba(249, 115, 22, 0.4);
      border-left: 3px solid #ea580c;
      color: #ffffff;
      font-weight: 600;
    }
    .sidebar-badge {
      background: #0f172a;
      color: #94a3b8;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
      min-width: 26px;
      text-align: center;
      font-family: Consolas, monospace;
    }
    .sidebar-item.active .sidebar-badge {
      background: #ea580c;
      color: #ffffff;
    }
    .sidebar-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .page-input-wrapper {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 2px 6px;
    }
    .page-num-input {
      width: 42px;
      background: transparent;
      color: #f1f5f9;
      border: none;
      outline: none;
      text-align: center;
      font-size: 12px;
      font-weight: 700;
      -moz-appearance: textfield;
    }
    .page-num-input::-webkit-outer-spin-button,
    .page-num-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .page-total-label {
      color: #94a3b8;
      font-size: 12px;
      font-weight: 600;
      user-select: none;
    }
    #stage {
      flex: 1;
      min-width: 0;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      padding: 20px;
      background: #1e293b;
      position: relative;
    }
    #pptx-canvas {
      max-width: 96%;
      max-height: calc(100vh - 88px);
      width: auto;
      height: auto;
      box-shadow: 0 12px 44px rgba(0,0,0,0.65);
      border-radius: 6px;
      background: #ffffff;
      display: none;
    }
    #pptx-dom-stage {
      width: 95%;
      max-width: 1280px;
      max-height: calc(100vh - 88px);
      aspect-ratio: 16 / 9;
      position: relative;
      box-shadow: 0 12px 48px rgba(0,0,0,0.65);
      border-radius: 8px;
      background: #ffffff;
      overflow: hidden;
      display: none;
      container-type: size;
    }
    #pptx-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: #94a3b8;
      font-size: 14px;
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(255,255,255,0.15);
      border-top-color: #ea580c;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="pptx-toolbar">
    <div class="pptx-meta">
      <button id="pptx-toc-btn" class="pptx-btn" style="background:#1e293b;border-color:rgba(255,255,255,0.15);" title="슬라이드 목차 열기">📑 목차</button>
      <span class="pptx-badge">PPTX</span>
      <span class="pptx-title">${escapeHtml(fileTitle || '프레젠테이션')}</span>
    </div>
    <div class="pptx-controls">
      <button id="prev-slide" class="pptx-btn" disabled>◀ 이전</button>
      <div class="page-input-wrapper">
        <input id="pptx-slide-input" class="page-num-input" type="number" min="1" value="1" title="슬라이드 번호 입력 후 Enter">
        <span style="color:#64748b;">/</span>
        <span id="pptx-slide-total" class="page-total-label">-</span>
      </div>
      <button id="next-slide" class="pptx-btn" disabled>다음 ▶</button>
      <span style="color:#4b5563;margin:0 2px;">|</span>
      <button id="pptx-fullscreen" class="pptx-btn">⛶ 전체화면</button>
    </div>
  </div>

  <div id="pptx-workspace">
    <div id="pptx-sidebar" class="viewer-sidebar">
      <div class="sidebar-inner">
        <div class="sidebar-header">
          <span>📑 슬라이드 목록</span>
          <span id="pptx-sidebar-count" style="font-size:11px;color:#94a3b8;margin-left:auto;margin-right:12px;font-weight:600;"></span>
          <button id="pptx-sidebar-close" class="sidebar-close-btn" title="목차 닫기">✕</button>
        </div>
        <div id="pptx-toc-list" class="sidebar-list">
          <div style="color:#94a3b8;text-align:center;padding:16px 0;font-size:12px;">목록을 불러오는 중...</div>
        </div>
      </div>
    </div>

    <div id="stage">
      <div id="pptx-loading">
        <div class="spinner"></div>
        <div id="pptx-loading-text">⚡ PowerPoint 슬라이드를 불러오는 중입니다...</div>
      </div>
      <canvas id="pptx-canvas" width="1280" height="720"></canvas>
      <div id="pptx-dom-stage"></div>
    </div>
  </div>

  <script>
    (function() {
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

      var targetUrl = ${safeJsonForScript(targetUrl || '')};
      var canvas = document.getElementById('pptx-canvas');
      var domStage = document.getElementById('pptx-dom-stage');
      var loadingEl = document.getElementById('pptx-loading');
      var prevBtn = document.getElementById('prev-slide');
      var nextBtn = document.getElementById('next-slide');
      var slideInput = document.getElementById('pptx-slide-input');
      var slideTotal = document.getElementById('pptx-slide-total');

      var tocBtn = document.getElementById('pptx-toc-btn');
      var sidebar = document.getElementById('pptx-sidebar');
      var sidebarClose = document.getElementById('pptx-sidebar-close');
      var tocList = document.getElementById('pptx-toc-list');

      function closeSidebar() {
        sidebar.classList.remove('open');
      }

      tocBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        sidebar.classList.toggle('open');
      });

      sidebarClose.addEventListener('click', function(e) {
        e.stopPropagation();
        closeSidebar();
      });

      var currentSlide = 0;
      var totalSlides = 0;
      var activeMode = 'none'; // 'canvas' | 'dom'
      var pptxViewer = null;
      var fallbackSlides = [];
      var slideAspect = 16 / 9;

      function goToSlide(n) {
        if (totalSlides <= 0) return;
        var target = Math.max(1, Math.min(n, totalSlides));
        if (isNaN(target)) return;
        showSlide(target - 1);
      }

      slideInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          goToSlide(parseInt(slideInput.value, 10));
          slideInput.blur();
        }
      });

      slideInput.addEventListener('change', function() {
        goToSlide(parseInt(slideInput.value, 10));
      });

      function buildPptxToc() {
        if (totalSlides <= 0) return;
        var countEl = document.getElementById('pptx-sidebar-count');
        if (countEl) countEl.textContent = '총 ' + totalSlides + '장';
        tocList.innerHTML = '';
        for (var s = 0; s < totalSlides; s++) {
          (function(sIdx) {
            var sInfo = fallbackSlides[sIdx];
            var title = (sInfo && sInfo.title) ? sInfo.title : ('슬라이드 ' + (sIdx + 1));
            var numStr = (sIdx + 1 < 10) ? ('0' + (sIdx + 1)) : ('' + (sIdx + 1));
            var div = document.createElement('div');
            div.className = 'sidebar-item' + (sIdx === currentSlide ? ' active' : '');
            div.id = 'pptx-toc-s-' + sIdx;
            div.innerHTML = '<span class="sidebar-badge">' + numStr + '</span><span class="sidebar-text" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</span>';
            div.addEventListener('click', function() {
              showSlide(sIdx);
            });
            tocList.appendChild(div);
          })(s);
        }
      }

      function updateControls() {
        slideInput.value = currentSlide + 1;
        slideTotal.textContent = totalSlides;
        prevBtn.disabled = (currentSlide <= 0);
        nextBtn.disabled = (currentSlide >= totalSlides - 1);

        var prevActive = tocList.querySelector('.sidebar-item.active');
        if (prevActive) prevActive.classList.remove('active');
        var curActive = document.getElementById('pptx-toc-s-' + currentSlide);
        if (curActive) {
          curActive.classList.add('active');
          if (sidebar.classList.contains('open')) {
            curActive.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }

      async function showSlide(index) {
        if (index < 0 || index >= totalSlides) return;
        currentSlide = index;
        updateControls();

        if (activeMode === 'canvas' && pptxViewer) {
          try {
            await pptxViewer.render(canvas, { slideIndex: currentSlide });
            return;
          } catch (e) {
            console.warn('PptxViewJS 슬라이드 렌더링 경고, 내장 OOXML 렌더러로 전환:', e);
            if (fallbackSlides.length > 0) {
              activeMode = 'dom';
              canvas.style.display = 'none';
              domStage.style.display = 'block';
            }
          }
        }

        if (activeMode === 'dom' && fallbackSlides[currentSlide]) {
          renderDomSlide(fallbackSlides[currentSlide]);
        }
      }

      prevBtn.addEventListener('click', function() {
        if (currentSlide > 0) showSlide(currentSlide - 1);
      });

      nextBtn.addEventListener('click', function() {
        if (currentSlide < totalSlides - 1) showSlide(currentSlide + 1);
      });

      window.addEventListener('keydown', function(e) {
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          if (currentSlide > 0) showSlide(currentSlide - 1);
        } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
          if (currentSlide < totalSlides - 1) showSlide(currentSlide + 1);
        }
      });

      document.getElementById('pptx-fullscreen').addEventListener('click', function() {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(function() {});
        } else {
          document.exitFullscreen().catch(function() {});
        }
      });

      function extractColor(parentEl) {
        if (!parentEl) return null;
        var noFill = parentEl.getElementsByTagName('a:noFill')[0] || parentEl.getElementsByTagName('noFill')[0];
        if (noFill) return null;
        var clr = parentEl.getElementsByTagName('a:srgbClr')[0] || parentEl.getElementsByTagName('srgbClr')[0];
        if (!clr || !clr.getAttribute('val')) return null;
        var hex = clr.getAttribute('val').trim();
        var alphaNode = clr.getElementsByTagName('a:alpha')[0] || clr.getElementsByTagName('alpha')[0];
        if (alphaNode && alphaNode.getAttribute('val')) {
          var a = parseInt(alphaNode.getAttribute('val'), 10) / 100000;
          var r = parseInt(hex.slice(0, 2), 16);
          var g = parseInt(hex.slice(2, 4), 16);
          var b = parseInt(hex.slice(4, 6), 16);
          return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
        }
        return '#' + hex;
      }

      function extractGradient(gradEl) {
        if (!gradEl) return null;
        var gsNodes = gradEl.getElementsByTagName('a:gs');
        if (!gsNodes.length) gsNodes = gradEl.getElementsByTagName('gs');
        var stops = [];
        for (var i = 0; i < gsNodes.length; i++) {
          var gs = gsNodes[i];
          var posVal = parseInt(gs.getAttribute('pos') || '0', 10);
          var posPct = Math.round(posVal / 1000);
          var clr = extractColor(gs);
          if (clr) {
            stops.push(clr + ' ' + posPct + '%');
          }
        }
        if (stops.length < 2) return null;
        var lin = gradEl.getElementsByTagName('a:lin')[0] || gradEl.getElementsByTagName('lin')[0];
        var angVal = lin ? lin.getAttribute('ang') : null;
        var cssDeg = 180;
        if (angVal) {
          var ooxmlDeg = (parseInt(angVal, 10) / 60000) % 360;
          cssDeg = Math.round((ooxmlDeg + 90) % 360);
        }
        return 'linear-gradient(' + cssDeg + 'deg, ' + stops.join(', ') + ')';
      }

      // 내장 JSZip OOXML 파서 (1:1 반응형 고화질 슬라이드 렌더러)
      async function parseOoxmlSlides(arrayBuf) {
        if (typeof JSZip === 'undefined') return [];
        var zip = await JSZip.loadAsync(arrayBuf);
        var parser = new DOMParser();

        var sldCx = 12192000;
        var sldCy = 6858000;
        var presFile = zip.file('ppt/presentation.xml');
        if (presFile) {
          var presXml = await presFile.async('string');
          var szMatch = presXml.match(/<p:sldSz[^>]*?cx=["']([0-9]+)["'][^>]*?cy=["']([0-9]+)["']/i);
          if (szMatch) {
            sldCx = parseInt(szMatch[1], 10) || sldCx;
            sldCy = parseInt(szMatch[2], 10) || sldCy;
          }
        }
        slideAspect = sldCx / sldCy;

        var slideNames = Object.keys(zip.files)
          .filter(function(name) {
            return name.startsWith('ppt/slides/slide') && name.endsWith('.xml') && !name.includes('_rels');
          })
          .sort(function(a, b) {
            var na = parseInt(a.replace(/[^0-9]/g, ''), 10) || 0;
            var nb = parseInt(b.replace(/[^0-9]/g, ''), 10) || 0;
            return na - nb;
          });

        var parsedSlides = [];
        for (var i = 0; i < slideNames.length; i++) {
          var sName = slideNames[i];
          var sXml = await zip.file(sName).async('string');
          var doc = parser.parseFromString(sXml, 'application/xml');

          // 관계 파일(_rels)에서 미디어 이미지 매핑 로드
          var relPath = sName.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
          var relMap = {};
          if (zip.file(relPath)) {
            var relXml = await zip.file(relPath).async('string');
            var relDoc = parser.parseFromString(relXml, 'application/xml');
            var relNodes = relDoc.getElementsByTagName('Relationship');
            for (var r = 0; r < relNodes.length; r++) {
              var rId = relNodes[r].getAttribute('Id');
              var target = relNodes[r].getAttribute('Target') || '';
              if (rId && target) {
                var cleanTarget = target.startsWith('../') ? target.replace('../', 'ppt/') : target;
                relMap[rId] = cleanTarget;
              }
            }
          }

          // 배경색 추출
          var bgColor = '#ffffff';
          var bgNodes = doc.getElementsByTagName('p:bg');
          if (!bgNodes.length) bgNodes = doc.getElementsByTagName('bg');
          if (bgNodes.length > 0) {
            var bgClr = bgNodes[0].getElementsByTagName('a:srgbClr')[0] || bgNodes[0].getElementsByTagName('srgbClr')[0];
            if (bgClr && bgClr.getAttribute('val')) {
              bgColor = '#' + bgClr.getAttribute('val');
            }
          }

          var elements = [];
          var slideTitle = '';
          var spTree = doc.getElementsByTagName('p:spTree')[0] || doc.getElementsByTagName('spTree')[0];
          if (spTree && spTree.children) {
            for (var c = 0; c < spTree.children.length; c++) {
              var node = spTree.children[c];
              var tag = node.localName || node.tagName.split(':').pop();
              if (tag === 'sp' || tag === 'pic') {
                var off = node.getElementsByTagName('a:off')[0] || node.getElementsByTagName('off')[0];
                var ext = node.getElementsByTagName('a:ext')[0] || node.getElementsByTagName('ext')[0];
                if (!off || !ext) continue;
                var x = (parseInt(off.getAttribute('x') || '0', 10) / sldCx) * 100;
                var y = (parseInt(off.getAttribute('y') || '0', 10) / sldCy) * 100;
                var w = (parseInt(ext.getAttribute('cx') || '0', 10) / sldCx) * 100;
                var h = (parseInt(ext.getAttribute('cy') || '0', 10) / sldCy) * 100;

                if (tag === 'pic') {
                  var blip = node.getElementsByTagName('a:blip')[0] || node.getElementsByTagName('blip')[0];
                  var embedId = blip ? (blip.getAttribute('r:embed') || blip.getAttribute('embed')) : null;
                  if (embedId && relMap[embedId] && zip.file(relMap[embedId])) {
                    var imgBlob = await zip.file(relMap[embedId]).async('blob');
                    var imgUrl = URL.createObjectURL(imgBlob);
                    elements.push({ type: 'pic', x: x, y: y, w: w, h: h, imgUrl: imgUrl });
                  }
                } else {
                  var phNode = node.getElementsByTagName('p:ph')[0] || node.getElementsByTagName('ph')[0];
                  var isTitleShape = phNode && (phNode.getAttribute('type') === 'title' || phNode.getAttribute('type') === 'ctrTitle');
                  var spPr = node.getElementsByTagName('p:spPr')[0] || node.getElementsByTagName('spPr')[0];
                  var fillHex = null;
                  var strokeHex = null;
                  var borderRadius = null;

                  if (spPr) {
                    var prstGeom = spPr.getElementsByTagName('a:prstGeom')[0] || spPr.getElementsByTagName('prstGeom')[0];
                    if (prstGeom) {
                      var prst = prstGeom.getAttribute('prst');
                      if (prst === 'roundRect' || prst === 'pill') {
                        var gd = prstGeom.getElementsByTagName('a:gd')[0] || prstGeom.getElementsByTagName('gd')[0];
                        var adj = 16667;
                        if (gd && gd.getAttribute('name') === 'adj') {
                          var fmla = gd.getAttribute('fmla') || '';
                          var fNum = parseInt(fmla.replace(/[^0-9]/g, ''), 10);
                          if (!isNaN(fNum)) adj = fNum;
                        }
                        var wCqh = (w / 100) * slideAspect * 100;
                        var hCqh = h;
                        var shortSide = Math.min(wCqh, hCqh);
                        if (prst === 'pill' || adj >= 40000 || (h <= 4.5 && adj >= 15000)) {
                          borderRadius = (shortSide * 0.5).toFixed(2) + 'cqh';
                        } else {
                          var rad = shortSide * (adj / 100000);
                          borderRadius = Math.max(0.4, rad).toFixed(2) + 'cqh';
                        }
                      }
                    }
                    // spPr의 직계 자식(childNodes)만 검사하여 테두리/그림자의 solidFill이 도형 배경으로 오인되는 버그 완전 방지
                    for (var k = 0; k < spPr.childNodes.length; k++) {
                      var child = spPr.childNodes[k];
                      if (child.nodeType !== 1) continue;
                      var cTag = child.localName || (child.tagName ? child.tagName.split(':').pop() : '');
                      if (cTag === 'solidFill') {
                        fillHex = extractColor(child);
                      } else if (cTag === 'gradFill') {
                        fillHex = extractGradient(child);
                      } else if (cTag === 'noFill') {
                        fillHex = 'transparent';
                      }
                    }
                    var ln = spPr.getElementsByTagName('a:ln')[0] || spPr.getElementsByTagName('ln')[0];
                    if (ln) {
                      var lnNoFill = ln.getElementsByTagName('a:noFill')[0] || ln.getElementsByTagName('noFill')[0];
                      if (!lnNoFill) {
                        strokeHex = extractColor(ln);
                      }
                    }
                    var outerShdw = spPr.getElementsByTagName('a:outerShdw')[0] || spPr.getElementsByTagName('outerShdw')[0];
                    var shadow = null;
                    if (outerShdw) {
                      var sClr = extractColor(outerShdw) || 'rgba(0,0,0,0.06)';
                      shadow = '0 4px 16px ' + sClr;
                    }
                  }

                  var cNvSpPr = node.getElementsByTagName('p:cNvSpPr')[0] || node.getElementsByTagName('cNvSpPr')[0];
                  var isTxBox = cNvSpPr && cNvSpPr.getAttribute('txBox') === '1';
                  var bodyPr = node.getElementsByTagName('a:bodyPr')[0] || node.getElementsByTagName('bodyPr')[0];
                  var wrapAttr = bodyPr ? bodyPr.getAttribute('wrap') : 'none';
                  var nowrap = wrapAttr !== 'square' && wrapAttr !== '1';
                  var anchorAttr = bodyPr ? bodyPr.getAttribute('anchor') : null;
                  var anchor = anchorAttr || (isTxBox ? 't' : 'ctr');
                  var justifyContent = 'center';
                  var alignItems = 'stretch';
                  if (anchor === 't') justifyContent = 'flex-start';
                  else if (anchor === 'b') justifyContent = 'flex-end';
                  else justifyContent = 'center';

                  var paragraphs = [];
                  var pNodes = node.getElementsByTagName('a:p');
                  if (!pNodes.length) pNodes = node.getElementsByTagName('p');
                  for (var pIdx = 0; pIdx < pNodes.length; pIdx++) {
                    var pNode = pNodes[pIdx];
                    var pPr = pNode.getElementsByTagName('a:pPr')[0] || pNode.getElementsByTagName('pPr')[0];
                    var algn = pPr ? (pPr.getAttribute('algn') || 'l') : 'l';
                    var lnSpc = pPr ? (pPr.getElementsByTagName('a:lnSpc')[0] || pPr.getElementsByTagName('lnSpc')[0]) : null;
                    var lineSpacingCqh = null;
                    if (lnSpc) {
                      var spcPts = lnSpc.getElementsByTagName('a:spcPts')[0] || lnSpc.getElementsByTagName('spcPts')[0];
                      if (spcPts && spcPts.getAttribute('val')) {
                        var pts = parseInt(spcPts.getAttribute('val'), 10) / 100;
                        lineSpacingCqh = (pts * 0.185185).toFixed(2) + 'cqh';
                      }
                    }
                    var runs = [];
                    var pChildren = pNode.childNodes || [];
                    for (var rIdx = 0; rIdx < pChildren.length; rIdx++) {
                      var cNode = pChildren[rIdx];
                      var cTag = cNode.localName || (cNode.tagName ? cNode.tagName.split(':').pop() : '');
                      if (cTag === 'br') {
                        runs.push({ isBr: true });
                        continue;
                      }
                      if (cTag === 'r') {
                        var tNode = cNode.getElementsByTagName('a:t')[0] || cNode.getElementsByTagName('t')[0];
                        if (!tNode || !tNode.textContent) continue;
                        var rPr = cNode.getElementsByTagName('a:rPr')[0] || cNode.getElementsByTagName('rPr')[0];
                        var sz = rPr && rPr.getAttribute('sz') ? (parseInt(rPr.getAttribute('sz'), 10) / 100) : 14;
                        var bold = rPr && rPr.getAttribute('b') === '1';
                        var italic = rPr && rPr.getAttribute('i') === '1';
                        var spc = rPr && rPr.getAttribute('spc') ? (parseInt(rPr.getAttribute('spc'), 10) / 100) : 0;
                        var rClrNode = rPr ? (rPr.getElementsByTagName('a:srgbClr')[0] || rPr.getElementsByTagName('srgbClr')[0]) : null;
                        var rColor = rClrNode ? extractColor(rClrNode.parentNode || rClrNode) : '#0f172a';
                        var latinNode = rPr ? (rPr.getElementsByTagName('a:latin')[0] || rPr.getElementsByTagName('latin')[0]) : null;
                        var typeface = latinNode ? latinNode.getAttribute('typeface') : null;

                        runs.push({
                          text: tNode.textContent,
                          sz: sz,
                          bold: bold,
                          italic: italic,
                          spc: spc,
                          color: rColor,
                          typeface: typeface
                        });
                      }
                    }
                    if (runs.length > 0) {
                      paragraphs.push({ algn: algn, runs: runs, lineSpacing: lineSpacingCqh });
                      var pText = runs.map(function(r) { return r.text || ''; }).join('').trim();
                      if (pText && pText.length > 1 && !pText.match(/^[0-9\/\s\.\-]+$/)) {
                        if (isTitleShape) {
                          slideTitle = pText.replace(/\s+/g, ' ');
                        } else if (!slideTitle) {
                          slideTitle = pText.replace(/\s+/g, ' ');
                        }
                      }
                    }
                  }
                  elements.push({
                    type: 'sp',
                    x: x, y: y, w: w, h: h,
                    fill: fillHex,
                    stroke: strokeHex,
                    shadow: shadow,
                    borderRadius: borderRadius,
                    nowrap: nowrap,
                    justifyContent: justifyContent,
                    alignItems: alignItems,
                    paragraphs: paragraphs
                  });
                }
              }
            }
          }
          parsedSlides.push({ bgColor: bgColor, elements: elements, title: slideTitle || ('슬라이드 ' + (i + 1)) });
        }
        return parsedSlides;
      }

      function renderDomSlide(slide) {
        domStage.innerHTML = '';
        domStage.style.background = slide.bgColor || '#ffffff';
        slide.elements.forEach(function(el) {
          var box = document.createElement('div');
          box.style.position = 'absolute';
          box.style.left = el.x + '%';
          box.style.top = el.y + '%';
          box.style.width = el.w + '%';
          box.style.height = el.h + '%';
          box.style.boxSizing = 'border-box';

          if (el.type === 'pic' && el.imgUrl) {
            var img = document.createElement('img');
            img.src = el.imgUrl;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            box.appendChild(img);
          } else {
            if (el.borderRadius) {
              box.style.borderRadius = el.borderRadius;
            } else if ((el.fill && el.fill !== 'transparent') || el.stroke) {
              box.style.borderRadius = '0.5cqh';
            }
            if (el.fill && el.fill !== 'transparent') box.style.background = el.fill;
            if (el.stroke) box.style.border = '1px solid ' + el.stroke;

            if (el.shadow) {
              box.style.boxShadow = el.shadow;
            } else if (el.fill === '#ffffff' && (el.h > 40 || el.w > 20)) {
              box.style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)';
            }

            // 부모 상자에 기본 글자 크기를 명시하여 브라우저 기본 16px 스트럿으로 인한 줄 간격 왜곡 및 글자 밀림 완전 제거
            var boxFontSz = 14;
            if (el.paragraphs && el.paragraphs.length > 0 && el.paragraphs[0].runs && el.paragraphs[0].runs.length > 0) {
              for (var rIdx = 0; rIdx < el.paragraphs[0].runs.length; rIdx++) {
                if (el.paragraphs[0].runs[rIdx].sz) {
                  boxFontSz = el.paragraphs[0].runs[rIdx].sz;
                  break;
                }
              }
            }
            box.style.fontSize = (boxFontSz * 0.185185).toFixed(2) + 'cqh';
            box.style.lineHeight = '1.15';

            box.style.display = 'flex';
            box.style.flexDirection = 'column';
            box.style.justifyContent = el.justifyContent || 'flex-start';
            box.style.alignItems = el.alignItems || 'stretch';
            box.style.overflow = 'visible';

            (el.paragraphs || []).forEach(function(p) {
              var pDiv = document.createElement('div');
              pDiv.style.display = 'block';
              pDiv.style.textAlign = p.algn === 'ctr' ? 'center' : (p.algn === 'r' ? 'right' : 'left');
              pDiv.style.whiteSpace = el.nowrap ? 'pre' : 'pre-wrap';
              pDiv.style.wordBreak = 'break-word';
              pDiv.style.width = '100%';
              
              var pFontSz = boxFontSz;
              for (var rIdx = 0; rIdx < p.runs.length; rIdx++) {
                if (p.runs[rIdx].sz) { pFontSz = p.runs[rIdx].sz; break; }
              }
              pDiv.style.fontSize = (pFontSz * 0.185185).toFixed(2) + 'cqh';
              pDiv.style.lineHeight = p.lineSpacing || '1.15';

              p.runs.forEach(function(r) {
                if (r.isBr) {
                  pDiv.appendChild(document.createElement('br'));
                  return;
                }
                var span = document.createElement('span');
                span.textContent = r.text;
                span.style.fontSize = (r.sz * 0.185185).toFixed(2) + 'cqh';
                span.style.fontWeight = r.bold ? '700' : '400';
                if (r.italic) span.style.fontStyle = 'italic';
                span.style.color = r.color;
                if (r.spc) span.style.letterSpacing = (r.spc * 0.185185).toFixed(2) + 'cqh';
                if (r.typeface) {
                  span.style.fontFamily = '"' + r.typeface + '", Consolas, "Segoe UI", sans-serif';
                } else {
                  span.style.fontFamily = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif';
                }
                pDiv.appendChild(span);
              });
              box.appendChild(pDiv);
            });
          }
          domStage.appendChild(box);
        });
      }

      async function loadPptx() {
        if (!targetUrl) {
          loadingEl.innerHTML = '<div>열람할 PPTX 파일이 지정되지 않았습니다.</div>';
          return;
        }
        try {
          var proxyUrl = toProxyUrlClient(targetUrl);
          var res = await fetch(proxyUrl);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          var arrayBuf = await res.arrayBuffer();

          fallbackSlides = await parseOoxmlSlides(arrayBuf).catch(function(e) {
            console.warn('OOXML 파싱 경고:', e);
            return [];
          });

          if (fallbackSlides.length > 0) {
            totalSlides = fallbackSlides.length;
            buildPptxToc();
            activeMode = 'dom';
            loadingEl.style.display = 'none';
            domStage.style.display = 'block';
            await showSlide(0);
            return;
          }

          if (window.PptxViewJS && window.PptxViewJS.PPTXViewer) {
            try {
              pptxViewer = new PptxViewJS.PPTXViewer({ canvas: canvas });
              await pptxViewer.loadFile(arrayBuf);
              totalSlides = pptxViewer.getSlideCount ? pptxViewer.getSlideCount() : (pptxViewer.slideCount || fallbackSlides.length || 1);
              buildPptxToc();
              var dims = pptxViewer.getSlideDimensions ? pptxViewer.getSlideDimensions() : null;
              if (dims && dims.cx && dims.cy) {
                canvas.width = 1280;
                canvas.height = Math.round(1280 * (dims.cy / dims.cx));
              }
              activeMode = 'canvas';
              loadingEl.style.display = 'none';
              canvas.style.display = 'block';
              await showSlide(0);
              return;
            } catch (viewerErr) {
              console.warn('PptxViewJS 초기화 실패:', viewerErr);
            }
          }

          throw new Error('슬라이드를 파싱할 수 없습니다.');
        } catch (err) {
          console.error('PPTX 로드 오류:', err);
          loadingEl.innerHTML = '<div style="color:#f97316;font-weight:bold;">⚠️ PowerPoint 문서를 불러올 수 없습니다.</div><div style="font-size:12px;margin-top:6px;color:#94a3b8;">' + String(err && err.message ? err.message : err) + '</div>';
        }
      }

      loadPptx();
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  SUPPORTED_FORMATS,
  getFileFormat,
  renderPdfViewer,
  renderMarkdownViewer,
  renderPptxViewer
};
