import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import { fakeProvider } from '@warden/core/testing';
import type { FailureContext } from '@warden/core';
import { HealerStrategy } from './healer-strategy';

const config = defineConfig();

const failure: FailureContext = {
  testCode: "await page.getByRole('button', { name: 'Buy' }).click();",
  errorMessage:
    "locator.click: Timeout 30000ms exceeded waiting for getByRole('button', { name: 'Buy' })",
  stackTrace: 'at checkout.spec.ts:12:34',
};

describe('HealerStrategy', () => {
  it('has name "healer"', () => {
    expect(new HealerStrategy().name).toBe('healer');
  });

  it('classifies the failure as maintenance from the provider tool call', async () => {
    const provider = fakeProvider({
      toolCalls: [
        {
          name: 'classify_failure',
          input: {
            kind: 'maintenance',
            severity: 'LOW',
            explanation: 'The Buy button was renamed to Purchase.',
            proposedFix: "getByRole('button', { name: 'Purchase' })",
          },
        },
      ],
    });
    const output = await new HealerStrategy().run({ provider, failure, config });

    expect(output.findings).toEqual([]);
    expect(output.diagnosis).toBeDefined();
    expect(output.diagnosis!.kind).toBe('maintenance');
    expect(['regression', 'maintenance']).toContain(output.diagnosis!.kind);
    expect(output.diagnosis!.explanation.length).toBeGreaterThan(0);
    expect(output.markdownReport.length).toBeGreaterThan(0);
  });

  it('classifies the failure as regression when the provider says so', async () => {
    const provider = fakeProvider({
      toolCalls: [
        {
          name: 'classify_failure',
          input: { kind: 'regression', severity: 'CRITICAL', explanation: 'Checkout crashes.' },
        },
      ],
    });
    const output = await new HealerStrategy().run({ provider, failure, config });
    expect(output.diagnosis!.kind).toBe('regression');
    expect(output.diagnosis!.severity).toBe('CRITICAL');
  });

  it('defaults to a valid kind when the provider returns nothing usable', async () => {
    const provider = fakeProvider({ text: 'not sure' });
    const output = await new HealerStrategy().run({ provider, failure, config });
    expect(['regression', 'maintenance']).toContain(output.diagnosis!.kind);
  });

  it('throws when there is no failure context', async () => {
    const provider = fakeProvider();
    await expect(new HealerStrategy().run({ provider, config })).rejects.toMatchObject({
      name: 'WardenError',
    });
  });
});
