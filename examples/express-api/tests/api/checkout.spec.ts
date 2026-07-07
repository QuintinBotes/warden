import { test, expect } from '@playwright/test';

// Tags live in the test title so Warden's `--grep` tier selection can match them directly
// (see docs/cli.md). `testName` in the matching tests/cases/*.yaml is the descriptive
// prefix, without the trailing tags.

test.describe('checkout API', () => {
  test('login > succeeds with valid credentials @smoke @api @apps/checkout', async ({ request }) => {
    const response = await request.post('/login', {
      data: { email: 'demo@warden.dev', password: 'hunter2' },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.token).toBeTruthy();
  });

  test('login > rejects invalid credentials @regression @api @apps/checkout', async ({ request }) => {
    const response = await request.post('/login', {
      data: { email: 'demo@warden.dev', password: 'wrong-password' },
    });

    expect(response.status()).toBe(401);
  });

  test('cart > returns items and total @regression @api @apps/checkout', async ({ request }) => {
    const response = await request.get('/cart');

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBe(40);
  });

  test('checkout > confirms a valid card @smoke @regression @api @apps/checkout', async ({ request }) => {
    const response = await request.post('/checkout', {
      data: { cardNumber: '4242 4242 4242 4242' },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('confirmed');
  });

  test('checkout > declines an invalid card @regression @api @apps/checkout', async ({ request }) => {
    const response = await request.post('/checkout', {
      data: { cardNumber: '1111-1111-1111-1111' },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.status).toBe('declined');
  });
});
