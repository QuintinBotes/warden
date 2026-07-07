import express from 'express';

/**
 * Warden example: a tiny in-memory Express JSON API — "Warden Demo Shop".
 *
 * Endpoints:
 *   GET  /health          -> { status: "ok" }
 *   POST /login           -> { token } on valid credentials, 401 otherwise
 *   GET  /cart             -> { items, total }
 *   POST /checkout         -> confirms or declines a card
 *
 * Deliberately dependency-light and stateful only in memory so the example is easy to read
 * end-to-end. Do not use this as a template for a real payments integration.
 */

const PORT = process.env.PORT || 3000;

// --- in-memory "database" -------------------------------------------------
const USERS = [{ email: 'demo@warden.dev', password: 'hunter2' }];

const CART = [
  { id: 'sku-1', name: 'Warden T-Shirt', price: 25 },
  { id: 'sku-2', name: 'Warden Mug', price: 15 },
];

// Stripe-style test prefix: any 16-digit card starting with 4242 is "valid".
const VALID_CARD_PREFIX = '4242';
const tokens = new Set();

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/login', (req, res) => {
    const { email, password } = req.body ?? {};
    const user = USERS.find((u) => u.email === email && u.password === password);

    if (!user) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const token = `demo-token-${Buffer.from(email).toString('hex')}`;
    tokens.add(token);
    return res.status(200).json({ token });
  });

  app.get('/cart', (req, res) => {
    const total = CART.reduce((sum, item) => sum + item.price, 0);
    res.status(200).json({ items: CART, total });
  });

  app.post('/checkout', (req, res) => {
    const { cardNumber } = req.body ?? {};
    const digitsOnly = typeof cardNumber === 'string' ? cardNumber.replace(/[\s-]/g, '') : '';
    const isValid = /^\d{16}$/.test(digitsOnly) && digitsOnly.startsWith(VALID_CARD_PREFIX);

    if (!isValid) {
      return res.status(400).json({ status: 'declined', reason: 'invalid card number' });
    }

    return res.status(200).json({ status: 'confirmed', orderId: `ord-${Date.now()}` });
  });

  return app;
}

// Only start listening when run directly (`node src/server.js` / `npm run dev`), so tests can
// import `createApp()` in-process if they ever want to.
if (import.meta.url === `file://${process.argv[1]}`) {
  createApp().listen(PORT, () => {
    console.log(`warden-example-express-api listening on http://localhost:${PORT}`);
  });
}
