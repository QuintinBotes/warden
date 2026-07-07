import { defineConfig, devices } from '@playwright/test';

/**
 * Warden example: Playwright E2E config for warden-example-next-app.
 *
 * Warden's runner shells out to `playwright test --reporter=json [--grep <tag>]`, so tiers are
 * selected purely by grepping test titles for tags like `@smoke` or `@apps/checkout` — see
 * docs/cli.md and packages/runner/src/run-playwright.ts in the Warden repo.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: 'warden-artifacts/next-app-report.json' }]],
  use: {
    baseURL: process.env.WARDEN_BASE_URL ?? 'http://localhost:3000',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !process.env.CI,
    env: { PORT: '3000' },
  },
});
