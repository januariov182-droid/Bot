const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbFile = path.join(dataDir, 'licenses.json');

function load() {
  if (!fs.existsSync(dbFile)) {
    return { licenses: [], orders: [] };
  }
  try {
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    db.licenses = Array.isArray(db.licenses) ? db.licenses : [];
    db.orders = Array.isArray(db.orders) ? db.orders : [];
    return db;
  } catch (_e) {
    return { licenses: [], orders: [] };
  }
}

function save(db) {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');
}

function createLicense(record) {
  const db = load();
  db.licenses.push({
    license_key: record.licenseKey,
    status: record.status,
    buyer_discord_id: record.buyerDiscordId,
    product: record.product,
    created_at: record.createdAt,
    server_id: record.serverId || null
  });
  save(db);
}

function createOrder(record) {
  const db = load();
  db.orders.push({
    order_id: record.orderId,
    buyer_discord_id: record.buyerDiscordId,
    product: record.product,
    status: record.status,
    pix_copia_cola: record.pixCopiaCola,
    created_at: record.createdAt,
    paid_at: record.paidAt || null,
    license_key: record.licenseKey || null
  });
  save(db);
}

function getOrderById(orderId) {
  const db = load();
  return db.orders.find((o) => o.order_id === orderId) || null;
}

function markOrderPaid(orderId, licenseKey) {
  const db = load();
  const item = db.orders.find((o) => o.order_id === orderId);
  if (!item) return null;
  item.status = 'paid';
  item.paid_at = new Date().toISOString();
  item.license_key = licenseKey || item.license_key || null;
  save(db);
  return item;
}

function getLicenseByKey(licenseKey) {
  const db = load();
  return db.licenses.find((l) => l.license_key === licenseKey) || null;
}

function markUsed(licenseKey, serverId) {
  const db = load();
  const item = db.licenses.find((l) => l.license_key === licenseKey);
  if (!item) return;
  item.status = 'used';
  item.server_id = serverId;
  save(db);
}

function allLicenses() {
  const db = load();
  return db.licenses.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

module.exports = {
  createLicense,
  getLicenseByKey,
  markUsed,
  allLicenses,
  createOrder,
  getOrderById,
  markOrderPaid
};
