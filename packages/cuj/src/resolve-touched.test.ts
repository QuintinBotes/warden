import { describe, it, expect } from 'vitest';
import { fixtureChangeSurface } from '@warden/core/testing';
import { resolveTouchedCujs } from './resolve-touched.js';
import { fixtureCuj } from './testing-fakes.js';

describe('resolveTouchedCujs', () => {
  it('touches a CUJ when the change surface intersects its top-level tags', () => {
    const cuj = fixtureCuj({ id: 'CUJ-a', tags: ['@apps/checkout'], steps: [] });
    const surface = fixtureChangeSurface({ testTags: ['@apps/checkout'], changedModules: [] });

    const touched = resolveTouchedCujs(surface, [cuj]);

    expect(touched).toHaveLength(1);
    expect(touched[0]!.cuj.id).toBe('CUJ-a');
    expect(touched[0]!.matchedTags).toEqual(['@apps/checkout']);
    expect(touched[0]!.reason).toContain('Guest checkout');
  });

  it('touches a CUJ on a step-module match even when top-level tags are disjoint', () => {
    const cuj = fixtureCuj({
      id: 'CUJ-b',
      tags: ['@unrelated'],
      steps: [{ order: 1, name: 'Pay', module: '@apps/checkout', testIds: [] }],
    });
    const surface = fixtureChangeSurface({ testTags: [], changedModules: ['@apps/checkout'] });

    const touched = resolveTouchedCujs(surface, [cuj]);

    expect(touched).toHaveLength(1);
    expect(touched[0]!.matchedTags).toEqual(['@apps/checkout']);
  });

  it('returns an empty set for a disjoint change (proving the gate is genuinely scoped)', () => {
    const cuj = fixtureCuj({ id: 'CUJ-c', tags: ['@apps/profile'], steps: [] });
    const surface = fixtureChangeSurface({
      testTags: ['@apps/checkout'],
      changedModules: ['apps/checkout'],
    });

    expect(resolveTouchedCujs(surface, [cuj])).toEqual([]);
  });

  it('deduplicates and sorts matched tags across tags + step modules', () => {
    const cuj = fixtureCuj({
      id: 'CUJ-d',
      tags: ['@b', '@a'],
      steps: [
        { order: 1, name: 's1', module: '@a', testIds: [] },
        { order: 2, name: 's2', module: '@c', testIds: [] },
      ],
    });
    const surface = fixtureChangeSurface({ testTags: ['@a', '@b', '@c'], changedModules: [] });

    const touched = resolveTouchedCujs(surface, [cuj]);
    expect(touched[0]!.matchedTags).toEqual(['@a', '@b', '@c']);
  });

  it('only returns the touched subset of many CUJs', () => {
    const hit = fixtureCuj({ id: 'CUJ-hit', tags: ['@apps/checkout'], steps: [] });
    const miss = fixtureCuj({ id: 'CUJ-miss', tags: ['@apps/search'], steps: [] });
    const surface = fixtureChangeSurface({ testTags: ['@apps/checkout'], changedModules: [] });

    const touched = resolveTouchedCujs(surface, [hit, miss]);
    expect(touched.map((t) => t.cuj.id)).toEqual(['CUJ-hit']);
  });
});
