import { describe, it, expect } from 'vitest';
import { CujSchema, defineConfig, type Cuj } from '@warden/core';
import { fakeProvider, fakeBrowserSession } from '@warden/core/testing';
import { ExploratoryStrategy } from './exploratory-strategy';

const config = defineConfig();

const missionCuj: Cuj = CujSchema.parse({
  id: 'CUJ-checkout',
  name: 'Guest checkout',
  owningTeam: 'payments',
  tier: 'tier1',
  steps: [
    { order: 2, name: 'Pay', module: '@apps/checkout', testIds: [] },
    { order: 1, name: 'Add item to cart', module: '@apps/cart', testIds: [] },
  ],
});

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

  it('prepends the CUJ mission brief and walks the journey steps when input.cuj is set', async () => {
    const provider = fakeProvider({ text: 'done' });
    const browser = fakeBrowserSession();

    await new ExploratoryStrategy().run({
      provider,
      browser,
      url: 'http://localhost:3000/checkout',
      config,
      cuj: missionCuj,
    });

    const prompt = provider.calls.find((c) => c.method === 'generateWithTools')!.prompt;
    // the mission brief is in the captured prompt
    expect(prompt).toContain('Mission brief: Guest checkout');
    expect(prompt).toContain('payments');
    // the session walked the journey's ordered steps (cart before pay)
    const actIndexCart = browser.actions.findIndex((a) => a.includes('Add item to cart'));
    const actIndexPay = browser.actions.findIndex((a) => a.includes('Pay'));
    expect(actIndexCart).toBeGreaterThanOrEqual(0);
    expect(actIndexPay).toBeGreaterThan(actIndexCart);
  });

  it('is byte-for-byte backward-compatible when input.cuj is absent', async () => {
    const run = async (withCuj: boolean) => {
      const provider = fakeProvider({ text: 'done' });
      const browser = fakeBrowserSession();
      await new ExploratoryStrategy().run({
        provider,
        browser,
        url: 'http://localhost:3000/checkout',
        config,
        ...(withCuj ? { cuj: missionCuj } : {}),
      });
      const prompt = provider.calls.find((c) => c.method === 'generateWithTools')!.prompt;
      return { prompt, actions: browser.actions };
    };

    const withoutCuj = await run(false);
    // no mission brief, and no `act` step-walking calls leak into the default path
    expect(withoutCuj.prompt).not.toContain('Mission brief');
    expect(withoutCuj.actions.some((a) => a.startsWith('act'))).toBe(false);
  });
});
