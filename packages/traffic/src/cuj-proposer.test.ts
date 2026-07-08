import { describe, expect, it } from 'vitest';
import type { GeneratedTest, JourneyCluster } from '@warden/core';
import { fakeProvider } from '@warden/core/testing';
import { AiCujProposer, buildCujNamingPrompt, createCujProposer } from './cuj-proposer.js';

const cluster: JourneyCluster = {
  signature: '/checkout/:id|click:Add to cart>click:Checkout>goto:',
  routeTemplate: '/checkout/:id',
  frequency: 42,
  weight: 210,
  representative: {
    url: 'https://shop.test/checkout/1001',
    startedAt: new Date('2026-07-08T10:00:00.000Z'),
    steps: [
      { action: 'goto' },
      { action: 'click', selector: 'Add to cart' },
      { action: 'click', selector: 'Checkout' },
    ],
  },
};

const specs: GeneratedTest[] = [
  { path: 'tests/e2e/traffic/checkout.spec.ts', content: '// spec', tags: ['@traffic'] },
  { path: 'tests/e2e/traffic/checkout-2.spec.ts', content: '// spec', tags: ['@traffic'] },
];

describe('AiCujProposer', () => {
  it('names the journey via the provider and links the synthesized specs', async () => {
    const provider = fakeProvider({ text: 'Guest Checkout With Saved Card' });
    const cuj = await new AiCujProposer().propose(cluster, specs, provider);

    expect(cuj.name).toBe('Guest Checkout With Saved Card');
    expect(cuj.signature).toBe(cluster.signature);
    expect(cuj.frequency).toBe(42);
    expect(cuj.routeTemplate).toBe('/checkout/:id');
    expect(cuj.testPaths).toEqual([
      'tests/e2e/traffic/checkout.spec.ts',
      'tests/e2e/traffic/checkout-2.spec.ts',
    ]);
  });

  it('strips code fences / quotes and keeps a single-line name', async () => {
    const provider = fakeProvider({ text: '```\n"Checkout Flow"\n```' });
    const cuj = await createCujProposer().propose(cluster, specs, provider);
    expect(cuj.name).toBe('Checkout Flow');
  });

  it('falls back to a deterministic route-derived name when the provider returns nothing', async () => {
    const provider = fakeProvider({ text: '   ' });
    const cuj = await new AiCujProposer().propose(cluster, specs, provider);
    expect(cuj.name).toBe('Checkout journey'); // from route /checkout/:id, params dropped
  });

  it('builds a deterministic naming prompt from the cluster', () => {
    const prompt = buildCujNamingPrompt(cluster);
    expect(prompt).toContain('Route: /checkout/:id');
    expect(prompt).toContain('Observed 42 times.');
    expect(prompt).toContain('selector=Add to cart');
  });
});
