const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
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

// 지원 포맷 정의 (.html, .pdf, .md, .pptx, .hwp, .hwpx)
const SUPPORTED_FORMATS = {
  html: ['.html', '.htm'],
  pdf:  ['.pdf'],
  md:   ['.md', '.markdown'],
  pptx: ['.pptx'],
  hwp:  ['.hwp', '.hwpx']
};

function getFileFormat(filename) {
  if (!filename) return null;
  const lower = filename.toLowerCase().split('?')[0];
  for (const [format, exts] of Object.entries(SUPPORTED_FORMATS)) {
    if (exts.some((ext) => lower.endsWith(ext))) return format;
  }
  return null;
}

const FORMAT_META = {
  html: { icon: '📄', label: 'HTML 웹페이지', color: 0x38bdf8 },
  pdf:  { icon: '📑', label: 'PDF 문서', color: 0xf43f5e },
  md:   { icon: '📝', label: 'Markdown 문서', color: 0x10b981 },
  pptx: { icon: '📊', label: 'PowerPoint 슬라이드', color: 0xf97316 },
  hwp:  { icon: '📝', label: '한글(HWP) 문서', color: 0x2563eb }
};

// 첨부파일 메모리 캐시 (슬래시 커맨드 및 우클릭 실행 시 즉각적인 CDN 링크 조회 보장)
const attachmentCache = new Map();

// 1. 신규 통합 슬래시 명령어 (/view) 빌더: HTML, PDF, MD, PPTX, HWP 전 포맷 자동 감지!
const viewSlashCommand = new SlashCommandBuilder()
  .setName('view')
  .setDescription('채팅방에 업로드된 문서(HTML, PDF, MD, PPTX, HWP)를 찾아 즉시 엽니다.')
  .setIntegrationTypes([0, 1]) // 0: Guild Install, 1: User Install
  .setContexts([0, 1, 2])     // 서버, 봇 DM, 개인/그룹 DM
  .addStringOption((option) =>
    option
      .setName('message')
      .setDescription('(선택) 특정 메시지 링크 또는 ID를 지정하여 실행합니다.')
      .setRequired(false)
  );

// 2. 통합 메시지 우클릭 컨텍스트 메뉴 (앱 -> 파일 바로보기)
const viewContextMenuCommand = new ContextMenuCommandBuilder()
  .setName('파일 바로보기')
  .setType(ApplicationCommandType.Message)
  .setIntegrationTypes([0, 1])
  .setContexts([0, 1, 2]);

// 실행 버튼 및 임베드 생성 헬퍼 함수 (다중 첨부파일 지원)
function buildLaunchPayload(attachment, messageId = 'cmd', uploaderName = '사용자', availableFiles = []) {
  attachmentCache.set(attachment.id, {
    name: attachment.name,
    url: attachment.url,
    size: attachment.size
  });

  if (availableFiles && availableFiles.length > 0) {
    availableFiles.forEach((f) => {
      attachmentCache.set(f.id, {
        name: f.name,
        url: f.url,
        size: f.size
      });
    });
  }

  const format = getFileFormat(attachment.name) || 'html';
  const meta = FORMAT_META[format] || { icon: '📄', label: '문서', color: 0x5865f2 };

  let description = `아래 버튼을 누르면 **디스코드 내부 팝업창(Activity)** 또는 **외부 브라우저**에서 **${meta.label}**가 즉시 실행됩니다.`;
  if (availableFiles && availableFiles.length > 1) {
    const fileSummary = availableFiles
      .map((f, i) => `${f.id === attachment.id ? '▶ **' : '• '}${i + 1}. ${f.name}${f.id === attachment.id ? '** (현재 선택됨)' : ''}`)
      .slice(0, 6)
      .join('\n');
    description = `📎 **대화에 첨부된 문서 (총 ${availableFiles.length}개 감지됨)**\n${fileSummary}${availableFiles.length > 6 ? '\n• ...외 더 있음' : ''}\n\n` + description;
  }

  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(`${meta.icon} ${attachment.name} 열기 준비 완료`)
    .setDescription(description)
    .addFields(
      { name: '파일 형식', value: `${meta.icon} ${meta.label}`, inline: true },
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

  const components = [row];

  if (availableFiles && availableFiles.length > 1) {
    const selectOptions = availableFiles.slice(0, 25).map((f) => {
      const fFormat = getFileFormat(f.name) || 'html';
      const fMeta = FORMAT_META[fFormat] || { icon: '📄', label: '문서' };
      return {
        label: `${fMeta.icon} ${f.name}`.slice(0, 50),
        description: `${fMeta.label} • ${(f.size / 1024).toFixed(1)} KB`,
        value: `select_file:${messageId}:${f.id}`,
        default: f.id === attachment.id
      };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_recent_file')
      .setPlaceholder(`📂 파일 선택 (${availableFiles.length}개 문서 중 전환)...`)
      .addOptions(selectOptions);

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  return { embeds: [embed], components };
}

client.once('clientReady', async () => {
  console.log(`✅ 디스코드 봇 로그인 완료: ${client.user.tag}`);

  // 봇 상태(Rich Presence) 설정: 알로항 봇처럼 프로필 상단에 표기됨
  try {
    client.user.setPresence({
      activities: [{ name: '/view 로 문서 바로보기', type: 0 }], // Playing 상태
      status: 'online'
    });
  } catch (presenceErr) {
    console.warn('⚠️ 상태 메시지 설정 알림:', presenceErr.message);
  }

  try {
    const existing = await client.application.commands.fetch();
    const hasView = existing.some((c) => c.name === 'view');
    const hasMenu = existing.some((c) => c.name === '파일 바로보기');

    if (!hasView) {
      await client.application.commands.create(viewSlashCommand);
    }
    if (!hasMenu) {
      await client.application.commands.create(viewContextMenuCommand);
    }
    console.log('✅ 디스코드 통합 명령어 준비 완료! (/view 및 메시지 우클릭 [파일 바로보기] 활성화됨)');
  } catch (cmdErr) {
    console.warn('⚠️ 명령어 확인 중 안내:', cmdErr.message);
  }

  console.log('📂 HTML, PDF, MD, PPTX, HWP 파일 자동 감지 및 /view 명령어가 모두 준비되었습니다.');
});

// [1단계] 사용자가 채팅창에 지원 파일(.html, .pdf, .md, .pptx, .hwp, .hwpx)을 올리면 감지하여 실행 버튼 생성
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;

    // 지원 확장자 첨부파일 모두 찾기
    const validAttachments = message.attachments.filter(
      (att) => att.name && getFileFormat(att.name)
    );
    if (!validAttachments || validAttachments.size === 0) return;

    const filesList = Array.from(validAttachments.values()).map((att) => ({
      id: att.id,
      name: att.name,
      url: att.url,
      size: att.size,
      format: getFileFormat(att.name)
    }));

    const firstAtt = validAttachments.first();
    const payload = buildLaunchPayload(firstAtt, message.id, message.author.username, filesList);
    await message.reply(payload);
  } catch (error) {
    console.error('❌ 메시지 처리 중 오류:', error);
  }
});

// [2단계] 인터랙션 처리 (슬래시 커맨드, 메시지 우클릭 앱, 실행 버튼)
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === '도움말' || interaction.commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('📖 Doc Viewer 사용 안내서')
        .setDescription('채팅방에 업로드된 문서를 다운로드 없이 디스코드 내부 팝업(Activity)으로 즉시 열람하는 뷰어입니다.')
        .setColor(0x5865f2)
        .addFields(
          {
            name: '1️⃣ 가장 빠른 실행 방법 (추천 ⭐)',
            value: '채팅방의 문서 메시지를 **마우스 우클릭** → **[앱]** → **`파일 바로보기`** 클릭!'
          },
          {
            name: '2️⃣ 최근 문서 자동 탐색 (/view)',
            value: '채팅창에 **/view** 를 치면 현재 채널의 최근 50개 메시지 중 문서를 자동으로 찾아 실행 카드를 띄워줍니다.'
          },
          {
            name: '3️⃣ 지원 파일 포맷',
            value: '• `📄 HTML`: Zero-Eval 네이티브 렌더러 (웹앱, 대시보드)\n• `📑 PDF`: Mozilla PDF.js v3 (목차 트리, 텍스트 마이닝, 페이지 점프)\n• `📝 Markdown`: Marked + Highlight.js + Mermaid 다이어그램\n• `📊 PowerPoint`: OOXML 네이티브 엔진 (.pptx 1:1 벡터 렌더링, 목차 카드)\n• `📝 한글(HWP)`: RHWP 고성능 벡터 렌더러 (.hwp, .hwpx A4 용지 뷰어)'
          },
          {
            name: '4️⃣ 뷰어 내부 조작 팁',
            value: '• **📑 목차 버튼**: 좌측 도킹형 사이드바로 전체 목차 및 슬라이드 탐색\n• **[ 1 ] / 14 입력창**: 원하는 페이지 번호 입력 후 Enter로 즉시 점프\n• **🔄 파일 전환 바**: 뷰어를 닫지 않고 채널의 다른 문서로 즉시 전환'
          }
        )
        .setFooter({ text: 'Doc Viewer • 100% Serverless' });

      return await interaction.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral });
    }

    // 1. 슬래시 명령어 (/view 및 기존 /html 호환) 처리: 채팅방 최근 문서 자동 탐색 또는 특정 메시지 지정
    if (interaction.commandName === 'view' || interaction.commandName === 'html') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const messageInput = interaction.options.getString('message');
      let targetMessage = null;
      let foundMessages = null;
      let allValidFiles = [];

      // 1) 특정 메시지 링크 또는 ID가 입력된 경우
      if (messageInput) {
        const match = messageInput.match(/(\d{17,20})$/);
        const msgId = match ? match[1] : messageInput.trim();
        try {
          targetMessage = await interaction.channel.messages.fetch(msgId);
        } catch (fetchErr) {
          return await interaction.editReply({
            content: `⚠️ 메시지를 찾을 수 없습니다: \`${messageInput}\`\n올바른 메시지 링크나 ID인지 확인해 주세요.`
          });
        }
      }

      // 2) 지정이 없으면 현재 채널 최근 50개 메시지를 검색하여 지원 문서 파일 탐색
      if (!targetMessage) {
        try {
          const messages = await interaction.channel.messages.fetch({ limit: 50 });
          foundMessages = messages.filter((m) =>
            m.attachments.some((att) => att.name && getFileFormat(att.name))
          );
        } catch (err) {
          console.error('메시지 히스토리 조회 실패:', err);
        }

        if (!foundMessages || foundMessages.size === 0) {
          return await interaction.editReply({
            content: [
              '⚠️ **현재 채널의 최근 50개 메시지 중에서 지원되는 문서 파일을 찾지 못했습니다.**',
              '• 지원 포맷: `.html`, `.pdf`, `.md`, `.pptx`, `.hwp`, `.hwpx`',
              '• 채팅방에 문서를 먼저 업로드한 뒤 `/view`를 입력해 보세요.',
              '• 또는 파일이 있는 메시지를 **[우클릭 → 앱 → 파일 바로보기]**로 즉시 열 수 있습니다.'
            ].join('\n')
          });
        }

        targetMessage = foundMessages.first();

        foundMessages.forEach((msg) => {
          msg.attachments.forEach((att) => {
            if (att.name && getFileFormat(att.name)) {
              allValidFiles.push({
                id: att.id,
                name: att.name,
                url: att.url,
                size: att.size,
                messageId: msg.id,
                author: msg.author.username
              });
            }
          });
        });
      } else {
        targetMessage.attachments.forEach((att) => {
          if (att.name && getFileFormat(att.name)) {
            allValidFiles.push({
              id: att.id,
              name: att.name,
              url: att.url,
              size: att.size,
              messageId: targetMessage.id,
              author: targetMessage.author.username
            });
          }
        });
      }

      const currentFiles = Array.from(targetMessage.attachments.values()).filter(
        (att) => att.name && getFileFormat(att.name)
      );
      if (!currentFiles.length) {
        return await interaction.editReply({
          content: '⚠️ 선택된 메시지에 지원되는 문서 첨부파일(.html, .pdf, .md, .pptx, .hwp, .hwpx)이 없습니다.'
        });
      }

      const firstAttachment = currentFiles[0];
      const filesToUse = allValidFiles.length > 0 ? allValidFiles : currentFiles;
      const payload = buildLaunchPayload(firstAttachment, targetMessage.id, targetMessage.author.username, filesToUse);

      return await interaction.editReply(payload);
    }
  }

  // 1-2. 최근 문서 드롭다운 메뉴 선택 시 실시간 버튼/정보 전환
  if (
    interaction.isStringSelectMenu() &&
    (interaction.customId === 'select_recent_file' || interaction.customId === 'select_recent_html')
  ) {
    const [, msgId, attId] = interaction.values[0].split(':');
    try {
      let freshCdnUrl = null;
      let freshFileName = null;
      let freshSize = 0;
      let authorName = '사용자';

      if (msgId && msgId !== 'cmd' && interaction.channel) {
        try {
          const msg = await interaction.channel.messages.fetch(msgId);
          authorName = msg.author.username;
          const att = msg.attachments.get(attId);
          if (att) {
            freshCdnUrl = att.url;
            freshFileName = att.name;
            freshSize = att.size;
          }
        } catch (fetchErr) {}
      }

      if (!freshCdnUrl) {
        const cached = attachmentCache.get(attId);
        if (cached) {
          freshCdnUrl = cached.url;
          freshFileName = cached.name;
          freshSize = cached.size || 0;
        }
      }

      if (freshCdnUrl) {
        let preservedFiles = [];
        if (interaction.message.components[1]) {
          const originalMenu = interaction.message.components[1].components[0];
          preservedFiles = originalMenu.options.map((opt) => {
            const [, mId, aId] = opt.value.split(':');
            return {
              id: aId,
              name: opt.label.replace(/^.*?\s/, ''),
              size: 0,
              url: (attachmentCache.get(aId) && attachmentCache.get(aId).url) || freshCdnUrl
            };
          });
        }

        const targetAttachment = {
          id: attId,
          name: freshFileName,
          url: freshCdnUrl,
          size: freshSize
        };

        const updatedPayload = buildLaunchPayload(
          targetAttachment,
          msgId,
          authorName,
          preservedFiles.length > 0 ? preservedFiles : [targetAttachment]
        );

        return await interaction.update(updatedPayload);
      }
    } catch (menuErr) {
      console.error('드롭다운 선택 처리 실패:', menuErr);
    }
  }

  // 2. 메시지 우클릭 컨텍스트 메뉴 (앱 -> 파일 바로보기) 처리 (나한테만 보이는 Ephemeral 메시지)
  if (interaction.isMessageContextMenuCommand()) {
    if (interaction.commandName === '파일 바로보기' || interaction.commandName === 'HTML 파일 실행') {
      const targetMsg = interaction.targetMessage;
      const validFiles = targetMsg.attachments.filter(
        (att) => att.name && getFileFormat(att.name)
      );
      if (!validFiles || validFiles.size === 0) {
        return await interaction.reply({
          content: '⚠️ 선택한 메시지에 첨부된 지원 문서 파일(.html, .pdf, .md, .pptx, .hwp, .hwpx)이 없습니다.',
          flags: MessageFlags.Ephemeral
        });
      }

      const filesList = Array.from(validFiles.values()).map((att) => ({
        id: att.id,
        name: att.name,
        url: att.url,
        size: att.size,
        format: getFileFormat(att.name)
      }));

      const firstFile = validFiles.first();
      const payload = buildLaunchPayload(firstFile, targetMsg.id, interaction.user.username, filesList);
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

    // 2) 슬래시 커맨드(/view) 또는 캐시된 첨부파일 정보 조회
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

    // 3) 대화에 함께 첨부된 모든 파일 목록(messageFiles) 추출 (Activity 내 파일 전환 지원)
    let messageFiles = [];
    if (messageId && messageId !== 'cmd' && interaction.channel) {
      try {
        const targetMessage = await interaction.channel.messages.fetch(messageId);
        if (targetMessage && targetMessage.attachments) {
          targetMessage.attachments.forEach((att) => {
            const fmt = getFileFormat(att.name);
            if (fmt) {
              messageFiles.push({
                id: att.id,
                name: att.name,
                url: att.url,
                size: att.size,
                format: fmt
              });
            }
          });
        }
      } catch (fetchErr) {}
    }

    if (messageFiles.length === 0 && interaction.message && interaction.message.components[1]) {
      const selectMenu = interaction.message.components[1].components[0];
      if (selectMenu && selectMenu.options) {
        messageFiles = selectMenu.options.map((opt) => {
          const [, mId, aId] = opt.value.split(':');
          const cached = attachmentCache.get(aId);
          return {
            id: aId,
            name: opt.label.replace(/^.*?\s/, ''),
            url: (cached && cached.url) || freshCdnUrl,
            size: (cached && cached.size) || 0,
            format: getFileFormat(opt.label)
          };
        });
      }
    }

    // 액티비티 팝업이 열리자마자 이 파일을 바로 띄울 수 있도록 서버 세션 업데이트
    setLatestSession({
      guildId: interaction.guildId || 'dm',
      channelId: interaction.channelId,
      fileName: freshFileName,
      cdnUrl: freshCdnUrl,
      requestedBy: interaction.user.username,
      messageFiles: messageFiles,
      updatedAt: Date.now()
    });

    const publicBaseUrl = (
      process.env.PUBLIC_ACTIVITY_URL || `http://localhost:${process.env.PORT || 3000}`
    ).replace(/\/$/, '');
    const directPreviewUrl = `${publicBaseUrl}/activity_shell.html?cdn_url=${encodeURIComponent(freshCdnUrl)}&title=${encodeURIComponent(freshFileName || 'Document Viewer')}&channel_id=${encodeURIComponent(interaction.channelId)}&_t=${Date.now()}`;

    // 1) [⚡ 디스코드 내부 팝업으로 즉시 실행] 버튼을 누른 경우 -> 액티비티 팝업 실행
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
      content: `✅ **${freshFileName}**의 최신 뷰어 주소가 준비되었습니다! 아래 버튼을 눌러 확인하세요.`,
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
