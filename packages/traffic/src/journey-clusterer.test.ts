import { describe, expect, it } from 'vitest';
import type { RecordedSession, RecordedStep } from '@warden/core';
import { createJourneyClusterer, routeTemplateOf } from './journey-clusterer.js';

function session(url: string, steps: RecordedStep[]): RecordedSession {
  return { url, startedAt: new Date('2026-07-08T10:00:00.000Z'), steps };
}

const GOTO: RecordedStep = { action: 'goto' };
const ADD: RecordedStep = { action: 'click', selector: 'Add to cart' };
const CHECKOUT: RecordedStep = { action: 'click', selector: 'Checkout' };
const SEARCH: RecordedStep = { action: 'fill', selector: 'Search' };

/** Four checkout sessions with the same interaction set but varying length (3,3,4,5). */
const checkout: RecordedSession[] = [
  session('https://shop.test/checkout/1001', [GOTO, ADD, CHECKOUT]),
  session('https://shop.test/checkout/1002', [GOTO, CHECKOUT, ADD]),
  session('https://shop.test/checkout/1003', [GOTO, ADD, ADD, CHECKOUT]),
  session('https://shop.test/checkout/1004', [GOTO, GOTO, ADD, CHECKOUT, CHECKOUT]),
];

/** Six search sessions — more frequent than checkout, but lower business weight. */
const search: RecordedSession[] = Array.from({ length: 6 }, (_, i) =>
  session(`https://shop.test/search?q=${i}`, [GOTO, SEARCH]),
);

const noise = [session('https://shop.test/about', [GOTO])];

describe('routeTemplateOf', () => {
  it('parameterizes id-like segments (numeric, uuid, redaction token)', () => {
    expect(routeTemplateOf('https://shop.test/checkout/1001')).toBe('/checkout/:id');
    expect(routeTemplateOf('https://shop.test/u/3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(
      '/u/:id',
    );
    expect(routeTemplateOf('https://shop.test/u/[REDACTED]', '[REDACTED]')).toBe('/u/:id');
    expect(routeTemplateOf('https://shop.test/search')).toBe('/search');
  });
});

describe('createJourneyClusterer', () => {
  const clusterer = createJourneyClusterer({
    minSessions: 3,
    businessWeightByRoute: { '/checkout/:id': 5 },
  });
  const clusters = clusterer.cluster([...search, ...checkout, ...noise]);

  it('groups sessions by canonical signature and drops sub-minSessions clusters (noise)', () => {
    expect(clusters).toHaveLength(2); // checkout + search; single /about noise dropped
    expect(clusters.some((c) => c.routeTemplate === '/about')).toBe(false);
  });

  it('ranks by frequency × business weight, not raw frequency', () => {
    // search is more frequent (6 vs 4) but checkout is weighted 5× → checkout ranks first.
    expect(clusters[0]!.routeTemplate).toBe('/checkout/:id');
    expect(clusters[0]!.frequency).toBe(4);
    expect(clusters[0]!.weight).toBe(20); // 4 × 5
    expect(clusters[1]!.routeTemplate).toBe('/search');
    expect(clusters[1]!.frequency).toBe(6);
    expect(clusters[1]!.weight).toBe(6); // 6 × 1 (default weight)
  });

  it('picks the median-length session as the deterministic representative', () => {
    // checkout lengths sorted: [3, 3, 4, 5] → median (index 2) has length 4.
    expect(clusters[0]!.representative.steps).toHaveLength(4);
  });

  it('is deterministic: identical input yields identical clusters', () => {
    const again = createJourneyClusterer({
      minSessions: 3,
      businessWeightByRoute: { '/checkout/:id': 5 },
    }).cluster([...search, ...checkout, ...noise]);
    expect(again).toEqual(clusters);
  });
});
