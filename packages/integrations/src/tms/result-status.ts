import type { TestStatus, TmsSource } from '@warden/core';

/**
 * Maps Warden's closed `TestStatus` (`PASS | FAIL | SKIP | BLOCKED | FLAKY`) onto each external
 * tool's result vocabulary. `FLAKY` has no first-class slot in most tools, so it maps to the
 * tool's *passed* value plus a `flaky` flag the adapter can attach separately.
 */
export interface ResultMapping {
  /** The tool-native result value — a string for most tools, a numeric `status_id` for TestRail. */
  status: string | number;
  /** True when the core status was `FLAKY` (reported passed-but-flaky). */
  flaky?: boolean;
}

type StatusTable = Record<TestStatus, string | number>;

const TABLES: Record<TmsSource, StatusTable> = {
  // testomat.io reporter: passed | failed | skipped.
  testomatio: {
    PASS: 'passed',
    FAIL: 'failed',
    SKIP: 'skipped',
    BLOCKED: 'failed',
    FLAKY: 'passed',
  },
  // Qase result statuses.
  qase: { PASS: 'passed', FAIL: 'failed', SKIP: 'skipped', BLOCKED: 'blocked', FLAKY: 'passed' },
  // TestRail numeric status_id: 1=Passed, 2=Blocked, 3=Untested, 4=Retest, 5=Failed.
  testrail: { PASS: 1, FAIL: 5, SKIP: 3, BLOCKED: 2, FLAKY: 1 },
  // Xray execution statuses.
  xray: { PASS: 'PASSED', FAIL: 'FAILED', SKIP: 'TODO', BLOCKED: 'ABORTED', FLAKY: 'PASSED' },
  // Zephyr Scale execution status names.
  zephyr: {
    PASS: 'Pass',
    FAIL: 'Fail',
    SKIP: 'Not Executed',
    BLOCKED: 'Blocked',
    FLAKY: 'Pass',
  },
  // Allure TestOps result statuses.
  'allure-testops': {
    PASS: 'passed',
    FAIL: 'failed',
    SKIP: 'skipped',
    BLOCKED: 'broken',
    FLAKY: 'passed',
  },
};

/** Map a core `TestStatus` to `source`'s result vocabulary, flagging flakiness separately. */
export function mapResultStatus(source: TmsSource, status: TestStatus): ResultMapping {
  const mapping: ResultMapping = { status: TABLES[source][status] };
  if (status === 'FLAKY') mapping.flaky = true;
  return mapping;
}
