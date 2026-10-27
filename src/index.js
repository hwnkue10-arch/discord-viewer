require('dotenv').config();
const { startServer } = require('./server');
const { startBot } = require('./bot');

async function main() {
  console.log('====================================================');
  console.log('🚀 Discord HTML/CSS 실시간 렌더러 (Method B) 시작 중...');
  console.log('====================================================');

  // 1. 액티비티 쉘(activity_shell.html) 및 CDN 프록시 서버 실행
  const port = process.env.PORT || 3000;
  await startServer(port);

  // 2. 디스코드 봇 실행
  await startBot();
}

main().catch((err) => {
  console.error('❌ 프로그램 시작 중 오류 발생:', err);
  process.exit(1);
});
