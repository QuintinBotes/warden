import { describe, it, expect } from 'vitest';
import { defineConfig, type ImpactResult, type WardenConfig } from '@warden/core';
import { fixtureChangeSurface } from '@warden/core/testing';
import { impactToGrep, selectWithImpact } from './impact-to-grep.js';
import { fixtureCoverageIndex } from './testing-fakes.js';

const cfgWith = (onUncovered: WardenConfig['impact']['onUncovered']): WardenConfig =>
  defineConfig({ impact: { enabled: true, onUncovered } });

const impacted = (names: string[]): ImpactResult => ({
  impacted: names.map((testName, i) => ({ testId: `TC-${i}`, testName, reason: 'r' })),
  uncoveredChangedFiles: [],
  safetyNet: false,
});

describe('impactToGrep', () => {
  it('renders impacted test names into a regex alternation', () => {
    expect(impactToGrep(impacted(['guest checkout', 'add to cart']))).toBe(
      'guest checkout|add to cart',
    );
  });

  it('renders a single impacted name without a pipe', () => {
    expect(impactToGrep(impacted(['guest checkout']))).toBe('guest checkout');
  });

  it('escapes regex metacharacters in test names', () => {
    expect(impactToGrep(impacted(['a.b (c)', 'd|e']))).toBe('a\\.b \\(c\\)|d\\|e');
  });

  it('returns an empty string when nothing is impacted', () => {
    expect(impactToGrep(impacted([]))).toBe('');
  });
});

describe('selectWithImpact', () => {
  it('forces the full suite (runAll) when the run-all safety net trips', () => {
    const surface = fixtureChangeSurface({ changedFiles: ['lib/brand-new.ts'] });

    const sel = selectWithImpact(surface, fixtureCoverageIndex(), cfgWith('run-all'));

    expect(sel.runAll).toBe(true);
    expect(sel.grep).toBeNull();
    expect(sel.result.safetyNet).toBe(true);
  });

  it('narrows to a grep when tests are impacted and no run-all escalation applies', () => {
    const surface = fixtureChangeSurface({ changedFiles: ['apps/profile/page.tsx'] });

    const sel = selectWithImpact(surface, fixtureCoverageIndex(), cfgWith('run-all'));

    expect(sel.runAll).toBe(false);
    expect(sel.grep).toBe('edit profile');
  });

  it('narrows to a grep under the warn policy even with uncovered files (no escalation)', () => {
    const surface = fixtureChangeSurface({
      changedFiles: ['apps/profile/page.tsx', 'lib/brand-new.ts'],
    });

    const sel = selectWithImpact(surface, fixtureCoverageIndex(), cfgWith('warn'));

    expect(sel.runAll).toBe(false);
    expect(sel.grep).toBe('edit profile');
    expect(sel.result.safetyNet).toBe(false);
  });

  it('narrows to a grep under run-tagged while surfacing the safety net on the result', () => {
    const surface = fixtureChangeSurface({
      changedFiles: ['apps/profile/page.tsx', 'lib/brand-new.ts'],
    });

    const sel = selectWithImpact(surface, fixtureCoverageIndex(), cfgWith('run-tagged'));

    // run-tagged does not force run-all; it narrows to impacted and lets the caller union tags.
    expect(sel.runAll).toBe(false);
    expect(sel.grep).toBe('edit profile');
    expect(sel.result.safetyNet).toBe(true);
    expect(sel.result.uncoveredChangedFiles).toEqual(['lib/brand-new.ts']);
  });

  it('defers (grep null, runAll false) for an empty diff', () => {
    const surface = fixtureChangeSurface({ changedFiles: [] });

    const sel = selectWithImpact(surface, fixtureCoverageIndex(), cfgWith('run-all'));

    expect(sel).toMatchObject({ grep: null, runAll: false });
    expect(sel.result.impacted).toEqual([]);
  });
});
