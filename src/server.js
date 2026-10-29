const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

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

// SSRF 방지 검사 함수 (로컬호스트, 사설망 IP 및 메타데이터 주소 차단)
function isBlockedTarget(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) return true;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host.endsWith('.local') || host.endsWith('.internal')) return true;
    const parts = host.split('.');
    if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
      const p0 = parseInt(parts[0], 10);
      const p1 = parseInt(parts[1], 10);
      if (p0 === 10) return true;
      if (p0 === 127) return true;
      if (p0 === 169 && p1 === 254) return true;
      if (p0 === 192 && p1 === 168) return true;
      if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
    }
    return false;
  } catch (e) {
    return true;
  }
}

// 경로 보존형 프록시 URL 생성 함수
function toProxyUrl(absUrl) {
  try {
    const u = new URL(absUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return absUrl;
    const proto = u.protocol.replace(':', '');
    return `/api/proxy/${proto}/${u.host}${u.pathname}${u.search}`;
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
    return req ? req.query.url : u.searchParams.get('url');
  }
  return null;
}

// eval()이나 new Function() 없이 순수 addEventListener 코드를 생성하는 CSP 완전 무결 이벤트 리스너 생성기
function buildGeneratedListenersScript(listenerEntries) {
  if (!listenerEntries || listenerEntries.length === 0) return '';
  let codeLines = [];
  for (const item of listenerEntries) {
    const safeCode = item.code.replace(/<\/script/gi, '<\\/script');
    codeLines.push(`  (function() {
    var el = document.querySelector('[data-aid="${item.aid}"]');
    if (el) {
      el.addEventListener('${item.event}', function(event) {
        ${item.event === 'submit' ? 'event.preventDefault();' : ''}
        ${safeCode}
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

// 런타임 심(Shim) 스크립트: 페이지 로드 후 실행되는 fetch, XHR, 동적 DOM 생성 및 샌드박스 스토리지 보정 + Discord SDK 연동
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

  // 1. fetch 및 XMLHttpRequest 가로채기
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
    return _open.apply(this, [method, wrap(url)].concat(rest));
  };

  // 2. 동적 DOM 에셋 생성 가로채기
  function patch(proto, prop) {
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if (d && d.set) {
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: d.enumerable,
        get: d.get,
        set: function(v) { d.set.call(this, wrap(v)); }
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
      val = wrap(val);
    }
    return _sa.call(this, name, val);
  };

  // 3. iframe 샌드박스 내 Storage 차단 대응
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
  } catch (e) {
    var createMemStore = function() {
      var store = {};
      return {
        getItem: function(k) { return store.hasOwnProperty(k) ? store[k] : null; },
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

  // 4. 모달 다이얼로그 폴백
  window.alert = function(msg) { console.log('[Alert]', msg); };
  window.confirm = function(msg) { console.log('[Confirm]', msg); return true; };
  window.prompt = function(msg, def) { console.log('[Prompt]', msg); return def || null; };

  // 5. Discord SDK 연동 및 외부 링크 안전 오픈
  var cid = '${discordClientId || ''}';
  if (window.self !== window.top && window.DiscordSDK && cid) {
    try {
      window.discordSdk = new window.DiscordSDK.DiscordSDK(cid);
      window.discordSdk.ready().catch(function(e) {
        console.warn('[DiscordSDK] ready error:', e);
      });
    } catch(sdkErr) {}
  }

  window.__discordOpenExternal = function(url) {
    if (window.discordSdk && window.discordSdk.commands && window.discordSdk.commands.openExternalLink) {
      window.discordSdk.commands.openExternalLink({ url: url }).catch(function() {
        window.open(url, '_blank');
      });
    } else {
      window.open(url, '_blank');
    }
  };

  document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (href && /^https?:/i.test(href) && !href.startsWith('/api/')) {
      var full = abs(href);
      if (full && new URL(full).origin !== location.origin) {
        e.preventDefault();
        window.__discordOpenExternal(full);
      }
    }
  }, true);

  // 6. CSP 위반 감지 배너
  document.addEventListener('securitypolicyviolation', function(e) {
    console.warn('[Discord CSP Blocked]', e.blockedURI, 'directive:', e.violatedDirective);
    var banner = document.getElementById('discord-csp-warning-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'discord-csp-warning-banner';
      banner.style.cssText = 'position:fixed;bottom:10px;left:50%;transform:translateX(-50%);z-index:2147483646;background:rgba(239,68,68,0.92);backdrop-filter:blur(6px);color:white;padding:6px 14px;border-radius:20px;font-size:12px;font-family:sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;gap:8px;';
      banner.innerHTML = '<span>⚠️ 일부 외부 기능이 디스코드 보안에 의해 차단되었습니다.</span><button style="background:white;color:#ef4444;border:none;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:bold;cursor:pointer;" onclick="this.parentElement.remove()">닫기</button>';
      (document.body || document.documentElement).appendChild(banner);
    }
  });
})();
</script>`;
}

// 동적 생성 요소 지원용 안전 이벤트 위임 폴백 브리지
const EVENT_BRIDGE_SCRIPT = `<script id="discord-csp-event-bridge">
(function() {
  function handleDynamicInteraction(e, evType) {
    var target = e.target.closest('[data-act-' + evType + '], form, button, a');
    if (!target) return;
    var code = target.getAttribute('data-act-' + evType);
    if (!code) return;

    try {
      var fnMatch = code.match(/^([a-zA-Z0-9_$.]+)\\s*\\((.*)\\)\\s*;?$/);
      if (fnMatch) {
        var fnName = fnMatch[1];
        var rawArgs = fnMatch[2].trim();
        var targetFn = null;
        if (fnName.includes('.')) {
          var parts = fnName.split('.');
          targetFn = window;
          for (var p = 0; p < parts.length; p++) {
            if (targetFn) targetFn = targetFn[parts[p]];
          }
        } else {
          targetFn = window[fnName];
        }
        if (typeof targetFn === 'function') {
          var args = [];
          if (rawArgs) {
            try {
              args = JSON.parse('[' + rawArgs.replace(/'/g, '"') + ']');
            } catch (err) {
              args = rawArgs.split(',').map(function(a) {
                var s = a.trim();
                return s.replace(/^[\\s('"]+|[\\s)'"]+$/g, '');
              });
            }
          }
          targetFn.apply(target, args);
          if (evType === 'submit') e.preventDefault();
          return;
        }
      }
      try {
        new Function('event', code).call(target, e);
        if (evType === 'submit') e.preventDefault();
      } catch (evalErr) {}
    } catch (bridgeErr) {
      console.error('[EventBridge Error]', bridgeErr);
    }
  }

  ['click', 'change', 'input', 'submit', 'keydown', 'keyup'].forEach(function(evName) {
    document.addEventListener(evName, function(e) {
      handleDynamicInteraction(e, evName);
    }, true);
  });
})();
</script>`;

// 플로팅 헬퍼 바 생성 (새로고침 및 Discord SDK 연동 새 창 바로가기 버튼 포함)
function buildHelperBar(fileTitle, directUrl) {
  return `
<div id="discord-activity-helper-bar" style="position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;align-items:center;gap:6px;background:rgba(15,23,42,0.92);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.18);padding:4px 10px;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#f1f5f9;box-shadow:0 4px 16px rgba(0,0,0,0.4);user-select:none;">
  <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;"></span>
  <span style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${fileTitle}</span>
  <button id="discord-helper-refresh-btn" style="background:#4f46e5;color:white;border:none;border-radius:10px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;transition:background 0.2s;">🔄 새로고침</button>
  <a id="discord-helper-external-btn" href="${directUrl}" style="background:#0284c7;color:white;text-decoration:none;border-radius:10px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;display:inline-block;transition:background 0.2s;" onclick="if(window.__discordOpenExternal){window.__discordOpenExternal('${directUrl}');return false;}">🌐 새 창</a>
  <button id="discord-helper-close-btn" style="background:transparent;color:#94a3b8;border:none;padding:2px 6px;font-size:13px;font-weight:bold;cursor:pointer;line-height:1;" title="헬퍼 바 숨기기">✕</button>
</div>
<script id="discord-helper-bar-script">
(function() {
  var bar = document.getElementById('discord-activity-helper-bar');
  var refreshBtn = document.getElementById('discord-helper-refresh-btn');
  var closeBtn = document.getElementById('discord-helper-close-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', function(e) { e.preventDefault(); window.location.reload(); });
  if (closeBtn && bar) closeBtn.addEventListener('click', function(e) { e.preventDefault(); bar.style.display = 'none'; });
})();
</script>`;
}

// 스트리밍 프록시 재작성 기반 디스코드 액티비티 HTML 렌더러
function renderHtmlForDiscordActivity(rawHtml, fileTitle, serverOrigin, targetUrl, discordClientId) {
  let processed = rawHtml;

  // 1. 외부 스크립트 (<script src="https://...">) -> 경로 보존형 toProxyUrl 주소로 재작성
  processed = processed.replace(/<script\b([^>]*?)\bsrc=["'](https?:\/\/[^"']+)["']([^>]*)>/gi, (m, b, url, a) => {
    if (url.includes('/api/')) return m;
    let attrs = (b + ' ' + a).replace(/\b(integrity|crossorigin)(=(['"]).*?\3|=[^\s>]+)?/gi, '');
    return `<script${attrs} src="${toProxyUrl(url)}">`;
  });

  // 2. 외부 스타일시트 (<link rel="stylesheet" href="https://...">) -> 경로 보존형 toProxyUrl 주소로 재작성
  processed = processed.replace(/<link\b([^>]*?)\bhref=["'](https?:\/\/[^"']+)["']([^>]*)>/gi, (m, b, url, a) => {
    if (url.includes('/api/')) return m;
    let attrs = (b + ' ' + a).replace(/\b(integrity|crossorigin)(=(['"]).*?\3|=[^\s>]+)?/gi, '');
    return `<link${attrs} href="${toProxyUrl(url)}">`;
  });

  // 3. 외부 이미지, 영상, 오디오 (<img src="https://..."> 등)
  processed = processed.replace(/<(img|source|video|audio)\b([^>]*?)\bsrc=["'](https?:\/\/[^"']+)["']([^>]*)>/gi, (m, tag, b, url, a) => {
    if (url.includes('/api/')) return m;
    return `<${tag}${b} src="${toProxyUrl(url)}"${a}>`;
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
      if (/^(https?:)?\/\//i.test(url) && !url.includes('/api/')) {
        const full = url.startsWith('//') ? 'https:' + url : url;
        url = toProxyUrl(full);
      }
      return `${url}${descriptor}`;
    }).join(', ');
    return `srcset=${q}${rewritten}${q}`;
  });

  // 5. 인라인 style="...url(https://...)..." 프록시 변환
  processed = processed.replace(/\bstyle=(['"])(.*?)\1/gi, (m, q, styleContent) => {
    if (!styleContent.includes('url(')) return m;
    const replaced = styleContent.replace(/url\(\s*(['"]?)(https?:\/\/[^'")]+)\1\s*\)/gi, (um, uq, u) => {
      if (u.includes('/api/')) return um;
      return `url("${toProxyUrl(u)}")`;
    });
    return `style=${q}${replaced}${q}`;
  });

  // 6. 인라인 이벤트 핸들러 on<event>="..." -> data-aid="N" 부여 및 순수 addEventListener 코드 수집
  const listenerEntries = [];
  let aidCounter = 0;
  const inlineEventRegex = /\b(on(click|change|submit|input|keydown|keyup))\s*=\s*(?:'([^']*)'|"([^"]*)")/gi;
  processed = processed.replace(inlineEventRegex, (match, fullAttr, eventName, singleCode, doubleCode) => {
    const code = singleCode !== undefined ? singleCode : (doubleCode !== undefined ? doubleCode : '');
    aidCounter++;
    listenerEntries.push({ aid: aidCounter, event: eventName, code: code });
    return `data-aid="${aidCounter}" data-act-${eventName}="${code.replace(/"/g, '&quot;')}"`;
  });

  // 7. <head>에 Discord Embedded App SDK 및 런타임 심 주입
  const headPayload = `\n<script src="/api/proxy/https/cdn.jsdelivr.net/npm/@discord/embedded-app-sdk@1.8.0/dist/index.min.js"></script>\n${buildRuntimeShimScript(discordClientId)}\n`;
  if (processed.includes('<head>')) {
    processed = processed.replace('<head>', `<head>${headPayload}`);
  } else if (/<head\b[^>]*>/i.test(processed)) {
    processed = processed.replace(/<head\b[^>]*>/i, `$&\n${headPayload}`);
  } else {
    processed = `<head>${headPayload}</head>\n` + processed;
  }

  // 8. <body> 끝 부분에 eval-free 생성 리스너, EVENT_BRIDGE_SCRIPT, helperBar 주입
  const directUrl = `${serverOrigin}/?cdn_url=${encodeURIComponent(targetUrl || '')}&title=${encodeURIComponent(fileTitle || '')}&_t=${Date.now()}`;
  const helperBar = buildHelperBar(fileTitle || 'Discord HTML Runner', directUrl);
  const generatedScript = buildGeneratedListenersScript(listenerEntries);
  const bodyEndPayload = `\n${generatedScript}\n${EVENT_BRIDGE_SCRIPT}\n${helperBar}\n`;

  if (processed.includes('</body>')) {
    processed = processed.replace('</body>', `${bodyEndPayload}</body>`);
  } else {
    processed += bodyEndPayload;
  }

  return processed;
}

// 정적 파일 제공 (public/activity_shell.html 등)
app.use(express.static(path.join(__dirname, '..', 'public')));
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
  if (!targetUrl) {
    let chosen = null;
    if (chanSess && instSess) {
      const chanTime = typeof chanSess.updatedAt === 'number' ? chanSess.updatedAt : new Date(chanSess.updatedAt || 0).getTime();
      const instTime = typeof instSess.updatedAt === 'number' ? instSess.updatedAt : new Date(instSess.updatedAt || 0).getTime();
      chosen = (chanTime >= instTime) ? chanSess : instSess;
    } else {
      chosen = chanSess || instSess;
    }

    if (!chosen && latestSession && latestSession.cdnUrl) {
      chosen = latestSession;
    }

    if (chosen) {
      targetUrl = chosen.cdnUrl;
      fileTitle = chosen.fileName;
      // 동일 방 참여자를 위해 최신 세션 동기화
      if (activityInstanceId) {
        instanceSessions.set(activityInstanceId, chosen);
      }
    }
  }

  // 방장이든 참여자이든, 유효한 URL과 instance_id가 있으면 동일 세션 참여자를 위해 캐싱
  if (activityInstanceId && targetUrl) {
    instanceSessions.set(activityInstanceId, {
      cdnUrl: targetUrl,
      fileName: fileTitle || 'Discord HTML Runner',
      updatedAt: Date.now()
    });
  }

  try {
    let rawHtml = '';

    if (!targetUrl) {
      const samplePath = path.join(__dirname, '..', 'examples', 'sample_test.html');
      if (fs.existsSync(samplePath)) {
        rawHtml = fs.readFileSync(samplePath, 'utf-8');
      } else {
        rawHtml = '<!DOCTYPE html><html><body style="background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;text-align:center;"><div><h2>🚀 Discord HTML Activity</h2><p style="color:#94a3b8;">디스코드 채팅방에 HTML 파일을 업로드하고 버튼을 눌러주세요.</p></div></body></html>';
      }
    } else {
      const parsedUrl = new URL(targetUrl);
      const allowedHosts = ['cdn.discordapp.com', 'media.discordapp.net'];
      if (!allowedHosts.includes(parsedUrl.hostname)) {
        return res.status(403).send('허용되지 않은 외부 도메인입니다. (cdn.discordapp.com만 가능)');
      }

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
            <p style="color:#94a3b8;font-size:14px;">디스코드 채팅방에서 HTML 파일을 다시 업로드하고 버튼을 눌러주세요!</p>
          </body>
          </html>
        `);
      }
      rawHtml = await response.text();
    }

    const serverOrigin = `${req.protocol}://${req.get('host')}`;
    const finalHtml = renderHtmlForDiscordActivity(rawHtml, fileTitle, serverOrigin, targetUrl, process.env.DISCORD_CLIENT_ID);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(finalHtml);
  } catch (error) {
    console.error('❌ 렌더링 실패:', error);
    res.status(500).send('HTML 렌더링 중 오류가 발생했습니다.');
  }
}

// 디스코드 액티비티 진입점 (루트 및 /activity_shell.html 모두 중첩 iframe 없는 네이티브 직결 렌더링!)
app.get('/', handleRenderRequest);
app.get('/activity_shell.html', handleRenderRequest);
app.get('/render', handleRenderRequest);
app.get('/view', handleRenderRequest);

// 검색엔진(구글, 네이버 등) 크롤러 접근 원천 차단
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});

// 클라우드 호스팅 헬스체크용 엔드포인트
app.get('/health', (req, res) => {
  res.status(200).send('OK');
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

    // 응답 크기 제한 (15MB 초과 차단)
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 15 * 1024 * 1024) {
      return res.status(413).send('Payload Too Large (>15MB)');
    }

    let contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (assetUrl.endsWith('.woff2')) contentType = 'font/woff2';
    else if (assetUrl.endsWith('.woff')) contentType = 'font/woff';
    else if (assetUrl.endsWith('.ttf')) contentType = 'font/ttf';
    else if (assetUrl.endsWith('.css')) contentType = 'text/css';
    else if (assetUrl.endsWith('.js') || assetUrl.endsWith('.mjs')) contentType = 'application/javascript';

    // 위험 파일 확장자 차단
    if (/application\/(x-msdownload|x-dosexec|x-sh)/i.test(contentType)) {
      return res.status(415).send('Unsupported Media Type');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // CSS 파일인 경우 내부 @import 및 url(...)을 재귀적으로 프록시 주소로 변환
    if (contentType.includes('text/css') || assetUrl.endsWith('.css')) {
      let cssText = await response.text();
      cssText = cssText.replace(/@import\s+url\(\s*(['"]?)(https?:\/\/[^'")]+)\1\s*\)\s*;?/gi, (m, q, u) => {
        return `@import url("${toProxyUrl(u)}");`;
      });
      cssText = cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, relUrl) => {
        let trimmed = relUrl.trim();
        if (trimmed.startsWith('data:') || trimmed.startsWith('/api/')) return m;
        try {
          const abs = new URL(trimmed, assetUrl).href;
          return `url("${toProxyUrl(abs)}")`;
        } catch (e) {
          return m;
        }
      });
      return res.send(cssText);
    }

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
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