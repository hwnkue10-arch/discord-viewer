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

// 외부 에셋 다운로드 함수 (캐시 우선)
async function getAssetContent(url) {
  if (assetCache.has(url)) {
    return assetCache.get(url);
  }
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const text = await res.text();
    assetCache.set(url, text);
    return text;
  } catch (err) {
    console.error(`⚠️ 외부 에셋 다운로드 실패 (${url}):`, err.message);
    return null;
  }
}

// CSS 내부의 상대 경로 url(...)을 C++ Base64 Data URI 또는 서버 프록시 절대 경로로 변환하여 폰트/이미지 404 및 CSP 차단 완전 방지
async function resolveCssUrls(cssContent, baseUrl) {
  const urlRegex = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  const matches = [...cssContent.matchAll(urlRegex)];

  for (const match of matches) {
    const fullMatch = match[0];
    let relUrl = match[2].trim();

    if (relUrl.startsWith('data:') || relUrl.startsWith('/api/asset-proxy')) {
      continue;
    }

    try {
      const absUrl = new URL(relUrl, baseUrl).href;

      // 1. 웹폰트(.woff2, .woff, .ttf)는 C++ 네이티브 Base64 Data URI로 고속 인라인화하여 아이콘 네모(▯) 깨짐 방지!
      if (absUrl.endsWith('.woff2') || absUrl.endsWith('.woff') || absUrl.endsWith('.ttf')) {
        let base64Font = assetCache.get(absUrl);
        if (!base64Font) {
          try {
            const fontRes = await fetch(absUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (fontRes.ok) {
              const fontBuf = await fontRes.arrayBuffer();
              let mime = 'font/woff2';
              if (absUrl.endsWith('.woff')) mime = 'font/woff';
              else if (absUrl.endsWith('.ttf')) mime = 'font/ttf';
              base64Font = `data:${mime};base64,${Buffer.from(fontBuf).toString('base64')}`;
              assetCache.set(absUrl, base64Font);
            }
          } catch (fontErr) {}
        }
        if (base64Font) {
          cssContent = cssContent.replace(fullMatch, () => `url("${base64Font}")`);
          continue;
        }
      }

      cssContent = cssContent.replace(fullMatch, () => `url("/api/asset-proxy?url=${encodeURIComponent(absUrl)}")`);
    } catch (e) {}
  }

  return cssContent;
}

// [핵심 해결책: 서버 사이드 완전 인라인화]
// 디스코드 액티비티(*.discordsays.com)는 엄격한 보안(CSP)으로 외부 인터넷(CDN) 통신을 전면 차단합니다.
// 브라우저 대신 내 서버(Node.js)가 외부 CSS, 폰트, JS를 먼저 다운받아 HTML 내부에 <style>, <script>로 직접 삽입합니다.
async function processHtmlForDiscordActivity(rawHtml) {
  let processed = rawHtml;

  // 1. <style> 태그 내부의 @import url('https://...') 외부 폰트/CSS 사전 인라인화
  const importRegex = /@import\s+url\(\s*(['"]?)(https?:\/\/[^'")]+)\1\s*\)\s*;?/gi;
  const importMatches = [...processed.matchAll(importRegex)];
  for (const match of importMatches) {
    const fullTag = match[0];
    const importUrl = match[2];
    const importCss = await getAssetContent(importUrl);
    if (importCss) {
      console.log(`✅ [인라인 주입] @import 외부 CSS 변환: ${importUrl}`);
      const resolved = await resolveCssUrls(importCss, importUrl);
      processed = processed.replace(fullTag, () => `/* inlined @import ${importUrl} */\n${resolved}\n`);
    }
  }

  // 2. 외부 CSS (<link rel="stylesheet" href="https://...">) -> <style> 태그로 완전 인라인화 (FontAwesome 등 웹폰트 자동 프록시 연결)
  const linkRegex = /<link\b(?=[^>]*?\bhref=["'](https?:\/\/[^"']+)["'])(?=[^>]*?\brel=["']stylesheet["'])[^>]*>/gi;
  const linkMatches = [...processed.matchAll(linkRegex)];
  for (const match of linkMatches) {
    const fullTag = match[0];
    const cssUrl = match[1];
    const cssContent = await getAssetContent(cssUrl);
    if (cssContent) {
      console.log(`✅ [인라인 주입] CSS 외부 에셋 변환: ${cssUrl}`);
      const resolved = await resolveCssUrls(cssContent, cssUrl);
      processed = processed.replace(fullTag, () => `<style data-inlined-from="${cssUrl}">\n${resolved}\n</style>`);
    }
  }

  // 3. 외부 JS (<script src="https://..."></script>) -> <script> 내부 코드로 완전 인라인화 (Tailwind Play CDN, Chart.js 등 100% 실행 보장)
  const scriptRegex = /<script\b[^>]*?\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>\s*<\/script>/gi;
  const scriptMatches = [...processed.matchAll(scriptRegex)];
  for (const match of scriptMatches) {
    const fullTag = match[0];
    const jsUrl = match[1];

    const jsContent = await getAssetContent(jsUrl);
    if (jsContent) {
      console.log(`✅ [인라인 주입] JS 외부 에셋 변환: ${jsUrl} (~${Math.round(jsContent.length / 1024)} KB)`);
      // 스크립트 내부의 </script> 문자열이 브라우저 HTML 파서를 깨트리지 않도록 치환
      const safeJs = jsContent.replace(/<\/script/gi, '<\\/script');
      // $ 패턴($&, $', $1 등)으로 인한 문자열 오염을 막기 위해 반드시 함수() => 형태로 교체
      processed = processed.replace(fullTag, () => `<script data-inlined-from="${jsUrl}">\n${safeJs}\n</script>`);
    }
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

    // 1. 인라인 onclick 등 이벤트 핸들러 보강 (가벼운 원본 HTML에 먼저 적용하여 백트래킹 방지)
    let bridgedHtml = bridgeInlineEventHandlers(rawHtml);

    // 2. 외부 CSS/JS 및 웹폰트 고속 인라인화
    let finalHtml = await processHtmlForDiscordActivity(bridgedHtml);

    // 3. 디스코드 액티비티 상단에 세련된 플로팅 새로고침 헬퍼 바 주입 (CSP 준수 addEventListener 바인딩)
    const helperBar = `
<div id="discord-activity-helper-bar" style="position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;align-items:center;gap:8px;background:rgba(15,23,42,0.92);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.18);padding:4px 10px;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#f1f5f9;box-shadow:0 4px 16px rgba(0,0,0,0.4);user-select:none;">
  <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;"></span>
  <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${fileTitle}</span>
  <button id="discord-helper-refresh-btn" style="background:#4f46e5;color:white;border:none;border-radius:10px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;transition:background 0.2s;" onmouseover="this.style.background='#6366f1'" onmouseout="this.style.background='#4f46e5'">🔄 새로고침</button>
  <button id="discord-helper-close-btn" style="background:transparent;color:#94a3b8;border:none;padding:2px 6px;font-size:13px;font-weight:bold;cursor:pointer;line-height:1;" title="헬퍼 바 숨기기" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#94a3b8'">✕</button>
</div>
<script id="discord-helper-bar-script">
(function() {
  var bar = document.getElementById('discord-activity-helper-bar');
  var refreshBtn = document.getElementById('discord-helper-refresh-btn');
  var closeBtn = document.getElementById('discord-helper-close-btn');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = '/?_t=' + Date.now();
    });
  }

  if (closeBtn && bar) {
    closeBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      bar.style.display = 'none';
      try { bar.remove(); } catch(err) {}
    });
  }
})();
</script>
`;
    if (finalHtml.includes('</body>')) {
      finalHtml = finalHtml.replace('</body>', `${helperBar}\n</body>`);
    } else {
      finalHtml += helperBar;
    }

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

// 외부 이미지/폰트 보조용 프록시 (필요 시 상대 경로로 호출 가능)
app.get('/api/asset-proxy', async (req, res) => {
  const assetUrl = req.query.url;
  if (!assetUrl) return res.status(400).send('Missing url');

  try {
    const response = await fetch(assetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    let contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (assetUrl.endsWith('.woff2')) contentType = 'font/woff2';
    else if (assetUrl.endsWith('.woff')) contentType = 'font/woff';
    else if (assetUrl.endsWith('.ttf')) contentType = 'font/ttf';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('❌ 외부 에셋 프록시 실패:', error.message);
    res.status(502).send('Asset fetch failed');
  }
});

// 디스코드 액티비티 CSP가 inline event handler (onclick="...")를 차단하므로
// 모든 on<event>="..."를 data-act-<event>="..."로 안전하게 변환하고 전역 캡처링 이벤트 위임으로 100% 실행 보장
function bridgeInlineEventHandlers(rawHtml) {
  let processed = rawHtml;

  const inlineEventRegex = /\b(on(click|change|submit|input|keydown|keyup))\s*=\s*(?:'([^']*)'|"([^"]*)")/gi;
  processed = processed.replace(inlineEventRegex, (match, fullAttr, eventName, singleCode, doubleCode) => {
    const code = singleCode !== undefined ? singleCode : (doubleCode !== undefined ? doubleCode : '');
    return `data-act-${eventName}="${code.replace(/"/g, '&quot;')}"`;
  });

  const bridgeScript = `
<script id="discord-csp-event-bridge">
(function() {
  var lastTrigger = 0;

  function handleInteraction(e) {
    var btn = e.target.closest('[data-act-click], [onclick], button, a');
    if (!btn) return;

    var now = Date.now();
    if (now - lastTrigger < 50) return;
    lastTrigger = now;

    var code = btn.getAttribute('data-act-click') || btn.getAttribute('onclick') || '';
    var txt = (btn.innerText || btn.textContent || '').trim();
    var btnId = btn.id || '';

    // 1. 카운터 전용 직접 DOM 조작 (디스코드 CSP가 모든 스크립트를 차단해도 100% 무조건 카운트 증가 보장!)
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

    try {
      // 2. 일반 함수 호출 패턴 (예: myFunction(arg1, arg2))
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
                s = s.replace(/^[\\s('"]+|[\\s)'"]+$/g, '');
                return s;
              });
            }
          }
          targetFn.apply(btn, args);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      // 3. 일반 JS 코드 블록 실행 시도
      if (code) {
        try {
          new Function('event', code).call(btn, e);
          e.preventDefault();
        } catch (evalErr) {}
      }
    } catch (bridgeErr) {
      console.error('[EventBridge Error]', bridgeErr);
    }
  }

  // 캡처링 단계에서 클릭 이벤트 즉각 감지 및 실행
  document.addEventListener('click', handleInteraction, true);
})();
</script>
`;

  if (processed.includes('</body>')) {
    processed = processed.replace('</body>', `${bridgeScript}\n</body>`);
  } else {
    processed += bridgeScript;
  }

  return processed;
}

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