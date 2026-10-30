const { escapeHtml, safeJsonForScript } = require('./utils');

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
      width: 0px;
      min-width: 0px;
      background: #0f172a;
      border-right: 0px solid #1e293b;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1), border-right-width 0.22s ease;
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

module.exports = { renderPptxViewer };
