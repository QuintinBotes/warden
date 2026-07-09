import { describe, it, expect } from 'vitest';
import { defineConfig, type WardenConfig } from '@warden/core';
import { fixtureChangeSurface } from '@warden/core/testing';
import { computeImpact } from './compute-impact.js';
import { fixtureCoverageIndex } from './testing-fakes.js';

const cfgWith = (onUncovered: WardenConfig['impact']['onUncovered']): WardenConfig =>
  defineConfig({ impact: { enabled: true, onUncovered } });

describe('computeImpact', () => {
  it('selects exactly the tests whose covered files intersect the diff, with a file-named reason', () => {
    const index = fixtureCoverageIndex();
    const surface = fixtureChangeSurface({ changedFiles: ['apps/profile/page.tsx'] });

    const result = computeImpact(surface, index, cfgWith('run-all'));

    expect(result.impacted).toEqual([
      {
        testId: 'TC-profile',
        testName: 'edit profile',
        reason: 'Covers changed file apps/profile/page.tsx',
      },
    ]);
    expect(result.uncoveredChangedFiles).toEqual([]);
    expect(result.safetyNet).toBe(false);
  });

  it('dedupes an impacted test by testId even when it covers several changed files', () => {
    const index = fixtureCoverageIndex();
    const surface = fixtureChangeSurface({
      changedFiles: ['apps/checkout/page.tsx', 'lib/cart.ts'],
    });

    const result = computeImpact(surface, index, cfgWith('run-all'));

    const checkout = result.impacted.filter((t) => t.testId === 'TC-checkout');
    expect(checkout).toHaveLength(1); // deduped
    expect(checkout[0]!.reason).toBe('Covers changed file apps/checkout/page.tsx'); // first match wins
    // lib/cart.ts is covered by both TC-checkout and TC-cart
    expect(result.impacted.map((t) => t.testId).sort()).toEqual(['TC-cart', 'TC-checkout']);
    expect(result.uncoveredChangedFiles).toEqual([]);
  });

  it('collects changed files no entry covers and trips the safety net under run-all', () => {
    const index = fixtureCoverageIndex();
    const surface = fixtureChangeSurface({ changedFiles: ['lib/brand-new.ts'] });

    const result = computeImpact(surface, index, cfgWith('run-all'));

    expect(result.impacted).toEqual([]);
    expect(result.uncoveredChangedFiles).toEqual(['lib/brand-new.ts']);
    expect(result.safetyNet).toBe(true);
  });

  it('trips the safety net under run-tagged but not under warn', () => {
    const index = fixtureCoverageIndex();
    const surface = fixtureChangeSurface({ changedFiles: ['lib/brand-new.ts'] });

    expect(computeImpact(surface, index, cfgWith('run-tagged')).safetyNet).toBe(true);
    expect(computeImpact(surface, index, cfgWith('warn')).safetyNet).toBe(false);
  });

  it('mixes covered + uncovered files: narrows to the covered tests and still flags the safety net', () => {
    const index = fixtureCoverageIndex();
    const surface = fixtureChangeSurface({
      changedFiles: ['apps/profile/page.tsx', 'lib/brand-new.ts'],
    });

    const result = computeImpact(surface, index, cfgWith('run-all'));

    expect(result.impacted.map((t) => t.testId)).toEqual(['TC-profile']);
    expect(result.uncoveredChangedFiles).toEqual(['lib/brand-new.ts']);
    expect(result.safetyNet).toBe(true);
  });

  it('selects nothing for an empty diff and never trips the safety net', () => {
    const index = fixtureCoverageIndex();
    const surface = fixtureChangeSurface({ changedFiles: [] });

    const result = computeImpact(surface, index, cfgWith('run-all'));

    expect(result).toEqual({ impacted: [], uncoveredChangedFiles: [], safetyNet: false });
  });
});
