import { defineConfig } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4321';

export default defineConfig({
  testDir: './tests',
  reporter: 'json',
  use: {
    baseURL: BASE_URL,
    screenshot: 'on',
    video: 'on',
    trace: 'on',
  },
  // Serve the dashboard export over http so /_next/... assets resolve (file:// can't).
  webServer: {
    command: 'node serve-static.mjs',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
