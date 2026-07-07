import { createServer } from 'node:http';
import { URL } from 'node:url';

/**
 * Warden example: a minimal login + checkout web UI — "Warden Demo Shop".
 *
 * Deliberately framework-light: a plain `node:http` server serving small, real HTML pages
 * (with real <form>/<label>/<button> elements, no client framework) plus two JSON API routes.
 * This keeps the example runnable with zero dependencies while still exercising a real
 * login -> checkout browser flow for Playwright's role-based locators.
 *
 * Pages:
 *   GET  /login     -> sign-in form
 *   GET  /checkout  -> cart summary + card form (reached after a successful login)
 * API:
 *   POST /api/login    -> { token } on valid credentials, 401 otherwise
 *   POST /api/checkout -> confirms or declines a card (requires a bearer token from /api/login)
 */

const PORT = process.env.PORT || 3000;

// --- in-memory "database" -------------------------------------------------
const USERS = [{ email: 'demo@warden.dev', password: 'hunter2' }];
const CART = [
  { name: 'Warden T-Shirt', price: 25 },
  { name: 'Warden Mug', price: 15 },
];
const VALID_CARD_PREFIX = '4242';
const sessions = new Set();

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Warden Demo Shop - ${title}</title>
</head>
<body>
${body}
</body>
</html>`;
}

function renderLoginPage() {
  return layout(
    'Log in',
    `<main>
  <h1>Log in</h1>
  <form id="login-form">
    <div>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" required />
    </div>
    <div>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
    </div>
    <button type="submit">Log in</button>
  </form>
  <p role="alert" id="login-message"></p>
  <script>
    const form = document.getElementById('login-form');
    const message = document.getElementById('login-message');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.textContent = '';
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        const { token } = await response.json();
        window.location.href = '/checkout?token=' + encodeURIComponent(token);
      } else {
        message.textContent = 'Invalid email or password.';
      }
    });
  </script>
</main>`,
  );
}

function renderCheckoutPage() {
  const total = CART.reduce((sum, item) => sum + item.price, 0);
  const items = CART.map((item) => `<li>${item.name} — $${item.price}</li>`).join('\n      ');

  return layout(
    'Checkout',
    `<main>
  <h1>Checkout</h1>
  <section aria-label="Cart summary">
    <h2>Your cart</h2>
    <ul>
      ${items}
    </ul>
    <p>Total: <span id="cart-total">$${total}</span></p>
  </section>
  <form id="checkout-form">
    <div>
      <label for="cardNumber">Card number</label>
      <input id="cardNumber" name="cardNumber" type="text" inputmode="numeric" required />
    </div>
    <button type="submit">Pay now</button>
  </form>
  <p role="status" id="checkout-message"></p>
  <script>
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    const form = document.getElementById('checkout-form');
    const message = document.getElementById('checkout-message');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.textContent = '';
      const cardNumber = document.getElementById('cardNumber').value;
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ cardNumber }),
      });
      const body = await response.json();
      if (response.ok) {
        message.textContent = 'Payment confirmed. Order ' + body.orderId + ' is on its way!';
      } else {
        message.textContent = 'Payment declined. Please check your card number.';
      }
    });
  </script>
</main>`,
  );
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function createServerApp() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { status: 'ok' });
    }

    if (req.method === 'GET' && url.pathname === '/login') {
      return sendHtml(res, 200, renderLoginPage());
    }

    if (req.method === 'GET' && url.pathname === '/checkout') {
      return sendHtml(res, 200, renderCheckoutPage());
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJsonBody(req);
      const user = USERS.find((u) => u.email === body.email && u.password === body.password);

      if (!user) {
        return sendJson(res, 401, { error: 'invalid credentials' });
      }

      const token = `demo-token-${Buffer.from(body.email).toString('hex')}`;
      sessions.add(token);
      return sendJson(res, 200, { token });
    }

    if (req.method === 'POST' && url.pathname === '/api/checkout') {
      const authHeader = req.headers.authorization ?? '';
      const token = authHeader.replace(/^Bearer\s+/i, '');

      if (!sessions.has(token)) {
        return sendJson(res, 401, { error: 'not authenticated' });
      }

      const body = await readJsonBody(req);
      const digitsOnly = typeof body.cardNumber === 'string' ? body.cardNumber.replace(/[\s-]/g, '') : '';
      const isValid = /^\d{16}$/.test(digitsOnly) && digitsOnly.startsWith(VALID_CARD_PREFIX);

      if (!isValid) {
        return sendJson(res, 400, { status: 'declined' });
      }

      return sendJson(res, 200, { status: 'confirmed', orderId: `ord-${Date.now()}` });
    }

    sendHtml(res, 404, layout('Not found', '<main><h1>Not found</h1></main>'));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServerApp().listen(PORT, () => {
    console.log(`warden-example-next-app listening on http://localhost:${PORT}`);
  });
}
