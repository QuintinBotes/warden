import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import { fakeProvider, fakeBrowserSession } from '@warden/core/testing';
import { ExploratoryStrategy } from './exploratory-strategy';

const config = defineConfig();

describe('ExploratoryStrategy', () => {
  it('has name "exploratory"', () => {
    expect(new ExploratoryStrategy().name).toBe('exploratory');
  });

  it('drives the browser and returns findings mapped from the provider tool calls', async () => {
    const provider = fakeProvider({
      text: 'Explored the checkout flow.',
      toolCalls: [
        {
          name: 'report_finding',
          input: {
            title: 'Checkout accepts negative quantity',
            severity: 'HIGH',
            steps: ['Open cart', 'Set quantity to -1', 'Checkout'],
            expected: 'Validation error',
            actual: 'Order placed with negative total',
          },
        },
      ],
    });
    const browser = fakeBrowserSession();
    const strategy = new ExploratoryStrategy();

    const output = await strategy.run({
      provider,
      browser,
      url: 'http://localhost:3000/checkout',
      config,
    });

    // AgentOutput shape
    expect(Array.isArray(output.findings)).toBe(true);
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]).toMatchObject({
      title: 'Checkout accepts negative quantity',
      severity: 'HIGH',
    });
    expect(output.findings[0]!.steps.length).toBeGreaterThan(0);
    expect(typeof output.markdownReport).toBe('string');
    expect(output.markdownReport.length).toBeGreaterThan(0);

    // it actually exercised the injected browser
    expect(browser.actions.some((a) => a.startsWith('goto'))).toBe(true);
    // the provider was consulted
    expect(provider.calls.some((c) => c.method === 'generateWithTools')).toBe(true);
  });

  it('normalizes unknown severities and missing fields to safe defaults', async () => {
    const provider = fakeProvider({
      toolCalls: [{ name: 'report_finding', input: { title: 'Weird' } }],
    });
    const output = await new ExploratoryStrategy().run({
      provider,
      browser: fakeBrowserSession(),
      config,
    });
    expect(output.findings[0]!.severity).toBe('MEDIUM');
    expect(output.findings[0]!.steps).toEqual([]);
  });

  it('produces a non-empty report even when no findings are reported', async () => {
    const provider = fakeProvider({ text: 'No issues found.' });
    const output = await new ExploratoryStrategy().run({
      provider,
      browser: fakeBrowserSession(),
      config,
    });
    expect(output.findings).toEqual([]);
    expect(output.markdownReport.length).toBeGreaterThan(0);
  });

  it('throws a BrowserError when no browser session is provided', async () => {
    const provider = fakeProvider();
    await expect(new ExploratoryStrategy().run({ provider, config })).rejects.toMatchObject({
      name: 'BrowserError',
      code: 'E_BROWSER',
    });
  });
});
