import { test, expect, type Page } from '@playwright/test';

// Role-based locators only (getByRole/getByLabel/getByText) — never CSS selectors — so tests
// stay resilient to markup changes. Tags live in the test title for Warden's `--grep` tier
// selection (see docs/cli.md); `testName` in tests/cases/*.yaml omits the trailing tags.

async function loginAndReachCheckout(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@warden.dev');
  await page.getByLabel('Password').fill('hunter2');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/checkout/);
}

test.describe('checkout', () => {
  test('checkout > complete with credit card @smoke @regression @apps/checkout', async ({ page }) => {
    await loginAndReachCheckout(page);

    await page.getByLabel('Card number').fill('4242 4242 4242 4242');
    await page.getByRole('button', { name: 'Pay now' }).click();

    await expect(page.getByRole('status')).toContainText('Payment confirmed.');
  });

  test('checkout > declines an invalid card @regression @apps/checkout', async ({ page }) => {
    await loginAndReachCheckout(page);

    await page.getByLabel('Card number').fill('1111 1111 1111 1111');
    await page.getByRole('button', { name: 'Pay now' }).click();

    await expect(page.getByRole('status')).toContainText('Payment declined.');
  });
});
