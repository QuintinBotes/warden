import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import { fakeProvider, fixtureChangeSurface } from '@warden/core/testing';
import { GenerativeStrategy } from './generative-strategy';

const config = defineConfig();
const CANNED_SPEC = `import { test, expect } from '@playwright/test';

test('@smoke checkout happy path', async ({ page }) => {
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
});
`;

describe('GenerativeStrategy', () => {
  it('has name "generative"', () => {
    expect(new GenerativeStrategy().name).toBe('generative');
  });

  it('generates a spec file from the change surface using the provider text', async () => {
    const provider = fakeProvider({ text: CANNED_SPEC });
    const output = await new GenerativeStrategy().run({
      provider,
      changeSurface: fixtureChangeSurface(),
      config,
    });

    expect(output.findings).toEqual([]);
    expect(output.generatedFiles).toBeDefined();
    expect(output.generatedFiles).toHaveLength(1);
    const file = output.generatedFiles![0]!;
    expect(file.content).toBe(CANNED_SPEC);
    expect(file.path).toMatch(/^tests\/e2e\/.+\.spec\.ts$/);
    expect(output.markdownReport.length).toBeGreaterThan(0);
    // provider was asked to generate text
    expect(provider.calls.some((c) => c.method === 'generateText')).toBe(true);
  });

  it('derives the spec path from the changed module name', async () => {
    const provider = fakeProvider({ text: CANNED_SPEC });
    const output = await new GenerativeStrategy().run({
      provider,
      changeSurface: fixtureChangeSurface({ changedModules: ['apps/checkout'] }),
      config,
    });
    expect(output.generatedFiles![0]!.path).toBe('tests/e2e/checkout.spec.ts');
  });

  it('falls back to the diff path when there is no change surface', async () => {
    const provider = fakeProvider({ text: CANNED_SPEC });
    const output = await new GenerativeStrategy().run({
      provider,
      diff: [{ path: 'src/features/login-form.tsx', status: 'added' }],
      config,
    });
    expect(output.generatedFiles![0]!.path).toBe('tests/e2e/login-form.spec.ts');
  });
});
