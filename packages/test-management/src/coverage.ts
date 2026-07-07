import type { Requirement, TestCase, TestResult } from '@warden/core';

/**
 * Recompute `coverageStatus` for each requirement from its linked test cases'
 * latest results. A test case is "linked" to a requirement either via the
 * requirement's own `linkedTestIds`, or via the test case's `requirementIds`
 * pointing back at the requirement (looked up through `casesById`).
 *
 * The "latest" result for a test case is the last matching entry in `results`
 * (callers are expected to pass results in chronological order — oldest first).
 */
export function computeCoverage(
  reqs: Requirement[],
  results: TestResult[],
  casesById: Record<string, TestCase>,
): Requirement[] {
  const latestByTestCase = new Map<string, TestResult>();
  for (const result of results) {
    latestByTestCase.set(result.testCaseId, result);
  }

  const reverseLinks = new Map<string, Set<string>>();
  for (const testCase of Object.values(casesById)) {
    for (const reqId of testCase.requirementIds) {
      const set = reverseLinks.get(reqId) ?? new Set<string>();
      set.add(testCase.id);
      reverseLinks.set(reqId, set);
    }
  }

  return reqs.map((req) => {
    const linkedIds = new Set<string>(req.linkedTestIds);
    for (const id of reverseLinks.get(req.id) ?? []) {
      linkedIds.add(id);
    }

    if (linkedIds.size === 0) {
      return { ...req, coverageStatus: 'NOT_TESTED' };
    }

    const latestResults: TestResult[] = [];
    for (const id of linkedIds) {
      const latest = latestByTestCase.get(id);
      if (latest) latestResults.push(latest);
    }

    if (latestResults.length === 0) {
      return { ...req, coverageStatus: 'NOT_TESTED' };
    }
    if (latestResults.some((r) => r.status === 'FAIL')) {
      return { ...req, coverageStatus: 'FAILED' };
    }
    if (
      latestResults.length === linkedIds.size &&
      latestResults.every((r) => r.status === 'PASS')
    ) {
      return { ...req, coverageStatus: 'PASSED' };
    }
    return { ...req, coverageStatus: 'PARTIAL' };
  });
}
