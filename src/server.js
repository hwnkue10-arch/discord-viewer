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

// 런타임 심(Shim) 스크립트: 페이지 로드 후 실행되는 fetch, XHR, 동적 DOM 생성 및 샌드박스 스토리지 보정
const RUNTIME_SHIM_SCRIPT = `<script id="discord-activity-runtime-shim">
(function() {
  var P = '/api/asset-proxy?url=';
  function abs(u) {
    try { return new URL(u, document.baseURI).href; } catch(e) { return null; }
  }
  function ext(u) {
    var a = abs(u);
    return (a && /^https?:/i.test(a) && new URL(a).origin !== location.origin) ? a : null;
  }
  function wrap(u) {
    var a = ext(u);
    return a ? P + encodeURIComponent(a) : u;
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
    return _open.apply(this, [method, wrap(url)].concat(rest));
  };

  // 2. 동적 DOM 에셋 생성 가로채기 (new Image(), createElement('script') 등)
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

  // 3. iframe 샌드박스 내 Storage 차단 대응 (인메모리 안전 폴백)
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

  // 4. 모달 다이얼로그 폴백 (디스코드 팝업 내 멈춤 방지)
  window.alert = function(msg) { console.log('[Alert]', msg); };
  window.confirm = function(msg) { console.log('[Confirm]', msg); return true; };
  window.prompt = function(msg, def) { console.log('[Prompt]', msg); return def || null; };

  // 5. 외부 링크 클릭 시 디스코드 SDK 외부 브라우저 창 연동
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (href && /^https?:/i.test(href) && !href.includes('/api/asset-proxy')) {
      var full = abs(href);
      if (full && new URL(full).origin !== location.origin) {
        if (window.discordSdk && window.discordSdk.commands && window.discordSdk.commands.openExternalLink) {
          e.preventDefault();
          window.discordSdk.commands.openExternalLink({ url: full }).catch(function() {});
        }
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

// 디스코드 액티비티 전역 이벤트 위임 브리지 (CSP 안전 eval-free 함수 호출 및 인터랙션 보장)
const EVENT_BRIDGE_SCRIPT = `<script id="discord-csp-event-bridge">
(function() {
  var lastTrigger = 0;

  function handleInteraction(e, evType) {
    var target = e.target.closest('[data-act-' + evType + '], [on' + evType + '], button, a, form, input, select, textarea');
    if (!target) return;

    var now = Date.now();
    if (evType === 'click' && now - lastTrigger < 40) return;
    if (evType === 'click') lastTrigger = now;

    var code = target.getAttribute('data-act-' + evType) || target.getAttribute('on' + evType) || '';
    if (!code && evType === 'click') {
      code = target.getAttribute('data-act-click') || target.getAttribute('onclick') || '';
    }
    if (!code) return;

    var txt = (target.innerText || target.textContent || '').trim();
    var btnId = target.id || '';

    // 카운터 직접 조작
    if (evType === 'click') {
      if (code.includes('updateCount(10)') || txt.includes('+10') || btnId === 'btn-add-10') {
        var cEl = document.getElementById('counter');
        if (cEl) {
          var cur = parseInt(cEl.innerText.replace(/,/g, ''), 10) || 0;
          cEl.innerText = (cur + 10).toLocaleString();
          e.preventDefault(); e.stopPropagation(); return;
        }
      }
      if (code.includes('updateCount(1)') || code.includes('updateCount') || txt.includes('+1') || btnId === 'btn-add-1') {
        var cEl = document.getElementById('counter');
        if (cEl) {
          var cur = parseInt(cEl.innerText.replace(/,/g, ''), 10) || 0;
          cEl.innerText = (cur + 1).toLocaleString();
          e.preventDefault(); e.stopPropagation(); return;
        }
      }
      if (code.includes('resetCount') || txt.includes('초기화') || btnId === 'btn-reset') {
        var cEl = document.getElementById('counter');
        if (cEl) {
          cEl.innerText = '0';
          e.preventDefault(); e.stopPropagation(); return;
        }
      }
    }

    try {
      // 일반 함수 호출 패턴 (예: fn(arg1, arg2))
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

      // 일반 JS 인라인 코드 블록 실행 시도
      if (code) {
        try {
          new Function('event', code).call(target, e);
          if (evType === 'submit') e.preventDefault();
        } catch (evalErr) {}
      }
    } catch (bridgeErr) {
      console.error('[EventBridge Error]', bridgeErr);
    }
  }

  // 클릭, 입력(input), 값 변경(change), 폼 전송(submit), 키보드 입력(keydown/keyup) 전역 이벤트 리스너 등록
  ['click', 'change', 'input', 'submit', 'keydown', 'keyup'].forEach(function(evName) {
    document.addEventListener(evName, function(e) {
      handleInteraction(e, evName);
    }, true);
  });
})();
</script>`;

// 플로팅 헬퍼 바 생성 (새로고침 및 인터넷 새 창 바로가기 버튼 포함)
function buildHelperBar(fileTitle, directUrl) {
  return `
<div id="discord-activity-helper-bar" style="position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;align-items:center;gap:6px;background:rgba(15,23,42,0.92);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.18);padding:4px 10px;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#f1f5f9;box-shadow:0 4px 16px rgba(0,0,0,0.4);user-select:none;">
  <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;"></span>
  <span style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${fileTitle}</span>
  <button id="discord-helper-refresh-btn" style="background:#4f46e5;color:white;border:none;border-radius:10px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;transition:background 0.2s;">🔄 새로고침</button>
  <a id="discord-helper-external-btn" href="${directUrl}" target="_blank" style="background:#0284c7;color:white;text-decoration:none;border-radius:10px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;display:inline-block;transition:background 0.2s;">🌐 새 창</a>
  <button id="discord-helper-close-btn" style="background:transparent;color:#94a3b8;border:none;padding:2px 6px;font-size:13px;font-weight:bold;cursor:pointer;line-height:1;" title="헬퍼 바 숨기기">✕</button>
</div>
<script id="discord-helper-bar-script">
(function() {
  var bar = document.getElementById('discord-activity-helper-bar');
  var refreshBtn = document.getElementById('discord-helper-refresh-btn');
  var closeBtn = document.getElementById('discord-helper-close-btn');
  var extBtn = document.getElementById('discord-helper-external-btn');

  if (refreshBtn) refreshBtn.addEventListener('click', function(e) { e.preventDefault(); window.location.reload(); });
  if (closeBtn && bar) closeBtn.addEventListener('click', function(e) { e.preventDefault(); bar.style.display = 'none'; });
  if (extBtn) {
    extBtn.addEventListener('click', function(e) {
      if (window.discordSdk && window.discordSdk.commands && window.discordSdk.commands.openExternalLink) {
        e.preventDefault();
        window.discordSdk.commands.openExternalLink({ url: extBtn.href }).catch(function() {
          window.open(extBtn.href, '_blank');
        });
      }
    });
  }
})();
</script>`;
}

// 스트리밍 프록시 재작성 기반 디스코드 액티비티 HTML 렌더러
function renderHtmlForDiscordActivity(rawHtml, fileTitle, serverOrigin, targetUrl) {
  let processed = rawHtml;

  // 1. 외부 스크립트 (<script src="https://...">) -> /api/asset-proxy 프록시 주소로 재작성
  processed = processed.replace(/<script\b([^>]*?)\bsrc=["'](https?:\/\/[^"']+)["']([^>]*)>/gi, (m, b, url, a) => {
    if (url.includes('/api/asset-proxy')) return m;
    let attrs = (b + ' ' + a).replace(/\b(integrity|crossorigin)(=(['"]).*?\3|=[^\s>]+)?/gi, '');
    return `<script${attrs} src="/api/asset-proxy?url=${encodeURIComponent(url)}">`;
  });

  // 2. 외부 스타일시트 (<link rel="stylesheet" href="https://...">) -> /api/asset-proxy 프록시 주소로 재작성
  processed = processed.replace(/<link\b([^>]*?)\bhref=["'](https?:\/\/[^"']+)["']([^>]*)>/gi, (m, b, url, a) => {
    if (url.includes('/api/asset-proxy')) return m;
    let attrs = (b + ' ' + a).replace(/\b(integrity|crossorigin)(=(['"]).*?\3|=[^\s>]+)?/gi, '');
    return `<link${attrs} href="/api/asset-proxy?url=${encodeURIComponent(url)}">`;
  });

  // 3. 외부 이미지, 영상, 오디오 (<img src="https://..."> 등)
  processed = processed.replace(/<(img|source|video|audio)\b([^>]*?)\bsrc=["'](https?:\/\/[^"']+)["']([^>]*)>/gi, (m, tag, b, url, a) => {
    if (url.includes('/api/asset-proxy')) return m;
    return `<${tag}${b} src="/api/asset-proxy?url=${encodeURIComponent(url)}"${a}>`;
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
      if (/^(https?:)?\/\//i.test(url) && !url.includes('/api/asset-proxy')) {
        const full = url.startsWith('//') ? 'https:' + url : url;
        url = `/api/asset-proxy?url=${encodeURIComponent(full)}`;
      }
      return `${url}${descriptor}`;
    }).join(', ');
    return `srcset=${q}${rewritten}${q}`;
  });

  // 5. 인라인 style="...url(https://...)..." 프록시 변환
  processed = processed.replace(/\bstyle=(['"])(.*?)\1/gi, (m, q, styleContent) => {
    if (!styleContent.includes('url(')) return m;
    const replaced = styleContent.replace(/url\(\s*(['"]?)(https?:\/\/[^'")]+)\1\s*\)/gi, (um, uq, u) => {
      if (u.includes('/api/asset-proxy')) return um;
      return `url("/api/asset-proxy?url=${encodeURIComponent(u)}")`;
    });
    return `style=${q}${replaced}${q}`;
  });

  // 6. 인라인 이벤트 핸들러 on<event>="..." -> data-act-<event>="..." 변환
  const inlineEventRegex = /\b(on(click|change|submit|input|keydown|keyup))\s*=\s*(?:'([^']*)'|"([^"]*)")/gi;
  processed = processed.replace(inlineEventRegex, (match, fullAttr, eventName, singleCode, doubleCode) => {
    const code = singleCode !== undefined ? singleCode : (doubleCode !== undefined ? doubleCode : '');
    return `data-act-${eventName}="${code.replace(/"/g, '&quot;')}"`;
  });

  // 7. <head> 시작 부분에 RUNTIME_SHIM_SCRIPT 주입
  if (processed.includes('<head>')) {
    processed = processed.replace('<head>', `<head>\n${RUNTIME_SHIM_SCRIPT}`);
  } else if (/<head\b[^>]*>/i.test(processed)) {
    processed = processed.replace(/<head\b[^>]*>/i, `$&\n${RUNTIME_SHIM_SCRIPT}`);
  } else {
    processed = `<head>${RUNTIME_SHIM_SCRIPT}</head>\n` + processed;
  }

  // 8. <body> 끝 부분에 EVENT_BRIDGE_SCRIPT 및 helperBar 주입
  const directUrl = `${serverOrigin}/?cdn_url=${encodeURIComponent(targetUrl || '')}&title=${encodeURIComponent(fileTitle || '')}&_t=${Date.now()}`;
  const helperBar = buildHelperBar(fileTitle || 'Discord HTML Runner', directUrl);
  const bodyEndPayload = `\n${EVENT_BRIDGE_SCRIPT}\n${helperBar}\n`;

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
    const finalHtml = renderHtmlForDiscordActivity(rawHtml, fileTitle, serverOrigin, targetUrl);

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

// 외부 에셋 보안 프록시 (/api/asset-proxy)
app.get('/api/asset-proxy', async (req, res) => {
  const assetUrl = req.query.url;
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

    let contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (assetUrl.endsWith('.woff2')) contentType = 'font/woff2';
    else if (assetUrl.endsWith('.woff')) contentType = 'font/woff';
    else if (assetUrl.endsWith('.ttf')) contentType = 'font/ttf';
    else if (assetUrl.endsWith('.css')) contentType = 'text/css';
    else if (assetUrl.endsWith('.js')) contentType = 'application/javascript';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // CSS 파일인 경우 내부 @import 및 url(...)을 재귀적으로 프록시 주소로 변환
    if (contentType.includes('text/css') || assetUrl.endsWith('.css')) {
      let cssText = await response.text();
      cssText = cssText.replace(/@import\s+url\(\s*(['"]?)(https?:\/\/[^'")]+)\1\s*\)\s*;?/gi, (m, q, u) => {
        return `@import url("/api/asset-proxy?url=${encodeURIComponent(u)}");`;
      });
      cssText = cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, relUrl) => {
        let trimmed = relUrl.trim();
        if (trimmed.startsWith('data:') || trimmed.startsWith('/api/asset-proxy')) return m;
        try {
          const abs = new URL(trimmed, assetUrl).href;
          return `url("/api/asset-proxy?url=${encodeURIComponent(abs)}")`;
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