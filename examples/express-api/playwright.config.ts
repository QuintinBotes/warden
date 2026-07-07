import { defineConfig } from '@playwright/test';

/**
 * Warden example: Playwright API-test config for warden-example-express-api.
 *
 * Warden's runner shells out to `playwright test --reporter=json [--grep <tag>]`, so tiers are
 * selected purely by grepping test titles for tags like `@smoke` or `@apps/checkout` — see
 * docs/cli.md and packages/runner/src/run-playwright.ts in the Warden repo.
 */
export default defineConfig({
  testDir: './tests/api',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: 'warden-artifacts/express-api-report.json' }]],
  use: {
    baseURL: process.env.WARDEN_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/health',
    reuseExistingServer: !process.env.CI,
    env: { PORT: '3000' },
  },
});
