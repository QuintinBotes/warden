import { describe, expect, it } from 'vitest';
import type { SpecCatalogEntry, TestCase } from '@warden/core';
import { reconcileCatalog } from './catalog-merge.js';

function testCase(overrides: Partial<TestCase> & Pick<TestCase, 'id' | 'title'>): TestCase {
  return {
    type: 'integration',
    priority: 'P2',
    tags: [],
    requirementIds: [],
    automation: { framework: 'playwright' },
    source: 'manual',
    ...overrides,
  };
}

const CATALOG: SpecCatalogEntry[] = [
  {
    externalId: '1',
    title: 'A',
    tags: ['@smoke'],
    requirementIds: ['JIRA-1'],
    automation: 'automated',
  },
  {
    externalId: '2',
    title: 'B changed in tool',
    tags: [],
    requirementIds: ['JIRA-2'],
    automation: 'manual',
  },
  {
    externalId: '3',
    title: 'C only in tool',
    tags: [],
    requirementIds: ['JIRA-2'],
    automation: 'manual',
  },
];

const LOCAL: TestCase[] = [
  testCase({ id: 'TC-1', title: 'A', tags: ['@smoke', '@Qase-1'], requirementIds: ['JIRA-1'] }),
  testCase({ id: 'TC-2', title: 'B', tags: ['@Qase-2'], requirementIds: ['JIRA-2'] }),
  testCase({ id: 'TC-4', title: 'D authored locally', tags: ['@smoke'] }),
  testCase({ id: 'TC-5', title: 'E orphan', tags: ['@Qase-99'] }),
];

describe('reconcileCatalog', () => {
  const result = reconcileCatalog('qase', CATALOG, LOCAL);

  it('classifies a joined, agreeing entry as matched', () => {
    expect(result.matched.map((e) => e.externalId)).toEqual(['1']);
    expect(result.matched[0]?.localCase?.id).toBe('TC-1');
  });

  it('classifies a joined, disagreeing entry as changed', () => {
    expect(result.changed.map((e) => e.externalId)).toEqual(['2']);
  });

  it('classifies a tool-only entry as new-in-tool', () => {
    expect(result.newInTool.map((e) => e.externalId)).toEqual(['3']);
    expect(result.newInTool[0]?.localCase).toBeUndefined();
  });

  it('classifies an untagged local case as new-in-code', () => {
    expect(result.newInCode.map((e) => e.localCase?.id)).toEqual(['TC-4']);
    expect(result.newInCode[0]?.externalId).toBeUndefined();
  });

  it('classifies a tagged local case with no catalog match as orphaned', () => {
    expect(result.orphaned.map((e) => e.externalId)).toEqual(['99']);
    expect(result.orphaned[0]?.localCase?.id).toBe('TC-5');
  });

  it('folds the tool’s requirement links into a deduped list', () => {
    expect(result.requirementIds).toEqual(['JIRA-1', 'JIRA-2']);
  });

  it('accounts for every catalog entry and local case exactly once', () => {
    // 3 catalog (matched+changed+new-in-tool) + 2 local-only (new-in-code+orphaned) = 5 entries.
    expect(result.entries).toHaveLength(5);
  });
});
