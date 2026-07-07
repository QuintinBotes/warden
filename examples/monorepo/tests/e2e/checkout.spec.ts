import { test, expect } from '@playwright/test';

// This spec only ever exercises the "checkout" module, so every test here carries the
// @apps/checkout module tag — Warden's selective testing greps on exactly this tag when a
// PR's diff only touches apps/checkout (see docs/architecture.md and ../../README.md).

const CHECKOUT_URL = process.env.CHECKOUT_URL ?? 'http://localhost:3001';

test.describe('checkout module', () => {
  test('checkout > confirms a valid card @smoke @regression @apps/checkout', async ({ request }) => {
    const response = await request.post(`${CHECKOUT_URL}/checkout`, {
      data: { cardNumber: '4242 4242 4242 4242' },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('confirmed');
  });

  test('checkout > declines an invalid card @regression @apps/checkout', async ({ request }) => {
    const response = await request.post(`${CHECKOUT_URL}/checkout`, {
      data: { cardNumber: '0000 0000 0000 0000' },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.status).toBe('declined');
  });
});
