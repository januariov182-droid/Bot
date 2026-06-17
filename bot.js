const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
require('dotenv').config();
const crypto = require('crypto');
const { issueLicense, verifyLicense } = require('./license-service');
const { allLicenses, createOrder, getOrderById, getOrdersByStatus, markOrderPayment } = require('./db');
const products = require('./products');

const token = process.env.DISCORD_TOKEN;
const storeChannelId = process.env.STORE_CHANNEL_ID || '';
const mpAccessToken = process.env.MP_ACCESS_TOKEN || '';
const mpWebhookUrl = process.env.MP_WEBHOOK_URL || '';

if (!token) {
  console.error('DISCORD_TOKEN nao definido.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
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
    .setTitle('Pagamento Mercado Pago')
    .setDescription(
      `Produto: **${productName}**\n` +
      `Valor: **${price}**\n\n` +
      `Pedido: \`${orderId}\`\n\n` +
      `Assim que o pagamento for aprovado, a key vai ser enviada automaticamente.`
    )
    .setColor(0x3498db);
  await user.send({ embeds: [embed] });
}

async function createMercadoPagoPreference(orderId, product) {
  if (!mpAccessToken) {
    throw new Error('MP_ACCESS_TOKEN nao definido');
  }
  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mpAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      items: [{
        title: product.mpTitle || product.name,
        description: product.mpDescription || product.description,
        quantity: 1,
        unit_price: Number(String(product.price).replace('R$', '').replace(',', '.').trim()),
        currency_id: 'BRL'
      }],
      external_reference: orderId,
      back_urls: {
        success: 'https://example.com/success',
        failure: 'https://example.com/failure',
        pending: 'https://example.com/pending'
      },
      auto_return: 'approved',
      notification_url: mpWebhookUrl || undefined
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Pago erro: ${response.status} ${text}`);
  }

  return response.json();
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId === 'open_store') {
    return interaction.reply({
      content: 'Selecione o plugin que deseja comprar:',
      components: [buildProductMenu()],
      ephemeral: true
    });
  }

  if (!interaction.isStringSelectMenu() || interaction.customId !== 'select_product') {
    return;
  }

  const productId = interaction.values[0];
  const product = products.find((item) => item.id === productId);
  if (!product) {
    return interaction.reply({ content: 'Produto nao encontrado.', ephemeral: true });
  }

  const orderId = crypto.randomUUID().slice(0, 8).toUpperCase();
  let preference;
  try {
    preference = await createMercadoPagoPreference(orderId, product);
  } catch (err) {
    return interaction.reply({ content: `Falha ao criar cobranca: ${err.message}`, ephemeral: true });
  }
  createOrder({
    orderId,
    buyerDiscordId: interaction.user.id,
    product: product.name,
    price: product.price,
    status: 'pending',
    mpPreferenceId: preference.id,
    mpInitPoint: preference.init_point,
    createdAt: new Date().toISOString(),
    paidAt: null,
    licenseKey: null
  });

  const embed = new EmbedBuilder()
    .setTitle(`Compra: ${product.name}`)
    .setDescription(
      `Valor: **${product.price}**\n\n` +
      `Pedido: \`${orderId}\`\n\n` +
      `Clique para pagar: [Abrir pagamento](${preference.init_point})\n\n` +
      'Assim que o pagamento for aprovado, a key vai ser enviada.'
    )
    .setColor(0xf1c40f);

  return interaction.reply({ embeds: [embed], ephemeral: true });
});

async function deliverPaidOrders() {
  const paidOrders = getOrdersByStatus('paid').filter((o) => !o.notification_sent && o.license_key);
  for (const order of paidOrders) {
    const buyer = await client.users.fetch(order.buyer_discord_id).catch(() => null);
    if (!buyer) {
      markOrderPayment(order.order_id, { notificationSent: false });
      continue;
    }
    await sendLicenseDm(buyer, order.license_key, order.product);
    markOrderPayment(order.order_id, { notificationSent: true });
  }
}

client.on('ready', () => {
  setInterval(() => {
    deliverPaidOrders().catch((err) => console.error('[bot] erro ao entregar pedidos:', err));
  }, 15000);
});

client.login(token);
