const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
require('dotenv').config();
const crypto = require('crypto');
const { issueLicense, verifyLicense } = require('./license-service');
const { allLicenses, createOrder, getOrderById } = require('./db');
const products = require('./products');

const token = process.env.DISCORD_TOKEN;
const pixCopiaCola = process.env.PIX_COPIA_E_COLA || 'PIX_NAO_CONFIGURADO';
const storeChannelId = process.env.STORE_CHANNEL_ID || '';

if (!token) {
  console.error('DISCORD_TOKEN nao definido.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log(`[bot] logado como ${client.user.tag}`);
  publishStoreCard().catch((err) => console.error('[bot] falha ao publicar loja:', err));
});

async function sendLicenseDm(user, key, product) {
  const embed = new EmbedBuilder()
    .setTitle('Licenca entregue')
    .setDescription(`Produto: **${product}**\nKey: \`${key}\``)
    .setColor(0x2ecc71);
  await user.send({ embeds: [embed] });
}

function buildStoreCard() {
  const embed = new EmbedBuilder()
    .setTitle('Loja de Plugins Minecraft')
    .setDescription(
      'Clique no botao abaixo para escolher um plugin.\\n\\n' +
      'Depois de selecionar, eu mostro o valor e gero o pedido PIX.'
    )
    .setColor(0x8e44ad);

  const button = new ButtonBuilder()
    .setCustomId('open_store')
    .setLabel('Escolher plugin')
    .setStyle(ButtonStyle.Primary);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)]
  };
}

async function publishStoreCard() {
  if (!storeChannelId) {
    console.log('[bot] STORE_CHANNEL_ID nao definido, loja nao foi publicada.');
    return;
  }

  const channel = await client.channels.fetch(storeChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.log('[bot] canal da loja invalido ou nao eh texto.');
    return;
  }

  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (recent && recent.some((msg) => msg.author.id === client.user.id && msg.components?.length)) {
    console.log('[bot] card da loja ja existe no canal.');
    return;
  }

  await channel.send(buildStoreCard());
  console.log('[bot] card da loja publicado.');
}

function buildProductMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('select_product')
    .setPlaceholder('Escolha um plugin')
    .addOptions(
      products.map((product) => ({
        label: `${product.name} - ${product.price}`,
        description: product.description,
        value: product.id
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

async function sendPixDm(user, orderId, productName, price) {
  const embed = new EmbedBuilder()
    .setTitle('Pagamento PIX')
    .setDescription(
      `Produto: **${productName}**\n` +
      `Valor: **${price}**\n\n` +
      `Pedido: \`${orderId}\`\n\n` +
      `Copie e cole:\n\`\`\`\n${pixCopiaCola}\n\`\`\`\n\n` +
      `Quando o pagamento for confirmado, a key vai ser enviada automaticamente.`
    )
    .setColor(0x3498db);
  await user.send({ embeds: [embed] });
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const isStaff = message.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
  const args = message.content.trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  if (cmd === '!loja') {
    return message.channel.send(buildStoreCard());
  }

  if (cmd === '!pagar') {
    if (!isStaff) return message.reply('Apenas staff pode confirmar pagamentos.');
    const buyerId = args[0];
    const product = args.slice(1).join(' ') || 'plugin';
    if (!buyerId) return message.reply('Uso: !pagar <discordId> <produto>');

    const buyer = await client.users.fetch(buyerId).catch(() => null);
    if (!buyer) return message.reply('Nao achei esse usuario.');

    const key = issueLicense({ buyerDiscordId: buyerId, product });
    await sendLicenseDm(buyer, key, product);
    return message.reply(`Pagamento aprovado. Key gerada: \`${key}\``);
  }

  if (cmd === '!pix') {
    const product = args.join(' ') || 'plugin';
    const buyer = message.author;
    const orderId = crypto.randomUUID().slice(0, 8).toUpperCase();
    createOrder({
      orderId,
      buyerDiscordId: buyer.id,
      product,
      status: 'pending',
      pixCopiaCola,
      createdAt: new Date().toISOString(),
      paidAt: null,
      licenseKey: null
    });
    await sendPixDm(buyer, orderId, product, 'consulte o card');
    return message.reply(`Pedido criado. Eu mandei o PIX no seu DM. ID do pedido: \`${orderId}\``);
  }

  if (cmd === '!ativar') {
    const key = args[0];
    const serverId = args[1];
    if (!key || !serverId) return message.reply('Uso: !ativar <key> <serverId>');
    const result = verifyLicense({ key, serverId });
    return message.reply(`${result.valid ? 'OK' : 'ERRO'}: ${result.message}`);
  }

  if (cmd === '!licencas') {
    if (!isStaff) return message.reply('Apenas staff pode listar licencas.');
    const items = allLicenses().slice(0, 10).map((l) => `${l.license_key} | ${l.status} | ${l.product} | ${l.buyer_discord_id}`);
    return message.reply(items.length ? items.join('\n') : 'Sem licencas.');
  }

  if (cmd === '!pedido') {
    const orderId = args[0];
    if (!orderId) return message.reply('Uso: !pedido <id>');
    const order = getOrderById(orderId);
    if (!order) return message.reply('Pedido nao encontrado.');
    return message.reply(`Pedido ${order.order_id} | ${order.status} | produto=${order.product} | key=${order.license_key || 'sem key'}`);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId === 'open_store') {
    return interaction.reply({
      content: 'Selecione o plugin que deseja comprar:',
      components: [buildProductMenu()],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'select_product') {
    const productId = interaction.values[0];
    const product = products.find((item) => item.id === productId);
    if (!product) {
      return interaction.reply({ content: 'Produto nao encontrado.', ephemeral: true });
    }

    const orderId = crypto.randomUUID().slice(0, 8).toUpperCase();
    createOrder({
      orderId,
      buyerDiscordId: interaction.user.id,
      product: product.name,
      status: 'pending',
      pixCopiaCola,
      createdAt: new Date().toISOString(),
      paidAt: null,
      licenseKey: null
    });

    const embed = new EmbedBuilder()
      .setTitle(`Compra: ${product.name}`)
      .setDescription(
        `Valor: **${product.price}**\n\n` +
        `Pedido: \`${orderId}\`\n\n` +
        `Copie e cole:\n\`\`\`\n${pixCopiaCola}\n\`\`\`\n\n` +
        'Assim que o pagamento for confirmado, a key vai ser enviada.'
      )
      .setColor(0xf1c40f);

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.login(token);
