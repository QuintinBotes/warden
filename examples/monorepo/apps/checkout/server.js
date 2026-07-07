import { createServer } from 'node:http';

/**
 * Warden example: the "checkout" module of a tiny two-app monorepo.
 *
 * GET  /health   -> { status: "ok", module: "checkout" }
 * POST /checkout -> confirms or declines a card
 */

const PORT = process.env.CHECKOUT_PORT || 3001;
const VALID_CARD_PREFIX = '4242';

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function createCheckoutServer() {
  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { status: 'ok', module: 'checkout' });
    }

    if (req.method === 'POST' && req.url === '/checkout') {
      const body = await readJsonBody(req);
      const digitsOnly = typeof body.cardNumber === 'string' ? body.cardNumber.replace(/[\s-]/g, '') : '';
      const isValid = /^\d{16}$/.test(digitsOnly) && digitsOnly.startsWith(VALID_CARD_PREFIX);

      if (!isValid) {
        return sendJson(res, 400, { status: 'declined' });
      }

      return sendJson(res, 200, { status: 'confirmed', orderId: `ord-${Date.now()}` });
    }

    sendJson(res, 404, { error: 'not found' });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createCheckoutServer().listen(PORT, () => {
    console.log(`warden-example checkout module listening on http://localhost:${PORT}`);
  });
}
