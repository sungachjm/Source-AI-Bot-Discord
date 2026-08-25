// index.js
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const https = require('https');
const config = require('./config.json');
const moduleconfig = require('./module/moduleconfig.json');
const { buildEmbed } = require('./untils/embed.js');
const { buildButtons, generateButtonLabels, buttons: buttonConfig } = require('./untils/button.js');
const { getUser, appendHistory, saveSummary, loadChannels, saveChannel, removeChannel, loadFeelingGuilds, saveFeelingGuild, loadVoiceGuilds, saveVoiceGuild } = require('./untils/uid.js');
const { handleImageGenCommand: _imageGen } = require('./untils/image.js'); // image.js hiện chỉ có handleImageGenCommand
const { buildSystemPrompt } = require('./untils/modereply.js');
const registerInteractionHandler = require('./untils/command.js');
const { sendVoiceReply } = require('./untils/voice.js');
const { handleImageGenCommand } = require('./untils/image-gen.js');
require('dotenv').config();
require('./keep_alive');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const activeChannels = loadChannels();

async function registerCommands() {
  const setchannel = new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Auto reply channel')
    .setDefaultMemberPermissions(0)
    .addStringOption(opt =>
      opt.setName('id')
        .setDescription('Channel ID (bỏ trống = dùng channel hiện tại)')
        .setRequired(false)
    );

  const stopsetchannel = new SlashCommandBuilder()
    .setName('stopsetchannel')
    .setDescription('Stop auto reply channel')
    .setDefaultMemberPermissions(0)
    .addStringOption(opt =>
      opt.setName('id')
        .setDescription('Channel ID (bỏ trống = dùng channel hiện tại)')
        .setRequired(false)
    );

  const feeling = new SlashCommandBuilder()
    .setName('feeling')
    .setDescription('Bật chế độ bày tỏ cảm xúc cho bot');

  const nofeeling = new SlashCommandBuilder()
    .setName('nofeeling')
    .setDescription('Tắt chế độ bày tỏ cảm xúc cho bot');

  const voice = new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Bật chế độ gửi voice khi tin nhắn dài');

  const novoice = new SlashCommandBuilder()
    .setName('novoice')
    .setDescription('Tắt chế độ gửi voice');

  const image = new SlashCommandBuilder()
    .setName('image')
    .setDescription('Tạo ảnh AI từ mô tả')
    .addStringOption(opt =>
      opt.setName('prompt')
        .setDescription('Mô tả ảnh muốn tạo')
        .setRequired(true)
    );

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(
    Routes.applicationCommands(config.APP_ID),
    { body: [setchannel.toJSON(), stopsetchannel.toJSON(), feeling.toJSON(), nofeeling.toJSON(), voice.toJSON(), novoice.toJSON(), image.toJSON()] }
  );
  console.log('✅ Slash commands registered: /setchannel /stopsetchannel /feeling /nofeeling /voice /novoice /image');
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'GET',
      headers: { 'User-Agent': 'Node.js' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data.trim()));
    }).on('error', reject).end();
  });
}

function groqRequest(messages, max_tokens = 512) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens,
    });
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function summarizeAndSave(userName, history) {
  if (!history || history.length === 0) return;
  const historyText = history
    .map(h => `${h.role === 'user' ? userName : 'THMEO-X'}: ${h.content}`)
    .join('\n');
  const { status, body } = await groqRequest([
    {
      role: 'system',
      content: `Mày là AI tóm tắt hội thoại. Tóm tắt ngắn gọn (tối đa 200 từ) những điểm quan trọng về người dùng từ đoạn chat sau: tính cách, cách nói chuyện, sở thích, chủ đề hay hỏi, thông tin cá nhân nếu có. Chỉ trả về đoạn tóm tắt, không giải thích.`,
    },
    { role: 'user', content: historyText },
  ], 500);
  if (status !== 200) return;
  const summary = body.choices?.[0]?.message?.content?.trim();
  if (summary) saveSummary(userName, summary);
}

const prompts = {};
const sessionModule = {};
const sessionLabels = {};
const messageCount = {};
const feelingGuilds = loadFeelingGuilds();
const voiceGuilds = loadVoiceGuilds();

async function detectModule(userText) {
  const moduleNames = Object.keys(prompts).join(', ');
  const { status, body } = await groqRequest([
    {
      role: 'system',
      content: `Mày là classifier. Dựa vào tin nhắn user, chọn đúng một module trong danh sách: ${moduleNames}. Chỉ trả về đúng tên module, không giải thích gì thêm.`,
    },
    { role: 'user', content: userText },
  ], 10);
  if (status !== 200) return Object.keys(prompts)[0];
  const result = body.choices?.[0]?.message?.content?.trim().toLowerCase();
  return prompts[result] ? result : Object.keys(prompts)[0];
}

async function detectColor(reply, selectedModule) {
  if (selectedModule === 'code') return 'code';
  const { status, body } = await groqRequest([
    {
      role: 'system',
      content: `Mày là classifier màu. Chọn đúng một trong: affirmation, question, error, default.
- affirmation: câu khẳng định, đồng ý, xác nhận
- question: câu hỏi, nghi vấn, không chắc
- error: lỗi, cảnh báo, từ chối
- default: mọi trường hợp còn lại
Chỉ trả về đúng một từ.`,
    },
    { role: 'user', content: reply },
  ], 10);
  if (status !== 200) return 'default';
  const result = body.choices?.[0]?.message?.content?.trim().toLowerCase();
  return ['affirmation', 'question', 'error', 'default'].includes(result) ? result : 'default';
}

async function generateFeeling(reply) {
  const { status, body } = await groqRequest([
    {
      role: 'system',
      content: `Mày là THMEO-X, một AI có cảm xúc. Dựa vào câu trả lời sau, hãy viết 1-3 dòng ngắn mô tả hành động/cảm xúc của THMEO-X theo kiểu roleplay (in nghiêng, dùng dấu *). Ví dụ: *mỉm cười nhẹ, gõ phím chậm rãi* 😊. Phải ngắn gọn, tự nhiên, có thể kèm emoji. Chỉ trả về phần hành động, không giải thích.`,
    },
    { role: 'user', content: reply },
  ], 80);
  if (status !== 200) return null;
  return body.choices?.[0]?.message?.content?.trim() ?? null;
}

async function sendReply(target, reply, selectedModule, userName, isInteraction = false, guildId = null) {
  const isCodeModule = selectedModule === 'code';
  const showFeeling = !isCodeModule && guildId && feelingGuilds.has(guildId);
  let feelingLine = '';
  if (showFeeling) {
    const f = await generateFeeling(reply);
    if (f) feelingLine = `\n${f}`;
  }

  let payload;
  if (isCodeModule) {
    const labels = await generateButtonLabels(groqRequest, reply, selectedModule);
    const row = buildButtons(selectedModule, labels);
    if (labels) sessionLabels[userName] = { labels, selectedModule };
    const colorKey = await detectColor(reply, selectedModule);
    const embed = buildEmbed(reply, colorKey, userName);
    payload = { embeds: [embed], components: row ? [row] : [] };
  } else {
    payload = { content: reply + feelingLine };
  }

  if (reply.length > 4096) {
    for (let i = 0; i < reply.length; i += 2000)
      isInteraction
        ? await target.followUp(reply.slice(i, i + 2000))
        : await target.reply(reply.slice(i, i + 2000));
  } else {
    isInteraction ? await target.editReply(payload) : await target.reply(payload);
  }
}

async function main() {
  console.log('Registering slash commands...');
  await registerCommands().catch(err => console.error('❌ Register thất bại:', err.message));

  console.log('Loading modules...');
  for (const [name, mod] of Object.entries(moduleconfig.modules)) {
    prompts[name] = await httpsGet(mod.systemPromptUrl);
    console.log(`✅ Module loaded: ${name}`);
  }

  client.once('clientReady', () => {
    client.user.setUsername('THMEO-X').catch(() => {});
    console.log(`Bot online: ${client.user.tag}`);
  });

  client.on('messageCreate', async (message) => {
    if (!activeChannels.has(message.channel.id)) return;
    if (message.author.bot) return;
    const userText = message.content.trim();
    if (!userText) return;
    message.channel.sendTyping();

    const userName = message.member?.displayName || message.author.username;
    try {
      message.channel.sendTyping();
      const selectedModule = await detectModule(userText);
      sessionModule[userName] = selectedModule;

      const userProfile = getUser(userName);

      // truyền message.guild để inject emoji của server
      const systemPrompt = buildSystemPrompt(
        userName,
        userProfile.summary,
        prompts[selectedModule],
        message.guild
      );

      const recentHistory = userProfile.history.slice(-20).map(h => ({ role: h.role, content: h.content }));

      const { status, body } = await groqRequest([
        { role: 'system', content: systemPrompt },
        ...recentHistory,
        { role: 'user', content: userText },
      ]);

      if (status !== 200) return message.reply('❌ Groq lỗi.');
      const reply = body.choices?.[0]?.message?.content?.trim();
      if (!reply) return message.reply('❌ Không có phản hồi.');

      appendHistory(userName, 'user', userText);
      appendHistory(userName, 'assistant', reply);

      messageCount[userName] = (messageCount[userName] ?? 0) + 1;
      if (messageCount[userName] % 20 === 0) {
        const freshProfile = getUser(userName);
        summarizeAndSave(userName, freshProfile.history).catch(console.error);
      }

      // Nếu voice bật và module không phải code → gửi text + voice cùng 1 tin
      // Nếu không → gửi text bình thường
      if (selectedModule !== 'code') {
        const voiceSent = await sendVoiceReply(message, reply, message.guild?.id, userName, false, voiceGuilds);
        if (!voiceSent) await sendReply(message, reply, selectedModule, userName, false, message.guild?.id);
      } else {
        await sendReply(message, reply, selectedModule, userName, false, message.guild?.id);
      }
    } catch (err) {
      console.error(err);
      message.reply('❌ Lỗi kết nối.');
    }
  });

  registerInteractionHandler(
    client, activeChannels, feelingGuilds, saveFeelingGuild, voiceGuilds, saveVoiceGuild,
    sessionModule, sessionLabels, prompts, groqRequest, sendReply, sendVoiceReply, handleImageGenCommand
  );

  client.login(process.env.TOKEN);
}

main();
