import { test, expect } from '@playwright/test';

// This spec only ever exercises the "cart" module, so every test here carries the @apps/cart
// module tag — Warden's selective testing greps on exactly this tag when a PR's diff only
// touches apps/cart (see docs/architecture.md and ../../README.md).

const CART_URL = process.env.CART_URL ?? 'http://localhost:3002';

test.describe('cart module', () => {
  test('cart > lists items and total @smoke @apps/cart', async ({ request }) => {
    const response = await request.get(`${CART_URL}/cart`);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(40);
  });

  test('cart > adds an item @regression @apps/cart', async ({ request }) => {
    const response = await request.post(`${CART_URL}/cart/items`, {
      data: { id: 'sku-3', name: 'Warden Stickers', price: 5 },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.items).toHaveLength(3);
  });
});
