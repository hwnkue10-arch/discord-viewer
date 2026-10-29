const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const {
  getFileFormat,
  renderPdfViewer,
  renderMarkdownViewer,
  renderPptxViewer
} = require('./templates');

const app = express();
app.use(cors());
app.use(express.json());

// 최근 실행 요청된 HTML 파일 정보 저장 (디스코드 액티비티 실행 시 자동 로드용)
let latestSession = {
  guildId: null,
  channelId: null,
  fileName: 'sample_test.html',
  cdnUrl: null,
  requestedBy: 'System',
  updatedAt: new Date().toISOString()
};

// 채널 및 액티비티 인스턴스(방 번호)별 세션 맵
const channelSessions = new Map();
const instanceSessions = new Map();

function setLatestSession(sessionData) {
  const data = { ...sessionData, updatedAt: sessionData.updatedAt || Date.now() };
  latestSession = { ...latestSession, ...data };
  if (data.channelId) {
    channelSessions.set(data.channelId, data);
  }
  if (data.instanceId) {
    instanceSessions.set(data.instanceId, data);
  } else {
    // 새 파일이 선택되면 기존 인스턴스 세션 캐시를 초기화하여 이전 파일이 뜨는 현상 방지
    instanceSessions.clear();
  }
}

// 외부 에셋(Tailwind CSS, 구글 폰트, JS 라이브러리 등) 인메모리 캐시
const assetCache = new Map();

// 서버 구동 시 Tailwind CDN 에셋을 미리 백그라운드에서 다운로드해 대기
async function prefetchCommonAssets() {
  const tailwindUrl = 'https://cdn.tailwindcss.com';
  try {
    const res = await fetch(tailwindUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const code = await res.text();
      assetCache.set(tailwindUrl, code);
      console.log(`⚡ [사전 캐싱 완료] Tailwind Play CDN 로드 성공 (~${Math.round(code.length / 1024)} KB)`);
    }
  } catch (err) {
    console.warn('⚠️ [사전 캐싱 알림] Tailwind 사전 로드 지연 (사용 시 재시도):', err.message);
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

// 스트리밍 프록시 재작성 기반 디스코드 액티비티 HTML 렌더러 (순수 addEventListener + 내장 Discord RPC 연동)
function renderHtmlForDiscordActivity(rawHtml, fileTitle, serverOrigin, targetUrl, discordClientId) {
  let processed = rawHtml;

  // 1. 외부 스크립트 (<script src="https://...">) -> 경로 보존형 toProxyUrl 주소로 재작성
  processed = processed.replace(/<script\b([^>]*?)\bsrc=["']((?:https?:)?\/\/[^"']+)["']([^>]*)>/gi, (m, b, url, a) => {
    if (url.startsWith('/api/')) return m;
    const fullUrl = url.startsWith('//') ? 'https:' + url : url;
    const attrs = (b + ' ' + a).replace(/\b(integrity|crossorigin)(=(['"]).*?\3|=[^\s>]+)?/gi, '');
    return `<script${attrs} src="${toProxyUrl(fullUrl)}">`;
  });

  // 2. 외부 스타일시트 (<link href="https://...">) -> 경로 보존형 toProxyUrl 주소로 재작성
  processed = processed.replace(/<link\b([^>]*?)\bhref=["']((?:https?:)?\/\/[^"']+)["']([^>]*)>/gi, (m, b, url, a) => {
    if (url.startsWith('/api/')) return m;
    const fullUrl = url.startsWith('//') ? 'https:' + url : url;
    const attrs = (b + ' ' + a).replace(/\b(integrity|crossorigin)(=(['"]).*?\3|=[^\s>]+)?/gi, '');
    return `<link${attrs} href="${toProxyUrl(fullUrl)}">`;
  });

  // 3. 외부 이미지, 영상, 오디오 (<img src="https://..."> 등)
  processed = processed.replace(/<(img|source|video|audio)\b([^>]*?)\bsrc=["']((?:https?:)?\/\/[^"']+)["']([^>]*)>/gi, (m, tag, b, url, a) => {
    if (url.startsWith('/api/')) return m;
    const fullUrl = url.startsWith('//') ? 'https:' + url : url;
    return `<${tag}${b} src="${toProxyUrl(fullUrl)}"${a}>`;
  });

  // 4. srcset 외부 주소 프록시 변환
  processed = processed.replace(/\bsrcset=(['"])(.*?)\1/gi, (m, q, srcset) => {
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
    return `srcset=${q}${rewritten}${q}`;
  });

  // 5. 인라인 style="...url(https://...)..." 및 <style>...</style> 내부 URL 프록시 변환
  processed = processed.replace(/\bstyle=(['"])(.*?)\1/gi, (m, q, styleContent) => {
    if (!styleContent.includes('url(')) return m;
    return `style="${rewriteCssText(styleContent, null).replace(/"/g, '&quot;')}"`;
  });
  processed = processed.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, openTag, cssBody, closeTag) => {
    return `${openTag}${rewriteCssText(cssBody, null)}${closeTag}`;
  });

  // 6. 인라인 이벤트 핸들러 on<event>="..." -> data-aid-<event>="N" 부여 및 순수 addEventListener 코드 수집 (중복 실행 원천 차단)
  const listenerEntries = [];
  let aidCounter = 0;
  const eventNamesPattern = INLINE_EVENTS.join('|');
  const inlineEventRegex = new RegExp(`\\b(on(${eventNamesPattern}))\\s*=\\s*(?:'([^']*)'|"([^"]*)")`, 'gi');
  processed = processed.replace(inlineEventRegex, (match, fullAttr, eventName, singleCode, doubleCode) => {
    const ev = eventName.toLowerCase();
    const code = singleCode !== undefined ? singleCode : (doubleCode !== undefined ? doubleCode : '');
    if (!code.trim()) return '';
    aidCounter++;
    listenerEntries.push({ aid: aidCounter, event: ev, code: code });
    return `data-aid-${ev}="${aidCounter}"`;
  });

  // 7. <head>에 런타임 심 주입
  const headPayload = `\n${buildRuntimeShimScript(discordClientId)}\n`;
  if (processed.includes('<head>')) {
    processed = processed.replace('<head>', `<head>${headPayload}`);
  } else if (/<head\b[^>]*>/i.test(processed)) {
    processed = processed.replace(/<head\b[^>]*>/i, `$&\n${headPayload}`);
  } else {
    processed = `<head>${headPayload}</head>\n` + processed;
  }

  // 8. <body> 끝 부분에 eval-free 생성 리스너 및 helperBar 주입
  const directUrl = `${serverOrigin}/?cdn_url=${encodeURIComponent(targetUrl || '')}&title=${encodeURIComponent(fileTitle || '')}&_t=${Date.now()}`;
  const helperBar = buildHelperBar(fileTitle || 'Discord HTML Runner', directUrl);
  const generatedScript = buildGeneratedListenersScript(listenerEntries);
  const bodyEndPayload = `\n${generatedScript}\n${helperBar}\n`;

  if (processed.includes('</body>')) {
    processed = processed.replace('</body>', `${bodyEndPayload}</body>`);
  } else {
    processed += bodyEndPayload;
  }

  return processed;
}

// 예제 정적 파일 제공
app.use('/examples', express.static(path.join(__dirname, '..', 'examples')));

// [핵심 혁신: 100% 네이티브 직결 렌더링]
// 중첩 iframe(iframe 안의 iframe)을 완전히 제거하고 디스코드 액티비티 창 자체에 HTML을 1:1 직결 주입합니다.
// 이로써 Electron의 자식 iframe 클릭 이벤트 유실 버그, null origin, CSP 격리 문제를 원천 차단합니다.
async function handleRenderRequest(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const activityInstanceId = req.query.instance_id;
  const activityChannelId = req.query.channel_id;

  let targetUrl = req.query.cdn_url || req.query.url;
  let fileTitle = req.query.title;

  let chanSess = null;
  let instSess = null;

  if (activityChannelId && channelSessions.has(activityChannelId)) {
    chanSess = channelSessions.get(activityChannelId);
  }
  if (activityInstanceId && instanceSessions.has(activityInstanceId)) {
    instSess = instanceSessions.get(activityInstanceId);
  }

  // 1. 세션 우선순위: 채널 최신 클릭 세션이 오래된 인스턴스 세션보다 무조건 우선!
  // Discord Activity는 방을 닫고 다시 열어도 같은 instance_id를 재사용하는 경우가 많으므로,
  // 인스턴스 세션이 채널 세션보다 3초 이상 최신인 경우가 아니면 채널 세션을 우선합니다.
  if (!targetUrl) {
    let chosen = null;
    if (chanSess && instSess) {
      const chanTime = typeof chanSess.updatedAt === 'number' ? chanSess.updatedAt : new Date(chanSess.updatedAt || 0).getTime();
      const instTime = typeof instSess.updatedAt === 'number' ? instSess.updatedAt : new Date(instSess.updatedAt || 0).getTime();
      chosen = (instTime - chanTime > 3000) ? instSess : chanSess;
    } else {
      chosen = chanSess || instSess;
    }

    if (!chosen && latestSession && latestSession.cdnUrl) {
      chosen = latestSession;
    }

    if (chosen) {
      targetUrl = chosen.cdnUrl;
      fileTitle = chosen.fileName;
    }
  }

  try {
    const format = getFileFormat(fileTitle || targetUrl) || 'html';
    const serverOrigin = `${req.protocol}://${req.get('host')}`;

    if (targetUrl) {
      const parsedUrl = new URL(targetUrl);
      const allowedHosts = ['cdn.discordapp.com', 'media.discordapp.net'];
      if (!allowedHosts.includes(parsedUrl.hostname)) {
        return res.status(403).send('허용되지 않은 외부 도메인입니다. (cdn.discordapp.com만 가능)');
      }
    }

    if (format === 'pdf') {
      const viewerHtml = renderPdfViewer(fileTitle, serverOrigin, targetUrl, process.env.DISCORD_CLIENT_ID);
      const finalHtml = renderHtmlForDiscordActivity(viewerHtml, fileTitle, serverOrigin, targetUrl, process.env.DISCORD_CLIENT_ID);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(finalHtml);
    }

    if (format === 'pptx') {
      const viewerHtml = renderPptxViewer(fileTitle, serverOrigin, targetUrl, process.env.DISCORD_CLIENT_ID);
      const finalHtml = renderHtmlForDiscordActivity(viewerHtml, fileTitle, serverOrigin, targetUrl, process.env.DISCORD_CLIENT_ID);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(finalHtml);
    }

    if (format === 'md') {
      let rawMd = '';
      if (targetUrl) {
        const response = await fetch(targetUrl);
        if (response.ok) rawMd = await response.text();
      }
      const viewerHtml = renderMarkdownViewer(rawMd, fileTitle, serverOrigin, targetUrl, process.env.DISCORD_CLIENT_ID);
      const finalHtml = renderHtmlForDiscordActivity(viewerHtml, fileTitle, serverOrigin, targetUrl, process.env.DISCORD_CLIENT_ID);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(finalHtml);
    }

    let rawHtml = '';
    if (!targetUrl) {
      const samplePath = path.join(__dirname, '..', 'examples', 'sample_test.html');
      if (fs.existsSync(samplePath)) {
        rawHtml = fs.readFileSync(samplePath, 'utf-8');
      } else {
        rawHtml = '<!DOCTYPE html><html><body style="background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;text-align:center;"><div><h2>🚀 Discord Viewer</h2><p style="color:#94a3b8;">디스코드 채팅방에 문서를 업로드하고 버튼을 눌러주세요.</p></div></body></html>';
      }
    } else {
      const response = await fetch(targetUrl);
      if (!response.ok) {
        return res.status(200).send(`
          <!DOCTYPE html>
          <html lang="ko">
          <head><meta charset="UTF-8"><title>CDN 링크 만료 알림</title>
          <style>body{background:#0f172a;color:#f87171;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px;}</style>
          </head>
          <body>
            <h2>⚠️ 파일 만료 알림</h2>
            <p>디스코드 CDN 임시 링크가 만료되었거나 파일을 찾을 수 없습니다.</p>
            <p style="color:#94a3b8;font-size:14px;">디스코드 채팅방에서 문서를 다시 업로드하고 버튼을 눌러주세요!</p>
          </body>
          </html>
        `);
      }
      rawHtml = await response.text();
    }

    const finalHtml = renderHtmlForDiscordActivity(rawHtml, fileTitle, serverOrigin, targetUrl, process.env.DISCORD_CLIENT_ID);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(finalHtml);
  } catch (error) {
    console.error('❌ 렌더링 실패:', error);
    res.status(500).send('문서 렌더링 중 오류가 발생했습니다.');
  }
}

// 디스코드 액티비티 진입점 (루트 및 /activity_shell.html 모두 중첩 iframe 없는 네이티브 직결 렌더링!)
app.get('/', handleRenderRequest);
app.get('/activity_shell.html', handleRenderRequest);
app.get('/render', handleRenderRequest);
app.get('/view', handleRenderRequest);
app.use(express.static(path.join(__dirname, '..', 'public')));

// 검색엔진(구글, 네이버 등) 크롤러 접근 원천 차단
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});

// 클라우드 호스팅 헬스체크용 엔드포인트
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// 채널 내 최근 문서 목록 조회 엔드포인트 (액티비티 내 즉시 파일 전환용)
app.get('/api/channel-files', async (req, res) => {
  const channelId = req.query.channel_id;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!channelId || !botToken) {
    return res.json({ files: [] });
  }
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=30`, {
      headers: { Authorization: `Bot ${botToken}` }
    });
    if (response.ok) {
      const msgs = await response.json();
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
      return res.json({ files });
    }
  } catch (e) {}
  return res.json({ files: [] });
});

// 최신 클릭된 파일 세션 메타데이터 조회 API (캐시 방지 헤더 포함)
app.get('/api/latest-session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json(latestSession);
});

// 외부 에셋 보안 프록시 (/api/proxy/* 및 /api/asset-proxy)
app.use(['/api/proxy/*', '/api/asset-proxy'], async (req, res) => {
  const fullReqUrl = req.originalUrl || req.url;
  const assetUrl = extractTargetUrl(fullReqUrl, req);
  if (!assetUrl) return res.status(400).send('Missing url parameter');

  if (isBlockedTarget(assetUrl)) {
    return res.status(403).send('Blocked target URL');
  }

  try {
    const response = await fetch(assetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return res.status(response.status).send(`Origin returned ${response.status}`);
    }

    const rawContentType = response.headers.get('content-type') || 'application/octet-stream';
    const { allowed, contentType } = resolveSafeContentType(rawContentType, assetUrl);
    if (!allowed) {
      return res.status(415).send('Unsupported Media Type');
    }

    const rawBytes = await readResponseWithLimit(response, MAX_PROXY_BYTES);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // CSS 파일인 경우 내부 @import 및 url(...)을 재귀적으로 프록시 주소로 변환
    if (contentType.includes('text/css') || assetUrl.toLowerCase().split('?')[0].endsWith('.css')) {
      const cssText = Buffer.from(rawBytes).toString('utf-8');
      return res.send(rewriteCssText(cssText, assetUrl));
    }

    res.send(Buffer.from(rawBytes));
  } catch (error) {
    if (error && error.status === 413) {
      return res.status(413).send('Payload Too Large (>15MB)');
    }
    console.error('❌ 외부 에셋 프록시 실패:', error.message);
    res.status(502).send('Asset fetch failed');
  }
});

// 디스코드 CDN 및 로컬 샘플 HTML을 완전 인라인화하여 반환하는 엔드포인트 (기존 API 호환)
app.get('/api/fetch-html', handleRenderRequest);

function startServer(port = 3000) {
  return new Promise((resolve) => {
    // 서버 부팅과 동시에 Tailwind CDN 사전 로드 시작
    prefetchCommonAssets();

    app.listen(port, () => {
      console.log(`🌐 액티비티 쉘 서버 구동 완료: http://localhost:${port}`);
      console.log(`   - 액티비티 진입점: http://localhost:${port}/activity_shell.html`);
      console.log(`   - 샘플 미리보기: http://localhost:${port}/activity_shell.html?sample=true`);
      resolve();
    });
  });
}

module.exports = { startServer, setLatestSession };