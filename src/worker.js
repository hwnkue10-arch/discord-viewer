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

// 외부 에셋 및 폰트 인메모리 캐시 (반복 다운로드 방지)
const assetCache = new Map();

// ArrayBuffer를 Base64 문자열로 변환 (Cloudflare Workers 환경 호환)
function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// CSS 내부 상대경로 웹폰트/에셋을 data: Base64 URI로 완전 인라인화하거나 상대경로 프록시로 변환
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

      // 1. 웹폰트(.woff2, .woff, .ttf)는 data: Base64 URI로 100% 인라인화하여 디스코드 CSP 차단 원천 차단!
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
              base64Font = `data:${mime};base64,${bufferToBase64(fontBuf)}`;
              assetCache.set(absUrl, base64Font);
            }
          } catch (fontErr) {}
        }
        if (base64Font) {
          cssContent = cssContent.replace(fullMatch, () => `url("${base64Font}")`);
          continue;
        }
      }

      // 2. 기타 일반 리소스는 상대경로 프록시(/api/asset-proxy)로 연결 ('self' 도메인 유지)
      cssContent = cssContent.replace(fullMatch, () => `url("/api/asset-proxy?url=${encodeURIComponent(absUrl)}")`);
    } catch (e) {}
  }

  return cssContent;
}

// 외부 CSS/JS 에셋 다운로드 및 인라인화
async function processHtmlForDiscordActivity(rawHtml) {
  let processed = rawHtml;

  // 1. @import 외부 폰트/CSS 인라인화
  const importRegex = /@import\s+url\(\s*(['"]?)(https?:\/\/[^'")]+)\1\s*\)\s*;?/gi;
  const importMatches = [...processed.matchAll(importRegex)];
  for (const match of importMatches) {
    const fullTag = match[0];
    const importUrl = match[2];
    try {
      const res = await fetch(importUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const cssText = await res.text();
        const resolved = await resolveCssUrls(cssText, importUrl);
        processed = processed.replace(fullTag, () => `/* inlined @import ${importUrl} */\n${resolved}\n`);
      }
    } catch (err) {}
  }

  // 2. 외부 CSS (<link rel="stylesheet">) 인라인화
  const linkRegex = /<link\b(?=[^>]*?\bhref=["'](https?:\/\/[^"']+)["'])(?=[^>]*?\brel=["']stylesheet["'])[^>]*>/gi;
  const linkMatches = [...processed.matchAll(linkRegex)];
  for (const match of linkMatches) {
    const fullTag = match[0];
    const cssUrl = match[1];
    try {
      const res = await fetch(cssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const cssContent = await res.text();
        const resolved = await resolveCssUrls(cssContent, cssUrl);
        processed = processed.replace(fullTag, () => `<style data-inlined-from="${cssUrl}">\n${resolved}\n</style>`);
      }
    } catch (err) {}
  }

  // 3. 외부 JS (<script src="https://...">) 인라인화 (Tailwind, Chart.js 등)
  const scriptRegex = /<script\b[^>]*?\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>\s*<\/script>/gi;
  const scriptMatches = [...processed.matchAll(scriptRegex)];
  for (const match of scriptMatches) {
    const fullTag = match[0];
    const jsUrl = match[1];
    try {
      const res = await fetch(jsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const jsContent = await res.text();
        const safeJs = jsContent.replace(/<\/script/gi, '<\\/script');
        processed = processed.replace(fullTag, () => `<script data-inlined-from="${jsUrl}">\n${safeJs}\n</script>`);
      }
    } catch (err) {}
  }

  return processed;
}

// 디스코드 액티비티 CSP 클릭 차단 우회 이벤트 브리지 주입
function bridgeInlineEventHandlers(rawHtml) {
  let processed = rawHtml;
  const inlineEventRegex = /\b(on(click|change|submit|input|keydown|keyup))\s*=\s*(["'])([\s\S]*?)\3/gi;
  processed = processed.replace(inlineEventRegex, (match, fullAttr, eventName, quote, code) => {
    return `data-act-${eventName}=${quote}${code}${quote}`;
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

    // 카운터 직접 조작
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
      // 일반 함수 호출 패턴
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

// 메모리 세션 캐시 (폴백용)
const channelSessions = new Map();
let lastGlobalSession = null;
let lastInteractionChannelId = null;

// 세션 저장 헬퍼 (Cloudflare KV + 로컬 메모리)
async function saveSession(env, sessionData, channelId, userId) {
  if (channelId) {
    channelSessions.set(channelId, sessionData);
    lastInteractionChannelId = channelId;
  }
  lastGlobalSession = sessionData;

  if (env && env.SESSIONS) {
    try {
      const jsonStr = JSON.stringify(sessionData);
      const puts = [
        env.SESSIONS.put('latest', jsonStr, { expirationTtl: 86400 })
      ];
      if (channelId) {
        puts.push(env.SESSIONS.put(`chan:${channelId}`, jsonStr, { expirationTtl: 86400 }));
      }
      if (userId) {
        puts.push(env.SESSIONS.put(`user:${userId}`, jsonStr, { expirationTtl: 86400 }));
      }
      await Promise.allSettled(puts);
    } catch (e) {
      console.error('[KV saveSession error]', e);
    }
  }
}

// 세션 조회 헬퍼 (Cloudflare KV 우선 조회 후 로컬 메모리 폴백)
async function getSession(env, channelId, userId) {
  if (env && env.SESSIONS) {
    try {
      if (channelId) {
        const val = await env.SESSIONS.get(`chan:${channelId}`);
        if (val) return JSON.parse(val);
      }
      if (userId) {
        const val = await env.SESSIONS.get(`user:${userId}`);
        if (val) return JSON.parse(val);
      }
      const latest = await env.SESSIONS.get('latest');
      if (latest) return JSON.parse(latest);
    } catch (e) {
      console.error('[KV getSession error]', e);
    }
  }

  if (channelId && channelSessions.has(channelId)) {
    return channelSessions.get(channelId);
  }
  if (lastGlobalSession) {
    return lastGlobalSession;
  }
  return null;
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
  const directUrl = `${workerOrigin}/?cdn_url=${encodeURIComponent(attachment.url)}&title=${encodeURIComponent(attachment.name)}`;

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

    // 2. 외부 에셋 프록시 (/api/asset-proxy)
    if (url.pathname === '/api/asset-proxy') {
      const assetUrl = url.searchParams.get('url');
      if (!assetUrl) return new Response('Missing url parameter', { status: 400 });

      try {
        const response = await fetch(assetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        let contentType = response.headers.get('content-type') || 'application/octet-stream';
        if (assetUrl.endsWith('.woff2')) contentType = 'font/woff2';
        else if (assetUrl.endsWith('.woff')) contentType = 'font/woff';
        else if (assetUrl.endsWith('.ttf')) contentType = 'font/ttf';

        return new Response(response.body, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400'
          }
        });
      } catch (err) {
        return new Response('Asset fetch failed', { status: 502 });
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

        const sessionData = { cdnUrl: normAttachment.url, fileName: normAttachment.name };
        const user = interaction.user || (interaction.member && interaction.member.user);
        const userId = user ? user.id : null;
        await saveSession(env, sessionData, channelId, userId);

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

        const sessionData = { cdnUrl: normAttachment.url, fileName: normAttachment.name };
        const user = interaction.user || (interaction.member && interaction.member.user);
        const userId = user ? user.id : null;
        await saveSession(env, sessionData, interaction.channel_id, userId);

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
          if (channelId) {
            lastInteractionChannelId = channelId;
            if (env && env.SESSIONS) {
              try {
                const sess = await env.SESSIONS.get(`chan:${channelId}`);
                if (sess) {
                  await env.SESSIONS.put('latest', sess, { expirationTtl: 86400 });
                }
              } catch (e) {}
            }
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
    const activityChannelId = url.searchParams.get('channel_id') || lastInteractionChannelId;

    // 1) channel_id 또는 Cloudflare KV 세션에서 CDN URL 복원
    if (!targetUrl) {
      const sess = await getSession(env, activityChannelId, null);
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
              await saveSession(env, { cdnUrl: att.url, fileName: fileTitle }, activityChannelId, null);
            }
          }
        }
      } catch (e) {
        console.error('Channel fetch error:', e);
      }
    }

    if (!targetUrl) {
      // 파라미터나 채널 첨부파일이 아예 없을 때의 안내 화면
      const welcomeHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>Discord HTML Serverless Runner</title>
  <style>
    body { background: #0b0f19; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; }
    h1 { color: #38bdf8; font-size: 24px; margin-bottom: 8px; }
    p { color: #94a3b8; font-size: 14px; max-width: 480px; line-height: 1.6; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 16px; }
    .btn { background: #5865f2; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 16px; text-decoration: none; transition: background 0.2s; }
    .btn:hover { background: #4752c4; }
  </style>
</head>
<body>
  <div class="status-badge">● Cloudflare Workers 100% 서버리스 가동 중</div>
  <h1>🚀 Discord HTML Activity Serverless Runner</h1>
  <p>디스코드 채팅방에서 <strong>/html</strong> 명령어를 입력하거나, HTML 파일 메시지를 <strong>[우클릭 → 앱 → HTML 파일 실행]</strong>하면 디스코드 내부 팝업으로 즉시 실행됩니다.</p>
  <button class="btn" onclick="window.location.reload()">🔄 지금 파일 불러오기 / 새로고침</button>
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

      // 서버리스 에셋 완전 인라인화 (웹폰트 Base64 임베딩 포함)
      let finalHtml = await processHtmlForDiscordActivity(rawHtml);

      // CSP 클릭 이벤트 브리지 주입
      finalHtml = bridgeInlineEventHandlers(finalHtml);

      // 플로팅 헬퍼 바 주입
      const helperBar = `
<div id="discord-activity-helper-bar" style="position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;align-items:center;gap:8px;background:rgba(15,23,42,0.92);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.18);padding:4px 10px;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#f1f5f9;box-shadow:0 4px 16px rgba(0,0,0,0.4);user-select:none;">
  <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;"></span>
  <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${fileTitle}</span>
  <button id="discord-helper-refresh-btn" style="background:#4f46e5;color:white;border:none;border-radius:10px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;transition:background 0.2s;">🔄 새로고침</button>
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
</script>
`;
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `${helperBar}\n</body>`);
      } else {
        finalHtml += helperBar;
      }

      return new Response(finalHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        }
      });
    } catch (err) {
      return new Response('HTML 렌더링 중 오류가 발생했습니다: ' + err.message, { status: 500 });
    }
  }
};
