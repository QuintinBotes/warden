import { createServer } from 'node:http';

/**
 * Warden example: the "cart" module of a tiny two-app monorepo.
 *
 * GET  /health      -> { status: "ok", module: "cart" }
 * GET  /cart        -> { items, total }
 * POST /cart/items  -> appends an item, returns the updated list
 */

const PORT = process.env.CART_PORT || 3002;

const items = [
  { id: 'sku-1', name: 'Warden T-Shirt', price: 25 },
  { id: 'sku-2', name: 'Warden Mug', price: 15 },
];

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

export function createCartServer() {
  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { status: 'ok', module: 'cart' });
    }

    if (req.method === 'GET' && req.url === '/cart') {
      const total = items.reduce((sum, item) => sum + item.price, 0);
      return sendJson(res, 200, { items, total });
    }

    if (req.method === 'POST' && req.url === '/cart/items') {
      const body = await readJsonBody(req);
      if (!body.id || !body.name || typeof body.price !== 'number') {
        return sendJson(res, 400, { error: 'invalid item' });
      }
      items.push({ id: body.id, name: body.name, price: body.price });
      return sendJson(res, 201, { items });
    }

    sendJson(res, 404, { error: 'not found' });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createCartServer().listen(PORT, () => {
    console.log(`warden-example cart module listening on http://localhost:${PORT}`);
  });
}
