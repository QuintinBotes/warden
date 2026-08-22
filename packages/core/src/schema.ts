import { z } from 'zod';

/**
 * The Warden domain model — Xray-inspired: Requirement → Test → Execution → Result.
 * Schemas are the single source of truth; TS types are inferred from them, so runtime
 * validation and compile-time types can never drift.
 */

/**
 * `SKIP` is a test the author chose not to run — harmless, and the gate treats it that way.
 * `BLOCKED` is a test that started and never finished (a run cut short by `--max-failures`, a
 * global timeout, or SIGINT): its result is unknown, so it blocks the merge gate rather than
 * being counted as a skip. The two are never interchangeable.
 */
export const TestStatus = z.enum(['PASS', 'FAIL', 'SKIP', 'BLOCKED', 'FLAKY']);
export type TestStatus = z.infer<typeof TestStatus>;

export const Priority = z.enum(['P1', 'P2', 'P3']);
export type Priority = z.infer<typeof Priority>;

export const TestType = z.enum([
  'unit',
  'integration',
  'smoke',
  'sanity',
  'regression',
  'exploratory',
  'api',
  'performance',
  'security',
]);
export type TestType = z.infer<typeof TestType>;

export const CoverageStatus = z.enum(['PASSED', 'FAILED', 'NOT_TESTED', 'PARTIAL']);
export type CoverageStatus = z.infer<typeof CoverageStatus>;

/** A captured artifact from a test run — the raw material the dashboard replays. */
export const ArtifactSchema = z.object({
  type: z.enum(['screenshot', 'video', 'trace', 'log']),
  path: z.string(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const RequirementSchema = z.object({
  id: z.string(), // maps to a GitHub Issue #, Jira key, etc.
  title: z.string(),
  type: z.enum(['story', 'bug', 'feature', 'epic']),
  linkedTestIds: z.array(z.string()).default([]),
  coverageStatus: CoverageStatus.default('NOT_TESTED'),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const TestCaseSchema = z.object({
  id: z.string(), // e.g. "TC-042"
  title: z.string(),
  type: TestType,
  priority: Priority,
  tags: z.array(z.string()).default([]),
  requirementIds: z.array(z.string()).default([]),
  automation: z.object({
    framework: z.enum(['playwright', 'vitest', 'jest', 'k6', 'manual']),
    filePath: z.string().optional(),
    testName: z.string().optional(),
  }),
  source: z.enum(['manual', 'ai-generated', 'recorded']),
  generatedFrom: z.string().optional(), // PR number or commit SHA
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const TestPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(), // semver or sprint name
  testSetIds: z.array(z.string()).default([]),
  environments: z.array(z.string()).default([]),
  entryCriteria: z.array(z.string()).default([]),
  exitCriteria: z.array(z.string()).default([]),
  schedule: z.enum(['on_pr', 'on_merge', 'nightly', 'release']),
  status: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']).default('DRAFT'),
});
export type TestPlan = z.infer<typeof TestPlanSchema>;

export const TestResultSchema = z.object({
  testCaseId: z.string(),
  /**
   * Human-readable test title (e.g. `checkout › apply discount code`), preserved from the
   * runner so reporters can show a real name instead of the opaque `testCaseId` hash.
   * Optional/back-compatible: consumers fall back to `testCaseId` when absent.
   */
  name: z.string().optional(),
  /** Source file the test lives in, preserved from the runner for the dashboard/reporters. */
  filePath: z.string().optional(),
  /**
   * Suite the test belongs to, preserved from the runner. Runners that report a suite
   * instead of a file path (Vitest, Jest) leave `filePath` empty, and this is then the
   * only real grouping a result carries.
   */
  suite: z.string().optional(),
  status: TestStatus,
  /**
   * Criticality of this test, when the runner said so — CTRF `extra.priority` or a `@P1`-style
   * tag. Optional because most suites mark nothing; the gate's `blockOnCritical` and
   * `warnOnHighCount` rules only fire on results that carry one, never on unmarked tests.
   */
  priority: Priority.optional(),
  duration: z.number(), // ms
  errorMessage: z.string().optional(),
  /** Media paths, populated by the runner (WS-12) for the dashboard's E2E replay (WS2-20). */
  screenshotPath: z.string().optional(),
  videoPath: z.string().optional(),
  tracePath: z.string().optional(),
  artifacts: z.array(ArtifactSchema).default([]),
  retries: z.number().int().nonnegative(),
  flakeFlag: z.boolean(),
});
export type TestResult = z.infer<typeof TestResultSchema>;

export const TestExecutionSchema = z.object({
  id: z.string(),
  testPlanId: z.string(),
  triggerType: z.enum(['pr', 'push', 'schedule', 'manual']),
  triggerRef: z.string(), // PR number, commit SHA, etc.
  environment: z.string(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
  results: z.array(TestResultSchema).default([]),
});
export type TestExecution = z.infer<typeof TestExecutionSchema>;
