import { test, expect } from '@playwright/test';

// Tags live in the test title so Warden's `--grep` tier selection can match them directly
// (see docs/cli.md). `testName` in the matching tests/cases/*.yaml is the descriptive
// prefix, without the trailing tags.

test('health > returns ok @smoke @api', async ({ request }) => {
  const response = await request.get('/health');

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});
