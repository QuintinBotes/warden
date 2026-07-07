import { test, expect } from '@playwright/test';

// Role-based locators only (getByRole/getByLabel/getByText) — never CSS selectors — so tests
// stay resilient to markup changes. Tags live in the test title for Warden's `--grep` tier
// selection (see docs/cli.md); `testName` in tests/cases/*.yaml omits the trailing tags.

test.describe('login', () => {
  test('login > user can sign in with valid credentials @smoke @apps/auth', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email').fill('demo@warden.dev');
    await page.getByLabel('Password').fill('hunter2');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  });

  test('login > shows an error for invalid credentials @regression @apps/auth', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email').fill('demo@warden.dev');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
    await expect(page).toHaveURL(/\/login/);
  });
});
