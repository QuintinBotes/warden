import type { SqliteStore } from '@warden/test-management';
import type { Requirement, TestExecution, TestResult } from '@warden/core';

function result(
  overrides: Partial<TestResult> & { testCaseId: string; status: TestResult['status'] },
): TestResult {
  return {
    duration: 1200,
    retries: 0,
    flakeFlag: false,
    artifacts: [],
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `daysAgo(3)` from a fixed anchor so the demo dataset's dates are stable across runs. */
function daysAgo(anchor: Date, n: number): Date {
  return new Date(anchor.getTime() - n * DAY_MS);
}

/**
 * Populates `store` with a small, realistic-looking demo dataset: requirements across a
 * few modules (auth, checkout, search), and a run of executions over the last ten days
 * whose results are deliberately mixed — a stable pass, a stable fail, a flaky test that
 * lands `shouldQuarantine`, a skipped test, and a linked-but-never-run test case (so
 * `coverageMatrix` has a `null` cell to exercise). Media paths are attached to failing and
 * flaky results, mirroring what the E2E runner captures for the dashboard's replay view.
 */
export function seedStore(
  store: SqliteStore,
  anchor: Date = new Date('2026-07-07T12:00:00.000Z'),
): void {
  const requirements: Requirement[] = [
    {
      id: 'REQ-AUTH-001',
      title: 'Users can log in with valid credentials',
      type: 'story',
      linkedTestIds: ['TC-AUTH-001', 'TC-AUTH-002'],
      coverageStatus: 'NOT_TESTED',
    },
    {
      id: 'REQ-AUTH-002',
      title: 'Users can log out',
      type: 'story',
      linkedTestIds: ['TC-AUTH-003'],
      coverageStatus: 'NOT_TESTED',
    },
    {
      id: 'REQ-CHECKOUT-001',
      title: 'Users can complete checkout with a saved card',
      type: 'story',
      linkedTestIds: ['TC-CHECKOUT-001'],
      coverageStatus: 'NOT_TESTED',
    },
    {
      id: 'REQ-CHECKOUT-002',
      title: 'Discount codes apply correctly at checkout',
      type: 'bug',
      linkedTestIds: ['TC-CHECKOUT-002'],
      coverageStatus: 'NOT_TESTED',
    },
    {
      id: 'REQ-SEARCH-001',
      title: 'Search returns relevant results',
      type: 'feature',
      linkedTestIds: ['TC-SEARCH-001', 'TC-SEARCH-002'],
      coverageStatus: 'NOT_TESTED',
    },
  ];
  for (const req of requirements) store.saveRequirement(req);

  store.saveTestPlan({
    id: 'PLAN-NIGHTLY',
    name: 'Nightly regression',
    version: '1.0.0',
    testSetIds: ['TS-1'],
    environments: ['staging'],
    entryCriteria: [],
    exitCriteria: [],
    schedule: 'nightly',
    status: 'ACTIVE',
  });

  // TC-AUTH-001: stable pass. TC-AUTH-002: flaky (2 fails / 5 runs -> 0.4, quarantined).
  // TC-AUTH-003: stable pass. TC-CHECKOUT-001: stable pass. TC-CHECKOUT-002: stable fail.
  // TC-SEARCH-001: mostly pass with one skip. TC-SEARCH-002: never executed (linked, no runs).
  const auth002Statuses: TestResult['status'][] = ['PASS', 'PASS', 'FAIL', 'PASS', 'FAIL'];

  const executions: TestExecution[] = [];
  for (let i = 0; i < 5; i++) {
    const startedAt = daysAgo(anchor, 9 - i * 2); // day 9, 7, 5, 3, 1 ago
    const auth002Status = auth002Statuses[i] ?? 'PASS';
    const results: TestResult[] = [
      result({ testCaseId: 'TC-AUTH-001', status: 'PASS', duration: 800 }),
      result({
        testCaseId: 'TC-AUTH-002',
        status: auth002Status,
        duration: 950,
        flakeFlag: auth002Status === 'FAIL',
        errorMessage: auth002Status === 'FAIL' ? 'Timed out waiting for redirect' : undefined,
        screenshotPath: auth002Status === 'FAIL' ? `media/auth-002-${i}.png` : undefined,
      }),
      result({ testCaseId: 'TC-AUTH-003', status: 'PASS', duration: 400 }),
      result({ testCaseId: 'TC-CHECKOUT-001', status: 'PASS', duration: 2100 }),
      result({
        testCaseId: 'TC-CHECKOUT-002',
        status: 'FAIL',
        duration: 1800,
        errorMessage: 'Discount not applied',
        screenshotPath: `media/checkout-002-${i}.png`,
        videoPath: `media/checkout-002-${i}.mp4`,
      }),
      result({
        testCaseId: 'TC-SEARCH-001',
        status: i === 2 ? 'SKIP' : 'PASS',
        duration: 600,
      }),
    ];

    executions.push({
      id: `EXEC-${i + 1}`,
      testPlanId: 'PLAN-NIGHTLY',
      triggerType: i === 4 ? 'pr' : 'schedule',
      triggerRef: i === 4 ? 'refs/pull/42' : 'nightly',
      environment: 'staging',
      startedAt,
      completedAt: new Date(startedAt.getTime() + 5 * 60 * 1000),
      results,
    });
  }

  for (const execution of executions) store.saveExecution(execution);
}
