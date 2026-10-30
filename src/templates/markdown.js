const { escapeHtml, safeJsonForScript } = require('./utils');

// 2. 마크다운 뷰어 (Marked.js + Highlight.js + 조건부 Mermaid.js 기반)
function renderMarkdownViewer(rawMarkdown, fileTitle, serverOrigin, targetUrl, discordClientId) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileTitle || 'Markdown 뷰어')} - Discord Viewer</title>
  <link id="theme-md-dark" rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.5.1/github-markdown-dark.min.css">
  <link id="theme-md-light" rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.5.1/github-markdown-light.min.css" disabled>
  <link id="theme-hljs-dark" rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css">
  <link id="theme-hljs-light" rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css" disabled>
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
      transition: background 0.2s ease, color 0.2s ease;
    }
    body.theme-light {
      background: #ffffff;
      color: #1f2328;
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
      transition: background 0.2s ease, border-color 0.2s ease;
    }
    body.theme-light #md-toolbar {
      background: rgba(255, 255, 255, 0.95);
      border-bottom-color: #d0d7de;
      color: #1f2328;
    }
    .md-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      font-weight: 600;
      overflow: hidden;
    }
    .md-title-text {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .md-badge {
      background: #238636;
      color: white;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .theme-toggle-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      user-select: none;
      flex-shrink: 0;
    }
    .theme-toggle-btn:hover {
      background: #30363d;
      border-color: #8b949e;
      color: #ffffff;
    }
    body.theme-light .theme-toggle-btn {
      background: #f6f8fa;
      border-color: #d0d7de;
      color: #24292f;
    }
    body.theme-light .theme-toggle-btn:hover {
      background: #eaeef2;
      border-color: #afb8c1;
    }
    .content-wrapper {
      max-width: 920px;
      margin: 0 auto;
      padding: 36px 24px 80px;
    }
    .markdown-body {
      background: transparent !important;
      font-size: 15px;
      line-height: 1.7;
      transition: color 0.2s ease;
    }
    body:not(.theme-light) .markdown-body {
      color: #c9d1d9 !important;
    }
    body.theme-light .markdown-body {
      color: #1f2328 !important;
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
      transition: opacity 0.2s, background 0.2s, color 0.2s;
    }
    .copy-btn:hover { opacity: 1; background: #30363d; }
    body.theme-light .copy-btn {
      background: #f6f8fa;
      border-color: #d0d7de;
      color: #24292f;
    }
    body.theme-light .copy-btn:hover {
      background: #eaeef2;
    }
    pre { position: relative; }
    .mermaid {
      background: rgba(22, 27, 34, 0.8);
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
      display: flex;
      justify-content: center;
      overflow-x: auto;
      transition: background 0.2s ease;
    }
    body.theme-light .mermaid {
      background: rgba(246, 248, 250, 0.8);
      border: 1px solid #d0d7de;
    }
  </style>
</head>
<body>
  <div id="md-toolbar">
    <div class="md-meta">
      <span class="md-badge">Markdown</span>
      <span class="md-title-text">${escapeHtml(fileTitle || '문서')}</span>
      <button id="theme-toggle-btn" class="theme-toggle-btn" title="다크 / 라이트 모드 전환">
        <span id="theme-icon">☀️</span>
        <span id="theme-label">라이트 모드</span>
      </button>
    </div>
  </div>

  <div class="content-wrapper">
    <article id="markdown-container" class="markdown-body"></article>
  </div>

  <script>
    (function() {
      var rawText = ${safeJsonForScript(rawMarkdown || '')};
      var container = document.getElementById('markdown-container');
      var mdDark = document.getElementById('theme-md-dark');
      var mdLight = document.getElementById('theme-md-light');
      var hljsDark = document.getElementById('theme-hljs-dark');
      var hljsLight = document.getElementById('theme-hljs-light');
      var toggleBtn = document.getElementById('theme-toggle-btn');
      var themeIcon = document.getElementById('theme-icon');
      var themeLabel = document.getElementById('theme-label');

      // 1. 테마 전환 및 환경 기억 (localStorage)
      var currentTheme = 'dark';
      try {
        var savedTheme = window.localStorage ? window.localStorage.getItem('__md_theme') : null;
        if (savedTheme === 'light' || savedTheme === 'dark') currentTheme = savedTheme;
      } catch (e) {}

      function applyTheme(theme) {
        currentTheme = theme;
        var isLight = theme === 'light';
        if (isLight) {
          document.body.classList.add('theme-light');
          if (mdDark) mdDark.disabled = true;
          if (mdLight) mdLight.disabled = false;
          if (hljsDark) hljsDark.disabled = true;
          if (hljsLight) hljsLight.disabled = false;
          if (themeIcon) themeIcon.textContent = '🌙';
          if (themeLabel) themeLabel.textContent = '다크 모드';
        } else {
          document.body.classList.remove('theme-light');
          if (mdDark) mdDark.disabled = false;
          if (mdLight) mdLight.disabled = true;
          if (hljsDark) hljsDark.disabled = false;
          if (hljsLight) hljsLight.disabled = true;
          if (themeIcon) themeIcon.textContent = '☀️';
          if (themeLabel) themeLabel.textContent = '라이트 모드';
        }
        try {
          if (window.localStorage) window.localStorage.setItem('__md_theme', theme);
        } catch (e) {}
      }

      applyTheme(currentTheme);

      if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
          e.preventDefault();
          var nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
          applyTheme(nextTheme);
        });
      }

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
            mermaid.initialize({ startOnLoad: false, theme: currentTheme === 'light' ? 'default' : 'dark' });
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
