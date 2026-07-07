import { describe, expect, it } from 'vitest';
import type { Requirement, TestCase, TestResult } from '@warden/core';
import { computeCoverage } from './coverage.js';

function makeCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'TC-001',
    title: 'A test',
    type: 'unit',
    priority: 'P2',
    tags: [],
    requirementIds: [],
    automation: { framework: 'vitest' },
    source: 'manual',
    ...overrides,
  };
}

function makeReq(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: 'REQ-001',
    title: 'A requirement',
    type: 'story',
    linkedTestIds: [],
    coverageStatus: 'NOT_TESTED',
    ...overrides,
  };
}

function makeResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    testCaseId: 'TC-001',
    status: 'PASS',
    duration: 1,
    retries: 0,
    flakeFlag: false,
    artifacts: [],
    ...overrides,
  };
}

describe('computeCoverage', () => {
  it('marks a requirement PASSED when all linked tests last passed', () => {
    const reqs = [makeReq({ id: 'REQ-1', linkedTestIds: ['TC-1', 'TC-2'] })];
    const results: TestResult[] = [
      makeResult({ testCaseId: 'TC-1', status: 'PASS' }),
      makeResult({ testCaseId: 'TC-2', status: 'PASS' }),
    ];

    const out = computeCoverage(reqs, results, {});

    expect(out[0]?.coverageStatus).toBe('PASSED');
  });

  it('marks a requirement FAILED when any linked test last failed', () => {
    const reqs = [makeReq({ id: 'REQ-1', linkedTestIds: ['TC-1', 'TC-2'] })];
    const results: TestResult[] = [
      makeResult({ testCaseId: 'TC-1', status: 'PASS' }),
      makeResult({ testCaseId: 'TC-2', status: 'FAIL' }),
    ];

    const out = computeCoverage(reqs, results, {});

    expect(out[0]?.coverageStatus).toBe('FAILED');
  });

  it('marks a requirement NOT_TESTED when none of its tests have a result', () => {
    const reqs = [makeReq({ id: 'REQ-1', linkedTestIds: ['TC-1'] })];

    const out = computeCoverage(reqs, [], {});

    expect(out[0]?.coverageStatus).toBe('NOT_TESTED');
  });

  it('marks a requirement NOT_TESTED when it has no linked tests at all', () => {
    const reqs = [makeReq({ id: 'REQ-1', linkedTestIds: [] })];

    const out = computeCoverage(reqs, [], {});

    expect(out[0]?.coverageStatus).toBe('NOT_TESTED');
  });

  it('marks a requirement PARTIAL when some linked tests have no result yet', () => {
    const reqs = [makeReq({ id: 'REQ-1', linkedTestIds: ['TC-1', 'TC-2'] })];
    const results: TestResult[] = [makeResult({ testCaseId: 'TC-1', status: 'PASS' })];

    const out = computeCoverage(reqs, results, {});

    expect(out[0]?.coverageStatus).toBe('PARTIAL');
  });

  it('uses the latest (last in array) result per test case', () => {
    const reqs = [makeReq({ id: 'REQ-1', linkedTestIds: ['TC-1'] })];
    const results: TestResult[] = [
      makeResult({ testCaseId: 'TC-1', status: 'FAIL' }),
      makeResult({ testCaseId: 'TC-1', status: 'PASS' }),
    ];

    const out = computeCoverage(reqs, results, {});

    expect(out[0]?.coverageStatus).toBe('PASSED');
  });

  it('links test cases via casesById requirementIds in addition to linkedTestIds', () => {
    const reqs = [makeReq({ id: 'REQ-1', linkedTestIds: [] })];
    const casesById: Record<string, TestCase> = {
      'TC-1': makeCase({ id: 'TC-1', requirementIds: ['REQ-1'] }),
    };
    const results: TestResult[] = [makeResult({ testCaseId: 'TC-1', status: 'PASS' })];

    const out = computeCoverage(reqs, results, casesById);

    expect(out[0]?.coverageStatus).toBe('PASSED');
  });

  it('does not mutate the input requirements', () => {
    const reqs = [makeReq({ id: 'REQ-1', linkedTestIds: ['TC-1'] })];
    const results: TestResult[] = [makeResult({ testCaseId: 'TC-1', status: 'PASS' })];

    computeCoverage(reqs, results, {});

    expect(reqs[0]?.coverageStatus).toBe('NOT_TESTED');
  });
});
