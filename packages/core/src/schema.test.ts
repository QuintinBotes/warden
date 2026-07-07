import { describe, it, expect } from 'vitest';
import { TestCaseSchema, RequirementSchema, TestExecutionSchema, TestResultSchema } from './schema';

describe('TestCaseSchema', () => {
  it('parses the blueprint TC-042 example', () => {
    const tc = TestCaseSchema.parse({
      id: 'TC-042',
      title: 'User can complete checkout with credit card',
      type: 'regression',
      priority: 'P1',
      tags: ['@apps/checkout', '@regression'],
      requirementIds: ['ISSUE-201', 'ISSUE-205'],
      automation: {
        framework: 'playwright',
        filePath: 'tests/e2e/checkout.spec.ts',
        testName: 'checkout > complete with credit card',
      },
      source: 'ai-generated',
      generatedFrom: 'PR-89',
    });
    expect(tc.id).toBe('TC-042');
    expect(tc.type).toBe('regression');
    expect(tc.automation.framework).toBe('playwright');
  });

  it('rejects an unknown priority', () => {
    expect(() =>
      TestCaseSchema.parse({
        id: 'x',
        title: 't',
        type: 'smoke',
        priority: 'P9',
        tags: [],
        requirementIds: [],
        automation: { framework: 'manual' },
        source: 'manual',
      }),
    ).toThrow();
  });
});

describe('RequirementSchema', () => {
  it('parses a requirement with a coverage status', () => {
    const r = RequirementSchema.parse({
      id: 'ISSUE-201',
      title: 'Credit-card checkout',
      type: 'story',
      linkedTestIds: ['TC-042', 'TC-043'],
      coverageStatus: 'FAILED',
    });
    expect(r.coverageStatus).toBe('FAILED');
  });
});

describe('TestResultSchema (media for dashboard replay)', () => {
  it('carries screenshot, video, and trace paths plus an artifacts list', () => {
    const result = TestResultSchema.parse({
      testCaseId: 'TC-042',
      status: 'FAIL',
      duration: 8423,
      errorMessage: 'Expected "Payment confirmed" but got "Error processing payment"',
      screenshotPath: 'artifacts/checkout-failure.png',
      videoPath: 'artifacts/checkout-failure.webm',
      tracePath: 'artifacts/checkout-failure.zip',
      retries: 1,
      flakeFlag: false,
      artifacts: [
        { type: 'video', path: 'artifacts/checkout-failure.webm' },
        { type: 'screenshot', path: 'artifacts/checkout-failure.png' },
      ],
    });
    expect(result.videoPath).toBe('artifacts/checkout-failure.webm');
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts?.[0]?.type).toBe('video');
  });

  it('defaults artifacts to an empty list and requires a valid status', () => {
    const r = TestResultSchema.parse({
      testCaseId: 'TC-1',
      status: 'PASS',
      duration: 12,
      retries: 0,
      flakeFlag: false,
    });
    expect(r.artifacts).toEqual([]);
    expect(() =>
      TestResultSchema.parse({
        testCaseId: 'TC-1',
        status: 'NOPE',
        duration: 1,
        retries: 0,
        flakeFlag: false,
      }),
    ).toThrow();
  });
});

describe('TestExecutionSchema', () => {
  it('coerces an ISO start time and nests results', () => {
    const ex = TestExecutionSchema.parse({
      id: 'EX-1',
      testPlanId: 'TP-1',
      triggerType: 'pr',
      triggerRef: '482',
      environment: 'preview-pr-482',
      startedAt: '2026-07-07T12:00:00.000Z',
      results: [
        { testCaseId: 'TC-042', status: 'PASS', duration: 100, retries: 0, flakeFlag: false },
      ],
    });
    expect(ex.startedAt).toBeInstanceOf(Date);
    expect(ex.results[0]?.status).toBe('PASS');
  });
});
