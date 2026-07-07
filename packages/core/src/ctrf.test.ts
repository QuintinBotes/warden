import { describe, it, expect } from 'vitest';
import { CTRFReportSchema } from './ctrf';

describe('CTRFReportSchema', () => {
  it('parses the blueprint CTRF example', () => {
    const report = CTRFReportSchema.parse({
      results: {
        tool: { name: 'Playwright', version: '1.52.0' },
        summary: {
          tests: 47,
          passed: 44,
          failed: 2,
          skipped: 1,
          pending: 0,
          other: 0,
          start: 1751900400000,
          stop: 1751900580000,
        },
        tests: [
          {
            name: 'checkout > complete with credit card',
            status: 'failed',
            duration: 8423,
            message: "Expected 'Payment confirmed' but got 'Error processing payment'",
            trace: 'playwright-traces/checkout-failure.zip',
            filePath: 'tests/e2e/checkout.spec.ts',
            tags: ['@apps/checkout', '@regression'],
            extra: { requirementIds: ['ISSUE-201'], priority: 'P1', flakeRate: 0.02 },
          },
        ],
        environment: {
          appName: 'MyApp',
          appVersion: '2.4.1',
          buildName: 'PR-123',
          branchName: 'feat/checkout-redesign',
          testEnvironment: 'preview-pr-123',
        },
      },
    });
    expect(report.results.summary.tests).toBe(47);
    expect(report.results.tests[0]?.status).toBe('failed');
  });

  it('rejects a report missing the summary', () => {
    expect(() => CTRFReportSchema.parse({ results: { tool: { name: 'x' }, tests: [] } })).toThrow();
  });
});
