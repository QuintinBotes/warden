import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The dashboard app is a workspace member like any package, and two of its files
    // — the client component and the snapshot script — carry behaviour worth asserting.
    // They live under apps/, not packages/, so the glob has to name both roots.
    include: [
      'packages/**/src/**/*.test.{ts,tsx}',
      'apps/*/app/**/*.test.{ts,tsx}',
      'apps/*/scripts/**/*.test.mjs',
    ],
    environment: 'node',
  },
});
