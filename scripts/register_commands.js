require('dotenv').config();
const fs = require('fs');
const path = require('path');

function getEnvValue(key) {
  if (process.env[key] && !process.env[key].includes('your_')) {
    return process.env[key];
  }
  const wranglerPath = path.join(__dirname, '..', 'wrangler.toml');
  if (fs.existsSync(wranglerPath)) {
    const content = fs.readFileSync(wranglerPath, 'utf-8');
    const match = content.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`));
    if (match) return match[1];
  }
  return null;
}

const token = getEnvValue('DISCORD_BOT_TOKEN');
const clientId = getEnvValue('DISCORD_CLIENT_ID');

if (!token || !clientId) {
  console.error('❌ DISCORD_BOT_TOKEN 또는 DISCORD_CLIENT_ID를 찾을 수 없습니다.');
  process.exit(1);
}

async function registerCommands() {
  console.log(`🌐 기존 Discord Application Commands 조회 중... (Client ID: ${clientId})`);
  const listUrl = `https://discord.com/api/v10/applications/${clientId}/commands`;
  
  const existingRes = await fetch(listUrl, {
    headers: { Authorization: `Bot ${token}` }
  });
  
  if (!existingRes.ok) {
    console.error('❌ 기존 명령어 조회 실패:', await existingRes.text());
    process.exit(1);
  }
  
  const existingCommands = await existingRes.json();
  // 디스코드 액티비티 Primary Entry Point (type: 4)는 반드시 보존되어야 함
  const entryPoint = existingCommands.find(c => c.type === 4);

  const updatedCommands = [
    {
      name: 'view',
      type: 1, // CHAT_INPUT (슬래시 커맨드)
      description: '채팅방의 문서(HTML, PDF, MD, PPTX)를 찾아 즉시 엽니다.',
      integration_types: [0, 1], // Guild Install + User Install
      contexts: [0, 1, 2],       // 서버, 봇 DM, 개인/그룹 DM
      options: [
        {
          name: 'message',
          type: 3,
          description: '(선택) 특정 메시지 링크 또는 ID를 지정하여 실행합니다.',
          required: false
        }
      ]
    },
    {
      name: '파일 바로보기',
      type: 3, // MESSAGE Context Menu (우클릭)
      integration_types: [0, 1],
      contexts: [0, 1, 2]
    }
  ];

  if (entryPoint) {
    updatedCommands.unshift({
      name: entryPoint.name || 'launch',
      type: 4,
      description: entryPoint.description || 'Launch an activity',
      handler: entryPoint.handler || 2,
      integration_types: [0, 1],
      contexts: [0, 1, 2]
    });
  }

  console.log('🌐 신규 전역 슬래시 명령어 동기화(Bulk Overwrite) 중...');
  const putRes = await fetch(listUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updatedCommands)
  });

  if (!putRes.ok) {
    console.error('❌ 등록 실패:', await putRes.text());
    process.exit(1);
  }

  const result = await putRes.json();
  console.log('====================================================');
  console.log('🎉 디스코드 전역 명령어 등록 성공!');
  console.log('====================================================');
  result.forEach((cmd) => {
    const typeLabel = cmd.type === 1 ? '슬래시 /' : cmd.type === 3 ? '우클릭 메뉴' : '액티비티 진입점';
    console.log(`• [${typeLabel}] ${cmd.name} (ID: ${cmd.id})`);
  });

  const viewCmd = result.find(c => c.name === 'view');
  if (viewCmd) {
    console.log('\n✨ [프로필 명령어 노출 안내]');
    console.log(`1. 봇 프로필의 [명령어] 섹션에 </view:${viewCmd.id}> 가 노출됩니다.`);
    console.log(`2. 봇 소개글(About Me)에 </view:${viewCmd.id}> 를 붙여넣으면 알로항처럼 파란색 알약 버튼으로 링크됩니다!`);
  }
}

registerCommands().catch((err) => {
  console.error('에러 발생:', err);
  process.exit(1);
});
