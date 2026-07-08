import { describe, expect, it } from 'vitest';
import { createFixtureCatalog, defineConfig } from '@warden/core';
import { fakeProvider, fixtureChangeSurface } from '@warden/core/testing';
import { GenerativeStrategy } from './generative-strategy';

const config = defineConfig();

const catalog = createFixtureCatalog('pr482-selective-a1b2', [
  {
    entity: 'customer',
    key: 'primaryCustomer',
    fields: { email: 'primary+pr482-selective-a1b2@test.warden' },
  },
]);

describe('GenerativeStrategy fixtures integration', () => {
  it('includes the fixture summary and a keyed-value instruction when fixtures are present', async () => {
    const provider = fakeProvider({ text: '// spec' });
    await new GenerativeStrategy().run({
      provider,
      changeSurface: fixtureChangeSurface(),
      config,
      fixtures: catalog,
    });
    const prompt = provider.calls.find((c) => c.method === 'generateText')!.prompt;
    expect(prompt).toContain('Seeded fixtures for this run');
    expect(prompt).toContain('customer.primaryCustomer');
    expect(prompt).toContain('primary+pr482-selective-a1b2@test.warden');
    expect(prompt).toContain('seeded: primaryCustomer');
  });

  it('omits the fixture summary entirely when no fixtures are provided (backward compatible)', async () => {
    const provider = fakeProvider({ text: '// spec' });
    await new GenerativeStrategy().run({
      provider,
      changeSurface: fixtureChangeSurface(),
      config,
    });
    const prompt = provider.calls.find((c) => c.method === 'generateText')!.prompt;
    expect(prompt).not.toContain('Seeded fixtures');
  });
});
