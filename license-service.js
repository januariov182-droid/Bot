const crypto = require('crypto');
const { createLicense, getLicenseByKey, markUsed } = require('./db');

function generateKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  while (true) {
    const chunks = [];
    for (let i = 0; i < 3; i++) {
      let chunk = '';
      for (let j = 0; j < 4; j++) {
        chunk += alphabet[crypto.randomInt(0, alphabet.length)];
      }
      chunks.push(chunk);
    }
    const key = chunks.join('-');
    if (!getLicenseByKey(key)) return key;
  }
}

function issueLicense({ buyerDiscordId, product }) {
  const licenseKey = generateKey();
  createLicense({
    licenseKey,
    status: 'unused',
    buyerDiscordId,
    product,
    createdAt: new Date().toISOString(),
    serverId: null
  });
  return licenseKey;
}

function ensureLicenseForPurchase({ buyerDiscordId, product, existingLicenseKey }) {
  if (existingLicenseKey) {
    return existingLicenseKey;
  }
  return issueLicense({ buyerDiscordId, product });
}

function issueLicenseForOrder(order) {
  return issueLicense({
    buyerDiscordId: order.buyer_discord_id,
    product: order.product
  });
}

function activateLicense({ key, serverId }) {
  const license = getLicenseByKey(key);
  if (!license) {
    return { valid: false, message: 'Key invalida.' };
  }
  if (license.status === 'used') {
    if (license.server_id === serverId) {
      return { valid: true, message: 'Key ja vinculada a este servidor.', serverId: license.server_id };
    }
    return { valid: false, message: 'Key ja foi usada em outro servidor.' };
  }
  markUsed(key, serverId);
  return { valid: true, message: 'Licenca ativada com sucesso.', serverId };
}

function verifyLicense({ key, serverId }) {
  const license = getLicenseByKey(key);
  if (!license) {
    return { valid: false, message: 'Key invalida.' };
  }
  if (license.status === 'unused') {
    return { valid: false, message: 'Key ainda nao foi ativada.' };
  }
  if (license.server_id !== serverId) {
    return { valid: false, message: 'Licenca vinculada a outro servidor.' };
  }
  return { valid: true, message: 'Licenca confirmada.', serverId: license.server_id };
}

module.exports = {
  issueLicense,
  ensureLicenseForPurchase,
  issueLicenseForOrder,
  activateLicense,
  verifyLicense
};
