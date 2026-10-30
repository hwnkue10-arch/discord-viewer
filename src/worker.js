/**
 * Cloudflare Workers 기반 100% 무(無)서버 Discord In-App Activity & Multi-Format Viewer
 * - 상시 실행 서버 0개 (비용 0원, 컴퓨터 꺼도 24시간 작동)
 * - 디스코드 Interactions HTTP Webhook 수신 (Ed25519 서명 검증)
 * - HTML, PDF, Markdown, PPTX 실시간 에지 렌더러
 */

import {
  SUPPORTED_FORMATS,
  getFileFormat,
  renderPdfViewer,
  renderMarkdownViewer,
  renderPptxViewer
} from './templates/index.js';

const FORMAT_META = {
  html: { icon: '📄', label: 'HTML 웹페이지', color: 0x38bdf8 },
  pdf:  { icon: '📑', label: 'PDF 문서', color: 0xf43f5e },
  md:   { icon: '📝', label: 'Markdown 문서', color: 0x10b981 },
  pptx: { icon: '📊', label: 'PowerPoint 슬라이드', color: 0xf97316 }
};

// 이용약관 및 개인정보 처리방침 공통 HTML 렌더러
function renderLegalPage(title, lastUpdated, sections) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${title} - Doc Viewer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0f172a;
      color: #cbd5e1;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.7;
      padding: 40px 20px;
      display: flex;
      justify-content: center;
    }
    .container {
      max-width: 760px;
      width: 100%;
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 36px 32px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    }
    h1 {
      color: #38bdf8;
      font-size: 22px;
      margin-bottom: 8px;
    }
    .date {
      color: #94a3b8;
      font-size: 13px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    h2 {
      color: #f1f5f9;
      font-size: 16px;
      margin: 22px 0 8px;
    }
    p, ul {
      font-size: 14px;
      margin-bottom: 12px;
    }
    ul {
      padding-left: 20px;
    }
    li {
      margin-bottom: 6px;
    }
    a {
      color: #38bdf8;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 12px;
      color: #64748b;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>\${title}</h1>
    <div class="date">최종 수정일: \${lastUpdated}</div>
    \${sections}
    <div class="footer">
      © 2026 Doc Viewer (Discord In-App Multi-Format Viewer). All rights reserved.
    </div>
  </div>
</body>
</html>`;
}

// 16진수 문자열을 Uint8Array로 변환
function hexToUint8Array(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Discord Ed25519 요청 서명 검증
async function verifyDiscordSignature(rawBody, signature, timestamp, clientPublicKey) {
  if (!signature || !timestamp || !clientPublicKey) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToUint8Array(clientPublicKey),
      { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
      false,
      ['verify']
    );
    const enc = new TextEncoder();
    const data = enc.encode(timestamp + rawBody);
    return await crypto.subtle.verify(
      'NODE-ED25519',
      key,
      hexToUint8Array(signature),
      data
    );
  } catch (e) {
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        hexToUint8Array(clientPublicKey),
        { name: 'Ed25519' },
        false,
        ['verify']
      );
      const enc = new TextEncoder();
      const data = enc.encode(timestamp + rawBody);
      return await crypto.subtle.verify(
        'Ed25519',
        key,
        hexToUint8Array(signature),
        data
      );
    } catch (err2) {
      return false;
    }
  }
}

// SSRF 방지 검사 함수 (로컬호스트, 사설망 IP, IPv6 로컬 및 클라우드 메타데이터 주소 차단)
function isBlockedTarget(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) return true;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '0:0:0:0:0:0:0:1' ||
      host.startsWith('fe80:') ||
      host.startsWith('fc00:') ||
      host.startsWith('fd00:') ||
      host === 'metadata.google.internal' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return true;
    }
    const parts = host.split('.');
    if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
      const p0 = parseInt(parts[0], 10);
      const p1 = parseInt(parts[1], 10);
      if (p0 === 0 || p0 === 10 || p0 === 127) return true;
      if (p0 === 169 && p1 === 254) return true;
      if (p0 === 192 && p1 === 168) return true;
      if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
    }
    return false;
  } catch (e) {
    return true;
  }
}

// 프록시 Content-Type 화이트리스트 및 위험 확장자 검사
const BLOCKED_EXTENSIONS = /\.(exe|msi|bat|cmd|sh|dll|scr|com|vbs|ps1)(\?|$)/i;
const ALLOWED_MIME_PREFIXES = ['text/', 'image/', 'audio/', 'video/', 'font/'];
const ALLOWED_EXACT_MIMES = new Set([
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'text/javascript',
  'application/json',
  'application/ld+json',
  'application/manifest+json',
  'application/wasm',
  'application/xml',
  'text/xml',
  'application/xhtml+xml',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/font-woff',
  'application/font-woff2',
  'application/x-font-ttf',
  'application/x-font-opentype',
  'application/vnd.ms-fontobject',
  'application/font-sfnt',
  'application/octet-stream'
]);

function resolveSafeContentType(rawContentType, assetUrl) {
  let pathname = '';
  try {
    pathname = new URL(assetUrl).pathname.toLowerCase();
  } catch (e) {
    pathname = String(assetUrl).toLowerCase();
  }
  if (BLOCKED_EXTENSIONS.test(pathname)) {
    return { allowed: false, contentType: 'application/octet-stream' };
  }

  let ct = (rawContentType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (pathname.endsWith('.woff2')) ct = 'font/woff2';
  else if (pathname.endsWith('.woff')) ct = 'font/woff';
  else if (pathname.endsWith('.ttf')) ct = 'font/ttf';
  else if (pathname.endsWith('.otf')) ct = 'font/otf';
  else if (pathname.endsWith('.css')) ct = 'text/css; charset=utf-8';
  else if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) ct = 'application/javascript; charset=utf-8';
  else if (pathname.endsWith('.json')) ct = 'application/json; charset=utf-8';
  else if (pathname.endsWith('.svg')) ct = 'image/svg+xml';
  else if (pathname.endsWith('.wasm')) ct = 'application/wasm';
  else if (pathname.endsWith('.pdf')) ct = 'application/pdf';
  else if (pathname.endsWith('.pptx')) ct = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  else if (pathname.endsWith('.md') || pathname.endsWith('.markdown')) ct = 'text/markdown; charset=utf-8';
  else if (pathname.endsWith('.bcmap') || pathname.endsWith('.pfb')) ct = 'application/octet-stream';

  const baseMime = ct.split(';')[0].trim();
  const isPrefixAllowed = ALLOWED_MIME_PREFIXES.some((prefix) => baseMime.startsWith(prefix));
  const isExactAllowed = ALLOWED_EXACT_MIMES.has(baseMime);

  return {
    allowed: isPrefixAllowed || isExactAllowed,
    contentType: rawContentType && !pathname.match(/\.(woff2?|ttf|otf|css|m?js|svg|wasm|pdf|pptx|md|markdown|bcmap|pfb)$/i) ? rawContentType : ct
  };
}

// 스트리밍 바이트 상한 리더 (Content-Length 헤더가 없는 청크 응답도 15MB 초과 시 즉시 중단)
const MAX_PROXY_BYTES = 15 * 1024 * 1024;
async function readResponseWithLimit(response, maxBytes = MAX_PROXY_BYTES) {
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    const err = new Error('Payload Too Large');
    err.status = 413;
    throw err;
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buf = await response.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      const err = new Error('Payload Too Large');
      err.status = 413;
      throw err;
    }
    return new Uint8Array(buf);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch (e) {}
      const err = new Error('Payload Too Large');
      err.status = 413;
      throw err;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

// 경로 보존형 프록시 URL 생성 함수 (상대 경로 import "./sub.js"가 프록시 안에서 그대로 동작하도록 경로 보존)
function toProxyUrl(absUrl) {
  try {
    const u = new URL(absUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return absUrl;
    const proto = u.protocol.replace(':', '');
    return `/api/proxy/${proto}/${u.host}${u.pathname}${u.search}`.replace(/'/g, '%27').replace(/"/g, '%22');
  } catch (e) {
    return `/api/asset-proxy?url=${encodeURIComponent(absUrl)}`;
  }
}

// 프록시 요청으로부터 원본 대상 URL 역추출 함수
function extractTargetUrl(requestUrl, req) {
  const u = new URL(requestUrl, 'http://localhost');
  if (u.pathname.startsWith('/api/proxy/')) {
    const match = u.pathname.match(/^\/api\/proxy\/(https?)\/([^\/]+)(?:\/(.*))?$/i);
    if (match) {
      const proto = match[1];
      const host = match[2];
      const rest = match[3] ? '/' + match[3] : '';
      return `${proto}://${host}${rest}${u.search}`;
    }
  }
  if (u.pathname === '/api/asset-proxy') {
    return req && req.query ? req.query.url : u.searchParams.get('url');
  }
  return null;
}

// CSS 텍스트 내 @import 및 url(...)을 경로 보존형 프록시 주소로 재귀 변환
function rewriteCssText(cssText, baseUrl) {
  let result = cssText.replace(
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*;?/gi,
    (m, q1, u1, q2, u2) => {
      const rawUrl = (u1 || u2 || '').trim();
      if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('/api/')) return m;
      try {
        const abs = baseUrl ? new URL(rawUrl, baseUrl).href : new URL(rawUrl).href;
        return `@import url('${toProxyUrl(abs)}');`;
      } catch (e) {
        return m;
      }
    }
  );

  result = result.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, relUrl) => {
    const trimmed = relUrl.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('#') || trimmed.startsWith('/api/')) {
      return m;
    }
    try {
      const fullCandidate = trimmed.startsWith('//') ? 'https:' + trimmed : trimmed;
      const abs = baseUrl ? new URL(fullCandidate, baseUrl).href : new URL(fullCandidate).href;
      return `url('${toProxyUrl(abs)}')`;
    } catch (e) {
      return m;
    }
  });

  return result;
}

// 지원하는 인라인 이벤트 목록
const INLINE_EVENTS = [
  'click', 'dblclick', 'mousedown', 'mouseup', 'mouseover', 'mouseout', 'mousemove', 'mouseenter', 'mouseleave', 'contextmenu',
  'keydown', 'keyup', 'keypress',
  'focus', 'blur', 'change', 'input', 'submit', 'reset', 'select',
  'touchstart', 'touchend', 'touchmove',
  'load', 'error', 'scroll', 'wheel', 'animationend', 'transitionend'
];

// eval()이나 new Function() 없이 순수 addEventListener 코드를 생성하는 CSP 완전 무결 이벤트 리스너 생성기
function buildGeneratedListenersScript(listenerEntries) {
  if (!listenerEntries || listenerEntries.length === 0) return '';
  const codeLines = [];
  for (const item of listenerEntries) {
    const safeCode = item.code.replace(/<\/script/gi, '<\\/script');
    codeLines.push(`    (function() {
      var el = document.querySelector('[data-aid-${item.event}="${item.aid}"]');
      if (el) {
        el.addEventListener('${item.event}', function(event) {
          var __res = (function(event) {
            ${safeCode}
          }).call(this, event);
          if (__res === false) {
            event.preventDefault();
          }
        });
      }
    })();`);
  }

  return `<script id="discord-generated-event-listeners">
(function() {
  function initListeners() {
${codeLines.join('\n')}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initListeners);
  } else {
    initListeners();
  }
})();
</script>`;
}

// 런타임 심(Shim) 스크립트: fetch, XHR, 동적 DOM 생성, 스토리지 폴백 + 내장 Discord Activity RPC (OPEN_EXTERNAL_LINK)
function buildRuntimeShimScript(discordClientId) {
  return `<script id="discord-activity-runtime-shim">
(function() {
  function abs(u) {
    try { return new URL(u, document.baseURI).href; } catch(e) { return null; }
  }
  function ext(u) {
    var a = abs(u);
    return (a && /^https?:/i.test(a) && new URL(a).origin !== location.origin) ? a : null;
  }
  function wrap(u) {
    if (typeof u !== 'string') return u;
    if (u.startsWith('/api/') || u.startsWith('data:') || u.startsWith('blob:')) return u;
    var a = ext(u);
    if (!a) return u;
    try {
      var parsed = new URL(a);
      var proto = parsed.protocol.replace(':', '');
      return '/api/proxy/' + proto + '/' + parsed.host + parsed.pathname + parsed.search;
    } catch(err) {
      return '/api/asset-proxy?url=' + encodeURIComponent(a);
    }
  }

  // 1. fetch 및 XMLHttpRequest 가로채기 (런타임 API 호출 CSP 우회)
  var _fetch = window.fetch;
  if (_fetch) {
    window.fetch = function(input, init) {
      if (typeof input === 'string' || input instanceof URL) {
        return _fetch.call(this, wrap(String(input)), init);
      } else if (input && input.url) {
        return _fetch.call(this, new Request(wrap(input.url), input), init);
      }
      return _fetch.call(this, input, init);
    };
  }
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var rest = Array.prototype.slice.call(arguments, 2);
    return _open.apply(this, [method, wrap(String(url))].concat(rest));
  };

  // 2. 동적 DOM 에셋 생성 가로채기 (new Image(), createElement('script') 등)
  function patch(proto, prop) {
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if (d && d.set) {
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: d.enumerable,
        get: d.get,
        set: function(v) { d.set.call(this, wrap(String(v))); }
      });
    }
  }
  if (window.HTMLImageElement) patch(HTMLImageElement.prototype, 'src');
  if (window.HTMLScriptElement) patch(HTMLScriptElement.prototype, 'src');
  if (window.HTMLLinkElement) patch(HTMLLinkElement.prototype, 'href');
  if (window.HTMLMediaElement) patch(HTMLMediaElement.prototype, 'src');
  if (window.HTMLSourceElement) patch(HTMLSourceElement.prototype, 'src');

  var _sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, val) {
    if (/^(src|href|poster)$/i.test(name) && /^(IMG|SCRIPT|LINK|VIDEO|AUDIO|SOURCE)$/.test(this.tagName)) {
      val = wrap(String(val));
    }
    return _sa.call(this, name, val);
  };

  // 3. iframe 샌드박스 내 Storage 차단 대응 (인메모리 안전 폴백)
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
  } catch (e) {
    var createMemStore = function() {
      var store = {};
      return {
        getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem: function(k, v) { store[k] = String(v); },
        removeItem: function(k) { delete store[k]; },
        clear: function() { store = {}; },
        key: function(i) { return Object.keys(store)[i] || null; },
        get length() { return Object.keys(store).length; }
      };
    };
    try {
      Object.defineProperty(window, 'localStorage', { value: createMemStore(), configurable: true });
      Object.defineProperty(window, 'sessionStorage', { value: createMemStore(), configurable: true });
    } catch(err) {}
  }

  // 4. 모달 다이얼로그 폴백 (디스코드 팝업 내 멈춤 방지)
  window.alert = function(msg) { console.log('[Alert]', msg); };
  window.confirm = function(msg) { console.log('[Confirm]', msg); return true; };
  window.prompt = function(msg, def) { console.log('[Prompt]', msg); return def || null; };

  // 5. 내장 Discord Embedded App SDK RPC 프로토콜 (외부 CDN 의존성 0개)
  var cid = '${discordClientId || ''}';
  var urlParams = new URLSearchParams(window.location.search);
  var frameId = urlParams.get('frame_id') || '';
  try {
    if (frameId) window.sessionStorage.setItem('__discord_frame_id', frameId);
    else frameId = window.sessionStorage.getItem('__discord_frame_id') || '';
  } catch (e) {}
  var inActivityIframe = (window.self !== window.top) && (!!frameId || /\\.discordsays\\.com$/i.test(window.location.hostname));
  var rpcSource = (window.parent && window.parent.opener) ? window.parent.opener : window.parent;

  function makeNonce() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function postRpcMessage(payload) {
    try {
      if (rpcSource) rpcSource.postMessage(payload, '*');
      if (window.top && window.top !== rpcSource && window.top !== window.self) {
        window.top.postMessage(payload, '*');
      }
    } catch (err) {}
  }

  if (inActivityIframe) {
    // Opcode 0: HANDSHAKE
    postRpcMessage([0, {
      v: 1,
      encoding: 'json',
      client_id: cid || 'discord-activity',
      frame_id: frameId,
      sdk_version: '1.8.0'
    }]);
  }

  function copyLinkWithToast(targetUrl) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(targetUrl).catch(function() {});
      } else {
        var ta = document.createElement('textarea');
        ta.value = targetUrl;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch (e) {}

    var existing = document.getElementById('discord-external-link-toast');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var toast = document.createElement('div');
    toast.id = 'discord-external-link-toast';
    toast.style.cssText = 'position:fixed;top:52px;right:10px;z-index:2147483647;background:rgba(15,23,42,0.96);backdrop-filter:blur(8px);border:1px solid rgba(56,189,248,0.45);color:#f8fafc;padding:10px 14px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,0.5);max-width:340px;line-height:1.5;';
    toast.innerHTML = '<div style="font-weight:700;color:#38bdf8;margin-bottom:4px;">🌐 새 창 열기 요청 & 링크 복사 완료!</div><div style="color:#cbd5e1;font-size:11px;word-break:break-all;">디스코드 팝업이 뜨지 않으면 브라우저 주소창에 <b>Ctrl+V</b>로 바로 붙여넣으세요.</div>';
    (document.body || document.documentElement).appendChild(toast);
    setTimeout(function() {
      if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
    }, 5000);
  }

  function sendOpenExternalLink(targetUrl) {
    return new Promise(function(resolve, reject) {
      if (!inActivityIframe) {
        reject(new Error('Not in Discord Activity iframe'));
        return;
      }
      try {
        var nonce = makeNonce();
        // Opcode 1: FRAME (OPEN_EXTERNAL_LINK)
        postRpcMessage([1, {
          cmd: 'OPEN_EXTERNAL_LINK',
          args: { url: targetUrl },
          nonce: nonce
        }]);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  if (!window.discordSdk) {
    window.discordSdk = {
      commands: {
        openExternalLink: function(opts) {
          return sendOpenExternalLink(opts && opts.url ? opts.url : String(opts));
        }
      }
    };
  }

  window.__discordOpenExternal = function(targetUrl) {
    if (inActivityIframe) {
      copyLinkWithToast(targetUrl);
      sendOpenExternalLink(targetUrl).catch(function() {
        try { window.open(targetUrl, '_blank', 'noopener,noreferrer'); } catch (e) {}
      });
    } else {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  document.addEventListener('click', function(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.id === 'discord-helper-external-btn') return;
    var href = a.getAttribute('href');
    if (href && /^https?:/i.test(href) && !href.startsWith('/api/')) {
      var full = abs(href);
      if (full && (new URL(full).origin !== location.origin || a.getAttribute('target') === '_blank')) {
        if (inActivityIframe) {
          e.preventDefault();
          window.__discordOpenExternal(full);
        }
      }
    }
  }, true);

  // 6. CSP 위반 감지 배너 (인라인 onclick 없이 순수 DOM 이벤트 바인딩)
  document.addEventListener('securitypolicyviolation', function(e) {
    console.warn('[Discord CSP Blocked]', e.blockedURI, 'directive:', e.violatedDirective);
    var banner = document.getElementById('discord-csp-warning-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'discord-csp-warning-banner';
      banner.style.cssText = 'position:fixed;bottom:10px;left:50%;transform:translateX(-50%);z-index:2147483646;background:rgba(239,68,68,0.92);backdrop-filter:blur(6px);color:white;padding:6px 14px;border-radius:20px;font-size:12px;font-family:sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;gap:8px;';
      var textSpan = document.createElement('span');
      textSpan.textContent = '⚠️ 일부 외부 기능이 디스코드 보안에 의해 차단되었습니다.';
      var closeBtn = document.createElement('button');
      closeBtn.style.cssText = 'background:white;color:#ef4444;border:none;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:bold;cursor:pointer;';
      closeBtn.textContent = '닫기';
      closeBtn.addEventListener('click', function() {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
      });
      banner.appendChild(textSpan);
      banner.appendChild(closeBtn);
      (document.body || document.documentElement).appendChild(banner);
    }
  });
})();
</script>`;
}

// 플로팅 헬퍼 바 생성 (새 창 버튼 제거, 접기/펼치기 원클릭 토글 버튼 제공)
function buildHelperBar(fileTitle, directUrl) {
  return `
<div id="discord-activity-helper-bar" style="position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;align-items:center;gap:6px;background:rgba(15,23,42,0.92);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.18);padding:4px 10px;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#f1f5f9;box-shadow:0 4px 16px rgba(0,0,0,0.4);user-select:none;">
  <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;"></span>
  <span style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${fileTitle}</span>
  <button id="discord-helper-switch-btn" style="background:#059669;color:white;border:none;border-radius:10px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;transition:background 0.2s;" title="채널 내 다른 문서로 즉시 전환">📂 파일 전환</button>
  <button id="discord-helper-refresh-btn" style="background:#4f46e5;color:white;border:none;border-radius:10px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;transition:background 0.2s;">🔄 새로고침</button>
  <button id="discord-helper-close-btn" style="background:transparent;color:#94a3b8;border:none;padding:2px 6px;font-size:11px;font-weight:600;cursor:pointer;line-height:1;" title="도구 모음 접기">− 접기</button>
</div>
<button id="discord-helper-launcher-btn" style="display:none;position:fixed;top:10px;right:10px;z-index:2147483647;align-items:center;gap:5px;background:rgba(15,23,42,0.92);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.22);padding:5px 11px;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;color:#38bdf8;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.4);cursor:pointer;user-select:none;transition:all 0.2s;" title="도구 모음 열기">
  <span>📂 파일 도구 ▾</span>
</button>
<div id="discord-file-switcher-modal" style="display:none;position:fixed;top:46px;right:10px;z-index:2147483647;background:rgba(15,23,42,0.96);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.18);padding:12px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,0.6);width:310px;max-height:420px;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#f1f5f9;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);">
    <strong style="color:#38bdf8;font-size:13px;">📂 채널 내 최근 문서 선택</strong>
    <button id="discord-switcher-close-btn" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:12px;">✕</button>
  </div>
  <div id="discord-switcher-list" style="display:flex;flex-direction:column;gap:6px;">
    <div style="color:#94a3b8;text-align:center;padding:12px 0;">목록을 불러오는 중...</div>
  </div>
</div>
<script id="discord-helper-bar-script">
(function() {
  var bar = document.getElementById('discord-activity-helper-bar');
  var refreshBtn = document.getElementById('discord-helper-refresh-btn');
  var closeBtn = document.getElementById('discord-helper-close-btn');
  var launcherBtn = document.getElementById('discord-helper-launcher-btn');
  var switchBtn = document.getElementById('discord-helper-switch-btn');
  var switchModal = document.getElementById('discord-file-switcher-modal');
  var switchClose = document.getElementById('discord-switcher-close-btn');
  var switchList = document.getElementById('discord-switcher-list');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', function(e) {
      e.preventDefault();
      window.location.reload();
    });
  }
  if (closeBtn && bar && launcherBtn) {
    closeBtn.addEventListener('click', function(e) {
      e.preventDefault();
      bar.style.display = 'none';
      launcherBtn.style.display = 'inline-flex';
      if (switchModal) switchModal.style.display = 'none';
    });
  }
  if (launcherBtn && bar) {
    launcherBtn.addEventListener('click', function(e) {
      e.preventDefault();
      launcherBtn.style.display = 'none';
      bar.style.display = 'flex';
    });
  }

  if (switchBtn && switchModal) {
    switchBtn.addEventListener('click', function(e) {
      e.preventDefault();
      if (switchModal.style.display === 'none' || !switchModal.style.display) {
        switchModal.style.display = 'block';
        loadChannelFiles();
      } else {
        switchModal.style.display = 'none';
      }
    });
  }

  if (switchClose && switchModal) {
    switchClose.addEventListener('click', function(e) {
      e.preventDefault();
      switchModal.style.display = 'none';
    });
  }

  function loadChannelFiles() {
    var params = new URLSearchParams(window.location.search);
    var chanId = params.get('channel_id');
    if (!chanId) {
      switchList.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:10px;">채널 정보를 확인할 수 없습니다.</div>';
      return;
    }
    fetch('/api/channel-files?channel_id=' + encodeURIComponent(chanId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var files = data.files || [];
        if (!files.length) {
          switchList.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:10px;">채널에 지원되는 문서가 없습니다.</div>';
          return;
        }
        var icons = { html: '📄', pdf: '📑', pptx: '📊', md: '📝' };
        var colors = { html: '#38bdf8', pdf: '#f43f5e', pptx: '#f97316', md: '#10b981' };
        var html = '';
        files.forEach(function(f) {
          var icon = icons[f.format] || '📄';
          var color = colors[f.format] || '#38bdf8';
          var sizeKb = (f.size / 1024).toFixed(1);
          html += '<div class="discord-switcher-item" data-url="' + encodeURIComponent(f.url) + '" data-title="' + encodeURIComponent(f.name) + '" style="background:rgba(30,41,59,0.7);border:1px solid rgba(255,255,255,0.08);padding:8px 10px;border-radius:8px;cursor:pointer;transition:background 0.15s;display:flex;align-items:center;justify-content:space-between;gap:8px;">';
          html += '  <div style="overflow:hidden;">';
          html += '    <div style="font-weight:600;color:#f8fafc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px;">' + icon + ' ' + f.name + '</div>';
          html += '    <div style="font-size:10px;color:#94a3b8;margin-top:2px;">' + f.author + ' · ' + sizeKb + ' KB</div>';
          html += '  </div>';
          html += '  <span style="background:' + color + ';color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:bold;flex-shrink:0;">' + (f.format ? f.format.toUpperCase() : 'DOC') + '</span>';
          html += '</div>';
        });
        switchList.innerHTML = html;

        var items = switchList.querySelectorAll('.discord-switcher-item');
        items.forEach(function(item) {
          item.addEventListener('mouseenter', function() { item.style.background = 'rgba(51,65,85,0.9)'; });
          item.addEventListener('mouseleave', function() { item.style.background = 'rgba(30,41,59,0.7)'; });
          item.addEventListener('click', function() {
            var fileUrl = decodeURIComponent(item.getAttribute('data-url'));
            var fileTitle = decodeURIComponent(item.getAttribute('data-title'));
            var newUrl = new URL(window.location.href);
            newUrl.searchParams.set('cdn_url', fileUrl);
            newUrl.searchParams.set('title', fileTitle);
            newUrl.searchParams.set('_t', Date.now());
            window.location.href = newUrl.toString();
          });
        });
      })
      .catch(function(err) {
        switchList.innerHTML = '<div style="color:#f43f5e;text-align:center;padding:10px;">문서 목록을 가져올 수 없습니다.</div>';
      });
  }
})();
</script>`;
}

// Cloudflare Workers HTMLRewriter 핸들러 클래스군 (경로 보존형 toProxyUrl 적용)
class ElementProxyRewriter {
  constructor(attrName) {
    this.attrName = attrName;
  }
  element(el) {
    const val = el.getAttribute(this.attrName);
    if (!val) return;
    const trimmed = val.trim();
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('#') || trimmed.startsWith('/api/')) {
      return;
    }
    if (/^(https?:)?\/\//i.test(trimmed)) {
      const fullUrl = trimmed.startsWith('//') ? 'https:' + trimmed : trimmed;
      el.setAttribute(this.attrName, toProxyUrl(fullUrl));
      if (el.hasAttribute('integrity')) el.removeAttribute('integrity');
      if (el.hasAttribute('crossorigin')) el.removeAttribute('crossorigin');
    }
  }
}

class SrcsetProxyRewriter {
  element(el) {
    const srcset = el.getAttribute('srcset');
    if (!srcset) return;
    const parts = srcset.split(',');
    const rewritten = parts.map((part) => {
      const trimmed = part.trim();
      const match = trimmed.match(/^(\S+)(\s+.*)?$/);
      if (!match) return part;
      let url = match[1];
      const descriptor = match[2] || '';
      if (/^(https?:)?\/\//i.test(url) && !url.startsWith('/api/')) {
        const full = url.startsWith('//') ? 'https:' + url : url;
        url = toProxyUrl(full);
      }
      return `${url}${descriptor}`;
    }).join(', ');
    el.setAttribute('srcset', rewritten);
  }
}

class InlineStyleProxyRewriter {
  element(el) {
    const style = el.getAttribute('style');
    if (!style || !style.includes('url(')) return;
    el.setAttribute('style', rewriteCssText(style, null));
  }
}

class StyleTagProxyRewriter {
  constructor() {
    this.buffer = '';
  }
  text(chunk) {
    this.buffer += chunk.text;
    if (chunk.lastInTextNode) {
      const rewritten = rewriteCssText(this.buffer, null);
      chunk.replace(rewritten, { html: true });
      this.buffer = '';
    } else {
      chunk.remove();
    }
  }
}

class HeadInjector {
  constructor(html) {
    this.html = html;
  }
  element(el) {
    el.prepend(this.html, { html: true });
  }
}

// 스트리밍 HTMLRewriter 기반 디스코드 액티비티 렌더러 (순수 addEventListener + 내장 Discord RPC 연동)
function renderHtmlForDiscordActivity(rawHtml, fileTitle, workerOrigin, targetUrl, discordClientId) {
  let normalizedHtml = rawHtml;
  const hasHead = /<head\b/i.test(normalizedHtml);
  const hasBody = /<body\b/i.test(normalizedHtml);

  if (!hasHead && !hasBody) {
    normalizedHtml = `<!DOCTYPE html><html><head></head><body>${normalizedHtml}</body></html>`;
  } else if (!hasHead) {
    if (/<html\b[^>]*>/i.test(normalizedHtml)) {
      normalizedHtml = normalizedHtml.replace(/<html\b[^>]*>/i, '$&<head></head>');
    } else {
      normalizedHtml = `<head></head>` + normalizedHtml;
    }
  } else if (!hasBody) {
    normalizedHtml = normalizedHtml + `<body></body>`;
  }

  const directUrl = `${workerOrigin}/?cdn_url=${encodeURIComponent(targetUrl)}&title=${encodeURIComponent(fileTitle)}&_t=${Date.now()}`;
  const helperBar = buildHelperBar(fileTitle, directUrl);

  const listenerEntries = [];
  let aidCounter = 0;

  class InlineEventRewriter {
    element(el) {
      for (const ev of INLINE_EVENTS) {
        const attr = 'on' + ev;
        if (el.hasAttribute(attr)) {
          const code = el.getAttribute(attr);
          if (code && code.trim()) {
            aidCounter++;
            el.setAttribute('data-aid-' + ev, String(aidCounter));
            listenerEntries.push({ aid: aidCounter, event: ev, code: code });
          }
          el.removeAttribute(attr);
        }
      }
    }
  }

  class BodyEndInjector {
    element(el) {
      el.onEndTag((endTag) => {
        const generatedScript = buildGeneratedListenersScript(listenerEntries);
        const payload = `\n${generatedScript}\n${helperBar}\n`;
        endTag.before(payload, { html: true });
      });
    }
  }

  const headPayload = `\n${buildRuntimeShimScript(discordClientId)}\n`;

  const rewriter = new HTMLRewriter()
    .on('head', new HeadInjector(headPayload))
    .on('script[src]', new ElementProxyRewriter('src'))
    .on('link[href]', new ElementProxyRewriter('href'))
    .on('img[src],source[src],video[src],audio[src]', new ElementProxyRewriter('src'))
    .on('img[srcset],source[srcset]', new SrcsetProxyRewriter())
    .on('[style]', new InlineStyleProxyRewriter())
    .on('style', new StyleTagProxyRewriter())
    .on('*', new InlineEventRewriter())
    .on('body', new BodyEndInjector());

  const response = new Response(normalizedHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });

  return rewriter.transform(response);
}

// 메모리 세션 캐시 (폴백용 - 채널 및 액티비티 인스턴스 격리)
const channelSessions = new Map();
const instanceSessions = new Map();

// 세션 저장 헬퍼 (Cloudflare KV + 로컬 메모리)
async function saveSession(env, sessionData, channelId, userId, attachmentId, instanceId) {
  const data = { ...sessionData, updatedAt: sessionData.updatedAt || Date.now() };

  if (channelId) {
    channelSessions.set(channelId, data);
  }
  if (instanceId) {
    instanceSessions.set(instanceId, data);
  }

  if (env && env.SESSIONS) {
    try {
      const jsonStr = JSON.stringify(data);
      const puts = [];
      if (channelId) {
        puts.push(env.SESSIONS.put(`chan:${channelId}`, jsonStr, { expirationTtl: 86400 }));
      }
      if (userId) {
        puts.push(env.SESSIONS.put(`user:${userId}`, jsonStr, { expirationTtl: 86400 }));
      }
      if (attachmentId) {
        puts.push(env.SESSIONS.put(`att:${attachmentId}`, jsonStr, { expirationTtl: 86400 }));
      }
      if (instanceId) {
        puts.push(env.SESSIONS.put(`inst:${instanceId}`, jsonStr, { expirationTtl: 86400 }));
      }
      await Promise.allSettled(puts);
    } catch (e) {
      console.error('[KV saveSession error]', e);
    }
  }
}

// 세션 조회 헬퍼 (채널 최신 클릭 세션 우선 -> 인스턴스 세션 -> KV -> 유저 세션)
async function getSession(env, channelId, userId, instanceId) {
  let chanSess = null;
  let instSess = null;

  if (channelId && channelSessions.has(channelId)) {
    chanSess = channelSessions.get(channelId);
  }
  if (instanceId && instanceSessions.has(instanceId)) {
    instSess = instanceSessions.get(instanceId);
  }

  if (env && env.SESSIONS) {
    try {
      const promises = [];
      if (channelId) {
        promises.push(env.SESSIONS.get(`chan:${channelId}`).then((v) => (v ? JSON.parse(v) : null)));
      } else {
        promises.push(Promise.resolve(null));
      }
      if (instanceId) {
        promises.push(env.SESSIONS.get(`inst:${instanceId}`).then((v) => (v ? JSON.parse(v) : null)));
      } else {
        promises.push(Promise.resolve(null));
      }
      const [kvChan, kvInst] = await Promise.all(promises);
      if (kvChan) {
        if (!chanSess || (kvChan.updatedAt || 0) >= (chanSess.updatedAt || 0)) {
          chanSess = kvChan;
        }
      }
      if (kvInst) {
        if (!instSess || (kvInst.updatedAt || 0) >= (instSess.updatedAt || 0)) {
          instSess = kvInst;
        }
      }
    } catch (e) {
      console.error('[KV getSession error]', e);
    }
  }

  // 사용자가 채팅창에서 클릭한 최신 채널 세션(chanSess)을 항상 최우선으로 적용!
  let chosen = chanSess || instSess;
  if (chanSess && instSess) {
    const chanTime = typeof chanSess.updatedAt === 'number' ? chanSess.updatedAt : new Date(chanSess.updatedAt || 0).getTime();
    const instTime = typeof instSess.updatedAt === 'number' ? instSess.updatedAt : new Date(instSess.updatedAt || 0).getTime();
    // instSess가 chanSess보다 3초 이상 확실하게 새로운 경우에만 예외적으로 인정 (채널 클릭 직후 인스턴스가 덮어쓰는 문제 원천 차단)
    chosen = (instTime > chanTime + 3000) ? instSess : chanSess;
  }

  if (!chosen && userId && env && env.SESSIONS) {
    try {
      const u = await env.SESSIONS.get(`user:${userId}`);
      if (u) chosen = JSON.parse(u);
    } catch (e) {}
  }

  // 선택된 최신 세션을 인스턴스에도 즉시 동기화 (다인 참여자 동일 화면 공유)
  if (chosen && instanceId) {
    instanceSessions.set(instanceId, chosen);
    if (env && env.SESSIONS) {
      env.SESSIONS.put(`inst:${instanceId}`, JSON.stringify(chosen), { expirationTtl: 86400 }).catch(() => {});
    }
  }

  return chosen;
}

// Discord Interaction 응답 헬퍼 (JSON 형식)
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// 실행 버튼 및 임베드 페이로드 빌더
function buildInteractionLaunchPayload(attachment, messageId, uploaderName, workerOrigin) {
  const directUrl = `${workerOrigin}/?cdn_url=${encodeURIComponent(attachment.url)}&title=${encodeURIComponent(attachment.name)}&_t=${Date.now()}`;
  const format = getFileFormat(attachment.name) || 'html';
  const meta = FORMAT_META[format] || { icon: '📄', label: '문서', color: 0x5865f2 };

  return {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: {
      flags: 64, // EPHEMERAL (나한테만 보임)
      embeds: [
        {
          color: meta.color,
          title: `${meta.icon} ${attachment.name} 열기 준비 완료`,
          description: `아래 버튼을 누르면 **디스코드 앱 내부 팝업(Activity)** 또는 **외부 브라우저**에서 **${meta.label}**가 즉시 실행됩니다.`,
          fields: [
            { name: '파일 형식', value: `${meta.icon} ${meta.label}`, inline: true },
            { name: '파일 크기', value: `${(attachment.size / 1024).toFixed(1)} KB`, inline: true },
            { name: '요청자', value: `${uploaderName || '사용자'}`, inline: true }
          ],
          timestamp: new Date().toISOString()
        }
      ],
      components: [
        {
          type: 1, // ACTION_ROW
          components: [
            {
              type: 2, // BUTTON
              style: 1, // PRIMARY
              custom_id: `launch_popup:${messageId || 'cmd'}:${attachment.id}`,
              label: '⚡ 디스코드 내부 팝업으로 즉시 실행'
            },
            {
              type: 2, // BUTTON
              style: 5, // LINK
              url: directUrl,
              label: '🌐 인터넷 새 창으로 열기'
            }
          ]
        }
      ]
    }
  };
}

// 메인 Cloudflare Workers 요청 핸들러
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const workerOrigin = url.origin;

    // 1. 헬스 체크 엔드포인트
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // 1-2. 채널 내 최근 문서 목록 조회 엔드포인트 (액티비티 내 즉시 파일 전환용)
    if (url.pathname === '/api/channel-files') {
      const channelId = url.searchParams.get('channel_id');
      if (!channelId || !env.DISCORD_BOT_TOKEN) {
        return jsonResponse({ files: [] });
      }
      try {
        const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=30`, {
          headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        if (res.ok) {
          const msgs = await res.json();
          const files = [];
          for (const m of msgs) {
            for (const att of (m.attachments || [])) {
              const fmt = getFileFormat(att.filename || att.name);
              if (fmt) {
                files.push({
                  id: att.id,
                  name: att.filename || att.name,
                  url: att.url,
                  size: att.size,
                  format: fmt,
                  author: m.author ? m.author.username : '사용자'
                });
              }
            }
          }
          return jsonResponse({ files });
        }
      } catch (e) {}
      return jsonResponse({ files: [] });
    }

    // 2. 외부 에셋 보안 프록시 (/api/proxy/* 및 /api/asset-proxy)
    if (url.pathname.startsWith('/api/proxy/') || url.pathname === '/api/asset-proxy') {
      const assetUrl = extractTargetUrl(request.url);
      if (!assetUrl) return new Response('Missing target url', { status: 400 });

      if (isBlockedTarget(assetUrl)) {
        return new Response('Blocked target URL', { status: 403 });
      }

      const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      if (cache) {
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) return cachedResponse;
      }

      try {
        const response = await fetch(assetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          signal: AbortSignal.timeout(8000)
        });

        if (!response.ok) {
          return new Response(`Origin returned ${response.status}`, { status: response.status });
        }

        const rawContentType = response.headers.get('content-type') || 'application/octet-stream';
        const { allowed, contentType } = resolveSafeContentType(rawContentType, assetUrl);
        if (!allowed) {
          return new Response('Unsupported Media Type', { status: 415 });
        }

        const rawBytes = await readResponseWithLimit(response, MAX_PROXY_BYTES);
        let body = rawBytes;

        // CSS 파일인 경우 내부 @import 및 url(...)을 재귀적으로 프록시 주소로 변환
        if (contentType.includes('text/css') || assetUrl.toLowerCase().split('?')[0].endsWith('.css')) {
          const cssText = new TextDecoder('utf-8').decode(rawBytes);
          body = rewriteCssText(cssText, assetUrl);
        }

        const proxyResponse = new Response(body, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'public, max-age=86400, s-maxage=86400'
          }
        });

        if (cache && ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(cache.put(cacheKey, proxyResponse.clone()));
        }
        return proxyResponse;
      } catch (err) {
        if (err && err.status === 413) {
          return new Response('Payload Too Large (>15MB)', { status: 413 });
        }
        return new Response('Asset fetch failed: ' + err.message, { status: 502 });
      }
    }

    // 3. 디스코드 인터랙션 웹훅 처리 (POST /api/interactions 또는 POST /)
    if (request.method === 'POST') {
      const signature = request.headers.get('x-signature-ed25519');
      const timestamp = request.headers.get('x-signature-timestamp');
      const rawBody = await request.text();

      // Ed25519 서명 검증
      const isValid = await verifyDiscordSignature(
        rawBody,
        signature,
        timestamp,
        env.DISCORD_PUBLIC_KEY
      );

      if (!isValid) {
        return new Response('Invalid request signature', { status: 401 });
      }

      const interaction = JSON.parse(rawBody);

      // 3-1. Discord Ping 검증 (포털에서 엔드포인트 저장 시 호출)
      if (interaction.type === 1) {
        return jsonResponse({ type: 1 });
      }

      const botToken = env.DISCORD_BOT_TOKEN;

      // 3-2. 슬래시 명령어 (/도움말 또는 /help) 처리 -> 프로필 모달 칩 및 안내서 제공
      if (interaction.type === 2 && interaction.data && (interaction.data.name === '도움말' || interaction.data.name === 'help')) {
        return jsonResponse({
          type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
          data: {
            flags: 64, // Ephemeral
            embeds: [
              {
                title: '📖 Doc Viewer 사용 안내서',
                description: '채팅방에 업로드된 문서를 다운로드 없이 디스코드 내부 팝업(Activity)으로 즉시 열람하는 뷰어입니다.',
                color: 0x5865f2,
                fields: [
                  {
                    name: '1️⃣ 가장 빠른 실행 방법 (추천 ⭐)',
                    value: '채팅방의 문서 메시지를 **마우스 우클릭** → **[앱]** → **`파일 바로보기`** 클릭!'
                  },
                  {
                    name: '2️⃣ 최근 문서 자동 탐색 (/view)',
                    value: '채팅창에 **`/view`** 를 치면 현재 채널의 최근 50개 메시지 중 문서를 자동으로 찾아 실행 카드를 띄워줍니다.'
                  },
                  {
                    name: '3️⃣ 지원 파일 포맷',
                    value: '• `📄 HTML`: Zero-Eval 네이티브 렌더러 (웹앱, 대시보드)\n• `📑 PDF`: Mozilla PDF.js v3 (목차 트리, 텍스트 마이닝, 페이지 점프)\n• `📝 Markdown`: Marked + Highlight.js + Mermaid 다이어그램\n• `📊 PowerPoint`: OOXML 네이티브 엔진 (.pptx 1:1 벡터 렌더링, 목차 카드)'
                  },
                  {
                    name: '4️⃣ 뷰어 내부 조작 팁',
                    value: '• **📑 목차 버튼**: 좌측 도킹형 사이드바로 전체 목차 및 슬라이드 탐색\n• **[ 1 ] / 14 입력창**: 원하는 페이지 번호 입력 후 Enter로 즉시 점프\n• **🔄 파일 전환 바**: 뷰어를 닫지 않고 채널의 다른 문서로 즉시 전환'
                  }
                ],
                footer: {
                  text: 'Doc Viewer • 100% Serverless Edge Cloud'
                }
              }
            ]
          }
        });
      }

      // 3-3. 슬래시 명령어 (/view 및 기존 /html 호환) 처리
      if (interaction.type === 2 && interaction.data && (interaction.data.name === 'view' || interaction.data.name === 'html')) {
        const channelId = interaction.channel_id;
        const messageOption = (interaction.data.options || []).find((o) => o.name === 'message');
        const messageInput = messageOption ? messageOption.value : null;

        let targetMessage = null;

        // 특정 메시지 링크 또는 ID 지정 시
        if (messageInput) {
          const match = String(messageInput).match(/(\d{17,20})$/);
          const msgId = match ? match[1] : String(messageInput).trim();
          try {
            const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${msgId}`, {
              headers: { Authorization: `Bot ${botToken}` }
            });
            if (res.ok) targetMessage = await res.json();
          } catch (e) {}
        }

        // 지정이 없으면 채널의 최근 50개 메시지 검색
        let foundMessages = [];
        if (!targetMessage) {
          try {
            const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=50`, {
              headers: { Authorization: `Bot ${botToken}` }
            });
            if (res.ok) {
              const msgs = await res.json();
              foundMessages = msgs.filter((m) =>
                (m.attachments || []).some((att) => getFileFormat(att.filename || att.name))
              );
            }
          } catch (e) {}

          if (!foundMessages || foundMessages.length === 0) {
            return jsonResponse({
              type: 4,
              data: {
                flags: 64,
                content: '⚠️ **현재 채널의 최근 50개 메시지 중에서 지원되는 문서(.html, .pdf, .md, .pptx)를 찾지 못했습니다.**\n채팅방에 문서를 업로드한 후 다시 시도하거나, 메시지 링크를 입력해 주세요.'
              }
            });
          }

          targetMessage = foundMessages[0];
        }

        const attachment = (targetMessage.attachments || []).find(
          (att) => getFileFormat(att.filename || att.name || '')
        );

        if (!attachment) {
          return jsonResponse({
            type: 4,
            data: { flags: 64, content: '⚠️ 선택된 메시지에 지원되는 문서 첨부파일(.html, .pdf, .md, .pptx)이 없습니다.' }
          });
        }

        const normAttachment = {
          id: attachment.id,
          name: attachment.filename || attachment.name,
          url: attachment.url,
          size: attachment.size
        };

        const sessionData = { cdnUrl: normAttachment.url, fileName: normAttachment.name, attachmentId: normAttachment.id };
        const user = interaction.user || (interaction.member && interaction.member.user);
        const userId = user ? user.id : null;
        await saveSession(env, sessionData, channelId, userId, normAttachment.id);

        const payload = buildInteractionLaunchPayload(
          normAttachment,
          targetMessage.id,
          targetMessage.author ? targetMessage.author.username : '사용자',
          workerOrigin
        );

        // 최근 문서 파일이 2개 이상이면 드롭다운 메뉴 추가
        if (foundMessages && foundMessages.length > 1) {
          const selectOptions = [];
          foundMessages.forEach((msg) => {
            (msg.attachments || []).forEach((att) => {
              const name = att.filename || att.name || '';
              const fmt = getFileFormat(name);
              if (fmt && selectOptions.length < 10) {
                const meta = FORMAT_META[fmt] || { icon: '📄', label: '문서' };
                selectOptions.push({
                  label: `${meta.icon} ${name}`.slice(0, 50),
                  description: `${meta.label} • ${msg.author ? msg.author.username : '사용자'} • ${(att.size / 1024).toFixed(1)} KB`,
                  value: `select_file:${msg.id}:${att.id}`,
                  default: att.id === attachment.id
                });
              }
            });
          });

          if (selectOptions.length > 1) {
            payload.data.components.push({
              type: 1,
              components: [
                {
                  type: 3, // STRING_SELECT
                  custom_id: 'select_recent_file',
                  placeholder: '📂 최근 업로드된 다른 문서 파일 선택...',
                  options: selectOptions
                }
              ]
            });
          }
        }

        return jsonResponse(payload);
      }

      // 3-3. 메시지 우클릭 컨텍스트 메뉴 (파일 바로보기 / HTML 파일 실행) 처리
      if (
        interaction.type === 2 &&
        interaction.data &&
        (interaction.data.name === '파일 바로보기' || interaction.data.name === 'HTML 파일 실행')
      ) {
        const targetId = interaction.data.target_id;
        const resolvedMsg = (interaction.data.resolved && interaction.data.resolved.messages) ? interaction.data.resolved.messages[targetId] : null;

        if (!resolvedMsg) {
          return jsonResponse({
            type: 4,
            data: { flags: 64, content: '⚠️ 대상 메시지 정보를 가져오지 못했습니다.' }
          });
        }

        const attachment = (resolvedMsg.attachments || []).find((att) =>
          getFileFormat(att.filename || att.name || '')
        );

        if (!attachment) {
          return jsonResponse({
            type: 4,
            data: { flags: 64, content: '⚠️ 선택한 메시지에 첨부된 지원 문서 파일(.html, .pdf, .md, .pptx)이 없습니다.' }
          });
        }

        const normAttachment = {
          id: attachment.id,
          name: attachment.filename || attachment.name,
          url: attachment.url,
          size: attachment.size
        };

        const sessionData = { cdnUrl: normAttachment.url, fileName: normAttachment.name, attachmentId: normAttachment.id };
        const user = interaction.user || (interaction.member && interaction.member.user);
        const userId = user ? user.id : null;
        await saveSession(env, sessionData, interaction.channel_id, userId, normAttachment.id);

        const payload = buildInteractionLaunchPayload(
          normAttachment,
          resolvedMsg.id,
          resolvedMsg.author ? resolvedMsg.author.username : '사용자',
          workerOrigin
        );

        return jsonResponse(payload);
      }

      // 3-4. 버튼 클릭 및 드롭다운 메뉴 처리 (type: 3)
      if (interaction.type === 3) {
        const customId = interaction.data.custom_id;

        // 디스코드 액티비티 즉시 팝업 실행 버튼
        if (customId.startsWith('launch_popup:')) {
          const channelId = interaction.channel_id;
          const user = interaction.user || (interaction.member && interaction.member.user);
          const userId = user ? user.id : null;
          const parts = customId.split(':');
          const msgId = parts[1];
          const attId = parts[2];

          let targetAttachment = null;

          if (attId && env && env.SESSIONS) {
            try {
              const attSess = await env.SESSIONS.get(`att:${attId}`);
              if (attSess) {
                targetAttachment = JSON.parse(attSess);
              }
            } catch (e) {}
          }

          // 만약 attSess가 KV에 없다면 채널 메시지에서 직접 첨부파일 조회
          if (!targetAttachment && channelId && msgId && msgId !== 'cmd' && botToken) {
            try {
              const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${msgId}`, {
                headers: { Authorization: `Bot ${botToken}` }
              });
              if (res.ok) {
                const msg = await res.json();
                const att = (msg.attachments || []).find((a) => a.id === attId || getFileFormat(a.filename || a.name || ''));
                if (att) {
                  targetAttachment = {
                    cdnUrl: att.url,
                    fileName: att.filename || att.name,
                    attachmentId: att.id
                  };
                }
              }
            } catch (fetchErr) {}
          }

          if (targetAttachment) {
            targetAttachment.updatedAt = Date.now();
            await saveSession(env, targetAttachment, channelId, userId, attId);
            instanceSessions.clear();
          }

          return jsonResponse({
            type: 12 // LAUNCH_ACTIVITY
          });
        }

        // 드롭다운 메뉴로 다른 최근 파일 선택 시 메시지 업데이트
        if ((customId === 'select_recent_file' || customId === 'select_recent_html') && interaction.data.values && interaction.data.values.length > 0) {
          const [tag, msgId, attId] = interaction.data.values[0].split(':');
          const channelId = interaction.channel_id;

          try {
            const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${msgId}`, {
              headers: { Authorization: `Bot ${botToken}` }
            });
            if (res.ok) {
              const msg = await res.json();
              const att = (msg.attachments || []).find((a) => a.id === attId);
              if (att) {
                const normAtt = {
                  id: att.id,
                  name: att.filename || att.name,
                  url: att.url,
                  size: att.size
                };
                const user = interaction.user || (interaction.member && interaction.member.user);
                const userId = user ? user.id : null;
                await saveSession(env, { cdnUrl: normAtt.url, fileName: normAtt.name }, channelId, userId);

                const newPayload = buildInteractionLaunchPayload(
                  normAtt,
                  msg.id,
                  msg.author ? msg.author.username : '사용자',
                  workerOrigin
                );

                // UPDATE_MESSAGE (type: 7) 로 전환
                newPayload.type = 7;
                return jsonResponse(newPayload);
              }
            }
          } catch (e) {}
        }
      }

      return jsonResponse({ type: 4, data: { flags: 64, content: '알 수 없는 요청입니다.' } });
    }

    // 3-9. 이용약관 및 개인정보 처리방침 라우팅
    if (url.pathname === '/terms' || url.pathname === '/terms-of-service') {
      const termsSections = `
        <p>Doc Viewer(이하 "서비스")를 이용해 주셔서 감사합니다. 본 약관은 Discord 플랫폼 내에서 제공되는 Doc Viewer 애플리케이션 및 인앱 액티비티의 이용 조건을 규정합니다.</p>
        <h2>제1조 (목적)</h2>
        <p>본 약관은 Doc Viewer가 제공하는 문서 뷰어 서비스(HTML, PDF, Markdown, PPTX 열람 기능)를 이용함에 있어 서비스 제공자와 이용자의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.</p>
        <h2>제2조 (서비스의 제공)</h2>
        <p>1. 본 서비스는 디스코드(Discord) 클라이언트 내에서 사용자가 공유한 문서를 다운로드 없이 즉시 열람할 수 있는 인앱 액티비티 및 슬래시 명령어를 제공합니다.<br>
        2. 서비스는 연중무휴, 1일 24시간 제공을 원칙으로 하되, 디스코드 API 장애 또는 시스템 유지보수가 필요한 경우 일시 중단될 수 있습니다.</p>
        <h2>제3조 (이용자의 의무)</h2>
        <p>이용자는 서비스를 이용함에 있어 다음 각 호의 행위를 하여서는 안 됩니다:</p>
        <ul>
          <li>악성코드, 바이러스, 악의적인 스크립트가 포함된 파일의 실행 및 공유</li>
          <li>타인의 저작권, 지식재산권을 침해하는 문서의 무단 배포</li>
          <li>디스코드 개발자 서비스 약관(Discord Developer Terms of Service) 및 커뮤니티 가이드라인 위반 행위</li>
          <li>비정상적인 반복 호출을 통해 서비스 인프라에 과도한 부하를 유발하는 행위</li>
        </ul>
        <h2>제4조 (면책 조항)</h2>
        <p>1. 본 서비스는 있는 그대로("AS IS") 제공되며, 서비스에 열람되는 모든 문서의 내용, 신뢰성 및 무결성에 대해 책임을 지지 않습니다.<br>
        2. 서비스 이용 중 발생할 수 있는 데이터 손실, 간접 손해 등에 대하여 법률이 허용하는 한도 내에서 책임을 부담하지 않습니다.</p>
        <h2>제5조 (문의)</h2>
        <p>서비스에 대한 문의사항이나 건의사항은 <a href="https://github.com/hwnkue10-arch/discord-viewer/issues" target="_blank">GitHub Issues</a>를 통해 접수해 주시기 바랍니다.</p>
      `;
      return new Response(renderLegalPage('Doc Viewer 이용약관 (Terms of Service)', '2026년 10월 30일', termsSections), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    if (url.pathname === '/privacy' || url.pathname === '/privacy-policy') {
      const privacySections = `
        <p>Doc Viewer(이하 "서비스")는 이용자의 개인정보를 소중하게 생각하며, 관련 법령 및 Discord 개발자 정책을 준수합니다.</p>
        <h2>제1조 (수집하는 정보 및 수집 방법)</h2>
        <p><strong>1. 수집하지 않는 정보:</strong> 본 서비스는 이용자의 이메일, 비밀번호, 실명, 결제 정보 등 일체의 민감한 개인 식별 정보를 수집하거나 영구 저장하지 않습니다.<br>
        <strong>2. 임시 처리 데이터:</strong> 디스코드 액티비티 세션 동기화 및 문서 열람 기능을 위해 다음 정보가 임시 처리될 수 있습니다:</p>
        <ul>
          <li>디스코드 채널 ID (Channel ID)</li>
          <li>디스코드 사용자 식별자 (User ID)</li>
          <li>열람 대상 문서의 디스코드 CDN URL 및 파일명</li>
        </ul>
        <h2>제2조 (정보의 이용 목적 및 보관 기간)</h2>
        <p>• <strong>이용 목적:</strong> 동일 디스코드 채널 및 액티비티 방에 참여한 사용자 간의 실시간 문서 열람 세션 동기화<br>
        • <strong>보관 기간:</strong> Cloudflare Workers KV 메모리에 임시 캐싱되며, 최대 24시간 이내에 자동 파기(TTL 만료)됩니다. 영구적인 데이터베이스 저장을 하지 않습니다.</p>
        <h2>제3조 (개인정보의 제3자 제공 및 공유)</h2>
        <p>본 서비스는 이용자의 정보를 어떠한 경우에도 상업적 목적으로 제3자에게 판매, 대여 또는 공유하지 않습니다.</p>
        <h2>제4조 (정보의 보호 및 보안 조치)</h2>
        <p>1. 디스코드 본사 서버와의 모든 통신은 Ed25519 전자서명 검증(SubtleCrypto)을 통해 위변조를 방지합니다.<br>
        2. 모든 웹 통신은 SSL/TLS(HTTPS) 암호화 채널을 통해서만 안전하게 전송됩니다.</p>
        <h2>제5조 (이용자의 권리)</h2>
        <p>이용자는 언제든지 봇을 디스코드 서버에서 추방하거나 액티비티 실행을 중단함으로써 데이터 접근을 차단할 수 있습니다.</p>
      `;
      return new Response(renderLegalPage('Doc Viewer 개인정보 처리방침 (Privacy Policy)', '2026년 10월 30일', privacySections), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 4. 디스코드 액티비티 HTML 실시간 렌더링 (GET / 또는 /view, /activity_shell.html)
    let targetUrl = url.searchParams.get('cdn_url') || url.searchParams.get('url');
    let fileTitle = url.searchParams.get('title') || 'Discord HTML Runner';
    const activityChannelId = url.searchParams.get('channel_id');
    const activityInstanceId = url.searchParams.get('instance_id');

    // 1) instance_id (동일 액티비티 방 참여자 우선) 또는 channel_id 세션에서 CDN URL 복원
    if (!targetUrl && (activityInstanceId || activityChannelId)) {
      const sess = await getSession(env, activityChannelId, null, activityInstanceId);
      if (sess) {
        targetUrl = sess.cdnUrl;
        fileTitle = sess.fileName;
      }
    }

    // 2) 세션에도 없다면, 디스코드 채널 API를 실시간 조회하여 최신 HTML 첨부파일 자동 확보!
    if (!targetUrl && activityChannelId && env.DISCORD_BOT_TOKEN) {
      try {
        const res = await fetch(`https://discord.com/api/v10/channels/${activityChannelId}/messages?limit=25`, {
          headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        if (res.ok) {
          const msgs = await res.json();
          const msgWithFile = msgs.find((m) =>
            (m.attachments || []).some((a) => getFileFormat(a.filename || a.name))
          );
          if (msgWithFile) {
            const att = msgWithFile.attachments.find((a) => getFileFormat(a.filename || a.name));
            if (att) {
              targetUrl = att.url;
              fileTitle = att.filename || att.name;
              await saveSession(env, { cdnUrl: att.url, fileName: fileTitle }, activityChannelId, null, null, activityInstanceId);
            }
          }
        }
      } catch (e) {
        console.error('Channel fetch error:', e);
      }
    }

    // 3) 세션이 확인되었고 instance_id가 존재한다면 인메모리에만 세션 캐싱 (채널 세션 덮어쓰기 방지)
    if (targetUrl && activityInstanceId && !instanceSessions.has(activityInstanceId)) {
      instanceSessions.set(activityInstanceId, { cdnUrl: targetUrl, fileName: fileTitle, updatedAt: Date.now() });
    }

    if (!targetUrl) {
      // 파라미터나 채널 첨부파일이 아예 없을 때의 안내 화면
      const welcomeHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>Discord HTML Serverless Runner</title>
  <style>
    body { background: #0b0f19; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 24px; box-sizing: border-box; }
    .card { background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 32px 24px; max-width: 480px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(10px); }
    h1 { color: #38bdf8; font-size: 20px; margin: 12px 0 8px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 18px; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
    .guide-box { background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 14px; text-align: left; font-size: 13px; color: #cbd5e1; line-height: 1.7; margin-bottom: 18px; }
    .btn { background: #5865f2; color: white; border: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; transition: background 0.2s; display: inline-block; }
    .btn:hover { background: #4752c4; }
  </style>
</head>
<body>
  <div class="card">
    <div class="status-badge">● HTML Runner 준비 완료</div>
    <h1>📄 실행할 HTML 파일을 선택해 주세요</h1>
    <p>현재 채널에서 선택된 HTML 파일이 없습니다.<br>채팅방에서 원하는 파일을 지정하면 이 화면에서 바로 실행됩니다.</p>
    <div class="guide-box">
      <strong>실행 방법:</strong><br>
      1. 채팅창의 HTML 파일 메시지를 <strong>마우스 우클릭</strong><br>
      2. <strong>[앱]</strong> → <strong>[HTML 파일 실행]</strong> 클릭<br>
      3. 나타난 메시지에서 <strong>[⚡ 디스코드 내부 팝업으로 즉시 실행]</strong> 클릭!
    </div>
    <button id="welcome-reload-btn" class="btn">🔄 다시 확인하기</button>
  <script>document.getElementById("welcome-reload-btn").addEventListener("click", function() { window.location.reload(); });</script>
  </div>
</body>
</html>`;
      return new Response(welcomeHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Discord CDN 파일 다운로드 및 인라인화
    try {
      const parsedCdn = new URL(targetUrl);
      const allowedHosts = ['cdn.discordapp.com', 'media.discordapp.net'];
      if (!allowedHosts.includes(parsedCdn.hostname)) {
        return new Response('허용되지 않은 외부 도메인입니다.', { status: 403 });
      }

      const format = getFileFormat(fileTitle || targetUrl) || 'html';

      if (format === 'pdf') {
        const finalHtml = renderPdfViewer(fileTitle, workerOrigin, targetUrl, env.DISCORD_CLIENT_ID);
        return renderHtmlForDiscordActivity(finalHtml, fileTitle, workerOrigin, targetUrl, env.DISCORD_CLIENT_ID);
      }

      if (format === 'pptx') {
        const finalHtml = renderPptxViewer(fileTitle, workerOrigin, targetUrl, env.DISCORD_CLIENT_ID);
        return renderHtmlForDiscordActivity(finalHtml, fileTitle, workerOrigin, targetUrl, env.DISCORD_CLIENT_ID);
      }

      if (format === 'md') {
        let rawMd = '';
        if (targetUrl) {
          const cdnRes = await fetch(targetUrl);
          if (cdnRes.ok) rawMd = await cdnRes.text();
        }
        const finalHtml = renderMarkdownViewer(rawMd, fileTitle, workerOrigin, targetUrl, env.DISCORD_CLIENT_ID);
        return renderHtmlForDiscordActivity(finalHtml, fileTitle, workerOrigin, targetUrl, env.DISCORD_CLIENT_ID);
      }

      // 기존 HTML 렌더러 파이프라인 (100% 동일)
      const cdnRes = await fetch(targetUrl);
      if (!cdnRes.ok) {
        return new Response('⚠️ 첨부파일이 만료되었거나 접근할 수 없습니다.', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      let rawHtml = await cdnRes.text();
      return renderHtmlForDiscordActivity(rawHtml, fileTitle, workerOrigin, targetUrl, env.DISCORD_CLIENT_ID);
    
    } catch (err) {
      return new Response('문서 렌더링 중 오류가 발생했습니다: ' + err.message, { status: 500 });
    }
  }
};
