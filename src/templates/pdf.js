const { escapeHtml, safeJsonForScript } = require('./utils');

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

module.exports = { renderPdfViewer };
