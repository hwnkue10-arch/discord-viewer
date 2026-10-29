/**
 * Cloudflare Workers 기반 100% 무(無)서버 Discord HTML Activity & Bot
 * - 상시 실행 서버 0개 (비용 0원, 컴퓨터 꺼도 24시간 작동)
 * - 디스코드 Interactions HTTP Webhook 수신 (Ed25519 서명 검증)
 * - Discord CDN HTML 실시간 인라인화 및 CSP 우회 렌더러
 */

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

  const baseMime = ct.split(';')[0].trim();
  const isPrefixAllowed = ALLOWED_MIME_PREFIXES.some((prefix) => baseMime.startsWith(prefix));
  const isExactAllowed = ALLOWED_EXACT_MIMES.has(baseMime);

  return {
    allowed: isPrefixAllowed || isExactAllowed,
    contentType: rawContentType && !pathname.match(/\.(woff2?|ttf|otf|css|m?js|svg|wasm)$/i) ? rawContentType : ct
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
  var frameId = urlParams.get('frame_id');
  var inActivityIframe = (window.self !== window.top) && !!frameId;
  var rpcSource = (window.parent && window.parent.opener) ? window.parent.opener : window.parent;
  var rpcOrigin = document.referrer ? (function() { try { return new URL(document.referrer).origin; } catch(e) { return '*'; } })() : '*';

  function makeNonce() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  if (inActivityIframe && rpcSource) {
    try {
      // Opcode 0: HANDSHAKE
      rpcSource.postMessage([0, {
        v: 1,
        encoding: 'json',
        client_id: cid || 'discord-activity',
        frame_id: frameId,
        sdk_version: '1.8.0'
      }], rpcOrigin);
    } catch ( err ) {}
  }

  function sendOpenExternalLink(targetUrl) {
    return new Promise(function(resolve, reject) {
      if (!inActivityIframe || !rpcSource) {
        reject(new Error('Not in Discord Activity iframe'));
        return;
      }
      try {
        var nonce = makeNonce();
        // Opcode 1: FRAME (OPEN_EXTERNAL_LINK)
        rpcSource.postMessage([1, {
          cmd: 'OPEN_EXTERNAL_LINK',
          args: { url: targetUrl },
          nonce: nonce
        }], rpcOrigin);
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
      sendOpenExternalLink(targetUrl).catch(function() {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
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
      if (full && new URL(full).origin !== location.origin) {
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

// 플로팅 헬퍼 바 생성 (인라인 onclick 제거, target="_blank" 보존 및 addEventListener 바인딩)
function buildHelperBar(fileTitle, directUrl) {
  return `
<div id="discord-activity-helper-bar" style="position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;align-items:center;gap:6px;background:rgba(15,23,42,0.92);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.18);padding:4px 10px;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#f1f5f9;box-shadow:0 4px 16px rgba(0,0,0,0.4);user-select:none;">
  <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;"></span>
  <span style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${fileTitle}</span>
  <button id="discord-helper-refresh-btn" style="background:#4f46e5;color:white;border:none;border-radius:10px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;transition:background 0.2s;">🔄 새로고침</button>
  <a id="discord-helper-external-btn" href="${directUrl}" target="_blank" rel="noopener noreferrer" style="background:#0284c7;color:white;text-decoration:none;border-radius:10px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;display:inline-block;transition:background 0.2s;">🌐 새 창</a>
  <button id="discord-helper-close-btn" style="background:transparent;color:#94a3b8;border:none;padding:2px 6px;font-size:13px;font-weight:bold;cursor:pointer;line-height:1;" title="헬퍼 바 숨기기">✕</button>
</div>
<script id="discord-helper-bar-script">
(function() {
  var bar = document.getElementById('discord-activity-helper-bar');
  var refreshBtn = document.getElementById('discord-helper-refresh-btn');
  var extBtn = document.getElementById('discord-helper-external-btn');
  var closeBtn = document.getElementById('discord-helper-close-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function(e) {
      e.preventDefault();
      window.location.reload();
    });
  }
  if (extBtn) {
    extBtn.addEventListener('click', function(e) {
      var hasFrameId = new URLSearchParams(window.location.search).has('frame_id');
      if (window.self !== window.top && hasFrameId && window.__discordOpenExternal) {
        e.preventDefault();
        window.__discordOpenExternal(extBtn.href);
      }
    });
  }
  if (closeBtn && bar) {
    closeBtn.addEventListener('click', function(e) {
      e.preventDefault();
      bar.style.display = 'none';
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

  // 채널에서 새로 클릭된 파일(chanSess)이 있다면 오래된 인스턴스(instSess) 세션보다 무조건 최우선 적용!
  let chosen = null;
  if (chanSess && instSess) {
    const chanTime = typeof chanSess.updatedAt === 'number' ? chanSess.updatedAt : new Date(chanSess.updatedAt || 0).getTime();
    const instTime = typeof instSess.updatedAt === 'number' ? instSess.updatedAt : new Date(instSess.updatedAt || 0).getTime();
    chosen = (chanTime >= instTime) ? chanSess : instSess;
  } else {
    chosen = chanSess || instSess;
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

  return {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: {
      flags: 64, // EPHEMERAL (나한테만 보임)
      embeds: [
        {
          color: 0x5865f2,
          title: `📄 ${attachment.name} 렌더링 준비 완료`,
          description: '아래 버튼을 누르면 **디스코드 앱 내부 팝업(Activity)** 또는 **외부 브라우저**에서 즉시 실행됩니다.',
          fields: [
            { name: '파일 크기', value: `${(attachment.size / 1024).toFixed(1)} KB`, inline: true },
            { name: '업로더', value: `${uploaderName || '사용자'}`, inline: true }
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

      // 3-2. 슬래시 명령어 (/html) 처리
      if (interaction.type === 2 && interaction.data && interaction.data.name === 'html') {
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
                (m.attachments || []).some((att) => att.filename && att.filename.toLowerCase().endsWith('.html'))
              );
            }
          } catch (e) {}

          if (!foundMessages || foundMessages.length === 0) {
            return jsonResponse({
              type: 4,
              data: {
                flags: 64,
                content: '⚠️ **현재 채널의 최근 50개 메시지 중에서 `.html` 첨부파일을 찾지 못했습니다.**\n채팅방에 HTML 파일을 업로드한 후 다시 시도하거나, 메시지 링크를 입력해 주세요.'
              }
            });
          }

          targetMessage = foundMessages[0];
        }

        const attachment = (targetMessage.attachments || []).find(
          (att) => (att.filename || att.name || '').toLowerCase().endsWith('.html')
        );

        if (!attachment) {
          return jsonResponse({
            type: 4,
            data: { flags: 64, content: '⚠️ 선택된 메시지에 `.html` 첨부파일이 없습니다.' }
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

        // 최근 HTML 파일이 2개 이상이면 드롭다운 메뉴 추가
        if (foundMessages && foundMessages.length > 1) {
          const selectOptions = [];
          foundMessages.forEach((msg) => {
            (msg.attachments || []).forEach((att) => {
              const name = att.filename || att.name || '';
              if (name.toLowerCase().endsWith('.html') && selectOptions.length < 10) {
                selectOptions.push({
                  label: name.slice(0, 50),
                  description: `${msg.author ? msg.author.username : '사용자'} • ${(att.size / 1024).toFixed(1)} KB`,
                  value: `select_html:${msg.id}:${att.id}`,
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
                  custom_id: 'select_recent_html',
                  placeholder: '📂 최근 업로드된 다른 HTML 파일 선택...',
                  options: selectOptions
                }
              ]
            });
          }
        }

        return jsonResponse(payload);
      }

      // 3-3. 메시지 우클릭 컨텍스트 메뉴 (HTML 파일 실행) 처리
      if (interaction.type === 2 && interaction.data && interaction.data.name === 'HTML 파일 실행') {
        const targetId = interaction.data.target_id;
        const resolvedMsg = (interaction.data.resolved && interaction.data.resolved.messages) ? interaction.data.resolved.messages[targetId] : null;

        if (!resolvedMsg) {
          return jsonResponse({
            type: 4,
            data: { flags: 64, content: '⚠️ 대상 메시지 정보를 가져오지 못했습니다.' }
          });
        }

        const attachment = (resolvedMsg.attachments || []).find((att) =>
          (att.filename || att.name || '').toLowerCase().endsWith('.html')
        );

        if (!attachment) {
          return jsonResponse({
            type: 4,
            data: { flags: 64, content: '⚠️ 선택한 메시지에 첨부된 `.html` 파일이 없습니다.' }
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
                const att = (msg.attachments || []).find((a) => a.id === attId || (a.filename || a.name || '').toLowerCase().endsWith('.html'));
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
          }

          return jsonResponse({
            type: 12 // LAUNCH_ACTIVITY
          });
        }

        // 드롭다운 메뉴로 다른 최근 HTML 파일 선택 시 메시지 업데이트
        if (customId === 'select_recent_html' && interaction.data.values && interaction.data.values.length > 0) {
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
          const msgWithHtml = msgs.find((m) =>
            (m.attachments || []).some((a) => (a.filename || a.name || '').toLowerCase().endsWith('.html'))
          );
          if (msgWithHtml) {
            const att = msgWithHtml.attachments.find((a) => (a.filename || a.name || '').toLowerCase().endsWith('.html'));
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

    // 3) 세션이 확인되었고 instance_id가 존재한다면, 다른 참여자들이 동일하게 들어올 수 있도록 instance_id 세션 동기화 저장
    if (targetUrl && activityInstanceId) {
      await saveSession(env, { cdnUrl: targetUrl, fileName: fileTitle }, activityChannelId, null, null, activityInstanceId);
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
      return new Response('HTML 렌더링 중 오류가 발생했습니다: ' + err.message, { status: 500 });
    }
  }
};
