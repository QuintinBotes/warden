import { describe, expect, it } from 'vitest';
import type { TestStatus, TmsSource } from '@warden/core';
import { mapResultStatus } from './result-status.js';

const ALL_STATUSES: TestStatus[] = ['PASS', 'FAIL', 'SKIP', 'BLOCKED', 'FLAKY'];
const ALL_SOURCES: TmsSource[] = [
  'testomatio',
  'qase',
  'testrail',
  'xray',
  'zephyr',
  'allure-testops',
];

describe('mapResultStatus', () => {
  it('maps every core status for every tool without gaps', () => {
    for (const source of ALL_SOURCES) {
      for (const status of ALL_STATUSES) {
        const mapping = mapResultStatus(source, status);
        expect(mapping.status).toBeDefined();
        expect(mapping.status).not.toBe('');
      }
    }
  });

  it('maps PASS→passed / FAIL→failed for testomat.io', () => {
    expect(mapResultStatus('testomatio', 'PASS').status).toBe('passed');
    expect(mapResultStatus('testomatio', 'FAIL').status).toBe('failed');
    expect(mapResultStatus('testomatio', 'SKIP').status).toBe('skipped');
  });

  it('reports FLAKY as passed-with-flaky-flag', () => {
    const mapping = mapResultStatus('testomatio', 'FLAKY');
    expect(mapping.status).toBe('passed');
    expect(mapping.flaky).toBe(true);
  });

  it('does not set the flaky flag for non-flaky statuses', () => {
    expect(mapResultStatus('qase', 'PASS').flaky).toBeUndefined();
  });

  it('uses numeric TestRail status_ids', () => {
    expect(mapResultStatus('testrail', 'PASS').status).toBe(1);
    expect(mapResultStatus('testrail', 'FAIL').status).toBe(5);
    expect(mapResultStatus('testrail', 'BLOCKED').status).toBe(2);
  });

  it('uses Xray uppercase and Zephyr title-case vocabularies', () => {
    expect(mapResultStatus('xray', 'PASS').status).toBe('PASSED');
    expect(mapResultStatus('zephyr', 'SKIP').status).toBe('Not Executed');
    expect(mapResultStatus('allure-testops', 'BLOCKED').status).toBe('broken');
  });
});
