import { describe, expect, it } from 'vitest';
import { defineConfig, type TestCase, type WardenConfig } from '@warden/core';
import { fixtureChangeSurface } from '@warden/core/testing';
import { analyzeGaps } from './gap-analyzer.js';
import type { TestInventory } from './test-inventory.js';
import type { DocInventory } from './doc-inventory.js';

function makeCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'TC-001',
    title: 'A test',
    type: 'integration',
    priority: 'P2',
    tags: [],
    requirementIds: [],
    automation: { framework: 'playwright' },
    source: 'manual',
    ...overrides,
  };
}

const emptyTest: TestInventory = { cases: [], specFiles: [] };
const emptyDoc: DocInventory = { docFiles: [], openapiFiles: [] };

function cfgWithMapping(mapping?: 'by-tag' | 'by-path'): WardenConfig {
  return defineConfig({ links: { testRepos: [{ repo: 'org/e2e', mapping }] } });
}

describe('analyzeGaps', () => {
  it('flags an uncovered, undocumented changed subject for both kinds', () => {
    const surface = fixtureChangeSurface({
      changedModules: ['checkout'],
      affectedApiRoutes: [],
      affectedComponents: [],
    });

    const gaps = analyzeGaps(surface, emptyTest, emptyDoc, cfgWithMapping('by-tag'));

    expect(gaps).toContainEqual(
      expect.objectContaining({ kind: 'test', type: 'uncovered', subject: 'checkout' }),
    );
    expect(gaps).toContainEqual(
      expect.objectContaining({ kind: 'doc', type: 'uncovered', subject: 'checkout' }),
    );
  });

  it('flags a covered subject as `changed` (test by tag, doc by path)', () => {
    const surface = fixtureChangeSurface({
      changedModules: ['checkout'],
      affectedApiRoutes: [],
      affectedComponents: [],
    });
    const testInv: TestInventory = {
      cases: [makeCase({ id: 'TC-9', tags: ['@checkout'] })],
      specFiles: [],
    };
    const docInv: DocInventory = { docFiles: ['docs/checkout.md'], openapiFiles: [] };

    const gaps = analyzeGaps(surface, testInv, docInv, cfgWithMapping('by-tag'));

    expect(gaps).toContainEqual(
      expect.objectContaining({
        kind: 'test',
        type: 'changed',
        subject: 'checkout',
        relatedPath: 'TC-9',
      }),
    );
    expect(gaps).toContainEqual(
      expect.objectContaining({
        kind: 'doc',
        type: 'changed',
        subject: 'checkout',
        relatedPath: 'docs/checkout.md',
      }),
    );
  });

  it('honors by-path mapping: a spec path covers, a tag does not', () => {
    const surface = fixtureChangeSurface({
      changedModules: ['checkout'],
      affectedApiRoutes: [],
      affectedComponents: [],
    });
    const testInv: TestInventory = {
      cases: [makeCase({ tags: ['@checkout'] })],
      specFiles: ['tests/checkout.spec.ts'],
    };

    const gaps = analyzeGaps(surface, testInv, emptyDoc, cfgWithMapping('by-path'));

    // Under by-path the tag is ignored; the matching spec path makes it `changed`.
    const testGap = gaps.find((g) => g.kind === 'test');
    expect(testGap).toMatchObject({
      type: 'changed',
      subject: 'checkout',
      relatedPath: 'tests/checkout.spec.ts',
    });
  });

  it('under by-tag, a matching spec path alone does not cover (still uncovered)', () => {
    const surface = fixtureChangeSurface({
      changedModules: ['checkout'],
      affectedApiRoutes: [],
      affectedComponents: [],
    });
    const testInv: TestInventory = { cases: [], specFiles: ['tests/checkout.spec.ts'] };

    const gaps = analyzeGaps(surface, testInv, emptyDoc, cfgWithMapping('by-tag'));

    const testGap = gaps.find((g) => g.kind === 'test');
    expect(testGap?.type).toBe('uncovered');
  });

  it('flags an orphaned test/doc for a removed subject and excludes it from uncovered', () => {
    const surface = fixtureChangeSurface({
      changedModules: ['legacy'],
      affectedApiRoutes: [],
      affectedComponents: [],
    });
    const testInv: TestInventory = { cases: [], specFiles: ['tests/legacy.spec.ts'] };
    const docInv: DocInventory = { docFiles: ['docs/legacy.md'], openapiFiles: [] };

    const gaps = analyzeGaps(surface, testInv, docInv, cfgWithMapping('by-path'), ['legacy']);

    expect(gaps).toContainEqual(
      expect.objectContaining({
        kind: 'test',
        type: 'orphaned',
        subject: 'legacy',
        relatedPath: 'tests/legacy.spec.ts',
      }),
    );
    expect(gaps).toContainEqual(
      expect.objectContaining({ kind: 'doc', type: 'orphaned', subject: 'legacy' }),
    );
    // A removed subject is never also reported as uncovered/changed.
    expect(gaps.some((g) => g.type === 'uncovered' || g.type === 'changed')).toBe(false);
  });
});
