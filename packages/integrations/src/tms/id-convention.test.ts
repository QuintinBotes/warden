import { describe, expect, it } from 'vitest';
import type { TestCase, TmsSource } from '@warden/core';
import {
  externalIdFromTestCase,
  externalIdTag,
  injectExternalId,
  parseExternalId,
  sourceRefFromTestCase,
  withExternalId,
} from './id-convention.js';

/** (source, externalId, tag) triples covering all six tag formats. */
const CASES: [TmsSource, string, string][] = [
  ['testomatio', '@T1a2b3c4d', '@T1a2b3c4d'],
  ['qase', '42', '@Qase-42'],
  ['testrail', 'C123', '@C123'],
  ['xray', 'CALC-1234', '@CALC-1234'],
  ['zephyr', 'ZE-5', '@ZE-5'],
  ['allure-testops', 'AS-9', '@AS-9'],
];

function testCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'TC-1',
    title: 'Example',
    type: 'integration',
    priority: 'P2',
    tags: [],
    requirementIds: [],
    automation: { framework: 'playwright' },
    source: 'manual',
    ...overrides,
  };
}

describe('id-convention', () => {
  describe('externalIdTag + parseExternalId round-trip', () => {
    it.each(CASES)('round-trips %s ids through the tag format', (source, externalId, tag) => {
      expect(externalIdTag(source, externalId)).toBe(tag);
      expect(parseExternalId(source, ['@smoke', tag, '@regression'])).toBe(externalId);
    });

    it('returns undefined when no id tag is present', () => {
      expect(parseExternalId('qase', ['@smoke', '@regression'])).toBeUndefined();
    });

    it('does not cross-match another tool’s tag format', () => {
      // A TestRail `@C123` tag is not a Qase id.
      expect(parseExternalId('qase', ['@C123'])).toBeUndefined();
      // A Qase `@Qase-42` tag is not a TestRail id.
      expect(parseExternalId('testrail', ['@Qase-42'])).toBeUndefined();
    });

    it('normalizes bare ids into the tool tag format', () => {
      expect(externalIdTag('testrail', '123')).toBe('@C123');
      expect(externalIdTag('allure-testops', '9')).toBe('@AS-9');
      expect(externalIdTag('qase', '@Qase-42')).toBe('@Qase-42');
    });
  });

  describe('injectExternalId', () => {
    it('adds the id tag alongside existing tags', () => {
      expect(injectExternalId('qase', ['@smoke'], '42')).toEqual(['@smoke', '@Qase-42']);
    });

    it('is a no-op when the exact id tag is already present', () => {
      const tags = ['@smoke', '@Qase-42'];
      expect(injectExternalId('qase', tags, '42')).toBe(tags);
    });

    it('replaces a stale id tag for the same source', () => {
      expect(injectExternalId('qase', ['@smoke', '@Qase-7'], '42')).toEqual(['@smoke', '@Qase-42']);
    });
  });

  describe('TestCase mapping', () => {
    it('parses the external id a case already carries', () => {
      const tc = testCase({ tags: ['@smoke', '@T1a2b3c4d'] });
      expect(externalIdFromTestCase('testomatio', tc)).toBe('@T1a2b3c4d');
    });

    it('builds a SourceCodeRef from the automation block', () => {
      const tc = testCase({
        automation: {
          framework: 'playwright',
          filePath: 'tests/e2e/x.spec.ts',
          testName: 'does x',
        },
      });
      expect(sourceRefFromTestCase(tc)).toEqual({
        filePath: 'tests/e2e/x.spec.ts',
        testName: 'does x',
        framework: 'playwright',
      });
    });

    it('returns no SourceCodeRef when the automation block lacks file/test name', () => {
      expect(sourceRefFromTestCase(testCase())).toBeUndefined();
    });

    it('withExternalId returns a copy carrying the id tag', () => {
      const tc = testCase({ tags: ['@smoke'] });
      const next = withExternalId('xray', tc, 'CALC-1234');
      expect(next.tags).toEqual(['@smoke', '@CALC-1234']);
      expect(tc.tags).toEqual(['@smoke']); // original untouched
    });
  });
});
