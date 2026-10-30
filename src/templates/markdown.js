const { escapeHtml, safeJsonForScript } = require('./utils');

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

module.exports = { renderMarkdownViewer };
