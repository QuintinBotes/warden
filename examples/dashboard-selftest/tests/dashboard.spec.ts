import { test, expect } from '@playwright/test';

// baseURL is the http static server serving apps/dashboard/out (see playwright.config.ts).
// These are the @smoke tier Warden runs against its own dashboard.

test('@smoke dashboard loads with the correct title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Warden Dashboard/i);
});

test('@smoke core dashboard panels render', async ({ page }) => {
  await page.goto('/');
  for (const panel of [
    'Latest verdict',
    'Test results',
    'Critical User Journeys',
    'Visual Regression',
    'Flake & quarantine',
  ]) {
    await expect(page.locator('h2.wd-title', { hasText: panel })).toBeVisible();
  }
});

test('@smoke static assets are served over http (css + js load 200)', async ({ page }) => {
  // Collect every _next asset response — this is what file:// cannot deliver.
  const ok = { css: false, js: false };
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('/_next/static/') || !res.ok()) return;
    if (url.endsWith('.css')) ok.css = true;
    if (url.endsWith('.js')) ok.js = true;
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  expect(ok.css, 'a /_next/static/*.css returned 200').toBe(true);
  expect(ok.js, 'a /_next/static/*.js returned 200').toBe(true);

  // And the stylesheet actually applied: the dark-theme dashboard body is not the UA default.
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('rgb(255, 255, 255)');
});
