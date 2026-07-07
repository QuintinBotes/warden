import { defineConfig } from '@playwright/test';

/**
 * Warden example: Playwright config for warden-example-monorepo.
 *
 * Both module servers are started via Playwright's `webServer` array so a single `playwright
 * test` run can exercise either module. In CI, Warden's scope analysis derives module tags
 * (`@apps/checkout`, `@apps/cart`) from the changed paths and greps only the affected module's
 * tests — see docs/architecture.md ("Modules -> Playwright test tags") and docs/cli.md.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: 'warden-artifacts/monorepo-report.json' }]],
  webServer: [
    {
      command: 'npm run dev:checkout',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      env: { CHECKOUT_PORT: '3001' },
    },
    {
      command: 'npm run dev:cart',
      url: 'http://localhost:3002/health',
      reuseExistingServer: !process.env.CI,
      env: { CART_PORT: '3002' },
    },
  ],
});
