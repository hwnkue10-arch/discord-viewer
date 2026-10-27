const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const { setLatestSession } = require('./server');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('clientReady', () => {
  console.log(`✅ 디스코드 봇 로그인 완료: ${client.user.tag}`);
  console.log('📂 이제 채널에 .html 파일을 업로드하면 실행 버튼이 자동 생성됩니다.');
});

// [1단계] 사용자가 .html 파일을 올리면 감지하여 실행 버튼 생성
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;

    // .html 확장자 첨부파일 찾기
    const attachment = message.attachments.find(
      (att) => att.name && att.name.toLowerCase().endsWith('.html')
    );
    if (!attachment) return;

    const shortMsgId = message.id;
    const shortAttId = attachment.id;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📄 ${attachment.name} 렌더링 준비 완료`)
      .setDescription(
        '아래 버튼을 누르면 **디스코드 앱 내부 팝업창(Activity)** 또는 **외부 브라우저**에서 즉시 실행됩니다.'
      )
      .addFields(
        { name: '파일 크기', value: `${(attachment.size / 1024).toFixed(1)} KB`, inline: true },
        { name: '업로더', value: `${message.author.username}`, inline: true }
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`launch_popup:${shortMsgId}:${shortAttId}`)
        .setLabel('⚡ 디스코드 내부 팝업으로 즉시 실행')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`launch_web:${shortMsgId}:${shortAttId}`)
        .setLabel('🌐 인터넷 새 창으로 열기')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.reply({
      embeds: [embed],
      components: [row]
    });
  } catch (error) {
    console.error('❌ 메시지 처리 중 오류:', error);
  }
});

// [4단계 연동] 버튼 클릭 시 최신 CDN 링크 갱신 후 디스코드 내부 액티비티 팝업 즉시 호출!
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const isPopup = interaction.customId.startsWith('launch_popup:');
  const isWeb = interaction.customId.startsWith('launch_web:');
  if (!isPopup && !isWeb) return;

  try {
    const [, messageId, attachmentId] = interaction.customId.split(':');

    // 버튼 클릭 시점에 메시지를 다시 fetch하여 만료 토큰이 갱신된 최신 CDN URL 확보
    const targetMessage = await interaction.channel.messages.fetch(messageId);
    const freshAttachment = targetMessage.attachments.get(attachmentId);

    if (!freshAttachment) {
      return await interaction.reply({
        content: '⚠️ 원본 첨부파일을 찾을 수 없습니다. 메시지가 삭제되었을 수 있습니다.',
        flags: MessageFlags.Ephemeral
      });
    }

    const freshCdnUrl = freshAttachment.url;

    // 액티비티 팝업이 열리자마자 이 파일을 바로 띄울 수 있도록 서버 세션 업데이트
    setLatestSession({
      guildId: interaction.guildId || 'dm',
      channelId: interaction.channelId,
      fileName: freshAttachment.name,
      cdnUrl: freshCdnUrl,
      requestedBy: interaction.user.username,
      updatedAt: new Date().toISOString()
    });

    const publicBaseUrl = (
      process.env.PUBLIC_ACTIVITY_URL || `http://localhost:${process.env.PORT || 3000}`
    ).replace(/\/$/, '');
    const directPreviewUrl = `${publicBaseUrl}/activity_shell.html?cdn_url=${encodeURIComponent(freshCdnUrl)}&title=${encodeURIComponent(freshAttachment.name)}`;

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
      content: `✅ **${freshAttachment.name}**의 최신 렌더링 주소가 준비되었습니다! 아래 버튼을 눌러 확인하세요.`,
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