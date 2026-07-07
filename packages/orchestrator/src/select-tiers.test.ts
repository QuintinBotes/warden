import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import { fixtureChangeSurface } from '@warden/core/testing';
import { selectTiers } from './index';

const cfg = defineConfig();

describe('selectTiers', () => {
  it('runs smoke + selective for a low risk score (0-3)', () => {
    const tiers = selectTiers(fixtureChangeSurface({ riskScore: 2, hasSharedChanges: false }), cfg);
    expect(tiers).toEqual(['smoke', 'selective']);
  });

  it('runs full regression + exploratory for a medium risk score (4-6)', () => {
    const tiers = selectTiers(fixtureChangeSurface({ riskScore: 5, hasSharedChanges: false }), cfg);
    expect(tiers).toEqual(['smoke', 'fullRegression', 'aiExploratory']);
  });

  it('runs full regression + exploratory for a high risk score (7-10)', () => {
    const tiers = selectTiers(fixtureChangeSurface({ riskScore: 9, hasSharedChanges: false }), cfg);
    expect(tiers).toEqual(['smoke', 'fullRegression', 'aiExploratory']);
  });

  it('forces full regression when there are shared changes on a low risk score', () => {
    const tiers = selectTiers(fixtureChangeSurface({ riskScore: 1, hasSharedChanges: true }), cfg);
    expect(tiers).toContain('fullRegression');
    expect(tiers).toContain('smoke');
  });

  it('does not duplicate full regression when shared changes and it is already selected', () => {
    const tiers = selectTiers(fixtureChangeSurface({ riskScore: 8, hasSharedChanges: true }), cfg);
    expect(tiers.filter((t) => t === 'fullRegression')).toHaveLength(1);
  });
});
