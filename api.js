const express = require('express');
require('dotenv').config();
const { activateLicense, verifyLicense, issueLicenseForOrder } = require('./license-service');
const { getLicenseByKey, getOrderById, markOrderPaid, markOrderPayment } = require('./db');
const mpAccessToken = process.env.MP_ACCESS_TOKEN || '';

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function asPlainText(res, payload) {
  res.type('text/plain').send(
    `valid=${payload.valid}\nmessage=${payload.message}\nserverId=${payload.serverId || ''}\n`
  );
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/activate', (req, res) => {
  const key = String(req.body.key || '').trim();
  const serverId = String(req.body.serverId || '').trim();
  if (!key || !serverId) {
    return asPlainText(res, { valid: false, message: 'Parametros invalidos.', serverId: '' });
  }
  const result = activateLicense({ key, serverId });
  return asPlainText(res, result);
});

app.get('/verify', (req, res) => {
  const key = String(req.query.key || '').trim();
  const serverId = String(req.query.serverId || '').trim();
  if (!key || !serverId) {
    return asPlainText(res, { valid: false, message: 'Parametros invalidos.', serverId: '' });
  }
  const result = verifyLicense({ key, serverId });
  return asPlainText(res, result);
});

app.get('/license/:key', (req, res) => {
  const license = getLicenseByKey(req.params.key.trim());
  if (!license) return res.status(404).json({ error: 'not_found' });
  res.json(license);
});

app.post('/webhook/pix', (req, res) => {
  const orderId = String(req.body.orderId || '').trim();
  const paid = String(req.body.paid || 'true').toLowerCase() !== 'false';
  if (!orderId) {
    return res.status(400).json({ ok: false, error: 'missing_orderId' });
  }
  const order = getOrderById(orderId);
  if (!order) {
    return res.status(404).json({ ok: false, error: 'order_not_found' });
  }
  if (!paid) {
    return res.json({ ok: true, status: 'ignored' });
  }
  const licenseKey = order.license_key || issueLicenseForOrder(order);
  markOrderPaid(orderId, licenseKey);
  return res.json({ ok: true, status: 'paid', orderId, licenseKey });
});

app.post('/webhook/mercadopago', (req, res) => {
  const body = req.body || {};
  const paymentId = String(body.data?.id || body.id || '').trim();
  if (!paymentId) {
    return res.status(400).json({ ok: false, error: 'missing_payment_id' });
  }
  if (!mpAccessToken) {
    return res.status(500).json({ ok: false, error: 'mp_access_token_missing' });
  }
  fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${mpAccessToken}`
    }
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Mercado Pago payment lookup failed: ${response.status}`);
      }
      return response.json();
    })
    .then((payment) => {
      const orderId = String(payment.external_reference || '').trim();
      if (!orderId) {
        return res.json({ ok: true, status: 'ignored', reason: 'missing_external_reference' });
      }
      const order = getOrderById(orderId);
      if (!order) {
        return res.status(404).json({ ok: false, error: 'order_not_found' });
      }
      const paidStatus = String(payment.status || '').toLowerCase();
      if (paidStatus !== 'approved') {
        markOrderPayment(orderId, { mpPaymentId: paymentId, status: paidStatus });
        return res.json({ ok: true, status: 'pending', paymentId, paidStatus });
      }
      const licenseKey = order.license_key || issueLicenseForOrder(order);
      markOrderPayment(orderId, {
        mpPaymentId: paymentId,
        mpPreferenceId: order.mp_preference_id,
        status: 'paid',
        paidAt: new Date().toISOString(),
        licenseKey
      });
      return res.json({ ok: true, status: 'paid', paymentId, orderId, licenseKey });
    })
    .catch((err) => {
      res.status(500).json({ ok: false, error: err.message });
    });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`[api] listening on ${port}`));
