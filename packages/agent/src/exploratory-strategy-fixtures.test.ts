import { describe, expect, it } from 'vitest';
import { createFixtureCatalog, defineConfig } from '@warden/core';
import { fakeBrowserSession, fakeProvider } from '@warden/core/testing';
import { ExploratoryStrategy } from './exploratory-strategy';

const config = defineConfig();

const catalog = createFixtureCatalog('pr482-a1b2', [
  { entity: 'order', key: 'openOrder', fields: { id: 'ORD-pr482-a1b2-041', status: 'pending' } },
]);

describe('ExploratoryStrategy fixtures integration', () => {
  it('includes the fixture summary in the exploration prompt when fixtures are present', async () => {
    const provider = fakeProvider({ text: 'done' });
    await new ExploratoryStrategy().run({
      provider,
      browser: fakeBrowserSession(),
      config,
      fixtures: catalog,
    });
    const prompt = provider.calls.find((c) => c.method === 'generateWithTools')!.prompt;
    expect(prompt).toContain('Seeded fixtures for this run');
    expect(prompt).toContain('order.openOrder');
    expect(prompt).toContain('ORD-pr482-a1b2-041');
  });

  it('omits the fixture summary when no fixtures are provided (backward compatible)', async () => {
    const provider = fakeProvider({ text: 'done' });
    await new ExploratoryStrategy().run({
      provider,
      browser: fakeBrowserSession(),
      config,
    });
    const prompt = provider.calls.find((c) => c.method === 'generateWithTools')!.prompt;
    expect(prompt).not.toContain('Seeded fixtures');
  });
});
