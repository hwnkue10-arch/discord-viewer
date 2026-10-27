const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType
} = require('discord.js');
const { setLatestSession } = require('./server');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 첨부파일 메모리 캐시 (슬래시 커맨드 및 우클릭 실행 시 즉각적인 CDN 링크 조회 보장)
const attachmentCache = new Map();

// 1. 슬래시 명령어 (/html) 빌더
const htmlSlashCommand = new SlashCommandBuilder()
  .setName('html')
  .setDescription('HTML 파일을 디스코드 액티비티로 즉시 실행합니다.')
  .addAttachmentOption((option) =>
    option
      .setName('file')
      .setDescription('실행할 .html 파일을 첨부하세요')
      .setRequired(true)
  );

// 2. 메시지 우클릭 컨텍스트 메뉴 (앱 -> HTML 파일 실행)
const htmlContextMenuCommand = new ContextMenuCommandBuilder()
  .setName('HTML 파일 실행')
  .setType(ApplicationCommandType.Message);

// 실행 버튼 및 임베드 생성 헬퍼 함수
function buildLaunchPayload(attachment, messageId = 'cmd', uploaderName = '사용자') {
  attachmentCache.set(attachment.id, {
    name: attachment.name,
    url: attachment.url,
    size: attachment.size
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📄 ${attachment.name} 렌더링 준비 완료`)
    .setDescription(
      '아래 버튼을 누르면 **디스코드 앱 내부 팝업창(Activity)** 또는 **외부 브라우저**에서 즉시 실행됩니다.'
    )
    .addFields(
      { name: '파일 크기', value: `${(attachment.size / 1024).toFixed(1)} KB`, inline: true },
      { name: '요청자', value: `${uploaderName}`, inline: true }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`launch_popup:${messageId}:${attachment.id}`)
      .setLabel('⚡ 디스코드 내부 팝업으로 즉시 실행')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`launch_web:${messageId}:${attachment.id}`)
      .setLabel('🌐 인터넷 새 창으로 열기')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

client.once('clientReady', async () => {
  console.log(`✅ 디스코드 봇 로그인 완료: ${client.user.tag}`);

  try {
    console.log('🔄 슬래시 명령어(/html) 및 우클릭 메뉴(HTML 파일 실행) 등록 중...');
    await client.application.commands.set([htmlSlashCommand, htmlContextMenuCommand]);
    console.log('✅ 디스코드 명령어 등록 성공! (/html 및 메시지 우클릭 메뉴 사용 가능)');
  } catch (cmdErr) {
    console.warn('⚠️ 명령어 등록 중 안내 (권한 확인 필요):', cmdErr.message);
  }

  console.log('📂 채널 업로드 자동 감지, /html 명령어, 메시지 우클릭 실행이 모두 대기 중입니다.');
});

// [1단계] 사용자가 채팅창에 .html 파일을 올리면 감지하여 실행 버튼 생성
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;

    // .html 확장자 첨부파일 찾기
    const attachment = message.attachments.find(
      (att) => att.name && att.name.toLowerCase().endsWith('.html')
    );
    if (!attachment) return;

    const payload = buildLaunchPayload(attachment, message.id, message.author.username);
    await message.reply(payload);
  } catch (error) {
    console.error('❌ 메시지 처리 중 오류:', error);
  }
});

// [2단계] 인터랙션 처리 (슬래시 커맨드, 메시지 우클릭 앱, 실행 버튼)
client.on('interactionCreate', async (interaction) => {
  // 1. 슬래시 명령어 (/html) 처리 (나한테만 보이는 Ephemeral 메시지로 전송)
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'html') {
      const file = interaction.options.getAttachment('file');
      if (!file || !file.name.toLowerCase().endsWith('.html')) {
        return await interaction.reply({
          content: '⚠️ `.html` 확장자를 가진 파일만 실행할 수 있습니다.',
          flags: MessageFlags.Ephemeral
        });
      }
      const payload = buildLaunchPayload(file, 'cmd', interaction.user.username);
      payload.flags = MessageFlags.Ephemeral;
      return await interaction.reply(payload);
    }
  }

  // 2. 메시지 우클릭 컨텍스트 메뉴 (앱 -> HTML 파일 실행) 처리 (나한테만 보이는 Ephemeral 메시지)
  if (interaction.isMessageContextMenuCommand()) {
    if (interaction.commandName === 'HTML 파일 실행') {
      const targetMsg = interaction.targetMessage;
      const file = targetMsg.attachments.find(
        (att) => att.name && att.name.toLowerCase().endsWith('.html')
      );
      if (!file) {
        return await interaction.reply({
          content: '⚠️ 선택한 메시지에 첨부된 `.html` 파일이 없습니다.',
          flags: MessageFlags.Ephemeral
        });
      }
      const payload = buildLaunchPayload(file, targetMsg.id, interaction.user.username);
      payload.flags = MessageFlags.Ephemeral;
      return await interaction.reply(payload);
    }
  }

  // 3. 버튼 클릭 시 디스코드 액티비티 또는 브라우저 실행
  if (!interaction.isButton()) return;

  const isPopup = interaction.customId.startsWith('launch_popup:');
  const isWeb = interaction.customId.startsWith('launch_web:');
  if (!isPopup && !isWeb) return;

  try {
    const [, messageId, attachmentId] = interaction.customId.split(':');

    let freshCdnUrl = null;
    let freshFileName = null;

    // 1) 일반 메시지인 경우 메시지를 다시 fetch하여 만료 토큰이 갱신된 최신 CDN URL 확보
    if (messageId && messageId !== 'cmd' && interaction.channel) {
      try {
        const targetMessage = await interaction.channel.messages.fetch(messageId);
        const att = targetMessage.attachments.get(attachmentId);
        if (att) {
          freshCdnUrl = att.url;
          freshFileName = att.name;
        }
      } catch (fetchErr) {}
    }

    // 2) 슬래시 커맨드(/html) 또는 캐시된 첨부파일 정보 조회
    if (!freshCdnUrl) {
      const cached = attachmentCache.get(attachmentId);
      if (cached) {
        freshCdnUrl = cached.url;
        freshFileName = cached.name;
      }
    }

    if (!freshCdnUrl) {
      return await interaction.reply({
        content: '⚠️ 원본 첨부파일을 찾을 수 없습니다. 메시지가 삭제되었거나 만료되었을 수 있습니다.',
        flags: MessageFlags.Ephemeral
      });
    }

    // 액티비티 팝업이 열리자마자 이 파일을 바로 띄울 수 있도록 서버 세션 업데이트
    setLatestSession({
      guildId: interaction.guildId || 'dm',
      channelId: interaction.channelId,
      fileName: freshFileName,
      cdnUrl: freshCdnUrl,
      requestedBy: interaction.user.username,
      updatedAt: new Date().toISOString()
    });

    const publicBaseUrl = (
      process.env.PUBLIC_ACTIVITY_URL || `http://localhost:${process.env.PORT || 3000}`
    ).replace(/\/$/, '');
    const directPreviewUrl = `${publicBaseUrl}/activity_shell.html?cdn_url=${encodeURIComponent(freshCdnUrl)}&title=${encodeURIComponent(freshFileName || 'Discord HTML Runner')}`;

    // 1) [⚡ 디스코드 내부 팝업으로 즉시 실행] 버튼을 누른 경우 -> 로켓 아이콘 없이 즉시 액티비티 팝업 실행!
    if (isPopup) {
      try {
        if (typeof interaction.launchActivity === 'function') {
          return await interaction.launchActivity();
        } else {
          return await client.rest.post(
            `/interactions/${interaction.id}/${interaction.token}/callback`,
            { body: { type: 12 } }
          );
        }
      } catch (activityErr) {
        console.warn('⚠️ 액티비티 직접 호출 실패 (개발자 포털 설정 확인 필요):', activityErr.message);
        const fallbackRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('🌐 프리뷰 창으로 바로 열기')
            .setStyle(ButtonStyle.Link)
            .setURL(directPreviewUrl)
        );
        return await interaction.reply({
          content: [
            `⚠️ **디스코드 내부 액티비티 팝업을 바로 열지 못했습니다.**`,
            `디스코드 개발자 포털의 **활동(Activities) → 설정(Settings)**에서 **활동 활성화(Enable Activities)**가 켜져 있는지 확인해 주세요!`,
            `아래 버튼으로는 지금 바로 화면을 열 수 있습니다.`
          ].join('\n'),
          components: [fallbackRow],
          flags: MessageFlags.Ephemeral
        });
      }
    }

    // 2) [🌐 인터넷 새 창으로 열기] 버튼을 누른 경우
    const previewRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🌐 클릭하여 화면 열기')
        .setStyle(ButtonStyle.Link)
        .setURL(directPreviewUrl)
    );

    await interaction.reply({
      content: `✅ **${freshFileName}**의 최신 렌더링 주소가 준비되었습니다! 아래 버튼을 눌러 확인하세요.`,
      components: [previewRow],
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    console.error('❌ 버튼 인터랙션 처리 중 오류:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ 실행 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
});

async function startBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || token === 'your_discord_bot_token_here') {
    console.warn('⚠️ [안내] .env 파일에 DISCORD_BOT_TOKEN이 아직 설정되지 않았습니다.');
    return;
  }
  await client.login(token);
}

module.exports = { startBot, client };